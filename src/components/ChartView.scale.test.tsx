// @vitest-environment jsdom
/**
 * The candle pane's price scale against polluted tape data, run through the real
 * <ChartView> on lightweight-charts with a stubbed 2D canvas (scale math is real
 * JS; rasterisation is stubbed — the same seam as the chile-sync suite).
 *
 * The failure this pins: one glitch print merged into a bar's wick used to
 * stretch the price axis to the outlier, flattening every candle into an
 * unreadable band with huge steps between price labels. Auto-fit must clamp
 * that wick so the candles stay readable; manual price zoom must stick until the
 * view is reset.
 */
import { act, type ComponentProps } from 'react'
import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as charts from 'lightweight-charts'
import { ChartView } from './ChartView'
import type { ChartHandle } from './ChartView'
import { DEFAULT_SETTINGS } from '../lib/types'
import type { Candle, Indicator } from '../lib/types'
import { generateCandles, getAsset } from '../lib/market'
import { TREND_PRESSURE_DEFAULTS } from '../lib/zeiierman-trend-pressure'

// Observe construction without replacing the real chart/scale implementation.
vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof charts>()
  return { ...actual, createChart: vi.fn(actual.createChart) }
})

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
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({
      matches: false,
      media: '',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
    configurable: true,
  })
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  const size = (
    proto: 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight',
    value: number,
  ) => {
    const prev = Object.getOwnPropertyDescriptor(HTMLElement.prototype, proto)
    Object.defineProperty(HTMLElement.prototype, proto, { get: () => value, configurable: true })
    restore.push(() => prev && Object.defineProperty(HTMLElement.prototype, proto, prev))
  }
  size('clientWidth', 1200)
  size('clientHeight', 800)
  size('offsetWidth', 1200)
  size('offsetHeight', 800)
  const prevGetBCR = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      width: 1200,
      height: 800,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
  }
  restore.push(() => (HTMLElement.prototype.getBoundingClientRect = prevGetBCR))
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

const flush = async (ms = 10) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

function buildProps(candles: Candle[], indicators: Indicator[] = []) {
  return {
    source: 'demo' as const,
    feedState: 'live' as const,
    asset: getAsset('BTCUSDT'),
    candles,
    timeframe: '1m' as const,
    chartType: 'candles' as const,
    indicators,
    customResults: {},
    indicatorTimeframes: {},
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
    onOscHudClose: () => {},
    replay: false,
    book: null,
  }
}

async function renderChart(candles: Candle[], indicators: Indicator[] = []) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const ref = createRef<ChartHandle>()
  const root: Root = createRoot(container)
  let props: ComponentProps<typeof ChartView> = buildProps(candles, indicators)
  const createChart = vi.mocked(charts.createChart)
  createChart.mockClear()
  await act(async () => {
    root.render(<ChartView {...props} ref={ref} />)
  })
  const chart = createChart.mock.results[0].value as charts.IChartApi
  await flush(30)
  return {
    ref,
    chart,
    container,
    rerender: async (overrides: Partial<ComponentProps<typeof ChartView>> = {}) => {
      props = { ...props, settings: { ...props.settings }, ...overrides }
      await act(async () => {
        root.render(<ChartView {...props} ref={ref} />)
      })
      await flush(30)
    },
    dispose: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

describe('candle pane price scale under tape glitches', () => {
  it('keeps candles readable when a wick carries a glitch print', async () => {
    const asset = getAsset('BTCUSDT')
    const candles = generateCandles(asset, '1m')
    const last = candles.length - 1
    // A bad print merged into a visible bar's high/low — the flattening bug.
    candles[last - 50] = { ...candles[last - 50], high: 200_000 }
    candles[last - 30] = { ...candles[last - 30], low: 1 }
    const { ref, dispose } = await renderChart(candles)
    const range = ref.current!.priceRange()!
    expect(range).not.toBeNull()
    // The scale stays on the market: no label steps of tens of thousands.
    expect(range.to).toBeLessThan(candles[last].close * 1.1)
    expect(range.from).toBeGreaterThan(candles[last].close * 0.9)
    // …while still covering every candle body in view.
    const bodies = candles.slice(-145)
    const bodyLow = Math.min(...bodies.map((c) => Math.min(c.open, c.close)))
    const bodyHigh = Math.max(...bodies.map((c) => Math.max(c.open, c.close)))
    expect(range.from).toBeLessThanOrEqual(bodyLow)
    expect(range.to).toBeGreaterThanOrEqual(bodyHigh)
    await dispose()
  })

  it('keeps the price scale independent when the PR 60 oscillator is present', async () => {
    const asset = getAsset('BTCUSDT')
    const candles = generateCandles(asset, '1m')
    const last = candles.length - 1
    // The indicator adds many series to its own oscillator pane, including levels
    // outside its normal range. None of those values may leak into candle autoscale.
    candles[last - 40] = { ...candles[last - 40], high: 200_000 }
    const pressure: Indicator = {
      id: 'pressure',
      kind: 'zeiierman-trend-pressure',
      name: 'Zeiierman Trend Pressure',
      period: 21,
      color: '#8baeff',
      visible: true,
      trendPressure: { ...TREND_PRESSURE_DEFAULTS },
    }
    const { ref, dispose } = await renderChart(candles, [pressure])
    const range = ref.current!.priceRange()!
    expect(range.from).toBeGreaterThan(candles[last].close * 0.9)
    expect(range.to).toBeLessThan(candles[last].close * 1.1)
    await dispose()
  })

  it('stays tight without glitches too', async () => {
    const asset = getAsset('BTCUSDT')
    const candles = generateCandles(asset, '1m')
    const { ref, dispose } = await renderChart(candles)
    const range = ref.current!.priceRange()!
    const bodies = candles.slice(-145)
    const lows = bodies.map((c) => c.low)
    const highs = bodies.map((c) => c.high)
    // Normal wicks fit exactly — the clamp only trims beyond-median excursions.
    expect(range.from).toBeCloseTo(Math.min(...lows), 4)
    expect(range.to).toBeCloseTo(Math.max(...highs), 4)
    await dispose()
  })

  it('lets manual price zoom stick until the view is reset', async () => {
    const asset = getAsset('BTCUSDT')
    const candles = generateCandles(asset, '1m')
    const { ref, dispose } = await renderChart(candles)
    const before = ref.current!.priceRange()!
    await act(async () => {
      ref.current!.zoomPrice(0.5)
    })
    await flush(30)
    const zoomed = ref.current!.priceRange()!
    // Half the span, around the same center: the candles are twice as tall.
    expect(zoomed.to - zoomed.from).toBeCloseTo((before.to - before.from) / 2, 4)
    expect((zoomed.to + zoomed.from) / 2).toBeCloseTo((before.to + before.from) / 2, 4)
    // A later auto-fit action (reset/latest) restores the robust fit.
    await act(async () => {
      ref.current!.latest()
    })
    await flush(30)
    const reset = ref.current!.priceRange()!
    expect(reset.to - reset.from).toBeCloseTo(before.to - before.from, 4)
    await dispose()
  })
})

describe('scale recovery controls', () => {
  it.each(['reset', 'latest', 'fit'] as const)(
    '%s restores both BTC and CM MACD after manual scale expansion',
    async (action) => {
      const candles = generateCandles(getAsset('BTCUSDT'), '1m')
      const macd: Indicator = {
        id: 'cm',
        kind: 'cm-ult-macd',
        name: 'CM Ultimate MACD',
        period: 12,
        color: '#8baeff',
        visible: true,
      }
      const { ref, chart, container, rerender, dispose } = await renderChart(candles, [macd])
      try {
        const oscillator = chart.priceScale('right', 1)
        const original = oscillator.getVisibleRange()!
        await act(async () => {
          ref.current!.zoomPrice(20)
          oscillator.setVisibleRange({ from: -100_000, to: 100_000 })
        })
        await flush(30)
        expect(oscillator.options().autoScale).toBe(false)
        await act(async () => {
          if (action === 'reset')
            container.querySelector<HTMLButtonElement>('[aria-label="Reset chart view"]')!.click()
          else ref.current![action]()
        })
        await flush(30)
        // A settings effect after recovery must not reinstate the old price pin.
        await rerender()
        expect(chart.priceScale('right').options().autoScale).toBe(true)
        expect(oscillator.options().autoScale).toBe(true)
        const recovered = oscillator.getVisibleRange()!
        expect(recovered.to - recovered.from).toBeLessThan(10_000)
        if (action !== 'fit') expect(recovered).toEqual(original)
      } finally {
        await dispose()
      }
    },
  )
})

describe('price series replacement with oscillator panes', () => {
  it.each(['bars', 'hollow', 'line', 'area', 'asset precision', 'symbol'] as const)(
    'keeps MACD out of the candle pane after changing %s',
    async (change) => {
      const candles = generateCandles(getAsset('BTCUSDT'), '1m')
      const indicators: Indicator[] = [
        {
          id: 'cm',
          kind: 'cm-ult-macd',
          name: 'CM MACD',
          period: 12,
          color: '#8baeff',
          visible: true,
        },
        {
          id: 'pressure',
          kind: 'zeiierman-trend-pressure',
          name: 'Trend Pressure',
          period: 21,
          color: '#8baeff',
          visible: true,
        },
      ]
      const { ref, chart, rerender, dispose } = await renderChart(candles, indicators)
      try {
        const paneCount = chart.panes().length
        const pricePane = chart.panes()[0]
        const macdPane = chart.panes()[1]
        const macdSeries = macdPane.getSeries()
        await rerender(
          change !== 'asset precision' && change !== 'symbol'
            ? { chartType: change }
            : {
                asset: {
                  ...getAsset('BTCUSDT'),
                  ...(change === 'symbol' ? { symbol: 'BTC-USD' } : { priceIncrement: 0.01 }),
                },
              },
        )
        expect(chart.panes()).toHaveLength(paneCount)
        expect(chart.panes()[0]).toBe(pricePane)
        expect(chart.panes()[1]).toBe(macdPane)
        for (const series of macdSeries) expect(chart.panes()[0].getSeries()).not.toContain(series)
        const range = ref.current!.priceRange()!
        expect(range.from).toBeGreaterThan(candles.at(-1)!.close * 0.9)
        expect(range.to).toBeLessThan(candles.at(-1)!.close * 1.1)
        // Replacing it again and clearing indicators must not retain empty
        // oscillator panes or delete the permanent candle pane.
        await rerender({ chartType: 'candles', indicators: [] })
        expect(chart.panes()).toHaveLength(1)
        expect(chart.panes()[0]).toBe(pricePane)
        await rerender({ indicators })
        expect(chart.panes()).toHaveLength(paneCount)
        expect(ref.current!.priceRange()!.from).toBeGreaterThan(candles.at(-1)!.close * 0.9)
      } finally {
        await dispose()
      }
    },
  )

  it('keeps panes separate when precision arrives before the first live candles', async () => {
    const indicators: Indicator[] = [
      {
        id: 'cm',
        kind: 'cm-ult-macd',
        name: 'CM MACD',
        period: 12,
        color: '#8baeff',
        visible: true,
      },
      {
        id: 'pressure',
        kind: 'zeiierman-trend-pressure',
        name: 'Trend Pressure',
        period: 21,
        color: '#8baeff',
        visible: true,
      },
    ]
    const { ref, chart, rerender, dispose } = await renderChart([], indicators)
    try {
      await rerender({ asset: { ...getAsset('BTCUSDT'), priceIncrement: 0.01 } })
      const candles = generateCandles(getAsset('BTCUSDT'), '1m')
      await rerender({ candles })
      expect(chart.panes()).toHaveLength(3)
      expect(chart.panes()[0].getSeries()).toHaveLength(1)
      expect(ref.current!.priceRange()!.from).toBeGreaterThan(candles.at(-1)!.close * 0.9)
      // Adding price overlays later must not hide a previously displaced MACD.
      await rerender({
        indicators: [
          ...indicators,
          {
            id: 'tux',
            kind: 'tux-ema-scalper',
            name: 'TUX EMA Scalper',
            period: 20,
            color: '#39b978',
            visible: true,
          },
        ],
      })
      expect(chart.panes()).toHaveLength(3)
      expect(chart.panes()[0].getSeries()).toHaveLength(4)
      expect(ref.current!.priceRange()!.from).toBeGreaterThan(candles.at(-1)!.close * 0.9)
    } finally {
      await dispose()
    }
  })
})
