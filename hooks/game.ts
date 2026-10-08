import type { Color, Effort, Game, Result, RulesPreset, SavedGame, Side, TimeControl } from '../types'
import { Chess, DEFAULT_POSITION } from './vendor/chess.js'

// price: first-party API $/MTok for input, output, cache read, 5-minute cache write. Update when Anthropic reprices.
export const MODELS = [
  { value: 'claude-fable-5-1', label: 'Fable 5.1', price: [10, 50, 0.25, 12.5] },
  { value: 'claude-opus-5-5', label: 'Opus 5.5', price: [4, 20, 0.2, 5] },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5', price: [2, 10, 0.2, 2.5] },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', price: [1, 5, 0.1, 1.25] },
] as const
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']


type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number }

// Claude Code's `modelPricing` setting, as $.settings.read() hands it: contracted rates per model ID, and a flat multiplier.
// An override named by a bare ID (claude-haiku-4-5) also covers its dated spelling (claude-haiku-4-5-20251001).
// ponytail: provider spellings (Bedrock, Vertex ARNs) of a built-in ID are not matched; chessus only asks first-party IDs.
export const contractedRates = (setting: unknown, model: string): { rates?: Rates; multiplier: number } => {
  const s = (setting ?? {}) as { multiplier?: unknown; overrides?: Record<string, unknown> }
  const m = typeof s.multiplier === 'number' && s.multiplier > 0 && s.multiplier <= 1 ? s.multiplier : 1
  const id = model.toLowerCase()
  const row = Object.entries(s.overrides ?? {}).find(([k]) => id === k.toLowerCase() || id === `${k.toLowerCase()}-${id.slice(-8)}` && /^\d{8}$/.test(id.slice(-8)))?.[1] as Partial<Rates> | undefined
  const isValid = !!row && (['input', 'output', 'cacheRead', 'cacheWrite'] as const).every(k => typeof row[k] === 'number' && row[k] >= 0 && row[k] <= 10_000)
  return { rates: isValid ? (row as Rates) : undefined, multiplier: m }
}

export const priceUsd = (model: string, u: Usage, pricing?: unknown) => {
  const { rates, multiplier } = contractedRates(pricing, model)
  const [input, output, read, write] = rates ? [rates.input, rates.output, rates.cacheRead, rates.cacheWrite] : MODELS.find(m => m.value === model)?.price ?? [0, 0, 0, 0]
  return (multiplier * (u.input_tokens * input + u.output_tokens * output + u.cache_read_input_tokens * read + u.cache_creation_input_tokens * write)) / 1e6
}

const MIN = 60_000
export const TIME_CONTROLS: TimeControl[] = [
  { id: 'untimed', label: 'Untimed', baseMs: 0, incMs: 0 },
  { id: '1+0', label: 'Bullet 1+0', baseMs: 1 * MIN, incMs: 0 },
  { id: '3+2', label: 'Blitz 3+2', baseMs: 3 * MIN, incMs: 2000 },
  { id: '5+3', label: 'Blitz 5+3', baseMs: 5 * MIN, incMs: 3000 },
  { id: '10+5', label: 'Rapid 10+5', baseMs: 10 * MIN, incMs: 5000 },
  { id: '15+10', label: 'Rapid 15+10', baseMs: 15 * MIN, incMs: 10_000 },
  { id: '90+30', label: 'Classical 90+30', baseMs: 90 * MIN, incMs: 30_000 },
]
const ILLEGAL_BONUS_MS = 2 * MIN

export const isTimed = (tc: TimeControl) => tc.baseMs > 0
// FIDE Appendix A/B: blitz is at most 10 minutes per player, counting 60 moves of increment
export const isBlitz = (tc: TimeControl) => isTimed(tc) && tc.baseMs + 60 * tc.incMs <= 10 * MIN

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')
export const turnOf = (g: Pick<Game, 'history'>): Color => (g.history.length % 2 === 0 ? 'w' : 'b')
export const sideOf = (g: Pick<Game, 'white' | 'black'>, c: Color) => (c === 'w' ? g.white : g.black)
export const winFor = (c: Color): Result => (c === 'w' ? '1-0' : '0-1')

export const nameOf = (side: Side) =>
  side.kind === 'human' ? 'You' : `${MODELS.find(m => m.value === side.model)?.label ?? side.model} (${side.effort})`

export const replay = (history: readonly string[], upto = history.length) => {
  const board = new Chess()
  for (const san of history.slice(0, upto)) board.move(san)
  return board
}

export type NewGame = {
  id: number
  white: Side
  black: Side
  tc: TimeControl
  rules: RulesPreset
  isClaudeClocked: boolean
  canSwitchOpponent?: boolean
  round?: string
  event?: string
}

export const newGame = (o: NewGame, now: number): Game => ({
  ...o,
  round: o.round ?? '-',
  event: o.event ?? 'Casual game',
  history: [],
  clock: { w: o.tc.baseMs, b: o.tc.baseMs },
  turnStartedAt: now,
  illegal: { w: 0, b: 0 },
  result: '*',
  termination: '',
  note: '',
  thinking: '',
  isPaused: false,
  isHalted: false,
  nextMoveAt: 0,
  spentUsd: 0,
})

export const isClockRunning = (g: Game, c: Color) =>
  isTimed(g.tc) && g.result === '*' && !g.isPaused && turnOf(g) === c && (sideOf(g, c).kind === 'human' || g.isClaudeClocked)

export const remaining = (g: Game, c: Color, now: number) =>
  isClockRunning(g, c) ? g.clock[c] - (now - g.turnStartedAt) : g.clock[c]

const end = (g: Game, result: Result, termination: string): Game => ({ ...g, result, termination, thinking: '' })

export const freeze = (g: Game, now: number): Game => {
  if (g.isPaused) return g
  const c = turnOf(g)
  return { ...g, clock: { ...g.clock, [c]: remaining(g, c, now) }, turnStartedAt: now, isPaused: true }
}

export const unfreeze = (g: Game, now: number): Game => (g.isPaused ? { ...g, turnStartedAt: now, isPaused: false } : g)

const positionKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

export const repetitions = (history: readonly string[]) => {
  const board = new Chess()
  const counts = new Map<string, number>()
  const bump = () => counts.set(positionKey(board.fen()), (counts.get(positionKey(board.fen())) ?? 0) + 1)
  bump()
  for (const san of history) {
    board.move(san)
    bump()
  }
  return counts.get(positionKey(board.fen())) ?? 1
}

const halfmoves = (board: Chess) => Number(board.fen().split(' ')[4])

// FIDE 6.9: c can mate by some legal series (a helpmate counts). A lone king never can; a lone minor
// only when the other side has material to block its own king.
// ponytail: misses locked-pawn and same-colored-bishop dead positions
export const canMate = (board: Chess, c: Color) => {
  const pieces = (color: Color) => board.board().flat().filter(p => p !== null && p.color === color && p.type !== 'k')
  const mine = pieces(c)
  if (mine.length === 0) return false
  const isLoneMinor = mine.length === 1 && (mine[0]!.type === 'n' || mine[0]!.type === 'b')
  return !(isLoneMinor && pieces(c === 'w' ? 'b' : 'w').length === 0)
}

const afterMove = (g: Game): Game => {
  const board = replay(g.history)
  if (board.isCheckmate()) return end(g, winFor(other(turnOf(g))), 'checkmate')
  if (board.isStalemate()) return end(g, '1/2-1/2', 'stalemate')
  if (board.isInsufficientMaterial()) return end(g, '1/2-1/2', 'insufficient material')
  if (repetitions(g.history) >= 5) return end(g, '1/2-1/2', 'fivefold repetition')
  if (halfmoves(board) >= 150) return end(g, '1/2-1/2', '75-move rule')
  return g
}

export const claimable = (g: Game) => {
  if (g.result !== '*') return ''
  if (repetitions(g.history) >= 3) return 'threefold repetition'
  if (halfmoves(replay(g.history)) >= 100) return '50-move rule'
  return ''
}

export const flag = (g: Game, c: Color): Game => {
  const opponent = other(c)
  const flagged = { ...g, clock: { ...g.clock, [c]: 0 } }
  return canMate(replay(g.history), opponent)
    ? end(flagged, winFor(opponent), 'time forfeit')
    : end(flagged, '1/2-1/2', 'time forfeit, opponent cannot mate')
}

export const flagIfOut = (g: Game, now: number) => {
  const c = turnOf(g)
  return isClockRunning(g, c) && remaining(g, c, now) <= 0 ? flag(g, c) : g
}

export type MoveInput = string | { from: string; to: string; promotion?: string }

export const applyMove = (g: Game, move: MoveInput, now: number): Game | null => {
  if (g.result !== '*') return null
  const c = turnOf(g)
  const board = replay(g.history)
  let san: string
  try {
    san = board.move(move).san
  } catch {
    return null
  }
  const spent = isClockRunning(g, c) ? now - g.turnStartedAt : 0
  if (isTimed(g.tc) && g.clock[c] - spent <= 0) return flag(g, c)
  const clock = isTimed(g.tc) ? { ...g.clock, [c]: g.clock[c] - spent + g.tc.incMs } : g.clock
  return afterMove({ ...g, history: [...g.history, san], clock, turnStartedAt: now, note: '' })
}

export const illegalMove = (g: Game, c: Color, reply = ''): Game => {
  const count = g.illegal[c] + 1
  const counted = { ...g, illegal: { ...g.illegal, [c]: count } }
  if (isBlitz(g.tc) || count >= 2) return end(counted, winFor(other(c)), 'illegal move')
  const opponent = other(c)
  const clock = isTimed(g.tc) ? { ...g.clock, [opponent]: g.clock[opponent] + ILLEGAL_BONUS_MS } : g.clock
  const penalty = isTimed(g.tc) ? 'opponent gets 2 extra minutes' : 'warning; a second one loses'
  const said = reply ? ` ("${reply}")` : ''
  return { ...counted, clock, note: `${nameOf(sideOf(g, c))} played an illegal move${said}: ${penalty}.` }
}

export const resign = (g: Game, c: Color) => (g.result === '*' ? end(g, winFor(other(c)), `${c === 'w' ? 'White' : 'Black'} resigned`) : g)

export const agreeDraw = (g: Game) => (g.result === '*' ? end(g, '1/2-1/2', 'draw by agreement') : g)

export const claimDraw = (g: Game) => {
  const reason = claimable(g)
  return reason ? end(g, '1/2-1/2', `draw claimed: ${reason}`) : g
}

const tcHeader = (tc: TimeControl) => (isTimed(tc) ? `${tc.baseMs / 1000}+${tc.incMs / 1000}` : '-')

export const toPgn = (g: Game, date: Date) => {
  const board = replay(g.history)
  const headers: [string, string][] = [
    ['Event', g.event],
    ['Site', 'Claude Code (chessus)'],
    ['Date', `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`],
    ['Round', g.round],
    ['White', nameOf(g.white)],
    ['Black', nameOf(g.black)],
    ['Result', g.result],
    ['TimeControl', tcHeader(g.tc)],
    ['Termination', g.termination || 'unterminated'],
  ]
  for (const [k, v] of headers) board.setHeader(k, v)
  return board.pgn()
}

export const fromPgn = (pgn: string) => {
  const board = new Chess()
  board.loadPgn(pgn)
  return { history: board.history(), headers: board.getHeaders() }
}

const RESULTS: readonly Result[] = ['1-0', '0-1', '1/2-1/2', '*']

// Text from PGN files and APIs is shown in the pane: strip control characters (escape sequences) and keep it short.
export const cleanText = (text: string, max = 80) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max)
const MAX_IMPORT = 200

// A Lichess page links to its PGN export: a game (/abcdEFGH, maybe with a colour suffix) or a study (/study/ID).
export const pgnUrl = (url: string) => {
  const u = new URL(url)
  if (!/(^|\.)lichess\.org$/.test(u.hostname) || u.pathname.startsWith('/api/') || u.pathname.startsWith('/game/export/')) return url
  const study = /^\/study\/([A-Za-z0-9]{8})/.exec(u.pathname)
  if (study) return `https://lichess.org/api/study/${study[1]}.pgn`
  const game = /^\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?$/.exec(u.pathname)
  return game ? `https://lichess.org/game/export/${game[1]}` : url
}

// One PGN file may hold many games: a new game starts at a tag block after a blank line.
export const importGames = (text: string, at: string) => {
  const chunks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n(?=\[)/).map(s => s.trim()).filter(Boolean)
  const games: SavedGame[] = []
  let failed = 0
  for (const pgn of chunks.slice(0, MAX_IMPORT)) {
    try {
      const { history, headers } = fromPgn(pgn)
      if (history.length === 0) throw new Error('no moves')
      // Replays start from the standard position, so a game set up from a FEN or another variant cannot be shown.
      const isCustomStart = headers.FEN !== undefined && headers.FEN !== DEFAULT_POSITION
      if (isCustomStart || (headers.Variant && headers.Variant !== 'Standard')) throw new Error('custom start')
      const result = (RESULTS as readonly string[]).includes(headers.Result ?? '') ? (headers.Result as Result) : '*'
      const event = [headers.Event, headers.Date?.slice(0, 4)].filter(s => s && !s.includes('?')).join(' ')
      const board = replay(history)
      for (const tag of ['Event', 'Site', 'Date', 'Round', 'White', 'Black']) if (headers[tag]) board.setHeader(tag, headers[tag]!)
      board.setHeader('Result', result)
      games.push({ pgn: board.pgn(), white: cleanText(headers.White ?? '?'), black: cleanText(headers.Black ?? '?'), result, termination: cleanText(event) || 'imported', at })
    } catch {
      failed++
    }
  }
  return { games, failed: failed + Math.max(0, chunks.length - MAX_IMPORT) }
}
