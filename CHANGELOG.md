# Changelog

## [0.1.3] - 2026-10-08

### Added
- Replay autoplay: `p` plays a replay or a finished game by itself, or stops it. From the end it starts over. A manual step, a confirm prompt, leaving the replay or hiding the pane stops it.
- Replay speed, 0.25s to 5s a move: `s` cycles it in a replay and applies to the next move, or set it in settings. It persists.

## [0.1.2] - 2026-10-08

### Added
- `/chess help`, `/chess keys`, `/chess key <key>` and `/chess set <name> <value>`: list and drive the pane's keys, pickers and fields from the chat.
- Replacing a game in progress (new game, tournament, resume, `/chess <model>`) asks: abandon it, keep it to resume later, or cancel.

- Claude's spend follows Claude Code's managed `modelPricing` setting (contracted rates and multiplier) when one is set, list price otherwise.

### Changed
- The move box under the board is gone: click a piece then its target, or play `/chess move e4` from the chat.
- `/chess` runs at once, even while Claude is mid-reply.
- Resigning, and the pane's confirmations reached from the chat, ask in Claude Code's yes/no picker.
- README: quick start, commands grouped, a Known issues section (herdr clicks), and a Cost notice: spend is an experimental estimate, not your bill.
- Claude's spend in the pane reads "est.".
- The draw key is hidden while the game is paused; a draw offer at the budget cap says why it was not sent.

### Fixed
- Claude's spend stayed at $0 from Claude Code 2.1.292: the session cost it was read from stopped moving with chessus's model calls. Each reply is now priced from its own tokens, so a chat turn running alongside no longer leaks into it either. The $0 samples it recorded are dropped from the tournament estimate.
- The tournament budget cap is checked before every Claude call, not every turn. A turn's retries ran well past it ($0.05 spent on a $0.015 cap), and draw offers were never checked. Now only a call already under way can pass it, and a paused game makes no further call.
- Keeping a game to resume on a full store stops what was starting, instead of abandoning the game and its older snapshot.

## [0.1.1] - 2026-10-07

### Changed
- The move list holds its full height from the first move, so the divider and the player below it no longer move as the game goes on.
- Claude's spend moved to the top row, right of the menu: this game's spend in a casual game, the tournament's spend against its cap in a tournament.
- The end-of-game note fits in two lines, so the sidebar never grows past the board when a game ends.

## [0.1.0] - 2026-10-07

### Added
- Any side human or Claude (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 4.5) at any effort: you vs Claude, Claude vs Claude, hotseat.
- FIDE rules: automatic fivefold/75-move draws, claimable threefold/50-move, flag vs insufficient material, illegal-move penalties per time control, casual preset.
- Time controls from bullet 1+0 to classical 90+30, Fischer increment, per-game toggle for Claude's clock.
- Round-robin tournaments (single/double), standings with Sonneborn-Berger, budget cap that pauses the tournament.
- Key row that fits the moment: game actions during play, replay steps only in replays and finished games.
- Board with a sidebar: mode header (casual, tournament round, replay), players and clocks, the side to move marked, the move list, a move box; a GAME OVER banner saying who won, that the game was saved, and what comes next.
- Claude's replies with no move in them are asked again without penalty; a named illegal move is penalized and quoted.
- Moves typed in SAN or coordinates, in the pane or from chat (`/chess move e4`); ambiguous moves name the choices.
- Pause and resume; an unfinished casual game is saved and comes back paused after a restart. Save a game to resume later (`s` or `/chess save`) and pick it up from replays. Resign and close ask first; starting a game over one in progress asks first and keeps the old one under replays.
- One "new game" screen for casual games and tournaments, with per-game options that start at the default settings; standings while a tournament runs; opponent model and effort switchable mid-game.
- Replays: famous games (Légal's Mate, the Immortal Game, the Evergreen Game, the Opera Game, Cardoso beats Fischer 1957), Lichess broadcast search and download, a Chess.com player's latest month, `/chess import <url|file>`, saved games, PGN copy and export.
- Default settings persisted across sessions.
- Delete a saved game, or all of them, with a confirm.
