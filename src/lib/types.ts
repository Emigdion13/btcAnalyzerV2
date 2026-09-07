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
export type IndicatorKind = 'ema' | 'sma' | 'bb' | 'rsi' | 'macd' | 'vwap' | 'volume' | 'custom'
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
export interface Plot {
  title: string
  color: string
  values: (number | null)[]
  pane: 'price' | 'oscillator'
  lineWidth: number
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
  { id: 'ema-20', kind: 'ema', name: 'EMA', period: 20, color: '#d6ad68', visible: true },
  { id: 'ema-50', kind: 'ema', name: 'EMA', period: 50, color: '#7796e8', visible: true },
  { id: 'volume', kind: 'volume', name: 'Volume', period: 20, color: '#2bb99b', visible: true },
  { id: 'rsi-14', kind: 'rsi', name: 'RSI', period: 14, color: '#ad91e5', visible: true },
]
