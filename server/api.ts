import type { IncomingMessage, ServerResponse } from 'node:http'
import { isInterval, isProductId } from '../shared/coinbase.ts'
import { CoinbaseService } from './coinbase-service.ts'
import { MarketError } from './rest-client.ts'

export function createMarketApi(service = new CoinbaseService()) {
  const connections = new Set<ServerResponse>()
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
        const e =
          error instanceof MarketError
            ? error
            : new MarketError('Coinbase returned unavailable or invalid market data. Please retry.')
        json(res, e.status, { source: 'coinbase', error: e.code, message: e.message })
      })
      return true
    },
    close() {
      connections.forEach((res) => res.end())
      service.close()
    },
  }
}
