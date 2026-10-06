import { expect, test } from 'claude-code/testing'

import { CLASSICS, classicPgn } from '../hooks/classics'
import { fromPgn, importGames, replay } from '../hooks/game'

test('every bundled classic imports, replays legally, and ends in the mate its result claims', () => {
  for (const c of CLASSICS) {
    const { games, failed } = importGames(classicPgn(c), 'now')
    expect(failed).toBe(0)
    const board = replay(fromPgn(games[0]!.pgn).history)
    expect(board.isCheckmate()).toBe(c.ending === 'mate')
    expect(board.isGameOver()).toBe(c.ending === 'mate')
    expect(board.turn()).toBe(c.result === '1-0' ? 'b' : 'w')
  }
})

test('Cardoso vs Fischer 1957 is the full 79-ply game from chessgames.com', () => {
  const c = CLASSICS.find(x => x.id === 'cardoso-fischer')!
  const { games } = importGames(classicPgn(c), 'now')
  const history = fromPgn(games[0]!.pgn).history
  expect(history).toHaveLength(79)
  expect(history.at(-1)).toBe('Rxd5+')
  expect(games[0]!.white).toBe('Rodolfo Tan Cardoso')
})
