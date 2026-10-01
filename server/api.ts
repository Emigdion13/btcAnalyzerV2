import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { isInterval, isProductId } from '../shared/coinbase.ts'
import {
  isMetalInterval,
  isMetalSymbol,
  KALSHI_COIN_FEEDS,
  KALSHI_METAL_FEEDS,
  kalshiFeedForProduct,
  METAL_INTERVALS,
} from '../shared/kalshi.ts'
import { CoinbaseService } from './coinbase-service.ts'
import { DerivativesService } from './derivatives-service.ts'
import { KalshiService } from './kalshi-service.ts'
import { collectGarbage, parseMaintenanceMinutes, rssMegabytes } from './maintenance.ts'
import { MarketError } from './rest-client.ts'

/**
 * Optional Kalshi API credentials, for the CF Benchmarks passthrough.
 *
 * Without them the strike feed still works — Kalshi's market data is public — we
 * simply lose the second-by-second index samples and draw quarter-hour anchors
 * instead. The private key may be inlined or pointed at a file; a PEM in an
 * environment variable is painful, so the path form is the practical one.
 */
/** Which charted pairs have a Kalshi 15-minute market, and the index behind each. */
const KALSHI_COIN_LIST = KALSHI_COIN_FEEDS.map((feed) => ({
  product: feed.product,
  series: feed.series,
  indexId: feed.indexId,
  roundDigits: feed.roundDigits,
}))

/**
 * The precious metals Kalshi settles, and the resolutions it can support.
 *
 * Gold and silver are not Coinbase products. Their prices are Kalshi's own published
 * settlement values for the `KXGOLD15M` / `KXSILVER15M` ladders, which resolve on Pyth's
 * 1-minute candlestick close — so quarter-hour resolution is a property of the source,
 * not a limitation of this server, and sub-15m intervals are refused rather than guessed.
 */
const KALSHI_METAL_LIST = KALSHI_METAL_FEEDS.map((feed) => ({
  symbol: feed.symbol,
  ticker: feed.ticker,
  name: feed.name,
  series: feed.series,
  indexId: feed.indexId,
  roundDigits: feed.roundDigits,
  unit: feed.unit,
  intervals: METAL_INTERVALS,
}))

function kalshiCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): {
  keyId?: string
  privateKey?: string
} {
  const keyId = env.KALSHI_API_KEY_ID?.trim()
  if (!keyId) return {}
  const inline = env.KALSHI_API_PRIVATE_KEY?.trim()
  const path = env.KALSHI_API_PRIVATE_KEY_PATH?.trim()
  let privateKey = inline || undefined
  if (!privateKey && path) {
    try {
      privateKey = readFileSync(path, 'utf8').trim()
    } catch {
      // A missing key file must not take the whole server down; the unauthenticated
      // strike feed carries on and the UI reports that samples are unavailable.
      privateKey = undefined
    }
  }
  return privateKey ? { keyId, privateKey } : {}
}

export function createMarketApi(
  service = new CoinbaseService({ derivatives: new DerivativesService() }),
  kalshi = new KalshiService({
    ...kalshiCredentialsFromEnv(),
    // The "Now" fallback for the floating window: only used when Kalshi's own
    // index feed is down, and only for crypto — the metals have no public
    // substitute close enough on a 15-minute horizon.
    spotProvider: async (product) => {
      if (isMetalSymbol(product)) return null
      const { quotes } = await service.getQuotes([product])
      return quotes[product]?.price ?? null
    },
  }),
) {
  const connections = new Set<ServerResponse>()
  /**
   * The scheduled memory sweep.
   *
   * Anything a live chart no longer holds is re-fetchable within seconds, so the sweep
   * drops it wholesale instead of letting resident memory ramp for a session's length.
   * `ATLAS_MAINTENANCE_MINUTES` defaults to 30; `0` disables the sweep. With Node
   * started under `--expose-gc` (all of this repo's run scripts do), a full collection
   * follows so the freed heap is returned to the operating system immediately.
   */
  const PURGE_AGE_MS = 15 * 60 * 1000
  const purge = () => {
    const before = rssMegabytes(),
      cutoff = Date.now() - PURGE_AGE_MS
    const report = {
      ...service.purge(cutoff),
      ...kalshi.purge(cutoff),
    }
    const collected = collectGarbage()
    console.log(
      `[atlas] memory purge — charts:${report.histories} quotes:${report.quotes}` +
        ` tradeBookmarks:${report.tradeIds} failedReconciles:${report.failures}` +
        ` restPages:${report.restEntries} kalshiPages:${report.pages}` +
        ` indexBuffers:${report.sampleBuffers}` +
        ` · rss ${before} MB → ${rssMegabytes()} MB` +
        (collected ? '' : ' · gc unavailable (start with --expose-gc to release heap)'),
    )
  }
  const maintenanceMinutes = parseMaintenanceMinutes(process.env.ATLAS_MAINTENANCE_MINUTES)
  const maintenanceTimer =
    maintenanceMinutes > 0 ? setInterval(purge, maintenanceMinutes * 60_000) : undefined
  // Never hold the process open just for the next sweep.
  maintenanceTimer?.unref?.()
  const json = (res: ServerResponse, status: number, value: unknown) => {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(status === 429 ? { 'Retry-After': '10' } : {}),
    })
    res.end(JSON.stringify(value))
  }
  const dispatch = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET')
      throw new MarketError('Only GET requests are supported.', 405, 'METHOD_NOT_ALLOWED')
    const url = new URL(req.url ?? '/', 'http://market.internal')
    /**
     * Kalshi's published strike for one coin's live 15-minute window.
     *
     * Handled before the Coinbase parameter validation below: it takes a single
     * `product`, not a watchlist, and must not be rejected by rules it has no part in.
     */
    if (url.pathname === '/api/kalshi/strike') {
      const product = url.searchParams.get('product')
      if (!isProductId(product) || !kalshiFeedForProduct(product))
        throw new MarketError(
          'Kalshi runs no 15-minute market on this pair.',
          400,
          'NO_KALSHI_SERIES',
        )
      json(res, 200, await kalshi.strikeFor(product))
      return
    }
    /**
     * One real-time snapshot of the running 15-minute market: the strike, the
     * UP/DOWN % as Kalshi displays it (live order book + last trade), the net
     * payout multipliers, and the "Now" index value the market settles on.
     *
     * Read-only like every other route here: public market data, no
     * authentication, and the only upstream the browser will ever see is this
     * origin — Kalshi itself 403s requests that carry an Origin header.
     */
    if (url.pathname === '/api/kalshi/float') {
      const product = url.searchParams.get('product')
      if (!isProductId(product) || !kalshiFeedForProduct(product))
        throw new MarketError(
          'Kalshi runs no 15-minute market on this pair.',
          400,
          'NO_KALSHI_SERIES',
        )
      json(res, 200, await kalshi.floatFor(product))
      return
    }
    if (url.pathname === '/api/kalshi/coins') {
      json(res, 200, { source: 'kalshi', keyed: kalshi.keyed, coins: KALSHI_COIN_LIST })
      return
    }
    if (url.pathname === '/api/kalshi/metals') {
      json(res, 200, { source: 'kalshi', metals: KALSHI_METAL_LIST })
      return
    }
    /**
     * Gold and silver candles, built from Kalshi's published settlement values.
     *
     * Handled here, above the Coinbase validation, because a metal symbol is shaped like
     * a product id but is not one: Coinbase does not trade XAU-USD, and sending it there
     * would come back as a confusing "product unavailable".
     */
    if (url.pathname === '/api/kalshi/metals/history') {
      const symbol = url.searchParams.get('symbol')
      if (!isMetalSymbol(symbol))
        throw new MarketError(
          'Choose a metal Kalshi settles: XAU-USD (gold) or XAG-USD (silver).',
          400,
          'INVALID_METAL',
        )
      const metalInterval = url.searchParams.get('interval')
      if (!isMetalInterval(metalInterval))
        throw new MarketError(
          `Kalshi settles metals at 15m; higher intervals are aggregated. Choose one of ${METAL_INTERVALS.join(', ')}.`,
          400,
          'INVALID_METAL_INTERVAL',
        )
      const metalLimit = Number(url.searchParams.get('limit') ?? '300')
      if (!Number.isInteger(metalLimit) || metalLimit < 2 || metalLimit > 900)
        throw new MarketError(
          'Candle limit must be an integer from 2 to 900.',
          400,
          'INVALID_LIMIT',
        )
      json(res, 200, await kalshi.metalHistory(symbol, metalInterval, metalLimit))
      return
    }
    if (url.pathname === '/api/coinbase/products') {
      json(res, 200, await service.getProducts())
      return
    }
    const products = [
      ...new Set((url.searchParams.get('products') || '').split(',').filter(Boolean)),
    ]
    if (products.length > 100 || products.some((id) => !isProductId(id)))
      throw new MarketError(
        'Request up to 100 valid Coinbase USD products.',
        400,
        'INVALID_PRODUCTS',
      )
    if (products.some(isMetalSymbol))
      throw new MarketError(
        'Gold and silver are not Coinbase products. Use /api/kalshi/metals/history.',
        400,
        'METAL_NOT_ON_COINBASE',
      )
    if (url.pathname === '/api/coinbase/quotes') {
      json(res, 200, await service.getQuotes(products))
      return
    }
    if (!['/api/coinbase/candles', '/api/coinbase/stream'].includes(url.pathname))
      throw new MarketError('Market endpoint not found.', 404, 'NOT_FOUND')
    const product = url.searchParams.get('product'),
      interval = url.searchParams.get('interval')
    if (!isProductId(product) || !isInterval(interval))
      throw new MarketError(
        'Choose a Coinbase USD pair and a supported interval.',
        400,
        'INVALID_REQUEST',
      )
    if (isMetalSymbol(product))
      throw new MarketError(
        'Gold and silver are not Coinbase products. Use /api/kalshi/metals/history.',
        400,
        'METAL_NOT_ON_COINBASE',
      )
    const limit = Number(url.searchParams.get('limit') ?? '300')
    if (!Number.isInteger(limit) || limit < 2 || limit > 900)
      throw new MarketError('Candle limit must be an integer from 2 to 900.', 400, 'INVALID_LIMIT')
    if (url.pathname === '/api/coinbase/candles') {
      json(res, 200, await service.getHistory(product, interval, limit))
      return
    }
    let closed = false
    const resources: { unsubscribe?: () => void; keepalive?: ReturnType<typeof setInterval> } = {}
    const close = () => {
      if (closed) return
      closed = true
      resources.unsubscribe?.()
      clearInterval(resources.keepalive)
      connections.delete(res)
    }
    res.once('close', close)
    const send = (value: unknown) => {
      if (closed || res.destroyed || res.writableEnded) return
      if (!res.headersSent) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.flushHeaders()
        res.write('retry: 3000\n\n')
        connections.add(res)
      }
      if (res.writableLength > 1024 * 1024) {
        res.end()
        close()
        return
      }
      res.write(`data: ${JSON.stringify(value)}\n\n`)
    }
    resources.unsubscribe = await service.subscribe(product, interval, products, send, limit)
    if (closed) {
      resources.unsubscribe()
      return
    }
    resources.keepalive = setInterval(() => {
      if (!res.destroyed) res.write(': heartbeat\n\n')
    }, 15000)
  }
  return {
    handle(req: IncomingMessage, res: ServerResponse): boolean {
      if (!req.url?.startsWith('/api/')) return false
      void dispatch(req, res).catch((error) => {
        if (res.headersSent) {
          res.end()
          return
        }
        const kalshiRoute = req.url?.startsWith('/api/kalshi/') ?? false
        const e =
          error instanceof MarketError
            ? error
            : new MarketError(
                kalshiRoute
                  ? 'Kalshi returned unavailable or invalid market data. Please retry.'
                  : 'Coinbase returned unavailable or invalid market data. Please retry.',
              )
        json(res, e.status, {
          source: kalshiRoute ? 'kalshi' : 'coinbase',
          error: e.code,
          message: e.message,
        })
      })
      return true
    },
    close() {
      if (maintenanceTimer) clearInterval(maintenanceTimer)
      connections.forEach((res) => res.end())
      service.close()
      kalshi.close()
    },
    /** Run the memory sweep now, on the same schedule the server keeps internally. */
    purge,
  }
}
