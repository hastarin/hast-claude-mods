import { expect, test } from 'claude-code/testing'

import { cacheLabel, expectedTtl, observedTtl, served } from './cache'
import { features } from './config'
import { modelName, modelTone, plain } from './format'
import { parseStatus, repoName } from './git'

const MIN = 60_000
const NOW = Date.parse('2026-10-10T02:00:00Z')
const inputs = { force5m: false, enable1h: false }
const quota = { q5: 10, q7: 10 }
const usage = (read: number, written: number, input = 100) => ({
  input_tokens: input,
  output_tokens: 10,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: written,
})
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

test('a segment needs the bar on as well as its own field', async () => {
  const options = { terminalDisplay: false, terminalGit: true, desktopDisplay: true, desktopGit: true }
  expect(features(options, 'terminal').git).toBe(false)
  expect(features(options, 'desktop')).toEqual({ display: true, git: true, cache: false, model: false })
  expect(features(options, 'mobile').git).toBe(true)
})

test('the lifetime follows the engine, in its order', async () => {
  expect(expectedTtl(inputs, quota)).toBe('1h')
  expect(expectedTtl(inputs, { q5: null, q7: null })).toBe('5m')
  expect(expectedTtl(inputs, null)).toBe('5m')
  expect(expectedTtl(inputs, { q5: 100, q7: 10 })).toBe('5m')
  expect(expectedTtl({ ...inputs, enable1h: true }, null)).toBe('1h')
  expect(expectedTtl({ ...inputs, settingTtl: '1h' }, null)).toBe('1h')
  expect(expectedTtl({ ...inputs, envTtl: '5m', settingTtl: '1h' }, quota)).toBe('5m')
  expect(expectedTtl({ ...inputs, force5m: true, envTtl: '1h' }, quota)).toBe('5m')
})

test('usage proves the lifetime only where the two lifetimes differ', async () => {
  expect(observedTtl(10 * MIN, usage(0, 90_000))).toBe('5m')
  expect(observedTtl(10 * MIN, usage(90_000, 100))).toBe('1h')
  // Too soon to tell, too small to trust, or expired under either lifetime.
  expect(observedTtl(4 * MIN, usage(0, 90_000))).toBe(null)
  expect(observedTtl(10 * MIN, usage(0, 9_000))).toBe(null)
  expect(observedTtl(70 * MIN, usage(0, 90_000))).toBe(null)
})

test('a lesson stands until disproved, and a model change proves nothing', async () => {
  const first = served(null, NOW, 'opus', usage(0, 90_000))
  expect(first.learned).toBe(null)

  const lapsed = served(first, NOW + 10 * MIN, 'opus', usage(0, 90_000))
  expect(lapsed.learned).toBe('5m')
  expect(served(lapsed, NOW + 11 * MIN, 'opus', usage(90_000, 0)).learned).toBe('5m')
  expect(served(lapsed, NOW + 20 * MIN, 'opus', usage(90_000, 0)).learned).toBe('1h')

  expect(served(first, NOW + 10 * MIN, 'sonnet', usage(0, 90_000)).learned).toBe(null)
  expect(served({ ...first, at: null }, NOW + 10 * MIN, 'opus', usage(0, 90_000)).learned).toBe(null)
})

test('the countdown reads whole minutes, then cold', async () => {
  const clock = { at: NOW, model: 'opus', learned: null }
  const at = (ms: number) => cacheLabel(clock, inputs, base, NOW + ms)
  expect(at(0)?.text).toBe('C (60m)')
  expect(at(0)?.gone).toBe(0)
  expect(at(13 * MIN)?.text).toBe('C (47m)')
  expect(at(59.9 * MIN)?.text).toBe('C (1m)')
  expect(at(60 * MIN)).toEqual({ text: 'C cold', gone: null })
  expect(cacheLabel({ ...clock, learned: '5m' }, inputs, base, NOW + 2 * MIN)?.text).toBe('C (3m)')
  expect(cacheLabel({ ...clock, at: null }, inputs, base, NOW)).toBe(null)
  expect(cacheLabel(null, inputs, base, NOW)).toBe(null)
})

test('git status reads as the status line script shows it', async () => {
  const status = [
    '# branch.oid 0123456789abcdef',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a b hooks/a.ts',
    '1 .M N... 100644 100644 100644 a b hooks/b.ts',
    '2 RM N... 100644 100644 100644 a b R100 c.ts\td.ts',
    'u UU N... 100644 100644 100644 100644 a b c e.ts',
    '? f.ts',
    '',
  ].join('\r\n')
  expect(parseStatus(status, 'mod')).toEqual({ repo: 'mod', branch: 'main', flags: '+2 ●2 ?1 ✖1 ↑2 ↓1' })
  expect(parseStatus('# branch.oid 0123456789abcdef\n# branch.head (detached)\n', 'mod')).toEqual({
    repo: 'mod',
    branch: '0123456',
    flags: '',
  })
  expect(repoName('C:/Users/hasta/source/usage-bar-mod\n')).toBe('usage-bar-mod')
})

test('a model reads by its family and version, coloured by tier', async () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(modelName('claude-sonnet-4-20250514')).toBe('Sonnet 4')
  expect(modelName('haiku')).toBe('Haiku')
  expect(modelName('some-other-model')).toBe('some-other-model')
  expect(modelTone('claude-opus-5-5').color).toBe('#ff8700')
  expect(modelTone('claude-fable-5-1').bold).toBe(true)
  expect(modelTone('some-other-model').color).toBeUndefined()
})

test('the plain line carries the extras in the status line order', async () => {
  const line = plain(base, NOW, {
    git: { repo: 'mod', branch: 'main', flags: '?1' },
    model: 'Opus 5.5',
    effort: 'high',
    cache: 'C (50m)',
  })
  expect(line).toBe(`mod main ?1  |  Opus 5.5 [high]  [█${'░'.repeat(19)}] 5%  54k / 1M  5h 9% · 7d 15%  C (50m)  ~$0.21`)
})
