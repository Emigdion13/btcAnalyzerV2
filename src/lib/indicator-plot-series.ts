import { customSeriesDefaultOptions } from 'lightweight-charts'
import type {
  CustomData,
  CustomSeriesOptions,
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type { Candle, Plot } from './types'

interface PointData extends CustomData<Time> {
  value: number
}
type Options = CustomSeriesOptions & { lineWidth: number }

/**
 * Pine-style fixed-width histogram strokes and absolute-value circles.
 * Native HistogramSeries uses expanding columns, and above/below-bar markers
 * would put the crossover dots at the wrong Y coordinate. This renderer also
 * participates in chart autoscaling, pane resizing and PNG screenshots.
 */
export class IndicatorPlotSeries implements ICustomSeriesPaneView<Time, PointData, Options> {
  private data: PaneRendererCustomData<Time, PointData> | null = null
  private options = this.defaultOptions()
  private readonly view: ICustomSeriesPaneRenderer = {
    draw: (target, priceToCoordinate) => {
      const data = this.data
      if (!data?.visibleRange) return
      target.useBitmapCoordinateSpace(
        ({ context, horizontalPixelRatio: rx, verticalPixelRatio: ry }) => {
          const zero = priceToCoordinate(0)
          for (let i = data.visibleRange!.from; i < data.visibleRange!.to; i++) {
            const bar = data.bars[i]
            const y = priceToCoordinate(bar.originalData.value)
            if (y === null) continue
            const x = Math.round(bar.x * rx)
            // Lightweight Charts extracts `color` from originalData into barColor.
            context.fillStyle = bar.barColor
            if (this.style === 'circles') {
              context.beginPath()
              context.ellipse(
                x,
                y * ry,
                this.options.lineWidth * rx,
                this.options.lineWidth * ry,
                0,
                0,
                Math.PI * 2,
              )
              context.fill()
            } else if (zero !== null) {
              // Like plot.style_histogram, width is 4 CSS pixels even when zoomed in.
              const width = Math.max(1, Math.round(this.options.lineWidth * rx))
              const top = Math.round(Math.min(y, zero) * ry)
              const bottom = Math.round(Math.max(y, zero) * ry)
              context.fillRect(x - Math.floor(width / 2), top, width, Math.max(1, bottom - top))
            }
          }
        },
      )
    },
  }
  constructor(private readonly style: 'histogram' | 'circles') {}
  renderer() {
    return this.view
  }
  update(data: PaneRendererCustomData<Time, PointData>, options: Options) {
    this.data = data
    this.options = options
  }
  priceValueBuilder(data: PointData) {
    return this.style === 'histogram' ? [0, data.value] : [data.value]
  }
  isWhitespace(
    data: PointData | CustomSeriesWhitespaceData<Time>,
  ): data is CustomSeriesWhitespaceData<Time> {
    return !('value' in data)
  }
  defaultOptions(): Options {
    return { ...customSeriesDefaultOptions, color: '#ffffff', lineWidth: 4 }
  }
  destroy() {
    this.data = null
  }
}

/** Pine colors the segment ending at a bar; Lightweight Charts colors its start. */
export function indicatorPlotData(candles: Candle[], plot: Plot) {
  const colors = plot.colors ? [...plot.colors] : undefined
  if (colors && (!plot.style || plot.style === 'line')) {
    let next = -1
    for (let i = plot.values.length - 1; i >= 0; i--) {
      if (plot.values[i] === null) continue
      colors[i] = plot.colors![next < 0 ? i : next]
      next = i
    }
  }
  return plot.values.map((value, i) =>
    value === null
      ? { time: candles[i].time as UTCTimestamp }
      : { time: candles[i].time as UTCTimestamp, value, color: colors?.[i] ?? plot.color },
  )
}
