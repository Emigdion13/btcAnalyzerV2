// @vitest-environment jsdom
/**
 * The polling half of the floating Kalshi window.
 *
 * The guarantees the window relies on: one cheap poll per second, the last good
 * snapshot survives dropped polls (a dropped poll is not a retracted market),
 * the staleness badge moves on its own once the snapshot is six seconds old,
 * and an unsupported pair is never polled at all.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import type { KalshiFloatResponse } from '../../shared/kalshi-float'
import { KALSHI_FLOAT_POLL_MS, useKalshiFloat, type KalshiFloatState } from './useKalshiFloat'

const floatPayload = (overrides: Partial<KalshiFloatResponse> = {}): KalshiFloatResponse => ({
  source: 'kalshi',
  product: 'BTC-USD',
  series: 'KXBTC15M',
  ticker: 'KXBTC15M-26SEP131715-15',
  target: 77314.22,
  decimals: 2,
  open: 1_789_333_200,
  close: 1_789_334_100,
  upPct: 69,
  downPct: 31,
  upX: 1.42,
  downX: 2.98,
  now: 77330.1,
  nowSource: 'kalshi',
  quiet: false,
  pctSource: 'book',
  asOf: 1_789_333_800_000,
  message: 'ok',
  ...overrides,
})

type HookProps = Parameters<typeof useKalshiFloat>[0]

interface Harness {
  readonly value: KalshiFloatState
  rerender(props: HookProps): void
  unmount(): void
}

function mount(props: HookProps): Harness {
  let current: KalshiFloatState = {
    response: null,
    message: '',
    stale: false,
    supported: false,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const Probe = ({ hookProps }: { hookProps: HookProps }) => {
    current = useKalshiFloat(hookProps)
    return null
  }
  act(() => {
    root.render(<Probe hookProps={props} />)
  })
  return {
    get value() {
      return current
    },
    rerender(p: HookProps) {
      act(() => {
        root.render(<Probe hookProps={p} />)
      })
    },
    unmount() {
      act(() => {
        root.unmount()
      })
    },
  }
}

function stubFetch(respond: (url: string) => { status?: number; body: unknown }) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : String(input)
      calls.push(url)
      const out = respond(url)
      return {
        ok: (out.status ?? 200) < 400,
        status: out.status ?? 200,
        json: async () => out.body,
      }
    }),
  )
  return { calls }
}

describe('useKalshiFloat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('polls once a second and lands the snapshot', async () => {
    const { calls } = stubFetch(() => ({ body: floatPayload() }))
    const h = mount({ product: 'BTC-USD', enabled: true })
    // The first poll fires at mount, so one second in the second has flown.
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    expect(calls[0]).toBe('/api/kalshi/float?product=BTC-USD')
    expect(h.value.response?.upPct).toBe(69)
    expect(h.value.stale).toBe(false)
    expect(calls.length).toBe(2)
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    expect(calls.length).toBe(3)
    h.unmount()
  })

  it('keeps the last good snapshot through failures, then goes stale on its own', async () => {
    let failing = false
    stubFetch(() =>
      failing
        ? { status: 502, body: { message: 'Kalshi is unavailable (HTTP 502).' } }
        : { body: floatPayload() },
    )
    const h = mount({ product: 'BTC-USD', enabled: true })
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    expect(h.value.response?.upPct).toBe(69)

    failing = true
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    // The dropped poll must not retract the market: the snapshot stays on screen,
    // and the footer says what happened to the transport.
    expect(h.value.response?.upPct).toBe(69)
    expect(h.value.message).toContain('502')
    expect(h.value.stale).toBe(false)

    // Six seconds without a fresh snapshot and the numbers stop looking live —
    // even though the message text has not changed since the first failure.
    await act(async () => {
      vi.advanceTimersByTimeAsync(7_000)
    })
    expect(h.value.stale).toBe(true)
    h.unmount()
  })

  it('rejects a payload that is not the float shape and reports the server message', async () => {
    stubFetch(() => ({
      status: 200,
      body: { source: 'kalshi', strike: { strike: 1 } },
    }))
    const h = mount({ product: 'BTC-USD', enabled: true })
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    expect(h.value.response).toBeNull()
    expect(h.value.message).toContain('HTTP 200')
    h.unmount()
  })

  it('does not poll pairs Kalshi has no 15-minute market on', async () => {
    const { calls } = stubFetch(() => ({ body: floatPayload() }))
    const h = mount({ product: 'LTC-USD', enabled: true })
    await act(async () => {
      vi.advanceTimersByTimeAsync(3_000)
    })
    expect(calls.length).toBe(0)
    expect(h.value.supported).toBe(false)
    h.unmount()
  })

  it('stops polling when disabled, and restarts cleanly when re-enabled', async () => {
    const { calls } = stubFetch(() => ({ body: floatPayload() }))
    const h = mount({ product: 'BTC-USD', enabled: true })
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    expect(calls.length).toBe(2)
    h.rerender({ product: 'BTC-USD', enabled: false })
    await act(async () => {
      vi.advanceTimersByTimeAsync(3_000)
    })
    expect(calls.length).toBe(2)
    h.rerender({ product: 'BTC-USD', enabled: true })
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    // Re-enabling starts with an immediate poll, then the cadence continues.
    expect(calls.length).toBe(4)
    h.unmount()
  })

  it('switches coin when the selection changes', async () => {
    const { calls } = stubFetch((url) => ({
      body: floatPayload({ product: url.includes('ETH') ? 'ETH-USD' : 'BTC-USD' }),
    }))
    const h = mount({ product: 'BTC-USD', enabled: true })
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    h.rerender({ product: 'ETH-USD', enabled: true })
    await act(async () => {
      vi.advanceTimersByTimeAsync(KALSHI_FLOAT_POLL_MS)
    })
    expect(calls.some((url) => url.includes('product=ETH-USD'))).toBe(true)
    h.unmount()
  })
})
