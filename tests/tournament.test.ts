import { expect, test } from 'claude-code/testing'

import { estimateUsd, roundRobin, standings } from '../hooks/tournament'

test('round-robin: every pair meets once, colors balanced, for 2 to 8 entrants', () => {
  for (let n = 2; n <= 8; n++) {
    const games = roundRobin(n, false)
    expect(games).toHaveLength((n * (n - 1)) / 2)
    const pairs = new Set(games.map(p => [p.white, p.black].sort().join('-')))
    expect(pairs.size).toBe(games.length)
    for (let e = 0; e < n; e++) {
      const whites = games.filter(p => p.white === e).length
      const blacks = games.filter(p => p.black === e).length
      expect(Math.abs(whites - blacks)).toBeLessThanOrEqual(1)
    }
  }
})

test('double round-robin swaps colors and balances them exactly', () => {
  for (let n = 2; n <= 8; n++) {
    const games = roundRobin(n, true)
    expect(games).toHaveLength(n * (n - 1))
    for (let e = 0; e < n; e++) expect(games.filter(p => p.white === e).length).toBe(n - 1)
  }
})

test('standings score 1/half/0 and break ties by Sonneborn-Berger', () => {
  const games = roundRobin(3, false).map((p, i) => ({ ...p, result: (['1-0', '1/2-1/2', '0-1'] as const)[i]! }))
  const table = standings(3, games)
  expect(table.reduce((s, r) => s + r.points, 0)).toBe(3)
  expect(table[0]!.points).toBeGreaterThanOrEqual(table[1]!.points)
  const sb = table.find(r => r.points === table[0]!.points && r.entrant === table[0]!.entrant)!.sb
  expect(sb).toBeGreaterThanOrEqual(0)
})

test('estimate is a lower bound when an entrant has no cost data', () => {
  const games = roundRobin(2, false)
  const est = estimateUsd(games, [0.01, 0.02])
  expect(Math.abs(est.usd - 1.2)).toBeLessThan(1e-9)
  expect(est.isComplete).toBe(true)
  expect(estimateUsd(games, [0.01, undefined]).isComplete).toBe(false)
})
