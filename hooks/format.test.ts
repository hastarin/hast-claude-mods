import { expect, test } from 'claude-code/testing'

import {
  FIVE_HOURS,
  bar,
  creditUsd,
  plain,
  quotaGauge,
  ramp,
  resetAt,
  timeLeft,
  totalK,
  usedK,
} from './format'

const base = {
  tokens: 54_000,
  window: 1_000_000,
  percent: 5,
  q5: 9,
  q7: 15,
  r5: null,
  r7: null,
  usd: 0.21,
  overageBase: null,
}

const NOW = Date.parse('2026-10-10T02:00:00Z')
const HOUR = 3600_000

test('the line matches the terminal status line', async () => {
  expect(plain(base, NOW)).toBe(`[█${'░'.repeat(19)}] 5%  54k / 1M  5h 9% · 7d 15%  ~$0.21`)
})

test('no quota segment off a subscription', async () => {
  expect(plain({ ...base, q5: null, q7: null }, NOW)).toBe(`[█${'░'.repeat(19)}] 5%  54k / 1M  ~$0.21`)
})

test('credit spend is the cost since overage began', async () => {
  const over = { ...base, q5: 100, usd: 3.5, overageBase: 3 }
  expect(creditUsd(over)).toBe(0.5)
  expect(plain(over, NOW).endsWith('~$3.50 💰$0.50')).toBe(true)
})

test('the ramp steps at 50, 75, 90 and 100', async () => {
  expect([49, 50, 75, 90, 100].map(p => ramp(p).color)).toEqual([
    '#00d75f',
    '#ffd700',
    '#ff8700',
    '#ff0000',
    '#ffaf00',
  ])
  expect(bar(100).off).toBe('')
  expect(bar(0).on).toBe('')
  expect(usedK(54_321)).toBe('54k')
  expect(totalK(200_000)).toBe('200k')
})

test('a window with a reset time shows how long is left', async () => {
  const timed = { ...base, r5: NOW + 2 * HOUR, r7: NOW + 4 * 24 * HOUR }
  expect(plain(timed, NOW)).toBe(`[█${'░'.repeat(19)}] 5%  54k / 1M  5h 9% (2h) · 7d 15% (4d)  ~$0.21`)
  expect(timeLeft(NOW + 45 * 60_000, NOW)).toBe(' (45m)')
  expect(timeLeft(NOW - 1, NOW)).toBe('')
  expect(resetAt('2026-10-10T04:00:00Z')).toBe(NOW + 2 * HOUR)
  expect(resetAt(undefined)).toBe(null)
  expect(resetAt('soon')).toBe(null)
})

test('a quota window is coloured by where it lands at its reset', async () => {
  const gauge = (used: number, hoursLeft: number) => quotaGauge(used, NOW + hoursLeft * HOUR, FIVE_HOURS, NOW)
  // 56% in three hours lands near 93%; the same 56% in one hour lands at 280%.
  expect(gauge(56, 2)).toBe(0)
  expect(gauge(56, 4)).toBe(90)
  expect(gauge(45, 3)).toBe(50)
  expect(gauge(55, 3)).toBe(75)
})

test('pace gives way to the level early, late, and without a reset time', async () => {
  expect(quotaGauge(20, NOW + 4.5 * HOUR, FIVE_HOURS, NOW)).toBe(0)
  expect(quotaGauge(92, NOW + 0.1 * HOUR, FIVE_HOURS, NOW)).toBe(92)
  expect(quotaGauge(60, null, FIVE_HOURS, NOW)).toBe(60)
  expect(quotaGauge(60, NOW - HOUR, FIVE_HOURS, NOW)).toBe(60)
  expect(quotaGauge(60, NOW + 6 * HOUR, FIVE_HOURS, NOW)).toBe(60)
})
