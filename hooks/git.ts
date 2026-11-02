import type { GitState } from '../types'

/** The last path segment of `git rev-parse --show-toplevel`. */
export const repoName = (toplevel: string): string =>
  toplevel.trim().replace(/\/+$/, '').split('/').pop() ?? ''

/** Reads `git status --porcelain=v2 --branch`, as the status line script does. */
export const parseStatus = (stdout: string, repo: string): GitState => {
  let branch = '?'
  let oid = ''
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflict = 0

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length)
    } else if (line.startsWith('# branch.oid ')) {
      oid = line.slice('# branch.oid '.length, '# branch.oid '.length + 7)
    } else if (line.startsWith('# branch.ab ')) {
      const [a = '', b = ''] = line.slice('# branch.ab '.length).split(' ')
      ahead = Number(a.replace('+', ''))
      behind = Number(b.replace('-', ''))
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.split(' ')[1] ?? '..'
      if (xy[0] !== '.') staged++
      if (xy[1] !== '.') unstaged++
    } else if (line.startsWith('u ')) {
      conflict++
    } else if (line.startsWith('? ')) {
      untracked++
    }
  }

  const flags = [
    staged > 0 ? `+${staged}` : '',
    unstaged > 0 ? `●${unstaged}` : '',
    untracked > 0 ? `?${untracked}` : '',
    conflict > 0 ? `✖${conflict}` : '',
    ahead > 0 ? `↑${ahead}` : '',
    behind > 0 ? `↓${behind}` : '',
  ].filter(f => f !== '')

  return { repo, branch: branch === '(detached)' ? oid : branch, flags: flags.join(' ') }
}
