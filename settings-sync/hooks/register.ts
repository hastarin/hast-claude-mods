import type { EngineInterface, Register } from 'claude-code'

import { type Item, type Path, demote, drift, keepReason, line, omit, parsePaths, promote, refusal, report, withOwnSkip } from './drift'
import { type Settings, apply, changedKeys, expandHome, isPlain, parseSettings } from './merge'
import { type Last, type Outcome, asLast, outcomeText, statusText } from './status'

/** Both files, read and parsed, or why they could not be. */
type Files =
  | { kind: 'ok'; skip: Path[]; sharedPath: string; shared: Settings; sharedRaw: Settings; target: string; ownText: string; own: Settings }
  | { kind: 'failed'; reason: string }

// The store key holding the shared settings as last applied, so a later removal can be undone.
const APPLIED = 'applied'
// The store key holding the last sync, so `/settings-sync status` can say what it did on any surface.
const LAST = 'last'
const COMMAND = 'settings-sync'

// The shared file's size and time as last synced: a change to them means sync again.
let seen: string | null = null
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
  const all = withOwnSkip(skip, shared.settings, own.settings)

  return {
    kind: 'ok',
    skip: all,
    sharedPath,
    shared: omit(shared.settings, all),
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
  const prev = omit(isPlain(stored) ? stored : {}, files.skip)
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

/** The shared file's size and modification time, or null when it cannot be read. */
const stamp = async ($: EngineInterface, file: string): Promise<string | null> => {
  try {
    const st = await $.fs.stat(expandHome(file, await homeOf($)))

    return `${st.size}:${st.mtimeMs}`
  } catch {
    return null
  }
}

/** Runs a sync and remembers how it went; a store that fails never loses the sync itself. */
const syncNow = async ($: EngineInterface, file: string, skip: readonly Path[]): Promise<Outcome> => {
  // Taken first, so a change made while this runs is picked up by the next check.
  seen = await stamp($, file)
  const outcome = await sync($, file, skip).catch((err: unknown): Outcome => ({ kind: 'failed', reason: reason(err) }))
  try {
    const last: Last = { at: await $.clock.now(), outcome }
    await $.store.set(LAST, last)
  } catch {}

  return outcome
}

// Toasts waiting for a surface to draw them. The desktop app and VS Code attach after the
// session starts, so a toast sent before that has nowhere to show; a `-p` run never attaches.
let held: string[] = []

const toast = async ($: EngineInterface, text: string) => {
  if ((await $.session.surfaces()).length > 0) $.ui.toast(text)
  else held.push(text)
}

const showHeld = ($: EngineInterface) => {
  const texts = held
  held = []
  for (const text of texts) $.ui.toast(text)
}

// Not gated on `e.isInteractive`: the desktop app and VS Code start like a `-p` run.
const toastOutcome = async ($: EngineInterface, outcome: Outcome, file: string) => {
  if (outcome.kind === 'applied') await toast($, `settings-sync: updated ${outcome.keys.join(', ')} from ${file}`)
  if (outcome.kind === 'failed') await toast($, `settings-sync: not applied: ${outcome.reason}`)
}

/**
 * Syncs again when the shared file has changed since the last sync, such as when a pull that
 * was still running at session start lands, or the file is edited by hand.
 */
const recheck = async ($: EngineInterface, file: string, skip: readonly Path[]): Promise<void> => {
  const now = await stamp($, file)
  if (now === null || now === seen) return
  await toastOutcome($, await syncNow($, file, skip), file)
}

/** `/settings-sync status`: what the last sync did. */
const showStatus = async ($: EngineInterface, file: string): Promise<string> =>
  statusText(asLast(await $.store.get(LAST)), await $.clock.now(), file)

/** `/settings-sync`: lists what this machine has that the shared file lacks. */
const showDrift = async ($: EngineInterface, file: string, skip: readonly Path[]): Promise<string> => {
  const files = await readFiles($, file, skip)
  if (files.kind === 'failed') return `Cannot compare: ${files.reason}`
  shown = drift(files.shared, files.own, files.skip)

  return report(shown, file)
}

type Picked = { kind: 'ok'; items: Item[]; files: Extract<Files, { kind: 'ok' }> } | { kind: 'no'; text: string }

/** The items of the last report that `args` number, or why they cannot be used. */
const pick = async ($: EngineInterface, file: string, skip: readonly Path[], args: string[], verb: string): Promise<Picked> => {
  if (shown === null) return { kind: 'no', text: `Run /settings-sync first, then ${verb} items by their numbers.` }
  const numbers = args.map(Number)
  const bad = args.filter((a, i) => !Number.isInteger(numbers[i]) || (numbers[i] ?? 0) < 1 || (numbers[i] ?? 0) > (shown?.length ?? 0))
  if (args.length === 0 || bad.length > 0) {
    return { kind: 'no', text: `Give item numbers from 1 to ${shown.length}${bad.length > 0 ? `, not ${bad.join(', ')}` : ''}.` }
  }

  const files = await readFiles($, file, skip)
  if (files.kind === 'failed') return { kind: 'no', text: `Cannot ${verb}: ${files.reason}` }
  // The files changed since the report: its numbers may point at something else now.
  if (JSON.stringify(drift(files.shared, files.own, files.skip)) !== JSON.stringify(shown)) {
    shown = null
    return { kind: 'no', text: `The settings changed since the last report. Run /settings-sync again, then ${verb} by the new numbers.` }
  }

  return { kind: 'ok', items: [...new Set(numbers)].map(n => shown?.[n - 1]).filter((i): i is Item => i !== undefined), files }
}

/** `/settings-sync explain 2`: has Claude say what items do and whether to keep, delete or share them. */
const explainItems = async (
  $: EngineInterface,
  file: string,
  skip: readonly Path[],
  args: string[],
): Promise<{ text: string; context?: string[] }> => {
  const picked = await pick($, file, skip, args, 'explain')
  if (picked.kind === 'no') return { text: picked.text }
  const prompt = [
    `Explain these Claude Code settings from this machine's settings.json, which ${file} does not have:`,
    ...picked.items.map((item, i) => line(i + 1, item)),
    'For each: what it does, whether this machine still needs it, and whether to leave it here, delete it (/settings-sync del), or share it (/settings-sync add).',
    'Be brief.',
  ].join('\n')
  try {
    const reply = await $.model.fork({ prompt })
    if (reply.isAnswered && reply.text.trim() !== '') return { text: reply.text.trim(), context: [reply.text.trim()] }
  } catch {}

  // No side answer to give (nothing to fork yet, say): leave the question for Claude's next turn.
  return { text: 'Claude could not answer here; ask it to explain those settings.', context: [prompt] }
}

/** `/settings-sync del 2 [confirm]`: takes items out of this machine's settings.json, after a confirmation. */
const deleteItems = async ($: EngineInterface, file: string, skip: readonly Path[], args: string[]): Promise<string> => {
  const confirmed = args.at(-1) === 'confirm'
  const numbers = confirmed ? args.slice(0, -1) : args
  const picked = await pick($, file, skip, numbers, 'delete')
  if (picked.kind === 'no') return picked.text
  const { items, files } = picked
  const kept = items.map(keepReason).filter((r): r is string => r !== null)
  if (kept.length > 0) return `Nothing deleted: ${kept.join('; ')}.`

  if (!confirmed) {
    return [
      "This would take out of this machine's settings.json:",
      ...items.map(i => `  ${line(1, i).replace(/^1\. /, '')}`),
      `Run /settings-sync del ${[...new Set(numbers)].join(' ')} confirm to do it (the old file is saved as settings.json.settings-sync.bak).`,
    ].join('\n')
  }

  await $.fs.write(`${files.target}.settings-sync.bak`, files.ownText)
  await $.fs.write(files.target, `${JSON.stringify(demote(JSON.parse(files.ownText) as Settings, items), null, 2)}\n`)
  shown = null

  return `Deleted ${items.map(i => i.path.join('.')).join(', ')} from settings.json. Run /settings-sync for a fresh list.`
}

/** `/settings-sync add 2 5`: copies items of the last report into the shared file. */
const addItems = async ($: EngineInterface, file: string, skip: readonly Path[], args: string[]): Promise<string> => {
  const picked = await pick($, file, skip, args, 'add')
  if (picked.kind === 'no') return picked.text
  const { items, files } = picked
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
    // A surface that cannot take the command still syncs.
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Show settings this machine has that the shared settings file lacks, copy, explain or delete them, or sync now',
        argumentHint: '[add <numbers> | explain <numbers> | del <numbers> | status | now]',
      })
    } catch {}
    const result = await next(e)
    if (file === '') return result
    await toastOutcome($, await syncNow($, file, skip), file)

    return result
  })

  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    showHeld($)

    return result
  })

  // A stat per prompt: cheap, and the sync itself only runs when the file changed.
  on('prompt.submit', async ($, e, next) => {
    if (file !== '') await recheck($, file, skip).catch(() => undefined)

    return next(e)
    // The prompt always goes through, whatever the check did.
  }).catch((_$, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/[\s,]+/).filter(a => a !== '')
    let text: string
    let context: string[] | undefined
    if (file === '') text = 'Set the shared settings file in the mod\'s settings first.'
    else if (verb === '') text = await showDrift($, file, skip)
    else if (verb === 'add') text = await addItems($, file, skip, rest)
    else if (verb === 'explain') ({ text, context } = await explainItems($, file, skip, rest))
    else if (verb === 'del') text = await deleteItems($, file, skip, rest)
    else if (verb === 'status') text = await showStatus($, file)
    else if (verb === 'now') text = `Synced just now: ${outcomeText(await syncNow($, file, skip), file)}`
    else text = 'Usage: /settings-sync to list what this machine has that the shared file lacks, /settings-sync add <numbers> to copy items into it, /settings-sync explain <numbers> to have Claude explain them, /settings-sync del <numbers> to take them out of this machine\'s settings.json, /settings-sync status to see what the last sync did, /settings-sync now to sync again.'

    // Claude reads it too, so it can help choose what to share.
    return { text, context: context ?? [text] }
  }).catch((_$, _e, next) => (next.called ? next(_e) : { text: 'The command failed; see the debug log.' }))
}
