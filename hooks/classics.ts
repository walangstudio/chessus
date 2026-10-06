// Famous games kept with the mod. Each replays legally to the ending it claims; tests/classics.test.ts holds that.
export type Classic = {
  id: string; title: string; white: string; black: string; site: string; date: string; moves: string
  result: '1-0' | '0-1'; ending: 'mate' | 'resigned'; source?: string
}

export const CLASSICS: readonly Classic[] = [
  {
    id: 'legal', title: "Légal's Mate", white: 'Legall de Kermeur', black: 'Saint Brie', site: 'Paris', date: '1750.??.??', result: '1-0', ending: 'mate',
    moves: '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#',
  },
  {
    id: 'immortal', title: 'The Immortal Game', white: 'Adolf Anderssen', black: 'Lionel Kieseritzky', site: 'London', date: '1851.06.21', result: '1-0', ending: 'mate',
    moves: '1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7#',
  },
  {
    id: 'evergreen', title: 'The Evergreen Game', white: 'Adolf Anderssen', black: 'Jean Dufresne', site: 'Berlin', date: '1852.??.??', result: '1-0', ending: 'mate',
    moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7#',
  },
  {
    id: 'opera', title: 'The Opera Game', white: 'Paul Morphy', black: 'Duke Karl / Count Isouard', site: 'Paris', date: '1858.??.??', result: '1-0', ending: 'mate',
    moves: '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#',
  },
  {
    id: 'cardoso-fischer', title: 'Cardoso beats Fischer', white: 'Rodolfo Tan Cardoso', black: 'Robert James Fischer',
    site: 'New York', date: '1957.09.08', result: '1-0', ending: 'resigned',
    source: 'chessgames.com game 1044430: Fischer-Cardoso match, round 3. The only game Fischer ever lost to a Filipino.',
    moves: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. g3 e5 7. Nde2 Be7 8. Bg2 O-O 9. O-O Nbd7 10. h3 b5 11. a4 b4 12. Nd5 Nxd5 13. Qxd5 Qc7 14. c3 Bb7 15. Qd1 Nc5 16. f3 a5 17. Be3 Ba6 18. Rc1 Rab8 19. f4 bxc3 20. Rxc3 Rxb2 21. Rf2 Qb6 22. Rc1 Qb3 23. Nc3 exf4 24. Rxb2 Qxb2 25. Bxc5 dxc5 26. gxf4 c4 27. Nd5 Bc5+ 28. Kh2 Bb4 29. Rc2 Qb3 30. e5 Qxa4 31. Be4 g6 32. Qg4 Bb7 33. Nf6+ Kg7 34. Qh4 Rc8 35. Qxh7+ Kf8 36. e6 Rc7 37. Qg8+ Ke7 38. Qxf7+ Kd8 39. Rd2+ Bd5 40. Rxd5+',
  },
]

export const classicTermination = (c: Classic) => (c.ending === 'mate' ? 'checkmate' : `${c.result === '1-0' ? 'Black' : 'White'} resigned`)

export const classicPgn = (c: Classic) =>
  [
    `[Event "${c.title}"]`, `[Site "${c.site}"]`, `[Date "${c.date}"]`,
    `[White "${c.white}"]`, `[Black "${c.black}"]`, `[Result "${c.result}"]`,
    `[Termination "${classicTermination(c)}"]`,
    '', `${c.moves} ${c.result}`, '',
  ].join('\n')
