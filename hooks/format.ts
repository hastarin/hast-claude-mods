import type { Snapshot } from '../types'

export const BAR_CELLS = 20

// Shared green -> amber -> orange -> red ramp for any 0-100 gauge; 100+ goes
// gold. Hex for xterm 41 / 220 / 208 / 196 / 214, as the terminal script uses.
export const GOLD = '#ffaf00'

export const ramp = (p: number): { color: string; bold: boolean } => {
  if (p >= 100) return { color: GOLD, bold: true }
  if (p >= 90) return { color: '#ff0000', bold: true }
  if (p >= 75) return { color: '#ff8700', bold: false }
  if (p >= 50) return { color: '#ffd700', bold: false }

  return { color: '#00d75f', bold: false }
}

export const FIVE_HOURS = 5 * 3600_000
export const SEVEN_DAYS = 7 * 24 * 3600_000

/** A reading's `resetsAt` as epoch ms; null for none or one that does not parse. */
export const resetAt = (iso: string | undefined): number | null => {
  const at = iso === undefined ? Number.NaN : Date.parse(iso)

  return Number.isNaN(at) ? null : at
}

/**
 * Where a quota window lands at its reset if the rest of it goes at the average
 * rate so far; null when the reset is unknown, past, or further off than the
 * window is long.
 */
export const projected = (
  used: number,
  resetsAt: number | null,
  length: number,
  now: number,
): number | null => {
  if (resetsAt === null) return null
  const left = resetsAt - now
  if (left <= 0 || left >= length) return null

  return used / (1 - left / length)
}

// A quota window is coloured by pace, not level: the value to hand `ramp` is
// green while the window will reach its reset with quota left, then amber,
// orange and red as the projection passes 100, 125 and 150. Under 25% used the
// projection is noise, 90%+ used is red whatever the pace, and a window with no
// usable reset time keeps its raw level.
export const quotaGauge = (
  used: number,
  resetsAt: number | null,
  length: number,
  now: number,
): number => {
  const pace = projected(used, resetsAt, length, now)
  if (used >= 90 || pace === null) return used
  if (used < 25 || pace <= 100) return 0
  if (pace <= 125) return 50
  if (pace <= 150) return 75

  return 90
}

/** Time to a window's reset as ` (45m)`, ` (2h)` or ` (4d)`; empty when unknown or past. */
export const timeLeft = (resetsAt: number | null, now: number): string => {
  if (resetsAt === null || resetsAt <= now) return ''
  const minutes = Math.round((resetsAt - now) / 60_000)
  if (minutes < 60) return ` (${minutes}m)`
  const hours = Math.round(minutes / 60)

  return hours < 24 ? ` (${hours}h)` : ` (${Math.round(hours / 24)}d)`
}

export const bar = (p: number): { on: string; off: string } => {
  const filled = Math.min(BAR_CELLS, Math.max(0, Math.floor((p / 100) * BAR_CELLS + 0.5)))

  return { on: '█'.repeat(filled), off: '░'.repeat(BAR_CELLS - filled) }
}

export const usedK = (n: number): string => `${Math.round(n / 1000)}k`

export const totalK = (n: number): string =>
  n >= 1_000_000 ? `${Number((n / 1_000_000).toPrecision(6))}M` : usedK(n)

export const isOverage = (s: Pick<Snapshot, 'q5' | 'q7'>): boolean =>
  (s.q5 ?? 0) >= 100 || (s.q7 ?? 0) >= 100

/** Cost charged to credits: what the session has cost since quota ran out. */
export const creditUsd = (s: Snapshot): number | null =>
  s.overageBase === null ? null : Math.max(0, s.usd - s.overageBase)

/** The whole bar as one uncoloured line, for `/usage-bar`. */
export const plain = (s: Snapshot, now: number): string => {
  const { on, off } = bar(s.percent)
  const quota =
    s.q5 === null && s.q7 === null
      ? ''
      : `  5h ${Math.round(s.q5 ?? 0)}%${timeLeft(s.r5, now)} · 7d ${Math.round(s.q7 ?? 0)}%${timeLeft(s.r7, now)}`
  const credit = creditUsd(s)
  const cost = `  ~$${s.usd.toFixed(2)}${credit === null ? '' : ` 💰$${credit.toFixed(2)}`}`

  return `[${on}${off}] ${Math.round(s.percent)}%  ${usedK(s.tokens)} / ${totalK(s.window)}${quota}${cost}`
}
