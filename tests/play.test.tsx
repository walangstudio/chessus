import { expect, test } from 'claude-code/testing'

import { hitTest } from '../hooks/board'
import { boardCell } from '../hooks/register'
import { HAIKU, PANE, choose, engine, scripted, tournamentSetup } from './kit'

test("Claude vs Claude plays to mate, saves the game, and the library reviews it", async ($, on) => {
  const clock = engine(on, scripted(['f3', 'e5', 'g4', 'Qh4#']))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await choose(ui, 'white-player', 'Haiku 4.5')
  await ui.press({ key: 'start' })
  for (let i = 0; i < 12; i++) await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /Black \(.+\) wins · checkmate/ })).toBeDefined()

  await ui.press({ key: 'nav-library' })
  await ui.press({ key: 'lib-0' })
  expect(await ui.find({ type: 'Text', text: /^Move 0 of 4/ })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /^Move 1 of 4/ })).toBeDefined()
})

test('you move with the keyboard, Claude answers, and a live game shows game keys, not replay keys', async ($, on) => {
  const clock = engine(on, scripted(['e5']))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'chessus', surface, ...PANE })
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Text', text: /e5/ })).toBeDefined()
      await ui.unmount()
      continue
    }
    await ui.press({ key: 'start' })
    for (const key of ['return', 'up', 'up', 'return']) await ui.key({ key, in: 'board' })
    for (let i = 0; i < 4; i++) await clock.advance(500)
    expect(await ui.find({ type: 'Text', text: /e4/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /e5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Your move \((White|Black)\)$/ })).toBeDefined()
    expect(await ui.find({ key: 'prev' })).toBeUndefined()
    expect(await ui.find({ key: 'new-game' })).toBeUndefined()
    for (const k of ['pause', 'save', 'copy', 'draw', 'resign', 'flip']) expect(await ui.find({ key: k })).toBeDefined()
    await ui.unmount()
  }
})

test('FIDE standard: a second illegal move loses', async ($, on) => {
  const clock = engine(on, () => 'banana')
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'start' })
  for (const key of ['return', 'up', 'up', 'return']) await ui.key({ key, in: 'board' })
  for (let i = 0; i < 4; i++) await clock.advance(500)
  expect(await ui.find({ type: 'Text', text: /White \(You\) wins · illegal move/ })).toBeDefined()
})

test('a round-robin runs every game, and the budget cap pauses it', async ($, on) => {
  const clock = engine(on, () => 'banana')
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await tournamentSetup(ui)
  await choose(ui, 'pick-model', 'Haiku 4.5')
  for (let i = 0; i < 3; i++) await ui.press({ key: 'add' })
  expect(await ui.find({ type: 'Text', text: /3 games/ })).toBeDefined()
  await ui.press({ key: 'start-tournament' })
  for (let i = 0; i < 20; i++) await clock.advance(500)
  expect(await ui.find({ type: 'Text', text: /^Saved\. Winner: / })).toBeDefined()
  await tournamentSetup(ui)
  expect(await ui.find({ type: 'Text', text: /Last tournament #1 finished/ })).toBeDefined()

  await ui.press({ key: 'nav-settings' })
  await ui.input({ key: 'budget', text: '0.015' })
  await tournamentSetup(ui)
  await ui.press({ key: 'start-tournament' })
  for (let i = 0; i < 20; i++) await clock.advance(500)
  await ui.press({ key: 'nav-tournament' })
  expect(await ui.find({ type: 'Text', text: /Budget of \$0.015 reached/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/3 games/ })).toBeDefined()
})

test('the board scales with the pane and a click on a piece then its target moves it', async ($, on) => {
  expect(boardCell(100, 40)).toEqual({ w: 7, h: 3 })
  expect(boardCell(70, 40)).toEqual({ w: 5, h: 2 })
  expect(boardCell(100, 28)).toEqual({ w: 5, h: 2 })
  expect(boardCell(50, 20)).toEqual({ w: 3, h: 1 })

  const clock = engine(on, scripted(['e5']))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'start' })
  expect(await ui.find({ type: 'Text', text: /^Your move \((White|Black)\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^CASUAL GAME$/ })).toBeDefined()
  const centre = (file: number, row: number) => ({ x: 2 + file * 7 + 3, y: row * 3 + 1 })
  await ui.pointer({ type: 'down', button: 'left', ...centre(4, 6) })
  await ui.pointer({ type: 'down', button: 'left', ...centre(4, 4) })
  for (let i = 0; i < 4; i++) await clock.advance(500)
  expect(await ui.find({ type: 'Text', text: /e4/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /e5/ })).toBeDefined()
})

test('clicks map to squares in both orientations and every size, and the promotion row maps to pieces', () => {
  const at = (w: number, h: number, file: number, row: number) => ({ x: 2 + file * w + Math.floor(w / 2), y: row * h + Math.floor(h / 2) })
  for (const [w, h] of [[7, 3], [5, 2], [3, 1]] as const) {
    const white = { cell: { w, h }, orientation: 'w' } as const
    const black = { cell: { w, h }, orientation: 'b' } as const
    const p = at(w, h, 4, 6)
    expect(hitTest(white, p.x, p.y)).toEqual({ kind: 'square', square: 'e2' })
    expect(hitTest(black, p.x, p.y)).toEqual({ kind: 'square', square: 'd7' })
    expect(hitTest(white, 0, 0)).toBeNull()
    expect(hitTest(white, p.x, 8 * h)).toBeNull()
    expect(hitTest(white, 13, 8 * h + 1)).toEqual({ kind: 'promo', piece: 'q' })
    expect(hitTest(white, 25, 8 * h + 1)).toEqual({ kind: 'promo', piece: 'n' })
    expect(hitTest(white, 5, 8 * h + 1)).toBeNull()
  }
})

test('moves can be typed when clicks never reach the board: SAN, UCI, and a clear note for a bad one', async ($, on) => {
  const clock = engine(on, scripted(['e5', 'Nc6']))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'start' })
  await ui.input({ key: 'move', text: 'Ke2' })
  expect(await ui.find({ type: 'Text', text: /"Ke2" is not a legal move here\. Legal: .*Nf3/ })).toBeDefined()
  await ui.input({ key: 'move', text: 'e4' })
  for (let i = 0; i < 4; i++) await clock.advance(500)
  await ui.input({ key: 'move', text: 'g1f3' })
  for (let i = 0; i < 4; i++) await clock.advance(500)
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${san} `) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Your move \((White|Black)\)$/ })).toBeDefined()
})

test('the pane has its own close button', async ($, on) => {
  engine(on, scripted([]))
  const closed: string[] = []
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['chessus'])
})
