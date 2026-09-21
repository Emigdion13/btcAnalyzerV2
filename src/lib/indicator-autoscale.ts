import type { AutoscaleInfoProvider } from 'lightweight-charts'

/** Price overlays share candle coordinates, but must not flatten the candle range. */
export function indicatorAutoscale(
  pane: number,
  rsi: boolean,
): AutoscaleInfoProvider | undefined {
  if (pane === 0) return () => null
  if (rsi) return () => ({ priceRange: { minValue: 0, maxValue: 100 } })
  return undefined
}
