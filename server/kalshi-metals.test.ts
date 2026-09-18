import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarketApi } from './api.ts'
import { CoinbaseService } from './coinbase-service.ts'
import { KalshiService } from './kalshi-service.ts'
import { CoinbaseRestClient } from './rest-client.ts'
import { isKalshiMetalHistory } from '../shared/kalshi-metals.ts'
import { KALSHI_WINDOW_SECONDS } from '../shared/kalshi.ts'
import fixture from '../shared/fixtures/kalshi-metals-markets.json'

/**
 * A synthetic gold ladder with a known shape, so pagination can be asserted exactly.
 *
 * Twenty windows, each priced a dollar above the last. The newest of them closed at
 * `GRADED_END` and is settled; the window that closed at `SERIES_END` has NOT been graded
 * yet — which is the real ordering, since Kalshi publishes the next window's strike about
 * a second after the cut and grades the closed one about eighteen seconds after. That gap
 * is exactly what the live strike is used for.
 */
const SERIES_END = Date.parse('2026-09-17T02:00:00Z') / 1000
const GRADED_END = SERIES_END - KALSHI_WINDOW_SECONDS
const SERIES_START = SERIES_END - 20 * KALSHI_WINDOW_SECONDS
/** Five minutes into the live window, so it is open and its strike is published. */
const NOW_MS = (SERIES_END + 300) * 1000

const priceAt = (time: number) => 4000 + (time - SERIES_START) / KALSHI_WINDOW_SECONDS
const iso = (time: number) => new Date(time * 1000).toISOString()

function settledGold(maxCloseSec: number, limit: number) {
  const markets = []
  for (
    let close = Math.min(Math.floor(maxCloseSec / 900) * 900, GRADED_END);
    close > SERIES_START && markets.length < limit;
    close -= KALSHI_WINDOW_SECONDS
  ) {
    const open = close - KALSHI_WINDOW_SECONDS
    markets.push({
      ticker: `KXGOLD15M-${close}`,
      event_ticker: `KXGOLD15M-${close}`,
      status: 'finalized',
      result: 'yes',
      open_time: iso(open),
      close_time: iso(close),
      floor_strike: priceAt(open),
      expiration_value: String(priceAt(close)),
      strike_type: 'greater_or_equal',
      custom_strike: { round_digits: '2' },
      rules_primary: 'the close price of the 1-minute Pyth GOLD candlestick',
    })
  }
  return { cursor: '', markets }
}

/** The live gold window: a strike at its open, and no settlement yet. */
const openGold = {
  cursor: '',
  markets: [
    {
      ticker: 'KXGOLD15M-live',
      status: 'active',
      result: '',
      open_time: iso(SERIES_END),
      close_time: iso(SERIES_END + KALSHI_WINDOW_SECONDS),
      floor_strike: priceAt(SERIES_END),
      expiration_value: '',
      strike_type: 'greater_or_equal',
      custom_strike: { round_digits: '2' },
      rules_primary: 'the close price of the 1-minute Pyth GOLD candlestick',
      last_price_dollars: '0.4200',
      yes_bid_dollars: '0.4100',
      yes_ask_dollars: '0.4300',
    },
  ],
}

const noMarkets = { cursor: '', markets: [] }

/** Answers settled pages by their `max_close_ts`, records every call, and never guesses. */
function metalFetch(options: { live?: boolean } = {}) {
  const calls: string[] = []
  const live = options.live ?? true
  const fetcher = vi.fn(async (input: unknown) => {
    const url = new URL(String(input))
    calls.push(url.pathname + url.search)
    const series = url.searchParams.get('series_ticker')
    const status = url.searchParams.get('status')
    if (status === 'open') {
      if (!live)
        return { ok: true, status: 200, json: async () => noMarkets } as unknown as Response
      const body = series === 'KXSILVER15M' ? fixture.silver.open : openGold
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    }
    // Silver is served from its real recorded markets; gold from the synthetic ladder.
    const body =
      series === 'KXSILVER15M'
        ? fixture.silver.settled
        : settledGold(
            Number(url.searchParams.get('max_close_ts')) / 1000,
            Number(url.searchParams.get('limit')),
          )
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  })
  return { fetcher: fetcher as unknown as typeof fetch, calls }
}

function metalService(options: { fetcher: typeof fetch; pageSize?: number; pageCap?: number }) {
  return new KalshiService({
    fetcher: options.fetcher,
    now: () => NOW_MS,
    spacing: 0,
    metalPageSize: options.pageSize,
    metalPageCap: options.pageCap,
  })
}

const closers: (() => void)[] = []
afterEach(() => {
  while (closers.length) closers.pop()!()
})

/** A real HTTP boundary, so route validation is tested as the browser meets it. */
async function serve(kalshi: KalshiService) {
  // Any Coinbase call for a metal is a bug; make it fail loudly rather than hang.
  const coinbase = new CoinbaseService({
    rest: new CoinbaseRestClient(
      (async () => {
        throw new Error('metals must never be routed to Coinbase')
      }) as typeof fetch,
      0,
    ),
  })
  const api = createMarketApi(coinbase, kalshi)
  const server = createServer((req, res) => {
    if (!api.handle(req, res)) {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => {
    api.close()
    server.closeAllConnections()
    server.close()
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('KalshiService.metalHistory', () => {
  it('builds candles from published settlement values, unauthenticated', async () => {
    const { fetcher, calls } = metalFetch()
    const result = await metalService({ fetcher }).metalHistory('XAU-USD', '15m', 20)

    expect(result.source).toBe('kalshi')
    expect(result.symbol).toBe('XAU-USD')
    expect(result.series).toBe('KXGOLD15M')
    expect(result.indexId).toBe('PYTH_GOLD')
    expect(result.unit).toBe('troy ounce')
    // Twenty-one points give twenty bars, the newest closed by the live window's strike.
    expect(result.candles).toHaveLength(20)
    expect(result.candles[0].open).toBe(priceAt(SERIES_START))
    expect(result.candles.at(-1)!.close).toBe(priceAt(SERIES_END))
    expect(result.candles.every((c) => c.time % KALSHI_WINDOW_SECONDS === 0)).toBe(true)
    // Kalshi publishes no metal volume, so none is claimed.
    expect(result.candles.every((c) => c.volume === 0)).toBe(true)
    expect(calls.length).toBeGreaterThan(0)
    expect(isKalshiMetalHistory(result, 'XAU-USD', '15m')).toBe(true)
  })

  it('reports the forming window without drawing a bar for it', async () => {
    const { fetcher } = metalFetch()
    const result = await metalService({ fetcher }).metalHistory('XAU-USD', '15m', 20)
    // The window that opened at SERIES_END has an open and no close: not a candle.
    expect(result.candles.map((c) => c.time)).not.toContain(SERIES_END)
    expect(result.candles.at(-1)!.time).toBe(GRADED_END)
    expect(result.pending?.windowStart).toBe(SERIES_END)
    expect(result.pending?.windowEnd).toBe(SERIES_END + KALSHI_WINDOW_SECONDS)
    expect(result.pending?.strike).toBe(priceAt(SERIES_END))
    expect(result.pending?.rule).toContain('Pyth GOLD')
    expect(result.pending?.tieGoesUp).toBe(true)
    // A contract price, kept out of the quote: 42c last trade = a 42% implied UP.
    expect(result.pending?.impliedUp).toBe(0.42)
  })

  it('uses the live strike to finish the bar the graded series has not closed yet', async () => {
    const withLive = await metalService(metalFetch()).metalHistory('XAU-USD', '15m', 20)
    const { fetcher } = metalFetch({ live: false })
    const withoutLive = await metalService({ fetcher }).metalHistory('XAU-USD', '15m', 20)

    // Ungraded, the newest point is the previous boundary and one bar is missing.
    expect(withoutLive.pending).toBeNull()
    expect(withoutLive.candles).toHaveLength(19)
    expect(withoutLive.candles.at(-1)!.time).toBe(GRADED_END - KALSHI_WINDOW_SECONDS)
    // The live strike is that missing boundary, published a second after the cut.
    expect(withLive.candles).toHaveLength(20)
    expect(withLive.candles.at(-1)!.time).toBe(GRADED_END)
    expect(withLive.candles.at(-1)!.close).toBe(priceAt(SERIES_END))
  })

  it('quotes silver off its real recorded markets, with no volume and an honest age', async () => {
    const { fetcher } = metalFetch()
    const result = await metalService({ fetcher }).metalHistory('XAG-USD', '15m', 10)
    expect(result.symbol).toBe('XAG-USD')
    expect(result.series).toBe('KXSILVER15M')
    expect(result.roundDigits).toBe(3)
    const quote = result.quote!
    expect(quote.source).toBe('kalshi')
    expect(quote.volume).toBeNull()
    expect(quote.price).toBe(63.498)
    expect(quote.updatedAt).toBe(Date.parse('2026-09-17T02:00:00Z'))
    // Two settled windows and the live strike: three points, two bars.
    expect(result.candles).toHaveLength(2)
    expect(result.candles[0].open).toBe(63.921)
    expect(result.coverage.ageSeconds).toBe(300)
  })

  it('pages backwards through settled markets, stepping the time bound not a cursor', async () => {
    const { fetcher, calls } = metalFetch()
    const result = await metalService({ fetcher, pageSize: 4 }).metalHistory('XAU-USD', '15m', 20)
    const settled = calls.filter((call) => call.includes('status=settled'))
    // Twenty windows at four per page, walking back to a short final page.
    expect(settled.length).toBeGreaterThanOrEqual(5)
    const bounds = settled.map((call) =>
      Number(new URLSearchParams(call.split('?')[1]).get('max_close_ts')),
    )
    expect(bounds).toEqual([...bounds].sort((a, b) => b - a))
    expect(new Set(bounds).size).toBe(bounds.length)
    // No cursor is ever sent: re-issuing one with different filters returns wrong pages.
    expect(calls.every((call) => !call.includes('cursor='))).toBe(true)
    expect(result.coverage.complete).toBe(true)
    expect(result.candles).toHaveLength(20)
  })

  it('reports truncated history instead of quietly showing a short chart', async () => {
    const { fetcher, calls } = metalFetch()
    const result = await metalService({ fetcher, pageSize: 2, pageCap: 2 }).metalHistory(
      'XAU-USD',
      '15m',
      20,
    )
    expect(calls.filter((call) => call.includes('status=settled'))).toHaveLength(2)
    expect(result.coverage.complete).toBe(false)
    expect(result.message).toContain('truncated')
    expect(result.candles.length).toBeLessThan(20)
  })

  it('says when the series simply does not go back that far', async () => {
    const { fetcher } = metalFetch()
    // 900 daily bars is 900 days; this ladder is twenty windows long.
    const result = await metalService({ fetcher }).metalHistory('XAU-USD', '1D', 900)
    expect(result.coverage.complete).toBe(true)
    expect(result.candles.length).toBeLessThan(900)
    expect(result.message).toContain('series begins')
  })

  it('aggregates quarter-hour points into the higher timeframes', async () => {
    const { fetcher } = metalFetch()
    const hourly = await metalService({ fetcher }).metalHistory('XAU-USD', '1h', 20)
    expect(hourly.interval).toBe('1h')
    expect(hourly.candles.every((c) => c.time % 3600 === 0)).toBe(true)
    // A rising ramp: each hour opens below where it closes, envelope included.
    for (const candle of hourly.candles) {
      expect(candle.close).toBeGreaterThan(candle.open)
      expect(candle.high).toBe(candle.close)
      expect(candle.low).toBe(candle.open)
    }
  })

  it('caps the settlement points it ships to what the chart can use', async () => {
    const { fetcher } = metalFetch()
    const result = await metalService({ fetcher }).metalHistory('XAU-USD', '15m', 20)
    expect(result.points.length).toBeLessThanOrEqual(1000)
    // …while coverage still reports how much history the walk actually held.
    expect(result.coverage.points).toBeGreaterThanOrEqual(result.points.length)
  })

  it('caches the settled pages so a poll does not re-walk the series', async () => {
    const { fetcher, calls } = metalFetch()
    const service = metalService({ fetcher })
    await service.metalHistory('XAU-USD', '15m', 20)
    const count = calls.length
    await service.metalHistory('XAU-USD', '15m', 20)
    expect(calls.length).toBe(count)
  })

  it('degrades to no candles rather than throwing when Kalshi is down', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('socket hang up')
    }) as unknown as typeof fetch
    const result = await metalService({ fetcher }).metalHistory('XAU-USD', '15m', 20)
    expect(result.candles).toEqual([])
    expect(result.points).toEqual([])
    expect(result.quote).toBeNull()
    expect(result.pending).toBeNull()
    expect(result.message.length).toBeGreaterThan(0)
    expect(isKalshiMetalHistory(result)).toBe(true)
  })

  it('maps an upstream 502 to a message, still without candles', async () => {
    const fetcher = vi.fn(
      async () => ({ ok: false, status: 502, json: async () => ({}) }) as unknown as Response,
    ) as unknown as typeof fetch
    const result = await metalService({ fetcher }).metalHistory('XAU-USD', '15m', 20)
    expect(result.candles).toEqual([])
    expect(result.message).toContain('Kalshi is unavailable')
  })

  it('rejects a symbol Kalshi settles no metal ladder on', async () => {
    const { fetcher } = metalFetch()
    const service = metalService({ fetcher })
    await expect(service.metalHistory('BTC-USD', '15m', 20)).rejects.toMatchObject({
      code: 'NO_KALSHI_SERIES',
      status: 404,
    })
    // Platinum and palladium have no ladder: refused, never approximated from gold.
    await expect(service.metalHistory('XPT-USD', '15m', 20)).rejects.toMatchObject({
      code: 'NO_KALSHI_SERIES',
    })
  })

  it('keeps metals away from the CF Benchmarks passthrough even with a key configured', async () => {
    const { fetcher, calls } = metalFetch()
    const service = new KalshiService({
      fetcher,
      now: () => NOW_MS,
      spacing: 0,
      keyId: 'key-id',
      privateKey: 'unused-for-metals',
    })
    const result = await service.strikeFor('XAU-USD')
    expect(result.keyed).toBe(true)
    expect(result.samples).toBeNull()
    expect(calls.every((call) => !call.includes('cfbenchmarks'))).toBe(true)
    expect(result.strike?.indexId).toBe('PYTH_GOLD')
    expect(result.strike?.strike).toBe(priceAt(SERIES_END))
  })
})

describe('the metals HTTP boundary', () => {
  it('serves the metal catalog with the resolutions Kalshi can support', async () => {
    const { fetcher } = metalFetch()
    const origin = await serve(metalService({ fetcher }))
    const body = await (await fetch(`${origin}/api/kalshi/metals`)).json()
    expect(body.source).toBe('kalshi')
    expect(body.metals.map((metal: { symbol: string }) => metal.symbol)).toEqual([
      'XAU-USD',
      'XAG-USD',
    ])
    expect(body.metals[0].intervals).toEqual(['15m', '30m', '1h', '2h', '4h', '1D', '1W'])
    expect(body.metals[0].unit).toBe('troy ounce')
  })

  it('serves validated history over HTTP', async () => {
    const { fetcher } = metalFetch()
    const origin = await serve(metalService({ fetcher }))
    const response = await fetch(`${origin}/api/kalshi/metals/history?symbol=XAU-USD&interval=15m`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(isKalshiMetalHistory(body, 'XAU-USD', '15m')).toBe(true)
    expect(body.candles.length).toBeGreaterThan(0)
  })

  it('refuses a resolution Kalshi publishes nothing for', async () => {
    const { fetcher, calls } = metalFetch()
    const origin = await serve(metalService({ fetcher }))
    for (const interval of ['1m', '3m', '5m']) {
      const response = await fetch(
        `${origin}/api/kalshi/metals/history?symbol=XAU-USD&interval=${interval}`,
      )
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBe('INVALID_METAL_INTERVAL')
      expect(body.message).toContain('15m')
    }
    // Refused at the boundary: no upstream request was made to resample from.
    expect(calls).toEqual([])
  })

  it('refuses a symbol it settles no metal on, and an absurd limit', async () => {
    const { fetcher } = metalFetch()
    const origin = await serve(metalService({ fetcher }))
    const symbol = await fetch(`${origin}/api/kalshi/metals/history?symbol=BTC-USD&interval=15m`)
    expect(symbol.status).toBe(400)
    expect((await symbol.json()).error).toBe('INVALID_METAL')
    const missing = await fetch(`${origin}/api/kalshi/metals/history?interval=15m`)
    expect((await missing.json()).error).toBe('INVALID_METAL')
    const limit = await fetch(
      `${origin}/api/kalshi/metals/history?symbol=XAU-USD&interval=15m&limit=999999`,
    )
    expect(limit.status).toBe(400)
    expect((await limit.json()).error).toBe('INVALID_LIMIT')
  })

  it('turns a metal sent to the Coinbase routes away with an explanation', async () => {
    const { fetcher } = metalFetch()
    const origin = await serve(metalService({ fetcher }))
    const candles = await fetch(
      `${origin}/api/coinbase/candles?product=XAU-USD&interval=15m&limit=10`,
    )
    expect(candles.status).toBe(400)
    const body = await candles.json()
    expect(body.error).toBe('METAL_NOT_ON_COINBASE')
    expect(body.source).toBe('coinbase')
    expect(body.message).toContain('/api/kalshi/metals/history')
    const quotes = await fetch(`${origin}/api/coinbase/quotes?products=XAU-USD,BTC-USD`)
    expect(quotes.status).toBe(400)
    expect((await quotes.json()).error).toBe('METAL_NOT_ON_COINBASE')
  })

  it('still serves the Kalshi strike route for a metal', async () => {
    const { fetcher } = metalFetch()
    const origin = await serve(metalService({ fetcher }))
    const response = await fetch(`${origin}/api/kalshi/strike?product=XAG-USD`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.source).toBe('kalshi')
    expect(body.indexId).toBe('PYTH_SILVER')
    expect(body.strike.strike).toBe(63.498)
  })
})
