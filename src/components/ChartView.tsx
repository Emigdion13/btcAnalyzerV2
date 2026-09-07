import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
} from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  Logical,
  MouseEventParams,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { ChevronDown, Eye, EyeOff, Minus, Plus, RotateCcw, Settings2, X } from 'lucide-react'
import type {
  Anchor,
  Asset,
  DataSource,
  ConnectionState,
  Candle,
  ChartSettings,
  ChartType,
  Drawing,
  Indicator,
  Plot,
  PriceAlert,
  ScriptResult,
  Timeframe,
  Tool,
} from '../lib/types'
import { builtInPlots } from '../lib/indicators'
import { cmMacdResolution, cmMacdSettings, indicatorLabel } from '../lib/cm-ult-macd'
import type { IndicatorTimeframes } from '../lib/cm-ult-macd'
import { IndicatorPlotSeries, indicatorPlotData } from '../lib/indicator-plot-series'
import { compactNumber, formatPrice, quoteCurrency, INTERVAL } from '../lib/market'
import { uid } from '../lib/storage'
import { CoinIcon, IconButton } from './ui'

export interface ChartHandle {
  fit: () => void
  zoom: (factor: number) => void
  setRange: (bars: number) => void
  latest: () => void
  snapshot: () => Promise<Blob | null>
}
interface Props {
  source: DataSource
  feedState: ConnectionState
  asset: Asset
  candles: Candle[]
  timeframe: Timeframe
  chartType: ChartType
  indicators: Indicator[]
  customResults: Record<string, ScriptResult>
  indicatorTimeframes: IndicatorTimeframes
  settings: ChartSettings
  drawings: Drawing[]
  drawingTool: Tool
  drawingsVisible: boolean
  drawingsLocked: boolean
  magnet: boolean
  alerts: PriceAlert[]
  onDraw: (drawing: Drawing) => void
  onToolComplete: () => void
  onTextRequest: (anchor: Anchor) => void
  onIndicatorEdit: (indicator: Indicator) => void
  onIndicatorToggle: (id: string) => void
  onIndicatorRemove: (id: string) => void
  onIndicatorRetry: () => void
  replay: boolean
}
interface IndicatorSeries {
  series: ISeriesApi<SeriesType>[]
  pane: number
}
interface Geometry {
  width: number
  height: number
  paneTops: number[]
}

export const ChartView = forwardRef<ChartHandle, Props>(function ChartView(props, ref) {
  const {
    asset,
    candles,
    timeframe,
    chartType,
    indicators,
    customResults,
    indicatorTimeframes,
    replay,
    settings,
    drawings,
    drawingTool,
    drawingsVisible,
    drawingsLocked,
    magnet,
    alerts,
  } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const indicatorSeries = useRef<Map<string, IndicatorSeries>>(new Map())
  const propsRef = useRef(props)
  propsRef.current = props
  const pendingRef = useRef<Anchor | null>(null)
  const [pending, setPending] = useState<Anchor | null>(null)
  const [preview, setPreview] = useState<Anchor | null>(null)
  const [hovered, setHovered] = useState<Candle | null>(null)
  const [geometry, setGeometry] = useState<Geometry>({ width: 0, height: 0, paneTops: [] })
  const [revision, setRevision] = useState(0)
  const [legendOpen, setLegendOpen] = useState(true)
  const refreshRef = useRef<() => void>(() => {})
  const dataInfo = useRef({ length: 0, first: 0, last: 0, candles: [] as Candle[] })
  const cmSessionKey = `${props.source}:${asset.symbol}:${timeframe}:${indicators
    .filter((i) => i.kind === 'cm-ult-macd' && i.visible)
    .map(
      (i) =>
        `${i.id}:${JSON.stringify(cmMacdSettings(i))}:${!!indicatorTimeframes[cmMacdResolution(cmMacdSettings(i), timeframe)]?.candles.length}`,
    )
    .join(';')}`
  const hasIndicatorCandles = candles.length > 0
  const [cmSession, setCmSession] = useState({ key: '', start: Infinity })
  useEffect(() => {
    setCmSession({ key: cmSessionKey, start: propsRef.current.candles.at(-1)?.time ?? Infinity })
  }, [cmSessionKey, hasIndicatorCandles])
  const realtimeFrom =
    cmSession.key === cmSessionKey ? cmSession.start : (candles.at(-1)?.time ?? Infinity)
  const generated = useMemo(
    () =>
      indicators
        .filter((i) => i.visible && i.kind !== 'volume')
        .map((indicator) => ({
          indicator,
          plots:
            indicator.kind === 'custom'
              ? (customResults[indicator.id]?.plots ?? [])
              : builtInPlots(candles, indicator, {
                  timeframe,
                  timeframes: indicatorTimeframes,
                  replay,
                  realtimeFrom,
                }),
        })),
    [candles, indicators, customResults, timeframe, indicatorTimeframes, replay, realtimeFrom],
  )
  const generatedRef = useRef(generated)
  generatedRef.current = generated
  const structure = generated
    .map(
      (g) =>
        `${g.indicator.id}:${g.plots.map((p) => `${p.pane}:${p.style ?? 'line'}:${p.horizontalLine ?? ''}`).join(',')}`,
    )
    .join(';')
  const visibleVolume = indicators.some((i) => i.kind === 'volume' && i.visible)

  const zoom = (factor: number) => {
    const scale = chartRef.current?.timeScale(),
      range = scale?.getVisibleLogicalRange()
    if (scale && range) {
      const center = (range.from + range.to) / 2
      const half = Math.min(900, Math.max(8, ((range.to - range.from) * factor) / 2))
      scale.setVisibleLogicalRange({ from: center - half, to: center + half })
    }
  }
  useImperativeHandle(ref, () => ({
    fit: () => {
      chartRef.current?.timeScale().fitContent()
      mainRef.current?.priceScale().applyOptions({ autoScale: true })
    },
    zoom,
    setRange: (bars: number) => {
      const length = propsRef.current.candles.length
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(-1, length - bars),
        to: length + Math.min(8, bars * 0.06),
      })
    },
    latest: () => {
      const length = propsRef.current.candles.length
      chartRef.current
        ?.timeScale()
        .setVisibleLogicalRange({ from: Math.max(0, length - 145), to: length + 8 })
      mainRef.current?.priceScale().applyOptions({ autoScale: true })
    },
    snapshot: async () => {
      const chart = chartRef.current
      if (!chart || !propsRef.current.candles.length) return null
      const image = chart.takeScreenshot()
      const output = document.createElement('canvas')
      const ratio = image.width / (hostRef.current?.clientWidth || image.width)
      const width = image.width / ratio
      output.width = image.width
      output.height = image.height + 64 * ratio
      const ctx = output.getContext('2d')!
      ctx.scale(ratio, ratio)
      ctx.fillStyle = propsRef.current.settings.background
      ctx.fillRect(0, 0, width, output.height / ratio)
      ctx.fillStyle = '#b9ee82'
      ctx.font = 'bold 18px "DM Sans", sans-serif'
      ctx.fillText('ATLAS', 20, 28)
      ctx.fillStyle = '#d7dce3'
      ctx.font = '12px "DM Sans", sans-serif'
      ctx.fillText(
        `${propsRef.current.asset.name} / ${quoteCurrency(propsRef.current.asset)} · ${propsRef.current.timeframe} · ${propsRef.current.source === 'coinbase' ? 'COINBASE / ' + propsRef.current.feedState.toUpperCase() : 'DEMO DATA'}`,
        104,
        27,
        Math.max(90, width - 120),
      )
      ctx.fillStyle = '#777f8d'
      ctx.font = '10px "DM Sans", sans-serif'
      ctx.fillText(
        propsRef.current.source === 'coinbase'
          ? 'Coinbase market data. Current candles provisional. Not investment advice.'
          : 'Illustrative market data. Not investment advice.',
        20,
        49,
      )
      ctx.drawImage(image, 0, 64, width, image.height / ratio)
      if (svgRef.current && propsRef.current.drawingsVisible) {
        const svg = new XMLSerializer().serializeToString(svgRef.current)
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        const overlay = new Image()
        await new Promise<void>((resolve) => {
          overlay.onload = () => {
            ctx.drawImage(overlay, 0, 64)
            resolve()
          }
          overlay.onerror = () => resolve()
          overlay.src = url
        })
        URL.revokeObjectURL(url)
      }
      return new Promise((resolve) => output.toBlob(resolve, 'image/png'))
    },
  }))

  useEffect(() => {
    if (!hostRef.current) return
    const host = hostRef.current
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#101318' },
        textColor: '#777f8d',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        attributionLogo: false,
        panes: { separatorColor: '#252a33', separatorHoverColor: '#3a4251', enableResize: true },
      },
      grid: { vertLines: { color: '#1c2129' }, horzLines: { color: '#1c2129' } },
      rightPriceScale: {
        borderVisible: false,
        minimumWidth: 82,
        scaleMargins: { top: 0.22, bottom: 0.15 },
      },
      timeScale: {
        borderVisible: true,
        borderColor: '#252a33',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 6,
        minBarSpacing: 2.5,
        ticksVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#636d7e',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#303743',
        },
        horzLine: {
          color: '#636d7e',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#303743',
        },
      },
      handleScroll: { vertTouchDrag: false },
      localization: { locale: 'en-US' },
    })
    chartRef.current = chart
    const currentIndicatorSeries = indicatorSeries.current
    let raf = 0
    const refresh = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const panes = chart.panes()
        let top = 0
        const paneTops = panes.map((pane) => {
          const current = top
          top += pane.getHeight() + 1
          return current
        })
        const next = {
          width: chart.timeScale().width(),
          height: panes[0]?.getHeight() ?? 0,
          paneTops,
        }
        setGeometry((previous) =>
          previous.width === next.width &&
          previous.height === next.height &&
          previous.paneTops.length === next.paneTops.length &&
          previous.paneTops.every((top, i) => top === next.paneTops[i])
            ? previous
            : next,
        )
        if (propsRef.current.drawings.length || pendingRef.current) setRevision((r) => r + 1)
      })
    }
    refreshRef.current = refresh
    const anchorFromEvent = (param: {
      point?: { x: number; y: number }
      paneIndex?: number
      time?: Time
    }): Anchor | null => {
      if (!param.point || !mainRef.current || (param.paneIndex ?? 0) !== 0) return null
      const price = mainRef.current.coordinateToPrice(param.point.y)
      const data = propsRef.current.candles
      if (data.length < 2) return null
      const logical = chart.timeScale().coordinateToLogical(param.point.x)
      const index = logical === null ? null : Math.round(logical)
      const step = INTERVAL[propsRef.current.timeframe]
      const time =
        typeof param.time === 'number'
          ? param.time
          : index === null
            ? null
            : (data[index]?.time ??
              (index < 0
                ? data[0].time + index * step
                : data[data.length - 1].time + (index - data.length + 1) * step))
      return price !== null && time !== null ? { time, price } : null
    }
    let pointerStart: { x: number; y: number; id: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }
    }
    // Use native pointer releases for drawing. The chart engine intentionally
    // suppresses distant clicks within its double-click window; two-point tools
    // must still accept those rapid clicks, and taps, independently.
    const onPointerUp = (event: PointerEvent) => {
      const current = propsRef.current
      const start = pointerStart
      pointerStart = null
      if (
        !start ||
        start.id !== event.pointerId ||
        event.button !== 0 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ||
        current.drawingTool === 'cursor' ||
        current.drawingsLocked
      )
        return
      const rect = host.getBoundingClientRect()
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top
      if (
        x < 0 ||
        x > chart.timeScale().width() ||
        y < 0 ||
        y > (chart.panes()[0]?.getHeight() ?? 0)
      )
        return
      const anchor = anchorFromEvent({ point: { x, y }, paneIndex: 0 })
      if (!anchor) return
      const tool = current.drawingTool
      if (tool === 'text') {
        current.onTextRequest(anchor)
        current.onToolComplete()
        return
      }
      if (tool === 'horizontal') {
        current.onDraw({ id: uid(), tool, start: anchor, color: '#90b6ff' })
        current.onToolComplete()
        return
      }
      if (!pendingRef.current) {
        pendingRef.current = anchor
        setPending(anchor)
        setPreview(anchor)
      } else {
        current.onDraw({
          id: uid(),
          tool,
          start: pendingRef.current,
          end: anchor,
          color: '#90b6ff',
        })
        pendingRef.current = null
        setPending(null)
        setPreview(null)
        current.onToolComplete()
      }
    }
    const onMove = (param: MouseEventParams<Time>) => {
      const current = propsRef.current
      if (param.time) setHovered(current.candles.find((c) => c.time === param.time) ?? null)
      else setHovered(null)
      if (pendingRef.current) setPreview(anchorFromEvent(param))
      refresh()
    }
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointerup', onPointerUp)
    chart.subscribeCrosshairMove(onMove)
    chart.timeScale().subscribeVisibleLogicalRangeChange(refresh)
    const observer = new ResizeObserver(refresh)
    observer.observe(hostRef.current)
    refresh()
    return () => {
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointerup', onPointerUp)
      observer.disconnect()
      cancelAnimationFrame(raf)
      chart.remove()
      chartRef.current = null
      mainRef.current = null
      volumeRef.current = null
      currentIndicatorSeries.clear()
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (mainRef.current) chart.removeSeries(mainRef.current)
    const current = propsRef.current
    const referencePrice = current.candles.at(-1)?.close ?? 100
    const digits = current.asset.priceIncrement
      ? Math.min(12, Math.max(2, Math.ceil(-Math.log10(current.asset.priceIncrement))))
      : referencePrice < 0.0001
        ? 8
        : referencePrice < 1
          ? 5
          : referencePrice < 10
            ? 4
            : 2
    const base = {
      priceFormat: {
        type: 'custom' as const,
        formatter: (value: number) => formatPrice(value, false, digits),
        minMove: 10 ** -digits,
      },
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1 as const,
      lastValueVisible: true,
    }
    const { upColor, downColor } = current.settings
    if (chartType === 'candles' || chartType === 'hollow') {
      mainRef.current = chart.addSeries(CandlestickSeries, {
        ...base,
        upColor: chartType === 'hollow' ? current.settings.background : upColor,
        downColor,
        borderVisible: chartType === 'hollow',
        borderUpColor: upColor,
        borderDownColor: downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
      }) as ISeriesApi<SeriesType>
    } else if (chartType === 'line')
      mainRef.current = chart.addSeries(LineSeries, {
        ...base,
        color: upColor,
        lineWidth: 2,
      }) as ISeriesApi<SeriesType>
    else if (chartType === 'area')
      mainRef.current = chart.addSeries(AreaSeries, {
        ...base,
        lineColor: upColor,
        topColor: `${upColor}48`,
        bottomColor: `${upColor}00`,
        lineWidth: 2,
      }) as ISeriesApi<SeriesType>
    else
      mainRef.current = chart.addSeries(BarSeries, {
        ...base,
        upColor,
        downColor,
        thinBars: true,
      }) as ISeriesApi<SeriesType>
    dataInfo.current = { length: 0, first: 0, last: 0, candles: [] }
  }, [chartType, asset.symbol, asset.priceIncrement])

  useEffect(() => {
    const series = mainRef.current
    if (!series) return
    if (!candles.length) {
      series.setData([])
      dataInfo.current = { length: 0, first: 0, last: 0, candles: [] }
      return
    }
    const data = candles.map((c) =>
      chartType === 'line' || chartType === 'area'
        ? { time: c.time as UTCTimestamp, value: c.close }
        : { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close },
    )
    const previous = dataInfo.current
    if (
      previous.first === candles[0].time &&
      candles.slice(0, Math.min(candles.length, previous.length) - 1).every((c, i) => {
        const old = previous.candles[i]
        return (
          old &&
          old.time === c.time &&
          old.open === c.open &&
          old.high === c.high &&
          old.low === c.low &&
          old.close === c.close
        )
      }) &&
      (previous.length === candles.length || previous.length === candles.length - 1) &&
      previous.last <= candles[candles.length - 1].time
    )
      series.update(data[data.length - 1])
    else series.setData(data)
    dataInfo.current = {
      length: candles.length,
      first: candles[0].time,
      last: candles[candles.length - 1].time,
      candles,
    }
    refreshRef.current()
  }, [candles, chartType, asset.symbol, asset.priceIncrement])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (visibleVolume && !volumeRef.current) {
      volumeRef.current = chart.addSeries(HistogramSeries, {
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false,
      })
      volumeRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } })
    } else if (!visibleVolume && volumeRef.current) {
      chart.removeSeries(volumeRef.current)
      volumeRef.current = null
    }
    volumeRef.current?.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? `${settings.upColor}32` : `${settings.downColor}32`,
      })),
    )
  }, [visibleVolume, candles, settings.upColor, settings.downColor])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    indicatorSeries.current.forEach((entry) =>
      entry.series.forEach((series) => chart.removeSeries(series)),
    )
    indicatorSeries.current.clear()
    let paneIndex = 0
    for (const { indicator, plots } of generatedRef.current) {
      if (!plots.length) continue
      const oscillator = plots.some((p) => p.pane === 'oscillator')
      const targetPane = oscillator ? ++paneIndex : 0
      const series = plots.map((plot) => {
        const pane = plot.pane === 'oscillator' ? targetPane : 0
        const rsi = indicator.kind === 'rsi'
        const base = {
          color: plot.color,
          lineWidth: plot.lineWidth as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: { type: 'price' as const, precision: 2, minMove: 0.01 },
        }
        const line = (
          plot.style === 'histogram' || plot.style === 'circles'
            ? chart.addCustomSeries(new IndicatorPlotSeries(plot.style), base, pane)
            : chart.addSeries(
                LineSeries,
                {
                  ...base,
                  lineVisible: plot.horizontalLine === undefined,
                  ...(rsi
                    ? {
                        autoscaleInfoProvider: () => ({
                          priceRange: { minValue: 0, maxValue: 100 },
                        }),
                      }
                    : {}),
                },
                pane,
              )
        ) as ISeriesApi<SeriesType>
        if (plot.horizontalLine !== undefined)
          line.createPriceLine({
            price: plot.horizontalLine,
            color: plot.color,
            lineWidth: plot.lineWidth as 1 | 2 | 3 | 4,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: false,
          })
        if (pane > 0)
          line.priceScale().applyOptions({
            mode: PriceScaleMode.Normal,
            autoScale: true,
            scaleMargins: { top: 0.2, bottom: 0.15 },
            minimumWidth: 82,
            borderVisible: false,
          })
        if (rsi)
          for (const level of [30, 70])
            line.createPriceLine({
              price: level,
              color: '#51465f',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
            })
        return line
      })
      indicatorSeries.current.set(indicator.id, { series, pane: targetPane })
    }
    const cmPanes = new Set(
      generatedRef.current
        .filter((g) => g.indicator.kind === 'cm-ult-macd')
        .map((g) => indicatorSeries.current.get(g.indicator.id)?.pane),
    )
    chart
      .panes()
      .forEach((pane, i) => pane.setStretchFactor(i === 0 ? 4.4 : cmPanes.has(i) ? 1.8 : 1))
    refreshRef.current()
  }, [structure])

  useEffect(() => {
    // Reserve room for the compact two-row legend instead of covering the curves.
    for (const { indicator } of generatedRef.current) {
      if (indicator.kind !== 'cm-ult-macd') continue
      indicatorSeries.current
        .get(indicator.id)
        ?.series[0]?.priceScale()
        .applyOptions({
          scaleMargins: { top: geometry.width <= 560 ? 0.4 : 0.2, bottom: 0.15 },
        })
    }
  }, [geometry.width, structure])

  useEffect(() => {
    for (const { indicator, plots } of generated) {
      const entry = indicatorSeries.current.get(indicator.id)
      if (!entry) continue
      plots.forEach((plot, index) => {
        entry.series[index]?.applyOptions({
          color: plot.color,
          lineWidth: plot.lineWidth as 1 | 2 | 3 | 4,
        })
        entry.series[index]?.setData(indicatorPlotData(candles, plot))
      })
    }
    refreshRef.current()
  }, [generated, candles, structure])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: settings.background } },
      grid: { vertLines: { visible: settings.grid }, horzLines: { visible: settings.grid } },
      crosshair: {
        mode: !settings.crosshair
          ? CrosshairMode.Hidden
          : magnet
            ? CrosshairMode.Magnet
            : CrosshairMode.Normal,
      },
      handleScroll: {
        pressedMouseMove: drawingTool === 'cursor',
        horzTouchDrag: drawingTool === 'cursor',
      },
    })
    const series = mainRef.current
    if (series) {
      series.priceScale().applyOptions({
        mode:
          settings.priceMode === 'log'
            ? PriceScaleMode.Logarithmic
            : settings.priceMode === 'percent'
              ? PriceScaleMode.Percentage
              : PriceScaleMode.Normal,
        autoScale: settings.autoScale,
      })
      if (chartType === 'candles' || chartType === 'hollow')
        (series as ISeriesApi<'Candlestick'>).applyOptions({
          upColor: chartType === 'hollow' ? settings.background : settings.upColor,
          downColor: settings.downColor,
          borderUpColor: settings.upColor,
          borderDownColor: settings.downColor,
          wickUpColor: settings.upColor,
          wickDownColor: settings.downColor,
        })
      else if (chartType === 'line')
        (series as ISeriesApi<'Line'>).applyOptions({ color: settings.upColor })
      else if (chartType === 'area')
        (series as ISeriesApi<'Area'>).applyOptions({
          lineColor: settings.upColor,
          topColor: `${settings.upColor}48`,
          bottomColor: `${settings.upColor}00`,
        })
      else
        (series as ISeriesApi<'Bar'>).applyOptions({
          upColor: settings.upColor,
          downColor: settings.downColor,
        })
    }
    refreshRef.current()
  }, [settings, magnet, chartType, asset.symbol, drawingTool])

  useEffect(() => {
    const series = mainRef.current
    if (!series) return
    const lines = alerts
      .filter((a) => a.symbol === asset.symbol && a.enabled && !a.triggeredAt)
      .map((alert) =>
        series.createPriceLine({
          price: alert.price,
          color: '#d7ae68',
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: true,
          title: 'Alert',
        }),
      )
    return () => {
      if (mainRef.current === series) lines.forEach((line) => series.removePriceLine(line))
    }
  }, [alerts, asset.symbol, chartType])

  const hasCandles = candles.length > 0
  useEffect(() => {
    const length = propsRef.current.candles.length
    if (!length) return
    chartRef.current
      ?.timeScale()
      .setVisibleLogicalRange({ from: Math.max(0, length - 145), to: length + 8 })
    setHovered(null)
  }, [asset.symbol, timeframe, hasCandles])
  useEffect(() => {
    pendingRef.current = null
    setPending(null)
    setPreview(null)
  }, [drawingTool, asset.symbol, timeframe, drawingsLocked])

  const last = candles[candles.length - 1]
  const display = (hovered ? candles.find((c) => c.time === hovered.time) : null) ?? last
  const up = display ? display.close >= display.open : true
  const hoverIndex = hovered
    ? candles.findIndex((c) => c.time === hovered.time)
    : candles.length - 1
  const plotValue = (plot?: Plot) => {
    const value = plot?.values[hoverIndex]
    return value === null || value === undefined ? '—' : formatPrice(value)
  }
  const cmNotice = (indicator: Indicator) => {
    const s = cmMacdSettings(indicator)
    const resolution = cmMacdResolution(s, timeframe)
    const data = resolution === timeframe ? candles : indicatorTimeframes[resolution]?.candles
    const feed = indicatorTimeframes[resolution]
    if (
      resolution !== timeframe &&
      feed &&
      ['offline', 'stale', 'reconnecting', 'loading'].includes(feed.state)
    )
      return `${resolution} feed ${feed.state} · ${feed.message}`
    if (!data?.length)
      return replay && resolution !== timeframe
        ? `No ${resolution} history in this replay snapshot. Exit replay to load it.`
        : `Loading ${resolution} source candles…`
    if (resolution !== timeframe) {
      if (data[0].time > candles[0]?.time)
        return `${resolution} history limited to ${data.length} source candles; earlier bars unavailable.`
    }
    return data.length < s.signalLength
      ? `Warming up · ${data.length}/${s.signalLength} source candles`
      : ''
  }
  const drawingList = [...drawings]
  if (pending && preview && drawingTool !== 'cursor')
    drawingList.push({
      id: 'preview',
      tool: drawingTool,
      start: pending,
      end: preview,
      color: '#90b6ff',
    })
  const position = (anchor: Anchor) => {
    if (!candles.length) return null
    const exact = chartRef.current?.timeScale().timeToCoordinate(anchor.time as UTCTimestamp)
    let logical = 0
    if (exact === null || exact === undefined) {
      let low = 0,
        high = candles.length
      while (low < high) {
        const mid = (low + high) >> 1
        if (candles[mid].time < anchor.time) low = mid + 1
        else high = mid
      }
      if (low === 0) logical = (anchor.time - candles[0].time) / INTERVAL[timeframe]
      else if (low === candles.length)
        logical =
          candles.length -
          1 +
          (anchor.time - candles[candles.length - 1].time) / INTERVAL[timeframe]
      else
        logical =
          low -
          1 +
          (anchor.time - candles[low - 1].time) / (candles[low].time - candles[low - 1].time)
    }
    const x = exact ?? chartRef.current?.timeScale().logicalToCoordinate(logical as Logical)
    const y = mainRef.current?.priceToCoordinate(anchor.price)
    return x === null || x === undefined || y === null || y === undefined
      ? null
      : { x: Number(x), y: Number(y) }
  }
  const renderDrawing = (drawing: Drawing) => {
    const start = position(drawing.start),
      end = drawing.end ? position(drawing.end) : null
    if (!start) return null
    const color = drawing.color
    const opacity = drawing.id === 'preview' ? 0.65 : 1
    if (drawing.tool === 'horizontal')
      return (
        <g key={drawing.id} opacity={opacity}>
          <line
            x1="0"
            y1={start.y}
            x2={geometry.width}
            y2={start.y}
            stroke={color}
            strokeWidth="1"
          />
          <rect x="8" y={start.y - 20} width="100" height="18" rx="3" fill="#1c2637" />
          <text x="15" y={start.y - 7} fill={color} fontSize="10" fontFamily="JetBrains Mono">
            {formatPrice(drawing.start.price)}
          </text>
        </g>
      )
    if (drawing.tool === 'text')
      return (
        <g key={drawing.id}>
          <rect
            x={start.x - 6}
            y={start.y - 19}
            width={Math.min(400, (drawing.text?.length ?? 4) * 7 + 14)}
            height="27"
            rx="4"
            fill="#1b2638"
            fillOpacity=".94"
            stroke={`${color}60`}
          />
          <text x={start.x + 1} y={start.y - 1} fill={color} fontSize="12" fontFamily="DM Sans">
            {drawing.text}
          </text>
        </g>
      )
    if (!end) return <circle key={drawing.id} cx={start.x} cy={start.y} r="4" fill={color} />
    if (drawing.tool === 'rectangle')
      return (
        <rect
          key={drawing.id}
          x={Math.min(start.x, end.x)}
          y={Math.min(start.y, end.y)}
          width={Math.max(1, Math.abs(start.x - end.x))}
          height={Math.max(1, Math.abs(start.y - end.y))}
          fill={color}
          fillOpacity=".08"
          stroke={color}
          strokeWidth="1.2"
          opacity={opacity}
        />
      )
    if (drawing.tool === 'fibonacci') {
      const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
      const colors = ['#87909f', '#d18685', '#d6ad68', '#b9ce82', '#66b99a', '#77a8d8', '#ad91e5']
      return (
        <g key={drawing.id} opacity={opacity}>
          {ratios.map((ratio, i) => {
            const y = start.y + (end.y - start.y) * ratio
            return (
              <g key={ratio}>
                <line
                  x1={Math.min(start.x, end.x)}
                  y1={y}
                  x2={Math.max(start.x, end.x)}
                  y2={y}
                  stroke={colors[i]}
                  strokeWidth="1"
                />
                <text
                  x={Math.min(start.x, end.x) + 5}
                  y={y - 4}
                  fill={colors[i]}
                  fontSize="10"
                  fontFamily="JetBrains Mono"
                >
                  {ratio.toFixed(3)} (
                  {formatPrice(
                    drawing.start.price + (drawing.end!.price - drawing.start.price) * ratio,
                  )}
                  )
                </text>
              </g>
            )
          })}
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={color}
            strokeDasharray="4 4"
            strokeOpacity=".4"
          />
        </g>
      )
    }
    const change = drawing.end ? (drawing.end.price / drawing.start.price - 1) * 100 : 0
    return (
      <g key={drawing.id} opacity={opacity}>
        {drawing.tool === 'measure' && (
          <rect
            x={Math.min(start.x, end.x)}
            y={Math.min(start.y, end.y)}
            width={Math.abs(start.x - end.x)}
            height={Math.abs(start.y - end.y)}
            fill={change >= 0 ? '#2bb99b' : '#ed6773'}
            fillOpacity=".09"
          />
        )}
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={drawing.tool === 'measure' ? '5 3' : undefined}
        />
        <circle cx={start.x} cy={start.y} r="3.5" fill="#101318" stroke={color} />
        <circle cx={end.x} cy={end.y} r="3.5" fill="#101318" stroke={color} />
        {drawing.tool === 'measure' && (
          <g>
            <rect
              x={(start.x + end.x) / 2 - 69}
              y={Math.min(start.y, end.y) - 32}
              width="138"
              height="24"
              rx="4"
              fill="#233047"
            />
            <text
              x={(start.x + end.x) / 2}
              y={Math.min(start.y, end.y) - 16}
              textAnchor="middle"
              fill="#dbe5f7"
              fontSize="10"
              fontFamily="JetBrains Mono"
            >
              {change >= 0 ? '+' : ''}
              {change.toFixed(2)}% ·{' '}
              {Math.round(Math.abs(drawing.end!.time - drawing.start.time) / INTERVAL[timeframe])}{' '}
              bars
            </text>
          </g>
        )}
      </g>
    )
  }

  return (
    <div
      className={`chart-stage ${drawingTool !== 'cursor' && !drawingsLocked ? 'is-drawing' : ''}`}
      style={{ background: settings.background }}
      data-testid="chart-stage"
    >
      <div
        className="chart-canvas"
        ref={hostRef}
        role="img"
        aria-label={`${asset.name} ${timeframe} ${chartType} chart with ${candles.length} ${props.source === 'demo' ? 'simulated' : 'Coinbase'} price bars`}
      />
      <div className="chart-watermark" style={{ top: `${geometry.height * 0.46}px` }}>
        <span>{asset.symbol}</span>
        <small>Your edge, in focus.</small>
      </div>
      <div className="chart-information">
        <div className="symbol-heading">
          <CoinIcon asset={asset} size={21} />
          <h1>
            {asset.name} <span>/</span> {props.source === 'demo' ? 'TetherUS' : 'USD'}
          </h1>
          <span className="heading-dot">·</span>
          <span>{timeframe}</span>
          <span
            className={`exchange-label ${props.source === 'coinbase' ? 'coinbase-exchange' : ''}`}
            title={
              props.source === 'coinbase' && ['3m', '4h', '1W'].includes(timeframe)
                ? 'Aggregated from smaller Coinbase candles · UTC aligned'
                : 'Market data provider'
            }
          >
            {props.source === 'coinbase' ? 'COINBASE' : 'DEMO'}
          </span>
          <span
            className={`market-dot ${props.replay || props.feedState !== 'live' ? 'replaying' : ''}`}
            title={
              props.replay
                ? 'Bar replay'
                : props.source === 'coinbase'
                  ? `Coinbase · ${props.feedState}`
                  : 'Demo market data'
            }
          />
          <button
            className="legend-toggle"
            aria-label="Toggle indicator legend"
            onClick={() => setLegendOpen(!legendOpen)}
          >
            <ChevronDown size={13} className={legendOpen ? '' : 'rotated'} />
          </button>
        </div>
        {display && (
          <div className={`ohlc-row ${up ? 'positive' : 'negative'}`}>
            <span>
              <i>O</i>
              {formatPrice(display.open)}
            </span>
            <span>
              <i>H</i>
              {formatPrice(display.high)}
            </span>
            <span>
              <i>L</i>
              {formatPrice(display.low)}
            </span>
            <span>
              <i>C</i>
              {formatPrice(display.close)}
            </span>
            <span className="candle-change">
              {up ? '+' : ''}
              {formatPrice(display.close - display.open)} ({up ? '+' : ''}
              {((display.close / display.open - 1) * 100).toFixed(2)}%)
            </span>
          </div>
        )}
        {legendOpen && (
          <div className="indicator-legends">
            {indicators
              .filter(
                (ind) =>
                  !ind.visible ||
                  (ind.kind !== 'rsi' &&
                    ind.kind !== 'macd' &&
                    ind.kind !== 'cm-ult-macd' &&
                    !(
                      ind.kind === 'custom' &&
                      customResults[ind.id]?.plots.every((p) => p.pane === 'oscillator')
                    )),
              )
              .map((indicator) => {
                const group = generated.find((g) => g.indicator.id === indicator.id)
                return (
                  <div
                    className={`indicator-legend ${!indicator.visible ? 'muted-legend' : ''}`}
                    key={indicator.id}
                  >
                    <span className="legend-dot" style={{ background: indicator.color }} />
                    <button
                      className="legend-name"
                      onClick={() => props.onIndicatorEdit(indicator)}
                    >
                      {indicatorLabel(indicator)}
                    </button>
                    <span className="legend-value" style={{ color: indicator.color }}>
                      {indicator.kind === 'volume'
                        ? compactNumber(display?.volume)
                        : plotValue(group?.plots[0])}
                    </span>
                    <div className="legend-actions">
                      <IconButton
                        icon={indicator.visible ? Eye : EyeOff}
                        label={`Toggle ${indicator.name} ${indicator.period}`}
                        onClick={() => props.onIndicatorToggle(indicator.id)}
                      />
                      <IconButton
                        icon={Settings2}
                        label={`Settings for ${indicator.name} ${indicator.period}`}
                        onClick={() => props.onIndicatorEdit(indicator)}
                      />
                      <IconButton
                        icon={X}
                        label={`Remove ${indicator.name} ${indicator.period}`}
                        onClick={() => props.onIndicatorRemove(indicator.id)}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </div>
      <div className="chart-currency">
        {quoteCurrency(asset)} <ChevronDown size={10} />
      </div>
      {generated.map(({ indicator, plots }) => {
        const pane = indicatorSeries.current.get(indicator.id)?.pane ?? 0
        if (!pane || !geometry.paneTops[pane]) return null
        return (
          <div
            className={`oscillator-legend ${indicator.kind === 'cm-ult-macd' ? 'cm-oscillator-legend' : ''}`}
            data-indicator={indicator.kind}
            key={indicator.id}
            style={{ top: geometry.paneTops[pane] + 9, background: settings.background }}
          >
            <button className="legend-name" onClick={() => props.onIndicatorEdit(indicator)}>
              {indicatorLabel(indicator)}
            </button>
            {indicator.kind === 'cm-ult-macd' && (
              <span
                className="cm-resolution-badge"
                title="Original Pine v1 historical lookahead. Open-bar values and crossover dots can repaint."
              >
                {cmMacdSettings(indicator).useCurrentRes ? 'Chart' : 'MTF'} ·{' '}
                {cmMacdResolution(cmMacdSettings(indicator), timeframe)}
              </span>
            )}
            {plots
              .filter((plot) => plot.pane === 'oscillator' && !plot.hideLegend)
              .map((plot) => (
                <span
                  className="mono"
                  key={plot.title}
                  title={plot.title}
                  data-plot={plot.title}
                  style={{ color: plot.colors?.[hoverIndex] ?? plot.color }}
                >
                  {plotValue(plot)}
                </span>
              ))}
            <div className="legend-actions">
              <IconButton
                icon={Eye}
                label={`Toggle ${indicator.name} visibility`}
                onClick={() => props.onIndicatorToggle(indicator.id)}
              />
              <IconButton
                icon={Settings2}
                label={`Settings for ${indicator.name} ${indicator.period}`}
                onClick={() => props.onIndicatorEdit(indicator)}
              />
              <IconButton
                icon={X}
                label={`Remove ${indicator.name} ${indicator.period}`}
                onClick={() => props.onIndicatorRemove(indicator.id)}
              />
            </div>
            {indicator.kind === 'cm-ult-macd' && cmNotice(indicator) && (
              <span className="cm-indicator-notice" role="status">
                {cmNotice(indicator)}
                {!replay &&
                  cmMacdResolution(cmMacdSettings(indicator), timeframe) !== timeframe && (
                    <IconButton
                      icon={RotateCcw}
                      label="Retry CM_Ult_MacD_MTF timeframe data"
                      onClick={props.onIndicatorRetry}
                    />
                  )}
              </span>
            )}
          </div>
        )
      })}
      <svg
        ref={svgRef}
        className="drawing-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        data-revision={revision}
      >
        {drawingsVisible && drawingList.map(renderDrawing)}
      </svg>
      {drawingTool !== 'cursor' && !drawingsLocked && (
        <div className="drawing-hint">
          {pending
            ? 'Click to place the second point'
            : drawingTool === 'horizontal'
              ? 'Click to place a horizontal line'
              : drawingTool === 'text'
                ? 'Click to place a note'
                : 'Click to place the first point'}
          <kbd>esc</kbd> to cancel
        </div>
      )}
      <div className="chart-navigation" style={{ top: geometry.height - 42 }}>
        <IconButton icon={Minus} label="Zoom out" onClick={() => zoom(1.3)} />
        <IconButton icon={Plus} label="Zoom in" onClick={() => zoom(0.75)} />
        <span />
        <IconButton
          icon={RotateCcw}
          label="Reset chart view"
          onClick={() => {
            chartRef.current?.timeScale().setVisibleLogicalRange({
              from: Math.max(0, candles.length - 145),
              to: candles.length + 8,
            })
            mainRef.current?.priceScale().applyOptions({ autoScale: true })
          }}
        />
      </div>
    </div>
  )
})
