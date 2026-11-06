/** How applying the shared file went. */
export type Outcome = { kind: 'current' } | { kind: 'applied'; keys: string[] } | { kind: 'failed'; reason: string }

/** A sync as `/settings-sync status` remembers it: when it ran and what it did. */
export type Last = { at: number; outcome: Outcome }

/** How long ago `then` was, in words: `just now`, `5 minutes ago`, `2 hours ago`, `3 days ago`. */
export const ago = (then: number, now: number): string => {
  const s = Math.max(0, Math.round((now - then) / 1000))
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`
  if (s < 60) return 'just now'
  if (s < 3600) return unit(Math.floor(s / 60), 'minute')
  if (s < 86_400) return unit(Math.floor(s / 3600), 'hour')

  return unit(Math.floor(s / 86_400), 'day')
}

/** What one sync did, in a sentence. */
export const outcomeText = (o: Outcome, file: string): string => {
  switch (o.kind) {
    case 'current':
      return `settings.json already matched ${file}, so nothing was written.`
    case 'applied':
      return `updated ${o.keys.join(', ')} in settings.json from ${file}; the old file is in settings.json.settings-sync.bak.`
    case 'failed':
      return `not applied: ${o.reason}`
  }
}

/** What `/settings-sync status` prints: the last sync, or that none has run yet. */
export const statusText = (last: Last | undefined, now: number, file: string): string =>
  last === undefined
    ? 'No sync has run on this machine yet. Run /settings-sync now to sync now.'
    : `Last sync, ${ago(last.at, now)}: ${outcomeText(last.outcome, file)}`

/** Reads back what the store holds for the last sync, or undefined when it is not one. */
export const asLast = (value: unknown): Last | undefined =>
  typeof value === 'object' && value !== null && 'at' in value && 'outcome' in value ? (value as Last) : undefined
