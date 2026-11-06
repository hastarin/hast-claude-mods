import { expect, test } from 'claude-code/testing'

import { ago, asLast, outcomeText, statusText } from './status'

test('ago reads in words', () => {
  expect(ago(0, 59_000)).toBe('just now')
  expect(ago(0, 120_000)).toBe('2 minutes ago')
  expect(ago(0, 3_600_000)).toBe('1 hour ago')
  expect(ago(0, 86_400_000)).toBe('1 day ago')
})

test('each outcome reads as a sentence', () => {
  expect(outcomeText({ kind: 'failed', reason: 'offline' }, 'f')).toBe('not applied: offline')
  expect(statusText({ at: 0, outcome: { kind: 'current' } }, 0, 'f')).toBe('Last sync, just now: settings.json already matched f, so nothing was written.')
})

test('a stored value that is not a sync is ignored', () => {
  expect(asLast(undefined)).toBe(undefined)
  expect(asLast({ at: 1 })).toBe(undefined)
  expect(asLast({ at: 1, outcome: { kind: 'current' } })).toEqual({ at: 1, outcome: { kind: 'current' } })
})
