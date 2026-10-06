import type { ClientModule } from 'claude-code'

import type { BoardProps } from '../types'

const FILES = 'abcdefgh'
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const PROMOTIONS = ['q', 'r', 'b', 'n'] as const
const LABEL = 2

const COLORS = {
  light: '#f0d9b5', dark: '#b58863',
  lastLight: '#cdd26a', lastDark: '#aaa23a',
  from: '#7fa650', target: '#8fb8d8', cursor: '#5d9cec',
}

const PROMO_LEFT = 11
const PROMO_STEP = 4

const latest = new WeakMap<object, BoardProps>()

type State = { cursor: [number, number]; from: string | null; promo: { from: string; to: string } | null }

export const parseFen = (fen: string) => {
  const grid: (string | null)[][] = []
  for (const row of fen.split(' ')[0]!.split('/')) {
    const cells: (string | null)[] = []
    for (const ch of row) {
      if (/\d/.test(ch)) cells.push(...Array<null>(Number(ch)).fill(null))
      else cells.push(ch)
    }
    grid.push(cells)
  }
  return (square: string) => grid[8 - Number(square[1])]![FILES.indexOf(square[0]!)] ?? null
}

const squareAt = (file: number, rank: number) => `${FILES[file]}${rank + 1}`

const liveFrom = (props: BoardProps, from: string | null) => (from && props.legal.some(m => m.startsWith(from)) ? from : null)

export const act = (props: BoardProps, cur: State, square: string, post: (uci: string) => void): State => {
  const at = { ...cur, cursor: [FILES.indexOf(square[0]!), Number(square[1]) - 1] as [number, number] }
  if (props.isLocked) return { ...at, from: null, promo: null }
  const from = liveFrom(props, cur.from)
  if (from && from !== square) {
    const moves = props.legal.filter(m => m.startsWith(from + square))
    if (moves.length > 1 || moves[0]?.length === 5) return { ...at, from: null, promo: { from, to: square } }
    if (moves.length === 1) {
      post(moves[0]!)
      return { ...at, from: null, promo: null }
    }
  }
  const canPick = from !== square && props.legal.some(m => m.startsWith(square))
  return { ...at, from: canPick ? square : null, promo: null }
}

export type Hit = { kind: 'square'; square: string } | { kind: 'promo'; piece: string } | null

// Region cells to what was clicked: a square (orientation-aware), a promotion piece, or nothing.
export const hitTest = (props: Pick<BoardProps, 'cell' | 'orientation'>, x: number, y: number): Hit => {
  const { w: cellW, h: cellH } = props.cell
  if (y === 8 * cellH + 1) {
    const piece = PROMOTIONS[Math.floor((x - PROMO_LEFT) / PROMO_STEP)]
    return x >= PROMO_LEFT && piece ? { kind: 'promo', piece } : null
  }
  const col = Math.floor((x - LABEL) / cellW)
  const row = Math.floor(y / cellH)
  if (x < LABEL || y < 0 || row > 7 || col < 0 || col > 7) return null
  const isUp = props.orientation === 'w'
  return { kind: 'square', square: squareAt(isUp ? col : 7 - col, isUp ? 7 - row : row) }
}

const isLivePromo = (props: BoardProps, promo: State['promo']) =>
  !!promo && props.legal.some(m => m.startsWith(promo.from + promo.to))

const Board: ClientModule<BoardProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest.set(surface, props)
  const isWhiteUp = props.orientation === 'w'
  const s: State = surface.state ?? { cursor: [4, 1], from: null, promo: null }
  const from = liveFrom(props, s.from)
  const post = (uci: string) => surface.post({ uci })
  const promo = isLivePromo(props, s.promo) ? s.promo : null

  const promote = (cur: State, piece: string) => {
    if (!cur.promo) return cur
    post(cur.promo.from + cur.promo.to + piece)
    return { ...cur, promo: null }
  }

  if (surface.state === undefined) {
    surface.onKey(({ key }) => {
      const now = latest.get(surface)!
      const cur = surface.state!
      if (isLivePromo(now, cur.promo) && (PROMOTIONS as readonly string[]).includes(key)) return surface.setState(promote(cur, key))
      const [f, r] = cur.cursor
      const up = now.orientation === 'w' ? 1 : -1
      const moved: Record<string, [number, number]> = {
        up: [f, r + up], down: [f, r - up], left: [f - up, r], right: [f + up, r],
      }
      const next = moved[key]
      if (next) {
        const clamp = (n: number) => Math.min(7, Math.max(0, n))
        return surface.setState({ ...cur, cursor: [clamp(next[0]), clamp(next[1])] })
      }
      if (key === 'return' || key === ' ') surface.setState(act(now, cur, squareAt(cur.cursor[0], cur.cursor[1]), post))
    })
    surface.onPointer(({ type, x, y }) => {
      if (type !== 'down') return
      const now = latest.get(surface)!
      const cur = surface.state!
      const hit = hitTest(now, x, y)
      if (hit?.kind === 'promo' && isLivePromo(now, cur.promo)) surface.setState(promote(cur, hit.piece))
      if (hit?.kind === 'square') surface.setState(act(now, cur, hit.square, post))
    })
    surface.setState(s)
  }

  const piece = parseFen(props.fen)
  const targets = new Set(from ? props.legal.filter(m => m.startsWith(from)).map(m => m.slice(2, 4)) : [])
  const last = [props.last.slice(0, 2), props.last.slice(2, 4)]
  const cursor = squareAt(s.cursor[0], s.cursor[1])

  const { w: cellW, h: cellH } = props.cell
  const mid = Math.floor(cellH / 2)
  const left = Math.floor((cellW - 1) / 2)
  const pad = (glyph: string) => ' '.repeat(left) + glyph + ' '.repeat(cellW - 1 - left)
  const rows = Array.from({ length: 8 * cellH }, (_, line) => {
    const row = Math.floor(line / cellH)
    const isMid = line % cellH === mid
    const rank = isWhiteUp ? 7 - row : row
    return (
      <Box>
        <Text dimColor>{isMid ? `${rank + 1} ` : '  '}</Text>
        {Array.from({ length: 8 }, (_, col) => {
          const file = isWhiteUp ? col : 7 - col
          const sq = squareAt(file, rank)
          const isLight = (file + rank) % 2 === 1
          const p = piece(sq)
          const bg =
            sq === cursor && !props.isLocked ? COLORS.cursor
            : sq === from ? COLORS.from
            : targets.has(sq) ? COLORS.target
            : last.includes(sq) ? (isLight ? COLORS.lastLight : COLORS.lastDark)
            : isLight ? COLORS.light : COLORS.dark
          const glyph = !isMid ? ' ' : p ? GLYPH[p.toLowerCase()]! : targets.has(sq) ? '●' : ' '
          const fg = p ? (p === p.toUpperCase() ? '#ffffff' : '#000000') : '#2f4f6f'
          return <Text backgroundColor={bg} color={fg} bold>{pad(glyph)}</Text>
        })}
      </Box>
    )
  })
  const files = Array.from({ length: 8 }, (_, col) => pad(FILES[isWhiteUp ? col : 7 - col]!)).join('')

  return (
    <Box flexDirection="column">
      {rows}
      <Text dimColor>{`  ${files}`}</Text>
      {promo ? (
        <Text bold>{`Promote to:${['♛', '♜', '♝', '♞'].map(g => g.padStart(PROMO_STEP - 1).padEnd(PROMO_STEP)).join('')}  (or press q r b n)`}</Text>
      ) : (
        <Text> </Text>
      )}
    </Box>
  )
}

export default Board
