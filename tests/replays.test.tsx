import { expect, test } from 'claude-code/testing'

import { CLASSICS, classicPgn } from '../hooks/classics'
import { PANE, choose, engine, scripted } from './kit'

const START = { cwd: '.', surface: 'terminal', isInteractive: true } as const
const RUN = { command: 'chess', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

test('the replays screen lists the classics, Cardoso vs Fischer included, and opens one as a replay', async ($, on) => {
  engine(on, scripted([]))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'nav-library' })
  expect(await ui.find({ type: 'Button', text: /Cardoso beats Fischer {2}· {2}Rodolfo Tan Cardoso vs Robert James Fischer, New York 1957/ })).toBeDefined()
  await ui.press({ key: 'classic-cardoso-fischer' })
  expect(await ui.find({ type: 'Text', text: /^REPLAY$/ })).toBeDefined()
  await ui.press({ key: 'last' })
  expect(await ui.find({ type: 'Text', text: /^Move 79 of 79 · 1-0/ })).toBeDefined()
})

test('searching official events lists them, and picking one downloads its games', async ($, on) => {
  engine(on, scripted([]))
  const fetched: string[] = []
  const event = classicPgn(CLASSICS.find(c => c.id === 'opera')!)
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    const text = e.url.includes('/search')
      ? JSON.stringify({ currentPageResults: [{ tour: { id: 'AbCd1234', name: 'FIDE Candidates 2026: Open' } }, { tour: { id: 'bad id', name: 'x' } }] })
      : event
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'nav-library' })
  await ui.input({ key: 'search-events', text: 'candidates' })
  expect(fetched[0]).toBe('https://lichess.org/api/broadcast/search?q=candidates')
  expect(await ui.findAll({ type: 'Button', text: /↓/ })).toHaveLength(1)
  await ui.press({ key: 'event-0' })
  expect(fetched[1]).toBe('https://lichess.org/api/broadcast/AbCd1234.pgn')
  expect(await ui.find({ type: 'Text', text: /^REPLAY$/ })).toBeDefined()
})

test("a Chess.com player's latest month loads from chat", async ($, on) => {
  engine(on, scripted([]))
  const fetched: string[] = []
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    const text = e.url.endsWith('/archives')
      ? JSON.stringify({ archives: ['https://api.chess.com/pub/player/someplayer/games/2026/09', 'https://api.chess.com/pub/player/someplayer/games/2026/10'] })
      : JSON.stringify({ games: [{ pgn: classicPgn(CLASSICS[0]!) }, { pgn: classicPgn(CLASSICS[1]!) }] })
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  const reply = await $.command.run({ ...RUN, args: 'player SomePlayer' })
  expect(fetched).toEqual(['https://api.chess.com/pub/player/someplayer/games/archives', 'https://api.chess.com/pub/player/someplayer/games/2026/10'])
  expect(reply.text).toMatch(/Imported 2 games from someplayer on Chess\.com \(2026-10\)/)
  expect((await $.command.run({ ...RUN, args: 'player not/a/user' })).text).toMatch(/is not a Chess\.com username/)
})

test('starting a casual game over one in progress asks first', async ($, on) => {
  engine(on, scripted(['e5']))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'start' })
  await $.command.run({ ...RUN, args: 'move e4' })
  await ui.press({ key: 'nav-setup' })
  await ui.press({ key: 'start' })
  expect(await ui.find({ type: 'Text', text: /Start a new game\? The current one:/ })).toBeDefined()
  await ui.press({ key: 'replace-no' })
  await ui.press({ key: 'resume-game' })
  expect(await ui.find({ type: 'Text', text: /^e4 / })).toBeDefined()
})

test('keeping the game in progress makes it resumable from replays when a new game starts', async ($, on) => {
  engine(on, scripted(['e5']))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'start' })
  await $.command.run({ ...RUN, args: 'move e4' })
  await ui.press({ key: 'nav-setup' })
  await ui.press({ key: 'start' })
  await ui.press({ key: 'replace-keep' })
  expect(await ui.find({ type: 'Text', text: /^Your move \(White\)$/ })).toBeDefined()
  await ui.press({ key: 'nav-library' })
  expect(await ui.find({ type: 'Button', text: /saved to resume/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /abandoned/ })).toBeUndefined()
  await ui.press({ key: 'lib-0' })
  expect(await ui.find({ key: 'resume-saved' })).toBeDefined()
})

test('/chess <model> over a game in progress asks: cancel keeps it, abandon replaces it', async ($, on) => {
  engine(on, scripted(['e5']))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let pick = 'Cancel'
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]!
    return { result: { questions: e.questions, answers: { [q.question]: pick } } }
  })
  await $.session.start(START)
  await $.command.run({ ...RUN, args: 'haiku low' })
  await $.command.run({ ...RUN, args: 'move e4' })
  expect((await $.command.run({ ...RUN, args: 'sonnet' })).text).toMatch(/Kept the game in progress/)
  pick = 'Abandon it'
  expect((await $.command.run({ ...RUN, args: 'sonnet' })).text).toMatch(/New game: you \(White\) vs Sonnet/)
})

test('/chess tournament opens the tournament form when none is running', async ($, on) => {
  engine(on, scripted([]))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  expect((await $.command.run({ ...RUN, args: 'tournament' })).text).toMatch(/Tournament setup opened/)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', key: 'new-mode-value', text: /Tournament/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'start-tournament' })).toBeDefined()
})

test('an import adds at most 30 games, never the same game twice', async ($, on) => {
  engine(on, scripted([]))
  const many = Array.from({ length: 40 }, (_, i) => `[Event "e${i}"]\n[White "W${i}"]\n[Black "B${i}"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 ${i % 2 ? 'Nc6' : 'Nf6'} *\n`).join('\n')
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: many } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  const first = (await $.command.run({ ...RUN, args: 'import https://example.com/a.pgn' })).text
  expect(first).toMatch(/Imported 30 games .*kept the newest 30 of 40/)
  const again = (await $.command.run({ ...RUN, args: 'import https://example.com/a.pgn' })).text
  expect(again).toMatch(/Imported 10 games .*30 already saved/)
  const third = (await $.command.run({ ...RUN, args: 'import https://example.com/a.pgn' })).text
  expect(third).toMatch(/Every game from .* is already under replays/)
})

test('network replies of the wrong shape are refused, and archive links must be the player\'s own', async ($, on) => {
  engine(on, scripted([]))
  const fetched: string[] = []
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    const text = e.url.includes('/search')
      ? JSON.stringify({ currentPageResults: [{ tour: { id: 12345678, name: 'numeric id' } }, { tour: { id: 'AbCd1234', name: { evil: true } } }, null] })
      : e.url.endsWith('/archives') ? JSON.stringify({ archives: ['https://evil.example.com/pub/player/someplayer/games/2026/10'] }) : 'not json'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  expect((await $.command.run({ ...RUN, args: 'search x' })).text).toMatch(/No events found/)
  expect((await $.command.run({ ...RUN, args: 'player someplayer' })).text).toMatch(/someplayer has no games on Chess\.com/)
  expect(fetched.some(u => u.includes('evil'))).toBe(false)
})

test('a saved game can be deleted after a confirm; the bundled classics cannot', async ($, on) => {
  const clock = engine(on, scripted(['f6', 'g5']))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'nav-library' })
  await ui.press({ key: 'classic-opera' })
  expect(await ui.find({ key: 'delete' })).toBeUndefined()
  await ui.press({ key: 'nav-setup' })
  await ui.press({ key: 'start' })
  for (const move of ['e4', 'd4', 'Qh5#']) {
    await $.command.run({ ...RUN, args: `move ${move}` })
    for (let i = 0; i < 4; i++) await clock.advance(500)
  }
  await ui.press({ key: 'nav-library' })
  await ui.press({ key: 'lib-0' })
  await ui.press({ key: 'delete' })
  expect(await ui.find({ type: 'Text', text: /Delete You vs Sonnet 5\.5 \(medium\) from your saved games\?/ })).toBeDefined()
  await ui.press({ key: 'delete-no' })
  await ui.press({ key: 'delete' })
  await ui.press({ key: 'delete-yes' })
  expect(await ui.find({ key: 'lib-0' })).toBeUndefined()
})

test('delete all saved games asks first', async ($, on) => {
  engine(on, scripted([]))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: CLASSICS.map(classicPgn).join('\n') } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start(START)
  await $.command.run({ ...RUN, args: 'import https://example.com/x.pgn' })
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await ui.press({ key: 'nav-library' })
  await ui.press({ key: 'clear-all' })
  expect(await ui.find({ type: 'Text', text: /Delete 5 saved games\?/ })).toBeDefined()
  await ui.press({ key: 'clear-no' })
  expect(await ui.find({ key: 'lib-0' })).toBeDefined()
  await ui.press({ key: 'clear-all' })
  await ui.press({ key: 'clear-yes' })
  expect(await ui.find({ key: 'lib-0' })).toBeUndefined()
})

test('a game takes its options from the new game screen, which start at the defaults', async ($, on) => {
  engine(on, scripted([]))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^Game options$/ })).toBeDefined()
  await choose(ui, 'opt-tc', 'Blitz 5+3')
  await choose(ui, 'opt-switch', 'Switchable from the board')
  await ui.press({ key: 'start' })
  expect(await ui.find({ type: 'Text', text: /You\s+5:00/ })).toBeDefined()
  expect(await ui.find({ key: 'opponent-model-value' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^STATUS$/ })).toBeDefined()
  await ui.press({ key: 'nav-settings' })
  expect(await ui.find({ type: 'Button', key: 'tc-value', text: /Untimed/ })).toBeDefined()
})

test('game options reset to the defaults once the game starts; delete all keeps games saved to resume', async ($, on) => {
  const clock = engine(on, scripted(['e5']))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'chessus', surface: 'terminal', ...PANE })
  await choose(ui, 'opt-tc', 'Blitz 5+3')
  expect(await ui.find({ key: 'opts-reset' })).toBeDefined()
  await ui.press({ key: 'start' })
  await ui.press({ key: 'nav-setup' })
  expect(await ui.find({ type: 'Button', key: 'opt-tc-value', text: /Untimed/ })).toBeDefined()
  expect(await ui.find({ key: 'opts-reset' })).toBeUndefined()
  await ui.press({ key: 'nav-game' })
  await $.command.run({ ...RUN, args: 'move e4' })
  for (let i = 0; i < 4; i++) await clock.advance(500)
  await ui.press({ key: 'save' })
  await ui.press({ key: 'nav-library' })
  expect(await ui.find({ key: 'clear-all' })).toBeUndefined()
})
