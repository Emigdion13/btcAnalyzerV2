import type { Asset, Candle, Timeframe } from './types'

export const ASSETS: Asset[] = [
  {
    symbol: 'BTCUSDT',
    ticker: 'BTC',
    name: 'Bitcoin',
    price: 67432.8,
    change: 1.94,
    color: '#f59b38',
    icon: '₿',
    volume: '24.86B',
    marketCap: '1.33T',
    category: 'Other',
  },
  {
    symbol: 'ETHUSDT',
    ticker: 'ETH',
    name: 'Ethereum',
    price: 3521.64,
    change: 2.67,
    color: '#8e9cea',
    icon: 'Ξ',
    volume: '12.42B',
    marketCap: '423.1B',
    category: 'Layer 1',
  },
  {
    symbol: 'SOLUSDT',
    ticker: 'SOL',
    name: 'Solana',
    price: 172.38,
    change: 5.23,
    color: '#a594e5',
    icon: '≋',
    volume: '3.14B',
    marketCap: '79.8B',
    category: 'Layer 1',
  },
  {
    symbol: 'BNBUSDT',
    ticker: 'BNB',
    name: 'BNB',
    price: 598.72,
    change: -0.82,
    color: '#e1b547',
    icon: '◇',
    volume: '1.68B',
    marketCap: '88.4B',
    category: 'Layer 1',
  },
  {
    symbol: 'XRPUSDT',
    ticker: 'XRP',
    name: 'XRP',
    price: 0.5284,
    change: 1.36,
    color: '#c8ced8',
    icon: '×',
    volume: '1.12B',
    marketCap: '29.3B',
    category: 'Layer 1',
  },
  {
    symbol: 'DOGEUSDT',
    ticker: 'DOGE',
    name: 'Dogecoin',
    price: 0.16482,
    change: -1.42,
    color: '#c8aa60',
    icon: 'Ð',
    volume: '846.5M',
    marketCap: '23.7B',
    category: 'Other',
  },
  {
    symbol: 'AVAXUSDT',
    ticker: 'AVAX',
    name: 'Avalanche',
    price: 36.84,
    change: 3.18,
    color: '#e66d70',
    icon: '▲',
    volume: '428.2M',
    marketCap: '14.2B',
    category: 'Layer 1',
  },
  {
    symbol: 'LINKUSDT',
    ticker: 'LINK',
    name: 'Chainlink',
    price: 17.62,
    change: 2.41,
    color: '#658bee',
    icon: '⬡',
    volume: '362.8M',
    marketCap: '10.3B',
    category: 'DeFi',
  },
  {
    symbol: 'ADAUSDT',
    ticker: 'ADA',
    name: 'Cardano',
    price: 0.4618,
    change: -0.64,
    color: '#699ee5',
    icon: '⁙',
    volume: '282.3M',
    marketCap: '16.5B',
    category: 'Layer 1',
  },
  {
    symbol: 'DOTUSDT',
    ticker: 'DOT',
    name: 'Polkadot',
    price: 7.24,
    change: 1.78,
    color: '#e47dab',
    icon: '●',
    volume: '194.6M',
    marketCap: '10.1B',
    category: 'Layer 1',
  },
  {
    symbol: 'UNIUSDT',
    ticker: 'UNI',
    name: 'Uniswap',
    price: 10.83,
    change: 4.26,
    color: '#de81b4',
    icon: 'U',
    volume: '173.9M',
    marketCap: '6.5B',
    category: 'DeFi',
  },
  {
    symbol: 'AAVEUSDT',
    ticker: 'AAVE',
    name: 'Aave',
    price: 104.62,
    change: 2.82,
    color: '#91b9bf',
    icon: 'A',
    volume: '92.1M',
    marketCap: '1.55B',
    category: 'DeFi',
  },
]
export const TIMEFRAMES: Timeframe[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1D', '1W']
export { INTERVAL_SECONDS as INTERVAL } from '../../shared/coinbase'
import { INTERVAL_SECONDS as INTERVAL, isProductId } from '../../shared/coinbase'
import type { CoinbaseProduct, MarketQuote } from '../../shared/coinbase'
export const COINBASE_DEFAULTS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'XRP-USD',
  'DOGE-USD',
  'AVAX-USD',
  'LINK-USD',
  'ADA-USD',
  'DOT-USD',
  'UNI-USD',
  'AAVE-USD',
]
export function coinbaseAsset(product: CoinbaseProduct | string): Asset {
  const symbol = typeof product === 'string' ? product : product.id
  const ticker = symbol.slice(0, -4),
    metadata = ASSETS.find((a) => a.ticker === ticker)
  return {
    symbol,
    ticker,
    name: metadata?.name ?? ticker,
    color: metadata?.color ?? '#84a6ce',
    icon: metadata?.icon ?? ticker[0],
    category: metadata?.category ?? 'Other',
    quoteCurrency: 'USD',
    priceIncrement: typeof product === 'string' ? undefined : product.increment,
    // Metadata is NOT a quote. Live prices come exclusively from the Coinbase transport.
    price: NaN,
    change: NaN,
    volume: '—',
    marketCap: '—',
  }
}
export const quoteCurrency = (asset: Asset) => asset.quoteCurrency ?? 'USDT'
export const isDemoSymbol = (symbol: string) => ASSETS.some((a) => a.symbol === symbol)
export const formatChange = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
export const changeClass = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 'muted' : value >= 0 ? 'positive' : 'negative'
export function demoQuotes(tick: number): Record<string, MarketQuote> {
  return Object.fromEntries(
    ASSETS.map((asset) => {
      const price = asset.price * (1 + Math.sin(tick * 0.64) * 0.00014),
        open = asset.price / (1 + asset.change / 100)
      return [
        asset.symbol,
        {
          price,
          open,
          high: asset.price * 1.0184,
          low: asset.price * 0.9736,
          volume: null,
          change: (price / open - 1) * 100,
          updatedAt: Date.now(),
          source: 'demo' as const,
        },
      ]
    }),
  )
}

function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deliberately synthetic: reproducible OHLCV, with no exchange/API dependency.
export function generateCandles(asset: Asset, timeframe: Timeframe, count = 900): Candle[] {
  const hash = [...asset.symbol].reduce((n, c) => n * 31 + c.charCodeAt(0), 7)
  const random = seededRandom(hash + INTERVAL[timeframe])
  const step = INTERVAL[timeframe]
  const end = Math.floor(Date.UTC(2026, 8, 7, 16, 0) / 1000 / step) * step
  const scale =
    timeframe === '1m'
      ? 0.0006
      : timeframe === '3m'
        ? 0.00085
        : timeframe === '5m'
          ? 0.001
          : timeframe === '15m'
            ? 0.0016
            : timeframe === '1h'
              ? 0.0025
              : timeframe === '4h'
                ? 0.005
                : 0.012
  let price = asset.price * 0.85
  const candles: Candle[] = []
  for (let i = 0; i < count; i++) {
    const trend = Math.sin(i / 43) * 0.24 + Math.cos(i / 17) * 0.23 + 0.055
    const movement = ((random() - 0.5) * 2.4 + trend) * scale
    const open = price
    const close = open * (1 + movement)
    const high = Math.max(open, close) + open * scale * (random() * 0.48 + 0.06)
    const low = Math.min(open, close) - open * scale * (random() * 0.48 + 0.06)
    const volume = (26 + random() * 150 + Math.abs(movement / scale) * 220) * (67432 / asset.price)
    candles.push({ time: end - (count - 1 - i) * step, open, high, low, close, volume })
    price = close
  }
  const multiplier = asset.price / candles[candles.length - 1].close
  return candles.map((c) => ({
    ...c,
    open: c.open * multiplier,
    high: c.high * multiplier,
    low: c.low * multiplier,
    close: c.close * multiplier,
  }))
}

export function formatPrice(
  value: number | null | undefined,
  currency = false,
  precision?: number,
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const digits =
    precision ??
    (Math.abs(value) < 0.0001
      ? 8
      : Math.abs(value) < 0.01
        ? 6
        : Math.abs(value) < 1
          ? 5
          : Math.abs(value) < 10
            ? 4
            : 2)
  return `${currency ? '$' : ''}${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
export function compactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}
export function getAsset(symbol: string) {
  return (
    ASSETS.find((a) => a.symbol === symbol) ??
    (isProductId(symbol) ? coinbaseAsset(symbol) : ASSETS[0])
  )
}
export function sparklinePoints(symbol: string, up: boolean): string {
  const random = seededRandom([...symbol].reduce((n, c) => n + c.charCodeAt(0), 0))
  let y = up ? 24 : 7
  return Array.from({ length: 22 }, (_, i) => {
    y = Math.min(29, Math.max(2, y + (random() - (up ? 0.58 : 0.42)) * 9))
    return `${i * 3},${y}`
  }).join(' ')
}
