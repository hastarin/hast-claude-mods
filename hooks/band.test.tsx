import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-10T02:00:00Z')
const HOUR = 3600_000

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never

const measurement = {
  context: { tokens: 54_000, window: 1_000_000, percent: 5 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 56, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 25 },
  ],
  cost: { usd: 0.21 },
  changed: ['context', 'rateLimits', 'cost'],
} as never

test('the band draws the bar on the desktop and in VS Code', async ($, on) => {
  mock.clock(on, { now: NOW })
  // The engine's side of a measurement and of the status line.
  const pinned: (string | undefined)[] = []
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  on('ui.status', (_$, e) => {
    pinned.push((e as { text?: string }).text)

    return { value: undefined } as never
  })
  await $.session.measure(measurement)

  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-bar', surface, component: 'AbovePrompt', props })
    // 56% with two of five hours left lands near 93%: on pace, so green.
    const five = await ui.find({ type: 'Text', text: /^5h 56% \(2h\)$/ })
    expect(five?.props.color).toBe('#00d75f')
    expect(await ui.find({ type: 'Text', text: /^7d 25%$/ })).toBeDefined()
    expect(await ui.find({ text: /54k \/ 1M/ })).toBeDefined()
    await ui.unmount()
    // The band is the only copy: no second, plain one under the prompt.
    expect(pinned).toEqual([])
  }
})

test('the band dims and colours what the status line script does', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  await $.session.measure(measurement)

  const ui = await $.ui.mount({ plugin: 'usage-bar', surface: 'terminal', component: 'AbovePrompt', props })
  for (const dim of [/^\[$/, /^░+\]$/, /^\/ 1M$/, /^·$/, /^~\$0\.21$/]) {
    expect((await ui.find({ type: 'Text', text: dim }))?.props.dimColor).toBe(true)
  }
  expect((await ui.find({ type: 'Text', text: /^54k$/ }))?.props.color).toBe('#00d75f')
  await ui.unmount()
})

test('the bar gives up cells before the line wraps, and is drawn in monospace', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  await $.session.measure(measurement)

  const mountAt = (bodyColumns: number) =>
    $.ui.mount({ plugin: 'usage-bar', surface: 'vscode', component: 'AbovePrompt', props: { ...(props as object), bodyColumns } as never })

  // The line is 65 cells with the whole bar: 19 empty and 1 filled at 5%.
  const wide = await mountAt(100)
  expect((await wide.find({ type: 'Text', text: /^░{19}\]$/ }))?.props.mono).toBe(true)
  await wide.unmount()

  const close = await mountAt(60)
  expect(await close.find({ type: 'Text', text: /^░{14}\]$/})).toBeDefined()
  await close.unmount()

  const narrow = await mountAt(30)
  expect(await narrow.find({ type: 'Text', text: /^░{8}\]$/ })).toBeDefined()
  await narrow.unmount()
})

test('the band keeps what other plugins draw beneath it', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>from another plugin</Text>
  })
  await $.session.measure(measurement)

  const ui = await $.ui.mount({ plugin: 'usage-bar', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await ui.find({ text: /from another plugin/ })).toBeDefined()
  expect(await ui.find({ text: /54k \/ 1M/ })).toBeDefined()
  await ui.unmount()
})

test('with its bar off, the terminal gets neither the band nor a pinned line', {
  options: { terminalDisplay: false },
}, async ($, on) => {
  mock.clock(on, { now: NOW })
  const pinned: (string | undefined)[] = []
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // The engine's own band, empty: what is drawn when the mod passes.
  on('ui.render', () => ({ type: 'Box', props: {} }) as never)
  on('ui.status', (_$, e) => {
    pinned.push((e as { text?: string }).text)

    return { value: undefined } as never
  })
  await $.session.measure(measurement)

  const ui = await $.ui.mount({ plugin: 'usage-bar', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await ui.find({ text: /54k \/ 1M/ })).toBeUndefined()
  await ui.unmount()
  expect(pinned).toEqual([])
})
