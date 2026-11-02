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

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { snapshot: Snapshot | null }
  }
}
