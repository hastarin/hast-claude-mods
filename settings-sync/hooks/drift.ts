import { type Settings, isPlain } from './merge'

/** A path into a settings object, one key per step. */
export type Path = readonly string[]

/** One way this machine's settings differ from the shared file. */
export type Item =
  | { kind: 'value'; path: Path; value: unknown; shared: unknown }
  | { kind: 'entry'; path: Path; value: unknown }

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Splits the `skip` option into paths: comma- or newline-separated, each dotted (`pluginConfigs.x@m`). */
export const parsePaths = (value: unknown): Path[] =>
  typeof value === 'string'
    ? value
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(s => s !== '')
        .map(s => s.split('.').filter(k => k !== ''))
        .filter(p => p.length > 0)
    : []

/**
 * `skip` with this mod's own `skip` option added, under whatever marketplace it came from:
 * each machine picks what it keeps, so that choice is never listed or shared.
 */
export const withOwnSkip = (skip: readonly Path[], ...settings: Settings[]): Path[] => {
  const keys = new Set(
    settings.flatMap(s => {
      const configs = s.pluginConfigs
      return configs !== null && typeof configs === 'object' && !Array.isArray(configs) ? Object.keys(configs) : []
    }),
  )
  const own = [...keys].filter(k => k.startsWith('settings-sync@')).map(k => ['pluginConfigs', k, 'options', 'skip'])

  return [...skip, ...own]
}

const isUnder = (path: Path, skip: readonly Path[]): boolean =>
  skip.some(s => s.length <= path.length && s.every((k, i) => path[i] === k))

/** A copy of `settings` without the skipped paths. */
export const omit = (settings: Settings, skip: readonly Path[], at: Path = []): Settings => {
  const out: Settings = {}
  for (const [k, v] of Object.entries(settings)) {
    const path = [...at, k]
    if (isUnder(path, skip)) continue
    out[k] = isPlain(v) ? omit(v, skip, path) : v
  }

  return out
}

/**
 * What this machine has that the shared file does not: values that differ or that only this
 * machine sets, and list entries only this machine has. Skipped paths are left out.
 */
export const drift = (shared: unknown, own: unknown, skip: readonly Path[] = [], at: Path = []): Item[] => {
  if (!isPlain(own)) return []
  const theirs = isPlain(shared) ? shared : {}

  return Object.entries(own).flatMap(([k, v]): Item[] => {
    const path = [...at, k]
    if (isUnder(path, skip)) return []
    const s = theirs[k]
    if (isPlain(v)) return drift(s, v, skip, path)
    if (Array.isArray(v)) {
      const list = Array.isArray(s) ? s : []

      return v.filter(e => !list.some(x => same(x, e))).map((value): Item => ({ kind: 'entry', path, value }))
    }

    return same(v, s) ? [] : [{ kind: 'value', path, value: v, shared: s }]
  })
}

// Names that usually hold a credential: never copied into a file that goes to git.
const SECRET = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH)/i

/** Why an item must not go into the shared file, or null when it may. */
export const refusal = (item: Item): string | null =>
  item.path[0] === 'env' && SECRET.test(item.path[1] ?? '')
    ? `${item.path.join('.')} looks like a secret, so it stays on this machine; add it to the shared file by hand only if it is not one`
    : null

/** `shared` with the items copied in from this machine: values set, list entries added. */
export const promote = (shared: Settings, items: readonly Item[]): Settings => {
  const out = structuredClone(shared) as Record<string, unknown>
  for (const item of items) {
    let node = out
    for (const k of item.path.slice(0, -1)) {
      if (!isPlain(node[k])) node[k] = {}
      node = node[k] as Record<string, unknown>
    }
    const last = item.path[item.path.length - 1] ?? ''
    if (item.kind === 'value') node[last] = item.value
    else {
      const list = Array.isArray(node[last]) ? (node[last] as unknown[]) : []
      if (!list.some(x => same(x, item.value))) list.push(item.value)
      node[last] = list
    }
  }

  return out
}

/** `settings` with the items taken out: values deleted, list entries removed, emptied parents pruned. */
export const demote = (settings: Settings, items: readonly Item[]): Settings => {
  const out = structuredClone(settings) as Record<string, unknown>
  for (const item of items) {
    const chain: Record<string, unknown>[] = [out]
    for (const k of item.path.slice(0, -1)) {
      const next = chain[chain.length - 1]?.[k]
      if (!isPlain(next)) break
      chain.push(next as Record<string, unknown>)
    }
    if (chain.length !== item.path.length) continue
    const last = item.path[item.path.length - 1] ?? ''
    const node = chain[chain.length - 1] as Record<string, unknown>
    if (item.kind === 'value') delete node[last]
    else if (Array.isArray(node[last])) {
      const kept = (node[last] as unknown[]).filter(x => !same(x, item.value))
      if (kept.length > 0) node[last] = kept
      else delete node[last]
    }
    // A parent left empty goes too, so no bare `{}` stays behind.
    for (let i = chain.length - 1; i > 0; i--) {
      const parent = chain[i - 1] as Record<string, unknown>
      if (Object.keys(chain[i] as object).length > 0) break
      delete parent[item.path[i - 1] ?? '']
    }
  }

  return out
}

/** Why an item cannot be deleted from this machine, or null when it can. */
export const keepReason = (item: Item): string | null =>
  item.kind === 'value' && item.shared !== undefined
    ? `${item.path.join('.')} is set by the shared file, which would put it back; change it there instead`
    : null

const show = (v: unknown): string => {
  const text = v === undefined ? 'unset' : JSON.stringify(v)

  return text.length > 100 ? `${text.slice(0, 97)}...` : text
}

/** One numbered line of the report. */
export const line = (n: number, item: Item): string =>
  item.kind === 'value'
    ? `${n}. ${item.path.join('.')}: ${show(item.value)}${item.shared === undefined ? '' : ` (shared: ${show(item.shared)})`}`
    : `${n}. ${item.path.join('.')}: + ${show(item.value)}`

/** The whole report: what differs, what only this machine has, and how to copy items across. */
export const report = (items: readonly Item[], file: string): string => {
  if (items.length === 0) return `This machine's settings.json has nothing that ${file} lacks.`
  const numbered = items.map((item, i) => ({ item, n: i + 1 }))
  const differs = numbered.filter(({ item }) => item.kind === 'value' && item.shared !== undefined)
  const only = numbered.filter(({ item }) => !(item.kind === 'value' && item.shared !== undefined))
  const section = (title: string, rows: typeof numbered) =>
    rows.length === 0 ? [] : [title, ...rows.map(({ item, n }) => `  ${line(n, item)}`)]

  return [
    `This machine's settings.json against ${file}`,
    ...section('Set differently here (the shared value comes back at the next session):', differs),
    ...section('Only on this machine:', only),
    `Run /settings-sync add <numbers> (such as /settings-sync add ${only[0]?.n ?? differs[0]?.n ?? 1}) to copy items into the shared file, then commit and push it.`,
  ].join('\n')
}
