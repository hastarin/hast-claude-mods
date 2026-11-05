import type { RenderSurface } from 'claude-code'

import { CONTEXT_LIMITS, type ContextLimits } from './format'

export type Features = { display: boolean; git: boolean; cache: boolean; model: boolean }

// A plugin's userConfig cannot vary by surface, so each environment has its own
// fields. A phone shares the desktop's: it has the same room and no status line.
const PREFIX: Record<RenderSurface, string> = {
  terminal: 'terminal',
  vscode: 'vscode',
  desktop: 'desktop',
  mobile: 'desktop',
}

export const SURFACES: readonly RenderSurface[] = ['terminal', 'vscode', 'desktop', 'mobile']

/**
 * The token counts the context changes colour at, set in thousands. A field
 * that is missing or not a positive number takes its own default; if the three
 * then are not in ascending order they all fall back, so a slip cannot leave the
 * colours in a muddle.
 */
export const contextLimits = (options: Record<string, unknown>): ContextLimits => {
  const k = (name: string, fallback: number) => {
    const value = Number(options[name])

    return Number.isFinite(value) && value > 0 ? value * 1000 : fallback
  }
  const limits = {
    amber: k('contextAmberK', CONTEXT_LIMITS.amber),
    orange: k('contextOrangeK', CONTEXT_LIMITS.orange),
    red: k('contextRedK', CONTEXT_LIMITS.red),
  }

  return limits.amber < limits.orange && limits.orange < limits.red ? limits : CONTEXT_LIMITS
}

/** What a surface shows; a segment needs the bar on as well as its own field. */
export const features = (options: Record<string, unknown>, surface: RenderSurface): Features => {
  const on = (name: string) => options[`${PREFIX[surface]}${name}`] === true
  const display = on('Display')

  return {
    display,
    git: display && on('Git'),
    cache: display && on('Cache'),
    model: display && on('Model'),
  }
}
