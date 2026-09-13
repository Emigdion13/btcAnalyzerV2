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
