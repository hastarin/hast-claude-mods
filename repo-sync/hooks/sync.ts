/** What running a command gave back: `$.process.run`'s result, or a failure to start. */
export type Run = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

/** How one repo's pull went. */
export type Outcome =
  | { kind: 'current'; repo: string; ahead: number }
  | { kind: 'updated'; repo: string; from: string; to: string; changed: string[]; ahead: number }
  | { kind: 'busy'; repo: string }
  | { kind: 'failed'; repo: string; reason: string }

export const DEFAULT_WATCH = ['AGENTS.md', 'CLAUDE.md']
export const DEFAULT_TIMEOUT_MS = 20_000

/** Splits a comma- or newline-separated option into its non-empty entries. */
export const parseList = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(s => s !== '')
    : []

/** The pull timeout in milliseconds; a missing, zero or nonsense value takes the default. */
export const timeoutMs = (value: unknown): number => {
  const seconds = Number(value)

  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TIMEOUT_MS
}

/** Expands a leading `~` to the home folder; any other path is left as written. */
export const expandHome = (path: string, home: string | undefined): string => {
  if (home === undefined || home === '') return path
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return `${home.replace(/[\\/]+$/, '')}/${path.slice(2)}`

  return path
}

/** The first line of git's complaint, without its `fatal:`/`error:` prefix. */
export const firstLine = (text: string): string =>
  (text.split(/\r?\n/).find(l => l.trim() !== '') ?? 'unknown error').replace(/^(fatal|error):\s*/, '').trim()

// Another session pulling the same repo at once: it holds git's lock, or its fetch landed in
// FETCH_HEAD beside this one's. Neither is a failure, and trying again soon usually gets through.
const isClash = (stderr: string): boolean =>
  /index\.lock|Unable to create '.*\.lock'|Cannot fast-forward to multiple branches/i.test(stderr)

// How many times a pull is tried when it clashes, and the wait between tries, spread at random
// so two sessions that clashed do not try again in step.
const PULL_TRIES = 3
const retryDelayMs = (): number => 500 + Math.floor(Math.random() * 1001)

const short = (sha: string): string => sha.slice(0, 7)

/** Whether a changed path is one of the watched file names, in any folder of the repo. */
export const watched = (path: string, watch: readonly string[]): boolean =>
  watch.includes(path.split('/').pop() ?? path)

/**
 * Fast-forwards one repo, never merging or forcing, and reports what changed.
 * `path` is the folder as it is run; `repo` is how it is named to the person.
 * `wait` pauses between tries of a pull that clashed with another session's.
 */
export const syncRepo = async (
  run: Run,
  path: string,
  repo: string,
  watch: readonly string[],
  wait: (ms: number) => Promise<void> = async () => {},
): Promise<Outcome> => {
  const git = (...args: string[]) => run(['git', '-C', path, ...args])
  const head = async () => {
    const r = await git('rev-parse', 'HEAD')

    return r.exitCode === 0 ? r.stdout.trim() : null
  }

  try {
    const from = await head()
    if (from === null) return { kind: 'failed', repo, reason: 'not a git repository' }

    // HEAD is read once, before the first try: what another session's pull brought in still
    // counts as changed here, so Claude hears about it.
    let pull = await git('pull', '--ff-only', '--quiet')
    for (let tries = 1; pull.exitCode !== 0 && isClash(pull.stderr) && tries < PULL_TRIES; tries++) {
      await wait(retryDelayMs())
      pull = await git('pull', '--ff-only', '--quiet')
    }
    if (pull.exitCode !== 0) {
      return isClash(pull.stderr) ? { kind: 'busy', repo } : { kind: 'failed', repo, reason: firstLine(pull.stderr) }
    }

    const to = (await head()) ?? from
    const counted = await git('rev-list', '--count', '@{upstream}..HEAD')
    // No upstream configured: nothing to be ahead of.
    const ahead = counted.exitCode === 0 ? Number(counted.stdout.trim()) || 0 : 0
    if (to === from) return { kind: 'current', repo, ahead }

    const diff = watch.length > 0 ? await git('diff', '--name-only', from, to) : null
    const changed = diff !== null && diff.exitCode === 0 ? parseList(diff.stdout).filter(f => watched(f, watch)) : []

    return { kind: 'updated', repo, from: short(from), to: short(to), changed, ahead }
  } catch (err) {
    // The command could not start (git missing) or ran past its timeout.
    return { kind: 'failed', repo, reason: err instanceof Error ? err.message : String(err) }
  }
}

const unpushed = (o: Outcome): string =>
  'ahead' in o && o.ahead > 0 ? ` It has ${o.ahead} local commit${o.ahead === 1 ? '' : 's'} not pushed yet.` : ''

/** The short line shown to the person, or null when there is nothing to say. */
export const toastText = (o: Outcome): string | null => {
  switch (o.kind) {
    case 'updated':
      return `${o.repo} updated ${o.from}..${o.to}${o.ahead > 0 ? `, ${o.ahead} unpushed` : ''}`
    case 'failed':
      return `${o.repo} not synced: ${o.reason}`
    case 'current':
      return o.ahead > 0 ? `${o.repo} has ${o.ahead} unpushed commit${o.ahead === 1 ? '' : 's'}` : null
    case 'busy':
      return null
  }
}

/** What Claude is told, or null when nothing it loaded could be stale. */
export const noteText = (outcomes: readonly Outcome[]): string | null => {
  const lines = outcomes.flatMap((o): string[] => {
    if (o.kind === 'updated' && o.changed.length > 0) {
      const files = o.changed.map(f => `${o.repo}/${f}`).join(', ')

      return [`${files} changed when ${o.repo} was pulled at the start of this session (${o.from}..${o.to}). The copy loaded into your instructions may be stale: re-read it before relying on it.${unpushed(o)}`]
    }
    if (o.kind === 'failed') {
      return [`${o.repo} could not be pulled at the start of this session (${o.reason}), so files loaded from it may be out of date.`]
    }
    const extra = unpushed(o)

    return extra === '' ? [] : [`${o.repo}:${extra}`]
  })

  return lines.length === 0 ? null : `# Repo sync\n\n${lines.map(l => `- ${l}`).join('\n')}`
}

/** How long ago `then` was, in words: `just now`, `5 minutes ago`, `2 hours ago`, `3 days ago`. */
export const ago = (then: number, now: number): string => {
  const s = Math.max(0, Math.round((now - then) / 1000))
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`
  if (s < 60) return 'just now'
  if (s < 3600) return unit(Math.floor(s / 60), 'minute')
  if (s < 86_400) return unit(Math.floor(s / 3600), 'hour')

  return unit(Math.floor(s / 86_400), 'day')
}

/** One repo's line in `/repo-sync`: what its last pull did. */
export const statusLine = (o: Outcome): string => {
  const extra = 'ahead' in o && o.ahead > 0 ? `; ${o.ahead} local commit${o.ahead === 1 ? '' : 's'} not pushed` : ''
  switch (o.kind) {
    case 'current':
      return `${o.repo}: already up to date${extra}`
    case 'updated':
      return `${o.repo}: updated ${o.from}..${o.to}${o.changed.length > 0 ? `, changing ${o.changed.join(', ')}` : ''}${extra}`
    case 'busy':
      return `${o.repo}: another session was pulling it at the same time`
    case 'failed':
      return `${o.repo}: not synced: ${o.reason}`
  }
}

/** A sync as `/repo-sync` remembers it: when it ran and what each repo did. */
export type Last = { at: number; outcomes: readonly Outcome[] }

/** What `/repo-sync` prints: the last sync, or that none has run yet. */
export const statusText = (last: Last | undefined, now: number, heading?: string): string => {
  if (last === undefined) return 'No sync has run on this machine yet. Run /repo-sync now to pull now.'
  if (last.outcomes.length === 0) return 'No repos are listed in the mod\'s settings, so there is nothing to pull.'
  const title = heading ?? `Last sync, ${ago(last.at, now)}:`

  return [title, ...last.outcomes.map(o => `  ${statusLine(o)}`)].join('\n')
}
