// @vitest-environment jsdom
/**
 * The firing path, mounted: an alarm on the charted pair is judged from the live candles the
 * chart already has, fires once for the bar it happens on, and writes its own bookkeeping.
 * Nothing here polls — the chart pair is deliberately the fastest path, so a cross that has just
 * printed fires immediately rather than at the next sweep.
 */
import { act } from 'react'
// React only batches test updates without a warning when the flag below is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alarmSeries, evaluateIndicatorAlarm, newIndicatorAlarm } from './indicator-alarms'
import type { AlarmReading } from './indicator-alarms'
import { useIndicatorAlarms } from './useIndicatorAlarms'
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import type { DataSource } from '../../shared/coinbase'
import type { Candle, IndicatorAlarm, Timeframe } from './types'

const SYMBOL = 'BTC-USD'
const TIMEFRAME: Timeframe = '15m'
const STEP = INTERVAL_SECONDS[TIMEFRAME]
const CREATED = '2026-09-17T00:00:00.000Z'

/** A decline that turns into a rally: the MACD crosses up somewhere after the turn. */
const price = (i: number) => (i < 100 ? 100 - i * 0.4 : 60 + (i - 100) * 0.45)
function rawCandles(count = 160): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = price(i)
    const open = i === 0 ? close : price(i - 1)
    return {
      time: i * STEP,
      open,
      close,
      high: Math.max(open, close) + 0.05,
      low: Math.min(open, close) - 0.05,
      volume: 12,
    }
  })
}
const spec = (overrides: Partial<IndicatorAlarm> = {}): IndicatorAlarm => ({
  ...newIndicatorAlarm({
    id: 'alarm-1',
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    indicator: 'macd',
    createdAt: CREATED,
  }),
  ...overrides,
})
/** The last bar of the tape where the bullish cross prints. */
function crossIndex(candles: Candle[]): number {
  const histogram = alarmSeries(candles, spec()).histogram!
  const crossings = histogram
    .map((value, i) =>
      value !== null && histogram[i - 1] !== null && value > 0 && histogram[i - 1]! <= 0 ? i : -1,
    )
    .filter((i) => i >= 0)
  expect(crossings.length).toBeGreaterThan(0)
  return crossings[crossings.length - 1]
}
/**
 * The tape trimmed to the cross bar, shifted so that bar sits in a bucket we control: the one
 * still forming right now, or the last one the venue has already finished publishing.
 */
function candlesEndingAtCross(bar: 'forming' | 'closed' = 'forming'): Candle[] {
  const candles = rawCandles()
  const trimmed = candles.slice(0, crossIndex(candles) + 1)
  const end = Math.floor(Date.now() / 1000 / STEP) * STEP - (bar === 'forming' ? 0 : STEP)
  return trimmed.map((candle, i) => ({
    ...candle,
    time: end - (trimmed.length - 1 - i) * STEP,
  }))
}

let container: HTMLDivElement
let root: Root
let fired: { alarm: IndicatorAlarm; reading: AlarmReading }[]
let patches: { id: string; patch: Partial<IndicatorAlarm> }[]
const onFire = (alarm: IndicatorAlarm, reading: AlarmReading) => fired.push({ alarm, reading })
const patchAlarm = (id: string, patch: Partial<IndicatorAlarm>) => patches.push({ id, patch })

function Harness({
  alarms,
  candles,
  source = 'coinbase',
  replay = false,
  state = 'live',
}: {
  alarms: IndicatorAlarm[]
  candles: Candle[]
  source?: DataSource
  replay?: boolean
  state?: string
}) {
  useIndicatorAlarms({
    alarms,
    chart: { symbol: SYMBOL, timeframe: TIMEFRAME, candles, state },
    source,
    quotes: {},
    replay,
    patchAlarm,
    onFire,
  })
  return null
}
const render = (props: Parameters<typeof Harness>[0]) =>
  act(() => {
    root.render(<Harness {...props} />)
  })

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  fired = []
  patches = []
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useIndicatorAlarms on the charted pair', () => {
  it('fires on the bar a fresh MACD cross prints, and only once for that bar', () => {
    const candles = candlesEndingAtCross()
    const alarm = spec()
    render({ alarms: [alarm], candles })
    expect(fired).toHaveLength(1)
    expect(fired[0].alarm.id).toBe('alarm-1')
    expect(fired[0].reading.active).toBe(true)
    expect(fired[0].reading.reading).toContain('MACD')
    // The monitor owns the bookkeeping: the fire is stamped, counted, and pinned to its bar.
    expect(patches).toHaveLength(1)
    expect(patches[0].id).toBe('alarm-1')
    expect(patches[0].patch).toMatchObject({
      lastTriggeredBar: candles[candles.length - 1].time,
      triggerCount: 1,
    })
    // A repaint of the same bar, and a re-render, must not fire it twice.
    render({ alarms: [alarm], candles: [...candles] })
    expect(fired).toHaveLength(1)
  })

  it('does not replay a fire the workspace already recorded for that bar', () => {
    const candles = candlesEndingAtCross()
    const barTime = candles[candles.length - 1].time
    render({ alarms: [spec({ lastTriggeredBar: barTime, triggerCount: 1 })], candles })
    expect(fired).toHaveLength(0)
    expect(patches).toHaveLength(0)
    // A later bar is news again.
    const nextBar = candles.map((candle, i) =>
      i === candles.length - 1 ? { ...candle, time: candle.time + STEP } : candle,
    )
    render({ alarms: [spec({ lastTriggeredBar: barTime, triggerCount: 1 })], candles: nextBar })
    expect(fired).toHaveLength(1)
  })

  it('pauses an alarm that asked to fire once, instead of arming it again', () => {
    const candles = candlesEndingAtCross()
    render({ alarms: [spec({ repeat: 'once' })], candles })
    expect(fired).toHaveLength(1)
    expect(patches[0].patch).toMatchObject({ enabled: false })
  })

  it('reads the live candles of the pair only while the feed is live and not replaying', () => {
    const candles = candlesEndingAtCross()
    render({ alarms: [spec()], candles, state: 'connecting' })
    expect(fired).toHaveLength(0)
    render({ alarms: [spec()], candles, state: 'live', replay: true })
    expect(fired).toHaveLength(0)
    render({ alarms: [spec()], candles, state: 'live', replay: false, source: 'demo' })
    expect(fired).toHaveLength(0)
    render({ alarms: [spec()], candles, state: 'live' })
    expect(fired).toHaveLength(1)
  })

  it('ignores a paused alarm', () => {
    render({ alarms: [spec({ enabled: false })], candles: candlesEndingAtCross() })
    expect(fired).toHaveLength(0)
  })

  it('waits for the close when the alarm only trusts closed bars', () => {
    // The cross bar is still forming, so a closed-bar alarm has nothing to judge yet.
    render({ alarms: [spec({ bars: 'closed' })], candles: candlesEndingAtCross('forming') })
    expect(fired).toHaveLength(0)
    // One bucket later that same cross sits in a closed bar, and the alarm fires on it.
    render({ alarms: [spec({ bars: 'closed' })], candles: candlesEndingAtCross('closed') })
    expect(fired).toHaveLength(1)
    expect(fired[0].reading.detail).toContain('fresh bullish cross')
  })

  it('fires a combined alarm on the bar both of its legs hold, and not before', () => {
    const candles = candlesEndingAtCross()
    const barTime = candles[candles.length - 1].time
    // The gate is the cross itself: the tape is still oversold on that bar, which is exactly
    // the "green cross while RSI is under 30" combination a trader would build.
    const combo = spec({
      also: [{ indicator: 'rsi', condition: 'rsi-below-level', params: { level: 30 } }],
      match: 'all',
    })
    render({ alarms: [combo], candles })
    expect(fired).toHaveLength(1)
    expect(fired[0].reading.detail).toContain('All 2 conditions hold')
    expect(patches[0].patch).toMatchObject({ lastTriggeredBar: barTime, triggerCount: 1 })
    // The same tape with a gate that cannot hold: the MACD crosses, but RSI is nowhere near it.
    fired = []
    patches = []
    render({
      alarms: [
        spec({
          also: [{ indicator: 'rsi', condition: 'rsi-above-level', params: { level: 50 } }],
          match: 'all',
        }),
      ],
      candles,
    })
    expect(fired).toHaveLength(0)
    expect(patches).toHaveLength(0)
  })

  it('evaluates the alarm the trader configured, not a default one', () => {
    const candles = candlesEndingAtCross()
    // The very same tape cannot satisfy "crosses below the signal", so nothing fires.
    const bearish = spec({ condition: 'macd-cross-down' })
    render({ alarms: [bearish], candles })
    expect(fired).toHaveLength(0)
    const reading = evaluateIndicatorAlarm(bearish, alarmSeries(candles, bearish))
    expect(reading.ready).toBe(true)
    expect(reading.active).toBe(false)
  })
})
