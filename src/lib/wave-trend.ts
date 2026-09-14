/**
 * Behavioral port of LazyBear's WaveTrend [LazyBear] (short title `WT_LB`,
 * published 2014), the Pine v1 port of the TS/MT "WaveTrend oscillator".
 * Reference/provenance, the flat-channel convention and the parity boundaries:
 * docs/wave-trend.md.
 */
import { pineEma, ta } from './indicator-runtime'
import type { Candle, Indicator, Plot, WaveTrendSettings } from './types'

export const WAVE_TREND_SOURCE =
  'https://www.tradingview.com/script/2KE8wTuF-Indicator-WaveTrend-Oscillator-WT/'
export const WAVE_TREND_DEFAULTS: Readonly<WaveTrendSettings> = {
  channelLength: 10,
  averageLength: 21,
  obLevel1: 60,
  obLevel2: 53,
  osLevel1: -60,
  osLevel2: -53,
}
/** Original Pine v1 named colors, not Atlas's theme and not Pine v6's palette. */
export const WT_COLORS = {
  green: '#008000',
  red: '#ff0000',
  gray: '#808080',
  blue: '#0000ff',
} as const
/** Original `plot(wt1-wt2, color=blue, style=area, transp=80)`. */
export const WT_AREA_TRANSPARENCY = 80
/** The original's hard-coded `sma(wt1, 4)`; it is not an input. */
export const WT_SIGNAL_LENGTH = 4
/** The original's hard-coded `(ap - esa) / (0.015 * d)`; it is not an input. */
export const WT_SCALE = 0.015
type Values = (number | null)[]
export interface WaveTrendValues {
  wt1: Values
  wt2: Values
  /** `wt1 - wt2`, the original's area plot. */
  diff: Values
}

export function isWaveTrendSettings(value: unknown): value is WaveTrendSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as WaveTrendSettings
  return (
    [s.channelLength, s.averageLength].every((n) => Number.isInteger(n) && n >= 1 && n <= 2000) &&
    [s.obLevel1, s.obLevel2, s.osLevel1, s.osLevel2].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100000,
    )
  )
}
export function waveTrendSettings(indicator: Indicator): WaveTrendSettings {
  return isWaveTrendSettings(indicator.waveTrend) ? indicator.waveTrend : { ...WAVE_TREND_DEFAULTS }
}
export function waveTrendIndicatorLabel(indicator: Indicator): string {
  const settings = waveTrendSettings(indicator)
  return `WaveTrend [LazyBear] (${settings.channelLength}, ${settings.averageLength})`
}

/**
 * The published recurrence, in the published order, on `hlc3`:
 * esa = ema(ap, n1); d = ema(|ap - esa|, n1); ci = (ap - esa) / (0.015 * d);
 * wt1 = ema(ci, n2); wt2 = sma(wt1, 4).
 */
export function calculateWaveTrend(
  candles: Candle[],
  settings: WaveTrendSettings,
): WaveTrendValues {
  if (!isWaveTrendSettings(settings)) throw new Error('Invalid WaveTrend settings.')
  const ap = candles.map((candle) => (candle.high + candle.low + candle.close) / 3)
  const esa = pineEma(ap, settings.channelLength)
  const d = pineEma(
    ap.map((value, i) => Math.abs(value - esa[i])),
    settings.channelLength,
  )
  const ci = ap.map((value, i) => {
    const scale = WT_SCALE * d[i]
    // Pine divides by zero on the seeded first bar and whenever the price channel
    // is perfectly flat; there the numerator is zero too, so the flat-price
    // limit 0 is used instead of a NaN that would poison the recursive EMA.
    return scale === 0 ? 0 : (value - esa[i]) / scale
  })
  const wt1 = pineEma(ci, settings.averageLength)
  const wt2 = ta.sma(wt1, WT_SIGNAL_LENGTH)
  return {
    wt1,
    wt2,
    diff: wt1.map((value, i) => (value === null || wt2[i] === null ? null : value - wt2[i]!)),
  }
}

export function waveTrendPlots(values: WaveTrendValues, settings: WaveTrendSettings): Plot[] {
  const level = (
    title: string,
    price: number,
    color: string,
    // Legacy Pine v1 numeric style 3 — the cross/circle marker style, which is
    // what gives the second levels and the signal their dotted appearance.
    style: 'line' | 'cross',
  ): Plot => ({
    title,
    values: values.wt1.map(() => price),
    color,
    pane: 'oscillator',
    lineWidth: 1,
    style,
    horizontalLine: price,
    hideLegend: true,
  })
  return [
    { title: 'WT1', values: values.wt1, color: WT_COLORS.green, pane: 'oscillator', lineWidth: 1 },
    {
      title: 'WT2',
      values: values.wt2,
      color: WT_COLORS.red,
      pane: 'oscillator',
      lineWidth: 1,
      style: 'cross',
    },
    {
      title: 'WT1 - WT2',
      values: values.diff,
      color: WT_COLORS.blue,
      pane: 'oscillator',
      lineWidth: 1,
      style: 'area',
      transp: WT_AREA_TRANSPARENCY,
    },
    level('Zero', 0, WT_COLORS.gray, 'line'),
    level('Over Bought Level 1', settings.obLevel1, WT_COLORS.red, 'line'),
    level('Over Sold Level 1', settings.osLevel1, WT_COLORS.green, 'line'),
    level('Over Bought Level 2', settings.obLevel2, WT_COLORS.red, 'cross'),
    level('Over Sold Level 2', settings.osLevel2, WT_COLORS.green, 'cross'),
  ]
}
