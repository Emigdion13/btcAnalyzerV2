import { ta } from './indicator-runtime'
import { calculateCmMacd, cmMacdPlots, cmMacdSettings } from './cm-ult-macd'
import { scalpSwingPlots } from './scalpswing'
import type { IndicatorContext } from './cm-ult-macd'
import type { Candle, Indicator, IndicatorKind, Plot } from './types'

/** Fast/slow/signal lengths for the conventional MACD, derived from `period`. */
export function conventionalMacdLengths(period: number): {
  fast: number
  slow: number
  signal: number
} {
  return { fast: period, slow: Math.max(period + 1, Math.round((period * 26) / 12)), signal: 9 }
}

/**
 * MACD histogram (MACD − signal) aligned to `candles`, for either MACD kind.
 * Unlike the plotted histogram this never suppresses exact zeros, so divergence
 * pivots see the raw momentum series. Returns null for non-MACD indicators.
 */
export function macdHistogram(
  candles: Candle[],
  indicator: Indicator,
  context?: IndicatorContext,
): (number | null)[] | null {
  if (indicator.kind === 'cm-ult-macd') {
    return calculateCmMacd(candles, cmMacdSettings(indicator), context).histogram
  }
  if (indicator.kind === 'macd') {
    const close = candles.map((c) => c.close)
    const { fast, slow, signal } = conventionalMacdLengths(indicator.period)
    const fastEma = ta.ema(close, fast)
    const slowEma = ta.ema(close, slow)
    const line = fastEma.map((v, i) => (v === null || slowEma[i] === null ? null : v - slowEma[i]!))
    const signalLine = ta.ema(line, signal)
    return line.map((v, i) => (v === null || signalLine[i] === null ? null : v - signalLine[i]!))
  }
  return null
}

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
    kind: 'coinbase-strike',
    name: 'Coinbase BTC Up/Down Strike',
    short: 'BTC Strike',
    description:
      'Mark the Coinbase 15m/1h prediction strike price with live UP/DOWN status, delta, and target buffer lines.',
    category: 'Price Action',
    period: 15,
    color: '#f5a623',
  },
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
    kind: 'pivot-points-missed-reversals',
    name: 'Pivot Points High Low & Missed Reversal Levels',
    short: 'Pivots & Missed Reversals',
    description:
      'Bar-count pivot highs and lows with ▼/▲ labels, the 👻 reversals the method misses, a zig-zag through both, missed-reversal levels and a trailing reversal estimate — a faithful port of LuxAlgo’s open-source (50) indicator.',
    category: 'Price Action',
    period: 50,
    color: '#26a69a',
  },
  {
    kind: 'scalpswing',
    name: 'SCALPSWING R1-6 (PAC Swing Arrows)',
    short: 'SCALPSWING R1-6',
    description:
      'Small bottom/top arrows from JustUncleL’s Scalping Swing Trading Tool R1-6 (10) – PAC EMA High/Low/Close breakout with optional 200EMA filter, recreated with the same EMA and cross logic.',
    category: 'Price Action',
    period: 10,
    color: '#26a69a',
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
  if (indicator.kind === 'coinbase-strike') {
    // The active strike is a native dotted price-scale marker in ChartView, not a historical
    // time-series plot. This keeps old interval strikes from becoming a line through the chart.
    return []
  }
  // Smart Money Concepts is drawn as a native SVG price overlay in ChartView.
  // It intentionally has no Lightweight Charts line/pane series.
  if (indicator.kind === 'smart-money-concepts') return []
  // SR Breaks and Retests is likewise a native SVG price overlay (zones,
  // diamonds, labels) with no Lightweight Charts series.
  if (indicator.kind === 'sr-breaks-retests') return []
  // Pivot Points High Low & Missed Reversal Levels draws labels, a zig-zag
  // and levels as a native SVG price overlay; no Lightweight Charts series.
  if (indicator.kind === 'pivot-points-missed-reversals') return []
  // SCALPSWING R1-6 draws small buy/sell arrows as SVG overlay; optional PAC/EMA lines are Lightweight series.
  if (indicator.kind === 'scalpswing') {
    return scalpSwingPlots(candles, indicator)
  }
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
    const lengths = conventionalMacdLengths(period)
    const fast = ta.ema(close, lengths.fast),
      slow = ta.ema(close, lengths.slow)
    const line = fast.map((v, i) => (v === null || slow[i] === null ? null : v - slow[i]!))
    const signal = ta.ema(line, lengths.signal)
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
    name: 'SCALPSWING R1-6 Arrows (PAC Breakout)',
    source: `// SCALPSWING R1-6 (10) – small bottom/top arrows logic
// Based on JustUncleL's open-source Pine v3 indicator
// PAC = EMA(high, len), EMA(low, len), EMA(close, len)
// Buy: close > open && close > pacU && close[1] < pacU[1] && (no filter or pacC > ema200)
// Sell: close < open && close < pacL && close[1] > pacL[1] && (no filter or pacC < ema200)

const pacLength = input.number("PAC Length", 10, 2, 200);
const emaFilterLength = input.number("EMA Filter Length", 200, 1, 2000);
const filterWithEma = input.number("Filter with EMA? 1=yes 0=no", 1, 0, 1);

const pacC = ta.ema(close, pacLength);
const pacU = ta.ema(high, pacLength);
const pacL = ta.ema(low, pacLength);
const emaFilter = ta.ema(close, emaFilterLength);

const buySignal = [];
const sellSignal = [];
for (let i = 0; i < close.length; i++) {
  if (i === 0 || pacU[i] === null || pacL[i] === null || pacC[i] === null) {
    buySignal.push(null);
    sellSignal.push(null);
    continue;
  }
  const prevClose = close[i-1];
  const curClose = close[i];
  const curOpen = open[i];
  const curPacU = pacU[i];
  const prevPacU = pacU[i-1];
  const curPacL = pacL[i];
  const prevPacL = pacL[i-1];
  const curPacC = pacC[i];
  const curEma = emaFilter[i];
  const filterOkUp = filterWithEma === 0 || (curEma !== null && curPacC > curEma);
  const filterOkDown = filterWithEma === 0 || (curEma !== null && curPacC < curEma);
  const isUp = curClose > curOpen && curClose > curPacU && prevClose < prevPacU && filterOkUp;
  const isDown = curClose < curOpen && curClose < curPacL && prevClose > prevPacL && filterOkDown;
  // Plot markers as price-level points: we use close price for visibility in oscillator workaround,
  // but in custom template we show PAC lines instead.
  buySignal.push(isUp ? low[i] : null);
  sellSignal.push(isDown ? high[i] : null);
}

// Draw PAC and filter for reference
plot(pacU, { title: "PAC High", color: "#7a8592", pane: "price", lineWidth: 1 });
plot(pacL, { title: "PAC Low", color: "#7a8592", pane: "price", lineWidth: 1 });
plot(pacC, { title: "PAC Close", color: "#b0bec5", pane: "price", lineWidth: 1 });
plot(emaFilter, { title: "EMA Filter " + emaFilterLength, color: "#42a5f5", pane: "price", lineWidth: 2 });
// In native SCALPSWING overlay these become small arrows at candle bottom/top.
// Here we plot dots as approximation – use built-in SCALPSWING for true arrows.
plot(buySignal, { title: "Buy Breakout (PAC)", color: "#26a69a", pane: "price", lineWidth: 2 });
plot(sellSignal, { title: "Sell Breakout (PAC)", color: "#ef5350", pane: "price", lineWidth: 2 });
`,
  },
  {
    name: 'Coinbase BTC Up/Down Strike',
    source: `// Coinbase BTC "Up or Down" Strike Line Indicator
const intervalMinutes = input.number("Contract Period (Min)", 15, 1, 1440);
const buffer = input.number("Target Buffer ($)", 50, 0, 5000);
const intervalSec = intervalMinutes * 60;

let currentStrike = null;
let currentInterval = -1;
const strikeLine = [];
const upperBand = [];
const lowerBand = [];

for (let i = 0; i < time.length; i++) {
  const intervalStart = Math.floor(time[i] / intervalSec) * intervalSec;
  if (intervalStart !== currentInterval) {
    currentInterval = intervalStart;
    currentStrike = open[i];
  }
  strikeLine.push(currentStrike);
  upperBand.push(buffer > 0 && currentStrike !== null ? currentStrike + buffer : null);
  lowerBand.push(buffer > 0 && currentStrike !== null ? currentStrike - buffer : null);
}

plot(strikeLine, { title: "Strike (" + intervalMinutes + "m)", color: "#f5a623", pane: "price", lineWidth: 2 });
if (buffer > 0) {
  plot(upperBand, { title: "Strike + Buffer", color: "#2bb99b", pane: "price", lineWidth: 1 });
  plot(lowerBand, { title: "Strike - Buffer", color: "#ed6773", pane: "price", lineWidth: 1 });
}`,
  },
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
