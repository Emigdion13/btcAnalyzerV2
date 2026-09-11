export type {
  DataSource,
  MarketQuote,
  ConnectionState,
  CoinbaseProduct,
} from '../../shared/coinbase'
export type Timeframe = import('../../shared/coinbase').Interval
export type ChartType = 'candles' | 'hollow' | 'line' | 'area' | 'bars'
export type Tool =
  'cursor' | 'trend' | 'horizontal' | 'rectangle' | 'fibonacci' | 'measure' | 'text'
export type IndicatorKind =
  | 'ema'
  | 'sma'
  | 'bb'
  | 'rsi'
  | 'macd'
  | 'cm-ult-macd'
  | 'smart-money-concepts'
  | 'sr-breaks-retests'
  | 'pivot-points-missed-reversals'
  | 'coinbase-strike'
  | 'scalpswing'
  | 'next-pivot'
  | 'vwap'
  | 'volume'
  | 'custom'
export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
export interface Asset {
  symbol: string
  ticker: string
  name: string
  price: number
  change: number
  color: string
  icon: string
  volume: string
  marketCap: string
  quoteCurrency?: string
  priceIncrement?: number
  category: 'Layer 1' | 'DeFi' | 'Other'
}
export interface CmMacdSettings {
  useCurrentRes: boolean
  resCustom: Timeframe
  fastLength: number
  slowLength: number
  signalLength: number
  showLines: boolean
  showDots: boolean
  showHistogram: boolean
  macdColorChange: boolean
  histogramColorChange: boolean
}

/**
 * Divergence detection shared by both the conventional MACD and CM_Ult_MacD_MTF.
 * Pivots are found on the MACD histogram and compared against price pivots.
 * Regular divergences warn of reversals; hidden divergences confirm the trend.
 */
export interface DivergenceSettings {
  showRegular: boolean
  showHidden: boolean
  /** Bars on each side of a histogram pivot required to confirm it. */
  pivotLookback: number
  /** Maximum bars between two compared pivots. */
  rangeUpper: number
  /** Minimum bars between two compared pivots. */
  rangeLower: number
  showLines: boolean
  showLabels: boolean
}
export const DIVERGENCE_DEFAULTS: Readonly<DivergenceSettings> = {
  showRegular: true,
  showHidden: true,
  pivotLookback: 5,
  rangeUpper: 60,
  rangeLower: 5,
  showLines: true,
  showLabels: true,
}

/** Settings for Atlas's independent Smart Money Concepts implementation. */
export type SMCStructureFilter = 'All' | 'BOS' | 'CHoCH'
export type SMCLabelSize = 'Tiny' | 'Small' | 'Normal'
export type SMCOrderBlockFilter = 'Atr' | 'Cumulative Mean Range'
export type SMCOrderBlockMitigation = 'High/Low' | 'Close'
export type SMCLineStyle = '⎯⎯⎯' | '----' | '····'
export interface SmartMoneyConceptsSettings {
  mode: 'Historical' | 'Present'
  style: 'Colored' | 'Monochrome'
  colorCandles: boolean
  showInternal: boolean
  internalBullish: SMCStructureFilter
  internalBearish: SMCStructureFilter
  internalLabelSize: SMCLabelSize
  confluenceFilter: boolean
  showSwing: boolean
  swingBullish: SMCStructureFilter
  swingBearish: SMCStructureFilter
  swingLabelSize: SMCLabelSize
  showSwingPoints: boolean
  showStrongWeakHighsLows: boolean
  swingLength: number
  showInternalOrderBlocks: boolean
  internalOrderBlockCount: number
  showSwingOrderBlocks: boolean
  swingOrderBlockCount: number
  orderBlockFilter: SMCOrderBlockFilter
  orderBlockMitigation: SMCOrderBlockMitigation
  highlightMitigatedBlocks: boolean
  showEqualHighLow: boolean
  equalHighLowBars: number
  equalHighLowThreshold: number
  equalHighLowLabelSize: SMCLabelSize
  showFairValueGaps: boolean
  fvgAutoThreshold: boolean
  /** Empty string means the active chart resolution. */
  fvgTimeframe: '' | Timeframe
  fvgExtend: number
  showDailyHighLow: boolean
  dailyLineStyle: SMCLineStyle
  showWeeklyHighLow: boolean
  weeklyLineStyle: SMCLineStyle
  showMonthlyHighLow: boolean
  monthlyLineStyle: SMCLineStyle
  showPremiumDiscount: boolean
}

/**
 * Familiar SMC defaults, intentionally expressed as original Atlas settings.
 * The compact summary reads: Historical, Colored, All, All, Tiny, All, All,
 * Small, 50, 5, 5, Atr, High/Low, 3, 0.1, Tiny, current chart, 1, solid.
 */
export const SMC_DEFAULTS: Readonly<SmartMoneyConceptsSettings> = {
  mode: 'Historical',
  style: 'Colored',
  colorCandles: false,
  showInternal: true,
  internalBullish: 'All',
  internalBearish: 'All',
  internalLabelSize: 'Tiny',
  confluenceFilter: false,
  showSwing: true,
  swingBullish: 'All',
  swingBearish: 'All',
  swingLabelSize: 'Small',
  showSwingPoints: true,
  showStrongWeakHighsLows: true,
  swingLength: 50,
  showInternalOrderBlocks: true,
  internalOrderBlockCount: 5,
  showSwingOrderBlocks: true,
  swingOrderBlockCount: 5,
  orderBlockFilter: 'Atr',
  orderBlockMitigation: 'High/Low',
  highlightMitigatedBlocks: true,
  showEqualHighLow: true,
  equalHighLowBars: 3,
  equalHighLowThreshold: 0.1,
  equalHighLowLabelSize: 'Tiny',
  showFairValueGaps: true,
  fvgAutoThreshold: true,
  fvgTimeframe: '',
  fvgExtend: 1,
  showDailyHighLow: true,
  dailyLineStyle: '⎯⎯⎯',
  showWeeklyHighLow: true,
  weeklyLineStyle: '⎯⎯⎯',
  showMonthlyHighLow: true,
  monthlyLineStyle: '⎯⎯⎯',
  showPremiumDiscount: true,
}

/**
 * Settings for the Atlas port of ChartPrime's published "Support and
 * Resistance (High Volume Boxes)" indicator, whose TradingView short title is
 * "SR Breaks and Retests [ChartPrime]" and whose legend reads (20, 2, 1).
 */
export interface SrBreaksRetestsSettings {
  /** Bars on each side of a close pivot. Pine input: "Lookback Period" (20). */
  lookbackPeriod: number
  /** Delta-volume filter window. Pine input: "Delta Volume Filter Length" (2). */
  volumeFilterLength: number
  /** Zone depth as an ATR(200) multiple. Pine input: "Adjust Box Width" (1). */
  boxWidth: number
}

/** The published defaults, rendered in the legend as (20, 2, 1). */
export const SR_BREAKS_RETESTS_DEFAULTS: Readonly<SrBreaksRetestsSettings> = {
  lookbackPeriod: 20,
  volumeFilterLength: 2,
  boxWidth: 1,
}

/**
 * Settings for the Atlas port of LuxAlgo's open-source "Pivot Points High
 * Low & Missed Reversal Levels", whose TradingView legend reads
 * "Pivot Points High Low & Missed Reversal Levels [LuxAlgo] (50)". The fields
 * mirror the published inputs one for one.
 */
export interface PivotPointsMissedReversalsSettings {
  /** Pine input: `input(50, 'Pivot Length')` — bars on each side of a pivot. */
  pivotLength: number
  /** Pine input: 'Regular Pivots' toggle (true). */
  showRegular: boolean
  /** Pine input: regular pivot 'High' color (#ef5350). */
  regularHighColor: string
  /** Pine input: regular pivot 'Low' color (#26a69a). */
  regularLowColor: string
  /** Pine input: 'Missed Pivots' toggle (true). */
  showMissed: boolean
  /** Pine input: missed pivot 'High' color (#ef5350). */
  missedHighColor: string
  /** Pine input: missed pivot 'Low' color (#26a69a). */
  missedLowColor: string
  /** Pine input: 'Text Label Color' (color.white). */
  labelTextColor: string
}

/** The published defaults; the legend renders them as (50). */
export const PIVOT_POINTS_MISSED_REVERSALS_DEFAULTS: Readonly<PivotPointsMissedReversalsSettings> =
  {
    pivotLength: 50,
    showRegular: true,
    regularHighColor: '#ef5350',
    regularLowColor: '#26a69a',
    showMissed: true,
    missedHighColor: '#ef5350',
    missedLowColor: '#26a69a',
    labelTextColor: '#ffffff',
  }

export interface CoinbaseStrikeSettings {
  /** Contract interval in minutes (5, 15, 30, 60, 240, 1440, etc.). */
  intervalMinutes: number
  /** Buffer / Target spread in USD. */
  buffer: number
  /** Whether to show upper/lower target buffer lines. */
  showTargets: boolean
  /** Whether to display the live UP/DOWN status badge on chart. */
  showStatusBadge: boolean
  /** Optional custom strike override (0 = auto interval open price). */
  customStrike: number
  /** Strike line color (default: #f5a623). */
  strikeColor: string
  /** Bullish / UP winning color (default: #2bb99b). */
  upColor: string
  /** Bearish / DOWN winning color (default: #ed6773). */
  downColor: string
}

export const COINBASE_STRIKE_DEFAULTS: Readonly<CoinbaseStrikeSettings> = {
  intervalMinutes: 15,
  buffer: 50,
  showTargets: false,
  showStatusBadge: true,
  customStrike: 0,
  strikeColor: '#f5a623',
  upColor: '#2bb99b',
  downColor: '#ed6773',
}

export interface ScalpSwingSettings {
  /** High/Low PAC length – Pine input \"High Low PAC Length\" (10). */
  pacLength: number
  /** Filter alerts with EMA – Pine input \"Filter PAC Alerts with 200ema\" */
  filterWithEma: boolean
  /** EMA filter length – 200 in original, 180 for 1m pane */
  emaFilterLength: number
  /** Show PAC channel lines (high/low/close EMA) */
  showPacChannel: boolean
  /** Show EMA filter line */
  showEmaFilter: boolean
  /** Use big aqua/fuchsia arrows (plotarrow) instead of small green/red */
  useBigArrows: boolean
  /** Show BUY/SELL text labels next to arrows */
  showLabels: boolean
  /** Replicate original [1] offset – arrow appears one bar after breakout */
  signalOnNextBar: boolean
  /** Buy arrow color */
  buyColor: string
  /** Sell arrow color */
  sellColor: string
}

export const SCALPSWING_DEFAULTS: Readonly<ScalpSwingSettings> = {
  pacLength: 10,
  filterWithEma: false,
  emaFilterLength: 200,
  showPacChannel: false,
  showEmaFilter: false,
  useBigArrows: false,
  showLabels: true,
  signalOnNextBar: true,
  buyColor: '#26a69a',
  sellColor: '#ef5350',
}

/**
 * Similarity measures supported by "The Next Pivot" indicator.
 * Mirrors Kioseff Trading's published options plus Atlas's own additions.
 */
export type NextPivotSimilarity =
  | 'cosine'
  | 'pearson'
  | 'spearman'
  | 'euclidean'
  | 'mse'
  | 'kendall'
  | 'dtw'
export type NextPivotSource = 'price' | 'pctChange'

/**
 * Settings for the Atlas port of Kioseff Trading's "The Next Pivot"
 * indicator. The published legend reads (20, 50, Cosine Similarity, Price, 5000, 1).
 * Atlas adds several accuracy upgrades that default on: ensemble top-K blending,
 * z-normalized similarity, confidence bands, and DTW matching.
 */
export interface NextPivotSettings {
  /** Pine input: "Correlation Length" (20) – bars in the look-back window. */
  correlationLength: number
  /** Pine input: "Forecast Length" (50) – bars projected forward. */
  forecastLength: number
  /** Pine input: "Similarity Calculation" – defaults to "Cosine Similarity". */
  similarity: NextPivotSimilarity
  /** Pine input: "Looks For Similarities In" – Price or %Change. */
  source: NextPivotSource
  /** Pine input: "Bars Back To Search" (5000). */
  barsBack: number
  /** Pine input: "Show Projected Price Path". */
  showPricePath: boolean
  /** Pine input: "Show Projected Zig Zag". */
  showZigZag: boolean
  /** Pine input: Lin Reg channel toggle. */
  showLinReg: boolean
  /** Pine input: Lin Reg σ multiplier (1). */
  linRegSigma: number
  /** Forecast price path color. */
  forecastColor: string
  /** Projected ZigZag color. */
  zigZagColor: string
  /** LinReg channel color. */
  linRegColor: string
  // === Atlas accuracy upgrades (the "double accurate, triple great" part) ===
  /** Use an ensemble of the top-K most similar sequences (weighted by similarity). */
  ensembleTopK: number
  /** Z-normalize sequences before comparing – fixes price-level bias in raw cosine. */
  zNormalize: boolean
  /** Show shaded confidence band from the ensemble dispersion. */
  showConfidenceBand: boolean
  /** Highlight the matched historical window with a shaded box (like original). */
  showMatchBox: boolean
  /** Show an info label with similarity score and match location. */
  showInfoLabel: boolean
  /** ZigZag pivot legs (5 in original; smaller = more sensitive). */
  zigZagLegs: number
}

/** Published defaults; legend renders (20, 50, Cosine Similarity, Price, 5000, 1). */
export const NEXT_PIVOT_DEFAULTS: Readonly<NextPivotSettings> = {
  correlationLength: 20,
  forecastLength: 50,
  similarity: 'cosine',
  source: 'price',
  barsBack: 5000,
  showPricePath: true,
  showZigZag: true,
  showLinReg: false,
  linRegSigma: 1,
  forecastColor: '#ffffff',
  zigZagColor: '#14D990',
  linRegColor: '#6929F2',
  ensembleTopK: 5,
  zNormalize: true,
  showConfidenceBand: true,
  showMatchBox: true,
  showInfoLabel: true,
  zigZagLegs: 5,
}

export interface Plot {
  title: string
  color: string
  values: (number | null)[]
  pane: 'price' | 'oscillator'
  lineWidth: number
  // Native built-ins only. The custom-script sandbox still accepts line plots only.
  style?: 'line' | 'histogram' | 'circles'
  colors?: string[]
  horizontalLine?: number
  hideLegend?: boolean
}
export interface ScriptInput {
  name: string
  value: number
  min: number
  max: number
}
export interface ScriptResult {
  plots: Plot[]
  inputs: ScriptInput[]
  duration: number
}
export interface Indicator {
  id: string
  kind: IndicatorKind
  name: string
  period: number
  color: string
  visible: boolean
  source?: string
  inputValues?: Record<string, number>
  scriptId?: string
  cmMacd?: CmMacdSettings
  /** MACD histogram divergence overlay, valid for `macd` and `cm-ult-macd`. */
  divergence?: DivergenceSettings
  smc?: SmartMoneyConceptsSettings
  sr?: SrBreaksRetestsSettings
  pivots?: PivotPointsMissedReversalsSettings
  strike?: CoinbaseStrikeSettings
  scalpswing?: ScalpSwingSettings
  nextPivot?: NextPivotSettings
}
export interface SavedScript {
  id: string
  name: string
  source: string
  updatedAt: string
}
export interface Anchor {
  time: number
  price: number
}
export interface Drawing {
  id: string
  tool: Exclude<Tool, 'cursor'>
  start: Anchor
  end?: Anchor
  text?: string
  color: string
}
export interface PriceAlert {
  id: string
  symbol: string
  condition: 'above' | 'below'
  price: number
  note: string
  createdAt: string
  triggeredAt?: string
  enabled: boolean
}
export interface ChartSettings {
  grid: boolean
  crosshair: boolean
  upColor: string
  downColor: string
  background: string
  priceMode: 'normal' | 'log' | 'percent'
  autoScale: boolean
}
export const DEFAULT_SETTINGS: ChartSettings = {
  grid: true,
  crosshair: true,
  upColor: '#2bb99b',
  downColor: '#ed6773',
  background: '#101318',
  priceMode: 'normal',
  autoScale: true,
}
export const DEFAULT_INDICATORS: Indicator[] = [
  {
    id: 'smart-money-concepts',
    kind: 'smart-money-concepts',
    name: 'Smart Money Concepts',
    period: 50,
    color: '#089981',
    visible: true,
    smc: { ...SMC_DEFAULTS },
  },
  { id: 'ema-20', kind: 'ema', name: 'EMA', period: 20, color: '#d6ad68', visible: true },
  { id: 'ema-50', kind: 'ema', name: 'EMA', period: 50, color: '#7796e8', visible: true },
  { id: 'volume', kind: 'volume', name: 'Volume', period: 20, color: '#2bb99b', visible: true },
  { id: 'rsi-14', kind: 'rsi', name: 'RSI', period: 14, color: '#ad91e5', visible: true },
  {
    id: 'cm-ult-macd',
    kind: 'cm-ult-macd',
    name: 'CM_Ult_MacD_MTF',
    period: 12,
    color: '#00ff00',
    visible: true,
    divergence: { ...DIVERGENCE_DEFAULTS },
  },
]
