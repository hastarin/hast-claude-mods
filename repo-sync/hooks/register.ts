import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_WATCH, type Outcome, expandHome, noteText, parseList, syncRepo, timeoutMs, toastText } from './sync'

// Rebuilt on each load; a reload mid-session pulls again at the next start.
let pending: Promise<readonly Outcome[]> | null = null
let note: string | null = null

const homeOf = async ($: EngineInterface): Promise<string | undefined> =>
  (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

const syncAll = async ($: EngineInterface, options: Record<string, unknown>, isInteractive: boolean) => {
  const repos = parseList(options.repos)
  const watch = options.watch === undefined ? DEFAULT_WATCH : parseList(options.watch)
  const limit = timeoutMs(options.timeoutSeconds)
  const home = await homeOf($)
  // No prompt for credentials: a pull that needs them fails instead of hanging.
  const run = (argv: readonly string[]) =>
    $.process.run(argv, { timeoutMs: limit, env: { GIT_TERMINAL_PROMPT: '0' } })

  const outcomes = await Promise.all(repos.map(r => syncRepo(run, expandHome(r, home), r, watch)))
  note = noteText(outcomes)
  if (isInteractive) {
    for (const o of outcomes) {
      const text = toastText(o)
      if (text !== null) $.ui.toast(`repo-sync: ${text}`)
    }
  }

  return outcomes
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    note = null
    // Started, not awaited: the session opens while the pulls run.
    pending = syncAll($, options, e.isInteractive).catch(() => [])

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // Each pull has its own timeout, so the first prompt waits at most that long.
    if (pending !== null) await pending
    if (note === null) return composed

    return { sections: [...composed.sections, { id: 'repo-sync:note', text: note, scope: 'session' }] }
  })
}
