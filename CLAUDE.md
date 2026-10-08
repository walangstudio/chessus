# CLAUDE.md

Chess as a Claude Code mod (function-hook plugin, Claude Code 2.1.291+).

- `hooks/register.tsx` - the only file that touches `$`: commands, state atoms, move loop, clock ticker, tournament runner, pane screens
- `hooks/game.ts` - pure game reducer: FIDE rules, clocks, penalties, PGN
- `hooks/claude.ts` - pure prompt building and SAN parsing
- `hooks/tournament.ts` - pure round-robin, standings, cost estimate
- `hooks/board.tsx` - `Client` surface module: the board
- `hooks/vendor/chess.js` - vendored chess.js 1.4.0 (BSD-2-Clause); do not edit, replace from npm and keep its license header
- `types/index.d.ts` - `$.state` contract
- `docs/PLAN.md` - design and phases

## The loop

```bash
claude plugin validate .
claude plugin test .
npx -y -p typescript@5 tsc -p .   # needs one --plugin-dir load first to lay .claude-plugin/types
```

## Failure log

- Never pass `$` into a function imported from another file; the validator refuses it. Keep every `$` call in `register.tsx`.
- Never name a contract type after an engine type (`Settings`, `Color` inside `declare module 'claude-code'`); it silently resolves to the engine's. Ours is `Prefs`.
- Answer `$`-call events in tests with `{ value }` (`model.complete`, `session.usage`, `command.register`); a bare result is skipped.
- Read a `Client`'s latest props from the `WeakMap` in key/pointer handlers; the closures are set once on the first render.
- Price Claude's spend from `r.usage` (`priceUsd`), never from `$.session.usage().cost`; from Claude Code 2.1.292 that total does not move with `$.model.complete`.
- Prove a store-full fix with `fillStore(key)` from `tests/kit.ts` and run the test against the old code first; a fake that refuses every write passed the broken fix.
- Gate spending in `complete()` (`heldBy`), the one path every Claude call takes; a per-turn cap check let a turn's retries and draw offers spend past the cap.
