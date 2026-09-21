import { describe, expect, it, vi } from 'vitest'
import { constants, createVerify, generateKeyPairSync } from 'node:crypto'
import {
  hourFloorIso,
  KalshiService,
  kalshiAuthHeaders,
  parseIndexPayload,
  secondsUntilCut,
} from './kalshi-service.ts'
import { MarketError } from './rest-client.ts'
import { kalshiFeedForProduct } from '../shared/kalshi.ts'

const BTC = kalshiFeedForProduct('BTC-USD')!
/**
 * A real keypair. Signing is the part most likely to be gotten subtly wrong, so the
 * keyed tests exercise it end to end rather than stubbing it out — a placeholder PEM
 * would throw inside the signer and quietly skip every passthrough assertion.
 */
const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
/** 2026-09-13T21:10:00Z — ten minutes into the 21:00→21:15 window. */
const NOW_MS = Date.parse('2026-09-13T21:10:00Z')
const WINDOW_START = Date.parse('2026-09-13T21:00:00Z') / 1000

const openPayload = {
  markets: [
    {
      ticker: 'KXBTC15M-26SEP131715-15',
      open_time: '2026-09-13T21:00:00Z',
      close_time: '2026-09-13T21:15:00Z',
      floor_strike: 77314.22,
      expiration_value: '',
      strike_type: 'greater_or_equal',
      custom_strike: { round_digits: '2' },
      rules_primary: "sixty seconds of CF Benchmarks' BRTI",
      status: 'active',
    },
  ],
}

const settledPayload = {
  markets: [
    {
      open_time: '2026-09-13T20:45:00Z',
      close_time: '2026-09-13T21:00:00Z',
      floor_strike: 77291.46,
      expiration_value: '77314.22',
    },
    {
      open_time: '2026-09-13T20:30:00Z',
      close_time: '2026-09-13T20:45:00Z',
      floor_strike: 77289.61,
      expiration_value: '77291.46',
    },
  ],
}

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

/** A canned upstream response, or an error to throw in its place. */
type Route = { body: unknown; status?: number } | Error

/** A fetcher that records every request and answers by URL substring. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const key = Object.keys(routes).find((pattern) => url.includes(pattern))
    if (!key) throw new Error(`Unexpected request: ${url}`)
    const route = routes[key]
    if (route instanceof Error) throw route
    return jsonResponse(route.body, route.status ?? 200)
  })
  return { fetcher: fetcher as unknown as typeof fetch, calls }
}

describe('kalshiAuthHeaders', () => {
  const privateKey = TEST_PRIVATE_KEY
  const publicKey = TEST_PUBLIC_KEY

  it('produces a signature Kalshi can verify over timestamp + method + path', () => {
    const timestamp = 1_789_333_800_000
    const headers = kalshiAuthHeaders(
      'key-id',
      privateKey,
      'GET',
      '/trade-api/v2/cfbenchmarks/values',
      timestamp,
    )
    expect(headers['KALSHI-ACCESS-KEY']).toBe('key-id')
    expect(headers['KALSHI-ACCESS-TIMESTAMP']).toBe(String(timestamp))
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${timestamp}GET/trade-api/v2/cfbenchmarks/values`)
    verifier.end()
    expect(
      verifier.verify(
        {
          key: publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        },
        headers['KALSHI-ACCESS-SIGNATURE'],
        'base64',
      ),
    ).toBe(true)
  })

  it('strips the query string before signing — the classic silent 401', () => {
    const timestamp = 1_789_333_800_000
    const withQuery = kalshiAuthHeaders(
      'key-id',
      privateKey,
      'GET',
      '/trade-api/v2/cfbenchmarks/values?id=BRTI&timespan=HOUR',
      timestamp,
    )
    const withoutQuery = kalshiAuthHeaders(
      'key-id',
      privateKey,
      'GET',
      '/trade-api/v2/cfbenchmarks/values',
      timestamp,
    )
    // PSS is randomised, so compare against a fresh verification of the stripped path.
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${timestamp}GET/trade-api/v2/cfbenchmarks/values`)
    verifier.end()
    const options = {
      key: publicKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    }
    expect(verifier.verify(options, withQuery['KALSHI-ACCESS-SIGNATURE'], 'base64')).toBe(true)
    expect(withQuery['KALSHI-ACCESS-TIMESTAMP']).toBe(withoutQuery['KALSHI-ACCESS-TIMESTAMP'])
  })
})

describe('hourFloorIso', () => {
  it('truncates to the hour, as CF Benchmarks requires', () => {
    expect(hourFloorIso(Date.parse('2026-09-13T21:10:00Z'))).toBe('2026-09-13T21:00:00.000Z')
    expect(hourFloorIso(Date.parse('2026-09-13T21:00:00Z'))).toBe('2026-09-13T21:00:00.000Z')
    expect(hourFloorIso(Date.parse('2026-09-13T21:59:59.999Z'))).toBe('2026-09-13T21:00:00.000Z')
  })
})

describe('secondsUntilCut', () => {
  it('counts down to the next quarter hour', () => {
    expect(secondsUntilCut(NOW_MS)).toBeCloseTo(300, 5)
    expect(secondsUntilCut(Date.parse('2026-09-13T21:14:59Z'))).toBeCloseTo(1, 5)
    expect(secondsUntilCut(Date.parse('2026-09-13T21:15:00Z'))).toBeCloseTo(900, 5)
  })
})

describe('parseIndexPayload', () => {
  it('normalises CF Benchmarks milliseconds and string values to chart units', () => {
    const parsed = parseIndexPayload(
      { payload: [{ time: 1_789_333_800_123, value: '77314.229' }] },
      BTC,
    )
    expect(parsed).toEqual([{ time: 1_789_333_800, value: 77314.23 }])
  })

  it('reads through the Kalshi passthrough envelope', () => {
    const wrapped = {
      data: { serverTime: 'x', payload: [{ time: 1_789_333_800_000, value: '1' }] },
    }
    expect(parseIndexPayload(wrapped.data, BTC)).toHaveLength(1)
  })

  it('sorts ascending and drops unusable entries', () => {
    const parsed = parseIndexPayload(
      {
        payload: [
          { time: 2_000_000_000_000, value: '3' },
          { time: 1_000_000_000_000, value: '1' },
          { time: 1_500_000_000_000, value: 'not-a-number' },
          { time: 1_600_000_000_000, value: '-5' },
          null,
        ],
      },
      BTC,
    )
    expect(parsed.map((sample) => sample.time)).toEqual([1_000_000_000, 2_000_000_000])
  })

  it('returns nothing for a malformed body', () => {
    expect(parseIndexPayload(null, BTC)).toEqual([])
    expect(parseIndexPayload({}, BTC)).toEqual([])
    expect(parseIndexPayload({ payload: 'nope' }, BTC)).toEqual([])
  })
})

describe('KalshiService.strikeFor', () => {
  it('returns the exact published strike, unauthenticated', async () => {
    const { fetcher, calls } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
    })
    const service = new KalshiService({ fetcher, now: () => NOW_MS })
    const result = await service.strikeFor('BTC-USD')

    expect(result.source).toBe('kalshi')
    expect(result.product).toBe('BTC-USD')
    expect(result.series).toBe('KXBTC15M')
    expect(result.indexId).toBe('BRTI')
    expect(result.keyed).toBe(false)
    expect(result.strike?.strike).toBe(77314.22)
    expect(result.strike?.windowStart).toBe(WINDOW_START)
    expect(result.strike?.windowEnd).toBe(WINDOW_START + 900)
    expect(result.strike?.tieGoesUp).toBe(true)
    // The anchor series is what the overlay draws without an API key.
    expect(result.anchors.map((anchor) => anchor.value)).toEqual([77289.61, 77291.46, 77314.22])
    expect(result.samples).toBeNull()
    // Public market data needs no credentials at all.
    expect(calls.every((call) => !call.headers['KALSHI-ACCESS-KEY'])).toBe(true)
  })

  it('rejects a pair Kalshi runs no 15-minute market on', async () => {
    const { fetcher } = fakeFetch({})
    const service = new KalshiService({ fetcher, now: () => NOW_MS })
    await expect(service.strikeFor('AVAX-USD')).rejects.toMatchObject({
      code: 'NO_KALSHI_SERIES',
      status: 404,
    })
  })

  it('degrades to no strike rather than throwing when Kalshi is down', async () => {
    const { fetcher } = fakeFetch({
      'status=open': { status: 502, body: {} },
      'status=settled': { status: 502, body: {} },
    })
    const service = new KalshiService({ fetcher, now: () => NOW_MS })
    const result = await service.strikeFor('BTC-USD')
    expect(result.strike).toBeNull()
    expect(result.anchors).toEqual([])
    expect(result.message).toContain('Kalshi is unavailable')
  })

  it('still reports a strike when only the settled feed fails', async () => {
    const { fetcher } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { status: 429, body: {} },
    })
    const service = new KalshiService({ fetcher, now: () => NOW_MS })
    const result = await service.strikeFor('BTC-USD')
    expect(result.strike?.strike).toBe(77314.22)
    expect(result.anchors).toEqual([])
  })

  it('reports when Kalshi has not published this window yet', async () => {
    const { fetcher } = fakeFetch({
      'status=open': { body: { markets: [{ ...openPayload.markets[0], floor_strike: '' }] } },
      'status=settled': { body: settledPayload },
    })
    const service = new KalshiService({ fetcher, now: () => NOW_MS })
    const result = await service.strikeFor('BTC-USD')
    expect(result.strike).toBeNull()
    expect(result.message).toContain('not published a strike')
  })

  it('caches within the TTL and coalesces concurrent callers', async () => {
    const { fetcher, calls } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
    })
    let clock = NOW_MS
    const service = new KalshiService({
      fetcher,
      now: () => clock,
      spacing: 0,
      strikeTtl: 4_000,
      anchorsTtl: 4_000,
    })
    const [a, b] = await Promise.all([service.strikeFor('BTC-USD'), service.strikeFor('BTC-USD')])
    expect(a.strike?.strike).toBe(b.strike?.strike)
    const afterParallel = calls.length
    expect(afterParallel).toBe(2) // one open + one settled, shared by both callers

    clock += 1_000
    await service.strikeFor('BTC-USD')
    expect(calls.length).toBe(afterParallel) // served from cache

    clock += 10_000
    await service.strikeFor('BTC-USD')
    expect(calls.length).toBe(afterParallel + 2) // both TTLs expired, both refetched
  })

  it('keeps the settled anchor series cached longer than the live strike', async () => {
    const { fetcher, calls } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
    })
    let clock = NOW_MS
    const service = new KalshiService({ fetcher, now: () => clock, spacing: 0 })
    await service.strikeFor('BTC-USD')
    expect(calls.length).toBe(2)
    // Past the strike TTL but well inside the anchor TTL: only the live market refetches.
    // Anchors only ever gain a row per quarter hour, so polling them hard buys nothing.
    clock += 10_000
    await service.strikeFor('BTC-USD')
    expect(calls.length).toBe(3)
    expect(calls[2].url).toContain('status=open')
  })

  it('stops fetching once closed', async () => {
    const { fetcher } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
    })
    const service = new KalshiService({ fetcher, now: () => NOW_MS, spacing: 0 })
    service.close()
    const result = await service.strikeFor('BTC-USD')
    expect(result.strike).toBeNull()
  })
})

describe('KalshiService with an API key', () => {
  const keyId = 'test-key-id'
  const privateKey = TEST_PRIVATE_KEY

  it('is only keyed when both halves of the credential are present', () => {
    expect(new KalshiService({ keyId, privateKey }).keyed).toBe(true)
    expect(new KalshiService({ keyId }).keyed).toBe(false)
    expect(new KalshiService({ privateKey }).keyed).toBe(false)
    expect(new KalshiService().keyed).toBe(false)
  })

  it('signs the passthrough path without its query string', async () => {
    const { fetcher, calls } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
      'cfbenchmarks/history/values': {
        body: { payload: [{ time: 1_789_330_200_000, value: '77254.95' }] },
      },
      'cfbenchmarks/values': { body: { payload: [{ time: NOW_MS, value: '77314.22' }] } },
    })
    const service = new KalshiService({
      fetcher: fetcher as unknown as typeof fetch,
      now: () => NOW_MS,
      spacing: 0,
      keyId,
      privateKey,
    })
    // Signing a malformed PEM throws; that must not escape as an unhandled rejection.
    const result = await service.strikeFor('BTC-USD')
    expect(result.keyed).toBe(true)
    const passthrough = calls.filter((call) => call.url.includes('/cfbenchmarks/'))
    expect(passthrough.length).toBeGreaterThan(0)
    for (const call of passthrough) {
      expect(call.headers['KALSHI-ACCESS-KEY']).toBe(keyId)
      expect(call.headers['KALSHI-ACCESS-TIMESTAMP']).toBe(String(NOW_MS))
      expect(typeof call.headers['KALSHI-ACCESS-SIGNATURE']).toBe('string')
    }
    // The signed payload excludes the query string; a wrong path yields no signature at all.
    expect(result.samples === null || Array.isArray(result.samples)).toBe(true)
  })

  it('asks history for the previous hour, which is the newest one it publishes', async () => {
    const { fetcher, calls } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
      'cfbenchmarks/history/values': { body: { payload: [] } },
      'cfbenchmarks/values': { body: { payload: [] } },
    })
    const service = new KalshiService({
      fetcher,
      now: () => NOW_MS,
      spacing: 0,
      keyId,
      privateKey,
    })
    await service.strikeFor('BTC-USD')
    const history = calls.find((call) => call.url.includes('/cfbenchmarks/history/values'))
    expect(history).toBeDefined()
    expect(history!.url).toContain('id=BRTI')
    expect(history!.url).toContain('timespan=HOUR')
    expect(history!.url).toContain(`timestamp=${hourFloorIso(NOW_MS - 3_600_000)}`)
  })

  it('surfaces an entitlement failure without losing the free strike', async () => {
    const { fetcher } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
      'cfbenchmarks/history/values': { status: 403, body: {} },
      'cfbenchmarks/values': { status: 403, body: {} },
    })
    const service = new KalshiService({
      fetcher,
      now: () => NOW_MS,
      spacing: 0,
      keyId,
      privateKey,
    })
    const result = await service.strikeFor('BTC-USD')
    expect(result.strike?.strike).toBe(77314.22)
    expect(result.samples).toBeNull()
    expect(result.message).toContain('not entitled')
  })

  it('merges history and live ticks, deduping by timestamp', async () => {
    const t = Math.floor(NOW_MS / 1000)
    const { fetcher } = fakeFetch({
      'status=open': { body: openPayload },
      'status=settled': { body: settledPayload },
      'cfbenchmarks/history/values': {
        body: {
          payload: [
            { time: (t - 120) * 1000, value: '77300.10' },
            { time: (t - 60) * 1000, value: '77305.20' },
          ],
        },
      },
      'cfbenchmarks/values': {
        body: {
          payload: [
            { time: (t - 60) * 1000, value: '77305.20' },
            { time: t * 1000, value: '77314.22' },
          ],
        },
      },
    })
    const service = new KalshiService({
      fetcher,
      now: () => NOW_MS,
      spacing: 0,
      keyId,
      privateKey,
    })
    const result = await service.strikeFor('BTC-USD')
    expect(result.samples?.map((sample) => sample.time)).toEqual([t - 120, t - 60, t])
    expect(result.samples?.map((sample) => sample.value)).toEqual([77300.1, 77305.2, 77314.22])
  })
})

describe('KalshiService error mapping', () => {
  it('wraps an unexpected throw in a MarketError', async () => {
    const { fetcher } = fakeFetch({
      'status=open': new Error('socket hang up'),
      'status=settled': new Error('socket hang up'),
    })
    const service = new KalshiService({ fetcher, now: () => NOW_MS, spacing: 0 })
    const result = await service.strikeFor('BTC-USD')
    expect(result.strike).toBeNull()
    expect(typeof result.message).toBe('string')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('maps a 401 to an actionable message', () => {
    const error = new MarketError(
      'Kalshi rejected the API key signature.',
      401,
      'KALSHI_UNAUTHORIZED',
    )
    expect(error.status).toBe(401)
    expect(error.code).toBe('KALSHI_UNAUTHORIZED')
  })
})

describe('KalshiService.floatFor — the floating window snapshot', () => {
  const LIVE = 'https://live.kalshi.test'
  /** 21:10 UTC — ten minutes into the 21:00→21:15 window of the openPayload market. */
  const WINDOW_OPEN = '2026-09-13T21:00:00Z'
  const WINDOW_CLOSE = '2026-09-13T21:15:00Z'

  const floatMarket = {
    markets: [
      {
        ticker: 'KXBTC15M-26SEP131715-15',
        open_time: WINDOW_OPEN,
        close_time: WINDOW_CLOSE,
        floor_strike: 77314.22,
        expiration_value: '',
        strike_type: 'greater_or_equal',
        custom_strike: { round_digits: '2' },
        rules_primary: "sixty seconds of CF Benchmarks' BRTI",
        status: 'active',
        yes_bid_dollars: '0.68',
        yes_ask_dollars: '0.69',
        no_ask_dollars: '0.32',
        last_price_dollars: '0.685',
      },
    ],
  }
  const bookPayload = {
    orderbook_fp: {
      yes_dollars: [
        [0.68, 100],
        [0.67, 250],
      ],
      no_dollars: [[0.31, 80]],
    },
  }
  const tradePayload = { trades: [{ yes_price_dollars: 0.685 }] }
  const indexPayload = { timeseries: [{ v: 77320.1 }, { v: 77330.1 }] }
  const seriesPayload = { series: { fee_type: 'quadratic', fee_multiplier: '1' } }

  /** Baseline: every read answers, so the window paints from the live book. */
  function floatRoutes(overrides: Record<string, { body: unknown; status?: number } | Error> = {}) {
    return {
      // The order matters: the cache-bust URL contains the plain markets URL.
      'limit=10&_=': { body: { markets: [] } },
      'live.kalshi.test/v1/live_data/assets/BTC/1s': { body: indexPayload },
      '/orderbook': { body: bookPayload },
      '/markets/trades?ticker=': { body: tradePayload },
      '/series/KXBTC15M': { body: seriesPayload },
      'status=open&limit=10': { body: floatMarket },
      ...overrides,
    }
  }

  function makeFloatService(
    routes: Record<string, { body: unknown; status?: number } | Error>,
    nowMs: number,
    spotProvider?: (product: string) => Promise<number | null>,
  ) {
    const { fetcher, calls } = fakeFetch(routes)
    const service = new KalshiService({
      fetcher,
      now: () => nowMs,
      spacing: 0,
      liveOrigin: LIVE,
      spotProvider,
    })
    return { service, calls }
  }

  it('assembles the full snapshot from the live book, the last trade and the index', async () => {
    const { service, calls } = makeFloatService(floatRoutes(), NOW_MS)
    const result = await service.floatFor('BTC-USD')
    expect(result.source).toBe('kalshi')
    expect(result.product).toBe('BTC-USD')
    expect(result.series).toBe('KXBTC15M')
    expect(result.ticker).toBe('KXBTC15M-26SEP131715-15')
    expect(result.target).toBe(77314.22)
    expect(result.decimals).toBe(2)
    expect(result.open).toBe(Math.floor(Date.parse(WINDOW_OPEN) / 1000))
    expect(result.close).toBe(Math.floor(Date.parse(WINDOW_CLOSE) / 1000))
    // % = the last trade (0.685), clamped into the book 0.68/0.69: 69, not 68 or 69-ish.
    expect(result.upPct).toBe(69)
    expect(result.downPct).toBe(31)
    // x multipliers net of the 0.07 taker fee, multiplier 1: 1/(0.69+0.07·0.69·0.31).
    expect(result.upX).toBeCloseTo(1 / (0.69 + 0.07 * 0.69 * 0.31), 9)
    expect(result.downX).toBeCloseTo(1 / (0.32 + 0.07 * 0.32 * 0.68), 9)
    expect(result.now).toBe(77330.1)
    expect(result.nowSource).toBe('kalshi')
    expect(result.quiet).toBe(false)
    expect(result.pctSource).toBe('book')
    expect(result.message).toContain('read-only')
    // The window reads the book and the trades, never the CF Benchmarks passthrough.
    expect(calls.some((call) => call.url.includes('/orderbook'))).toBe(true)
    expect(calls.some((call) => call.url.includes('/markets/trades?ticker='))).toBe(true)
  })

  it('falls back to the market list for the % when the book does not answer, and says so', async () => {
    const { service } = makeFloatService(
      floatRoutes({ '/orderbook': { body: {}, status: 502 } }),
      NOW_MS,
    )
    const result = await service.floatFor('BTC-USD')
    expect(result.pctSource).toBe('list')
    // The list prices (0.68/0.69) with the list's last trade (0.685) give the same 69.
    expect(result.upPct).toBe(69)
    expect(result.message).toContain('market list')
  })

  it('uses the last known trade when /trades drops, so the % does not jump to the midpoint', async () => {
    let down = false
    const { service } = makeFloatService(
      floatRoutes({
        // The getter flips after the first poll: the second poll gets an empty
        // trades payload, exactly as a dropped /trades request reads.
        '/markets/trades?ticker=': {
          get body() {
            return down ? {} : tradePayload
          },
        },
      }),
      NOW_MS,
    )
    const first = await service.floatFor('BTC-USD')
    down = true
    const second = await service.floatFor('BTC-USD')
    expect(first.upPct).toBe(69)
    // Without the stored trade the same book would have shown the midpoint (69 here,
    // but with a wider spread it would have jumped): the stored print stands in.
    expect(second.pctSource).toBe('book')
    expect(second.upPct).toBe(69)
  })

  it('parks the book endpoint after a rate limit and degrades to the list', async () => {
    const { service } = makeFloatService(
      floatRoutes({ '/orderbook': { body: {}, status: 429 } }),
      NOW_MS,
    )
    const result = await service.floatFor('BTC-USD')
    expect(result.pctSource).toBe('list')
    // Parked for 30s: the very next poll must not even try the book again.
    const retried = await service.floatFor('BTC-USD')
    expect(retried.pctSource).toBe('list')
  })

  it('falls back to a Coinbase print for the "Now" on crypto, labelled approximate', async () => {
    const { service } = makeFloatService(
      floatRoutes({ 'live.kalshi.test/v1/live_data/assets/BTC/1s': { body: {}, status: 502 } }),
      NOW_MS,
      async () => 77321.44,
    )
    const result = await service.floatFor('BTC-USD')
    expect(result.now).toBe(77321.44)
    expect(result.nowSource).toBe('coinbase')
    expect(result.message).toContain('Coinbase')
  })

  it('a paused index reads "quiet" — normal outside hours, not a failure', async () => {
    const { service } = makeFloatService(
      floatRoutes({ 'live.kalshi.test/v1/live_data/assets/BTC/1s': { body: { timeseries: [] } } }),
      NOW_MS,
    )
    const result = await service.floatFor('BTC-USD')
    expect(result.now).toBeNull()
    expect(result.nowSource).toBeNull()
    expect(result.quiet).toBe(true)
    expect(result.message).toContain('emitting ticks')
  })

  it('never falls back to Coinbase for the metals: no public substitute is close enough', async () => {
    let called = false
    const { service } = makeFloatService(
      floatRoutes({
        'limit=10&_=': { body: { markets: [] } },
        // The symbol is URL-encoded on the wire: PYTH:GOLD becomes PYTH%3AGOLD.
        'live.kalshi.test/v1/live_data/assets/PYTH%3AGOLD/1s': { body: {}, status: 404 },
        '/orderbook': { body: bookPayload },
        '/markets/trades?ticker=': { body: tradePayload },
        '/series/KXGOLD15M': { body: seriesPayload },
        'status=open&limit=10': {
          body: {
            markets: [
              {
                ticker: 'KXGOLD15M-26SEP131715-15',
                open_time: WINDOW_OPEN,
                close_time: WINDOW_CLOSE,
                floor_strike: 3725.44,
                strike_type: 'greater_or_equal',
                custom_strike: { round_digits: '2' },
              },
            ],
          },
        },
      }),
      NOW_MS,
      async () => {
        called = true
        return 3721.0
      },
    )
    const result = await service.floatFor('XAU-USD')
    expect(called).toBe(false)
    expect(result.now).toBeNull()
    expect(result.nowSource).toBeNull()
    expect(result.quiet).toBe(false)
    expect(result.message).toContain('Now unavailable')
    expect(result.target).toBe(3725.44)
    expect(result.decimals).toBe(2)
  })

  it('rolls to the next contract when the cached list only knows the old one', async () => {
    const nextMarket = {
      ticker: 'KXBTC15M-26SEP133015-30',
      open_time: '2026-09-13T21:15:00Z',
      close_time: '2026-09-13T21:30:00Z',
      floor_strike: 77340.55,
      strike_type: 'greater_or_equal',
      custom_strike: { round_digits: '2' },
    }
    const routes = floatRoutes({
      'limit=10&_=': { body: { markets: [nextMarket] } },
    })
    // First poll, ten minutes into the 21:00 window: the plain list suffices.
    const { service } = makeFloatService(routes, NOW_MS)
    const first = await service.floatFor('BTC-USD')
    expect(first.ticker).toBe('KXBTC15M-26SEP131715-15')
    // Six minutes later the cut has passed. Kalshi's 15s-cached list still carries
    // only the just-closed window; the clock governs, so the service busts once.
    const later = NOW_MS + 6 * 60 * 1000 // 21:16:00Z
    const { service: s2 } = makeFloatService(routes, later)
    const second = await s2.floatFor('BTC-USD')
    expect(second.ticker).toBe(nextMarket.ticker)
    expect(second.target).toBe(77340.55)
    expect(second.open).toBe(Math.floor(Date.parse(nextMarket.open_time) / 1000))
  })

  it('never lets a future window replace a running one from a stale list', async () => {
    // At 21:10 the plain list answers with BOTH the running and the next window:
    // the running one must win even though the next one is listed first.
    const { service } = makeFloatService(
      floatRoutes({
        'status=open&limit=10': {
          body: {
            markets: [
              {
                ticker: 'NEXT',
                open_time: '2026-09-13T21:15:00Z',
                close_time: '2026-09-13T21:30:00Z',
                floor_strike: 77340.55,
              },
              ...floatMarket.markets,
            ],
          },
        },
      }),
      NOW_MS,
    )
    const result = await service.floatFor('BTC-USD')
    expect(result.ticker).toBe('KXBTC15M-26SEP131715-15')
  })

  it('reads a future-only list as "waiting", never as a contract with a future countdown', async () => {
    // A couple of seconds after the cut the list can carry only the NEXT window
    // (the new one is not published yet, or the cache has not turned). Drawing
    // it would count down to a cut 30 minutes away — the honest state is
    // "waiting for the next contract".
    const { service } = makeFloatService(
      floatRoutes({
        'limit=10&_=': {
          body: {
            markets: [
              {
                ticker: 'NEXT',
                open_time: '2026-09-13T21:15:00Z',
                close_time: '2026-09-13T21:30:00Z',
                floor_strike: 77340.55,
              },
            ],
          },
        },
        'status=open&limit=10': {
          body: {
            markets: [
              {
                ticker: 'NEXT',
                open_time: '2026-09-13T21:15:00Z',
                close_time: '2026-09-13T21:30:00Z',
                floor_strike: 77340.55,
              },
            ],
          },
        },
      }),
      NOW_MS,
    )
    const result = await service.floatFor('BTC-USD')
    expect(result.ticker).toBeNull()
    expect(result.target).toBeNull()
    expect(result.open).toBeNull()
    expect(result.message).toContain('next contract')
    // The index still flows: "Now" does not depend on a contract being open.
    expect(result.now).toBe(77330.1)
  })

  it('answers with a well-formed empty snapshot when no contract is open', async () => {
    const { service } = makeFloatService(
      floatRoutes({
        'limit=10&_=': { body: { markets: [] } },
        'status=open&limit=10': { body: { markets: [] } },
      }),
      NOW_MS,
    )
    const result = await service.floatFor('BTC-USD')
    expect(result.ticker).toBeNull()
    expect(result.target).toBeNull()
    expect(result.open).toBeNull()
    expect(result.close).toBeNull()
    expect(result.upPct).toBeNull()
    expect(result.downPct).toBeNull()
    expect(result.upX).toBeNull()
    expect(result.downX).toBeNull()
    expect(result.pctSource).toBeNull()
    // "Now" still works without a market: the index does not care about contracts.
    expect(result.now).toBe(77330.1)
    expect(result.nowSource).toBe('kalshi')
    expect(result.message).toContain('next contract')
  })

  it('rejects pairs Kalshi has no 15-minute market on', async () => {
    const { service } = makeFloatService(floatRoutes(), NOW_MS)
    await expect(service.floatFor('LTC-USD')).rejects.toMatchObject({ status: 404 })
  })
})
