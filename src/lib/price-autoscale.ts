import type { AutoscaleInfo, AutoscaleInfoProvider, IRange, Logical } from 'lightweight-charts'

/**
 * Outlier-resistant price scaling for the candle pane.
 *
 * Lightweight Charts fits the price axis to the raw min/max of the visible bars —
 * including every wick. A single bad print (one crossed trade merged into a bar's
 * high/low, one venue glitch) then stretches the axis to that outlier, and the
 * candles collapse into a thin unreadable band with huge steps between price
 * labels — and no amount of time-zooming brings them back.
 *
 * The rules below keep the scale honest about real price action while making it
 * immune to that flattening:
 *
 * - Candle BODIES always set the scale. A genuinely large candle (earnings bar,
 *   flash move) is never hidden, because bodies are never clipped.
 * - WICK excursions past `WICK_CLIP` typical bar ranges (or `WICK_CLIP_BODY` of the
 *   bar's own body heights, whichever is larger) are treated as tape glitches and
 *   clipped for scaling purposes only. The wick is still drawn and simply runs off
 *   the pane edge when the user zooms into the bodies — exactly what manual
 *   price-zoom does on any trading terminal.
 */

/** How many median bar ranges a wick may extend past its body before it is a glitch. */
export const WICK_CLIP = 8

/** A volatile bar's own wicks may also reach this many body-heights past its body. */
export const WICK_CLIP_BODY = 3

/** Floor for the clip allowance on dead-flat markets, as a fraction of the price level. */
export const CLIP_FLOOR = 0.0005

export interface Ohlc {
  open: number
  high: number
  low: number
  close: number
}

export type PriceRange = { minValue: number; maxValue: number }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * The price range the candle pane should show for candles[from..to] (inclusive,
 * out-of-range indices are clamped). Null when the window has no candles.
 */
export function robustPriceRange(
  candles: readonly Ohlc[],
  from: number,
  to: number,
): PriceRange | null {
  const first = Math.max(0, Math.floor(from))
  const last = Math.min(candles.length - 1, Math.ceil(to))
  if (!candles.length || last < first) return null
  const visible = candles.slice(first, last + 1)
  const ranges: number[] = []
  const mids: number[] = []
  for (const candle of visible) {
    ranges.push(candle.high - candle.low)
    mids.push((candle.high + candle.low) / 2)
  }
  const center = median(mids)
  const medRange = Math.abs(median(ranges))
  let minValue = Infinity
  let maxValue = -Infinity
  for (const candle of visible) {
    const bodyLow = Math.min(candle.open, candle.close)
    const bodyHigh = Math.max(candle.open, candle.close)
    // Each bar's wicks may reach past their body by the larger of: several typical
    // bar ranges (so isolated tape glitches are clipped), several of the bar's own
    // body heights (so genuine volatile candles keep their wicks), and a small
    // price-relative floor (so dead-flat markets still have room).
    const clip = Math.max(
      WICK_CLIP * medRange,
      WICK_CLIP_BODY * (bodyHigh - bodyLow),
      Math.abs(center) * CLIP_FLOOR,
    )
    // Bodies decide the range outright; wicks only reach `clip` past their body.
    const low = Math.max(candle.low, bodyLow - clip)
    const high = Math.min(candle.high, bodyHigh + clip)
    minValue = Math.min(minValue, low, bodyLow)
    maxValue = Math.max(maxValue, high, bodyHigh)
  }
  return { minValue, maxValue }
}

/**
 * Series `autoscaleInfoProvider` for the candle series: the robust visible-candle
 * range, with the base implementation's pixel margins preserved. Falls back to
 * the native range whenever the robust one cannot be computed (no data, no
 * visible window yet).
 */
export function candleAutoscale(
  getCandles: () => readonly Ohlc[],
  getVisibleLogicalRange: () => IRange<Logical> | null,
): AutoscaleInfoProvider {
  return (baseImplementation): AutoscaleInfo | null => {
    const base = baseImplementation()
    const window = getVisibleLogicalRange()
    if (!window) return base
    // One bar of slack on each side: the scale's visible window can differ
    // slightly from the time scale's logical range at the edges.
    const range = robustPriceRange(getCandles(), Number(window.from) - 1, Number(window.to) + 1)
    if (!range) return base
    return { priceRange: range, ...(base?.margins ? { margins: base.margins } : {}) }
  }
}
