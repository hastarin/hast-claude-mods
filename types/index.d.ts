export type Snapshot = {
  tokens: number
  window: number
  percent: number
  q5: number | null
  q7: number | null
  /** When each quota window resets, epoch ms; null when the reading names none. */
  r5: number | null
  r7: number | null
  usd: number
  /** Session cost when a quota window first hit 100%; null while under quota. */
  overageBase: number | null
}

export type Quota = Pick<Snapshot, 'q5' | 'q7' | 'r5' | 'r7'>

/** The newest quota reading a session has had, left in the store for the others. */
export type SharedQuota = Quota & {
  /** When the response that carried it came back, epoch ms. */
  at: number
}

export type Ttl = '5m' | '1h'

export type CacheClock = {
  /** When the last request that kept the cache alive was sent; null after a reset. */
  at: number | null
  /** The session's model at that request. */
  model: string
  /** The lifetime a request has proved, which beats the expected one. */
  learned: Ttl | null
}

export type GitState = {
  repo: string
  branch: string
  /** The working tree state, such as `+1 ●2 ?3 ↑1`; empty when clean and in step. */
  flags: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': {
      snapshot: Snapshot | null
      /** When the quota in the snapshot was read; 0 until a reply has read one. */
      quotaAt: number
      cache: CacheClock | null
      git: GitState | null
      effort: string | null
    }
  }
}
