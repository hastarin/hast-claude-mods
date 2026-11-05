import type { SharedQuota, Snapshot } from '../types'

export const BAR_CELLS = 20
const MIN_BAR_CELLS = 8

// Shared green -> amber -> orange -> red ramp for any 0-100 gauge; 100+ goes
// gold. Hex for xterm 41 / 220 / 208 / 196 / 214.
export const GOLD = '#ffaf00'

export const ramp = (p: number): { color: string; bold: boolean } => {
  if (p >= 100) return { color: GOLD, bold: true }
  if (p >= 90) return { color: '#ff0000', bold: true }
  if (p >= 75) return { color: '#ff8700', bold: false }
  if (p >= 50) return { color: '#ffd700', bold: false }

  return { color: '#00d75f', bold: false }
}

// Context is coloured by whichever is worse: how full the window is, or how
// many tokens it holds. Each turn re-reads the whole context and long contexts
// also drift, so size matters on a 1M window long before it is full. Amber from
// 100k, orange from 200k (a good point to consider compacting), red from 300k.
export const CONTEXT_STEPS: readonly [tokens: number, gauge: number][] = [
  [300_000, 90],
  [200_000, 75],
  [100_000, 50],
]

/** The value to hand `ramp` for the context: the window's percent, raised by size. */
export const contextGauge = (tokens: number, percent: number): number => {
  const step = CONTEXT_STEPS.find(([from]) => tokens >= from)

  return Math.max(percent, step?.[1] ?? 0)
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

export const bar = (p: number, cells = BAR_CELLS): { on: string; off: string } => {
  const filled = Math.min(cells, Math.max(0, Math.floor((p / 100) * cells + 0.5)))

  return { on: '█'.repeat(filled), off: '░'.repeat(cells - filled) }
}

/** One glyph for when even the shortest bar will not fit, to the nearest quarter. */
export const ring = (p: number): string => '○◔◑◕●'.charAt(Math.min(4, Math.max(0, Math.round(p / 25))))

/**
 * Cells for a bar in a line `length` long at full width: any overflow comes out
 * of the bar. 0 when even the shortest bar is too long, for `ring` to stand in.
 */
export const barCells = (length: number, room: number): number => {
  const cells = BAR_CELLS - Math.max(0, length - room)
  if (room <= 0) return BAR_CELLS

  return cells >= MIN_BAR_CELLS ? cells : 0
}

export const usedK = (n: number): string => `${Math.round(n / 1000)}k`

export const totalK = (n: number): string =>
  n >= 1_000_000 ? `${Number((n / 1_000_000).toPrecision(6))}M` : usedK(n)

export const isOverage = (s: Pick<Snapshot, 'q5' | 'q7'>): boolean =>
  (s.q5 ?? 0) >= 100 || (s.q7 ?? 0) >= 100

/** The figures as they stand at `now`: a window past its reset has nothing used. */
export const settled = (s: Snapshot, now: number): Snapshot => {
  const lapsed = (resetsAt: number | null): boolean => resetsAt !== null && resetsAt <= now
  const q5 = s.q5 !== null && lapsed(s.r5) ? 0 : s.q5
  const q7 = s.q7 !== null && lapsed(s.r7) ? 0 : s.q7

  return {
    ...s,
    q5,
    q7,
    r5: lapsed(s.r5) ? null : s.r5,
    r7: lapsed(s.r7) ? null : s.r7,
    overageBase: isOverage({ q5, q7 }) ? s.overageBase : null,
  }
}

/** The store's reading if it has the right shape; null for anything else. */
export const sharedQuota = (value: unknown): SharedQuota | null => {
  if (typeof value !== 'object' || value === null) return null
  const { q5, q7, r5, r7, at } = value as Record<string, unknown>
  const isFigure = (v: unknown): v is number | null => v === null || typeof v === 'number'
  const isWhole = isFigure(q5) && isFigure(q7) && isFigure(r5) && isFigure(r7) && typeof at === 'number'

  return isWhole ? { q5, q7, r5, r7, at } : null
}

/** Cost charged to credits: what the session has cost since quota ran out. */
export const creditUsd = (s: Snapshot): number | null =>
  s.overageBase === null ? null : Math.max(0, s.usd - s.overageBase)

/** A model id by family and version: `claude-opus-5-5` reads `Opus 5.5`. */
export const modelName = (id: string): string => {
  const found = /(fable|mythos|opus|sonnet|haiku)(?:[- ](\d+(?:[-.]\d{1,2}(?!\d))?))?/i.exec(id)
  if (found === null) return id
  const [, family = '', version] = found
  const name = `${family[0]?.toUpperCase()}${family.slice(1).toLowerCase()}`

  return version === undefined ? name : `${name} ${version.replace('-', '.')}`
}

/** A model's colour by cost tier, the pricier the louder; undefined when unknown. */
export const modelTone = (id: string): { color?: string; bold: boolean } => {
  const name = id.toLowerCase()
  if (name.includes('fable') || name.includes('mythos')) return { color: '#ff00af', bold: true }
  if (name.includes('opus')) return { color: '#ff8700', bold: false }
  if (name.includes('sonnet')) return { color: '#00afaf', bold: false }
  if (name.includes('haiku')) return { color: '#8a8a8a', bold: false }

  return { bold: false }
}

/** An effort level's brightness, hueless so it never competes with the model or context colours. */
export const effortTone = (level: string): { color?: string; bold: boolean; dim: boolean } => {
  if (level === 'low') return { color: '#585858', bold: false, dim: false }
  if (level === 'medium') return { color: '#8a8a8a', bold: false, dim: false }
  if (level === 'high') return { color: '#d0d0d0', bold: false, dim: false }
  if (level === 'xhigh') return { color: '#ffffff', bold: false, dim: false }
  if (level === 'max') return { color: '#ffffff', bold: true, dim: false }

  return { bold: false, dim: true }
}

/** What `/usage-bar` adds to the figures; each is left out when null. */
export type Extras = {
  git?: { repo: string; branch: string; flags: string } | null
  model?: string | null
  effort?: string | null
  cache?: string | null
}

/** The whole bar as one uncoloured line, for `/usage-bar`. */
export const plain = (s: Snapshot, now: number, extras: Extras = {}): string => {
  const { git = null, model = null, effort = null, cache = null } = extras
  const { on, off } = bar(s.percent)
  const quota =
    s.q5 === null && s.q7 === null
      ? ''
      : `  5h ${Math.round(s.q5 ?? 0)}%${timeLeft(s.r5, now)} · 7d ${Math.round(s.q7 ?? 0)}%${timeLeft(s.r7, now)}`
  const credit = creditUsd(s)
  const cost = `  ~$${s.usd.toFixed(2)}${credit === null ? '' : ` 💰$${credit.toFixed(2)}`}`

  const where = git === null ? '' : `${[git.repo, git.branch, git.flags].filter(Boolean).join(' ')}  |  `
  const who = model === null ? '' : `${model}${effort === null ? '' : ` [${effort}]`}  `
  const countdown = cache === null ? '' : `  ${cache}`

  return `${where}${who}[${on}${off}] ${Math.round(s.percent)}%  ${usedK(s.tokens)} / ${totalK(s.window)}${quota}${countdown}${cost}`
}
