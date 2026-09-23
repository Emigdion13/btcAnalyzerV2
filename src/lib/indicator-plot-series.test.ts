import { describe, expect, it, vi } from 'vitest'
import type {
  ICustomSeriesPaneRenderer,
  PaneRendererCustomData,
  Time,
  UTCTimestamp,
  Coordinate,
} from 'lightweight-charts'
import { IndicatorPlotSeries, indicatorPlotData } from './indicator-plot-series'
import type { Candle, Plot } from './types'

const sample = (
  barSpacing: number,
): PaneRendererCustomData<Time, { time: Time; value: number; base?: number }> => ({
  bars: [
    // The chart strips color out of originalData; tests must model that boundary.
    {
      x: 10,
      time: 0 as UTCTimestamp,
      originalData: { time: 0 as UTCTimestamp, value: 20 },
      barColor: '#00ffff',
    },
    {
      x: 20,
      time: 1 as UTCTimestamp,
      originalData: { time: 1 as UTCTimestamp, value: -10 },
      barColor: '#800000',
    },
  ],
  visibleRange: { from: 0, to: 2 },
  barSpacing,
  conflationFactor: 1,
})
function drawing() {
  const colors: string[] = []
  const strokes: string[] = []
  const alphas: number[] = []
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    beginPath: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(() => {
      colors.push(context.fillStyle)
      alphas.push(context.globalAlpha)
    }),
    fillRect: vi.fn(() => {
      colors.push(context.fillStyle)
      alphas.push(context.globalAlpha)
    }),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => {
      strokes.push(context.strokeStyle)
      alphas.push(context.globalAlpha)
    }),
    save: vi.fn(),
    restore: vi.fn(),
  }
  const target = {
    useBitmapCoordinateSpace: (draw: (scope: unknown) => void) =>
      draw({
        context,
        horizontalPixelRatio: 2,
        verticalPixelRatio: 2,
      }),
  } as unknown as Parameters<ICustomSeriesPaneRenderer['draw']>[0]
  const priceToY = (price: number) => (50 - price) as Coordinate
  return { context, target, priceToY, colors, strokes, alphas }
}

describe('CM plot rendering', () => {
  it.each([3, 6, 20])(
    'keeps histogram strokes four CSS pixels at %s-pixel bar spacing',
    (spacing) => {
      const renderer = new IndicatorPlotSeries('histogram')
      renderer.update(sample(spacing), renderer.defaultOptions())
      const draw = drawing()
      renderer.renderer().draw(draw.target, draw.priceToY, false)
      expect(draw.context.fillRect.mock.calls).toEqual([
        [16, 60, 8, 40],
        [36, 100, 8, 20],
      ])
      expect(draw.colors).toEqual(['#00ffff', '#800000'])
      expect(draw.context.ellipse).not.toHaveBeenCalled()
    },
  )
  it('draws separated, correctly colored circles at exact signal coordinates', () => {
    const renderer = new IndicatorPlotSeries('circles')
    const data = sample(10)
    data.bars[0].originalData.value = 0
    renderer.update(data, renderer.defaultOptions())
    const draw = drawing()
    renderer.renderer().draw(draw.target, draw.priceToY, false)
    expect(draw.context.ellipse.mock.calls[0]).toEqual([20, 100, 8, 8, 0, 0, Math.PI * 2])
    expect(draw.context.ellipse).toHaveBeenCalledTimes(2)
    expect(draw.colors).toEqual(['#00ffff', '#800000'])
    expect(draw.context.fillRect).not.toHaveBeenCalled()
  })
  it('includes zero in histogram autoscaling but not as an artificial dot value', () => {
    const hist = new IndicatorPlotSeries('histogram')
    const dots = new IndicatorPlotSeries('circles')
    expect(hist.priceValueBuilder({ time: 0 as UTCTimestamp, value: 10 })).toEqual([0, 10])
    expect(dots.priceValueBuilder({ time: 0 as UTCTimestamp, value: -20 })).toEqual([-20])
    expect(dots.isWhitespace({ time: 0 as UTCTimestamp })).toBe(true)
    expect(dots.isWhitespace({ time: 0 as UTCTimestamp, value: 0 })).toBe(false)
  })
  it('does not draw absent data or a destroyed series', () => {
    const hist = new IndicatorPlotSeries('histogram')
    const draw = drawing()
    hist.renderer().draw(draw.target, draw.priceToY, false)
    expect(draw.context.fillRect).not.toHaveBeenCalled()
    hist.update(sample(6), hist.defaultOptions())
    hist.destroy()
    hist.renderer().draw(draw.target, draw.priceToY, false)
    expect(draw.context.fillRect).not.toHaveBeenCalled()
  })
  it('draws legacy Pine cross markers centered on the value, in the bar color', () => {
    const renderer = new IndicatorPlotSeries('cross')
    renderer.update(sample(10), { ...renderer.defaultOptions(), lineWidth: 2 })
    const draw = drawing()
    renderer.renderer().draw(draw.target, draw.priceToY, false)
    // Two diagonal strokes per bar, sized by the plot width and centered on the value.
    expect(draw.context.moveTo.mock.calls).toEqual([
      [16, 56],
      [24, 56],
      [36, 116],
      [44, 116],
    ])
    expect(draw.context.lineTo.mock.calls).toEqual([
      [24, 64],
      [16, 64],
      [44, 124],
      [36, 124],
    ])
    expect(draw.context.stroke).toHaveBeenCalledTimes(2)
    expect(draw.strokes).toEqual(['#00ffff', '#800000'])
    expect(draw.context.fillRect).not.toHaveBeenCalled()
    expect(draw.context.ellipse).not.toHaveBeenCalled()
  })
  it('fills an area from the zero line at the Pine transparency and strokes its edge', () => {
    const renderer = new IndicatorPlotSeries('area')
    const data = sample(10)
    renderer.update(data, {
      ...renderer.defaultOptions(),
      color: '#0000ff',
      lineWidth: 1,
      transp: 80,
    })
    const draw = drawing()
    renderer.renderer().draw(draw.target, draw.priceToY, false)
    // Polygon: zero → every value → back to zero, then the line on top.
    expect(draw.context.moveTo.mock.calls).toEqual([
      [20, 100],
      [20, 60],
    ])
    expect(draw.context.lineTo.mock.calls).toEqual([
      [20, 60],
      [40, 120],
      [40, 100],
      [40, 120],
    ])
    expect(draw.context.closePath).toHaveBeenCalledTimes(1)
    expect(draw.colors).toEqual(['#0000ff'])
    expect(draw.alphas[0]).toBeCloseTo(0.2, 12) // transp 80 → 20% opacity
    expect(draw.alphas[1]).toBe(1)
    expect(draw.strokes).toEqual(['#0000ff'])
    expect(draw.context.save).toHaveBeenCalled()
    expect(draw.context.restore).toHaveBeenCalled()
    expect(draw.context.globalAlpha).toBe(1) // Never leave the canvas transparent.
  })
  it('fills an opaque area by default and skips bars without a value', () => {
    const renderer = new IndicatorPlotSeries('area')
    const data = sample(10)
    const whitespace = [
      ...data.bars,
      {
        x: 30,
        time: 2 as UTCTimestamp,
        originalData: { time: 2 as UTCTimestamp } as never,
        barColor: '#ffffff',
      },
    ]
    data.bars = whitespace as typeof data.bars
    data.visibleRange = { from: 0, to: whitespace.length }
    renderer.update(data, renderer.defaultOptions())
    const draw = drawing()
    renderer.renderer().draw(draw.target, draw.priceToY, false)
    expect(draw.alphas).toEqual([1, 1]) // No transp → an opaque fill.
    expect(draw.context.lineTo.mock.calls).toEqual([
      [20, 60],
      [40, 120],
      [40, 100],
      [40, 120],
    ])
  })
  it('includes zero in area autoscaling but not as a marker value', () => {
    const area = new IndicatorPlotSeries('area')
    const cross = new IndicatorPlotSeries('cross')
    expect(area.priceValueBuilder({ time: 0 as UTCTimestamp, value: 10 })).toEqual([0, 10])
    expect(cross.priceValueBuilder({ time: 0 as UTCTimestamp, value: -20 })).toEqual([-20])
    expect(area.isWhitespace({ time: 0 as UTCTimestamp })).toBe(true)
    expect(area.isWhitespace({ time: 0 as UTCTimestamp, value: 0 })).toBe(false)
  })
  it('aligns Pine segment colors without shifting histogram/dot colors or times', () => {
    const candles: Candle[] = Array.from({ length: 4 }, (_, i) => ({
      time: i * 60,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    }))
    const plot: Plot = {
      title: 'MACD',
      pane: 'oscillator',
      lineWidth: 4,
      color: '#00ff00',
      colors: ['#00ff00', '#ffff00', '#ff0000', '#00ff00'],
      values: [1, null, -1, 2],
    }
    expect(indicatorPlotData(candles, plot)).toEqual([
      { time: 0 as UTCTimestamp, value: 1, color: '#ff0000' },
      { time: 60 },
      { time: 120, value: -1, color: '#00ff00' },
      { time: 180, value: 2, color: '#00ff00' },
    ])
    for (const style of ['histogram', 'circles', 'columns'] as const)
      expect(indicatorPlotData(candles, { ...plot, style })[0]).toEqual({
        time: 0 as UTCTimestamp,
        value: 1,
        color: '#00ff00',
      })
    expect(indicatorPlotData(candles, { ...plot, colorMode: 'bar' })[0]).toEqual({
      time: 0 as UTCTimestamp,
      value: 1,
      color: '#00ff00',
    })
    expect(plot.colors?.[0]).toBe('#00ff00') // Never mutate calculation/legend colors.
  })
  it('draws a column from value to base and skips a bar whose base is missing', () => {
    const renderer = new IndicatorPlotSeries('columns')
    const data = sample(8)
    data.bars[0].originalData = { ...data.bars[0].originalData, base: 4 }
    renderer.update(data, renderer.defaultOptions())
    const draw = drawing()
    renderer.renderer().draw(draw.target, draw.priceToY, false)
    // width = max(1, min(round(8 * 0.62 * 2), round(10 * 2))) = 10
    // value 20 → y 30, base 4 → y 46; top 60, height 32, x round(20 - 5) = 15
    expect(draw.context.fillRect.mock.calls).toEqual([[15, 60, 10, 32]])
    expect(draw.colors).toEqual(['#00ffff'])
    expect(renderer.priceValueBuilder({ time: 0 as UTCTimestamp, value: 10, base: 4 })).toEqual([
      4, 10,
    ])
    expect(renderer.priceValueBuilder({ time: 0 as UTCTimestamp, value: 10 })).toEqual([10, 10])
  })
})
