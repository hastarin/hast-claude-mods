import { describe, expect, test } from 'claude-code/testing'

import {
  askText,
  cleanSummary,
  deleteArgv,
  expandHome,
  expiredHandoffs,
  fileName,
  handoffText,
  joinPath,
  keepDays,
  parseArgs,
  seedText,
  withNote,
} from './summary'

// The shape the engine wrote in Claude Code 2.1.318, cut down.
const RAW = [
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.',
  '',
  '<system-reminder>',
  '<tools-used-before-summary>Bash, Write</tools-used-before-summary>',
  '</system-reminder>',
  'Summary:',
  '1. Primary Request and Intent:',
  '   - Remember the codename BLUEBIRD.',
  '',
  '9. Optional Next Step:',
  '   - None.',
  '',
  'If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: C:\\Users\\jon\\.claude\\projects\\x\\f67dee49.jsonl',
  'Continue the conversation from where it left off without asking the user any further questions. Resume directly.',
].join('\n')

describe('cleanSummary', () => {
  test('keeps the summary and drops the wrapper', () => {
    const { summary, transcript } = cleanSummary(RAW)
    expect(summary.startsWith('1. Primary Request and Intent:')).toBe(true)
    expect(summary.endsWith('- None.')).toBe(true)
    expect(summary).not.toContain('system-reminder')
    expect(summary).not.toContain('Resume directly')
    expect(summary).not.toContain('If you need specific details')
    expect(transcript).toBe('C:\\Users\\jon\\.claude\\projects\\x\\f67dee49.jsonl')
  })

  test('a summary with no heading loses only the preamble line', () => {
    const { summary, transcript } = cleanSummary(
      'This session is being continued from a previous conversation that ran out of context.\nDid the thing.\nNext: the other thing.',
    )
    expect(summary).toBe('Did the thing.\nNext: the other thing.')
    expect(transcript).toBeNull()
  })

  test('plain text, such as a fork reply, stays as it is', () => {
    expect(cleanSummary('## Done\n- a\n').summary).toBe('## Done\n- a')
  })

  test('a wrapper with nothing in it comes back empty', () => {
    expect(cleanSummary('Summary:\n\nContinue the conversation from where it left off.').summary).toBe('')
  })
})

describe('parseArgs', () => {
  test('reads the verb and keeps the rest as a note', () => {
    expect(parseArgs('new  focus on the tests')).toEqual({ verb: 'new', note: 'focus on the tests' })
    expect(parseArgs('COMPACT')).toEqual({ verb: 'compact', note: '' })
    expect(parseArgs('copy')).toEqual({ verb: 'copy', note: '' })
  })

  test('anything else asks for help', () => {
    expect(parseArgs('')).toEqual({ verb: 'help', note: '' })
    expect(parseArgs('help')).toEqual({ verb: 'help', note: '' })
    expect(parseArgs('restart it')).toEqual({ verb: 'help', note: 'restart it' })
  })
})

test('a note is added to the instructions', () => {
  expect(withNote('Base.', '')).toBe('Base.')
  expect(withNote('Base.', 'keep the plan')).toBe('Base.\nThe user adds: keep the plan')
})

test('~ is the home folder, written with its own separator', () => {
  expect(expandHome('~/.claude/handoffs', 'C:\\Users\\jon\\')).toBe('C:\\Users\\jon\\.claude\\handoffs')
  expect(expandHome('~\\h/x', '/home/jon')).toBe('/home/jon/h/x')
  expect(expandHome('/abs', '/home/jon')).toBe('/abs')
  expect(expandHome('~/x', undefined)).toBe('~/x')
})

test("a file joins its folder with the folder's separator", () => {
  expect(joinPath('C:\\Users\\jon\\h\\', 'a.md')).toBe('C:\\Users\\jon\\h\\a.md')
  expect(joinPath('/home/jon/h', 'a.md')).toBe('/home/jon/h/a.md')
})

test('file names start with the session and sort by time', () => {
  const name = fileName('abc', new Date(2026, 10, 6, 17, 5, 9).getTime())
  expect(name).toBe('abc-20261106-170509.md')
})

describe('old handoffs', () => {
  const DAY = 86_400_000
  const now = new Date(2026, 10, 6, 12, 0, 0).getTime()

  test('keepFor reads as days, and Never or anything unreadable keeps every file', () => {
    expect(keepDays('30 days')).toBe(30)
    expect(keepDays('1 day')).toBe(1)
    expect(keepDays('Never')).toBeNull()
    expect(keepDays('0 days')).toBeNull()
    expect(keepDays('soon')).toBeNull()
    expect(keepDays(undefined)).toBeNull()
  })

  test('only handoff files older than the limit are picked, by the time in their names', () => {
    const old = fileName('f67dee49-1c2a-4b3d-9e8f-0a1b2c3d4e5f', now - 31 * DAY)
    const recent = fileName('a1b2c3d4-1c2a-4b3d-9e8f-0a1b2c3d4e5f', now - 29 * DAY)
    const names = [old, recent, 'notes.md', 'old-20200101-000000.txt', 'x-2020-01-01.md']
    expect(expiredHandoffs(names, now, 30)).toEqual([old])
  })

  test('the delete runs without a shell, one command per platform', () => {
    expect(deleteArgv(false, ['a.md', 'b.md'])).toEqual(['rm', '-f', '--', 'a.md', 'b.md'])
    expect(deleteArgv(true, ['a.md'])).toEqual(['cmd', '/d', '/c', 'del', '/q', '/f', 'a.md'])
  })
})

test('the saved file says how to get back to the old session', () => {
  const text = handoffText({
    sessionId: 'abc',
    cwd: '/work',
    savedAt: Date.UTC(2026, 10, 6),
    transcript: '/t/abc.jsonl',
    note: 'mind the tests',
    summary: 'Did it.',
  })
  expect(text).toContain('# Handoff from session abc')
  expect(text).toContain('`claude --resume abc`')
  expect(text).toContain('- Its full transcript: /t/abc.jsonl')
  expect(text).toContain('## Note\n\nmind the tests')
  expect(text.trimEnd().endsWith('## Summary\n\nDid it.')).toBe(true)
})

test('the first message and the desktop request name the saved file', () => {
  expect(seedText('BODY', '/h/f.md')).toContain('saved at `/h/f.md`')
  expect(seedText('BODY', '/h/f.md').endsWith('BODY')).toBe(true)
  expect(askText('/h/f.md')).toContain('`/h/f.md`')
})
