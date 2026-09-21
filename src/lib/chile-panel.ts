import { INTERVAL_SECONDS, bucketStart } from '../../shared/coinbase'
import type { Candle, ChileReversalSettings, Timeframe } from './types'
import type { ChileReversalResult } from './chile-reversal'
import {
  CHILE_EMA_LENGTH,
  CHILE_RSI_LENGTH,
  closedHtfIndexes,
  pineEmaSeries,
  sessionVwap,
  wilderAtr,
  wilderRsi,
} from './chile-reversal'

/**
 * Chile panel — the scoring engine and corner readout of "ROBEX IA CHILERA V17 PRO", ported to
 * Atlas as a floating window.
 *
 * `lib/chile-reversal.ts` ports the reversal core of the same family (the four pivot patterns
 * that paint markers). This module ports the other half of V17: the score that turns those
 * patterns plus a trend/momentum/flow stack into one call for the next round.
 *
 * ```pine
 * if robexUp      scoreUp += 2      // ta.supertrend direction
 * if trend15Up    scoreUp += 2      // ema9_15 > ema21_15
 * if slopeUp      scoreUp += 1      // both 15m EMAs rising
 * if rsi15 >= 55  scoreUp += 2 else if rsi15 > 50 scoreUp += 1
 * if higherHigh   scoreUp += 1 ; if higherLow scoreUp += 1
 * if momentumUp   scoreUp += 2      // 5m EMA stack + rsi5 > 52 + green 5m bar
 * if pressureUp   scoreUp += 1      // chart EMA stack + rsi > 52
 * if sobreVWAP    scoreUp += 1
 * if buyersStrong scoreUp += 1 ; if volAlto and buyersStrong scoreUp += 1
 * if rondaFuerteUp scoreUp += 2 else if rondaUp scoreUp += 1
 * if reboteSoporte scoreUp += 3 ; if rompeResistencia scoreUp += 3
 * ```
 *
 * …and the mirror image for the down side. `fuerza` is each side's share of the total, and the
 * call is `score >= minScore and advantage >= minVentaja` while the market is not lateral.
 *
 * Faithful details carried over:
 *
 * 1. Higher-timeframe reads use the *closed* bar (`x[1]` under `lookahead_on`), through the same
 *    mapper the overlay uses, so the window and the chart read one and the same 15m candle.
 * 2. The 5m momentum read is the *live* 5m bar — the original requests it without `[1]`, forming
 *    candle included.
 * 3. Buyers/sellers are close-position-in-range, not a tape reading: `round((close - low) / range
 *    × 100)` for buyers, the complement for sellers. It says where in the bar the close landed.
 * 4. The round (ronda) is accumulated from the chart candles inside the panel's resolution
 *    bucket, exactly like `nuevaRonda = ta.change(time("15")) != 0`.
 * 5. `mercadoLateral` suppresses both calls: |EMA9 − EMA21| under 0.025 ATR with a local RSI
 *    inside 47–53.
 *
 * One deliberate difference, documented in docs/chile-panel.md: the four reversal events that
 * score +3 come from `calculateChileReversal`, i.e. from the same levels, zone thickness and
 * confirmation gates the markers on the chart use — V17 recomputes them inline against the bare
 * level. Two definitions of "bounce" in one workspace would let the panel cheer a marker that is
 * not there.
 */

/** Pine `ta.ema(close, 21)` — the slow leg of both EMA stacks. */
export const CHILE_PANEL_EMA_SLOW = 21
/** The resolution the 5m momentum read comes from, hard-coded `"5"` in Pine. */
export const CHILE_PANEL_MOMENTUM_TIMEFRAME: Timeframe = '5m'
/** Pine `ta.sma(volume, 20)` for the volume ratio. */
export const CHILE_PANEL_VOLUME_SMA = 20
/** Pine `volAlto = volRatio >= 1.20`. */
export const CHILE_PANEL_VOLUME_HIGH = 1.2
/** Pine `volMuyAlto = volRatio >= 1.60`. */
export const CHILE_PANEL_VOLUME_VERY_HIGH = 1.6
/** Pine `buyersStrong = compradores >= 60`. */
export const CHILE_PANEL_STRONG_SIDE = 60
/** Pine `rsi15 >= 55` (2 points) / `> 50` (1 point). */
export const CHILE_PANEL_RSI_STRONG = 55
/** Pine `rsi15 <= 45` (2 points) / `< 50` (1 point). */
export const CHILE_PANEL_RSI_WEAK = 45
/** Pine `pressureUp/Down`: local RSI outside 52/48. */
export const CHILE_PANEL_PRESSURE_RSI = 52
/** Pine `momentumUp/Down`: 5m RSI outside 52/48. */
export const CHILE_PANEL_MOMENTUM_RSI = 52
/** Pine `cercaR1/cercaS1`: within 0.20 ATR of the level. */
export const CHILE_PANEL_NEAR_LEVEL_ATR = 0.2
/** Pine `mercadoLateral`: EMA gap under 0.025 ATR. */
export const CHILE_PANEL_LATERAL_ATR = 0.025
/** Pine `mercadoLateral`: local RSI inside 47–53. */
export const CHILE_PANEL_LATERAL_RSI_LOW = 47
export const CHILE_PANEL_LATERAL_RSI_HIGH = 53
/** Pine `rondaFuerteUp/Down`: round move and close position inside the round range. */
export const CHILE_PANEL_ROUND_MOVE = 0.2
export const CHILE_PANEL_ROUND_STRONG_UP = 0.65
export const CHILE_PANEL_ROUND_STRONG_DOWN = 0.35
/** Every reversal event scores +3 in the original. */
export const CHILE_PANEL_REVERSAL_POINTS = 3
/** Divide-by-zero guard where Pine would use `syminfo.mintick`. */
const MIN_RANGE = 1e-9

export type ChilePanelCall = 'up' | 'down' | 'wait'
export type ChilePanelTrend = 'up' | 'down' | 'mixed'
export type ChilePanelVolume = 'normal' | 'high' | 'very-high'
export type ChilePanelLevelState =
  | 'none'
  | 'near-r1'
  | 'near-r2'
  | 'near-s1'
  | 'near-s2'
  | 'bounce'
  | 'reject'
  | 'break-resistance'
  | 'break-support'

/** One scored contribution, so the window can show why it is saying what it is saying. */
export interface ChileScoreFactor {
  /** Stable key, for tests and list keys. */
  key: string
  /** What the window prints. */
  label: string
  side: 'up' | 'down'
  points: number
}

export interface ChileRoundClock {
  totalSeconds: number
  /** `mm:ss` to the next round close. */
  text: string
  /** Pine's `colorTiempo` thresholds: red at 60 s, amber at 180 s. */
  urgency: 'steady' | 'closing' | 'final'
}

export interface ChilePanelSnapshot {
  /** False while something the score needs is still missing. */
  ready: boolean
  /** What is missing, so the window says so instead of showing zeros. */
  waitingOn: 'data' | 'round-feed' | 'warmup' | null
  call: ChilePanelCall
  scoreUp: number
  scoreDown: number
  /** Pine `fuerzaArriba`/`fuerzaAbajo`: each side's share of the total, in percent. */
  fuerzaArriba: number
  fuerzaAbajo: number
  /** Pine `ventaja`: the signed gap, positive when the up side leads. */
  advantage: number
  /** Pine `mercadoLateral` — both calls are suppressed while it holds. */
  lateral: boolean
  /**
   * True when the newest chart bar closes on a round boundary. Pine only prints its signals on
   * those bars (`fin15 and barstate.isconfirmed`); the panel's live call runs on every bar.
   */
  official: boolean
  clock: ChileRoundClock
  /** The scored contributions behind `scoreUp`/`scoreDown`, strongest first. */
  factors: ChileScoreFactor[]
  buyers: number
  sellers: number
  volumeRatio: number
  volume: ChilePanelVolume
  rsiRound: number | null
  rsiLocal: number | null
  trend: ChilePanelTrend
  /** Pine `trendTexto`: supertrend and the 15m EMA cross have to agree to name a trend. */
  trendLabel: 'ALCISTA' | 'BAJISTA' | 'MIXTA'
  /** Pine `robexUp`/`robexDown`; null while the supertrend is still warming. */
  supertrendUp: boolean | null
  level: ChilePanelLevelState
  /** Pine `srTexto`. */
  levelLabel: string
  /** The round's own OHLC so far, in the panel's resolution bucket. */
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
}

export interface ChilePanelInput {
  /** The chart series: the Pine script's "local" reads run on whatever it is attached to. */
  candles: Candle[]
  timeframe: Timeframe
  settings: ChileReversalSettings
  /**
   * The overlay engine's result for these very candles and settings. The panel's reversal points
   * and S/R proximity come from it, so the window and the markers can never disagree.
   */
  reversal: ChileReversalResult
  /** The panel resolution's feed — the "15" requests. Ignored when that is the chart's own. */
  roundCandles: Candle[]
  /** The 5m feed for the momentum read. */
  momentumCandles: Candle[]
  /** Seconds, wall clock on a live feed. Drives the countdown only. */
  nowSeconds: number
}

const pad = (value: number) => (value < 10 ? `0${value}` : String(value))

/**
 * Seconds to the next round close, matching Pine's `time("15") + 15 * 60 * 1000 - timenow` for
 * UTC-aligned buckets. The urgency thresholds are the original's `colorTiempo` cuts.
 */
export function chileRoundClock(nowSeconds: number, roundSeconds: number): ChileRoundClock {
  const safe = Math.max(roundSeconds, 1)
  const boundary = (Math.floor(nowSeconds / safe) + 1) * safe
  const totalSeconds = Math.max(0, Math.floor(boundary - nowSeconds))
  return {
    totalSeconds,
    text: `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`,
    urgency: totalSeconds <= 60 ? 'final' : totalSeconds <= 180 ? 'closing' : 'steady',
  }
}

/** The resolutions the panel window needs beyond the chart's own. */
export function chilePanelRequestedTimeframes(
  settings: ChileReversalSettings,
  chart: Timeframe,
): Timeframe[] {
  return [...new Set([settings.resolution, CHILE_PANEL_MOMENTUM_TIMEFRAME])].filter(
    (resolution) => resolution !== chart,
  )
}

/**
 * Pine `ta.supertrend(factor, atrPeriod)`, reduced to its direction — the only half the original
 * reads (`robexUp = direccionST < 0`). Bands are the canonical trailing pair: each band only
 * tightens until price closes through it, and the direction flips on that close.
 */
function pineSupertrendDirection(
  candles: Candle[],
  factor: number,
  atrLength: number,
): (number | null)[] {
  const atr = wilderAtr(candles, atrLength)
  const upper: (number | null)[] = []
  const lower: (number | null)[] = []
  const st: (number | null)[] = []
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

    const previousSt = i > 0 ? st[i - 1] : null
    let value: number | null = null
    if (u !== null && l !== null) {
      if (previousSt === null) value = candle.close > u ? l : u
      else if (previousSt === previousUpper) value = candle.close <= u ? u : l
      else value = candle.close >= l ? l : u
    }
    st.push(value)
    direction.push(value === null ? null : value === u ? 1 : -1)
  }
  return direction
}

/** Rolling mean, Pine `ta.sma`. */
function simpleMovingAverage(values: number[], length: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < length - 1) return null
    let sum = 0
    for (let j = i - length + 1; j <= i; j++) sum += values[j]!
    return sum / length
  })
}

/** The round (ronda) accumulation, per chart bar, in the panel resolution's buckets. */
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

const notReady = (
  waitingOn: ChilePanelSnapshot['waitingOn'],
  nowSeconds: number,
  roundSeconds: number,
): ChilePanelSnapshot => ({
  ready: false,
  waitingOn,
  call: 'wait',
  scoreUp: 0,
  scoreDown: 0,
  fuerzaArriba: 0,
  fuerzaAbajo: 0,
  advantage: 0,
  lateral: false,
  official: false,
  clock: chileRoundClock(nowSeconds, roundSeconds),
  factors: [],
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
  levelLabel: 'SIN NIVEL CERCANO',
  round: {
    open: null,
    high: null,
    low: null,
    position: null,
    move: null,
    strong: false,
    up: false,
  },
})

/**
 * The panel's read on the newest chart bar. Everything is computed from closed bars except the
 * two reads the original makes on live ones: the 5m momentum bar and the forming chart candle
 * itself, which is what makes the call move while you watch it.
 */
export function chilePanelSnapshot(input: ChilePanelInput): ChilePanelSnapshot {
  const { candles, timeframe, settings, reversal } = input
  const roundSeconds = INTERVAL_SECONDS[settings.resolution] ?? 900
  if (!candles.length) return notReady('data', input.nowSeconds, roundSeconds)

  const chartStep = INTERVAL_SECONDS[timeframe] ?? 60
  const higher = roundSeconds > chartStep
  const source = higher ? input.roundCandles : candles
  if (higher && !source.length) return notReady('round-feed', input.nowSeconds, roundSeconds)

  const last = candles.length - 1
  const candle = candles[last]!

  // --- Higher-timeframe (round resolution) reads, closed bar only -------------------------
  const sourceCloses = source.map((c) => c.close)
  const roundEmaFast = pineEmaSeries(sourceCloses, CHILE_EMA_LENGTH)
  const roundEmaSlow = pineEmaSeries(sourceCloses, CHILE_PANEL_EMA_SLOW)
  const roundRsi = wilderRsi(sourceCloses, CHILE_RSI_LENGTH)
  const closedIndex = closedHtfIndexes(
    candles.map((c) => c.time),
    source,
    settings.resolution,
    higher,
  )[last]
  const previousIndex = closedIndex !== null && closedIndex > 0 ? closedIndex - 1 : null
  const roundBar = closedIndex === null ? null : (source[closedIndex] ?? null)
  const roundBarBefore = previousIndex === null ? null : (source[previousIndex] ?? null)

  // `atrSeguro = math.max(atr15, syminfo.mintick)` — the overlay engine's per-bar HTF ATR.
  const roundAtr = reversal.atr[last] ?? null
  if (roundAtr === null || !(roundAtr > 0))
    return notReady('warmup', input.nowSeconds, roundSeconds)
  const atrSeguro = roundAtr

  // --- Local (chart resolution) reads -----------------------------------------------------
  const closes = candles.map((c) => c.close)
  const emaFast = pineEmaSeries(closes, CHILE_EMA_LENGTH)[last]
  const emaSlow = pineEmaSeries(closes, CHILE_PANEL_EMA_SLOW)[last]
  const rsiLocal = wilderRsi(closes, CHILE_RSI_LENGTH)[last]
  const vwap = sessionVwap(candles)[last]
  const volumeAverage = simpleMovingAverage(
    candles.map((c) => c.volume),
    CHILE_PANEL_VOLUME_SMA,
  )[last]
  const volumeRatio =
    volumeAverage !== null && volumeAverage > 0 ? candle.volume / volumeAverage : 1
  const supertrend = pineSupertrendDirection(
    candles,
    settings.panelTrendFactor,
    settings.panelTrendAtrLength,
  )[last]

  // --- Buyers / sellers: close position inside the bar -----------------------------------
  const barRange = Math.max(candle.high - candle.low, MIN_RANGE)
  const buyers = Math.round(Math.max(0, Math.min(1, (candle.close - candle.low) / barRange)) * 100)
  const sellers = 100 - buyers
  const buyersStrong = buyers >= CHILE_PANEL_STRONG_SIDE
  const sellersStrong = sellers >= CHILE_PANEL_STRONG_SIDE

  // --- Round state ------------------------------------------------------------------------
  const round = roundStates(candles, settings.resolution)[last]!
  const roundRange = Math.max(round.high - round.low, MIN_RANGE)
  const roundPosition = (candle.close - round.low) / roundRange
  const roundMove = (candle.close - round.open) / atrSeguro
  const roundUp = candle.close > round.open
  const roundDown = candle.close < round.open
  const roundStrongUp =
    roundMove > CHILE_PANEL_ROUND_MOVE && roundPosition > CHILE_PANEL_ROUND_STRONG_UP
  const roundStrongDown =
    roundMove < -CHILE_PANEL_ROUND_MOVE && roundPosition < CHILE_PANEL_ROUND_STRONG_DOWN

  // --- Trend reads ------------------------------------------------------------------------
  const roundEmaFastNow = closedIndex === null ? null : (roundEmaFast[closedIndex] ?? null)
  const roundEmaSlowNow = closedIndex === null ? null : (roundEmaSlow[closedIndex] ?? null)
  const roundEmaFastBefore = previousIndex === null ? null : (roundEmaFast[previousIndex] ?? null)
  const roundEmaSlowBefore = previousIndex === null ? null : (roundEmaSlow[previousIndex] ?? null)
  const rsiRound = closedIndex === null ? null : (roundRsi[closedIndex] ?? null)

  const trendRoundUp =
    roundEmaFastNow !== null && roundEmaSlowNow !== null && roundEmaFastNow > roundEmaSlowNow
  const trendRoundDown =
    roundEmaFastNow !== null && roundEmaSlowNow !== null && roundEmaFastNow < roundEmaSlowNow
  const slopeUp =
    roundEmaFastNow !== null &&
    roundEmaFastBefore !== null &&
    roundEmaSlowNow !== null &&
    roundEmaSlowBefore !== null &&
    roundEmaFastNow > roundEmaFastBefore &&
    roundEmaSlowNow >= roundEmaSlowBefore
  const slopeDown =
    roundEmaFastNow !== null &&
    roundEmaFastBefore !== null &&
    roundEmaSlowNow !== null &&
    roundEmaSlowBefore !== null &&
    roundEmaFastNow < roundEmaFastBefore &&
    roundEmaSlowNow <= roundEmaSlowBefore

  const higherHigh =
    roundBar !== null && roundBarBefore !== null && roundBar.high > roundBarBefore.high
  const higherLow =
    roundBar !== null && roundBarBefore !== null && roundBar.low > roundBarBefore.low
  const lowerHigh =
    roundBar !== null && roundBarBefore !== null && roundBar.high < roundBarBefore.high
  const lowerLow = roundBar !== null && roundBarBefore !== null && roundBar.low < roundBarBefore.low

  // --- 5m momentum: the LIVE 5m bar, as the original requests it --------------------------
  const momentumBar = input.momentumCandles.at(-1) ?? null
  const momentumEmaFast = momentumBar
    ? (pineEmaSeries(
        input.momentumCandles.map((c) => c.close),
        CHILE_EMA_LENGTH,
      ).at(-1) ?? null)
    : null
  const momentumEmaSlow = momentumBar
    ? (pineEmaSeries(
        input.momentumCandles.map((c) => c.close),
        CHILE_PANEL_EMA_SLOW,
      ).at(-1) ?? null)
    : null
  const momentumRsi = momentumBar
    ? (wilderRsi(
        input.momentumCandles.map((c) => c.close),
        CHILE_RSI_LENGTH,
      ).at(-1) ?? null)
    : null
  const momentumUp =
    momentumEmaFast !== null &&
    momentumEmaSlow !== null &&
    momentumRsi !== null &&
    momentumBar !== null &&
    momentumEmaFast > momentumEmaSlow &&
    momentumRsi > CHILE_PANEL_MOMENTUM_RSI &&
    momentumBar.close > momentumBar.open
  const momentumDown =
    momentumEmaFast !== null &&
    momentumEmaSlow !== null &&
    momentumRsi !== null &&
    momentumBar !== null &&
    momentumEmaFast < momentumEmaSlow &&
    momentumRsi < 100 - CHILE_PANEL_MOMENTUM_RSI &&
    momentumBar.close < momentumBar.open

  // --- Reversal events and proximity, from the overlay engine -----------------------------
  const events = reversal.signals.filter((signal) => signal.index === last)
  const bounce = events.some((signal) => signal.kind === 'bounce-support')
  const reject = events.some((signal) => signal.kind === 'reject-resistance')
  const breakResistance = events.some((signal) => signal.kind === 'break-resistance')
  const breakSupport = events.some((signal) => signal.kind === 'break-support')

  const nearThreshold = atrSeguro * CHILE_PANEL_NEAR_LEVEL_ATR
  const levelPrice = (kind: 'R1' | 'R2' | 'S1' | 'S2') =>
    reversal.levels.find((candidate) => candidate.kind === kind)?.price ?? null
  const near = (kind: 'R1' | 'R2' | 'S1' | 'S2') => {
    const price = levelPrice(kind)
    return price !== null && Math.abs(candle.close - price) <= nearThreshold
  }

  // Pine assigns srTexto in this order, so the later states win.
  let level: ChilePanelLevelState = 'none'
  if (near('R1')) level = 'near-r1'
  if (near('R2')) level = 'near-r2'
  if (near('S1')) level = 'near-s1'
  if (near('S2')) level = 'near-s2'
  if (bounce) level = 'bounce'
  if (reject) level = 'reject'
  if (breakResistance) level = 'break-resistance'
  if (breakSupport) level = 'break-support'
  const LEVEL_LABELS: Record<ChilePanelLevelState, string> = {
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

  // --- Pressure, VWAP, lateral filter -----------------------------------------------------
  const pressureUp =
    emaFast !== null &&
    emaSlow !== null &&
    rsiLocal !== null &&
    emaFast > emaSlow &&
    candle.close > emaFast &&
    rsiLocal > CHILE_PANEL_PRESSURE_RSI
  const pressureDown =
    emaFast !== null &&
    emaSlow !== null &&
    rsiLocal !== null &&
    emaFast < emaSlow &&
    candle.close < emaFast &&
    rsiLocal < 100 - CHILE_PANEL_PRESSURE_RSI
  const aboveVwap = vwap !== null && candle.close > vwap
  const belowVwap = vwap !== null && candle.close < vwap

  const lateral =
    emaFast !== null &&
    emaSlow !== null &&
    rsiLocal !== null &&
    Math.abs(emaFast - emaSlow) < atrSeguro * CHILE_PANEL_LATERAL_ATR &&
    rsiLocal > CHILE_PANEL_LATERAL_RSI_LOW &&
    rsiLocal < CHILE_PANEL_LATERAL_RSI_HIGH

  // --- The score --------------------------------------------------------------------------
  const factors: ChileScoreFactor[] = []
  const add = (key: string, label: string, side: 'up' | 'down', points: number) => {
    if (points > 0) factors.push({ key, label, side, points })
  }

  const robexUp = supertrend === -1
  const robexDown = supertrend === 1
  add('robex-trend', 'ROBEX trend', 'up', robexUp ? 2 : 0)
  add('robex-trend-down', 'ROBEX trend', 'down', robexDown ? 2 : 0)
  add('round-ema-cross', 'Round EMA cross', 'up', trendRoundUp ? 2 : 0)
  add('round-ema-cross-down', 'Round EMA cross', 'down', trendRoundDown ? 2 : 0)
  add('round-slope', 'Round EMA slope', 'up', slopeUp ? 1 : 0)
  add('round-slope-down', 'Round EMA slope', 'down', slopeDown ? 1 : 0)

  if (rsiRound !== null) {
    const up = rsiRound >= CHILE_PANEL_RSI_STRONG ? 2 : rsiRound > 50 ? 1 : 0
    const down = rsiRound <= CHILE_PANEL_RSI_WEAK ? 2 : rsiRound < 50 ? 1 : 0
    add('round-rsi', 'Round RSI', 'up', up)
    add('round-rsi-down', 'Round RSI', 'down', down)
  }

  add('higher-high', 'Higher high', 'up', higherHigh ? 1 : 0)
  add('higher-low', 'Higher low', 'up', higherLow ? 1 : 0)
  add('lower-high', 'Lower high', 'down', lowerHigh ? 1 : 0)
  add('lower-low', 'Lower low', 'down', lowerLow ? 1 : 0)
  add('momentum', '5m momentum', 'up', momentumUp ? 2 : 0)
  add('momentum-down', '5m momentum', 'down', momentumDown ? 2 : 0)
  add('pressure', 'Chart pressure', 'up', pressureUp ? 1 : 0)
  add('pressure-down', 'Chart pressure', 'down', pressureDown ? 1 : 0)
  add('vwap', 'Above VWAP', 'up', aboveVwap ? 1 : 0)
  add('vwap-down', 'Below VWAP', 'down', belowVwap ? 1 : 0)
  add('buyers', 'Buyers in control', 'up', buyersStrong ? 1 : 0)
  add('sellers', 'Sellers in control', 'down', sellersStrong ? 1 : 0)
  add(
    'buyers-volume',
    'Buyers on volume',
    'up',
    volumeRatio >= CHILE_PANEL_VOLUME_HIGH && buyersStrong ? 1 : 0,
  )
  add(
    'sellers-volume',
    'Sellers on volume',
    'down',
    volumeRatio >= CHILE_PANEL_VOLUME_HIGH && sellersStrong ? 1 : 0,
  )
  add('round', 'Round so far', 'up', roundStrongUp ? 2 : roundUp ? 1 : 0)
  add('round-down', 'Round so far', 'down', roundStrongDown ? 2 : roundDown ? 1 : 0)
  const points = CHILE_PANEL_REVERSAL_POINTS
  add('bounce', 'Bounce off support', 'up', bounce ? points : 0)
  add('reject', 'Rejection at resistance', 'down', reject ? points : 0)
  add('break-resistance', 'Breaks resistance', 'up', breakResistance ? points : 0)
  add('break-support', 'Breaks support', 'down', breakSupport ? points : 0)

  const scoreUp = factors
    .filter((factor) => factor.side === 'up')
    .reduce((sum, f) => sum + f.points, 0)
  const scoreDown = factors
    .filter((factor) => factor.side === 'down')
    .reduce((sum, f) => sum + f.points, 0)
  const total = Math.max(scoreUp + scoreDown, 1)
  const fuerzaArriba = Math.round((Math.max(scoreUp, 0) * 100) / total)
  const fuerzaAbajo = Math.round((Math.max(scoreDown, 0) * 100) / total)
  const advantage = scoreUp - scoreDown

  let call: ChilePanelCall = 'wait'
  if (!lateral && scoreUp >= settings.panelMinScore && advantage >= settings.panelMinEdge)
    call = 'up'
  else if (!lateral && scoreDown >= settings.panelMinScore && -advantage >= settings.panelMinEdge)
    call = 'down'

  const trend: ChilePanelTrend =
    robexUp && trendRoundUp ? 'up' : robexDown && trendRoundDown ? 'down' : 'mixed'
  const trendLabel = trend === 'up' ? 'ALCISTA' : trend === 'down' ? 'BAJISTA' : 'MIXTA'

  return {
    ready: true,
    waitingOn: null,
    call,
    scoreUp,
    scoreDown,
    fuerzaArriba,
    fuerzaAbajo,
    advantage,
    lateral,
    // Pine `fin15 = minute(time_close) % 15 == 0`: this chart bar closes a round.
    official: (candle.time + chartStep) % roundSeconds === 0,
    clock: chileRoundClock(input.nowSeconds, roundSeconds),
    factors: [...factors].sort((a, b) => b.points - a.points),
    buyers,
    sellers,
    volumeRatio,
    volume:
      volumeRatio >= CHILE_PANEL_VOLUME_VERY_HIGH
        ? 'very-high'
        : volumeRatio >= CHILE_PANEL_VOLUME_HIGH
          ? 'high'
          : 'normal',
    rsiRound,
    rsiLocal,
    trend,
    trendLabel,
    supertrendUp: supertrend === null ? null : supertrend < 0,
    level,
    levelLabel: LEVEL_LABELS[level],
    round: {
      open: round.open,
      high: round.high,
      low: round.low,
      position: roundPosition,
      move: roundMove,
      strong: roundStrongUp || roundStrongDown,
      up: roundUp,
    },
  }
}
