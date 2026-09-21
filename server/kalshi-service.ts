import { constants, createSign } from 'node:crypto'
import {
  isMetalFeed,
  kalshiFeedForProduct,
  kalshiIsoSeconds,
  kalshiMarketRows,
  kalshiNumeric,
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
  floatChance,
  floatDecimals,
  floatLiveSymbol,
  floatPayout,
  parseFeeMultiplier,
  parseFloatOrderbook,
  parseLastTradePrice,
  parseLiveIndexTick,
  selectFloatMarket,
  type FloatMarket,
  type KalshiFloatBook,
  type KalshiFloatResponse,
} from '../shared/kalshi-float.ts'
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

/**
 * The host of Kalshi's LIVE index feed — the same public, UNDOCUMENTED endpoint
 * Kalshi's own page reads its "Now" from (verified by the original floating
 * window's author across all 16 ladders). There is no CF Benchmarks equivalent
 * for the metals: gold answers here literally as `Metal.Index.1OZGOLD/USD`.
 *
 * If Kalshi changes or removes this, `floatFor` degrades by design: crypto falls
 * back to a Coinbase print (labelled approximate) and the metals show no value.
 * Nothing on this path is ever authenticated.
 */
export const KALSHI_LIVE_ORIGIN = 'https://api.elections.kalshi.com'
const LIVE_INDEX_PATH = '/v1/live_data/assets'

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
  /**
   * Live Coinbase price for the "Now" fallback, used only when the Kalshi index
   * feed is down AND the feed is a crypto one (the metals have no public
   * substitute that is close enough on a 15-minute horizon). Must never throw
   * to the caller's detriment: a rejection simply means "no fallback".
   */
  spotProvider?: (product: string) => Promise<number | null>
  /** How long the real-time float readings (book, trades, index) are reused, ms. */
  floatTtl?: number
  /** Origin of the live index feed. Injectable so tests can point it at a fixture host. */
  liveOrigin?: string
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
  private spotProvider: ((product: string) => Promise<number | null>) | null
  private floatTtl: number
  private liveOrigin: string
  private cache = new Map<string, CacheEntry>()
  private pending = new Map<string, Promise<unknown>>()
  private lastStarted = 0
  private closed = false
  /** Rolling per-product index samples accumulated from the live endpoint. */
  private sampleBuffers = new Map<string, BrtiSample[]>()
  private lastMessage = new Map<string, string>()
  /** Float reads that just failed: endpoint key -> when to retry, unix ms. */
  private floatPause = new Map<string, number>()
  /** Live index symbols that stopped answering: symbol -> when to retry, unix ms. */
  private liveDead = new Map<string, number>()
  /** Last known trade per product, so a dropped /trades poll does not jump the %. */
  private lastKnownTrade = new Map<string, { ticker: string; px: number }>()

  constructor(options: KalshiServiceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.strikeTtl = options.strikeTtl ?? 4_000
    this.anchorsTtl = options.anchorsTtl ?? 120_000
    this.samplesTtl = options.samplesTtl ?? 3_000
    this.spacing = options.spacing ?? 200
    this.anchorLimit = Math.min(200, Math.max(2, options.anchorLimit ?? 60))
    this.spotProvider = options.spotProvider ?? null
    // One client poll is ~1/s; a 1.2s reuse means two overlapping polls never
    // double the load while the reading stays within ~1s of the data.
    this.floatTtl = options.floatTtl ?? 1_200
    this.liveOrigin = options.liveOrigin ?? KALSHI_LIVE_ORIGIN
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

  private async fetchJson(
    path: string,
    ttl: number,
    authed: boolean,
    origin: string = KALSHI_REST_ORIGIN,
  ): Promise<unknown> {
    // ttl <= 0 means "never cached" — not even read, not even stored. The real-time
    // float readings change every second, and their paths turn over with every
    // contract, so storing them would grow the cache without ever being hit.
    const cacheKey = `${authed ? 'a' : 'p'}:${origin}${path}`
    if (ttl > 0) {
      const cached = this.cache.get(cacheKey)
      if (cached && this.now() - cached.at < ttl) return cached.value
    }
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
        const response = await this.fetcher(`${origin}${path}`, {
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
      if (ttl > 0) this.cache.set(cacheKey, { value, at: this.now() })
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

  /**
   * Everything the floating Kalshi window needs to paint, for one product.
   *
   * Port of the snapshot cycle of the standalone floating window. The pieces are
   * read at different cadences because they change at different speeds:
   *
   *   - the market LIST (ticker, target, hours) — short TTL; Kalshi serves it
   *     from a 15-second cache upstream, and it is only ever used for what does
   *     not change inside a contract;
   *   - the order book and the last trade — near-live TTL; this is where the %
   *     and the "x" multipliers come from, in real time;
   *   - the live index — near-live TTL; the "Now" price, the number Kalshi
   *     settles on;
   *   - the series fee multiplier — an hour; it is a static property of the
   *     ladder.
   *
   * Every failure degrades one labelled part of the response instead of
   * failing the whole read: no book -> the % falls back to the cached list
   * (and says so), no index -> a Coinbase print for crypto (and says so), no
   * market -> a well-formed empty response with the clock still running.
   */
  async floatFor(product: string): Promise<KalshiFloatResponse> {
    const feed = kalshiFeedForProduct(product)
    if (!feed)
      throw new MarketError(
        'Kalshi runs no 15-minute market on this pair.',
        404,
        'NO_KALSHI_SERIES',
      )
    const asOf = this.now()
    const nowSec = Math.floor(asOf / 1000)
    const expectedStart = Math.floor(nowSec / KALSHI_WINDOW_SECONDS) * KALSHI_WINDOW_SECONDS

    let market: FloatMarket | null = null
    let marketFailure = ''
    try {
      let payload = await this.fetchJson(
        this.marketsPath(feed, 'open', 10),
        this.strikeTtl,
        false,
      )
      market = selectFloatMarket(payload, nowSec)
      // Rollover: Kalshi's list is cached 15s upstream and ours for strikeTtl, so
      // right after the cut it can still carry only the NEXT (future) window.
      // The clock governs — when the running window is missing from the list, bust
      // the cache once, but only inside the first half minute of the window;
      // outside it, a still-missing market is a real gap, not a stale cache, and
      // this must not hammer the server.
      const open = market ? kalshiIsoSeconds(market.open_time) : null
      const staleList = market === null || open === null || open > expectedStart
      if (staleList && (market === null || nowSec - expectedStart < 30)) {
        try {
          const bust = await this.fetchJson(
            `${this.marketsPath(feed, 'open', 10)}&_=${asOf}`,
            0,
            false,
          )
          const fresh = selectFloatMarket(bust, nowSec)
          const freshOpen = fresh ? kalshiIsoSeconds(fresh.open_time) : null
          if (fresh && freshOpen !== null && freshOpen <= nowSec) {
            payload = bust
            market = fresh
          } else if (market === null && fresh) {
            market = fresh
          }
        } catch {
          // The bust is an optimisation only: keep what the list had.
        }
      }
    } catch (error) {
      marketFailure = error instanceof MarketError ? error.message : 'Kalshi is unreachable.'
    }

    // A window that has not opened yet is not the contract to display: in the
    // couple of seconds after the cut the list can carry only the NEXT window.
    // That reads as "waiting for the next contract", the way the standalone
    // window reads the just-closed one as liquidating — never as a live market
    // with a countdown to a future cut.
    if (market) {
      const selectedOpen = kalshiIsoSeconds(market.open_time)
      if (selectedOpen !== null && selectedOpen > nowSec) market = null
    }

    // The real-time readings go out together; each degrades on its own.
    const symbol = floatLiveSymbol(feed.product)
    const ticker = market && typeof market.ticker === 'string' ? market.ticker : null
    const [book, tick, fee, lastTrade] = await Promise.all([
      ticker ? this.readFloatBook(ticker) : Promise.resolve(null),
      this.readLiveIndex(symbol),
      market ? this.readFeeMultiplier(feed) : Promise.resolve(1),
      ticker ? this.readLastTrade(ticker) : Promise.resolve(null),
    ])
    let last = lastTrade
    if (last !== null && ticker) this.lastKnownTrade.set(feed.product, { ticker, px: last })
    if (last === null && market) {
      const known = this.lastKnownTrade.get(feed.product)
      if (known && known.ticker === ticker) last = known.px
    }

    let yesBid: number | null = null
    let yesAsk: number | null = null
    let noAsk: number | null = null
    let pctSource: KalshiFloatResponse['pctSource'] = null
    if (market) {
      if (book) {
        yesBid = book.yesBid
        yesAsk = book.yesAsk
        noAsk = book.noAsk
        pctSource = 'book'
      } else {
        // Fallback: the prices on the market list, which can be up to ~20s behind
        // (15s upstream cache + ours). The window labels this in its footer.
        yesBid = inUnit(market.yes_bid_dollars)
        yesAsk = inUnit(market.yes_ask_dollars)
        noAsk = inUnit(market.no_ask_dollars)
        if (last === null) last = inUnit(market.last_price_dollars)
        pctSource = 'list'
      }
    }

    const upPct = market ? floatChance(yesBid, yesAsk, last) : null
    const upX = market ? floatPayout(yesAsk, fee) : null
    const downX = market ? floatPayout(noAsk, fee) : null

    // "Now": the live settlement index; the labelled Coinbase fallback for crypto.
    let nowPx: number | null = null
    let nowSource: KalshiFloatResponse['nowSource'] = null
    let quiet = false
    if (tick === 'quiet') quiet = true
    else if (typeof tick === 'number') {
      nowPx = tick
      nowSource = 'kalshi'
    }
    if (nowPx === null && !isMetalFeed(feed) && this.spotProvider) {
      try {
        const spot = await this.spotProvider(feed.product)
        if (spot !== null && Number.isFinite(spot) && spot > 0) {
          nowPx = spot
          nowSource = 'coinbase'
        }
      } catch {
        // No fallback: the footer will say the index is unavailable.
      }
    }

    const target = market ? kalshiNumeric(market.floor_strike) : null
    const openSec = market ? kalshiIsoSeconds(market.open_time) : null
    const closeSec = market ? kalshiIsoSeconds(market.close_time) : null

    return {
      source: 'kalshi',
      product: feed.product,
      series: feed.series,
      ticker,
      target,
      decimals: floatDecimals(market, target),
      open: openSec,
      close: closeSec,
      upPct,
      downPct: upPct === null ? null : 100 - upPct,
      upX,
      downX,
      now: nowPx,
      nowSource,
      quiet,
      pctSource,
      asOf,
      message: this.floatMessage({
        feed,
        hasMarket: !!market,
        marketFailure,
        quiet,
        nowPx,
        nowSource,
        pctSource,
      }),
    }
  }

  /** One of the near-live float reads, with a short park after each failure. */
  private readFloatBook(ticker: string): Promise<KalshiFloatBook | null> {
    return this.guardedFloatRead('book', async () =>
      parseFloatOrderbook(
        await this.fetchJson(
          `${API_ROOT}/markets/${encodeURIComponent(ticker)}/orderbook`,
          0,
          false,
        ),
      ),
    )
  }

  private readLastTrade(ticker: string): Promise<number | null> {
    return this.guardedFloatRead('trades', async () =>
      parseLastTradePrice(
        await this.fetchJson(
          `${API_ROOT}/markets/trades?ticker=${encodeURIComponent(ticker)}&limit=1`,
          0,
          false,
        ),
      ),
    )
  }

  /**
   * Run a near-live read, parking that endpoint briefly on failure (longer when
   * it is a rate limit) so one dead endpoint cannot stall the whole cycle —
   * the same discipline the standalone window uses before it retries.
   */
  private async guardedFloatRead<T>(
    key: string,
    read: () => Promise<T | null>,
  ): Promise<T | null> {
    if (this.now() < (this.floatPause.get(key) ?? 0)) return null
    try {
      return await read()
    } catch (error) {
      const status = error instanceof MarketError ? error.status : 0
      this.floatPause.set(key, this.now() + (status === 429 ? 30_000 : 5_000))
      return null
    }
  }

  /**
   * The "Now" value from Kalshi's own live index feed, with per-symbol pauses:
   * a dead symbol would otherwise cost a full timeout on EVERY poll and make
   * the whole window flicker "stale" while Kalshi itself is fine.
   */
  private async readLiveIndex(symbol: string): Promise<number | 'quiet' | null> {
    if (this.now() < (this.liveDead.get(symbol) ?? 0)) return null
    const path = `${LIVE_INDEX_PATH}/${encodeURIComponent(symbol)}/1s?last_sec=10`
    try {
      const payload = await this.fetchJson(path, this.floatTtl, false, this.liveOrigin)
      return parseLiveIndexTick(payload)
    } catch (error) {
      const status = error instanceof MarketError ? error.status : 0
      const pause =
        status === 400 || status === 404 ? 300_000 : status === 429 ? 60_000 : 15_000
      this.liveDead.set(symbol, this.now() + pause)
      return null
    }
  }

  /**
   * The ladder's fee multiplier, cached an hour by the fetch cache; on failure
   * assume 1 and only retry after a minute, so the network being down never
   * slows the price cycle down.
   */
  private async readFeeMultiplier(feed: KalshiCoinFeed): Promise<number> {
    const key = `fee:${feed.series}`
    if (this.now() < (this.floatPause.get(key) ?? 0)) return 1
    try {
      const payload = await this.fetchJson(
        `${API_ROOT}/series/${encodeURIComponent(feed.series)}`,
        3_600_000,
        false,
      )
      return parseFeeMultiplier(payload)
    } catch {
      this.floatPause.set(key, this.now() + 60_000)
      return 1
    }
  }

  /** The footer line: one sentence about where the numbers on screen came from. */
  private floatMessage(args: {
    feed: KalshiCoinFeed
    hasMarket: boolean
    marketFailure: string
    quiet: boolean
    nowPx: number | null
    nowSource: KalshiFloatResponse['nowSource']
    pctSource: KalshiFloatResponse['pctSource']
  }): string {
    const { feed, hasMarket, marketFailure, quiet, nowPx, nowSource, pctSource } = args
    let message: string
    if (!hasMarket) {
      message = isMetalFeed(feed)
        ? 'No open contract right now — waiting for the next one'
        : 'Waiting for the next contract…'
    } else if (quiet) message = 'The index is not emitting ticks right now (underlying paused)'
    else if (nowPx !== null && nowSource === 'coinbase')
      message = 'Now ≈ Coinbase — approximate; the Kalshi index did not answer'
    else if (nowPx === null) message = 'Now unavailable — the Kalshi index did not answer'
    else if (pctSource === 'list')
      message = '% from the market list, up to ~20s delayed (the order book did not answer)'
    else message = 'Now = the index Kalshi settles on · % from the live order book · read-only'
    if (marketFailure) message = `${message} · ${marketFailure}`
    return message
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
    this.floatPause.clear()
    this.liveDead.clear()
    this.lastKnownTrade.clear()
  }

  /**
   * Drop cache entries recorded before `cutoff` and index buffers that have gone
   * entirely stale.
   *
   * Without this the cache grows for the life of the process: settled metals pages are
   * keyed by their page cursor, so every quarter hour mints a new key, and a TTL is
   * only honoured on read. Index buffers are trimmed on write, but a product nobody
   * charts any more leaves its buffer stranded past the two-hour window. Returns the
   * number of entries and buffers dropped.
   */
  purge(cutoff: number): { pages: number; sampleBuffers: number } {
    let pages = 0
    for (const [key, entry] of this.cache)
      if (entry.at < cutoff) {
        this.cache.delete(key)
        pages++
      }
    const staleBefore = Math.floor(this.now() / 1000) - 7_200
    let sampleBuffers = 0
    for (const [product, samples] of this.sampleBuffers)
      if (!samples.length || samples[samples.length - 1].time < staleBefore) {
        this.sampleBuffers.delete(product)
        sampleBuffers++
      }
    // Expired float pauses and dead-index marks are one-time tripwires, not data.
    for (const [key, until] of this.floatPause)
      if (until < this.now()) this.floatPause.delete(key)
    for (const [symbol, until] of this.liveDead)
      if (until < this.now()) this.liveDead.delete(symbol)
    return { pages, sampleBuffers }
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

/**
 * A contract price as published on the market list, in (0, 1) or null.
 *
 * On the LIST (unlike the order book) "no orders" arrives as 0.0000 / 1.0000
 * rather than as an empty field, and those sentinels must read as "no quote"
 * — a 1.0 ask would turn the payout into 1.00x, which is a lie.
 */
function inUnit(value: unknown): number | null {
  const v = typeof value === 'string' ? Number(value) : value
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1 ? v : null
}

/** Seconds until the next window cut — used to pick a saner poll cadence. */
export function secondsUntilCut(nowMs: number): number {
  const nowSec = nowMs / 1000
  const windowEnd = (Math.floor(nowSec / KALSHI_WINDOW_SECONDS) + 1) * KALSHI_WINDOW_SECONDS
  return windowEnd - nowSec
}
