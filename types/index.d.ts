export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Color = 'w' | 'b'
export type Side = { kind: 'human' } | { kind: 'claude'; model: string; effort: Effort }
export type RulesPreset = 'standard' | 'casual'
export type TimeControl = { id: string; label: string; baseMs: number; incMs: number }
export type Result = '1-0' | '0-1' | '1/2-1/2' | '*'

export type Game = {
  id: number
  white: Side
  black: Side
  tc: TimeControl
  rules: RulesPreset
  isClaudeClocked: boolean
  history: string[]
  clock: { w: number; b: number }
  turnStartedAt: number
  illegal: { w: number; b: number }
  result: Result
  termination: string
  note: string
  thinking: string
  isPaused: boolean
  isHalted: boolean
  nextMoveAt: number
  spentUsd: number
  canSwitchOpponent?: boolean
  round: string
  event: string
}

export type Pairing = { round: number; white: number; black: number; result: Result | null }

export type Tournament = {
  id: number
  entrants: Side[]
  isDouble: boolean
  tc: TimeControl
  rules: RulesPreset
  isClaudeClocked: boolean
  budgetUsd: number
  spentUsd: number
  pairings: Pairing[]
  current: number | null
  status: 'setup' | 'running' | 'paused' | 'done'
  note: string
}

export type Screen = 'setup' | 'game' | 'tournament' | 'library' | 'settings'

export type Prefs = {
  tcId: string
  rules: RulesPreset
  isClaudeClocked: boolean
  isDouble: boolean
  budgetUsd: number
  spectateMs: number
  canSwitchOpponent: boolean
}

// What a game saved mid-play needs to carry on: who plays each side and under which rules.
export type Resume = { white: Side; black: Side; tcId: string; rules: RulesPreset; isClaudeClocked: boolean; gameId?: number }

export type Review = { history: string[]; white: string; black: string; result: Result; termination: string; resume?: Resume; pgn?: string; savedAt?: string }

export type View = {
  screen: Screen
  ply: number | null
  isFlipped: boolean
  draft: { white: Side; black: Side }
  entrants: Side[]
  pick: { model: string; effort: Effort }
  review: Review | null
  confirm?: 'resign' | 'close' | 'replace' | 'resume' | 'delete' | 'clear' | null
  newMode?: 'casual' | 'tournament'
  found?: { id: string; name: string }[]
  searchNote?: string
  // This game's or tournament's options; whatever is not set here comes from the default settings.
  opts?: Partial<Prefs>
}

export type SavedGame = {
  pgn: string; white: string; black: string; result: Result; termination: string; at: string
  tournament?: number; pairing?: number; resume?: Resume
}

export type CostStat = { usd: number; moves: number }

export type BoardProps = {
  fen: string
  legal: string[]
  last: string
  isLocked: boolean
  orientation: Color
  cell: { w: number; h: number }
}

declare module 'claude-code' {
  interface PluginState {
    chessus: { game: Game | null; tournament: Tournament | null; view: View; settings: Prefs; now: number }
  }
}
