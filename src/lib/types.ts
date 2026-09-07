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
  showSwingPoints: false,
  showStrongWeakHighsLows: false,
  swingLength: 50,
  showInternalOrderBlocks: true,
  internalOrderBlockCount: 5,
  showSwingOrderBlocks: false,
  swingOrderBlockCount: 5,
  orderBlockFilter: 'Atr',
  orderBlockMitigation: 'High/Low',
  highlightMitigatedBlocks: true,
  showEqualHighLow: true,
  equalHighLowBars: 3,
  equalHighLowThreshold: 0.1,
  equalHighLowLabelSize: 'Tiny',
  showFairValueGaps: false,
  fvgAutoThreshold: true,
  fvgTimeframe: '',
  fvgExtend: 1,
  showDailyHighLow: false,
  dailyLineStyle: '⎯⎯⎯',
  showWeeklyHighLow: false,
  weeklyLineStyle: '⎯⎯⎯',
  showMonthlyHighLow: false,
  monthlyLineStyle: '⎯⎯⎯',
  showPremiumDiscount: false,
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
  smc?: SmartMoneyConceptsSettings
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
  },
]
