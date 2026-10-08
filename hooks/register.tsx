import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Color, CostStat, Effort, Game, Prefs, Review, SavedGame, Screen, Side, Tournament, View } from '../types'
import { CLASSICS, classicPgn, classicTermination } from './classics'
import { drawPrompt, isAcceptance, movePrompt, namesAMove, pickMove } from './claude'
import type { Ask } from './claude'
import {
  EFFORTS, MODELS, TIME_CONTROLS, agreeDraw, cleanText, importGames, pgnUrl, applyMove, claimDraw, claimable, flagIfOut, freeze, fromPgn, illegalMove,
  isClockRunning, isTimed, nameOf, newGame, other, priceUsd, remaining, replay, resign, sideOf, toPgn, turnOf, unfreeze,
} from './game'
import type { NewGame } from './game'
import { estimateUsd, nextPairing, roundRobin, standings } from './tournament'

const PANE = 'chessus'
const MAX_SAVED = 200
const MAX_ENTRANTS = 8
const LIBRARY_ROWS = 15
const MAX_FOUND = 10
// Settings labels sit in one column this wide, so every value and hint lines up.
const SETTINGS_LABEL_WIDTH = 24
const OPTION_LABEL_WIDTH = 20
// One import adds at most this many games (the newest in the file) and reads at most this much text.
const MAX_IMPORT_ONCE = 30
const MAX_IMPORT_CHARS = 2_000_000
const TICK_MS = 500
const HELP = `Chessus commands

Play
  /chess                      open the pane
  /chess <model> [effort]     new game, you (White) vs Claude: /chess opus high
                              models: fable, opus, sonnet, haiku · efforts: low, medium, high, xhigh, max (default medium)
  /chess move <move>          play a move: e4, Nf3, O-O, exd5, e8=Q or e2e4
  /chess pause                freeze both clocks and Claude
  /chess resume               carry on a paused game
  /chess save                 save the game to resume later from replays
  /chess resign               resign, after a yes/no question
  /chess close                close the pane; mid-game it pauses and saves first

Drive the pane from the chat
  /chess keys                 list every key, picker and field on screen now
  /chess key <key>            press one: /chess key 2 opens new game
  /chess set <name> <value>   change a picker or fill a field: /chess set tc 5+3

Screens
  /chess replays              famous games, online search, saved games (also /chess library)
  /chess tournament           tournament setup, or standings while one runs
  /chess settings             defaults for new games

Games and files
  /chess last                 replay your last finished game
  /chess search <words>       find official events on Lichess: /chess search candidates
  /chess player <username>    load a Chess.com player's latest month of games
  /chess import <url|file>    load PGN from a Lichess link, any PGN URL, or a .pgn file
  /chess export <path>        write every saved game to one PGN file

/chess runs at once, even while Claude is replying.`

// Every hotkey, picker and field the pane last drew, so /chess can drive the pane from the chat when clicks and keys never reach it.
type Control = { kind: 'key' | 'set'; label: string; options?: readonly string[]; run: (value: string) => unknown }
const controls = new Map<string, Control>()
const MAX_API_ERRORS = 3
const CASUAL_RETRIES = 3
const UNREADABLE_RETRIES = 3

const SONNET: Side = { kind: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }
const DEFAULT_PREFS: Prefs = { tcId: 'untimed', rules: 'standard', isClaudeClocked: true, isDouble: false, budgetUsd: 5, spectateMs: 1000, replayMs: 1000, canSwitchOpponent: false }
const DEFAULT_VIEW: View = {
  screen: 'setup', ply: null, isFlipped: false,
  draft: { white: { kind: 'human' }, black: SONNET },
  entrants: [], pick: { model: SONNET.model, effort: 'medium' }, review: null,
}

const gameA = atom({ plugin: 'chessus', key: 'game' } as const, null)
const tourA = atom({ plugin: 'chessus', key: 'tournament' } as const, null)
const viewA = atom({ plugin: 'chessus', key: 'view' } as const, DEFAULT_VIEW)
const settingsA = atom({ plugin: 'chessus', key: 'settings' } as const, DEFAULT_PREFS)
const nowA = atom({ plugin: 'chessus', key: 'now' } as const, 0)

export const tcOf = (id: string) => TIME_CONTROLS.find(t => t.id === id) ?? TIME_CONTROLS[0]!
const eventOf = (t: Tournament) => `Chessus tournament #${t.id}`
const sideFrom = (value: string, effort: Effort): Side => (value === 'human' ? { kind: 'human' } : { kind: 'claude', model: value, effort })
const PLAYER_OPTIONS = [{ value: 'human', label: 'You' }, ...MODELS]
const costKey = (side: Side) => (side.kind === 'claude' ? `${side.model}|${side.effort}` : '')

// Sidebar beside the board: players, clocks, moves, status. Lichess-style.
const SIDEBAR = 26
// Width beside the 8 squares: rank labels 2, gap 2, sidebar. Rows besides the squares: nav, the gap under it, files row, promo row, two key rows (replay and game over), Claude's spend.
const BESIDE_BOARD = 4 + SIDEBAR
const CHROME_ROWS = 8
// What the pane asks for when it opens: room for the 7x3 board and the sidebar. The person's own resize wins.
const PANE_ROWS = 8 * 3 + CHROME_ROWS
const PANE_COLUMNS = 8 * 7 + BESIDE_BOARD
// Sidebar rows that are not moves, worst case: mode header, 2 player lines, 2 rules, gap, STATUS label, status,
// then two rows: a note during play, or the outcome and its follow-up line once it ends.
const SIDEBAR_FIXED_ROWS = 10
const SWITCH_ROWS = 2
// The store holds 4 MiB in all; the library keeps well under it so settings, costs and the live game always fit.
const LIBRARY_BYTES = 3_000_000

// Squares are 7x3 cells when the pane has room, else 5x2, else 3x1 (a terminal cell is about twice as tall as wide).
// Below 3x1's needs the board still draws at 3x1 and the pane scrolls.
export const boardCell = (columns: number, rows: number) => {
  const sizes = [{ w: 7, h: 3 }, { w: 5, h: 2 }, { w: 3, h: 1 }]
  return sizes.find(s => BESIDE_BOARD + 8 * s.w <= columns && 8 * s.h + CHROME_ROWS <= rows) ?? sizes[2]!
}

export const formatClock = (ms: number) => {
  const t = Math.max(0, ms)
  if (t < 10_000) return `${(t / 1000).toFixed(1)}s`
  const s = Math.floor(t / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Why no Claude call may be made for this game now: it is paused or over, or its tournament is paused or at its cap.
const heldBy = async ($: EngineInterface, gameId: number) => {
  const g = await read($, gameA)
  if (!g || g.id !== gameId || g.result !== '*') return 'The game is over.'
  if (g.isPaused) return 'The game is paused.'
  const t = await read($, tourA)
  if (!isTournamentGame(g, t)) return ''
  if (t.spentUsd >= t.budgetUsd) return `Budget of $${t.budgetUsd} reached.`
  return t.status === 'running' ? '' : 'The tournament is paused.'
}

// Every Claude call goes through here, so nothing is spent while the game is held. The check sits right before the call.
const complete = async ($: EngineInterface, g: Game, c: Color, prompt: string, timeoutMs: number) => {
  const side = sideOf(g, c)
  if (side.kind !== 'claude') throw new Error('not a Claude side')
  // Claude Code prices at the managed modelPricing only; a project's settings cannot change what it bills.
  const pricing = await $.settings.read({ source: 'policy' }).then(p => p.modelPricing, () => undefined)
  const held = await heldBy($, g.id)
  if (held) return { held }
  const r = await $.model.complete({ model: side.model, effort: side.effort, prompt, maxTokens: 16_000, timeoutMs })
  return { r, usd: priceUsd(side.model, r.usage, pricing) }
}

const askMove = async ($: EngineInterface, g: Game, c: Color, retry: string, timeoutMs: number) => {
  const res = await complete($, g, c, movePrompt(g, c, retry), timeoutMs)
  if (!res.r) return { held: res.held ?? '' }
  const { r, usd } = res
  if (!r.isAnswered) return { ask: { kind: 'error', reason: r.reason } as Ask, usd }
  if (r.text.trim() === '') return { ask: { kind: 'error', reason: 'empty reply' } as Ask, usd }
  const san = pickMove(r.text, replay(g.history).moves())
  const text = cleanText(r.text, 60)
  const ask: Ask = san ? { kind: 'move', san } : namesAMove(r.text) ? { kind: 'illegal', text } : { kind: 'unreadable', text }
  return { ask, usd }
}

const askDraw = async ($: EngineInterface, g: Game, c: Color) => {
  const res = await complete($, g, c, drawPrompt(g, c), 120_000)
  if (!res.r) return { held: res.held ?? '' }
  return { isAccepted: res.r.isAnswered && isAcceptance(res.r.text), usd: res.usd }
}

const loadGames = async ($: EngineInterface) => ((await $.store.get('games')) as SavedGame[] | undefined) ?? []
// 0.1.1's table ('costs') counted moves at $0 once Claude Code 2.1.292 froze the session cost, so 0.1.2 starts a new one.
const COSTS_KEY = 'costs-v2'
const loadCosts = async ($: EngineInterface) => ((await $.store.get(COSTS_KEY)) as Record<string, CostStat> | undefined) ?? {}

const patchTour = ($: EngineInterface, fn: (t: Tournament) => Partial<Tournament>) => update($, tourA, t => t && { ...t, ...fn(t) })

// Any view change by hand (a step, another screen, closing the replay) stops autoplay; autoplay moves the ply itself
// through update(), never through here.
const setView = ($: EngineInterface, patch: Partial<View>) =>
  update($, viewA, v => ({
    ...v,
    ...('screen' in patch || 'review' in patch ? { confirm: null } : {}),
    ...('screen' in patch || 'review' in patch || 'ply' in patch || 'confirm' in patch ? { autoplay: null } : {}),
    ...('screen' in patch && patch.screen !== 'library' && v.screen === 'library' ? { found: [], searchNote: '' } : {}),
    ...patch,
  }))

const REPLAY_SPEEDS = [250, 500, 1000, 2000, 5000]
const speedLabel = (ms: number) => `${ms / 1000}s a move`
const shownHistory = async ($: EngineInterface, v: View) => (v.review ? v.review.history : (await read($, gameA))?.history ?? [])
let autoplaySeq = 0

const isPaneShown = async ($: EngineInterface) => (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
const scheduleAutoplay = async ($: EngineInterface, token: number) =>
  $.clock.after((await read($, settingsA)).replayMs, () => void autoplayStep($, token))

// The replay on screen steps itself forward at the replay speed until its end, while its token is the view's and the
// pane is shown. A view change by hand clears the token, so a pending step finds it gone.
const autoplayStep = async ($: EngineInterface, token: number) => {
  const v = await read($, viewA)
  if (v.autoplay !== token) return
  if (!(await isPaneShown($))) return update($, viewA, x => (x.autoplay === token ? { ...x, autoplay: null } : x))
  const history = await shownHistory($, v)
  let isMore = false
  await update($, viewA, x => {
    isMore = false
    if (x.autoplay !== token) return x
    const next = Math.min((x.ply ?? history.length) + 1, history.length)
    isMore = next < history.length
    return { ...x, ply: isMore || x.review ? next : null, autoplay: isMore ? token : null }
  })
  if (isMore) await scheduleAutoplay($, token)
}

const toggleAutoplay = async ($: EngineInterface) => {
  const v = await read($, viewA)
  const history = await shownHistory($, v)
  const shown = (x: View) => `${x.screen}|${JSON.stringify(x.review)}`
  const token = ++autoplaySeq
  let isStarted = false
  await update($, viewA, x => {
    isStarted = false
    if (x.autoplay) return { ...x, autoplay: null }
    // Started only on the replay it was pressed in; from the end it plays again from the start.
    if (shown(x) !== shown(v)) return x
    isStarted = true
    return { ...x, ply: x.ply === null || x.ply >= history.length ? 0 : x.ply, autoplay: token }
  })
  if (isStarted) await scheduleAutoplay($, token)
}

// A new speed applies at once: a running autoplay takes a new token, which drops the step pending at the old speed.
const cycleReplaySpeed = async ($: EngineInterface) => {
  const ms = (await read($, settingsA)).replayMs
  await setSettings($, { replayMs: REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(ms) + 1) % REPLAY_SPEEDS.length]! })
  const token = ++autoplaySeq
  let isRunning = false
  await update($, viewA, x => {
    isRunning = !!x.autoplay
    return isRunning ? { ...x, autoplay: token } : x
  })
  if (isRunning) await scheduleAutoplay($, token)
}

// M4: the library is capped by count and by size, oldest out first; a full store never blocks the caller.
const saveGames = async ($: EngineInterface, added: SavedGame[]) => {
  const before = await loadGames($)
  let games = [...before, ...added].slice(-MAX_SAVED)
  while (games.length > added.length && JSON.stringify(games).length > LIBRARY_BYTES) games = games.slice(1)
  const evicted = Math.max(0, before.length - (games.length - added.length))
  try {
    await $.store.set('games', games)
    return { isSaved: true, evicted }
  } catch {
    return { isSaved: false, evicted: 0 }
  }
}
const setSettings = async ($: EngineInterface, patch: Partial<Prefs>) => {
  await update($, settingsA, s => ({ ...s, ...patch }))
  await $.store.set('settings', await read($, settingsA))
}

const isTournamentGame = (g: Game, t: Tournament | null): t is Tournament =>
  t !== null && t.current !== null && t.status !== 'done' && g.event === eventOf(t)

const spend = async ($: EngineInterface, gameId: number, side: Side, usd: number, isMove: boolean) => {
  const g = await read($, gameA)
  await update($, gameA, x => (x && x.id === gameId ? { ...x, spentUsd: x.spentUsd + usd } : x))
  if (g && g.id === gameId) await update($, tourA, t => (t && isTournamentGame(g, t) ? { ...t, spentUsd: t.spentUsd + usd } : t))
  // ponytail: get-then-set on the cost table; two overlapping calls can drop one sample of an average
  const costs = await loadCosts($)
  const was = costs[costKey(side)] ?? { usd: 0, moves: 0 }
  await $.store.set(COSTS_KEY, { ...costs, [costKey(side)]: { usd: was.usd + usd, moves: was.moves + (isMove ? 1 : 0) } })
}

// An unfinished casual game outlives the session; a tournament game ends with its tournament.
const LIVE_KEY = 'live'
const CASUAL = 'Casual game'

const saveLive = async ($: EngineInterface) => {
  const g = await read($, gameA)
  if (g && g.result === '*' && g.event === CASUAL) await $.store.set(LIVE_KEY, { ...g, thinking: '' })
  else await $.store.delete(LIVE_KEY)
}

// A restored game comes back paused: no clock runs and Claude spends nothing until the person resumes.
// Time away is not charged.
const restoreLive = async ($: EngineInterface) => {
  if (await read($, gameA)) return
  const live = (await $.store.get(LIVE_KEY)) as Game | undefined
  if (!live || live.result !== '*') return
  const now = await $.clock.now()
  await update($, gameA, () => freeze({ ...live, thinking: '', isHalted: false, isPaused: false, turnStartedAt: now, nextMoveAt: 0 }, now))
  await update($, nowA, () => now)
  await setView($, { screen: 'game', ply: null, review: null, confirm: null, isFlipped: live.white.kind !== 'human' && live.black.kind === 'human' })
}

const isLiveCasual = (g: Game | null): g is Game => !!g && g.result === '*' && g.event === CASUAL

// Pause freezes both clocks and Claude; the game is already saved, so a paused game survives a restart too.
const pauseGame = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, gameA, g => (isLiveCasual(g) ? freeze(g, now) : g))
  await saveLive($)
}

const resumeGame = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, gameA, g => (isLiveCasual(g) ? unfreeze(g, now) : g))
  await saveLive($)
  kick($, 0)
}

const resignGame = async ($: EngineInterface) => {
  const cur = await read($, gameA)
  if (cur && cur.result === '*') await finish($, resign(cur, humanColor(cur) ?? turnOf(cur)))
}

const closePane = async ($: EngineInterface, isPausing: boolean) => {
  if (isPausing) await pauseGame($)
  await setView($, { confirm: null, autoplay: null })
  await $.ui.close({ id: PANE })
}

// The one writer of a finished game. It claims the game inside the update, so a flag racing a move or a resign lands once.
const finish = async ($: EngineInterface, g: Game) => {
  let isClaimed = false
  await update($, gameA, prev => {
    isClaimed = !!prev && prev.id === g.id && prev.result === '*' && g.result !== '*' && g.history.length >= prev.history.length
    return isClaimed ? { ...g, thinking: '' } : prev
  })
  if (!isClaimed) return
  await saveLive($)
  const t = await read($, tourA)
  const pairing = isTournamentGame(g, t) ? t.current : null
  const saved: SavedGame = {
    pgn: toPgn(g, new Date()), white: nameOf(g.white), black: nameOf(g.black),
    result: g.result, termination: g.termination, at: new Date().toISOString(),
    ...(t && pairing !== null ? { tournament: t.id, pairing } : {}),
  }
  const { isSaved } = await saveGames($, [saved])
  if (!isSaved) $.ui.toast('Chessus could not save the finished game: the store is full. /chess export, then clear old games.')
  await setView($, { confirm: null })
  if (pairing === null) return
  await update($, tourA, x => {
    if (!x || x.current !== pairing) return x
    const pairings = x.pairings.map((p, i) => (i === pairing ? { ...p, result: g.result } : p))
    return { ...x, pairings, current: null, status: nextPairing(pairings) === null ? 'done' : x.status }
  })
}

const kick = ($: EngineInterface, ms: number) => void $.clock.after(ms, () => void pump($))

const settle = async ($: EngineInterface, g: Game) => {
  if (g.result !== '*') return finish($, g)
  const isSpectating = g.white.kind === 'claude' && g.black.kind === 'claude'
  const delay = isSpectating ? (await read($, settingsA)).spectateMs : 0
  const now = await $.clock.now()
  await update($, gameA, x => {
    if (!x || x.id !== g.id || x.result !== '*') return x
    const moved = { ...g, nextMoveAt: now + delay }
    return x.isPaused ? freeze({ ...moved, isPaused: false }, now) : moved
  })
  await saveLive($)
  kick($, delay)
}

const halt = async ($: EngineInterface, gameId: number, note: string) => {
  await update($, gameA, g => (g && g.id === gameId ? { ...g, thinking: '', isHalted: true, note } : g))
  const g = await read($, gameA)
  if (g && g.id === gameId) await update($, tourA, t => (t && isTournamentGame(g, t) ? { ...t, note: `Game halted: ${note}` } : t))
}

// No module-level busy flag: an old call still waiting (the opponent was switched, or a hot reload) must not
// block the next ask. The thinking token in claudeTurn is what keeps two asks from both moving.
const pump = async ($: EngineInterface) => {
  await claudeTurn($).catch(() => undefined)
}

const pauseTournament = async ($: EngineInterface, note: string) => {
  const now = await $.clock.now()
  await patchTour($, () => ({ status: 'paused', note }))
  const t = await read($, tourA)
  await update($, gameA, g => (g && g.result === '*' && isTournamentGame(g, t) ? freeze(g, now) : g))
}

const resumeTournament = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await patchTour($, () => ({ status: 'running', note: '' }))
  await update($, gameA, g => (g ? unfreeze(g, now) : g))
  kick($, 0)
}

// The live game plays on as a casual game; it is no longer scored.
const endTournament = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const t = await read($, tourA)
  await update($, gameA, g => (g && g.result === '*' && isTournamentGame(g, t) ? { ...unfreeze(g, now), event: CASUAL } : g))
  await patchTour($, () => ({ status: 'done', current: null, note: 'Ended early.' }))
  await saveLive($)
  kick($, 0)
}

// M2: a casual game in progress is never silently replaced: it goes to the library as abandoned first.
const archiveCasual = async ($: EngineInterface) => {
  const live = await read($, gameA)
  if (!isLiveCasual(live) || live.history.length === 0) return
  const saved: SavedGame = {
    pgn: toPgn(live, new Date()), white: nameOf(live.white), black: nameOf(live.black),
    result: '*', termination: 'abandoned', at: new Date().toISOString(),
  }
  const { isSaved } = await saveGames($, [saved])
  $.ui.toast(isSaved ? 'The unfinished game went to "saved" as abandoned.' : 'The unfinished game could not be saved: the store is full.')
}

const claudeTurn = async ($: EngineInterface) => {
  const g = await read($, gameA)
  if (!g || g.result !== '*' || g.thinking || g.isHalted || g.isPaused) return
  if ((await $.clock.now()) < g.nextMoveAt) return
  const c = turnOf(g)
  const side = sideOf(g, c)
  if (side.kind !== 'claude') return
  const token = `${g.id}:${g.history.length}:${Math.random()}`
  await update($, gameA, s => (s && s.id === g.id && !s.thinking && s.history.length === g.history.length ? { ...s, thinking: token } : s))

  const isMine = (s: Game | null): s is Game => !!s && s.id === g.id && s.thinking === token && s.result === '*'
  try {
    await askUntilMoved($, g, c, side, token, isMine)
  } catch (err) {
    const why = `Claude's move failed (${err instanceof Error ? err.message : String(err)}). Press retry.`
    await update($, gameA, s => (isMine(s) ? { ...s, thinking: '', isHalted: true, note: why } : s))
  }
}

const askUntilMoved = async (
  $: EngineInterface, g: Game, c: Color, side: Side & { kind: 'claude' }, token: string, isMine: (s: Game | null) => s is Game,
) => {
  let retry = ''
  let errors = 0
  let casualMisses = 0
  let unreadable = 0
  const release = () => update($, gameA, s => (isMine(s) ? { ...s, thinking: '' } : s))
  for (;;) {
    const before = await read($, gameA)
    if (!isMine(before)) return
    const now = await $.clock.now()
    const timeoutMs = isClockRunning(before, c) ? Math.max(1000, remaining(before, c, now) + 500) : 600_000
    const asked = await askMove($, before, c, retry, timeoutMs)
    if (!asked.ask) {
      // A move at the cap pauses the tournament, freezing the game before the turn is let go so the ticker starts no other
      // call. Only moves pause it: a draw offer pausing would throw away a paid move call already under way.
      const t = await read($, tourA)
      if (isTournamentGame(before, t) && t.status === 'running' && t.spentUsd >= t.budgetUsd) {
        await pauseTournament($, `${asked.held} Raise it in Settings, then resume.`)
      }
      return release()
    }
    const { ask, usd } = asked
    await spend($, g.id, side, usd, ask.kind === 'move')
    const cur = await read($, gameA)
    if (!isMine(cur)) return
    if (cur.isPaused) return release()
    const at = await $.clock.now()

    if (ask.kind === 'move') {
      if (sideOf(cur, other(c)).kind === 'human') $.ui.toast(`${nameOf(side)} played ${ask.san}`)
      return settle($, { ...applyMove(cur, ask.san, at)!, thinking: '' })
    }
    if (ask.kind === 'error') {
      if (++errors >= MAX_API_ERRORS) return halt($, g.id, `${nameOf(side)} is unavailable (${ask.reason}). Press retry.`)
      await $.clock.sleep(2000)
      continue
    }
    // A reply with no move in it is asked again for free; only a named move that is not legal costs a penalty.
    if (ask.kind === 'unreadable' && ++unreadable <= UNREADABLE_RETRIES) {
      retry = `Your previous reply "${ask.text}" did not contain a move. Reply with exactly one move from the legal list, like ${replay(cur.history).moves()[0]}.`
      continue
    }
    if (cur.rules === 'casual') {
      if (++casualMisses <= CASUAL_RETRIES) {
        retry = `Your previous reply "${ask.text}" was not a legal move.`
        continue
      }
      const legal = replay(cur.history).moves()
      const moved = applyMove(cur, legal[Math.floor(Math.random() * legal.length)]!, at)!
      return settle($, { ...moved, thinking: '', note: `${nameOf(side)} gave no legal move after ${CASUAL_RETRIES} retries; a random legal move was played.` })
    }
    const penalized = illegalMove(cur, c, ask.text)
    if (penalized.result !== '*') return finish($, penalized)
    await update($, gameA, s => (isMine(s) ? penalized : s))
    retry = `Your previous reply "${ask.text}" was an illegal move and was penalized. Another illegal move loses the game.`
  }
}

const startGame = async ($: EngineInterface, o: Omit<NewGame, 'id'>, screen: Screen | null = 'game', history: string[] = []) => {
  const live = await read($, gameA)
  if (screen !== null && live && live.result === '*' && isTournamentGame(live, await read($, tourA))) {
    $.ui.toast('A tournament game is in progress. End the tournament first.')
    return false
  }
  await archiveCasual($)
  const now = await $.clock.now()
  const g = { ...newGame({ ...o, id: Math.max((live?.id ?? 0) + 1, Math.floor(now)) }, now), history }
  await update($, gameA, () => g)
  await update($, nowA, () => now)
  await saveLive($)
  if (screen !== null) await setView($, { screen, ply: null, review: null, isFlipped: g.white.kind !== 'human' && g.black.kind === 'human' })
  else await update($, viewA, v => (v.review ? v : { ...v, ply: null, autoplay: null }))
  kick($, 0)
  return true
}

let isStarting = false

const startNext = async ($: EngineInterface) => {
  if (isStarting) return
  isStarting = true
  try {
    await startNextGame($)
  } finally {
    isStarting = false
  }
}

const startNextGame = async ($: EngineInterface) => {
  const t = await read($, tourA)
  if (!t || t.status !== 'running' || t.current !== null) return
  const live = await read($, gameA)
  if (live && live.result === '*' && (!live.isPaused || live.event === CASUAL)) {
    const waiting = 'Waiting: a casual game is open. Finish or resign it to continue.'
    if (live.event === CASUAL && t.note !== waiting) await patchTour($, () => ({ note: waiting }))
    return
  }
  const i = nextPairing(t.pairings)
  if (i === null) {
    await patchTour($, () => ({ status: 'done' }))
    return
  }
  const p = t.pairings[i]!
  await patchTour($, () => ({ current: i }))
  await startGame($, {
    white: t.entrants[p.white]!, black: t.entrants[p.black]!, tc: t.tc, rules: t.rules,
    isClaudeClocked: t.isClaudeClocked, round: String(p.round), event: eventOf(t),
  }, null)
  if ((await read($, tourA))?.status === 'paused') {
    const now = await $.clock.now()
    await update($, gameA, g => (g && g.result === '*' ? freeze(g, now) : g))
  }
}

const tick = async ($: EngineInterface) => {
  const g = await read($, gameA)
  const now = await $.clock.now()
  if (g && g.result === '*' && isTimed(g.tc) && !g.isPaused) {
    const flagged = flagIfOut(g, now)
    if (flagged !== g) await finish($, flagged)
    else await update($, nowA, () => now)
  }
  const isClaudeDue = !!g && g.result === '*' && !g.thinking && !g.isHalted && !g.isPaused && now >= g.nextMoveAt && sideOf(g, turnOf(g)).kind === 'claude'
  if (isClaudeDue) kick($, 0)
  await startNext($)
}

const humanColor = (g: Game): Color | null => {
  const isW = g.white.kind === 'human'
  const isB = g.black.kind === 'human'
  if (isW && isB) return turnOf(g)
  return isW ? 'w' : isB ? 'b' : null
}

const humanMove = async ($: EngineInterface, uci: string, isFromChat = false) => {
  const g = await read($, gameA)
  const v = await read($, viewA)
  if (!g || g.result !== '*' || g.isPaused || sideOf(g, turnOf(g)).kind !== 'human') return false
  if (!isFromChat && (v.ply !== null || v.review)) return false
  const promotion = uci.slice(4, 5)
  const moved = applyMove(g, { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(promotion ? { promotion } : {}) }, await $.clock.now())
  if (!moved) return false
  await settle($, moved)
  return true
}

// From-square to-square, with an optional - x or : between and an optional promotion: e2e4, e2-e4, e7e8q, e7-e8=Q.
const COORDINATE = /^([a-h][1-8])\s*[-x:]?\s*([a-h][1-8])\s*=?([qrbn])?$/i

// One move as a player writes it: SAN (e4, Nf3, O-O, exd5, e8=Q, case and 0-0 forgiven) or coordinates.
// Returns the UCI of the legal move it names, or undefined.
export const parseMove = (text: string, history: readonly string[]) => {
  const t = text.trim()
  const moves = replay(history).moves({ verbose: true })
  const uciOf = (m: (typeof moves)[number]) => m.from + m.to + (m.promotion ?? '')
  const coord = COORDINATE.exec(t)
  if (coord) {
    const uci = (coord[1]! + coord[2]! + (coord[3] ?? '')).toLowerCase()
    return moves.some(m => uciOf(m) === uci) ? uci : undefined
  }
  if (/\s/.test(t)) return undefined
  const castle = t.replace(/[0o]/gi, 'O')
  const typed = /^O-O(-O)?[+#]?$/.test(castle) ? castle : t
  const san = pickMove(typed, moves.map(m => m.san))
  const move = moves.find(m => m.san === san)
  if (move) return uciOf(move)
  // Over-specified but unique (Ngf3 with one knight that reaches f3) is still that move.
  const spelled = /^([NBRQKnrqk])([a-h]?[1-8]?)(x?[a-h][1-8])$/.exec(typed)
  if (!spelled) return undefined
  const piece = spelled[1]!.toUpperCase()
  const from = spelled[2]!.toLowerCase()
  const to = spelled[3]!.toLowerCase().replace('x', '')
  const candidates = moves.filter(m => m.piece === piece.toLowerCase() && m.to === to && m.from.includes(from))
  return candidates.length === 1 ? uciOf(candidates[0]!) : undefined
}

// Why a typed move did not play. SAN requires naming which piece when two can reach a square (Nbd2, R1e2),
// so a bare Nd2 that two knights reach is answered with the moves it could mean.
export const whyNotMove = (text: string, history: readonly string[]) => {
  const coord = COORDINATE.exec(text.trim())
  if (coord && !coord[3]) {
    const fromTo = (coord[1]! + coord[2]!).toLowerCase()
    if (replay(history).moves({ verbose: true }).some(m => m.from + m.to === fromTo && m.promotion)) {
      return `"${text.trim()}" promotes a pawn: add the piece, e.g. ${fromTo}q (queen), ${fromTo}r, ${fromTo}b or ${fromTo}n.`
    }
  }
  const t = text.trim().replace(/[+#?!]/g, '')
  const asked = [t, t.charAt(0).toUpperCase() + t.slice(1)]
  const undisambiguated = (san: string) => san.replace(/[+#]/g, '').replace(/^([NBRQK])[a-h]?[1-8]?(x?[a-h][1-8])$/, '$1$2')
  const meant = replay(history).moves().filter(san => asked.includes(undisambiguated(san)) && !asked.includes(san.replace(/[+#]/g, '')))
  return meant.length > 1 ? `"${text.trim()}" is ambiguous: more than one piece can go there. Write ${[...meant].sort().join(" or ")}.` : `"${text.trim()}" is not a legal move here.`
}

const typedMove = async ($: EngineInterface, text: string) => {
  const g = await read($, gameA)
  const uci = g && parseMove(text, g.history)
  return uci ? humanMove($, uci, true) : false
}

const offerDraw = async ($: EngineInterface) => {
  const g = await read($, gameA)
  const me = g && humanColor(g)
  if (!g || !me || g.result !== '*') return
  const opponent = sideOf(g, other(me))
  if (opponent.kind !== 'claude') return
  const decline = (why: string) => update($, gameA, s => (s && s.id === g.id ? { ...s, note: `No draw offer sent. ${why}` } : s))
  const held = await heldBy($, g.id)
  if (held) return decline(held)
  await update($, gameA, s => (s && s.id === g.id ? { ...s, note: `Offered a draw to ${nameOf(opponent)}...` } : s))
  const res = await askDraw($, g, other(me))
  if (res.held !== undefined) return decline(res.held)
  const { isAccepted, usd } = res
  await spend($, g.id, opponent, usd, false)
  const cur = await read($, gameA)
  if (!cur || cur.id !== g.id || cur.result !== '*') return
  if (isAccepted) return finish($, agreeDraw(cur))
  await update($, gameA, s => (s && s.id === g.id ? { ...s, note: `${nameOf(opponent)} declined the draw.` } : s))
}

// Imported text becomes saved games, the first opens as a replay. One message says what happened.
const importText = async ($: EngineInterface, text: string, from: string) => {
  const { games: parsed, failed } = importGames(text.slice(0, MAX_IMPORT_CHARS), new Date().toISOString())
  if (parsed.length === 0) return `No replayable games in ${from}${failed > 0 ? ` (${failed} skipped: Chess960, custom start or unreadable)` : ''}.`
  const known = new Set((await loadGames($)).map(g => g.pgn))
  const fresh = parsed.filter(g => !known.has(g.pgn))
  const games = fresh.slice(-MAX_IMPORT_ONCE)
  if (games.length === 0) {
    await openReview($, parsed.at(-1)!)
    return `Every game from ${from} is already under replays. Replaying ${parsed.at(-1)!.white} vs ${parsed.at(-1)!.black}.`
  }
  const { isSaved, evicted } = await saveGames($, games)
  if (!isSaved) return 'The store is full. /chess export your games, then try again.'
  const first = games.at(-1)!
  await openReview($, first)
  const notes = [
    failed > 0 ? `skipped ${failed} (Chess960, custom start or unreadable)` : '',
    fresh.length > games.length ? `kept the newest ${games.length} of ${fresh.length}` : '',
    parsed.length > fresh.length ? `${parsed.length - fresh.length} already saved` : '',
  ].filter(Boolean)
  const dropped = evicted > 0 ? ` To make room, your ${evicted} oldest saved game${evicted === 1 ? ' was' : 's were'} dropped.` : ''
  return `Imported ${games.length} game${games.length === 1 ? '' : 's'} from ${from}${notes.length ? ` (${notes.join('; ')})` : ''}. Replaying ${first.white} vs ${first.black}; the rest are under replays.${dropped}`
}

const fetchText = async ($: EngineInterface, url: string, headers: Record<string, string> = {}) => {
  const res = await $.http.fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text
}

const fetchJson = async ($: EngineInterface, url: string, headers: Record<string, string> = {}): Promise<unknown> => {
  const text = await fetchText($, url, headers)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('the reply was not JSON')
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Lichess broadcasts: official over-the-board events (Candidates, Olympiad, national championships).
const searchEvents = async ($: EngineInterface, query: string) => {
  try {
    const body = await fetchJson($, `https://lichess.org/api/broadcast/search?q=${encodeURIComponent(query)}`)
    const results = isRecord(body) && Array.isArray(body.currentPageResults) ? body.currentPageResults : []
    const found = results
      .map(r => (isRecord(r) && isRecord(r.tour) ? r.tour : {}))
      .map(tour => ({ id: tour.id, name: tour.name }))
      .filter((r): r is { id: string; name: string } => typeof r.id === 'string' && /^[A-Za-z0-9]{8}$/.test(r.id) && typeof r.name === 'string')
      .map(r => ({ id: r.id, name: cleanText(r.name) }))
      .filter(r => r.name)
      .slice(0, MAX_FOUND)
    await setView($, { found, searchNote: found.length ? `${found.length} events for "${query}". Pick one to download its games.` : `No events found for "${query}".` })
  } catch (err) {
    await setView($, { found: [], searchNote: `Search failed: ${errorText(err)}.` })
  }
}

const downloadEvent = async ($: EngineInterface, id: string, name: string) => {
  await setView($, { searchNote: `Downloading ${name}...` })
  try {
    const note = await importText($, await fetchText($, `https://lichess.org/api/broadcast/${id}.pgn`), name)
    await setView($, { found: [], searchNote: note })
  } catch (err) {
    await setView($, { searchNote: `Download failed: ${errorText(err)}.` })
  }
}

// Chess.com's public API: a player's games, one month per archive; the latest month is fetched.
const playerGames = async ($: EngineInterface, username: string) => {
  const user = username.trim().toLowerCase()
  if (!/^[a-z0-9_-]{1,40}$/.test(user)) {
    await setView($, { searchNote: `"${cleanText(username, 40)}" is not a Chess.com username.` })
    return
  }
  const headers = { 'User-Agent': 'chessus (Claude Code chess mod)' }
  await setView($, { searchNote: `Fetching ${user}'s games from Chess.com...` })
  try {
    const index = await fetchJson($, `https://api.chess.com/pub/player/${user}/games/archives`, headers)
    const archives = isRecord(index) && Array.isArray(index.archives) ? index.archives.filter((a): a is string => typeof a === 'string') : []
    const prefix = `https://api.chess.com/pub/player/${user}/games/`
    const latest = archives.filter(a => a.startsWith(prefix) && /^\d{4}\/\d{2}$/.test(a.slice(prefix.length))).at(-1)
    if (!latest) {
      await setView($, { searchNote: `${user} has no games on Chess.com.` })
      return
    }
    const month = await fetchJson($, latest, headers)
    const list = isRecord(month) && Array.isArray(month.games) ? month.games : []
    const pgns = list.map(g => (isRecord(g) && typeof g.pgn === 'string' ? g.pgn : '')).filter(Boolean)
    await setView($, { searchNote: await importText($, pgns.join('\n\n'), `${user} on Chess.com (${latest.slice(prefix.length).replace('/', '-')})`) })
  } catch (err) {
    await setView($, { searchNote: `Chess.com fetch failed: ${errorText(err)}.` })
  }
}

// "Black (Haiku 4.5) wins · checkmate", "Draw by agreement", "Draw · stalemate".
export const outcome = (result: string, termination: string, white: string, black: string) => {
  if (result === '1/2-1/2') return /^draw /i.test(termination) ? termination.charAt(0).toUpperCase() + termination.slice(1) : `Draw · ${termination}`
  const winner = result === '1-0' ? `White (${white})` : `Black (${black})`
  return `${winner} wins · ${termination}`
}

// A casual game in progress goes to replays with what it needs to carry on later. Clocks restart on resume.
const saveToResume = async ($: EngineInterface) => {
  const g = await read($, gameA)
  if (!isLiveCasual(g)) return { isSaved: false, text: 'Only a casual game in progress can be saved to resume.' }
  if (g.history.length === 0) return { isSaved: false, text: 'Nothing to save yet: no moves have been played.' }
  const saved: SavedGame = {
    pgn: toPgn(g, new Date()), white: nameOf(g.white), black: nameOf(g.black), result: '*', termination: 'saved to resume',
    at: new Date().toISOString(), resume: { white: g.white, black: g.black, tcId: g.tc.id, rules: g.rules, isClaudeClocked: g.isClaudeClocked, gameId: g.id },
  }
  const isOld = (s: SavedGame) => s.result === '*' && s.resume?.gameId === g.id
  const old = (await loadGames($)).filter(isOld)
  await dropSaved($, isOld)
  const { isSaved } = await saveGames($, [saved])
  if (!isSaved && old.length) await saveGames($, old)
  return isSaved
    ? { isSaved, text: 'Saved under replays: open it there and press r to resume. c copies the PGN to share.' }
    : { isSaved, text: 'The store is full. /chess export your games, then try again.' }
}

// Keeps the live casual game resumable from replays, then clears it so whatever starts next does not archive it again.
// Only clears once the snapshot is really in the store, so a full store never loses the game: false, and the caller stops.
const keepLive = async ($: EngineInterface) => {
  const live = await read($, gameA)
  if (!isLiveCasual(live) || live.history.length === 0) return true
  const { isSaved, text } = await saveToResume($)
  $.ui.toast(text)
  if (!isSaved) return false
  await update($, gameA, x => (isLiveCasual(x) ? null : x))
  return true
}

const deleteSaved = async ($: EngineInterface, review: Review) => {
  if (!review.savedAt) return
  const removed = await dropSaved($, s => s.at === review.savedAt && s.pgn === review.pgn)
  await setView($, { review: null, ply: null, screen: 'library' })
  $.ui.toast(removed > 0 ? `Deleted ${review.white} vs ${review.black}.` : 'That game was already gone.')
}

// Removes the saved games that match, reading the list at the moment of the call. Returns how many went.
const dropSaved = async ($: EngineInterface, isGone: (s: SavedGame) => boolean) => {
  const games = await loadGames($)
  const kept = games.filter(s => !isGone(s))
  if (kept.length !== games.length) await $.store.set('games', kept)
  return games.length - kept.length
}

// Resuming consumes the snapshot: the game carries on, and is saved again when it ends or is saved anew.
const resumeReview = async ($: EngineInterface, review: Review) => {
  const r = review.resume
  if (!r || review.result !== '*') return
  await setView($, { confirm: null })
  await startGame($, { white: r.white, black: r.black, tc: tcOf(r.tcId), rules: r.rules, isClaudeClocked: r.isClaudeClocked }, 'game', review.history)
  if (review.savedAt) await dropSaved($, s => s.result === '*' && s.at === review.savedAt && s.pgn === review.pgn)
}

const openReview = async ($: EngineInterface, saved: SavedGame) => {
  try {
    const { history } = fromPgn(saved.pgn)
    replay(history)
    const review: Review = {
      history, white: saved.white, black: saved.black, result: saved.result, termination: saved.termination, pgn: saved.pgn,
      ...(saved.at ? { savedAt: saved.at } : {}),
      ...(saved.resume ? { resume: saved.resume } : {}),
    }
    await setView($, { screen: 'game', review, ply: 0, isFlipped: false })
    return true
  } catch {
    $.ui.toast(`Chessus cannot replay ${saved.white} vs ${saved.black}: it does not start from the standard position.`)
    return false
  }
}

// A key that opens a yes/no question in the pane asks it in Claude Code's own picker too, once the pane has drawn it.
const confirmFromChat = async ($: EngineInterface) => {
  if (!(await read($, viewA)).confirm) return ''
  for (const k of ['y', 'n', 'k', 'p']) controls.delete(k)
  $.ui.invalidate('ui.render')
  for (let i = 0; i < 20 && !controls.has('y'); i++) await $.clock.sleep(50)
  const yes = controls.get('y')
  const no = controls.get('n')
  if (!yes || !no) return 'its question is waiting in the pane'
  const third = controls.get('k') ?? controls.get('p')
  const choices = [yes, third, no].filter((c): c is Control => !!c)
  const question = third?.label.startsWith('pause') ? 'Leave the game?' : third ? 'What happens to the game in progress?' : `${yes.label}?`
  const answer = await $.ui.ask(question, choices.map(c => c.label)).catch(() => no.label)
  const picked = choices.find(c => c.label === answer) ?? no
  await picked.run('')
  return picked.label
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chess',
      description: 'Chess against Claude, Claude vs Claude, tournaments',
      immediate: true,
      argumentHint: 'help | [model [effort]] | move <move> | pause | resume | save | resign | close | keys | key <key> | set <name> <value> | replays | tournament | settings | last | search <words> | player <user> | import <url|file> | export <path>',
    })
    const stored = (await $.store.get('settings')) as Partial<Prefs> | undefined
    if (stored) await update($, settingsA, s => ({ ...s, ...stored }))
    await update($, gameA, g => (g && g.thinking ? { ...g, thinking: '' } : g))
    await restoreLive($)
    await $.store.delete('costs')
    $.clock.every(TICK_MS, () => void tick($))
    return next(e)
  })

  on('command.run', { command: 'chess' }, async ($, e) => {
    const args = e.args.trim()
    const [first = '', second] = args.split(/\s+/)
    const word = first.toLowerCase()
    const open = async (text: string) => {
      await $.ui.open({ id: PANE, title: 'Chessus', focus: true, rows: PANE_ROWS, columns: PANE_COLUMNS })
      return { text }
    }
    if (word === 'help') return { text: HELP }
    if (['keys', 'key', 'set'].includes(word) && !(await isPaneShown($))) controls.clear()
    if (word === 'keys') {
      if (!controls.size) return open('Chessus opened. Run /chess keys again to list what it shows.')
      const rows = [...controls].map(([k, c]) => (c.kind === 'key' ? `key ${k}: ${c.label}` : `set ${k}: ${c.label}${c.options ? ` (${c.options.join(', ')})` : ' <text>'}`))
      return { text: `On screen now:\n${rows.join('\n')}\n\n/chess key <key> presses one; /chess set <name> <value> picks or fills one.` }
    }
    if (word === 'key' || word === 'set') {
      const value = args.replace(/^\S+(\s+\S+)?\s*/, '')
      const c = second ? (controls.get(second) ?? [...controls].find(([k]) => k.toLowerCase() === second.toLowerCase())?.[1]) : undefined
      if (!c || c.kind !== word) return { text: `Nothing "${second ?? ''}" to ${word === 'key' ? 'press' : 'set'} on screen. /chess keys lists what is.` }
      if (word === 'set' && c.options && !c.options.includes(value)) return { text: `${second} takes: ${c.options.join(', ')}.` }
      if (word === 'set' && !value) return { text: `Usage: /chess set ${second} <value>` }
      await c.run(value)
      const answer = await confirmFromChat($)
      return { text: `${word === 'key' ? 'Pressed' : 'Set'} ${c.label.split(':')[0]}${word === 'set' ? ` to ${value}` : ''}${answer ? `, then ${answer}` : ''}. /chess keys lists what is on screen now.` }
    }
    if (word === 'export') {
      const path = args.slice(first.length).trim()
      if (!path) return { text: 'Usage: /chess export <path>' }
      const games = await loadGames($)
      await $.fs.write(path, games.map(g => g.pgn).join('\n\n') + '\n')
      return { text: `Wrote ${games.length} games to ${path}.` }
    }
    if (word === 'close') {
      const g = await read($, gameA)
      const isPausing = isLiveCasual(g) && !g.isPaused
      await closePane($, isPausing)
      return { text: isPausing ? 'Game paused and saved, Chessus closed. /chess resume continues it.' : 'Chessus closed. /chess opens it again.' }
    }
    if (word === 'save') return { text: (await saveToResume($)).text }
    if (word === 'pause' || word === 'resume') {
      const g = await read($, gameA)
      if (!isLiveCasual(g)) return { text: 'No casual game in progress. Tournament games pause from the tournament screen.' }
      if (word === 'pause') await pauseGame($)
      else await resumeGame($)
      return { text: word === 'pause' ? 'Game paused and saved. /chess resume continues it.' : 'Game resumed.' }
    }
    if (word === 'resign') {
      const g = await read($, gameA)
      if (!g || g.result !== '*' || !humanColor(g)) return { text: 'No game of yours in progress.' }
      const answer = await $.ui.ask(`Resign this game against ${nameOf(sideOf(g, other(humanColor(g)!)))}?`, ['Yes, resign', 'No, keep playing']).catch(() => '')
      if (answer !== 'Yes, resign') return { text: 'Kept playing.' }
      await resignGame($)
      const after = (await read($, gameA))!
      return { text: `You resigned. ${after.result} (${after.termination}). The game is in /chess library.` }
    }
    if (word === 'move') {
      const text = args.slice(first.length).trim()
      if (!text) return { text: 'Usage: /chess move <move>, e.g. e4, Nf3, O-O, exd5, e8=Q or e2e4.' }
      const g = await read($, gameA)
      if (!g || g.result !== '*') return { text: 'No game in progress. Start one with /chess <model>, e.g. /chess haiku low.' }
      if (g.isPaused) return { text: 'The game is paused.' }
      if (sideOf(g, turnOf(g)).kind !== 'human') return { text: `Not your move: ${nameOf(sideOf(g, turnOf(g)))} is to move.` }
      if (!(await typedMove($, text))) {
        return { text: `${whyNotMove(text, g.history)} Legal moves: ${replay(g.history).moves().join(' ')}` }
      }
      await setView($, { ply: null, review: null })
      const after = (await read($, gameA))!
      const played = after.history.at(-1)
      if (after.result !== '*') return { text: `You played ${played}. Game over: ${after.result} (${after.termination}).` }
      const next = sideOf(after, turnOf(after))
      return { text: `You played ${played}.${next.kind === 'claude' ? ` ${nameOf(next)} is thinking; its move shows as a toast and in the pane.` : ''}` }
    }
    if (word === 'import') {
      const source = args.slice(first.length).trim()
      if (!source) return { text: 'Usage: /chess import <url or file>. A Lichess game or study link, any URL serving PGN, or a .pgn file.' }
      let text: string
      try {
        text = /^https?:\/\//i.test(source) ? await fetchText($, pgnUrl(source)) : await $.fs.read(source)
      } catch (err) {
        return { text: `Could not ${/^https?:/i.test(source) ? 'fetch' : 'read'} ${source}: ${errorText(err)}.` }
      }
      return open(await importText($, text, source))
    }
    if (word === 'replays') {
      await setView($, { screen: 'library' })
      return open('Replays opened: classics, online search and your saved games.')
    }
    if (word === 'search') {
      const query = args.slice(first.length).trim()
      if (!query) return { text: 'Usage: /chess search <words>, e.g. /chess search candidates. Searches official events on Lichess.' }
      await setView($, { screen: 'library' })
      await searchEvents($, query)
      return open((await read($, viewA)).searchNote ?? 'Searched.')
    }
    if (word === 'player') {
      const user = args.slice(first.length).trim()
      if (!user) return { text: 'Usage: /chess player <chess.com username>. Loads their latest month of games.' }
      await setView($, { screen: 'library' })
      await playerGames($, user)
      return open((await read($, viewA)).searchNote ?? 'Done.')
    }
    if (word === 'last') {
      const last = (await loadGames($)).at(-1)
      if (!last) return { text: 'No finished games yet.' }
      if (!(await openReview($, last))) return { text: 'That game cannot be replayed.' }
      return open('Reviewing the last game.')
    }
    if (word === 'tournament') {
      const t = await read($, tourA)
      const isActive = !!t && (t.status === 'running' || t.status === 'paused')
      await setView($, isActive ? { screen: 'tournament' } : { screen: 'setup', newMode: 'tournament' })
      return open(isActive ? 'Tournament standings opened.' : 'Tournament setup opened: add players, then start.')
    }
    if (word === 'library' || word === 'settings') {
      await setView($, { screen: word })
      return open(`Chessus ${word} opened.`)
    }
    const model = word ? MODELS.find(m => m.value === word || m.label.toLowerCase().startsWith(word)) : undefined
    if (word && !model) return { text: `Unknown command or model "${first}". Models: ${MODELS.map(m => m.label.split(' ')[0]!.toLowerCase()).join(', ')}. /chess help lists every command.` }
    if (model) {
      const effort = EFFORTS.find(x => x === second) ?? 'medium'
      const live = await read($, gameA)
      if (isLiveCasual(live) && live.history.length > 0) {
        const answer = await $.ui.ask('Start a new game? What happens to the game in progress?', ['Abandon it', 'Keep it to resume', 'Cancel']).catch(() => 'Cancel')
        if (answer === 'Keep it to resume') {
          if (!(await keepLive($))) return { text: 'The store is full, so the game in progress stays. /chess export your games, then try again.' }
        } else if (answer !== 'Abandon it') return { text: 'Kept the game in progress.' }
      }
      const s: Prefs = { ...(await read($, settingsA)), ...(await read($, viewA)).opts }
      const isStarted = await startGame($, { white: { kind: 'human' }, black: { kind: 'claude', model: model.value, effort }, tc: tcOf(s.tcId), rules: s.rules, isClaudeClocked: s.isClaudeClocked, canSwitchOpponent: s.canSwitchOpponent })
      if (isStarted) await setView($, { opts: {} })
      if (!isStarted) return { text: 'A tournament game is in progress. End the tournament first.' }
      return open(`New game: you (White) vs ${model.label} (${effort}). Click a piece, then its square, or use /chess move e4.`)
    }
    const live = await read($, gameA)
    if (live && live.result === '*') {
      return open(live.isPaused ? 'Chessus opened. Your game is paused: /chess resume continues it.' : 'Chessus opened. Click a piece, then its square, or /chess move e4.')
    }
    return open('Chessus opened. Start a game from "new" (key 1), or /chess haiku low.')
  })

  on('ui.message', { module: 'hooks/board.tsx' }, async ($, e) => {
    const { uci } = (e.data ?? {}) as { uci?: unknown }
    if (typeof uci === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) await humanMove($, uci)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, viewA)
    const settings = await read($, settingsA)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const hasBoard = e.surface === 'terminal' || e.surface === 'desktop'
    if (hasBoard) controls.clear()
    const arg = (key: string) => ({ plugin: 'chessus', element: key, component: 'Pane', requestId: PANE, surface: e.surface }) as const
    const Button: typeof ui.Button = props => {
      const key = props.key ?? props.hotkey ?? ''
      if (hasBoard && props.hotkey) controls.set(props.hotkey, { kind: 'key', label: (props.label ?? key).trim(), run: () => props.onPress(arg(key)) })
      return ui.Button(props)
    }
    type Fields = Extract<typeof ui, { Input: unknown }>
    const Input: Fields['Input'] = props => {
      if (hasBoard) controls.set(props.key, { kind: 'set', label: props.label ?? props.placeholder ?? props.key, run: v => props.onSubmit(v, arg(props.key) as never) })
      return (ui as Fields).Input(props)
    }
    const hasFields = e.surface !== 'mobile'

    const t = await read($, tourA)
    const isTourActive = !!t && (t.status === 'running' || t.status === 'paused')
    const g = await read($, gameA)
    const isGameLive = !!g && g.result === '*'

    // Four places: the board, starting something new, replays, settings. Standings appear while a tournament runs.
    const tabs: { screen: Screen; label: string }[] = [
      { screen: 'game', label: 'board' },
      { screen: 'setup', label: 'new game' },
      { screen: 'library', label: 'replays' },
      { screen: 'settings', label: 'settings' },
      ...(isTourActive ? [{ screen: 'tournament' as const, label: 'standings' }] : []),
    ]
    const tourGame = g && t && g.event === eventOf(t) ? t : null
    // The last game of a finished tournament still shows that tournament's total against its cap.
    const hasClaude = !!g && (g.white.kind === 'claude' || g.black.kind === 'claude')
    const spend = view.screen !== 'game' || view.review || !g || !hasClaude ? null
      : tourGame ? `Claude est. $${tourGame.spentUsd.toFixed(2)} / $${tourGame.budgetUsd} cap`
        : `Claude est. $${g.spentUsd.toFixed(3)} · no cap`
    const nav = (
      <Box width="100%">
        {tabs.map((tab, i) => (
          <Button
            key={`nav-${tab.screen}`}
            plain
            hotkey={String(i + 1)}
            label={view.screen === tab.screen ? `[${tab.label}]  ` : `${tab.label}  `}
            onPress={() => setView($, { screen: tab.screen })}
          />
        ))}
        <Button key="close" plain hotkey="0" label="close" role="dismiss" onPress={async () => {
          const live = await read($, gameA)
          if (isLiveCasual(live) && !live.isPaused) await setView($, { screen: 'game', review: null, ply: null, confirm: 'close' })
          else await closePane($, false)
        }} />
      </Box>
    )
    const page = (...children: RenderChildren[]) => (
      <Box flexDirection="column">
        {nav}
        <Box flexDirection="column" marginTop={1}>{children}</Box>
      </Box>
    )
    // Arrow buttons instead of dropdowns: one click or Enter changes the value at once, no menu to open.
    // Arrow-button picker. With a label width the labels line up in a column; a hint sits under the value.
    const select = (
      key: string, label: string, value: string, options: readonly { value: string; label?: string }[],
      onSelect: (v: string) => unknown, layout: { labelWidth?: number; hint?: string } = {},
    ) => {
      const at = Math.max(0, options.findIndex(o => o.value === value))
      const shown = options[at]?.label ?? options[at]?.value ?? value
      const go = (by: number) => void onSelect(options[(at + by + options.length) % options.length]!.value)
      if (hasBoard) controls.set(key, { kind: 'set', label: `${label}: ${shown}`, options: options.map(o => o.value), run: onSelect })
      const width = layout.labelWidth ?? 0
      const row = (
        <Box key={key}>
          <Text>{width ? label.padEnd(width) : `${label}: `}</Text>
          <Button key={`${key}-prev`} plain label="‹" onPress={() => go(-1)} />
          <Button key={`${key}-value`} plain label={` ${shown} `} onPress={() => go(1)} />
          <Button key={`${key}-next`} plain label="›" onPress={() => go(1)} />
        </Box>
      )
      if (!layout.hint) return row
      return (
        <Box key={`${key}-row`} flexDirection="column" marginBottom={1}>
          {row}
          <Text dimColor>{' '.repeat(width) + layout.hint}</Text>
        </Box>
      )
    }
    const section = (title: string, ...rows: RenderChildren[]) => (
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>{title}</Text>
        <Box flexDirection="column" marginTop={1}>{rows}</Box>
      </Box>
    )

    if (view.screen === 'settings') {
      const field = { labelWidth: SETTINGS_LABEL_WIDTH }
      return page(
        <Text bold>Default settings</Text>,
        <Text dimColor>Every new game and tournament starts with these. Change them for one game on the new game screen.</Text>,
        section('Game',
          select('tc', 'Time control', settings.tcId, TIME_CONTROLS.map(tc => ({ value: tc.id, label: tc.label })), v => setSettings($, { tcId: v }),
            { ...field, hint: 'Minutes per side, plus seconds added after each move.' }),
          select('rules', 'Rules', settings.rules, [{ value: 'standard', label: 'FIDE standard' }, { value: 'casual', label: `Casual (${CASUAL_RETRIES} retries, then random)` }],
            v => setSettings($, { rules: v === 'casual' ? 'casual' : 'standard' }), { ...field, hint: 'What happens when Claude plays an illegal move.' }),
          select('switch', 'Opponent mid-game', settings.canSwitchOpponent ? 'on' : 'off', [{ value: 'off', label: 'Fixed for the game' }, { value: 'on', label: 'Switchable from the board' }],
            v => setSettings($, { canSwitchOpponent: v === 'on' }), { ...field, hint: "Change Claude's model and effort during a casual game." }),
          select('replay-speed', 'Replay speed', String(settings.replayMs), REPLAY_SPEEDS.map(ms => ({ value: String(ms), label: speedLabel(ms) })),
            v => setSettings($, { replayMs: Number(v) }), { ...field, hint: 'How fast a replay plays itself (p in a replay; s changes it there too).' }),
        ),
        section('Claude',
          select('clock', 'Claude clock', settings.isClaudeClocked ? 'on' : 'off', [{ value: 'on', label: 'Thinking time counts' }, { value: 'off', label: 'Paused while Claude thinks' }],
            v => setSettings($, { isClaudeClocked: v === 'on' }), { ...field, hint: "Whether Claude's thinking time runs down its clock." }),
          select('spectate', 'Claude vs Claude pace', String(settings.spectateMs), [0, 500, 1000, 2000, 5000].map(ms => ({ value: String(ms), label: ms === 0 ? 'No delay' : `${ms / 1000}s between moves` })),
            v => setSettings($, { spectateMs: Number(v) }), { ...field, hint: 'A pause between moves so you can follow the game.' }),
        ),
        section('Tournament',
          select('format', 'Format', settings.isDouble ? 'double' : 'single', [{ value: 'single', label: 'Single round-robin' }, { value: 'double', label: 'Double round-robin' }],
            v => setSettings($, { isDouble: v === 'double' }), { ...field, hint: 'Double plays every pairing twice, with colours swapped.' }),
          <Box key="budget-row" flexDirection="column">
            <Box>
              <Text>{'Budget cap'.padEnd(SETTINGS_LABEL_WIDTH)}</Text>
              <Text bold>{`$${settings.budgetUsd}`}</Text>
            </Box>
            {hasFields && 'Input' in ui && (
              <Box marginLeft={SETTINGS_LABEL_WIDTH}>
                <Input
                  key="budget"
                  placeholder="new cap in dollars, e.g. 5"
                  submitLabel="set"
                  onSubmit={async v => {
                    const usd = Number(v)
                    if (!Number.isFinite(usd) || usd <= 0) return
                    await setSettings($, { budgetUsd: usd })
                    await update($, tourA, x => (x && x.status !== 'done' ? { ...x, budgetUsd: usd } : x))
                  }}
                />
              </Box>
            )}
            <Text dimColor>{' '.repeat(SETTINGS_LABEL_WIDTH) + "Pauses the tournament when Claude's spend reaches it. Also applies to one already running."}</Text>
          </Box>,
        ),
      )
    }

    if (view.screen === 'library') {
      const all = await loadGames($)
      const resumable = all.filter(s => s.resume).length
      const clearable = all.length - resumable
      const games = all.slice(-LIBRARY_ROWS).reverse()
      return page(
        <Text bold>Replays</Text>,
        <Text dimColor>Pick a game to watch it move by move: b and f step, a and e jump to the start and end.</Text>,
        section('Famous games',
          ...CLASSICS.map(c => (
            <Button key={`classic-${c.id}`} plain label={`${c.title}  ·  ${c.white} vs ${c.black}, ${c.site} ${c.date.slice(0, 4)}`} onPress={() => openReview($, {
              pgn: classicPgn(c), white: c.white, black: c.black, result: c.result,
              termination: classicTermination(c), at: '',
            })} />
          )),
        ),
        section('Find games online',
          hasFields && 'Input' in ui && (
            <Input key="search-events" label="Official events (Lichess)" placeholder="e.g. candidates, olympiad, world championship" submitLabel="search"
              onSubmit={v => v.trim() && searchEvents($, v.trim())} />
          ),
          ...(view.found ?? []).map((f, i) => (
            <Button key={`event-${i}`} plain label={`   ↓ ${f.name}`} onPress={() => downloadEvent($, f.id, f.name)} />
          )),
          <Box key="player-gap" marginTop={1}>
            {hasFields && 'Input' in ui && (
              <Input key="search-player" label="A player's games (Chess.com)" placeholder="chess.com username" submitLabel="load"
                onSubmit={v => v.trim() && playerGames($, v.trim())} />
            )}
          </Box>,
          view.searchNote && <Box key="note-gap" marginTop={1}><Text color="cyan">{view.searchNote}</Text></Box>,
        ),
        section(`Your saved games${games.length ? ` (newest ${games.length})` : ''}`,
          games.length === 0 && <Text dimColor>Finished and imported games land here.</Text>,
          ...games.map((sg, i) => (
            <Button key={`lib-${i}`} plain label={`${sg.at.slice(0, 10)}  ${sg.white} vs ${sg.black}  ${sg.result}  ${sg.termination}`} onPress={() => openReview($, sg)} />
          )),
          clearable > 0 && (
            <Box key="clear-row" marginTop={1}>
              {view.confirm === 'clear' ? (
                <Box>
                  <Text color="yellow">{`Delete ${clearable} saved game${clearable === 1 ? '' : 's'}? This cannot be undone.${resumable ? ` Games saved to resume (${resumable}) are kept.` : ''}  `}</Text>
                  <Button key="clear-yes" plain hotkey="y" label="yes, delete  " onPress={async () => {
                    const removed = await dropSaved($, s => !s.resume)
                    await setView($, { confirm: null })
                    $.ui.toast(`Deleted ${removed} saved game${removed === 1 ? '' : 's'}.`)
                  }} />
                  <Button key="clear-no" plain hotkey="n" label="no" onPress={() => setView($, { confirm: null })} />
                </Box>
              ) : (
                <Button key="clear-all" plain label="delete all saved games" onPress={() => setView($, { confirm: 'clear' })} />
              )}
            </Box>
          ),
        ),
        <Box marginTop={1}><Text dimColor>From chat: /chess import &lt;url or .pgn file&gt; · /chess export &lt;path&gt;</Text></Box>,
      )
    }

    if (view.screen === 'tournament' && t && isTourActive) {
      const table = standings(t.entrants.length, t.pairings)
      const done = t.pairings.filter(p => p.result !== null).length
      const saved = (await loadGames($)).filter(sg => sg.tournament === t.id)
      const current = t.current !== null ? t.pairings[t.current] : undefined
      return page(
        <Text bold color="yellow">{`TOURNAMENT #${t.id} · ${done}/${t.pairings.length} games played · ${t.status === 'paused' ? 'PAUSED' : 'RUNNING'}`}</Text>,
        <Text dimColor>{`Claude spend est. $${t.spentUsd.toFixed(2)} of $${t.budgetUsd} cap`}</Text>,
        <Text dimColor>{'#  Player                  P   W  D  L  Pts   SB'}</Text>,
        ...table.map((r, i) => (
          <Text key={`row-${r.entrant}`}>{`${String(i + 1).padEnd(3)}${nameOf(t.entrants[r.entrant]!).padEnd(24)}${String(r.played).padEnd(4)}${String(r.wins).padEnd(3)}${String(r.draws).padEnd(3)}${String(r.losses).padEnd(3)}${String(r.points).padEnd(6)}${r.sb.toFixed(2)}`}</Text>
        )),
        current && <Text color="cyan">{`Now playing: round ${current.round}, ${nameOf(t.entrants[current.white]!)} vs ${nameOf(t.entrants[current.black]!)}`}</Text>,
        t.note !== '' && <Text color="red">{t.note}</Text>,
        <Box>
          <Button key="watch" plain hotkey="w" label="watch  " onPress={() => setView($, { screen: 'game', review: null, ply: null })} />
          {t.status === 'running'
            ? <Button key="pause" plain hotkey="p" label="pause  " onPress={() => pauseTournament($, 'Paused.')} />
            : <Button key="resume" plain hotkey="r" label="resume  " onPress={() => resumeTournament($)} />}
          <Button key="stop" plain label="end tournament" onPress={() => endTournament($)} />
        </Box>,
        saved.length > 0 && <Text dimColor>Played</Text>,
        ...saved.slice(-LIBRARY_ROWS).map((sg, i) => (
          <Button key={`tg-${i}`} plain label={`R${t.pairings[sg.pairing ?? 0]?.round ?? '?'}  ${sg.white} - ${sg.black}  ${sg.result}`} onPress={() => openReview($, sg)} />
        )),
      )
    }

    if (view.screen === 'setup' || (!g && !view.review)) {
      const mode = view.newMode ?? 'casual'
      const modeSwitch = select('new-mode', 'Start a', mode, [{ value: 'casual', label: 'Casual game' }, { value: 'tournament', label: 'Tournament' }], v =>
        setView($, { newMode: v === 'tournament' ? 'tournament' : 'casual', confirm: null }))
      const opts: Prefs = { ...settings, ...view.opts }
      const setOpt = (patch: Partial<Prefs>) => update($, viewA, v => ({ ...v, opts: { ...v.opts, ...patch } }))
      const optField = { labelWidth: OPTION_LABEL_WIDTH }
      const changed = (Object.keys(view.opts ?? {}) as (keyof Prefs)[]).some(k => view.opts?.[k] !== settings[k])
      const optionRows = (isTournament: boolean) => section(isTournament ? 'Tournament options' : 'Game options',
        select('opt-tc', 'Time control', opts.tcId, TIME_CONTROLS.map(tc => ({ value: tc.id, label: tc.label })), v => setOpt({ tcId: v }), optField),
        select('opt-rules', 'Rules', opts.rules, [{ value: 'standard', label: 'FIDE standard' }, { value: 'casual', label: `Casual (${CASUAL_RETRIES} retries, then random)` }],
          v => setOpt({ rules: v === 'casual' ? 'casual' : 'standard' }), optField),
        select('opt-clock', 'Claude clock', opts.isClaudeClocked ? 'on' : 'off', [{ value: 'on', label: 'Thinking time counts' }, { value: 'off', label: 'Paused while Claude thinks' }],
          v => setOpt({ isClaudeClocked: v === 'on' }), optField),
        isTournament
          ? select('opt-format', 'Format', opts.isDouble ? 'double' : 'single', [{ value: 'single', label: 'Single round-robin' }, { value: 'double', label: 'Double round-robin' }],
            v => setOpt({ isDouble: v === 'double' }), optField)
          : select('opt-switch', 'Opponent mid-game', opts.canSwitchOpponent ? 'on' : 'off', [{ value: 'off', label: 'Fixed for the game' }, { value: 'on', label: 'Switchable from the board' }],
            v => setOpt({ canSwitchOpponent: v === 'on' }), optField),
        isTournament && <Text key="opt-budget">{`${'Budget cap'.padEnd(OPTION_LABEL_WIDTH)}$${opts.budgetUsd}  `}<Text dimColor>(set in default settings)</Text></Text>,
        changed && (
          <Box key="opt-reset" marginTop={1}>
            <Button key="opts-reset" plain label="reset to default settings" onPress={() => setView($, { opts: {} })} />
          </Box>
        ),
      )
      const busy = isGameLive && g
        ? <Text color="yellow">{`A game is in progress: ${nameOf(g.white)} vs ${nameOf(g.black)}, ${g.history.length} moves${g.isPaused ? ' (paused)' : ''}.`}</Text>
        : null

      if (mode === 'tournament') {
        if (t && isTourActive) {
          return page(modeSwitch, <Text color="yellow">{`Tournament #${t.id} is ${t.status === 'paused' ? 'paused' : 'running'}.`}</Text>,
            <Button key="go-standings" plain hotkey="t" label="see standings" onPress={() => setView($, { screen: 'tournament' })} />)
        }
        const costs = await loadCosts($)
        const pairings = roundRobin(view.entrants.length, opts.isDouble)
        const perMove = view.entrants.map(s => {
          const stat = costs[costKey(s)]
          return s.kind === 'human' ? 0 : stat && stat.moves > 0 ? stat.usd / stat.moves : undefined
        })
        const est = estimateUsd(pairings, perMove)
        const finished = t?.status === 'done' ? t : null
        const isComplete = finished !== null && finished.pairings.every(p => p.result !== null)
        const leader = finished && nameOf(finished.entrants[standings(finished.entrants.length, finished.pairings)[0]!.entrant]!)
        const startTournament = async () => {
          const id = ((await read($, tourA))?.id ?? 0) + 1
          await archiveCasual($)
          await update($, gameA, x => (isLiveCasual(x) ? null : x))
          await saveLive($)
          await update($, tourA, (): Tournament => ({
            id, entrants: view.entrants, isDouble: opts.isDouble, tc: tcOf(opts.tcId), rules: opts.rules,
            isClaudeClocked: opts.isClaudeClocked, budgetUsd: opts.budgetUsd, spentUsd: 0,
            pairings: roundRobin(view.entrants.length, opts.isDouble), current: null, status: 'running', note: '',
          }))
          await setView($, { screen: 'game', review: null, ply: null, opts: {} })
          await startNext($)
        }
        return page(
          modeSwitch,
          finished && <Text color="yellow">{`Last tournament #${finished.id} ${isComplete ? `finished. Winner: ${leader}` : `ended early. Leader: ${leader}`}`}</Text>,
          <Box>
            {select('pick-model', 'Add player', view.pick.model, PLAYER_OPTIONS, v => setView($, { pick: { ...view.pick, model: v } }))}
            {view.pick.model !== 'human' && select('pick-effort', 'Effort', view.pick.effort, EFFORTS.map(value => ({ value })), v => setView($, { pick: { ...view.pick, effort: EFFORTS.find(x => x === v) ?? 'medium' } }))}
            <Button key="add" plain hotkey="a" label="  add" onPress={() => view.entrants.length < MAX_ENTRANTS && setView($, { entrants: [...view.entrants, sideFrom(view.pick.model, view.pick.effort)] })} />
          </Box>,
          view.entrants.length === 0 && <Text dimColor>No players yet: pick one above and press a to add. 2 to 8 players.</Text>,
          ...view.entrants.map((s, i) => (
            <Box key={`entrant-${i}`}>
              <Text>{`${i + 1}. ${nameOf(s)}  `}</Text>
              <Button key={`rm-${i}`} plain label="remove" onPress={() => setView($, { entrants: view.entrants.filter((_, j) => j !== i) })} />
            </Box>
          )),
          optionRows(true),
          view.entrants.length >= 2 && <Text>{`${pairings.length} games. Estimated cost: ${est.isComplete ? '' : 'at least '}$${est.usd.toFixed(2)}${est.isComplete ? '' : ' (no data yet for some players)'}`}</Text>,
          busy,
          view.confirm === 'replace' ? (
            <Box>
              <Text color="yellow">{'Start the tournament? The current game:  '}</Text>
              <Button key="replace-yes" plain hotkey="y" label="abandon it  " onPress={async () => {
                await setView($, { confirm: null })
                await startTournament()
              }} />
              <Button key="replace-keep" plain hotkey="k" label="keep it to resume  " onPress={async () => {
                await setView($, { confirm: null })
                if (await keepLive($)) await startTournament()
              }} />
              <Button key="replace-no" plain hotkey="n" label="cancel" onPress={() => setView($, { confirm: null })} />
            </Box>
          ) : (
            <Button key="start-tournament" plain hotkey="s" label={view.entrants.length < 2 ? 'start tournament (add 2+ players first)' : 'start tournament'} onPress={async () => {
              if (view.entrants.length < 2) return
              const live = await read($, gameA)
              if (live && live.result === '*' && !isLiveCasual(live)) return void $.ui.toast('Finish the current game first.')
              if (isLiveCasual(live) && live.history.length > 0) return void setView($, { confirm: 'replace' })
              await startTournament()
            }} />
          ),
        )
      }

      const { white, black } = view.draft
      const sideSelect = (color: 'white' | 'black', side: Side) => (
        <Box>
          {select(`${color}-player`, color === 'white' ? 'White' : 'Black', side.kind === 'human' ? 'human' : side.model, PLAYER_OPTIONS, v =>
            setView($, { draft: { ...view.draft, [color]: sideFrom(v, side.kind === 'claude' ? side.effort : 'medium') } }))}
          {side.kind === 'claude' && select(`${color}-effort`, '  Effort', side.effort, EFFORTS.map(value => ({ value })), v =>
            setView($, { draft: { ...view.draft, [color]: { ...side, effort: EFFORTS.find(x => x === v) ?? 'medium' } } }))}
        </Box>
      )
      const begin = async () => {
        const isStarted = await startGame($, { white, black, tc: tcOf(opts.tcId), rules: opts.rules, isClaudeClocked: opts.isClaudeClocked, canSwitchOpponent: opts.canSwitchOpponent })
        if (isStarted) await setView($, { opts: {} })
      }
      const inTournament = isTourActive
      return page(
        modeSwitch,
        sideSelect('white', white),
        sideSelect('black', black),
        optionRows(false),
        busy,
        inTournament ? <Text color="yellow">A tournament is running. End it (standings) to start a casual game.</Text>
          : view.confirm === 'replace' ? (
            <Box>
              <Text color="yellow">{'Start a new game? The current one:  '}</Text>
              <Button key="replace-yes" plain hotkey="y" label="abandon it  " onPress={async () => {
                await setView($, { confirm: null })
                await begin()
              }} />
              <Button key="replace-keep" plain hotkey="k" label="keep it to resume  " onPress={async () => {
                await setView($, { confirm: null })
                if (await keepLive($)) await begin()
              }} />
              <Button key="replace-no" plain hotkey="n" label="cancel" onPress={() => setView($, { confirm: null })} />
            </Box>
          ) : (
            <Box>
              <Button key="swap" plain hotkey="x" label="swap colors  " onPress={() => setView($, { draft: { white: black, black: white } })} />
              <Button key="start" plain hotkey="s" label="start game  " onPress={async () => {
                const live = await read($, gameA)
                if (isLiveCasual(live) && live.history.length > 0) return void setView($, { confirm: 'replace' })
                await begin()
              }} />
              {isGameLive && <Button key="resume-game" plain hotkey="b" label="back to the board" onPress={() => setView($, { screen: 'game' })} />}
            </Box>
          ),
      )
    }

    const review = view.review
    const history = review ? review.history : g!.history
    const ply = view.ply ?? history.length
    const shown = replay(history, ply)
    const isLive = !review && view.ply === null
    const live = g!
    const result = review ? review.result : live.result
    const termination = review ? review.termination : live.termination
    const now = await read($, nowA)
    const toMove = turnOf({ history })
    const canMove = isLive && live.result === '*' && !live.thinking && !live.isPaused && sideOf(live, toMove).kind === 'human'
    const lastMove = ply > 0 ? shown.history({ verbose: true }).at(-1) : undefined
    const me = !review && live.result === '*' ? humanColor(live) : null
    const opponent = me ? sideOf(live, other(me)) : null
    const isCasual = !review && live.event === CASUAL
    const orientation: Color = view.isFlipped ? 'b' : 'w'
    const top: Color = orientation === 'w' ? 'b' : 'w'
    const cell = boardCell(e.props.bodyColumns, e.props.scroll.bodyRows)

    const mode = review
      ? <Text bold color="magenta">{'REPLAY'}</Text>
      : isCasual
        ? <Text bold color="green">{'CASUAL GAME'}</Text>
        : <Text bold color="yellow">{`TOURNAMENT #${t?.id ?? '?'} · ROUND ${live.round}`}</Text>

    const label = (c: Color) => (review ? (c === 'w' ? review.white : review.black) : nameOf(sideOf(live, c)))
    const head = (c: Color) => {
      const clock = review || !isTimed(live.tc) ? '' : formatClock(remaining(live, c, now))
      const marker = isLive && result === '*' && toMove === c ? '» ' : '  '
      const name = `${marker}${c === 'w' ? '○' : '●'} ${label(c)}`.slice(0, SIDEBAR - clock.length - 1)
      return <Text bold={isLive && result === '*' && toMove === c}>{name.padEnd(SIDEBAR - clock.length) + clock}</Text>
    }
    const colorName = (c: Color) => (c === 'w' ? 'White' : 'Black')
    const isOver = !review && result !== '*'
    const status = review
      ? `Move ${ply} of ${history.length} · ${result}`
      : view.ply !== null
        ? `Viewing move ${ply} of ${history.length}`
        : isOver
          ? 'GAME OVER'
          : live.isPaused ? 'Paused · p resumes'
            : live.thinking ? `${colorName(toMove)} (${label(toMove)}) is thinking…`
              : canMove ? `Your move (${colorName(toMove)})` : `${colorName(toMove)} to move`
    // What happens after the last move: who won, that it was saved, and what comes next.
    const leaderName = t ? nameOf(t.entrants[standings(t.entrants.length, t.pairings)[0]!.entrant]!) : ''
    const afterGame = !isOver ? []
      : [
          outcome(result, termination, label('w'), label('b')),
          isCasual ? 'Saved to replays.' : t?.status === 'running' ? 'Saved. Next game starts shortly.'
            : t?.status === 'paused' ? 'Saved. Tournament paused.'
              : `Saved. Winner: ${leaderName}.`,
        ]

    const canSwitch = isCasual && live.result === '*' && (live.canSwitchOpponent ?? settings.canSwitchOpponent) && opponent?.kind === 'claude' && hasFields
    const moveRows = Math.max(3, 8 * cell.h + 2 - SIDEBAR_FIXED_ROWS - (canSwitch ? SWITCH_ROWS : 0))
    const pairs = Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => ({ n: i + 1, w: history[i * 2]!, b: history[i * 2 + 1] }))
    const lastPair = Math.max(1, Math.ceil(ply / 2))
    const shownPairs = pairs.slice(Math.max(0, lastPair - moveRows), Math.max(0, lastPair - moveRows) + moveRows)
    const moveText = (san: string | undefined, index: number) =>
      san === undefined ? null : <Text inverse={index === ply - 1}>{san.padEnd(8)}</Text>
    const rule = <Text dimColor>{'─'.repeat(SIDEBAR)}</Text>

    const step = (by: number) => {
      const at = Math.min(history.length, Math.max(0, ply + by))
      return setView($, { ply: at === history.length && !review ? null : at })
    }
    const pgn = review ? review.pgn ?? replay(history).pgn() : toPgn(live, new Date())
    const switchOpponent = (patch: Partial<{ model: string; effort: Effort }>) =>
      update($, gameA, x => {
        if (!x || !me || x.result !== '*') return x
        const side = sideOf(x, other(me))
        if (side.kind !== 'claude') return x
        const next = { ...side, ...patch }
        const switched = other(me) === 'w' ? { ...x, white: next } : { ...x, black: next }
        return { ...switched, thinking: '' }
      }).then(async () => {
        await saveLive($)
        kick($, 0)
      })

    const sidebar = (
      <Box flexDirection="column" marginLeft={2} width={SIDEBAR} minHeight={8 * cell.h + 2}>
        {mode}
        {head(top)}
        {rule}
        {history.length === 0 && <Text dimColor>no moves yet</Text>}
        {shownPairs.map(p => (
          <Box key={`m-${p.n}`}>
            <Text dimColor>{`${p.n}.`.padStart(4) + ' '}</Text>
            {moveText(p.w, (p.n - 1) * 2)}
            {moveText(p.b, (p.n - 1) * 2 + 1)}
          </Box>
        ))}
        {Array.from({ length: Math.max(0, moveRows - shownPairs.length - (history.length === 0 ? 1 : 0)) }, (_, i) => (
          <Text key={`pad-${i}`}> </Text>
        ))}
        {rule}
        {head(other(top))}
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>STATUS</Text>
          <Text color={isOver ? 'yellow' : canMove ? 'green' : undefined} bold={isOver || canMove} inverse={isOver}>{isOver ? ` ${status} ` : status}</Text>
          {afterGame.map((line, i) => <Text key={`after-${i}`} color={i === 0 ? 'yellow' : undefined} bold={i === 0} dimColor={i > 0}>{line}</Text>)}
        </Box>
        {!review && live.note !== '' && <Text color="red">{live.note}</Text>}
        <Box flexGrow={1} />
        {canSwitch && opponent?.kind === 'claude' && select('opponent-model', 'Opponent', opponent.model, MODELS, v => switchOpponent({ model: v }))}
        {canSwitch && opponent?.kind === 'claude' && select('opponent-effort', 'Effort', opponent.effort, EFFORTS.map(value => ({ value })), v =>
          switchOpponent({ effort: EFFORTS.find(x => x === v) ?? opponent.effort }))}
      </Box>
    )

    const key = (k: string, hotkey: string, text: string, onPress: () => unknown) => (
      <Button key={k} plain hotkey={hotkey} label={`${text}  `} onPress={() => onPress()} />
    )
    // Replays and finished games step the same way; only where the end is differs (a finished game's end is live).
    const replayRow = (title: string, end: number | null) => (
      <Box>
        <Text dimColor>{title}</Text>
        {key('first', 'a', '⏮ start', () => setView($, { ply: 0 }))}
        {key('prev', 'b', '◀ back', () => step(-1))}
        {key('next', 'f', 'forward ▶', () => step(1))}
        {key('last', 'e', 'end ⏭', () => setView($, { ply: end }))}
        {key('autoplay', 'p', view.autoplay ? '⏸ stop' : '▶ play', () => toggleAutoplay($))}
        {key('replay-speed', 's', speedLabel(settings.replayMs), () => cycleReplaySpeed($))}
      </Box>
    )
    const keys =
      view.confirm === 'resign' ? (
        <Box>
          <Text color="yellow">{'Resign this game?  '}</Text>
          {key('resign-yes', 'y', 'yes, resign', async () => {
            await setView($, { confirm: null })
            await resignGame($)
          })}
          {key('resign-no', 'n', 'no, keep playing', () => setView($, { confirm: null }))}
        </Box>
      ) : view.confirm === 'delete' && review ? (
        <Box>
          <Text color="yellow">{`Delete ${review.white} vs ${review.black} from your saved games? This cannot be undone.  `}</Text>
          {key('delete-yes', 'y', 'yes, delete', () => deleteSaved($, review))}
          {key('delete-no', 'n', 'no', () => setView($, { confirm: null }))}
        </Box>
      ) : view.confirm === 'resume' && review ? (
        <Box>
          <Text color="yellow">{'Resume the saved game? The game in progress:  '}</Text>
          {key('resume-yes', 'y', 'abandon it', () => resumeReview($, review))}
          {key('resume-keep', 'k', 'keep it to resume', async () => {
            if (await keepLive($)) await resumeReview($, review)
          })}
          {key('resume-no', 'n', 'cancel', () => setView($, { confirm: null }))}
        </Box>
      ) : view.confirm === 'close' ? (
        <Box>
          <Text color="yellow">{'Leave the game?  '}</Text>
          {key('close-pause', 'p', 'pause & close', () => closePane($, true))}
          {key('close-keep', 'y', 'close, keep clocks running', () => closePane($, false))}
          {key('close-no', 'n', 'stay', () => setView($, { confirm: null }))}
        </Box>
      ) : (
        // Each context gets only the keys that make sense in it: replay steps for replays and finished games,
        // game actions for a game in progress.
        review ? (
          <Box flexDirection="column">
            {replayRow('Replay   ', history.length)}
            <Box>
              <Text dimColor>{'         '}</Text>
              {review.resume && review.result === '*' && key('resume-saved', 'r', 'resume this game', async () => {
                const live = await read($, gameA)
                if (isLiveCasual(live) && live.history.length > 0) await setView($, { confirm: 'resume' })
                else await resumeReview($, review)
              })}
              {key('flip', 'v', 'flip', () => setView($, { isFlipped: !view.isFlipped }))}
              <Button key="copy" plain hotkey="c" label="copy PGN  " onPress={p => void $.ui.copy({ text: pgn, surface: p.surface })} />
              {review.savedAt && key('delete', 'x', 'delete', () => setView($, { confirm: 'delete' }))}
              {key('close-review', 'q', 'close replay', () => setView($, { review: null, ply: null, screen: 'library' }))}
            </Box>
          </Box>
        ) : isOver ? (
          <Box flexDirection="column">
            {replayRow('Review   ', null)}
            <Box>
              <Text dimColor>{'Next     '}</Text>
              {!isTourActive && key('new-game', 'n', 'new game', () => setView($, { screen: 'setup' }))}
              {isTourActive && key('standings', 't', 'standings', () => setView($, { screen: 'tournament' }))}
              <Button key="copy" plain hotkey="c" label="copy PGN  " onPress={p => void $.ui.copy({ text: pgn, surface: p.surface })} />
              {key('flip', 'v', 'flip', () => setView($, { isFlipped: !view.isFlipped }))}
            </Box>
          </Box>
        ) : (
          <Box flexWrap="wrap">
            <Text dimColor>{'Game     '}</Text>
            {live.isHalted && key('retry', 'r', 'retry Claude', async () => {
              await update($, gameA, x => (x ? { ...x, isHalted: false, note: '' } : x))
              kick($, 0)
            })}
            {isCasual && key('pause', 'p', live.isPaused ? 'resume' : 'pause', () => (live.isPaused ? resumeGame($) : pauseGame($)))}
            {isCasual && key('save', 's', 'save to resume', async () => $.ui.toast((await saveToResume($)).text))}
            <Button key="copy" plain hotkey="c" label="copy PGN  " onPress={p => void $.ui.copy({ text: pgn, surface: p.surface })} />
            {me && !live.isPaused && opponent?.kind === 'claude' && key('draw', 'd', 'offer draw', () => offerDraw($))}
            {me && turnOf(live) === me && claimable(live) && key('claim', 'm', 'claim draw', async () => {
              const cur = await read($, gameA)
              if (cur) await finish($, claimDraw(cur))
            })}
            {me && key('resign', 'x', 'resign', () => setView($, { confirm: 'resign' }))}
            {!isCasual && isTourActive && key('standings', 't', 'standings', () => setView($, { screen: 'tournament' }))}
            {key('flip', 'v', 'flip', () => setView($, { isFlipped: !view.isFlipped }))}
          </Box>
        )
      )

    return page(
      <Box flexWrap="wrap">
        {hasBoard && 'Client' in ui ? (
          <ui.Client
            key="board"
            module="./board.tsx"
            props={{
              fen: shown.fen(),
              legal: canMove ? replay(history).moves({ verbose: true }).map(m => m.from + m.to + (m.promotion ?? '')) : [],
              last: lastMove ? lastMove.from + lastMove.to : '',
              isLocked: !canMove,
              orientation,
              cell,
            }}
          />
        ) : <Text dimColor>The board needs the terminal or the desktop app.</Text>}
        {sidebar}
      </Box>,
      keys,
      spend && <Text dimColor wrap="truncate-end">{spend}</Text>,
    )
  })
}
