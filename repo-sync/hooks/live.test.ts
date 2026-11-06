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
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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

const start = ($: Engine, isInteractive = true) =>
  $.session.start({ cwd: '/work', surface: 'terminal', isInteractive } as never)

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

test('a headless run still notes for Claude but shows no toast', { options: { repos: '~/.agents' } }, async ($, on) => {
  const { toasts } = world(on)
  await start($, false)
  const { sections } = await $.prompt.compose(COMPOSE)
  expect(toasts).toEqual([])
  expect(sections.some(s => s.id === 'repo-sync:note')).toBe(true)
})
