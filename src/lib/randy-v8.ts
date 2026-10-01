import { INTERVAL_SECONDS, bucketStart } from '../../shared/coinbase'
import { closedHtfIndexes } from './chile-reversal'
import { ta } from './indicator-runtime'
import type { Candle, Indicator, Plot, RandyV8Settings, Timeframe } from './types'
import { RANDY_V8_DEFAULTS } from './types'

/**
 * Randy V8.10 DISCIPLINADO — the Atlas port of the 15-minute BTC / Kalshi Pine indicator.
 *
 * The contract's TARGET is the centre of the system. Three things are computed per 1-minute chart
 * bar and then read together:
 *
 * - a **context** score per timeframe (1H, 15M, 5M closed, 5M live) and a faster **micro** score for
 *   the 1M bar itself, both sums of fixed-weight candle/EMA/RSI/volume/structure evidence;
 * - the **TARGET core** — distance to the strike against the movement still available in the time
 *   left — blended with the market score into a UP/DOWN meter that always sums to 100; and
 * - the **SCALP** engine, an evidence count on top of a direction score, which drives the staged
 *   decision CHARGING → CHARGED → ENTER, with DON'T CHASE, SIT OUT and PROTECT around it.
 *
 * Faithful details:
 *
 * 1. Every higher-timeframe read except 5M LIVE is the *closed* bar (`x[1]` under `lookahead_on`),
 *    so a developing candle's eventual extreme never reaches an earlier chart bar.
 * 2. 5M LIVE is the 5m bar *forming* at each chart bar. TradingView shows exactly that on the live
 *    edge; on history it would hand every bar the 5m bucket's final values, so here it is rebuilt
 *    from the chart's own 1m bars up to and including the current one — no look-ahead.
 * 3. `barstate.isconfirmed` is "every bar but a live newest one": the confirmation streaks only
 *    advance on confirmed bars, and ENTER labels print only on them.
 * 4. The contract clock is `time_close("15") - now` on the live bar and `- bar close` on history.
 *
 * Two deliberate departures, both documented in docs/randy-v8.md: the Pine `alert()` calls are not
 * ported (Atlas has no Pine alert channel), and the unused "Score SCALP fuerte" input is dropped.
 */

/** The three resolutions read off the chart, hard-coded in the original. */
export const RANDY_V8_TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h']
/** Divide-by-zero guard where Pine uses `syminfo.mintick` (BTC-USD ticks 0.01). */
const MINTICK = 0.01

export const RANDY_V8_COLORS = {
  ema9: '#facc15',
  ema20: '#e5e7eb',
  target: '#22d3ee',
  resistance: '#ef4444',
  support: '#22c55e',
  map15: '#f59e0b',
  map1h: '#d946ef',
  up: '#22c55e',
  down: '#ef4444',
} as const

// ----------------------------------------------------------------------------------------------
// Settings
// ----------------------------------------------------------------------------------------------

export interface RandyV8Field {
  key: Exclude<keyof RandyV8Settings, 'showEmas' | 'showTarget' | 'showLevels' | 'showMarkers'>
  label: string
  /** Pine input label, kept so a trader can match this dialog to the script. */
  pine: string
  min: number
  max: number
  step: number
  int: boolean
  group: 'target' | 'engine' | 'confirm' | 'scalp' | 'discipline' | 'map'
}

/** Pine `input.float` fields whose step happens to be a whole number: decimals stay legal. */
const FLOAT_KEYS = new Set<RandyV8Field['key']>([
  'minEdgePct',
  'noEdgePct',
  'momentumMin',
  'scalpThreshold',
  'preAlertThreshold',
  'chargedThreshold',
  'enterStrengthMin',
])

const f = (
  key: RandyV8Field['key'],
  label: string,
  pine: string,
  min: number,
  max: number,
  step: number,
  group: RandyV8Field['group'],
  int = Number.isInteger(step) && !FLOAT_KEYS.has(key),
): RandyV8Field => ({ key, label, pine, min, max, step, int, group })

/** The single source of truth for every numeric input: its label, range and group. */
export const RANDY_V8_FIELDS: readonly RandyV8Field[] = [
  f('target', 'Target (strike)', 'TARGET KALSHI / TO BEAT', 0, 10_000_000, 0.01, 'target', false),
  f(
    'minEdgePct',
    'Edge to allow entry (%)',
    'Ventaja minima para permitir entrada',
    55,
    90,
    1,
    'target',
  ),
  f(
    'noEdgePct',
    'No clear edge below (%)',
    'Debajo de este % = sin ventaja clara',
    52,
    65,
    1,
    'target',
  ),
  f('emaCtxFast', 'Context EMA fast', 'EMA contexto rapida', 2, 400, 1, 'engine'),
  f('emaCtxSlow', 'Context EMA slow', 'EMA contexto lenta', 3, 400, 1, 'engine'),
  f('ema1Fast', '1M EMA fast', 'EMA 1M rapida', 2, 400, 1, 'engine'),
  f('ema1Slow', '1M EMA slow', 'EMA 1M lenta', 3, 400, 1, 'engine'),
  f('rsiLength', 'RSI length', 'RSI', 2, 200, 1, 'engine'),
  f('volLength', 'Volume average', 'Promedio volumen', 5, 400, 1, 'engine'),
  f('atrLength', 'ATR length', 'ATR', 2, 200, 1, 'engine'),
  f('atrAvgLength', '1M ATR average', 'Promedio ATR 1M', 5, 400, 1, 'engine'),
  f(
    'volMultiplier',
    'Strong volume × average',
    'Volumen fuerte x promedio',
    0.5,
    5,
    0.05,
    'engine',
  ),
  f('atrMin', 'Minimum relative volatility', 'Volatilidad minima relativa', 0.1, 5, 0.05, 'engine'),
  f('srLookback5', 'S/R 5M bars', 'S/R velas 5M', 5, 48, 1, 'engine'),
  f('srLookback15', 'S/R 15M bars', 'S/R velas 15M', 4, 32, 1, 'engine'),
  f(
    'confirmBars',
    '1M closes to confirm',
    'Cierres 1M necesarios para confirmar',
    1,
    4,
    1,
    'confirm',
  ),
  f(
    'momentumMin',
    'Minimum 5M LIVE + 1M momentum',
    'Momentum minimo 5M LIVE + 1M',
    10,
    60,
    1,
    'confirm',
  ),
  f(
    'crashBodyAtr',
    'Violent 1M candle: body / ATR',
    'Vela 1M violenta: cuerpo / ATR',
    0.4,
    2.5,
    0.05,
    'confirm',
  ),
  f('crash3Atr', 'Violent 3M move / ATR', 'Impulso 3M violento / ATR', 0.6, 4, 0.05, 'confirm'),
  f(
    'maxExtensionAtr',
    'Max extension from 15M open / ATR5',
    'Max extension desde apertura 15M / ATR5',
    0.4,
    2.5,
    0.05,
    'confirm',
  ),
  f('scalpThreshold', 'SCALP minimum score', 'Score minimo SCALP', 24, 80, 1, 'scalp'),
  f('scalpEvidenceMin', 'SCALP minimum evidence', 'Evidencias minimas SCALP', 2, 6, 1, 'scalp'),
  f(
    'preAlertThreshold',
    'PRE-ALERT score (CHARGING)',
    'Score PRE-ALERTA intravela',
    18,
    60,
    1,
    'scalp',
  ),
  f(
    'scalpNoTradeLastSec',
    'No SCALP in the last seconds',
    'No abrir SCALP en ultimos segundos',
    0,
    180,
    1,
    'scalp',
  ),
  f(
    'scalpExtremeExtensionAtr',
    'SCALP extreme extension / ATR5',
    'Extension extrema SCALP / ATR5',
    1,
    4,
    0.05,
    'scalp',
  ),
  f('chargedThreshold', 'CHARGED: minimum score', 'CHARGED: score minimo', 22, 60, 1, 'discipline'),
  f(
    'chargedEvidenceMin',
    'CHARGED: minimum evidence',
    'CHARGED: evidencias minimas',
    2,
    6,
    1,
    'discipline',
  ),
  f(
    'enterStrengthMin',
    'ENTER: minimum strength',
    'ENTRAR: fuerza minima',
    20,
    80,
    1,
    'discipline',
  ),
  f(
    'lateBlockAtr',
    "DON'T CHASE: block extension / ATR5",
    'NO PERSEGUIR: extension bloque / ATR5',
    0.7,
    3,
    0.05,
    'discipline',
  ),
  f(
    'lateTargetRatio',
    "DON'T CHASE: target distance / capacity",
    'NO PERSEGUIR: distancia Target / capacidad',
    0.5,
    2.5,
    0.05,
    'discipline',
  ),
  f(
    'sitOutLastSec',
    'SIT OUT: no entry in the last seconds',
    'SIT OUT: no abrir en ultimos segundos',
    30,
    240,
    1,
    'discipline',
  ),
  f('mapLookback1H', 'MAP 1H: bars', 'MAPA 1H: velas', 4, 48, 1, 'map'),
  f('mapLookback15', 'MAP 15M: bars', 'MAPA 15M: velas', 6, 64, 1, 'map'),
  f('mapZone1HAtr', 'MAP 1H: zone / ATR', 'MAPA 1H: zona / ATR', 0.1, 0.8, 0.02, 'map'),
  f('mapZone15Atr', 'MAP 15M: zone / ATR', 'MAPA 15M: zona / ATR', 0.08, 0.7, 0.02, 'map'),
  f('mapBreakAtr', 'MAP: break / ATR', 'MAPA: ruptura / ATR', 0.01, 0.25, 0.01, 'map'),
]

const BOOLEAN_KEYS = ['showEmas', 'showTarget', 'showLevels', 'showMarkers'] as const

export function isRandyV8Settings(value: unknown): value is RandyV8Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  for (const field of RANDY_V8_FIELDS) {
    const v = s[field.key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < field.min || v > field.max) return false
    if (field.int && !Number.isInteger(v)) return false
  }
  return BOOLEAN_KEYS.every((key) => typeof s[key] === 'boolean')
}

/** The stored profile, or the published defaults when it is missing or no longer valid. */
export function randyV8Settings(indicator: Indicator): RandyV8Settings {
  const candidate = indicator.randyV8
  if (!isRandyV8Settings(candidate)) return { ...RANDY_V8_DEFAULTS }
  const next: Record<string, unknown> = { ...RANDY_V8_DEFAULTS }
  const source = candidate as unknown as Record<string, unknown>
  for (const key of [...RANDY_V8_FIELDS.map((field) => field.key), ...BOOLEAN_KEYS]) {
    if (source[key] !== undefined) next[key] = source[key]
  }
  return next as unknown as RandyV8Settings
}

export function randyV8IndicatorLabel(indicator: Indicator): string {
  const s = randyV8Settings(indicator)
  return `Randy V8.10 (${s.target > 0 ? s.target : 'no target'})`
}

/** The resolutions the engine needs beyond the chart's own. */
export function randyV8RequestedTimeframes(chart: Timeframe): Timeframe[] {
  return RANDY_V8_TIMEFRAMES.filter((resolution) => resolution !== chart)
}

// ----------------------------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------------------------

export type RandyDecision =
  | 'review-target'
  | 'protect-up'
  | 'protect-down'
  | 'no-chase-up'
  | 'no-chase-down'
  | 'enter-up'
  | 'enter-down'
  | 'charged-up'
  | 'charged-down'
  | 'charging-up'
  | 'charging-down'
  | 'impulse-up'
  | 'impulse-down'
  | 'sit-out'
  | 'wait'

export type RandyTone = 'up' | 'down' | 'warn' | 'protect' | 'neutral'

export interface RandyBar {
  index: number
  time: number
  /** False until every feed the bar reads has answered; the rest of the fields are neutral. */
  ready: boolean
  /** Pine `barstate.isconfirmed`: false only on a live, still-forming newest bar. */
  confirmed: boolean
  targetEntered: boolean
  /** Pine `targetValido`: entered, and within 5% of the close. */
  targetValid: boolean
  /** close − target; 0 without a valid target. */
  distance: number
  /** Seconds left in the 15m contract. */
  secondsLeft: number
  /** SCALP direction score, −100…100, and its two always-visible halves. */
  scalpScore: number
  dirUpPct: number
  dirDownPct: number
  /** The Kalshi-style UP/DOWN meter off the TARGET core; always sums to 100. */
  meterUpPct: number
  meterDownPct: number
  /** Impulse strength, 0…100 (Pine `fuerzaImpulso`). */
  strength: number
  aligned: 'up' | 'down' | 'none'
  evidenceUp: number
  evidenceDown: number
  decision: RandyDecision
  /** −1 / 0 / 1: Pine `decisionFinal`, the ENTER state. */
  entry: -1 | 0 | 1
  decisionText: string
  modeText: string
  reasonText: string
  stageText: string
  mapText: string
  decisionTone: RandyTone
  stageTone: RandyTone
  mapTone: RandyTone
  /** The individual scores, for the panel's tooltip and the tests. */
  scores: {
    micro1: number
    live5: number
    closed5: number
    m15: number
    h1: number
    map: number
    market: number
    targetEdge: number
  }
  flags: {
    strongDrop: boolean
    strongRise: boolean
    lateUp: boolean
    lateDown: boolean
    sitOut: boolean
    volatilityOk: boolean
  }
}

export interface RandyEntry {
  index: number
  time: number
  side: 'up' | 'down'
}

export interface RandyV8Result {
  bars: RandyBar[]
  /** The newest bar — what the floating panel reads. */
  last: RandyBar | null
  /** Higher-timeframe feeds that had no candles; while any is missing no bar is ready. */
  missingFeeds: Timeframe[]
  /** Chart-aligned lines, `null` where the original plots `na`. */
  ema9: (number | null)[]
  ema20: (number | null)[]
  target: (number | null)[]
  resistance5: (number | null)[]
  support5: (number | null)[]
  max15: (number | null)[]
  min15: (number | null)[]
  max1h: (number | null)[]
  min1h: (number | null)[]
  /** Confirmed bars where the decision turned into ENTER UP / DOWN. */
  entries: RandyEntry[]
}

export interface RandyV8Context {
  timeframe: Timeframe
  timeframes?: Partial<Record<Timeframe, { candles: Candle[] }>>
  replay?: boolean
  /**
   * Wall-clock seconds. The newest bar is live — unconfirmed, clocked on `now` — only while this
   * is within a bar of its close; without it every bar is confirmed, which suits replay and demo
   * history pinned away from the wall clock.
   */
  nowSeconds?: number
}

// ----------------------------------------------------------------------------------------------
// Numeric helpers
// ----------------------------------------------------------------------------------------------

type Values = (number | null)[]

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
const gt = (a: number | null, b: number | null) => a !== null && b !== null && a > b
const lt = (a: number | null, b: number | null) => a !== null && b !== null && a < b
const ge = (a: number | null, b: number | null) => a !== null && b !== null && a >= b
const le = (a: number | null, b: number | null) => a !== null && b !== null && a <= b

/** Pine `ta.highest(src, n)` / `ta.lowest`, `null` until n bars exist. */
function rolling(values: number[], n: number, pick: (a: number, b: number) => number): Values {
  return values.map((_, i) => {
    if (i < n - 1) return null
    let out = values[i]!
    for (let j = i - n + 1; j < i; j++) out = pick(out, values[j]!)
    return out
  })
}

/** Wilder-smoothed average gain/loss, matching Pine `ta.rsi`'s `rma(change)` seeding. */
function wilderRsiParts(values: number[], length: number): { gain: Values; loss: Values } {
  const gain: Values = []
  const loss: Values = []
  let sumUp = 0
  let sumDown = 0
  let avgUp: number | null = null
  let avgDown = 0
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      gain.push(null)
      loss.push(null)
      continue
    }
    const diff = values[i]! - values[i - 1]!
    const up = Math.max(diff, 0)
    const down = Math.max(-diff, 0)
    if (i <= length) {
      sumUp += up
      sumDown += down
      if (i === length) {
        avgUp = sumUp / length
        avgDown = sumDown / length
      }
    } else if (avgUp !== null) {
      avgUp = (avgUp * (length - 1) + up) / length
      avgDown = (avgDown * (length - 1) + down) / length
    }
    gain.push(avgUp)
    loss.push(avgUp === null ? null : avgDown)
  }
  return { gain, loss }
}

/** Pine's `rsi`: 100 when nothing fell, 0 when nothing rose. */
function rsiFrom(gain: number | null, loss: number | null): number | null {
  if (gain === null || loss === null) return null
  if (loss === 0) return 100
  if (gain === 0) return 0
  return 100 - 100 / (1 + gain / loss)
}

/** Pine `ta.atr(length)` — Wilder RMA of the true range, seeded with its first `length` mean. */
function atrSeries(candles: Candle[], length: number): Values {
  const out: Values = []
  let sum = 0
  let atr: number | null = null
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    const tr =
      i === 0
        ? c.high - c.low
        : Math.max(
            c.high - c.low,
            Math.abs(c.high - candles[i - 1]!.close),
            Math.abs(c.low - candles[i - 1]!.close),
          )
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

// ----------------------------------------------------------------------------------------------
// Context and micro scores
// ----------------------------------------------------------------------------------------------

/** Everything one score reads off one bar, so a closed bar and a forming bar share one scorer. */
interface Frame {
  open: number
  high: number
  low: number
  close: number
  volume: number
  fast: number | null
  slow: number | null
  fastBack2: number | null
  rsi: number | null
  atr: number | null
  volAvg: number | null
  prevHigh: number | null
  prevLow: number | null
  prevOpen: number | null
  prevClose: number | null
  prevClose2: number | null
  maxPrev5: number | null
  minPrev5: number | null
}

/** One timeframe's candles and the recursions both scores read. */
interface Pack {
  candles: Candle[]
  fast: Values
  slow: Values
  gain: Values
  loss: Values
  rsi: Values
  atr: Values
  volAvg: Values
  fastAlpha: number
  slowAlpha: number
  rsiLength: number
  atrLength: number
  volLength: number
}

function buildPack(
  candles: Candle[],
  fastLength: number,
  slowLength: number,
  rsiLength: number,
  atrLength: number,
  volLength: number,
): Pack {
  const closes = candles.map((c) => c.close)
  const { gain, loss } = wilderRsiParts(closes, rsiLength)
  return {
    candles,
    fast: ta.ema(closes, fastLength),
    slow: ta.ema(closes, slowLength),
    gain,
    loss,
    rsi: gain.map((g, i) => rsiFrom(g, loss[i] ?? null)),
    atr: atrSeries(candles, atrLength),
    volAvg: ta.sma(
      candles.map((c) => c.volume),
      volLength,
    ),
    fastAlpha: 2 / (fastLength + 1),
    slowAlpha: 2 / (slowLength + 1),
    rsiLength,
    atrLength,
    volLength,
  }
}

const at = (values: Values, index: number): number | null =>
  index >= 0 && index < values.length ? (values[index] ?? null) : null

/** `highest(high[1], 5)` / `lowest(low[1], 5)` for the bar at `base`, from the five before it. */
function previousExtreme(
  candles: Candle[],
  base: number,
  pick: (c: Candle) => number,
  better: (a: number, b: number) => number,
): number | null {
  if (base < 5) return null
  let out = pick(candles[base - 1]!)
  for (let j = base - 2; j >= base - 5; j--) out = better(out, pick(candles[j]!))
  return out
}

/** The frame of the closed bar `k`. */
function closedFrame(pack: Pack, k: number): Frame {
  const c = pack.candles[k]!
  const prev = pack.candles[k - 1]
  return {
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    fast: pack.fast[k] ?? null,
    slow: pack.slow[k] ?? null,
    fastBack2: at(pack.fast, k - 2),
    rsi: pack.rsi[k] ?? null,
    atr: pack.atr[k] ?? null,
    volAvg: pack.volAvg[k] ?? null,
    prevHigh: prev ? prev.high : null,
    prevLow: prev ? prev.low : null,
    prevOpen: prev ? prev.open : null,
    prevClose: prev ? prev.close : null,
    prevClose2: pack.candles[k - 2]?.close ?? null,
    maxPrev5: previousExtreme(pack.candles, k, (x) => x.high, Math.max),
    minPrev5: previousExtreme(pack.candles, k, (x) => x.low, Math.min),
  }
}

/**
 * The frame of a bar that has not closed yet, standing one step after the closed bar `p`: every
 * recursion advances once from `p` with the forming bar's values — what the original's
 * `request.security(..., lookahead_off)` reads on the live edge.
 */
function formingFrame(pack: Pack, p: number, bar: Omit<Candle, 'time'>): Frame {
  const base = p + 1
  const prev = pack.candles[p]!
  const step = (previous: number | null, alpha: number) =>
    previous === null ? null : alpha * bar.close + (1 - alpha) * previous
  const up = Math.max(bar.close - prev.close, 0)
  const down = Math.max(prev.close - bar.close, 0)
  const gainPrev = pack.gain[p] ?? null
  const lossPrev = pack.loss[p] ?? null
  const n = pack.rsiLength
  const gain = gainPrev === null ? null : (gainPrev * (n - 1) + up) / n
  const loss = lossPrev === null ? null : (lossPrev * (n - 1) + down) / n
  const tr = Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prev.close),
    Math.abs(bar.low - prev.close),
  )
  const atrPrev = pack.atr[p] ?? null
  const m = pack.atrLength
  let volAvg: number | null = null
  if (base >= pack.volLength - 1) {
    let sum = bar.volume
    for (let j = p; j > p - (pack.volLength - 1); j--) sum += pack.candles[j]!.volume
    volAvg = sum / pack.volLength
  }
  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    fast: step(at(pack.fast, p), pack.fastAlpha),
    slow: step(at(pack.slow, p), pack.slowAlpha),
    fastBack2: at(pack.fast, base - 2),
    rsi: rsiFrom(gain, loss),
    atr: atrPrev === null ? null : (atrPrev * (m - 1) + tr) / m,
    volAvg,
    prevHigh: prev.high,
    prevLow: prev.low,
    prevOpen: prev.open,
    prevClose: prev.close,
    prevClose2: pack.candles[p - 1]?.close ?? null,
    maxPrev5: previousExtreme(pack.candles, base, (x) => x.high, Math.max),
    minPrev5: previousExtreme(pack.candles, base, (x) => x.low, Math.min),
  }
}

interface FrameMetrics {
  range: number
  body: number
  closePos: number
  upperWick: number
  lowerWick: number
  bodyAtr: number
  structureUp: boolean
  structureDown: boolean
  sequenceUp: boolean
  sequenceDown: boolean
  strongVolume: boolean
  breakUp: boolean
  breakDown: boolean
}

function metrics(fr: Frame, volMultiplier: number): FrameMetrics {
  const range = Math.max(fr.high - fr.low, MINTICK)
  const body = Math.abs(fr.close - fr.open)
  return {
    range,
    body,
    closePos: (fr.close - fr.low) / range,
    upperWick: fr.high - Math.max(fr.open, fr.close),
    lowerWick: Math.min(fr.open, fr.close) - fr.low,
    bodyAtr: fr.atr !== null && fr.atr > 0 ? body / fr.atr : 0,
    structureUp: fr.prevHigh !== null && fr.high > fr.prevHigh && fr.low > (fr.prevLow ?? Infinity),
    structureDown:
      fr.prevHigh !== null && fr.high < fr.prevHigh && fr.low < (fr.prevLow ?? -Infinity),
    sequenceUp: gt(fr.close, fr.prevClose) && gt(fr.prevClose, fr.prevClose2),
    sequenceDown: lt(fr.close, fr.prevClose) && lt(fr.prevClose, fr.prevClose2),
    strongVolume: fr.volAvg !== null && fr.volume > fr.volAvg * volMultiplier,
    breakUp: gt(fr.close, fr.maxPrev5),
    breakDown: lt(fr.close, fr.minPrev5),
  }
}

/** Pine `f_contextScore()` — the 1H, 15M and 5M reading. */
function contextScore(fr: Frame, volMultiplier: number): number {
  const m = metrics(fr, volMultiplier)
  const bull = fr.close > fr.open
  const bear = fr.close < fr.open
  const rechazoUp = m.lowerWick > m.body * 1.35 && m.closePos >= 0.6
  const rechazoDown = m.upperWick > m.body * 1.35 && m.closePos <= 0.4
  const engulfUp =
    bull &&
    fr.prevClose !== null &&
    fr.prevOpen !== null &&
    fr.prevClose < fr.prevOpen &&
    fr.close >= fr.prevOpen &&
    fr.open <= fr.prevClose
  const engulfDown =
    bear &&
    fr.prevClose !== null &&
    fr.prevOpen !== null &&
    fr.prevClose > fr.prevOpen &&
    fr.close <= fr.prevOpen &&
    fr.open >= fr.prevClose

  let s = 0
  if (gt(fr.fast, fr.slow)) s += 18
  else if (lt(fr.fast, fr.slow)) s -= 18
  if (gt(fr.close, fr.fast)) s += 10
  else if (lt(fr.close, fr.fast)) s -= 10
  if (gt(fr.fast, fr.fastBack2)) s += 9
  else if (lt(fr.fast, fr.fastBack2)) s -= 9
  if (ge(fr.rsi, 60)) s += 11
  else if (ge(fr.rsi, 53)) s += 5
  else if (le(fr.rsi, 40)) s -= 11
  else if (le(fr.rsi, 47)) s -= 5
  if (m.structureUp) s += 16
  else if (m.structureDown) s -= 16
  if (m.sequenceUp) s += 9
  else if (m.sequenceDown) s -= 9
  if (bull && m.closePos >= 0.7 && m.bodyAtr >= 0.25) s += 11
  else if (bear && m.closePos <= 0.3 && m.bodyAtr >= 0.25) s -= 11
  if (rechazoUp) s += 8
  else if (rechazoDown) s -= 8
  if (engulfUp) s += 8
  else if (engulfDown) s -= 8
  if (m.strongVolume && bull) s += 10
  else if (m.strongVolume && bear) s -= 10
  if (m.breakUp) s += 10
  else if (m.breakDown) s -= 10
  return clamp(s, -100, 100)
}

/** Pine `f_microScore()` — the faster 1M reading. */
function microScore(fr: Frame, volMultiplier: number): number {
  const m = metrics(fr, volMultiplier)
  const bull = fr.close > fr.open
  const bear = fr.close < fr.open

  let s = 0
  if (gt(fr.fast, fr.slow)) s += 20
  else if (lt(fr.fast, fr.slow)) s -= 20
  if (gt(fr.close, fr.fast)) s += 10
  else if (lt(fr.close, fr.fast)) s -= 10
  if (gt(fr.fast, fr.fastBack2)) s += 10
  else if (lt(fr.fast, fr.fastBack2)) s -= 10
  if (ge(fr.rsi, 60)) s += 13
  else if (ge(fr.rsi, 54)) s += 7
  else if (le(fr.rsi, 40)) s -= 13
  else if (le(fr.rsi, 46)) s -= 7
  if (m.structureUp) s += 13
  else if (m.structureDown) s -= 13
  if (m.sequenceUp) s += 9
  else if (m.sequenceDown) s -= 9
  if (bull && m.closePos >= 0.7 && m.bodyAtr >= 0.22) s += 13
  else if (bear && m.closePos <= 0.3 && m.bodyAtr >= 0.22) s -= 13
  if (m.strongVolume && bull) s += 12
  else if (m.strongVolume && bear) s -= 12
  if (m.breakUp) s += 10
  else if (m.breakDown) s -= 10
  return clamp(s, -100, 100)
}

// ----------------------------------------------------------------------------------------------
// Text
// ----------------------------------------------------------------------------------------------

const DECISION_TEXT: Record<RandyDecision, string> = {
  'review-target': 'REVIEW TARGET',
  'protect-up': 'PROTECT UP',
  'protect-down': 'PROTECT DOWN',
  'no-chase-up': "DON'T CHASE UP",
  'no-chase-down': "DON'T CHASE DOWN",
  'enter-up': 'ENTER UP',
  'enter-down': 'ENTER DOWN',
  'charged-up': 'CHARGED UP',
  'charged-down': 'CHARGED DOWN',
  'charging-up': 'CHARGING UP',
  'charging-down': 'CHARGING DOWN',
  'impulse-up': 'TURN / IMPULSE UP',
  'impulse-down': 'TURN / IMPULSE DOWN',
  'sit-out': 'SIT OUT',
  wait: 'WAIT',
}

const DECISION_TONE: Record<RandyDecision, RandyTone> = {
  'review-target': 'neutral',
  'protect-up': 'protect',
  'protect-down': 'protect',
  'no-chase-up': 'warn',
  'no-chase-down': 'warn',
  'enter-up': 'up',
  'enter-down': 'down',
  'charged-up': 'warn',
  'charged-down': 'warn',
  'charging-up': 'warn',
  'charging-down': 'warn',
  'impulse-up': 'warn',
  'impulse-down': 'warn',
  'sit-out': 'neutral',
  wait: 'warn',
}

export function randyDecisionText(decision: RandyDecision): string {
  return DECISION_TEXT[decision]
}

function neutralBar(index: number, time: number, confirmed: boolean): RandyBar {
  return {
    index,
    time,
    ready: false,
    confirmed,
    targetEntered: false,
    targetValid: false,
    distance: 0,
    secondsLeft: 0,
    scalpScore: 0,
    dirUpPct: 50,
    dirDownPct: 50,
    meterUpPct: 50,
    meterDownPct: 50,
    strength: 0,
    aligned: 'none',
    evidenceUp: 0,
    evidenceDown: 0,
    decision: 'wait',
    entry: 0,
    decisionText: DECISION_TEXT.wait,
    modeText: 'NO ENTRY',
    reasonText: 'WAITING FOR DATA',
    stageText: 'NO CLEAR EDGE',
    mapText: 'NO KEY ZONE',
    decisionTone: 'neutral',
    stageTone: 'neutral',
    mapTone: 'neutral',
    scores: { micro1: 0, live5: 0, closed5: 0, m15: 0, h1: 0, map: 0, market: 0, targetEdge: 0 },
    flags: {
      strongDrop: false,
      strongRise: false,
      lateUp: false,
      lateDown: false,
      sitOut: false,
      volatilityOk: false,
    },
  }
}

// ----------------------------------------------------------------------------------------------
// Engine
// ----------------------------------------------------------------------------------------------

export function calculateRandyV8(
  candles: Candle[],
  settings: RandyV8Settings,
  context: RandyV8Context = { timeframe: '1m' },
): RandyV8Result {
  if (!isRandyV8Settings(settings)) throw new Error('Invalid Randy V8.10 settings.')
  const n = candles.length
  const chartStep = INTERVAL_SECONDS[context.timeframe] ?? 60
  const nulls = (): Values => candles.map(() => null)
  const unready = (missing: Timeframe[]): RandyV8Result => ({
    bars: candles.map((c, i) => neutralBar(i, c.time, true)),
    last: n ? neutralBar(n - 1, candles[n - 1]!.time, true) : null,
    missingFeeds: missing,
    ema9: nulls(),
    ema20: nulls(),
    target: nulls(),
    resistance5: nulls(),
    support5: nulls(),
    max15: nulls(),
    min15: nulls(),
    max1h: nulls(),
    min1h: nulls(),
    entries: [],
  })
  if (!n) return unready([])

  const isHigher = (tf: Timeframe) => (INTERVAL_SECONDS[tf] ?? 0) > chartStep
  const sourceFor = (tf: Timeframe) =>
    isHigher(tf) ? (context.timeframes?.[tf]?.candles ?? []) : candles
  const missing = RANDY_V8_TIMEFRAMES.filter((tf) => isHigher(tf) && !sourceFor(tf).length)
  if (missing.length) return unready([...missing])

  const times = candles.map((c) => c.time)
  const lastTime = times[n - 1]!
  const live =
    !context.replay &&
    context.nowSeconds !== undefined &&
    Math.abs(context.nowSeconds - (lastTime + chartStep)) <= chartStep

  const s = settings
  const src5 = sourceFor('5m')
  const src15 = sourceFor('15m')
  const src1h = sourceFor('1h')
  const ctxPack = (source: Candle[]) =>
    buildPack(source, s.emaCtxFast, s.emaCtxSlow, s.rsiLength, s.atrLength, s.volLength)
  const pack5 = ctxPack(src5)
  const pack15 = ctxPack(src15)
  const pack1h = ctxPack(src1h)
  const closedScores = (pack: Pack) =>
    pack.candles.map((_, k) => contextScore(closedFrame(pack, k), s.volMultiplier))
  const score5Closed = closedScores(pack5)
  const score15Series = closedScores(pack15)
  const score1hSeries = closedScores(pack1h)

  const idx5 = closedHtfIndexes(times, src5, '5m', isHigher('5m'))
  const idx15 = closedHtfIndexes(times, src15, '15m', isHigher('15m'))
  const idx1h = closedHtfIndexes(times, src1h, '1h', isHigher('1h'))

  const highs = (source: Candle[]) => source.map((c) => c.high)
  const lows = (source: Candle[]) => source.map((c) => c.low)
  const res5Series = rolling(highs(src5), s.srLookback5, Math.max)
  const sup5Series = rolling(lows(src5), s.srLookback5, Math.min)
  const res15Series = rolling(highs(src15), s.srLookback15, Math.max)
  const sup15Series = rolling(lows(src15), s.srLookback15, Math.min)
  const max15Series = rolling(highs(src15), s.mapLookback15, Math.max)
  const min15Series = rolling(lows(src15), s.mapLookback15, Math.min)
  const max1hSeries = rolling(highs(src1h), s.mapLookback1H, Math.max)
  const min1hSeries = rolling(lows(src1h), s.mapLookback1H, Math.min)

  // The chart's own 1M reading and the 5M LIVE score.
  const micro = buildPack(candles, s.ema1Fast, s.ema1Slow, s.rsiLength, s.atrLength, s.volLength)
  const score1M = candles.map((_, i) => microScore(closedFrame(micro, i), s.volMultiplier))
  const atrAvg1 = ta.sma(micro.atr, s.atrAvgLength)
  const live5: (number | null)[] = []
  if (chartStep < 300 && 300 % chartStep === 0) {
    let bucket = -1
    let o = 0
    let h = 0
    let l = 0
    let v = 0
    for (let i = 0; i < n; i++) {
      const c = candles[i]!
      const b = bucketStart(c.time, '5m')
      if (b !== bucket) {
        bucket = b
        o = c.open
        h = c.high
        l = c.low
        v = 0
      }
      h = Math.max(h, c.high)
      l = Math.min(l, c.low)
      v += c.volume
      const p = idx5[i]
      live5.push(
        p === null || p === undefined
          ? null
          : contextScore(
              formingFrame(pack5, p, { open: o, high: h, low: l, close: c.close, volume: v }),
              s.volMultiplier,
            ),
      )
    }
  } else {
    const own = ctxPack(candles)
    for (let i = 0; i < n; i++) live5.push(contextScore(closedFrame(own, i), s.volMultiplier))
  }

  const ema9Line: Values = micro.fast
  const ema20Line: Values = micro.slow

  const bars: RandyBar[] = []
  const targetLine: Values = []
  const res5Line: Values = []
  const sup5Line: Values = []
  const max15Line: Values = []
  const min15Line: Values = []
  const max1hLine: Values = []
  const min1hLine: Values = []
  const entries: RandyEntry[] = []

  let openBlock: number | null = null
  let streakUp = 0
  let streakDown = 0
  let lastTrigger = 0
  let previousEntry = 0

  for (let i = 0; i < n; i++) {
    const c = candles[i]!
    const confirmed = !(live && i === n - 1)
    const p5 = idx5[i] ?? null
    const p15 = idx15[i] ?? null
    const p1h = idx1h[i] ?? null

    const res5 = p5 === null ? null : at(res5Series, p5)
    const sup5 = p5 === null ? null : at(sup5Series, p5)
    const res15 = p15 === null ? null : at(res15Series, p15)
    const sup15 = p15 === null ? null : at(sup15Series, p15)
    const max15 = p15 === null ? null : at(max15Series, p15)
    const min15 = p15 === null ? null : at(min15Series, p15)
    const max1h = p1h === null ? null : at(max1hSeries, p1h)
    const min1h = p1h === null ? null : at(min1hSeries, p1h)
    res5Line.push(res5)
    sup5Line.push(sup5)
    max15Line.push(max15)
    min15Line.push(min15)
    max1hLine.push(max1h)
    min1hLine.push(min1h)

    // The 15m block's open: `var aperturaBloque15`, reset on every new 15m bar.
    const new15 = i === 0 || bucketStart(c.time, '15m') !== bucketStart(times[i - 1]!, '15m')
    if (new15 || openBlock === null) openBlock = c.open
    if (new15) lastTrigger = 0

    const validTarget = s.target > 0 && Math.abs(s.target - c.close) / c.close < 0.05
    targetLine.push(validTarget ? s.target : null)

    const atr5 = p5 === null ? null : at(pack5.atr, p5)
    const atr15 = p15 === null ? null : at(pack15.atr, p15)
    const atr1H = p1h === null ? null : at(pack1h.atr, p1h)
    const atr1 = micro.atr[i] ?? null
    const score15 = p15 === null ? null : (score15Series[p15] ?? null)
    const score1H = p1h === null ? null : (score1hSeries[p1h] ?? null)
    const score5c = p5 === null ? null : (score5Closed[p5] ?? null)
    const score5Live = live5[i] ?? null

    if (
      i < 5 ||
      atr5 === null ||
      atr15 === null ||
      atr1H === null ||
      atr1 === null ||
      score15 === null ||
      score1H === null ||
      score5c === null ||
      score5Live === null
    ) {
      bars.push(neutralBar(i, c.time, confirmed))
      previousEntry = 0
      continue
    }

    const close = c.close
    const open = c.open
    const score1 = score1M[i]!
    const ema9 = micro.fast[i] ?? null
    const ema20 = micro.slow[i] ?? null
    const atrProm1 = atrAvg1[i] ?? null
    const volProm1 = micro.volAvg[i] ?? null
    const volRatio1 = volProm1 !== null && volProm1 > 0 ? c.volume / volProm1 : 1
    const volatilityOk = atrProm1 !== null && atrProm1 > 0 && atr1 >= atrProm1 * s.atrMin

    // Clock of the 15m contract.
    const referenceTime = live && i === n - 1 ? context.nowSeconds! : c.time + chartStep
    const contractEnd = bucketStart(c.time, '15m') + 900
    const secondsLeft = Math.max(Math.trunc(contractEnd - referenceTime), 0)
    const minutesLeft = Math.max(secondsLeft / 60, 0.1)
    const progress = clamp(1 - secondsLeft / 900, 0, 1)

    // Support / resistance.
    const dRes5 = atr5 > 0 && res5 !== null ? (res5 - close) / atr5 : null
    const dSup5 = atr5 > 0 && sup5 !== null ? (close - sup5) / atr5 : null
    const dRes15 = atr15 > 0 && res15 !== null ? (res15 - close) / atr15 : null
    const dSup15 = atr15 > 0 && sup15 !== null ? (close - sup15) / atr15 : null
    const nearBetween = (d: number | null, max: number) => d !== null && d >= 0 && d <= max
    const nearResistance = nearBetween(dRes5, 0.35) || nearBetween(dRes15, 0.3)
    const nearSupport = nearBetween(dSup5, 0.35) || nearBetween(dSup15, 0.3)
    const breakResistance =
      res5 !== null && close > res5 + atr5 * 0.04 && score5Live >= 25 && volRatio1 >= 1.1
    const breakSupport =
      sup5 !== null && close < sup5 - atr5 * 0.04 && score5Live <= -25 && volRatio1 >= 1.1

    let srAdjust = 0
    if (nearResistance && !breakResistance) srAdjust -= 12
    if (nearSupport && !breakSupport) srAdjust += 12
    if (breakResistance) srAdjust += 8
    if (breakSupport) srAdjust -= 8
    srAdjust = clamp(srAdjust, -20, 20)

    // MAP 1H + 15M: where BTC is and how it reacts to the big zones.
    const body = Math.abs(close - open)
    const upperWick = c.high - Math.max(open, close)
    const lowerWick = Math.min(open, close) - c.low
    const tol1H = atr1H * s.mapZone1HAtr
    const tol15 = atr15 * s.mapZone15Atr
    const nearMax1H = max1h !== null && c.high >= max1h - tol1H && close <= max1h + tol1H
    const nearMin1H = min1h !== null && c.low <= min1h + tol1H && close >= min1h - tol1H
    const nearMax15 = max15 !== null && c.high >= max15 - tol15 && close <= max15 + tol15
    const nearMin15 = min15 !== null && c.low <= min15 + tol15 && close >= min15 - tol15
    const rejectMax1H =
      nearMax1H && close < open && upperWick >= Math.max(body * 0.65, MINTICK) && close < max1h!
    const rejectMin1H =
      nearMin1H && close > open && lowerWick >= Math.max(body * 0.65, MINTICK) && close > min1h!
    const rejectMax15 =
      nearMax15 && close < open && upperWick >= Math.max(body * 0.55, MINTICK) && close < max15!
    const rejectMin15 =
      nearMin15 && close > open && lowerWick >= Math.max(body * 0.55, MINTICK) && close > min15!
    const breakMax1H = max1h !== null && close > max1h + atr1H * s.mapBreakAtr && score5Live >= 12
    const breakMin1H = min1h !== null && close < min1h - atr1H * s.mapBreakAtr && score5Live <= -12
    const breakMax15 = max15 !== null && close > max15 + atr15 * s.mapBreakAtr && score5Live >= 10
    const breakMin15 = min15 !== null && close < min15 - atr15 * s.mapBreakAtr && score5Live <= -10

    let scoreMap = 0
    if (rejectMax1H) scoreMap -= 20
    else if (breakMax1H) scoreMap += 22
    else if (nearMax1H) scoreMap -= 6
    if (rejectMin1H) scoreMap += 20
    else if (breakMin1H) scoreMap -= 22
    else if (nearMin1H) scoreMap += 6
    if (rejectMax15) scoreMap -= 28
    else if (breakMax15) scoreMap += 30
    else if (nearMax15) scoreMap -= 8
    if (rejectMin15) scoreMap += 28
    else if (breakMin15) scoreMap -= 30
    else if (nearMin15) scoreMap += 8
    scoreMap = clamp(scoreMap, -100, 100)

    let mapText = 'NO KEY ZONE'
    let mapTone: RandyTone = 'neutral'
    if (breakMax15 || breakMax1H) {
      mapText =
        breakMax15 && breakMax1H
          ? 'BREAKS MAX 15M + 1H'
          : breakMax15
            ? 'BREAKS MAX 15M'
            : 'BREAKS MAX 1H'
      mapTone = 'up'
    } else if (breakMin15 || breakMin1H) {
      mapText =
        breakMin15 && breakMin1H
          ? 'BREAKS MIN 15M + 1H'
          : breakMin15
            ? 'BREAKS MIN 15M'
            : 'BREAKS MIN 1H'
      mapTone = 'down'
    } else if (rejectMax15 || rejectMax1H) {
      mapText =
        rejectMax15 && rejectMax1H
          ? 'REJECTED AT MAX 15M + 1H'
          : rejectMax15
            ? 'REJECTED AT MAX 15M'
            : 'REJECTED AT MAX 1H'
      mapTone = 'down'
    } else if (rejectMin15 || rejectMin1H) {
      mapText =
        rejectMin15 && rejectMin1H
          ? 'BOUNCE OFF MIN 15M + 1H'
          : rejectMin15
            ? 'BOUNCE OFF MIN 15M'
            : 'BOUNCE OFF MIN 1H'
      mapTone = 'up'
    } else if (nearMax15 || nearMax1H) {
      mapText = nearMax15 ? 'NEAR MAX 15M' : 'NEAR MAX 1H'
      mapTone = 'warn'
    } else if (nearMin15 || nearMin1H) {
      mapText = nearMin15 ? 'NEAR MIN 15M' : 'NEAR MIN 1H'
      mapTone = 'warn'
    }

    // Market context: 15M sets the scenario, 5M LIVE + 1M speed up the reaction.
    const scoreFast = clamp(score5Live * 0.55 + score1 * 0.45, -100, 100)
    const scoreMarket = clamp(
      score15 * 0.27 +
        score5c * 0.1 +
        score5Live * 0.24 +
        score1 * 0.21 +
        score1H * 0.08 +
        scoreMap * 0.1 +
        srAdjust,
      -100,
      100,
    )

    // TARGET core: distance + time + the movement still available.
    const atr5PerMin = atr5 > 0 ? atr5 / Math.sqrt(5) : atr1
    const baseMove = Math.max(atr1 * 0.65 + atr5PerMin * 0.35, MINTICK)
    const capacity = Math.max(baseMove * Math.sqrt(minutesLeft) * 1.1, MINTICK)
    const distance = validTarget ? close - s.target : 0
    const ratioTarget = validTarget ? distance / capacity : 0
    const velocity3 = (close - candles[i - 3]!.close) / 3
    const velocity5 = (close - candles[i - 5]!.close) / 5
    const velocityMix = velocity3 * 0.65 + velocity5 * 0.35
    const projectionMinutes = Math.min(minutesLeft, 4)
    const projected = validTarget ? distance + velocityMix * projectionMinutes * 0.45 : 0
    const ratioProjected = validTarget ? projected / capacity : 0
    const targetEdge = validTarget ? clamp(ratioTarget * 55 + ratioProjected * 20, -100, 100) : 0
    const distanceFactor = validTarget ? clamp(Math.abs(ratioTarget) / 1.25, 0, 1) : 0
    const targetWeight = validTarget
      ? clamp(0.6 + progress * 0.18 + distanceFactor * 0.12, 0.6, 0.9)
      : 0
    const contextGate = validTarget ? clamp(0.15 + Math.abs(ratioTarget) * 0.75, 0.15, 1) : 0
    let scoreV8 = validTarget
      ? targetEdge * targetWeight + scoreMarket * contextGate * (1 - targetWeight)
      : 0

    // Violent rises and drops: don't hold UP through a collapse or DOWN through a pump.
    const body1Atr = atr1 > 0 ? body / atr1 : 0
    const move3Atr = atr1 > 0 ? (close - candles[i - 3]!.close) / atr1 : 0
    const dropCandle = close < open && body1Atr >= s.crashBodyAtr && volRatio1 >= 1.15
    const riseCandle = close > open && body1Atr >= s.crashBodyAtr && volRatio1 >= 1.15
    const dropSequence = move3Atr <= -s.crash3Atr && score1 <= -35
    const riseSequence = move3Atr >= s.crash3Atr && score1 >= 35
    const strongDrop =
      dropCandle || dropSequence || (score1 <= -70 && score5Live <= -35 && lt(close, ema20))
    const strongRise =
      riseCandle || riseSequence || (score1 >= 70 && score5Live >= 35 && gt(close, ema20))
    if (strongDrop) scoreV8 -= 22
    if (strongRise) scoreV8 += 22
    scoreV8 = clamp(scoreV8, -100, 100)

    const meterUp = validTarget ? Math.round(clamp(50 + scoreV8 * 0.5, 1, 99)) : 50
    const meterDown = 100 - meterUp

    // Risk / complication.
    const blockMoveAtr = atr5 > 0 ? (close - openBlock) / atr5 : 0
    const extendedUp = blockMoveAtr >= s.maxExtensionAtr
    const extendedDown = blockMoveAtr <= -s.maxExtensionAtr
    const conflictTargetMarket =
      (targetEdge >= 25 && scoreMarket <= -25) || (targetEdge <= -25 && scoreMarket >= 25)
    const conflict15v5 =
      (score15 >= 25 && score5Live <= -25) || (score15 <= -25 && score5Live >= 25)
    const nearTargetLate = validTarget && secondsLeft <= 180 && Math.abs(ratioTarget) <= 0.35
    const riskUpResistance = nearResistance && !breakResistance
    const riskDownSupport = nearSupport && !breakSupport
    const against1HUp = score1H <= -55
    const against1HDown = score1H >= 55

    // SCALP: the immediate move. Conflicts penalise a little and never veto.
    const targetChange = validTarget ? clamp((ratioProjected - ratioTarget) * 160, -100, 100) : 0
    const vel1 = atr1 > 0 ? (close - open) / atr1 : 0
    const vel3 = move3Atr
    const vel5 = atr1 > 0 ? (close - candles[i - 5]!.close) / atr1 : 0
    const velocityScore = clamp(vel1 * 28 + vel3 * 18 + vel5 * 7, -48, 48)
    const volumeDirection =
      close > open
        ? clamp((volRatio1 - 0.75) * 14, 0, 18)
        : close < open
          ? -clamp((volRatio1 - 0.75) * 14, 0, 18)
          : 0

    let scoreScalp =
      score1 * 0.3 +
      score5Live * 0.28 +
      targetChange * 0.1 +
      scoreMap * 0.16 +
      score15 * 0.05 +
      score5c * 0.03 +
      score1H * 0.03 +
      targetEdge * 0.05 +
      velocityScore * 0.75 +
      volumeDirection
    if (strongRise) scoreScalp += 16
    if (strongDrop) scoreScalp -= 16
    if (breakResistance || breakMax15 || breakMax1H) scoreScalp += 8
    if (breakSupport || breakMin15 || breakMin1H) scoreScalp -= 8
    if (riskUpResistance && scoreScalp > 0) scoreScalp -= 4
    if (riskDownSupport && scoreScalp < 0) scoreScalp += 4
    if (against1HUp && scoreScalp > 0) scoreScalp -= 3
    if (against1HDown && scoreScalp < 0) scoreScalp += 3
    if (!volatilityOk && progress < 0.7) scoreScalp *= 0.93
    scoreScalp = clamp(scoreScalp, -100, 100)

    const dirUp = Math.round(clamp(50 + scoreScalp * 0.5, 1, 99))
    const dirDown = 100 - dirUp

    // Strength of the impulse, separate from its direction.
    const speedStrength = clamp(
      Math.abs(vel1) * 38 + Math.abs(vel3) * 20 + Math.abs(vel5) * 7,
      0,
      70,
    )
    const alignStrength = clamp(Math.abs(score1) * 0.18 + Math.abs(score5Live) * 0.12, 0, 24)
    const volumeStrength = clamp((volRatio1 - 0.7) * 16, 0, 16)
    const anyBreak =
      breakResistance || breakSupport || breakMax15 || breakMin15 || breakMax1H || breakMin1H
    const strength = clamp(
      speedStrength + alignStrength + volumeStrength + (anyBreak ? 10 : 0),
      0,
      100,
    )

    const range1 = Math.max(c.high - c.low, MINTICK)
    const closePos1 = (close - c.low) / range1
    const impulseCandleUp = close > open && body1Atr >= 0.16 && closePos1 >= 0.56
    const impulseCandleDown = close < open && body1Atr >= 0.16 && closePos1 <= 0.44
    const prev1 = candles[i - 1]!.close
    const prev2 = candles[i - 2]!.close
    const impulseSequenceUp = close > prev1 && prev1 >= prev2
    const impulseSequenceDown = close < prev1 && prev1 <= prev2
    const impulseVolumeUp = volRatio1 >= 0.9 && close > open
    const impulseVolumeDown = volRatio1 >= 0.9 && close < open

    let evidenceUp = 0
    let evidenceDown = 0
    if (score1 >= 12) evidenceUp++
    if (score1 <= -12) evidenceDown++
    if (score5Live >= 10) evidenceUp++
    if (score5Live <= -10) evidenceDown++
    if (gt(close, ema9) && ge(ema9, ema20)) evidenceUp++
    if (lt(close, ema9) && le(ema9, ema20)) evidenceDown++
    if (impulseCandleUp || impulseSequenceUp) evidenceUp++
    if (impulseCandleDown || impulseSequenceDown) evidenceDown++
    if (impulseVolumeUp) evidenceUp++
    if (impulseVolumeDown) evidenceDown++
    if (targetChange >= 4) evidenceUp++
    if (targetChange <= -4) evidenceDown++
    if (breakResistance || breakMax15 || breakMax1H) evidenceUp++
    if (breakSupport || breakMin15 || breakMin1H) evidenceDown++
    if (scoreMap >= 12) evidenceUp++
    if (scoreMap <= -12) evidenceDown++

    const extremeUp = blockMoveAtr >= s.scalpExtremeExtensionAtr
    const extremeDown = blockMoveAtr <= -s.scalpExtremeExtensionAtr
    const lastStretch = s.scalpNoTradeLastSec > 0 && secondsLeft <= s.scalpNoTradeLastSec

    const scalpUp =
      validTarget &&
      scoreScalp >= s.scalpThreshold &&
      evidenceUp >= s.scalpEvidenceMin &&
      !strongDrop &&
      !extremeUp &&
      !lastStretch
    const scalpDown =
      validTarget &&
      scoreScalp <= -s.scalpThreshold &&
      evidenceDown >= s.scalpEvidenceMin &&
      !strongRise &&
      !extremeDown &&
      !lastStretch
    const preAlertUp =
      validTarget &&
      scoreScalp >= s.preAlertThreshold &&
      evidenceUp >= 2 &&
      !strongDrop &&
      !extremeUp &&
      !lastStretch
    const preAlertDown =
      validTarget &&
      scoreScalp <= -s.preAlertThreshold &&
      evidenceDown >= 2 &&
      !strongRise &&
      !extremeDown &&
      !lastStretch

    // TARGET confirmation (strict): a bigger percentage alone is not enough.
    const baseUp = validTarget && meterUp >= s.minEdgePct
    const baseDown = validTarget && meterDown >= s.minEdgePct
    const contextUp =
      score15 >= -15 && score5Live >= 18 && score1 >= 18 && scoreFast >= s.momentumMin
    const contextDown =
      score15 <= 15 && score5Live <= -18 && score1 <= -18 && scoreFast <= -s.momentumMin
    const timingUp = gt(close, ema9) && ge(ema9, ema20)
    const timingDown = lt(close, ema9) && le(ema9, ema20)
    const volatilityAcceptable = volatilityOk || progress >= 0.7
    const generalBlock = conflictTargetMarket || conflict15v5 || nearTargetLate
    const confirmRawUp =
      baseUp &&
      contextUp &&
      timingUp &&
      volatilityAcceptable &&
      !strongDrop &&
      !generalBlock &&
      !riskUpResistance &&
      !against1HUp &&
      !extendedUp
    const confirmRawDown =
      baseDown &&
      contextDown &&
      timingDown &&
      volatilityAcceptable &&
      !strongRise &&
      !generalBlock &&
      !riskDownSupport &&
      !against1HDown &&
      !extendedDown
    if (confirmed) {
      streakUp = confirmRawUp ? streakUp + 1 : 0
      streakDown = confirmRawDown ? streakDown + 1 : 0
    }
    const confirmedUp = confirmRawUp && streakUp >= s.confirmBars
    const confirmedDown = confirmRawDown && streakDown >= s.confirmBars

    // Stages and discipline.
    const alignedUp = score1 >= 14 && score5Live >= 10 && ge(close, ema9)
    const alignedDown = score1 <= -14 && score5Live <= -10 && le(close, ema9)
    const chargedUp =
      preAlertUp &&
      scoreScalp >= s.chargedThreshold &&
      evidenceUp >= s.chargedEvidenceMin &&
      alignedUp
    const chargedDown =
      preAlertDown &&
      scoreScalp <= -s.chargedThreshold &&
      evidenceDown >= s.chargedEvidenceMin &&
      alignedDown

    const lateTime = secondsLeft <= s.sitOutLastSec
    const lateUp =
      extremeUp ||
      lateTime ||
      (blockMoveAtr >= s.lateBlockAtr && strength >= 60) ||
      (ratioTarget >= s.lateTargetRatio && progress >= 0.45)
    const lateDown =
      extremeDown ||
      lateTime ||
      (blockMoveAtr <= -s.lateBlockAtr && strength >= 60) ||
      (ratioTarget <= -s.lateTargetRatio && progress >= 0.45)

    const enterUp = scalpUp && chargedUp && strength >= s.enterStrengthMin && !lateUp
    const enterDown = scalpDown && chargedDown && strength >= s.enterStrengthMin && !lateDown

    const seriousConflict = (conflict15v5 || conflictTargetMarket) && strength < 72
    const choppy =
      Math.abs(scoreScalp) < s.preAlertThreshold &&
      Math.abs(score1) < 28 &&
      Math.abs(score5Live) < 28
    const sitOut =
      validTarget &&
      (lateTime ||
        (seriousConflict && !strongRise && !strongDrop) ||
        (!volatilityOk && progress < 0.55 && choppy))

    // Memory of the block's last trigger, so PROTECT has something to protect.
    if (enterUp) lastTrigger = 1
    else if (enterDown) lastTrigger = -1

    const protectUp =
      lastTrigger === 1 &&
      !enterDown &&
      ((lateUp && strength >= 62) || scoreScalp < s.preAlertThreshold || strongDrop)
    const protectDown =
      lastTrigger === -1 &&
      !enterUp &&
      ((lateDown && strength >= 62) || scoreScalp > -s.preAlertThreshold || strongRise)

    const keepUp =
      confirmedUp && scoreMap >= -35 && !strongDrop && scoreScalp >= -s.preAlertThreshold
    const keepDown =
      confirmedDown && scoreMap <= 35 && !strongRise && scoreScalp <= s.preAlertThreshold

    let decision: RandyDecision
    let mode = 'NO ENTRY'
    let reason = 'NOT ALIGNED'
    if (!validTarget) {
      decision = 'review-target'
      reason = 'TARGET INVALID OR EMPTY'
    } else if (protectUp) {
      decision = 'protect-up'
      mode = 'IF YOU ENTERED'
      reason = strongDrop
        ? 'STRONG TURN AGAINST UP'
        : lateUp
          ? 'MOVE ALREADY EXTENDED'
          : 'UP IMPULSE LOSING STRENGTH'
    } else if (protectDown) {
      decision = 'protect-down'
      mode = 'IF YOU ENTERED'
      reason = strongRise
        ? 'STRONG TURN AGAINST DOWN'
        : lateDown
          ? 'MOVE ALREADY EXTENDED'
          : 'DOWN IMPULSE LOSING STRENGTH'
    } else if (lateUp && scoreScalp >= s.preAlertThreshold) {
      decision = 'no-chase-up'
      mode = 'ARRIVED LATE'
      reason = 'UP MAY CONTINUE, BUT THE RUN IS SPENT'
    } else if (lateDown && scoreScalp <= -s.preAlertThreshold) {
      decision = 'no-chase-down'
      mode = 'ARRIVED LATE'
      reason = 'DOWN MAY CONTINUE, BUT THE RUN IS SPENT'
    } else if (enterUp) {
      decision = 'enter-up'
      mode = keepUp ? 'TARGET + IMPULSE' : 'IMPULSE'
      reason = '1M + 5M ALIGNED | ROOM TO RUN'
    } else if (enterDown) {
      decision = 'enter-down'
      mode = keepDown ? 'TARGET + IMPULSE' : 'IMPULSE'
      reason = '1M + 5M ALIGNED | ROOM TO RUN'
    } else if (chargedUp) {
      decision = 'charged-up'
      mode = 'ALMOST READY'
      reason = strength < s.enterStrengthMin ? 'NEEDS STRENGTH' : 'WAITING FOR FINAL TRIGGER'
    } else if (chargedDown) {
      decision = 'charged-down'
      mode = 'ALMOST READY'
      reason = strength < s.enterStrengthMin ? 'NEEDS STRENGTH' : 'WAITING FOR FINAL TRIGGER'
    } else if (preAlertUp) {
      decision = 'charging-up'
      mode = 'FORMING'
      reason = 'EARLY BIAS | DON’T ENTER YET'
    } else if (preAlertDown) {
      decision = 'charging-down'
      mode = 'FORMING'
      reason = 'EARLY BIAS | DON’T ENTER YET'
    } else if (strongRise && scoreScalp > 0) {
      decision = 'impulse-up'
      mode = 'WATCH'
      reason = 'FAST MOVE; WAIT FOR CONFIRMATION'
    } else if (strongDrop && scoreScalp < 0) {
      decision = 'impulse-down'
      mode = 'WATCH'
      reason = 'FAST MOVE; WAIT FOR CONFIRMATION'
    } else if (sitOut) {
      decision = 'sit-out'
      mode = "DON'T TOUCH"
      reason = lateTime
        ? 'TOO LITTLE TIME'
        : seriousConflict
          ? 'REAL CONFLICT BETWEEN TIMEFRAMES'
          : 'SLOW / CHOPPY MARKET'
    } else {
      decision = 'wait'
      mode =
        dirUp > dirDown
          ? `BIAS UP ${dirUp}%`
          : dirDown > dirUp
            ? `BIAS DOWN ${dirDown}%`
            : '50 / 50'
      reason = 'NO CLEAN TRIGGER YET'
    }
    const entry: -1 | 0 | 1 = decision === 'enter-up' ? 1 : decision === 'enter-down' ? -1 : 0

    let stageText = 'NO CLEAR EDGE'
    let stageTone: RandyTone = 'neutral'
    if (!validTarget) stageText = 'REVIEW TARGET'
    else if (protectUp || protectDown) {
      stageText = 'PROTECT PROFIT IF YOU ENTERED'
      stageTone = 'protect'
    } else if (lateUp && scoreScalp >= s.preAlertThreshold) {
      stageText = 'UP EXTENDED'
      stageTone = 'warn'
    } else if (lateDown && scoreScalp <= -s.preAlertThreshold) {
      stageText = 'DOWN EXTENDED'
      stageTone = 'warn'
    } else if (enterUp) {
      stageText = 'UP CONFIRMED NOW'
      stageTone = 'up'
    } else if (enterDown) {
      stageText = 'DOWN CONFIRMED NOW'
      stageTone = 'down'
    } else if (chargedUp) {
      stageText = 'UP CHARGED'
      stageTone = 'warn'
    } else if (chargedDown) {
      stageText = 'DOWN CHARGED'
      stageTone = 'warn'
    } else if (preAlertUp) {
      stageText = 'UP CHARGING'
      stageTone = 'warn'
    } else if (preAlertDown) {
      stageText = 'DOWN CHARGING'
      stageTone = 'warn'
    } else if (sitOut) stageText = 'NO TRADABLE EDGE'

    if (confirmed && entry !== 0 && previousEntry !== entry)
      entries.push({ index: i, time: c.time, side: entry === 1 ? 'up' : 'down' })
    previousEntry = entry

    bars.push({
      index: i,
      time: c.time,
      ready: true,
      confirmed,
      targetEntered: s.target > 0,
      targetValid: validTarget,
      distance,
      secondsLeft,
      scalpScore: scoreScalp,
      dirUpPct: dirUp,
      dirDownPct: dirDown,
      meterUpPct: meterUp,
      meterDownPct: meterDown,
      strength,
      aligned: alignedUp ? 'up' : alignedDown ? 'down' : 'none',
      evidenceUp,
      evidenceDown,
      decision,
      entry,
      decisionText: DECISION_TEXT[decision],
      modeText: mode,
      reasonText: reason,
      stageText,
      mapText,
      decisionTone: DECISION_TONE[decision],
      stageTone,
      mapTone,
      scores: {
        micro1: score1,
        live5: score5Live,
        closed5: score5c,
        m15: score15,
        h1: score1H,
        map: scoreMap,
        market: scoreMarket,
        targetEdge,
      },
      flags: { strongDrop, strongRise, lateUp, lateDown, sitOut, volatilityOk },
    })
  }

  return {
    bars,
    last: bars[n - 1] ?? null,
    missingFeeds: [],
    ema9: ema9Line,
    ema20: ema20Line,
    target: targetLine,
    resistance5: res5Line,
    support5: sup5Line,
    max15: max15Line,
    min15: min15Line,
    max1h: max1hLine,
    min1h: min1hLine,
    entries,
  }
}

// ----------------------------------------------------------------------------------------------
// Chart plots
// ----------------------------------------------------------------------------------------------

/**
 * The price-pane lines the Pine script plots (EMA 9/20 on a 1M chart, the TARGET, the 5M S/R and
 * the 15M/1H map), plus a dot under or over every confirmed ENTER.
 */
export function randyV8Plots(
  result: RandyV8Result,
  settings: RandyV8Settings,
  candles: Candle[],
  timeframe: Timeframe,
): Plot[] {
  const gated = (values: Values, visible: boolean): Values =>
    visible ? values : values.map(() => null)
  const lineFor = (
    title: string,
    values: Values,
    color: string,
    visible: boolean,
    lineWidth = 1,
    hideLegend = false,
  ): Plot => ({
    title,
    values: gated(values, visible),
    color,
    pane: 'price',
    lineWidth,
    style: 'line',
    hideLegend,
  })
  const on1m = timeframe === '1m'
  const entryValues = (side: 'up' | 'down'): Values => {
    const out: Values = candles.map(() => null)
    if (!settings.showMarkers) return out
    for (const entry of result.entries) {
      if (entry.side !== side) continue
      const candle = candles[entry.index]
      if (!candle) continue
      const atr = candle.high - candle.low
      out[entry.index] = side === 'up' ? candle.low - atr * 0.6 : candle.high + atr * 0.6
    }
    return out
  }
  return [
    lineFor('EMA 9', result.ema9, RANDY_V8_COLORS.ema9, settings.showEmas && on1m, 2),
    lineFor('EMA 20', result.ema20, RANDY_V8_COLORS.ema20, settings.showEmas && on1m, 2),
    lineFor('TARGET KALSHI', result.target, RANDY_V8_COLORS.target, settings.showTarget, 3),
    lineFor(
      'Resistance 5M',
      result.resistance5,
      RANDY_V8_COLORS.resistance,
      settings.showLevels,
      1,
      true,
    ),
    lineFor('Support 5M', result.support5, RANDY_V8_COLORS.support, settings.showLevels, 1, true),
    lineFor('Map MAX 15M', result.max15, RANDY_V8_COLORS.map15, settings.showLevels, 1, true),
    lineFor('Map MIN 15M', result.min15, RANDY_V8_COLORS.map15, settings.showLevels, 1, true),
    lineFor('Map MAX 1H', result.max1h, RANDY_V8_COLORS.map1h, settings.showLevels, 1, true),
    lineFor('Map MIN 1H', result.min1h, RANDY_V8_COLORS.map1h, settings.showLevels, 1, true),
    {
      title: 'ENTER UP',
      values: entryValues('up'),
      color: RANDY_V8_COLORS.up,
      pane: 'price',
      lineWidth: 4,
      style: 'circles',
      hideLegend: true,
    },
    {
      title: 'ENTER DOWN',
      values: entryValues('down'),
      color: RANDY_V8_COLORS.down,
      pane: 'price',
      lineWidth: 4,
      style: 'circles',
      hideLegend: true,
    },
  ]
}

/** The scorers and frame builders, exposed so the tests can prove the forming-bar recursion. */
export const randyV8Internals = {
  buildPack,
  closedFrame,
  formingFrame,
  contextScore,
  microScore,
}
