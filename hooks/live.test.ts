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

/** The engine's side of everything the mod asks for, with a clock the test moves. */
const world = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {})
  const calls: string[][] = []
  const figures = { now: measurement }
  on('session.start', (_$, e) => ({ ...e }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.compact', (_$, e) => ({ messages: e.messages }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.usage', () => ({ value: figures.now }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.cwd', () => ({ value: '/work/mod' }) as never)
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv)
    const stdout = argv.includes('status') ? STATUS : '/work/mod\n'

    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    } as never
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
  expect(calls.filter(argv => argv.includes('rev-parse')).length).toBe(1)
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

test('/usage-bar prints the whole line', async ($, on) => {
  world(on)
  await started($)
  await step($)

  const { text } = (await $.command.run({ command: 'usage-bar' } as never)) as { text: string }
  expect(text).toContain('mod main ?1  |  Opus 5.5 [high]  [')
  expect(text).toContain('C (60m)  ~$0.21')
})
