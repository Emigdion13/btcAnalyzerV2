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
): PaneRendererCustomData<Time, { time: Time; value: number }> => ({
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
  const context = {
    fillStyle: '',
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    fill: vi.fn(() => colors.push(context.fillStyle)),
    fillRect: vi.fn(() => colors.push(context.fillStyle)),
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
  return { context, target, priceToY, colors }
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
    for (const style of ['histogram', 'circles'] as const)
      expect(indicatorPlotData(candles, { ...plot, style })[0]).toEqual({
        time: 0 as UTCTimestamp,
        value: 1,
        color: '#00ff00',
      })
    expect(plot.colors?.[0]).toBe('#00ff00') // Never mutate calculation/legend colors.
  })
})
