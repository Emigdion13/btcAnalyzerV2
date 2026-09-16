/**
 * Candle Pulse — live analysis of the single bar currently being built.
 *
 * The rest of the app reads price action on CLOSED bars. This module answers the question a
 * trader actually has while a bar is still forming: where is this bar right now relative to the
 * defensible levels around it, how hard is it being traded, and what does local history say
 * happens in situations like this one?
 *
 * What it reports
 * - `clock`   where inside the bar we are, and how long until it closes
 * - `shape`   O/H/L/C, body/wick geometry, close position inside the range
 * - `pace`    volume so far vs. what this much of a typical bar has normally traded
 * - `levels`  the nearest support/resistance zones, each scored 0..100 on confluence (confirmed
 *             fractal pivots, the prior UTC day, and the resting order book) — plus, for the
 *             best zone on each side, how often price historically held at it
 * - `tape`    the taker buy/sell split executed inside this bar (when the feed reports it)
 * - `tilt`    a small composite of the above in [-100, 100], labelled UP-LEAN / DOWN-LEAN /
 *             NO EDGE. It is CONTEXT, not a forecast: it says which way the evidence currently
 *             points, never what the close will be.
 * - `baseRate` how often recent bars closed up, and where they typically end inside their range
 *
 * Everything is deterministic OHLCV + book arithmetic over the loaded window. Two honesty
 * notes, mirrored in the UI: the forming bar is provisional (the stream reconciles it against
 * REST), and the level "held X/Y" counts use today's zone price against past bars — a deliberate
 * approximation, because recomputing point-in-time levels for every historical bar is noise
 * for a read that is context, not a signal.
 */
import { INTERVAL_SECONDS } from '../../shared/coinbase'
import type { BarTape, OrderBookView } from '../../shared/coinbase'
import type { Candle, Timeframe } from './types'

/** Fractal half-width: a pivot needs this many bars on each side to be confirmed. */
export const PIVOT_K = 3
/** How many closed bars are scanned for fractal pivots. */
export const SWING_LOOKBACK = 120
/** Bars used to define the "typical bar" volume. */
export const PACE_LOOKBACK = 96
/** Bars used for the close-up / close-position base rate. */
export const BASE_RATE_LOOKBACK = 96
/** Bars examined when counting how often a level held. */
export const HOLD_LOOKBACK = 60
/** Cluster width for merging nearby level candidates, in ATR. */
export const ZONE_ATR_TOLERANCE = 0.08
/** Levels farther than this, in ATR, are not treated as "in play". */
export const LEVEL_ATR_HORIZON = 4
/** Fewer than this many bars: not enough history to be honest. */
export const MIN_CANDLES = 24

export type LevelSource = 'swing' | 'prior-day' | 'book'
export type LevelSide = 'support' | 'resistance'
export type Lean = 'up' | 'down' | 'flat'

export interface BarClock {
  /** UTC bucket start of the forming bar. */
  start: number
  /** Unix seconds when the bar closes. */
  end: number
  /** 0..1 share of the bar elapsed. */
  progress: number
  secondsLeft: number
  /** `mm:ss` countdown for display. */
  clockLabel: string
}

export interface BarShape {
  open: number
  high: number
  low: number
  close: number
  range: number
  body: number
  upperWick: number
  lowerWick: number
  /** (close − low) / range; 0.5 when the bar is flat. */
  closePosition: number
  /** body / range. */
  bodyRatio: number
  lean: Lean
}

export interface VolumePace {
  /** Volume printed so far inside the forming bar. */
  soFar: number
  /** Median volume of recent completed bars. */
  medianBar: number
  /** What this share of a median bar has normally traded. */
  expectedSoFar: number
  /** soFar / expectedSoFar; null while the bar is too young to judge. */
  paceRatio: number | null
  /** soFar / progress — where the bar is heading if the current pace holds. */
  projectedTotal: number | null
  /** projectedTotal / medianBar − 1; the % above (or below) a typical bar. */
  projectedVsMedian: number | null
}

export interface LevelZone {
  side: LevelSide
  price: number
  /** Distance from price, in basis points. */
  distanceBps: number
  /** Distance from price, in ATR units. */
  distanceAtr: number
  /** 0..100 conviction: confluence, touches, book backing, proximity. */
  score: number
  sources: LevelSource[]
  /** Confirmed pivots / prior-day extremes inside the zone. */
  touches: number
  /** USD of resting book inside the zone. */
  bookUsd: number
  /** Of recent approaches, how many closed on the right side; null when too few to count. */
  holdStats: { approaches: number; held: number } | null
}

export type TiltFactorId = 'levels' | 'tape' | 'momentum' | 'position'

export interface TiltFactor {
  id: TiltFactorId
  label: string
  /** Signed contribution to the tilt score. */
  value: number
  /** Full scale of the factor. */
  weight: number
}

export interface Tilt {
  /** -100..100; positive leans up. */
  score: number
  label: 'UP-LEAN' | 'DOWN-LEAN' | 'NO EDGE'
  strength: 'strong' | 'mild' | 'none'
  factors: TiltFactor[]
}

export interface BarPulseRead {
  /** False while the loaded window is too short to compute honestly. */
  ready: boolean
  /** Human reason when not ready. */
  reason?: string
  clock: BarClock
  shape: BarShape
  pace: VolumePace
  levels: { support: LevelZone[]; resistance: LevelZone[] }
  tilt: Tilt
  baseRate: { bars: number; upShare: number; medianClosePosition: number } | null
  /** ATR(14) over closed bars; the unit every distance in this read is measured in. */
  atr: number
}

export interface BarPulseInput {
  /** Chart candles, oldest first; the LAST one is the bar still forming. */
  candles: Candle[]
  interval: Timeframe
  /** Unix seconds (client clock). */
  now: number
  /** Latest traded price. */
  price: number
  book?: OrderBookView | null
  tape?: BarTape | null
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))
const clamp01 = (value: number): number => clamp(value, 0, 1)

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function notReady(reason: string, price: number): BarPulseRead {
  const safe = Number.isFinite(price) && price > 0 ? price : 0
  return {
    ready: false,
    reason,
    atr: 0,
    clock: { start: 0, end: 0, progress: 0, secondsLeft: 0, clockLabel: '—' },
    shape: {
      open: safe,
      high: safe,
      low: safe,
      close: safe,
      range: 0,
      body: 0,
      upperWick: 0,
      lowerWick: 0,
      closePosition: 0.5,
      bodyRatio: 0,
      lean: 'flat',
    },
    pace: {
      soFar: 0,
      medianBar: 0,
      expectedSoFar: 0,
      paceRatio: null,
      projectedTotal: null,
      projectedVsMedian: null,
    },
    levels: { support: [], resistance: [] },
    tilt: { score: 0, label: 'NO EDGE', strength: 'none', factors: [] },
    baseRate: null,
  }
}

function barClock(forming: Candle, interval: Timeframe, now: number): BarClock {
  const seconds = INTERVAL_SECONDS[interval]
  const start = forming.time
  const end = start + seconds
  const progress = clamp01((now - start) / seconds)
  const secondsLeft = Math.max(0, end - now)
  const d = Math.floor(secondsLeft / 86400)
  const h = Math.floor((secondsLeft % 86400) / 3600)
  const m = Math.floor((secondsLeft % 3600) / 60)
  const s = Math.floor(secondsLeft % 60)
  const clockLabel =
    secondsLeft >= 86400
      ? `${d}d ${h}h`
      : secondsLeft >= 3600
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return {
    start,
    end,
    progress,
    secondsLeft,
    clockLabel,
  }
}

function barShape(bar: Candle): BarShape {
  const range = bar.high - bar.low
  const body = Math.abs(bar.close - bar.open)
  const closePosition = range > 0 ? clamp01((bar.close - bar.low) / range) : 0.5
  const bodyRatio = range > 0 ? clamp01(body / range) : 0
  return {
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    range,
    body,
    upperWick: bar.high - Math.max(bar.open, bar.close),
    lowerWick: Math.min(bar.open, bar.close) - bar.low,
    closePosition,
    bodyRatio,
    lean: bar.close > bar.open ? 'up' : bar.close < bar.open ? 'down' : 'flat',
  }
}

/** Simple average true range over the most recent closed bars (the read's distance unit). */
function atr(closed: Candle[], period = 14): number {
  if (closed.length < 2) return 0
  const slice = closed.slice(-(period + 1))
  const trs: number[] = []
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i]
    const p = slice[i - 1]
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)))
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length
}

function volumePace(forming: Candle, closed: Candle[], progress: number): VolumePace {
  const medianBar = median(closed.slice(-PACE_LOOKBACK).map((c) => c.volume))
  const expectedSoFar = medianBar * progress
  const soFar = forming.volume
  const paceRatio =
    progress >= 0.05 && expectedSoFar > 0 ? soFar / expectedSoFar : null
  const projectedTotal = progress >= 0.05 ? soFar / progress : null
  const projectedVsMedian =
    projectedTotal !== null && medianBar > 0 ? projectedTotal / medianBar - 1 : null
  return { soFar, medianBar, expectedSoFar, paceRatio, projectedTotal, projectedVsMedian }
}

interface LevelCandidate {
  price: number
  source: LevelSource
  bookUsd: number
}

/** Confirmed fractal pivots over the recent closed bars (a pivot is only real after k bars). */
function swingPivots(closed: Candle[]): LevelCandidate[] {
  const out: LevelCandidate[] = []
  const scanStart = Math.max(PIVOT_K, closed.length - SWING_LOOKBACK - PIVOT_K)
  for (let i = PIVOT_K; i < closed.length - PIVOT_K; i++) {
    if (i < scanStart) continue
    const c = closed[i]
    let isHigh = true
    let isLow = true
    for (let j = 1; j <= PIVOT_K && (isHigh || isLow); j++) {
      if (closed[i - j].high >= c.high || closed[i + j].high >= c.high) isHigh = false
      if (closed[i - j].low <= c.low || closed[i + j].low <= c.low) isLow = false
    }
    if (isHigh) out.push({ price: c.high, source: 'swing', bookUsd: 0 })
    if (isLow) out.push({ price: c.low, source: 'swing', bookUsd: 0 })
  }
  return out
}

/** High/low of the most recent COMPLETED UTC day in the window. */
function priorDay(closed: Candle[], now: number): LevelCandidate[] {
  const today = Math.floor(now / 86400)
  const days = new Set(closed.map((c) => Math.floor(c.time / 86400)))
  for (let d = today - 1; d > today - 3; d--) {
    if (!days.has(d)) continue
    const bars = closed.filter((c) => Math.floor(c.time / 86400) === d)
    return [
      { price: Math.max(...bars.map((b) => b.high)), source: 'prior-day', bookUsd: 0 },
      { price: Math.min(...bars.map((b) => b.low)), source: 'prior-day', bookUsd: 0 },
    ]
  }
  return []
}

function bookWalls(book: OrderBookView | null, price: number): LevelCandidate[] {
  if (!book) return []
  const out: LevelCandidate[] = []
  for (const wall of book.supports)
    if (wall.price < price) out.push({ price: wall.price, source: 'book', bookUsd: wall.notional })
  for (const wall of book.resistances)
    if (wall.price > price) out.push({ price: wall.price, source: 'book', bookUsd: wall.notional })
  return out
}

interface Cluster {
  sum: number
  count: number
  sources: Set<LevelSource>
  touches: number
  bookUsd: number
}

/** Merge nearby candidates into zones and score each one 0..100. */
function levelZones(
  candidates: LevelCandidate[],
  price: number,
  atrValue: number,
  medianBarUsd: number,
): LevelZone[] {
  if (!candidates.length || atrValue <= 0 || !(price > 0)) return []
  const tol = ZONE_ATR_TOLERANCE * atrValue
  const sorted = [...candidates].sort((a, b) => a.price - b.price)
  const clusters: Cluster[] = []
  for (const cand of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && Math.abs(cand.price - last.sum / last.count) <= tol) {
      last.sum += cand.price
      last.count += 1
      last.sources.add(cand.source)
      if (cand.source !== 'book') last.touches += 1
      last.bookUsd += cand.bookUsd
    } else {
      clusters.push({
        sum: cand.price,
        count: 1,
        sources: new Set<LevelSource>([cand.source]),
        touches: cand.source !== 'book' ? 1 : 0,
        bookUsd: cand.bookUsd,
      })
    }
  }
  return clusters.map((cluster) => {
    const avg = cluster.sum / cluster.count
    const side: LevelSide = avg < price ? 'support' : 'resistance'
    const distance = Math.abs(price - avg)
    const distanceAtr = distance / atrValue
    const proximity = Math.max(0, 1 - distanceAtr / LEVEL_ATR_HORIZON)
    const score = Math.round(
      clamp(
        // Confluence: more independent sources agreeing on one price = more defensible.
        Math.min(40, 20 * (cluster.sources.size - 1)) +
          // Repeated visits: a level price has come back to before.
          Math.min(20, 8 * Math.max(0, cluster.touches - 1)) +
          // Book backing: resting USD at the zone vs. half a typical bar's notional.
          (cluster.bookUsd > 0
            ? Math.min(25, 25 * Math.min(1, cluster.bookUsd / Math.max(1, 0.5 * medianBarUsd)))
            : 0) +
          // Proximity: levels in play matter more than ones four ATR away.
          15 * proximity,
        0,
        100,
      ),
    )
    return {
      side,
      price: avg,
      distanceBps: (distance / price) * 10000,
      distanceAtr,
      score,
      sources: [...cluster.sources],
      touches: cluster.touches,
      bookUsd: cluster.bookUsd,
      holdStats: null as { approaches: number; held: number } | null,
    }
  })
}

/**
 * Of the recent bars that traded INTO this zone from the right side, how many closed back out
 * of it? "Held" means the close stayed on the far side of the level (above it for support,
 * below it for resistance).
 */
function holdStats(zone: LevelZone, closed: Candle[], atrValue: number) {
  if (!closed.length) return null
  const tol = ZONE_ATR_TOLERANCE * atrValue
  let approaches = 0
  let held = 0
  for (const bar of closed.slice(-HOLD_LOOKBACK)) {
    const approached =
      zone.side === 'support'
        ? bar.low <= zone.price + tol && bar.open >= zone.price - tol
        : bar.high >= zone.price - tol && bar.open <= zone.price + tol
    if (!approached) continue
    approaches += 1
    if (zone.side === 'support' ? bar.close > zone.price : bar.close < zone.price) held += 1
  }
  return approaches >= 2 ? { approaches, held } : null
}

function computeTilt(
  shape: BarShape,
  pace: VolumePace,
  tape: BarTape | null,
  bestSupport: LevelZone | undefined,
  bestResistance: LevelZone | undefined,
): Tilt {
  const factors: TiltFactor[] = []
  // 1. Level pressure: the net "cushion" — strong support close below pushes up, strong
  //    resistance close above pushes down, and a weak/distant level contributes almost
  //    nothing. Each push is (score/100) × proximity, so the factor tops out at ±35 only
  //    when one side is fully defended and the other has nothing at all.
  if (bestSupport || bestResistance) {
    const push = (zone: LevelZone | undefined) =>
      zone
        ? (zone.score / 100) * Math.max(0, 1 - zone.distanceAtr / LEVEL_ATR_HORIZON)
        : 0
    factors.push({
      id: 'levels',
      label: 'Level pressure',
      value: (push(bestSupport) - push(bestResistance)) * 35,
      weight: 35,
    })
  }
  // 2. Bar tape: the taker buy/sell split executed inside this bar, when the feed reports it.
  if (tape && tape.bought + tape.sold > 0) {
    const total = tape.bought + tape.sold
    factors.push({
      id: 'tape',
      label: 'Bar tape',
      value: ((tape.bought - tape.sold) / total) * 25,
      weight: 25,
    })
  }
  // 3. Bar momentum: direction scaled by how decisive the bar is (body), how far through its
  //    range it has travelled, and whether volume is backing it.
  const sign = shape.lean === 'up' ? 1 : shape.lean === 'down' ? -1 : 0
  if (sign !== 0) {
    const paceFactor = pace.paceRatio === null ? 0.6 : clamp(pace.paceRatio, 0, 1.5) / 1.5
    factors.push({
      id: 'momentum',
      label: 'Bar momentum',
      value: sign * (0.5 * shape.bodyRatio + 0.3 * shape.closePosition + 0.2 * paceFactor) * 25,
      weight: 25,
    })
  }
  // 4. Range position: a bar trading near the top of its own range is being bid into close.
  factors.push({
    id: 'position',
    label: 'Range position',
    value: (shape.closePosition - 0.5) * 2 * 15,
    weight: 15,
  })
  const score = Math.round(clamp(factors.reduce((a, f) => a + f.value, 0), -100, 100))
  return {
    score,
    label: score >= 12 ? 'UP-LEAN' : score <= -12 ? 'DOWN-LEAN' : 'NO EDGE',
    strength: Math.abs(score) >= 30 ? 'strong' : Math.abs(score) >= 12 ? 'mild' : 'none',
    factors,
  }
}

function baseRate(closed: Candle[]) {
  const bars = closed.slice(-BASE_RATE_LOOKBACK)
  if (bars.length < 20) return null
  const ups = bars.filter((b) => b.close > b.open).length
  const positions = bars.map((b) => {
    const r = b.high - b.low
    return r > 0 ? clamp01((b.close - b.low) / r) : 0.5
  })
  return { bars: bars.length, upShare: ups / bars.length, medianClosePosition: median(positions) }
}

/** Analyze the forming bar. Pure and deterministic; see the module doc for what each field means. */
export function analyzeBarPulse(input: BarPulseInput): BarPulseRead {
  const { candles, interval, now, price } = input
  if (candles.length < MIN_CANDLES || !(Number.isFinite(price) && price > 0)) {
    return notReady('Warming up — not enough closed bars yet.', price)
  }
  const closed = candles.slice(0, -1)
  const forming = candles[candles.length - 1]
  const atrValue = atr(closed)
  if (!(atrValue > 0)) return notReady('Warming up — range data is not usable yet.', price)

  const clock = barClock(forming, interval, now)
  const shape = barShape(forming)
  const pace = volumePace(forming, closed, clock.progress)

  const candidates = [
    ...swingPivots(closed),
    ...priorDay(closed, now),
    ...bookWalls(input.book ?? null, price),
  ]
  const medianBarUsd = median(closed.slice(-PACE_LOOKBACK).map((c) => c.volume)) * price
  const zones = levelZones(candidates, price, atrValue, medianBarUsd)
  const byScore = (a: LevelZone, b: LevelZone) =>
    b.score - a.score || a.distanceAtr - b.distanceAtr
  const support = zones.filter((z) => z.side === 'support').sort(byScore).slice(0, 3)
  const resistance = zones.filter((z) => z.side === 'resistance').sort(byScore).slice(0, 3)
  const bestSupport = support[0]
  const bestResistance = resistance[0]
  if (bestSupport) bestSupport.holdStats = holdStats(bestSupport, closed, atrValue)
  if (bestResistance) bestResistance.holdStats = holdStats(bestResistance, closed, atrValue)

  return {
    ready: true,
    atr: atrValue,
    clock,
    shape,
    pace,
    levels: { support, resistance },
    tilt: computeTilt(shape, pace, input.tape ?? null, bestSupport, bestResistance),
    baseRate: baseRate(closed),
  }
}
