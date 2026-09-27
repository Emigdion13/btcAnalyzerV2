import type { AutoscaleInfo, AutoscaleInfoProvider } from 'lightweight-charts'

/**
 * Price overlays share the candle pane, but must not set its scale.
 *
 * Return an explicit empty price range so price overlays cannot contribute
 * zero-based histogram/area values to the candle fit. In the pinned LWC version,
 * returning `null` also excludes the series; native scaling is used only when
 * no provider is installed (or when the provider calls the base implementation).
 */
const EXCLUDE_FROM_AUTOSCALE: AutoscaleInfo = { priceRange: null }

export function indicatorAutoscale(pane: number, rsi: boolean): AutoscaleInfoProvider | undefined {
  if (pane === 0) return () => EXCLUDE_FROM_AUTOSCALE
  if (rsi) return () => ({ priceRange: { minValue: 0, maxValue: 100 } })
  return undefined
}
