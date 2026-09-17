import { describe, expect, it } from 'vitest'
import {
  ALARM_CONDITIONS,
  ALARM_LIMIT,
  alarmFeedKey,
  alarmEntries,
  alarmFires,
  alarmHeadline,
  alarmIndicatorLabel,
  alarmParams,
  alarmSeries,
  alarmVenueActive,
  barsToTarget,
  canAddEntry,
  closedCandles,
  conditionExists,
  conditionSpec,
  conditionsFor,
  defaultCondition,
  defaultParams,
  evaluateIndicatorAlarm,
  formatAlarmNumber,
  histogramColor,
  isIndicatorAlarm,
  newIndicatorAlarm,
  sanitizeIndicatorAlarms,
  typicalStep,
} from './indicator-alarms'
import type { AlarmSeries } from './indicator-alarms'
import { pineEma, ta } from './indicator-runtime'
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import type { AlarmConditionId, AlarmIndicatorKind, Candle, IndicatorAlarm } from './types'

const CREATED = '2026-09-17T00:00:00.000Z'
const alarm = (
  indicator: AlarmIndicatorKind,
  condition: AlarmConditionId,
  overrides: Partial<IndicatorAlarm> = {},
): IndicatorAlarm => ({
  ...newIndicatorAlarm({
    id: 'a',
    symbol: 'BTC-USD',
    timeframe: '15m',
    indicator,
    createdAt: CREATED,
  }),
  condition,
  params: defaultParams(condition),
  ...overrides,
})
/** A series cut at `end`, the way the monitor evaluates a growing tape. */
function slice(series: AlarmSeries, end: number): AlarmSeries {
  const cut = <T>(values: T[] | undefined) => values?.slice(0, end + 1)
  return {
    times: series.times.slice(0, end + 1),
    macd: cut(series.macd),
    signal: cut(series.signal),
    histogram: cut(series.histogram),
    rsi: cut(series.rsi),
    wvf: cut(series.wvf),
    upperBand: cut(series.upperBand),
    rangeHigh: cut(series.rangeHigh),
    isGreen: cut(series.isGreen),
  }
}
const firesAt = (spec: IndicatorAlarm, series: AlarmSeries, index: number): boolean =>
  alarmFires(evaluateIndicatorAlarm(spec, slice(series, index)))
/** A deterministic candle tape: a sine path with an adjustable phase and amplitude. */
function rampCandles(count: number, closeAt: (index: number) => number): Candle[] {
  const start = Date.UTC(2026, 0, 1) / 1000
  return Array.from({ length: count }, (_, i) => {
    const close = closeAt(i)
    const open = i === 0 ? close : closeAt(i - 1)
    return {
      time: start + i * INTERVAL_SECONDS['15m'],
      open,
      close,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      volume: 10 + (i % 7),
    }
  })
}

describe('alarm condition catalog', () => {
  it('describes every condition once, with usable params', () => {
    const ids = ALARM_CONDITIONS.map((spec) => spec.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const spec of ALARM_CONDITIONS) {
      expect(spec.label.length).toBeGreaterThan(8)
      expect(spec.description.length).toBeGreaterThan(20)
      expect(spec.group.length).toBeGreaterThan(2)
      expect(spec.indicators.length).toBeGreaterThan(0)
      for (const param of spec.params) {
        expect(param.min).toBeLessThan(param.max)
        expect(param.default).toBeGreaterThanOrEqual(param.min)
        expect(param.default).toBeLessThanOrEqual(param.max)
      }
      expect(conditionSpec(spec.id).label).toBe(spec.label)
    }
  })

  it('offers every indicator a set of conditions and a default', () => {
    for (const indicator of ['cm-ult-macd', 'macd', 'rsi', 'cm-williams-vix-fix'] as const) {
      const offered = conditionsFor(indicator)
      expect(offered.length).toBeGreaterThan(2)
      expect(offered.every((spec) => spec.indicators.includes(indicator))).toBe(true)
      expect(offered.some((spec) => spec.id === defaultCondition(indicator))).toBe(true)
    }
  })

  it('keeps ChrisMoody histogram colors off the conventional MACD', () => {
    const colorIds = ['macd-hist-aqua', 'macd-hist-blue', 'macd-hist-maroon', 'macd-hist-red']
    const colors = conditionsFor('cm-ult-macd').filter((spec) => colorIds.includes(spec.id))
    expect(colors.length).toBe(4)
    expect(conditionsFor('macd').some((spec) => spec.id === 'macd-hist-aqua')).toBe(false)
    expect(conditionExists('macd-hist-aqua')).toBe(true)
    expect(conditionExists('nope')).toBe(false)
  })

  it('falls back to the catalog default when a stored alarm is missing its params', () => {
    expect(alarmParams(alarm('rsi', 'rsi-cross-up-level', { params: {} }))).toEqual({ level: 70 })
    expect(alarmParams(alarm('rsi', 'rsi-cross-down-level', { params: {} }))).toEqual({ level: 30 })
    expect(alarmParams(alarm('cm-ult-macd', 'macd-about-cross-up', { params: {} }))).toEqual({
      within: 3,
    })
  })

  it('clamps stored params to the catalog range', () => {
    expect(alarmParams(alarm('rsi', 'rsi-cross-up-level', { params: { level: 900 } })).level).toBe(
      99,
    )
    expect(alarmParams(alarm('rsi', 'rsi-about-cross-up', { params: { within: 0 } })).within).toBe(
      1,
    )
  })
})

describe('alarm labels', () => {
  it('names the indicator and its lengths', () => {
    expect(alarmIndicatorLabel(alarm('cm-ult-macd', 'macd-cross-up'))).toBe(
      'CM_Ult_MacD_MTF (12, 26, 9)',
    )
    expect(alarmIndicatorLabel(alarm('macd', 'macd-cross-up'))).toBe('MACD (12, 26, 9)')
    expect(alarmIndicatorLabel(alarm('rsi', 'rsi-cross-up-level'))).toBe('RSI (14)')
    expect(alarmIndicatorLabel(alarm('rsi', 'rsi-cross-up-level', { rsi: { period: 7 } }))).toBe(
      'RSI (7)',
    )
    expect(alarmIndicatorLabel(alarm('cm-williams-vix-fix', 'wvf-spike'))).toBe(
      'CM_Williams_Vix_Fix (22, 20, 2, 50, 0.85, 1.01)',
    )
  })

  it('headlines the condition the trader picked', () => {
    expect(alarmHeadline(alarm('cm-ult-macd', 'macd-about-cross-up'))).toBe(
      'MACD is about to cross above the signal line (still red)',
    )
  })

  it('keys feeds by symbol and timeframe so alarms can share one request', () => {
    expect(alarmFeedKey(alarm('rsi', 'rsi-cross-up-level'))).toBe('BTC-USD|15m')
  })
})

describe('venue rules', () => {
  it('fires Coinbase alarms on Coinbase data only', () => {
    expect(alarmVenueActive('BTC-USD', 'coinbase')).toBe(true)
    expect(alarmVenueActive('BTC-USD', 'demo')).toBe(false)
  })

  it('fires demo alarms on demo data only', () => {
    expect(alarmVenueActive('BTCUSDT', 'demo')).toBe(true)
    expect(alarmVenueActive('BTCUSDT', 'coinbase')).toBe(false)
  })

  it('treats silver as a Kalshi market that demo mode cannot serve', () => {
    expect(alarmVenueActive('XAG-USD', 'coinbase')).toBe(true)
    expect(alarmVenueActive('XAG-USD', 'demo')).toBe(false)
  })
})

describe('MACD conditions', () => {
  const macdSeries = (line: number[], signal: number[]): AlarmSeries => ({
    times: line.map((_, i) => i * 900),
    macd: line,
    signal,
    histogram: line.map((value, i) => value - signal[i]),
  })

  it('fires on the bar of a bullish cross, not on the bars around it', () => {
    const series = macdSeries([-1.4, -0.9, -0.2, 0.6, 1.1], [0, 0, 0, 0, 0])
    const spec = alarm('macd', 'macd-cross-up')
    expect(firesAt(spec, series, 1)).toBe(false)
    expect(firesAt(spec, series, 2)).toBe(false)
    expect(firesAt(spec, series, 3)).toBe(true)
    // The cross has already happened: the state is green, but this is not a fresh cross.
    expect(firesAt(spec, series, 4)).toBe(false)
  })

  it('fires on the bar of a bearish cross', () => {
    const series = macdSeries([1.4, 0.9, 0.2, -0.6, -1.1], [0, 0, 0, 0, 0])
    const spec = alarm('macd', 'macd-cross-down')
    expect(firesAt(spec, series, 2)).toBe(false)
    expect(firesAt(spec, series, 3)).toBe(true)
    expect(firesAt(spec, series, 4)).toBe(false)
  })

  it('treats an exact touch of the signal line as still red, then green', () => {
    const series = macdSeries([-1, 0, 1], [0, 0, 0])
    const up = alarm('macd', 'macd-cross-up')
    expect(firesAt(up, series, 1)).toBe(false)
    expect(firesAt(up, series, 2)).toBe(true)
    const down = alarm('macd', 'macd-cross-down')
    expect(firesAt(down, macdSeries([1, 0, -1], [0, 0, 0]), 2)).toBe(true)
  })

  it('reads a closing gap as "about to cross" without any threshold to tune', () => {
    // Histogram −3, −2.4, −1.8, −1.2, −0.6: a steady 0.6 per bar, so the last bar is one
    // typical bar away from the cross.
    const line = [-3, -2.4, -1.8, -1.2, -0.6]
    const series = macdSeries(line, [0, 0, 0, 0, 0])
    const reading = evaluateIndicatorAlarm(alarm('macd', 'macd-about-cross-up'), series)
    expect(reading.active).toBe(true)
    expect(reading.estimate).toBeCloseTo(1, 5)
    expect(reading.detail).toContain('bullish cross')
  })

  it('does not call it "about to cross" when the gap is widening or already closed', () => {
    const widening = macdSeries([-3, -3.6, -4.2, -4.8, -5.4], [0, 0, 0, 0, 0])
    expect(evaluateIndicatorAlarm(alarm('macd', 'macd-about-cross-up'), widening).active).toBe(
      false,
    )
    const crossed = macdSeries([-0.6, -0.3, 0.1, 0.4, 0.7], [0, 0, 0, 0, 0])
    expect(evaluateIndicatorAlarm(alarm('macd', 'macd-about-cross-up'), crossed).active).toBe(false)
    const far = macdSeries([-30, -28, -26, -24, -22], [0, 0, 0, 0, 0])
    expect(evaluateIndicatorAlarm(alarm('macd', 'macd-about-cross-up'), far).active).toBe(false)
    expect(evaluateIndicatorAlarm(alarm('macd', 'macd-about-cross-up'), far).estimate).toBeNull()
  })

  it('honours the "within" setting of a proximity alarm', () => {
    const line = [-3, -2.4, -1.8, -1.2, -0.6]
    const series = macdSeries(line, [0, 0, 0, 0, 0])
    const tight = alarm('macd', 'macd-about-cross-up', { params: { within: 1 } })
    const early = alarm('macd', 'macd-about-cross-up', { params: { within: 5 } })
    expect(evaluateIndicatorAlarm(tight, series).active).toBe(true)
    expect(evaluateIndicatorAlarm(early, series).active).toBe(true)
  })

  it('fires on zero crossings of the MACD line itself', () => {
    const series = macdSeries([-2, -1, 0.5, 1.5], [0, 0, 0, 0])
    expect(firesAt(alarm('macd', 'macd-zero-cross-up'), series, 2)).toBe(true)
    expect(firesAt(alarm('macd', 'macd-zero-cross-up'), series, 3)).toBe(false)
    expect(
      firesAt(
        alarm('macd', 'macd-zero-cross-down'),
        macdSeries([2, 1, -0.5, -1.5], [0, 0, 0, 0]),
        2,
      ),
    ).toBe(true)
  })

  it('fires on the ChrisMoody histogram colors exactly as the pane paints them', () => {
    // aqua: above zero and taller than the bar before; blue: above zero, shorter;
    // maroon: at or below zero, taller; red: at or below zero, shorter.
    const bars = [0, 1, 2, 1, 0, 0, -1, 0, -1]
    const series = macdSeries(
      bars,
      bars.map(() => 0),
    )
    const histogram = series.histogram!
    expect(histogramColor(histogram, 0)).toBe('none')
    expect(histogramColor(histogram, 2)).toBe('aqua')
    expect(histogramColor(histogram, 3)).toBe('blue')
    expect(histogramColor(histogram, 4)).toBe('red')
    // A bar the same height as the one before it is CM's flat yellow.
    expect(histogramColor(histogram, 5)).toBe('yellow')
    expect(histogramColor(histogram, 7)).toBe('maroon')
    expect(firesAt(alarm('cm-ult-macd', 'macd-hist-aqua'), series, 1)).toBe(true)
    expect(firesAt(alarm('cm-ult-macd', 'macd-hist-aqua'), series, 2)).toBe(false)
    expect(firesAt(alarm('cm-ult-macd', 'macd-hist-blue'), series, 3)).toBe(true)
    expect(firesAt(alarm('cm-ult-macd', 'macd-hist-red'), series, 4)).toBe(true)
    expect(firesAt(alarm('cm-ult-macd', 'macd-hist-maroon'), series, 7)).toBe(true)
    expect(firesAt(alarm('cm-ult-macd', 'macd-hist-red'), series, 5)).toBe(false)
  })

  it('fires on the first bar of a rising or falling histogram run', () => {
    const rising = macdSeries([3, 2, 1, 1.5, 2, 2.4], [0, 0, 0, 0, 0, 0])
    expect(firesAt(alarm('macd', 'macd-hist-rising'), rising, 3)).toBe(true)
    // Still rising: the alarm has already had its say on this run.
    expect(firesAt(alarm('macd', 'macd-hist-rising'), rising, 4)).toBe(false)
    const falling = macdSeries([1, 2, 3, 2, 3], [0, 0, 0, 0, 0])
    expect(firesAt(alarm('macd', 'macd-hist-falling'), falling, 3)).toBe(true)
    expect(firesAt(alarm('macd', 'macd-hist-falling'), falling, 2)).toBe(false)
  })

  it('waits for warm-up instead of firing on an empty series', () => {
    const empty = evaluateIndicatorAlarm(alarm('macd', 'macd-cross-up'), { times: [] })
    expect(empty.ready).toBe(false)
    expect(empty.active).toBe(false)
    const warming = evaluateIndicatorAlarm(alarm('macd', 'macd-cross-up'), {
      times: [0],
      macd: [null],
      signal: [null],
      histogram: [null],
    })
    expect(warming.ready).toBe(false)
    expect(warming.reading).toBe('Waiting for enough history')
  })

  it('evaluates a real candle tape: every fire is a bar the histogram crossed on', () => {
    const candles = rampCandles(240, (i) => 100 + Math.sin(i / 9) * 10 + i * 0.02)
    const spec = alarm('macd', 'macd-cross-up', { macd: { fast: 12, slow: 26, signal: 9 } })
    const series = alarmSeries(candles, spec)
    const histogram = series.histogram!
    const crossedAt = histogram
      .map((value, i) => ({ value, previous: histogram[i - 1], i }))
      .filter(
        (bar) => bar.value !== null && bar.previous !== null && bar.value > 0 && bar.previous! <= 0,
      )
      .map((bar) => bar.i)
    expect(crossedAt.length).toBeGreaterThan(3)
    const firedAt = series.times.map((_, i) => i).filter((i) => firesAt(spec, series, i))
    expect(firedAt).toEqual(crossedAt)
  })

  it('evaluates CM_Ult_MacD_MTF on the alarm timeframe, on its own maths', () => {
    const candles = rampCandles(200, (i) => 2500 + Math.cos(i / 11) * 60)
    const spec = alarm('cm-ult-macd', 'macd-cross-up')
    const series = alarmSeries(candles, spec)
    // CM uses Pine's seeded EMA and an SMA signal — not the conventional EMA/EMA pair.
    const closes = candles.map((c) => c.close)
    const macd = pineEma(closes, 12).map((value, i) => value - pineEma(closes, 26)[i])
    expect(series.macd!.at(-1)).toBeCloseTo(macd.at(-1)!, 10)
    expect(series.signal!.at(-1)).toBeCloseTo(ta.sma(macd, 9).at(-1)!, 10)
    expect(series.times).toEqual(candles.map((c) => c.time))
  })
})

describe('RSI conditions', () => {
  it('fires exactly on the bar RSI crosses the level', () => {
    const candles = rampCandles(200, (i) => 100 + Math.sin(i / 14) * 6)
    const spec = alarm('rsi', 'rsi-cross-up-level', { params: { level: 70 } })
    const series = alarmSeries(candles, spec)
    const rsi = series.rsi!
    const crossings = rsi
      .map((value, i) => ({ value, previous: rsi[i - 1], i }))
      .filter(
        (bar) =>
          bar.value !== null && bar.previous !== null && bar.value! > 70 && bar.previous! <= 70,
      )
      .map((bar) => bar.i)
    expect(crossings.length).toBeGreaterThan(0)
    expect(series.times.map((_, i) => i).filter((i) => firesAt(spec, series, i))).toEqual(crossings)
  })

  it('reads oversold crossings on the way down', () => {
    const series: AlarmSeries = { times: [0, 1, 2, 3], rsi: [45, 38, 30, 26] }
    const spec = alarm('rsi', 'rsi-cross-down-level', { params: { level: 30 } })
    expect(firesAt(spec, series, 3)).toBe(true)
    expect(firesAt(spec, series, 2)).toBe(false)
  })

  it('fires once when RSI enters an overbought state and re-arms after it leaves', () => {
    const series: AlarmSeries = { times: [0, 1, 2, 3, 4], rsi: [60, 72, 74, 68, 75] }
    const spec = alarm('rsi', 'rsi-above-level', { params: { level: 70 } })
    expect(firesAt(spec, series, 1)).toBe(true)
    expect(firesAt(spec, series, 2)).toBe(false)
    expect(firesAt(spec, series, 3)).toBe(false)
    expect(firesAt(spec, series, 4)).toBe(true)
  })

  it('reads proximity to a level in bars of typical movement', () => {
    const series: AlarmSeries = { times: [0, 1, 2, 3, 4], rsi: [60, 62, 64, 66, 68] }
    const reading = evaluateIndicatorAlarm(
      alarm('rsi', 'rsi-about-cross-up', { params: { level: 70, within: 3 } }),
      series,
    )
    expect(reading.active).toBe(true)
    expect(reading.estimate).toBeCloseTo(1, 5)
    // Falling RSI is not approaching a level above it.
    const falling: AlarmSeries = { times: [0, 1, 2, 3, 4], rsi: [72, 70, 68, 66, 64] }
    expect(
      evaluateIndicatorAlarm(alarm('rsi', 'rsi-about-cross-up', { params: { level: 70 } }), falling)
        .active,
    ).toBe(false)
  })

  it('fires when RSI turns out of a dip or off a peak', () => {
    const dip: AlarmSeries = { times: [0, 1, 2, 3], rsi: [34, 30, 26, 27] }
    expect(firesAt(alarm('rsi', 'rsi-turns-up'), dip, 3)).toBe(true)
    const peak: AlarmSeries = { times: [0, 1, 2, 3], rsi: [66, 70, 74, 73] }
    expect(firesAt(alarm('rsi', 'rsi-turns-down'), peak, 3)).toBe(true)
    expect(firesAt(alarm('rsi', 'rsi-turns-up'), peak, 3)).toBe(false)
  })

  it('separates a dip turn from the first bar of a rally', () => {
    const rising: AlarmSeries = { times: [0, 1, 2], rsi: [40, 45, 50] }
    expect(firesAt(alarm('rsi', 'rsi-turns-up'), rising, 2)).toBe(false)
  })

  it('respects a custom RSI length', () => {
    const candles = rampCandles(120, (i) => 100 + Math.sin(i / 9) * 4)
    const spec = alarm('rsi', 'rsi-cross-up-level', { rsi: { period: 7 } })
    const series = alarmSeries(candles, spec)
    expect(series.rsi).toEqual(
      ta.rsi(
        candles.map((c) => c.close),
        7,
      ),
    )
  })
})

describe('CM_Williams_Vix_Fix conditions', () => {
  /** A calm tape that takes one hard hit — the fear spike the indicator exists to find. */
  const spikeCandles = (): Candle[] => {
    const candles = rampCandles(120, (i) => 100 + Math.sin(i / 9) * 0.6)
    return candles.map((candle, i) =>
      i === 90 ? { ...candle, low: candle.open * 0.88, close: candle.open * 0.9 } : candle,
    )
  }

  it('fires on the first lime bar of each spike and again when the spike ends', () => {
    const candles = spikeCandles()
    const spec = alarm('cm-williams-vix-fix', 'wvf-spike')
    const series = alarmSeries(candles, spec)
    const green = series.isGreen!
    expect(green.some(Boolean)).toBe(true)
    // Every lime run has to start somewhere: that bar is the alarm's bar.
    const runStarts = green.map((lime, i) => (lime && !green[i - 1] ? i : -1)).filter((i) => i >= 0)
    const runEnds = green.map((lime, i) => (!lime && green[i - 1] ? i : -1)).filter((i) => i >= 0)
    expect(runStarts.length).toBeGreaterThan(0)
    expect(runEnds.length).toBe(runStarts.length)
    const fired = series.times.map((_, i) => i).filter((i) => firesAt(spec, series, i))
    expect(fired).toEqual(runStarts)
    const endSpec = alarm('cm-williams-vix-fix', 'wvf-spike-ends')
    expect(series.times.map((_, i) => i).filter((i) => firesAt(endSpec, series, i))).toEqual(
      runEnds,
    )
  })

  it('reads the Bollinger band and percentile range as separate triggers', () => {
    const series: AlarmSeries = {
      times: [0, 1, 2, 3],
      wvf: [4, 6, 9, 12],
      upperBand: [8, 8, 8, 8],
      rangeHigh: [10, 10, 10, 10],
      isGreen: [false, false, false, true],
    }
    const band = alarm('cm-williams-vix-fix', 'wvf-cross-above-band')
    expect(firesAt(band, series, 2)).toBe(true)
    expect(firesAt(band, series, 1)).toBe(false)
    const range = alarm('cm-williams-vix-fix', 'wvf-cross-above-range')
    expect(firesAt(range, series, 3)).toBe(true)
    expect(firesAt(range, series, 2)).toBe(false)
  })

  it('measures proximity against whichever trigger is nearer', () => {
    const series: AlarmSeries = {
      times: [0, 1, 2, 3, 4],
      wvf: [4, 5, 6, 7, 8],
      upperBand: [10, 10, 10, 10, 10],
      rangeHigh: [9, 9, 9, 9, 9],
      isGreen: [false, false, false, false, false],
    }
    const reading = evaluateIndicatorAlarm(alarm('cm-williams-vix-fix', 'wvf-about-spike'), series)
    expect(reading.active).toBe(true)
    expect(reading.estimate).toBeCloseTo(1, 5)
    expect(reading.detail).toContain('nearest trigger')
  })

  it('stays quiet when the nearest trigger already failed or is out of reach', () => {
    const beyond: AlarmSeries = {
      times: [0, 1, 2, 3, 4],
      wvf: [4, 5, 6, 7, 12],
      upperBand: [10, 10, 10, 10, 10],
      rangeHigh: [9, 9, 9, 9, 9],
      isGreen: [false, false, false, false, true],
    }
    expect(
      evaluateIndicatorAlarm(alarm('cm-williams-vix-fix', 'wvf-about-spike'), beyond).active,
    ).toBe(false)
    const far: AlarmSeries = {
      times: [0, 1, 2, 3, 4],
      wvf: [1, 1, 1, 1, 1],
      upperBand: [40, 40, 40, 40, 40],
      rangeHigh: [50, 50, 50, 50, 50],
      isGreen: [false, false, false, false, false],
    }
    expect(
      evaluateIndicatorAlarm(alarm('cm-williams-vix-fix', 'wvf-about-spike'), far).active,
    ).toBe(false)
  })

  it('compares the ratio against a level', () => {
    const series: AlarmSeries = { times: [0, 1], wvf: [8, 14] }
    expect(firesAt(alarm('cm-williams-vix-fix', 'wvf-above-level'), series, 1)).toBe(true)
    expect(firesAt(alarm('cm-williams-vix-fix', 'wvf-above-level'), series, 0)).toBe(false)
    expect(firesAt(alarm('cm-williams-vix-fix', 'wvf-below-level'), series, 1)).toBe(false)
  })
})

describe('combined alarms', () => {
  const leg = (
    indicator: AlarmIndicatorKind,
    condition: AlarmConditionId,
    params?: Record<string, number>,
  ) => ({ indicator, condition, params: params ?? defaultParams(condition) })
  /** MACD crosses green on bar 2; RSI is over 70 from bar 2 on. */
  const comboSeries = (rsi: (number | null)[]): AlarmSeries => ({
    times: [0, 1, 2, 3, 4],
    macd: [-1, -0.5, 0.5, 1, 1.5],
    signal: [0, 0, 0, 0, 0],
    histogram: [-1, -0.5, 0.5, 1, 1.5],
    rsi,
  })
  const macdAndRsi = (match: 'all' | 'any') =>
    alarm('macd', 'macd-cross-up', {
      also: [leg('rsi', 'rsi-above-level', { level: 70 })],
      match,
    })

  it('names every family and every leg it watches', () => {
    const spec = macdAndRsi('all')
    expect(alarmIndicatorLabel(spec)).toBe('MACD (12, 26, 9) + RSI (14)')
    expect(alarmHeadline(spec)).toBe('MACD turns green and RSI above 70')
    expect(alarmHeadline({ ...spec, match: 'any' })).toBe('MACD turns green or RSI above 70')
    expect(alarmEntries(spec)).toHaveLength(2)
    expect(alarmEntries(spec)[1].params).toEqual({ level: 70 })
  })

  it('fires only on the bar every leg of an "all" alarm holds together', () => {
    const spec = macdAndRsi('all')
    // RSI joins on the cross bar: the one bar both legs are true.
    const together = comboSeries([50, 60, 72, 74, 66])
    expect(firesAt(spec, together, 1)).toBe(false)
    expect(firesAt(spec, together, 2)).toBe(true)
    expect(firesAt(spec, together, 3)).toBe(false)
    expect(firesAt(spec, together, 4)).toBe(false)
    // RSI is only over the line a bar later: the cross bar missed its gate, so nothing fires.
    const late = comboSeries([50, 60, 66, 72, 74])
    expect(late.times.map((_, i) => i).filter((i) => firesAt(spec, late, i))).toEqual([])
  })

  it('fires on whichever leg of an "any" alarm gets there first', () => {
    const spec = macdAndRsi('any')
    // MACD crosses on bar 2 while RSI is still quiet: the cross alone fires the alarm.
    const cross = comboSeries([50, 55, 60, 64, 66])
    expect(cross.times.map((_, i) => i).filter((i) => firesAt(spec, cross, i))).toEqual([2])
    // The MACD never crosses here; RSI crossing 70 on bar 3 is what fires it.
    const rsiOnly: AlarmSeries = {
      times: [0, 1, 2, 3, 4],
      macd: [0, 0, 0, 0, 0],
      signal: [0, 0, 0, 0, 0],
      histogram: [0, 0, 0, 0, 0],
      rsi: [50, 60, 66, 72, 74],
    }
    expect(rsiOnly.times.map((_, i) => i).filter((i) => firesAt(spec, rsiOnly, i))).toEqual([3])
  })

  it('says which leg a combined alarm is still waiting on', () => {
    // A state leg holds while MACD stays above zero; only RSI is missing on the last bar.
    const stateAndRsi = alarm('macd', 'macd-above-level', {
      params: { level: 0 },
      also: [leg('rsi', 'rsi-above-level', { level: 70 })],
      match: 'all',
    })
    const waiting = evaluateIndicatorAlarm(stateAndRsi, comboSeries([50, 60, 72, 74, 66]))
    expect(waiting.active).toBe(false)
    expect(waiting.detail).toBe('Waiting on RSI above 70')
    // Nothing holds yet: the card says so instead of naming a single leg.
    const below: AlarmSeries = {
      times: [0, 1, 2, 3, 4],
      macd: [-1, -0.8, -0.6, -0.4, -0.2],
      signal: [0, 0, 0, 0, 0],
      histogram: [-1, -0.8, -0.6, -0.4, -0.2],
      rsi: [50, 55, 60, 62, 64],
    }
    expect(evaluateIndicatorAlarm(stateAndRsi, below).detail).toBe(
      'None of 2 yet: MACD above 0, RSI above 70',
    )
    // On the firing bar itself, both sentences name the legs that made it happen.
    const tape = slice(comboSeries([50, 60, 72, 74, 66]), 2)
    expect(evaluateIndicatorAlarm(macdAndRsi('all'), tape).detail).toBe(
      'All 2 conditions hold: MACD turns green, RSI above 70',
    )
    const any = evaluateIndicatorAlarm(macdAndRsi('any'), tape)
    expect(any.active).toBe(true)
    expect(any.detail).toBe('Triggered by MACD turns green, RSI above 70')
  })

  it('computes only the indicators the alarm actually reads', () => {
    const candles = rampCandles(120, (i) => 100 + Math.sin(i / 9) * 5)
    const combo = alarmSeries(candles, macdAndRsi('all'))
    expect(combo.macd).toBeDefined()
    expect(combo.rsi).toBeDefined()
    expect(combo.wvf).toBeUndefined()
    expect(alarmSeries(candles, alarm('rsi', 'rsi-cross-up-level')).macd).toBeUndefined()
  })

  it('keeps one MACD flavour per alarm and refuses duplicate legs', () => {
    const base = alarm('cm-ult-macd', 'macd-cross-up')
    expect(canAddEntry(base, leg('rsi', 'rsi-above-level'))).toBe(true)
    expect(canAddEntry(base, leg('macd', 'macd-cross-up'))).toBe(false)
    expect(canAddEntry(base, leg('cm-ult-macd', 'macd-cross-up'))).toBe(false)
    const four = {
      ...base,
      also: [
        leg('rsi', 'rsi-above-level'),
        leg('cm-williams-vix-fix', 'wvf-spike'),
        leg('rsi', 'rsi-below-level'),
      ],
    }
    expect(canAddEntry(four, leg('rsi', 'rsi-turns-up'))).toBe(false)
    expect(canAddEntry(base, leg('cm-williams-vix-fix', 'wvf-spike'))).toBe(true)
  })

  it('keeps an alarm with no extra legs exactly as it was', () => {
    const spec = alarm('rsi', 'rsi-cross-up-level')
    expect(alarmEntries(spec)).toHaveLength(1)
    expect(alarmHeadline(spec)).toBe('RSI crosses above a level')
    expect(alarmIndicatorLabel(spec)).toBe('RSI (14)')
  })

  it('validates the extra legs of a stored alarm', () => {
    const spec = macdAndRsi('all')
    expect(isIndicatorAlarm(spec)).toBe(true)
    expect(isIndicatorAlarm({ ...spec, also: [leg('macd', 'macd-cross-up')] })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, also: [] })).toBe(true)
    expect(
      isIndicatorAlarm({
        ...spec,
        also: [{ ...leg('rsi', 'rsi-turns-up'), condition: 'nope' as AlarmConditionId }],
      }),
    ).toBe(false)
    // A leg that does not belong to its family is invalid, not coerced.
    expect(isIndicatorAlarm({ ...spec, also: [leg('rsi', 'macd-cross-up')] })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, also: [leg('rsi', 'rsi-turns-up'), {}] })).toBe(false)
    expect(
      isIndicatorAlarm({ ...spec, also: [leg('rsi', 'rsi-turns-up'), leg('rsi', 'rsi-turns-up')] }),
    ).toBe(false)
    expect(isIndicatorAlarm({ ...spec, match: 'sometimes' })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, match: 'any' })).toBe(true)
    const five = {
      ...spec,
      also: [
        leg('rsi', 'rsi-above-level'),
        leg('rsi', 'rsi-below-level'),
        leg('rsi', 'rsi-turns-up'),
        leg('rsi', 'rsi-turns-down'),
      ],
    }
    expect(isIndicatorAlarm(five)).toBe(false)
  })
})

describe('proximity arithmetic', () => {
  it('divides the gap by typical per-bar movement', () => {
    expect(barsToTarget([0, 1, 2, 3, 4], 4, 6, 1, 10)).toBeCloseTo(2, 6)
    expect(typicalStep([0, 1, 2, 3, 4], 4)).toBeCloseTo(1, 6)
  })

  it('refuses a gap that is not closing, already closed, or measured with too little history', () => {
    expect(barsToTarget([0, 2, 4, 6], 3, 8, 1, 10)).toBeNull()
    expect(barsToTarget([0, 1, 2, 3], 3, 2, 1, 10)).toBeNull()
    expect(barsToTarget([null, null, null, null], 3, 5, 1, 10)).toBeNull()
    expect(typicalStep([null, null, 1, 2], 3)).toBeNull()
    expect(typicalStep([1, 1, 1, 1, 1], 4)).toBeNull()
  })

  it('measures the way down as well as the way up', () => {
    expect(barsToTarget([10, 9, 8, 7, 6], 4, 4, -1, 10)).toBeCloseTo(2, 6)
    expect(barsToTarget([10, 9, 8, 7, 6], 4, 12, -1, 10)).toBeNull()
  })
})

describe('bar selection and formatting', () => {
  it('drops only the bar whose bucket is still open', () => {
    const step = INTERVAL_SECONDS['1h']
    const candles: Candle[] = [
      { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: step, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: step * 2, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]
    // Half way through the third bucket: it is still forming.
    expect(closedCandles(candles, '1h', step * 2 + step / 2).map((c) => c.time)).toEqual([0, step])
    expect(closedCandles(candles, '1h', step * 3).map((c) => c.time)).toEqual([0, step, step * 2])
  })

  it('formats alarm numbers at a readable precision', () => {
    expect(formatAlarmNumber(1234.5678)).toBe('1235')
    expect(formatAlarmNumber(123.456)).toBe('123.5')
    expect(formatAlarmNumber(12.3456)).toBe('12.35')
    expect(formatAlarmNumber(0.123456)).toBe('0.1235')
    expect(formatAlarmNumber(0)).toBe('0')
    expect(formatAlarmNumber(0.0000123)).toBe('1.23e-5')
  })
})

describe('stored alarms', () => {
  it('accepts a freshly built alarm and rejects a condition that does not match its indicator', () => {
    const spec = alarm('cm-ult-macd', 'macd-hist-aqua')
    expect(isIndicatorAlarm(spec)).toBe(true)
    expect(isIndicatorAlarm({ ...spec, indicator: 'macd' })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, condition: 'rsi-turns-up' })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, timeframe: '2m' })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, params: { level: 'high' } })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, repeat: 'sometimes' })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, bars: 'always' })).toBe(false)
    expect(isIndicatorAlarm({ ...spec, cmMacd: { useCurrentRes: true } })).toBe(false)
    expect(isIndicatorAlarm(null)).toBe(false)
    expect(isIndicatorAlarm([])).toBe(false)
  })

  it('keeps the valid alarms and drops the rest of a stored list', () => {
    const good = alarm('rsi', 'rsi-cross-up-level')
    const other = alarm('cm-williams-vix-fix', 'wvf-spike', { id: 'b' })
    expect(sanitizeIndicatorAlarms([good, { junk: true }, other, 'nope']).map((a) => a.id)).toEqual(
      ['a', 'b'],
    )
    expect(sanitizeIndicatorAlarms('nope')).toEqual([])
    expect(sanitizeIndicatorAlarms(Array.from({ length: 40 }, () => good)).length).toBe(ALARM_LIMIT)
  })

  it('accepts stored trigger bookkeeping', () => {
    const spec: IndicatorAlarm = {
      ...alarm('rsi', 'rsi-cross-up-level'),
      lastTriggeredAt: CREATED,
      lastTriggeredBar: 1_700_000_000,
      triggerCount: 3,
      repeat: 'once',
      bars: 'closed',
      note: 'watch the 4h',
    }
    expect(isIndicatorAlarm(spec)).toBe(true)
  })
})
