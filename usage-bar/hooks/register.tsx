import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, SessionUsage } from 'claude-code'

import type { CacheClock, GitState, Quota, Snapshot } from '../types'
import { type TtlInputs, cacheLabel, isOn, served } from './cache'
import { SURFACES, contextLimits, features } from './config'
import {
  FIVE_HOURS,
  GOLD,
  SEVEN_DAYS,
  bar,
  barCells,
  contextGauge,
  creditUsd,
  effortTone,
  isOverage,
  modelName,
  modelTone,
  plain,
  quotaGauge,
  ramp,
  resetAt,
  ring,
  settled,
  sharedQuota,
  timeLeft,
  totalK,
  usedK,
} from './format'
import { parseStatus, remoteName, repoName } from './git'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)
const quotaAt = atom({ plugin: 'usage-bar', key: 'quotaAt' } as const, 0)
const cache = atom({ plugin: 'usage-bar', key: 'cache' } as const, null)
const git = atom({ plugin: 'usage-bar', key: 'git' } as const, null)
const effort = atom({ plugin: 'usage-bar', key: 'effort' } as const, null)

type Figures = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>

// The tick only compares strings; the band redraws when one changes.
const TICK_MS = 10_000
const GIT_EVERY_MS = 60_000
const GIT_TIMEOUT_MS = 5_000
// Every session of an install reads and writes this one store entry.
const QUOTA_KEY = 'quota'

// Rebuilt on each load: everything a reload must keep is in an atom.
let ttlInputs: TtlInputs = { force5m: false, enable1h: false }
let drawn = ''
let gitWanted = false
let gitDue = true
let gitBusy = false
let gitAt = 0
let named: { cwd: string; repo: string } | null = null

const percentOf = (tokens: number, window: number): number => (window > 0 ? (tokens * 100) / window : 0)

/** Leaves a reading for the other sessions, unless one of them got in later. */
const share = async ($: EngineInterface, quota: Quota): Promise<void> => {
  const at = await $.clock.now()
  await update($, quotaAt, () => at)
  const held = sharedQuota(await $.store.get(QUOTA_KEY))
  if (held === null || held.at < at) await $.store.set(QUOTA_KEY, { ...quota, at })
}

/** Takes another session's reading if it is newer than this one's. */
const adopt = async ($: EngineInterface): Promise<void> => {
  // Without a reading of its own a session may not be on a subscription at all.
  const s = await read($, snapshot)
  if (s === null || (s.q5 === null && s.q7 === null)) return
  const held = sharedQuota(await $.store.get(QUOTA_KEY))
  if (held === null || held.at <= (await read($, quotaAt))) return

  const { at, ...quota } = held
  await update($, quotaAt, () => at)
  await update($, snapshot, (prev: Snapshot | null) =>
    prev === null ? null : { ...prev, ...quota, overageBase: isOverage(quota) ? (prev.overageBase ?? prev.usd) : null },
  )
}

/**
 * Reads the session's figures. `replied` says a response has just brought a new
 * quota reading: without that, the engine's is only as new as this session's
 * last response, and one taken from another session may be newer.
 */
const refresh = async ($: EngineInterface, figures?: Figures, replied = false): Promise<Snapshot | null> => {
  const { context, rateLimits, cost } = figures ?? (await $.session.usage())
  const limit = (kind: string) => rateLimits.find(r => r.kind === kind)?.percentUsed ?? null
  const resets = (kind: string) => resetAt(rateLimits.find(r => r.kind === kind)?.resetsAt)
  const usd = cost?.usd ?? 0
  const own: Quota = {
    q5: limit('five_hour'),
    q7: limit('seven_day'),
    r5: resets('five_hour'),
    r7: resets('seven_day'),
  }
  const keep = !replied && (await read($, quotaAt)) > 0

  await update($, snapshot, (prev: Snapshot | null): Snapshot => {
    // No reading between a compaction and the next response: keep its size.
    const tokens = context.tokens ?? prev?.tokens ?? 0
    const quota: Quota = keep && prev !== null ? { q5: prev.q5, q7: prev.q7, r5: prev.r5, r7: prev.r7 } : own

    return {
      tokens,
      window: context.window,
      percent: context.percent ?? percentOf(tokens, context.window),
      ...quota,
      usd,
      // Cost does not split plan-covered from credit spend: snapshot the total
      // when overage is first seen, and drop it once back under quota.
      overageBase: isOverage(quota) ? (prev?.overageBase ?? usd) : null,
    }
  })
  if (replied && (own.q5 !== null || own.q7 !== null)) await share($, own).catch(() => undefined)

  // Nothing is pinned to the status line: the band already draws the
  // figures, in colour, on every surface that has one.
  return read($, snapshot)
}

const refreshGit = async ($: EngineInterface, now: number): Promise<void> => {
  gitBusy = true
  gitDue = false
  gitAt = now
  try {
    // Optional locks off, so this never gets in the way of a git the model runs.
    const status = await $.process.run(
      ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'],
      { timeoutMs: GIT_TIMEOUT_MS },
    )
    let next: GitState | null = null
    if (status.exitCode === 0) {
      const cwd = await $.session.cwd()
      if (named?.cwd !== cwd) {
        // Named after origin, as the desktop app does, so worktrees and clones read the same.
        const origin = await $.process.run(['git', 'remote', 'get-url', 'origin'], {
          timeoutMs: GIT_TIMEOUT_MS,
        })
        let repo = origin.exitCode === 0 ? remoteName(origin.stdout) : ''
        if (repo === '') {
          const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], {
            timeoutMs: GIT_TIMEOUT_MS,
          })
          repo = repoName(top.stdout)
        }
        named = { cwd, repo }
      }
      next = parseStatus(status.stdout, named.repo)
    }
    if (JSON.stringify(next) !== JSON.stringify(await read($, git))) {
      await update($, git, () => next)
    }
  } catch {
    // No git, or a repository too slow to read: the band keeps what it has.
  } finally {
    gitBusy = false
  }
}

/** Everything on the band that moves with the clock alone. */
const moving = (held: Snapshot | null, clock: CacheClock | null, now: number): string => {
  if (held === null) return ''
  const s = settled(held, now)

  return [
    cacheLabel(clock, ttlInputs, s, now)?.text,
    timeLeft(s.r5, now),
    timeLeft(s.r7, now),
    quotaGauge(s.q5 ?? 0, s.r5, FIVE_HOURS, now),
    quotaGauge(s.q7 ?? 0, s.r7, SEVEN_DAYS, now),
  ].join('|')
}

const tick = async ($: EngineInterface): Promise<void> => {
  await adopt($).catch(() => undefined)
  const now = await $.clock.now()
  const shown = moving(await read($, snapshot), await read($, cache), now)
  if (shown !== drawn) {
    drawn = shown
    $.ui.invalidate('ui.render')
  }
  if (gitWanted && !gitBusy && (gitDue || now - gitAt >= GIT_EVERY_MS)) await refreshGit($, now)
}

const keptAlive = async ($: EngineInterface, at: number, usage: ModelUsage): Promise<void> => {
  const model = await $.session.model()
  await update($, cache, (prev: CacheClock | null) => served(prev, at, model, usage))
}

const forget = async ($: EngineInterface, tokens: number): Promise<void> => {
  await update($, cache, (prev: CacheClock | null) => (prev === null ? null : { ...prev, at: null }))
  await update($, snapshot, (prev: Snapshot | null) =>
    prev === null ? null : { ...prev, tokens, percent: percentOf(tokens, prev.window) },
  )
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-bar',
      description: 'Print the usage bar (git, model, context, 5h/7d quota, cache, cost)',
    })
    await refresh($)

    ttlInputs = {
      force5m: isOn(await $.env.get('FORCE_PROMPT_CACHING_5M')),
      envTtl: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      settingTtl: (await $.settings.read()).promptCacheTtl,
      enable1h: isOn(await $.env.get('ENABLE_PROMPT_CACHING_1H')),
    }
    // A timer started inside a turn dies with it; this one lasts until a reload.
    if (SURFACES.some(surface => features(options, surface).display)) {
      $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    }

    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => {
    await refresh($)
    await adopt($).catch(() => undefined)
    const held = await read($, snapshot)
    if (held === null) return { text: 'No usage reading yet.' }

    const at = await $.clock.now()
    const now = settled(held, at)
    await refreshGit($, at)
    const model = await $.session.model()

    return {
      text: plain(now, at, {
        git: await read($, git),
        model: modelName(model),
        effort: await read($, effort),
        cache: cacheLabel(await read($, cache), ttlInputs, now, at)?.text ?? null,
      }),
    }
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e, e.changed.includes('rateLimits'))

    return next(e)
  })

  // The cache's clock runs from when a request is sent. A subagent's requests
  // carry a prefix of their own, so only the main thread's keep this one alive.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const at = await $.clock.now()
    const result = yield* next(e)
    if (result.usage) {
      await keptAlive($, at, result.usage)
      await update($, effort, () => (e.effort === undefined ? null : String(e.effort)))
      // session.measure waits for the end of the turn, and a turn can be long.
      await refresh($, undefined, true).catch(() => null)
    }
    // A turn's edits are what git most often has news of.
    gitDue = true

    return result
  })

  // A fork, such as a keep-alive ping, renews the main thread's cache entry
  // without a turn.step; an api-error's usage is all zeros and renews nothing.
  on('model.fork', async ($, e, next) => {
    const at = await $.clock.now()
    const result = await next(e)
    const reply = result.value
    if (reply !== undefined && 'usage' in reply && reply.usage.cache_read_input_tokens + reply.usage.cache_creation_input_tokens > 0) {
      await keptAlive($, at, reply.usage).catch(() => undefined)
    }

    return result
  })

  // After a /clear or a compaction the next request writes a new prefix, and
  // the engine reports no context until that response. session.end also fires
  // on exit, where nothing is left to draw.
  on('session.end', async ($, e, next) => {
    await forget($, 0)

    return next(e)
  })
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      await forget($, result.tokensAfter ?? 0).catch(() => undefined)
    }

    return result
  })

  // The coloured bar: context by its level, each quota window by its pace. The
  // band is shared, so what other plugins drew beneath this hook stays.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const show = features(options, e.surface)
    const held = await read($, snapshot)
    if (!show.display || e.props.hasSurvey || held === null) return below

    if (show.git) gitWanted = true
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const s = settled(held, now)
    const fill = ramp(contextGauge(s.tokens, s.percent, contextLimits(options)))
    const five = ramp(quotaGauge(s.q5 ?? 0, s.r5, FIVE_HOURS, now))
    const seven = ramp(quotaGauge(s.q7 ?? 0, s.r7, SEVEN_DAYS, now))
    const hasQuota = s.q5 !== null || s.q7 !== null
    const credit = creditUsd(s)
    const clock = await read($, cache)
    const repo = show.git ? await read($, git) : null
    const countdown = show.cache ? cacheLabel(clock, ttlInputs, s, now) : null
    const model = show.model ? await $.session.model() : null
    const level = show.model ? await read($, effort) : null
    const tone = model === null ? null : modelTone(model)
    const strength = level === null ? null : effortTone(level)
    const line = plain(s, now, {
      git: repo,
      model: model === null ? null : modelName(model),
      effort: level,
      cache: countdown?.text ?? null,
    })
    const cells = barCells(line.length, e.props.bodyColumns)
    const { on: filled, off } = bar(s.percent, cells)
    drawn = moving(s, clock, now)

    return (
      <Box flexDirection="column">
        {below}
        <Text>
          {repo === null ? null : <Text color="cyan">{repo.repo}</Text>}
          {repo === null ? null : ' '}
          {repo === null ? null : <Text color="magenta">{repo.branch}</Text>}
          {repo === null || repo.flags === '' ? null : <Text color="yellow">{` ${repo.flags}`}</Text>}
          {repo === null ? null : '  '}
          {repo === null ? null : <Text dimColor>|</Text>}
          {repo === null ? null : '  '}
          {model === null || tone === null ? null : (
            <Text color={tone.color} bold={tone.bold}>
              {modelName(model)}
            </Text>
          )}
          {strength === null ? null : (
            <Text color={strength.color} bold={strength.bold} dimColor={strength.dim}>
              {` [${level}]`}
            </Text>
          )}
          {model === null ? null : '  '}
          {cells === 0 ? null : <Text dimColor>[</Text>}
          <Text color={fill.color} bold={fill.bold}>
            {cells === 0 ? ring(s.percent) : filled}
          </Text>
          {cells === 0 ? null : <Text dimColor>{`${off}]`}</Text>}
          {' '}
          <Text color={fill.color} bold={fill.bold}>
            {`${Math.round(s.percent)}%`}
          </Text>
          {'  '}
          <Text color={fill.color} bold={fill.bold}>
            {usedK(s.tokens)}
          </Text>
          {' '}
          <Text dimColor>{`/ ${totalK(s.window)}`}</Text>
          {hasQuota ? '  ' : ''}
          {hasQuota ? (
            <Text color={five.color} bold={five.bold}>
              {`5h ${Math.round(s.q5 ?? 0)}%${timeLeft(s.r5, now)}`}
            </Text>
          ) : null}
          {hasQuota ? ' ' : ''}
          {hasQuota ? <Text dimColor>·</Text> : null}
          {hasQuota ? ' ' : ''}
          {hasQuota ? (
            <Text color={seven.color} bold={seven.bold}>
              {`7d ${Math.round(s.q7 ?? 0)}%${timeLeft(s.r7, now)}`}
            </Text>
          ) : null}
          {countdown === null ? null : '  '}
          {countdown === null ? null : countdown.gone === null ? (
            <Text dimColor>{countdown.text}</Text>
          ) : (
            <Text color={ramp(countdown.gone).color} bold={ramp(countdown.gone).bold}>
              {countdown.text}
            </Text>
          )}
          {'  '}
          <Text dimColor>{`~$${s.usd.toFixed(2)}`}</Text>
          {credit === null ? null : ' '}
          {credit === null ? null : (
            <Text color={GOLD} bold>
              {`💰$${credit.toFixed(2)}`}
            </Text>
          )}
        </Text>
      </Box>
    )
  })
}
