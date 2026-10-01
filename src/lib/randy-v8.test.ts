import { describe, expect, it } from 'vitest'
import { bucketStart } from '../../shared/coinbase'
import {
  RANDY_V8_FIELDS,
  calculateRandyV8,
  isRandyV8Settings,
  randyV8Internals,
  randyV8Plots,
  randyV8RequestedTimeframes,
  randyV8Settings,
} from './randy-v8'
import { requestedIndicatorTimeframes } from './cm-ult-macd'
import { parseWorkspaceBackup } from './workspace-backup'
import type { WorkspaceBackup } from './workspace-backup'
import {
  DEFAULT_INDICATORS,
  DEFAULT_SETTINGS,
  RANDY_V8_DEFAULTS,
  type Candle,
  type Indicator,
  type Timeframe,
} from './types'

const MINUTE = 60
/** 2026-01-05 00:00 UTC — a quarter-hour boundary. */
const START = 1_767_571_200

/** Deterministic pseudo-random walk (mulberry32), so every run sees the same market. */
function walk(count: number, seed = 7, drift = 0, start = START): Candle[] {
  let a = seed
  const random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let price = 100_000
  return Array.from({ length: count }, (_, i) => {
    const open = price
    const close = open + drift + (random() - 0.5) * 90
    price = close
    return {
      time: start + i * MINUTE,
      open,
      high: Math.max(open, close) + random() * 25,
      low: Math.min(open, close) - random() * 25,
      close,
      volume: 5 + random() * 20,
    }
  })
}

function aggregate(candles: Candle[], timeframe: Timeframe): Candle[] {
  const out: Candle[] = []
  for (const c of candles) {
    const time = bucketStart(c.time, timeframe)
    const last = out[out.length - 1]
    if (last && last.time === time) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume += c.volume
    } else out.push({ ...c, time })
  }
  return out
}

const feeds = (candles: Candle[]) => ({
  '5m': { candles: aggregate(candles, '5m') },
  '15m': { candles: aggregate(candles, '15m') },
  '1h': { candles: aggregate(candles, '1h') },
})

const run = (candles: Candle[], target: number, extra: Partial<typeof RANDY_V8_DEFAULTS> = {}) =>
  calculateRandyV8(
    candles,
    { ...RANDY_V8_DEFAULTS, target, ...extra },
    { timeframe: '1m', timeframes: feeds(candles) },
  )

describe('Randy V8.10 settings', () => {
  it('accepts the published defaults and rejects values outside the Pine ranges', () => {
    expect(isRandyV8Settings(RANDY_V8_DEFAULTS)).toBe(true)
    expect(isRandyV8Settings({ ...RANDY_V8_DEFAULTS, confirmBars: 5 })).toBe(false)
    expect(isRandyV8Settings({ ...RANDY_V8_DEFAULTS, confirmBars: 1.5 })).toBe(false)
    expect(isRandyV8Settings({ ...RANDY_V8_DEFAULTS, minEdgePct: 64.5 })).toBe(true)
    expect(isRandyV8Settings({ ...RANDY_V8_DEFAULTS, target: -1 })).toBe(false)
    expect(isRandyV8Settings({ ...RANDY_V8_DEFAULTS, showEmas: 'yes' })).toBe(false)
    expect(isRandyV8Settings(null)).toBe(false)
  })

  it('keeps every default inside its own field range', () => {
    for (const field of RANDY_V8_FIELDS) {
      const value = RANDY_V8_DEFAULTS[field.key]
      expect(value).toBeGreaterThanOrEqual(field.min)
      expect(value).toBeLessThanOrEqual(field.max)
    }
  })

  it('falls back to the defaults for a missing or invalid stored profile', () => {
    const base = {
      id: 'r',
      kind: 'randy-v8',
      name: 'Randy',
      period: 1,
      color: '#fff',
      visible: true,
    }
    expect(randyV8Settings(base as Indicator)).toEqual(RANDY_V8_DEFAULTS)
    expect(
      randyV8Settings({ ...base, randyV8: { ...RANDY_V8_DEFAULTS, target: 99_000 } } as Indicator)
        .target,
    ).toBe(99_000)
    expect(
      randyV8Settings({ ...base, randyV8: { ...RANDY_V8_DEFAULTS, rsiLength: 0 } } as Indicator),
    ).toEqual(RANDY_V8_DEFAULTS)
  })

  it('asks for every resolution except the chart’s own', () => {
    expect(randyV8RequestedTimeframes('1m')).toEqual(['5m', '15m', '1h'])
    expect(randyV8RequestedTimeframes('5m')).toEqual(['15m', '1h'])
  })
})

describe('the forming-bar recursion', () => {
  it('reproduces the closed bar when fed that bar’s final values', () => {
    const candles = aggregate(walk(900), '5m')
    const { buildPack, closedFrame, formingFrame, contextScore } = randyV8Internals
    const make = (source: Candle[]) => buildPack(source, 20, 50, 14, 14, 20)
    const full = make(candles)
    for (const k of [60, 90, 120, 150]) {
      const before = make(candles.slice(0, k))
      const c = candles[k]!
      const forming = formingFrame(before, k - 1, c)
      const closed = closedFrame(full, k)
      for (const key of Object.keys(closed) as (keyof typeof closed)[]) {
        const a = forming[key]
        const b = closed[key]
        if (a === null || b === null) expect(a).toBe(b)
        else expect(a).toBeCloseTo(b, 8)
      }
      expect(contextScore(forming, 1.15)).toBe(contextScore(closed, 1.15))
    }
  })
})

describe('calculateRandyV8', () => {
  const candles = walk(1500)
  const target = Math.round(candles[candles.length - 1]!.close)

  it('reports the missing feeds instead of scoring against invented bars', () => {
    const result = calculateRandyV8(
      candles,
      { ...RANDY_V8_DEFAULTS, target },
      { timeframe: '1m', timeframes: { '5m': { candles: aggregate(candles, '5m') } } },
    )
    expect(result.missingFeeds).toEqual(['15m', '1h'])
    expect(result.bars.every((bar) => !bar.ready)).toBe(true)
    expect(result.entries).toEqual([])
  })

  it('returns one bar per chart candle with a UP/DOWN meter that always sums to 100', () => {
    const result = run(candles, target)
    expect(result.bars).toHaveLength(candles.length)
    expect(result.last?.ready).toBe(true)
    for (const bar of result.bars) {
      expect(bar.meterUpPct + bar.meterDownPct).toBe(100)
      expect(bar.dirUpPct + bar.dirDownPct).toBe(100)
      expect(bar.strength).toBeGreaterThanOrEqual(0)
      expect(bar.strength).toBeLessThanOrEqual(100)
      expect(Math.abs(bar.scalpScore)).toBeLessThanOrEqual(100)
    }
  })

  it('asks for a target before it calls anything', () => {
    const empty = run(candles, 0)
    expect(empty.last?.decision).toBe('review-target')
    expect(empty.last?.meterUpPct).toBe(50)
    expect(empty.target.every((value) => value === null)).toBe(true)
    // Further than 5% from the close is a typo, not a strike.
    expect(run(candles, 1).last?.targetValid).toBe(false)
  })

  it('never lets a later bar change an earlier one', () => {
    const full = run(candles, target)
    for (const cut of [700, 1000, 1337]) {
      const partial = run(candles.slice(0, cut), target)
      for (let i = 60; i < cut - 1; i++) {
        const a = full.bars[i]!
        const b = partial.bars[i]!
        expect(b.scalpScore).toBeCloseTo(a.scalpScore, 9)
        expect(b.meterUpPct).toBe(a.meterUpPct)
        expect(b.decision).toBe(a.decision)
        expect(b.scores.live5).toBeCloseTo(a.scores.live5, 9)
      }
    }
  })

  it('clocks history on the bar close and the live bar on the wall clock', () => {
    const history = run(candles, target)
    const bar = history.bars.find((b) => (b.time - START) % 900 === 14 * 60 && b.ready)!
    expect(bar.secondsLeft).toBe(0)
    const first = history.bars.find((b) => (b.time - START) % 900 === 0 && b.ready)!
    expect(first.secondsLeft).toBe(840)

    const lastTime = candles[candles.length - 1]!.time
    const now = lastTime + 10
    const live = calculateRandyV8(
      candles,
      { ...RANDY_V8_DEFAULTS, target },
      { timeframe: '1m', timeframes: feeds(candles), nowSeconds: now },
    )
    expect(live.last?.confirmed).toBe(false)
    expect(live.last?.secondsLeft).toBe(Math.max(bucketStart(lastTime, '15m') + 900 - now, 0))
    // A clock far from the data (demo, replay) leaves every bar confirmed.
    const demo = calculateRandyV8(
      candles,
      { ...RANDY_V8_DEFAULTS, target },
      { timeframe: '1m', timeframes: feeds(candles), nowSeconds: lastTime + 86_400 },
    )
    expect(demo.last?.confirmed).toBe(true)
  })

  it('leans UP in a rising market with the strike underneath', () => {
    const rising = walk(1500, 11, 6)
    const last = rising[rising.length - 1]!.close
    const result = run(rising, Math.round(last - 120))
    expect(result.last?.targetValid).toBe(true)
    expect(result.last?.distance).toBeGreaterThan(0)
    expect(result.last?.meterUpPct).toBeGreaterThan(50)
    expect(result.last?.scalpScore).toBeGreaterThan(0)
  })

  it('leans DOWN in a falling market with the strike above', () => {
    const falling = walk(1500, 11, -6)
    const last = falling[falling.length - 1]!.close
    const result = run(falling, Math.round(last + 120))
    expect(result.last?.distance).toBeLessThan(0)
    expect(result.last?.meterDownPct).toBeGreaterThan(50)
    expect(result.last?.scalpScore).toBeLessThan(0)
  })

  it('prints ENTER markers only on confirmed bars, once per turn', () => {
    // A strike far enough from every close that it stays valid, in a series with real swings.
    const swingy = walk(3000, 3, 0.4)
    const result = run(swingy, Math.round(swingy[1500]!.close), { scalpThreshold: 24 })
    let previous = 0
    for (const bar of result.bars) {
      if (bar.confirmed && bar.entry !== 0 && previous !== bar.entry) {
        expect(result.entries.some((e) => e.index === bar.index)).toBe(true)
      }
      previous = bar.entry
    }
    expect(result.entries.length).toBe(
      result.bars.filter(
        (bar, i) =>
          bar.confirmed && bar.entry !== 0 && (result.bars[i - 1]?.entry ?? 0) !== bar.entry,
      ).length,
    )
  })

  it('builds chart-aligned price plots', () => {
    const result = run(candles, target)
    const plots = randyV8Plots(result, { ...RANDY_V8_DEFAULTS, target }, candles, '1m')
    expect(plots.map((plot) => plot.title)).toEqual([
      'EMA 9',
      'EMA 20',
      'TARGET KALSHI',
      'Resistance 5M',
      'Support 5M',
      'Map MAX 15M',
      'Map MIN 15M',
      'Map MAX 1H',
      'Map MIN 1H',
      'ENTER UP',
      'ENTER DOWN',
    ])
    for (const plot of plots) expect(plot.values).toHaveLength(candles.length)
    // The EMAs belong to the 1M engine: off the 1M chart they do not draw.
    const off = randyV8Plots(result, { ...RANDY_V8_DEFAULTS, target }, candles, '5m')
    expect(off[0]!.values.every((value) => value === null)).toBe(true)
    const hidden = randyV8Plots(
      result,
      { ...RANDY_V8_DEFAULTS, target, showTarget: false, showLevels: false },
      candles,
      '1m',
    )
    expect(hidden[2]!.values.every((value) => value === null)).toBe(true)
    expect(hidden[3]!.values.every((value) => value === null)).toBe(true)
  })
})

describe('Randy V8.10 in the workspace', () => {
  const indicator: Indicator = {
    id: 'randy',
    kind: 'randy-v8',
    name: 'Randy V8.10',
    period: 1,
    color: '#22d3ee',
    visible: true,
    randyV8: { ...RANDY_V8_DEFAULTS, target: 99_500.5 },
  }

  it('asks for the 5m, 15m and 1h feeds only while the indicator is visible', () => {
    expect(requestedIndicatorTimeframes([indicator], '1m')).toEqual(['15m', '1h', '5m'])
    expect(requestedIndicatorTimeframes([indicator], '5m')).toEqual(['15m', '1h'])
    expect(requestedIndicatorTimeframes([{ ...indicator, visible: false }], '1m')).toEqual([])
  })

  const backup = (indicators: Indicator[]): WorkspaceBackup => ({
    version: 1,
    exportedAt: '2026-09-07T00:00:00.000Z',
    workspaceName: 'My workspace',
    symbol: 'BTCUSDT',
    timeframe: '1m',
    chartType: 'candles',
    settings: { ...DEFAULT_SETTINGS },
    watchlist: ['BTCUSDT'],
    tabs: ['BTCUSDT'],
    indicators: [...DEFAULT_INDICATORS.map((i) => ({ ...i })), ...indicators],
    drawings: {},
    scripts: [],
    draft: { id: 'draft', name: 'Test', source: 'plot(close);' },
    alerts: [],
    notes: '',
  })

  it('survives an export and import with its Target and profile', () => {
    const parsed = parseWorkspaceBackup(JSON.parse(JSON.stringify(backup([indicator]))))
    const restored = parsed.indicators.find((i) => i.kind === 'randy-v8')
    expect(restored?.randyV8).toEqual(indicator.randyV8)
  })

  it('rejects an imported profile that is out of range', () => {
    const bad = { ...indicator, randyV8: { ...RANDY_V8_DEFAULTS, confirmBars: 9 } }
    expect(() => parseWorkspaceBackup(JSON.parse(JSON.stringify(backup([bad]))))).toThrow(
      /Randy V8.10 settings/,
    )
  })
})
