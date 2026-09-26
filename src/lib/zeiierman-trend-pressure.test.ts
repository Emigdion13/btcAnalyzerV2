import { describe, expect, it } from 'vitest'
import {
  calculateTrendPressure,
  isTrendPressureSettings,
  trendPressureSettings,
  trendPressurePlots,
  TREND_PRESSURE_DEFAULTS,
} from './zeiierman-trend-pressure'
import { trendPressureHudModel } from './osc-hud'
import type { Candle, Indicator } from './types'

const settings = { ...TREND_PRESSURE_DEFAULTS }
const bar = (i: number, open: number, close: number): Candle => ({
  time: 1_700_000_000 + i * 60,
  open,
  close,
  high: Math.max(open, close),
  low: Math.min(open, close),
  volume: 10,
})
const fixture = [
  ...Array.from({ length: 30 }, (_, i) => bar(i, 100 + i, 101 + i)),
  ...Array.from({ length: 35 }, (_, i) => bar(i + 30, 130 - i, 129 - i)),
]

describe('Zeiierman Trend Pressure', () => {
  it('validates Pine input ranges and restores defaults for invalid stored settings', () => {
    expect(isTrendPressureSettings(settings)).toBe(true)
    expect(isTrendPressureSettings({ ...settings, sensitivity: 0 })).toBe(false)
    expect(isTrendPressureSettings({ ...settings, pulseRange: 3.5 })).toBe(false)
    expect(isTrendPressureSettings({ ...settings, hot: 'red' })).toBe(false)
    expect(
      trendPressurePlots(calculateTrendPressure(fixture, settings), settings).length,
    ).toBeGreaterThan(10)
    expect(
      trendPressureSettings({ trendPressure: { ...settings, sensitivity: 99 } } as Indicator),
    ).toEqual(settings)
  })

  it('seeds the first EMA from the first observation and keeps every series aligned', () => {
    const v = calculateTrendPressure([bar(0, 100, 101)], settings, 0.01)
    expect(v.pulse[0]).toBeCloseTo(-28) // WR = 0; flat stochastic denominator => -100
    expect(v.trend).toEqual([0])
    expect(v.core).toHaveLength(1)
    expect(v.core[0]).toBeGreaterThan(-100)
    expect(v.upperActive).toEqual([false])
    expect(calculateTrendPressure([], settings).boxes).toEqual([])
  })

  it('confirms and releases exhaustion without repainting earlier bars; caps price boxes', () => {
    const tuned = { ...settings, sensitivity: 1, maxBoxes: 1 }
    const v = calculateTrendPressure(fixture, tuned, 0.01)
    expect(v.pulse).toHaveLength(fixture.length)
    expect(v.trend.every((x) => x !== null && x >= -100 && x <= 0)).toBe(true)
    expect(v.upperStart.some(Boolean)).toBe(true)
    expect(v.upperRelease.some(Boolean)).toBe(true)
    const release = v.upperRelease.findIndex(Boolean)
    expect(v.upperReleasePrice[release]).toBeGreaterThanOrEqual(fixture[0].high)
    const uncapped = calculateTrendPressure(fixture, { ...tuned, maxBoxes: 300 }, 0.01)
    const upperBox = uncapped.boxes.find((box) => box.side === 'upper' && box.end === release - 1)!
    expect(v.upperReleasePrice[release]).toBe(upperBox.top)
    expect(v.boxes.length).toBeLessThanOrEqual(1)
    expect(v.boxes[0]?.start).toBeLessThanOrEqual(v.boxes[0]?.end ?? -1)
    const first = calculateTrendPressure(fixture.slice(0, 25), tuned, 0.01)
    expect(v.pulse.slice(0, 25)).toEqual(first.pulse)
    expect(v.trend.slice(0, 25)).toEqual(first.trend)
    expect(v.upperStart.slice(0, 25)).toEqual(first.upperStart)
  })

  it('shares pulse, trend, core and sensitivity levels with the floating window', () => {
    const values = calculateTrendPressure(fixture, settings, 0.01)
    const plots = trendPressurePlots(values, settings)
    expect(plots.find((p) => p.title === 'Z-Pulse')?.values).toBe(values.pulse)
    expect(plots.find((p) => p.title === 'Pressure Core')?.colors).toBe(values.coreColors)
    const hud = trendPressureHudModel(values, settings, {
      times: fixture.map((c) => c.time),
      timeframe: '1m',
      bars: 20,
      index: fixture.length - 1,
      settingsSource: 'chart',
    })
    expect(hud.times).toHaveLength(20)
    expect(hud.traces[0].values).toEqual(values.pulse.slice(-20))
    expect(hud.traces[1].values).toEqual(values.trend.slice(-20))
    expect(hud.traces[2].values).toEqual(values.core.slice(-20))
    expect(hud.levels.map((level) => level.value)).toEqual([values.upper, -50, values.lower])
  })
})
