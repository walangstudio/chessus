import { expect, test } from 'claude-code/testing'

import { TIME_CONTROLS, applyMove, newGame } from '../hooks/game'
import { parseMove, whyNotMove } from '../hooks/register'
import { PANE, engine, scripted, toasts } from './kit'

const RUN = { command: 'chess', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('parseMove reads SAN and coordinate notation, and nothing else', () => {
  expect(parseMove('e4', [])).toBe('e2e4')
  expect(parseMove('Nf3', [])).toBe('g1f3')
  expect(parseMove('nf3', [])).toBe('g1f3')
  expect(parseMove('e2e4', [])).toBe('e2e4')
  expect(parseMove('e2-e4', [])).toBe('e2e4')
  expect(parseMove('G1-F3', [])).toBe('g1f3')
  expect(parseMove('e2e5', [])).toBeUndefined()
  expect(parseMove('Ke2', [])).toBeUndefined()
  expect(parseMove('e4 please', [])).toBeUndefined()
  expect(parseMove('O-O', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])).toBe('e1g1')
  expect(parseMove('0-0', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])).toBe('e1g1')
})

test('/chess move plays your move from chat and Claude answers', async ($, on) => {
  const clock = engine(on, scripted(['e5']))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ ...RUN, args: 'move e4' })).text).toMatch(/No game in progress/)
  await $.command.run({ ...RUN, args: 'haiku low' })
  expect((await $.command.run({ ...RUN, args: 'move e5' })).text).toMatch(/"e5" is not a legal move here\. Legal moves: .*e4/)
  expect((await $.command.run({ ...RUN, args: 'move e2-e4' })).text).toMatch(/You played e4\. Haiku 4\.5 \(low\) is thinking/)
  expect((await $.command.run({ ...RUN, args: 'move d4' })).text).toMatch(/Not your move/)
  for (let i = 0; i < 4; i++) await clock.advance(500)
  expect(toasts).toContain('Haiku 4.5 (low) played e5')
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^e5 / })).toBeDefined()
})

test('/chess close closes the pane and keeps the game', async ($, on) => {
  engine(on, scripted([]))
  const closed: string[] = []
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.command.run({ ...RUN, args: 'haiku low' })
  expect((await $.command.run({ ...RUN, args: 'close' })).text).toMatch(/Game paused and saved, Chessus closed/)
  expect(closed).toEqual(['chessus'])
  expect((await $.command.run({ ...RUN, args: 'move e4' })).text).toMatch(/paused/)
  expect((await $.command.run({ ...RUN, args: 'resume' })).text).toMatch(/resumed/)
  expect((await $.command.run({ ...RUN, args: 'move e4' })).text).toMatch(/You played e4/)
})

test('an unfinished casual game comes back paused in the next session, with no clock charged for the time away', async ($, on) => {
  const HAIKU_LOW = { kind: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'low' } as const
  const fresh = newGame({ id: 7, white: { kind: 'human' }, black: HAIKU_LOW, tc: TIME_CONTROLS.find(t => t.id === '5+3')!, rules: 'standard', isClaudeClocked: true }, 0)
  const live = applyMove(applyMove(fresh, 'e4', 10_000)!, 'e5', 20_000)!
  engine(on, scripted([]), 0.01, { live })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^e5 / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Paused · p resumes$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ You\s+4:53/ })).toBeDefined()
  expect((await $.command.run({ ...RUN, args: 'move Nf3' })).text).toMatch(/paused/)
  expect((await $.command.run({ ...RUN, args: 'resume' })).text).toMatch(/resumed/)
  expect((await $.command.run({ ...RUN, args: 'move Nf3' })).text).toMatch(/You played Nf3/)
})

test('castling in any case, over-specified moves, and a promotion without its piece', () => {
  const castleReady = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']
  expect(parseMove('o-o', castleReady)).toBe('e1g1')
  expect(parseMove('O-o', castleReady)).toBe('e1g1')
  expect(parseMove('Ngf3', [])).toBe('g1f3')
  expect(parseMove('Ng1f3', [])).toBe('g1f3')
  const promoting = ['a4', 'h5', 'a5', 'h4', 'a6', 'h3', 'axb7', 'hxg2']
  expect(whyNotMove('b7a8', promoting)).toBe('"b7a8" promotes a pawn: add the piece, e.g. b7a8q (queen), b7a8r, b7a8b or b7a8n.')
  expect(parseMove('b7a8q', promoting)).toBe('b7a8q')
})

test('two pieces that can reach one square must be told apart, as SAN requires', () => {
  const twoKnights = ['Nf3', 'd5', 'd3', 'e5']
  expect(parseMove('Nd2', twoKnights)).toBeUndefined()
  expect(whyNotMove('Nd2', twoKnights)).toBe('"Nd2" is ambiguous: more than one piece can go there. Write Nbd2 or Nfd2.')
  expect(parseMove('Nbd2', twoKnights)).toBe('b1d2')
  expect(parseMove('Nfd2', twoKnights)).toBe('f3d2')
  expect(parseMove('b1d2', twoKnights)).toBe('b1d2')
  expect(whyNotMove('Ke2', [])).toBe('"Ke2" is not a legal move here.')
})
