/** A settings object as a settings.json holds it. */
export type Settings = Record<string, unknown>

/** What parsing a settings file came to. */
export type Parsed = { kind: 'ok'; settings: Settings } | { kind: 'failed'; reason: string }

export const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Expands a leading `~` to the home folder; any other path is left as written. */
export const expandHome = (path: string, home: string | undefined): string => {
  if (home === undefined || home === '') return path
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return `${home.replace(/[\\/]+$/, '')}/${path.slice(2)}`

  return path
}

/** Parses a settings file's text, which must hold a JSON object. `$schema` is for editors, so it is dropped. */
export const parseSettings = (text: string): Parsed => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    return { kind: 'failed', reason: `not valid JSON (${err instanceof Error ? err.message : String(err)})` }
  }
  if (!isPlain(value)) return { kind: 'failed', reason: 'not a JSON object' }
  const { $schema: _schema, ...settings } = value

  return { kind: 'ok', settings }
}

/**
 * Called for a setting that has left the shared file since the last apply (`prev`).
 * List entries that apply added are taken out of `own`, so a rule can be revoked everywhere.
 * Any other value stays as this machine has it: it is no longer synced, and this machine keeps it.
 * Returns undefined when nothing is left.
 */
export const withdraw = (prev: unknown, own: unknown): unknown => {
  if (Array.isArray(prev) && Array.isArray(own)) {
    const left = own.filter(o => !prev.some(p => same(p, o)))

    return left.length === 0 ? undefined : left
  }
  if (isPlain(prev) && isPlain(own)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(own)) {
      const left = k in prev ? withdraw(prev[k], v) : v
      if (left !== undefined) out[k] = left
    }

    return Object.keys(out).length === 0 ? undefined : out
  }

  return own
}

/**
 * Applies `shared` to this machine's settings, `own`.
 *
 * - A value in `shared` wins, so a change made once reaches every machine.
 * - Objects merge key by key, so a key only this machine has is left alone.
 * - Lists join: this machine's entries first, then the shared ones it lacks.
 * - `prev` is what the last apply used. A list entry that has since left `shared` is taken out
 *   again; any other setting that has left it stays as this machine has it, no longer synced.
 */
export const apply = (shared: unknown, prev: unknown, own: unknown): unknown => {
  if (isPlain(shared)) {
    const mine = isPlain(own) ? own : {}
    const before = isPlain(prev) ? prev : {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(mine)) {
      if (k in shared) out[k] = apply(shared[k], before[k], v)
      else if (k in before) {
        const left = withdraw(before[k], v)
        if (left !== undefined) out[k] = left
      } else out[k] = v
    }
    for (const [k, v] of Object.entries(shared)) if (!(k in mine)) out[k] = apply(v, before[k], undefined)

    return out
  }
  if (Array.isArray(shared)) {
    const mine = Array.isArray(own) ? own : []
    const dropped = Array.isArray(prev) ? prev.filter(p => !shared.some(s => same(s, p))) : []
    const kept = mine.filter(o => !dropped.some(d => same(d, o)))

    return [...kept, ...shared.filter(s => !kept.some(o => same(o, s)))]
  }

  return shared
}

/** The top-level keys whose value differs between two settings objects, in a stable order. */
export const changedKeys = (before: Settings, after: Settings): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => !same(before[k], after[k]))
