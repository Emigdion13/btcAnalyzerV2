import { describe, expect, it } from 'vitest'
import { indicatorAutoscale } from './indicator-autoscale'

describe('indicator autoscaling', () => {
  const zeroBasedRange = () => ({ priceRange: { minValue: 0, maxValue: 100_000 } })

  it('excludes price overlays (including zero-based areas) from the candle range', () => {
    // Must not return null — LWC would then use the overlay's native 0…max range.
    expect(indicatorAutoscale(0, false)?.(zeroBasedRange)).toEqual({ priceRange: null })
  })

  it('never applies oscillator bounds to the price pane', () => {
    expect(indicatorAutoscale(0, true)?.(zeroBasedRange)).toEqual({ priceRange: null })
  })

  it('retains fixed RSI bounds in a separate pane', () => {
    expect(indicatorAutoscale(1, true)?.(zeroBasedRange)).toEqual({
      priceRange: { minValue: 0, maxValue: 100 },
    })
  })

  it('leaves other oscillator panels on native autoscaling', () => {
    expect(indicatorAutoscale(2, false)).toBeUndefined()
  })
})
