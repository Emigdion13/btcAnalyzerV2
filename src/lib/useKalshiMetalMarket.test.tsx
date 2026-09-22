// @vitest-environment jsdom
/**
 * The client half of the metals feed.
 *
 * The interesting guarantees are not "does it parse" — the payload shape is validated by
 * `shared/kalshi-metals` — but the promises this hook makes to the chart:
 *   • it only ever asks for a resolution Kalshi actually publishes;
 *   • it shows the settlement points it was given, and their real age;
 *   • it never renders one metal's numbers under another metal's symbol;
 *   • and it polls at the quarter-hour rhythm instead of hammering a ladder that cannot
 *     have changed.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  metalPollDelayMs,
  useKalshiMetalMarket,
  type KalshiMetalMarket,
} from './useKalshiMetalMarket'
import {
  KALSHI_WINDOW_SECONDS,
  metalFeedForSymbol,
  type MetalInterval,
  type RawMarket,
} from '../../shared/kalshi'
import {
  metalCoverage,
  metalQuote,
  mergeSettlementPoints,
  parseImpliedUp,
  parseSettlementPoints,
  settlementCandles,
  type KalshiMetalHistory,
} from '../../shared/kalshi-metals'
import fixture from '../../shared/fixtures/kalshi-metals-markets.json'

/** The live gold window in the fixture opened here; five minutes in keeps it fresh. */
const LIVE_OPEN = Date.parse('2026-09-17T02:00:00Z') / 1000
const NOW_SEC = LIVE_OPEN + 300

const gold = metalFeedForSymbol('XAU-USD')!

/** A payload assembled the way the server assembles it, from Kalshi's verbatim records. */
function historyFor(
  symbol: string,
  options?: { candles?: boolean; interval?: MetalInterval; message?: string },
): KalshiMetalHistory {
  const feed = metalFeedForSymbol(symbol)!
  const records = feed === gold ? fixture.gold : fixture.silver
  const points = mergeSettlementPoints(
    parseSettlementPoints(records.settled, feed),
    parseSettlementPoints(records.open, feed),
  )
  const live = parseSettlementPoints(records.open, feed).at(-1)!
  const market = records.open.markets[0] as RawMarket
  const interval = options?.interval ?? '15m'
  const candles = options?.candles === false ? [] : settlementCandles(points, interval, 300)
  return {
    source: 'kalshi',
    symbol: feed.symbol,
    series: feed.series,
    indexId: feed.indexId,
    interval,
    candles,
    points,
    quote: candles.length ? metalQuote(points) : null,
    pending: {
      windowStart: live.time,
      windowEnd: live.time + KALSHI_WINDOW_SECONDS,
      strike: live.value,
      roundDigits: feed.roundDigits,
      ticker: String(market.ticker),
      rule: typeof market.rules_primary === 'string' ? market.rules_primary : '',
      tieGoesUp: true,
      impliedUp: parseImpliedUp(market),
    },
    roundDigits: feed.roundDigits,
    unit: feed.unit,
    coverage: metalCoverage(points, NOW_SEC, true),
    asOf: NOW_SEC * 1000,
    message: options?.message ?? `${feed.name} settled by Kalshi's ${feed.series} ladder on Pyth.`,
  }
}

interface Stub {
  calls: string[]
  requests(): URLSearchParams[]
}

/** Stub `fetch`, recording every URL and answering from `respond`. */
function stubFetch(respond: (params: URLSearchParams) => unknown | Promise<unknown>): Stub {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : String(input)
      calls.push(url)
      const search = new URL(url, 'http://localhost').searchParams
      const payload = await respond(search)
      const failed = payload instanceof Response500
      return {
        ok: !failed,
        status: failed ? 500 : 200,
        json: async () => (failed ? { message: (payload as Response500).message } : payload),
      }
    }),
  )
  return {
    calls,
    requests: () => calls.map((url) => new URL(url, 'http://localhost').searchParams),
  }
}

/** An error the stub should answer with, carrying the server's own message. */
class Response500 {
  constructor(readonly message: string) {}
}

type HookProps = Parameters<typeof useKalshiMetalMarket>[0]

interface Harness {
  readonly value: KalshiMetalMarket
  rerender(props: HookProps): void
  unmount(): void
}

function mount(props: HookProps): Harness {
  let current: KalshiMetalMarket | null = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const Probe = ({ hookProps }: { hookProps: HookProps }) => {
    current = useKalshiMetalMarket(hookProps)
    return null
  }
  act(() => {
    root.render(<Probe hookProps={props} />)
  })
  return {
    get value() {
      return current as KalshiMetalMarket
    },
    rerender(next: HookProps) {
      act(() => {
        root.render(<Probe hookProps={next} />)
      })
    },
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** Let the hook's awaits settle. Each round is one microtask turn inside `act`. */
async function flush(rounds = 6) {
  for (let i = 0; i < rounds; i++)
    await act(async () => {
      await Promise.resolve()
    })
}

const harnesses: Harness[] = []
function render(props: HookProps): Harness {
  const harness = mount(props)
  harnesses.push(harness)
  return harness
}

afterEach(() => {
  while (harnesses.length) harnesses.pop()!.unmount()
  vi.unstubAllGlobals()
})

describe('metalPollDelayMs', () => {
  it('polls hard either side of a quarter-hour boundary', () => {
    const cut = LIVE_OPEN + KALSHI_WINDOW_SECONDS
    // Just after the cut the next window's strike has landed, and just before it the
    // settlement is about to: both are the only moments a metal price can change.
    expect(metalPollDelayMs(LIVE_OPEN * 1000)).toBe(3_000)
    expect(metalPollDelayMs((LIVE_OPEN + 10) * 1000)).toBe(3_000)
    expect(metalPollDelayMs((cut - 20) * 1000)).toBe(3_000)
    expect(metalPollDelayMs(cut * 1000)).toBe(3_000)
    expect(metalPollDelayMs((cut + 5) * 1000)).toBe(3_000)
  })

  it('idles through the middle of a window, when nothing new can be published', () => {
    expect(metalPollDelayMs((LIVE_OPEN + 600) * 1000)).toBe(30_000)
    expect(metalPollDelayMs((LIVE_OPEN + 120) * 1000)).toBe(30_000)
  })

  it('never sleeps past the moment the fast pre-cut polling must begin', () => {
    for (let offset = 0; offset < KALSHI_WINDOW_SECONDS; offset += 15) {
      const delay = metalPollDelayMs((LIVE_OPEN + offset) * 1000)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(30_000)
      const left = KALSHI_WINDOW_SECONDS - offset
      if (offset >= 30 && left >= 30)
        // The next poll must land no later than the start of the pre-cut fast window, so a
        // settlement is on screen within seconds of being graded. The 2s floor on the delay
        // is allowed to overshoot by at most that floor.
        expect(offset + delay / 1000).toBeLessThanOrEqual(KALSHI_WINDOW_SECONDS - 30 + 2)
    }
  })
})

describe('useKalshiMetalMarket', () => {
  it('asks for the symbol, resolution and bar count it was given', async () => {
    const stub = stubFetch(() => historyFor('XAU-USD'))
    render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: true, limit: 120 })
    await flush()
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]).toContain('/api/kalshi/metals/history')
    const params = stub.requests()[0]
    expect(params.get('symbol')).toBe('XAU-USD')
    expect(params.get('interval')).toBe('15m')
    expect(params.get('limit')).toBe('120')
  })

  it('publishes settlement points, bars, the quote and the forming window as given', async () => {
    const expected = historyFor('XAU-USD')
    stubFetch(() => expected)
    const chart = render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: true })
    await flush()
    const value = chart.value
    expect(value.state).toBe('live')
    expect(value.message).toBe(expected.message)
    expect(value.candles).toEqual(expected.candles)
    expect(value.points).toEqual(expected.points)
    expect(value.quote).toEqual(expected.quote)
    expect(value.coverage).toEqual(expected.coverage)
    // The forming window is exposed as pending rather than drawn as a partial bar.
    expect(value.pending?.strike).toBe(expected.pending?.strike)
    expect(value.pending?.windowStart).toBe(LIVE_OPEN)
    expect(value.snapshot?.source).toBe('kalshi')
    expect(value.snapshot?.provisional).toBe(false)
    expect(value.assets.map((asset) => asset.symbol)).toEqual(['XAU-USD', 'XAG-USD'])
  })

  it('aggregates coarser resolutions on the server, and asks for nothing finer than 15m', async () => {
    const stub = stubFetch(() => historyFor('XAU-USD'))
    render({ symbol: 'XAU-USD', interval: '4h', enabled: true, playing: true })
    await flush()
    expect(stub.requests()[0].get('interval')).toBe('4h')
  })

  it('explains a resolution the ladder does not publish, without requesting it', async () => {
    const stub = stubFetch(() => historyFor('XAU-USD'))
    const chart = render({ symbol: 'XAG-USD', interval: '5m', enabled: true, playing: true })
    await flush()
    // Never ask for data that cannot exist: no request, no bars, and a message that names
    // both the metal and the resolutions that do exist.
    expect(stub.calls).toHaveLength(0)
    expect(chart.value.candles).toEqual([])
    expect(chart.value.state).toBe('stale')
    expect(chart.value.message).toContain('Silver')
    expect(chart.value.message).toContain('every 15 minutes')
    expect(chart.value.message).toContain('5m candles do not exist')
  })

  it('stays idle for a symbol Kalshi does not settle', async () => {
    const stub = stubFetch(() => historyFor('XAU-USD'))
    const chart = render({ symbol: 'BTC-USD', interval: '15m', enabled: true, playing: true })
    await flush()
    expect(stub.calls).toHaveLength(0)
    expect(chart.value.candles).toEqual([])
    expect(chart.value.state).toBe('loading')
  })

  it('does not fetch while the tab is hidden, disabled, or paused', async () => {
    const stub = stubFetch(() => historyFor('XAU-USD'))
    render({ symbol: 'XAU-USD', interval: '15m', enabled: false, playing: true })
    await flush()
    expect(stub.calls).toHaveLength(0)

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: true })
    await flush()
    expect(stub.calls).toHaveLength(0)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })

    render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: false })
    await flush()
    expect(stub.calls).toHaveLength(0)
  })

  it('prices the other watched metals with a two-bar ask, never the charted one twice', async () => {
    const stub = stubFetch((params) => historyFor(params.get('symbol')!))
    render({
      symbol: 'XAU-USD',
      interval: '15m',
      enabled: true,
      playing: true,
      watched: ['BTC-USD', 'XAG-USD', 'XAU-USD'],
    })
    await flush()
    // Coinbase pairs are someone else's business, and the charted metal is already loaded.
    expect(stub.requests().map((params) => params.get('symbol'))).toEqual(['XAU-USD', 'XAG-USD'])
    expect(stub.requests()[1].get('limit')).toBe('2')
  })

  it('reports an empty ladder as stale rather than inventing bars', async () => {
    // Nothing settled in the requested resolution: no bars to draw, and the hook says so
    // instead of falling back to a finer one.
    stubFetch(() => historyFor('XAU-USD', { interval: '1D', candles: false, message: '' }))
    const chart = render({ symbol: 'XAU-USD', interval: '1D', enabled: true, playing: true })
    await flush()
    expect(chart.value.candles).toEqual([])
    // The snapshot still exists, but carries no bars: an empty ladder is reported as empty
    // rather than backfilled from a finer resolution.
    expect(chart.value.snapshot?.candles).toEqual([])
    expect(chart.value.snapshot?.provisional).toBe(false)
    expect(chart.value.state).toBe('stale')
    expect(chart.value.message).toContain('no settled windows')
  })

  it('flags a ladder that has stopped grading, with the real age of the newest point', async () => {
    const history = historyFor('XAU-USD')
    // Four missed windows: the data is not merely old, the ladder has stopped publishing.
    const aged = { ...history, asOf: (LIVE_OPEN + 4 * KALSHI_WINDOW_SECONDS + 60) * 1000 }
    stubFetch(() => aged)
    const chart = render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: true })
    await flush()
    expect(chart.value.state).toBe('stale')
    expect(chart.value.message).toContain('61 minutes old')
  })

  it("refuses to show another metal's payload under this symbol", async () => {
    // A stale in-flight response for silver must not be painted on a gold chart.
    stubFetch(() => historyFor('XAG-USD'))
    const chart = render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: true })
    await flush()
    expect(chart.value.candles).toEqual([])
    expect(chart.value.state).toBe('offline')
    expect(chart.value.message).toContain('invalid metal history')
  })

  it("surfaces the server's refusal verbatim, and retries on demand", async () => {
    const stub = stubFetch(() => new Response500('Kalshi does not settle PEPE-USD.'))
    const chart = render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: true })
    await flush()
    expect(chart.value.state).toBe('offline')
    expect(chart.value.message).toContain('Kalshi does not settle PEPE-USD.')
    expect(stub.calls).toHaveLength(1)

    stubFetch(() => historyFor('XAU-USD'))
    act(() => chart.value.retry())
    await flush()
    expect(chart.value.state).toBe('live')
    expect(chart.value.candles.length).toBeGreaterThan(0)
  })

  it('switching metal clears the previous ladder before the new one arrives', async () => {
    stubFetch((params) => historyFor(params.get('symbol')!))
    const chart = render({ symbol: 'XAU-USD', interval: '15m', enabled: true, playing: true })
    await flush()
    expect(chart.value.quote?.price).toBeCloseTo(4300.16, 2)

    // Gold is ~4300 and silver ~63.5: an un-cleared payload would be obvious at a glance.
    chart.rerender({ symbol: 'XAG-USD', interval: '15m', enabled: true, playing: true })
    expect(chart.value.candles).toEqual([])
    expect(chart.value.state).toBe('loading')
    await flush()
    expect(chart.value.quote?.price).toBeCloseTo(63.498, 3)
    expect(chart.value.candles.at(-1)?.close).toBeCloseTo(63.498, 3)
  })
})
