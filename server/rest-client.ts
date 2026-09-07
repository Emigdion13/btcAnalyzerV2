const ORIGIN = 'https://api.exchange.coinbase.com'
export class MarketError extends Error {
  status: number
  code: string
  constructor(message: string, status = 502, code = 'COINBASE_UNAVAILABLE') {
    super(message)
    this.status = status
    this.code = code
  }
}
/** Fixed upstream, bounded cache/queue, request coalescing, 4 requests/s maximum. */
export class CoinbaseRestClient {
  private cache = new Map<string, { value: unknown; at: number }>()
  private pending = new Map<string, Promise<{ value: unknown; at: number }>>()
  private queue: { run: () => void; reject: (error: Error) => void }[] = []
  private active = 0
  private lastStarted = 0
  private blockedUntil = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private controllers = new Set<AbortController>()
  private fetcher: typeof fetch
  private spacing: number
  constructor(fetcher = fetch, spacing = 250) {
    this.fetcher = fetcher
    this.spacing = spacing
  }
  private drain() {
    if (this.stopped || this.timer || this.active >= 3 || !this.queue.length) return
    const wait = Math.max(
      0,
      Math.max(this.blockedUntil, this.lastStarted + this.spacing) - Date.now(),
    )
    this.timer = setTimeout(() => {
      this.timer = undefined
      const task = this.queue.shift()
      if (task) {
        this.active++
        this.lastStarted = Date.now()
        task.run()
      }
      this.drain()
    }, wait)
  }
  get(path: string, ttl = 0): Promise<{ value: unknown; at: number }> {
    if (!/^\/products(?:$|\/[A-Z0-9]{1,24}-USD\/(?:stats|candles)(?:\?|$))/.test(path))
      return Promise.reject(new MarketError('Invalid upstream request.', 400, 'INVALID_REQUEST'))
    const cached = this.cache.get(path)
    if (cached && Date.now() - cached.at < ttl) return Promise.resolve(cached)
    const pending = this.pending.get(path)
    if (pending) return pending
    if (this.stopped || this.queue.length >= 120)
      return Promise.reject(
        new MarketError('The market service is busy. Please retry shortly.', 503, 'BUSY'),
      )
    const request = new Promise<{ value: unknown; at: number }>((resolve, reject) => {
      this.queue.push({
        reject,
        run: () => {
          const controller = new AbortController()
          this.controllers.add(controller)
          const timeout = setTimeout(() => controller.abort(), 10000)
          this.fetcher(`${ORIGIN}${path}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json', 'User-Agent': 'Atlas-Charting/0.2' },
            redirect: 'error',
          })
            .then(async (response) => {
              if (!response.ok) {
                if (response.status === 429) {
                  this.blockedUntil =
                    Date.now() +
                    Math.min(60, Math.max(1, Number(response.headers.get('Retry-After')) || 10)) *
                      1000
                  throw new MarketError(
                    'Coinbase rate limit reached. Retrying after a short pause.',
                    429,
                    'RATE_LIMITED',
                  )
                }
                if (response.status === 404)
                  throw new MarketError(
                    'This Coinbase pair is not available.',
                    404,
                    'PAIR_UNAVAILABLE',
                  )
                throw new MarketError(
                  `Coinbase is unavailable (HTTP ${response.status}). Please retry.`,
                  502,
                )
              }
              const text = await response.text()
              if (text.length > 8 * 1024 * 1024)
                throw new MarketError('Coinbase returned an oversized response.')
              const result = { value: JSON.parse(text) as unknown, at: Date.now() }
              if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!)
              this.cache.set(path, result)
              resolve(result)
            })
            .catch((error) =>
              reject(
                error instanceof MarketError
                  ? error
                  : new MarketError(
                      'Cannot reach Coinbase from this server. Check the connection and retry.',
                    ),
              ),
            )
            .finally(() => {
              clearTimeout(timeout)
              this.controllers.delete(controller)
              this.active--
              this.pending.delete(path)
              this.drain()
            })
        },
      })
      this.drain()
    })
    this.pending.set(path, request)
    return request
  }
  close() {
    this.stopped = true
    clearTimeout(this.timer)
    this.controllers.forEach((c) => c.abort())
    this.queue
      .splice(0)
      .forEach((task) => task.reject(new MarketError('Market service stopped.', 503)))
    this.cache.clear()
  }
}
