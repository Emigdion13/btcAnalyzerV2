import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { CoinbaseRestClient } from './rest-client'
import { CoinbaseService } from './coinbase-service'
import { KalshiService } from './kalshi-service'
import { createMarketApi } from './api'
import { collectGarbage, parseMaintenanceMinutes } from './maintenance'

/** 2026-09-13T21:10:00Z — matches the Kalshi service test window. */
const NOW_MS = Date.parse('2026-09-13T21:10:00Z')

const coinPayload = {
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
  ],
}

const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

describe('maintenance interval parsing', () => {
  it('defaults to thirty minutes and accepts explicit values', () => {
    expect(parseMaintenanceMinutes(undefined)).toBe(30)
    expect(parseMaintenanceMinutes('')).toBe(30)
    expect(parseMaintenanceMinutes('  ')).toBe(30)
    expect(parseMaintenanceMinutes('0')).toBe(0)
    expect(parseMaintenanceMinutes('45')).toBe(45)
    expect(parseMaintenanceMinutes('10080')).toBe(10080)
  })
  it('rejects values that would silently disable maintenance', () => {
    for (const raw of ['-5', '1.5', 'banana', '99999', 'Infinity', 'NaN'])
      expect(() => parseMaintenanceMinutes(raw)).toThrow('ATLAS_MAINTENANCE_MINUTES')
  })
})

describe('garbage collection hook', () => {
  it('reports honestly when Node was started without --expose-gc', () => {
    expect(collectGarbage()).toBe(false)
    const gc = vi.fn()
    vi.stubGlobal('gc', gc)
    expect(collectGarbage()).toBe(true)
    expect(gc).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('CoinbaseRestClient purge', () => {
  it('drops only cache entries recorded before the cutoff', async () => {
    const calls: URL[] = []
    const fetcher = (async (input: string | URL | Request) => {
      calls.push(new URL(String(input)))
      return Response.json([
        { id: 'BTC-USD', quote_currency: 'USD', quote_increment: '.01', status: 'online' },
      ])
    }) as typeof fetch
    const rest = new CoinbaseRestClient(fetcher, 0)
    await rest.get('/products', 60_000)
    await rest.get('/products', 60_000)
    expect(calls).toHaveLength(1)
    // A fresh entry stays; the sweep is not a TTL override.
    expect(rest.purge(Date.now() - 60_000)).toBe(0)
    await rest.get('/products', 60_000)
    expect(calls).toHaveLength(1)
    // Anything recorded before the cutoff goes, even if some caller once used a long TTL.
    expect(rest.purge(Date.now() + 1)).toBe(1)
    await rest.get('/products', 60_000)
    expect(calls).toHaveLength(2)
    rest.close()
  })
})

describe('CoinbaseService purge', () => {
  function fixture() {
    const calls: URL[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      calls.push(url)
      if (url.pathname === '/products')
        return Response.json(
          ['BTC', 'ETH'].map((base) => ({
            id: `${base}-USD`,
            quote_currency: 'USD',
            quote_increment: '.01',
            status: 'online',
          })),
        )
      if (url.pathname.endsWith('/stats'))
        return Response.json({ last: '120', open: '100', high: '130', low: '90', volume: '5' })
      if (url.pathname.endsWith('/candles')) {
        const granularity = Number(url.searchParams.get('granularity'))
        const start =
          Math.floor(Date.parse(url.searchParams.get('start')!) / 1000 / granularity) * granularity
        const end = Date.parse(url.searchParams.get('end')!) / 1000
        const data = []
        for (let time = start; time <= end; time += granularity)
          data.push([time, 99, 102, 100, 101, 2])
        return Response.json(data.reverse())
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    const rest = new CoinbaseRestClient(fetcher, 0)
    const service = new CoinbaseService({ rest })
    return { rest, service, calls }
  }

  it('keeps every byte a live chart needs and drops the rest', async () => {
    const { service, calls } = fixture()
    await service.getHistory('BTC-USD', '1m', 50)
    await service.getHistory('ETH-USD', '1m', 50)
    await service.getQuotes(['BTC-USD', 'ETH-USD'])
    const unsubscribe = await service.subscribe('BTC-USD', '1m', ['BTC-USD'], () => {}, 50)
    const report = service.purge(Date.now() + 1)
    // The unwatched pair's history and quote go; the charted pair's stay.
    expect(report.histories).toBe(1)
    expect(report.quotes).toBe(1)
    expect(report.restEntries).toBeGreaterThanOrEqual(4)
    const candleCalls = () => calls.filter((c) => c.pathname.endsWith('/candles')).length
    const candlesBefore = candleCalls()
    // The subscribed chart still serves its candles from memory. Only the purged
    // products catalog page refetches, once, on the next validation.
    await service.getHistory('BTC-USD', '1m', 50)
    expect(candleCalls()).toBe(candlesBefore)
    // The dropped pair is simply re-fetched on demand.
    await service.getHistory('ETH-USD', '1m', 50)
    expect(candleCalls()).toBe(candlesBefore + 1)
    unsubscribe()
    service.close()
  })

  it('sweeps everything when no chart is connected', async () => {
    const { service } = fixture()
    await service.getHistory('BTC-USD', '1m', 50)
    await service.getQuotes(['BTC-USD'])
    const report = service.purge(Date.now() + 1)
    expect(report.histories).toBe(1)
    expect(report.quotes).toBe(1)
    service.close()
  })
})

describe('KalshiService purge', () => {
  function kalshiFixture(extra: Record<string, unknown> = {}) {
    const calls: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('status=open')) return Response.json(coinPayload)
      if (url.includes('status=settled')) return Response.json(settledPayload)
      if (url.includes('cfbenchmarks/history/values'))
        return Response.json({ payload: [{ time: NOW_MS - 3_600_000, value: '77254.95' }] })
      if (url.includes('cfbenchmarks/values'))
        return Response.json({ payload: [{ time: NOW_MS, value: '77314.22' }] })
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    let clock = NOW_MS
    const service = new KalshiService({
      fetcher,
      now: () => clock,
      spacing: 0,
      ...extra,
    })
    return { service, calls, advanceClock: (ms: number) => (clock += ms) }
  }

  it('drops settled page cache entries so the map cannot grow forever', async () => {
    const { service, calls } = kalshiFixture()
    await service.strikeFor('BTC-USD')
    const afterFirst = calls.length
    expect(afterFirst).toBeGreaterThan(0)
    const report = service.purge(NOW_MS + 1)
    expect(report.pages).toBe(2)
    expect(report.sampleBuffers).toBe(0)
    // Purged entries are re-fetched, not served from the stale cache.
    await service.strikeFor('BTC-USD')
    expect(calls.length).toBe(afterFirst + 2)
    service.close()
  })

  it('keeps fresh index buffers and retires ones past the two-hour window', async () => {
    const { service, advanceClock } = kalshiFixture({
      keyId: 'test-key-id',
      privateKey: TEST_PRIVATE_KEY,
    })
    expect(service.keyed).toBe(true)
    await service.strikeFor('BTC-USD')
    // The buffer's newest sample is one hour old — well inside the window.
    expect(service.purge(NOW_MS + 1).sampleBuffers).toBe(0)
    // Three hours later the buffer describes data no chart can still show.
    advanceClock(3 * 3_600_000)
    expect(service.purge(NOW_MS + 1).sampleBuffers).toBe(1)
    service.close()
  })
})

describe('market API maintenance wiring', () => {
  function stubServices() {
    const service = {
      purge: vi.fn((cutoff: number) => ({
        cutoff,
        histories: 0,
        quotes: 0,
        tradeIds: 0,
        failures: 0,
        restEntries: 0,
      })),
      close: vi.fn(),
    }
    const kalshi = {
      purge: vi.fn((cutoff: number) => ({ cutoff, pages: 0, sampleBuffers: 0 })),
      close: vi.fn(),
    }
    return { service, kalshi }
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('purges on demand and on the thirty-minute schedule until closed', () => {
    vi.useFakeTimers()
    const { service, kalshi } = stubServices()
    const api = createMarketApi(
      service as unknown as CoinbaseService,
      kalshi as unknown as KalshiService,
    )
    api.purge()
    expect(service.purge).toHaveBeenCalledTimes(1)
    expect(kalshi.purge).toHaveBeenCalledTimes(1)
    // The cutoff hands the REST client the hottest-TTL horizon, not "now".
    const age = Date.now() - (service.purge.mock.calls[0]?.[0] as number)
    expect(age).toBeGreaterThanOrEqual(15 * 60_000)
    expect(age).toBeLessThan(16 * 60_000)
    vi.advanceTimersByTime(30 * 60_000)
    expect(service.purge).toHaveBeenCalledTimes(2)
    api.close()
    vi.advanceTimersByTime(30 * 60_000)
    expect(service.purge).toHaveBeenCalledTimes(2)
  })

  it('schedules nothing when the sweep is disabled', () => {
    vi.stubEnv('ATLAS_MAINTENANCE_MINUTES', '0')
    vi.useFakeTimers()
    const { service, kalshi } = stubServices()
    const api = createMarketApi(
      service as unknown as CoinbaseService,
      kalshi as unknown as KalshiService,
    )
    vi.advanceTimersByTime(6 * 60 * 60_000)
    expect(service.purge).not.toHaveBeenCalled()
    expect(kalshi.purge).not.toHaveBeenCalled()
    api.purge()
    expect(service.purge).toHaveBeenCalledTimes(1)
    api.close()
  })

  it('rejects an invalid maintenance interval at startup', () => {
    vi.stubEnv('ATLAS_MAINTENANCE_MINUTES', 'banana')
    const { service, kalshi } = stubServices()
    expect(() =>
      createMarketApi(service as unknown as CoinbaseService, kalshi as unknown as KalshiService),
    ).toThrow('ATLAS_MAINTENANCE_MINUTES')
  })
})
