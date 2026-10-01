import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DerivativesService, POLL_MS } from './derivatives-service'

class FakeSocket extends EventTarget {
  readyState = 0
  sent: string[] = []
  constructor(readonly url: string) {
    super()
    queueMicrotask(() => {
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    })
  }
  send(value: string) {
    this.sent.push(value)
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
  emit(value: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }
}

/** Every venue, answering with whatever `market` holds at the moment of the request. */
function venues() {
  const market = { oiScale: 1, price: 84_000 }
  const calls: string[] = []
  const quietHistory = (now: number, value: (i: number) => number) =>
    Array.from({ length: 120 }, (_, i) => {
      const ts = String((Math.floor(now / 300_000) - i) * 300_000)
      return [ts, String(value(i)), String(value(i)), String(value(i)), String(value(i))]
    })
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}`)
    const { oiScale, price } = market
    const json = (value: unknown) => Response.json(value)
    if (url.pathname === '/api/v5/public/instruments')
      return json({ data: [{ instId: 'BTC-USDT-SWAP', ctVal: '0.01', ctValCcy: 'BTC' }] })
    if (url.pathname.endsWith('/open-interest-history'))
      return json({
        data: url.searchParams.get('end')
          ? []
          : quietHistory(Date.now(), (i) => 28_000 + ((i * 7) % 5)),
      })
    if (url.pathname.endsWith('/history-candles'))
      return json({
        data: url.searchParams.get('after')
          ? []
          : quietHistory(Date.now(), (i) => 84_000 + ((i * 3) % 7)),
      })
    if (url.pathname === '/api/v5/public/open-interest')
      return json({ data: [{ instId: 'BTC-USDT-SWAP', oiCcy: String(28_000 * oiScale) }] })
    if (url.pathname === '/api/v5/public/mark-price')
      return json({ data: [{ instId: 'BTC-USDT-SWAP', markPx: String(price) }] })
    if (url.pathname === '/api/v5/public/funding-rate')
      return json({ data: [{ fundingRate: '0.0001' }] })
    if (url.host === 'futures.kraken.com')
      return json({
        tickers: [
          {
            symbol: 'PF_XBTUSD',
            openInterest: 2_400 * oiScale,
            markPrice: price,
            fundingRate: 0.5,
          },
        ],
      })
    if (url.host === 'api.hyperliquid.xyz')
      return json([
        { universe: [{ name: 'BTC' }] },
        [{ openInterest: String(34_000 * oiScale), markPx: String(price), funding: '0.00001' }],
      ])
    if (url.host === 'www.deribit.com')
      return json({
        result: [
          {
            instrument_name: 'BTC-PERPETUAL',
            open_interest: 9_500 * oiScale * price,
            mark_price: price,
            funding_8h: 0.00005,
          },
        ],
      })
    if (url.host === 'api.international.coinbase.com')
      return json({ open_interest: String(1_000 * oiScale), quote: { mark_price: String(price) } })
    return new Response('not found', { status: 404 })
  }
  return { market, calls, fetcher }
}

let service: DerivativesService | undefined
beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 8, 30, 12, 0, 0) })
})
afterEach(() => {
  service?.close()
  service = undefined
  vi.useRealTimers()
})

it('subscribes each liquidation feed and reads a long squeeze from five venues', async () => {
  const { market, fetcher } = venues()
  const sockets: FakeSocket[] = []
  service = new DerivativesService({
    fetcher,
    socketFactory: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
  })
  const release = service.watch('BTC-USD')
  await vi.advanceTimersByTimeAsync(3_000)

  const byHost = (host: string) => sockets.find((s) => s.url.includes(host))!
  expect(byHost('okx').sent.map((m) => JSON.parse(m))).toContainEqual({
    op: 'subscribe',
    args: [{ channel: 'liquidation-orders', instType: 'SWAP' }],
  })
  expect(JSON.parse(byHost('kraken').sent[0])).toMatchObject({
    event: 'subscribe',
    feed: 'trade',
    product_ids: ['PF_XBTUSD'],
  })
  expect(JSON.parse(byHost('deribit').sent[0]).params.channels).toEqual([
    'trades.BTC-PERPETUAL.100ms',
  ])

  // Five minutes later every venue's OI is 2% lower and price 1.2% lower: longs are being closed.
  await vi.advanceTimersByTimeAsync(300_000 - 3_000 - POLL_MS)
  market.oiScale = 0.98
  market.price = 83_000
  await vi.advanceTimersByTimeAsync(POLL_MS)
  const flow = service.snapshot('BTC-USD', Date.now() / 1000)!
  expect(flow.thresholds.calibrated).toBe(true)
  expect(flow.oiVenues.sort()).toEqual(['coinbase-intl', 'deribit', 'hyperliquid', 'kraken', 'okx'])
  expect(flow.oiChange).toBeCloseTo(-0.02, 6)
  expect(flow.priceChange).toBeCloseTo(83_000 / 84_000 - 1, 6)
  expect(flow.state).toBe('longs-liquidating')
  expect(flow.funding.venues).toEqual(
    expect.arrayContaining(['okx', 'kraken', 'deribit', 'hyperliquid']),
  )

  // A live Kraken liquidation of a long lands on the BTC tracker.
  byHost('kraken').emit({
    feed: 'trade',
    type: 'liquidation',
    product_id: 'PF_XBTUSD',
    side: 'sell',
    qty: 2,
    price: 83_000,
    time: Date.now(),
  })
  const after = service.snapshot('BTC-USD', Date.now() / 1000)!
  expect(after.liquidations.longUsd).toBe(166_000)
  expect(after.feeds.kraken).toBe('live')

  // Letting go of the last chart closes every socket shortly after.
  release()
  await vi.advanceTimersByTimeAsync(6_000)
  expect(sockets.every((s) => s.readyState === 3)).toBe(true)
  expect(service.snapshot('BTC-USD', Date.now() / 1000)).toBeUndefined()

  // A chart that comes back (a tab shown again) resumes the same tracker: the squeeze it saw is
  // still listed and the thresholds are still calibrated.
  service.watch('BTC-USD')
  const resumed = service.snapshot('BTC-USD', Date.now() / 1000)!
  expect(resumed.events.map((e) => e.state)).toEqual(['longs-liquidating'])
  expect(resumed.thresholds.calibrated).toBe(true)
})

it('stays quiet until something is watched, and ignores products it cannot map', async () => {
  const { calls, fetcher } = venues()
  const sockets: string[] = []
  service = new DerivativesService({
    fetcher,
    socketFactory: (url) => {
      sockets.push(url)
      return new FakeSocket(url) as unknown as WebSocket
    },
  })
  await vi.advanceTimersByTimeAsync(POLL_MS * 2)
  expect(calls).toEqual([])
  expect(sockets).toEqual([])
  service.watch('not a product')
  expect(service.snapshot('not a product', 0)).toBeUndefined()
})
