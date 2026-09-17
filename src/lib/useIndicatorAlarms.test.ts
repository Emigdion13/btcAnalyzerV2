import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAlarmCandles } from './useIndicatorAlarms'
import { INTERVAL_SECONDS } from '../../shared/coinbase'

const product = 'BTC-USD'
const interval = '15m'
const now = Date.UTC(2026, 8, 17) / 1000
function history() {
  return {
    source: 'coinbase',
    product,
    interval,
    revision: 1,
    asOf: Date.now(),
    provisional: true,
    candles: Array.from({ length: 20 }, (_, i) => {
      const open = 60_000 + i * 10
      return {
        time: now - (20 - 1 - i) * INTERVAL_SECONDS[interval],
        open,
        high: open + 5,
        low: open - 5,
        close: open + 2,
        volume: 3,
      }
    }),
  }
}
function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response
}
const stubFetch = (body: unknown, ok = true) => {
  const calls: string[] = []
  const fake = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return jsonResponse(body, ok)
  })
  vi.stubGlobal('fetch', fake)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAlarmCandles', () => {
  it('reads a Coinbase pair through the same validated history endpoint as the chart', async () => {
    const calls = stubFetch(history())
    const candles = await fetchAlarmCandles(product, interval, new AbortController().signal)
    expect(calls[0]).toBe('/api/coinbase/candles?product=BTC-USD&interval=15m&limit=300')
    expect(candles).toHaveLength(20)
    expect(candles[0].time).toBe(now - 19 * INTERVAL_SECONDS[interval])
  })

  it('surfaces the service message instead of pretending the alarm saw candles', async () => {
    stubFetch({ message: 'Choose a Coinbase USD pair and a supported interval.' }, false)
    await expect(
      fetchAlarmCandles(product, interval, new AbortController().signal),
    ).rejects.toThrow('Choose a Coinbase USD pair and a supported interval.')
  })

  it('refuses a payload that fails the app’s own candle validation', async () => {
    const bad = history()
    bad.candles[3] = { ...bad.candles[3], time: bad.candles[2].time }
    stubFetch(bad)
    await expect(
      fetchAlarmCandles(product, interval, new AbortController().signal),
    ).rejects.toThrow('invalid chart data')
  })

  it('asks Kalshi for silver, never Coinbase', async () => {
    const calls = stubFetch({
      source: 'kalshi',
      symbol: 'XAG-USD',
      series: 'KXSILVER15M',
      indexId: 'PYTH_SILVER',
      interval: '15m',
      asOf: Date.now(),
      message: 'Silver settlement points loaded.',
      candles: history().candles,
      points: [],
      coverage: { points: 0, from: null, to: null, ageSeconds: 0, complete: true },
      quote: null,
      pending: null,
      roundDigits: 3,
      unit: 'troy ounce',
    })
    const candles = await fetchAlarmCandles('XAG-USD', '15m', new AbortController().signal)
    expect(calls[0]).toBe('/api/kalshi/metals/history?symbol=XAG-USD&interval=15m&limit=300')
    expect(candles).toHaveLength(20)
  })

  it('refuses a sub-15m silver alarm rather than inventing bars', async () => {
    const calls = stubFetch(history())
    await expect(fetchAlarmCandles('XAG-USD', '5m', new AbortController().signal)).rejects.toThrow(
      'Kalshi publishes no 5m silver bars to read.',
    )
    expect(calls).toHaveLength(0)
  })

  it('generates demo pairs locally, without asking the network', async () => {
    const calls = stubFetch(history())
    const candles = await fetchAlarmCandles('BTCUSDT', '15m', new AbortController().signal)
    expect(calls).toHaveLength(0)
    expect(candles.length).toBeGreaterThan(100)
    expect(candles.every((candle) => candle.time % INTERVAL_SECONDS['15m'] === 0)).toBe(true)
  })
})
