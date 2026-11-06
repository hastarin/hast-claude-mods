import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import {
  INSTRUCTIONS,
  type Verb,
  askText,
  cleanSummary,
  expandHome,
  fileName,
  joinPath,
  handoffText,
  parseArgs,
  seedText,
  withNote,
} from './summary'

type Options = { thresholdK: number; instructionsFile: string; compactFirst: boolean; folder: string }
type Prepared = { file: string; saved: string }
type Action = Verb | 'ask'

const NAMES = ['handoff', 'hast-handoff']

// What runs now, drawn in place of the buttons, so a second press cannot start another.
let busy: string | null = null
// The name `/handoff` was registered under; null when both were taken.
let owned: string | null = null
// Set while this mod's own `/compact` runs, so its `session.compact` hook keeps the summary.
let capturing = false
let captured: string | null = null
// The terminal takes `$.session.compact`; a session driven like a `-p` run (the desktop app,
// VS Code) refuses it, and `/compact` runs there instead.
let interactive = false

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const readOptions = (options: Record<string, unknown>): Options => ({
  thresholdK: typeof options.thresholdK === 'number' && options.thresholdK > 0 ? options.thresholdK : 200,
  instructionsFile: typeof options.instructionsFile === 'string' ? options.instructionsFile.trim() : '',
  compactFirst: options.compactFirst !== false,
  folder: typeof options.folder === 'string' && options.folder.trim() !== '' ? options.folder.trim() : '~/.claude/handoffs',
})

const homeOf = async ($: EngineInterface): Promise<string | undefined> =>
  (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

/** The summary's text from a compaction's messages: the first user message, which holds it. */
const summaryOf = (messages: readonly { role: string; text: string }[]): string =>
  messages.find(m => m.role === 'user' && m.text.trim() !== '')?.text ?? ''

/** Compacts the session and returns the summary as the engine wrote it. */
const compactNow = async ($: EngineInterface, instructions: string): Promise<string> => {
  if (interactive) {
    const r = await $.session.compact({ instructions })
    if (r.skip !== undefined) throw new Error(r.skip)

    return summaryOf(r.messages)
  }
  captured = null
  capturing = true
  let said: string | undefined
  try {
    said = (await $.command.run({ command: 'compact', args: instructions })).text
  } finally {
    capturing = false
  }
  if (captured === null) throw new Error(said?.trim() || 'the compaction did not run')

  return captured
}

/** A summary without changing the session: one request over its own transcript, from the cache. */
const forkSummary = async ($: EngineInterface, instructions: string): Promise<string> => {
  const r = await $.model.fork({ prompt: `${instructions}\nWrite only the summary, in Markdown.` })
  if (!r.isAnswered) throw new Error(`no summary was written (${r.reason})`)

  return r.text
}

const readInstructions = async ($: EngineInterface, o: Options): Promise<string> => {
  if (o.instructionsFile === '') return INSTRUCTIONS
  const text = (await $.fs.read(expandHome(o.instructionsFile, await homeOf($)))).trim()
  if (text === '') throw new Error(`${o.instructionsFile} is empty`)

  return text
}

/** Writes the summary, saves it and reads it back; throws, leaving the session alone, when any step fails. */
const prepare = async ($: EngineInterface, o: Options, note: string, compact: boolean): Promise<Prepared> => {
  const sessionId = await $.session.id()
  const instructions = withNote(await readInstructions($, o), note)
  const raw = compact ? await compactNow($, instructions) : await forkSummary($, instructions)
  const { summary, transcript } = cleanSummary(raw)
  if (summary === '') throw new Error('the summary came back empty')

  const savedAt = await $.clock.now()
  const file = joinPath(expandHome(o.folder, await homeOf($)), fileName(sessionId, savedAt))
  const text = handoffText({ sessionId, cwd: await $.session.cwd(), savedAt, transcript, note, summary })
  await $.fs.write(file, text)
  const saved = await $.fs.read(file)
  if (!saved.includes(summary)) throw new Error(`${file} did not read back as written`)

  return { file, saved }
}

/** Terminal and VS Code: summary, clear, then the summary as the new session's first message. */
const newSession = async ($: EngineInterface, o: Options, note: string): Promise<void> => {
  const before = await $.session.id()
  const { file, saved } = await prepare($, o, note, o.compactFirst)
  await $.command.run({ command: 'clear' })
  if ((await $.session.id()) === before) throw new Error(`the session was not cleared; the handoff is saved at ${file}`)
  await $.prompt.submit({ text: seedText(saved, file) })
  $.ui.toast(`handoff: new session started; resume the old one with claude --resume ${before}`, { timeoutMs: 10000 })
}

const copyHandoff = async ($: EngineInterface, o: Options, note: string, surface: RenderSurface | undefined): Promise<void> => {
  const { file, saved } = await prepare($, o, note, true)
  const r = await $.ui.copy({ text: seedText(saved, file), surface })
  $.ui.toast(
    r.isCopied
      ? 'handoff: copied; open a new session and paste it as the first message'
      : `handoff: not copied (${r.reason}); the handoff is saved at ${file}`,
    { timeoutMs: 10000 },
  )
}

/** The desktop app: the person sends the request, so the new session is started on their own words. */
const askForSession = async ($: EngineInterface, o: Options, note: string): Promise<void> => {
  const { file } = await prepare($, o, note, true)
  await $.prompt.fill({ text: askText(file) })
  $.ui.toast('handoff: press Enter to ask Claude to start the new session', { timeoutMs: 10000 })
}

const LABEL: Record<Action, string> = {
  compact: 'compacting',
  new: 'starting a new session',
  copy: 'writing the handoff to copy',
  ask: 'writing the handoff',
}

/** Runs one action at a time; any failure leaves the session as it was and says why. */
const run = async ($: EngineInterface, o: Options, action: Action, note: string, surface: RenderSurface | undefined): Promise<void> => {
  if (busy !== null) {
    $.ui.toast(`handoff: still ${busy}`)
    return
  }
  busy = LABEL[action]
  $.ui.invalidate('ui.render')
  try {
    if (action === 'compact') {
      await prepare($, o, note, true)
      $.ui.toast('handoff: compacted; the summary is saved too')
    } else if (action === 'new') await newSession($, o, note)
    else if (action === 'copy') await copyHandoff($, o, note, surface)
    else await askForSession($, o, note)
  } catch (err) {
    $.ui.toast(`handoff: stopped: ${reason(err)}`, { timeoutMs: 10000 })
  } finally {
    busy = null
    $.ui.invalidate('ui.render')
  }
}

/** On the desktop app `/clear` loses the old conversation, so `new` asks Claude to start one instead. */
const actionFor = (verb: Verb, surface: RenderSurface | undefined): Action =>
  verb === 'new' && surface === 'desktop' ? 'ask' : verb

const usage = (name: string, tokens: number | undefined): string =>
  [
    `/${name} compact [note]: compact now with handoff instructions, and save the summary.`,
    `/${name} new [note]: start a new session from the summary (in the desktop app, ask Claude to start one).`,
    `/${name} copy [note]: compact, save, and copy the handoff to paste into a new session.`,
    tokens === undefined ? '' : `The context holds ${Math.round(tokens / 1000)}k tokens.`,
  ]
    .filter(l => l !== '')
    .join('\n')

export const register: Register = (on, options) => {
  const o = readOptions(options)

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    owned = null
    for (const name of NAMES) {
      try {
        await $.command.register({
          name,
          description: 'Compact with handoff instructions, or hand off to a new session',
          argumentHint: '[compact | new | copy] [note]',
        })
        owned = name
        break
      } catch {}
    }
    const result = await next(e)
    if (owned !== NAMES[0]) {
      $.ui.toast(owned === null ? 'handoff: /handoff and /hast-handoff are both taken; use the buttons' : `handoff: /handoff is taken; use /${owned}`)
    }

    return result
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (capturing && e.agentId === undefined && r.messages !== undefined) captured = summaryOf(r.messages)

    return r
    // A failure here must never stop a compaction: hand it on as it came.
  }).catch(($, e, next) => next(e))

  // Answers only the name this mod holds: another plugin's or a skill's command is left to it.
  on('command.run', async ($, e, next) => {
    if (owned === null || e.command !== owned) return next(e)
    const { verb, note } = parseArgs(e.args)
    if (verb === 'help') return { text: usage(owned, (await $.session.usage()).context.tokens) }
    const surfaces = await $.session.surfaces()
    const surface = surfaces.includes('desktop') ? 'desktop' : surfaces[0]
    // The command holds the session until it returns, and compacting under it is refused.
    $.clock.after(0, () => void run($, o, actionFor(verb, surface), note, surface))

    return { text: `handoff: ${LABEL[actionFor(verb, surface)]}…` }
  }).catch(($, e, next) => (next.called ? next(e) : e.command === owned ? { text: 'handoff: the command failed; see the debug log.' } : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || !['terminal', 'desktop', 'vscode'].includes(e.surface)) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    let row
    if (busy !== null) {
      row = <Text dimColor>handoff: {busy}…</Text>
    } else {
      const tokens = (await $.session.usage()).context.tokens ?? 0
      if (e.props.isWorking || tokens < o.thresholdK * 1000) return below
      const press = (action: Action) => (p: { surface: RenderSurface }) => void run($, o, action, '', p.surface)
      const buttons: [Action, string][] =
        e.surface === 'desktop'
          ? [['compact', 'Compact'], ['copy', 'Copy handoff'], ['ask', 'Ask Claude for a new session']]
          : [['compact', 'Compact'], ['new', 'New session']]
      row = (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>handoff ({Math.round(tokens / 1000)}k)</Text>
          {buttons.map(([action, label]) => (
            <Button key={`handoff-${action}`} label={label} onPress={press(action)} />
          ))}
        </Box>
      )
    }
    if (below === undefined || below === null) return row

    // A desktop or VS Code button is taller than a line of text: without the gap it rides up
    // over the row above it.
    return (
      <Box flexDirection="column" gap={e.surface === 'terminal' ? 0 : 1}>
        {below}
        {row}
      </Box>
    )
  })
}
