import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, SessionUsage } from 'claude-code'

import type { CacheClock, GitState, Snapshot } from '../types'
import { type TtlInputs, cacheLabel, isOn, served } from './cache'
import { SURFACES, features } from './config'
import {
  FIVE_HOURS,
  GOLD,
  SEVEN_DAYS,
  bar,
  barCells,
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
  timeLeft,
  totalK,
  usedK,
} from './format'
import { parseStatus, repoName } from './git'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)
const cache = atom({ plugin: 'usage-bar', key: 'cache' } as const, null)
const git = atom({ plugin: 'usage-bar', key: 'git' } as const, null)
const effort = atom({ plugin: 'usage-bar', key: 'effort' } as const, null)

type Figures = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>

// The tick only compares strings; the band redraws when one changes.
const TICK_MS = 10_000
const GIT_EVERY_MS = 60_000
const GIT_TIMEOUT_MS = 5_000

// Rebuilt on each load: everything a reload must keep is in an atom.
let ttlInputs: TtlInputs = { force5m: false, enable1h: false }
let drawn = ''
let gitWanted = false
let gitDue = true
let gitBusy = false
let gitAt = 0
let named: { cwd: string; repo: string } | null = null

const percentOf = (tokens: number, window: number): number => (window > 0 ? (tokens * 100) / window : 0)

const refresh = async ($: EngineInterface, figures?: Figures): Promise<Snapshot | null> => {
  const { context, rateLimits, cost } = figures ?? (await $.session.usage())
  const limit = (kind: string) => rateLimits.find(r => r.kind === kind)?.percentUsed ?? null
  const resets = (kind: string) => resetAt(rateLimits.find(r => r.kind === kind)?.resetsAt)
  const usd = cost?.usd ?? 0
  const q5 = limit('five_hour')
  const q7 = limit('seven_day')

  await update($, snapshot, (prev: Snapshot | null): Snapshot => {
    // No reading between a compaction and the next response: keep its size.
    const tokens = context.tokens ?? prev?.tokens ?? 0

    return {
      tokens,
      window: context.window,
      percent: context.percent ?? percentOf(tokens, context.window),
      q5,
      q7,
      r5: resets('five_hour'),
      r7: resets('seven_day'),
      usd,
      // Cost does not split plan-covered from credit spend: snapshot the total
      // when overage is first seen, and drop it once back under quota.
      overageBase: isOverage({ q5, q7 }) ? (prev?.overageBase ?? usd) : null,
    }
  })

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
        const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], {
          timeoutMs: GIT_TIMEOUT_MS,
        })
        named = { cwd, repo: repoName(top.stdout) }
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
const moving = (s: Snapshot | null, clock: CacheClock | null, now: number): string => {
  if (s === null) return ''

  return [
    cacheLabel(clock, ttlInputs, s, now)?.text,
    timeLeft(s.r5, now),
    timeLeft(s.r7, now),
    quotaGauge(s.q5 ?? 0, s.r5, FIVE_HOURS, now),
    quotaGauge(s.q7 ?? 0, s.r7, SEVEN_DAYS, now),
  ].join('|')
}

const tick = async ($: EngineInterface): Promise<void> => {
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
    const now = await refresh($)
    if (now === null) return { text: 'No usage reading yet.' }

    const at = await $.clock.now()
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
    await refresh($, e)

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
      await refresh($).catch(() => null)
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
    const s = await read($, snapshot)
    if (!show.display || e.props.hasSurvey || s === null) return below

    if (show.git) gitWanted = true
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const fill = ramp(s.percent)
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
