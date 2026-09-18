/**
 * Behavioral port of L&L Capital's TMO Scalper (TradingView short title `TMO Scalper`),
 * the MTF scalping variant of Mobius's (T)rue (M)omentum (O)scillator, published with the
 * legend (1, 5, 30, 14, 5, 3, 3, 2, 9, -9, ▴, ▾, ▴, ▾) — three timeframe aggregations,
 * the length/calc/smooth trio, the signal size/offset, the extreme levels, and the two
 * arrow toggles. Reference/provenance, the aggregation convention and the parity
 * boundaries: docs/tmo-scalper.md.
 */
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import { pineEma } from './indicator-runtime'
import type { Candle, Indicator, Plot, Timeframe, TmoResolution, TmoScalperSettings } from './types'

export const TMO_SCALPER_SOURCE = 'https://www.tradingview.com/script/LOPtZGaw-TMO-Scalper/'
export const TMO_SCALPER_DEFAULTS: Readonly<TmoScalperSettings> = {
  timeframe1: '1',
  timeframe2: '5',
  timeframe3: '30',
  tmoLength: 14,
  calcLength: 5,
  smoothLength: 3,
  signalSize: 3,
  signalOffset: 2,
  extremeOb: 9,
  extremeOs: -9,
  showTmo1Signals: true,
  showTmo2Signals: true,
  showTmo2ExtremeSignals: true,
  showLines: true,
}
/**
 * Original Pine colors, not Atlas's theme. The fast and middle pairs share one hue
 * (#27c22e / #ff0000 by direction), the slow pair wears the dark pair (#006400 /
 * #800000), and TMO 1 crosses print in the bright #0de50d / #ff0000.
 */
export const TMO_COLORS = {
  tmo1Bull: '#0de50d',
  bear: '#ff0000',
  bull: '#27c22e',
  tmo2Bull: '#006400',
  tmo2Bear: '#800000',
  extremeBull: '#7cfc00',
  extremeBear: '#ff4081',
  zero: '#2a2e39',
} as const
/** The original's hard-coded display scale: `plot(15*Main/tmolength, …)`. Not an input. */
export const TMO_DISPLAY_SCALE = 15
/**
 * The published hline levels: `hline(math.round(15))` / `-15`, the OB/OS cutoff pair the
 * display scale converges to for long lengths, plus the zero line. Not inputs.
 */
export const TMO_CUTOFF = 15

/** Published TimeFrame options, minus the month-and-beyond choices Atlas has no feed for. */
export const TMO_RESOLUTIONS: TmoResolution[] = [
  '1',
  '2',
  '3',
  '5',
  '10',
  '15',
  '20',
  '30',
  '45',
  '60',
  '120',
  '180',
  '240',
  'D',
  '2D',
  '3D',
  '4D',
  'W',
  '2W',
  '3W',
]
const RESOLUTION_SECONDS: Record<TmoResolution, number> = {
  '1': 60,
  '2': 120,
  '3': 180,
  '5': 300,
  '10': 600,
  '15': 900,
  '20': 1200,
  '30': 1800,
  '45': 2700,
  '60': 3600,
  '120': 7200,
  '180': 10800,
  '240': 14400,
  D: 86400,
  '2D': 172800,
  '3D': 259200,
  '4D': 345600,
  W: 604800,
  '2W': 1209600,
  '3W': 1814400,
}
export function tmoResolutionSeconds(resolution: TmoResolution): number {
  return RESOLUTION_SECONDS[resolution]
}
export function tmoResolutionLabel(resolution: TmoResolution): string {
  return /^[0-9]+$/.test(resolution) ? `${resolution}m` : resolution
}

/**
 * Which native chart feed an aggregation is built from. Atlas streams the eight Coinbase
 * intervals only; every published TMO aggregation is a whole multiple of one of them, and
 * folding from the COARSEST such stream (30m from the 15m stream 2-to-1, 2D from the daily)
 * reproduces the same bucket OHLC with the longest wheel history. Every answer here is a
 * Coinbase-native granularity, so the feed itself needs no further resampling.
 */
export function tmoFeedInterval(seconds: number): Timeframe {
  if (seconds % 604800 === 0) return '1W'
  if (seconds % 86400 === 0) return '1D'
  if (seconds % 14400 === 0) return '4h'
  if (seconds % 3600 === 0) return '1h'
  if (seconds % 900 === 0) return '15m'
  if (seconds % 300 === 0) return '5m'
  if (seconds % 180 === 0) return '3m'
  return '1m'
}

const isResolution = (value: unknown): value is TmoResolution =>
  typeof value === 'string' && Object.hasOwn(RESOLUTION_SECONDS, value)

export function isTmoScalperSettings(value: unknown): value is TmoScalperSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as TmoScalperSettings
  return (
    isResolution(s.timeframe1) &&
    isResolution(s.timeframe2) &&
    isResolution(s.timeframe3) &&
    [s.tmoLength, s.calcLength, s.smoothLength, s.signalSize].every(
      (n) => Number.isInteger(n) && n >= 1 && n <= 2000,
    ) &&
    [s.signalOffset, s.extremeOb, s.extremeOs].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100000,
    ) &&
    [s.showTmo1Signals, s.showTmo2Signals, s.showTmo2ExtremeSignals, s.showLines].every(
      (v) => typeof v === 'boolean',
    )
  )
}
export function tmoScalperSettings(indicator: Indicator): TmoScalperSettings {
  return isTmoScalperSettings(indicator.tmoScalper)
    ? indicator.tmoScalper
    : { ...TMO_SCALPER_DEFAULTS }
}
export function tmoScalperIndicatorLabel(indicator: Indicator): string {
  const s = tmoScalperSettings(indicator)
  return `TMO Scalper (${s.timeframe1}, ${s.timeframe2}, ${s.timeframe3}, ${s.tmoLength}, ${s.calcLength}, ${s.smoothLength})`
}

/** The distinct chart-feed intervals the indicator's three aggregations are built from. */
export function tmoScalperFeeds(settings: TmoScalperSettings): Timeframe[] {
  return [
    ...new Set(
      [settings.timeframe1, settings.timeframe2, settings.timeframe3].map((resolution) =>
        tmoFeedInterval(tmoResolutionSeconds(resolution)),
      ),
    ),
  ]
}

export interface TmoScalperContext {
  timeframe: Timeframe
  timeframes?: Partial<Record<Timeframe, { candles: Candle[] }>>
  /** Replay snapshots hold closed extraneous feeds; see docs/tmo-scalper.md for the caveat. */
  replay?: boolean
}

type Values = (number | null)[]

/**
 * Weekly buckets start Monday 00:00 UTC like the chart's own 1W bars; every other
 * aggregation uses plain UTC-aligned buckets.
 */
function tmoBucket(time: number, seconds: number): number {
  const offset = seconds % 604800 === 0 ? 4 * 86400 : 0
  return Math.floor((time - offset) / seconds) * seconds + offset
}

/**
 * Fold native-interval candles into one of the published TMO aggregations. A bucket that
 * is still open keeps its partial values (close = the latest feed close), which is what
 * makes the unclosed higher-TF bar move tick by tick exactly like request.security in
 * realtime.
 */
export function aggregateCandles(feed: Candle[], seconds: number): Candle[] {
  const out: Candle[] = []
  let bucket = Number.NaN
  for (const candle of feed) {
    const b = tmoBucket(candle.time, seconds)
    if (b !== bucket) {
      bucket = b
      out.push({ ...candle, time: b })
      continue
    }
    const bar = out[out.length - 1]!
    bar.high = Math.max(bar.high, candle.high)
    bar.low = Math.min(bar.low, candle.low)
    bar.close = candle.close
    bar.volume += candle.volume
  }
  return out
}

interface TmoNative {
  times: number[]
  main: number[]
  signal: number[]
}

/**
 * The published recurrence on one aggregation's own candles:
 * data = Σ over i = 1..length−1 of sign(close − open[i])   [na comparisons count 0]
 * EMA = ema(data, calcLength); Main = ema(EMA, smoothLength); Signal = ema(Main, smoothLength).
 * All three EMAs use Pine v5 seeding: the first value is the seed.
 */
function tmoNative(candles: Candle[], settings: TmoScalperSettings): TmoNative {
  const data = candles.map((candle, i) => {
    let sum = 0
    for (let k = 1; k <= settings.tmoLength - 1; k++) {
      const open = candles[i - k]?.open
      if (open === undefined) continue
      if (candle.close > open) sum += 1
      else if (candle.close < open) sum -= 1
    }
    return sum
  })
  const ema = pineEma(data, settings.calcLength)
  const main = pineEma(ema, settings.smoothLength)
  const signal = pineEma(main, settings.smoothLength)
  return { times: candles.map((candle) => candle.time), main, signal }
}

/**
 * Emulate request.security(gaps_off, lookahead_off): an aggregation's latest value is
 * the one of its bucket that the chart bar sits in, and the line is flat between bucket
 * starts. Smaller aggregations report their most recent bar at-or-before the chart bar,
 * the same end the CM_Ult_MacD_MTF port lands on in realtime.
 */
function projectOntoChart(
  native: TmoNative,
  chart: Candle[],
  tfSeconds: number,
  chartSeconds: number,
): { main: Values; signal: Values } {
  const main: Values = []
  const signal: Values = []
  let cursor = -1
  for (const candle of chart) {
    const boundary = tfSeconds >= chartSeconds ? tmoBucket(candle.time, tfSeconds) : candle.time
    while (cursor + 1 < native.times.length && native.times[cursor + 1]! <= boundary) cursor++
    if (cursor < 0) {
      main.push(null)
      signal.push(null)
    } else {
      main.push(native.main[cursor]!)
      signal.push(native.signal[cursor]!)
    }
  }
  return { main, signal }
}

const crossOver = (a: Values, b: Values, i: number): boolean =>
  i > 0 &&
  a[i] !== null &&
  b[i] !== null &&
  a[i - 1] !== null &&
  b[i - 1] !== null &&
  a[i]! > b[i]! &&
  a[i - 1]! <= b[i - 1]!
const crossUnder = (a: Values, b: Values, i: number): boolean =>
  i > 0 &&
  a[i] !== null &&
  b[i] !== null &&
  a[i - 1] !== null &&
  b[i - 1] !== null &&
  a[i]! < b[i]! &&
  a[i - 1]! >= b[i - 1]!

/** All series, chart-aligned and already in the published 15×…/length display scale. */
export interface TmoScalperValues {
  main1: Values
  signal1: Values
  main2: Values
  signal2: Values
  main3: Values
  signal3: Values
  /** TMO 1 cross dots, plotted at main ∓ offset like the original. */
  bull1: Values
  bear1: Values
  /** TMO 2 cross dots, gated by TMO 3. */
  bull2: Values
  bear2: Values
  /** TMO 2 crosses that print while the middle wheel sits past its extreme level. */
  bullExtreme: Values
  bearExtreme: Values
}

export function calculateTmoScalper(
  chart: Candle[],
  settings: TmoScalperSettings,
  context: TmoScalperContext = { timeframe: '1h' },
): TmoScalperValues {
  if (!isTmoScalperSettings(settings)) throw new Error('Invalid TMO Scalper settings.')
  const empty = () => chart.map(() => null)
  const nothing: TmoScalperValues = {
    main1: empty(),
    signal1: empty(),
    main2: empty(),
    signal2: empty(),
    main3: empty(),
    signal3: empty(),
    bull1: empty(),
    bear1: empty(),
    bull2: empty(),
    bear2: empty(),
    bullExtreme: empty(),
    bearExtreme: empty(),
  }
  if (!chart.length) return nothing
  const chartSeconds = INTERVAL_SECONDS[context.timeframe] ?? 3600

  const legs = [settings.timeframe1, settings.timeframe2, settings.timeframe3].map((resolution) => {
    const seconds = tmoResolutionSeconds(resolution)
    const source =
      seconds === chartSeconds
        ? chart
        : aggregateCandles(context.timeframes?.[tmoFeedInterval(seconds)]?.candles ?? [], seconds)
    if (!source.length) return { main: empty(), signal: empty() }
    return projectOntoChart(tmoNative(source, settings), chart, seconds, chartSeconds)
  })
  const [leg1, leg2, leg3] = legs as [
    { main: Values; signal: Values },
    { main: Values; signal: Values },
    { main: Values; signal: Values },
  ]
  const scale = (values: Values): Values =>
    values.map((v) => (v === null ? null : (TMO_DISPLAY_SCALE * v) / settings.tmoLength))
  const main1 = scale(leg1.main),
    signal1 = scale(leg1.signal),
    main2 = scale(leg2.main),
    signal2 = scale(leg2.signal),
    main3 = scale(leg3.main),
    signal3 = scale(leg3.signal)

  // The published gate: a wheel's cross only prints while the next bigger wheel is
  // turning the same way. TMO 1 reads TMO 2; TMO 2 reads TMO 3.
  const bull1: Values = []
  const bear1: Values = []
  const bull2: Values = []
  const bear2: Values = []
  const bullExtreme: Values = []
  const bearExtreme: Values = []
  for (let i = 0; i < chart.length; i++) {
    const up1 = crossOver(main1, signal1, i) && (main2[i] ?? -Infinity) > (signal2[i] ?? Infinity)
    const down1 =
      crossUnder(main1, signal1, i) && (main2[i] ?? Infinity) < (signal2[i] ?? -Infinity)
    const up2 = crossOver(main2, signal2, i) && (main3[i] ?? -Infinity) > (signal3[i] ?? Infinity)
    const down2 =
      crossUnder(main2, signal2, i) && (main3[i] ?? Infinity) < (signal3[i] ?? -Infinity)
    bull1.push(up1 ? main1[i]! - settings.signalOffset : null)
    bear1.push(down1 ? main1[i]! + settings.signalOffset : null)
    bull2.push(up2 ? main2[i]! - settings.signalOffset : null)
    bear2.push(down2 ? main2[i]! + settings.signalOffset : null)
    // The strategy-guide read of "TMO 2 extreme signals": the middle wheel's cross fired FROM
    // an extreme zone — deliberately NOT trend-gated, because an oversold lift by definition
    // prints while the slow wheel is still red. This is the counter-move ▲/▼ pair of the
    // profile; the original script has no such plot.
    bullExtreme.push(
      crossOver(main2, signal2, i) && main2[i]! <= settings.extremeOs ? main2[i]! : null,
    )
    bearExtreme.push(
      crossUnder(main2, signal2, i) && main2[i]! >= settings.extremeOb ? main2[i]! : null,
    )
  }
  return {
    main1,
    signal1,
    main2,
    signal2,
    main3,
    signal3,
    bull1,
    bear1,
    bull2,
    bear2,
    bullExtreme,
    bearExtreme,
  }
}

/** Direction color of a wheel pair, per bar, exactly the original's `color1/2/3`. */
function pairColors(main: Values, signal: Values, bull: string, bear: string): string[] {
  return main.map((v, i) => {
    const s = signal[i]
    if (v === null || s === null) return bear
    return v > s ? bull : bear
  })
}

export function tmoScalperPlots(values: TmoScalperValues, settings: TmoScalperSettings): Plot[] {
  const shown = (data: Values, visible: boolean) => data.map((v) => (visible ? v : null))
  const level = (title: string, price: number, color: string): Plot => ({
    title,
    values: values.main1.map(() => price),
    color,
    pane: 'oscillator',
    lineWidth: 1,
    horizontalLine: price,
    hideLegend: true,
  })
  const line = (title: string, data: Values, colors: string[]): Plot => ({
    title,
    values: shown(data, settings.showLines),
    color: colors[0] ?? TMO_COLORS.bull,
    colors,
    pane: 'oscillator',
    lineWidth: 1,
  })
  const dots = (
    title: string,
    data: Values,
    visible: boolean,
    color: string,
    size: number,
  ): Plot => ({
    title,
    values: shown(data, visible),
    color,
    pane: 'oscillator',
    lineWidth: size,
    style: 'circles',
  })
  const colors1 = pairColors(values.main1, values.signal1, TMO_COLORS.bull, TMO_COLORS.bear)
  const colors2 = pairColors(values.main2, values.signal2, TMO_COLORS.bull, TMO_COLORS.bear)
  const colors3 = pairColors(values.main3, values.signal3, TMO_COLORS.tmo2Bull, TMO_COLORS.tmo2Bear)
  return [
    line('TMO 1 Main', values.main1, colors1),
    line('TMO 1 Signal', values.signal1, colors1),
    line('TMO 2 Main', values.main2, colors2),
    line('TMO 2 Signal', values.signal2, colors2),
    line('TMO 3 Main', values.main3, colors3),
    line('TMO 3 Signal', values.signal3, colors3),
    dots(
      'TMO 1 Bullish Signal',
      values.bull1,
      settings.showTmo1Signals,
      TMO_COLORS.tmo1Bull,
      settings.signalSize,
    ),
    dots(
      'TMO 1 Bearish Signal',
      values.bear1,
      settings.showTmo1Signals,
      TMO_COLORS.bear,
      settings.signalSize,
    ),
    dots(
      'TMO 2 Bullish Signal',
      values.bull2,
      settings.showTmo2Signals,
      TMO_COLORS.tmo2Bull,
      settings.signalSize + 2,
    ),
    dots(
      'TMO 2 Bearish Signal',
      values.bear2,
      settings.showTmo2Signals,
      TMO_COLORS.tmo2Bear,
      settings.signalSize + 2,
    ),
    dots(
      'TMO 2 Extreme Bullish',
      values.bullExtreme,
      settings.showTmo2ExtremeSignals,
      TMO_COLORS.extremeBull,
      settings.signalSize + 2,
    ),
    dots(
      'TMO 2 Extreme Bearish',
      values.bearExtreme,
      settings.showTmo2ExtremeSignals,
      TMO_COLORS.extremeBear,
      settings.signalSize + 2,
    ),
    level('OB Cutoff Line', TMO_CUTOFF, TMO_COLORS.bear),
    level('OS Cutoff Line', -TMO_CUTOFF, TMO_COLORS.bull),
    level('Zero Line', 0, TMO_COLORS.zero),
  ]
}
