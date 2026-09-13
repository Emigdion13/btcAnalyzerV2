import type { BrtiAnchor, BrtiSample } from '../../shared/kalshi'

/** A point on the CF Benchmarks index overlay, snapped to the chart's own time grid. */
export interface BrtiPoint {
  time: number
  value: number
}

/**
 * Snap CF Benchmarks index values onto the chart's candle grid.
 *
 * This matters more than it looks. lightweight-charts shares one time scale across
 * every series, so feeding it per-second index samples under a 1-minute candle series
 * would inject thousands of extra time points and visibly compress the candles. Instead
 * each candle takes the last index value that falls inside its own bucket, which keeps
 * the overlay aligned with bars the user is already reading and preserves spacing.
 *
 * Sparse input is fine and intentional: unauthenticated Kalshi only yields exact values
 * at quarter-hour boundaries, so the overlay becomes a polyline through those anchors —
 * which is precisely what should be compared against the candles.
 */
export function brtiOverlayPoints(
  candles: readonly { time: number }[],
  values: readonly (BrtiSample | BrtiAnchor)[],
  stepSeconds: number,
): BrtiPoint[] {
  if (!candles.length || !values.length || stepSeconds <= 0) return []
  // One shared walk: both inputs are time-ordered, so a single cursor suffices.
  const sorted = [...values].sort((a, b) => a.time - b.time)
  const points: BrtiPoint[] = []
  let cursor = 0
  for (const candle of candles) {
    const from = candle.time
    const to = candle.time + stepSeconds
    let latest: number | null = null
    while (cursor < sorted.length && sorted[cursor].time < from) cursor++
    let scan = cursor
    while (scan < sorted.length && sorted[scan].time < to) {
      const value = sorted[scan].value
      if (Number.isFinite(value) && value > 0) latest = value
      scan++
    }
    if (latest !== null) points.push({ time: candle.time, value: latest })
  }
  return points
}

/**
 * The Coinbase↔index basis at each anchor, in dollars.
 *
 * Kalshi settles on CF Benchmarks' index; the chart shows Coinbase trades. The gap is
 * usually a few dollars and occasionally much more, and it is the single best explanation
 * for a strike line that "looks wrong" against a printed price.
 */
export function brtiBasis(
  candles: readonly { time: number; close: number }[],
  values: readonly (BrtiSample | BrtiAnchor)[],
): { time: number; basis: number; index: number; coinbase: number }[] {
  if (!candles.length || !values.length) return []
  const closes = new Map(candles.map((candle) => [candle.time, candle.close]))
  const out: { time: number; basis: number; index: number; coinbase: number }[] = []
  for (const value of values) {
    const close = closes.get(value.time)
    if (close === undefined || !Number.isFinite(close)) continue
    out.push({ time: value.time, basis: close - value.value, index: value.value, coinbase: close })
  }
  return out.sort((a, b) => a.time - b.time)
}
