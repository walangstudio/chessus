import type { Color, Game } from '../types'
import { replay } from './game'

const bare = (san: string) => san.replace(/[+#?!]/g, '').replace(/0/g, 'O').replace(/^([a-h][18])=?([QRBNqrbn])$/, (_, sq: string, p: string) => `${sq}=${p.toUpperCase()}`)

const spellings = (token: string) => {
  const t = bare(token.replace(/^\d+\.+/, '').replace(/\.$/, ''))
  return /^[nbrqk][a-h1-8x]/.test(t) ? [t, t[0]!.toUpperCase() + t.slice(1)] : [t]
}

// Markdown and punctuation around a move are not part of it: **Nf3**, `e4`, "O-O".
const tokens = (reply: string) => reply.split(/[\s,;:()"'`*]+/).filter(Boolean)

// The whole reply as one move first; otherwise the last legal move named, since models reason before answering.
export const pickMove = (reply: string, legal: readonly string[]) => {
  const byBare = new Map(legal.map(m => [bare(m), m]))
  const find = (token: string) => spellings(token).map(s => byBare.get(s)).find(Boolean)
  const whole = find(reply.trim())
  if (whole) return whole
  let last: string | undefined
  for (const token of tokens(reply)) last = find(token) ?? last
  return last
}

export const movePrompt = (g: Game, c: Color, retry: string) => {
  const board = replay(g.history)
  return [
    `You are playing ${c === 'w' ? 'White' : 'Black'} in a chess game under FIDE rules.`,
    `Position (FEN): ${board.fen()}`,
    `Moves so far: ${board.pgn() || '(none)'}`,
    `Legal moves: ${board.moves().join(' ')}`,
    retry,
    'Reply with exactly one move from the legal list, in SAN, and nothing else.',
  ]
    .filter(Boolean)
    .join('\n')
}

export type Ask =
  | { kind: 'move'; san: string }
  | { kind: 'illegal'; text: string }
  | { kind: 'unreadable'; text: string }
  | { kind: 'error'; reason: string }

// A reply names a move when its answer is shaped like one: the whole reply, or its last word, the way the
// prompt asks Claude to end. "a3 is interesting" mentions a square but answers nothing, so it is unreadable,
// a formatting slip asked again for free; "**Ke6**" is an answer, and if it is not legal it is an illegal move.
const MOVE = /^([NBRQK][a-h]?[1-8]?x?[a-h][1-8]|[a-h](x[a-h])?[1-8](=?[QRBN])?|[a-h][1-8][a-h][1-8][qrbn]?|[O0]-[O0](-[O0])?)[+#!?]*\.?$/

export const namesAMove = (reply: string) => {
  const words = tokens(reply)
  const whole = reply.trim().replace(/^[*`"']+|[*`"'.]+$/g, '')
  return MOVE.test(whole) || (words.length > 0 && MOVE.test(words.at(-1)!))
}

export const drawPrompt = (g: Game, c: Color) => {
  const board = replay(g.history)
  return [
    `You are playing ${c === 'w' ? 'White' : 'Black'} in a chess game. Your opponent offers a draw.`,
    `Position (FEN): ${board.fen()}`,
    `Moves so far: ${board.pgn() || '(none)'}`,
    'Reply ACCEPT or DECLINE and nothing else.',
  ].join('\n')
}

export const isAcceptance = (text: string) => /\baccept\b/i.test(text) && !/\bdecline\b/i.test(text)
