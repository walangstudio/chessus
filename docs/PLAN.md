# Chessus plan

Chess inside Claude Code as a mod. Any side can be you or a Claude model at any effort. Official rules, clocks, tournaments, full game review.

## Goals

- **Matchups**: human vs Claude, Claude vs Claude (Haiku vs Opus), human vs human (hotseat).
- **Official rules**: FIDE Laws of Chess, including clocks and illegal-move penalties.
- **Tournaments**: round-robin among entrants (model + effort pairs, optionally you), auto-played, standings with tiebreaks.
- **Review**: every finished game saved as PGN with full headers; step through any game move by move; export.

## Architecture

One plugin, pure logic split from engine wiring so it unit-tests without `$`.

| File | Role | Pure? |
| --- | --- | --- |
| `hooks/vendor/chess.js` | chess.js 1.4.0 (BSD-2): move gen, legality, SAN/FEN/PGN, mate/stalemate/50-move/threefold/insufficient | yes |
| `hooks/game.ts` | Game reducer: `applyMove`, `resign`, `drawAgreed`, `flag`, `tick`; FIDE extras chess.js lacks (75-move + fivefold auto-draw, flag-vs-insufficient-material = draw, illegal-move count) | yes |
| `hooks/claude.ts` | Claude player: prompt (FEN + PGN + legal list), `$.model.complete({ model, effort })`, parse SAN, illegal-move policy, usage/cost accounting | no |
| `hooks/tournament.ts` | Round-robin pairings (Berger tables, colors balanced, double round option), standings (1 / ½ / 0), tiebreaks (Sonneborn-Berger, then head-to-head, then wins) | yes |
| `hooks/register.tsx` | Commands, state atoms, the move loop, pane rendering | no |
| `hooks/board.tsx` | `Client` board: cursor, click/keys, promotion picker, flip | yes (UI) |

### State

- `$.state` `chessus.game`: active game (players, history SAN, clocks, illegal counts, status, view ply, usage).
- `$.state` `chessus.tournament`: entrants, schedule, results, current game id.
- `$.state` `chessus.screen`: `setup | game | tournament | library`.
- `$.store` `games`: finished games as PGN (cap ~200, 4 MiB store limit). `$.store` `tournaments`: finished tables.

### Player model

`Side = { kind: 'human' } | { kind: 'claude'; model: string; effort: Effort }`. A game is `{ white: Side, black: Side, timeControl, rules }`. Every matchup is the same code path.

### The move loop

- After every state change: if the side to move is Claude and no request is in flight, `$.clock.after(spectateDelayMs)` -> request a move -> apply it.
- A game id guards each request: a new game or resign mid-request drops the stale reply.
- `session.start` re-kicks the loop after a hot reload or resume (module variables reset; state survives).
- Claude vs Claude runs unattended; one game at a time.

## Rules (FIDE Laws)

| Rule | Source |
| --- | --- |
| Castling, en passant, promotion, check | chess.js |
| Checkmate, stalemate | chess.js |
| Threefold repetition, 50-move rule | **claimable** by a human (Claim draw button). Claude never claims; fivefold/75-move end Claude-vs-Claude loops |
| Fivefold repetition, 75-move rule | **automatic** draw (game.ts) |
| Insufficient material | automatic draw |
| Flag fall | loss, unless the opponent cannot mate by any legal sequence -> draw |
| Resignation, draw by agreement | buttons; Claude answers a draw offer via one model call |
| Illegal move (Claude) | Default and tournaments: FIDE Standard. 1st illegal move adds 2 min to the opponent (rapid/classical), 2nd loses; in blitz/bullet the 1st loses. Casual preset (3 retries, then a random legal move, flagged in PGN) is opt-in |
| Promotion choice | picker q/r/b/n in the board |

Humans can't make illegal moves: the board only lets you play legal ones.

## Time controls

Presets: untimed, bullet 1+0, blitz 3+2 / 5+3, rapid 10+5 / 15+10, classical 90+30. Fischer increment. Clock ticks via `$.clock.every(100)` while a game runs.

**Claude clock**: per-game toggle on the setup screen, default on (thinking time counts, as FIDE). Off freezes the Claude side while it thinks.

## Tournament mode

- Entrants: 2-8, each a Side (you can enter too; the loop waits on your games).
- Format: single or double round-robin (double = each pair plays both colors). Swiss deferred.
- Per-tournament settings: time control, rules preset (forced to Standard or Blitz, never Casual), spectate delay.
- **Budget guard**: default cap $5, editable per tournament; estimated cost shown before start (games x avg plies x per-move cost by model/effort); hard stop at a $ cap, read from `usage` on each reply.
- Standings table: P, W, D, L, points, SB; live crosstable; click a cell to review that game.
- PGN headers: Event, Site, Date, Round, White, Black, Result, TimeControl, Termination, WhiteEffort/BlackEffort.

## Screens (one pane, switched by `screen`)

1. **Setup**: White side, Black side (Select: You / each model), effort per Claude side, time control, rules preset, Start. Shortcut: `/chess opus high` = you vs Opus high.
2. **Game**: board (flips when you play Black), both clocks, move log with current ply highlighted, status, buttons: resign, offer draw, claim draw, flip, review (|< < > >|), copy PGN, new game. Per-side running cost.
3. **Tournament**: setup (entrants, format, budget), then standings + crosstable + current game board.
4. **Library**: saved games (date, players, result), pick one to review; `/chess export <path>` writes all PGN to a file.

5. **Settings**: time control, rules preset, Claude clock, tournament format, budget cap, spectate pace. Persisted in `$.store`; new games and tournaments read it.

## Phases (each ends green: validate, tsc, tests)

1. **Core**: Side model, game reducer, setup screen, human vs Claude / Claude vs Claude / hotseat, promotion, resign, review log, PGN save + library. Tests: reducer, SAN parsing, a mocked CvC game played to mate, review stepping.
2. **Rules + clocks**: time controls, flag logic, illegal-move presets, claim/offer draw, 75/fivefold. Tests: mocked clock flag, insufficient-material flag draw, illegal-move penalties.
3. **Tournament**: Berger pairings, standings + SB, budget guard, crosstable review. Tests: pairing balance for 3-8 entrants, SB math, budget stop.
4. **Polish**: export, live E2E pass in the terminal, README with install line.

## Risks

- **Cost**: a double round-robin of 6 entrants = 30 games; at Opus max that's real money. Budget guard is mandatory, not optional.
- **Model latency vs clocks**: high effort can take minutes per move, so blitz with Claude-time-counted will flag.
- **Weak SAN discipline at low effort**: Haiku-low may emit illegal moves; the presets decide what that costs.
- **Pane width**: board (26 cols) + log (~22) + clocks needs ~60 columns; below that the log stacks under the board.
