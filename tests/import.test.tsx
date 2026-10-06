import { expect, test } from 'claude-code/testing'

import { TIME_CONTROLS, applyMove, importGames, newGame, pgnUrl, toPgn } from '../hooks/game'
import { PANE, engine, scripted } from './kit'

const RUN = { command: 'chess', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

const played = (moves: string[]) =>
  moves.reduce((g, san) => applyMove(g, san, 0)!, newGame({ id: 1, white: { kind: 'human' }, black: { kind: 'human' }, tc: TIME_CONTROLS[0]!, rules: 'standard', isClaudeClocked: true }, 0))
const TWO_GAMES = `${toPgn(played(['f3', 'e5', 'g4', 'Qh4#']), new Date(2026, 0, 2))}\n\n${toPgn(played(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']), new Date(2026, 0, 3))}\n`

test('Lichess pages map to their PGN export; other URLs pass through', () => {
  expect(pgnUrl('https://lichess.org/abcdEFGH')).toBe('https://lichess.org/game/export/abcdEFGH')
  expect(pgnUrl('https://lichess.org/abcdEFGHijkl')).toBe('https://lichess.org/game/export/abcdEFGH')
  expect(pgnUrl('https://lichess.org/abcdEFGH/black')).toBe('https://lichess.org/game/export/abcdEFGH')
  expect(pgnUrl('https://lichess.org/study/AbCd1234')).toBe('https://lichess.org/api/study/AbCd1234.pgn')
  expect(pgnUrl('https://lichess.org/api/study/AbCd1234.pgn')).toBe('https://lichess.org/api/study/AbCd1234.pgn')
  expect(pgnUrl('https://example.com/famous.pgn')).toBe('https://example.com/famous.pgn')
})

test('a PGN file with several games imports each and skips what does not parse', () => {
  const { games, failed } = importGames(`${TWO_GAMES}\n[Event "broken"]\n\n1. e5 e4 *\n`, 'now')
  expect(games.map(g => g.result)).toEqual(['0-1', '1-0'])
  expect(games[1]!.white).toBe('You')
  expect(failed).toBe(1)
})

test('/chess import fetches a URL and opens the newest game as a replay', async ($, on) => {
  engine(on, scripted([]))
  const fetched: string[] = []
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: TWO_GAMES } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const reply = await $.command.run({ ...RUN, args: 'import https://lichess.org/study/AbCd1234' })
  expect(fetched).toEqual(['https://lichess.org/api/study/AbCd1234.pgn'])
  expect(reply.text).toMatch(/Imported 2 games/)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^REPLAY$/ })).toBeDefined()
  await ui.press({ key: 'last' })
  expect(await ui.find({ type: 'Text', text: /^Move 7 of 7 · 1-0/ })).toBeDefined()
  await ui.press({ key: 'nav-library' })
  expect(await ui.findAll({ type: 'Button', text: /You vs You/ })).toHaveLength(2)
})

test('/chess import reports a failed fetch plainly', async ($, on) => {
  engine(on, scripted([]))
  on('http.fetch', () => ({ value: { status: 404, ok: false, headers: {}, text: '' } }))
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ ...RUN, args: 'import https://lichess.org/abcdEFGH' })).text).toBe('Could not fetch https://lichess.org/abcdEFGH: HTTP 404.')
})

test('games set up from a FEN or another variant are refused, not imported to crash the replay', () => {
  const fromFen = '[Event "study"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Ke7 *\n'
  const variant = '[Event "x"]\n[Variant "Chess960"]\n\n1. e4 e5 *\n'
  const { games, failed } = importGames(`${fromFen}\n${variant}\n${TWO_GAMES}`, 'now')
  expect(games).toHaveLength(2)
  expect(failed).toBe(2)
})

test('imported games are stored without comments or variations', () => {
  const noisy = '[Event "annotated"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 {best by test} e5 (1... c5 2. Nf3) 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n'
  const { games } = importGames(noisy, 'now')
  expect(games[0]!.pgn).not.toContain('best by test')
  expect(games[0]!.pgn).not.toContain('c5')
  expect(games[0]!.pgn).toContain('4. Qxf7# 1-0')
})

test('a FEN header that is the standard start still imports', () => {
  const standard = '[Event "from position"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 *\n'
  expect(importGames(standard, 'now').games).toHaveLength(1)
})
