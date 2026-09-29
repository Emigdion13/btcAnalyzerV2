import { INTERVAL_SECONDS, bucketStart } from '../../shared/coinbase'
import type { Candle, ChileReversalSettings, Indicator, Timeframe } from './types'
import { CHILE_REVERSAL_DEFAULTS } from './types'

/**
 * Chile Reversal — the Atlas port of "ROBEX IA CHILERA V17 PRO".
 *
 * The script is one engine, so this module is one engine too: the higher-timeframe pivot levels,
 * the four price-vs-level patterns that feed the score, the 20-point score itself, the call for
 * the next round, and the chart output the original paints — ROBEX Trend (a supertrend), the
 * EMA 9/21 pair, VWAP, the R1/R2/S1/S2 lines, and an ARRIBA/ABAJO label on every confirmed round
 * close the score calls. The floating Chile panel (`lib/chile-panel.ts`) is the same engine's
 * `table`, read off the newest bar of the same result.
 *
 * Faithful details:
 *
 * 1. Levels are `ta.pivothigh/pivotlow(high/low, pivotIzq, pivotDer)` on the pivot timeframe,
 *    remembered four deep (`ph1..ph4`/`pl1..pl4`), and R1/R2 are the two nearest remembered highs
 *    strictly above the close — compared against the level itself. V17 has no zone thickness:
 *    `reboteS1 = low <= soporte1 and close > soporte1 and close > open`.
 * 2. Candidates further than `maxDistATR × ATR(14)` are discarded, and the 6-bar high/low range
 *    fills an empty first slot (`miniHigh`/`miniLow`).
 * 3. Every higher-timeframe read is the closed bar (`x[1]` under `lookahead_on`), so a developing
 *    candle's eventual extreme never reaches an earlier chart bar. The 5m momentum read is the
 *    exception, because the original asks for it without `[1]`: it is the 5m bar *containing* the
 *    chart bar, forming values on the live edge.
 * 4. Signals print only where the original prints them: `fin15 and barstate.isconfirmed`, i.e. a
 *    chart bar that closes a round, once that bar has closed.
 * 5. `mercadoLateral` suppresses both calls, and the call needs `minScore` points *and* a
 *    `minVentaja`-point lead.
 *
 * One deliberate correction, documented in docs/chile-reversal.md: the Pine R2/S2 insertion sort
 * can assign r2/s2 while r1/s1 is still `na`, producing a second level with no first. Here the
 * nearest candidate is always R1/S1 and the runner-up R2/S2.
 */

/** Pine `ta.atr(14)` on the higher timeframe. */
export const CHILE_ATR_LENGTH = 14
/** Pine `ta.rsi(close, 14)`. */
export const CHILE_RSI_LENGTH = 14
/** Pine `ta.ema(close, 9)`. */
export const CHILE_EMA_LENGTH = 9
/** Pine `ta.ema(close, 21)`. */
export const CHILE_EMA_SLOW_LENGTH = 21
/** Pine `ta.highest(high, 6)[1]` / `ta.lowest(low, 6)[1]` fallback window. */
export const CHILE_MINI_RANGE = 6
/** How many pivots of each side the original remembers: ph1..ph4 / pl1..pl4. */
export const CHILE_PIVOT_MEMORY = 4
/** The resolution the momentum read comes from, hard-coded `"5"` in Pine. */
export const CHILE_MOMENTUM_TIMEFRAME: Timeframe = '5m'
/** Pine `ta.sma(volume, 20)` for the volume ratio. */
export const CHILE_VOLUME_SMA = 20
/** Pine `volAlto = volRatio >= 1.20`, `volMuyAlto = volRatio >= 1.60`. */
export const CHILE_VOLUME_HIGH = 1.2
export const CHILE_VOLUME_VERY_HIGH = 1.6
/** Pine `buyersStrong = compradores >= 60`. */
export const CHILE_STRONG_SIDE = 60
/** Pine `rsi15 >= 55` (2 points) / `> 50` (1 point), and `<= 45` / `< 50` for the down side. */
export const CHILE_RSI_STRONG = 55
export const CHILE_RSI_WEAK = 45
export const CHILE_RSI_MID = 50
/** Pine `pressureUp/Down`: local RSI outside 52/48. */
export const CHILE_PRESSURE_RSI = 52
/** Pine `momentumUp/Down`: 5m RSI outside 52/48. */
export const CHILE_MOMENTUM_RSI = 52
/** Pine `cercaR1/cercaS1`: within 0.20 ATR of the level. */
export const CHILE_NEAR_LEVEL_ATR = 0.2
/** Pine `mercadoLateral`: EMA gap under 0.025 ATR with the local RSI inside 47–53. */
export const CHILE_LATERAL_ATR = 0.025
export const CHILE_LATERAL_RSI_LOW = 47
export const CHILE_LATERAL_RSI_HIGH = 53
/** Pine `rondaFuerteUp/Down`: the round's move in ATR and the close position in its range. */
export const CHILE_ROUND_MOVE = 0.2
export const CHILE_ROUND_STRONG_UP = 0.65
export const CHILE_ROUND_STRONG_DOWN = 0.35
/** Every reversal event scores +3 in the original. */
export const CHILE_REVERSAL_POINTS = 3
/** Divide-by-zero guard where Pine would use `syminfo.mintick`. */
const MIN_RANGE = 1e-9

/** Palette matching the Pine script's verde/rojo/amarillo constants. */
export const CHILE_REVERSAL_COLORS = {
  /** Pine `verde` rgb(0, 225, 145) — support, ARRIBA. */
  support: '#00e191',
  /** Pine `verdeFuerte` rgb(0, 160, 95) — S2. */
  supportStrong: '#00a05f',
  /** Pine `rojo` rgb(250, 65, 90) — resistance, ABAJO. */
  resistance: '#fa415a',
  /** Pine `rojoFuerte` rgb(190, 35, 55) — R2. */
  resistanceStrong: '#be2337',
  /** Pine `azul` rgb(55, 145, 255) — VWAP. */
  vwap: '#3791ff',
  /** Pine `blanco` rgb(245, 247, 250). */
  foreground: '#f5f7fa',
} as const

export type ChileLevelKind = 'R1' | 'R2' | 'S1' | 'S2'
export type ChileSignalKind = 'arriba' | 'abajo'
export type ChileCall = 'up' | 'down' | 'wait'
export type ChileTrend = 'up' | 'down' | 'mixed'
export type ChileVolume = 'normal' | 'high' | 'very-high'
export type ChileLevelState =
  | 'none'
  | 'near-r1'
  | 'near-r2'
  | 'near-s1'
  | 'near-s2'
  | 'bounce'
  | 'reject'
  | 'break-resistance'
  | 'break-support'

export interface ChileLevel {
  kind: ChileLevelKind
  side: 'support' | 'resistance'
  /** The pivot price itself. V17 compares price against the level, not against a zone. */
  price: number
  /** True when the level came from the 6-bar mini-range fallback. */
  fallback: boolean
}

/** The four price-vs-level patterns, worth +3 each in the score. */
export interface ChileReversalEvents {
  bounce: boolean
  reject: boolean
  breakResistance: boolean
  breakSupport: boolean
}

/** One scored contribution, so the panel can show why it says what it says. */
export interface ChileScoreFactor {
  key: string
  label: string
  side: 'up' | 'down'
  points: number
}

/** Everything the score and the panel read off one chart bar. */
export interface ChileBarState {
  index: number
  time: number
  /** The chart bar's close — the live price on the forming bar. */
  close: number
  /** False while a closed round bar or its ATR is still missing. */
  ready: boolean
  scoreUp: number
  scoreDown: number
  /** Pine `fuerzaArriba`/`fuerzaAbajo`: each side's share of the total, in percent. */
  fuerzaArriba: number
  fuerzaAbajo: number
  /** Pine `ventaja`: the signed gap, positive when the up side leads. */
  advantage: number
  prediction: 1 | -1 | 0
  call: ChileCall
  /** Pine `mercadoLateral` — both calls are suppressed while it holds. */
  lateral: boolean
  /** Pine `fin15`: this chart bar closes a round. */
  official: boolean
  /** Pine `barstate.isconfirmed` for this bar. */
  confirmed: boolean
  buyers: number
  sellers: number
  volumeRatio: number
  volume: ChileVolume
  rsiRound: number | null
  rsiLocal: number | null
  trend: ChileTrend
  /** Pine `trendTexto`. */
  trendLabel: 'ALCISTA' | 'BAJISTA' | 'MIXTA'
  /** Pine `robexUp`/`robexDown`; null while the supertrend warms up. */
  supertrendUp: boolean | null
  level: ChileLevelState
  /** Pine `srTexto`. */
  levelLabel: string
  round: {
    open: number | null
    high: number | null
    low: number | null
    /** Pine `posRonda`: close position inside the round range, 0–1. */
    position: number | null
    /** Pine `movRonda`: the round's move in round-ATR units. */
    move: number | null
    strong: boolean
    up: boolean
  }
  /** The scored contributions, on the newest bar only — the panel is their only reader. */
  factors: ChileScoreFactor[]
}

export interface ChileSignal {
  kind: ChileSignalKind
  /** Chart-bar index the label printed on — always a bar that closes a round. */
  index: number
  time: number
  /** Candle anchor for the label: low for ARRIBA (belowbar), high for ABAJO (abovebar). */
  price: number
  side: 'bullish' | 'bearish'
  scoreUp: number
  scoreDown: number
  advantage: number
}

export interface ChileReversalResult {
  /** Levels resolved on the most recent bar; what the overlay draws. */
  levels: ChileLevel[]
  signals: ChileSignal[]
  /** Per-bar HTF ATR, for the legend and tests. */
  atr: (number | null)[]
  /** Bars needed before the HTF ATR and pivots can produce a level. */
  warmupBars: number
  /** The higher timeframe actually used. */
  resolution: Timeframe
  /** True when the HTF feed had no candles, so nothing could be computed. */
  missingFeed: boolean
  /** Pine `plot(supertrend, "ROBEX TREND")`. */
  supertrend: (number | null)[]
  /** Pine `robexUp`/`robexDown`, which drive the trend line's colour. */
  supertrendUp: (boolean | null)[]
  ema9: (number | null)[]
  ema21: (number | null)[]
  vwap: (number | null)[]
  /** The per-bar score, one entry per chart bar. */
  bars: ChileBarState[]
  /** The newest bar's state — what the floating panel reads. */
  last: ChileBarState | null
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** The settings this engine reads, so a stored profile cannot smuggle retired fields back in. */
const SETTING_KEYS = [
  'resolution',
  'minScore',
  'minEdge',
  'pivotLeft',
  'pivotRight',
  'maxDistanceAtr',
  'lineLength',
  'trendFactor',
  'trendAtrLength',
  'showTrend',
  'showEma',
  'showVwap',
  'showLevels',
  'markerTtlSeconds',
  'markerFadeSeconds',
  'supportColor',
  'resistanceColor',
] as const

export function isChileReversalSettings(value: unknown): value is ChileReversalSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  const int = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  return (
    typeof s.resolution === 'string' &&
    s.resolution in INTERVAL_SECONDS &&
    int(s.minScore, 3, 20) &&
    int(s.minEdge, 1, 8) &&
    int(s.pivotLeft, 1, 5) &&
    int(s.pivotRight, 1, 5) &&
    num(s.maxDistanceAtr, 0.5, 6) &&
    int(s.lineLength, 10, 100) &&
    num(s.trendFactor, 1, 5) &&
    int(s.trendAtrLength, 5, 30) &&
    typeof s.showTrend === 'boolean' &&
    typeof s.showEma === 'boolean' &&
    typeof s.showVwap === 'boolean' &&
    typeof s.showLevels === 'boolean' &&
    // Optional so a profile persisted before the marker lifetime existed keeps validating;
    // chileReversalSettings() fills the defaults in.
    (s.markerTtlSeconds === undefined || num(s.markerTtlSeconds, 0, 3600)) &&
    (s.markerFadeSeconds === undefined || num(s.markerFadeSeconds, 0, 600)) &&
    typeof s.supportColor === 'string' &&
    HEX_COLOR.test(s.supportColor) &&
    typeof s.resistanceColor === 'string' &&
    HEX_COLOR.test(s.resistanceColor)
  )
}

export function chileReversalSettings(indicator: Indicator): ChileReversalSettings {
  const candidate = indicator.chileReversal
  if (!isChileReversalSettings(candidate)) return { ...CHILE_REVERSAL_DEFAULTS }
  // Defaults first, then only the keys this engine knows: a profile saved by an older port
  // (zone thickness, confirmation gates, panel-prefixed inputs) must not leak through.
  const next: Record<string, unknown> = { ...CHILE_REVERSAL_DEFAULTS }
  const source = candidate as unknown as Record<string, unknown>
  for (const key of SETTING_KEYS) {
    if (source[key] !== undefined) next[key] = source[key]
  }
  return next as unknown as ChileReversalSettings
}

export function chileReversalIndicatorLabel(indicator: Indicator): string {
  const s = chileReversalSettings(indicator)
  return `Chile Reversal (${s.resolution}, ${s.pivotLeft}, ${s.pivotRight}, ${s.minScore}/${s.minEdge})`
}

export interface ChileReversalContext {
  timeframe: Timeframe
  timeframes?: Partial<Record<Timeframe, { candles: Candle[] }>>
  replay?: boolean
  /**
   * Wall-clock seconds, when the caller has them. A bar counts as confirmed — the original's
   * `barstate.isconfirmed` — once its close time has passed; without a clock every bar is treated
   * as confirmed, which is right for replay and for pinned demo history.
   */
  nowSeconds?: number
}

/** Wilder ATR, matching Pine `ta.atr(length)`. */
export function wilderAtr(candles: Candle[], length: number): (number | null)[] {
  const out: (number | null)[] = []
  let previousClose: number | null = null
  let sum = 0
  let atr: number | null = null
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const tr =
      previousClose === null
        ? c.high - c.low
        : Math.max(
            c.high - c.low,
            Math.abs(c.high - previousClose),
            Math.abs(c.low - previousClose),
          )
    previousClose = c.close
    if (i < length) {
      sum += tr
      atr = i === length - 1 ? sum / length : null
    } else if (atr !== null) {
      atr = (atr * (length - 1) + tr) / length
    }
    out.push(atr)
  }
  return out
}

/** Pine `ta.ema` seeded from the first value (not the Studio's SMA-seeded ema). */
export function pineEmaSeries(values: number[], length: number): (number | null)[] {
  const alpha = 2 / (length + 1)
  let previous: number | null = null
  return values.map((value, i) => {
    previous = previous === null ? value : value * alpha + previous * (1 - alpha)
    return i >= length - 1 ? previous : null
  })
}

/** Wilder RSI, matching Pine `ta.rsi`. */
export function wilderRsi(values: number[], length: number): (number | null)[] {
  const out: (number | null)[] = []
  let gain = 0
  let loss = 0
  let avgGain: number | null = null
  let avgLoss = 0
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      out.push(null)
      continue
    }
    const diff = values[i]! - values[i - 1]!
    const up = Math.max(diff, 0)
    const down = Math.max(-diff, 0)
    if (i <= length) {
      gain += up
      loss += down
      if (i === length) {
        avgGain = gain / length
        avgLoss = loss / length
      }
    } else if (avgGain !== null) {
      avgGain = (avgGain * (length - 1) + up) / length
      avgLoss = (avgLoss * (length - 1) + down) / length
    }
    if (avgGain === null) {
      out.push(null)
      continue
    }
    out.push(avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return out
}

/** Rolling mean, Pine `ta.sma`. */
export function simpleMovingAverage(values: number[], length: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < length - 1) return null
    let sum = 0
    for (let j = i - length + 1; j <= i; j++) sum += values[j]!
    return sum / length
  })
}

/** Pine `ta.vwap(hlc3)`, reset each UTC day like Atlas's built-in VWAP. */
export function sessionVwap(candles: Candle[]): (number | null)[] {
  let day: number | null = null
  let pv = 0
  let vol = 0
  return candles.map((candle) => {
    const current = Math.floor(candle.time / 86400)
    if (day !== current) {
      day = current
      pv = 0
      vol = 0
    }
    const typical = (candle.high + candle.low + candle.close) / 3
    const volume = candle.volume > 0 ? candle.volume : 0
    pv += typical * volume
    vol += volume
    return vol > 0 ? pv / vol : typical
  })
}

/**
 * Pine `ta.supertrend(factor, atrPeriod)`: the trailing band pair and the direction the original
 * reads (`robexUp = direccionST < 0`). Each band only tightens until price closes through it, and
 * the direction flips on that close.
 */
export function pineSupertrend(
  candles: Candle[],
  factor: number,
  atrLength: number,
): { value: (number | null)[]; direction: (number | null)[] } {
  const atr = wilderAtr(candles, atrLength)
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []
  const value: (number | null)[] = []
  const direction: (number | null)[] = []

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!
    const range = atr[i]
    const mid = (candle.high + candle.low) / 2
    const basicUpper = range === null ? null : mid + factor * range
    const basicLower = range === null ? null : mid - factor * range
    const previousClose = i > 0 ? candles[i - 1]!.close : null
    const previousUpper = i > 0 ? upper[i - 1] : null
    const previousLower = i > 0 ? lower[i - 1] : null

    const band = (
      basic: number | null,
      previous: number | null,
      tighter: (a: number, b: number) => boolean,
      crossed: (close: number, band: number) => boolean,
    ): number | null => {
      if (basic === null) return null
      if (previous === null) return basic
      return tighter(basic, previous) ||
        (previousClose !== null && crossed(previousClose, previous))
        ? basic
        : previous
    }

    const u = band(
      basicUpper,
      previousUpper,
      (a, b) => a < b,
      (close, b) => close > b,
    )
    const l = band(
      basicLower,
      previousLower,
      (a, b) => a > b,
      (close, b) => close < b,
    )
    upper.push(u)
    lower.push(l)

    const previous = i > 0 ? value[i - 1] : null
    let next: number | null = null
    if (u !== null && l !== null) {
      if (previous === null) next = candle.close > u ? l : u
      else if (previous === previousUpper) next = candle.close <= u ? u : l
      else next = candle.close >= l ? l : u
    }
    value.push(next)
    direction.push(next === null ? null : next === u ? 1 : -1)
  }
  return { value, direction }
}

/**
 * Maps every chart bar to the newest higher-timeframe bar that had already CLOSED — what
 * `request.security(..., x[1], lookahead=barmerge.lookahead_on)` delivers. When the source
 * resolution is at or below the chart's own, the request degenerates to the previous chart bar.
 */
export function closedHtfIndexes(
  chartTimes: number[],
  htf: { time: number }[],
  resolution: Timeframe,
  higher: boolean,
): (number | null)[] {
  const out: (number | null)[] = []
  let cursor = -1
  for (const time of chartTimes) {
    if (higher) {
      const bucket = bucketStart(time, resolution)
      while (cursor + 1 < htf.length && htf[cursor + 1]!.time <= bucket) cursor++
      // `[1]`: the bar before the developing one.
      const closedIndex = htf[cursor]?.time === bucket ? cursor - 1 : cursor
      out.push(closedIndex >= 0 ? closedIndex : null)
    } else {
      cursor++
      out.push(cursor > 0 ? cursor - 1 : null)
    }
  }
  return out
}

/**
 * The same walk without the `[1]` shift: the higher-timeframe bar *containing* each chart bar.
 * This is what `request.security(syminfo.tickerid, "5", x)` returns — the forming bar on the live
 * edge, and a bar whose values are final for history. The original asks for its 5m reads this way,
 * which is what makes them repaint inside the 5m bar.
 */
export function containingHtfIndexes(
  chartTimes: number[],
  htf: { time: number }[],
  resolution: Timeframe,
  higher: boolean,
): (number | null)[] {
  if (!higher) return chartTimes.map((_, i) => i)
  const out: (number | null)[] = []
  let cursor = -1
  for (const time of chartTimes) {
    const bucket = bucketStart(time, resolution)
    while (cursor + 1 < htf.length && htf[cursor + 1]!.time <= bucket) cursor++
    out.push(cursor >= 0 ? cursor : null)
  }
  return out
}

/** Pine `ta.pivothigh(high, left, right)` — confirmed `right` bars after the pivot. */
function pivotHighs(candles: Candle[], left: number, right: number): (number | null)[] {
  return candles.map((_, i) => {
    const p = i - right
    if (p < left) return null
    const value = candles[p]!.high
    for (let j = p - left; j <= p + right; j++) {
      if (j === p) continue
      if (candles[j]!.high >= value) return null
    }
    return value
  })
}

function pivotLows(candles: Candle[], left: number, right: number): (number | null)[] {
  return candles.map((_, i) => {
    const p = i - right
    if (p < left) return null
    const value = candles[p]!.low
    for (let j = p - left; j <= p + right; j++) {
      if (j === p) continue
      if (candles[j]!.low <= value) return null
    }
    return value
  })
}

/** Rolling high/low over `window` bars, Pine `ta.highest`/`ta.lowest`. */
function rollingExtreme(
  candles: Candle[],
  window: number,
  pick: 'high' | 'low',
): (number | null)[] {
  return candles.map((_, i) => {
    if (i < window - 1) return null
    let best = candles[i]![pick]
    for (let j = i - window + 1; j <= i; j++) {
      const v = candles[j]![pick]
      best = pick === 'high' ? Math.max(best, v) : Math.min(best, v)
    }
    return best
  })
}

/** Per-HTF-bar state the chart bars read from, using only closed HTF bars. */
interface HtfState {
  time: number
  atr: number | null
  emaFast: number | null
  emaSlow: number | null
  rsi: number | null
  high: number
  low: number
  pivotHighs: number[]
  pivotLows: number[]
  miniHigh: number | null
  miniLow: number | null
}

function buildHtfStates(source: Candle[], settings: ChileReversalSettings): HtfState[] {
  const atr = wilderAtr(source, CHILE_ATR_LENGTH)
  const closes = source.map((c) => c.close)
  const emaFast = pineEmaSeries(closes, CHILE_EMA_LENGTH)
  const emaSlow = pineEmaSeries(closes, CHILE_EMA_SLOW_LENGTH)
  const rsi = wilderRsi(closes, CHILE_RSI_LENGTH)
  const ph = pivotHighs(source, settings.pivotLeft, settings.pivotRight)
  const pl = pivotLows(source, settings.pivotLeft, settings.pivotRight)
  const miniHigh = rollingExtreme(source, CHILE_MINI_RANGE, 'high')
  const miniLow = rollingExtreme(source, CHILE_MINI_RANGE, 'low')

  // ph1..ph4 / pl1..pl4: newest first, pushed only on a NEW pivot
  // (`not na(pivotHigh15) and na(pivotHigh15[1])`).
  const highs: number[] = []
  const lows: number[] = []
  return source.map((candle, i) => {
    if (ph[i] !== null && (i === 0 || ph[i - 1] === null)) {
      highs.unshift(ph[i]!)
      highs.length = Math.min(highs.length, CHILE_PIVOT_MEMORY)
    }
    if (pl[i] !== null && (i === 0 || pl[i - 1] === null)) {
      lows.unshift(pl[i]!)
      lows.length = Math.min(lows.length, CHILE_PIVOT_MEMORY)
    }
    return {
      time: candle.time,
      atr: atr[i],
      emaFast: emaFast[i],
      emaSlow: emaSlow[i],
      rsi: rsi[i],
      high: candle.high,
      low: candle.low,
      pivotHighs: [...highs],
      pivotLows: [...lows],
      miniHigh: miniHigh[i],
      miniLow: miniLow[i],
    }
  })
}

/**
 * Resolve R1/R2/S1/S2 for one chart bar: the nearest remembered pivot above/below the close wins,
 * the runner-up is the second level, both filtered by `maxDistanceAtr`, with the mini-range
 * fallback when the first slot is empty.
 */
function resolveLevels(
  close: number,
  state: HtfState,
  settings: ChileReversalSettings,
): ChileLevel[] {
  const atr = state.atr
  if (atr === null || !(atr > 0)) return []
  const maxDistance = atr * settings.maxDistanceAtr

  const above = state.pivotHighs.filter((price) => price > close).sort((a, b) => a - b)
  const below = state.pivotLows.filter((price) => price < close).sort((a, b) => b - a)

  const levels: ChileLevel[] = []
  const push = (
    kind: ChileLevelKind,
    side: 'support' | 'resistance',
    price: number | undefined,
    fallback = false,
  ) => {
    if (price === undefined) return false
    const distance = side === 'resistance' ? price - close : close - price
    if (!(distance > 0) || distance > maxDistance) return false
    levels.push({ kind, side, price, fallback })
    return true
  }

  const hasR1 = push('R1', 'resistance', above[0])
  if (hasR1) push('R2', 'resistance', above[1])
  else if (state.miniHigh !== null && state.miniHigh > close)
    push('R1', 'resistance', state.miniHigh, true)

  const hasS1 = push('S1', 'support', below[0])
  if (hasS1) push('S2', 'support', below[1])
  else if (state.miniLow !== null && state.miniLow < close)
    push('S1', 'support', state.miniLow, true)

  return levels
}

/** The V17 `srTexto` states, in the order the original assigns them. */
export const CHILE_LEVEL_LABELS: Record<ChileLevelState, string> = {
  none: 'SIN NIVEL CERCANO',
  'near-r1': 'CERCA R1',
  'near-r2': 'CERCA R2',
  'near-s1': 'CERCA S1',
  'near-s2': 'CERCA S2',
  bounce: 'REBOTE SOPORTE',
  reject: 'RECHAZO RESIST.',
  'break-resistance': 'ROMPE RESIST.',
  'break-support': 'ROMPE SOPORTE',
}

/** The four patterns, evaluated on the chart candle against the resolved levels. */
function reversalEvents(candle: Candle, previousClose: number | null, levels: ChileLevel[]) {
  const events: ChileReversalEvents = {
    bounce: false,
    reject: false,
    breakResistance: false,
    breakSupport: false,
  }
  const r1 = levels.find((level) => level.kind === 'R1')
  const s1 = levels.find((level) => level.kind === 'S1')
  for (const level of levels) {
    if (level.side === 'support') {
      // reboteS1 = low <= soporte1 and close > soporte1 and close > open
      if (candle.low <= level.price && candle.close > level.price && candle.close > candle.open)
        events.bounce = true
    } else if (
      // rechazoR1 = high >= resistencia1 and close < resistencia1 and close < open
      candle.high >= level.price &&
      candle.close < level.price &&
      candle.close < candle.open
    )
      events.reject = true
  }
  if (previousClose !== null) {
    if (r1 && candle.close > r1.price && previousClose <= r1.price) events.breakResistance = true
    if (s1 && candle.close < s1.price && previousClose >= s1.price) events.breakSupport = true
  }
  return events
}

/** The reads one bar's score is built from. */
interface BarReads {
  robexUp: boolean
  robexDown: boolean
  trendRoundUp: boolean
  trendRoundDown: boolean
  slopeUp: boolean
  slopeDown: boolean
  rsiRound: number | null
  higherHigh: boolean
  higherLow: boolean
  lowerHigh: boolean
  lowerLow: boolean
  momentumUp: boolean
  momentumDown: boolean
  pressureUp: boolean
  pressureDown: boolean
  aboveVwap: boolean
  belowVwap: boolean
  buyersStrong: boolean
  sellersStrong: boolean
  volumeHigh: boolean
  roundStrongUp: boolean
  roundUp: boolean
  roundStrongDown: boolean
  roundDown: boolean
  events: ChileReversalEvents
}

/**
 * The 20-point score. Fourteen contributions a side, each the original's fixed number of points;
 * `withFactors` also returns them as a list, which only the newest bar needs (the panel is the
 * only reader of "why").
 */
function scoreReads(
  reads: BarReads,
  withFactors: boolean,
): { scoreUp: number; scoreDown: number; factors: ChileScoreFactor[] } {
  const factors: ChileScoreFactor[] = []
  let scoreUp = 0
  let scoreDown = 0
  const add = (key: string, label: string, side: 'up' | 'down', points: number) => {
    if (points <= 0) return
    if (side === 'up') scoreUp += points
    else scoreDown += points
    if (withFactors) factors.push({ key, label, side, points })
  }

  add('robex-trend', 'ROBEX trend', 'up', reads.robexUp ? 2 : 0)
  add('robex-trend-down', 'ROBEX trend', 'down', reads.robexDown ? 2 : 0)
  add('round-ema-cross', 'Round EMA cross', 'up', reads.trendRoundUp ? 2 : 0)
  add('round-ema-cross-down', 'Round EMA cross', 'down', reads.trendRoundDown ? 2 : 0)
  add('round-slope', 'Round EMA slope', 'up', reads.slopeUp ? 1 : 0)
  add('round-slope-down', 'Round EMA slope', 'down', reads.slopeDown ? 1 : 0)
  if (reads.rsiRound !== null) {
    const rsi = reads.rsiRound
    add('round-rsi', 'Round RSI', 'up', rsi >= CHILE_RSI_STRONG ? 2 : rsi > CHILE_RSI_MID ? 1 : 0)
    add(
      'round-rsi-down',
      'Round RSI',
      'down',
      rsi <= CHILE_RSI_WEAK ? 2 : rsi < CHILE_RSI_MID ? 1 : 0,
    )
  }
  add('higher-high', 'Higher high', 'up', reads.higherHigh ? 1 : 0)
  add('higher-low', 'Higher low', 'up', reads.higherLow ? 1 : 0)
  add('lower-high', 'Lower high', 'down', reads.lowerHigh ? 1 : 0)
  add('lower-low', 'Lower low', 'down', reads.lowerLow ? 1 : 0)
  add('momentum', '5m momentum', 'up', reads.momentumUp ? 2 : 0)
  add('momentum-down', '5m momentum', 'down', reads.momentumDown ? 2 : 0)
  add('pressure', 'Chart pressure', 'up', reads.pressureUp ? 1 : 0)
  add('pressure-down', 'Chart pressure', 'down', reads.pressureDown ? 1 : 0)
  add('vwap', 'Above VWAP', 'up', reads.aboveVwap ? 1 : 0)
  add('vwap-down', 'Below VWAP', 'down', reads.belowVwap ? 1 : 0)
  add('buyers', 'Buyers in control', 'up', reads.buyersStrong ? 1 : 0)
  add('sellers', 'Sellers in control', 'down', reads.sellersStrong ? 1 : 0)
  add('buyers-volume', 'Buyers on volume', 'up', reads.volumeHigh && reads.buyersStrong ? 1 : 0)
  add(
    'sellers-volume',
    'Sellers on volume',
    'down',
    reads.volumeHigh && reads.sellersStrong ? 1 : 0,
  )
  add('round', 'Round so far', 'up', reads.roundStrongUp ? 2 : reads.roundUp ? 1 : 0)
  add('round-down', 'Round so far', 'down', reads.roundStrongDown ? 2 : reads.roundDown ? 1 : 0)
  const points = CHILE_REVERSAL_POINTS
  add('bounce', 'Bounce off support', 'up', reads.events.bounce ? points : 0)
  add('reject', 'Rejection at resistance', 'down', reads.events.reject ? points : 0)
  add('break-resistance', 'Breaks resistance', 'up', reads.events.breakResistance ? points : 0)
  add('break-support', 'Breaks support', 'down', reads.events.breakSupport ? points : 0)

  if (withFactors) factors.sort((a, b) => b.points - a.points)
  return { scoreUp, scoreDown, factors }
}

/** The round (ronda) accumulation, per chart bar, in the round resolution's buckets. */
interface RoundState {
  open: number
  high: number
  low: number
}

function roundStates(candles: Candle[], resolution: Timeframe): RoundState[] {
  let current: RoundState | null = null
  let bucket: number | null = null
  return candles.map((candle) => {
    const start = bucketStart(candle.time, resolution)
    // `nuevaRonda = ta.change(time("15")) != 0`
    if (current === null || bucket !== start) {
      current = { open: candle.open, high: candle.high, low: candle.low }
      bucket = start
    } else {
      current = {
        open: current.open,
        high: Math.max(current.high, candle.high),
        low: Math.min(current.low, candle.low),
      }
    }
    return current
  })
}

function barState(
  candle: Candle,
  index: number,
  ready: boolean,
  official: boolean,
  confirmed: boolean,
): ChileBarState {
  return {
    index,
    time: candle.time,
    close: candle.close,
    ready,
    scoreUp: 0,
    scoreDown: 0,
    fuerzaArriba: 0,
    fuerzaAbajo: 0,
    advantage: 0,
    prediction: 0,
    call: 'wait',
    lateral: false,
    official,
    confirmed,
    buyers: 50,
    sellers: 50,
    volumeRatio: 1,
    volume: 'normal',
    rsiRound: null,
    rsiLocal: null,
    trend: 'mixed',
    trendLabel: 'MIXTA',
    supertrendUp: null,
    level: 'none',
    levelLabel: CHILE_LEVEL_LABELS.none,
    round: {
      open: null,
      high: null,
      low: null,
      position: null,
      move: null,
      strong: false,
      up: false,
    },
    factors: [],
  }
}

export function calculateChileReversal(
  candles: Candle[],
  settings: ChileReversalSettings,
  context: ChileReversalContext = { timeframe: '1m' },
): ChileReversalResult {
  if (!isChileReversalSettings(settings)) throw new Error('Invalid Chile Reversal settings.')

  const warmupBars = Math.max(CHILE_ATR_LENGTH, settings.pivotLeft + settings.pivotRight + 1)
  const chartStep = INTERVAL_SECONDS[context.timeframe] ?? 60
  const roundSeconds = INTERVAL_SECONDS[settings.resolution] ?? 900
  const higher = roundSeconds > chartStep
  const momentumStep = INTERVAL_SECONDS[CHILE_MOMENTUM_TIMEFRAME]
  const momentumHigher = momentumStep > chartStep

  const empty = (missingFeed: boolean): ChileReversalResult => ({
    levels: [],
    signals: [],
    atr: candles.map(() => null),
    warmupBars,
    resolution: settings.resolution,
    missingFeed,
    supertrend: candles.map(() => null),
    supertrendUp: candles.map(() => null),
    ema9: candles.map(() => null),
    ema21: candles.map(() => null),
    vwap: candles.map(() => null),
    bars: candles.map((candle, i) => barState(candle, i, false, false, true)),
    last: null,
  })
  if (!candles.length) return empty(false)

  const source = higher ? (context.timeframes?.[settings.resolution]?.candles ?? []) : candles
  if (higher && !source.length) return empty(true)
  const momentumSource = momentumHigher
    ? (context.timeframes?.[CHILE_MOMENTUM_TIMEFRAME]?.candles ?? [])
    : candles

  const states = buildHtfStates(source, settings)
  const chartTimes = candles.map((candle) => candle.time)
  // Map every chart bar to the newest HTF bar that had already CLOSED, which is
  // what `request.security(..., x[1], lookahead_on)` delivers.
  const closedIndexes = closedHtfIndexes(chartTimes, states, settings.resolution, higher)
  const perBar = closedIndexes.map((index) => (index === null ? null : (states[index] ?? null)))
  // `high[2]`/`low[2]` and the EMA values one bar back, for the higher-high and slope reads.
  const previousBar = closedIndexes.map((index) =>
    index === null || index <= 0 ? null : (states[index - 1] ?? null),
  )

  // The 5m momentum read: the bar containing the chart bar, forming on the live edge.
  const momentumCloses = momentumSource.map((c) => c.close)
  const momentumEmaFast = pineEmaSeries(momentumCloses, CHILE_EMA_LENGTH)
  const momentumEmaSlow = pineEmaSeries(momentumCloses, CHILE_EMA_SLOW_LENGTH)
  const momentumRsi = wilderRsi(momentumCloses, CHILE_RSI_LENGTH)
  const perMomentum = containingHtfIndexes(
    chartTimes,
    momentumSource,
    CHILE_MOMENTUM_TIMEFRAME,
    momentumHigher,
  )

  const closes = candles.map((c) => c.close)
  const ema9 = pineEmaSeries(closes, CHILE_EMA_LENGTH)
  const ema21 = pineEmaSeries(closes, CHILE_EMA_SLOW_LENGTH)
  const rsiLocal = wilderRsi(closes, CHILE_RSI_LENGTH)
  const vwap = sessionVwap(candles)
  const volumeAverage = simpleMovingAverage(
    candles.map((c) => c.volume),
    CHILE_VOLUME_SMA,
  )
  const trend = pineSupertrend(candles, settings.trendFactor, settings.trendAtrLength)
  const rounds = roundStates(candles, settings.resolution)

  const bars: ChileBarState[] = []
  const signals: ChileSignal[] = []
  const atrSeries: (number | null)[] = []
  let lastLevels: ChileLevel[] = []

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!
    const state = perBar[i]
    const before = previousBar[i]
    const round = rounds[i]!
    // Pine `fin15 = minute(time_close) % 15 == 0`, plus `barstate.isconfirmed`.
    const official = (candle.time + chartStep) % roundSeconds === 0
    const confirmed =
      context.nowSeconds === undefined || candle.time + chartStep <= context.nowSeconds
    atrSeries.push(state?.atr ?? null)

    if (!state || state.atr === null || !(state.atr > 0)) {
      bars.push(barState(candle, i, false, official, confirmed))
      continue
    }
    const atr = state.atr
    const levels = resolveLevels(candle.close, state, settings)
    lastLevels = levels
    const previousClose = i > 0 ? (closes[i - 1] ?? null) : null
    const events = reversalEvents(candle, previousClose, levels)

    // --- buyers / sellers: close position inside the bar --------------------------------
    const barRange = Math.max(candle.high - candle.low, MIN_RANGE)
    const buyers = Math.round(
      Math.max(0, Math.min(1, (candle.close - candle.low) / barRange)) * 100,
    )
    const sellers = 100 - buyers
    const volumeRatio =
      volumeAverage[i] !== null && volumeAverage[i]! > 0 ? candle.volume / volumeAverage[i]! : 1

    // --- round state ----------------------------------------------------------------------
    const roundRange = Math.max(round.high - round.low, MIN_RANGE)
    const roundPosition = (candle.close - round.low) / roundRange
    const roundMove = (candle.close - round.open) / atr
    const roundUp = candle.close > round.open
    const roundDown = candle.close < round.open
    const roundStrongUp = roundMove > CHILE_ROUND_MOVE && roundPosition > CHILE_ROUND_STRONG_UP
    const roundStrongDown = roundMove < -CHILE_ROUND_MOVE && roundPosition < CHILE_ROUND_STRONG_DOWN

    // --- higher-timeframe trend reads ------------------------------------------------------
    const trendRoundUp =
      state.emaFast !== null && state.emaSlow !== null && state.emaFast > state.emaSlow
    const trendRoundDown =
      state.emaFast !== null && state.emaSlow !== null && state.emaFast < state.emaSlow
    const slopeUp =
      state.emaFast !== null &&
      state.emaSlow !== null &&
      before !== null &&
      before.emaFast !== null &&
      before.emaSlow !== null &&
      state.emaFast > before.emaFast &&
      state.emaSlow >= before.emaSlow
    const slopeDown =
      state.emaFast !== null &&
      state.emaSlow !== null &&
      before !== null &&
      before.emaFast !== null &&
      before.emaSlow !== null &&
      state.emaFast < before.emaFast &&
      state.emaSlow <= before.emaSlow
    const higherHigh = before !== null && state.high > before.high
    const higherLow = before !== null && state.low > before.low
    const lowerHigh = before !== null && state.high < before.high
    const lowerLow = before !== null && state.low < before.low

    // --- 5m momentum -------------------------------------------------------------------------
    const m = perMomentum[i]
    const momentumBar = m === null ? null : (momentumSource[m] ?? null)
    const mEmaFast = m === null ? null : (momentumEmaFast[m] ?? null)
    const mEmaSlow = m === null ? null : (momentumEmaSlow[m] ?? null)
    const mRsi = m === null ? null : (momentumRsi[m] ?? null)
    const momentumUp =
      mEmaFast !== null &&
      mEmaSlow !== null &&
      mRsi !== null &&
      momentumBar !== null &&
      mEmaFast > mEmaSlow &&
      mRsi > CHILE_MOMENTUM_RSI &&
      momentumBar.close > momentumBar.open
    const momentumDown =
      mEmaFast !== null &&
      mEmaSlow !== null &&
      mRsi !== null &&
      momentumBar !== null &&
      mEmaFast < mEmaSlow &&
      mRsi < 100 - CHILE_MOMENTUM_RSI &&
      momentumBar.close < momentumBar.open

    // --- local pressure, VWAP, lateral filter -------------------------------------------------
    const fast = ema9[i]
    const slow = ema21[i]
    const local = rsiLocal[i]
    const pressureUp =
      fast !== null &&
      slow !== null &&
      local !== null &&
      fast > slow &&
      candle.close > fast &&
      local > CHILE_PRESSURE_RSI
    const pressureDown =
      fast !== null &&
      slow !== null &&
      local !== null &&
      fast < slow &&
      candle.close < fast &&
      local < 100 - CHILE_PRESSURE_RSI
    const aboveVwap = vwap[i] !== null && candle.close > vwap[i]!
    const belowVwap = vwap[i] !== null && candle.close < vwap[i]!
    const lateral =
      fast !== null &&
      slow !== null &&
      local !== null &&
      Math.abs(fast - slow) < atr * CHILE_LATERAL_ATR &&
      local > CHILE_LATERAL_RSI_LOW &&
      local < CHILE_LATERAL_RSI_HIGH

    // --- proximity and the S/R text -------------------------------------------------------------
    const nearThreshold = atr * CHILE_NEAR_LEVEL_ATR
    const near = (kind: ChileLevelKind) => {
      const level = levels.find((candidate) => candidate.kind === kind)
      return level !== undefined && Math.abs(candle.close - level.price) <= nearThreshold
    }
    let level: ChileLevelState = 'none'
    if (near('R1')) level = 'near-r1'
    if (near('R2')) level = 'near-r2'
    if (near('S1')) level = 'near-s1'
    if (near('S2')) level = 'near-s2'
    if (events.bounce) level = 'bounce'
    if (events.reject) level = 'reject'
    if (events.breakResistance) level = 'break-resistance'
    if (events.breakSupport) level = 'break-support'

    // --- the score -------------------------------------------------------------------------------
    const supertrendUp = trend.direction[i] === null ? null : trend.direction[i] === -1
    const scored = scoreReads(
      {
        robexUp: supertrendUp === true,
        robexDown: supertrendUp === false,
        trendRoundUp,
        trendRoundDown,
        slopeUp,
        slopeDown,
        rsiRound: state.rsi,
        higherHigh,
        higherLow,
        lowerHigh,
        lowerLow,
        momentumUp,
        momentumDown,
        pressureUp,
        pressureDown,
        aboveVwap,
        belowVwap,
        buyersStrong: buyers >= CHILE_STRONG_SIDE,
        sellersStrong: sellers >= CHILE_STRONG_SIDE,
        volumeHigh: volumeRatio >= CHILE_VOLUME_HIGH,
        roundStrongUp,
        roundUp,
        roundStrongDown,
        roundDown,
        events,
      },
      i === candles.length - 1,
    )
    const total = Math.max(scored.scoreUp + scored.scoreDown, 1)
    const advantage = scored.scoreUp - scored.scoreDown
    let prediction: 1 | -1 | 0 = 0
    if (!lateral && scored.scoreUp >= settings.minScore && advantage >= settings.minEdge)
      prediction = 1
    else if (!lateral && scored.scoreDown >= settings.minScore && -advantage >= settings.minEdge)
      prediction = -1

    const trendCall: ChileTrend =
      supertrendUp === true && trendRoundUp
        ? 'up'
        : supertrendUp === false && trendRoundDown
          ? 'down'
          : 'mixed'

    bars.push({
      index: i,
      time: candle.time,
      close: candle.close,
      ready: true,
      scoreUp: scored.scoreUp,
      scoreDown: scored.scoreDown,
      fuerzaArriba: Math.round((Math.max(scored.scoreUp, 0) * 100) / total),
      fuerzaAbajo: Math.round((Math.max(scored.scoreDown, 0) * 100) / total),
      advantage,
      prediction,
      call: prediction === 1 ? 'up' : prediction === -1 ? 'down' : 'wait',
      lateral,
      official,
      confirmed,
      buyers,
      sellers,
      volumeRatio,
      volume:
        volumeRatio >= CHILE_VOLUME_VERY_HIGH
          ? 'very-high'
          : volumeRatio >= CHILE_VOLUME_HIGH
            ? 'high'
            : 'normal',
      rsiRound: state.rsi,
      rsiLocal: local,
      trend: trendCall,
      trendLabel: trendCall === 'up' ? 'ALCISTA' : trendCall === 'down' ? 'BAJISTA' : 'MIXTA',
      supertrendUp,
      level,
      levelLabel: CHILE_LEVEL_LABELS[level],
      round: {
        open: round.open,
        high: round.high,
        low: round.low,
        position: roundPosition,
        move: roundMove,
        strong: roundStrongUp || roundStrongDown,
        up: roundUp,
      },
      factors: scored.factors,
    })

    // `senalArriba = momentoOficial and prediccion == 1` — and only once the bar has closed.
    if (official && confirmed && prediction !== 0)
      signals.push({
        kind: prediction === 1 ? 'arriba' : 'abajo',
        index: i,
        time: candle.time,
        price: prediction === 1 ? candle.low : candle.high,
        side: prediction === 1 ? 'bullish' : 'bearish',
        scoreUp: scored.scoreUp,
        scoreDown: scored.scoreDown,
        advantage,
      })
  }

  return {
    levels: lastLevels,
    signals,
    atr: atrSeries,
    warmupBars,
    resolution: settings.resolution,
    missingFeed: false,
    supertrend: trend.value,
    supertrendUp: trend.direction.map((direction) => (direction === null ? null : direction < 0)),
    ema9,
    ema21,
    vwap,
    bars,
    last: bars.at(-1) ?? null,
  }
}

/**
 * Pine paints its labels under `max_labels_count` (100 here) and garbage-collects the oldest, so a
 * chart never accumulates a whole history of stale text. The overlay does the equivalent: only the
 * newest `maxCount` labels stay. The engine's raw `signals` stay untouched for the legend, the
 * panel and the tests; only the SVG overlay filters.
 */
export const CHILE_MAX_DISPLAYED_SIGNALS = 40

export function displayedChileSignals(
  signals: ChileSignal[],
  maxCount: number = CHILE_MAX_DISPLAYED_SIGNALS,
): ChileSignal[] {
  return signals.slice(-maxCount)
}

/**
 * How far an ARRIBA/ABAJO label is through its lifetime. Labels are alerts, not annotations: each
 * one prints when its bar closes, holds full strength for `ttlSeconds`, then fades to nothing over
 * `fadeSeconds`. A `ttlSeconds` of 0 returns `null` — labels stay until the count cap takes them.
 */
export interface ChileMarkerExpiry {
  /** Seconds since the label's bar closed; 0 while the bar is still forming. */
  ageSeconds: number
  /** True once the label is past its fade and must not render at all. */
  expired: boolean
  /**
   * CSS animation delay for the fade: `ttlSeconds - ageSeconds`. Positive while the label still
   * holds full strength, negative once it is mid-fade — the negative delay drops the animation
   * into the fade at the right depth.
   */
  fadeDelaySeconds: number
}

export function chileMarkerExpiry(
  signal: ChileSignal,
  nowSeconds: number,
  barSeconds: number,
  ttlSeconds: number,
  fadeSeconds: number,
): ChileMarkerExpiry | null {
  if (!(ttlSeconds > 0)) return null
  const fade = Math.max(fadeSeconds, 0)
  // The label prints at its bar's close; before that the bar is still forming.
  const printSeconds = signal.time + barSeconds
  const ageSeconds = Math.max(0, nowSeconds - printSeconds)
  return {
    ageSeconds,
    expired: ageSeconds >= ttlSeconds + fade,
    fadeDelaySeconds: ttlSeconds - ageSeconds,
  }
}

/**
 * The second the marker clock reads "now". On a live feed the newest bar tracks wall-clock time, so
 * labels age in real seconds and fade while you watch. Demo and replay data are pinned away from
 * the wall clock, so their "now" is the close of the newest loaded bar — the data's own live edge,
 * which only advances as bars stream in.
 */
export function chileMarkerNowSeconds(
  wallNowSeconds: number,
  lastCandleTime: number,
  barSeconds: number,
): number {
  const edge = lastCandleTime + barSeconds
  return Math.abs(wallNowSeconds - edge) <= barSeconds ? wallNowSeconds : edge
}

/** The resolutions the indicator needs beyond the chart's own: its round feed and the 5m read. */
export function chileRequestedTimeframes(
  settings: ChileReversalSettings,
  chart: Timeframe,
): Timeframe[] {
  return [...new Set([settings.resolution, CHILE_MOMENTUM_TIMEFRAME])].filter(
    (resolution) => resolution !== chart,
  )
}
