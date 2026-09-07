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
import {
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react'
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
import type { OrderBookView } from '../../shared/coinbase'
import { scoreZone } from '../../shared/order-book'
import type { BookSide, BookStrengthBucket, ZoneBookScore } from '../../shared/order-book'
import { formatNotional } from '../../shared/whale-flow'
import { builtInPlots } from '../lib/indicators'
import { cmMacdResolution, cmMacdSettings, indicatorLabel } from '../lib/cm-ult-macd'
import type { IndicatorTimeframes } from '../lib/cm-ult-macd'
import {
  calculateSmartMoneyConcepts,
  displayedSmcResult,
  smcLabelSize,
  smcPalette,
  smcSettings,
  structureAllowed,
} from '../lib/smart-money-concepts'
import {
  calculateSrBreaksRetests,
  SR_ATR_LENGTH,
  srBreaksRetestsSettings,
  SR_BROKEN_FILL_OPACITY,
  SR_BREAKS_RETESTS_COLORS,
} from '../lib/sr-breaks-retests'
import { calculateCoinbaseStrike, coinbaseStrikeSettings } from '../lib/coinbase-strike'
import { ta } from '../lib/indicator-runtime'
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
  /** Resting-liquidity depth view of the charted product; zone chips and walls need it. */
  book?: OrderBookView | null
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
    book,
  } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const smcSvgRef = useRef<SVGSVGElement>(null)
  const srSvgRef = useRef<SVGSVGElement>(null)
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
  const smcOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'smart-money-concepts')
        .map((indicator) => {
          const smc = smcSettings(indicator)
          return {
            indicator,
            settings: smc,
            palette: smcPalette(smc),
            result: displayedSmcResult(
              calculateSmartMoneyConcepts(candles, smc, {
                timeframe,
                timeframes: indicatorTimeframes,
                replay,
              }),
              smc,
            ),
          }
        }),
    [candles, indicatorTimeframes, indicators, replay, timeframe],
  )
  const candleTrendOverlay = smcOverlays.find((overlay) => overlay.settings.colorCandles)
  const srOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'sr-breaks-retests')
        .map((indicator) => {
          const settings = srBreaksRetestsSettings(indicator)
          return {
            indicator,
            settings,
            result: calculateSrBreaksRetests(candles, settings),
          }
        }),
    [candles, indicators],
  )
  const strikeOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'coinbase-strike')
        .map((indicator) => {
          const settings = coinbaseStrikeSettings(indicator)
          return {
            indicator,
            settings,
            result: calculateCoinbaseStrike(candles, settings),
          }
        }),
    [candles, indicators],
  )
  const rsiIndicator = indicators.find((i) => i.visible && i.kind === 'rsi')
  const rsiPeriod = rsiIndicator?.period ?? 14
  const [rsiMinimized, setRsiMinimized] = useState(false)
  const [rsiPos, setRsiPos] = useState<{ x: number; y: number } | null>(null)
  const [isDraggingRsi, setIsDraggingRsi] = useState(false)
  const rsiCardRef = useRef<HTMLDivElement>(null)
  const rsiDragState = useRef<{
    startX: number
    startY: number
    initialX: number
    initialY: number
  } | null>(null)

  const handleRsiPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button, input, a')) return
    event.stopPropagation()
    const card = rsiCardRef.current
    const stage = card?.parentElement
    if (!card || !stage) return

    const cardRect = card.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const currentX = cardRect.left - stageRect.left
    const currentY = cardRect.top - stageRect.top

    rsiDragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      initialX: currentX,
      initialY: currentY,
    }
    setIsDraggingRsi(true)

    const onPointerMove = (e: PointerEvent) => {
      if (!rsiDragState.current || !rsiCardRef.current) return
      const currentStage = rsiCardRef.current.parentElement
      if (!currentStage) return
      const curStageRect = currentStage.getBoundingClientRect()
      const curCardRect = rsiCardRef.current.getBoundingClientRect()

      const deltaX = e.clientX - rsiDragState.current.startX
      const deltaY = e.clientY - rsiDragState.current.startY

      let newX = rsiDragState.current.initialX + deltaX
      let newY = rsiDragState.current.initialY + deltaY

      const maxX = Math.max(0, curStageRect.width - curCardRect.width - 4)
      const maxY = Math.max(0, curStageRect.height - curCardRect.height - 4)
      newX = Math.min(Math.max(4, newX), maxX)
      newY = Math.min(Math.max(4, newY), maxY)

      setRsiPos({ x: newX, y: newY })
    }

    const onPointerUp = () => {
      rsiDragState.current = null
      setIsDraggingRsi(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  const rsiValues = useMemo(() => {
    if (candles.length < 2) return []
    return ta.rsi(
      candles.map((c) => c.close),
      rsiPeriod,
    )
  }, [candles, rsiPeriod])
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
      const paintSvg = async (element: SVGSVGElement | null) => {
        if (!element) return
        const svg = new XMLSerializer().serializeToString(element)
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
      await paintSvg(smcSvgRef.current)
      await paintSvg(srSvgRef.current)
      if (propsRef.current.drawingsVisible) await paintSvg(svgRef.current)
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
        if (
          propsRef.current.drawings.length ||
          pendingRef.current ||
          propsRef.current.indicators.some(
            (indicator) =>
              (indicator.visible && indicator.kind === 'smart-money-concepts') ||
              (indicator.visible && indicator.kind === 'sr-breaks-retests'),
          )
        )
          setRevision((r) => r + 1)
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
    const data = candles.map((candle, index) => {
      if (chartType === 'line' || chartType === 'area')
        return { time: candle.time as UTCTimestamp, value: candle.close }
      const trend = candleTrendOverlay?.result.trend[index] ?? 0
      const smcColor =
        candleTrendOverlay && trend
          ? trend > 0
            ? candleTrendOverlay.palette.internalBull
            : candleTrendOverlay.palette.internalBear
          : undefined
      return {
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        ...(smcColor && chartType === 'candles'
          ? { color: smcColor, borderColor: smcColor, wickColor: smcColor }
          : {}),
      }
    })
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
  }, [candles, chartType, asset.symbol, asset.priceIncrement, candleTrendOverlay])

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
  const activeRsi =
    rsiValues[hoverIndex] ?? (rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null)
  const prevRsi =
    hoverIndex > 0
      ? rsiValues[hoverIndex - 1]
      : rsiValues.length > 1
        ? rsiValues[rsiValues.length - 2]
        : null
  const rsiDelta = activeRsi !== null && prevRsi !== null ? activeRsi - prevRsi : null
  const rsiZoneClass =
    activeRsi === null
      ? ''
      : activeRsi >= 70
        ? 'rsi-zone-ob'
        : activeRsi <= 30
          ? 'rsi-zone-os'
          : activeRsi >= 50
            ? 'rsi-zone-bull'
            : 'rsi-zone-bear'
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
  const smcNotice = (indicator: Indicator) => {
    const settings = smcSettings(indicator)
    const resolution = settings.fvgTimeframe
    if (!settings.showFairValueGaps || !resolution || resolution === timeframe) return ''
    const feed = indicatorTimeframes[resolution]
    const data = feed?.candles
    if (feed && ['offline', 'stale', 'reconnecting', 'loading'].includes(feed.state))
      return `${resolution} FVG feed ${feed.state} · ${feed.message}`
    if (!data?.length)
      return replay
        ? `No ${resolution} FVG history in this replay snapshot. Exit replay to load it.`
        : `Loading ${resolution} FVG source candles…`
    if (data[0].time > candles[0]?.time)
      return `${resolution} FVG history limited to ${data.length} source candles; earlier bars unavailable.`
    return ''
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

  const bookStrength = (top: number, bottom: number, side: BookSide): ZoneBookScore | null =>
    book && !props.replay ? scoreZone(book, top, bottom, side) : null
  const BUCKET_FILL: Record<BookStrengthBucket, string> = {
    strong: '#2ebd85',
    medium: '#e8a93d',
    weak: '#7a8592',
    unloaded: '#4b5462',
  }
  const chipText = (score: ZoneBookScore | null) =>
    score && score.bucket !== 'unloaded'
      ? `${score.bucket === 'strong' ? 'STRONG' : score.bucket === 'medium' ? 'MED' : 'WEAK'} ${formatNotional(score.notional)}`
      : null
  const smcPoint = (index: number, price: number) => {
    const candle = candles[index]
    return candle ? position({ time: candle.time, price }) : null
  }
  const smcTimePoint = (time: number, price: number) => position({ time, price })
  const smcLineDash = (style: '⎯⎯⎯' | '----' | '····') =>
    style === '----' ? '7 4' : style === '····' ? '1 4' : undefined
  const renderSmcOverlay = (overlay: (typeof smcOverlays)[number]) => {
    const { indicator, settings: smc, palette, result } = overlay
    const renderStructure = (event: (typeof result.internalEvents)[number]) => {
      const isInternal = event.kind === 'internal'
      const enabled = isInternal ? smc.showInternal : smc.showSwing
      const filter =
        event.side === 'bullish'
          ? isInternal
            ? smc.internalBullish
            : smc.swingBullish
          : isInternal
            ? smc.internalBearish
            : smc.swingBearish
      if (!enabled || !structureAllowed(event.type, filter)) return null
      const start = smcPoint(event.pivotIndex, event.price)
      const end = smcPoint(event.breakIndex, event.price)
      if (!start || !end) return null
      const color =
        event.side === 'bullish'
          ? isInternal
            ? palette.internalBull
            : palette.swingBull
          : isInternal
            ? palette.internalBear
            : palette.swingBear
      const size = smcLabelSize(isInternal ? smc.internalLabelSize : smc.swingLabelSize)
      // LuxAlgo-style: line runs pivot → break; the label is transparent colored
      // text at the break bar so it never hides the price action behind it.
      const label = event.type
      return (
        <g key={`${event.kind}:${event.side}:${event.pivotIndex}:${event.breakIndex}`}>
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={color}
            strokeWidth={isInternal ? '1' : '1.5'}
            strokeDasharray={isInternal ? '4 3' : undefined}
            opacity=".95"
          />
          <text
            x={end.x}
            y={event.side === 'bullish' ? end.y - 6 : end.y + size + 5}
            textAnchor="middle"
            fill={color}
            fontSize={size}
            fontWeight="600"
            fontFamily="DM Sans, sans-serif"
            className="smc-label"
          >
            {label}
          </text>
        </g>
      )
    }
    const renderOrderBlock = (block: (typeof result.internalOrderBlocks)[number]) => {
      const visible =
        block.kind === 'internal' ? smc.showInternalOrderBlocks : smc.showSwingOrderBlocks
      if (!visible) return null
      // LuxAlgo-style: active boxes extend to the right edge; mitigation dims, invalidation removes.
      const rightIndex = candles.length - 1
      const leftTop = smcPoint(block.startIndex, block.top)
      const leftBottom = smcPoint(block.startIndex, block.bottom)
      const right = smcPoint(rightIndex, block.bottom)
      if (!leftTop || !leftBottom || !right) return null
      const mitigated = block.mitigatedAt !== undefined
      const color =
        mitigated && smc.highlightMitigatedBlocks
          ? palette.muted
          : block.side === 'bullish'
            ? palette.bullOrderBlock
            : palette.bearOrderBlock
      const x = Math.min(leftTop.x, right.x)
      const y = Math.min(leftTop.y, leftBottom.y)
      const width = Math.max(2, Math.abs(right.x - leftTop.x))
      const height = Math.max(1, Math.abs(leftBottom.y - leftTop.y))
      const strength = bookStrength(block.top, block.bottom, block.side === 'bullish' ? 'bid' : 'ask')
      const chip = chipText(strength)
      return (
        <g key={block.id} className="smc-order-block">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill={color}
            fillOpacity={mitigated ? '.09' : '.18'}
            stroke={color}
            strokeWidth="1"
            strokeOpacity={mitigated ? '.45' : '.9'}
          />
          <text
            x={x + 4}
            y={Math.min(y + 11, geometry.height - 3)}
            fill={color}
            fontSize="8"
            fontWeight="600"
            fontFamily="DM Sans, sans-serif"
          >
            {block.kind === 'internal' ? 'iOB' : 'OB'} {block.side === 'bullish' ? '+' : '−'}
            {mitigated ? ' · mitigated' : ''}
          </text>
          {chip && strength && (
            <text
              x={x + 4}
              y={Math.min(y + 21, geometry.height - 3)}
              fill={BUCKET_FILL[strength.bucket]}
              fontSize="7"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
              data-testid="book-zone-chip"
            >
              {chip}
            </text>
          )}
        </g>
      )
    }
    const renderEqualLevel = (level: (typeof result.equalLevels)[number]) => {
      if (!smc.showEqualHighLow) return null
      const start = smcPoint(level.firstIndex, level.price)
      const end = smcPoint(level.secondIndex, level.price)
      if (!start || !end) return null
      const color = level.side === 'high' ? palette.swingBear : palette.swingBull
      const size = smcLabelSize(smc.equalHighLowLabelSize)
      const text = level.side === 'high' ? 'EQH' : 'EQL'
      return (
        <g key={`${level.side}:${level.firstIndex}:${level.secondIndex}`}>
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={color}
            strokeDasharray="2 3"
            strokeWidth="1"
          />
          <text
            x={end.x}
            y={level.side === 'high' ? end.y - 6 : end.y + size + 5}
            textAnchor="middle"
            fill={color}
            fontSize={size}
            fontWeight="600"
            fontFamily="DM Sans, sans-serif"
            className="smc-label"
          >
            {text}
          </text>
        </g>
      )
    }
    const renderFairValueGap = (gap: (typeof result.fairValueGaps)[number]) => {
      if (!smc.showFairValueGaps) return null
      const leftTop = smcTimePoint(gap.startTime, gap.top)
      const leftBottom = smcTimePoint(gap.startTime, gap.bottom)
      // Keep extensions inside available chart history; the price pane does not
      // synthesize future bars solely to show a projected FVG rectangle.
      const rightTime = Math.max(
        gap.startTime,
        Math.min(gap.endTime, candles.at(-1)?.time ?? gap.endTime),
      )
      const right = smcTimePoint(rightTime, gap.bottom)
      if (!leftTop || !leftBottom || !right) return null
      const color = gap.side === 'bullish' ? palette.bullFvg : palette.bearFvg
      const x = Math.min(leftTop.x, right.x)
      const y = Math.min(leftTop.y, leftBottom.y)
      const width = Math.max(2, Math.abs(right.x - leftTop.x))
      const height = Math.max(1, Math.abs(leftBottom.y - leftTop.y))
      const strength = bookStrength(gap.top, gap.bottom, gap.side === 'bullish' ? 'bid' : 'ask')
      const chip = chipText(strength)
      return (
        <g key={`fvg:${gap.side}:${gap.startIndex}`} className="smc-fvg">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill={color}
            fillOpacity={gap.mitigatedAt === undefined ? '.13' : '.05'}
            stroke={color}
            strokeOpacity=".58"
            strokeWidth="1"
          />
          <text
            x={x + 3}
            y={Math.min(y + 10, geometry.height - 3)}
            fill={color}
            fontSize="7"
            fontWeight="600"
            fontFamily="DM Sans, sans-serif"
          >
            FVG
          </text>
          {chip && strength && (
            <text
              x={x + 3}
              y={Math.min(y + 20, geometry.height - 3)}
              fill={BUCKET_FILL[strength.bucket]}
              fontSize="7"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
              data-testid="book-zone-chip"
            >
              {chip}
            </text>
          )}
        </g>
      )
    }
    const renderPreviousHighLow = (level: (typeof result.previousHighLows)[number]) => {
      const highStart = smcPoint(level.startIndex, level.high)
      const highEnd = smcPoint(level.endIndex, level.high)
      const lowStart = smcPoint(level.startIndex, level.low)
      const lowEnd = smcPoint(level.endIndex, level.low)
      if (!highStart || !highEnd || !lowStart || !lowEnd) return null
      const color = palette.equilibrium
      const dash = smcLineDash(level.style)
      return (
        <g key={`${level.timeframe}:${level.startIndex}`} opacity=".82">
          <line
            x1={highStart.x}
            y1={highStart.y}
            x2={highEnd.x}
            y2={highEnd.y}
            stroke={color}
            strokeWidth="1"
            strokeDasharray={dash}
          />
          <line
            x1={lowStart.x}
            y1={lowStart.y}
            x2={lowEnd.x}
            y2={lowEnd.y}
            stroke={color}
            strokeWidth="1"
            strokeDasharray={dash}
          />
          <text
            x={highEnd.x - 2}
            y={highEnd.y - 4}
            textAnchor="end"
            fill={color}
            fontSize="7"
            fontFamily="DM Sans, sans-serif"
          >
            P{level.timeframe}H
          </text>
          <text
            x={lowEnd.x - 2}
            y={lowEnd.y + 9}
            textAnchor="end"
            fill={color}
            fontSize="7"
            fontFamily="DM Sans, sans-serif"
          >
            P{level.timeframe}L
          </text>
        </g>
      )
    }
    const renderSwingPoint = (pivot: (typeof result.swingPivots)[number]) => {
      if (!smc.showSwing || !smc.showSwingPoints) return null
      const point = smcPoint(pivot.index, pivot.price)
      if (!point) return null
      const bullish = pivot.kind === 'low'
      const color = bullish ? palette.swingBull : palette.swingBear
      const size = smcLabelSize(smc.swingLabelSize)
      return (
        <text
          key={`swing:${pivot.kind}:${pivot.index}`}
          x={point.x}
          y={bullish ? point.y + size + 5 : point.y - 6}
          textAnchor="middle"
          fill={color}
          fontSize={size}
          fontWeight="600"
          fontFamily="DM Sans, sans-serif"
          className="smc-label"
        >
          {pivot.label}
        </text>
      )
    }
    const renderStrongWeak = () => {
      if (!smc.showStrongWeakHighsLows) return null
      const high = [...result.swingPivots].reverse().find((pivot) => pivot.kind === 'high')
      const low = [...result.swingPivots].reverse().find((pivot) => pivot.kind === 'low')
      const lastIndex = candles.length - 1
      const bullish = result.swingTrend >= 0
      const draw = (pivot: typeof high, label: string, color: string, below: boolean) => {
        if (!pivot) return null
        const start = smcPoint(pivot.index, pivot.price)
        const end = smcPoint(lastIndex, pivot.price)
        if (!start || !end) return null
        return (
          <g key={`strong-weak:${pivot.kind}:${pivot.index}`}>
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={color}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={end.x - 3}
              y={below ? end.y + 10 : end.y - 4}
              textAnchor="end"
              fill={color}
              fontSize="8"
              fontWeight="600"
              fontFamily="DM Sans, sans-serif"
            >
              {label}
            </text>
          </g>
        )
      }
      return (
        <>
          {draw(high, bullish ? 'Weak High' : 'Strong High', palette.swingBear, false)}
          {draw(low, bullish ? 'Strong Low' : 'Weak Low', palette.swingBull, true)}
        </>
      )
    }
    const renderPremiumDiscount = () => {
      if (!smc.showPremiumDiscount || !result.range) return null
      const { high, low, startIndex } = result.range
      const start = smcPoint(startIndex, high)
      const end = smcPoint(candles.length - 1, low)
      const highPoint = smcPoint(startIndex, high)
      const lowPoint = smcPoint(startIndex, low)
      if (!start || !end || !highPoint || !lowPoint) return null
      const range = high - low
      const zones = [
        { label: 'PREMIUM', top: high, bottom: low + range * 0.525, color: palette.premium },
        {
          label: 'EQUILIBRIUM',
          top: low + range * 0.525,
          bottom: low + range * 0.475,
          color: palette.equilibrium,
        },
        { label: 'DISCOUNT', top: low + range * 0.475, bottom: low, color: palette.discount },
      ]
      const x = Math.min(start.x, end.x)
      const width = Math.max(2, Math.abs(end.x - start.x))
      return (
        <g className="smc-premium-discount">
          {zones.map((zone) => {
            const top = smcPoint(startIndex, zone.top)
            const bottom = smcPoint(startIndex, zone.bottom)
            if (!top || !bottom) return null
            const y = Math.min(top.y, bottom.y)
            const height = Math.max(1, Math.abs(bottom.y - top.y))
            return (
              <g key={zone.label}>
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={zone.color}
                  fillOpacity={zone.label === 'EQUILIBRIUM' ? '.13' : '.06'}
                  stroke={zone.color}
                  strokeOpacity=".35"
                  strokeWidth="1"
                />
                <text
                  x={x + width / 2}
                  y={y + Math.min(height / 2 + 3, 10)}
                  textAnchor="middle"
                  fill={zone.color}
                  fillOpacity=".82"
                  fontSize="7"
                  fontWeight="600"
                  fontFamily="DM Sans, sans-serif"
                >
                  {zone.label}
                </text>
              </g>
            )
          })}
        </g>
      )
    }
    return (
      <g key={indicator.id} data-smc-mode={smc.mode}>
        {renderPremiumDiscount()}
        {result.previousHighLows.map(renderPreviousHighLow)}
        {result.fairValueGaps.map(renderFairValueGap)}
        {result.internalOrderBlocks.map(renderOrderBlock)}
        {result.swingOrderBlocks.map(renderOrderBlock)}
        {result.equalLevels.map(renderEqualLevel)}
        {result.internalEvents.map(renderStructure)}
        {result.swingEvents.map(renderStructure)}
        {result.swingPivots.map(renderSwingPoint)}
        {renderStrongWeak()}
      </g>
    )
  }

  // Live resting-book S/R: walls detected from the level2 order book are drawn as dashed
  // support/resistance lines across the pane, labeled with their USD size and the liquidity in
  // front of them. This is the "S/R the book itself is constructing", refreshed every second.
  const renderBookOverlay = () => {
    if (!book || props.replay || geometry.height <= 0 || !mainRef.current) return null
    const yOf = (price: number) => {
      const y = mainRef.current?.priceToCoordinate(price)
      return typeof y === 'number' && Number.isFinite(y) && y >= -1 && y <= geometry.height + 1
        ? y
        : null
    }
    const drawWall = (wall: OrderBookView['supports'][number], side: 'support' | 'resistance') => {
      const y = yOf(wall.price)
      if (y === null) return null
      const color = side === 'support' ? '#2ebd85' : '#f6465d'
      const label = `${side === 'support' ? 'S' : 'R'} ${formatNotional(wall.notional)}`
      const hint =
        wall.depth > 0 ? ` · in front ${formatNotional(wall.depth)}` : ''
      return (
        <g key={`book-wall:${wall.side}:${wall.price}`} className="book-wall" data-testid="book-wall">
          <line
            x1={0}
            y1={y}
            x2={geometry.width}
            y2={y}
            stroke={color}
            strokeWidth="1"
            strokeOpacity=".5"
            strokeDasharray="7 5"
          />
          <text
            x={5}
            y={Math.max(9, y - 5)}
            fill={color}
            fontSize="8"
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
            paintOrder="stroke"
            stroke="#101318"
            strokeWidth="3"
          >
            {label}
            {hint}
          </text>
        </g>
      )
    }
    const elements = [
      ...book.resistances.map((wall) => drawWall(wall, 'resistance')),
      ...book.supports.map((wall) => drawWall(wall, 'support')),
    ]
    return elements.some((element) => element !== null) ? elements : null
  }

  // SR Breaks and Retests is drawn as a native SVG overlay, mirroring Pine's
  // boxes, plotchar diamonds, and break labels.
  const srPoint = (index: number, price: number) => {
    const last = candles.length - 1
    if (index <= last) {
      const candle = candles[index]
      return candle ? position({ time: candle.time, price }) : null
    }
    // Pine extends the live boxes one bar past the newest bar
    // (`set_right(bar_index + 1)`), so extrapolate into the right offset.
    const lastTime = candles.at(-1)?.time
    if (lastTime === undefined) return null
    const future = position({ time: lastTime + INTERVAL[timeframe] * (index - last), price })
    return future ?? position({ time: lastTime, price })
  }
  const renderSrOverlay = (overlay: (typeof srOverlays)[number]) => {
    const { indicator, result } = overlay
    const renderZone = (zone: (typeof result.zones)[number]) => {
      // A null boundary is Pine's `na` box bottom while ATR(200) warms up.
      if (zone.boundary === null) return null
      const leftEdge = srPoint(zone.pivotIndex, zone.level)
      const rightEdge = srPoint(zone.rightIndex, zone.boundary)
      if (!leftEdge || !rightEdge) return null
      const x = Math.min(leftEdge.x, rightEdge.x)
      const width = Math.max(2, Math.abs(rightEdge.x - leftEdge.x))
      const topPrice = zone.side === 'support' ? zone.level : zone.boundary
      const bottomPrice = zone.side === 'support' ? zone.boundary : zone.level
      const topLeft = srPoint(zone.pivotIndex, topPrice)
      const bottomLeft = srPoint(zone.pivotIndex, bottomPrice)
      if (!topLeft || !bottomLeft) return null
      const y = Math.min(topLeft.y, bottomLeft.y)
      const height = Math.max(1, Math.abs(bottomLeft.y - topLeft.y))
      const broken = zone.state === 'broken'
      const color =
        zone.side === 'support'
          ? broken
            ? SR_BREAKS_RETESTS_COLORS.resistance
            : SR_BREAKS_RETESTS_COLORS.support
          : broken
            ? SR_BREAKS_RETESTS_COLORS.support
            : SR_BREAKS_RETESTS_COLORS.resistance
      const strength = bookStrength(topPrice, bottomPrice, zone.side === 'support' ? 'bid' : 'ask')
      const chip = chipText(strength)
      return (
        <g key={zone.id} className="sr-zone" data-testid="sr-zone">
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill={color}
            fillOpacity={broken ? SR_BROKEN_FILL_OPACITY : Math.max(0.02, zone.fillOpacity)}
            stroke={color}
            strokeWidth="1"
            strokeDasharray={broken ? '5 4' : undefined}
          />
          {height >= 9 && (
            <text
              x={x + width / 2}
              y={y + height / 2 + 3}
              textAnchor="middle"
              fill={SR_BREAKS_RETESTS_COLORS.foreground}
              fontSize="9"
              fontFamily="DM Sans, sans-serif"
              className="sr-zone-text"
            >
              {zone.volumeText}
            </text>
          )}
          {chip && strength && height >= 22 && (
            <text
              x={x + 4}
              y={y + 9}
              fill={BUCKET_FILL[strength.bucket]}
              fontSize="7"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
              data-testid="book-zone-chip"
            >
              {chip}
            </text>
          )}
        </g>
      )
    }
    const renderMarker = (marker: (typeof result.markers)[number]) => {
      const candle = candles[marker.index]
      if (!candle) return null
      const anchor = position({
        time: candle.time,
        price: marker.location === 'above' ? candle.high : candle.low,
      })
      if (!anchor) return null
      return (
        <text
          key={`sr-marker:${marker.kind}:${marker.index}`}
          x={anchor.x}
          y={marker.location === 'above' ? anchor.y - 6 : anchor.y + 13}
          textAnchor="middle"
          fill={marker.color}
          fontSize="10"
          fontFamily="DM Sans, sans-serif"
          className="smc-label"
          data-testid="sr-marker"
        >
          ◆
        </text>
      )
    }
    const renderLabel = (label: (typeof result.labels)[number]) => {
      const anchor = srPoint(label.index, label.price)
      if (!anchor) return null
      const text = label.kind === 'break-support' ? 'Break Sup' : 'Break Res'
      const width = 60
      const height = 17
      const above = label.kind === 'break-support'
      const x = anchor.x - width / 2
      const y = above ? anchor.y - height - 7 : anchor.y + 7
      return (
        <g
          key={`sr-label:${label.kind}:${label.index}`}
          className="sr-break-label"
          data-testid="sr-break-label"
        >
          <rect x={x} y={y} width={width} height={height} rx={3} fill={label.color} />
          <path
            d={
              above
                ? `M ${anchor.x - 4} ${y + height} L ${anchor.x + 4} ${y + height} L ${anchor.x} ${y + height + 5} Z`
                : `M ${anchor.x - 4} ${y} L ${anchor.x + 4} ${y} L ${anchor.x} ${y - 5} Z`
            }
            fill={label.color}
          />
          <text
            x={anchor.x}
            y={y + 12}
            textAnchor="middle"
            fill={SR_BREAKS_RETESTS_COLORS.foreground}
            fontSize="9.5"
            fontWeight="600"
            fontFamily="DM Sans, sans-serif"
          >
            {text}
          </text>
        </g>
      )
    }
    return (
      <g key={indicator.id} data-sr-inputs={`${overlay.settings.lookbackPeriod}`}>
        {result.zones.map(renderZone)}
        {result.markers.map(renderMarker)}
        {result.labels.map(renderLabel)}
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
        {strikeOverlays.map(({ indicator, settings: strikeSettings, result }) => {
          if (!strikeSettings.showStatusBadge || result.currentStrike === null) return null
          const strikeDisplay =
            hovered && result.strikeLine[hoverIndex] !== null
              ? result.strikeLine[hoverIndex]!
              : result.currentStrike
          const currentPrice = hovered
            ? hovered.close
            : (result.currentPrice ?? candles[candles.length - 1]?.close ?? strikeDisplay)
          const delta = currentPrice - strikeDisplay
          const deltaPct = strikeDisplay > 0 ? (delta / strikeDisplay) * 100 : 0
          const isUp = delta >= 0
          const minutesLeft = Math.floor(result.timeRemainingSeconds / 60)
          const secondsLeft = result.timeRemainingSeconds % 60
          const countdown = `${String(minutesLeft).padStart(2, '0')}:${String(secondsLeft).padStart(2, '0')}`

          return (
            <div
              key={`strike-badge-${indicator.id}`}
              className={`strike-hud-badge ${isUp ? 'strike-is-up' : 'strike-is-down'}`}
              style={{
                borderColor: isUp ? strikeSettings.upColor : strikeSettings.downColor,
              }}
            >
              <div className="strike-hud-header">
                <span
                  className="strike-hud-dot"
                  style={{ background: strikeSettings.strikeColor }}
                />
                <span className="strike-hud-title">
                  COINBASE {strikeSettings.intervalMinutes}m STRIKE
                </span>
                {!hovered && (
                  <span className="strike-hud-timer" title="Time to interval expiry">
                    ⏱ {countdown}
                  </span>
                )}
              </div>
              <div className="strike-hud-values">
                <div className="strike-hud-price-col">
                  <span className="strike-hud-label">Strike</span>
                  <span className="strike-hud-price" style={{ color: strikeSettings.strikeColor }}>
                    ${formatPrice(strikeDisplay)}
                  </span>
                </div>
                <div className="strike-hud-divider" />
                <div className="strike-hud-status-col">
                  <span
                    className="strike-hud-status-tag"
                    style={{
                      color: isUp ? strikeSettings.upColor : strikeSettings.downColor,
                      background: isUp
                        ? `${strikeSettings.upColor}22`
                        : `${strikeSettings.downColor}22`,
                    }}
                  >
                    {isUp ? '▲ UP (WINNING)' : '▼ DOWN (WINNING)'}
                  </span>
                  <span
                    className="strike-hud-delta"
                    style={{ color: isUp ? strikeSettings.upColor : strikeSettings.downColor }}
                  >
                    {delta >= 0 ? '+' : ''}${formatPrice(Math.abs(delta), false)} (
                    {deltaPct >= 0 ? '+' : ''}
                    {deltaPct.toFixed(2)}%)
                  </span>
                </div>
              </div>
            </div>
          )
        })}
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
                        : indicator.kind === 'smart-money-concepts'
                          ? `${smcSettings(indicator).mode} · ${smcSettings(indicator).swingLength}`
                          : indicator.kind === 'sr-breaks-retests'
                            ? `${
                                (
                                  srOverlays.find((item) => item.indicator.id === indicator.id)
                                    ?.result.zones ?? []
                                ).filter((zone) => zone.boundary !== null).length
                              } zones`
                            : plotValue(group?.plots[0])}
                    </span>
                    {indicator.kind === 'sr-breaks-retests' && candles.length < SR_ATR_LENGTH && (
                      <span className="cm-indicator-notice" role="status">
                        ATR({SR_ATR_LENGTH}) warming up · {candles.length}/{SR_ATR_LENGTH} bars
                      </span>
                    )}
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
      {rsiIndicator && activeRsi !== null && (
        <div
          ref={rsiCardRef}
          className={`rsi-hud-card ${rsiZoneClass} ${rsiMinimized ? 'is-minimized' : ''} ${isDraggingRsi ? 'is-dragging' : ''}`}
          role="region"
          aria-label="RSI Meter"
          onPointerDown={handleRsiPointerDown}
          style={
            rsiPos
              ? { left: `${rsiPos.x}px`, top: `${rsiPos.y}px`, right: 'auto' }
              : { top: '34px', right: '10px' }
          }
        >
          <div className="rsi-hud-header">
            <div className="rsi-hud-title-row">
              <GripVertical size={11} className="rsi-hud-grip" aria-hidden="true" />
              <span className="rsi-hud-dot" />
              <span className="rsi-hud-title">RSI {rsiPeriod}</span>
              {hovered ? (
                <span className="rsi-hud-hover-tag">BAR</span>
              ) : (
                <span className="rsi-hud-live-tag">LIVE</span>
              )}
            </div>
            <button
              type="button"
              className="rsi-hud-min-btn"
              title={rsiMinimized ? 'Expand RSI Meter' : 'Minimize RSI Meter'}
              aria-label={rsiMinimized ? 'Expand RSI Meter' : 'Minimize RSI Meter'}
              onClick={() => setRsiMinimized((m) => !m)}
            >
              {rsiMinimized ? <Plus size={11} /> : <Minus size={11} />}
            </button>
          </div>

          <div className="rsi-hud-body">
            <div className="rsi-hud-value-row">
              <span className="rsi-hud-number">{activeRsi.toFixed(1)}</span>
              {rsiDelta !== null && (
                <span
                  className={`rsi-hud-delta ${rsiDelta >= 0 ? 'is-up' : 'is-down'}`}
                  title={`Change from previous bar: ${rsiDelta >= 0 ? '+' : ''}${rsiDelta.toFixed(2)}`}
                >
                  {rsiDelta >= 0 ? '+' : ''}
                  {rsiDelta.toFixed(1)} {rsiDelta >= 0 ? '▲' : '▼'}
                </span>
              )}
            </div>

            {!rsiMinimized && (
              <>
                <div className="rsi-hud-meter">
                  <div className="rsi-hud-meter-track">
                    <div
                      className="rsi-hud-meter-fill"
                      style={{ width: `${Math.min(100, Math.max(0, activeRsi))}%` }}
                    />
                    <div
                      className="rsi-hud-meter-needle"
                      style={{ left: `${Math.min(100, Math.max(0, activeRsi))}%` }}
                    />
                    <div
                      className="rsi-hud-meter-marker marker-30"
                      style={{ left: '30%' }}
                      title="Oversold (30)"
                    />
                    <div
                      className="rsi-hud-meter-marker marker-70"
                      style={{ left: '70%' }}
                      title="Overbought (70)"
                    />
                  </div>
                  <div className="rsi-hud-meter-labels">
                    <span>30 OS</span>
                    <span>50</span>
                    <span>70 OB</span>
                  </div>
                </div>

                <div className="rsi-hud-badge">
                  {activeRsi >= 70 ? (
                    <span className="rsi-badge-ob">🔥 OVERBOUGHT ({activeRsi.toFixed(1)})</span>
                  ) : activeRsi <= 30 ? (
                    <span className="rsi-badge-os">⚡ OVERSOLD ({activeRsi.toFixed(1)})</span>
                  ) : activeRsi >= 50 ? (
                    <span className="rsi-badge-bull">▲ BULLISH MOMENTUM</span>
                  ) : (
                    <span className="rsi-badge-bear">▼ BEARISH MOMENTUM</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
            {indicator.kind === 'smart-money-concepts' && smcNotice(indicator) && (
              <span className="cm-indicator-notice" role="status">
                {smcNotice(indicator)}
                {!replay && smcSettings(indicator).fvgTimeframe !== timeframe && (
                  <IconButton
                    icon={RotateCcw}
                    label="Retry Smart Money Concepts FVG timeframe data"
                    onClick={props.onIndicatorRetry}
                  />
                )}
              </span>
            )}
          </div>
        )
      })}
      <svg
        className="book-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="book-overlay"
        data-revision={revision}
      >
        {renderBookOverlay()}
      </svg>
      <svg
        ref={smcSvgRef}
        className="smc-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="smc-overlay"
        data-revision={revision}
      >
        {smcOverlays.map(renderSmcOverlay)}
      </svg>
      <svg
        ref={srSvgRef}
        className="sr-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="sr-overlay"
        data-revision={revision}
      >
        {srOverlays.map(renderSrOverlay)}
      </svg>
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
