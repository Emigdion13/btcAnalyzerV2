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
  /** Far end of a column. Absent means the column is not drawn. */
  base?: number
}
type Options = CustomSeriesOptions & { lineWidth: number; transp: number; baseValue: number }
export type IndicatorPlotStyle = 'histogram' | 'circles' | 'cross' | 'area' | 'columns'

/**
 * Pine-style fixed-width histogram strokes, marker styles, and zero-based areas.
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
          if (this.style === 'columns') {
            this.columns(context, data, priceToCoordinate, rx, ry)
            return
          }
          // An area hangs from its Pine histbase, not always zero.
          const zero = priceToCoordinate(this.options.baseValue ?? 0)
          const points: { x: number; y: number; color: string }[] = []
          for (let i = data.visibleRange!.from; i < data.visibleRange!.to; i++) {
            const bar = data.bars[i]
            const value = bar.originalData.value
            const y =
              typeof value === 'number' && Number.isFinite(value) ? priceToCoordinate(value) : null
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
            } else if (this.style === 'cross') {
              // Legacy Pine cross markers: two strokes centered on the value.
              const arm = this.options.lineWidth * rx
              context.strokeStyle = bar.barColor
              context.lineWidth = Math.max(1, Math.round(rx))
              context.beginPath()
              context.moveTo(x - arm, y * ry - arm)
              context.lineTo(x + arm, y * ry + arm)
              context.moveTo(x + arm, y * ry - arm)
              context.lineTo(x - arm, y * ry + arm)
              context.stroke()
            } else if (this.style === 'histogram' && zero !== null) {
              // Like plot.style_histogram, width is 4 CSS pixels even when zoomed in.
              const width = Math.max(1, Math.round(this.options.lineWidth * rx))
              const top = Math.round(Math.min(y, zero) * ry)
              const bottom = Math.round(Math.max(y, zero) * ry)
              context.fillRect(x - Math.floor(width / 2), top, width, Math.max(1, bottom - top))
            } else if (this.style === 'area') {
              points.push({ x, y: y * ry, color: bar.barColor })
            }
          }
          if (this.style === 'area' && zero !== null && points.length)
            this.area(context, points, zero * ry, rx)
        },
      )
    },
  }
  constructor(private readonly style: IndicatorPlotStyle) {}
  renderer() {
    return this.view
  }
  update(data: PaneRendererCustomData<Time, PointData>, options: Options) {
    this.data = data
    this.options = options
  }
  /**
   * A column between `value` and `base`, not from zero. A missing base skips the bar.
   * Width tracks bar spacing, capped so a zoomed-in chart does not paint a slab.
   */
  private columns(
    context: CanvasRenderingContext2D,
    data: PaneRendererCustomData<Time, PointData>,
    priceToCoordinate: (price: number) => number | null,
    rx: number,
    ry: number,
  ) {
    const width = Math.max(
      1,
      Math.min(Math.round(data.barSpacing * 0.62 * rx), Math.round(10 * rx)),
    )
    const range = data.visibleRange
    if (!range) return
    for (let i = range.from; i < range.to; i++) {
      const bar = data.bars[i]
      const value = bar?.originalData.value
      const base = bar?.originalData.base
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      if (typeof base !== 'number' || !Number.isFinite(base)) continue
      const yValue = priceToCoordinate(value)
      const yBase = priceToCoordinate(base)
      if (yValue === null || yBase === null) continue
      context.fillStyle = bar.barColor
      const top = Math.min(yValue, yBase) * ry
      const height = Math.max(1, Math.abs(yValue - yBase) * ry)
      context.fillRect(
        Math.round(bar.x * rx - width / 2),
        Math.round(top),
        width,
        Math.round(height),
      )
    }
  }
  /**
   * Pine `style=area`: the line, plus the region between it and the base line. Pine paints the
   * segment ending at a bar in that bar's colour, so a per-bar colour series — nQQE's lime above
   * 60, red below 40, yellow between — recolours the fill and the edge from that bar on. Each run
   * of one colour is one shape, so a single-colour area is still drawn as a single polygon.
   */
  private area(
    context: CanvasRenderingContext2D,
    points: { x: number; y: number; color: string }[],
    zero: number,
    rx: number,
  ) {
    const transparency = Math.min(100, Math.max(0, this.options.transp))
    const runs = colorRuns(points.map((point) => point.color))
    context.save()
    context.globalAlpha = 1 - transparency / 100
    for (const run of runs) {
      context.beginPath()
      context.moveTo(points[run.from].x, zero)
      for (let i = run.from; i <= run.to; i++) context.lineTo(points[i].x, points[i].y)
      context.lineTo(points[run.to].x, zero)
      context.closePath()
      context.fillStyle = run.color
      context.fill()
    }
    // Every fill first, so a colour change never lays one run's fill over the next run's edge.
    context.globalAlpha = 1
    context.lineWidth = Math.max(1, Math.round(this.options.lineWidth * rx))
    for (const run of runs) {
      context.beginPath()
      context.moveTo(points[run.from].x, points[run.from].y)
      for (let i = run.from + 1; i <= run.to; i++) context.lineTo(points[i].x, points[i].y)
      context.strokeStyle = run.color
      context.stroke()
    }
    context.restore()
  }
  priceValueBuilder(data: PointData) {
    if (this.style === 'columns') {
      const base =
        typeof data.base === 'number' && Number.isFinite(data.base) ? data.base : data.value
      return [base, data.value]
    }
    if (this.style === 'histogram') return [0, data.value]
    return this.style === 'area' ? [this.options.baseValue ?? 0, data.value] : [data.value]
  }
  isWhitespace(
    data: PointData | CustomSeriesWhitespaceData<Time>,
  ): data is CustomSeriesWhitespaceData<Time> {
    return !('value' in data)
  }
  defaultOptions(): Options {
    return {
      ...customSeriesDefaultOptions,
      color: '#ffffff',
      lineWidth: 4,
      transp: 0,
      baseValue: 0,
    }
  }
  destroy() {
    this.data = null
  }
}

/**
 * Split a line into runs of one colour, by Pine's rule that the segment ending at point `k` takes
 * point `k`'s colour. Each run spans points `from..to` (inclusive, `from` shared with the run
 * before it), so drawing every run joins up into the whole line. A lone point is a run of its own.
 */
export function colorRuns(colors: string[]): { from: number; to: number; color: string }[] {
  if (colors.length === 1) return [{ from: 0, to: 0, color: colors[0]! }]
  const runs: { from: number; to: number; color: string }[] = []
  for (let k = 1; k < colors.length; k++) {
    const last = runs.at(-1)
    if (last && last.color === colors[k]) last.to = k
    else runs.push({ from: k - 1, to: k, color: colors[k]! })
  }
  return runs
}

/**
 * Pine colors the segment ending at a bar; Lightweight Charts colors its start.
 * `colorMode: 'bar'` keeps the colour on the bar that produced it.
 */
export function indicatorPlotData(candles: Candle[], plot: Plot) {
  const colors = plot.colors ? [...plot.colors] : undefined
  const shiftColors =
    !!colors && (plot.style === undefined || plot.style === 'line') && plot.colorMode !== 'bar'
  if (shiftColors && colors) {
    let next = -1
    for (let i = plot.values.length - 1; i >= 0; i--) {
      if (plot.values[i] === null) continue
      colors[i] = plot.colors![next < 0 ? i : next]
      next = i
    }
  }
  return plot.values.map((value, i) => {
    if (value === null) return { time: candles[i].time as UTCTimestamp }
    const point: { time: UTCTimestamp; value: number; color: string; base?: number } = {
      time: candles[i].time as UTCTimestamp,
      value,
      color: colors?.[i] ?? plot.color,
    }
    const base = plot.base?.[i]
    if (typeof base === 'number' && Number.isFinite(base)) point.base = base
    return point
  })
}
