import {
  calculateTrendPressure,
  trendPressureSettings,
  TREND_PRESSURE_DEFAULTS,
  trendPressurePlots,
} from '../lib/zeiierman-trend-pressure'
import { candleAutoscale } from '../lib/price-autoscale'
import { indicatorAutoscale } from '../lib/indicator-autoscale'
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
  CreatePriceLineOptions,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  Logical,
  MouseEventParams,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import {
  ChevronDown,
  ChevronUp,
  Eraser,
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
  TmoScalperSettings,
  Tool,
} from '../lib/types'
import type { OrderBookView, WhaleFlow } from '../../shared/coinbase'
import { scoreZone } from '../../shared/order-book'
import type { BookSide, BookStrengthBucket, ZoneBookScore } from '../../shared/order-book'
import { formatNotional, summarizeWhalePrints } from '../../shared/whale-flow'
import { builtInPlots, macdHistogram } from '../lib/indicators'
import { rsiMeterPeriod } from '../lib/rsi-hud'
import { calculateWaveTrend, waveTrendSettings, WAVE_TREND_DEFAULTS } from '../lib/wave-trend'
import {
  BAYESIAN_NQQE_DEFAULTS,
  bayesianNqqeSettings,
  calculateBayesianNqqeBankfunds,
} from '../lib/bayesian-nqqe-bankfunds'
import {
  calculateWilliamsVixFix,
  CM_WILLIAMS_VIX_FIX_DEFAULTS,
  williamsVixFixSettings,
} from '../lib/cm-williams-vix-fix'
import {
  calculateTmoScalper,
  TMO_SCALPER_DEFAULTS,
  tmoScalperFeeds,
  tmoScalperSettings,
} from '../lib/tmo-scalper'
import {
  bayesianNqqeHudModel,
  trendPressureHudModel,
  clampOscHudBars,
  cmMacdHudModel,
  oscHudBars,
  rsiDivergenceHudModel,
  tmoScalperHudModel,
  waveTrendHudModel,
  williamsVixFixHudModel,
} from '../lib/osc-hud'
import type { OscHudKind } from '../lib/osc-hud'
import { historyEnd, panHistory, windowHistory } from '../lib/history-pan'
import type { HistoryAnchor } from '../lib/history-pan'
import { RSI_DIVERGENCE_DEFAULTS } from '../lib/rsi-divergence'
import {
  calculateCmMacd,
  cmMacdResolution,
  cmMacdSettings,
  CM_MACD_DEFAULTS,
  indicatorLabel,
} from '../lib/cm-ult-macd'
import type { IndicatorTimeframes } from '../lib/cm-ult-macd'
import {
  detectMacdDivergences,
  divergenceEnabled,
  divergenceSettings,
} from '../lib/macd-divergence'
import type { Divergence } from '../lib/macd-divergence'
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
import {
  calculateCoinbaseStrike,
  coinbaseStrikePriceLevels,
  coinbaseStrikeSettings,
  resolveStrike,
} from '../lib/coinbase-strike'
import { useKalshiStrike } from '../lib/useKalshiStrike'
import {
  calculatePivotPointsMissedReversals,
  pivotPointsMissedReversalsSettings,
} from '../lib/pivot-points-missed-reversals'
import type { PivotColorRole } from '../lib/pivot-points-missed-reversals'
import { calculateScalpSwing, SCALPSWING_COLORS, scalpSwingSettings } from '../lib/scalpswing'
import { calculateTuxEmaScalper, tuxEmaScalperSettings } from '../lib/tux-ema-scalper'
import {
  CHILE_REVERSAL_COLORS,
  calculateChileReversal,
  chileMarkerExpiry,
  chileMarkerNowSeconds,
  chileReversalSettings,
  displayedChileSignals,
} from '../lib/chile-reversal'
import { calculateNextPivot, nextPivotSettings } from '../lib/next-pivot'
import { ta } from '../lib/indicator-runtime'
import { IndicatorPlotSeries, indicatorPlotData } from '../lib/indicator-plot-series'
import {
  compactNumber,
  formatPrice,
  pricePrecision,
  quoteCurrency,
  venueLabel,
  INTERVAL,
} from '../lib/market'
import { uid, useLocalState } from '../lib/storage'
import { ChartMessagePlate, ChartMessageText, SrBreakLabel } from './ChartMessage'
import { CoinIcon, IconButton } from './ui'
import { OscHudCard } from './OscHudCard'

export interface ChartHandle {
  fit: () => void
  zoom: (factor: number) => void
  zoomPrice: (factor: number) => void
  setRange: (bars: number) => void
  latest: () => void
  snapshot: () => Promise<Blob | null>
  /** The price range the scale currently shows (auto-fit or manual), for tests and HUDs. */
  priceRange: () => { from: number; to: number } | null
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
  /** Floating RSI meter. The toolbar button owns it; the RSI pane stays the indicator's job. */
  rsiHud?: boolean
  /**
   * Floating CM_Ult_MacD_MTF, WaveTrend, RSI Divergence and CM_Williams_Vix_Fix windows: the last
   * twenty minutes of each, zoomed to their own scale. Like the RSI meter, the toolbar buttons own
   * the windows and the indicators stay in the library — the windows only read the settings your
   * chart already carries.
   */
  cmMacdHud?: boolean
  waveTrendHud?: boolean
  rsiDivHud?: boolean
  vixFixHud?: boolean
  tmoScalperHud?: boolean
  bayesianNqqeHud?: boolean
  trendPressureHud?: boolean
  /** Closing a window from its own card is the same choice as its toolbar button. */
  onOscHudClose?: (kind: OscHudKind) => void
  /** Lets a window offer the pane whose settings it is borrowing. */
  onIndicatorAdd?: (kind: Indicator['kind']) => void
  /** Resting-liquidity depth view of the charted product; zone chips and walls need it. */
  book?: OrderBookView | null
  /** Exact executed-price map for the current Coinbase whale sweep, absent at rest/replay. */
  whale?: WhaleFlow | null
}
interface IndicatorSeries {
  series: ISeriesApi<SeriesType>[]
  pane: number
}
interface ManagedStrikePriceLine {
  series: ISeriesApi<SeriesType>
  line: IPriceLine
}
interface Geometry {
  width: number
  height: number
  paneTops: number[]
  paneHeights: number[]
  totalHeight: number
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
    whale,
  } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const smcSvgRef = useRef<SVGSVGElement>(null)
  const srSvgRef = useRef<SVGSVGElement>(null)
  const pivotSvgRef = useRef<SVGSVGElement>(null)
  const scalpswingSvgRef = useRef<SVGSVGElement>(null)
  const tuxEmaScalperSvgRef = useRef<SVGSVGElement>(null)
  const chileReversalSvgRef = useRef<SVGSVGElement>(null)
  const nextPivotSvgRef = useRef<SVGSVGElement>(null)
  const divSvgRef = useRef<SVGSVGElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const indicatorSeries = useRef<Map<string, IndicatorSeries>>(new Map())
  const strikePriceLinesRef = useRef<Map<string, ManagedStrikePriceLine>>(new Map())
  const whaleExecutionPriceLinesRef = useRef<Map<string, ManagedStrikePriceLine>>(new Map())
  const propsRef = useRef(props)
  propsRef.current = props
  const pendingRef = useRef<Anchor | null>(null)
  const [pending, setPending] = useState<Anchor | null>(null)
  const [preview, setPreview] = useState<Anchor | null>(null)
  const [hovered, setHovered] = useState<Candle | null>(null)
  const [geometry, setGeometry] = useState<Geometry>({
    width: 0,
    height: 0,
    paneTops: [],
    paneHeights: [],
    totalHeight: 0,
  })
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
  const pressureOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'zeiierman-trend-pressure')
        .map((indicator) => {
          const settings = trendPressureSettings(indicator)
          return {
            indicator,
            settings,
            values: calculateTrendPressure(candles, settings, asset.priceIncrement ?? 1e-8),
          }
        }),
    [candles, indicators, asset.priceIncrement],
  )
  const pivotOverlays = useMemo(
    () =>
      indicators
        .filter(
          (indicator) => indicator.visible && indicator.kind === 'pivot-points-missed-reversals',
        )
        .map((indicator) => {
          const settings = pivotPointsMissedReversalsSettings(indicator)
          return {
            indicator,
            settings,
            result: calculatePivotPointsMissedReversals(candles, settings),
          }
        }),
    [candles, indicators],
  )
  const strikeIndicatorActive = indicators.some(
    (indicator) => indicator.visible && indicator.kind === 'coinbase-strike',
  )
  /**
   * Kalshi's own published strike, fetched rather than re-derived. Disabled in demo
   * mode: a simulated chart has no real window for Kalshi to have published against,
   * and inventing one would present fiction as an authoritative number.
   *
   * Enabled for both live venues. On Kalshi ladders the strike is the window's opening
   * settlement value from the same ladder the candles come from, so it is exact by
   * construction rather than an estimate — the resolver labels it as Kalshi's either way.
   */
  const kalshi = useKalshiStrike({
    product: asset.symbol,
    enabled: props.source !== 'demo' && strikeIndicatorActive,
  })
  // A product switch can leave the previous pair's response in state for a frame; the
  // strike is only ever applied to the market it was actually published for.
  const kalshiPayload =
    kalshi.response && kalshi.response.product === asset.symbol ? kalshi.response : null
  const kalshiStrike = kalshiPayload?.strike ?? null
  const strikeOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'coinbase-strike')
        .map((indicator) => {
          const settings = coinbaseStrikeSettings(indicator)
          const result = calculateCoinbaseStrike(candles, settings)
          return {
            indicator,
            settings,
            result,
            resolved: resolveStrike(result, kalshiStrike, settings, candles, INTERVAL[timeframe]),
          }
        }),
    [candles, indicators, kalshiStrike, timeframe],
  )
  const scalpSwingOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'scalpswing')
        .map((indicator) => {
          const settings = scalpSwingSettings(indicator)
          return {
            indicator,
            settings,
            result: calculateScalpSwing(candles, settings),
          }
        }),
    [candles, indicators],
  )
  const tuxEmaScalperOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'tux-ema-scalper')
        .map((indicator) => {
          const settings = tuxEmaScalperSettings(indicator)
          return {
            indicator,
            settings,
            result: calculateTuxEmaScalper(candles, settings),
          }
        }),
    [candles, indicators],
  )
  const chileReversalOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'chile-reversal')
        .map((indicator) => {
          const settings = chileReversalSettings(indicator)
          return {
            indicator,
            settings,
            result: calculateChileReversal(candles, settings, {
              timeframe,
              timeframes: indicatorTimeframes,
              replay,
              // `barstate.isconfirmed`: on a live feed the newest bar has not closed yet, so it
              // must not print an ARRIBA/ABAJO label that the next tick could contradict.
              nowSeconds: Date.now() / 1000,
            }),
          }
        }),
    [candles, indicators, timeframe, indicatorTimeframes, replay],
  )
  /**
   * Clear-on-demand for Chile Reversal markers: per indicator, the print time
   * (a bar-close second) through which every marker was wiped by the legend's
   * eraser. Signals printed after it still render; the wiped ones never come
   * back, which is the point of cleaning the chart.
   */
  const [chileMarkerClears, setChileMarkerClears] = useState<Record<string, number>>({})
  /** Chart-bar seconds and the marker clock's "now" — see chileMarkerNowSeconds. */
  const chileBarSeconds = INTERVAL[timeframe]
  const chileNowSeconds = candles.length
    ? chileMarkerNowSeconds(Date.now() / 1000, candles[candles.length - 1].time, chileBarSeconds)
    : 0
  const clearChileMarkers = (indicatorId: string) => {
    if (!candles.length) return
    setChileMarkerClears((current) => ({
      ...current,
      // At least the newest bar's close, so a marker sitting on the forming
      // candle is wiped too, not just the already-closed history.
      [indicatorId]: Math.max(chileNowSeconds, candles[candles.length - 1].time + chileBarSeconds),
    }))
  }
  const nextPivotOverlays = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && indicator.kind === 'next-pivot')
        .map((indicator) => {
          const settings = nextPivotSettings(indicator)
          return {
            indicator,
            settings,
            result: calculateNextPivot(candles, settings, INTERVAL[timeframe]),
          }
        }),
    [candles, indicators, timeframe],
  )
  // The meter reads its period from the chart's RSI — visible or hidden — so the window and the
  // oscillator pane always talk about the same setting.
  const rsiPeriod = rsiMeterPeriod(indicators)
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
            indicator.kind === 'zeiierman-trend-pressure'
              ? trendPressurePlots(
                  pressureOverlays.find((overlay) => overlay.indicator.id === indicator.id)!.values,
                  trendPressureSettings(indicator),
                )
              : indicator.kind === 'custom'
                ? (customResults[indicator.id]?.plots ?? [])
                : builtInPlots(candles, indicator, {
                    timeframe,
                    timeframes: indicatorTimeframes,
                    replay,
                    realtimeFrom,
                    priceIncrement: asset.priceIncrement,
                  }),
        })),
    [
      candles,
      indicators,
      customResults,
      timeframe,
      indicatorTimeframes,
      replay,
      realtimeFrom,
      asset.priceIncrement,
      pressureOverlays,
    ],
  )
  const generatedRef = useRef(generated)
  generatedRef.current = generated
  const macdDivergences = useMemo(
    () =>
      indicators
        .filter((indicator) => indicator.visible && divergenceEnabled(indicator))
        .map((indicator) => {
          const settings = divergenceSettings(indicator)
          const histogram =
            indicator.kind === 'rsi-divergence'
              ? ta.rsi(
                  candles.map((c) => c.close),
                  indicator.period || 14,
                )
              : (macdHistogram(candles, indicator, {
                  timeframe,
                  timeframes: indicatorTimeframes,
                  replay,
                  realtimeFrom,
                }) ?? [])
          return {
            indicator,
            settings,
            histogram,
            divergences: detectMacdDivergences(candles, histogram, settings),
          }
        }),
    [candles, indicators, timeframe, indicatorTimeframes, replay, realtimeFrom],
  )
  const structure = generated
    .map(
      (g) =>
        `${g.indicator.id}:${g.plots.map((p) => `${p.pane}:${p.style ?? 'line'}:${p.horizontalLine ?? ''}`).join(',')}`,
    )
    .join(';')
  const visibleVolume = indicators.some((i) => i.kind === 'volume' && i.visible)

  /** Manual price zoom must not be overwritten by the auto-scale setting until reset. */
  const pricePinnedRef = useRef(false)
  const zoom = (factor: number) => {
    const scale = chartRef.current?.timeScale(),
      range = scale?.getVisibleLogicalRange()
    if (scale && range) {
      const center = (range.from + range.to) / 2
      const length = Math.max(8, propsRef.current.candles.length)
      // Allow seeing the whole tape; minBarSpacing (not this cap) is what used
      // to stop zoom-out after a handful of clicks.
      const half = Math.min(length, Math.max(8, ((range.to - range.from) * factor) / 2))
      scale.setVisibleLogicalRange({ from: center - half, to: center + half })
    }
  }
  /**
   * Vertical zoom of the price scale: factor < 1 grows the candles (narrower
   * price range around its center). Time zoom alone cannot reveal candle bodies
   * when the visible price range is wide, so the chart controls need both.
   * Manual scaling wins over auto-fit until the user resets the view.
   */
  const zoomPrice = (factor: number) => {
    const scale = mainRef.current?.priceScale(),
      range = scale?.getVisibleRange()
    if (scale && range) {
      const center = (range.from + range.to) / 2,
        half = Math.max(1e-8, ((range.to - range.from) * factor) / 2)
      pricePinnedRef.current = true
      scale.applyOptions({ autoScale: false })
      scale.setVisibleRange({ from: center - half, to: center + half })
    }
  }
  // Recovery is chart-wide: an axis drag can pin an oscillator independently
  // of the candle pane. Time zoom alone cannot undo either manual price range.
  const resetPriceScales = () => {
    pricePinnedRef.current = false
    chartRef.current?.panes().forEach((pane) => {
      pane.priceScale('right').applyOptions({ autoScale: true })
    })
  }
  const latest = () => {
    const length = propsRef.current.candles.length
    chartRef.current
      ?.timeScale()
      .setVisibleLogicalRange({ from: Math.max(0, length - 145), to: length + 8 })
    resetPriceScales()
  }
  useImperativeHandle(ref, () => ({
    fit: () => {
      chartRef.current?.timeScale().fitContent()
      resetPriceScales()
    },
    zoom,
    zoomPrice,
    setRange: (bars: number) => {
      const length = propsRef.current.candles.length
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(-1, length - bars),
        to: length + Math.min(8, bars * 0.06),
      })
    },
    latest,
    priceRange: () => mainRef.current?.priceScale().getVisibleRange() ?? null,
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
        `${propsRef.current.asset.name} / ${quoteCurrency(propsRef.current.asset)} · ${propsRef.current.timeframe} · ${propsRef.current.source === 'demo' ? 'DEMO DATA' : venueLabel(propsRef.current.source).toUpperCase() + ' / ' + propsRef.current.feedState.toUpperCase()}`,
        104,
        27,
        Math.max(90, width - 120),
      )
      ctx.fillStyle = '#777f8d'
      ctx.font = '10px "DM Sans", sans-serif'
      ctx.fillText(
        propsRef.current.source === 'demo'
          ? 'Illustrative market data. Not investment advice.'
          : propsRef.current.source === 'kalshi'
            ? 'Kalshi settlement values for the precious metals, quarter-hour resolution. Not investment advice.'
            : 'Coinbase market data. Current candles provisional. Not investment advice.',
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
      await paintSvg(pivotSvgRef.current)
      await paintSvg(scalpswingSvgRef.current)
      await paintSvg(tuxEmaScalperSvgRef.current)
      await paintSvg(chileReversalSvgRef.current)
      await paintSvg(nextPivotSvgRef.current)
      await paintSvg(divSvgRef.current)
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
        minBarSpacing: 0.2,
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
    // Replacing the main series can briefly leave pane 0 empty. Without this,
    // LWC removes it and shifts the first oscillator into the price pane before
    // the replacement is added, merging (e.g.) MACD's zero with BTC's price range.
    // Only preserve the price pane; empty oscillator panes should still disappear.
    chart.panes()[0].setPreserveEmptyPane(true)
    chartRef.current = chart
    const currentIndicatorSeries = indicatorSeries.current
    const currentStrikePriceLines = strikePriceLinesRef.current
    const currentWhaleExecutionPriceLines = whaleExecutionPriceLinesRef.current
    let raf = 0
    const refresh = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const panes = chart.panes()
        let top = 0
        const paneHeights = panes.map((pane) => pane.getHeight())
        const paneTops = panes.map((pane) => {
          const current = top
          top += pane.getHeight() + 1
          return current
        })
        const next = {
          width: chart.timeScale().width(),
          height: panes[0]?.getHeight() ?? 0,
          paneTops,
          paneHeights,
          totalHeight: top,
        }
        setGeometry((previous) =>
          previous.width === next.width &&
          previous.height === next.height &&
          previous.totalHeight === next.totalHeight &&
          previous.paneTops.length === next.paneTops.length &&
          previous.paneTops.every((top, i) => top === next.paneTops[i]) &&
          previous.paneHeights.every((h, i) => h === next.paneHeights[i])
            ? previous
            : next,
        )
        if (
          propsRef.current.drawings.length ||
          pendingRef.current ||
          propsRef.current.indicators.some(
            (indicator) =>
              (indicator.visible && indicator.kind === 'zeiierman-trend-pressure') ||
              (indicator.visible && indicator.kind === 'smart-money-concepts') ||
              (indicator.visible && indicator.kind === 'sr-breaks-retests') ||
              (indicator.visible && indicator.kind === 'pivot-points-missed-reversals') ||
              (indicator.visible && indicator.kind === 'scalpswing') ||
              (indicator.visible && indicator.kind === 'tux-ema-scalper') ||
              (indicator.visible && indicator.kind === 'chile-reversal') ||
              (indicator.visible && indicator.kind === 'next-pivot') ||
              (indicator.visible && divergenceEnabled(indicator)),
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
      currentStrikePriceLines.clear()
      currentWhaleExecutionPriceLines.clear()
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (mainRef.current) {
      strikePriceLinesRef.current.clear()
      whaleExecutionPriceLinesRef.current.clear()
      chart.removeSeries(mainRef.current)
    }
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
      // Outlier-resistant fit: one glitch print in a wick must not flatten the
      // candles (see price-autoscale). Applies to every auto-fit of the pane.
      // Line/area draw closes only, so they keep the native close-based range.
      autoscaleInfoProvider: candleAutoscale(
        () => propsRef.current.candles,
        () => chartRef.current?.timeScale().getVisibleLogicalRange() ?? null,
        chartType === 'candles' || chartType === 'hollow' || chartType === 'bars',
      ),
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
          autoscaleInfoProvider: indicatorAutoscale(pane, rsi),
          priceFormat: { type: 'price' as const, precision: 2, minMove: 0.01 },
        }
        // Every non-line Pine style is drawn by the native renderer so that
        // histogram widths, marker coordinates and area fills stay in chart space.
        const style = plot.style ?? 'line'
        const line = (
          style !== 'line'
            ? chart.addCustomSeries(
                new IndicatorPlotSeries(style),
                { ...base, transp: plot.transp ?? 0, baseValue: plot.histbase ?? 0 },
                pane,
              )
            : chart.addSeries(
                LineSeries,
                {
                  ...base,
                  lineVisible: plot.horizontalLine === undefined,
                },
                pane,
              )
        ) as ISeriesApi<SeriesType>
        if (plot.horizontalLine !== undefined)
          line.createPriceLine({
            price: plot.horizontalLine,
            color: plot.color,
            lineWidth: plot.lineWidth as 1 | 2 | 3 | 4,
            lineStyle: plot.dashed ? LineStyle.Dashed : LineStyle.Solid,
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
        autoScale: pricePinnedRef.current ? false : settings.autoScale,
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

  useEffect(() => {
    const series = mainRef.current
    if (!series) return

    const activeKeys = new Set<string>()
    for (const { indicator, settings: strikeSettings, result, resolved } of strikeOverlays) {
      for (const level of coinbaseStrikePriceLevels(result, strikeSettings, resolved)) {
        const key = `${indicator.id}:${level.role}`
        activeKeys.add(key)
        const options: CreatePriceLineOptions = {
          id: `coinbase-strike:${key}`,
          price: level.price,
          color: level.color,
          lineWidth: level.role === 'strike' ? 2 : 1,
          lineStyle: level.role === 'strike' ? LineStyle.Dotted : LineStyle.Dashed,
          lineVisible: true,
          axisLabelVisible: level.axisLabelVisible,
          axisLabelColor: level.color,
          title: level.title,
        }
        const managed = strikePriceLinesRef.current.get(key)
        if (managed?.series === series) managed.line.applyOptions(options)
        else {
          strikePriceLinesRef.current.set(key, {
            series,
            line: series.createPriceLine(options),
          })
        }
      }
    }

    for (const [key, managed] of strikePriceLinesRef.current) {
      if (activeKeys.has(key) && managed.series === series) continue
      if (managed.series === series) series.removePriceLine(managed.line)
      strikePriceLinesRef.current.delete(key)
    }
  }, [asset.priceIncrement, asset.symbol, chartType, strikeOverlays])

  /**
   * Executed-price map for the live whale sweep. The line is deliberately separate from the
   * level2 overlay: a match is where money actually traded, while a book wall is only an order
   * that is still waiting. The map disappears with the ephemeral flow or during replay.
   */
  useEffect(() => {
    const series = mainRef.current
    if (!series) return
    const activeKeys = new Set<string>()
    const removeInactive = () => {
      for (const [key, managed] of whaleExecutionPriceLinesRef.current) {
        if (activeKeys.has(key) && managed.series === series) continue
        if (managed.series === series) series.removePriceLine(managed.line)
        whaleExecutionPriceLinesRef.current.delete(key)
      }
    }
    if (!whale || replay || props.source !== 'coinbase') {
      removeInactive()
      return
    }
    const fromPayload =
      Number.isFinite(whale.executionVwap) &&
      Number.isFinite(whale.executionLow) &&
      Number.isFinite(whale.executionHigh)
        ? {
            vwap: whale.executionVwap!,
            low: whale.executionLow!,
            high: whale.executionHigh!,
          }
        : summarizeWhalePrints(whale.prints)
    if (!fromPayload) {
      removeInactive()
      return
    }
    const direction = whale.net > 0 ? 'BUY' : whale.net < 0 ? 'SELL' : 'MIXED'
    const color = whale.net > 0 ? '#2ebd85' : whale.net < 0 ? '#f6465d' : '#9aa4b2'
    const addLine = (key: string, price: number, options: Partial<CreatePriceLineOptions>) => {
      if (!Number.isFinite(price) || price <= 0) return
      activeKeys.add(key)
      const lineOptions: CreatePriceLineOptions = {
        id: `whale-execution:${key}`,
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        lineVisible: true,
        axisLabelVisible: false,
        ...options,
      }
      const managed = whaleExecutionPriceLinesRef.current.get(key)
      if (managed?.series === series) managed.line.applyOptions(lineOptions)
      else
        whaleExecutionPriceLinesRef.current.set(key, {
          series,
          line: series.createPriceLine(lineOptions),
        })
    }
    addLine('vwap', fromPayload.vwap, {
      color,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      axisLabelColor: color,
      title: `Whale ${direction} VWAP`,
    })
    if (fromPayload.high > fromPayload.low) {
      addLine('low', fromPayload.low, { title: `Whale ${direction} low` })
      addLine('high', fromPayload.high, { title: `Whale ${direction} high` })
    }
    // Keep a few exact match prices on the scale as faint dotted guides. The box carries the
    // complete map's VWAP/range, while these guides let a trader see where the largest recent
    // fills landed without turning a five-second burst into permanent chart clutter.
    const prices = new Set<number>()
    for (const print of whale.prints.slice(0, 6)) {
      if (prices.has(print.price)) continue
      prices.add(print.price)
      addLine(`print:${print.price}`, print.price, {
        lineStyle: LineStyle.Dotted,
        title: `Whale ${print.side === 'buy' ? 'buy' : 'sell'} fill`,
      })
    }
    removeInactive()
  }, [whale, replay, props.source, asset.symbol, chartType, asset.priceIncrement])

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
  // Kalshi rounds gold to 2 decimals and silver to 3; showing 63.50 for a published
  // 63.498 would hide the digit the contract actually settles on.
  const priceDigits = pricePrecision(asset.symbol)
  const plotValue = (plot?: Plot) => {
    const value = plot?.values[hoverIndex]
    return value === null || value === undefined ? '—' : formatPrice(value, false, priceDigits)
  }
  /**
   * One honest sentence about why a TMO wheel is missing: the feed it aggregates from is
   * down, still loading, or shorter than the chart (the Kalshi metals publish nothing below
   * fifteen minutes, and the sub-daily wheels simply have no source there).
   */
  const tmoNotice = (settings: TmoScalperSettings) => {
    for (const feed of tmoScalperFeeds(settings)) {
      if (feed === timeframe) continue
      const data = indicatorTimeframes[feed]
      if (data && ['offline', 'stale', 'reconnecting', 'loading'].includes(data.state))
        return `${feed} feed ${data.state} · ${data.message}`
      if (!data?.candles.length)
        return replay
          ? `No ${feed} history in this replay snapshot. Exit replay to load it.`
          : `Loading ${feed} source candles…`
      if (data.candles[0]!.time > candles[0]?.time)
        return `${feed} history limited to ${data.candles.length} source candles; earlier bars unavailable.`
    }
    return ''
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
  // The floating oscillator windows. They are views, not second opinions: each reads the
  // chart's own indicator (a hidden one included, so a pane you switched off still sets the
  // lengths) and falls back to the published defaults when the chart carries none, then draws the
  // last twenty minutes of those values at their own scale.
  const pressureHudIndicator =
    indicators.find((indicator) => indicator.kind === 'zeiierman-trend-pressure') ?? null
  const pressureHudSettings = useMemo(
    () =>
      pressureHudIndicator ? trendPressureSettings(pressureHudIndicator) : TREND_PRESSURE_DEFAULTS,
    [pressureHudIndicator],
  )
  const cmHudIndicator = indicators.find((indicator) => indicator.kind === 'cm-ult-macd') ?? null
  const waveHudIndicator = indicators.find((indicator) => indicator.kind === 'wave-trend') ?? null
  const vixFixHudIndicator =
    indicators.find((indicator) => indicator.kind === 'cm-williams-vix-fix') ?? null
  const tmoHudIndicator = indicators.find((indicator) => indicator.kind === 'tmo-scalper') ?? null
  const bayesHudIndicator =
    indicators.find((indicator) => indicator.kind === 'bayesian-nqqe-bankfunds') ?? null
  const cmHudSettings = useMemo(
    () => (cmHudIndicator ? cmMacdSettings(cmHudIndicator) : CM_MACD_DEFAULTS),
    [cmHudIndicator],
  )
  const waveHudSettings = useMemo(
    () => (waveHudIndicator ? waveTrendSettings(waveHudIndicator) : WAVE_TREND_DEFAULTS),
    [waveHudIndicator],
  )
  const vixFixHudSettings = useMemo(
    () =>
      vixFixHudIndicator
        ? williamsVixFixSettings(vixFixHudIndicator)
        : CM_WILLIAMS_VIX_FIX_DEFAULTS,
    [vixFixHudIndicator],
  )
  const tmoHudSettings = useMemo(
    () => (tmoHudIndicator ? tmoScalperSettings(tmoHudIndicator) : TMO_SCALPER_DEFAULTS),
    [tmoHudIndicator],
  )
  const bayesHudSettings = useMemo(
    () => (bayesHudIndicator ? bayesianNqqeSettings(bayesHudIndicator) : BAYESIAN_NQQE_DEFAULTS),
    [bayesHudIndicator],
  )
  const candleTimes = useMemo(() => candles.map((candle) => candle.time), [candles])
  // Zoom is a per-window preference: the default is twenty minutes of the chart's own bars, and
  // ±4 bars is enough of a step that you can widen for a wave or tighten for the last few ticks.
  const [oscHudBarsOverride, setOscHudBarsOverride] = useLocalState<
    Partial<Record<OscHudKind, number>>
  >('osc-hud-bars', {})
  const pressureHudBars = oscHudBars(timeframe, oscHudBarsOverride['zeiierman-trend-pressure'])
  const cmHudBars = oscHudBars(timeframe, oscHudBarsOverride['cm-ult-macd'])
  const waveHudBars = oscHudBars(timeframe, oscHudBarsOverride['wave-trend'])
  const vixFixHudBars = oscHudBars(timeframe, oscHudBarsOverride['cm-williams-vix-fix'])
  const tmoHudBars = oscHudBars(timeframe, oscHudBarsOverride['tmo-scalper'])
  const bayesHudBars = oscHudBars(timeframe, oscHudBarsOverride['bayesian-nqqe-bankfunds'])
  const zoomOscHud = (kind: OscHudKind, delta: number) =>
    setOscHudBarsOverride((previous) => ({
      ...previous,
      [kind]: clampOscHudBars(oscHudBars(timeframe, previous[kind]) + delta, timeframe),
    }))
  // Scrolling back through history is a look, not a preference: each window keeps the time of its
  // newest bar while you study it, and a reload opens every window on live candles again.
  const [oscHudAnchors, setOscHudAnchors] = useState<Partial<Record<OscHudKind, HistoryAnchor>>>({})
  const oscHudEnd = (kind: OscHudKind, bars: number) =>
    historyEnd(candleTimes, oscHudAnchors[kind] ?? null, bars)
  const panOscHud = (kind: OscHudKind, bars: number, delta: number | 'live') =>
    setOscHudAnchors((previous) => ({
      ...previous,
      [kind]:
        delta === 'live' ? null : panHistory(candleTimes, previous[kind] ?? null, bars, delta),
    }))
  // Off the crosshair, each model reads its window's own newest bar (`end - 1`) — the live one, or
  // the last bar in view once it has been scrolled back — so the numbers speak about a bar you see.
  const pressureHudEnd = oscHudEnd('zeiierman-trend-pressure', pressureHudBars)
  const cmHudEnd = oscHudEnd('cm-ult-macd', cmHudBars)
  const waveHudEnd = oscHudEnd('wave-trend', waveHudBars)
  const vixFixHudEnd = oscHudEnd('cm-williams-vix-fix', vixFixHudBars)
  const tmoHudEnd = oscHudEnd('tmo-scalper', tmoHudBars)
  const bayesHudEnd = oscHudEnd('bayesian-nqqe-bankfunds', bayesHudBars)
  // An alt-timeframe MACD with no source candles has nothing honest to draw; say so with the same
  // words the pane uses rather than showing an empty box.
  const cmHudNotice = props.cmMacdHud && cmHudIndicator ? cmNotice(cmHudIndicator) : ''
  const pressureHudModel = useMemo(
    () =>
      props.trendPressureHud
        ? trendPressureHudModel(
            pressureOverlays.find((overlay) => overlay.indicator.id === pressureHudIndicator?.id)
              ?.values ??
              calculateTrendPressure(candles, pressureHudSettings, asset.priceIncrement),
            pressureHudSettings,
            {
              times: candleTimes,
              timeframe,
              bars: pressureHudBars,
              end: pressureHudEnd,
              index: hovered ? hoverIndex : pressureHudEnd - 1,
              hovered: hovered !== null,
              settingsSource: pressureHudIndicator ? 'chart' : 'defaults',
            },
          )
        : null,
    [
      props.trendPressureHud,
      candles,
      pressureHudSettings,
      asset.priceIncrement,
      candleTimes,
      timeframe,
      pressureHudBars,
      pressureHudEnd,
      hoverIndex,
      hovered,
      pressureHudIndicator,
      pressureOverlays,
    ],
  )
  const cmHudModel = useMemo(
    () =>
      props.cmMacdHud
        ? cmMacdHudModel(
            calculateCmMacd(candles, cmHudSettings, {
              timeframe,
              timeframes: indicatorTimeframes,
              replay,
              realtimeFrom,
            }),
            cmHudSettings,
            {
              times: candleTimes,
              timeframe,
              bars: cmHudBars,
              end: cmHudEnd,
              index: hovered ? hoverIndex : cmHudEnd - 1,
              hovered: hovered !== null,
              note: cmHudNotice,
              settingsSource: cmHudIndicator ? 'chart' : 'defaults',
            },
          )
        : null,
    [
      props.cmMacdHud,
      candles,
      cmHudSettings,
      timeframe,
      indicatorTimeframes,
      replay,
      realtimeFrom,
      candleTimes,
      cmHudBars,
      cmHudEnd,
      hoverIndex,
      hovered,
      cmHudIndicator,
      cmHudNotice,
    ],
  )
  const waveHudModel = useMemo(
    () =>
      props.waveTrendHud
        ? waveTrendHudModel(calculateWaveTrend(candles, waveHudSettings), waveHudSettings, {
            times: candleTimes,
            timeframe,
            bars: waveHudBars,
            end: waveHudEnd,
            index: hovered ? hoverIndex : waveHudEnd - 1,
            hovered: hovered !== null,
            settingsSource: waveHudIndicator ? 'chart' : 'defaults',
          })
        : null,
    [
      props.waveTrendHud,
      candles,
      waveHudSettings,
      candleTimes,
      timeframe,
      waveHudBars,
      waveHudEnd,
      hoverIndex,
      hovered,
      waveHudIndicator,
    ],
  )
  const rsiDivHudIndicator =
    indicators.find((indicator) => indicator.kind === 'rsi-divergence') ?? null
  const rsiDivHudSettings = useMemo(
    () => ({
      period: rsiDivHudIndicator?.period ?? RSI_DIVERGENCE_DEFAULTS.period,
      divergence: rsiDivHudIndicator
        ? divergenceSettings(rsiDivHudIndicator)
        : { ...RSI_DIVERGENCE_DEFAULTS.divergence },
    }),
    [rsiDivHudIndicator],
  )
  const vixFixHudModel = useMemo(
    () =>
      props.vixFixHud
        ? williamsVixFixHudModel(
            calculateWilliamsVixFix(candles, vixFixHudSettings),
            vixFixHudSettings,
            {
              times: candleTimes,
              timeframe,
              bars: vixFixHudBars,
              end: vixFixHudEnd,
              index: hovered ? hoverIndex : vixFixHudEnd - 1,
              hovered: hovered !== null,
              settingsSource: vixFixHudIndicator ? 'chart' : 'defaults',
            },
          )
        : null,
    [
      props.vixFixHud,
      candles,
      vixFixHudSettings,
      candleTimes,
      timeframe,
      vixFixHudBars,
      vixFixHudEnd,
      hoverIndex,
      hovered,
      vixFixHudIndicator,
    ],
  )
  const rsiDivHudBars = oscHudBars(timeframe, oscHudBarsOverride['rsi-divergence'])
  const rsiDivHudEnd = oscHudEnd('rsi-divergence', rsiDivHudBars)
  // The TMO window reads the pane's own wheels: the same settings, the same feeds, the same
  // gated crosses — the note names the missing feed instead of drawing a guessed wheel.
  const tmoHudNotice = props.tmoScalperHud ? tmoNotice(tmoHudSettings) : ''
  const tmoHudModel = useMemo(
    () =>
      props.tmoScalperHud
        ? tmoScalperHudModel(
            calculateTmoScalper(candles, tmoHudSettings, {
              timeframe,
              timeframes: indicatorTimeframes,
              replay,
            }),
            tmoHudSettings,
            {
              times: candleTimes,
              timeframe,
              bars: tmoHudBars,
              end: tmoHudEnd,
              index: hovered ? hoverIndex : tmoHudEnd - 1,
              hovered: hovered !== null,
              note: tmoHudNotice,
              settingsSource: tmoHudIndicator ? 'chart' : 'defaults',
            },
          )
        : null,
    [
      props.tmoScalperHud,
      candles,
      tmoHudSettings,
      timeframe,
      indicatorTimeframes,
      replay,
      candleTimes,
      tmoHudBars,
      tmoHudEnd,
      hoverIndex,
      hovered,
      tmoHudNotice,
      tmoHudIndicator,
    ],
  )
  const bayesHudModel = useMemo(
    () =>
      props.bayesianNqqeHud
        ? bayesianNqqeHudModel(
            calculateBayesianNqqeBankfunds(candles, bayesHudSettings),
            bayesHudSettings,
            {
              times: candleTimes,
              timeframe,
              bars: bayesHudBars,
              end: bayesHudEnd,
              index: hovered ? hoverIndex : bayesHudEnd - 1,
              hovered: hovered !== null,
              settingsSource: bayesHudIndicator ? 'chart' : 'defaults',
            },
          )
        : null,
    [
      props.bayesianNqqeHud,
      candles,
      bayesHudSettings,
      candleTimes,
      timeframe,
      bayesHudBars,
      bayesHudEnd,
      hoverIndex,
      hovered,
      bayesHudIndicator,
    ],
  )
  const rsiDivHudModel = useMemo(
    () =>
      props.rsiDivHud
        ? rsiDivergenceHudModel(candles, rsiDivHudSettings, {
            times: candleTimes,
            timeframe,
            bars: rsiDivHudBars,
            end: rsiDivHudEnd,
            index: hovered ? hoverIndex : rsiDivHudEnd - 1,
            hovered: hovered !== null,
            settingsSource: rsiDivHudIndicator ? 'chart' : 'defaults',
          })
        : null,
    [
      props.rsiDivHud,
      candles,
      rsiDivHudSettings,
      candleTimes,
      timeframe,
      rsiDivHudBars,
      rsiDivHudEnd,
      hoverIndex,
      hovered,
      rsiDivHudIndicator,
    ],
  )
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
          <ChartMessagePlate
            x={8}
            y={start.y - 20}
            width={100}
            height={18}
            color={color}
            testId="drawing-price-tag"
          />
          <ChartMessageText
            x={15}
            y={start.y - 7}
            color={color}
            fontFamily="JetBrains Mono, monospace"
          >
            {formatPrice(drawing.start.price)}
          </ChartMessageText>
        </g>
      )
    if (drawing.tool === 'text')
      return (
        <g key={drawing.id}>
          <ChartMessagePlate
            x={start.x - 6}
            y={start.y - 19}
            width={Math.min(400, (drawing.text?.length ?? 4) * 7 + 14)}
            height={27}
            rx={4}
            color={color}
            strokeOpacity={0.45}
            testId="drawing-text-plate"
          />
          <ChartMessageText x={start.x + 1} y={start.y - 1} color={color} size={12}>
            {drawing.text}
          </ChartMessageText>
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
                <ChartMessageText
                  x={Math.min(start.x, end.x) + 5}
                  y={y - 4}
                  color={colors[i]}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {ratio.toFixed(3)} (
                  {formatPrice(
                    drawing.start.price + (drawing.end!.price - drawing.start.price) * ratio,
                  )}
                  )
                </ChartMessageText>
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
            <ChartMessagePlate
              x={(start.x + end.x) / 2 - 69}
              y={Math.min(start.y, end.y) - 32}
              width={138}
              height={24}
              rx={4}
              color="#8b9bb2"
              testId="drawing-measure-plate"
            />
            <ChartMessageText
              x={(start.x + end.x) / 2}
              y={Math.min(start.y, end.y) - 16}
              color="#dbe5f7"
              anchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              {change >= 0 ? '+' : ''}
              {change.toFixed(2)}% ·{' '}
              {Math.round(Math.abs(drawing.end!.time - drawing.start.time) / INTERVAL[timeframe])}{' '}
              bars
            </ChartMessageText>
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
      const strength = bookStrength(
        block.top,
        block.bottom,
        block.side === 'bullish' ? 'bid' : 'ask',
      )
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
          <ChartMessageText
            x={x + 4}
            y={Math.min(y + 11, geometry.height - 3)}
            color={color}
            size={8}
            weight={600}
          >
            {block.kind === 'internal' ? 'iOB' : 'OB'} {block.side === 'bullish' ? '+' : '−'}
            {mitigated ? ' · mitigated' : ''}
          </ChartMessageText>
          {chip && strength && (
            <ChartMessageText
              x={x + 4}
              y={Math.min(y + 21, geometry.height - 3)}
              color={BUCKET_FILL[strength.bucket]}
              size={7}
              weight={700}
              fontFamily="JetBrains Mono, monospace"
              testId="book-zone-chip"
            >
              {chip}
            </ChartMessageText>
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
          <ChartMessageText
            x={x + 3}
            y={Math.min(y + 10, geometry.height - 3)}
            color={color}
            size={7}
            weight={600}
          >
            FVG
          </ChartMessageText>
          {chip && strength && (
            <ChartMessageText
              x={x + 3}
              y={Math.min(y + 20, geometry.height - 3)}
              color={BUCKET_FILL[strength.bucket]}
              size={7}
              weight={700}
              fontFamily="JetBrains Mono, monospace"
              testId="book-zone-chip"
            >
              {chip}
            </ChartMessageText>
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
          <ChartMessageText x={highEnd.x - 2} y={highEnd.y - 4} anchor="end" color={color} size={7}>
            P{level.timeframe}H
          </ChartMessageText>
          <ChartMessageText x={lowEnd.x - 2} y={lowEnd.y + 9} anchor="end" color={color} size={7}>
            P{level.timeframe}L
          </ChartMessageText>
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
            <ChartMessageText
              x={end.x - 3}
              y={below ? end.y + 10 : end.y - 4}
              anchor="end"
              color={color}
              size={8}
              weight={600}
            >
              {label}
            </ChartMessageText>
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
                <ChartMessageText
                  x={x + width / 2}
                  y={y + Math.min(height / 2 + 3, 10)}
                  anchor="middle"
                  color={zone.color}
                  opacity={0.82}
                  size={7}
                  weight={600}
                >
                  {zone.label}
                </ChartMessageText>
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
      const hint = wall.depth > 0 ? ` · in front ${formatNotional(wall.depth)}` : ''
      return (
        <g
          key={`book-wall:${wall.side}:${wall.price}`}
          className="book-wall"
          data-testid="book-wall"
        >
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
          <ChartMessageText
            x={5}
            y={Math.max(9, y - 5)}
            color={color}
            size={8}
            weight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            {label}
            {hint}
          </ChartMessageText>
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
            <ChartMessageText
              x={x + 4}
              y={y + 9}
              color={BUCKET_FILL[strength.bucket]}
              size={7}
              weight={700}
              fontFamily="JetBrains Mono, monospace"
              testId="book-zone-chip"
            >
              {chip}
            </ChartMessageText>
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
      // Transparent by contract: the published color outlines the label and tints
      // the glyphs, but no plate is filled over the candles.
      const textColor =
        label.kind === 'break-support'
          ? SR_BREAKS_RETESTS_COLORS.breakSupportText
          : SR_BREAKS_RETESTS_COLORS.breakResistanceText
      return (
        <SrBreakLabel
          key={`sr-label:${label.kind}:${label.index}`}
          kind={label.kind}
          anchor={anchor}
          color={label.color}
          textColor={textColor}
        />
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

  // Pivot Points High Low & Missed Reversal Levels: Pine labels (▼ ▲ 👻),
  // zig-zag lines and ghost levels, drawn as a native SVG overlay.
  const pivotLegendValue = (result?: (typeof pivotOverlays)[number]['result']) => {
    if (!result) return '—'
    const missed = result.labels.filter(
      (label) => !label.estimate && label.kind.startsWith('missed'),
    ).length
    const regular = result.labels.filter((label) => label.kind.startsWith('regular')).length
    return `${regular} pivots · ${missed} missed`
  }
  const renderPressureOverlay = (overlay: (typeof pressureOverlays)[number]) => {
    const { indicator, settings, values } = overlay
    if (!settings.priceBoxes) return null
    const point = (index: number, price: number) =>
      candles[index] ? position({ time: candles[index].time, price }) : null
    const boxes = values.boxes.map((box, i) => {
      const left = point(Math.max(0, box.start - 1), box.top),
        right = point(box.end, box.bottom)
      const top = point(box.start, box.top)
      if (!left || !right || !top) return null
      const color = box.side === 'upper' ? settings.hot : settings.cold
      return (
        <rect
          key={i}
          data-testid="pressure-price-box"
          x={Math.min(left.x, right.x)}
          y={top.y}
          width={Math.max(1, Math.abs(right.x - left.x))}
          height={Math.max(1, right.y - top.y)}
          fill={color}
          fillOpacity={0.2}
          stroke={color}
          strokeOpacity={0.4}
        />
      )
    })
    const releases = candles.map((_, i) => {
      if (!values.upperRelease[i] && !values.lowerRelease[i]) return null
      const side = values.upperRelease[i] ? 'upper' : 'lower'
      const price = side === 'upper' ? values.upperReleasePrice[i] : values.lowerReleasePrice[i]
      if (price === null) return null
      const xy = point(i, price)
      if (!xy) return null
      const color = side === 'upper' ? settings.hot : settings.cold
      return (
        <path
          key={`release-${i}`}
          data-testid="pressure-release-price"
          d={
            side === 'upper'
              ? `M ${xy.x} ${xy.y + 5} l -5 -8 h 10 Z`
              : `M ${xy.x} ${xy.y - 5} l -5 8 h 10 Z`
          }
          fill={color}
        />
      )
    })
    return (
      <g key={indicator.id}>
        {boxes}
        {releases}
      </g>
    )
  }
  const renderPressureGradient = (overlay: (typeof pressureOverlays)[number], index: number) => {
    const { indicator, settings, values } = overlay
    if (!settings.gradientFill) return null
    const entry = indicatorSeries.current.get(indicator.id)
    const series = entry?.series[0]
    const scale = chartRef.current?.timeScale()
    if (!entry?.pane || !series || !scale) return null
    const top = geometry.paneTops[entry.pane] ?? 0
    const height = geometry.paneHeights[entry.pane] ?? 0
    const y = (v: number) => top + Number(series.priceToCoordinate(v))
    const x = (i: number) => scale.timeToCoordinate(candles[i].time as UTCTimestamp)
    const start = Math.max(0, values.pulse.length - 1500)
    const shapes = []
    for (let i = start + 1; i < candles.length; i++) {
      if (
        [values.pulse[i - 1], values.trend[i - 1], values.pulse[i], values.trend[i]].some(
          (v) => v === null,
        )
      )
        continue
      const x1 = x(i - 1),
        x2 = x(i)
      if (x1 === null || x2 === null || x2 < 0 || x1 > geometry.width) continue
      shapes.push(
        <polygon
          key={i}
          points={`${x1},${y(values.pulse[i - 1]!)} ${x2},${y(values.pulse[i]!)} ${x2},${y(values.trend[i]!)} ${x1},${y(values.trend[i - 1]!)}`}
          fill={`url(#pressure-gradient-${index})`}
        />,
      )
    }
    return (
      <g key={indicator.id} clipPath={`url(#pressure-clip-${index})`}>
        <defs>
          <clipPath id={`pressure-clip-${index}`}>
            <rect x="0" y={top} width={geometry.width} height={height} />
          </clipPath>
          <linearGradient
            id={`pressure-gradient-${index}`}
            x1="0"
            y1={y(0)}
            x2="0"
            y2={y(-100)}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={settings.hot} stopOpacity=".4" />
            <stop offset=".3" stopColor={settings.hot} stopOpacity="0" />
            <stop offset=".7" stopColor={settings.cold} stopOpacity="0" />
            <stop offset="1" stopColor={settings.cold} stopOpacity=".4" />
          </linearGradient>
        </defs>
        {shapes}
      </g>
    )
  }
  const renderPivotOverlay = (overlay: (typeof pivotOverlays)[number]) => {
    const { indicator, settings: pivots, result } = overlay
    const roleColor = (role: PivotColorRole) =>
      role === 'regular-high'
        ? pivots.regularHighColor
        : role === 'regular-low'
          ? pivots.regularLowColor
          : role === 'missed-high'
            ? pivots.missedHighColor
            : pivots.missedLowColor
    const point = (index: number, price: number) => {
      const candle = candles[index]
      return candle ? position({ time: candle.time, price }) : null
    }
    const renderLevel = (level: (typeof result.levels)[number]) => {
      const start = point(level.x1, level.price)
      const end = point(level.x2, level.price)
      if (!start || !end) return null
      // Historical levels: `color.new(reg_*_css, 50)`, width 2. The estimated
      // level shares the treatment but is tinted with the leg color.
      return (
        <line
          key={`pivot-level:${level.order}`}
          x1={start.x}
          y1={start.y}
          x2={Math.max(start.x, end.x)}
          y2={end.y}
          stroke={roleColor(level.color)}
          strokeOpacity="0.5"
          strokeWidth="2"
          data-testid={level.estimate ? 'pivot-estimate-level' : 'pivot-level'}
        />
      )
    }
    const renderSegment = (segment: (typeof result.zigzag)[number]) => {
      const start = point(segment.x1, segment.y1)
      const end = point(segment.x2, segment.y2)
      if (!start || !end) return null
      const color = segment.direction === 'up' ? pivots.missedLowColor : pivots.missedHighColor
      return (
        <line
          key={`pivot-zigzag:${segment.order}`}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={color}
          strokeWidth="1"
          strokeDasharray={segment.dashed ? '5 4' : undefined}
          data-testid={segment.estimate ? 'pivot-estimate-leg' : 'pivot-zigzag'}
        />
      )
    }
    const renderLabel = (label: (typeof result.labels)[number]) => {
      const anchor = point(label.index, label.price)
      if (!anchor) return null
      const missed = label.kind === 'missed-high' || label.kind === 'missed-low'
      const color = roleColor(label.kind)
      // `size.small` label plates: a rounded box with a pointer at the anchor.
      // `label_down` sits above its anchor, `label_up` hangs below it.
      const width = missed ? 22 : 18
      const height = 17
      const pointer = 5
      const gap = 1
      const above = label.style === 'down'
      const x = anchor.x - width / 2
      const y = above ? anchor.y - gap - pointer - height : anchor.y + gap + pointer
      const pointerPath = above
        ? `M ${anchor.x - 4} ${y + height} L ${anchor.x + 4} ${y + height} L ${anchor.x} ${anchor.y - gap} Z`
        : `M ${anchor.x - 4} ${y} L ${anchor.x + 4} ${y} L ${anchor.x} ${anchor.y + gap} Z`
      return (
        <g
          key={`pivot-label:${label.kind}:${label.index}:${label.estimate ? 'estimate' : 'fixed'}`}
          className="pivot-label"
          data-testid={label.estimate ? 'pivot-estimate-label' : `pivot-label-${label.kind}`}
        >
          <title>{label.tooltip}</title>
          <ChartMessagePlate
            x={x}
            y={y}
            width={width}
            height={height}
            rx={3}
            color={color}
            strokeOpacity={0.85}
          />
          <path d={pointerPath} fill={color} fillOpacity="0.85" />
          <ChartMessageText
            x={anchor.x}
            y={y + (missed ? 13 : 12.5)}
            color={missed ? color : pivots.labelTextColor}
            size={missed ? 12 : 9}
            weight={600}
            anchor="middle"
            className="pivot-label-text"
          >
            {label.kind === 'regular-high' ? '▼' : label.kind === 'regular-low' ? '▲' : '👻'}
          </ChartMessageText>
        </g>
      )
    }
    return (
      <g key={indicator.id} data-pivot-length={pivots.pivotLength}>
        {result.levels.map(renderLevel)}
        {result.zigzag.map(renderSegment)}
        {result.labels.map(renderLabel)}
      </g>
    )
  }

  // SCALPSWING R1-6 – small bottom/top arrows at PAC breakouts
  const scalpSwingLegendValue = (result?: (typeof scalpSwingOverlays)[number]['result']) => {
    if (!result) return '—'
    const buys = result.signals.filter((s) => s.side === 'buy').length
    const sells = result.signals.filter((s) => s.side === 'sell').length
    return `${buys} BUY · ${sells} SELL`
  }
  const tuxEmaScalperLegendValue = (result?: (typeof tuxEmaScalperOverlays)[number]['result']) => {
    if (!result) return '—'
    const buys = result.signals.filter((s) => s.side === 'buy').length
    const sells = result.signals.filter((s) => s.side === 'sell').length
    return `${buys} BUY · ${sells} SELL`
  }
  const nextPivotLegendValue = (result?: (typeof nextPivotOverlays)[number]['result']) => {
    if (!result || !result.info) return 'computing…'
    return `r=${result.info.similarity.toFixed(2)} · +${result.info.forecastLength} bars`
  }

  const renderScalpSwingOverlay = (overlay: (typeof scalpSwingOverlays)[number]) => {
    const { indicator, settings, result } = overlay
    const point = (index: number, price: number) => {
      const candle = candles[index]
      return candle ? position({ time: candle.time, price }) : null
    }

    const renderSignal = (signal: (typeof result.signals)[number]) => {
      const candle = candles[signal.index]
      if (!candle) return null
      const isBuy = signal.side === 'buy'
      const anchorPrice = isBuy ? candle.low : candle.high
      const anchor = point(signal.index, anchorPrice)
      if (!anchor) return null

      const color = isBuy ? settings.buyColor : settings.sellColor
      const bigColor = isBuy ? SCALPSWING_COLORS.bigBuy : SCALPSWING_COLORS.bigSell
      const displayColor = settings.useBigArrows ? bigColor : color

      // Original Pine: shape.arrowup belowbar (green) for BUY, arrowdown abovebar (red) for SELL
      // Both point TOWARD the candle. Small arrows at candle bottom/top.
      const size = settings.useBigArrows ? 14 : 8
      const gap = settings.useBigArrows ? 12 : 8

      // BUY: triangle pointing UP, just below low. Tip at y, base below.
      // SELL: triangle pointing DOWN, just above high. Tip at y, base above.
      const tipY = isBuy ? anchor.y + gap : anchor.y - gap
      const baseY = isBuy ? tipY + size : tipY - size
      const arrowPath = isBuy
        ? `M ${anchor.x} ${tipY} L ${anchor.x - size * 0.85} ${baseY} L ${anchor.x + size * 0.85} ${baseY} Z`
        : `M ${anchor.x} ${tipY} L ${anchor.x - size * 0.85} ${baseY} L ${anchor.x + size * 0.85} ${baseY} Z`

      const stemHeight = settings.useBigArrows ? 28 : 0
      const stemY2 = isBuy ? baseY + stemHeight : baseY - stemHeight

      return (
        <g
          key={`scalpswing:${signal.side}:${signal.index}`}
          className="scalpswing-signal"
          data-testid={`scalpswing-${signal.side}`}
          data-index={signal.index}
        >
          <title>
            {isBuy ? 'BUY' : 'SELL'} {formatPrice(signal.close)} · PAC {settings.pacLength}{' '}
            {isBuy ? '>' : '<'}{' '}
            {isBuy ? formatPrice(signal.pacU ?? 0) : formatPrice(signal.pacL ?? 0)} ·{' '}
            {settings.filterWithEma ? `EMA${settings.emaFilterLength} filter` : 'no filter'}{' '}
            {settings.signalOnNextBar ? '[next bar]' : '[same bar]'}
          </title>
          {settings.useBigArrows && (
            <line
              x1={anchor.x}
              y1={baseY}
              x2={anchor.x}
              y2={stemY2}
              stroke={displayColor}
              strokeWidth={2.5}
              strokeOpacity={0.9}
            />
          )}
          <path d={arrowPath} fill={displayColor} stroke={displayColor} strokeWidth={0.6} />
          {settings.showLabels && (
            <text
              x={anchor.x}
              y={isBuy ? baseY + 12 : baseY - 7}
              textAnchor="middle"
              fill={displayColor}
              fontSize={settings.useBigArrows ? 10 : 9}
              fontWeight={settings.useBigArrows ? '700' : '700'}
              fontFamily="DM Sans, sans-serif"
              className="scalpswing-label"
            >
              {isBuy ? 'BUY' : 'SELL'}
            </text>
          )}
        </g>
      )
    }

    return (
      <g
        key={indicator.id}
        data-scalpswing-length={settings.pacLength}
        data-testid="scalpswing-overlay"
      >
        {result.signals.map(renderSignal)}
      </g>
    )
  }

  const renderTuxEmaScalperOverlay = (overlay: (typeof tuxEmaScalperOverlays)[number]) => {
    const { indicator, settings, result } = overlay
    const point = (index: number, price: number) => {
      const candle = candles[index]
      return candle ? position({ time: candle.time, price }) : null
    }

    return (
      <g key={indicator.id} data-testid="tux-ema-scalper-overlay">
        {result.signals.map((signal) => {
          const candle = candles[signal.index]
          if (!candle) return null
          const isBuy = signal.side === 'buy'
          const anchor = point(signal.index, isBuy ? candle.low : candle.high)
          if (!anchor) return null
          const color = isBuy ? settings.buyColor : settings.sellColor
          const size = 9
          const gap = 8
          const tipY = isBuy ? anchor.y + gap : anchor.y - gap
          const baseY = isBuy ? tipY + size : tipY - size
          const arrowPath = isBuy
            ? `M ${anchor.x} ${tipY} L ${anchor.x - size * 0.85} ${baseY} L ${anchor.x + size * 0.85} ${baseY} Z`
            : `M ${anchor.x} ${tipY} L ${anchor.x - size * 0.85} ${baseY} L ${anchor.x + size * 0.85} ${baseY} Z`
          return (
            <g
              key={`tux-ema-scalper:${signal.side}:${signal.index}`}
              className="tux-ema-scalper-signal"
              data-testid={`tux-ema-scalper-${signal.side}`}
              data-index={signal.index}
            >
              <title>
                {isBuy ? 'BUY' : 'SELL'} · EMA {settings.emaLength} cross · SuperTrend{' '}
                {signal.trend ?? 'warming up'}
              </title>
              <path d={arrowPath} fill={color} stroke={color} strokeWidth={0.7} />
              {settings.showLabels && (
                <ChartMessageText
                  x={anchor.x}
                  y={isBuy ? baseY + 12 : baseY - 6}
                  color={color}
                  size={9}
                  weight={700}
                  anchor="middle"
                  className="tux-ema-scalper-label"
                >
                  {isBuy ? 'Buy' : 'Sell'}
                </ChartMessageText>
              )}
            </g>
          )
        })}
      </g>
    )
  }

  /** Compact age for the legend: the last signal's distance from the newest bar. */
  const chileSignalAge = (seconds: number) => {
    if (seconds <= 0) return 'now'
    if (seconds < 90) return `${Math.round(seconds)}s`
    const minutes = Math.round(seconds / 60)
    if (minutes < 90) return `${minutes}m`
    const hours = Math.round(minutes / 60)
    if (hours < 36) return `${hours}h`
    return `${Math.round(hours / 24)}d`
  }
  const chileReversalLegendValue = (
    overlay: (typeof chileReversalOverlays)[number] | undefined,
    nowSeconds: number,
    barSeconds: number,
  ) => {
    if (!overlay) return '—'
    const { result, settings } = overlay
    if (result.missingFeed) return `${result.resolution} feed…`
    const last = result.last
    const call = last ? `${last.scoreUp}/${last.scoreDown} pts` : ''
    const signal = result.signals.at(-1)
    if (!signal) return call ? `${call} · no call yet` : `${result.levels.length} levels`
    const latestTime = candles.at(-1)?.time
    // Without the age a stale label reads like a permanent fixture of the chart.
    const age = latestTime === undefined ? '' : ` · ${chileSignalAge(latestTime - signal.time)}`
    // With a marker lifetime, say where the newest label stands in it: the legend is the only
    // trace left once it has faded off the price pane.
    const expiry = chileMarkerExpiry(
      signal,
      nowSeconds,
      barSeconds,
      settings.markerTtlSeconds,
      settings.markerFadeSeconds,
    )
    const state = !expiry
      ? ''
      : expiry.expired
        ? ' · faded'
        : expiry.fadeDelaySeconds <= 0
          ? ' · fading'
          : ''
    return `${signal.kind === 'arriba' ? 'ARRIBA' : 'ABAJO'} ${signal.scoreUp}/${signal.scoreDown}${age}${state}`
  }

  const renderChileReversalOverlay = (overlay: (typeof chileReversalOverlays)[number]) => {
    const { indicator, settings, result } = overlay
    if (!candles.length) return null
    const lastIndex = candles.length - 1

    /**
     * A Pine `plot(..., style=plot.style_linebr)` as an SVG path: the pen lifts on `na`, so gaps in
     * the series stay gaps instead of being bridged.
     */
    const linePath = (values: (number | null)[]) => {
      let d = ''
      let pen = false
      for (let i = 0; i < candles.length; i++) {
        const value = values[i]
        const candle = candles[i]
        if (value === null || value === undefined || !candle) {
          pen = false
          continue
        }
        const point = position({ time: candle.time, price: value })
        if (!point) {
          pen = false
          continue
        }
        d += `${pen ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)} `
        pen = true
      }
      return d.trim()
    }

    /** Pine `fill(pEMA9, pEMA21)` — the area between the two EMAs. */
    const areaBetween = (upper: (number | null)[], lower: (number | null)[]) => {
      const forward: string[] = []
      const backward: string[] = []
      for (let i = 0; i < candles.length; i++) {
        const a = upper[i]
        const b = lower[i]
        const candle = candles[i]
        if (a === null || a === undefined || b === null || b === undefined || !candle) continue
        const top = position({ time: candle.time, price: a })
        const bottom = position({ time: candle.time, price: b })
        if (!top || !bottom) continue
        forward.push(`${forward.length ? 'L' : 'M'}${top.x.toFixed(1)} ${top.y.toFixed(1)}`)
        backward.unshift(`L${bottom.x.toFixed(1)} ${bottom.y.toFixed(1)}`)
      }
      if (forward.length < 2) return ''
      return `${forward.join(' ')} ${backward.join(' ')} Z`
    }

    const emaColor =
      (result.ema9[lastIndex] ?? 0) >= (result.ema21[lastIndex] ?? 0)
        ? settings.supportColor
        : settings.resistanceColor

    const plots = (
      <g data-testid="chile-reversal-plots">
        {settings.showEma && (
          <path
            d={areaBetween(result.ema9, result.ema21)}
            fill={emaColor}
            fillOpacity={0.08}
            stroke="none"
          />
        )}
        {settings.showVwap && (
          <path
            d={linePath(result.vwap)}
            fill="none"
            stroke={CHILE_REVERSAL_COLORS.vwap}
            strokeOpacity={0.65}
            strokeWidth={1}
          />
        )}
        {settings.showEma && (
          <>
            <path
              d={linePath(result.ema9)}
              fill="none"
              stroke={emaColor}
              strokeOpacity={0.9}
              strokeWidth={2}
            />
            <path
              d={linePath(result.ema21)}
              fill="none"
              stroke={emaColor}
              strokeOpacity={0.65}
              strokeWidth={1}
            />
          </>
        )}
        {settings.showTrend && (
          <path
            data-testid="chile-reversal-trend"
            d={linePath(result.supertrend)}
            fill="none"
            stroke={
              result.supertrendUp[lastIndex] === false
                ? settings.resistanceColor
                : settings.supportColor
            }
            strokeWidth={3}
            strokeOpacity={0.9}
          />
        )}
      </g>
    )

    // Pine `line.new(bar_index - largoLinea, nivel, bar_index + 5, nivel)` plus its price label.
    const levels = settings.showLevels
      ? result.levels.map((level) => {
          const left = srPoint(Math.max(0, lastIndex - settings.lineLength), level.price)
          const right = srPoint(lastIndex + 5, level.price)
          if (!left || !right) return null
          const secondary = level.kind === 'R2' || level.kind === 'S2'
          const color =
            level.side === 'support'
              ? secondary
                ? CHILE_REVERSAL_COLORS.supportStrong
                : settings.supportColor
              : secondary
                ? CHILE_REVERSAL_COLORS.resistanceStrong
                : settings.resistanceColor
          const labelAt = srPoint(lastIndex + 6, level.price)
          return (
            <g key={`chile-level:${level.kind}`} data-testid="chile-reversal-level">
              <title>
                {level.kind} {level.price.toFixed(2)}
                {level.fallback ? ' · mini-range fallback' : ' · pivot'}
              </title>
              <line
                x1={left.x}
                y1={left.y}
                x2={right.x}
                y2={right.y}
                stroke={color}
                strokeWidth={secondary ? 2 : 3}
                strokeDasharray={level.fallback ? '4 3' : undefined}
              />
              {labelAt && (
                <ChartMessageText
                  x={labelAt.x}
                  y={labelAt.y - 4}
                  color={color}
                  size={9}
                  weight={700}
                  anchor="start"
                  className="chile-reversal-label"
                >
                  {`${level.kind}  ${level.price.toFixed(2)}`}
                </ChartMessageText>
              )}
            </g>
          )
        })
      : []

    return (
      <g key={indicator.id} data-testid="chile-reversal-overlay">
        {plots}
        {levels}
        {displayedChileSignals(result.signals)
          .map((signal) => ({
            signal,
            // Labels are alerts, not annotations: each holds full strength for its lifetime, then
            // the CSS fade takes it to nothing. A lifetime of 0 keeps them until the count cap.
            expiry: chileMarkerExpiry(
              signal,
              chileNowSeconds,
              chileBarSeconds,
              settings.markerTtlSeconds,
              settings.markerFadeSeconds,
            ),
          }))
          .filter(
            (marker) =>
              // Wiped by the legend's clear-on-demand eraser, or past its fade.
              marker.signal.time + chileBarSeconds >
                (chileMarkerClears[indicator.id] ?? Number.NEGATIVE_INFINITY) &&
              marker.expiry?.expired !== true,
          )
          .map(({ signal, expiry }) => {
            const candle = candles[signal.index]
            if (!candle) return null
            const bullish = signal.side === 'bullish'
            const anchor = position({ time: candle.time, price: signal.price })
            if (!anchor) return null
            const color = bullish ? settings.supportColor : settings.resistanceColor
            const text = bullish ? 'ARRIBA' : 'ABAJO'
            const size = 9
            const gap = 8
            // `shape.labelup` sits below the bar, `shape.labeldown` above it.
            const tipY = bullish ? anchor.y + gap : anchor.y - gap
            const baseY = bullish ? tipY + size : tipY - size
            return (
              <g
                key={`chile-reversal:${signal.kind}:${signal.index}`}
                className={`chile-reversal-signal ${expiry ? 'chile-reversal-signal-expiring' : ''}`}
                data-testid={`chile-reversal-${signal.kind}`}
                data-index={signal.index}
                style={
                  expiry
                    ? {
                        // The class carries name/timing/fill-mode; the inline duration and delay
                        // place this label on the shared fade timeline (a negative delay resumes
                        // mid-fade).
                        animationDuration: `${Math.max(settings.markerFadeSeconds, 0.01)}s`,
                        animationDelay: `${expiry.fadeDelaySeconds}s`,
                      }
                    : undefined
                }
              >
                <title>
                  {text} · {signal.scoreUp} vs {signal.scoreDown} points ·{' '}
                  {signal.time.toLocaleString?.() ?? signal.time}
                </title>
                <path
                  d={`M ${anchor.x} ${tipY} L ${anchor.x - size} ${baseY} L ${anchor.x + size} ${baseY} Z`}
                  fill={color}
                  stroke={color}
                  strokeWidth={0.7}
                />
                <ChartMessageText
                  x={anchor.x}
                  y={bullish ? baseY + 12 : baseY - 6}
                  color={color}
                  size={9}
                  weight={700}
                  anchor="middle"
                  className="chile-reversal-label"
                >
                  {text}
                </ChartMessageText>
              </g>
            )
          })}
      </g>
    )
  }

  const renderNextPivotOverlay = (overlay: (typeof nextPivotOverlays)[number]) => {
    const { indicator, settings, result } = overlay
    if (!candles.length) return null
    const last = candles[candles.length - 1]
    const lastPos = position({ time: last.time, price: last.close })
    if (!lastPos) return null

    const forecastStart = position({ time: last.time, price: last.close })
    if (!forecastStart) return null

    // Convert a forecast point (offset time, price) to screen coordinates.
    const fp = (pt: { time: number; price: number }) => position({ time: pt.time, price: pt.price })

    const elements: React.ReactNode[] = []

    // ----- Matched-history highlight box -----
    if (
      settings.showMatchBox &&
      result.bestStart !== null &&
      result.bestEnd !== null &&
      result.bestStart >= 0 &&
      result.bestEnd < candles.length
    ) {
      const startC = candles[result.bestStart]
      const endC = candles[result.bestEnd]
      const midC = candles[result.bestMid!]
      let minP = Infinity,
        maxP = -Infinity
      for (let i = result.bestStart; i <= result.bestEnd; i++) {
        minP = Math.min(minP, candles[i].low)
        maxP = Math.max(maxP, candles[i].high)
      }
      const p1 = position({ time: startC.time, price: maxP })
      const p2 = position({ time: midC.time, price: minP })
      const p3 = position({ time: midC.time, price: maxP })
      const p4 = position({ time: endC.time, price: minP })
      if (p1 && p2 && p3 && p4) {
        elements.push(
          <rect
            key={`np-match:${indicator.id}:hist`}
            x={p1.x}
            y={p1.y}
            width={p3.x - p1.x}
            height={p2.y - p1.y}
            fill="#3b82f6"
            fillOpacity={0.12}
            stroke="none"
          />,
        )
        elements.push(
          <rect
            key={`np-match:${indicator.id}:cont`}
            x={p3.x}
            y={p3.y}
            width={Math.max(2, p4.x - p3.x)}
            height={Math.max(2, p4.y - p3.y)}
            fill={settings.forecastColor}
            fillOpacity={0.1}
            stroke="none"
          />,
        )
      }
    }

    // ----- Current lookback window highlight -----
    if (settings.showMatchBox && candles.length >= settings.correlationLength) {
      const winStart = candles[candles.length - settings.correlationLength]
      const winEnd = last
      let minP = Infinity,
        maxP = -Infinity
      for (let i = candles.length - settings.correlationLength; i < candles.length; i++) {
        minP = Math.min(minP, candles[i].low)
        maxP = Math.max(maxP, candles[i].high)
      }
      const p1 = position({ time: winStart.time, price: maxP })
      const p2 = position({ time: winEnd.time, price: minP })
      if (p1 && p2) {
        elements.push(
          <rect
            key={`np-cur:${indicator.id}`}
            x={p1.x}
            y={p1.y}
            width={Math.max(2, p2.x - p1.x)}
            height={Math.max(2, p2.y - p1.y)}
            fill="#3b82f6"
            fillOpacity={0.08}
            stroke="none"
          />,
        )
      }
    }

    // ----- Confidence band -----
    if (settings.showConfidenceBand && result.forecast.length > 1) {
      // Build a closed polygon going upper path forward then lower path backward.
      const topPts: { x: number; y: number }[] = []
      const botPts: { x: number; y: number }[] = []
      for (const pt of result.forecast) {
        const u = fp({ time: pt.time, price: pt.upper })
        const l = fp({ time: pt.time, price: pt.lower })
        if (u) topPts.push(u)
        if (l) botPts.push(l)
      }
      if (topPts.length > 1 && botPts.length > 1) {
        const d =
          `M ${forecastStart.x} ${forecastStart.y} ` +
          topPts.map((p) => `L ${p.x} ${p.y}`).join(' ') +
          ' ' +
          [...botPts]
            .reverse()
            .map((p) => `L ${p.x} ${p.y}`)
            .join(' ') +
          ' Z'
        elements.push(
          <path
            key={`np-band:${indicator.id}`}
            d={d}
            fill={settings.forecastColor}
            fillOpacity={0.08}
            stroke="none"
          />,
        )
      }
    }

    // ----- LinReg channel -----
    if (settings.showLinReg && result.linReg && result.forecast.length > 1) {
      const upper: { x: number; y: number }[] = []
      const lower: { x: number; y: number }[] = []
      for (let i = 0; i < result.forecast.length; i++) {
        const pt = result.forecast[i]
        const u = fp({
          time: pt.time,
          price: result.linReg.upper[i] * settings.linRegSigma + result.linReg.fit[i],
        })
        const l = fp({
          time: pt.time,
          price: result.linReg.fit[i] - result.linReg.sigma * settings.linRegSigma,
        })
        const f = fp({ time: pt.time, price: result.linReg.fit[i] })
        if (u && f) upper.push(u)
        if (l && f) lower.push(l)
      }
      // Fit line itself
      const fitPts: { x: number; y: number }[] = []
      for (let i = 0; i < result.forecast.length; i++) {
        const pt = result.forecast[i]
        const q = fp({ time: pt.time, price: result.linReg.fit[i] })
        if (q) fitPts.push(q)
      }
      if (upper.length > 1 && lower.length > 1) {
        const d =
          `M ${forecastStart.x} ${forecastStart.y} ` +
          upper.map((p) => `L ${p.x} ${p.y}`).join(' ') +
          ' ' +
          [...lower]
            .reverse()
            .map((p) => `L ${p.x} ${p.y}`)
            .join(' ') +
          ' Z'
        elements.push(
          <path
            key={`np-lrfill:${indicator.id}`}
            d={d}
            fill={settings.linRegColor}
            fillOpacity={0.18}
            stroke="none"
          />,
        )
      }
      if (fitPts.length > 1) {
        const fd =
          `M ${forecastStart.x} ${forecastStart.y} ` +
          fitPts.map((p) => `L ${p.x} ${p.y}`).join(' ')
        elements.push(
          <path
            key={`np-lr:${indicator.id}`}
            d={fd}
            fill="none"
            stroke={settings.linRegColor}
            strokeWidth={1.25}
            strokeDasharray="6 4"
          />,
        )
      }
    }

    // ----- Forecast price path (dotted, like original) -----
    if (settings.showPricePath && result.forecast.length > 0) {
      let prev = forecastStart
      const segs: string[] = []
      for (const pt of result.forecast) {
        const q = fp(pt)
        if (!q) continue
        segs.push(`M ${prev.x} ${prev.y} L ${q.x} ${q.y}`)
        prev = q
      }
      elements.push(
        <path
          key={`np-path:${indicator.id}`}
          d={segs.join(' ')}
          fill="none"
          stroke={settings.forecastColor}
          strokeWidth={1.75}
          strokeDasharray="2 4"
          strokeLinecap="round"
        />,
      )
    }

    // ----- Projected ZigZag -----
    if (settings.showZigZag && result.zigZag.length > 0) {
      // Start from last close, then walk the projected pivots in offset order,
      // anchoring first segment to the last confirmed real pivot (last close).
      const pivots = [...result.zigZag].sort((a, b) => a.offset - b.offset)
      const anchor = forecastStart
      let prev = anchor
      const segs: string[] = []
      for (const z of pivots) {
        const q = position({ time: z.time, price: z.price })
        if (!q) continue
        segs.push(`M ${prev.x} ${prev.y} L ${q.x} ${q.y}`)
        prev = q
        // Mark pivot dots
        elements.push(
          <circle
            key={`np-zz-dot:${indicator.id}:${z.offset}`}
            cx={q.x}
            cy={q.y}
            r={3}
            fill={settings.zigZagColor}
            stroke={z.direction === 1 ? '#ef5350' : '#26a69a'}
            strokeWidth={1.5}
          />,
        )
      }
      // Close to last forecast point if possible
      if (result.forecast.length > 0) {
        const lastFp = fp(result.forecast[result.forecast.length - 1])
        if (lastFp) segs.push(`M ${prev.x} ${prev.y} L ${lastFp.x} ${lastFp.y}`)
      }
      elements.push(
        <path
          key={`np-zz:${indicator.id}`}
          d={segs.join(' ')}
          fill="none"
          stroke={settings.zigZagColor}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />,
      )
    }

    // ----- Info label -----
    if (settings.showInfoLabel && result.info) {
      const labelX = forecastStart.x + 8
      const labelY = forecastStart.y - 44
      const simText = result.info.similarity.toFixed(3)
      const line1 = `${result.info.method} · ${result.info.source}`
      const line2 = `r=${simText} · ${result.info.ensembleSize} matches · ${result.info.barsBack} bars back`
      elements.push(
        <g key={`np-label:${indicator.id}`} pointerEvents="none">
          <rect
            x={labelX - 4}
            y={labelY - 12}
            width={Math.max(210, line2.length * 6.2)}
            height={36}
            rx={4}
            fill="#000000"
            fillOpacity={0.55}
            stroke={settings.zigZagColor}
            strokeOpacity={0.5}
            strokeWidth={1}
          />
          <text
            x={labelX + 4}
            y={labelY + 2}
            fill={settings.forecastColor}
            fontSize={10}
            fontWeight={700}
            fontFamily="JetBrains Mono, monospace"
          >
            The Next Pivot ({result.info.correlationLength},{result.info.forecastLength})
          </text>
          <text
            x={labelX + 4}
            y={labelY + 16}
            fill="#cfd4dc"
            fontSize={9}
            fontFamily="DM Sans, sans-serif"
          >
            {line1}
          </text>
          <text
            x={labelX + 4}
            y={labelY + 27}
            fill="#cfd4dc"
            fontSize={8.5}
            fontFamily="DM Sans, sans-serif"
          >
            {line2}
          </text>
        </g>,
      )
    }

    return (
      <g
        key={indicator.id}
        data-testid="next-pivot-overlay"
        data-similarity={result.info?.similarity ?? 0}
      >
        {elements}
      </g>
    )
  }

  const renderDivergenceOverlay = (overlay: (typeof macdDivergences)[number]) => {
    const entry = indicatorSeries.current.get(overlay.indicator.id)
    if (!entry || !entry.pane) return null
    // The oscillator pane holds the MACD/histogram series; its price scale maps
    // histogram values to Y. priceToCoordinate is pane-relative, so add the
    // pane's top offset to place the line in the full-height SVG overlay.
    const series = entry.series[0]
    const paneTop = geometry.paneTops[entry.pane] ?? 0
    const paneHeight = geometry.paneHeights[entry.pane] ?? 0
    const timeScale = chartRef.current?.timeScale()
    if (!series || !timeScale) return null
    const point = (index: number, value: number) => {
      const candle = candles[index]
      if (!candle) return null
      const x = timeScale.timeToCoordinate(candle.time as UTCTimestamp)
      const y = series.priceToCoordinate(value)
      if (x === null || x === undefined || y === null || y === undefined) return null
      const absY = paneTop + Number(y)
      // Skip points scrolled out of the pane vertically or off the time axis.
      if (Number(x) < 0 || Number(x) > geometry.width) return null
      if (Number(y) < -2 || Number(y) > paneHeight + 2) return null
      return { x: Number(x), y: absY }
    }
    const items = overlay.divergences
      .map((divergence) => {
        const from = point(divergence.fromIndex, divergence.fromValue)
        const to = point(divergence.toIndex, divergence.toValue)
        if (!from || !to) return null
        return { divergence, from, to }
      })
      .filter(
        (
          item,
        ): item is {
          divergence: Divergence
          from: { x: number; y: number }
          to: { x: number; y: number }
        } => item !== null,
      )
    if (!items.length) return null
    return (
      <g key={overlay.indicator.id} data-testid="macd-divergence">
        {items.map(({ divergence, from, to }) => {
          const labelBelow = divergence.bullish
          const labelY = labelBelow
            ? Math.min(to.y + 13, paneTop + paneHeight - 3)
            : Math.max(to.y - 7, paneTop + 9)
          return (
            <g
              key={`${divergence.kind}:${divergence.fromIndex}:${divergence.toIndex}`}
              data-divergence={divergence.kind}
            >
              {overlay.settings.showLines && (
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={divergence.color}
                  strokeWidth={1.5}
                  strokeDasharray={divergence.hidden ? '4 3' : undefined}
                />
              )}
              {overlay.settings.showLabels && (
                <text
                  x={to.x}
                  y={labelY}
                  textAnchor="middle"
                  fill={divergence.color}
                  fontSize="9"
                  fontFamily="DM Sans, sans-serif"
                  className="smc-label"
                >
                  {divergence.label}
                </text>
              )}
            </g>
          )
        })}
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
        aria-label={`${asset.name} ${timeframe} ${chartType} chart with ${candles.length} ${props.source === 'demo' ? 'simulated' : venueLabel(props.source)} price bars`}
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
            className={`exchange-label ${
              props.source === 'demo'
                ? ''
                : props.source === 'kalshi'
                  ? 'kalshi-exchange'
                  : 'coinbase-exchange'
            }`}
            title={
              props.source === 'kalshi'
                ? // Everything above 15m is aggregated from Kalshi's quarter-hour settlement
                  // points, and 15m bars are bounded by two of them — the range is a floor.
                  'Kalshi settlement values on Pyth · quarter-hour resolution · bar range is the tightest published bound'
                : props.source === 'coinbase' && ['3m', '4h', '1W'].includes(timeframe)
                  ? 'Aggregated from smaller Coinbase candles · UTC aligned'
                  : 'Market data provider'
            }
          >
            {venueLabel(props.source).toUpperCase()}
          </span>
          <span
            className={`market-dot ${props.replay || props.feedState !== 'live' ? 'replaying' : ''}`}
            title={
              props.replay
                ? 'Bar replay'
                : props.source === 'demo'
                  ? 'Demo market data'
                  : `${venueLabel(props.source)} · ${props.feedState}`
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
              {formatPrice(display.open, false, priceDigits)}
            </span>
            <span>
              <i>H</i>
              {formatPrice(display.high, false, priceDigits)}
            </span>
            <span>
              <i>L</i>
              {formatPrice(display.low, false, priceDigits)}
            </span>
            <span>
              <i>C</i>
              {formatPrice(display.close, false, priceDigits)}
            </span>
            <span className="candle-change">
              {up ? '+' : ''}
              {formatPrice(display.close - display.open, false, priceDigits)} ({up ? '+' : ''}
              {((display.close / display.open - 1) * 100).toFixed(2)}%)
            </span>
          </div>
        )}
        {strikeOverlays.map(({ indicator, settings: strikeSettings, result, resolved }) => {
          if (!strikeSettings.showStatusBadge || resolved.price === null) return null
          const strikeDisplay =
            hovered && result.strikeLine[hoverIndex] !== null
              ? result.strikeLine[hoverIndex]!
              : resolved.price
          const currentPrice = hovered
            ? hovered.close
            : (result.currentPrice ?? candles[candles.length - 1]?.close ?? strikeDisplay)
          const delta = currentPrice - strikeDisplay
          const deltaPct = strikeDisplay > 0 ? (delta / strikeDisplay) * 100 : 0
          // Kalshi resolves this ladder on `greater_or_equal`: a dead-even tie is UP.
          const isUp = resolved.tieGoesUp ? delta >= 0 : delta > 0
          const sourceLabel = resolved.manual
            ? 'MANUAL PIN'
            : resolved.authoritative
              ? `KALSHI · ${kalshiPayload?.indexId ?? 'BRTI'}`
              : 'COINBASE EST'
          const basisLabel =
            resolved.basis !== null
              ? `CB basis ${resolved.basis >= 0 ? '+' : '−'}$${formatPrice(Math.abs(resolved.basis), false)}`
              : resolved.authoritative
                ? 'exact · 60s index average'
                : kalshi.status === 'unsupported'
                  ? 'no Kalshi market on this pair'
                  : kalshi.status === 'waiting'
                    ? 'awaiting Kalshi strike'
                    : kalshi.message || 'estimate · 60s trailing average'
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
                <span className="strike-hud-title" title={resolved.rule ?? undefined}>
                  {resolved.authoritative && !resolved.manual
                    ? `KALSHI ${strikeSettings.intervalMinutes}m STRIKE`
                    : `COINBASE ${strikeSettings.intervalMinutes}m STRIKE · EST`}
                </span>
                {!hovered && (
                  <span className="strike-hud-timer" title="Time to interval expiry">
                    ⏱ {countdown}
                  </span>
                )}
              </div>
              <div
                className={`strike-hud-source${resolved.authoritative ? ' strike-source-exact' : ''}`}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  opacity: 0.85,
                }}
              >
                <span
                  style={{
                    color: resolved.authoritative
                      ? strikeSettings.upColor
                      : strikeSettings.downColor,
                    fontWeight: 700,
                  }}
                >
                  {sourceLabel}
                </span>
                <span>{basisLabel}</span>
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
                  // Oscillators with their own pane legend are listed there, not here.
                  (ind.kind !== 'rsi' &&
                    ind.kind !== 'rsi-divergence' &&
                    ind.kind !== 'macd' &&
                    ind.kind !== 'cm-ult-macd' &&
                    ind.kind !== 'zeiierman-trend-pressure' &&
                    ind.kind !== 'wave-trend' &&
                    ind.kind !== 'cm-williams-vix-fix' &&
                    ind.kind !== 'tmo-scalper' &&
                    ind.kind !== 'bayesian-nqqe-bankfunds' &&
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
                            : indicator.kind === 'pivot-points-missed-reversals'
                              ? pivotLegendValue(
                                  pivotOverlays.find((item) => item.indicator.id === indicator.id)
                                    ?.result,
                                )
                              : indicator.kind === 'scalpswing'
                                ? scalpSwingLegendValue(
                                    scalpSwingOverlays.find(
                                      (item) => item.indicator.id === indicator.id,
                                    )?.result,
                                  )
                                : indicator.kind === 'tux-ema-scalper'
                                  ? tuxEmaScalperLegendValue(
                                      tuxEmaScalperOverlays.find(
                                        (item) => item.indicator.id === indicator.id,
                                      )?.result,
                                    )
                                  : indicator.kind === 'chile-reversal'
                                    ? chileReversalLegendValue(
                                        chileReversalOverlays.find(
                                          (item) => item.indicator.id === indicator.id,
                                        ),
                                        chileNowSeconds,
                                        chileBarSeconds,
                                      )
                                    : indicator.kind === 'coinbase-strike'
                                      ? formatPrice(
                                          strikeOverlays.find(
                                            (item) => item.indicator.id === indicator.id,
                                          )?.resolved.price ??
                                            strikeOverlays.find(
                                              (item) => item.indicator.id === indicator.id,
                                            )?.result.currentStrike ??
                                            null,
                                        )
                                      : indicator.kind === 'next-pivot'
                                        ? nextPivotLegendValue(
                                            nextPivotOverlays.find(
                                              (item) => item.indicator.id === indicator.id,
                                            )?.result,
                                          )
                                        : plotValue(group?.plots[0])}
                    </span>
                    {indicator.kind === 'sr-breaks-retests' && candles.length < SR_ATR_LENGTH && (
                      <span className="cm-indicator-notice" role="status">
                        ATR({SR_ATR_LENGTH}) warming up · {candles.length}/{SR_ATR_LENGTH} bars
                      </span>
                    )}
                    {indicator.kind === 'pivot-points-missed-reversals' &&
                      candles.length <
                        2 * pivotPointsMissedReversalsSettings(indicator).pivotLength + 1 && (
                        <span className="cm-indicator-notice" role="status">
                          Pivot window warming up · {candles.length}/
                          {2 * pivotPointsMissedReversalsSettings(indicator).pivotLength + 1} bars
                        </span>
                      )}
                    {indicator.kind === 'next-pivot' &&
                      (() => {
                        const s = nextPivotSettings(indicator)
                        const need = s.correlationLength + s.forecastLength + 2
                        return candles.length < need ? (
                          <span className="cm-indicator-notice" role="status">
                            Warming up · {candles.length}/{need} bars
                          </span>
                        ) : null
                      })()}
                    <div className="legend-actions">
                      <IconButton
                        icon={indicator.visible ? Eye : EyeOff}
                        label={`Toggle ${indicator.name} ${indicator.period}`}
                        onClick={() => props.onIndicatorToggle(indicator.id)}
                      />
                      {indicator.kind === 'chile-reversal' && (
                        <IconButton
                          icon={Eraser}
                          label={`Clear ${indicator.name} markers`}
                          title="Clear every Bounce / Reject / Break marker now; new signals still print"
                          onClick={() => clearChileMarkers(indicator.id)}
                        />
                      )}
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
      {props.rsiHud && activeRsi !== null && (
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
      {props.cmMacdHud && cmHudModel && (
        <OscHudCard
          model={cmHudModel}
          dock="cm"
          indicator={cmHudIndicator}
          bars={cmHudBars}
          onZoom={(delta) => zoomOscHud('cm-ult-macd', delta)}
          history={windowHistory(candleTimes, cmHudEnd, cmHudBars)}
          onPan={(delta) => panOscHud('cm-ult-macd', cmHudBars, delta)}
          onEditIndicator={props.onIndicatorEdit}
          onAddIndicator={(kind) => props.onIndicatorAdd?.(kind)}
          onClose={() => props.onOscHudClose?.('cm-ult-macd')}
        />
      )}
      {props.waveTrendHud && waveHudModel && (
        <OscHudCard
          model={waveHudModel}
          dock="wave"
          indicator={waveHudIndicator}
          bars={waveHudBars}
          onZoom={(delta) => zoomOscHud('wave-trend', delta)}
          history={windowHistory(candleTimes, waveHudEnd, waveHudBars)}
          onPan={(delta) => panOscHud('wave-trend', waveHudBars, delta)}
          onEditIndicator={props.onIndicatorEdit}
          onAddIndicator={(kind) => props.onIndicatorAdd?.(kind)}
          onClose={() => props.onOscHudClose?.('wave-trend')}
        />
      )}
      {props.rsiDivHud && rsiDivHudModel && (
        <OscHudCard
          model={rsiDivHudModel}
          dock="rsi-div"
          indicator={rsiDivHudIndicator}
          bars={rsiDivHudBars}
          onZoom={(delta) => zoomOscHud('rsi-divergence', delta)}
          history={windowHistory(candleTimes, rsiDivHudEnd, rsiDivHudBars)}
          onPan={(delta) => panOscHud('rsi-divergence', rsiDivHudBars, delta)}
          onEditIndicator={props.onIndicatorEdit}
          onAddIndicator={(kind) => props.onIndicatorAdd?.(kind)}
          onClose={() => props.onOscHudClose?.('rsi-divergence')}
        />
      )}
      {props.vixFixHud && vixFixHudModel && (
        <OscHudCard
          model={vixFixHudModel}
          dock="vix-fix"
          indicator={vixFixHudIndicator}
          bars={vixFixHudBars}
          onZoom={(delta) => zoomOscHud('cm-williams-vix-fix', delta)}
          history={windowHistory(candleTimes, vixFixHudEnd, vixFixHudBars)}
          onPan={(delta) => panOscHud('cm-williams-vix-fix', vixFixHudBars, delta)}
          onEditIndicator={props.onIndicatorEdit}
          onAddIndicator={(kind) => props.onIndicatorAdd?.(kind)}
          onClose={() => props.onOscHudClose?.('cm-williams-vix-fix')}
        />
      )}
      {props.tmoScalperHud && tmoHudModel && (
        <OscHudCard
          model={tmoHudModel}
          dock="tmo"
          indicator={tmoHudIndicator}
          bars={tmoHudBars}
          onZoom={(delta) => zoomOscHud('tmo-scalper', delta)}
          history={windowHistory(candleTimes, tmoHudEnd, tmoHudBars)}
          onPan={(delta) => panOscHud('tmo-scalper', tmoHudBars, delta)}
          onEditIndicator={props.onIndicatorEdit}
          onAddIndicator={(kind) => props.onIndicatorAdd?.(kind)}
          onClose={() => props.onOscHudClose?.('tmo-scalper')}
        />
      )}
      {props.trendPressureHud && pressureHudModel && (
        <OscHudCard
          model={pressureHudModel}
          dock="pressure"
          indicator={pressureHudIndicator}
          bars={pressureHudBars}
          onZoom={(delta) => zoomOscHud('zeiierman-trend-pressure', delta)}
          history={windowHistory(candleTimes, pressureHudEnd, pressureHudBars)}
          onPan={(delta) => panOscHud('zeiierman-trend-pressure', pressureHudBars, delta)}
          onEditIndicator={props.onIndicatorEdit}
          onAddIndicator={(kind) => props.onIndicatorAdd?.(kind)}
          onClose={() => props.onOscHudClose?.('zeiierman-trend-pressure')}
        />
      )}
      {props.bayesianNqqeHud && bayesHudModel && (
        <OscHudCard
          model={bayesHudModel}
          dock="bayes"
          indicator={bayesHudIndicator}
          bars={bayesHudBars}
          onZoom={(delta) => zoomOscHud('bayesian-nqqe-bankfunds', delta)}
          history={windowHistory(candleTimes, bayesHudEnd, bayesHudBars)}
          onPan={(delta) => panOscHud('bayesian-nqqe-bankfunds', bayesHudBars, delta)}
          onEditIndicator={props.onIndicatorEdit}
          onAddIndicator={(kind) => props.onIndicatorAdd?.(kind)}
          onClose={() => props.onOscHudClose?.('bayesian-nqqe-bankfunds')}
        />
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
        className="pressure-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.totalHeight}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.totalHeight || 1}`}
        aria-hidden="true"
        data-testid="pressure-overlay"
        data-revision={revision}
      >
        {pressureOverlays.map(renderPressureGradient)}
      </svg>
      <svg
        className="pressure-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="pressure-price-overlay"
        data-revision={revision}
      >
        {pressureOverlays.map(renderPressureOverlay)}
      </svg>
      <svg
        ref={pivotSvgRef}
        className="pivot-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="pivot-overlay"
        data-revision={revision}
      >
        {pivotOverlays.map(renderPivotOverlay)}
      </svg>
      <svg
        ref={scalpswingSvgRef}
        className="scalpswing-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="scalpswing-overlay"
        data-revision={revision}
      >
        {scalpSwingOverlays.map(renderScalpSwingOverlay)}
      </svg>
      <svg
        ref={tuxEmaScalperSvgRef}
        className="tux-ema-scalper-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="tux-ema-scalper-overlay"
        data-revision={revision}
      >
        {tuxEmaScalperOverlays.map(renderTuxEmaScalperOverlay)}
      </svg>
      <svg
        ref={chileReversalSvgRef}
        className="chile-reversal-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="chile-reversal-overlay"
        data-revision={revision}
      >
        {chileReversalOverlays.map(renderChileReversalOverlay)}
      </svg>
      <svg
        ref={nextPivotSvgRef}
        className="next-pivot-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.height || 1}`}
        aria-hidden="true"
        data-testid="next-pivot-overlay"
        data-revision={revision}
      >
        {nextPivotOverlays.map(renderNextPivotOverlay)}
      </svg>
      <svg
        ref={divSvgRef}
        className="divergence-overlay"
        xmlns="http://www.w3.org/2000/svg"
        width={geometry.width}
        height={geometry.totalHeight || geometry.height}
        viewBox={`0 0 ${geometry.width || 1} ${geometry.totalHeight || geometry.height || 1}`}
        aria-hidden="true"
        data-testid="divergence-overlay"
        data-revision={revision}
      >
        {macdDivergences.map(renderDivergenceOverlay)}
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
        <IconButton icon={ChevronUp} label="Zoom prices in" onClick={() => zoomPrice(0.75)} />
        <IconButton icon={ChevronDown} label="Zoom prices out" onClick={() => zoomPrice(1.33)} />
        <span />
        <IconButton icon={RotateCcw} label="Reset chart view" onClick={latest} />
      </div>
    </div>
  )
})
