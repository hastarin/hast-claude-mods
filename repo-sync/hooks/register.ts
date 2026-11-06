import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_WATCH, type Last, type Outcome, expandHome, noteText, parseList, statusText, syncRepo, timeoutMs, toastText } from './sync'

// Rebuilt on each load; a reload mid-session pulls again at the next start.
let pending: Promise<readonly Outcome[]> | null = null
let note: string | null = null

const COMMAND = 'repo-sync'
// The store key holding the last sync, so `/repo-sync` can say what it did on any surface.
const LAST = 'last'

const homeOf = async ($: EngineInterface): Promise<string | undefined> =>
  (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

const syncAll = async ($: EngineInterface, options: Record<string, unknown>): Promise<readonly Outcome[]> => {
  const repos = parseList(options.repos)
  const watch = options.watch === undefined ? DEFAULT_WATCH : parseList(options.watch)
  const limit = timeoutMs(options.timeoutSeconds)
  const home = await homeOf($)
  // No prompt for credentials: a pull that needs them fails instead of hanging.
  const run = (argv: readonly string[]) =>
    $.process.run(argv, { timeoutMs: limit, env: { GIT_TERMINAL_PROMPT: '0' } })

  const outcomes = await Promise.all(repos.map(r => syncRepo(run, expandHome(r, home), r, watch)))
  note = noteText(outcomes)
  // Remembered for `/repo-sync`; a store that fails never loses the sync itself.
  try {
    const last: Last = { at: await $.clock.now(), outcomes }
    await $.store.set(LAST, last)
  } catch {}

  return outcomes
}

const toastAll = ($: EngineInterface, outcomes: readonly Outcome[]) => {
  for (const o of outcomes) {
    const text = toastText(o)
    if (text !== null) $.ui.toast(`repo-sync: ${text}`)
  }
}

/** `/repo-sync`: what the last sync did. `/repo-sync now`: pull again and say what that did. */
const runCommand = async ($: EngineInterface, options: Record<string, unknown>, args: string): Promise<{ text: string; context: string[] }> => {
  const verb = args.trim().toLowerCase()
  if (verb === 'now') {
    pending = syncAll($, options).catch(() => [])
    const outcomes = await pending
    const text = statusText({ at: 0, outcomes }, 0, 'Synced just now:')

    // Claude is told at once when a watched file changed, as well as from the next prompt on.
    return { text, context: note === null ? [text] : [text, note] }
  }
  if (verb !== '') {
    const text = 'Usage: /repo-sync to see what the last sync did, /repo-sync now to pull again.'

    return { text, context: [text] }
  }
  const stored = await $.store.get(LAST)
  const last = typeof stored === 'object' && stored !== null && 'at' in stored ? (stored as Last) : undefined
  const text = statusText(last, await $.clock.now())

  return { text, context: [text] }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    note = null
    // Started, not awaited: the session opens while the pulls run.
    pending = syncAll($, options)
      .then(outcomes => {
        if (e.isInteractive) toastAll($, outcomes)
        return outcomes
      })
      .catch(() => [])
    // After the pulls start: a surface that cannot take the command still syncs.
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Show what the last repo sync did, or pull the listed repos again with now',
        argumentHint: '[now]',
      })
    } catch {}

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => runCommand($, options, e.args)).catch((_$, e, next) =>
    next.called ? next(e) : { text: 'The command failed; see the debug log.' },
  )

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // Each pull has its own timeout, so the first prompt waits at most that long.
    if (pending !== null) await pending
    if (note === null) return composed

    return { sections: [...composed.sections, { id: 'repo-sync:note', text: note, scope: 'session' }] }
  })
}
