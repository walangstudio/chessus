import type { Pairing, Result } from '../types'

// Circle method for who meets whom; colors go to whoever has had fewer whites (Berger-style balance).
export const roundRobin = (n: number, isDouble: boolean): Pairing[] => {
  const seats = Array.from({ length: n }, (_, i) => i)
  if (n % 2 === 1) seats.push(-1)
  const m = seats.length
  const balance = Array<number>(n).fill(0)
  const single: Pairing[] = []
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const a = seats[i]!
      const b = seats[m - 1 - i]!
      if (a < 0 || b < 0) continue
      const isAWhite = balance[a]! < balance[b]! || (balance[a] === balance[b] && (r + i) % 2 === 0)
      const [white, black] = isAWhite ? [a, b] : [b, a]
      balance[white]!++
      balance[black]!--
      single.push({ round: r + 1, white, black, result: null })
    }
    seats.splice(1, 0, seats.pop()!)
  }
  if (!isDouble) return single
  return [...single, ...single.map(p => ({ round: p.round + m - 1, white: p.black, black: p.white, result: null }))]
}

const scoreOf = (result: Result, isWhite: boolean) =>
  result === '1/2-1/2' ? 0.5 : (result === '1-0') === isWhite ? 1 : 0

export type Standing = { entrant: number; played: number; wins: number; draws: number; losses: number; points: number; sb: number }

export const standings = (n: number, pairings: readonly Pairing[]): Standing[] => {
  const rows: Standing[] = Array.from({ length: n }, (_, entrant) => ({ entrant, played: 0, wins: 0, draws: 0, losses: 0, points: 0, sb: 0 }))
  const done = pairings.filter((p): p is Pairing & { result: Result } => p.result !== null && p.result !== '*')
  for (const p of done) {
    for (const [me, isWhite] of [[p.white, true], [p.black, false]] as const) {
      const s = scoreOf(p.result, isWhite)
      const row = rows[me]!
      row.played++
      row.points += s
      if (s === 1) row.wins++
      else if (s === 0.5) row.draws++
      else row.losses++
    }
  }
  for (const p of done) {
    rows[p.white]!.sb += scoreOf(p.result, true) * rows[p.black]!.points
    rows[p.black]!.sb += scoreOf(p.result, false) * rows[p.white]!.points
  }
  const headToHead = (a: number, b: number) =>
    done.reduce((sum, p) => sum + (p.white === a && p.black === b ? scoreOf(p.result, true) : p.white === b && p.black === a ? scoreOf(p.result, false) : 0), 0)
  return rows.sort(
    (x, y) =>
      y.points - x.points ||
      y.sb - x.sb ||
      headToHead(y.entrant, x.entrant) - headToHead(x.entrant, y.entrant) ||
      y.wins - x.wins,
  )
}

export const nextPairing = (pairings: readonly Pairing[]) => {
  const i = pairings.findIndex(p => p.result === null)
  return i < 0 ? null : i
}

const AVG_MOVES_PER_SIDE = 40

// Cost estimate from measured averages per model+effort; unknown sides make it a lower bound.
export const estimateUsd = (
  pairings: readonly Pairing[],
  perMove: readonly (number | undefined)[],
) => {
  let usd = 0
  let isComplete = true
  for (const p of pairings) {
    for (const e of [p.white, p.black]) {
      const each = perMove[e]
      if (each === undefined) isComplete = false
      else usd += each * AVG_MOVES_PER_SIDE
    }
  }
  return { usd, isComplete }
}
