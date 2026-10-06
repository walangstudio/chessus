import { expect, test } from 'claude-code/testing'

import type { Game } from '../types'
import { namesAMove, pickMove } from '../hooks/claude'
import { TIME_CONTROLS, applyMove, canMate, claimable, flagIfOut, illegalMove, newGame, remaining, toPgn } from '../hooks/game'
import { Chess } from '../hooks/vendor/chess.js'

const tc = (id: string) => TIME_CONTROLS.find(t => t.id === id)!
const HUMAN = { kind: 'human' } as const
const HAIKU = { kind: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'low' } as const
const start = (id = 'untimed', o: Partial<Game> = {}) =>
  ({ ...newGame({ id: 1, white: HUMAN, black: HAIKU, tc: tc(id), rules: 'standard', isClaudeClocked: true }, 0), ...o })
const play = (g: Game, moves: string[], stepMs = 0) =>
  moves.reduce((acc, san, i) => applyMove(acc, san, (i + 1) * stepMs)!, g)

test("fool's mate ends 0-1 by checkmate", () => {
  const g = play(start(), ['f3', 'e5', 'g4', 'Qh4#'])
  expect(g.result).toBe('0-1')
  expect(g.termination).toBe('checkmate')
  expect(applyMove(g, 'a3', 0)).toBeNull()
})

test('illegal moves: rapid gives +2 min then loses, blitz loses at once, untimed warns first', () => {
  const rapid = illegalMove(start('10+5'), 'w')
  expect(rapid.result).toBe('*')
  expect(rapid.clock.b).toBe(12 * 60_000)
  expect(illegalMove(rapid, 'w').result).toBe('0-1')
  expect(illegalMove(start('3+2'), 'w').result).toBe('0-1')
  const casual = illegalMove(start(), 'w')
  expect(casual.result).toBe('*')
  expect(casual.note).toContain('warning')
})

test('clocks: elapsed time is charged, increment added, flag loses, flag vs bare king draws', () => {
  const g = applyMove(start('3+2'), 'e4', 5000)!
  expect(g.clock.w).toBe(3 * 60_000 - 5000 + 2000)
  expect(remaining(g, 'b', 6000)).toBe(3 * 60_000 - 1000)
  const flagged = flagIfOut(g, 5000 + 3 * 60_000 + 1)
  expect(flagged.result).toBe('1-0')
  expect(flagged.termination).toBe('time forfeit')
})

test('a lone king, K+N or K+B cannot mate, so flagging against it is a draw', () => {
  expect(canMate(new Chess('k7/8/8/8/8/8/8/K6N w - - 0 1'), 'w')).toBe(false)
  expect(canMate(new Chess('k7/8/8/8/8/8/8/K6B w - - 0 1'), 'w')).toBe(false)
  expect(canMate(new Chess('k7/8/8/8/8/8/8/K5NN w - - 0 1'), 'w')).toBe(true)
  expect(canMate(new Chess('k7/8/8/8/8/8/8/K6Q w - - 0 1'), 'b')).toBe(false)
})

test("Claude's clock can be paused while it thinks", () => {
  const g = applyMove(start('3+2', { isClaudeClocked: false }), 'e4', 0)!
  const after = applyMove(g, 'e5', 60_000)!
  expect(after.clock.b).toBe(3 * 60_000 + 2000)
})

test('threefold is claimable, fivefold ends the game', () => {
  const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8']
  const three = play(start(), [...shuffle, ...shuffle])
  expect(three.result).toBe('*')
  expect(claimable(three)).toBe('threefold repetition')
  const five = play(start(), [...shuffle, ...shuffle, ...shuffle, ...shuffle])
  expect(five.result).toBe('1/2-1/2')
  expect(five.termination).toBe('fivefold repetition')
})

test('pickMove reads SAN out of chatty replies', () => {
  const legal = ['e4', 'Nf3', 'O-O', 'exd5', 'Qh4#']
  expect(pickMove('e4', legal)).toBe('e4')
  expect(pickMove('I play 1. Nf3.', legal)).toBe('Nf3')
  expect(pickMove('0-0', legal)).toBe('O-O')
  expect(pickMove('Qh4', legal)).toBe('Qh4#')
  expect(pickMove('banana', legal)).toBeUndefined()
})

test('PGN carries the official headers and result', () => {
  const pgn = toPgn(play(start(), ['f3', 'e5', 'g4', 'Qh4#']), new Date('2026-10-06T00:00:00Z'))
  expect(pgn).toContain('[White "You"]')
  expect(pgn).toContain('[Black "Haiku 4.5 (low)"]')
  expect(pgn).toContain('[Result "0-1"]')
  expect(pgn).toContain('[Termination "checkmate"]')
  expect(pgn).toContain('2. g4 Qh4# 0-1')
})

test('a lone minor can still mate when the flagged side has material to block with (FIDE 6.9)', () => {
  expect(canMate(new Chess('k7/p7/8/8/8/8/8/K6B w - - 0 1'), 'w')).toBe(true)
})

test('pickMove takes the whole reply first, else the last move named, and forgives case and promotion spelling', () => {
  const legal = ['e4', 'd4', 'Nf3', 'e8=Q']
  expect(pickMove('I considered e4 but prefer d4', legal)).toBe('d4')
  expect(pickMove('nf3', legal)).toBe('Nf3')
  expect(pickMove('e8Q', legal)).toBe('e8=Q')
  expect(pickMove('e8q', legal)).toBe('e8=Q')
})

test('a reply names a move only when its answer is shaped like one; markdown around it does not matter', () => {
  for (const reply of ['Ke6', '**Ke6**', '`Ke6`', 'Ke6.', 'I will play Ke6', 'My move: **Ke6**', 'e2e4', 'O-O', 'exd5+'])
    expect(namesAMove(reply)).toBe(true)
  for (const reply of ['a3 is interesting, hmm', 'The knight on f3 is strong.', 'Let me think about this position.', ''])
    expect(namesAMove(reply)).toBe(false)
  expect(pickMove('**Nf3**', ['e4', 'Nf3'])).toBe('Nf3')
  expect(pickMove('`e4`', ['e4', 'Nf3'])).toBe('e4')
})
