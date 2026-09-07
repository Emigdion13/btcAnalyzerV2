/**
 * Behavioral port of ChrisMoody's original CM_MacD_Ult_MTF (April 2014),
 * NOT the V2 update and NOT the conventional EMA-signal MACD.
 * Reference/provenance and historical lookahead caveats: docs/cm-ult-macd.md.
 */
import { bucketStart, INTERVAL_SECONDS, isInterval } from '../../shared/coinbase'
import { ta } from './indicator-runtime'
import { smcIndicatorLabel, smcSettings } from './smart-money-concepts'
import { srBreaksRetestsIndicatorLabel } from './sr-breaks-retests'
import type { Candle, CmMacdSettings, ConnectionState, Indicator, Plot, Timeframe } from './types'

export const CM_MACD_SOURCE =
  'https://www.tradingview.com/script/OQx7vju0-MacD-Custom-Indicator-Multiple-Time-Frame-All-Available-Options/'
export const CM_MACD_DEFAULTS: Readonly<CmMacdSettings> = {
  useCurrentRes: true,
  resCustom: '1h',
  fastLength: 12,
  slowLength: 26,
  signalLength: 9,
  showLines: true,
  showDots: true,
  showHistogram: true,
  macdColorChange: true,
  histogramColorChange: true,
}
// Original Pine v1 named colors, not Atlas's theme or Pine v6's revised palette.
export const CM_COLORS = {
  aqua: '#00ffff',
  blue: '#0000ff',
  red: '#ff0000',
  maroon: '#800000',
  yellow: '#ffff00',
  gray: '#808080',
  lime: '#00ff00',
  white: '#ffffff',
} as const
export const CM_RESOLUTIONS: Record<Timeframe, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1D': 'D',
  '1W': 'W',
}
export interface IndicatorTimeframeData {
  candles: Candle[]
  state: ConnectionState
  message: string
  asOf: number
}
export type IndicatorTimeframes = Partial<Record<Timeframe, IndicatorTimeframeData>>
export interface IndicatorContext {
  timeframe: Timeframe
  timeframes?: IndicatorTimeframes
  replay?: boolean
  /** First bar observed in this live calculation session; earlier bars are historical. */
  realtimeFrom?: number
}
type Values = (number | null)[]
export interface CmMacdValues {
  macd: Values
  signal: Values
  histogram: Values
}

export function isCmMacdSettings(value: unknown): value is CmMacdSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as CmMacdSettings
  return (
    isInterval(s.resCustom) &&
    [s.fastLength, s.slowLength, s.signalLength].every(
      (n) => Number.isInteger(n) && n >= 1 && n <= 2000,
    ) &&
    [
      s.useCurrentRes,
      s.showLines,
      s.showDots,
      s.showHistogram,
      s.macdColorChange,
      s.histogramColorChange,
    ].every((v) => typeof v === 'boolean')
  )
}
export function cmMacdSettings(indicator: Indicator): CmMacdSettings {
  return isCmMacdSettings(indicator.cmMacd) ? indicator.cmMacd : { ...CM_MACD_DEFAULTS }
}
export function cmMacdResolution(settings: CmMacdSettings, chart: Timeframe): Timeframe {
  return settings.useCurrentRes ? chart : settings.resCustom
}
export function indicatorLabel(indicator: Indicator): string {
  if (indicator.kind === 'cm-ult-macd') {
    const s = cmMacdSettings(indicator)
    return `CM_Ult_MacD_MTF (${CM_RESOLUTIONS[s.resCustom]}, ${s.fastLength}, ${s.slowLength}, ${s.signalLength})`
  }
  if (indicator.kind === 'smart-money-concepts') return smcIndicatorLabel(indicator)
  if (indicator.kind === 'sr-breaks-retests') return srBreaksRetestsIndicatorLabel(indicator)
  return `${indicator.name}${['volume', 'vwap', 'custom'].includes(indicator.kind) ? '' : ` ${indicator.period}`}`
}
export function requestedIndicatorTimeframes(
  indicators: Indicator[],
  chart: Timeframe,
): Timeframe[] {
  const cmResolutions = indicators
    .filter((indicator) => indicator.kind === 'cm-ult-macd' && indicator.visible)
    .map((indicator) => cmMacdResolution(cmMacdSettings(indicator), chart))
  const smcFvgResolutions = indicators
    .filter(
      (indicator) =>
        indicator.kind === 'smart-money-concepts' &&
        indicator.visible &&
        smcSettings(indicator).showFairValueGaps,
    )
    .map((indicator) => smcSettings(indicator).fvgTimeframe)
    .filter((resolution): resolution is Timeframe => !!resolution)
  return [
    ...new Set(
      [...cmResolutions, ...smcFvgResolutions].filter((resolution) => resolution !== chart),
    ),
  ].sort()
}

/** Pine ema() seeds from the first close. Do NOT change the Studio's SMA-seeded ta.ema. */
export function pineEma(values: number[], length: number): number[] {
  if (!Number.isInteger(length) || length < 1 || length > 2000)
    throw new Error('EMA length must be an integer between 1 and 2000.')
  const alpha = 2 / (length + 1)
  let previous = values[0]
  return values.map((value, i) => {
    previous = i === 0 ? value : alpha * value + (1 - alpha) * previous
    return previous
  })
}
function nativeValues(candles: Candle[], settings: CmMacdSettings) {
  const closes = candles.map((c) => c.close)
  const fast = pineEma(closes, settings.fastLength)
  const slow = pineEma(closes, settings.slowLength)
  const macd = fast.map((value, i) => value - slow[i])
  const signal = ta.sma(macd, settings.signalLength)
  return {
    fast,
    slow,
    macd,
    signal,
    histogram: macd.map((value, i) => (signal[i] === null ? null : value - signal[i]!)),
  }
}

/**
 * Evaluate in the requested resolution FIRST, then emulate v1 security(gaps_off,
 * lookahead_on). Colors and cross() must be evaluated AFTER this projection.
 * Native candles are required for a different resolution: a 300 x 1m chart is
 * not sufficient history for a 26 x 1h EMA, and cannot supply lower timeframes.
 */
export function calculateCmMacd(
  chart: Candle[],
  settings: CmMacdSettings,
  context: IndicatorContext = { timeframe: '1h' },
): CmMacdValues {
  if (!isCmMacdSettings(settings)) throw new Error('Invalid CM_Ult_MacD_MTF settings.')
  const resolution = cmMacdResolution(settings, context.timeframe)
  const source =
    resolution === context.timeframe ? chart : (context.timeframes?.[resolution]?.candles ?? [])
  const empty = () => chart.map(() => null)
  if (!source.length || !chart.length) return { macd: empty(), signal: empty(), histogram: empty() }
  const native = nativeValues(source, settings)
  if (resolution === context.timeframe)
    return { macd: native.macd, signal: native.signal, histogram: native.histogram }

  const chartStep = INTERVAL_SECONDS[context.timeframe]
  const sourceStep = INTERVAL_SECONDS[resolution]
  const cutoff = chart.at(-1)!.time + chartStep
  const result: CmMacdValues = { macd: [], signal: [], histogram: [] }
  let cursor = -1
  const append = (macd: number | null, signal: number | null) => {
    result.macd.push(macd)
    result.signal.push(signal)
    result.histogram.push(macd === null || signal === null ? null : macd - signal)
  }
  for (const candle of chart) {
    const realtime = !context.replay && candle.time >= (context.realtimeFrom ?? Infinity)
    if (sourceStep > chartStep) {
      const bucket = bucketStart(candle.time, resolution)
      while (cursor + 1 < source.length && source[cursor + 1].time <= bucket) cursor++
      if (cursor < 0) {
        append(null, null)
        continue
      }
      const developing =
        source[cursor].time === bucket &&
        (realtime || (context.replay && bucket + sourceStep > cutoff))
      if (developing) {
        // Recompute ONE unclosed HTF observation from the chart close and the
        // previous native EMA states; never append each small candle to the EMA.
        // In replay this also avoids reading the future final HTF close.
        const fastAlpha = 2 / (settings.fastLength + 1)
        const slowAlpha = 2 / (settings.slowLength + 1)
        const fast =
          cursor === 0
            ? candle.close
            : fastAlpha * candle.close + (1 - fastAlpha) * native.fast[cursor - 1]
        const slow =
          cursor === 0
            ? candle.close
            : slowAlpha * candle.close + (1 - slowAlpha) * native.slow[cursor - 1]
        const macd = fast - slow
        const prior = native.macd.slice(Math.max(0, cursor - settings.signalLength + 1), cursor)
        const signal =
          prior.length === settings.signalLength - 1
            ? (prior.reduce((sum, value) => sum + value, 0) + macd) / settings.signalLength
            : null
        append(macd, signal)
      } else append(native.macd[cursor], native.signal[cursor])
    } else {
      // v1 historical LTF security selects the FIRST intrabar, not the last.
      // On realtime bars it instead reports the latest available intrabar.
      while (cursor + 1 < source.length && source[cursor + 1].time < candle.time) cursor++
      let selected = cursor
      if (cursor + 1 < source.length && source[cursor + 1].time < candle.time + chartStep)
        selected = cursor + 1
      if (realtime || (context.replay && candle === chart.at(-1))) {
        while (selected + 1 < source.length && source[selected + 1].time < candle.time + chartStep)
          selected++
      }
      // Do not imply coverage for a chart candle that predates the loaded LTF window.
      if (selected < 0 || candle.time < source[0].time) append(null, null)
      else append(native.macd[selected], native.signal[selected])
    }
  }
  return result
}

export function cmHistogramColor(
  value: number | null,
  previous: number | null,
  change = true,
): string {
  if (!change) return CM_COLORS.gray
  if (value !== null && previous !== null) {
    if (value > previous && value > 0) return CM_COLORS.aqua
    if (value < previous && value > 0) return CM_COLORS.blue
    if (value < previous && value <= 0) return CM_COLORS.red
    if (value > previous && value <= 0) return CM_COLORS.maroon
  }
  // Strict comparisons in the original: flat and unavailable comparisons are yellow.
  return CM_COLORS.yellow
}
export function cmMacdPlots(values: CmMacdValues, settings: CmMacdSettings): Plot[] {
  const { macd, signal, histogram } = values
  const colors = macd.map((value, i) =>
    settings.macdColorChange && value !== null && signal[i] !== null && value >= signal[i]!
      ? CM_COLORS.lime
      : CM_COLORS.red,
  )
  const crosses = macd.map((value, i) => {
    if (
      !settings.showDots ||
      i === 0 ||
      value === null ||
      signal[i] === null ||
      macd[i - 1] === null ||
      signal[i - 1] === null
    )
      return null
    const delta = value - signal[i]!
    const previous = macd[i - 1]! - signal[i - 1]!
    return (delta > 0 && previous <= 0) || (delta < 0 && previous >= 0) ? signal[i] : null
  })
  // Original `smd and outMacD ? outMacD : na` also suppresses EXACT zeros.
  // Dots use an independent sd toggle and do allow signal == 0.
  const shown = (data: Values, visible: boolean) => data.map((v) => (visible && v !== 0 ? v : null))
  const plot = (title: string, data: Values, color: string, lineWidth: number): Plot => ({
    title,
    values: data,
    color,
    lineWidth,
    pane: 'oscillator',
  })
  return [
    {
      ...plot(
        'MACD',
        shown(macd, settings.showLines),
        settings.macdColorChange ? CM_COLORS.lime : CM_COLORS.red,
        4,
      ),
      colors,
    },
    plot(
      'Signal Line',
      shown(signal, settings.showLines),
      settings.macdColorChange ? CM_COLORS.yellow : CM_COLORS.lime,
      2,
    ),
    {
      ...plot(
        'Histogram',
        shown(histogram, settings.showHistogram),
        settings.histogramColorChange ? CM_COLORS.aqua : CM_COLORS.gray,
        4,
      ),
      style: 'histogram',
      colors: histogram.map((v, i) =>
        cmHistogramColor(v, histogram[i - 1] ?? null, settings.histogramColorChange),
      ),
    },
    {
      ...plot('Cross', crosses, settings.macdColorChange ? CM_COLORS.lime : CM_COLORS.red, 4),
      style: 'circles',
      colors,
    },
    {
      ...plot(
        '0 Line',
        macd.map(() => 0),
        CM_COLORS.white,
        2,
      ),
      horizontalLine: 0,
      hideLegend: true,
    },
  ]
}
