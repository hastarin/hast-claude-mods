import { expect, test } from 'claude-code/testing'

import { apply, changedKeys, expandHome, parseSettings, withdraw } from './merge'

test('a shared value wins, and keys only this machine has are left alone', () => {
  expect(apply({ model: 'opus' }, {}, { model: 'sonnet', voice: { enabled: false } })).toEqual({
    model: 'opus',
    voice: { enabled: false },
  })
})

test('objects merge key by key, at any depth', () => {
  const shared = { pluginConfigs: { 'a@m': { options: { x: 1 } }, 'b@m': { options: { z: 3 } } } }
  const own = { pluginConfigs: { 'a@m': { options: { x: 9, local: true } } } }
  expect(apply(shared, {}, own)).toEqual({
    pluginConfigs: { 'a@m': { options: { x: 1, local: true } }, 'b@m': { options: { z: 3 } } },
  })
})

test('lists join, this machine first, without repeats', () => {
  const shared = { permissions: { allow: ['Bash(gh issue *)', 'Bash(npx -y gh-axi)'] } }
  const own = { permissions: { allow: ['Bash(npx -y gh-axi)', 'Read(//c/x/**)'], defaultMode: 'auto' } }
  expect(apply(shared, {}, own)).toEqual({
    permissions: { allow: ['Bash(npx -y gh-axi)', 'Read(//c/x/**)', 'Bash(gh issue *)'], defaultMode: 'auto' },
  })
})

test('lists of objects, such as hook groups, join by equal content', () => {
  const group = { hooks: [{ type: 'command', command: 'echo hi' }] }
  expect(apply({ hooks: { Stop: [group] } }, {}, { hooks: { Stop: [{ ...group }] } })).toEqual({ hooks: { Stop: [group] } })
})

test('a list entry dropped from the shared file is taken out, and this machine\'s stay', () => {
  const prev = { permissions: { allow: ['A', 'B'] } }
  const own = { permissions: { allow: ['A', 'B', 'Mine'] } }
  expect(apply({ permissions: { allow: ['A'] } }, prev, own)).toEqual({ permissions: { allow: ['A', 'Mine'] } })
})

test('a value dropped from the shared file stays as this machine has it, no longer synced', () => {
  const prev = { model: 'opus', theme: 'dark', pluginConfigs: { 'a@m': { options: { x: 1 } } } }
  const own = { model: 'opus', theme: 'light', pluginConfigs: { 'a@m': { options: { x: 1, local: true } } } }
  expect(apply({}, prev, own)).toEqual(own)
})

test('list entries under a dropped key are still taken out', () => {
  const prev = { permissions: { allow: ['A'], defaultMode: 'auto' } }
  expect(apply({}, prev, { permissions: { allow: ['A', 'Mine'], defaultMode: 'auto' } })).toEqual({
    permissions: { allow: ['Mine'], defaultMode: 'auto' },
  })
  expect(withdraw({ a: [1] }, { a: [1] })).toBe(undefined)
  expect(withdraw(['x'], ['x', 'y'])).toEqual(['y'])
})

test('applying the same shared file twice changes nothing more', () => {
  const shared = { model: 'opus', permissions: { allow: ['A'] }, hooks: { Stop: [{ hooks: [] }] } }
  const once = apply(shared, {}, { permissions: { allow: ['Mine'] } })
  expect(apply(shared, shared, once)).toEqual(once)
})

test('changed keys are named at the top level', () => {
  expect(changedKeys({ model: 'a', x: 1, gone: true }, { model: 'b', x: 1, added: 2 })).toEqual(['model', 'gone', 'added'])
})

test('a settings file must be a JSON object; $schema is dropped', () => {
  expect(parseSettings('{ "$schema": "https://x", "model": "opus" }')).toEqual({ kind: 'ok', settings: { model: 'opus' } })
  expect(parseSettings('[1]')).toEqual({ kind: 'failed', reason: 'not a JSON object' })
  expect(parseSettings('{ model: opus }').kind).toBe('failed')
})

test('~ expands to the home folder', () => {
  expect(expandHome('~/.agents/claude/settings.json', '/home/jon')).toBe('/home/jon/.agents/claude/settings.json')
  expect(expandHome('~\\.agents\\s.json', 'C:\\Users\\hasta')).toBe('C:\\Users\\hasta/.agents\\s.json')
  expect(expandHome('/etc/s.json', '/home/jon')).toBe('/etc/s.json')
})
