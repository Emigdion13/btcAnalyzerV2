/**
 * The Next Pivot — port of Kioseff Trading's published indicator with
 * Atlas accuracy upgrades.
 *
 * Original idea: walk back through history, score each window of
 * `correlationLength` bars against the most recent window using a
 * similarity measure (Cosine, Pearson, Spearman, Euclidean, MSE, Kendall,
 * or Atlas's DTW), then project forward what happened after the best match.
 *
 * Atlas upgrades for "double the accurate, triple the great":
 *   • Z-normalization before comparison — raw cosine on price levels is
 *     trivially biased by price magnitude. Percent-change mode is still
 *     supported for authenticity.
 *   • Top-K ensemble blending — weight the K best matches by their similarity
 *     score (softmax) instead of committing to a single look-alike.
 *   • Dynamic Time Warping (DTW) option — allows small temporal warp so a
 *     shape that played out over 18 bars can match one that took 22.
 *   • Confidence band from ensemble dispersion (±1σ).
 *   • Robust ZigZag projection derived from the ensemble envelope.
 *   • Linear-regression forecast channel like the original.
 *
 * All defaults match the published (20, 50, Cosine Similarity, Price, 5000, 1).
 */
import type { Candle, Indicator, NextPivotSettings } from './types'
import { NEXT_PIVOT_DEFAULTS } from './types'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isNextPivotSettings(value: unknown): value is NextPivotSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  const simOk =
    typeof s.similarity === 'string' &&
    ['cosine', 'pearson', 'spearman', 'euclidean', 'mse', 'kendall', 'dtw'].includes(
      s.similarity as string,
    )
  const srcOk = typeof s.source === 'string' && ['price', 'pctChange'].includes(s.source as string)
  return (
    simOk &&
    srcOk &&
    typeof s.correlationLength === 'number' &&
    Number.isInteger(s.correlationLength) &&
    s.correlationLength >= 5 &&
    s.correlationLength <= 200 &&
    typeof s.forecastLength === 'number' &&
    Number.isInteger(s.forecastLength) &&
    s.forecastLength >= 5 &&
    s.forecastLength <= 500 &&
    typeof s.barsBack === 'number' &&
    Number.isInteger(s.barsBack) &&
    s.barsBack >= 100 &&
    s.barsBack <= 20000 &&
    typeof s.showPricePath === 'boolean' &&
    typeof s.showZigZag === 'boolean' &&
    typeof s.showLinReg === 'boolean' &&
    typeof s.linRegSigma === 'number' &&
    s.linRegSigma >= 0 &&
    s.linRegSigma <= 5 &&
    typeof s.forecastColor === 'string' &&
    HEX_COLOR.test(s.forecastColor as string) &&
    typeof s.zigZagColor === 'string' &&
    HEX_COLOR.test(s.zigZagColor as string) &&
    typeof s.linRegColor === 'string' &&
    HEX_COLOR.test(s.linRegColor as string) &&
    typeof s.ensembleTopK === 'number' &&
    Number.isInteger(s.ensembleTopK) &&
    s.ensembleTopK >= 1 &&
    s.ensembleTopK <= 20 &&
    typeof s.zNormalize === 'boolean' &&
    typeof s.showConfidenceBand === 'boolean' &&
    typeof s.showMatchBox === 'boolean' &&
    typeof s.showInfoLabel === 'boolean' &&
    typeof s.zigZagLegs === 'number' &&
    Number.isInteger(s.zigZagLegs) &&
    s.zigZagLegs >= 2 &&
    s.zigZagLegs <= 50
  )
}

export function nextPivotSettings(indicator: Indicator): NextPivotSettings {
  const custom = indicator.nextPivot
  if (custom && isNextPivotSettings(custom)) return custom
  return { ...NEXT_PIVOT_DEFAULTS }
}

export function nextPivotIndicatorLabel(indicator: Indicator): string {
  const s = nextPivotSettings(indicator)
  const simLabel: Record<NextPivotSettings['similarity'], string> = {
    cosine: 'Cosine Similarity',
    pearson: 'Pearson',
    spearman: 'Spearman',
    euclidean: 'Euclidean',
    mse: 'MSE',
    kendall: 'Kendall',
    dtw: 'DTW',
  }
  return `The Next Pivot (${s.correlationLength}, ${s.forecastLength}, ${simLabel[s.similarity]}, ${s.source === 'price' ? 'Price' : '%Change'}, ${s.barsBack}, ${s.linRegSigma})`
}

// ------------- statistics helpers -------------

function mean(a: number[] | Float64Array): number {
  if (a.length === 0) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return s / a.length
}

function stdev(a: number[] | Float64Array, m?: number): number {
  if (a.length < 2) return 0
  const mu = m ?? mean(a)
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - mu) ** 2
  return Math.sqrt(s / (a.length - 1))
}

function znormalize(a: Float64Array): Float64Array {
  const out = new Float64Array(a.length)
  const mu = mean(a)
  const sd = stdev(a, mu)
  if (sd === 0 || !Number.isFinite(sd)) {
    // constant series — similarity is undefined; return zeros so cosine/DTW
    // treat it neutrally (will score low against a non-constant query).
    return out
  }
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - mu) / sd
  return out
}

/** Percent-rank (0..historical-1) of `arr[idx]` within `arr`. */
function rankOf(arr: Float64Array, idx: number): number {
  const v = arr[idx]
  let lower = 0
  let equal = 0
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < v) lower++
    else if (arr[i] === v) equal++
  }
  // Average-rank ties, like Pine's ta.percentrank interpretation.
  return Math.round(((lower + equal / 2) / arr.length) * (arr.length - 1))
}

// ------------- similarity measures -------------
// All return a score where HIGHER = more similar. Distances are converted via
// 1/(1+d) so they sit on the same scale as correlations.

function cosineSim(a: Float64Array, b: Float64Array): number {
  let dot = 0,
    na = 0,
    nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const den = Math.sqrt(na) * Math.sqrt(nb)
  return den === 0 ? -1 : dot / den
}

function pearsonSim(a: Float64Array, b: Float64Array): number {
  const ma = mean(a),
    mb = mean(b)
  let num = 0,
    da = 0,
    db = 0
  for (let i = 0; i < a.length; i++) {
    const xa = a[i] - ma,
      xb = b[i] - mb
    num += xa * xb
    da += xa * xa
    db += xb * xb
  }
  const den = Math.sqrt(da * db)
  return den === 0 ? -1 : num / den
}

function spearmanSim(a: Float64Array, b: Float64Array): number {
  const n = a.length
  const ra = new Float64Array(n)
  const rb = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    ra[i] = rankOf(a, i)
    rb[i] = rankOf(b, i)
  }
  return pearsonSim(ra, rb)
}

function euclideanSim(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return 1 / (1 + Math.sqrt(s))
}

function mseSim(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return 1 / (1 + s / a.length)
}

/** Kendall tau-b correlation. */
function kendallSim(a: Float64Array, b: Float64Array): number {
  let con = 0,
    dis = 0,
    ta = 0,
    tb = 0
  const n = a.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d1 = a[j] - a[i]
      const d2 = b[j] - b[i]
      const s = d1 * d2
      if (s > 0) con++
      else if (s < 0) dis++
      else {
        if (d1 === 0) ta++
        if (d2 === 0) tb++
      }
    }
  }
  const den = Math.sqrt((con + dis + ta) * (con + dis + tb))
  return den === 0 ? 0 : (con - dis) / den
}

/**
 * Constrained Dynamic Time Warping with a Sakoe-Chiba band of 10% of length.
 * Distance is normalized to [0,1] and inverted to a similarity score.
 */
function dtwSim(a: Float64Array, b: Float64Array): number {
  const n = a.length
  const band = Math.max(1, Math.ceil(n * 0.1))
  const INF = Number.POSITIVE_INFINITY
  const dtw = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) dtw[i] = INF
  dtw[0] = Math.abs(a[0] - b[0])
  for (let i = 0; i < n; i++) {
    const jStart = Math.max(0, i - band)
    const jEnd = Math.min(n, i + band + 1)
    for (let j = jStart; j < jEnd; j++) {
      if (i === 0 && j === 0) continue
      const cost = Math.abs(a[i] - b[j])
      const up = i > 0 ? dtw[(i - 1) * n + j] : INF
      const left = j > 0 ? dtw[i * n + j - 1] : INF
      const diag = i > 0 && j > 0 ? dtw[(i - 1) * n + j - 1] : INF
      dtw[i * n + j] = cost + Math.min(up, left, diag)
    }
  }
  // Normalize by path length (at least n steps).
  const dist = dtw[n * n - 1] / n
  // Scale by amplitude so the score is roughly in [0,1] for z-normalized inputs.
  const amp =
    0.5 *
    (stdev(a) + stdev(b) !== 0
      ? 0.5 * (stdev(a) + stdev(b)) * 3
      : 1)
  return 1 / (1 + dist / Math.max(amp, 1e-9))
}

type SimilarityFn = (a: Float64Array, b: Float64Array) => number

function getSimilarityFn(kind: NextPivotSettings['similarity']): SimilarityFn {
  switch (kind) {
    case 'cosine':
      return cosineSim
    case 'pearson':
      return pearsonSim
    case 'spearman':
      return spearmanSim
    case 'euclidean':
      return euclideanSim
    case 'mse':
      return mseSim
    case 'kendall':
      return kendallSim
    case 'dtw':
      return dtwSim
  }
}

// ------------- core result -------------

export interface ForecastPoint {
  /** 0-based offset from last historical bar (1..forecastLength). */
  offset: number
  /** Unix seconds for positioning on the time axis. */
  time: number
  /** Ensemble mean forecast price. */
  price: number
  /** Upper band (mean + sigma). */
  upper: number
  /** Lower band (mean - sigma). */
  lower: number
}

export interface NextPivotZigZagPoint {
  /** Bar index within the forecast path (0..forecastLength). */
  offset: number
  time: number
  price: number
  /** +1 for a projected pivot high, -1 for a pivot low. */
  direction: 1 | -1
}

export interface MatchCandidate {
  /** Start index in candles[] of the historical window. */
  startIndex: number
  /** Similarity score (higher = more similar). */
  score: number
}

export interface NextPivotResult {
  /** Best-match window start index. */
  bestStart: number | null
  /** Midpoint (bestStart + correlationLength), where the forecast begins historically. */
  bestMid: number | null
  /** End index (mid + forecastLength) of the best historical continuation. */
  bestEnd: number | null
  /** Top-K matches and their scores. */
  topMatches: MatchCandidate[]
  /** Ensemble forecast path (length forecastLength). */
  forecast: ForecastPoint[]
  /** Projected ZigZag pivots on the forecast path. */
  zigZag: NextPivotZigZagPoint[]
  /** Linear-regression channel over the forecast. */
  linReg: {
    slope: number
    intercept: number
    sigma: number
    /** y values for each offset 0..forecastLength. */
    fit: number[]
    upper: number[]
    lower: number[]
  } | null
  /** Information for the on-chart label. */
  info: {
    similarity: number
    method: string
    source: string
    correlationLength: number
    forecastLength: number
    barsBack: number
    ensembleSize: number
  } | null
  warmupBars: number
}

/**
 * Simple bar-count ZigZag: a point is a pivot high if it's the highest high
 * across `legs` bars on each side, and vice versa for pivot lows. This is
 * what the original uses via TradingView/ZigZag/6 with price deviation set
 * to a near-zero value (0.00001%) — effectively a bar-count zigzag with 5 legs.
 */
function zigZagPivots(
  prices: number[],
  legs: number,
  startTime: number,
  barSeconds: number,
  startOffset: number,
): NextPivotZigZagPoint[] {
  const n = prices.length
  if (n < 2 * legs + 1) return []
  const pivots: NextPivotZigZagPoint[] = []
  for (let i = legs; i < n - legs; i++) {
    const p = prices[i]
    let isHigh = true,
      isLow = true
    for (let j = i - legs; j <= i + legs; j++) {
      if (j === i) continue
      if (prices[j] > p) isHigh = false
      if (prices[j] < p) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) {
      pivots.push({
        offset: startOffset + i,
        time: startTime + (startOffset + i) * barSeconds,
        price: p,
        direction: 1,
      })
    } else if (isLow) {
      pivots.push({
        offset: startOffset + i,
        time: startTime + (startOffset + i) * barSeconds,
        price: p,
        direction: -1,
      })
    }
  }
  return pivots
}

/**
 * Project a ZigZag through the ensemble forecast using the historical ZigZag
 * on each top-K match, then voting. Simplified but faithful to the original
 * approach that draws zigzag segments from the matched continuation.
 */
function ensembleZigZag(
  forecast: ForecastPoint[],
  lastClose: number,
  legs: number,
  startTime: number,
  barSeconds: number,
): NextPivotZigZagPoint[] {
  // Derive pivots directly on the mean forecast path — simple and stable.
  const prices = forecast.map((p) => p.price)
  // Anchor the zigzag starting from the last close (point 0).
  const full = [lastClose, ...prices]
  const pivots = zigZagPivots(full, legs, startTime, barSeconds, -1)
  return pivots
}

function computeLinReg(forecast: ForecastPoint[]): NextPivotResult['linReg'] {
  if (forecast.length < 2) return null
  const n = forecast.length
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = i + 1
    ys[i] = forecast[i].price
  }
  const mx = mean(xs),
    my = mean(ys)
  let num = 0,
    den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = my - slope * mx
  const fit: number[] = []
  const residuals = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const yhat = slope * xs[i] + intercept
    fit.push(yhat)
    residuals[i] = ys[i] - yhat
  }
  const sigma = stdev(residuals)
  return {
    slope,
    intercept,
    sigma,
    fit,
    upper: fit.map((v) => v + sigma),
    lower: fit.map((v) => v - sigma),
  }
}

/**
 * Main calculator. Runs in O(barsBack * correlationLength). For the default
 * barsBack=5000 and correlationLength=20 that's ~100k operations — very fast.
 * For Kendall/DTW we cap barsBack to keep it interactive.
 */
export function calculateNextPivot(
  candles: Candle[],
  settings: NextPivotSettings,
  intervalSeconds: number,
): NextPivotResult {
  if (!isNextPivotSettings(settings)) throw new Error('Invalid Next Pivot settings')
  const n = candles.length
  const H = settings.correlationLength
  const F = settings.forecastLength
  const warmupBars = Math.max(H + F + 1, settings.barsBack < n ? H + F : 0)

  if (n < H + F + 2) {
    return {
      bestStart: null,
      bestMid: null,
      bestEnd: null,
      topMatches: [],
      forecast: [],
      zigZag: [],
      linReg: null,
      info: null,
      warmupBars,
    }
  }

  // Cap expensive methods to stay interactive.
  let effectiveBarsBack = settings.barsBack
  if (settings.similarity === 'kendall') effectiveBarsBack = Math.min(effectiveBarsBack, 1500)
  if (settings.similarity === 'dtw') effectiveBarsBack = Math.min(effectiveBarsBack, 1500)
  const startIdx = Math.max(0, n - 1 - effectiveBarsBack)

  // Build the raw value series (price or log %change).
  const rawSeries = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (settings.source === 'pctChange') {
      if (i === 0) rawSeries[i] = 0
      else {
        const prev = candles[i - 1].close
        rawSeries[i] = prev > 0 ? Math.log(candles[i].close / prev) : 0
      }
    } else {
      rawSeries[i] = candles[i].close
    }
  }

  const simFn = getSimilarityFn(settings.similarity)

  // The recent window ends at n-1 (last complete bar).
  const recentStart = n - H
  const recent = new Float64Array(H)
  for (let i = 0; i < H; i++) recent[i] = rawSeries[recentStart + i]
  const recentNorm = settings.zNormalize ? znormalize(recent) : recent

  // Score every candidate window from startIdx .. n - H - F - 1.
  const maxI = n - H - F - 1
  const candidates: MatchCandidate[] = []
  const capK = Math.min(settings.ensembleTopK, 20)

  for (let i = startIdx; i <= maxI; i++) {
    const cand = new Float64Array(H)
    for (let j = 0; j < H; j++) cand[j] = rawSeries[i + j]
    const candNorm = settings.zNormalize ? znormalize(cand) : cand
    const score = simFn(recentNorm, candNorm)
    if (!Number.isFinite(score)) continue
    // Keep only the top-K candidates using a simple insert-into-sorted-list.
    if (candidates.length < capK) {
      candidates.push({ startIndex: i, score })
      candidates.sort((a, b) => b.score - a.score)
    } else if (score > candidates[capK - 1].score) {
      candidates[capK - 1] = { startIndex: i, score }
      candidates.sort((a, b) => b.score - a.score)
    }
  }

  if (candidates.length === 0) {
    return {
      bestStart: null,
      bestMid: null,
      bestEnd: null,
      topMatches: [],
      forecast: [],
      zigZag: [],
      linReg: null,
      info: null,
      warmupBars,
    }
  }

  // Convert scores to weights via softmax on temperature-scaled scores.
  // Temperature chosen so clear winners dominate but ensemble still blends.
  const scores = candidates.map((c) => c.score)
  const maxScore = Math.max(...scores)
  const temp = 0.25
  const exps = scores.map((s) => Math.exp((s - maxScore) / temp))
  const expSum = exps.reduce((a, b) => a + b, 0) || 1
  const weights = exps.map((e) => e / expSum)

  // Compute the ensemble forecast. For each offset 1..F, gather the close
  // price from each match's continuation and blend them.
  // Continuation is expressed as a price relative to each match's last-close,
  // so different absolute price levels are comparable. We project forward
  // from the current last close.
  const lastClose = candles[n - 1].close
  const lastTime = candles[n - 1].time
  const barSeconds = intervalSeconds
  const forecast: ForecastPoint[] = []

  // sigma over ensemble at each offset
  for (let f = 1; f <= F; f++) {
    const prices: number[] = []
    const w: number[] = []
    for (let k = 0; k < candidates.length; k++) {
      const ci = candidates[k].startIndex
      const followIdx = ci + H + f - 1
      if (followIdx >= n) continue
      // Continuation path as cumulative product of returns (robust across
      // price levels), applied to the current close.
      let cum = 1
      for (let j = 0; j < f; j++) {
        const idx = ci + H + j
        if (idx >= n) break
        const prevIdx = idx === 0 ? idx : idx - 1
        const prevClose =
          candles[prevIdx].close > 0 ? candles[prevIdx].close : candles[idx].close
        cum *= candles[idx].close / prevClose
      }
      const projected = lastClose * cum
      if (Number.isFinite(projected) && projected > 0) {
        prices.push(projected)
        w.push(weights[k])
      }
    }
    if (prices.length === 0) continue
    let wsum = 0
    let wmean = 0
    for (let k = 0; k < prices.length; k++) {
      wmean += w[k] * prices[k]
      wsum += w[k]
    }
    wmean /= wsum || 1
    let wvar = 0
    for (let k = 0; k < prices.length; k++) {
      wvar += w[k] * (prices[k] - wmean) ** 2
    }
    const wsd = Math.sqrt(wvar / (wsum || 1))
    forecast.push({
      offset: f,
      time: lastTime + f * barSeconds,
      price: wmean,
      upper: wmean + wsd,
      lower: wmean - wsd,
    })
  }

  // ZigZag on the forecast path.
  const zigZag = settings.showZigZag
    ? ensembleZigZag(forecast, lastClose, settings.zigZagLegs, lastTime, barSeconds)
    : []

  const linReg = settings.showLinReg ? computeLinReg(forecast) : null

  const best = candidates[0]
  const methodLabel: Record<NextPivotSettings['similarity'], string> = {
    cosine: 'Cosine Similarity',
    pearson: 'Pearson',
    spearman: 'Spearman',
    euclidean: 'Euclidean',
    mse: 'MSE',
    kendall: 'Kendall τ-b',
    dtw: 'DTW',
  }

  return {
    bestStart: best.startIndex,
    bestMid: best.startIndex + H,
    bestEnd: best.startIndex + H + F,
    topMatches: candidates,
    forecast,
    zigZag,
    linReg,
    info: {
      similarity: best.score,
      method: methodLabel[settings.similarity],
      source: settings.source === 'price' ? 'Price' : '% Change',
      correlationLength: H,
      forecastLength: F,
      barsBack: effectiveBarsBack,
      ensembleSize: candidates.length,
    },
    warmupBars,
  }
}
