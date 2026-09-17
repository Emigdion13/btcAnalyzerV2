/**
 * What an alarm card says in its status line, kept out of the component so it can be reasoned
 * about (and tested) on its own. An alarm that cannot currently react says why — paused, the
 * wrong data source, a failed read, a dead connection — rather than looking like it is watching.
 */
import { alarmEntries, alarmHeadline, alarmVenueActive } from './indicator-alarms'
import type { AlarmReading } from './indicator-alarms'
import type { AlarmFeedHealth } from './useIndicatorAlarms'
import type { DataSource } from '../../shared/coinbase'
import type { IndicatorAlarm } from './types'

export interface AlarmStatus {
  label: string
  tone: 'idle' | 'positive' | 'warning'
}
export function alarmStatus(
  alarm: IndicatorAlarm,
  reading: AlarmReading | undefined,
  feed: AlarmFeedHealth | undefined,
  source: DataSource,
  connected: boolean,
): AlarmStatus {
  if (!alarm.enabled) return { label: 'Paused', tone: 'idle' }
  if (!alarmVenueActive(alarm.symbol, source))
    return { label: 'Not on this data source', tone: 'idle' }
  if (feed?.state === 'error') return { label: feed.message, tone: 'warning' }
  if (!connected) return { label: 'Waiting for the connection', tone: 'idle' }
  if (!reading)
    return { label: feed?.message ?? `Reading ${alarm.timeframe} candles…`, tone: 'idle' }
  if (reading.active) return { label: `Holding · ${reading.detail}`, tone: 'positive' }
  return { label: `Watching · ${reading.detail}`, tone: 'idle' }
}
/**
 * The line the toast shows when an alarm fires. A single-condition alarm names the condition and
 * the numbers behind it; a combined one is already a sentence, so its verdict is the news —
 * `BTC-USD 15m · All 2 conditions hold: MACD turns green, RSI above 70`.
 */
export function alarmFireToast(alarm: IndicatorAlarm, reading: AlarmReading): string {
  const pair = `${alarm.symbol} ${alarm.timeframe}`
  if (alarmEntries(alarm).length > 1) return `${pair} · ${reading.detail}`
  return `${pair} · ${alarmHeadline(alarm)} · ${reading.reading}`
}
/** `Fired 12:30 UTC`, `Fired ×3 12:30 UTC`, or nothing yet. Times are UTC, as everywhere else. */
export function alarmFiredLabel(alarm: IndicatorAlarm): string {
  if (!alarm.lastTriggeredAt) return 'Never fired yet'
  const at = new Date(alarm.lastTriggeredAt)
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  return `${alarm.triggerCount === 1 ? 'Fired' : `Fired ×${alarm.triggerCount}`} ${time} UTC`
}
