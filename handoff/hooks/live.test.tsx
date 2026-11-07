import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fileName } from './summary'

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never
const RAW = [
  'This session is being continued from a previous conversation that ran out of context.',
  '<system-reminder>x</system-reminder>',
  'Summary:',
  'The codename is BLUEBIRD.',
  '',
  'If you need specific details from before compaction, read the full transcript at: /t/old.jsonl',
  'Continue the conversation from where it left off without asking the user any further questions.',
].join('\n')

const norm = (path: string): string => path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

type World = {
  clock: { advance: (ms: number) => Promise<void> }
  files: Record<string, string>
  toasts: string[]
  steps: string[]
  submitted: string[]
  filled: string[]
  copied: string[]
  // What each compaction was asked to keep: the hook's `instructions`, or `/compact`'s args.
  asked: (string | undefined)[]
  // Each command run on the host: its arguments and the folder it ran in.
  ran: { argv: string[]; cwd?: string }[]
}

/** The engine beneath the mod: one session that a clear swaps for another. */
const world = (
  on: On,
  o: { tokens?: number; surfaces?: string[]; below?: string; summary?: string; taken?: string[]; files?: Record<string, string>; deleteFails?: string } = {},
): World => {
  mock.env(on, { HOME: '/home/jon' })
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 6, 6, 0, 0) })
  // The engine draws nothing above the prompt of its own.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return o.below === undefined ? <Box /> : <Text>{o.below}</Text>
  })
  const w: World = { clock, files: {}, toasts: [], steps: [], submitted: [], filled: [], copied: [], asked: [], ran: [] }
  let id = 'old'
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    if ((o.taken ?? []).includes(e.name)) throw new Error(`"/${e.name}" refused: it is the user's /${e.name}`)

    return { value: { command: e.name } } as never
  })
  on('session.id', () => ({ value: id }) as never)
  on('session.cwd', () => ({ value: '/work' }) as never)
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: o.tokens ?? 250_000, window: 1_000_000 } } }) as never)
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.invalidate', () => ({ value: undefined }) as never)
  on('fs.write', (_$, e) => {
    w.steps.push('save')
    w.files[norm(e.path)] = e.text
    return { value: undefined } as never
  })
  Object.assign(w.files, o.files)
  on('fs.list', (_$, e) => {
    const dir = `${norm(e.path ?? '').replace(/\/+$/, '')}/`
    const names = Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    if (names.length === 0) throw new Error(`ENOENT: ${dir}`)
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) } as never
  })
  on('process.run', (_$, e) => {
    const { argv, init } = e as unknown as { argv: string[]; init?: { cwd?: string } }
    w.ran.push({ argv: [...argv], cwd: init?.cwd === undefined ? undefined : norm(init.cwd) })
    return { value: { exitCode: o.deleteFails === undefined ? 0 : 1, stdout: '', stderr: o.deleteFails ?? '' } } as never
  })
  on('fs.read', (_$, e) => {
    const text = w.files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT: ${norm(e.path)}`)
    return { value: text } as never
  })
  const compacted = { messages: [{ role: 'user', text: o.summary ?? RAW, toolUses: [] }], tokensBefore: 250_000, tokensAfter: 9_000 }
  on('session.compact', (_$, e) => {
    w.steps.push('compact')
    w.asked.push(e.instructions)
    return compacted as never
  })
  on('command.run', async ($, e) => {
    w.steps.push(`/${e.command}`)
    if (e.command === 'clear') id = 'new'
    // The kit cannot raise the compaction from here, so `/compact` reports it did not run,
    // as it does in a session too short to compact. The live check covers the rest.
    if (e.command === 'compact') w.asked.push(e.args)
    if (e.command === 'compact') return { text: 'Not enough messages to compact.' }
    return { text: '' }
  })
  on('prompt.submit', (_$, e) => {
    w.steps.push('submit')
    w.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('prompt.fill', (_$, e) => {
    w.filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: 0 } as never
  })
  on('ui.copy', (_$, e) => {
    w.copied.push(e.text)
    return { value: { isCopied: true } } as never
  })

  return w
}

// The terminal starts interactive; the desktop app and VS Code start like a `-p` run.
const start = ($: Engine, isInteractive = true) =>
  $.session.start({ cwd: '/work', surface: isInteractive ? 'terminal' : null, isInteractive } as never)

const command = ($: Engine, name: string, args: string) =>
  $.command.run({
    command: name,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as never) as Promise<{ text?: string }>

/** Lets the work a press or a command started run to its end. */
const settle = async (w: World, until: () => boolean) => {
  for (let i = 0; i < 500 && !until(); i++) await w.clock.advance(1)
}

test('the row shows only past the threshold, and not while a turn runs', async ($, on) => {
  world(on, { tokens: 150_000 })
  await start($)
  const low = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await low.findAll({ type: 'Button' })).toHaveLength(0)
  await low.unmount()
})

test('each surface gets its own buttons', async ($, on) => {
  world(on)
  await start($)
  const labels = async (surface: 'terminal' | 'desktop' | 'vscode', p = props) => {
    const ui = await $.ui.mount({ plugin: 'handoff', surface, component: 'AbovePrompt', props: p })
    const found = (await ui.findAll({ type: 'Button' })).map(b => b.text)
    await ui.unmount()
    return found
  }
  expect(await labels('terminal')).toEqual(['Compact', 'New session'])
  expect(await labels('vscode')).toEqual(['Compact', 'New session'])
  expect(await labels('desktop')).toEqual(['Compact', 'New session'])
  expect(await labels('terminal', { ...(props as object), isWorking: true } as never)).toEqual([])
})

test('another mod\'s row above the prompt stays, with this one under it', async ($, on) => {
  world(on, { below: 'usage bar' })
  await start($)
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await ui.find({ type: 'Text', text: /usage bar/ }))?.text).toBe('usage bar')
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await ui.unmount()
})

test('New session compacts, saves, clears, then sends the cleaned summary', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', component: 'AbovePrompt', props })
  await ui.press({ key: 'handoff-new' })
  await settle(w, () => w.submitted.length > 0)
  await ui.unmount()

  expect(w.steps).toEqual(['compact', 'save', '/clear', 'submit'])
  expect(w.asked).toEqual([undefined])
  const [path] = Object.keys(w.files)
  expect(path).toMatch(/^\/home\/jon\/\.claude\/handoffs\/old-\d{8}-\d{6}\.md$/)
  const seed = w.submitted[0] ?? ''
  expect(seed).toContain('The codename is BLUEBIRD.')
  expect(seed).toContain('`claude --resume old`')
  expect(seed).toContain('/t/old.jsonl')
  expect(seed).not.toContain('without asking the user')
  expect(w.toasts.at(-1)).toContain('claude --resume old')
})

test('an empty summary stops before anything is cleared', async ($, on) => {
  const w = world(on, { summary: 'Summary:\n\nContinue the conversation from where it left off.' })
  await start($)
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', component: 'AbovePrompt', props })
  await ui.press({ key: 'handoff-new' })
  await settle(w, () => w.toasts.length > 0)
  await ui.unmount()

  expect(w.steps).toEqual(['compact'])
  expect(w.toasts).toEqual(['handoff: stopped: the summary came back empty'])
})

test('on the desktop app, /compact is used, and a failure says why and changes nothing', async ($, on) => {
  const w = world(on, { surfaces: ['desktop'] })
  await start($, false)
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'handoff-new' })
  await settle(w, () => w.toasts.length > 0)
  await ui.unmount()

  expect(w.steps).toEqual(['/compact'])
  expect(w.asked).toEqual([''])
  expect(w.filled).toEqual([])
  expect(w.toasts).toEqual(['handoff: stopped: Not enough messages to compact.'])
})

test('/handoff new on the desktop app asks Claude instead of clearing', async ($, on) => {
  const w = world(on, { surfaces: ['desktop'] })
  await start($, false)
  const r = await command($, 'handoff', 'new')
  expect(r.text).toBe('handoff: writing the handoff…')
  await settle(w, () => w.toasts.length > 0)

  expect(w.steps).not.toContain('/clear')
})

test('/handoff copy saves the note with the handoff and copies it', async ($, on) => {
  const w = world(on)
  await start($)
  await command($, 'handoff', 'copy keep the plan')
  await settle(w, () => w.copied.length > 0)

  expect(w.steps).toEqual(['compact', 'save'])
  expect(w.asked).toEqual(['keep the plan'])
  expect(w.copied[0]).toContain('The codename is BLUEBIRD.')
  expect(w.copied[0]).toContain('## Note\n\nkeep the plan')
  expect(w.toasts.at(-1)).toContain('copied')
})

test('when /handoff is taken, the mod uses /hast-handoff and leaves /handoff alone', async ($, on) => {
  const w = world(on, { taken: ['handoff'] })
  await start($)
  expect(w.toasts).toEqual(['handoff: /handoff is taken; use /hast-handoff'])

  const theirs = await command($, 'handoff', '')
  expect(theirs.text).toBe('')
  const ours = await command($, 'hast-handoff', '')
  expect(ours.text).toContain('/hast-handoff compact')
  expect(ours.text).toContain('250k tokens')
})

test('New session on the desktop app asks Claude, and never clears', async ($, on) => {
  const w = world(on, { surfaces: ['desktop'] })
  await start($)
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'handoff-new' })
  await settle(w, () => w.filled.length > 0)
  await ui.unmount()

  expect(w.steps).toEqual(['compact', 'save'])
  expect(w.filled[0]).toContain('Start a new session')
})

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 6, 6, 0, 0)
const OLD = fileName('f67dee49-1c2a-4b3d-9e8f-0a1b2c3d4e5f', NOW - 40 * DAY)
const RECENT = fileName('a1b2c3d4-1c2a-4b3d-9e8f-0a1b2c3d4e5f', NOW - 10 * DAY)
const saved = { [`/home/jon/.claude/handoffs/${OLD}`]: 'x', [`/home/jon/.claude/handoffs/${RECENT}`]: 'x', '/home/jon/.claude/handoffs/notes.md': 'x' }

test('a session start deletes handoffs past 30 days, and nothing else', async ($, on) => {
  const w = world(on, { files: saved })
  await start($)
  await settle(w, () => w.ran.length > 0)

  expect(w.ran).toEqual([{ argv: ['rm', '-f', '--', OLD], cwd: '/home/jon/.claude/handoffs' }])
})

test('with keepFor Never, nothing is deleted', { options: { keepFor: 'Never' } }, async ($, on) => {
  const w = world(on, { files: saved })
  await start($)
  await settle(w, () => w.ran.length > 0)

  expect(w.ran).toEqual([])
})

test('many old handoffs are deleted in batches that miss none and repeat none', async ($, on) => {
  const many: Record<string, string> = {}
  const names = Array.from({ length: 101 }, (_, i) => fileName(`s${String(i).padStart(3, '0')}`, NOW - (40 + i) * DAY))
  for (const name of names) many[`/home/jon/.claude/handoffs/${name}`] = 'x'
  const w = world(on, { files: { ...many, [`/home/jon/.claude/handoffs/${RECENT}`]: 'x' } })
  await start($)
  await settle(w, () => w.ran.length >= 3)

  expect(w.ran.map(r => r.argv.length - 3)).toEqual([50, 50, 1])
  expect(w.ran.flatMap(r => r.argv.slice(3)).sort()).toEqual([...names].sort())
})

test('a delete that fails says so, and leaves the session running', async ($, on) => {
  const w = world(on, { files: saved, deleteFails: 'Access is denied.' })
  await start($)
  await settle(w, () => w.toasts.length > 0)

  expect(w.ran).toHaveLength(1)
  expect(w.toasts).toEqual(['handoff: could not delete old summaries: Access is denied.'])
})
