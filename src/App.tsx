import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  Bot,
  Bell,
  BellPlus,
  Camera,
  CandlestickChart,
  ChartArea,
  ChartNoAxesColumnIncreasing,
  ChartNoAxesCombined,
  ChevronDown,
  CircleHelp,
  CheckCheck,
  Code2,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Focus,
  Grid2X2,
  HelpCircle,
  Keyboard,
  LayoutPanelLeft,
  List,
  LockKeyhole,
  Magnet,
  Maximize,
  Minus,
  MoveUpRight,
  NotebookPen,
  PanelRightClose,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Waves,
  Layers,
  Ruler,
  Search,
  Settings2,
  Share2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  TextCursorInput,
  Trash2,
  TrendingUp,
  Undo2,
  UnlockKeyhole,
  X,
  RefreshCw,
  Loader2,
  WifiOff,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ChartView } from './components/ChartView'
import type { ChartHandle } from './components/ChartView'
import { DEFAULT_WATCHLIST, AlertsPanel, NotesPanel, Watchlist } from './components/Sidebar'
import { AgentPanel } from './components/AgentPanel'
import { AgentDecisionBox } from './components/AgentDecisionBox'
import { IndicatorStudio } from './components/IndicatorStudio'
import { IndicatorTimeframeFeed } from './components/IndicatorTimeframeFeeds'
import { TimeframePeekBox } from './components/TimeframePeekBox'
import type { TimeframePeekFeed } from './components/TimeframePeekBox'
import { BookStrengthBox } from './components/BookStrengthBox'
import { WhaleFlowBox } from './components/WhaleFlowBox'
import { CoinIcon, Dropdown, IconButton, MenuItem, ToastHost } from './components/ui'
import type { ToastMessage } from './components/ui'
import { demoBook } from './lib/demo-book'
import {
  ASSETS,
  TIMEFRAMES,
  formatPrice,
  generateCandles,
  getAsset,
  COINBASE_DEFAULTS,
  demoQuotes,
  isDemoSymbol,
  changeClass,
  formatChange,
  quoteCurrency,
} from './lib/market'
import { useCoinbaseMarket } from './lib/useCoinbaseMarket'
import {
  agentContextTimeframes,
  defaultAgentPredictionJournal,
  normalizeAgentLearningState,
  normalizeAgentPredictionJournal,
  recordAgentPrediction,
  resolveAgentPredictionJournal,
  suggestedHorizonBars,
} from './lib/agent-journal'
import {
  analyzeMarket,
  defaultAgentLearningState,
  type AgentLearningState,
  type MarketAnalysis,
} from './lib/market-agents'
import { agentDecisionDefaultVisible } from './lib/floating-window'
import { useIndicatorInput } from './lib/useIndicatorInput'
import { initialMarket } from './lib/market-settings'
import { INTERVAL_SECONDS, isProductId, candleFingerprint } from '../shared/coinbase'
import { kalshiStrike } from './lib/kalshi-window'
import { INDICATOR_CATALOG, SCRIPT_TEMPLATES } from './lib/indicators'
import { CM_MACD_DEFAULTS, requestedIndicatorTimeframes } from './lib/cm-ult-macd'
import type { IndicatorTimeframeData, IndicatorTimeframes } from './lib/cm-ult-macd'
import {
  TIMEFRAME_PEEK_DEFAULTS,
  peekDefaultVisible,
  peekResolution,
  timeframePeekSettings,
} from './lib/timeframe-peek'
import type { TimeframePeekSettings } from './lib/timeframe-peek'
import { runIndicator } from './lib/script-runner'
import { downloadFile, readStored, uid, useLocalState, writeStored } from './lib/storage'
import type {
  Anchor,
  Candle,
  DataSource,
  ChartSettings,
  ChartType,
  Drawing,
  Indicator,
  PriceAlert,
  SavedScript,
  ScriptResult,
  Timeframe,
  Tool,
} from './lib/types'
import {
  DEFAULT_INDICATORS,
  DEFAULT_SETTINGS,
  DIVERGENCE_DEFAULTS,
  SMC_DEFAULTS,
  SR_BREAKS_RETESTS_DEFAULTS,
  PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS,
  COINBASE_STRIKE_DEFAULTS,
} from './lib/types'
import { parseWorkspaceBackup, persistWorkspaceBackup } from './lib/workspace-backup'
import type { WorkspaceBackup } from './lib/workspace-backup'

// Dialogs are loaded only when needed; the chart stays in the initial bundle.
const AlertDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.AlertDialog })),
)
const ChartSettingsDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.ChartSettingsDialog })),
)
const ConfirmDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.ConfirmDialog })),
)
const DocsDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.DocsDialog })),
)
const IndicatorLibrary = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.IndicatorLibrary })),
)
const IndicatorSettingsDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.IndicatorSettingsDialog })),
)
const MarketsDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.MarketsDialog })),
)
const ShareDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.ShareDialog })),
)
const SymbolSearch = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.SymbolSearch })),
)
const TextNoteDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.TextNoteDialog })),
)
const WorkspaceDialog = lazy(() =>
  import('./components/Dialogs').then((module) => ({ default: module.WorkspaceDialog })),
)

const EMPTY_DRAWINGS: Drawing[] = []
const EMPTY_CANDLES: Candle[] = []
const CHART_TYPES: { id: ChartType; name: string; icon: LucideIcon }[] = [
  { id: 'candles', name: 'Candlesticks', icon: CandlestickChart },
  { id: 'hollow', name: 'Hollow candles', icon: ChartNoAxesColumnIncreasing },
  { id: 'line', name: 'Line', icon: TrendingUp },
  { id: 'area', name: 'Area', icon: ChartArea },
  { id: 'bars', name: 'Bars', icon: ChartNoAxesColumnIncreasing },
]
const DRAW_TOOLS: { id: Tool; label: string; icon: LucideIcon; shortcut?: string }[] = [
  { id: 'cursor', label: 'Crosshair', icon: Crosshair },
  { id: 'trend', label: 'Trend line', icon: MoveUpRight, shortcut: 'Alt T' },
  { id: 'horizontal', label: 'Horizontal line', icon: Minus, shortcut: 'Alt H' },
  { id: 'fibonacci', label: 'Fibonacci retracement', icon: SlidersHorizontal },
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'text', label: 'Text note', icon: TextCursorInput },
  { id: 'measure', label: 'Measure', icon: Ruler },
]
const DEFAULT_AGENT_HORIZONS = Object.fromEntries(
  TIMEFRAMES.map((interval) => [interval, suggestedHorizonBars(interval)]),
) as Record<Timeframe, number>
type ModalName =
  | 'symbols'
  | 'indicators'
  | 'settings'
  | 'alert'
  | 'share'
  | 'markets'
  | 'docs'
  | 'workspace'
  | 'indicator-settings'
  | 'text'
  | null
type Draft = { id: string; name: string; source: string }
type ComputedResult = {
  dataKey: string
  configKey: string
  result: ScriptResult
  times: number[]
  sampledAt: number
}
const configKey = (indicator: Pick<Indicator, 'source' | 'inputValues'>) =>
  JSON.stringify([indicator.source, indicator.inputValues ?? {}])

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])
  return (
    <span className="clock mono">
      {now.toLocaleTimeString('en-GB', { timeZone: 'UTC' })}
      <span> (UTC)</span>
    </span>
  )
}

export default function App() {
  const [source, setSource] = useState<DataSource>(() => initialMarket().source)
  const [symbol, setSymbol] = useState(() => initialMarket().symbol)
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const query = new URLSearchParams(window.location.search).get('interval') as Timeframe
    const saved = readStored<Timeframe>('timeframe', source === 'coinbase' ? '15m' : '1h')
    return TIMEFRAMES.includes(query)
      ? query
      : TIMEFRAMES.includes(saved)
        ? saved
        : source === 'coinbase'
          ? '15m'
          : '1h'
  })
  const [chartType, setChartType] = useState<ChartType>(() => {
    const query = new URLSearchParams(window.location.search).get('style') as ChartType
    const saved = readStored<ChartType>('chart-type', 'candles')
    return CHART_TYPES.some((c) => c.id === query)
      ? query
      : CHART_TYPES.some((c) => c.id === saved)
        ? saved
        : 'candles'
  })
  const [workspaceName, setWorkspaceName] = useLocalState('workspace-name', 'Crypto workspace')
  const [tabs, setTabs] = useLocalState<string[]>('tabs', ['BTCUSDT', 'ETHUSDT'])
  const [watchlist, setWatchlist] = useLocalState<string[]>('watchlist', DEFAULT_WATCHLIST)
  const [whaleBoxVisible, setWhaleBoxVisible] = useLocalState('whale-box-visible', true)
  const [bookBoxVisible, setBookBoxVisible] = useLocalState('book-strength-box-visible', true)
  const [settings, setSettings] = useLocalState<ChartSettings>('chart-settings', DEFAULT_SETTINGS)
  const [indicators, setIndicators] = useLocalState<Indicator[]>('indicators', DEFAULT_INDICATORS)
  const [allDrawings, setAllDrawings] = useLocalState<Record<string, Drawing[]>>('drawings', {})
  const [scripts, setScripts] = useLocalState<SavedScript[]>('scripts', [])
  const [draft, setDraft] = useLocalState<Draft>('draft', {
    id: 'first-indicator',
    name: SCRIPT_TEMPLATES[0].name,
    source: SCRIPT_TEMPLATES[0].source,
  })
  const [alerts, setAlerts] = useLocalState<PriceAlert[]>('alerts', [])
  const [studioOpen, setStudioOpen] = useLocalState('studio-open', true)
  const [studioHeight, setStudioHeight] = useLocalState('studio-height', 270)
  const [drawingsVisible, setDrawingsVisible] = useLocalState('drawings-visible', true)
  const [drawingsLocked, setDrawingsLocked] = useLocalState('drawings-locked', false)
  const [magnet, setMagnet] = useLocalState('magnet', false)
  const [feedActive, setFeedActive] = useLocalState('feed-active', true)
  const [agentLearning, setAgentLearning] = useLocalState<AgentLearningState>(
    'agent-learning',
    defaultAgentLearningState(),
  )
  const [agentJournal, setAgentJournal] = useLocalState(
    'agent-journal',
    defaultAgentPredictionJournal(),
  )
  // The AI's general decision, as a floating window on the chart rather than a panel to open.
  // null means "never chosen", which defers to the viewport; a real choice wins over it either way.
  const [agentDecisionPreference, setAgentDecisionPreference] = useLocalState<boolean | null>(
    'agent-decision-visible',
    null,
  )
  const agentDecisionVisible =
    agentDecisionPreference ?? agentDecisionDefaultVisible(window.innerWidth)
  const setAgentDecisionVisible = (next: boolean) => setAgentDecisionPreference(next)
  const [agentHorizons, setAgentHorizons] = useLocalState<Record<Timeframe, number>>(
    'agent-horizons',
    DEFAULT_AGENT_HORIZONS,
  )
  // The floating timeframe-peek window: a second resolution, forming bar included.
  // null means "never chosen", which defers to the viewport; a real choice wins over it either way.
  const [peekPreference, setPeekPreference] = useLocalState<boolean | null>(
    'timeframe-peek-visible',
    null,
  )
  const peekVisible = peekPreference ?? peekDefaultVisible(window.innerWidth)
  const [peekStored, setPeekStored] = useLocalState<TimeframePeekSettings>(
    'timeframe-peek',
    TIMEFRAME_PEEK_DEFAULTS,
  )
  const peekSettings = useMemo(() => timeframePeekSettings(peekStored), [peekStored])
  const [sidePanel, setSidePanel] = useState<'watchlist' | 'alerts' | 'notes' | 'agents' | null>(
    () => (window.innerWidth >= 1050 ? 'watchlist' : null),
  )
  const [modal, setModal] = useState<ModalName>(null)
  const [searchAdding, setSearchAdding] = useState(false)
  const [libraryTab, setLibraryTab] = useState<'built-in' | 'scripts'>('built-in')
  const [docsTab, setDocsTab] = useState<'start' | 'api' | 'shortcuts' | 'about'>('start')
  const [editingIndicator, setEditingIndicator] = useState<string | null>(null)
  const [textAnchor, setTextAnchor] = useState<Anchor | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [tool, setTool] = useState<Tool>('cursor')
  const [tick, setTick] = useState(0)
  // One-second wall clock so the 15-minute strike countdown ticks even when the feed is quiet.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [replayIndex, setReplayIndex] = useState<number | null>(null)
  const [replaySnapshot, setReplaySnapshot] = useState<Candle[] | null>(null)
  const [timeframeFeeds, setTimeframeFeeds] = useState<Record<string, IndicatorTimeframeData>>({})
  const [replayTimeframes, setReplayTimeframes] = useState<IndicatorTimeframes>({})
  const [timeframeRetry, setTimeframeRetry] = useState(0)
  const receiveTimeframe = useCallback(
    (product: string, interval: Timeframe, data: IndicatorTimeframeData) => {
      setTimeframeFeeds((previous) => ({
        ...Object.fromEntries(
          Object.entries(previous)
            .filter(([key]) => key !== `${product}:${interval}`)
            .slice(-23),
        ),
        [`${product}:${interval}`]: data,
      }))
    },
    [],
  )
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)
  const [activeRange, setActiveRange] = useState('')
  const [rangeCommand, setRangeCommand] = useState<{ bars: number; id: number } | null>(null)
  const [drawingHistory, setDrawingHistory] = useState<
    Record<string, { past: Drawing[][]; future: Drawing[][] }>
  >({})
  const [running, setRunning] = useState(false)
  const [runStatus, setRunStatus] = useState<{
    type: 'ready' | 'success' | 'error'
    message: string
  }>({ type: 'ready', message: 'Ready when you are' })
  const [computed, setComputed] = useState<Record<string, ComputedResult>>({})
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [confirmation, setConfirmation] = useState<{
    title: string
    message: string
    label: string
    action: () => void
  } | null>(null)
  const safeAgentLearning = useMemo(
    () => normalizeAgentLearningState(agentLearning),
    [agentLearning],
  )
  const safeAgentJournal = useMemo(
    () => normalizeAgentPredictionJournal(agentJournal),
    [agentJournal],
  )
  const agentHorizonBars = useMemo(() => {
    const fallback = suggestedHorizonBars(timeframe)
    const configured = Number(agentHorizons[timeframe] ?? fallback)
    return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : fallback
  }, [agentHorizons, timeframe])
  const chartRef = useRef<ChartHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const runnerRef = useRef<AbortController | null>(null)
  const cacheRef = useRef<Map<string, ScriptResult>>(new Map())
  const scriptErrors = useRef<Map<string, string>>(new Map())
  const visibleTabs = tabs.filter((s) => (source === 'coinbase' ? isProductId(s) : isDemoSymbol(s)))
  const visibleWatchlist = watchlist.filter((s) =>
    source === 'coinbase' ? isProductId(s) : isDemoSymbol(s),
  )
  const watched = [
    symbol,
    ...alerts.filter((a) => a.enabled && !a.triggeredAt).map((a) => a.symbol),
    ...watchlist,
    ...tabs,
  ].filter(isProductId)
  const live = useCoinbaseMarket({
    product: symbol,
    interval: timeframe,
    enabled: source === 'coinbase',
    playing: feedActive,
    watched,
    limit: Math.max(300, Math.min(900, rangeCommand?.bars ?? 300)),
  })
  const assets = source === 'coinbase' ? live.assets : ASSETS
  const asset = assets.find((a) => a.symbol === symbol) ?? getAsset(symbol)
  const syntheticQuotes = useMemo(() => (source === 'demo' ? demoQuotes(tick) : {}), [source, tick])
  const quotes = source === 'coinbase' ? live.quotes : syntheticQuotes
  const quotePrices = useMemo(
    () => Object.fromEntries(Object.entries(quotes).map(([id, quote]) => [id, quote.price])),
    [quotes],
  )
  const demoHistory = useMemo(
    () => (source === 'demo' ? generateCandles(asset, timeframe) : EMPTY_CANDLES),
    [source, asset, timeframe],
  )
  const simulatedCandles = useMemo(() => {
    if (source !== 'demo' || !demoHistory.length) return EMPTY_CANDLES
    const last = demoHistory[demoHistory.length - 1],
      close = syntheticQuotes[symbol]?.price ?? last.close
    return [
      ...demoHistory.slice(0, -1),
      { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) },
    ]
  }, [source, demoHistory, syntheticQuotes, symbol])
  // Live resting book comes from the Coinbase SSE stream; demo mode renders a clearly-labeled
  // synthetic book so the depth/strength feature stays explorable offline. Never both at once.
  const demoBookView = useMemo(
    () =>
      source === 'demo' && simulatedCandles.length
        ? demoBook(symbol, simulatedCandles, Date.now() / 1000)
        : null,
    [source, symbol, simulatedCandles],
  )
  const bookView = replayIndex === null ? (live.book ?? demoBookView) : null
  // Executed whale flow is live tape, not replayable history: the ensemble reads it only
  // while the chart is live, exactly like the book. Null at rest, in demo, or on a dead feed.
  const whaleSignal = replayIndex === null ? live.whaleFlow : null
  const availableCandles =
    source === 'coinbase' ? (live.snapshot?.candles ?? EMPTY_CANDLES) : simulatedCandles
  const baseCandles = replaySnapshot ?? availableCandles
  const candles = useMemo(
    () => (replayIndex === null ? baseCandles : baseCandles.slice(0, replayIndex)),
    [baseCandles, replayIndex],
  )
  const peekTimeframe = useMemo(
    () => peekResolution(peekSettings, timeframe),
    [peekSettings, timeframe],
  )
  const agentTimeframes = useMemo(() => agentContextTimeframes(timeframe), [timeframe])
  // A hidden window asks nothing of the market, and bar replay must not peek at live candles.
  const peekActive = peekVisible && replayIndex === null
  const indicatorTimeframes = useMemo(
    () =>
      requestedIndicatorTimeframes(indicators, timeframe, [
        ...(peekActive ? [peekTimeframe] : []),
        ...agentTimeframes,
      ]),
    [indicators, timeframe, peekActive, peekTimeframe, agentTimeframes],
  )
  const demoTimeframes = useMemo<IndicatorTimeframes>(
    () =>
      source !== 'demo'
        ? {}
        : Object.fromEntries(
            indicatorTimeframes.map((interval) => [
              interval,
              {
                candles: generateCandles(asset, interval),
                state: 'paused',
                message: 'Synthetic demo history; not exchange data.',
                asOf: 0,
              },
            ]),
          ),
    [source, asset, indicatorTimeframes],
  )
  const nativeTimeframes = useMemo<IndicatorTimeframes>(
    () =>
      source === 'demo'
        ? demoTimeframes
        : Object.fromEntries(
            indicatorTimeframes.flatMap((interval) => {
              const entry = timeframeFeeds[`${symbol}:${interval}`]
              return entry ? [[interval, entry]] : []
            }),
          ),
    [source, symbol, indicatorTimeframes, timeframeFeeds, demoTimeframes],
  )
  const currentPrice = quotePrices[symbol] ?? candles[candles.length - 1]?.close
  const hasData = candles.length > 1
  const feedState = source === 'coinbase' ? live.state : feedActive ? 'live' : 'paused'
  const analysisTimeframes = replayIndex === null ? nativeTimeframes : replayTimeframes
  const contextAnalyses = useMemo(
    () =>
      agentTimeframes.map((interval) => {
        const feed = analysisTimeframes[interval]
        const contextCandles = feed?.candles ?? EMPTY_CANDLES
        let analysis: MarketAnalysis | null = null
        if (contextCandles.length >= 30) {
          try {
            analysis = analyzeMarket(
              { candles: contextCandles, timeframe: interval },
              safeAgentLearning,
            )
          } catch {
            analysis = null
          }
        }
        return {
          timeframe: interval,
          state: feed?.state ?? (source === 'coinbase' ? 'loading' : 'paused'),
          analysis,
        }
      }),
    [agentTimeframes, analysisTimeframes, safeAgentLearning, source],
  )
  const contextSignals = useMemo(
    () =>
      contextAnalyses.flatMap((item) =>
        item.analysis
          ? [
              {
                timeframe: item.timeframe,
                bias: item.analysis.bias,
                score: item.analysis.score,
                confidence: item.analysis.confidence,
                regime: item.analysis.regime,
              },
            ]
          : [],
      ),
    [contextAnalyses],
  )
  const settledCandles = useMemo(
    () => (replayIndex === null && candles.length > 30 ? candles.slice(0, -1) : candles),
    [candles, replayIndex],
  )
  // The clock the strike window reads: wall time live, the replay cursor on replay.
  const strikeNowSec = useMemo(() => {
    if (replayIndex === null) return nowMs / 1000
    const anchor = candles[candles.length - 1]
    return anchor ? anchor.time + (INTERVAL_SECONDS[timeframe] ?? 60) : nowMs / 1000
  }, [replayIndex, candles, timeframe, nowMs])
  // The game every agent is playing: UP or DOWN from this strike at the cut.
  const kalshiLive = useMemo(
    () => kalshiStrike(candles, strikeNowSec, currentPrice),
    [candles, strikeNowSec, currentPrice],
  )
  const kalshiSettled = useMemo(
    () => kalshiStrike(settledCandles, strikeNowSec, currentPrice),
    [settledCandles, strikeNowSec, currentPrice],
  )
  const marketAnalysis = useMemo<MarketAnalysis | null>(() => {
    if (candles.length < 30) return null
    try {
      return analyzeMarket(
        {
          candles,
          timeframe,
          book: bookView ?? undefined,
          context: contextSignals,
          whale: whaleSignal ?? undefined,
          strike: kalshiLive ?? undefined,
        },
        safeAgentLearning,
      )
    } catch {
      return null
    }
  }, [candles, timeframe, bookView, contextSignals, whaleSignal, kalshiLive, safeAgentLearning])
  const settledMarketAnalysis = useMemo<MarketAnalysis | null>(() => {
    if (settledCandles.length < 30) return null
    try {
      return analyzeMarket(
        {
          candles: settledCandles,
          timeframe,
          book: replayIndex === null ? (bookView ?? undefined) : undefined,
          context: contextSignals,
          whale: replayIndex === null ? (live.whaleFlow ?? undefined) : undefined,
          strike: kalshiSettled ?? undefined,
        },
        safeAgentLearning,
      )
    } catch {
      return null
    }
  }, [
    settledCandles,
    timeframe,
    replayIndex,
    bookView,
    contextSignals,
    live.whaleFlow,
    kalshiSettled,
    safeAgentLearning,
  ])
  const settledFingerprint = useMemo(() => candleFingerprint(settledCandles), [settledCandles])

  const peekFeed = useMemo<TimeframePeekFeed | null>(() => {
    if (!peekActive) return null
    const peekingTheChart = peekTimeframe === timeframe
    const feed = peekingTheChart ? undefined : nativeTimeframes[peekTimeframe]
    return {
      resolution: peekTimeframe,
      chartTimeframe: timeframe,
      candles: feed?.candles ?? (peekingTheChart ? candles : EMPTY_CANDLES),
      state: feed?.state ?? feedState,
      message:
        feed?.message ??
        (source === 'coinbase'
          ? live.message
          : feedActive
            ? 'Demo feed · synthetic bars, not exchange data.'
            : 'Demo feed paused.'),
      // A resolution feed is refreshed by remounting it; the chart's own data belongs to the
      // main connection, so it retries that one instead.
      retry:
        source === 'coinbase'
          ? peekingTheChart
            ? live.retry
            : () => setTimeframeRetry((attempt) => attempt + 1)
          : undefined,
    }
  }, [
    peekActive,
    peekTimeframe,
    timeframe,
    nativeTimeframes,
    candles,
    feedState,
    source,
    live.message,
    live.retry,
    feedActive,
  ])
  const drawKey = `${symbol}:${timeframe}`
  const drawings = allDrawings[drawKey] ?? EMPTY_DRAWINGS
  const history = drawingHistory[drawKey]
  const contextKey = `${source}:${symbol}:${timeframe}`
  const fingerprint = useMemo(() => candleFingerprint(candles), [candles])
  const dataKey = `${contextKey}:${fingerprint}`
  const autoInput = useIndicatorInput(candles, contextKey)
  const autoKey = useMemo(
    () => `${autoInput.context}:${candleFingerprint(autoInput.candles)}`,
    [autoInput],
  )
  const customIndicators = useMemo(
    () => indicators.filter((i) => i.kind === 'custom' && i.visible && i.source),
    [indicators],
  )
  const customResults = useMemo(
    () =>
      Object.fromEntries(
        customIndicators.flatMap((indicator) => {
          const entry = computed[indicator.id]
          if (
            !entry ||
            !entry.dataKey.startsWith(`${contextKey}:`) ||
            entry.configKey !== configKey(indicator)
          )
            return []
          // Align by timestamp, including rolling windows and exchange data gaps.
          const timeIndex = new Map(entry.times.map((time, index) => [time, index]))
          const result = {
            ...entry.result,
            plots: entry.result.plots.map((plot) => ({
              ...plot,
              values: candles.map((c) => {
                const index = timeIndex.get(c.time)
                return index === undefined ? null : (plot.values[index] ?? null)
              }),
            })),
          }
          return [[indicator.id, result]]
        }),
      ),
    [computed, customIndicators, contextKey, candles],
  )
  const saved = scripts.some(
    (script) =>
      script.id === draft.id && script.source === draft.source && script.name === draft.name,
  )
  const activeAlertCount = alerts.filter((a) => a.enabled && !a.triggeredAt).length
  const currentChartType = CHART_TYPES.find((c) => c.id === chartType)!
  const closeModal = () => setModal(null)

  const notify = useCallback((message: string, tone: ToastMessage['tone'] = 'success') => {
    const id = uid()
    setToasts((current) => [...current.slice(-2), { id, message, tone }])
    const timer = setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      tone === 'error' ? 7500 : 4500,
    )
    timers.current.push(timer)
  }, [])
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      runnerRef.current?.abort()
    },
    [],
  )
  useEffect(() => {
    writeStored('data-source', source)
    writeStored('symbol', symbol)
    writeStored('timeframe', timeframe)
    writeStored('chart-type', chartType)
    const url = new URL(window.location.href)
    url.searchParams.set('source', source)
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('interval', timeframe)
    url.searchParams.set('style', chartType)
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }, [source, symbol, timeframe, chartType])
  useEffect(() => {
    if (!tabs.includes(symbol)) setTabs((previous) => [...previous.slice(-7), symbol])
  }, [symbol, tabs, setTabs])
  useEffect(() => {
    if (source !== 'demo' || !feedActive || replayIndex !== null) return
    const interval = setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1)
    }, 5000)
    return () => clearInterval(interval)
  }, [source, feedActive, replayIndex])
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) setNowMs(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    if (!replayPlaying) return
    const interval = setInterval(
      () =>
        setReplayIndex((index) =>
          index === null ? null : Math.min(baseCandles.length, index + 1),
        ),
      1000 / replaySpeed,
    )
    return () => clearInterval(interval)
  }, [replayPlaying, replaySpeed, baseCandles.length])
  useEffect(() => {
    if (replayPlaying && replayIndex === baseCandles.length) {
      setReplayPlaying(false)
      notify('You’ve reached the last loaded candle.', 'info')
    }
  }, [replayIndex, replayPlaying, baseCandles.length, notify])
  useEffect(() => {
    if (!rangeCommand) return
    const frame = requestAnimationFrame(() => chartRef.current?.setRange(rangeCommand.bars))
    return () => cancelAnimationFrame(frame)
  }, [rangeCommand, timeframe, hasData])

  useEffect(() => {
    if (!customIndicators.length || autoInput.candles.length < 2) return
    const controller = new AbortController()
    for (const indicator of customIndicators) {
      const spec = configKey(indicator),
        key = `${autoKey}:${spec}`
      const cached = cacheRef.current.get(key)
      if (cached) {
        setComputed((previous) =>
          previous[indicator.id]?.configKey === spec &&
          previous[indicator.id].sampledAt > autoInput.sampledAt
            ? previous
            : {
                ...previous,
                [indicator.id]: {
                  dataKey: autoKey,
                  configKey: spec,
                  result: cached,
                  times: autoInput.candles.map((c) => c.time),
                  sampledAt: autoInput.sampledAt,
                },
              },
        )
        continue
      }
      runIndicator(indicator.source!, autoInput.candles, indicator.inputValues, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          if (cacheRef.current.size > 40) cacheRef.current.clear()
          cacheRef.current.set(key, result)
          setComputed((previous) =>
            previous[indicator.id]?.configKey === spec &&
            previous[indicator.id].sampledAt > autoInput.sampledAt
              ? previous
              : {
                  ...previous,
                  [indicator.id]: {
                    dataKey: autoKey,
                    configKey: spec,
                    result,
                    times: autoInput.candles.map((c) => c.time),
                    sampledAt: autoInput.sampledAt,
                  },
                },
          )
          scriptErrors.current.delete(indicator.id)
        })
        .catch((error: Error) => {
          if (error.name === 'AbortError') return
          if (scriptErrors.current.get(indicator.id) !== error.message) {
            notify(`${indicator.name}: ${error.message}`, 'error')
            scriptErrors.current.set(indicator.id, error.message)
          }
        })
    }
    return () => controller.abort()
  }, [autoInput, autoKey, customIndicators, notify])

  useEffect(() => {
    if (replayIndex !== null || feedState !== 'live') return
    const triggered = alerts.filter(
      (alert) =>
        alert.enabled &&
        !alert.triggeredAt &&
        quotes[alert.symbol]?.source === source &&
        (alert.condition === 'above'
          ? quotePrices[alert.symbol] >= alert.price
          : quotePrices[alert.symbol] <= alert.price),
    )
    if (!triggered.length) return
    const triggeredIds = new Set(triggered.map((a) => a.id))
    setAlerts((previous) =>
      previous.map((a) =>
        triggeredIds.has(a.id) ? { ...a, triggeredAt: new Date().toISOString() } : a,
      ),
    )
    triggered.forEach((alert) =>
      notify(
        `${getAsset(alert.symbol).ticker} ${alert.condition} ${formatPrice(alert.price)} · ${alert.note || 'Your price alert was triggered.'}`,
        'info',
      ),
    )
  }, [alerts, quotePrices, quotes, source, feedState, replayIndex, setAlerts, notify])

  useEffect(() => {
    if (replayIndex !== null || settledCandles.length < 30) return
    const resolved = resolveAgentPredictionJournal(safeAgentJournal, safeAgentLearning, {
      source,
      symbol,
      timeframe,
      candles: settledCandles,
    })
    const journalWithPrediction =
      settledMarketAnalysis && safeAgentJournal.autoJournal
        ? recordAgentPrediction(resolved.journal, {
            source,
            symbol,
            timeframe,
            candles: settledCandles,
            analysis: settledMarketAnalysis,
            horizonBars: agentHorizonBars,
            // Window-mode entries settle on the strike itself, so only a defended
            // (non-provisional) strike may seed them.
            strike:
              kalshiSettled && !kalshiSettled.provisional
                ? {
                    price: kalshiSettled.price,
                    windowStart: kalshiSettled.windowStart,
                    windowEnd: kalshiSettled.windowEnd,
                  }
                : undefined,
          })
        : resolved.journal
    if (resolved.learning !== safeAgentLearning) setAgentLearning(resolved.learning)
    if (journalWithPrediction !== safeAgentJournal) setAgentJournal(journalWithPrediction)
  }, [
    replayIndex,
    safeAgentJournal,
    safeAgentLearning,
    settledMarketAnalysis,
    agentHorizonBars,
    kalshiSettled,
    source,
    symbol,
    timeframe,
    settledCandles,
    settledFingerprint,
    setAgentJournal,
    setAgentLearning,
  ])

  const openSearch = (adding = false) => {
    setSearchAdding(adding)
    setModal('symbols')
  }
  const openIndicators = (tab: 'built-in' | 'scripts' = 'built-in') => {
    setLibraryTab(tab)
    setModal('indicators')
  }
  const openDocs = (tab: typeof docsTab = 'start') => {
    setDocsTab(tab)
    setModal('docs')
  }
  const switchSource = (next: DataSource) => {
    if (next === source) return
    const target =
      next === 'coinbase'
        ? (COINBASE_DEFAULTS.find((id) => id.startsWith(`${asset.ticker}-`)) ?? 'BTC-USD')
        : (ASSETS.find((a) => a.ticker === asset.ticker)?.symbol ?? 'BTCUSDT')
    setSource(next)
    setSymbol(target)
    setReplaySnapshot(null)
    setReplayIndex(null)
    setReplayPlaying(false)
    setActiveRange('')
    setRangeCommand(null)
    setTool('cursor')
    const defaults = next === 'coinbase' ? COINBASE_DEFAULTS.slice(0, 10) : DEFAULT_WATCHLIST
    if (!watchlist.some((id) => (next === 'coinbase' ? isProductId(id) : isDemoSymbol(id))))
      setWatchlist((previous) => [...previous, ...defaults])
    setModal(null)
    notify(
      next === 'coinbase'
        ? 'Coinbase USD pairs selected. Connecting to real market data…'
        : 'Offline demo selected. All demo prices are synthetic.',
      'info',
    )
  }
  const selectSymbol = (next: string) => {
    setSource(isProductId(next) ? 'coinbase' : 'demo')
    setSymbol(next)
    setReplayIndex(null)
    setReplaySnapshot(null)
    setReplayPlaying(false)
    setActiveRange('')
    setRangeCommand(null)
    setTool('cursor')
    setModal(null)
  }
  const selectTimeframe = (next: Timeframe) => {
    setTimeframe(next)
    setReplayIndex(null)
    setReplaySnapshot(null)
    setReplayPlaying(false)
    setActiveRange('')
    setRangeCommand(null)
  }
  const toggleWatchlist = (next: string) => {
    const exists = watchlist.includes(next)
    if (!exists && visibleWatchlist.length >= 30) {
      notify('Keep up to 30 pairs per watchlist.', 'info')
      return
    }
    setWatchlist((previous) =>
      exists ? previous.filter((item) => item !== next) : [...previous, next],
    )
    notify(`${getAsset(next).ticker} ${exists ? 'removed from' : 'added to'} your watchlist.`)
  }
  const selectSearchResult = (next: string) => {
    if (searchAdding) {
      if (!watchlist.includes(next)) {
        setWatchlist((previous) => [...previous, next])
        notify(`${getAsset(next).ticker} added to your watchlist.`)
      } else notify(`${getAsset(next).ticker} is already in your watchlist.`, 'info')
    } else selectSymbol(next)
  }
  const closeTab = (next: string) => {
    if (visibleTabs.length <= 1) return
    const remaining = tabs.filter((t) => t !== next)
    setTabs(remaining)
    if (symbol === next) selectSymbol(visibleTabs.find((tab) => tab !== next)!)
  }
  const chooseTool = (next: Tool) => {
    if (!hasData && next !== 'cursor') {
      notify('Load chart data before adding drawings.', 'info')
      return
    }
    if (drawingsLocked && next !== 'cursor') {
      notify('Unlock drawings to add a new one.', 'info')
      return
    }
    setTool(next)
    if (next !== 'cursor') setDrawingsVisible(true)
  }
  const updateDrawings = (next: Drawing[]) => {
    setDrawingHistory((previous) => ({
      ...previous,
      [drawKey]: { past: [...(previous[drawKey]?.past ?? []).slice(-39), drawings], future: [] },
    }))
    setAllDrawings((previous) => ({ ...previous, [drawKey]: next }))
  }
  const addDrawing = (drawing: Drawing) => {
    if (drawings.length >= 100) {
      notify('Keep up to 100 drawings per chart. Remove one to add another.', 'error')
      return
    }
    updateDrawings([...drawings, drawing])
  }
  const undoDrawing = () => {
    if (!history?.past.length) return
    setAllDrawings((previous) => ({
      ...previous,
      [drawKey]: history.past[history.past.length - 1],
    }))
    setDrawingHistory((previous) => ({
      ...previous,
      [drawKey]: { past: history.past.slice(0, -1), future: [drawings, ...history.future] },
    }))
  }
  const redoDrawing = () => {
    if (!history?.future.length) return
    setAllDrawings((previous) => ({ ...previous, [drawKey]: history.future[0] }))
    setDrawingHistory((previous) => ({
      ...previous,
      [drawKey]: { past: [...history.past, drawings], future: history.future.slice(1) },
    }))
  }
  const toggleIndicator = (id: string) =>
    setIndicators((previous) =>
      previous.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
    )
  const removeIndicator = (id: string) => {
    setIndicators((previous) => previous.filter((i) => i.id !== id))
    setComputed((previous) => {
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
    scriptErrors.current.delete(id)
  }
  const editIndicator = (indicator: Indicator) => {
    setEditingIndicator(indicator.id)
    setModal('indicator-settings')
  }
  const addBuiltIn = (kind: Indicator['kind']) => {
    const item = INDICATOR_CATALOG.find((i) => i.kind === kind)
    if (!item || indicators.some((i) => i.kind === kind && i.period === item.period)) return
    if (indicators.length >= 16) {
      notify('The chart supports up to 16 indicators. Remove one to add another.', 'error')
      return
    }
    setIndicators((previous) => [
      ...previous,
      {
        id: uid(),
        kind,
        name:
          item.kind === 'smart-money-concepts'
            ? 'Smart Money Concepts'
            : item.kind === 'sr-breaks-retests'
              ? 'SR Breaks and Retests'
              : item.kind === 'pivot-points-missed-reversals'
                ? 'Pivot Points High Low & Missed Reversal Levels'
                : item.short === 'VOL'
                  ? 'Volume'
                  : item.short,
        period: item.period,
        color: item.color,
        visible: true,
        ...(kind === 'cm-ult-macd'
          ? { cmMacd: { ...CM_MACD_DEFAULTS }, divergence: { ...DIVERGENCE_DEFAULTS } }
          : {}),
        ...(kind === 'macd' ? { divergence: { ...DIVERGENCE_DEFAULTS } } : {}),
        ...(kind === 'smart-money-concepts' ? { smc: { ...SMC_DEFAULTS } } : {}),
        ...(kind === 'sr-breaks-retests' ? { sr: { ...SR_BREAKS_RETESTS_DEFAULTS } } : {}),
        ...(kind === 'pivot-points-missed-reversals'
          ? { pivots: { ...PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS } }
          : {}),
        ...(kind === 'coinbase-strike' ? { strike: { ...COINBASE_STRIKE_DEFAULTS } } : {}),
      },
    ])
    notify(`${item.name} added to chart.`)
  }
  const saveScript = () => {
    const script = {
      id: draft.id,
      name: draft.name.trim() || 'Untitled indicator',
      source: draft.source,
      updatedAt: new Date().toISOString(),
    }
    if (!scripts.some((s) => s.id === script.id) && scripts.length >= 30) {
      notify(
        'Your local library supports 30 scripts. Export a backup before removing older scripts.',
        'error',
      )
      return
    }
    const next = scripts.some((s) => s.id === script.id)
      ? scripts.map((s) => (s.id === script.id ? script : s))
      : [...scripts, script]
    if (!writeStored('scripts', next)) {
      notify(
        'Local storage is full or unavailable. Export your workspace to keep a backup.',
        'error',
      )
      return
    }
    setScripts(next)
    setDraft({ id: script.id, name: script.name, source: script.source })
    notify(`${script.name} saved to your library.`)
  }
  const applyScript = async (
    script: Pick<SavedScript, 'id' | 'name' | 'source'>,
    overrides?: Indicator,
  ) => {
    if (runnerRef.current) return
    if (!hasData) {
      notify('Load market candles before running an indicator.', 'info')
      return
    }
    const existing =
      overrides ?? indicators.find((i) => i.kind === 'custom' && i.scriptId === script.id)
    if (!existing && indicators.length >= 16) {
      notify('Remove an indicator before adding another (16 maximum).', 'error')
      return
    }
    const controller = new AbortController()
    runnerRef.current = controller
    setRunning(true)
    setRunStatus({ type: 'ready', message: 'Running your indicator…' })
    try {
      const inputValues = overrides?.inputValues ?? existing?.inputValues ?? {}
      const result = await runIndicator(script.source, candles, inputValues, controller.signal)
      const next: Indicator = {
        id: existing?.id ?? uid(),
        kind: 'custom',
        name: script.name.trim() || 'Untitled indicator',
        period: 20,
        color: result.plots[0].color,
        visible: overrides?.visible ?? true,
        source: script.source,
        inputValues,
        scriptId: script.id,
      }
      const spec = configKey(next)
      if (cacheRef.current.size >= 40) cacheRef.current.clear()
      cacheRef.current.set(`${dataKey}:${spec}`, result)
      setComputed((previous) => ({
        ...previous,
        [next.id]: {
          dataKey,
          configKey: spec,
          result,
          times: candles.map((c) => c.time),
          sampledAt: Date.now(),
        },
      }))
      setIndicators((previous) =>
        previous.some((i) => i.id === next.id)
          ? previous.map((i) => (i.id === next.id ? next : i))
          : [...previous, next],
      )
      setRunStatus({
        type: 'success',
        message: `Compiled successfully · ${result.plots.length} ${result.plots.length === 1 ? 'plot' : 'plots'} · ${result.duration.toFixed(1)} ms`,
      })
      notify(`${next.name} ${existing ? 'updated on' : 'added to'} your chart.`)
      if (overrides) setModal(null)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        const message = error instanceof Error ? error.message : 'Could not run this indicator.'
        setRunStatus({ type: 'error', message })
        notify(message, 'error')
      }
    } finally {
      runnerRef.current = null
      setRunning(false)
    }
  }
  const confirmDraftChange = (action: () => void) => {
    const isStarter =
      draft.source === SCRIPT_TEMPLATES[0].source && draft.name === SCRIPT_TEMPLATES[0].name
    if (!saved && !isStarter && draft.source.trim()) {
      setModal(null)
      setConfirmation({
        title: 'Keep your current idea?',
        message:
          'This script has unsaved changes. Save it to your library first, or continue to replace the editor draft. Your applied indicators will stay on the chart.',
        label: 'Replace draft',
        action,
      })
    } else action()
  }
  const loadTemplate = (name: string, source: string) =>
    confirmDraftChange(() => {
      setDraft({ id: uid(), name, source })
      setRunStatus({ type: 'ready', message: 'Ready when you are' })
      setStudioOpen(true)
      setModal(null)
    })
  const loadScript = (script: SavedScript) =>
    confirmDraftChange(() => {
      setDraft({ id: script.id, name: script.name, source: script.source })
      setRunStatus({ type: 'ready', message: 'Ready when you are' })
      setStudioOpen(true)
      setModal(null)
    })
  const saveIndicatorSettings = (indicator: Indicator) => {
    if (indicator.kind === 'custom')
      void applyScript(
        { id: indicator.scriptId ?? indicator.id, name: indicator.name, source: indicator.source! },
        indicator,
      )
    else {
      setIndicators((previous) => previous.map((i) => (i.id === indicator.id ? indicator : i)))
      setModal(null)
      notify(`${indicator.name} settings updated.`)
    }
  }
  const openAlert = () => {
    if (replayIndex !== null) {
      notify('Exit replay to create price alerts.', 'info')
      return
    }
    if (feedState !== 'live' || !quotes[symbol]) {
      notify('Price alerts require an active quote connection.', 'info')
      return
    }
    setModal('alert')
  }
  const toggleReplay = () => {
    if (replayIndex !== null) {
      setReplayIndex(null)
      setReplaySnapshot(null)
      setReplayPlaying(false)
      notify(`Back to the ${source === 'coinbase' ? 'Coinbase' : 'demo'} feed.`, 'info')
    } else {
      if (!hasData) {
        notify('Load chart history before starting replay.', 'info')
        return
      }
      setReplaySnapshot(availableCandles)
      setReplayTimeframes(nativeTimeframes)
      setReplayIndex(Math.max(2, availableCandles.length - 120))
      setReplayPlaying(false)
      notify('Bar Replay · a frozen snapshot of the loaded history.', 'info')
    }
    setRangeCommand(null)
    setActiveRange('')
    requestAnimationFrame(() => chartRef.current?.latest())
  }
  const changeRange = (range: string) => {
    const ranges: Record<string, { tf: Timeframe; bars: number }> = {
      '1D': { tf: '5m', bars: 288 },
      '5D': { tf: '1h', bars: 120 },
      '1M': { tf: '1h', bars: 720 },
      '3M': { tf: '4h', bars: 540 },
      '6M': { tf: '1D', bars: 180 },
      YTD: { tf: '1D', bars: 250 },
      '1Y': { tf: '1D', bars: 365 },
      All: { tf: '1W', bars: 900 },
    }
    const target = ranges[range]
    setTimeframe(target.tf)
    setReplayIndex(null)
    setReplaySnapshot(null)
    setReplayPlaying(false)
    setActiveRange(range)
    setRangeCommand({ bars: target.bars, id: Date.now() })
  }
  const capture = useCallback(() => chartRef.current?.snapshot() ?? Promise.resolve(null), [])
  const downloadChart = async () => {
    try {
      const blob = await capture()
      if (!blob) throw new Error('Chart not ready')
      downloadFile(`atlas-${symbol}-${timeframe}.png`, blob)
      notify('Chart snapshot downloaded.')
    } catch {
      notify('Could not export this chart. Please try again.', 'error')
    }
  }
  const exportData = () => {
    if (!hasData) {
      notify('No candle data to export yet.', 'info')
      return
    }
    const csv = [
      'time_utc,open,high,low,close,volume',
      ...candles.map((c) =>
        [new Date(c.time * 1000).toISOString(), c.open, c.high, c.low, c.close, c.volume].join(','),
      ),
    ].join('\n')
    downloadFile(`atlas-${symbol}-${timeframe}-${source}.csv`, csv, 'text/csv')
    notify(`${candles.length} ${source} candles exported.`)
  }
  const exportWorkspace = () => {
    const backup = {
      version: 1,
      dataSource: source,
      exportedAt: new Date().toISOString(),
      workspaceName,
      symbol,
      timeframe,
      chartType,
      settings,
      watchlist,
      tabs,
      indicators,
      drawings: allDrawings,
      scripts,
      draft,
      alerts,
      notes: readStored('notes', ''),
      agentLearning: safeAgentLearning,
      agentJournal: safeAgentJournal,
      agentHorizons,
    }
    downloadFile('atlas-workspace.json', JSON.stringify(backup, null, 2))
    notify('Workspace backup downloaded.')
  }
  const restoreWorkspace = (backup: WorkspaceBackup) => {
    try {
      persistWorkspaceBackup(backup)
      runnerRef.current?.abort()
      cacheRef.current.clear()
      scriptErrors.current.clear()
      setSource(backup.dataSource ?? (isProductId(backup.symbol) ? 'coinbase' : 'demo'))
      setWorkspaceName(backup.workspaceName)
      setSymbol(backup.symbol)
      setTimeframe(backup.timeframe)
      setChartType(backup.chartType)
      setSettings(backup.settings)
      setWatchlist(backup.watchlist)
      setTabs(backup.tabs)
      setIndicators(backup.indicators)
      setAllDrawings(backup.drawings)
      setScripts(backup.scripts)
      setDraft(backup.draft)
      setAlerts(backup.alerts)
      setAgentLearning(backup.agentLearning ?? defaultAgentLearningState())
      setAgentJournal(backup.agentJournal ?? defaultAgentPredictionJournal())
      setAgentHorizons({
        ...DEFAULT_AGENT_HORIZONS,
        ...(backup.agentHorizons ?? {}),
      })
      setDrawingHistory({})
      setComputed({})
      setReplayIndex(null)
      setReplaySnapshot(null)
      setReplayPlaying(false)
      setTool('cursor')
      setSidePanel('watchlist')
      setRangeCommand(null)
      setActiveRange('')
      setRunStatus({ type: 'ready', message: 'Workspace restored · ready when you are' })
      setStudioOpen(true)
      setModal(null)
      notify('Workspace restored from your backup.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not import this workspace.', 'error')
    }
  }
  const importWorkspace = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('Choose a workspace backup smaller than 5 MB.')
      const backup = parseWorkspaceBackup(JSON.parse(await file.text()))
      setModal(null)
      setConfirmation({
        title: 'Replace the current workspace?',
        message: `Import “${backup.workspaceName}”? This replaces your current scripts, drawings, alerts, settings, and notes. Export your current workspace first if you need a backup. Custom scripts from the file will run in isolated workers; only import files you trust.`,
        label: 'Import backup',
        action: () => restoreWorkspace(backup),
      })
    } catch (error) {
      notify(
        error instanceof SyntaxError
          ? 'This file is not valid workspace JSON.'
          : error instanceof Error
            ? error.message
            : 'Could not read this backup.',
        'error',
      )
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }
  const shareUrl = useMemo(() => {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('source', source)
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('interval', timeframe)
    url.searchParams.set('style', chartType)
    return url.toString()
  }, [source, symbol, timeframe, chartType])
  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      notify('Workspace link copied.')
      return true
    } catch {
      notify('Clipboard access is unavailable. Select and copy the link manually.', 'info')
      return false
    }
  }
  const togglePeek = () => setPeekPreference(!peekVisible)
  const toggleDecision = () => setAgentDecisionVisible(!agentDecisionVisible)
  const commandsRef = useRef({
    saveScript,
    applyScript,
    undoDrawing,
    redoDrawing,
    openSearch,
    chooseTool,
    openDocs,
    togglePeek,
    toggleDecision,
    draft,
    modal,
    confirmation,
  })
  commandsRef.current = {
    saveScript,
    applyScript,
    undoDrawing,
    redoDrawing,
    openSearch,
    chooseTool,
    openDocs,
    togglePeek,
    toggleDecision,
    draft,
    modal,
    confirmation,
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const cmd = commandsRef.current
      if (cmd.modal || cmd.confirmation) return
      const typing = (event.target as HTMLElement)?.closest(
        'input, textarea, select, [contenteditable="true"]',
      )
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        cmd.openSearch()
        return
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        cmd.saveScript()
        return
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault()
        void cmd.applyScript(cmd.draft)
        return
      }
      if (event.key === 'Escape') {
        cmd.chooseTool('cursor')
        setFocusMode(false)
        return
      }
      if (typing) return
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) cmd.redoDrawing()
        else cmd.undoDrawing()
      }
      if (event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        cmd.chooseTool('trend')
      }
      if (event.altKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        cmd.chooseTool('horizontal')
      }
      if (event.altKey && !mod && (event.key.toLowerCase() === 'p' || event.code === 'KeyP')) {
        event.preventDefault()
        cmd.togglePeek()
      }
      if (event.altKey && !mod && (event.key.toLowerCase() === 'a' || event.code === 'KeyA')) {
        event.preventDefault()
        cmd.toggleDecision()
      }
      if (event.key === '+' || event.key === '=') chartRef.current?.zoom(0.75)
      if (event.key === '-') chartRef.current?.zoom(1.3)
      if (event.key === '?') cmd.openDocs('shortcuts')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const indicatorToEdit = indicators.find((i) => i.id === editingIndicator)
  return (
    <div className={`app ${focusMode ? 'focus-mode' : ''}`}>
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Import workspace file"
        onChange={(event) => void importWorkspace(event.target.files?.[0])}
      />
      <header className="topbar">
        <a className="brand" href={window.location.pathname} aria-label="Atlas home">
          <svg width="29" height="30" viewBox="0 0 36 36" fill="none">
            <path d="M3 29 14.5 6h7L33 29h-8.6L18 14.7 11.6 29H3Z" fill="currentColor" />
            <path d="m15 27 3-6 3 6h-6Z" fill="currentColor" />
          </svg>
          <span>
            atlas<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className="active" onClick={() => setModal(null)}>
            <ChartNoAxesCombined size={16} />
            Chart
          </button>
          <button onClick={() => setModal('markets')}>
            Markets
            <ArrowDownToLine size={12} className="nav-market-icon" />
          </button>
          <button onClick={() => openIndicators('scripts')}>My scripts</button>
        </nav>
        <div className="workspace-switcher">
          <span className="workspace-divider" />
          <Dropdown
            trigger={() => (
              <button>
                <Grid2X2 size={14} />
                <span>{workspaceName}</span>
                <ChevronDown size={12} />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">YOUR SPACE</div>
                <MenuItem icon={Grid2X2} selected onClick={close}>
                  {workspaceName}
                </MenuItem>
                <div className="menu-divider" />
                <MenuItem
                  icon={Settings2}
                  onClick={() => {
                    setModal('workspace')
                    close()
                  }}
                >
                  Workspace settings
                </MenuItem>
                <MenuItem
                  icon={Download}
                  onClick={() => {
                    exportWorkspace()
                    close()
                  }}
                >
                  Export workspace
                </MenuItem>
                <MenuItem
                  icon={Waves}
                  selected={whaleBoxVisible}
                  onClick={() => {
                    setWhaleBoxVisible(!whaleBoxVisible)
                    close()
                  }}
                >
                  {whaleBoxVisible ? 'Hide whale flow box' : 'Show whale flow box'}
                </MenuItem>
                <MenuItem
                  icon={PictureInPicture2}
                  selected={peekVisible}
                  onClick={() => {
                    setPeekPreference(!peekVisible)
                    close()
                  }}
                >
                  {peekVisible ? 'Hide timeframe peek window' : 'Show timeframe peek window'}
                </MenuItem>
                <MenuItem
                  icon={Bot}
                  selected={agentDecisionVisible}
                  onClick={() => {
                    setAgentDecisionVisible(!agentDecisionVisible)
                    close()
                  }}
                >
                  {agentDecisionVisible ? 'Hide AI decision window' : 'Show AI decision window'}
                </MenuItem>
                <MenuItem
                  icon={Layers}
                  selected={bookBoxVisible}
                  onClick={() => {
                    setBookBoxVisible(!bookBoxVisible)
                    close()
                  }}
                >
                  {bookBoxVisible ? 'Hide book depth & strength' : 'Show book depth & strength'}
                </MenuItem>
                <MenuItem
                  icon={RotateCcw}
                  onClick={() => {
                    setSettings(DEFAULT_SETTINGS)
                    setStudioHeight(270)
                    setStudioOpen(true)
                    setSidePanel('watchlist')
                    setWhaleBoxVisible(true)
                    setBookBoxVisible(true)
                    setPeekPreference(null)
                    setAgentDecisionVisible(true)
                    close()
                    notify('Default layout restored. Your scripts and drawings are unchanged.')
                  }}
                >
                  Restore default layout
                </MenuItem>
              </>
            )}
          </Dropdown>
        </div>
        <div className="topbar-right">
          <span
            className="saved-indicator"
            title="Workspace preferences saved in this browser. No cloud sync."
          >
            <CheckCheck size={15} />
            <span>Saved locally</span>
          </span>
          <span className="topbar-divider" />
          <IconButton
            icon={Camera}
            label="Download chart snapshot"
            onClick={() => void downloadChart()}
          />
          <button className="button share-button" onClick={() => setModal('share')}>
            <Share2 size={14} />
            <span>Share</span>
          </button>
          <button
            className="avatar"
            aria-label="Your workspace"
            onClick={() => setModal('workspace')}
          >
            A<span />
          </button>
        </div>
      </header>
      <div className="workspace-layout">
        <main className="main-workspace">
          <div className="instrument-tabs">
            <div className="instrument-tab-list" role="tablist" aria-label="Open charts">
              {visibleTabs.map((tab) => {
                const item = getAsset(tab)
                return (
                  <div className={`instrument-tab ${symbol === tab ? 'selected' : ''}`} key={tab}>
                    <button
                      role="tab"
                      aria-selected={symbol === tab}
                      onClick={() => selectSymbol(tab)}
                    >
                      <CoinIcon asset={item} size={18} />
                      <strong>{item.symbol}</strong>
                      <span className={changeClass(quotes[tab]?.change)}>
                        {formatChange(quotes[tab]?.change)}
                      </span>
                    </button>
                    {visibleTabs.length > 1 && (
                      <button
                        className="tab-close"
                        onClick={() => closeTab(tab)}
                        aria-label={`Close ${tab} chart`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
              <IconButton
                icon={Plus}
                label="Open another chart"
                className="new-chart-tab"
                onClick={() => openSearch()}
              />
            </div>
            <button
              className="layout-indicator"
              onClick={() => {
                setSidePanel(sidePanel ? null : 'watchlist')
              }}
              title="Toggle watchlist"
            >
              <LayoutPanelLeft size={14} />
              <span>Chart workspace</span>
            </button>
          </div>
          <div className="chart-toolbar">
            <button className="symbol-picker" onClick={() => openSearch()}>
              <Search size={16} />
              <strong>{asset.symbol}</strong>
              <ChevronDown size={11} />
            </button>
            <span className="toolbar-separator" />
            <div className="timeframe-buttons">
              {(['1m', '3m', '5m', '15m', '1h', '4h', '1D'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  className={timeframe === tf ? 'active' : ''}
                  onClick={() => selectTimeframe(tf)}
                  aria-label={`${tf} timeframe`}
                >
                  {tf === '1D' ? 'D' : tf}
                </button>
              ))}
            </div>
            <Dropdown
              trigger={() => (
                <IconButton
                  icon={ChevronDown}
                  label="More timeframes"
                  className="small-chevron"
                  active={!['1m', '3m', '5m', '15m', '1h', '4h', '1D'].includes(timeframe)}
                />
              )}
            >
              {(close) => (
                <>
                  <div className="menu-label">TIME INTERVAL</div>
                  {TIMEFRAMES.map((tf) => (
                    <MenuItem
                      key={tf}
                      selected={timeframe === tf}
                      onClick={() => {
                        selectTimeframe(tf)
                        close()
                      }}
                    >
                      {tf === '1D'
                        ? '1 day'
                        : tf === '1W'
                          ? '1 week'
                          : tf.endsWith('h')
                            ? `${tf.slice(0, -1)} hour${tf === '1h' ? '' : 's'}`
                            : `${tf.slice(0, -1)} minute${tf === '1m' ? '' : 's'}`}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            <span className="toolbar-separator" />
            <Dropdown
              className="chart-type-picker"
              trigger={() => (
                <button
                  className="toolbar-button icon-only"
                  title={`Chart style: ${currentChartType.name}`}
                  aria-label="Choose chart style"
                >
                  <currentChartType.icon size={18} strokeWidth={1.5} />
                  <ChevronDown size={10} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="menu-label">CHART STYLE</div>
                  {CHART_TYPES.map((type) => (
                    <MenuItem
                      key={type.id}
                      icon={type.icon}
                      selected={chartType === type.id}
                      onClick={() => {
                        setChartType(type.id)
                        close()
                      }}
                    >
                      {type.name}
                    </MenuItem>
                  ))}
                </>
              )}
            </Dropdown>
            <span className="toolbar-separator" />
            <button className="toolbar-button indicator-button" onClick={() => openIndicators()}>
              <Activity size={18} strokeWidth={1.7} />
              <span>Indicators</span>
              <span className="toolbar-count">{indicators.length}</span>
            </button>
            <button className="toolbar-button alert-toolbar-button" onClick={openAlert}>
              <BellPlus size={17} strokeWidth={1.5} />
              <span>Alert</span>
            </button>
            <button
              className={`toolbar-button replay-button ${replayIndex !== null ? 'active' : ''}`}
              onClick={toggleReplay}
            >
              <SkipBack size={16} strokeWidth={1.5} />
              <span>Replay</span>
            </button>
            <button
              className={`toolbar-button peek-toggle ${peekVisible ? 'active' : ''}`}
              onClick={() => setPeekPreference(!peekVisible)}
              title="Floating window onto another timeframe (Alt P)"
              aria-pressed={peekVisible}
            >
              <PictureInPicture2 size={17} strokeWidth={1.5} />
              <span>Peek</span>
            </button>
            <button
              className={`toolbar-button ai-decision-toggle ${agentDecisionVisible ? 'active' : ''}`}
              onClick={() => setAgentDecisionVisible(!agentDecisionVisible)}
              title="Floating AI decision window (Alt A)"
              aria-pressed={agentDecisionVisible}
            >
              <Bot size={17} strokeWidth={1.5} />
              <span>AI</span>
            </button>
            <div className="chart-toolbar-right">
              <span className="toolbar-separator" />
              <IconButton
                icon={Undo2}
                label="Undo drawing (Ctrl Z)"
                disabled={!history?.past.length}
                onClick={undoDrawing}
              />
              <IconButton
                icon={Redo2}
                label="Redo drawing (Ctrl Shift Z)"
                disabled={!history?.future.length}
                onClick={redoDrawing}
              />
              <span className="toolbar-separator" />
              <IconButton
                icon={Settings2}
                label="Chart settings"
                onClick={() => setModal('settings')}
              />
              <IconButton
                icon={focusMode ? Focus : Maximize}
                label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
                active={focusMode}
                onClick={() => setFocusMode(!focusMode)}
              />
            </div>
          </div>
          <div className="chart-workspace-body">
            <aside className="drawing-toolbar" aria-label="Drawing tools">
              <div className="drawing-tools-main">
                {DRAW_TOOLS.map((item, i) => (
                  <div key={item.id}>
                    {i === 6 && <div className="drawing-separator" />}
                    <IconButton
                      icon={item.icon}
                      label={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
                      active={tool === item.id}
                      onClick={() => chooseTool(item.id)}
                    />
                  </div>
                ))}
                <div className="drawing-separator" />
                <IconButton
                  icon={Magnet}
                  label="Snap crosshair to candle prices"
                  active={magnet}
                  onClick={() => setMagnet(!magnet)}
                />
                <IconButton
                  icon={drawingsLocked ? LockKeyhole : UnlockKeyhole}
                  label={drawingsLocked ? 'Unlock drawings' : 'Lock drawings'}
                  active={drawingsLocked}
                  onClick={() => {
                    setDrawingsLocked(!drawingsLocked)
                    setTool('cursor')
                  }}
                />
                <IconButton
                  icon={drawingsVisible ? Eye : EyeOff}
                  label={drawingsVisible ? 'Hide drawings' : 'Show drawings'}
                  active={!drawingsVisible}
                  onClick={() => setDrawingsVisible(!drawingsVisible)}
                />
                <div className="drawing-separator" />
                <IconButton
                  icon={Trash2}
                  label="Remove all drawings"
                  disabled={!drawings.length}
                  onClick={() => {
                    updateDrawings([])
                    notify('Drawings removed. Use Undo to restore them.')
                  }}
                />
              </div>
              <div className="drawing-tools-bottom">
                <IconButton
                  icon={Keyboard}
                  label="Keyboard shortcuts"
                  onClick={() => openDocs('shortcuts')}
                />
                <IconButton
                  icon={HelpCircle}
                  label="Open the Atlas field guide"
                  onClick={() => openDocs()}
                />
              </div>
            </aside>
            <div className="chart-and-panels">
              <div className="chart-container">
                {source === 'coinbase' &&
                  replayIndex === null &&
                  indicatorTimeframes.map((interval) => (
                    <IndicatorTimeframeFeed
                      key={`${symbol}:${interval}:${timeframeRetry}`}
                      product={symbol}
                      interval={interval}
                      playing={feedActive}
                      onData={receiveTimeframe}
                    />
                  ))}
                <ChartView
                  ref={chartRef}
                  source={source}
                  feedState={feedState}
                  asset={asset}
                  candles={candles}
                  timeframe={timeframe}
                  chartType={chartType}
                  indicators={indicators}
                  customResults={customResults}
                  indicatorTimeframes={replayIndex === null ? nativeTimeframes : replayTimeframes}
                  settings={settings}
                  drawings={drawings}
                  drawingTool={tool}
                  drawingsVisible={drawingsVisible}
                  drawingsLocked={drawingsLocked}
                  magnet={magnet}
                  alerts={alerts}
                  onDraw={addDrawing}
                  onToolComplete={() => setTool('cursor')}
                  onTextRequest={(anchor) => {
                    setTextAnchor(anchor)
                    setModal('text')
                  }}
                  onIndicatorEdit={editIndicator}
                  onIndicatorToggle={toggleIndicator}
                  onIndicatorRemove={removeIndicator}
                  onIndicatorRetry={() => setTimeframeRetry((n) => n + 1)}
                  replay={replayIndex !== null}
                  book={bookView}
                />
                {agentDecisionVisible && hasData && replayIndex === null && (
                  <AgentDecisionBox
                    assetLabel={asset.symbol}
                    source={source}
                    timeframe={timeframe}
                    analysis={marketAnalysis}
                    context={contextAnalyses}
                    feedState={feedState}
                    onOpenPanel={() => {
                      setFocusMode(false)
                      setSidePanel('agents')
                    }}
                    onClose={() => setAgentDecisionVisible(false)}
                  />
                )}
                {source === 'coinbase' && whaleBoxVisible && replayIndex === null && (
                  <WhaleFlowBox flow={live.whaleFlow} onClose={() => setWhaleBoxVisible(false)} />
                )}
                {source === 'coinbase' && bookBoxVisible && replayIndex === null && bookView && (
                  <BookStrengthBox book={bookView} onClose={() => setBookBoxVisible(false)} />
                )}
                {peekFeed && hasData && (
                  <TimeframePeekBox
                    ticker={asset.ticker}
                    source={source}
                    settings={peekSettings}
                    onChange={setPeekStored}
                    onClose={() => setPeekPreference(false)}
                    feed={peekFeed}
                    upColor={settings.upColor}
                    downColor={settings.downColor}
                  />
                )}
                {source === 'coinbase' && !hasData && (
                  <div className="market-feedback" role="status">
                    <span
                      className={`market-feedback-icon ${live.state === 'offline' ? 'unavailable' : ''}`}
                    >
                      {live.state === 'offline' ? (
                        <WifiOff size={26} />
                      ) : (
                        <Loader2 size={26} className="spin" />
                      )}
                    </span>
                    <span className="eyebrow">
                      COINBASE · {symbol} · {timeframe}
                    </span>
                    <h2>
                      {live.state === 'offline'
                        ? 'Coinbase is unavailable'
                        : 'Connecting your perspective.'}
                    </h2>
                    <p>{live.message}</p>
                    <div className="row">
                      <button className="button button-primary" onClick={live.retry}>
                        <RefreshCw size={14} />
                        Retry Coinbase
                      </button>
                      <button
                        className="button button-secondary"
                        onClick={() => switchSource('demo')}
                      >
                        Use offline demo
                      </button>
                    </div>
                    <small>No synthetic data is shown in Coinbase mode.</small>
                  </div>
                )}
                {source === 'coinbase' &&
                  hasData &&
                  replayIndex === null &&
                  ['stale', 'reconnecting', 'offline'].includes(live.state) && (
                    <div className="market-stale-banner" role="status">
                      <WifiOff size={13} />
                      <span>{live.message}</span>
                      <button onClick={live.retry}>Retry</button>
                    </div>
                  )}
                {replayIndex !== null && (
                  <div className="replay-controls">
                    <div className="replay-label">
                      <span className="tiny-dot" />
                      BAR REPLAY
                    </div>
                    <IconButton
                      icon={SkipBack}
                      label="Replay back five bars"
                      disabled={replayIndex <= 2}
                      onClick={() => {
                        setReplayIndex(Math.max(2, replayIndex - 5))
                        requestAnimationFrame(() => chartRef.current?.latest())
                      }}
                    />
                    <IconButton
                      icon={replayPlaying ? Pause : Play}
                      label={replayPlaying ? 'Pause replay' : 'Play replay'}
                      disabled={replayIndex === baseCandles.length}
                      active={replayPlaying}
                      onClick={() => setReplayPlaying(!replayPlaying)}
                    />
                    <IconButton
                      icon={SkipForward}
                      label="Replay next bar"
                      disabled={replayIndex === baseCandles.length}
                      onClick={() => setReplayIndex(Math.min(baseCandles.length, replayIndex + 1))}
                    />
                    <button
                      className="replay-speed"
                      onClick={() =>
                        setReplaySpeed(
                          replaySpeed === 1
                            ? 2
                            : replaySpeed === 2
                              ? 5
                              : replaySpeed === 5
                                ? 10
                                : 1,
                        )
                      }
                      title="Change replay speed"
                    >
                      {replaySpeed}×
                    </button>
                    <span className="replay-progress mono">
                      {replayIndex}/{baseCandles.length}
                    </span>
                    <IconButton icon={X} label="Exit replay" onClick={toggleReplay} />
                  </div>
                )}
              </div>
              <div className="chart-bottom-bar">
                <div className="range-buttons">
                  {['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'All'].map((range) => (
                    <button
                      className={activeRange === range ? 'active' : ''}
                      key={range}
                      onClick={() => changeRange(range)}
                      aria-label={`Show ${range} range`}
                    >
                      {range}
                    </button>
                  ))}
                  <span className="range-divider" />
                  <IconButton
                    icon={RotateCcw}
                    label="Go to latest candles"
                    onClick={() => {
                      chartRef.current?.latest()
                      setActiveRange('')
                    }}
                  />
                </div>
                <div className="chart-scale-controls">
                  <Clock />
                  <span className="toolbar-separator" />
                  <button
                    className={settings.priceMode === 'percent' ? 'active' : ''}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        priceMode: settings.priceMode === 'percent' ? 'normal' : 'percent',
                      })
                    }
                    title="Percentage price scale"
                  >
                    %
                  </button>
                  <button
                    className={settings.priceMode === 'log' ? 'active' : ''}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        priceMode: settings.priceMode === 'log' ? 'normal' : 'log',
                      })
                    }
                    title="Logarithmic price scale"
                  >
                    log
                  </button>
                  <button
                    className={`auto-scale ${settings.autoScale ? 'active' : ''}`}
                    onClick={() => setSettings({ ...settings, autoScale: !settings.autoScale })}
                  >
                    auto
                  </button>
                </div>
              </div>
              <IndicatorStudio
                name={draft.name}
                source={draft.source}
                onNameChange={(name) => setDraft({ ...draft, name })}
                onSourceChange={(source) => {
                  setDraft({ ...draft, source })
                  setRunStatus({ type: 'ready', message: 'Draft updated · add to chart to apply' })
                }}
                onRun={() => void applyScript(draft)}
                onSave={saveScript}
                onTemplate={loadTemplate}
                scripts={scripts}
                onLoadScript={loadScript}
                saved={saved}
                running={running}
                status={runStatus}
                open={studioOpen}
                onOpenChange={setStudioOpen}
                height={studioHeight}
                onHeightChange={setStudioHeight}
                onDocs={() => openDocs('api')}
                indicators={indicators}
                drawings={drawings}
                onIndicatorToggle={toggleIndicator}
                onIndicatorRemove={removeIndicator}
                onIndicatorEdit={editIndicator}
                onDrawingRemove={(id) => updateDrawings(drawings.filter((d) => d.id !== id))}
                candles={candles}
                dataSource={source}
                onExportData={exportData}
              />
            </div>
          </div>
        </main>
        {sidePanel === 'watchlist' && (
          <Watchlist
            symbols={visibleWatchlist}
            source={source}
            feedState={feedState}
            selected={asset}
            quotes={quotes}
            onSelect={selectSymbol}
            onAdd={() => openSearch(true)}
            onToggleWatchlist={toggleWatchlist}
            onAlert={openAlert}
            onClose={() => setSidePanel(null)}
            onMarkets={() => setModal('markets')}
          />
        )}
        {sidePanel === 'alerts' && (
          <AlertsPanel
            alerts={alerts}
            source={source}
            connected={feedState === 'live' && replayIndex === null}
            onAdd={openAlert}
            onRemove={(id) => setAlerts((previous) => previous.filter((a) => a.id !== id))}
            onToggle={(id) =>
              setAlerts((previous) =>
                previous.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)),
              )
            }
            onSelect={selectSymbol}
            onClose={() => setSidePanel(null)}
          />
        )}
        {sidePanel === 'notes' && <NotesPanel onClose={() => setSidePanel(null)} />}
        {sidePanel === 'agents' && (
          <AgentPanel
            assetLabel={asset.symbol}
            source={source}
            timeframe={timeframe}
            analysis={marketAnalysis}
            context={contextAnalyses}
            learning={safeAgentLearning}
            journal={safeAgentJournal}
            horizonBars={agentHorizonBars}
            onClose={() => setSidePanel(null)}
            onToggleAutoJournal={(autoJournal) =>
              setAgentJournal((previous) => ({
                ...previous,
                autoJournal,
                updatedAt: new Date().toISOString(),
              }))
            }
            onHorizonBarsChange={(bars) =>
              setAgentHorizons((previous) => ({
                ...previous,
                [timeframe]: bars,
              }))
            }
            onClearJournal={() => {
              setAgentJournal(defaultAgentPredictionJournal())
              notify('Agent journal cleared.', 'info')
            }}
            onResetLearning={() => {
              setAgentLearning(defaultAgentLearningState())
              notify('Agent learning reset to neutral weights.', 'info')
            }}
          />
        )}
        <aside className="activity-rail" aria-label="Workspace sidebar">
          <div>
            <IconButton
              icon={List}
              label="Toggle watchlist"
              active={sidePanel === 'watchlist'}
              onClick={() => setSidePanel(sidePanel === 'watchlist' ? null : 'watchlist')}
            />
            <div className="rail-alert-button">
              <IconButton
                icon={Bell}
                label="Toggle alerts"
                active={sidePanel === 'alerts'}
                onClick={() => setSidePanel(sidePanel === 'alerts' ? null : 'alerts')}
              />
              {activeAlertCount > 0 && <span>{activeAlertCount}</span>}
            </div>
            <IconButton
              icon={Bot}
              label="Toggle agent panel"
              active={sidePanel === 'agents'}
              onClick={() => setSidePanel(sidePanel === 'agents' ? null : 'agents')}
            />
            <IconButton
              icon={Code2}
              label="Open script library"
              active={modal === 'indicators' && libraryTab === 'scripts'}
              onClick={() => openIndicators('scripts')}
            />
            <IconButton
              icon={NotebookPen}
              label="Toggle trading notes"
              active={sidePanel === 'notes'}
              onClick={() => setSidePanel(sidePanel === 'notes' ? null : 'notes')}
            />
            <div className="drawing-separator" />
            <IconButton
              icon={ChartNoAxesCombined}
              label="Market overview"
              onClick={() => setModal('markets')}
            />
          </div>
          <div>
            <IconButton
              icon={PanelRightClose}
              label={sidePanel ? 'Hide sidebar' : 'Show sidebar'}
              onClick={() => setSidePanel(sidePanel ? null : 'watchlist')}
            />
            <IconButton icon={CircleHelp} label="About Atlas" onClick={() => openDocs('about')} />
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <div>
          <Dropdown
            trigger={() => (
              <button
                className={`feed-status ${feedState !== 'live' || replayIndex !== null ? 'paused' : ''}`}
                aria-label="Market data source and connection"
                title={source === 'coinbase' ? live.message : 'Synthetic offline data'}
              >
                <span className="connection-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  {replayIndex !== null
                    ? 'Bar replay'
                    : source === 'demo'
                      ? feedActive
                        ? 'Demo feed connected'
                        : 'Demo feed paused'
                      : `Coinbase · ${feedState === 'live' ? 'live' : feedState}`}
                </span>
                <ChevronDown size={10} />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">MARKET DATA SOURCE</div>
                <MenuItem
                  selected={source === 'coinbase'}
                  onClick={() => {
                    switchSource('coinbase')
                    close()
                  }}
                >
                  Coinbase · real USD markets
                </MenuItem>
                <MenuItem
                  selected={source === 'demo'}
                  onClick={() => {
                    switchSource('demo')
                    close()
                  }}
                >
                  Offline demo · synthetic prices
                </MenuItem>
                <div className="menu-divider" />
                <div className="feed-menu-description">
                  {source === 'coinbase'
                    ? `${live.message} 3m candles are aggregated from Coinbase 1m candles; current bars are provisional.`
                    : 'Illustrative OHLCV. Quotes are generated locally, not from an exchange.'}
                </div>
                <MenuItem
                  icon={feedActive ? Pause : Play}
                  onClick={() => {
                    setFeedActive(!feedActive)
                    close()
                  }}
                >
                  {feedActive ? 'Pause feed updates' : 'Resume feed updates'}
                </MenuItem>
                {source === 'coinbase' && (
                  <MenuItem
                    icon={RefreshCw}
                    onClick={() => {
                      live.retry()
                      close()
                    }}
                  >
                    Reconnect Coinbase
                  </MenuItem>
                )}
              </>
            )}
          </Dropdown>
          <span className="status-divider" />
          <span className="status-market">
            <span className="tiny-dot" />
            {asset.ticker} / {quoteCurrency(asset)}
            <span>·</span>
            {source === 'coinbase' ? 'Coinbase' : 'Demo'}
          </span>
        </div>
        <div className="statusbar-center">
          <LockKeyhole size={10} />A space to see things differently.
        </div>
        <div className="statusbar-right">
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noreferrer"
            title="Powered by TradingView Lightweight Charts™"
          >
            Charts by TradingView
          </a>
          <span className="status-divider" />
          <button onClick={() => openDocs('shortcuts')}>
            <Keyboard size={12} />
            <span>Shortcuts</span>
          </button>
          <span className="version-label">v0.2</span>
        </div>
      </footer>

      <Suspense fallback={null}>
        {modal === 'symbols' && (
          <SymbolSearch
            onClose={closeModal}
            onSelect={selectSearchResult}
            watchlist={visibleWatchlist}
            assets={assets}
            quotes={quotes}
            source={source}
            verified={source === 'demo' || live.verified}
            onToggleWatchlist={toggleWatchlist}
            adding={searchAdding}
          />
        )}
        {modal === 'indicators' && (
          <IndicatorLibrary
            onClose={closeModal}
            indicators={indicators}
            onAdd={addBuiltIn}
            scripts={scripts}
            onEditScript={loadScript}
            onApplyScript={(script) => {
              void applyScript(script)
              closeModal()
            }}
            onDeleteScript={(id) => {
              closeModal()
              setConfirmation({
                title: 'Remove this saved script?',
                message:
                  'The script will be removed from your local library. Applied copies and the current editor draft will not be removed.',
                label: 'Remove script',
                action: () => {
                  setScripts((previous) => previous.filter((s) => s.id !== id))
                  notify('Script removed from your library.')
                },
              })
            }}
            onNew={() =>
              loadTemplate(
                'Untitled indicator',
                '// Build something uniquely yours.\n\nplot(close, { title: "Close", color: "#b9ee82" });',
              )
            }
            onDocs={() => openDocs('api')}
            initialTab={libraryTab}
          />
        )}
        {modal === 'settings' && (
          <ChartSettingsDialog settings={settings} onChange={setSettings} onClose={closeModal} />
        )}
        {modal === 'indicator-settings' && indicatorToEdit && (
          <IndicatorSettingsDialog
            indicator={indicatorToEdit}
            result={customResults[indicatorToEdit.id]}
            onSave={saveIndicatorSettings}
            onClose={closeModal}
            onEditSource={() =>
              loadScript({
                id: indicatorToEdit.scriptId ?? uid(),
                name: indicatorToEdit.name,
                source: indicatorToEdit.source!,
                updatedAt: new Date().toISOString(),
              })
            }
          />
        )}
        {modal === 'alert' && currentPrice !== undefined && (
          <AlertDialog
            asset={asset}
            currentPrice={currentPrice}
            source={source}
            onClose={closeModal}
            onCreate={(alert) => {
              if (feedState !== 'live') {
                notify('Connection lost. Reconnect before creating this alert.', 'info')
                return
              }
              if (alerts.length >= 50) {
                notify('Remove an old alert before adding another (50 maximum).', 'error')
                return
              }
              setAlerts((previous) => [
                ...previous,
                { ...alert, id: uid(), createdAt: new Date().toISOString(), enabled: true },
              ])
              closeModal()
              setSidePanel('alerts')
              notify(`Watching ${asset.ticker} ${alert.condition} ${formatPrice(alert.price)}.`)
            }}
          />
        )}
        {modal === 'share' && (
          <ShareDialog
            url={shareUrl}
            onClose={closeModal}
            onCopy={copyShareUrl}
            onDownload={() => void downloadChart()}
            capture={capture}
          />
        )}
        {modal === 'markets' && (
          <MarketsDialog
            onClose={closeModal}
            onSelect={selectSymbol}
            assets={assets}
            quotes={quotes}
            source={source}
            verified={source === 'demo' || live.verified}
          />
        )}
        {modal === 'docs' && (
          <DocsDialog onClose={closeModal} onTemplate={loadTemplate} initialTab={docsTab} />
        )}
        {modal === 'workspace' && (
          <WorkspaceDialog
            name={workspaceName}
            onNameChange={setWorkspaceName}
            onExport={exportWorkspace}
            onImport={() => importRef.current?.click()}
            onClose={closeModal}
          />
        )}
        {modal === 'text' && textAnchor && (
          <TextNoteDialog
            onClose={closeModal}
            onAdd={(text) => {
              addDrawing({ id: uid(), tool: 'text', start: textAnchor, color: '#90b6ff', text })
              closeModal()
              setTextAnchor(null)
            }}
          />
        )}
        {confirmation && (
          <ConfirmDialog
            title={confirmation.title}
            message={confirmation.message}
            actionLabel={confirmation.label}
            onClose={() => setConfirmation(null)}
            onConfirm={() => {
              confirmation.action()
              setConfirmation(null)
            }}
          />
        )}
      </Suspense>
      <ToastHost
        toasts={toasts}
        dismiss={(id) => setToasts((previous) => previous.filter((t) => t.id !== id))}
      />
    </div>
  )
}
