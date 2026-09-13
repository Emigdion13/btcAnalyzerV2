import { describe, expect, it } from 'vitest'
import { brtiBasis, brtiOverlayPoints } from './brti-overlay'
import type { BrtiAnchor, BrtiSample } from '../../shared/kalshi'

const START = Date.parse('2026-09-13T21:00:00Z') / 1000
const minute = (offset: number) => ({ time: START + offset * 60 })
const candles = [minute(0), minute(1), minute(2), minute(3)]

describe('brtiOverlayPoints', () => {
  it('snaps per-second samples onto the candle grid, taking the last in each bucket', () => {
    const samples: BrtiSample[] = [
      { time: START + 5, value: 100 },
      { time: START + 40, value: 101 },
      { time: START + 61, value: 102 },
      { time: START + 130, value: 103 },
    ]
    expect(brtiOverlayPoints(candles, samples, 60)).toEqual([
      { time: START, value: 101 },
      { time: START + 60, value: 102 },
      { time: START + 120, value: 103 },
    ])
  })

  it('never emits a time the chart does not already have', () => {
    // This is the whole point: injecting per-second times into a one-minute series would
    // add thousands of points to the shared time scale and visibly compress the candles.
    const samples: BrtiSample[] = Array.from({ length: 240 }, (_, i) => ({
      time: START + i,
      value: 100 + i,
    }))
    const points = brtiOverlayPoints(candles, samples, 60)
    const candleTimes = new Set(candles.map((candle) => candle.time))
    expect(points.every((point) => candleTimes.has(point.time))).toBe(true)
    expect(points.length).toBeLessThanOrEqual(candles.length)
  })

  it('draws a polyline through sparse quarter-hour anchors', () => {
    const anchors: BrtiAnchor[] = [
      { time: START, value: 77314.22, indexId: 'BRTI' },
      { time: START + 900, value: 77340.1, indexId: 'BRTI' },
    ]
    // Only the boundary candles carry a value; the rest are simply absent, and the line
    // series connects across the gap.
    expect(brtiOverlayPoints(candles, anchors, 60)).toEqual([{ time: START, value: 77314.22 }])
    const longer = [...candles, ...Array.from({ length: 12 }, (_, i) => minute(4 + i))]
    expect(brtiOverlayPoints(longer, anchors, 60)).toEqual([
      { time: START, value: 77314.22 },
      { time: START + 900, value: 77340.1 },
    ])
  })

  it('accepts unsorted input', () => {
    const samples: BrtiSample[] = [
      { time: START + 40, value: 101 },
      { time: START + 5, value: 100 },
    ]
    expect(brtiOverlayPoints(candles, samples, 60)).toEqual([{ time: START, value: 101 }])
  })

  it('drops non-positive and non-finite values', () => {
    const samples = [
      { time: START + 1, value: -5 },
      { time: START + 2, value: NaN },
      { time: START + 3, value: 100 },
    ] as BrtiSample[]
    expect(brtiOverlayPoints(candles, samples, 60)).toEqual([{ time: START, value: 100 }])
  })

  it('returns nothing when there is nothing to draw', () => {
    expect(brtiOverlayPoints(candles, [], 60)).toEqual([])
    expect(brtiOverlayPoints([], [{ time: START, value: 1 }], 60)).toEqual([])
    expect(brtiOverlayPoints(candles, [{ time: START, value: 1 }], 0)).toEqual([])
  })

  it('honours a coarser candle grid', () => {
    const samples: BrtiSample[] = [
      { time: START + 60, value: 100 },
      { time: START + 200, value: 101 },
      { time: START + 400, value: 102 },
    ]
    const coarse = [{ time: START }, { time: START + 300 }]
    expect(brtiOverlayPoints(coarse, samples, 300)).toEqual([
      { time: START, value: 101 },
      { time: START + 300, value: 102 },
    ])
  })
})

describe('brtiBasis', () => {
  const candlesWithClose = [
    { time: START, close: 77323.31 },
    { time: START + 900, close: 77400 },
    { time: START + 1800, close: 77500 },
  ]

  it('measures Coinbase trades against the index at shared timestamps', () => {
    const anchors: BrtiAnchor[] = [
      { time: START, value: 77314.22, indexId: 'BRTI' },
      { time: START + 900, value: 77390.5, indexId: 'BRTI' },
    ]
    expect(brtiBasis(candlesWithClose, anchors)).toEqual([
      { time: START, basis: 77323.31 - 77314.22, index: 77314.22, coinbase: 77323.31 },
      { time: START + 900, basis: 77400 - 77390.5, index: 77390.5, coinbase: 77400 },
    ])
  })

  it('skips index values the chart has no candle for', () => {
    const anchors: BrtiAnchor[] = [{ time: START + 45, value: 1, indexId: 'BRTI' }]
    expect(brtiBasis(candlesWithClose, anchors)).toEqual([])
  })

  it('returns nothing on empty input', () => {
    expect(brtiBasis([], [{ time: START, value: 1, indexId: 'BRTI' }])).toEqual([])
    expect(brtiBasis(candlesWithClose, [])).toEqual([])
  })
})
