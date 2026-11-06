import type { EngineInterface, Register } from 'claude-code'

import { type Item, type Path, drift, omit, parsePaths, promote, refusal, report } from './drift'
import { type Settings, apply, changedKeys, expandHome, isPlain, parseSettings } from './merge'

/** How applying the shared file went. */
type Outcome = { kind: 'current' } | { kind: 'applied'; keys: string[] } | { kind: 'failed'; reason: string }

/** Both files, read and parsed, or why they could not be. */
type Files =
  | { kind: 'ok'; sharedPath: string; shared: Settings; sharedRaw: Settings; target: string; ownText: string; own: Settings }
  | { kind: 'failed'; reason: string }

// The store key holding the shared settings as last applied, so a later removal can be undone.
const APPLIED = 'applied'
const COMMAND = 'settings-sync'

// The items the last report numbered: `add` copies from these, so the numbers mean what was shown.
let shown: Item[] | null = null

const homeOf = async ($: EngineInterface): Promise<string | undefined> =>
  (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

/** This machine's user settings file, where Claude Code keeps it. */
const settingsPath = async ($: EngineInterface, home: string | undefined): Promise<string> => {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? expandHome('~/.claude', home)

  return `${dir.replace(/[\\/]+$/, '')}/settings.json`
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const readFiles = async ($: EngineInterface, file: string, skip: readonly Path[]): Promise<Files> => {
  const home = await homeOf($)
  const sharedPath = expandHome(file, home)
  let sharedText: string
  try {
    sharedText = await $.fs.read(sharedPath)
  } catch (err) {
    return { kind: 'failed', reason: reason(err) }
  }
  const shared = parseSettings(sharedText)
  if (shared.kind === 'failed') return { kind: 'failed', reason: `${file} is ${shared.reason}` }

  const target = await settingsPath($, home)
  const ownText = (await $.fs.exists(target)) ? await $.fs.read(target) : '{}'
  // Never write over a file that cannot be read back: this machine's settings would be lost.
  const own = parseSettings(ownText)
  if (own.kind === 'failed') return { kind: 'failed', reason: `settings.json is ${own.reason}` }

  return {
    kind: 'ok',
    sharedPath,
    shared: omit(shared.settings, skip),
    sharedRaw: JSON.parse(sharedText) as Settings,
    target,
    ownText,
    own: own.settings,
  }
}

const sync = async ($: EngineInterface, file: string, skip: readonly Path[]): Promise<Outcome> => {
  const files = await readFiles($, file, skip)
  if (files.kind === 'failed') return files

  const stored = await $.store.get(APPLIED)
  // A skipped setting is neither written nor taken out again.
  const prev = omit(isPlain(stored) ? stored : {}, skip)
  const merged = apply(files.shared, prev, files.own) as Settings
  // `$schema` stays first, where a file that has one keeps it.
  const original = JSON.parse(files.ownText) as Settings
  const next = '$schema' in original ? { $schema: original.$schema, ...merged } : merged
  const keys = changedKeys(original, next)

  if (keys.length > 0) {
    await $.fs.write(`${files.target}.settings-sync.bak`, files.ownText)
    await $.fs.write(files.target, `${JSON.stringify(next, null, 2)}\n`)
  }
  await $.store.set(APPLIED, files.shared)

  return keys.length > 0 ? { kind: 'applied', keys } : { kind: 'current' }
}

/** `/settings-sync`: lists what this machine has that the shared file lacks. */
const showDrift = async ($: EngineInterface, file: string, skip: readonly Path[]): Promise<string> => {
  const files = await readFiles($, file, skip)
  if (files.kind === 'failed') return `Cannot compare: ${files.reason}`
  shown = drift(files.shared, files.own, skip)

  return report(shown, file)
}

/** `/settings-sync add 2 5`: copies items of the last report into the shared file. */
const addItems = async ($: EngineInterface, file: string, skip: readonly Path[], args: string[]): Promise<string> => {
  if (shown === null) return 'Run /settings-sync first, then add items by their numbers.'
  const numbers = args.map(Number)
  const bad = args.filter((a, i) => !Number.isInteger(numbers[i]) || (numbers[i] ?? 0) < 1 || (numbers[i] ?? 0) > (shown?.length ?? 0))
  if (args.length === 0 || bad.length > 0) {
    return `Give item numbers from 1 to ${shown.length}${bad.length > 0 ? `, not ${bad.join(', ')}` : ''}.`
  }

  const files = await readFiles($, file, skip)
  if (files.kind === 'failed') return `Cannot add: ${files.reason}`
  // The files changed since the report: its numbers may point at something else now.
  if (JSON.stringify(drift(files.shared, files.own, skip)) !== JSON.stringify(shown)) {
    shown = null
    return 'The settings changed since the last report. Run /settings-sync again, then add by the new numbers.'
  }

  const items = [...new Set(numbers)].map(n => shown?.[n - 1]).filter((i): i is Item => i !== undefined)
  const refused = items.map(refusal).filter((r): r is string => r !== null)
  if (refused.length > 0) return `Nothing added: ${refused.join('; ')}.`

  await $.fs.write(files.sharedPath, `${JSON.stringify(promote(files.sharedRaw, items), null, 2)}\n`)
  shown = null
  const what = items.map(i => i.path.join('.')).join(', ')

  return `Added ${what} to ${file}. Commit and push it so other machines pick it up at their next session.`
}

export const register: Register = (on, options) => {
  const file = typeof options.file === 'string' ? options.file.trim() : ''
  const skip = parsePaths(options.skip)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show settings this machine has that the shared settings file lacks, and copy them across',
      argumentHint: '[add <numbers>]',
    })
    const result = await next(e)
    if (file === '') return result
    const outcome = await sync($, file, skip).catch((err: unknown): Outcome => ({ kind: 'failed', reason: reason(err) }))
    if (!e.isInteractive) return result
    if (outcome.kind === 'applied') $.ui.toast(`settings-sync: updated ${outcome.keys.join(', ')} from ${file}`)
    if (outcome.kind === 'failed') $.ui.toast(`settings-sync: not applied: ${outcome.reason}`)

    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/[\s,]+/).filter(a => a !== '')
    let text: string
    if (file === '') text = 'Set the shared settings file in the mod\'s settings first.'
    else if (verb === '') text = await showDrift($, file, skip)
    else if (verb === 'add') text = await addItems($, file, skip, rest)
    else text = 'Usage: /settings-sync to list what this machine has that the shared file lacks, /settings-sync add <numbers> to copy items into it.'

    // Claude reads it too, so it can help choose what to share.
    return { text, context: [text] }
  }).catch((_$, _e, next) => (next.called ? next(_e) : { text: 'The command failed; see the debug log.' }))
}
