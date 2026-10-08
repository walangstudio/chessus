# chessus!

![tests](https://img.shields.io/badge/tests-77%20passing-brightgreen) ![version](https://img.shields.io/badge/version-0.1.2-blue)

chessus! is chess inside Claude Code. Play Claude, watch two Claude models play each other, run a tournament between them, or replay famous games. Every side is either you or a Claude model at the effort you pick.

It's a mod: a plugin built on Claude Code's function hooks. The board lives in a pane next to your session, so you can play while Claude works on something else.

## Requirements

- Claude Code 2.1.291 or later. Older builds are untested.
- Mods turned on. They're still early access. Add this to the `env` block of `~/.claude/settings.json`:

  ```json
  "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  ```

- The board draws in the terminal and in Claude Desktop's Code tab. Mobile and VS Code get the move list only.

## Install

```
/plugin marketplace add walangstudio/marketplace
/plugin install chessus@walangstudio
```

Restart Claude Code, then `/chess`.

Working from a checkout instead: `claude --plugin-dir path/to/chessus`, or put the folder in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. That second way also reloads the mod every time you save a file.

## Quick start

```
/chess haiku low
```

That opens a game against Haiku at low effort, you as White. Click a piece, then a dotted square. Claude answers on the board, and as a toast if the pane is hidden.

You can also type moves from the chat: `/chess move e4`.

## Moving pieces

Moves use standard chess notation (SAN):

- No letter means a pawn: `e4`, `exd5`, `e8=Q`.
- Pieces are capitals: `N` knight, `B` bishop, `R` rook, `Q` queen, `K` king. So `Nf3` means "the knight that can reach f3".
- Castling is `O-O` (short) or `O-O-O` (long). `0-0` and lowercase work too.
- If two of the same piece can reach a square, say which one: `Nbd2`, `R1e2`. chessus! tells you when that's needed and lists the options.
- From-to also works: `e2e4`, `e2-e4`, `e7e8q`.

With the board focused (click it), the arrow keys move a cursor and Enter or Space picks.

## The pane

The top row has four places, plus standings while a tournament runs:

- **board**: the game. The board is on the left. The sidebar shows the mode (CASUAL GAME, TOURNAMENT, or REPLAY), both players and their clocks, `»` next to whoever is to move, and the moves so far. The move list keeps its full height from the first move, so nothing below it shifts as the game goes on. Under it sits STATUS: whose turn it is, and when a game ends, a GAME OVER banner with who won and how. Claude's spend shows under the game keys, with the budget cap in a tournament.
- **new game**: switch between Casual game and Tournament, set up the sides or players, and adjust this game's options (time control, rules, Claude's clock, switching the opponent mid-game, tournament format). They start at your default settings. Starting over a game in progress asks what happens to it: abandon it (it stays under replays to watch, not to continue), keep it to resume later from replays, or cancel.
- **replays**: famous games, online search, and everything you've played or imported. Open a saved game and press `x` to delete it, or delete them all from the bottom of the list. Both ask first.
- **settings**: your defaults for new games: time control, rules, Claude's clock, pace for Claude vs Claude, tournament format and budget cap.

Pickers are arrow buttons, `‹ value ›`. Click them, or Tab to one and press Enter.

## Keys

With the pane focused. If your keys keep going to Claude Code's prompt instead, press ctrl+x then Tab to move focus to the pane; Esc moves it back. The key row under the board only shows what fits the moment.

During a game:

| Key | Does |
| --- | --- |
| `p` | pause or resume |
| `s` | save to resume later (it goes under replays) |
| `c` | copy the game as PGN, to share |
| `d` | offer Claude a draw |
| `m` | claim a draw (threefold repetition or 50-move rule), when you can |
| `x` | resign (asks first) |
| `r` | retry, if Claude couldn't be reached |
| `v` | flip the board |

Replays, and a game that just ended:

| Key | Does |
| --- | --- |
| `a` `b` `f` `e` | start, back, forward, end |
| `r` | resume, for a game you saved mid-play |
| `n` | new game, after a game ends |
| `t` | tournament standings |
| `x` | delete a saved game (asks first) |
| `q` | close the replay |

Anywhere: `1` board, `2` new game, `3` replays, `4` settings, `5` standings while a tournament runs, `0` close (mid-game it offers to pause and save first). Esc hands the keyboard back to the prompt.

## Commands

`/chess help` prints this list in the chat. `/chess` runs at once, even while Claude is mid-reply, so a game never waits on the chat.

### Play

| Command | Does |
| --- | --- |
| `/chess` | Open the pane |
| `/chess <model> [effort]` | New game, you (White) vs Claude: `/chess opus high`. Models: fable, opus, sonnet, haiku. Efforts: low, medium, high, xhigh, max; medium when left out |
| `/chess move <move>` | Play a move: `e4`, `Nf3`, `O-O`, `exd5`, `e8=Q` or `e2e4` |
| `/chess pause` | Freeze both clocks and Claude |
| `/chess resume` | Carry on a paused game |
| `/chess save` | Save the game in progress to resume later; open it under replays and press `r` |
| `/chess resign` | Resign, after a yes/no question in Claude Code's own picker |
| `/chess close` | Close the pane. Mid-game it pauses and saves first |

### Drive the pane from the chat

| Command | Does |
| --- | --- |
| `/chess keys` | List every key, picker and field the pane shows right now |
| `/chess key <key>` | Press one of the pane's keys: `/chess key 2` opens new game. A key that asks first asks in Claude Code's yes/no picker |
| `/chess set <name> <value>` | Change a picker or fill a field: `/chess set tc 5+3` |

### Screens

| Command | Does |
| --- | --- |
| `/chess replays` | Famous games, online search, saved games. `/chess library` does the same |
| `/chess tournament` | Tournament setup, or standings if one is running |
| `/chess settings` | Your defaults for new games |

### Games and files

| Command | Does |
| --- | --- |
| `/chess last` | Replay your last finished game |
| `/chess search <words>` | Find official over-the-board events on Lichess and download their games: `/chess search candidates` |
| `/chess player <username>` | Load a Chess.com player's latest month of games |
| `/chess import <url or file>` | Load PGN from a Lichess game or study link, any PGN URL, or a local `.pgn` file |
| `/chess export <path>` | Write every saved game to one PGN file |
| `/chess help` | This list |

An unfinished casual game survives a restart. It comes back paused, and the time you were away doesn't count.

## Rules

FIDE Laws of Chess, using [chess.js](https://github.com/jhlywa/chess.js) for move generation, plus the parts it doesn't cover:

- Fivefold repetition and the 75-move rule end the game on their own. Threefold repetition and the 50-move rule have to be claimed (`m`).
- Running out of time loses, unless the other side can't possibly mate. Then it's a draw.
- If Claude's reply has no move in it at all, it's asked again, up to three times, without a penalty. That's a formatting slip, not a chess mistake.
- If Claude names a move that isn't legal under FIDE standard rules: in rapid and classical the opponent gets 2 extra minutes and a second one loses; in blitz and bullet the first one loses; untimed, the first one is a warning. The casual preset lets Claude retry 3 times, then plays a random legal move.
- Claude's thinking time counts on its clock by default. Turn that off in settings if you'd rather it didn't.

## Tournaments

2 to 8 players, any mix of you and Claude models. Single or double round-robin (double plays each pairing twice, colours swapped), with colours balanced. Standings score 1, ½ and 0, broken by Sonneborn-Berger, then head-to-head, then wins.

Claude costs money, so tournaments have a budget cap ($5 by default). When Claude's spend reaches it the tournament pauses. Raise the cap in settings and resume. Before you start, you get an estimate based on what each model and effort has cost you so far.

## Replays

chessus! comes with five famous games: Légal's Mate (1750), the Immortal Game (1851), the Evergreen Game (1852), the Opera Game (1858), and Rodolfo Tan Cardoso's win over a 14-year-old Bobby Fischer in New York, 1957. That last one is the only game Fischer lost to a Filipino. Its moves come from chessgames.com, and the tests replay every bundled game to its real ending.

You can also search for games online:

- **Lichess broadcasts** cover official over-the-board events like the Candidates, Olympiads and national championships. Search, pick an event, and its games download.
- **Chess.com** gives you a player's most recent month of games.

One import adds at most 30 games and never the same game twice. Chess960 and games set up from a custom position are skipped, since a replay always starts from the normal opening position.

## Known issues

- **herdr: board clicks don't register.** A click never reaches the board; the likely cause, unconfirmed, is that Claude Code switches to pixel mouse reporting while the board is shown and herdr doesn't pass those reports through. Double-clicks select text instead, and since the pane never takes the keyboard, hotkeys land in Claude's prompt. Run chessus outside herdr, or drive it from the chat: `/chess keys` lists what the pane shows, `/chess key` and `/chess set` work it, and `/chess move e4` plays.

## Develop

```
claude plugin validate .
claude plugin test .
```

For type-checking, load the mod once (`--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`) so Claude Code writes `.claude-plugin/types/` and a `tsconfig.json`, then run `npx -p typescript@5 tsc -p .`.

How it's laid out:

- `hooks/register.tsx`: commands, state, the move loop, the screens. The only file that uses `$`.
- `hooks/game.ts`: rules, clocks, PGN.
- `hooks/claude.ts`: prompts and reading Claude's moves.
- `hooks/tournament.ts`: pairings and standings.
- `hooks/board.tsx`: the board.
- `hooks/classics.ts`: the bundled famous games.

## License

MIT, © walangstudio. That covers the code of chessus! itself.

`hooks/vendor/chess.js` is [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 by Jeff Hlywa, used unmodified under the BSD 2-Clause License. Its copyright notice and license text stay with it, in the file's header and in `hooks/vendor/LICENSE-chess.js`. Game scores (the moves of famous games) are historical facts, not code.
