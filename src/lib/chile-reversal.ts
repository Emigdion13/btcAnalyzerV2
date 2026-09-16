import { INTERVAL_SECONDS, bucketStart } from '../../shared/coinbase'
import type { Candle, ChileReversalSettings, Indicator, Timeframe } from './types'
import { CHILE_REVERSAL_DEFAULTS } from './types'

/**
 * Chile Reversal — the reversal core of "ROBEX IA CHILERA V18 PRO", ported to
 * Atlas as a native price overlay.
 *
 * The Pine original is a trend-continuation scoring engine in which reversal
 * behavior is expressed by exactly four booleans built on higher-timeframe
 * pivot levels. This indicator keeps those four and nothing else, so what the
 * chart shows is the reversal logic itself rather than a 20-point trend score
 * that happens to include it:
 *
 *   reboteS  = low  <= support    + zone and close > support    and close > open
 *   rechazoR = high >= resistance - zone and close < resistance and close < open
 *   rompeR   = close > R + zone and close[1] <= R + zone
 *   rompeS   = close < S - zone and close[1] >= S - zone
 *
 * Faithful details carried over from the Pine source:
 *
 * 1. Levels come from pivots on a *higher* timeframe (`pivotIzq/pivotDer`,
 *    default 2/2), confirmed `pivotDer` bars late — never repainted earlier.
 *    The last four pivot highs and lows are remembered (`ph1..ph4`/`pl1..pl4`).
 * 2. R1/R2 are the two nearest remembered pivot highs strictly above the close;
 *    S1/S2 the two nearest pivot lows strictly below it. Both are recomputed
 *    every bar against the current close, exactly like the original's
 *    hand-rolled insertion sort.
 * 3. Candidates further than `maxDistATR × ATR(14, HTF)` from price are
 *    discarded. If that leaves no R1/S1, the 6-bar HTF high/low range is used
 *    as a fallback level — the original's `miniHigh`/`miniLow`.
 * 4. Zone thickness is `grosorZonaATR × ATR(14, HTF)` (default 0.10).
 * 5. Rebound/rejection are evaluated on the *chart* candle against HTF levels,
 *    as in the original where the script's timeframe and the "15" requests are
 *    deliberately mixed.
 * 6. HTF series are read with the closed-bar value (`[1]` under
 *    `lookahead_on`), so a level is only used once its HTF bar has closed. No
 *    future information reaches an earlier bar.
 *
 * One deliberate correction, documented in docs/chile-reversal.md: the Pine
 * R2/S2 insertion sort can assign r2/s2 while r1/s1 is still `na` (the `ph2`
 * branch when `ph1 <= close`), producing a second level with no first level.
 * Here the nearest candidate is always R1/S1 and the runner-up R2/S2.
 *
 * The `confirmacionLong/Short` + `velaImpulso` gates from the scalping engine
 * are preserved as an optional filter, off by default, because in the original
 * they are what suppress a signal until price has already reclaimed EMA9/VWAP.
 */

/** Pine `ta.atr(14)` on the higher timeframe. */
export const CHILE_ATR_LENGTH = 14
/** Pine `ta.rsi(close, 14)` for the optional confirmation gate. */
export const CHILE_RSI_LENGTH = 14
/** Pine `ta.ema(close, 9)` for the optional confirmation gate. */
export const CHILE_EMA_LENGTH = 9
/** Pine `ta.highest(high, 6)[1]` / `ta.lowest(low, 6)[1]` fallback window. */
export const CHILE_MINI_RANGE = 6
/** How many pivots of each side the original remembers: ph1..ph4 / pl1..pl4. */
export const CHILE_PIVOT_MEMORY = 4

/** Palette matching the Pine script's verde/rojo/amarillo constants. */
export const CHILE_REVERSAL_COLORS = {
  /** Pine `verde` rgb(0, 225, 145) — support, bounce. */
  support: '#00e191',
  /** Pine `verdeFuerte` rgb(0, 160, 95) — S2, break-up. */
  supportStrong: '#00a05f',
  /** Pine `rojo` rgb(250, 65, 90) — resistance, rejection. */
  resistance: '#fa415a',
  /** Pine `rojoFuerte` rgb(190, 35, 55) — R2, break-down. */
  resistanceStrong: '#be2337',
  /** Pine `amarillo` rgb(255, 195, 55) — breaks. */
  breakout: '#ffc337',
  /** Pine `blanco` rgb(245, 247, 250). */
  foreground: '#f5f7fa',
} as const

export type ChileLevelKind = 'R1' | 'R2' | 'S1' | 'S2'
export type ChileSignalKind =
  'bounce-support' | 'reject-resistance' | 'break-resistance' | 'break-support'

export interface ChileLevel {
  kind: ChileLevelKind
  side: 'support' | 'resistance'
  /** The pivot price itself. */
  price: number
  /** Half-thickness of the zone: `grosorZonaATR × ATR`. */
  zone: number
  /** True when the level came from the 6-bar mini-range fallback. */
  fallback: boolean
}

export interface ChileSignal {
  kind: ChileSignalKind
  /** Chart-candle index the signal printed on. */
  index: number
  time: number
  /** The level that was bounced off, rejected at, or broken. */
  level: number
  levelKind: ChileLevelKind
  /** Candle anchor for the marker: low for bullish, high for bearish. */
  price: number
  side: 'bullish' | 'bearish'
  /** False when the confirmation filter is on and the bar failed it. */
  confirmed: boolean
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
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

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
    int(s.pivotLeft, 1, 5) &&
    int(s.pivotRight, 1, 5) &&
    num(s.maxDistanceAtr, 0.5, 6) &&
    num(s.zoneThicknessAtr, 0.03, 0.5) &&
    typeof s.showZones === 'boolean' &&
    typeof s.showBreaks === 'boolean' &&
    typeof s.requireConfirmation === 'boolean' &&
    num(s.impulseBodyRatio, 0, 1) &&
    typeof s.supportColor === 'string' &&
    HEX_COLOR.test(s.supportColor) &&
    typeof s.resistanceColor === 'string' &&
    HEX_COLOR.test(s.resistanceColor)
  )
}

export function chileReversalSettings(indicator: Indicator): ChileReversalSettings {
  const candidate = indicator.chileReversal
  return isChileReversalSettings(candidate) ? candidate : { ...CHILE_REVERSAL_DEFAULTS }
}

export function chileReversalIndicatorLabel(indicator: Indicator): string {
  const s = chileReversalSettings(indicator)
  return `Chile Reversal (${s.resolution}, ${s.pivotLeft}, ${s.pivotRight}, ${s.zoneThicknessAtr})`
}

export interface ChileReversalContext {
  timeframe: Timeframe
  timeframes?: Partial<Record<Timeframe, { candles: Candle[] }>>
  replay?: boolean
}

/** Wilder ATR, matching Pine `ta.atr(length)`. */
function wilderAtr(candles: Candle[], length: number): (number | null)[] {
  const out: (number | null)[] = []
  let previousClose: number | null = null
  let sum = 0
  let atr: number | null = null
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
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

/** Pine `ta.pivothigh(high, left, right)` — confirmed `right` bars after the pivot. */
function pivotHighs(candles: Candle[], left: number, right: number): (number | null)[] {
  return candles.map((_, i) => {
    const p = i - right
    if (p < left) return null
    const value = candles[p].high
    for (let j = p - left; j <= p + right; j++) {
      if (j === p) continue
      if (candles[j].high >= value) return null
    }
    return value
  })
}

function pivotLows(candles: Candle[], left: number, right: number): (number | null)[] {
  return candles.map((_, i) => {
    const p = i - right
    if (p < left) return null
    const value = candles[p].low
    for (let j = p - left; j <= p + right; j++) {
      if (j === p) continue
      if (candles[j].low <= value) return null
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
    let best = candles[i][pick]
    for (let j = i - window + 1; j <= i; j++) {
      const v = candles[j][pick]
      best = pick === 'high' ? Math.max(best, v) : Math.min(best, v)
    }
    return best
  })
}

/** Per-HTF-bar state the chart bars read from, using only closed HTF bars. */
interface HtfState {
  /** HTF bar open time. */
  time: number
  atr: number | null
  pivotHighs: number[]
  pivotLows: number[]
  miniHigh: number | null
  miniLow: number | null
}

function buildHtfStates(source: Candle[], settings: ChileReversalSettings): HtfState[] {
  const atr = wilderAtr(source, CHILE_ATR_LENGTH)
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
      pivotHighs: [...highs],
      pivotLows: [...lows],
      miniHigh: miniHigh[i],
      miniLow: miniLow[i],
    }
  })
}

/**
 * Resolve R1/R2/S1/S2 for one chart bar. Nearest candidate above/below the
 * close wins, runner-up is the second level, both filtered by `maxDistanceAtr`,
 * with the mini-range fallback when the first slot is empty.
 */
function resolveLevels(
  close: number,
  state: HtfState,
  settings: ChileReversalSettings,
): ChileLevel[] {
  const atr = state.atr
  if (atr === null || !(atr > 0)) return []
  const zone = atr * settings.zoneThicknessAtr
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
    levels.push({ kind, side, price, zone, fallback })
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

export function calculateChileReversal(
  candles: Candle[],
  settings: ChileReversalSettings,
  context: ChileReversalContext = { timeframe: '1m' },
): ChileReversalResult {
  if (!isChileReversalSettings(settings)) throw new Error('Invalid Chile Reversal settings.')

  const warmupBars = Math.max(CHILE_ATR_LENGTH, settings.pivotLeft + settings.pivotRight + 1)
  const empty = (missingFeed: boolean): ChileReversalResult => ({
    levels: [],
    signals: [],
    atr: candles.map(() => null),
    warmupBars,
    resolution: settings.resolution,
    missingFeed,
  })
  if (!candles.length) return empty(false)

  const chartStep = INTERVAL_SECONDS[context.timeframe] ?? 60
  const sourceStep = INTERVAL_SECONDS[settings.resolution]
  // On or below the chart resolution the original's "15" requests degenerate to
  // the chart series itself; above it, use the dedicated higher-timeframe feed.
  const higher = sourceStep > chartStep
  const source = higher ? (context.timeframes?.[settings.resolution]?.candles ?? []) : candles
  if (!source.length) return empty(higher)

  const states = buildHtfStates(source, settings)

  // Map every chart bar to the newest HTF bar that had already CLOSED, which is
  // what `request.security(..., x[1], lookahead_on)` delivers.
  const perBar: (HtfState | null)[] = []
  let cursor = -1
  for (const candle of candles) {
    if (higher) {
      const bucket = bucketStart(candle.time, settings.resolution)
      while (cursor + 1 < states.length && states[cursor + 1].time <= bucket) cursor++
      // `[1]`: the bar before the developing one.
      const closedIndex = states[cursor]?.time === bucket ? cursor - 1 : cursor
      perBar.push(closedIndex >= 0 ? states[closedIndex] : null)
    } else {
      cursor++
      perBar.push(cursor > 0 ? states[cursor - 1] : null)
    }
  }

  const closes = candles.map((c) => c.close)
  const ema9 = pineEmaSeries(closes, CHILE_EMA_LENGTH)
  const rsi = wilderRsi(closes, CHILE_RSI_LENGTH)
  const vwap = sessionVwap(candles)

  const signals: ChileSignal[] = []
  const atrSeries: (number | null)[] = []
  let previousLevels: ChileLevel[] = []
  let lastLevels: ChileLevel[] = []

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    const state = perBar[i]
    atrSeries.push(state?.atr ?? null)
    if (!state) {
      previousLevels = []
      continue
    }
    const levels = resolveLevels(candle.close, state, settings)
    lastLevels = levels

    const body = Math.abs(candle.close - candle.open)
    const range = Math.max(candle.high - candle.low, Number.EPSILON)
    const impulse = body / range >= settings.impulseBodyRatio
    const longOk =
      !settings.requireConfirmation ||
      (impulse &&
        ema9[i] !== null &&
        vwap[i] !== null &&
        rsi[i] !== null &&
        candle.close > ema9[i]! &&
        candle.close > vwap[i]! &&
        rsi[i]! > 50)
    const shortOk =
      !settings.requireConfirmation ||
      (impulse &&
        ema9[i] !== null &&
        vwap[i] !== null &&
        rsi[i] !== null &&
        candle.close < ema9[i]! &&
        candle.close < vwap[i]! &&
        rsi[i]! < 50)

    for (const level of levels) {
      const { price, zone } = level
      if (level.side === 'support') {
        // reboteS: wick into the zone, close back above the level, green body.
        if (
          candle.low <= price + zone &&
          candle.close > price &&
          candle.close > candle.open &&
          longOk
        )
          signals.push({
            kind: 'bounce-support',
            index: i,
            time: candle.time,
            level: price,
            levelKind: level.kind,
            price: candle.low,
            side: 'bullish',
            confirmed: longOk,
          })
      } else if (
        candle.high >= price - zone &&
        candle.close < price &&
        candle.close < candle.open &&
        shortOk
      )
        // rechazoR: wick into the zone, close back below the level, red body.
        signals.push({
          kind: 'reject-resistance',
          index: i,
          time: candle.time,
          level: price,
          levelKind: level.kind,
          price: candle.high,
          side: 'bearish',
          confirmed: shortOk,
        })
    }

    // Breaks compare against the PREVIOUS bar's level set, like Pine's
    // `close[1] <= resistencia1 + grosorZona` where R1 is the `var`-free value
    // recomputed each bar but read with the prior close.
    if (settings.showBreaks && i > 0) {
      const priorClose = candles[i - 1].close
      const r1 = previousLevels.find((level) => level.kind === 'R1')
      const s1 = previousLevels.find((level) => level.kind === 'S1')
      if (
        r1 &&
        candle.close > r1.price + r1.zone &&
        priorClose <= r1.price + r1.zone &&
        (!settings.requireConfirmation || impulse)
      )
        signals.push({
          kind: 'break-resistance',
          index: i,
          time: candle.time,
          level: r1.price,
          levelKind: 'R1',
          price: candle.high,
          side: 'bullish',
          confirmed: true,
        })
      if (
        s1 &&
        candle.close < s1.price - s1.zone &&
        priorClose >= s1.price - s1.zone &&
        (!settings.requireConfirmation || impulse)
      )
        signals.push({
          kind: 'break-support',
          index: i,
          time: candle.time,
          level: s1.price,
          levelKind: 'S1',
          price: candle.low,
          side: 'bearish',
          confirmed: true,
        })
    }

    previousLevels = levels
  }

  return {
    levels: lastLevels,
    signals,
    atr: atrSeries,
    warmupBars,
    resolution: settings.resolution,
    missingFeed: false,
  }
}

/**
 * Pine paints signal labels under `max_labels_count` (default ~50): the oldest
 * are garbage-collected, so a chart never accumulates a whole history of stale
 * text. Mirrors both halves of that spirit here: a run of the same pattern at
 * the same level on consecutive bars collapses to its freshest print (the bar
 * where the close confirmed the pattern), and only the newest `maxCount`
 * markers stay on the chart. Without the cap, un-capped history plus
 * back-to-back reprints smeared into rows of "Bounce"/"Reject" text that no
 * longer read as attached to any candle. The engine's raw `signals` stay
 * untouched for the legend and tests; only the overlay filters.
 */
export const CHILE_MAX_DISPLAYED_SIGNALS = 40

/**
 * What the overlay actually prints: consecutive-bar reprints of a pattern
 * collapsed, then capped at `maxCount` — see the constant above. The engine's
 * raw `signals` stay untouched for the legend and tests; only the SVG overlay
 * filters.
 */
export function displayedChileSignals(
  signals: ChileSignal[],
  maxCount: number = CHILE_MAX_DISPLAYED_SIGNALS,
): ChileSignal[] {
  const collapsed: ChileSignal[] = []
  for (const signal of signals) {
    const previous = collapsed[collapsed.length - 1]
    if (
      previous &&
      previous.kind === signal.kind &&
      previous.levelKind === signal.levelKind &&
      previous.level === signal.level &&
      signal.index === previous.index + 1
    )
      collapsed[collapsed.length - 1] = signal
    else collapsed.push(signal)
  }
  return collapsed.slice(-maxCount)
}

/** Pine `ta.ema` seeded from the first value (not the Studio's SMA-seeded ema). */
function pineEmaSeries(values: number[], length: number): (number | null)[] {
  const alpha = 2 / (length + 1)
  let previous: number | null = null
  return values.map((value, i) => {
    previous = previous === null ? value : value * alpha + previous * (1 - alpha)
    return i >= length - 1 ? previous : null
  })
}

/** Wilder RSI, matching Pine `ta.rsi`. */
function wilderRsi(values: number[], length: number): (number | null)[] {
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
    const diff = values[i] - values[i - 1]
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

/** Pine `ta.vwap(hlc3)`, reset each UTC day like Atlas's built-in VWAP. */
function sessionVwap(candles: Candle[]): (number | null)[] {
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
