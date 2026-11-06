import { expect, test } from 'claude-code/testing'

import { type Run, expandHome, noteText, parseList, syncRepo, timeoutMs, toastText, watched } from './sync'

const OLD = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NEW = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/** A git that answers each subcommand from a table; HEAD moves after a pull. */
const fakeGit = (answers: {
  pull?: { exitCode: number; stderr?: string }
  moves?: boolean
  ahead?: string
  diff?: string
  head?: number
}): { run: Run; calls: string[][] } => {
  const calls: string[][] = []
  let pulled = false
  const run: Run = async argv => {
    calls.push([...argv])
    const sub = argv[3]
    if (sub === 'rev-parse') {
      if (answers.head !== undefined) return { exitCode: answers.head, stdout: '', stderr: 'fatal: not a git repository' }
      return { exitCode: 0, stdout: `${pulled && answers.moves === true ? NEW : OLD}\n`, stderr: '' }
    }
    if (sub === 'pull') {
      pulled = true
      return { exitCode: answers.pull?.exitCode ?? 0, stdout: '', stderr: answers.pull?.stderr ?? '' }
    }
    if (sub === 'rev-list') {
      return answers.ahead === undefined
        ? { exitCode: 128, stdout: '', stderr: 'fatal: no upstream configured' }
        : { exitCode: 0, stdout: `${answers.ahead}\n`, stderr: '' }
    }
    if (sub === 'diff') return { exitCode: 0, stdout: answers.diff ?? '', stderr: '' }

    return { exitCode: 1, stdout: '', stderr: `unexpected ${argv.join(' ')}` }
  }

  return { run, calls }
}

const WATCH = ['AGENTS.md', 'CLAUDE.md']

test('options: lists split on commas and newlines, the timeout falls back', () => {
  expect(parseList(' ~/.agents, ~/dotfiles\n,, /srv/x ')).toEqual(['~/.agents', '~/dotfiles', '/srv/x'])
  expect(parseList(undefined)).toEqual([])
  expect(timeoutMs(5)).toBe(5000)
  expect(timeoutMs(0)).toBe(20_000)
  expect(timeoutMs('soon')).toBe(20_000)
})

test('~ expands to the home folder on both kinds of path', () => {
  expect(expandHome('~/.agents', '/home/jon')).toBe('/home/jon/.agents')
  expect(expandHome('~\\.agents', 'C:\\Users\\hasta\\')).toBe('C:\\Users\\hasta/.agents')
  expect(expandHome('~', '/home/jon')).toBe('/home/jon')
  expect(expandHome('/srv/repo', '/home/jon')).toBe('/srv/repo')
  expect(expandHome('~/.agents', undefined)).toBe('~/.agents')
})

test('a watched name matches in any folder, and only by its whole name', () => {
  expect(watched('AGENTS.md', WATCH)).toBe(true)
  expect(watched('sub/CLAUDE.md', WATCH)).toBe(true)
  expect(watched('docs/MY-AGENTS.md', WATCH)).toBe(false)
})

test('already current: nothing to say', async () => {
  const { run, calls } = fakeGit({ ahead: '0' })
  const o = await syncRepo(run, '/home/jon/.agents', '~/.agents', WATCH)
  expect(o).toEqual({ kind: 'current', repo: '~/.agents', ahead: 0 })
  expect(toastText(o)).toBe(null)
  expect(noteText([o])).toBe(null)
  expect(calls[1]).toEqual(['git', '-C', '/home/jon/.agents', 'pull', '--ff-only', '--quiet'])
})

test('a pull that changes AGENTS.md tells Claude to re-read it', async () => {
  const { run } = fakeGit({ moves: true, ahead: '0', diff: 'AGENTS.md\nknowledge/log.md\n' })
  const o = await syncRepo(run, '/home/jon/.agents', '~/.agents', WATCH)
  expect(o).toEqual({ kind: 'updated', repo: '~/.agents', from: '1111111', to: '2222222', changed: ['AGENTS.md'], ahead: 0 })
  expect(toastText(o)).toBe('~/.agents updated 1111111..2222222')
  expect(noteText([o])).toMatch(/~\/\.agents\/AGENTS\.md changed .* re-read it/)
})

test('a pull that changes nothing watched shows a toast but tells Claude nothing', async () => {
  const { run } = fakeGit({ moves: true, ahead: '0', diff: 'knowledge/log.md\n' })
  const o = await syncRepo(run, '/r', '~/r', WATCH)
  expect(toastText(o)).toBe('~/r updated 1111111..2222222')
  expect(noteText([o])).toBe(null)
})

test('unpushed commits are pointed out to both', async () => {
  const { run } = fakeGit({ ahead: '2' })
  const o = await syncRepo(run, '/r', '~/r', WATCH)
  expect(toastText(o)).toBe('~/r has 2 unpushed commits')
  expect(noteText([o])).toMatch(/2 local commits not pushed yet/)
})

test('no upstream counts as nothing unpushed', async () => {
  const { run } = fakeGit({})
  expect(await syncRepo(run, '/r', '~/r', WATCH)).toEqual({ kind: 'current', repo: '~/r', ahead: 0 })
})

test('a diverged or offline pull is reported, never forced', async () => {
  const { run, calls } = fakeGit({ pull: { exitCode: 128, stderr: 'fatal: Not possible to fast-forward, aborting.\n' } })
  const o = await syncRepo(run, '/r', '~/r', WATCH)
  expect(o).toEqual({ kind: 'failed', repo: '~/r', reason: 'Not possible to fast-forward, aborting.' })
  expect(toastText(o)).toBe('~/r not synced: Not possible to fast-forward, aborting.')
  expect(noteText([o])).toMatch(/could not be pulled .* out of date/)
  expect(calls.some(c => c.includes('--force') || c.includes('reset'))).toBe(false)
})

test('another session holding the lock is not an error', async () => {
  const { run } = fakeGit({ pull: { exitCode: 128, stderr: "fatal: Unable to create '/r/.git/index.lock': File exists." } })
  const o = await syncRepo(run, '/r', '~/r', WATCH)
  expect(o).toEqual({ kind: 'busy', repo: '~/r' })
  expect(toastText(o)).toBe(null)
  expect(noteText([o])).toBe(null)
})

test('a folder that is not a repo, or git that will not start, is a failure', async () => {
  const { run } = fakeGit({ head: 128 })
  expect(await syncRepo(run, '/nope', '/nope', WATCH)).toEqual({ kind: 'failed', repo: '/nope', reason: 'not a git repository' })

  const broken: Run = async () => {
    throw new Error('timed out after 20000 ms')
  }
  expect(await syncRepo(broken, '/r', '~/r', WATCH)).toEqual({ kind: 'failed', repo: '~/r', reason: 'timed out after 20000 ms' })
})
