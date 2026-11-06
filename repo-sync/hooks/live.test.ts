import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const OLD = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NEW = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/** The engine beneath the mod: a git whose pull moves HEAD and touches AGENTS.md. */
const world = (on: On, home: Record<string, string> = { HOME: '/home/jon' }) => {
  mock.env(on, home)
  const calls: { argv: string[]; env?: Record<string, string> }[] = []
  const toasts: string[] = []
  let pulled = false
  // Where the session draws: the terminal at once; the desktop app only once it attaches.
  const surfaces: string[] = []
  on('session.start', (_$, e) => {
    if (e.surface !== null) surfaces.push(e.surface)
    return { cwd: e.cwd }
  })
  on('session.attach', (_$, e) => {
    surfaces.push(e.surface)
    return { clientId: e.clientId }
  })
  on('session.surfaces', () => ({ value: [...surfaces] }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }) as never)
  on('process.run', (_$, e) => {
    const { argv, init } = e as { argv: string[]; init?: { env?: Record<string, string> } }
    calls.push({ argv: [...argv], env: init?.env })
    const sub = argv[3]
    let stdout = ''
    if (sub === 'rev-parse') stdout = `${pulled ? NEW : OLD}\n`
    if (sub === 'pull') pulled = true
    if (sub === 'rev-list') stdout = '0\n'
    if (sub === 'diff') stdout = 'AGENTS.md\n'

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })

  return { calls, toasts }
}

const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
// How the desktop app, VS Code and a `-p` run start a session.
const startDesktop = ($: Engine) => $.session.start({ cwd: '/work', surface: null, isInteractive: false } as never)

test('with no repos set, nothing runs and the prompt is untouched', async ($, on) => {
  const { calls, toasts } = world(on)
  await start($)
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections.map(s => s.id)).toEqual(['intro'])
  expect(calls).toEqual([])
  expect(toasts).toEqual([])
})

test('a configured repo is pulled with ~ expanded, toasted, and noted for Claude', {
  options: { repos: '~/.agents', timeoutSeconds: 5 },
}, async ($, on) => {
  const { calls, toasts } = world(on)
  await start($)
  const { sections } = await $.prompt.compose(COMPOSE)

  expect(calls[0]?.argv).toEqual(['git', '-C', '/home/jon/.agents', 'rev-parse', 'HEAD'])
  expect(calls[1]?.argv).toEqual(['git', '-C', '/home/jon/.agents', 'pull', '--ff-only', '--quiet'])
  expect(calls[1]?.env).toEqual({ GIT_TERMINAL_PROMPT: '0' })
  expect(toasts).toEqual(['repo-sync: ~/.agents updated 1111111..2222222'])

  const note = sections.find(s => s.id === 'repo-sync:note')
  expect(note?.scope).toBe('session')
  expect(note?.text).toMatch(/~\/\.agents\/AGENTS\.md changed .* re-read it/)
  expect(sections[0]?.id).toBe('intro')
})

test('Windows: USERPROFILE stands in when HOME is unset', { options: { repos: '~/.agents' } }, async ($, on) => {
  const { calls } = world(on, { USERPROFILE: 'C:\\Users\\hasta' })
  await start($)
  await $.prompt.compose(COMPOSE)
  expect(calls[0]?.argv[2]).toBe('C:\\Users\\hasta/.agents')
})

test('the desktop app gets the toast once it attaches, and the note', { options: { repos: '~/.agents' } }, async ($, on) => {
  const { toasts } = world(on)
  await startDesktop($)
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections.some(s => s.id === 'repo-sync:note')).toBe(true)
  // Sent before the app attached, the toast would have had nowhere to show.
  expect(toasts).toEqual([])
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(toasts).toEqual(['repo-sync: ~/.agents updated 1111111..2222222'])
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:second' })
  expect(toasts.length).toBe(1)
})

test('a -p run, where nothing attaches, still notes for Claude but shows no toast', { options: { repos: '~/.agents' } }, async ($, on) => {
  const { toasts } = world(on)
  await startDesktop($)
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(toasts).toEqual([])
  expect(sections.some(s => s.id === 'repo-sync:note')).toBe(true)
})

const command = ($: Engine, args: string) =>
  $.command.run({
    command: 'repo-sync',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as never) as Promise<{ text?: string; context?: readonly string[] }>

test('/repo-sync says what the last sync did, and /repo-sync now pulls again', {
  options: { repos: '~/.agents' },
}, async ($, on) => {
  const { calls } = world(on)
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } } as never
  })
  await start($)
  await $.prompt.compose(COMPOSE)
  expect(registered).toEqual(['repo-sync'])

  await clock.advance(5 * 60_000)
  const status = await command($, '')
  expect(status.text).toBe('Last sync, 5 minutes ago:\n  ~/.agents: updated 1111111..2222222, changing AGENTS.md')

  const pulls = calls.filter(c => c.argv[3] === 'pull').length
  const now = await command($, 'now')
  expect(calls.filter(c => c.argv[3] === 'pull').length).toBe(pulls + 1)
  expect(now.text).toBe('Synced just now:\n  ~/.agents: already up to date')
  expect(now.context).toEqual([now.text])
  expect((await command($, '')).text).toMatch(/^Last sync, just now:/)
  expect((await command($, 'later')).text).toMatch(/^Usage: /)
})

test('/repo-sync before any sync has run says so', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  expect((await command($, '')).text).toMatch(/^No sync has run on this machine yet/)
})

test('a /repo-sync now that changes AGENTS.md tells Claude straight away', { options: { repos: '~/.agents' } }, async ($, on) => {
  world(on)
  mock.store(on)
  mock.clock(on)
  const now = await command($, 'now')
  expect(now.text).toBe('Synced just now:\n  ~/.agents: updated 1111111..2222222, changing AGENTS.md')
  expect(now.context?.[1]).toMatch(/AGENTS\.md changed .* re-read it/)
})
