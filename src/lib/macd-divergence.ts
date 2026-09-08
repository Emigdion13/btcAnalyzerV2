/**
 * MACD histogram divergence detection, shared by the conventional MACD and the
 * ChrisMoody CM_Ult_MacD_MTF. Divergence compares consecutive confirmed pivots
 * on the MACD histogram against the corresponding price pivots:
 *
 *   Regular bullish  price lower low   + histogram higher low   (reversal up)
 *   Regular bearish  price higher high + histogram lower high   (reversal down)
 *   Hidden  bullish  price higher low  + histogram lower low    (uptrend continues)
 *   Hidden  bearish  price lower high  + histogram higher high  (downtrend continues)
 *
 * Pivots are confirmed only after `pivotLookback` bars on each side, so the most
 * recent bars never carry a pivot until enough future bars exist — the marker is
 * anchored to the confirming (second) pivot, matching TradingView's behavior.
 */
import { DIVERGENCE_DEFAULTS } from './types'
import type { Candle, DivergenceSettings, Indicator } from './types'

export const DIVERGENCE_COLORS = {
  regularBullish: '#26a69a',
  regularBearish: '#ef5350',
  hiddenBullish: '#66bb6a',
  hiddenBearish: '#ff7043',
} as const

export type DivergenceKind =
  'regular-bullish' | 'regular-bearish' | 'hidden-bullish' | 'hidden-bearish'

export interface Divergence {
  kind: DivergenceKind
  bullish: boolean
  hidden: boolean
  /** Index of the earlier (from) pivot. */
  fromIndex: number
  /** Index of the confirming (to) pivot, where the label is anchored. */
  toIndex: number
  /** Histogram values at each pivot, used to draw the connecting line. */
  fromValue: number
  toValue: number
  color: string
  label: string
}

export function divergenceSettings(indicator: Indicator): DivergenceSettings {
  return isDivergenceSettings(indicator.divergence)
    ? indicator.divergence
    : { ...DIVERGENCE_DEFAULTS }
}
export function divergenceEnabled(indicator: Indicator): boolean {
  if (indicator.kind !== 'macd' && indicator.kind !== 'cm-ult-macd') return false
  if (!indicator.divergence) return false
  const s = divergenceSettings(indicator)
  return s.showRegular || s.showHidden
}

export function isDivergenceSettings(value: unknown): value is DivergenceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as DivergenceSettings
  return (
    [s.showRegular, s.showHidden, s.showLines, s.showLabels].every((v) => typeof v === 'boolean') &&
    [s.pivotLookback, s.rangeUpper, s.rangeLower].every(
      (n) => Number.isInteger(n) && n >= 1 && n <= 1000,
    ) &&
    s.rangeUpper >= s.rangeLower
  )
}

/**
 * Confirmed pivot lows/highs of a series. A bar is a pivot low when it is
 * strictly lower than the `lookback` bars on each side (ties are not pivots),
 * and symmetrically for pivot highs. Bars without `lookback` neighbours on both
 * sides can never be pivots, so returns are always null there.
 */
export function pivotIndices(
  values: (number | null)[],
  lookback: number,
): { lows: boolean[]; highs: boolean[] } {
  const n = values.length
  const lows = new Array<boolean>(n).fill(false)
  const highs = new Array<boolean>(n).fill(false)
  if (lookback < 1) return { lows, highs }
  for (let i = lookback; i < n - lookback; i++) {
    const value = values[i]
    if (value === null || !Number.isFinite(value)) continue
    let isLow = true
    let isHigh = true
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue
      const other = values[j]
      if (other === null || !Number.isFinite(other)) {
        isLow = false
        isHigh = false
        break
      }
      if (other <= value) isLow = false
      if (other >= value) isHigh = false
    }
    lows[i] = isLow
    highs[i] = isHigh
  }
  return { lows, highs }
}

/**
 * Detect regular and hidden divergences between MACD-histogram pivots and price.
 * `histogram` and `candles` must be index-aligned. Divergences are compared
 * between each confirmed pivot and the previous confirmed pivot of the same kind
 * within [rangeLower, rangeUpper] bars.
 */
export function detectMacdDivergences(
  candles: Candle[],
  histogram: (number | null)[],
  settings: DivergenceSettings,
): Divergence[] {
  if (!isDivergenceSettings(settings)) return []
  if (!settings.showRegular && !settings.showHidden) return []
  const { lows, highs } = pivotIndices(histogram, settings.pivotLookback)
  const results: Divergence[] = []
  const inRange = (from: number, to: number) => {
    const gap = to - from
    return gap >= settings.rangeLower && gap <= settings.rangeUpper
  }

  // Bullish divergences pair consecutive histogram pivot LOWS with price lows.
  let previousLow = -1
  for (let i = 0; i < histogram.length; i++) {
    if (!lows[i]) continue
    if (previousLow >= 0 && inRange(previousLow, i)) {
      const histFrom = histogram[previousLow]!
      const histTo = histogram[i]!
      const priceFrom = candles[previousLow].low
      const priceTo = candles[i].low
      // Regular bullish: price makes a lower low, histogram a higher low.
      if (settings.showRegular && priceTo < priceFrom && histTo > histFrom) {
        results.push({
          kind: 'regular-bullish',
          bullish: true,
          hidden: false,
          fromIndex: previousLow,
          toIndex: i,
          fromValue: histFrom,
          toValue: histTo,
          color: DIVERGENCE_COLORS.regularBullish,
          label: 'Bull',
        })
      }
      // Hidden bullish: price makes a higher low, histogram a lower low.
      else if (settings.showHidden && priceTo > priceFrom && histTo < histFrom) {
        results.push({
          kind: 'hidden-bullish',
          bullish: true,
          hidden: true,
          fromIndex: previousLow,
          toIndex: i,
          fromValue: histFrom,
          toValue: histTo,
          color: DIVERGENCE_COLORS.hiddenBullish,
          label: 'H Bull',
        })
      }
    }
    previousLow = i
  }

  // Bearish divergences pair consecutive histogram pivot HIGHS with price highs.
  let previousHigh = -1
  for (let i = 0; i < histogram.length; i++) {
    if (!highs[i]) continue
    if (previousHigh >= 0 && inRange(previousHigh, i)) {
      const histFrom = histogram[previousHigh]!
      const histTo = histogram[i]!
      const priceFrom = candles[previousHigh].high
      const priceTo = candles[i].high
      // Regular bearish: price makes a higher high, histogram a lower high.
      if (settings.showRegular && priceTo > priceFrom && histTo < histFrom) {
        results.push({
          kind: 'regular-bearish',
          bullish: false,
          hidden: false,
          fromIndex: previousHigh,
          toIndex: i,
          fromValue: histFrom,
          toValue: histTo,
          color: DIVERGENCE_COLORS.regularBearish,
          label: 'Bear',
        })
      }
      // Hidden bearish: price makes a lower high, histogram a higher high.
      else if (settings.showHidden && priceTo < priceFrom && histTo > histFrom) {
        results.push({
          kind: 'hidden-bearish',
          bullish: false,
          hidden: true,
          fromIndex: previousHigh,
          toIndex: i,
          fromValue: histFrom,
          toValue: histTo,
          color: DIVERGENCE_COLORS.hiddenBearish,
          label: 'H Bear',
        })
      }
    }
    previousHigh = i
  }

  return results.sort((a, b) => a.toIndex - b.toIndex)
}
