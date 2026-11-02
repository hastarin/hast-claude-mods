import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Snapshot } from '../types'
import {
  FIVE_HOURS,
  GOLD,
  SEVEN_DAYS,
  bar,
  creditUsd,
  isOverage,
  plain,
  quotaGauge,
  ramp,
  resetAt,
  timeLeft,
  totalK,
  usedK,
} from './format'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)

type Figures = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>

const refresh = async ($: EngineInterface, figures?: Figures): Promise<Snapshot | null> => {
  const { context, rateLimits, cost } = figures ?? (await $.session.usage())
  const limit = (kind: string) => rateLimits.find(r => r.kind === kind)?.percentUsed ?? null
  const resets = (kind: string) => resetAt(rateLimits.find(r => r.kind === kind)?.resetsAt)
  const tokens = context.tokens ?? 0
  const usd = cost?.usd ?? 0
  const q5 = limit('five_hour')
  const q7 = limit('seven_day')

  await update($, snapshot, (prev: Snapshot | null): Snapshot => ({
    tokens,
    window: context.window,
    percent: context.percent ?? (context.window > 0 ? (tokens * 100) / context.window : 0),
    q5,
    q7,
    r5: resets('five_hour'),
    r7: resets('seven_day'),
    usd,
    // Cost does not split plan-covered from credit spend: snapshot the total
    // when overage is first seen, and drop it once back under quota.
    overageBase: isOverage({ q5, q7 }) ? (prev?.overageBase ?? usd) : null,
  }))

  // Nothing is pinned to the status line: the band already draws the
  // figures, in colour, on every surface that has one.
  return read($, snapshot)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-bar',
      description: 'Print the usage bar (context, 5h/7d quota, cost)',
    })
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => {
    const now = await refresh($)

    return { text: now === null ? 'No usage reading yet.' : plain(now, await $.clock.now()) }
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)

    return next(e)
  })

  // The coloured bar, on the desktop's band: context by its level, each quota
  // window by its pace. The terminal's statusLine script draws the same there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.surface === 'terminal' || e.props.hasSurvey || s === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const { on: filled, off } = bar(s.percent)
    const fill = ramp(s.percent)
    const five = ramp(quotaGauge(s.q5 ?? 0, s.r5, FIVE_HOURS, now))
    const seven = ramp(quotaGauge(s.q7 ?? 0, s.r7, SEVEN_DAYS, now))
    const hasQuota = s.q5 !== null || s.q7 !== null
    const credit = creditUsd(s)

    return (
      <Box>
        <Text>
          [
          <Text color={fill.color} bold={fill.bold}>
            {filled}
          </Text>
          <Text dimColor>{off}</Text>
          {'] '}
          <Text color={fill.color} bold={fill.bold}>
            {`${Math.round(s.percent)}%`}
          </Text>
          {`  ${usedK(s.tokens)} / ${totalK(s.window)}`}
          {hasQuota ? '  ' : ''}
          {hasQuota ? (
            <Text color={five.color} bold={five.bold}>
              {`5h ${Math.round(s.q5 ?? 0)}%${timeLeft(s.r5, now)}`}
            </Text>
          ) : null}
          {hasQuota ? ' · ' : ''}
          {hasQuota ? (
            <Text color={seven.color} bold={seven.bold}>
              {`7d ${Math.round(s.q7 ?? 0)}%${timeLeft(s.r7, now)}`}
            </Text>
          ) : null}
          {`  ~$${s.usd.toFixed(2)}`}
          {credit === null ? null : <Text color={GOLD}>{` 💰$${credit.toFixed(2)}`}</Text>}
        </Text>
      </Box>
    )
  })
}
