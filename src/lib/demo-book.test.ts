import { describe, expect, it } from 'vitest'
import { demoBook } from './demo-book'
import type { Candle } from './types'

function bars(): Candle[] {
  const candles: Candle[] = []
  let price = 99_500
  for (let i = 0; i < 240; i++) {
    const drift = Math.sin(i / 7) * 400 + Math.sin(i / 23) * 900
    const open = price
    const close = open + drift * 0.2
    candles.push({
      time: 1_700_000_000 + i * 900,
      open,
      high: Math.max(open, close) + 250,
      low: Math.min(open, close) - 250,
      close,
      volume: 20 + (i % 9) * 3,
    })
    price = close
  }
  return candles
}

describe('demoBook — labeled synthetic book for demo mode', () => {
  it('builds a well-formed depth view from recent demo candles', () => {
    const view = demoBook('BTCUSDT', bars(), 1_700_100_000)
    expect(view).not.toBeNull()
    expect(view!.product).toBe('BTCUSDT')
    expect(view!.bins.length).toBeGreaterThan(0)
    expect(view!.bins.length).toBeLessThanOrEqual(280)
    expect(view!.mid).toBeGreaterThan(90_000)
    expect(view!.spread).toBeGreaterThan(0)
    expect(view!.bidsTotal).toBeGreaterThan(0)
    expect(view!.asksTotal).toBeGreaterThan(0)
    expect(view!.imbalance).toBeGreaterThanOrEqual(-1)
    expect(view!.imbalance).toBeLessThanOrEqual(1)
  })
  it('shows the swing extremes of the candles as walls (deterministic per symbol + candles)', () => {
    const first = demoBook('BTCUSDT', bars(), 1_700_100_000)
    const again = demoBook('BTCUSDT', bars(), 1_700_100_000)
    expect(again).toEqual(first)
    // Bars oscillate over a ~2% range, so at least one support or resistance wall must surface.
    const wallCount = (first!.supports.length + first!.resistances.length)
    expect(wallCount).toBeGreaterThanOrEqual(1)
    for (const side of ['supports', 'resistances'] as const)
      for (const wall of first![side])
        expect(wall.notional).toBeGreaterThanOrEqual(250_000)
  })
  it('returns null without enough history', () => {
    expect(demoBook('BTCUSDT', bars().slice(0, 10), 1_700_100_000)).toBeNull()
  })
})
