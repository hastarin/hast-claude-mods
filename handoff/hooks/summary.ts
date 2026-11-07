// Pure helpers: the summary's text, the saved file and the prompts built from it.

/**
 * What a summary written without compacting covers. A compaction needs none: the engine's own
 * prompt runs, and anything passed to it is added on top.
 */
export const FORK_INSTRUCTIONS = [
  'Write this summary as a handoff to a fresh session that has none of this conversation.',
  'Cover, under headings: what was done and what is next; decisions made and constraints to keep;',
  'files touched, with their paths; open questions.',
  "Quote the user's own messages that still matter, word for word.",
].join(' ')

export type Verb = 'compact' | 'new' | 'copy'

/** `/handoff [compact|new|copy] [note]`: the verb, and the rest as a note. */
export const parseArgs = (args: string): { verb: Verb | 'help'; note: string } => {
  const text = args.trim()
  const [first = '', ...rest] = text.split(/\s+/)
  const word = first.toLowerCase()
  if (word === 'compact' || word === 'new' || word === 'copy') return { verb: word, note: rest.join(' ').trim() }
  if (text === '' || word === 'help') return { verb: 'help', note: '' }

  return { verb: 'help', note: text }
}

/** The instructions the summarizer gets: the base, plus the person's note when there is one. */
export const withNote = (base: string, note: string): string =>
  note === '' ? base : `${base}\nThe user adds: ${note}`

/** `~` as the home folder, with the rest of the path written in the home folder's own separator. */
export const expandHome = (path: string, home: string | undefined): string => {
  if (home === undefined || !(path === '~' || path.startsWith('~/') || path.startsWith('~\\'))) return path
  const sep = home.includes('\\') ? '\\' : '/'

  return `${home.replace(/[\\/]+$/, '')}${path.slice(1).replace(/[\\/]/g, sep)}`
}

/** A file in a folder, joined with the folder's own separator. */
export const joinPath = (dir: string, name: string): string => {
  const sep = dir.includes('\\') ? '\\' : '/'

  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `<session id>-<yyyymmdd-hhmmss>.md`, in local time, so the files sort by when they were made. */
export const fileName = (sessionId: string, ms: number): string => {
  const d = new Date(ms)
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

  return `${sessionId}-${date}-${time}.md`
}

/**
 * The summary without the engine's wrapper: the preamble, its reminders, and the closing lines
 * telling the model to resume without asking, which are wrong for a session the person starts.
 * The old transcript's path is kept apart, for the saved file to name.
 */
export const cleanSummary = (raw: string): { summary: string; transcript: string | null } => {
  const transcript = /read the full transcript at:\s*(\S+\.jsonl)/.exec(raw)?.[1] ?? null
  let text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  const heading = /^Summary:[ \t]*$/m.exec(text)
  if (heading !== null) text = text.slice(heading.index + heading[0].length)
  else text = text.replace(/^\s*This session is being continued from a previous conversation[^\n]*\n/, '')
  for (const tail of ['If you need specific details from before compaction', 'Continue the conversation from where it left off']) {
    const at = text.indexOf(tail)
    if (at >= 0) text = text.slice(0, at)
  }

  return { summary: text.trim(), transcript }
}

const DAY_MS = 86_400_000

/** `keepFor` in days: `"30 days"` is 30; `"Never"`, or anything unreadable, keeps every file. */
export const keepDays = (value: unknown): number | null => {
  const m = typeof value === 'string' ? /^\s*(\d+)\s+days?\s*$/i.exec(value) : null
  const days = m === null ? 0 : Number(m[1])

  return days > 0 ? days : null
}

// A name `fileName` writes: the session id, then the date and time it was saved.
const SAVED_NAME = /^[0-9A-Za-z][0-9A-Za-z-]*-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.md$/

/** When a handoff was saved, read from its name in local time; null for any file the mod did not name. */
const savedAtOf = (name: string): number | null => {
  const m = SAVED_NAME.exec(name)
  if (m === null) return null
  const [y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0] = m.slice(1).map(Number)

  return new Date(y, mo - 1, d, h, mi, s).getTime()
}

/** The handoffs saved more than `days` ago; every file the mod did not name is left out. */
export const expiredHandoffs = (names: readonly string[], now: number, days: number): string[] =>
  names.filter(name => {
    const at = savedAtOf(name)

    return at !== null && at < now - days * DAY_MS
  })

/** The command that deletes `names` from the folder it runs in, with no shell between. */
export const deleteArgv = (isWindows: boolean, names: readonly string[]): string[] =>
  isWindows ? ['cmd', '/d', '/c', 'del', '/q', '/f', ...names] : ['rm', '-f', '--', ...names]

export type Handoff = {
  sessionId: string
  cwd: string
  savedAt: number
  transcript: string | null
  note: string
  summary: string
}

/** The saved file: where it came from, how to get back to it, and the summary. */
export const handoffText = (h: Handoff): string => {
  const lines = [
    `# Handoff from session ${h.sessionId}`,
    '',
    `- Saved: ${new Date(h.savedAt).toISOString()}`,
    `- Folder: ${h.cwd}`,
    `- Resume the old session: \`claude --resume ${h.sessionId}\``,
  ]
  if (h.transcript !== null) lines.push(`- Its full transcript: ${h.transcript}`)
  if (h.note !== '') lines.push('', '## Note', '', h.note)
  lines.push('', '## Summary', '', h.summary, '')

  return lines.join('\n')
}

/** The new session's first message. */
export const seedText = (saved: string, file: string): string =>
  [
    'Continuing from an earlier session.',
    `Its handoff follows, also saved at \`${file}\`.`,
    'Read it, say in one line where things stand, then wait for my go-ahead.',
    '',
    saved,
  ].join('\n')

/** What the desktop app's prompt box is filled with: the person sends it, in their own words. */
export const askText = (file: string): string =>
  [
    'Start a new session to carry on this work.',
    `Give it the handoff saved at \`${file}\` as its brief, word for word,`,
    'and tell it to say in one line where things stand, then wait for my go-ahead.',
  ].join(' ')
