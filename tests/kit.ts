import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HAIKU = 'claude-haiku-4-5-20251001'

export const PANE = {
  component: 'Pane',
  requestId: 'chessus',
  props: { title: 'Chessus', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const USAGE = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const engine = (on: On, reply: (prompt: string) => string | Promise<string>, usdPerCall = 0.01, store: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, store)
  let usd = 0
  asked.length = 0
  on('model.complete', async (_$, e) => {
    asked.push(`${e.model}|${e.effort}`)
    usd += usdPerCall
    return { value: { isAnswered: true, text: await reply(e.prompt), usage: USAGE } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd } } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  toasts.length = 0
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return clock
}

export const toasts: string[] = []
export const asked: string[] = []

export const scripted = (moves: string[]) => () => moves.shift() ?? 'banana'

export const gate = () => {
  let release: (text: string) => void = () => {}
  const wait = () => new Promise<string>(resolve => { release = resolve })
  return { wait, release: (text: string) => release(text) }
}

type Drawing = {
  find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<{ text: string } | undefined>
  press: (t: { key: string }) => Promise<unknown>
}

// Arrow-button pickers: press the value until it reads `label`.
export const choose = async (ui: Drawing, key: string, label: string) => {
  for (let i = 0; i < 16; i++) {
    const shown = await ui.find({ type: 'Button', key: `${key}-value` })
    if (shown?.text.trim() === label) return
    await ui.press({ key: `${key}-next` })
  }
  throw new Error(`${key} never showed "${label}"`)
}

// The tournament form lives under "new game", behind the mode switch.
export const tournamentSetup = async (ui: Drawing) => {
  await ui.press({ key: 'nav-setup' })
  await choose(ui, 'new-mode', 'Tournament')
}
