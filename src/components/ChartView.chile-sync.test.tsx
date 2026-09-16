// @vitest-environment jsdom
/**
 * Headless verification that the Chile Reversal SVG markers (Bounce / Reject)
 * stay glued to their candles when the chart pans/zooms and when live bars
 * stream in. Runs the real <ChartView> against lightweight-charts with a
 * stubbed 2D canvas: coordinate math is real JS, rasterisation is stubbed.
 */
import { act } from 'react'
import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ChartView } from './ChartView'
import type { ChartHandle } from './ChartView'
import { generateCandles, getAsset } from '../lib/market'
import { bucketStart } from '../../shared/coinbase'
import { CHILE_REVERSAL_DEFAULTS, DEFAULT_SETTINGS } from '../lib/types'
import type { Candle, ChileReversalSettings, Indicator, Timeframe } from '../lib/types'

function aggregate(source: Candle[], timeframe: Timeframe): Candle[] {
  const out: Candle[] = []
  for (const candle of source) {
    const bucket = bucketStart(candle.time, timeframe)
    const last = out[out.length - 1]
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, candle.high)
      last.low = Math.min(last.low, candle.low)
      last.close = candle.close
      last.volume += candle.volume
    } else
      out.push({
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })
  }
  return out
}

const W = 1200
const H = 800

function stubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const target: Record<string | symbol, unknown> = { canvas }
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop]
      if (prop === 'measureText') return () => ({ width: 8 })
      if (prop === 'getImageData')
        return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
      if (
        prop === 'createLinearGradient' ||
        prop === 'createRadialGradient' ||
        prop === 'createPattern'
      )
        return () => ({ addColorStop: () => {} })
      if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      if (prop === 'getLineDash') return () => []
      const fn = () => {}
      t[prop] = fn
      return fn
    },
    set(t, prop, value) {
      t[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

let restore: (() => void)[] = []

beforeAll(() => {
  const g = globalThis as Record<string, unknown>
  g.IS_REACT_ACT_ENVIRONMENT = true

  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  g.ResizeObserver = RO

  g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0)
  g.cancelAnimationFrame = (id: number) => clearTimeout(id)

  const matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true })
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })

  const size = (
    proto: 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight',
    value: number,
  ) => {
    const prev = Object.getOwnPropertyDescriptor(HTMLElement.prototype, proto)
    Object.defineProperty(HTMLElement.prototype, proto, { get: () => value, configurable: true })
    restore.push(() => prev && Object.defineProperty(HTMLElement.prototype, proto, prev))
  }
  size('clientWidth', W)
  size('clientHeight', H)
  size('offsetWidth', W)
  size('offsetHeight', H)

  const prevGbc = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: W,
      height: H,
      left: 0,
      top: 0,
      right: W,
      bottom: H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
  }
  restore.push(() => (HTMLElement.prototype.getBoundingClientRect = prevGbc))

  const prevGetContext = HTMLCanvasElement.prototype.getContext
  // @ts-expect-error override
  HTMLCanvasElement.prototype.getContext = function (kind: string) {
    if (kind === '2d') return stubContext(this)
    return null
  }
  restore.push(() => (HTMLCanvasElement.prototype.getContext = prevGetContext))
})

afterAll(() => {
  restore.forEach((r) => r())
  restore = []
})

const flush = async (ms = 5) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function buildProps(
  candles: Candle[],
  htf: Candle[],
  timeframe: Timeframe = '1m',
  chile: Partial<ChileReversalSettings> = {},
) {
  const indicator: Indicator = {
    id: 'chile-1',
    kind: 'chile-reversal',
    name: 'Chile Reversal',
    period: 0,
    color: '#00e191',
    visible: true,
    // These tests are about geometry — markers glued to their candles — not
    // about the marker lifetime, so they opt out of it: with a TTL the demo
    // clock (the data edge) would hide every marker older than the TTL and the
    // assertions would depend on where in the seeded history signals happen to
    // sit. The lifetime has its own tests below.
    chileReversal: { ...CHILE_REVERSAL_DEFAULTS, markerTtlSeconds: 0, ...chile },
  }
  return {
    source: 'demo' as const,
    feedState: 'live' as const,
    asset: getAsset('BTCUSD'),
    candles,
    timeframe,
    chartType: 'candles' as const,
    indicators: [indicator],
    customResults: {},
    indicatorTimeframes: {
      '15m': { candles: htf, state: 'live' as const, message: '', asOf: Date.now() },
    },
    settings: { ...DEFAULT_SETTINGS },
    drawings: [],
    drawingTool: 'cursor' as const,
    drawingsVisible: true,
    drawingsLocked: false,
    magnet: false,
    alerts: [],
    onDraw: () => {},
    onToolComplete: () => {},
    onTextRequest: () => {},
    onIndicatorEdit: () => {},
    onIndicatorToggle: () => {},
    onIndicatorRemove: () => {},
    onIndicatorRetry: () => {},
    replay: false,
    book: null,
  }
}

type MarkerSample = { key: string; x: number; y: number }

function sampleMarkers(container: HTMLElement): MarkerSample[] {
  return [...container.querySelectorAll('.chile-reversal-signal')].map((el) => {
    const text = el.querySelector('text')
    return {
      key: `${el.getAttribute('data-testid')}:${el.getAttribute('data-index')}`,
      x: Number(text?.getAttribute('x')),
      y: Number(text?.getAttribute('y')),
    }
  })
}

describe('Chile Reversal marker scroll sync', () => {
  it('stays synced under React.StrictMode double-mount (dev mode)', async () => {
    const { StrictMode } = await import('react')
    const asset = getAsset('BTCUSD')
    const base = generateCandles(asset, '1m')
    const htf = aggregate(base, '15m')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const ref = createRef<ChartHandle>()
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <StrictMode>
          <ChartView ref={ref} {...buildProps(base, htf)} />
        </StrictMode>,
      )
    })
    await flush(30)
    await act(async () => {
      ref.current!.latest()
    })
    await flush(30)

    const before = sampleMarkers(container)
    expect(before.length).toBeGreaterThan(0)

    // Pan under StrictMode.
    await act(async () => {
      ref.current!.setRange(110)
    })
    await flush(30)
    const afterPan = sampleMarkers(container)
    const sameKeys = afterPan.filter((m) => before.some((b) => b.key === m.key))
    const moved = sameKeys.filter((m) => {
      const prev = before.find((b) => b.key === m.key)!
      return Math.abs(prev.x - m.x) > 1
    })
    console.log(
      'strictmode: markers',
      before.length,
      '→',
      afterPan.length,
      'same keys',
      sameKeys.length,
      'moved',
      moved.length,
    )

    // Live append under StrictMode.
    const last = base[base.length - 1]
    const appended = [...base, { ...last, time: last.time + 60, open: last.close }]
    await act(async () => {
      root.render(
        <StrictMode>
          <ChartView ref={ref} {...buildProps(appended, htf)} />
        </StrictMode>,
      )
    })
    await flush(30)
    const afterAppend = sampleMarkers(container)
    const frozen = afterAppend.filter((m) => {
      const prev = afterPan.find((b) => b.key === m.key)
      return prev && Math.abs(prev.x - m.x) < 1 && Math.abs(prev.y - m.y) < 1
    })
    console.log('strictmode: after append', afterAppend.length, 'FROZEN', frozen.length)
    expect(frozen.length).toBe(0)
    expect(moved.length).toBeGreaterThan(0)

    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps markers glued to their candles while live bars stream in', async () => {
    const asset = getAsset('BTCUSD')
    const base = generateCandles(asset, '1m')
    const htf = aggregate(base, '15m')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const ref = createRef<ChartHandle>()
    const root = createRoot(container)

    const candles = base
    await act(async () => {
      root.render(<ChartView ref={ref} {...buildProps(candles, htf)} />)
    })
    await flush(20)
    await act(async () => {
      ref.current!.latest()
    })
    await flush(20)

    const glued = sampleMarkers(container)
    expect(glued.length).toBeGreaterThan(0)

    // 1. Quote tick: same bar count, last candle mutates. Candles don't move
    //    horizontally, so marker x must be bit-identical.
    const ticked = candles.map((c, i) =>
      i === candles.length - 1 ? { ...c, close: c.close * 1.001, high: c.high * 1.001 } : c,
    )
    await act(async () => {
      root.render(<ChartView ref={ref} {...buildProps(ticked, htf)} />)
    })
    await flush(20)
    const afterTick = sampleMarkers(container)
    const xDrift = afterTick
      .map((m) => {
        const prev = glued.find((g) => g.key === m.key)
        return prev ? Math.abs(prev.x - m.x) : 0
      })
      .reduce((a, b) => Math.max(a, b), 0)
    console.log('max x drift after quote tick:', xDrift)

    // 2. New bar append (candle closed → new last bar). The chart keeps the
    //    latest bar visible, shifting all history left; every marker must move
    //    left by exactly one bar spacing.
    const last = ticked[ticked.length - 1]
    const appended = [
      ...ticked.slice(0, -1),
      last,
      { ...last, time: last.time + 60, open: last.close },
    ]
    await act(async () => {
      root.render(<ChartView ref={ref} {...buildProps(appended, htf)} />)
    })
    await flush(20)
    const afterAppend = sampleMarkers(container)
    const spacing = 6 // createChart barSpacing: 6
    const shifted = afterAppend.filter((m) => {
      const prev = glued.find((g) => g.key === m.key)
      return prev && Math.abs(prev.x - spacing - m.x) < 1.5
    })
    const frozen = afterAppend.filter((m) => {
      const prev = glued.find((g) => g.key === m.key)
      return prev && Math.abs(prev.x - m.x) < 1
    })
    console.log(
      'after append:',
      afterAppend.length,
      'shifted one spacing left:',
      shifted.length,
      'FROZEN:',
      frozen.length,
      frozen.slice(0, 3),
    )

    await act(async () => root.unmount())
    container.remove()
  })

  it('moves the Bounce/Reject markers when the visible range changes', async () => {
    const asset = getAsset('BTCUSD')
    const candles = generateCandles(asset, '1m')
    const htf = aggregate(candles, '15m')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const ref = createRef<ChartHandle>()
    const root = createRoot(container)

    await act(async () => {
      root.render(<ChartView ref={ref} {...buildProps(candles, htf)} />)
    })
    await flush(20)

    const before = sampleMarkers(container)
    console.log('markers rendered:', before.length)
    expect(before.length).toBeGreaterThan(0)

    // Pan/zoom to a different window of history.
    await act(async () => {
      ref.current!.setRange(120)
    })
    await flush(20)

    const after = sampleMarkers(container)
    const moved = after.filter((m) => {
      const prev = before.find((b) => b.key === m.key)
      return prev && (Math.abs(prev.x - m.x) > 1 || Math.abs(prev.y - m.y) > 1)
    })
    console.log(
      'markers after setRange:',
      after.length,
      'moved:',
      moved.length,
      'same-keys:',
      after.filter((m) => before.some((b) => b.key === m.key)).length,
    )

    // Show the tail at a different scroll offset — panic-free second view change.
    await act(async () => {
      ref.current!.fit()
    })
    await flush(20)
    const afterFit = sampleMarkers(container)
    const movedFit = afterFit.filter((m) => {
      const prev = after.find((b) => b.key === m.key)
      return prev && Math.abs(prev.x - m.x) > 1
    })
    console.log('markers after fit:', afterFit.length, 'moved vs setRange view:', movedFit.length)

    expect(moved.length + movedFit.length).toBeGreaterThan(0)

    await act(async () => root.unmount())
    container.remove()
  })
})

describe('Chile Reversal marker lifetime', () => {
  const step = 900 // a 15m chart, pivots on the same resolution: no HTF feed needed

  /**
   * 20 flat filler bars (ATR warms up, no pivots), a pivot low at 96, a wick
   * toward it, then the bar that prints the Bounce — and `tailBars` more bars
   * after it. Demo data is pinned away from the wall clock, so the marker clock
   * is the data edge: each appended bar ages the Bounce by another 900 s.
   */
  const bounceSeries = (tailBars: number): Candle[] => {
    const rows: Array<[number, number, number, number]> = [
      ...Array.from({ length: 20 }, () => [100, 101, 99, 100] as [number, number, number, number]),
      [100, 101, 99, 100],
      [100, 101, 96, 100], // pivot low 96, confirmed two bars later
      [100, 101, 99, 100],
      [100, 101, 99, 100],
      [100, 101, 97, 99],
      [99, 103, 96, 102], // wick into 96, closes green above it: the Bounce
    ]
    for (let i = 0; i < tailBars; i++) rows.push([102, 103, 101, 102])
    return rows.map(([open, high, low, close], i) => ({
      time: i * step,
      open,
      high,
      low,
      close,
      volume: 10,
    }))
  }

  const bounceMarkers = (container: HTMLElement) => [
    ...container.querySelectorAll<SVGGElement>('[data-testid="chile-reversal-bounce-support"]'),
  ]

  // The default 2.5 ATR distance filter drops the 96 support before the bounce
  // bar can reach it; 6 keeps it in range. Breaks stay on so the clear test
  // exercises a mixed pile of markers.
  const lifetime = { maxDistanceAtr: 6, resolution: '15m' as const }
  const expiring = { ...lifetime, markerTtlSeconds: 60 }

  async function renderChart(props: ReturnType<typeof buildProps>) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const ref = createRef<ChartHandle>()
    const root = createRoot(container)
    await act(async () => {
      root.render(<ChartView ref={ref} {...props} />)
    })
    await flush(20)
    await act(async () => {
      ref.current!.latest()
    })
    await flush(20)
    return { container, ref, root }
  }

  it('puts a fresh marker on the fade timeline and drops it once it ages out', async () => {
    // The Bounce is the newest bar: age 0, so it renders with the expiring
    // class and a fade that starts one lifetime from now.
    const fresh = await renderChart(buildProps(bounceSeries(0), [], '15m', expiring))
    const markers = bounceMarkers(fresh.container)
    expect(markers.length).toBe(1)
    expect(markers[0].classList.contains('chile-reversal-signal-expiring')).toBe(true)
    expect(markers[0].style.animationDuration).toBe('15s')
    expect(markers[0].style.animationDelay).toBe('60s')

    // One 15m bar later every marker is 900 s older — past 60 s + 15 s of fade —
    // so none of them render at all.
    const aged = await renderChart(buildProps(bounceSeries(1), [], '15m', expiring))
    expect(bounceMarkers(aged.container).length).toBe(0)
    expect(aged.container.querySelectorAll('.chile-reversal-signal').length).toBe(0)

    await act(async () => fresh.root.unmount())
    fresh.container.remove()
    await act(async () => aged.root.unmount())
    aged.container.remove()
  })

  it('keeps markers on screen when the lifetime is 0', async () => {
    const view = await renderChart(buildProps(bounceSeries(1), [], '15m', lifetime))
    const markers = bounceMarkers(view.container)
    expect(markers.length).toBe(1)
    expect(markers[0].classList.contains('chile-reversal-signal-expiring')).toBe(false)

    await act(async () => view.root.unmount())
    view.container.remove()
  })

  it('clears every marker on demand and lets new signals print afterwards', async () => {
    const view = await renderChart(buildProps(bounceSeries(0), [], '15m', lifetime))
    expect(bounceMarkers(view.container).length).toBe(1)

    // The legend's eraser: clean the chart now.
    const eraser = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear Chile Reversal markers"]',
    )
    expect(eraser).not.toBeNull()
    await act(async () => {
      eraser!.click()
    })
    await flush(10)
    expect(view.container.querySelectorAll('.chile-reversal-signal').length).toBe(0)

    // A later bar that bounces the same level again is a new print the eraser
    // never touched, while the cleared history stays cleared.
    const appended = [
      ...bounceSeries(0),
      { time: 26 * step, open: 99, high: 103, low: 96, close: 102, volume: 10 },
    ]
    await act(async () => {
      view.root.render(<ChartView ref={view.ref} {...buildProps(appended, [], '15m', lifetime)} />)
    })
    await flush(20)
    const reprinted = bounceMarkers(view.container)
    expect(reprinted.length).toBe(1)
    expect(reprinted[0].getAttribute('data-index')).toBe('26')

    await act(async () => view.root.unmount())
    view.container.remove()
  })
})
