import { expect, test } from 'claude-code/testing'

import { drift, line, omit, parsePaths, promote, refusal, report } from './drift'
import { apply } from './merge'

test('skip paths split on commas and newlines, with dots reaching inside', () => {
  expect(parsePaths(' env, pluginConfigs.usage-bar@m\nhooks.Stop ,, ')).toEqual([
    ['env'],
    ['pluginConfigs', 'usage-bar@m'],
    ['hooks', 'Stop'],
  ])
  expect(parsePaths(undefined)).toEqual([])
})

test('omit drops a whole setting or one part of it', () => {
  const s = { env: { A: '1' }, pluginConfigs: { 'a@m': { x: 1 }, 'b@m': { y: 2 } }, theme: 'dark' }
  expect(omit(s, parsePaths('env, pluginConfigs.a@m'))).toEqual({ pluginConfigs: { 'b@m': { y: 2 } }, theme: 'dark' })
})

test('a skipped setting is neither written nor taken out', () => {
  const skip = parsePaths('env')
  const own = { env: { MINE: '1' }, theme: 'light' }
  const shared = omit({ env: { SHARED: '1' }, theme: 'dark' }, skip)
  expect(apply(shared, omit({ env: { MINE: '1' } }, skip), own)).toEqual({ env: { MINE: '1' }, theme: 'dark' })
})

test('drift lists values set differently, values only here, and list entries only here', () => {
  const shared = { theme: 'dark', permissions: { allow: ['A'], defaultMode: 'auto' } }
  const own = { theme: 'light', voice: { enabled: false }, permissions: { allow: ['A', 'Mine'], defaultMode: 'auto' } }
  expect(drift(shared, own)).toEqual([
    { kind: 'value', path: ['theme'], value: 'light', shared: 'dark' },
    { kind: 'value', path: ['voice', 'enabled'], value: false, shared: undefined },
    { kind: 'entry', path: ['permissions', 'allow'], value: 'Mine' },
  ])
  expect(drift(shared, own, parsePaths('voice, permissions.allow'))).toEqual([
    { kind: 'value', path: ['theme'], value: 'light', shared: 'dark' },
  ])
})

test('promote copies values and list entries into the shared file, keeping what is there', () => {
  const shared = { $schema: 'x', permissions: { allow: ['A'] } }
  const items = drift(shared, { voice: { enabled: false }, permissions: { allow: ['A', 'Mine'] } })
  expect(promote(shared, items)).toEqual({ $schema: 'x', permissions: { allow: ['A', 'Mine'] }, voice: { enabled: false } })
  expect(shared.permissions.allow).toEqual(['A'])
  // Once copied, nothing is left to list.
  expect(drift(promote(shared, items), { voice: { enabled: false }, permissions: { allow: ['A', 'Mine'] } })).toEqual([])
})

test('an env variable whose name looks like a secret is refused', () => {
  expect(refusal({ kind: 'value', path: ['env', 'GITHUB_TOKEN'], value: 'x', shared: undefined })).toMatch(/looks like a secret/)
  expect(refusal({ kind: 'value', path: ['env', 'CLAUDE_CODE_SUBAGENT_MODEL'], value: 'sonnet', shared: undefined })).toBe(null)
})

test('the report numbers items and says how to add them', () => {
  const items = drift({ theme: 'dark' }, { theme: 'light', permissions: { allow: ['Mine'] } })
  const text = report(items, '~/s.json')
  expect(text).toContain('1. theme: "light" (shared: "dark")')
  expect(text).toContain('2. permissions.allow: + "Mine"')
  expect(text).toContain('/settings-sync add 2')
  expect(report([], '~/s.json')).toBe("This machine's settings.json has nothing that ~/s.json lacks.")
  expect(line(9, { kind: 'entry', path: ['x'], value: 'y'.repeat(200) }).length).toBeLessThan(120)
})
