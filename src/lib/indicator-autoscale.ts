import type { AutoscaleInfo, AutoscaleInfoProvider } from 'lightweight-charts'

/**
 * Price overlays share the candle pane, but must not set its scale.
 *
 * Lightweight Charts treats a provider that returns `null` as "use the series'
 * native range". Histogram/area plots then contribute a 0-line, stretching BTC
 * from ~$0 to ~$100k so the axis ticks in $10,000 steps and the real 80–90k
 * tape collapses into a thin band. Returning an AutoscaleInfo whose
 * `priceRange` is null excludes the overlay from the fit instead.
 */
const EXCLUDE_FROM_AUTOSCALE: AutoscaleInfo = { priceRange: null }

export function indicatorAutoscale(
  pane: number,
  rsi: boolean,
): AutoscaleInfoProvider | undefined {
  if (pane === 0) return () => EXCLUDE_FROM_AUTOSCALE
  if (rsi) return () => ({ priceRange: { minValue: 0, maxValue: 100 } })
  return undefined
}
