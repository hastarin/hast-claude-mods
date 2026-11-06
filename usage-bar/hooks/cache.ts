// Adapted from cache-timer (Mehmet Aras) and cache-keeper (Nate Herk), both MIT.
// See THIRD-PARTY-NOTICES.md for their copyright and permission notices.

import type { ModelUsage } from 'claude-code'

import type { CacheClock, Snapshot, Ttl } from '../types'
import { isOverage } from './format'

const MINUTE = 60_000

export const TTL_MS: Record<Ttl, number> = { '5m': 5 * MINUTE, '1h': 60 * MINUTE }

export type TtlInputs = {
  force5m: boolean
  envTtl?: string
  settingTtl?: unknown
  enable1h: boolean
}

const isTtl = (v: unknown): v is Ttl => v === '5m' || v === '1h'

export const isOn = (v: string | undefined): boolean =>
  ['1', 'true', 'yes', 'on'].includes((v ?? '').toLowerCase())

/**
 * The lifetime the engine picks, in its own order: the API does not tell a mod.
 * "Over a limit" stands in for the engine's overage flag, which no mod can read.
 */
export const expectedTtl = (i: TtlInputs, s: Pick<Snapshot, 'q5' | 'q7'> | null): Ttl => {
  if (i.force5m) return '5m'
  if (isTtl(i.envTtl)) return i.envTtl
  if (isTtl(i.settingTtl)) return i.settingTtl
  if (i.enable1h) return '1h'
  const subscribed = s !== null && (s.q5 !== null || s.q7 !== null)

  return subscribed && !isOverage(s) ? '1h' : '5m'
}

// Below this the shares are too noisy, and a gap under 5.5 minutes fits either lifetime.
const MIN_TOKENS = 30_000
const MIN_GAP = 5.5 * MINUTE

/**
 * What a request's usage proves about the lifetime. A rewrite too soon for an
 * hour means five minutes; a hit too late for five minutes means an hour.
 */
export const observedTtl = (gap: number, u: ModelUsage): Ttl | null => {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  if (total <= MIN_TOKENS || gap <= MIN_GAP) return null
  if (u.cache_creation_input_tokens / total > 0.5) return gap < TTL_MS['1h'] ? '5m' : null

  return u.cache_read_input_tokens / total > 0.8 ? '1h' : null
}

/** The clock after a request of `model`, sent at `at`, kept the cache alive. */
export const served = (
  prev: CacheClock | null,
  at: number,
  model: string,
  u: ModelUsage,
): CacheClock => {
  // A new model starts a cache of its own, so a rewrite then proves nothing.
  const comparable = prev !== null && prev.at !== null && prev.model === model
  const seen = comparable ? observedTtl(at - (prev.at as number), u) : null

  return { at, model, learned: seen ?? prev?.learned ?? null }
}

/** The countdown, in whole minutes rounded up so a warm cache never reads 0m. */
export const cacheLabel = (
  clock: CacheClock | null,
  inputs: TtlInputs,
  s: Snapshot | null,
  now: number,
): { text: string; gone: number | null } | null => {
  if (clock === null || clock.at === null) return null
  const ttl = TTL_MS[clock.learned ?? expectedTtl(inputs, s)]
  const left = clock.at + ttl - now
  if (left <= 0) return { text: 'C cold', gone: null }

  return { text: `C (${Math.ceil(left / MINUTE)}m)`, gone: 100 - (left * 100) / ttl }
}
