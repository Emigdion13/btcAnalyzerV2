import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CoinbaseRestClient } from './rest-client'
import { CoinbaseService } from './coinbase-service'
import { createMarketApi } from './api'

const closers: (() => void)[] = []
afterEach(() => {
  closers.splice(0).forEach((close) => close())
})
function fixture() {
  const calls: URL[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url)
    if (url.pathname === '/products')
      return Response.json(
        ['BTC', 'ETH', 'SOL'].map((base) => ({
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
      for (let time = start; time <= end; time += granularity) {
        const price = 100 + ((time / granularity) % 10)
        data.push([time, price - 1, price + 2, price, price + 1, 2])
      }
      expect(data.length).toBeLessThanOrEqual(300)
      return Response.json(data.reverse())
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
  const rest = new CoinbaseRestClient(fetcher, 0)
  const service = new CoinbaseService({ rest })
  closers.push(() => service.close())
  return { rest, service, calls }
}

describe('same-origin Coinbase API', () => {
  it('coalesces and caches repeated upstream requests', async () => {
    const { rest, calls } = fixture()
    await Promise.all([rest.get('/products', 60000), rest.get('/products', 60000)])
    await rest.get('/products', 60000)
    expect(calls).toHaveLength(1)
    await expect(rest.get('https://evil.example/')).rejects.toThrow('Invalid upstream')
  })
  it('backfills 300 3m bars using Coinbase 1m data only', async () => {
    const { service, calls } = fixture()
    const snapshot = await service.getHistory('BTC-USD', '3m', 300)
    expect(snapshot.candles).toHaveLength(300)
    expect(snapshot.candles.every((c) => c.time % 180 === 0)).toBe(true)
    expect(snapshot.candles.slice(0, -1).every((c) => c.volume === 6)).toBe(true)
    const pages = calls.filter((c) => c.pathname.endsWith('/candles'))
    expect(pages).toHaveLength(3)
    expect(pages.every((p) => p.searchParams.get('granularity') === '60')).toBe(true)
    const count = calls.length
    await service.getHistory('BTC-USD', '3m', 300)
    expect(calls.length).toBe(count)
  })
  it('rejects unsupported products without issuing a candle request', async () => {
    const { service, calls } = fixture()
    await expect(service.getHistory('BNB-USD', '1m')).rejects.toThrow('not an available')
    expect(calls.every((c) => c.pathname === '/products')).toBe(true)
  })
  it('returns real quote fields and their exchange source', async () => {
    const { service } = fixture()
    const quotes = await service.getQuotes(['BTC-USD', 'ETH-USD'])
    expect(quotes.quotes['BTC-USD'].price).toBe(120)
    expect(quotes.quotes['ETH-USD'].change).toBeCloseTo(20)
    expect(quotes.quotes['BTC-USD'].source).toBe('coinbase')
  })
  it('returns an explicit upstream failure, never synthetic fallback data', async () => {
    const rest = new CoinbaseRestClient(
      (async () => {
        throw new Error('TLS unavailable')
      }) as typeof fetch,
      0,
    )
    const api = createMarketApi(new CoinbaseService({ rest }))
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
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/coinbase/candles?product=BTC-USD&interval=3m`,
    )
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.error).toBe('COINBASE_UNAVAILABLE')
    expect(body.candles).toBeUndefined()
  })
  it('validates the public HTTP boundary and serves the same candle contract', async () => {
    const { service } = fixture(),
      api = createMarketApi(service)
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
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    expect((await fetch(`${origin}/api/coinbase/candles?product=BTC-USD&interval=2m`)).status).toBe(
      400,
    )
    expect(
      (await fetch(`${origin}/api/coinbase/candles?product=BTC-USD&interval=1m&limit=999999`))
        .status,
    ).toBe(400)
    expect((await fetch(`${origin}/api/coinbase/products`, { method: 'POST' })).status).toBe(405)
    const response = await fetch(
      `${origin}/api/coinbase/candles?product=ETH-USD&interval=5m&limit=50`,
    )
    expect(response.status).toBe(200)
    expect((await response.json()).candles).toHaveLength(50)
  })
})

class FakeSocket extends EventTarget {
  readyState = 0
  sent: string[] = []
  constructor() {
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

it('bridges real SSE framing with batched trade updates and disconnection state', async () => {
  const { rest } = fixture()
  let socket: FakeSocket | undefined
  const service = new CoinbaseService({
    rest,
    socketFactory: (url) => {
      expect(url).toBe('wss://ws-feed.exchange.coinbase.com')
      socket = new FakeSocket()
      return socket as unknown as WebSocket
    },
  })
  const api = createMarketApi(service)
  const server = createServer((req, res) => {
    if (!api.handle(req, res)) res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const controller = new AbortController()
  closers.push(() => {
    controller.abort()
    api.close()
    server.closeAllConnections()
    server.close()
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await fetch(`${origin}/api/coinbase/candles?product=BTC-USD&interval=1m&limit=50`)
  const response = await fetch(
    `${origin}/api/coinbase/stream?product=BTC-USD&interval=1m&products=ETH-USD`,
    { signal: controller.signal },
  )
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const reader = response.body!.getReader(),
    decoder = new TextDecoder()
  const initial = decoder.decode((await reader.read()).value)
  expect(initial).toContain('retry: 3000')
  expect(socket!.sent.join('')).toContain('matches')
  socket!.emit({
    type: 'ticker',
    product_id: 'BTC-USD',
    price: '333',
    open_24h: '300',
    high_24h: '340',
    low_24h: '290',
    volume_24h: '9',
  })
  socket!.emit({
    type: 'match',
    product_id: 'BTC-USD',
    trade_id: 123,
    price: '333',
    size: '2',
    time: new Date(Date.now() + 1000).toISOString(),
  })
  const update = decoder.decode((await reader.read()).value)
  expect(update).toContain('"state":"live"')
  expect(update).toContain('"close":333')
  expect(update).toContain('"source":"coinbase"')
  socket!.close()
  const disconnected = decoder.decode((await reader.read()).value)
  expect(disconnected).toContain('"state":"reconnecting"')
  controller.abort()
})
