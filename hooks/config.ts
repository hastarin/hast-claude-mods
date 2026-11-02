import type { RenderSurface } from 'claude-code'

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
