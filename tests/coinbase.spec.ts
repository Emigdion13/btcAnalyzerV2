import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { bucketStart, INTERVAL_SECONDS } from '../shared/coinbase'
import type { Interval, HistorySnapshot, MarketQuote, StreamPayload } from '../shared/coinbase'

const products = ['BTC', 'ETH', 'SOL'].map((base) => ({
  id: `${base}-USD`,
  base,
  quote: 'USD',
  increment: 0.01,
}))
function history(product: string, interval: Interval, limit = 300): HistorySnapshot {
  const end = bucketStart(Date.now() / 1000, interval),
    scale = product === 'BTC-USD' ? 70000 : product === 'ETH-USD' ? 4000 : 180
  return {
    source: 'coinbase',
    product,
    interval,
    revision: 1,
    asOf: Date.now(),
    provisional: true,
    candles: Array.from({ length: limit }, (_, i) => {
      const open = scale * (1 + Math.sin(i / 12) * 0.01 + i * 0.00002),
        close = open * (1 + Math.sin(i * 3) * 0.001)
      return {
        time: end - (limit - 1 - i) * INTERVAL_SECONDS[interval],
        open,
        close,
        high: Math.max(open, close) * 1.0004,
        low: Math.min(open, close) * 0.9996,
        volume: 10 + (i % 40),
      }
    }),
  }
}
function quotes(): Record<string, MarketQuote> {
  return Object.fromEntries(
    products.map((p) => {
      const price = p.base === 'BTC' ? 70000 : p.base === 'ETH' ? 4000 : 180
      return [
        p.id,
        {
          price,
          open: price / 1.02,
          high: price * 1.01,
          low: price * 0.97,
          change: 2,
          volume: 12345,
          source: 'coinbase',
          updatedAt: Date.now(),
        },
      ]
    }),
  )
}
async function mockCoinbase(page: Page, failHistory = false) {
  const requests: string[] = []
  // This transport stub is TEST-ONLY. It is never served by the application.
  await page.addInitScript(() => {
    const streams: {
      url: string
      onmessage: ((event: { data: string }) => void) | null
      onerror: (() => void) | null
      closed: boolean
    }[] = []
    class TestEventSource {
      url: string
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      closed = false
      constructor(url: string) {
        this.url = url
        streams.push(this)
      }
      close() {
        this.closed = true
      }
    }
    Object.defineProperty(window, 'EventSource', { value: TestEventSource })
    Object.assign(window, {
      __testStreams: streams,
      __marketMessage: (message: unknown) => {
        for (const stream of streams)
          if (!stream.closed) stream.onmessage?.({ data: JSON.stringify(message) })
      },
      __marketDisconnect: () => {
        for (const stream of streams) if (!stream.closed) stream.onerror?.()
      },
    })
  })
  await page.route('**/api/coinbase/**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url.pathname + url.search)
    if (url.pathname.endsWith('/products'))
      return route.fulfill({ json: { source: 'coinbase', products, asOf: Date.now() } })
    if (url.pathname.endsWith('/quotes'))
      return route.fulfill({ json: { source: 'coinbase', quotes: quotes(), asOf: Date.now() } })
    if (failHistory)
      return route.fulfill({
        status: 502,
        json: {
          source: 'coinbase',
          error: 'COINBASE_UNAVAILABLE',
          message: 'Coinbase is unreachable in this test.',
        },
      })
    return route.fulfill({
      json: history(
        url.searchParams.get('product')!,
        url.searchParams.get('interval') as Interval,
        Number(url.searchParams.get('limit') ?? 300),
      ),
    })
  })
  return requests
}
async function emit(page: Page, message: StreamPayload) {
  await page.waitForFunction(() =>
    (window as unknown as { __testStreams: { closed: boolean }[] }).__testStreams.some(
      (s) => !s.closed,
    ),
  )
  await page.evaluate(
    (message) =>
      (window as unknown as { __marketMessage: (message: unknown) => void }).__marketMessage(
        message,
      ),
    message,
  )
}
function payload(product = 'BTC-USD', interval: Interval = '15m', revision = 2): StreamPayload {
  const snapshot = history(product, interval)
  const last = snapshot.candles.at(-1)!
  return {
    state: 'live',
    message: 'Coinbase live · current candles provisional',
    product,
    interval,
    candles: [{ ...last, high: last.high + 100, close: last.high + 50, volume: 55 }],
    quotes: quotes(),
    revision,
    asOf: Date.now(),
    provisional: true,
  }
}

test('defaults to Coinbase, exposes 1m/3m/5m/15m, and binds real product IDs', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const requests = await mockCoinbase(page)
  await page.goto('/')
  await expect(
    page.getByRole('img', { name: /Bitcoin 15m candles chart with 300 Coinbase/ }),
  ).toBeVisible()
  await expect(page.locator('.exchange-label')).toHaveText('COINBASE')
  for (const interval of ['1m', '3m', '5m', '15m'] as const) {
    await page.getByRole('button', { name: `${interval} timeframe`, exact: true }).click()
    await expect(
      page.getByRole('img', {
        name: new RegExp(`Bitcoin ${interval} candles chart with 300 Coinbase`),
      }),
    ).toBeVisible()
    expect(
      requests.some(
        (request) =>
          request.includes('product=BTC-USD') && request.includes(`interval=${interval}`),
      ),
    ).toBe(true)
  }
  await page.getByRole('tab', { name: /ETH-USD/ }).click()
  await expect(
    page.getByRole('img', { name: /Ethereum 15m candles chart with 300 Coinbase/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: '3m timeframe' }).click()
  await expect(
    page.getByRole('img', { name: /Ethereum 3m candles chart with 300 Coinbase/ }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('uses only the Coinbase catalog and does not leak demo quote statistics', async ({ page }) => {
  await mockCoinbase(page)
  await page.goto('/')
  await expect(page.locator('.detail-price')).toContainText('70,000.00')
  await page.keyboard.press('Control+k')
  await page.getByRole('textbox', { name: 'Search symbols' }).fill('BNB')
  await expect(page.locator('.symbol-result')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Search symbols' }).fill('SOL')
  await expect(page.locator('.symbol-result')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Search symbols' }).press('Enter')
  await expect(page.locator('.symbol-heading')).toContainText('Solana')
  await expect(page.locator('.detail-price')).toContainText('180.00')
  await expect(page.locator('.symbol-detail')).not.toContainText('Market cap')
  await expect(page.locator('.symbol-detail')).not.toContainText('Binance')
})

test('applies streaming candle patches, marks stale data, and freezes replay history', async ({
  page,
}) => {
  await mockCoinbase(page)
  await page.goto('/')
  await expect(page.getByRole('img', { name: /300 Coinbase price bars/ })).toBeVisible()
  const update = payload()
  await emit(page, update)
  await expect(page.locator('.feed-status')).toContainText('Coinbase · live')
  await expect(page.locator('.ohlc-row')).toContainText(
    update.candles[0].close.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  )
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await expect(page.locator('.replay-progress')).toHaveText('180/300')
  const frozen = await page.locator('.ohlc-row').innerText()
  await emit(page, {
    ...payload(),
    revision: 3,
    candles: [{ ...update.candles[0], time: update.candles[0].time + 900 }],
  })
  await expect(page.locator('.replay-progress')).toHaveText('180/300')
  await expect(page.locator('.ohlc-row')).toHaveText(frozen, { useInnerText: true })
  await page.getByRole('button', { name: 'Exit replay' }).click()
  await expect(page.getByRole('img', { name: /301 Coinbase price bars/ })).toBeVisible()
  await page.evaluate(() =>
    (window as unknown as { __marketDisconnect: () => void }).__marketDisconnect(),
  )
  await expect(page.locator('.market-stale-banner')).toBeVisible()
  await expect(page.locator('.feed-status')).toContainText('reconnecting')
})

test('never silently falls back to demo data on errors; explicit demo remains available', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockCoinbase(page, true)
  await page.goto('/')
  await expect(page.locator('.market-feedback')).toContainText('Coinbase is unavailable')
  await expect(page.locator('.market-feedback')).toContainText('No synthetic data')
  await expect(page.getByRole('img', { name: /0 Coinbase price bars/ })).toBeVisible()
  await page.getByRole('button', { name: 'Use offline demo', exact: true }).click()
  await expect(page.getByRole('img', { name: /900 simulated price bars/ })).toBeVisible()
  await expect(page.locator('.feed-status')).toContainText('Demo feed connected')
  expect(errors).toEqual([])
})

test('keeps fast intervals visible on mobile and custom indicators usable with Coinbase', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockCoinbase(page)
  await page.goto('/')
  for (const interval of ['1m', '3m', '5m', '15m'])
    await expect(
      page.getByRole('button', { name: `${interval} timeframe`, exact: true }),
    ).toBeVisible()
  await expect(page.getByRole('img', { name: /300 Coinbase price bars/ })).toBeVisible()
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.editor-status')).toContainText('Compiled successfully')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

test('does not trigger live alerts from a disconnected or demo quote', async ({ page }) => {
  await mockCoinbase(page)
  await page.goto('/')
  await expect(page.getByRole('img', { name: /300 Coinbase price bars/ })).toBeVisible()
  await page.getByRole('button', { name: 'Alert', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.toast-host')).toContainText('active quote connection')
  await emit(page, payload())
  await page.getByRole('button', { name: 'Alert', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Target price · USD', exact: true }).fill('999999')
  await page.getByRole('button', { name: 'Create alert', exact: true }).click()
  await page.evaluate(() =>
    (window as unknown as { __marketDisconnect: () => void }).__marketDisconnect(),
  )
  const count = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('atlas.v1.alerts')!).filter(
        (a: { triggeredAt?: string }) => a.triggeredAt,
      ).length,
  )
  expect(count).toBe(0)
})
