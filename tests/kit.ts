import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HAIKU = 'claude-haiku-4-5-20251001'

export const PANE = {
  component: 'Pane',
  requestId: 'chessus',
  props: { title: 'Chessus', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Haiku 4.5 bills $1/MTok input: $0.01 a call. Sonnet 5.5: $0.02.
const USAGE = { input_tokens: 10_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const engine = (on: On, reply: (prompt: string) => string | Promise<string>, store: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // mock.store, plus a full store on demand: fillStore(key) caps that key at its current size, as the real 4 MiB limit
  // would; a write past the cap rejects, one back within it lands.
  const held = new Map(Object.entries(store))
  const caps = new Map<string, number>()
  const size = (v: unknown) => JSON.stringify(v ?? null).length
  fillStore = key => void caps.set(key, size(held.get(key)))
  on('store.get', (_$, e) => ({ value: held.get(e.key) }))
  on('store.set', (_$, e) => {
    if (size(e.value) > (caps.get(e.key) ?? Infinity)) throw new Error('store over 4 MiB')
    held.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    held.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...held.keys()] }))
  asked.length = 0
  on('model.complete', async (_$, e) => {
    asked.push(`${e.model}|${e.effort}`)
    return { value: { isAnswered: true, text: await reply(e.prompt), usage: USAGE } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 0 } } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  panes.isOpen = true
  managed.modelPricing = undefined
  // A project's modelPricing is set too: chessus must read the managed (policy) one only.
  on('settings.read', (_$, e) => ({ value: e.source === 'policy' ? { ...managed } : { modelPricing: { multiplier: 0.01 } } }))
  on('ui.panes', () => ({
    value: panes.isOpen ? [{ id: 'chessus', title: 'Chessus', isShown: true, isFocused: false, isPlaced: true, plugin: 'chessus', element: '', component: 'Pane' as const }] : [],
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  toasts.length = 0
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return clock
}

export let fillStore = (_key: string) => {}
// What $.ui.panes answers: the pane open, or (isOpen false) closed.
export const panes = { isOpen: true }
// The managed settings' modelPricing, as $.settings.read({ source: 'policy' }) answers it.
export const managed: { modelPricing?: unknown } = {}
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

// Answers $.ui.ask: picks the option whose label starts with `pick`.
export const answer = (on: On, pick: string) => {
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]!
    const label = q.options?.find(o => o.label.startsWith(pick))?.label ?? pick
    return { result: { questions: e.questions, answers: { [q.question]: label } } }
  })
}
