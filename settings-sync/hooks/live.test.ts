import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SHARED = '/home/jon/.agents/claude/settings.json'
const OWN = '/home/jon/.claude/settings.json'
const FILE = { file: '~/.agents/claude/settings.json' }

// The kit hands paths on made absolute for this machine; compare them as written.
const norm = (path: string): string => path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

/** The engine beneath the mod: files on disk, the mod's store, and its toasts. */
const world = (on: On, files: Record<string, string>, store: Record<string, unknown> = {}, env: Record<string, string> = { HOME: '/home/jon' }) => {
  mock.env(on, env)
  mock.store(on, store)
  const writes: string[] = []
  const toasts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in files }) as never)
  on('fs.read', (_$, e) => {
    const text = files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT: no such file, open '${norm(e.path)}'`)

    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    writes.push(norm(e.path))
    files[norm(e.path)] = e.text

    return { value: undefined } as never
  })

  return { files, writes, toasts }
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
const json = (v: unknown) => JSON.stringify(v, null, 2)

test('with no file set, nothing is read or written', async ($, on) => {
  const { writes, toasts } = world(on, { [OWN]: json({ model: 'sonnet' }) })
  await start($)
  expect(writes).toEqual([])
  expect(toasts).toEqual([])
})

test('the shared file is merged into settings.json, with a backup, once', { options: FILE }, async ($, on) => {
  const own = { $schema: 'https://json.schemastore.org/claude-code-settings.json', model: 'sonnet', permissions: { allow: ['Read(//c/x/**)'] } }
  const { files, writes, toasts } = world(on, {
    [SHARED]: json({ model: 'opus', permissions: { allow: ['Bash(gh issue *)'] } }),
    [OWN]: json(own),
  })
  await start($)

  expect(JSON.parse(files[OWN] ?? '')).toEqual({
    $schema: own.$schema,
    model: 'opus',
    permissions: { allow: ['Read(//c/x/**)', 'Bash(gh issue *)'] },
  })
  expect(Object.keys(JSON.parse(files[OWN] ?? ''))[0]).toBe('$schema')
  expect(files[`${OWN}.settings-sync.bak`]).toBe(json(own))
  expect(toasts).toEqual(['settings-sync: updated model, permissions from ~/.agents/claude/settings.json'])

  // A second session finds nothing to do.
  await start($)
  expect(writes).toEqual([`${OWN}.settings-sync.bak`, OWN])
  expect(toasts.length).toBe(1)
})

test('a rule taken out of the shared file is taken out here too', { options: FILE }, async ($, on) => {
  const { files } = world(
    on,
    { [SHARED]: json({ permissions: { allow: ['A'] } }), [OWN]: json({ permissions: { allow: ['A', 'B', 'Mine'] } }) },
    { applied: { permissions: { allow: ['A', 'B'] } } },
  )
  await start($)
  expect(JSON.parse(files[OWN] ?? '')).toEqual({ permissions: { allow: ['A', 'Mine'] } })
})

test('CLAUDE_CONFIG_DIR moves settings.json, and a missing one is created', { options: FILE }, async ($, on) => {
  const { files } = world(on, { [SHARED]: json({ model: 'opus' }) }, {}, { HOME: '/home/jon', CLAUDE_CONFIG_DIR: '/cfg/' })
  await start($)
  expect(JSON.parse(files['/cfg/settings.json'] ?? '')).toEqual({ model: 'opus' })
})

test('a broken settings.json is never written over, and the toast says why', { options: FILE }, async ($, on) => {
  const { writes, toasts } = world(on, { [SHARED]: json({ model: 'opus' }), [OWN]: '{ "model": ' })
  await start($)
  expect(writes).toEqual([])
  expect(toasts[0]).toMatch(/^settings-sync: not applied: settings\.json is not valid JSON/)
})

test('a missing shared file writes nothing, and the toast says why', { options: FILE }, async ($, on) => {
  const { writes, toasts } = world(on, { [OWN]: json({}) })
  await start($)
  expect(writes).toEqual([])
  expect(toasts[0]).toMatch(/^settings-sync: not applied: /)
})

const run = ($: Engine, args: string) =>
  $.command.run({
    command: 'settings-sync',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as never) as Promise<{ text?: string; context?: readonly string[] }>

test('a skipped setting is not written here', { options: { ...FILE, skip: 'env, pluginConfigs.a@m' } }, async ($, on) => {
  const { files } = world(on, {
    [SHARED]: json({ env: { X: '1' }, pluginConfigs: { 'a@m': { o: 1 }, 'b@m': { o: 2 } } }),
    [OWN]: json({}),
  })
  await start($)
  expect(JSON.parse(files[OWN] ?? '')).toEqual({ pluginConfigs: { 'b@m': { o: 2 } } })
})

test('/settings-sync lists what only this machine has, and add copies it into the shared file', { options: { ...FILE, skip: 'voice' } }, async ($, on) => {
  const shared = { $schema: 'x', permissions: { allow: ['A'] } }
  const { files } = world(on, {
    [SHARED]: json(shared),
    [OWN]: json({ voice: { enabled: true }, theme: 'light', permissions: { allow: ['A', 'Mine'] } }),
  })
  await start($)

  const listed = await run($, '')
  expect(listed.text).toContain('1. theme: "light"')
  expect(listed.text).toContain('2. permissions.allow: + "Mine"')
  expect(listed.text).not.toContain('voice')
  expect(listed.context).toEqual([listed.text])

  const added = await run($, 'add 2')
  expect(added.text).toMatch(/^Added permissions\.allow to ~\/\.agents\/claude\/settings\.json\. Commit and push/)
  expect(JSON.parse(files[SHARED] ?? '')).toEqual({ $schema: 'x', permissions: { allow: ['A', 'Mine'] } })

  // The numbers were used up: a new report is needed.
  expect((await run($, 'add 1')).text).toMatch(/^Run \/settings-sync first/)
  expect((await run($, '')).text).toContain('1. theme: "light"')
  expect((await run($, 'add 7')).text).toMatch(/^Give item numbers from 1 to 1, not 7/)
})

test('add refuses when the settings changed since the report, and refuses secrets', { options: FILE }, async ($, on) => {
  const { files } = world(on, { [SHARED]: json({}), [OWN]: json({ env: { GITHUB_TOKEN: 'abc' } }) })
  await start($)
  await run($, '')
  expect((await run($, 'add 1')).text).toMatch(/env\.GITHUB_TOKEN looks like a secret/)
  expect(JSON.parse(files[SHARED] ?? '')).toEqual({})

  await run($, '')
  files[OWN] = json({ env: { GITHUB_TOKEN: 'abc' }, theme: 'dark' })
  expect((await run($, 'add 1')).text).toMatch(/changed since the last report/)
})

test('/settings-sync status says what the last sync did, and now syncs again', { options: FILE }, async ($, on) => {
  const { files, writes } = world(on, { [SHARED]: json({ theme: 'dark' }), [OWN]: json({}) })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($)

  await clock.advance(2 * 3_600_000)
  expect((await run($, 'status')).text).toBe(
    'Last sync, 2 hours ago: updated theme in settings.json from ~/.agents/claude/settings.json; the old file is in settings.json.settings-sync.bak.',
  )

  files[SHARED] = json({ theme: 'light' })
  const now = await run($, 'now')
  expect(now.text).toMatch(/^Synced just now: updated theme in settings\.json/)
  expect(JSON.parse(files[OWN] ?? '')).toEqual({ theme: 'light' })
  expect(writes.filter(w => w === OWN).length).toBe(2)
  expect((await run($, 'now')).text).toBe('Synced just now: settings.json already matched ~/.agents/claude/settings.json, so nothing was written.')
  expect((await run($, 'status')).text).toMatch(/^Last sync, just now: settings\.json already matched/)
})

test('/settings-sync status before any sync has run says so', { options: FILE }, async ($, on) => {
  world(on, {})
  mock.clock(on)
  expect((await run($, 'status')).text).toMatch(/^No sync has run on this machine yet/)
})

test('without the command, the sync still runs', { options: FILE }, async ($, on) => {
  mock.env(on, { HOME: '/home/jon' })
  mock.store(on)
  const files: Record<string, string> = { [SHARED]: json({ theme: 'dark' }) }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in files }) as never)
  on('fs.read', (_$, e) => ({ value: files[norm(e.path)] }) as never)
  on('fs.write', (_$, e) => {
    files[norm(e.path)] = e.text
    return { value: undefined } as never
  })
  await start($)
  expect(JSON.parse(files[OWN] ?? '')).toEqual({ theme: 'dark' })
})
