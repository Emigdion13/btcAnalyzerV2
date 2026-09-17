/**
 * Indicator alarm monitoring.
 *
 * Two evaluation paths feed one model:
 *
 * 1. **The chart's own pair** is read straight from the live candles the app is already
 *    streaming, so an alarm on what you are looking at reacts to the same ticks the pane does.
 * 2. **Every other pair** is polled from the same read-only same-origin API on a slow cadence —
 *    an RSI 15m alarm on BTC-USD keeps watching while the chart is on ETH 1m.
 *
 * Fires are gated exactly like the price alerts: only while the selected feed is live and the
 * workspace is not replaying. One bar can fire an alarm once, however many times it repaints.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALARM_FEED_LIMIT,
  ALARM_POLL_MS,
  alarmFeedKey,
  alarmSeries,
  alarmFires,
  alarmVenueActive,
  closedCandles,
  evaluateIndicatorAlarm,
} from './indicator-alarms'
import type { AlarmReading } from './indicator-alarms'
import { generateCandles, getAsset } from './market'
import { isProductId, validateHistory } from '../../shared/coinbase'
import { isMetalInterval, isMetalSymbol } from '../../shared/kalshi'
import { isKalshiMetalHistory } from '../../shared/kalshi-metals'
import type { DataSource, MarketQuote } from '../../shared/coinbase'
import type { Candle, IndicatorAlarm, Timeframe } from './types'

export type AlarmFeedState = 'loading' | 'live' | 'ready' | 'error' | 'queued'
export interface AlarmFeedHealth {
  state: AlarmFeedState
  message: string
  fetchedAt: number
}
interface FeedData extends AlarmFeedHealth {
  candles: Candle[]
}
const LOADING: AlarmFeedHealth = { state: 'loading', message: 'Reading candles…', fetchedAt: 0 }
/** More pairs than the poll budget allows: say so rather than showing a card that never loads. */
const QUEUED: AlarmFeedHealth = {
  state: 'queued',
  message: `Waiting for a poll slot — ${ALARM_FEED_LIMIT} pairs are read at a time`,
  fetchedAt: 0,
}
export const EMPTY_ALARM_READING: AlarmReading = {
  active: false,
  previousActive: false,
  ready: false,
  barTime: null,
  reading: '—',
  detail: '',
  estimate: null,
}
/** One read-only history request for a pair, validated with the same rules the chart uses. */
export async function fetchAlarmCandles(
  symbol: string,
  timeframe: Timeframe,
  signal: AbortSignal,
): Promise<Candle[]> {
  // Demo pairs are generated, never fetched — the same source the demo chart draws.
  if (!isProductId(symbol) && !isMetalSymbol(symbol))
    return generateCandles(getAsset(symbol), timeframe, 300)
  if (isMetalSymbol(symbol)) {
    if (!isMetalInterval(timeframe))
      throw new Error(`Kalshi publishes no ${timeframe} silver bars to read.`)
    const params = new URLSearchParams({ symbol, interval: timeframe, limit: '300' })
    const response = await fetch(`/api/kalshi/metals/history?${params}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok)
      throw new Error(
        typeof (data as { message?: unknown })?.message === 'string'
          ? (data as { message: string }).message
          : 'Metal history could not be read for this alarm.',
      )
    if (!isKalshiMetalHistory(data, symbol, timeframe))
      throw new Error('Kalshi returned an invalid metal history payload.')
    return data.candles
  }
  const params = new URLSearchParams({ product: symbol, interval: timeframe, limit: '300' })
  const response = await fetch(`/api/coinbase/candles?${params}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      typeof (data as { message?: unknown })?.message === 'string'
        ? (data as { message: string }).message
        : 'Candles could not be read for this alarm.',
    )
  return validateHistory(data, symbol, timeframe).candles
}
/** Apply the live quote to the last generated bar, so demo alarms follow the demo tape. */
function withQuote(candles: Candle[], quote: MarketQuote | undefined): Candle[] {
  if (!quote || !candles.length) return candles
  const last = candles[candles.length - 1]
  return [
    ...candles.slice(0, -1),
    {
      ...last,
      close: quote.price,
      high: Math.max(last.high, quote.price),
      low: Math.min(last.low, quote.price),
    },
  ]
}
export interface IndicatorAlarmMonitorOptions {
  alarms: IndicatorAlarm[]
  /** The chart in front of the trader: its candles are the fastest path to an alarm. */
  chart: {
    symbol: string
    timeframe: Timeframe
    candles: Candle[]
    state: string
  }
  source: DataSource
  /** Quotes, so demo alarms read the same synthetic tape the demo chart does. */
  quotes: Record<string, MarketQuote>
  replay: boolean
  patchAlarm: (id: string, patch: Partial<IndicatorAlarm>) => void
  onFire: (alarm: IndicatorAlarm, reading: AlarmReading) => void
}
export function useIndicatorAlarms({
  alarms,
  chart,
  source,
  quotes,
  replay,
  patchAlarm,
  onFire,
}: IndicatorAlarmMonitorOptions) {
  const feeds = useRef(new Map<string, FeedData>())
  const inFlight = useRef(new Set<string>())
  const firedBars = useRef(new Map<string, number>())
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((current) => current + 1), [])
  const chartKey = `${chart.symbol}|${chart.timeframe}`
  const connected = chart.state === 'live'
  const quotesRef = useRef(quotes)
  useEffect(() => {
    quotesRef.current = quotes
  }, [quotes])
  /**
   * One request per distinct pair, capped so a pile of alarms cannot turn into a pile of
   * traffic: alarms beyond the cap still evaluate from whatever is already cached. Pairs whose
   * venue the workspace is not reading are skipped — a Coinbase alarm cannot fire in demo mode,
   * so there is nothing to poll for.
   */
  const pairs = useMemo(() => {
    const map = new Map<string, { symbol: string; timeframe: Timeframe }>()
    for (const alarm of alarms) {
      if (!alarm.enabled || !alarmVenueActive(alarm.symbol, source)) continue
      const key = alarmFeedKey(alarm)
      if (map.has(key)) continue
      if (map.size >= ALARM_FEED_LIMIT) continue
      map.set(key, { symbol: alarm.symbol, timeframe: alarm.timeframe })
    }
    return map
  }, [alarms, source])
  const pairsKey = useMemo(() => [...pairs.keys()].sort().join(','), [pairs])
  // The chart's own candles are the freshest source for its pair; keep that entry live.
  useEffect(() => {
    if (!chart.candles.length || !pairs.has(chartKey)) return
    feeds.current.set(chartKey, {
      candles: chart.candles,
      state: connected ? 'live' : 'ready',
      message: connected ? 'Live chart stream' : 'Chart snapshot',
      fetchedAt: Date.now(),
    })
    bump()
  }, [chart.candles, chartKey, pairs, connected, bump])
  useEffect(() => {
    if (!pairs.size) return
    const controller = new AbortController()
    let stopped = false
    const poll = async (key: string) => {
      const pair = pairs.get(key)
      if (!pair || inFlight.current.has(key) || stopped) return
      // A live chart key needs no request: the stream above is already ahead of a poll.
      if (key === chartKey && connected && !document.hidden) return
      inFlight.current.add(key)
      try {
        const candles = await fetchAlarmCandles(pair.symbol, pair.timeframe, controller.signal)
        if (stopped) return
        const quote = quotesRef.current[pair.symbol]
        feeds.current.set(key, {
          candles: quote ? withQuote(candles, quote) : candles,
          state: 'ready',
          message: `Polled every ${Math.round(ALARM_POLL_MS / 1000)} s`,
          fetchedAt: Date.now(),
        })
      } catch (error) {
        if (stopped || (error as Error)?.name === 'AbortError') return
        const previous = feeds.current.get(key)
        feeds.current.set(key, {
          candles: previous?.candles ?? [],
          state: 'error',
          message: (error as Error)?.message || 'This alarm could not read candles.',
          fetchedAt: previous?.fetchedAt ?? 0,
        })
      } finally {
        inFlight.current.delete(key)
        if (!stopped) bump()
      }
    }
    const sweep = () => {
      for (const key of feeds.current.keys()) if (!pairs.has(key)) feeds.current.delete(key)
      for (const key of pairs.keys()) void poll(key)
    }
    sweep()
    const timer = setInterval(sweep, ALARM_POLL_MS)
    return () => {
      stopped = true
      controller.abort()
      clearInterval(timer)
    }
  }, [pairs, pairsKey, chartKey, connected, bump])
  /** Every enabled alarm against the newest candles it owns. Pure — firing happens below. */
  const readings = useMemo(() => {
    void version
    const result: Record<string, AlarmReading> = {}
    for (const alarm of alarms) {
      if (!alarm.enabled) continue
      const key = alarmFeedKey(alarm)
      const candles = feeds.current.get(key)?.candles ?? []
      if (!candles.length) continue
      const series = alarmSeries(
        alarm.bars === 'closed' ? closedCandles(candles, alarm.timeframe) : candles,
        alarm,
      )
      if (!series.times.length) continue
      result[alarm.id] = evaluateIndicatorAlarm(alarm, series)
    }
    return result
  }, [alarms, version])
  const health = useMemo(() => {
    void version
    const result: Record<string, AlarmFeedHealth> = {}
    for (const alarm of alarms) {
      const key = alarmFeedKey(alarm)
      const cached = feeds.current.get(key)
      if (cached) {
        result[key] = cached
        continue
      }
      result[key] =
        alarm.enabled && alarmVenueActive(alarm.symbol, source) && !pairs.has(key)
          ? QUEUED
          : LOADING
    }
    return result
  }, [alarms, version, pairs, source])
  const firing = useMemo(
    () =>
      replay
        ? []
        : alarms.filter((alarm) => {
            if (!alarmVenueActive(alarm.symbol, source)) return false
            const reading = readings[alarm.id]
            if (!reading || reading.barTime === null || !alarmFires(reading)) return false
            // The bar this alarm already fired on is remembered in the workspace, so reopening
            // the terminal does not replay yesterday's fire for a condition that still holds.
            const fired = firedBars.current.get(alarm.id) ?? alarm.lastTriggeredBar
            return fired !== reading.barTime
          }),
    [alarms, readings, replay, source],
  )
  useEffect(() => {
    if (replay || !connected || !firing.length) return
    for (const alarm of firing) {
      const reading = readings[alarm.id]
      if (!reading || reading.barTime === null) continue
      firedBars.current.set(alarm.id, reading.barTime)
      patchAlarm(alarm.id, {
        lastTriggeredAt: new Date().toISOString(),
        lastTriggeredBar: reading.barTime,
        triggerCount: alarm.triggerCount + 1,
        ...(alarm.repeat === 'once' ? { enabled: false } : {}),
      })
      onFire(alarm, reading)
    }
  }, [firing, readings, replay, connected, patchAlarm, onFire])
  return { readings, health }
}
