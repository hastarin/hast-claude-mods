import { expect, test } from 'claude-code/testing'

import { contextLimits } from './config'
import {
  CONTEXT_LIMITS,
  FIVE_HOURS,
  bar,
  contextGauge,
  creditUsd,
  plain,
  quotaGauge,
  ramp,
  resetAt,
  ring,
  settled,
  sharedQuota,
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

test('the plain line reads as the band does', async () => {
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

test('a window past its reset is empty, and takes its overage with it', async () => {
  const past = { ...base, q5: 100, q7: 15, r5: NOW - 1, r7: NOW + HOUR, overageBase: 3 }
  expect(settled(past, NOW)).toEqual({ ...past, q5: 0, r5: null, overageBase: null })
  expect(settled({ ...past, r5: NOW + 1 }, NOW)).toEqual({ ...past, r5: NOW + 1 })
  expect(settled({ ...base, q5: null, q7: 100, r5: NOW - 1, overageBase: 3 }, NOW).q5).toBe(null)
  expect(settled({ ...base, q5: null, q7: 100, r5: NOW - 1, overageBase: 3 }, NOW).overageBase).toBe(3)
})

test('a shared reading is checked before it is trusted', async () => {
  const reading = { q5: 10, q7: null, r5: NOW, r7: null, at: NOW }
  expect(sharedQuota(reading)).toEqual(reading)
  expect(sharedQuota(undefined)).toBe(null)
  expect(sharedQuota('junk')).toBe(null)
  expect(sharedQuota({ ...reading, q5: '10' })).toBe(null)
  expect(sharedQuota({ ...reading, at: undefined })).toBe(null)
})

test('the ring reads to the nearest quarter', async () => {
  expect([0, 12, 13, 37, 38, 62, 63, 87, 88, 100, 150].map(ring).join('')).toBe('○○◔◔◑◑◕◕●●●')
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

test('context turns amber at 100k, orange at 200k and red at 400k, whatever the window', async () => {
  const colour = (tokens: number, percent: number) => ramp(contextGauge(tokens, percent)).color
  expect([99_999, 100_000, 200_000, 400_000].map(t => colour(t, t / 10_000))).toEqual([
    '#00d75f',
    '#ffd700',
    '#ff8700',
    '#ff0000',
  ])
  // A small window still goes by how full it is.
  expect(colour(90_000, 95)).toBe('#ff0000')
  expect(colour(0, 0)).toBe('#00d75f')
})

test('the context limits come from settings in thousands, or the defaults when they make no sense', async () => {
  const set = { contextAmberK: 50, contextOrangeK: '150', contextRedK: 250 }
  expect(contextLimits(set)).toEqual({ amber: 50_000, orange: 150_000, red: 250_000 })
  expect(contextLimits({})).toEqual(CONTEXT_LIMITS)
  expect(contextLimits({ ...set, contextRedK: 100 })).toEqual(CONTEXT_LIMITS)
  expect(contextLimits({ ...set, contextAmberK: 'soon' })).toEqual(CONTEXT_LIMITS)
  expect(contextLimits({ ...set, contextAmberK: 0 })).toEqual(CONTEXT_LIMITS)
  expect(ramp(contextGauge(150_000, 15, contextLimits(set))).color).toBe('#ff8700')
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
