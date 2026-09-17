import { constants, createSign } from 'node:crypto'
import {
  isMetalFeed,
  kalshiFeedForProduct,
  kalshiIsoSeconds,
  kalshiMarketRows,
  KALSHI_WINDOW_SECONDS,
  metalFeedForSymbol,
  parseBrtiAnchors,
  parseKalshiStrike,
  roundStrike,
  selectKalshiMarket,
  type BrtiAnchor,
  type BrtiSample,
  type KalshiCoinFeed,
  type KalshiMetalFeed,
  type KalshiStrikeResponse,
  type MetalInterval,
} from '../shared/kalshi.ts'
import {
  mergeSettlementPoints,
  metalCoverage,
  metalQuote,
  metalRequestRange,
  parseImpliedUp,
  parseSettlementPoints,
  quantizeMetalLookback,
  settlementCandles,
  type KalshiMetalHistory,
  type MetalPendingWindow,
  type SettlementPoint,
} from '../shared/kalshi-metals.ts'
import { MarketError } from './rest-client.ts'

/** Recommended production Trade API host. */
export const KALSHI_REST_ORIGIN = 'https://external-api.kalshi.com'
const API_ROOT = '/trade-api/v2'

/** Settled markets per page when walking a metal ladder back through time. */
export const METAL_PAGE_SIZE = 1000
/** Hard cap on pages walked for one metal request: 10,000 windows ≈ 104 days. */
export const METAL_PAGE_CAP = 10

/**
 * Sign a Kalshi Trade API request.
 *
 * Kalshi signs `timestamp + method + path`, where the path is taken from the API root
 * and **excludes the query string** — signing the full URL is the single most common
 * way this integration silently 401s. RSA-PSS over SHA-256 with a digest-length salt.
 */
export function kalshiAuthHeaders(
  keyId: string,
  privateKeyPem: string,
  method: string,
  path: string,
  timestampMs: number,
): Record<string, string> {
  const pathWithoutQuery = path.split('?')[0]
  const signer = createSign('RSA-SHA256')
  signer.update(`${timestampMs}${method.toUpperCase()}${pathWithoutQuery}`)
  signer.end()
  const signature = signer
    .sign({
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    })
    .toString('base64')
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': String(timestampMs),
  }
}

/** Truncate to the hour, as CF Benchmarks' `timestamp` parameter requires. */
export function hourFloorIso(timeMs: number): string {
  return new Date(Math.floor(timeMs / 3_600_000) * 3_600_000).toISOString()
}

export interface KalshiServiceOptions {
  fetcher?: typeof fetch
  /** Injectable clock, unix ms. Tests pin it so window math is deterministic. */
  now?: () => number
  /** How long an open-market fetch is reused, ms. */
  strikeTtl?: number
  /** How long settled markets (the anchor series) are reused, ms. */
  anchorsTtl?: number
  /** How long a live index sample fetch is reused, ms. */
  samplesTtl?: number
  /** Minimum spacing between upstream requests, ms. */
  spacing?: number
  /** Kalshi API key id. Omit for the free, unauthenticated strike feed. */
  keyId?: string
  /** Matching RSA private key, PEM. Required alongside `keyId`. */
  privateKey?: string
  /** How many settled windows to read back for the anchor series. */
  anchorLimit?: number
  /** How long the newest settled-metals page is reused, ms. Older pages are immutable. */
  metalTtl?: number
  /** Settled markets per metals page. Overridable so tests can walk multiple pages. */
  metalPageSize?: number
  /** Maximum pages walked for one metals request. */
  metalPageCap?: number
}

interface CacheEntry {
  value: unknown
  at: number
}

/**
 * Kalshi's published numbers, fetched rather than re-derived.
 *
 * The point of this service is that it never guesses. The strike Kalshi settles
 * against is a 60-second average of CF Benchmarks' BRTI-family index; no amount of
 * Coinbase candle math reproduces it exactly. So we read Kalshi's own `floor_strike`
 * off the public market record — unauthenticated, free, and exact by definition —
 * and only fall back to a local estimate when Kalshi itself is unreachable.
 *
 * With an API key the CF Benchmarks REST passthrough additionally yields the raw
 * index samples, which is what turns the overlay from quarter-hour anchors into a
 * real second-by-second index line.
 */
export class KalshiService {
  private fetcher: typeof fetch
  private now: () => number
  private strikeTtl: number
  private anchorsTtl: number
  private samplesTtl: number
  private spacing: number
  private anchorLimit: number
  private keyId: string | null
  private privateKey: string | null
  private metalTtl: number
  private metalPageSize: number
  private metalPageCap: number
  private cache = new Map<string, CacheEntry>()
  private pending = new Map<string, Promise<unknown>>()
  private lastStarted = 0
  private closed = false
  /** Rolling per-product index samples accumulated from the live endpoint. */
  private sampleBuffers = new Map<string, BrtiSample[]>()
  private lastMessage = new Map<string, string>()

  constructor(options: KalshiServiceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.strikeTtl = options.strikeTtl ?? 4_000
    this.anchorsTtl = options.anchorsTtl ?? 120_000
    this.samplesTtl = options.samplesTtl ?? 3_000
    this.spacing = options.spacing ?? 200
    this.anchorLimit = Math.min(200, Math.max(2, options.anchorLimit ?? 60))
    // The newest settled page gains a row each quarter hour, so it is cached briefly;
    // every page behind it is immutable and cached for an hour by the caller.
    this.metalTtl = options.metalTtl ?? 20_000
    this.metalPageSize = Math.min(
      METAL_PAGE_SIZE,
      Math.max(1, Math.trunc(options.metalPageSize ?? METAL_PAGE_SIZE)),
    )
    this.metalPageCap = Math.min(
      METAL_PAGE_CAP,
      Math.max(1, Math.trunc(options.metalPageCap ?? METAL_PAGE_CAP)),
    )
    // Both halves are required; a key id without its private key cannot sign.
    this.keyId = options.keyId && options.privateKey ? options.keyId : null
    this.privateKey = options.keyId && options.privateKey ? options.privateKey : null
  }

  /** True when the authenticated CF Benchmarks passthrough is configured. */
  get keyed(): boolean {
    return this.keyId !== null && this.privateKey !== null
  }

  private async fetchJson(path: string, ttl: number, authed: boolean): Promise<unknown> {
    const cacheKey = `${authed ? 'a' : 'p'}:${path}`
    const cached = this.cache.get(cacheKey)
    if (cached && this.now() - cached.at < ttl) return cached.value
    const inflight = this.pending.get(cacheKey)
    if (inflight) return inflight
    if (this.closed) throw new MarketError('The Kalshi service is stopped.', 503, 'STOPPED')

    const request = (async () => {
      // Honour minimum upstream spacing without a full queue: coalescing already
      // collapses concurrent demand for the same path.
      const wait = Math.max(0, this.lastStarted + this.spacing - this.now())
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      this.lastStarted = this.now()
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (authed) {
        if (!this.keyId || !this.privateKey)
          throw new MarketError('Kalshi API key is not configured.', 401, 'NO_KEY')
        Object.assign(
          headers,
          kalshiAuthHeaders(this.keyId, this.privateKey, 'GET', path, this.now()),
        )
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const response = await this.fetcher(`${KALSHI_REST_ORIGIN}${path}`, {
          signal: controller.signal,
          headers,
          redirect: 'error',
        })
        if (!response.ok) {
          if (response.status === 401 || response.status === 403)
            throw new MarketError(
              response.status === 403
                ? 'This Kalshi account is not entitled to the CF Benchmarks passthrough.'
                : 'Kalshi rejected the API key signature.',
              response.status,
              'KALSHI_UNAUTHORIZED',
            )
          if (response.status === 429)
            throw new MarketError('Kalshi rate limit reached.', 429, 'RATE_LIMITED')
          throw new MarketError(
            `Kalshi is unavailable (HTTP ${response.status}).`,
            502,
            'KALSHI_UNAVAILABLE',
          )
        }
        return await response.json()
      } finally {
        clearTimeout(timeout)
      }
    })()

    this.pending.set(cacheKey, request)
    try {
      const value = await request
      this.cache.set(cacheKey, { value, at: this.now() })
      return value
    } finally {
      this.pending.delete(cacheKey)
    }
  }

  private marketsPath(feed: KalshiCoinFeed, status: 'open' | 'settled', limit?: number): string {
    const params = new URLSearchParams({ series_ticker: feed.series, status })
    if (limit) params.set('limit', String(limit))
    return `${API_ROOT}/markets?${params}`
  }

  /**
   * Live index samples from the CF Benchmarks passthrough.
   *
   * Two calls, because CF Benchmarks splits recency from depth: `/values` gives the
   * latest tick, `/history/values` gives a whole hour of per-second samples but only
   * once that hour is roughly complete. We seed the buffer from history and append
   * each fresh tick, so the overlay is dense without asking history for data it does
   * not have yet.
   */
  private async readSamples(feed: KalshiCoinFeed): Promise<BrtiSample[] | null> {
    // The passthrough only serves CF Benchmarks ids. The metals settle on Pyth, which
    // Kalshi exposes no index endpoint for, so asking would be a guaranteed 400.
    if (!this.keyed || isMetalFeed(feed)) return null
    const bufferKey = feed.product
    const existing = this.sampleBuffers.get(bufferKey) ?? []
    try {
      // Backfill the previous complete hour; the current one is not published yet.
      const historyPath =
        `${API_ROOT}/cfbenchmarks/history/values?id=${feed.indexId}` +
        `&timespan=HOUR&timestamp=${hourFloorIso(this.now() - 3_600_000)}`
      const history = (await this.fetchJson(historyPath, this.anchorsTtl, true)) as {
        data?: { payload?: unknown }
        payload?: unknown
      } | null
      const backfill = parseIndexPayload(history?.data ?? history, feed)
      const latestPath = `${API_ROOT}/cfbenchmarks/values?id=${feed.indexId}`
      const latest = (await this.fetchJson(latestPath, this.samplesTtl, true)) as {
        data?: { payload?: unknown }
        payload?: unknown
      } | null
      const ticks = parseIndexPayload(latest?.data ?? latest, feed)
      const merged = new Map<number, number>()
      for (const sample of [...backfill, ...existing, ...ticks])
        merged.set(sample.time, sample.value)
      const mergedList = [...merged.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, value]) => ({ time, value }))
      // Keep roughly two hours; older samples are off the chart anyway.
      const cutoff = Math.floor(this.now() / 1000) - 7_200
      const trimmed = mergedList.filter((sample) => sample.time >= cutoff)
      this.sampleBuffers.set(bufferKey, trimmed)
      return trimmed.length ? trimmed : null
    } catch (error) {
      this.lastMessage.set(
        bufferKey,
        error instanceof MarketError ? error.message : 'CF Benchmarks passthrough failed.',
      )
      return existing.length ? existing : null
    }
  }

  /**
   * The exact strike for `product`, plus the index anchors behind it.
   *
   * Never throws when Kalshi is merely unreachable: a chart that cannot reach Kalshi
   * should still draw, with the strike labelled an estimate rather than silently
   * presenting a wrong number as authoritative.
   */
  async strikeFor(product: string): Promise<KalshiStrikeResponse> {
    const feed = kalshiFeedForProduct(product)
    if (!feed)
      throw new MarketError(
        'Kalshi runs no 15-minute market on this pair.',
        404,
        'NO_KALSHI_SERIES',
      )
    const asOf = this.now()
    const nowSec = Math.floor(asOf / 1000)
    let strike = null
    let anchors: BrtiAnchor[] = []
    let message = ''

    try {
      const open = await this.fetchJson(this.marketsPath(feed, 'open'), this.strikeTtl, false)
      strike = parseKalshiStrike(open, feed, nowSec, asOf)
      if (!strike) message = 'Kalshi has not published a strike for this window yet.'
    } catch (error) {
      message = error instanceof MarketError ? error.message : 'Kalshi is unreachable.'
    }

    try {
      const settled = await this.fetchJson(
        this.marketsPath(feed, 'settled', this.anchorLimit),
        this.anchorsTtl,
        false,
      )
      anchors = parseBrtiAnchors(settled, feed)
    } catch (error) {
      if (!message)
        message = error instanceof MarketError ? error.message : 'Kalshi is unreachable.'
    }

    const samples = await this.readSamples(feed)
    if (!message && samples) message = 'Live CF Benchmarks index samples.'
    if (!message && strike) message = `Kalshi published strike · ${feed.indexId}`
    if (!message) message = 'Kalshi returned no usable strike.'
    const keyedNote = this.lastMessage.get(feed.product)
    if (keyedNote) message = `${message} ${keyedNote}`

    return {
      source: 'kalshi',
      product: feed.product,
      series: feed.series,
      indexId: feed.indexId,
      strike,
      anchors,
      samples,
      keyed: this.keyed,
      asOf,
      message,
    }
  }

  /** One page of settled metal markets, bounded by close time in unix milliseconds. */
  private metalsSettledPath(feed: KalshiMetalFeed, fromSec: number, toSec: number): string {
    const params = new URLSearchParams({
      series_ticker: feed.series,
      status: 'settled',
      limit: String(this.metalPageSize),
      min_close_ts: String(Math.max(0, Math.trunc(fromSec)) * 1000),
      max_close_ts: String(Math.max(0, Math.trunc(toSec)) * 1000),
    })
    return `${API_ROOT}/markets?${params}`
  }

  /**
   * Walk a metal ladder backwards through its settled markets.
   *
   * Pagination steps `max_close_ts` rather than following Kalshi's `cursor`: a cursor is
   * only valid for the exact parameter set that produced it, and re-issuing one without
   * the time filters returns pages from a different ordering — observed live, following a
   * `max_close_ts` cursor yielded a market *newer* than the page it came from. Time
   * stepping is filter-stable and needs no state.
   *
   * `complete` distinguishes "we reached the requested depth, or the series start" from
   * "the page cap stopped us", so the UI can say when history is truncated rather than
   * quietly showing a short chart.
   */
  private async metalPoints(
    feed: KalshiMetalFeed,
    fromSec: number,
    toSec: number,
  ): Promise<{ points: SettlementPoint[]; complete: boolean; pages: number }> {
    // Align the upper bound to the window open now, so the newest page's path — and its
    // cache entry — is stable for the whole quarter hour instead of changing every poll.
    let cursorTo = (Math.floor(toSec / KALSHI_WINDOW_SECONDS) + 1) * KALSHI_WINDOW_SECONDS
    const runs: SettlementPoint[][] = []
    let pages = 0
    let complete = false
    while (pages < this.metalPageCap) {
      const path = this.metalsSettledPath(feed, fromSec, cursorTo)
      // Page one still receives settlements; every page behind it is immutable history.
      const payload = await this.fetchJson(path, pages === 0 ? this.metalTtl : 3_600_000, false)
      pages++
      const rows = kalshiMarketRows(payload)
      runs.push(parseSettlementPoints(payload, feed))
      // A short page means the filters matched everything left, i.e. the series start.
      if (rows.length < this.metalPageSize) {
        complete = true
        break
      }
      let oldest: number | null = null
      for (const market of rows) {
        const close = kalshiIsoSeconds(market.close_time)
        if (close !== null && (oldest === null || close < oldest)) oldest = close
      }
      if (oldest === null || oldest - KALSHI_WINDOW_SECONDS <= fromSec) {
        complete = true
        break
      }
      cursorTo = oldest - 1
    }
    return { points: mergeSettlementPoints(...runs), complete, pages }
  }

  /**
   * Gold or silver, as far as Kalshi actually publishes them.
   *
   * Every number here is one Kalshi put on the record: a window's `floor_strike` or its
   * graded `expiration_value`. Nothing is interpolated, resampled or carried forward, and
   * a window Kalshi did not publish leaves a hole in the chart rather than a flat bar.
   *
   * Never throws when Kalshi is merely unreachable — the caller still gets a well-formed
   * response with whatever it already had, and a message saying why there is no more.
   */
  async metalHistory(
    symbol: string,
    interval: MetalInterval,
    limit: number,
  ): Promise<KalshiMetalHistory> {
    const feed = metalFeedForSymbol(symbol)
    if (!feed)
      throw new MarketError(
        'Kalshi runs no 15-minute market on this metal.',
        404,
        'NO_KALSHI_SERIES',
      )
    const asOf = this.now()
    const nowSec = Math.floor(asOf / 1000)
    const bars = Math.max(2, Math.min(900, Math.trunc(limit)))
    const { from, to } = metalRequestRange(interval, bars, nowSec)
    let points: SettlementPoint[] = []
    let complete = false
    let pages = 0
    let failure = ''

    try {
      const run = await this.metalPoints(feed, quantizeMetalLookback(from), to)
      points = run.points
      complete = run.complete
      pages = run.pages
    } catch (error) {
      failure = error instanceof MarketError ? error.message : 'Kalshi is unreachable.'
    }

    let pending: MetalPendingWindow | null = null
    try {
      const open = await this.fetchJson(this.marketsPath(feed, 'open'), this.strikeTtl, false)
      const market = selectKalshiMarket(open, nowSec)
      const strike = parseKalshiStrike({ markets: market ? [market] : [] }, feed, nowSec, asOf)
      if (strike) {
        pending = {
          windowStart: strike.windowStart,
          windowEnd: strike.windowEnd,
          strike: strike.strike,
          roundDigits: strike.roundDigits,
          ticker: strike.ticker,
          rule: strike.rule,
          tieGoesUp: strike.tieGoesUp,
          impliedUp: parseImpliedUp(market),
        }
        // The live strike is the newest boundary value Kalshi has published, and it lands
        // about a second after the cut — well before the window it closes is graded.
        // Merging it finishes the bar that just closed. The bar forming now still has only
        // its opening point, so it stays undrawn: an unfinished bar is not a candle.
        points = mergeSettlementPoints(points, [
          { time: pending.windowStart, value: pending.strike },
        ])
      }
    } catch (error) {
      if (!failure)
        failure = error instanceof MarketError ? error.message : 'Kalshi is unreachable.'
    }

    const candles = settlementCandles(points, interval, bars)
    const coverage = metalCoverage(points, nowSec, complete)
    const quote = points.length ? metalQuote(points) : null
    let message: string
    if (!candles.length)
      message = failure || 'Kalshi has published no settled windows for this metal yet.'
    else {
      message = `${feed.name} · Kalshi ${feed.series} settlement points on ${feed.indexId}, quarter-hour resolution.`
      if (!complete) message += ` History truncated at ${pages} pages of settled markets.`
      else if (candles.length < bars && coverage.from)
        message += ` The series begins ${new Date(coverage.from * 1000).toISOString().slice(0, 10)}, so there are fewer ${interval} bars than requested.`
      if (failure) message += ` ${failure}`
    }
    return {
      source: 'kalshi',
      symbol,
      series: feed.series,
      indexId: feed.indexId,
      interval,
      candles,
      // The chart only needs the points behind the bars it was given; the full run stays
      // server-side, and `coverage` reports how much of it there was.
      points: points.slice(-1000),
      quote,
      pending,
      roundDigits: feed.roundDigits,
      unit: feed.unit,
      coverage,
      asOf,
      message,
    }
  }

  close(): void {
    this.closed = true
    this.cache.clear()
    this.pending.clear()
    this.sampleBuffers.clear()
  }
}

/**
 * Read CF Benchmarks' `{ payload: [{ time, value }] }` shape.
 *
 * `time` arrives in milliseconds and `value` as a string; Kalshi additionally wraps
 * the whole body under `data`. Both are tolerated so the parser does not care which
 * hop it is reading.
 */
export function parseIndexPayload(body: unknown, feed: KalshiCoinFeed): BrtiSample[] {
  if (!body || typeof body !== 'object') return []
  const payload = (body as { payload?: unknown }).payload
  if (!Array.isArray(payload)) return []
  const out: BrtiSample[] = []
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as { time?: unknown; value?: unknown }
    const time = typeof raw.time === 'number' ? raw.time : Number(raw.time)
    const value = typeof raw.value === 'number' ? raw.value : Number(raw.value)
    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) continue
    // CF Benchmarks timestamps are ms; normalise to the unix seconds the chart uses.
    // 1e11 separates the two cleanly: unix seconds today are ~1.8e9, unix ms ~1.8e12.
    const seconds = time > 1e11 ? Math.floor(time / 1000) : Math.floor(time)
    out.push({ time: seconds, value: roundStrike(value, feed.roundDigits) })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** Seconds until the next window cut — used to pick a saner poll cadence. */
export function secondsUntilCut(nowMs: number): number {
  const nowSec = nowMs / 1000
  const windowEnd = (Math.floor(nowSec / KALSHI_WINDOW_SECONDS) + 1) * KALSHI_WINDOW_SECONDS
  return windowEnd - nowSec
}
