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
  | 'rsi-divergence'
  | 'macd'
  | 'cm-ult-macd'
  | 'cm-williams-vix-fix'
  | 'smart-money-concepts'
  | 'sr-breaks-retests'
  | 'pivot-points-missed-reversals'
  | 'coinbase-strike'
  | 'scalpswing'
  | 'tux-ema-scalper'
  | 'tmo-scalper'
  | 'next-pivot'
  | 'chile-reversal'
  | 'randy-v8'
  | 'zeiierman-trend-pressure'
  | 'wave-trend'
  | 'bayesian-nqqe-bankfunds'
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
  /**
   * Watchlist grouping. 'Metals' is the Kalshi-settled precious metals, which are neither
   * a layer-1 token nor a DeFi one — they are not crypto at all.
   */
  category: 'Layer 1' | 'DeFi' | 'Other' | 'Metals'
}
/**
 * The published TimeFrame choices of TMO Scalper. Pine options 'M' and longer have no
 * streamable chart feed in Atlas and are intentionally absent.
 */
export type TmoResolution =
  | '1'
  | '2'
  | '3'
  | '5'
  | '10'
  | '15'
  | '20'
  | '30'
  | '45'
  | '60'
  | '120'
  | '180'
  | '240'
  | 'D'
  | '2D'
  | '3D'
  | '4D'
  | 'W'
  | '2W'
  | '3W'

/**
 * Published inputs of L&L Capital's TMO Scalper, with the strategy-profile additions the
 * published legend (1, 5, 30, 14, 5, 3, 3, 2, 9, -9) lists after the signal settings:
 * the extreme overbought/oversold levels and the two arrow toggles.
 */
export interface TmoScalperSettings {
  /** Pine input: `TimeFrame1` ('1') — the fast wheel, usually the chart's own minutes. */
  timeframe1: TmoResolution
  /** Pine input: `TimeFrame2` ('5') — the wheel TMO 1 crosses are gated and traded by. */
  timeframe2: TmoResolution
  /** Pine input: `TimeFrame3` ('30') — the slow wheel that gates TMO 2. */
  timeframe3: TmoResolution
  /** Pine input: `Length` (14) — bars of close-vs-open sums before smoothing. */
  tmoLength: number
  /** Pine input: `Calc Length` (5) — first EMA smoothing of the sums. */
  calcLength: number
  /** Pine input: `Smooth Length` (3) — Main EMA and Signal EMA length. */
  smoothLength: number
  /** Pine input: `Signal Size` (3) — the cross-dot radius. */
  signalSize: number
  /**
   * Pine input: `Signal Offset` — how far a cross dot sits off the Main line. Published
   * default 0; the documented (3, 2) signal profile pins it to 2.
   */
  signalOffset: number
  /** Extreme overbought level (9) for the TMO 2 extreme flags. */
  extremeOb: number
  /** Extreme oversold level (-9) for the TMO 2 extreme flags. */
  extremeOs: number
  /** Display the TMO 1 cross dots (the original's bright circles). */
  showTmo1Signals: boolean
  /** Display the TMO 2 cross dots (hidden in the published style but always computed). */
  showTmo2Signals: boolean
  /** Display the TMO 2 crosses that fire past the extreme levels. */
  showTmo2ExtremeSignals: boolean
  /** Draw the three Main/Signal line pairs. */
  showLines: boolean
}

/** Zeiierman Trend Pressure Pine v6 inputs. */
export interface TrendPressureSettings {
  pulseRange: number
  pulseStochastic: number
  pulseSmoothing: number
  trendRange: number
  macroTrend: number
  trendSmoothing: number
  trendPersistence: number
  exhaustionZone: number
  sensitivity: number
  showCrosses: boolean
  reactiveSmoothing: number
  regimeWeight: number
  cold: string
  hot: string
  upperLevel: string
  lowerLevel: string
  levelTransparency: number
  pulseColor: string
  trendColor: string
  coreBull: string
  coreBear: string
  coreNeutral: string
  coreWidth: number
  gradientFill: boolean
  priceBoxes: boolean
  maxBoxes: number
}

/** Published inputs of LazyBear's WaveTrend [LazyBear] (short title `WT_LB`). */
export interface WaveTrendSettings {
  /** `n1` — channel length of the ESA and the absolute-deviation average. */
  channelLength: number
  /** `n2` — average length applied to the channel position index. */
  averageLength: number
  obLevel1: number
  obLevel2: number
  osLevel1: number
  osLevel2: number
}

/**
 * Published inputs of ChrisMoody's CM_Williams_Vix_Fix (short title
 * `CM_Williams_Vix_Fix`, legend `(22, 20, 2, 50, 0.85, 1.01)`).
 */
export interface WilliamsVixFixSettings {
  /** `pd` — lookback for the highest close in the Williams VIX Fix ratio. */
  pd: number
  /** `bbl` — Bollinger length of the WVF average and deviation. */
  bbl: number
  /** `mult` — Bollinger standard-deviation multiplier (Pine minval 1, maxval 5). */
  mult: number
  /** `lb` — lookback for the percentile range-high / range-low. */
  lb: number
  /** `ph` — highest percentile factor applied to the highest WVF. */
  ph: number
  /** `pl` — lowest percentile factor applied to the lowest WVF. */
  pl: number
  /** `hp` — draw the orange percentile range-high / range-low lines. */
  showHighRange: boolean
  /** `sd` — draw the aqua Bollinger upper band line. */
  showStdDevLine: boolean
}

/** Price series the nQQE half of Bayesian/nQQE/BankFunds may read. Bayesian events stay on close. */
export type BayesianNqqeSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4'

/**
 * Published legend of Bayesian/nQQE/BankFunds, plus the display bools that are not in the
 * numeric tuple. Alligator offsets are stored and shown; they are not applied.
 */
export interface BayesianNqqeSettings {
  /** BB basis length (20). */
  bbSmaPeriod: number
  /** BB population-stdev multiplier (2.5). */
  bbStdDev: number
  /** Awesome Oscillator fast SMA (5). The title may say EMA; the average is an SMA. */
  aoFast: number
  /** Awesome Oscillator slow SMA (34). */
  aoSlow: number
  /** Accelerator fast SMA (5). */
  acFast: number
  /** Accelerator slow SMA (34). */
  acSlow: number
  /** SMA length applied to the accelerator raw difference (13). */
  acAoMa: number
  /** Alligator lips SMMA length (5). Unshifted. */
  lipsLength: number
  /** Alligator teeth SMMA length (8). Unshifted. */
  teethLength: number
  /** Alligator jaw SMMA length (13). Unshifted. */
  jawLength: number
  /** Stored lips offset (3). Not applied. */
  lipsOffset: number
  /** Stored teeth offset (5). Not applied. */
  teethOffset: number
  /** Stored jaw offset (8). Not applied. */
  jawOffset: number
  /** SMA the Bayesian events compare close against (20). */
  smaPeriod: number
  /** Lookback of the event averages (20). */
  bayesPeriod: number
  /** Lower threshold on the 0–100 plotted score (15). */
  lowerThreshold: number
  /** nQQE source. The Bayesian half always reads close. */
  nqqeSource: BayesianNqqeSource
  /** nQQE RSI length (14). */
  nqqeRsiLength: number
  /** nQQE RSI smoothing (5). */
  nqqeSmooth: number
  showProbabilities: boolean
  showNqqe: boolean
  showBankFunds: boolean
  showSignals: boolean
  /** Bill Williams confirmation. Off in the published default. Uses the unshifted alligator. */
  useBwConfirmation: boolean
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

/** Settings for the public-facing recreation of TUX EMA Scalper+SuperTrend. */
export interface TuxEmaScalperSettings {
  /** SuperTrend ATR multiplier; published default is 3. */
  factor: number
  /** SuperTrend ATR period; published default is 7. */
  atrPeriod: number
  /** TonyUX EMA signal length; published default is 20. */
  emaLength: number
  /** Source shown in the published legend. This recreation uses close. */
  source: 'close'
  /** Show the blue EMA signal line. */
  showEma: boolean
  /** Show green/red SuperTrend context lines. */
  showSuperTrend: boolean
  /** Show transparent BUY/SELL text beside the arrows. */
  showLabels: boolean
  /** Green long arrow color. */
  buyColor: string
  /** Pink short arrow color. */
  sellColor: string
}

export const TUX_EMA_SCALPER_DEFAULTS: Readonly<TuxEmaScalperSettings> = {
  factor: 3,
  atrPeriod: 7,
  emaLength: 20,
  source: 'close',
  showEma: true,
  showSuperTrend: true,
  showLabels: true,
  buyColor: '#39b978',
  sellColor: '#d14b83',
}

/**
 * Settings for Chile Reversal — the Atlas port of "ROBEX IA CHILERA V17 PRO".
 * The fields mirror the Pine inputs one for one; the two marker-lifetime fields
 * are Atlas additions, because an SVG overlay has no `max_labels_count` to
 * garbage-collect behind it.
 */
export interface ChileReversalSettings {
  /** Timeframe the pivots and the round come from. Pine hard-codes "15". */
  resolution: Timeframe
  /** Pine input: "Fuerza minima" (6) — points one side needs before it is called. */
  minScore: number
  /** Pine input: "Ventaja minima" (2) — points one side needs over the other. */
  minEdge: number
  /** Pine input: "Pivot 15M izquierda" (2). */
  pivotLeft: number
  /** Pine input: "Pivot 15M derecha" (2). */
  pivotRight: number
  /** Pine input: "Distancia maxima S/R en ATR" (2.5). */
  maxDistanceAtr: number
  /** Pine input: "Largo lineas S/R" (35) — how many bars back the level lines reach. */
  lineLength: number
  /** Pine input: "Sensibilidad ROBEX Trend" (2.4) — supertrend ATR multiplier. */
  trendFactor: number
  /** Pine input: "ATR ROBEX Trend" (10) — supertrend ATR length. */
  trendAtrLength: number
  /** Pine input: "Mostrar ROBEX Trend". */
  showTrend: boolean
  /** Pine input: "Mostrar EMA 9/21". */
  showEma: boolean
  /** Pine input: "Mostrar VWAP". */
  showVwap: boolean
  /** Pine input: "Mostrar S/R 15M cercanos". */
  showLevels: boolean
  /**
   * Seconds an ARRIBA/ABAJO marker stays at full strength after its bar closes.
   * 0 keeps markers until the 40-marker cap — the closest thing to Pine's
   * `max_labels_count` behaviour.
   */
  markerTtlSeconds: number
  /** Seconds the fade-out takes once `markerTtlSeconds` elapses. */
  markerFadeSeconds: number
  /** Support color. Pine `verde` rgb(0, 225, 145). */
  supportColor: string
  /** Resistance color. Pine `rojo` rgb(250, 65, 90). */
  resistanceColor: string
}

/** Defaults taken from the Pine script's own input defaults. */
export const CHILE_REVERSAL_DEFAULTS: Readonly<ChileReversalSettings> = {
  resolution: '15m',
  minScore: 6,
  minEdge: 2,
  pivotLeft: 2,
  pivotRight: 2,
  maxDistanceAtr: 2.5,
  lineLength: 35,
  trendFactor: 2.4,
  trendAtrLength: 10,
  showTrend: true,
  showEma: true,
  showVwap: true,
  showLevels: true,
  // Markers are transient alerts, not permanent annotations: one minute on the
  // chart, then a slow fade to nothing.
  markerTtlSeconds: 60,
  markerFadeSeconds: 15,
  supportColor: '#00e191',
  resistanceColor: '#fa415a',
}

/**
 * Settings for Randy V8.10 DISCIPLINADO — the Atlas port of the 15-minute BTC/Kalshi Pine
 * indicator. Every field except the `show*` toggles is a Pine input of the same meaning; the
 * Spanish input label is in `RANDY_V8_FIELDS` (lib/randy-v8.ts), which also holds each range.
 */
export interface RandyV8Settings {
  /** "TARGET KALSHI / TO BEAT" — the contract's strike. 0 = not entered. */
  target: number
  emaCtxFast: number
  emaCtxSlow: number
  ema1Fast: number
  ema1Slow: number
  rsiLength: number
  volLength: number
  atrLength: number
  atrAvgLength: number
  volMultiplier: number
  atrMin: number
  srLookback5: number
  srLookback15: number
  minEdgePct: number
  noEdgePct: number
  confirmBars: number
  momentumMin: number
  crashBodyAtr: number
  crash3Atr: number
  maxExtensionAtr: number
  scalpThreshold: number
  scalpEvidenceMin: number
  preAlertThreshold: number
  scalpNoTradeLastSec: number
  scalpExtremeExtensionAtr: number
  chargedThreshold: number
  chargedEvidenceMin: number
  enterStrengthMin: number
  lateBlockAtr: number
  lateTargetRatio: number
  sitOutLastSec: number
  mapLookback1H: number
  mapLookback15: number
  mapZone1HAtr: number
  mapZone15Atr: number
  mapBreakAtr: number
  showEmas: boolean
  showTarget: boolean
  showLevels: boolean
  showMarkers: boolean
}

/** Defaults taken from the Pine script's own input defaults. */
export const RANDY_V8_DEFAULTS: Readonly<RandyV8Settings> = {
  target: 0,
  emaCtxFast: 20,
  emaCtxSlow: 50,
  ema1Fast: 9,
  ema1Slow: 20,
  rsiLength: 14,
  volLength: 20,
  atrLength: 14,
  atrAvgLength: 20,
  volMultiplier: 1.15,
  atrMin: 0.85,
  srLookback5: 12,
  srLookback15: 8,
  minEdgePct: 64,
  noEdgePct: 57,
  confirmBars: 2,
  momentumMin: 24,
  crashBodyAtr: 0.85,
  crash3Atr: 1.35,
  maxExtensionAtr: 0.95,
  scalpThreshold: 36,
  scalpEvidenceMin: 2,
  preAlertThreshold: 26,
  scalpNoTradeLastSec: 30,
  scalpExtremeExtensionAtr: 2.2,
  chargedThreshold: 32,
  chargedEvidenceMin: 3,
  enterStrengthMin: 42,
  lateBlockAtr: 1.35,
  lateTargetRatio: 1.15,
  sitOutLastSec: 75,
  mapLookback1H: 12,
  mapLookback15: 16,
  mapZone1HAtr: 0.28,
  mapZone15Atr: 0.24,
  mapBreakAtr: 0.05,
  showEmas: true,
  showTarget: true,
  showLevels: true,
  showMarkers: true,
}

/**
 * Similarity measures supported by "The Next Pivot" indicator.
 * Mirrors Kioseff Trading's published options plus Atlas's own additions.
 */
export type NextPivotSimilarity =
  'cosine' | 'pearson' | 'spearman' | 'euclidean' | 'mse' | 'kendall' | 'dtw'
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
  style?: 'line' | 'histogram' | 'circles' | 'cross' | 'area' | 'columns'
  /** Pine `transp`, 0–100. Applies to the fill of an `area` plot. */
  transp?: number
  /**
   * Pine `histbase` of an `area` plot — the level the fill hangs from.
   * Defaults to 0; the Bayesian nQQE area uses 50.
   */
  histbase?: number
  /** Dashed `hline` for a `horizontalLine` plot (the Bayesian 40/60 levels). */
  dashed?: boolean
  colors?: string[]
  /**
   * Second price of a `columns` bar. The column is drawn from `values[i]` to `base[i]`.
   * A missing or non-finite base skips that bar; it is not drawn from zero.
   */
  base?: (number | null)[]
  /**
   * `segment` (the default for a line) shifts each colour onto the following bar, which is
   * how Lightweight Charts colours a segment. `bar` keeps the colour on the bar that produced it.
   */
  colorMode?: 'segment' | 'bar'
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
  /** Divergence overlay, valid for `macd`, `cm-ult-macd`, and `rsi-divergence`. */
  divergence?: DivergenceSettings
  smc?: SmartMoneyConceptsSettings
  sr?: SrBreaksRetestsSettings
  pivots?: PivotPointsMissedReversalsSettings
  strike?: CoinbaseStrikeSettings
  scalpswing?: ScalpSwingSettings
  tuxEmaScalper?: TuxEmaScalperSettings
  tmoScalper?: TmoScalperSettings
  nextPivot?: NextPivotSettings
  chileReversal?: ChileReversalSettings
  randyV8?: RandyV8Settings
  trendPressure?: TrendPressureSettings
  waveTrend?: WaveTrendSettings
  williamsVixFix?: WilliamsVixFixSettings
  bayesianNqqe?: BayesianNqqeSettings
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
/** Which indicator a custom alarm watches. */
export type AlarmIndicatorKind = 'cm-ult-macd' | 'macd' | 'rsi' | 'cm-williams-vix-fix'
/**
 * Every condition the alarm builder offers. `indicator-alarms.ts` owns the labels,
 * descriptions and the arithmetic behind each id — this union only names them.
 */
export type AlarmConditionId =
  // CM_Ult_MacD_MTF and the conventional MACD.
  | 'macd-cross-up'
  | 'macd-cross-down'
  | 'macd-about-cross-up'
  | 'macd-about-cross-down'
  | 'macd-zero-cross-up'
  | 'macd-zero-cross-down'
  | 'macd-above-level'
  | 'macd-below-level'
  | 'macd-hist-rising'
  | 'macd-hist-falling'
  // CM_Ult_MacD_MTF histogram colors only: the conventional MACD never paints them.
  | 'macd-hist-aqua'
  | 'macd-hist-blue'
  | 'macd-hist-maroon'
  | 'macd-hist-red'
  // Wilder RSI.
  | 'rsi-cross-up-level'
  | 'rsi-cross-down-level'
  | 'rsi-about-cross-up'
  | 'rsi-about-cross-down'
  | 'rsi-above-level'
  | 'rsi-below-level'
  | 'rsi-turns-up'
  | 'rsi-turns-down'
  // CM_Williams_Vix_Fix.
  | 'wvf-spike'
  | 'wvf-spike-ends'
  | 'wvf-about-spike'
  | 'wvf-cross-above-band'
  | 'wvf-cross-above-range'
  | 'wvf-above-level'
  | 'wvf-below-level'
/**
 * One leg of a combined alarm: which indicator family it reads, the condition, and its own
 * numeric inputs. A leg carries its family, so one alarm can gate MACD on RSI or on the VIX
 * Fix — the same condition id can never mean two things.
 */
export interface AlarmConditionEntry {
  indicator: AlarmIndicatorKind
  condition: AlarmConditionId
  /** Numeric inputs declared by this condition's catalog entry, e.g. `{ level: 70 }`. */
  params: Record<string, number>
}
/** How a multi-condition alarm combines: every leg true, or any one of them. */
export type AlarmMatch = 'all' | 'any'
/**
 * A custom alarm on an indicator rather than on a price.
 *
 * The alarm names its own symbol, timeframe and indicator settings, so it stands alone: an
 * RSI(14) 15m alarm on BTC-USD keeps watching while the chart is on something else. Conditions
 * are state predicates — the alarm fires on the bar the state becomes true, once per bar.
 *
 * `indicator`/`condition`/`params` are the primary leg; `also` carries up to three more, and
 * `match` says whether all of them (`all`, the default) or any one of them (`any`) has to hold
 * on the bar. An alarm without `also` is exactly what it always was.
 */
export interface IndicatorAlarm {
  id: string
  symbol: string
  timeframe: Timeframe
  indicator: AlarmIndicatorKind
  condition: AlarmConditionId
  /** Numeric inputs declared by the condition's catalog entry, e.g. `{ level: 70 }`. */
  params: Record<string, number>
  /** Extra legs of a combined alarm, evaluated alongside the primary one. */
  also?: AlarmConditionEntry[]
  /** `all` (default) requires every leg; `any` fires on whichever leg is true first. */
  match?: AlarmMatch
  /** RSI length. RSI alarms only. */
  rsi?: { period: number }
  /** Conventional MACD lengths, EMA-fast / EMA-slow / EMA-signal. */
  macd?: { fast: number; slow: number; signal: number }
  /** CM_Ult_MacD_MTF lengths (evaluated at the alarm's own timeframe) and color rules. */
  cmMacd?: CmMacdSettings
  /** CM_Williams_Vix_Fix published inputs. */
  williamsVixFix?: WilliamsVixFixSettings
  /** Play the alarm chime in addition to the in-app notification. */
  sound: boolean
  /** `bar` re-arms on every new bar; `once` pauses the alarm after its first fire. */
  repeat: 'bar' | 'once'
  /** Read the forming bar (fast, can repaint) or only closed bars (confirmed). */
  bars: 'forming' | 'closed'
  note: string
  enabled: boolean
  createdAt: string
  lastTriggeredAt?: string
  /** Bucket time of the bar the alarm last fired on, so one bar never fires twice. */
  lastTriggeredBar?: number
  triggerCount: number
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
