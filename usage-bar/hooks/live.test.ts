import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

const NOW = Date.parse('2026-10-10T02:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never
const mountAt = (surface: RenderSurface) => ({ plugin: 'usage-bar', surface, component: 'AbovePrompt', props }) as never

const measurement = {
  context: { tokens: 54_000, window: 1_000_000, percent: 5 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 56, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 25 },
  ],
  cost: { usd: 0.21 },
  changed: ['context', 'rateLimits', 'cost'],
} as never

const STATUS = '# branch.oid 0123456789\n# branch.head main\n? new.ts\n'
const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 0 }

// The plugin's store, which every session of the install shares.
const store = new Map<string, unknown>()

/** The engine's side of everything the mod asks for, with a clock the test moves. */
const world = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  store.clear()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined } as never
  })
  const calls: string[][] = []
  // No origin unless a test gives one, as in a repository that was never pushed.
  const figures = { now: measurement, after: undefined as number | undefined, origin: null as string | null }
  on('session.start', (_$, e) => ({ ...e }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.compact', (_$, e) => ({ messages: e.messages, tokensAfter: figures.after }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.usage', () => ({ value: figures.now }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.cwd', () => ({ value: '/work/mod' }) as never)
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv)
    const done = (exitCode: number, stdout: string, stderr = '') =>
      ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (argv.includes('status')) return done(0, STATUS)
    if (argv.includes('remote')) {
      return figures.origin === null ? done(2, '', "error: No such remote 'origin'\n") : done(0, `${figures.origin}\n`)
    }

    return done(0, '/work/mod\n')
  })
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: 'claude-opus-5-5' } } as never
  })

  return { clock, calls, figures }
}

const started = async ($: Engine) => {
  await $.session.start({ cwd: '/work/mod', surface: 'desktop', isInteractive: true } as never)
  await $.session.measure(measurement)
}

const step = async ($: Engine, agentId?: string) => {
  const input = { turnId: 't', index: 0, model: 'opus', effort: 'high', messageCount: 1, agentId } as never
  const stream = $.turn.step(input)
  for (;;) {
    const { done } = await stream.next()
    if (done === true) return
  }
}

test('the defaults: the terminal has everything, desktop git and cache, VS Code neither', async ($, on) => {
  const { clock, calls } = world(on)
  await started($)
  await step($)

  const desktop = await $.ui.mount(mountAt('desktop'))
  expect(await desktop.find({ text: /^C \(60m\)$/ })).toBeDefined()
  await clock.advance(11_000)
  expect(await desktop.find({ type: 'Text', text: /^mod$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^main$/ })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /\?1/ })).toBeDefined()
  expect(await desktop.find({ text: /Opus/ })).toBeUndefined()
  await desktop.unmount()

  const vscode = await $.ui.mount(mountAt('vscode'))
  expect(await vscode.find({ text: /54k \/ 1M/ })).toBeDefined()
  expect(await vscode.find({ text: /C \(\d+m\)/})).toBeUndefined()
  expect(await vscode.find({ type: 'Text', text: /^main$/ })).toBeUndefined()
  await vscode.unmount()

  const terminal = await $.ui.mount(mountAt('terminal'))
  expect(await terminal.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^ \[high\]$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^C \(60m\)$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^main$/ })).toBeDefined()
  await terminal.unmount()

  expect(calls[0]).toEqual(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'])
})

test('with every bar off, nothing ticks and nothing runs', {
  options: { terminalDisplay: false, vscodeDisplay: false, desktopDisplay: false },
}, async ($, on) => {
  const { clock, calls } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('desktop'))
  await clock.advance(5 * MIN)
  expect(await ui.find({ text: /54k \/ 1M/ })).toBeUndefined()
  expect(calls).toEqual([])
  await ui.unmount()
})

test('the countdown moves on its own, then goes cold', async ($, on) => {
  const { clock } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('desktop'))
  await clock.advance(13 * MIN)
  expect(await ui.find({ type: 'Text', text: /^C \(47m\)$/ })).toBeDefined()
  await clock.advance(47 * MIN)
  expect(await ui.find({ type: 'Text', text: /^C cold$/ })).toBeDefined()
  await ui.unmount()
})

test('git runs in the background about once a minute when idle', async ($, on) => {
  const { clock, calls } = world(on)
  await started($)
  const ui = await $.ui.mount(mountAt('desktop'))

  await clock.advance(5 * MIN)
  const statuses = calls.filter(argv => argv.includes('status')).length
  expect(statuses).toBeGreaterThanOrEqual(4)
  expect(statuses).toBeLessThanOrEqual(6)
  expect(calls.filter(argv => argv.includes('remote')).length).toBe(1)
  expect(calls.filter(argv => argv.includes('rev-parse')).length).toBe(1)
  await ui.unmount()
})

test('the repository is named after its origin, as the desktop app names it', async ($, on) => {
  const { clock, calls, figures } = world(on)
  figures.origin = 'https://github.com/hastarin/hast-claude-mods.git'
  await started($)

  const ui = await $.ui.mount(mountAt('desktop'))
  await clock.advance(11_000)
  expect(await ui.find({ type: 'Text', text: /^hast-claude-mods$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^mod$/ })).toBeUndefined()
  expect(calls).toContainEqual(['git', 'remote', 'get-url', 'origin'])
  expect(calls.filter(argv => argv.includes('rev-parse'))).toEqual([])
  await ui.unmount()
})

// session.measure comes at the end of a turn, or when a quota moves a whole point.
test('each step of a turn moves the figures, without waiting for the turn to end', async ($, on) => {
  const { figures } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  expect(await ui.find({ text: /54k \/ 1M/ })).toBeDefined()

  figures.now = {
    ...(measurement as object),
    context: { tokens: 90_000, window: 1_000_000, percent: 9 },
    cost: { usd: 0.59 },
  } as never
  await step($)
  expect(await ui.find({ text: /90k \/ 1M/ })).toBeDefined()
  expect(await ui.find({ text: /~\$0\.59/ })).toBeDefined()
  await ui.unmount()
})

// cache-keepalive's ping, made by another plugin as the real one does.
const keeper = {
  name: 'keeper',
  register: (on: On) => {
    on('command.run', { command: 'ping' }, async $ => {
      await $.model.fork({ prompt: 'ping' })

      return { text: 'pinged' }
    })
  },
}

test('a keep-alive fork renews the countdown', { plugins: [keeper] }, async ($, on) => {
  const { clock } = world(on)
  on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage } }) as never)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('desktop'))
  await clock.advance(50 * MIN)
  expect(await ui.find({ type: 'Text', text: /^C \(10m\)$/ })).toBeDefined()
  await $.command.run({ command: 'ping' } as never)
  await clock.advance(11_000)
  expect(await ui.find({ type: 'Text', text: /^C \(60m\)$/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent leaves the main countdown alone', async ($, on) => {
  const { clock } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('desktop'))
  await clock.advance(10 * MIN)
  await step($, 'agent-1')
  await clock.advance(11_000)
  expect(await ui.find({ type: 'Text', text: /^C \(50m\)$/ })).toBeDefined()
  await ui.unmount()
})

test('a compaction clears the countdown until the next reply', async ($, on) => {
  world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('desktop'))
  expect(await ui.find({ type: 'Text', text: /^C \(60m\)$/ })).toBeDefined()
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'assistant', text: 'hi', toolUses: [] }] as never })
  expect(await ui.find({ text: /C \(\d+m\)/})).toBeUndefined()
  await step($)
  expect(await ui.find({ type: 'Text', text: /^C \(60m\)$/ })).toBeDefined()
  await ui.unmount()
})

// What another session of the same install leaves in the store.
const shared = (at: number) => ({ q5: 80, q7: 30, r5: NOW + HOUR, r7: NOW + 72 * HOUR, at })

test('each reply leaves its quota reading for other sessions', async ($, on) => {
  world(on)
  await started($)
  await step($)

  expect(store.get('quota')).toEqual({
    q5: 56,
    q7: 25,
    r5: NOW + 2 * HOUR,
    r7: null,
    at: NOW,
  })
})

test('a newer reading from another session shows without a reply', async ($, on) => {
  const { clock } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  store.set('quota',shared(NOW + MIN))
  await clock.advance(11_000)
  expect(await ui.find({ text: /5h 80% \(1h\)/ })).toBeDefined()
  expect(await ui.find({ text: /7d 30% \(3d\)/ })).toBeDefined()
  await ui.unmount()
})

test('an older reading from another session changes nothing', async ($, on) => {
  const { clock } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  store.set('quota',shared(NOW - MIN))
  await clock.advance(11_000)
  expect(await ui.find({ text: /5h 56%/ })).toBeDefined()
  await ui.unmount()
})

test('a measurement of this session does not undo a shared reading, and the next reply does', async ($, on) => {
  const { clock } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  store.set('quota',shared(NOW + MIN))
  await clock.advance(11_000)
  await $.session.measure({ ...(measurement as object), changed: ['cost'] } as never)
  expect(await ui.find({ text: /5h 80%/ })).toBeDefined()

  await step($)
  expect(await ui.find({ text: /5h 56%/ })).toBeDefined()
  await ui.unmount()
})

test('/usage-bar prints the newest reading', async ($, on) => {
  world(on)
  await started($)
  await step($)
  store.set('quota',shared(NOW + MIN))

  const { text } = (await $.command.run({ command: 'usage-bar' } as never)) as { text: string }
  expect(text).toContain('5h 80% (1h)')
})

test('a session with no quota of its own never takes one from the store', async ($, on) => {
  const { clock, figures } = world(on)
  figures.now = { ...(measurement as object), rateLimits: [] } as never
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  store.set('quota',shared(NOW + MIN))
  await clock.advance(11_000)
  expect(await ui.find({ text: /5h/ })).toBeUndefined()
  await ui.unmount()
})

test('a store holding something else is ignored', async ($, on) => {
  const { clock } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  store.set('quota',{ q5: 'lots', at: NOW + MIN })
  await clock.advance(11_000)
  expect(await ui.find({ text: /5h 56%/ })).toBeDefined()
  await ui.unmount()
})

test('a window reads as empty once its reset has passed', async ($, on) => {
  const { clock } = world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  await clock.advance(2 * HOUR + MIN)
  expect(await ui.find({ text: /5h 0%$/ })).toBeDefined()
  expect(await ui.find({ text: /7d 25%/ })).toBeDefined()
  await ui.unmount()
})

const compact = { trigger: 'manual', messages: [{ role: 'assistant', text: 'hi', toolUses: [] }] } as never
// The engine has no context reading from a compaction until the next response.
const unread = { ...(measurement as object), context: { window: 1_000_000 } } as never

test('a compaction shows the size it left, without waiting for the next reply', async ($, on) => {
  const { figures } = world(on)
  await started($)
  await step($)
  figures.after = 30_000
  figures.now = unread

  const ui = await $.ui.mount(mountAt('terminal'))
  await $.session.compact(compact)
  expect(await ui.find({ text: /30k \/ 1M/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3%$/ })).toBeDefined()

  await $.session.measure({ ...(unread as object), changed: ['cost'] } as never)
  expect(await ui.find({ text: /30k \/ 1M/ })).toBeDefined()

  figures.now = { ...(measurement as object), context: { tokens: 40_000, window: 1_000_000, percent: 4 } } as never
  await step($)
  expect(await ui.find({ text: /40k \/ 1M/ })).toBeDefined()
  await ui.unmount()
})

test('a compaction with no recorded size reads as empty', async ($, on) => {
  const { figures } = world(on)
  await started($)
  await step($)
  figures.now = unread

  const ui = await $.ui.mount(mountAt('terminal'))
  await $.session.compact(compact)
  expect(await ui.find({ type: 'Text', text: /^0%$/ })).toBeDefined()
  await ui.unmount()
})

test('a precomputed compaction leaves the figures, as nothing has shrunk yet', async ($, on) => {
  world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  await $.session.compact({ ...(compact as object), trigger: 'precompute' } as never)
  expect(await ui.find({ text: /54k \/ 1M/ })).toBeDefined()
  await ui.unmount()
})

test('/clear empties the context straight away', async ($, on) => {
  world(on)
  await started($)
  await step($)

  const ui = await $.ui.mount(mountAt('terminal'))
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as never)
  expect(await ui.find({ type: 'Text', text: /^0%$/ })).toBeDefined()
  await ui.unmount()
})

test('/usage-bar prints the whole line', async ($, on) => {
  world(on)
  await started($)
  await step($)

  const { text } = (await $.command.run({ command: 'usage-bar' } as never)) as { text: string }
  expect(text).toContain('mod main ?1  |  Opus 5.5 [high]  [')
  expect(text).toContain('C (60m)  ~$0.21')
})
