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
 * The token counts the context changes colour at, set in thousands. Any that is
 * missing, not a positive number or out of order falls back with the rest, so a
 * typo cannot leave the colours in a muddle.
 */
export const contextLimits = (options: Record<string, unknown>): ContextLimits => {
  const k = (name: string) => {
    const value = Number(options[name])

    return Number.isFinite(value) && value > 0 ? value * 1000 : Number.NaN
  }
  const limits = { amber: k('contextAmberK'), orange: k('contextOrangeK'), red: k('contextRedK') }

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
