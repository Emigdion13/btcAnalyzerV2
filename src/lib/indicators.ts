import { ta } from './indicator-runtime'
import { calculateCmMacd, cmMacdPlots, cmMacdSettings } from './cm-ult-macd'
import type { IndicatorContext } from './cm-ult-macd'
import type { Candle, Indicator, IndicatorKind, Plot } from './types'

export const INDICATOR_CATALOG: {
  kind: IndicatorKind
  name: string
  short: string
  description: string
  category: string
  period: number
  color: string
}[] = [
  {
    kind: 'sma',
    name: 'Simple Moving Average',
    short: 'SMA',
    description: 'Find the underlying trend by smoothing price over time.',
    category: 'Trend',
    period: 20,
    color: '#b9e881',
  },
  {
    kind: 'ema',
    name: 'Exponential Moving Average',
    short: 'EMA',
    description: 'A responsive moving average that favors recent prices.',
    category: 'Trend',
    period: 20,
    color: '#d6ad68',
  },
  {
    kind: 'bb',
    name: 'Bollinger Bands',
    short: 'BB',
    description: 'A moving average wrapped in two volatility bands.',
    category: 'Volatility',
    period: 20,
    color: '#7796e8',
  },
  {
    kind: 'rsi',
    name: 'Relative Strength Index',
    short: 'RSI',
    description: 'Measure momentum and spot overbought or oversold levels.',
    category: 'Momentum',
    period: 14,
    color: '#ad91e5',
  },
  {
    kind: 'cm-ult-macd',
    name: 'CM_Ult_MacD_MTF',
    short: 'CM_Ult_MacD_MTF',
    description:
      'ChrisMoody’s original: EMA 12/26, SMA 9 signal, four-color histogram, crossover dots, and multi-timeframe controls.',
    category: 'Momentum',
    period: 12,
    color: '#00ff00',
  },
  {
    kind: 'smart-money-concepts',
    name: 'Smart Money Concepts',
    short: 'SMC',
    description:
      'Independent price-action overlay with internal and swing BOS/CHoCH, order blocks, equal highs/lows, fair value gaps, and value zones.',
    category: 'Price Action',
    period: 50,
    color: '#089981',
  },
  {
    kind: 'sr-breaks-retests',
    name: 'SR Breaks and Retests',
    short: 'SR B&R',
    description:
      'Volume-graded support and resistance zones from close pivots, with break labels, hold diamonds, and role-reversal retests — a faithful port of ChartPrime’s published (20, 2, 1) indicator.',
    category: 'Price Action',
    period: 20,
    color: '#4caf50',
  },
  {
    kind: 'macd',
    name: 'MACD',
    short: 'MACD',
    description: 'Track the relationship between fast and slow moving averages.',
    category: 'Momentum',
    period: 12,
    color: '#7eacf3',
  },
  {
    kind: 'vwap',
    name: 'Volume Weighted Average Price',
    short: 'VWAP',
    description: 'The average price weighted by volume. Resets daily in UTC.',
    category: 'Trend',
    period: 1,
    color: '#e6be77',
  },
  {
    kind: 'volume',
    name: 'Volume',
    short: 'VOL',
    description: 'See the trading activity behind every candle.',
    category: 'Volume',
    period: 20,
    color: '#2bb99b',
  },
]
export function builtInPlots(
  candles: Candle[],
  indicator: Indicator,
  context?: IndicatorContext,
): Plot[] {
  if (indicator.kind === 'cm-ult-macd') {
    const settings = cmMacdSettings(indicator)
    return cmMacdPlots(calculateCmMacd(candles, settings, context), settings)
  }
  // Smart Money Concepts is drawn as a native SVG price overlay in ChartView.
  // It intentionally has no Lightweight Charts line/pane series.
  if (indicator.kind === 'smart-money-concepts') return []
  // SR Breaks and Retests is likewise a native SVG price overlay (zones,
  // diamonds, labels) with no Lightweight Charts series.
  if (indicator.kind === 'sr-breaks-retests') return []
  const close = candles.map((c) => c.close)
  const { kind, period, color } = indicator
  const plot = (
    values: (number | null)[],
    title: string,
    pane: 'price' | 'oscillator' = 'price',
    plotColor = color,
  ): Plot => ({ values, title, color: plotColor, pane, lineWidth: 1 })
  if (kind === 'ema') return [plot(ta.ema(close, period), `EMA ${period}`)]
  if (kind === 'sma') return [plot(ta.sma(close, period), `SMA ${period}`)]
  if (kind === 'rsi') return [plot(ta.rsi(close, period), `RSI ${period}`, 'oscillator')]
  if (kind === 'bb') {
    const mean = ta.sma(close, period),
      dev = ta.stdev(close, period)
    return [
      plot(mean, 'Basis'),
      plot(
        mean.map((v, i) => (v === null ? null : v + 2 * dev[i]!)),
        'Upper band',
      ),
      plot(
        mean.map((v, i) => (v === null ? null : v - 2 * dev[i]!)),
        'Lower band',
      ),
    ]
  }
  if (kind === 'macd') {
    const fast = ta.ema(close, period),
      slow = ta.ema(close, Math.max(period + 1, Math.round((period * 26) / 12)))
    const line = fast.map((v, i) => (v === null || slow[i] === null ? null : v - slow[i]!))
    const signal = ta.ema(line, 9)
    return [plot(line, 'MACD', 'oscillator'), plot(signal, 'Signal', 'oscillator', '#d6ad68')]
  }
  if (kind === 'vwap') {
    let weighted = 0,
      volume = 0,
      day = -1
    return [
      plot(
        candles.map((c) => {
          const currentDay = Math.floor(c.time / 86400)
          if (day !== currentDay) {
            weighted = 0
            volume = 0
            day = currentDay
          }
          weighted += ((c.high + c.low + c.close) / 3) * c.volume
          volume += c.volume
          return volume > 0 ? weighted / volume : c.close
        }),
        'VWAP',
      ),
    ]
  }
  return []
}

export const SCRIPT_TEMPLATES = [
  {
    name: 'My first indicator',
    source: `// Your next edge starts here.\nconst period = input.number("Period", 20);\nconst source = close;\n\n// Smooth the noise. See the trend.\nconst average = ta.ema(source, period);\nplot(average, { title: "My EMA", color: "#b9ee82" });`,
  },
  {
    name: 'Moving average ribbon',
    source: `// Two perspectives. One clear trend.\nconst fast = input.number("Fast period", 12);\nconst slow = input.number("Slow period", 26);\n\nplot(ta.ema(close, fast), { title: "Fast EMA", color: "#b9ee82" });\nplot(ta.ema(close, slow), { title: "Slow EMA", color: "#7796e8" });`,
  },
  {
    name: 'Bollinger bands',
    source: `const period = input.number("Period", 20);\nconst multiplier = input.number("Deviation", 2, 0.1, 10);\nconst basis = ta.sma(close, period);\nconst deviation = ta.stdev(close, period);\n\nconst upper = basis.map((v, i) => v === null ? null : v + deviation[i] * multiplier);\nconst lower = basis.map((v, i) => v === null ? null : v - deviation[i] * multiplier);\n\nplot(basis, { title: "Basis", color: "#d6ad68" });\nplot(upper, { title: "Upper band", color: "#7796e8" });\nplot(lower, { title: "Lower band", color: "#7796e8" });`,
  },
  {
    name: 'RSI momentum',
    source: `// An oscillator in its own pane.\nconst period = input.number("Period", 14);\nconst momentum = ta.rsi(close, period);\n\nplot(momentum, {\n  title: "Custom RSI",\n  color: "#ad91e5",\n  pane: "oscillator"\n});`,
  },
]
