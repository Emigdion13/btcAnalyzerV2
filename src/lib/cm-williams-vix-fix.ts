/**
 * Behavioral port of ChrisMoody's CM_Williams_Vix_Fix (short title
 * `CM_Williams_Vix_Fix`, legend `(22, 20, 2, 50, 0.85, 1.01)`), Larry Williams'
 * synthetic VIX applied to any asset to find market bottoms.
 * Reference/provenance and the parity boundaries: docs/cm-williams-vix-fix.md.
 */
import { ta } from './indicator-runtime'
import type { Candle, Indicator, Plot, WilliamsVixFixSettings } from './types'

export const WILLIAMS_VIX_FIX_SOURCE =
  'https://www.tradingview.com/script/og7JPrRA-CM-Williams-Vix-Fix-Finds-Market-Bottoms/'
export const CM_WILLIAMS_VIX_FIX_DEFAULTS: Readonly<WilliamsVixFixSettings> = {
  pd: 22,
  bbl: 20,
  mult: 2,
  lb: 50,
  ph: 0.85,
  pl: 1.01,
  showHighRange: false,
  showStdDevLine: false,
}
/** Original Pine v1 named colors, not Atlas's theme and not Pine v6's palette. */
export const WVF_COLORS = {
  lime: '#00ff00',
  gray: '#808080',
  orange: '#ff9800',
  aqua: '#00ffff',
} as const
type Values = (number | null)[]
export interface WilliamsVixFixValues {
  /** `((highest(close, pd) - low) / highest(close, pd)) * 100`, the histogram. */
  wvf: Values
  /** `sma(wvf, bbl)`, the Bollinger midline (computed, never plotted). */
  midLine: Values
  /** `midLine - mult * stdev(wvf, bbl)` (computed, never plotted). */
  lowerBand: Values
  /** `midLine + mult * stdev(wvf, bbl)`, the aqua line when `sd` is on. */
  upperBand: Values
  /** `highest(wvf, lb) * ph`, the orange range line when `hp` is on. */
  rangeHigh: Values
  /** `lowest(wvf, lb) * pl`, the orange range line when `hp` is on. */
  rangeLow: Values
  /** `wvf >= upperBand or wvf >= rangeHigh` — the lime fear-spike bars. */
  isGreen: boolean[]
}

export function isWilliamsVixFixSettings(value: unknown): value is WilliamsVixFixSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as WilliamsVixFixSettings
  return (
    [s.pd, s.bbl, s.lb].every((n) => Number.isInteger(n) && n >= 1 && n <= 2000) &&
    typeof s.mult === 'number' &&
    Number.isFinite(s.mult) &&
    s.mult >= 1 &&
    s.mult <= 5 &&
    [s.ph, s.pl].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 5) &&
    [s.showHighRange, s.showStdDevLine].every((v) => typeof v === 'boolean')
  )
}
export function williamsVixFixSettings(indicator: Indicator): WilliamsVixFixSettings {
  return isWilliamsVixFixSettings(indicator.williamsVixFix)
    ? indicator.williamsVixFix
    : { ...CM_WILLIAMS_VIX_FIX_DEFAULTS }
}
export function williamsVixFixIndicatorLabel(indicator: Indicator): string {
  const s = williamsVixFixSettings(indicator)
  return `CM_Williams_Vix_Fix (${s.pd}, ${s.bbl}, ${s.mult}, ${s.lb}, ${s.ph}, ${s.pl})`
}

/**
 * The published recurrence, in the published order:
 * wvf = ((highest(close, pd) - low) / highest(close, pd)) * 100;
 * sDev = mult * stdev(wvf, bbl); midLine = sma(wvf, bbl);
 * upperBand = midLine + sDev; lowerBand = midLine - sDev;
 * rangeHigh = highest(wvf, lb) * ph; rangeLow = lowest(wvf, lb) * pl.
 */
export function calculateWilliamsVixFix(
  candles: Candle[],
  settings: WilliamsVixFixSettings,
): WilliamsVixFixValues {
  if (!isWilliamsVixFixSettings(settings)) throw new Error('Invalid Williams VIX Fix settings.')
  const close = candles.map((candle) => candle.close)
  const low = candles.map((candle) => candle.low)
  const highestClose = ta.highest(close, settings.pd)
  const wvf = close.map((_, i) => {
    const highest = highestClose[i]
    // Pine yields `na` until `pd` closes exist; a zero highest close would divide by zero.
    if (highest === null || highest === 0) return null
    return ((highest - low[i]) / highest) * 100
  })
  const stdev = ta.stdev(wvf, settings.bbl)
  const midLine = ta.sma(wvf, settings.bbl)
  const upperBand = midLine.map((mid, i) =>
    mid === null || stdev[i] === null ? null : mid + settings.mult * stdev[i]!,
  )
  const lowerBand = midLine.map((mid, i) =>
    mid === null || stdev[i] === null ? null : mid - settings.mult * stdev[i]!,
  )
  const highestWvf = ta.highest(wvf, settings.lb)
  const lowestWvf = ta.lowest(wvf, settings.lb)
  const rangeHigh = highestWvf.map((value) => (value === null ? null : value * settings.ph))
  const rangeLow = lowestWvf.map((value) => (value === null ? null : value * settings.pl))
  // Pine comparisons against `na` are false, so a bar with no band or range is gray, never lime.
  const isGreen = wvf.map((value, i) => {
    if (value === null) return false
    const upper = upperBand[i]
    const range = rangeHigh[i]
    return (upper !== null && value >= upper) || (range !== null && value >= range)
  })
  return { wvf, midLine, lowerBand, upperBand, rangeHigh, rangeLow, isGreen }
}

export function williamsVixFixPlots(
  values: WilliamsVixFixValues,
  settings: WilliamsVixFixSettings,
): Plot[] {
  const plots: Plot[] = [
    {
      title: 'Williams Vix Fix',
      values: values.wvf,
      color: WVF_COLORS.lime,
      pane: 'oscillator',
      lineWidth: 4,
      style: 'histogram',
      colors: values.wvf.map((_, i) => (values.isGreen[i] ? WVF_COLORS.lime : WVF_COLORS.gray)),
    },
  ]
  // `hp and rangeHigh ? rangeHigh : na` — nothing is drawn while the toggle is off.
  if (settings.showHighRange) {
    plots.push({
      title: 'Range High Percentile',
      values: values.rangeHigh,
      color: WVF_COLORS.orange,
      pane: 'oscillator',
      lineWidth: 4,
    })
    plots.push({
      title: 'Range Low Percentile',
      values: values.rangeLow,
      color: WVF_COLORS.orange,
      pane: 'oscillator',
      lineWidth: 4,
    })
  }
  // `sd and upperBand ? upperBand : na` — the midline and lower band are never plotted.
  if (settings.showStdDevLine) {
    plots.push({
      title: 'Upper Band',
      values: values.upperBand,
      color: WVF_COLORS.aqua,
      pane: 'oscillator',
      lineWidth: 3,
    })
  }
  return plots
}
