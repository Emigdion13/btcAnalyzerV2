// Independent native port of Zeiierman's Trend Pressure (Pine v6).
// © Zeiierman — CC BY-NC-SA 4.0. See THIRD_PARTY_NOTICES.md.
import type { Candle, Indicator, Plot, TrendPressureSettings } from './types'

export const TREND_PRESSURE_DEFAULTS: Readonly<TrendPressureSettings> = {
  pulseRange: 21,
  pulseStochastic: 9,
  pulseSmoothing: 7,
  trendRange: 55,
  macroTrend: 120,
  trendSmoothing: 5,
  trendPersistence: 9,
  exhaustionZone: 20,
  sensitivity: 7,
  showCrosses: false,
  reactiveSmoothing: 16,
  regimeWeight: 0.65,
  cold: '#2962ff',
  hot: '#e6283e',
  upperLevel: '#e6283e',
  lowerLevel: '#2962ff',
  levelTransparency: 20,
  pulseColor: '#e5e7eb',
  trendColor: '#8baeff',
  coreBull: '#40e3c3',
  coreBear: '#df5141',
  coreNeutral: '#c0c0c0',
  coreWidth: 2,
  gradientFill: true,
  priceBoxes: true,
  maxBoxes: 60,
}
const bounds: Partial<Record<keyof TrendPressureSettings, [number, number, number]>> = {
  pulseRange: [3, 2000, 1],
  pulseStochastic: [3, 2000, 1],
  pulseSmoothing: [1, 50, 1],
  trendRange: [5, 2000, 1],
  macroTrend: [10, 2000, 1],
  trendSmoothing: [1, 30, 1],
  trendPersistence: [0, 20, 0.5],
  exhaustionZone: [5, 40, 1],
  sensitivity: [1, 10, 1],
  reactiveSmoothing: [1, 30, 1],
  regimeWeight: [0, 1, 0.05],
  levelTransparency: [0, 100, 1],
  coreWidth: [1, 4, 1],
  maxBoxes: [1, 300, 1],
}
export function isTrendPressureSettings(value: unknown): value is TrendPressureSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as TrendPressureSettings
  return Object.entries(TREND_PRESSURE_DEFAULTS).every(([key, defaultValue]) => {
    const v = s[key as keyof TrendPressureSettings]
    const limit = bounds[key as keyof TrendPressureSettings]
    if (limit)
      return (
        typeof v === 'number' &&
        Number.isFinite(v) &&
        v >= limit[0] &&
        v <= limit[1] &&
        (limit[2] !== 1 || Number.isInteger(v))
      )
    if (typeof defaultValue === 'boolean') return typeof v === 'boolean'
    return typeof v === 'string' && /^#[\da-f]{6}$/i.test(v)
  })
}
export function trendPressureSettings(indicator: Indicator): TrendPressureSettings {
  return isTrendPressureSettings(indicator.trendPressure)
    ? indicator.trendPressure
    : { ...TREND_PRESSURE_DEFAULTS }
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
type Values = (number | null)[]
// Pine ta.ema seeds on the first non-na observation; na does not reset the recurrence.
function ema(values: Values, length: number): Values {
  let previous: number | null = null
  const alpha = 2 / (length + 1)
  return values.map((v) => {
    if (v === null) return null
    previous = previous === null ? v : previous + alpha * (v - previous)
    return previous
  })
}
function highest(values: Values, k: number): Values {
  return values.map((_, i) => {
    const window = values
      .slice(Math.max(0, i - k + 1), i + 1)
      .filter((v): v is number => v !== null)
    return window.length ? Math.max(...window) : null
  })
}
function lowest(values: Values, k: number): Values {
  return highest(
    values.map((v) => (v === null ? null : -v)),
    k,
  ).map((v) => (v === null ? null : -v))
}
function sma(values: Values, k: number): Values {
  return values.map((_, i) => {
    const slice = values.slice(i - k + 1, i + 1)
    return slice.length === k && slice.every((v) => v !== null)
      ? slice.reduce<number>((sum, v) => sum + v!, 0) / k
      : null
  })
}
export interface PressureBox {
  start: number
  end: number
  top: number
  bottom: number
  side: 'upper' | 'lower'
}
export interface TrendPressureValues {
  pulse: Values
  trend: Values
  core: Values
  coreColors: string[]
  upper: number
  lower: number
  upperActive: boolean[]
  lowerActive: boolean[]
  upperStart: boolean[]
  lowerStart: boolean[]
  upperRelease: boolean[]
  lowerRelease: boolean[]
  crossUp: boolean[]
  crossDown: boolean[]
  boxes: PressureBox[]
  upperReleasePrice: Values
  lowerReleasePrice: Values
}
export function calculateTrendPressure(
  candles: Candle[],
  s: TrendPressureSettings,
  tick = 1e-8,
): TrendPressureValues {
  if (!isTrendPressureSettings(s)) throw new Error('Invalid Trend Pressure settings.')
  if (!(tick > 0) || !Number.isFinite(tick)) tick = 1e-8
  const high = candles.map((c) => c.high),
    low = candles.map((c) => c.low)
  const close = candles.map((c) => c.close)
  const wr = (k: number) => {
    const hi = highest(high, k),
      lo = lowest(low, k)
    return close.map((v, i) => (100 * (v - hi[i]!)) / Math.max(hi[i]! - lo[i]!, tick))
  }
  const fast = wr(s.pulseRange),
    mid = wr(s.trendRange),
    macro = wr(s.macroTrend)
  const rfHi = highest(fast, s.pulseStochastic),
    rfLo = lowest(fast, s.pulseStochastic)
  const raw = fast.map((v, i) =>
    clamp(
      v * 0.72 + (-100 + (100 * (v - rfLo[i]!)) / Math.max(rfHi[i]! - rfLo[i]!, 1e-10)) * 0.28,
      -100,
      0,
    ),
  )
  const pulse = s.pulseSmoothing > 1 ? ema(raw, s.pulseSmoothing) : raw
  const weight = 1 - 0.18 - 0.72
  const consensus = fast.map((v, i) =>
    clamp(v * weight + mid[i]! * 0.18 + macro[i]! * 0.72, -100, 0),
  )
  const agreement = fast.map(
    (v, i) =>
      1 -
      clamp(
        (Math.abs(v - mid[i]!) + Math.abs(mid[i]! - macro[i]!) + Math.abs(v - macro[i]!)) / 300,
        0,
        1,
      ),
  )
  const change = close.map((v, i) => (i ? Math.abs(v - close[i - 1]!) : null))
  const path = sma(change, s.trendRange)
  const efficiency = close.map((v, i) =>
    i < s.trendRange || path[i] === null
      ? 0
      : clamp(
          Math.abs(v - close[i - s.trendRange]!) / Math.max(path[i]! * s.trendRange, tick),
          0,
          1,
        ),
  )
  let upHold = 0,
    downHold = 0
  const target = consensus.map((v) => {
    upHold = v > -30 ? Math.min(1, upHold * 0.93 + 0.07) : upHold * 0.94
    downHold = v < -70 ? Math.min(1, downHold * 0.93 + 0.07) : downHold * 0.94
    return clamp(v + s.trendPersistence * (upHold - downHold), -100, 0)
  })
  const smoothedTarget = ema(target, 2)
  const base = 2 / (s.trendSmoothing + 1)
  const trend: Values = []
  smoothedTarget.forEach((v, i) => {
    if (i === 0) {
      trend.push(v)
      return
    }
    const prev = trend[i - 1]!
    const side = macro[i]! > -50 ? 1 : macro[i]! < -50 ? -1 : 0
    const pull = (side === 1 && v! < prev) || (side === -1 && v! > prev)
    const lock = clamp(0.15 + agreement[i]! * efficiency[i]! * 0.92, 0, 0.97)
    const alpha = pull ? Math.max(0.015, base * (1 - lock)) : Math.max(base * 0.75, 0.03)
    trend.push(clamp(prev + alpha * (v! - prev), -100, 0))
  })
  // Pine `prs(k)`: same candle anatomy at the reactive (21) and regime (112) horizons.
  const pressureAt = (k: number): number[] => {
    const hi = highest(high, k),
      lo = lowest(low, k)
    return candles.map((c, i) => {
      const range = Math.max(hi[i]! - lo[i]!, tick)
      const candleRange = Math.max(c.high - c.low, tick)
      const upperWick = c.high - Math.max(c.open, c.close)
      const lowerWick = Math.min(c.open, c.close) - c.low
      return clamp(
        (((c.close - lo[i]!) / range) * 0.42 +
          (((c.high + c.low + c.close) / 3 - lo[i]!) / range) * 0.23 +
          ((c.close - c.open) / candleRange + 1) * 0.5 * 0.13 +
          ((lowerWick - upperWick) / candleRange + 1) * 0.5 * 0.12 +
          ((c.close - (close[i - 5] ?? c.close)) / range + 1) * 0.5 * 0.1) *
          100,
        0,
        100,
      )
    })
  }
  const pressure = pressureAt(21)
  const reactive = ema(pressure, s.reactiveSmoothing)
  const regime = ema(pressureAt(112), 3)
  const core = pressure.map(
    (_, i) => regime[i]! * s.regimeWeight + reactive[i]! * (1 - s.regimeWeight) - 100,
  )
  const coreColors = core.map((v, i) =>
    v > -50 && regime[i]! > 50
      ? `${s.coreBull}d9`
      : v < -50 && regime[i]! < 50
        ? `${s.coreBear}d9`
        : `${s.coreNeutral}a6`,
  )
  const d = s.sensitivity - 5,
    zone = clamp(s.exhaustionZone - d * 4, 8, 42)
  const rebound = clamp(8 + d * 1.75, 1, 18),
    upper = -zone,
    lower = -100 + zone
  const confirm = s.sensitivity <= 5 ? 1 : s.sensitivity <= 7 ? 2 : s.sensitivity <= 9 ? 3 : 4
  let state = 0,
    upperCount = 0,
    lowerCount = 0
  const upperActive: boolean[] = [],
    lowerActive: boolean[] = [],
    upperStart: boolean[] = [],
    lowerStart: boolean[] = []
  const upperRelease: boolean[] = [],
    lowerRelease: boolean[] = [],
    crossUp: boolean[] = [],
    crossDown: boolean[] = []
  const boxes: PressureBox[] = []
  const upperReleasePrice: Values = [],
    lowerReleasePrice: Values = []
  let activeBox: PressureBox | null = null
  candles.forEach((c, i) => {
    const p = pulse[i],
      t = trend[i]
    upperCount = p !== null && t !== null && p >= upper && t >= upper ? upperCount + 1 : 0
    lowerCount = p !== null && t !== null && p <= lower && t <= lower ? lowerCount + 1 : 0
    const before = state
    if (!state) {
      if (upperCount >= confirm) state = 1
      else if (lowerCount >= confirm) state = -1
    } else if (p !== null && t !== null) {
      const fast = s.sensitivity <= 2
      if (
        state === 1 &&
        (fast
          ? p < upper - rebound || t < upper - rebound
          : p < upper - rebound && t < upper - rebound)
      )
        state = 0
      else if (
        state === -1 &&
        (fast
          ? p > lower + rebound || t > lower + rebound
          : p > lower + rebound && t > lower + rebound)
      )
        state = 0
    }
    upperActive.push(state === 1)
    lowerActive.push(state === -1)
    upperStart.push(state === 1 && before !== 1)
    lowerStart.push(state === -1 && before !== -1)
    upperRelease.push(state === 0 && before === 1)
    lowerRelease.push(state === 0 && before === -1)
    upperReleasePrice.push(state === 0 && before === 1 && activeBox ? activeBox.top : null)
    lowerReleasePrice.push(state === 0 && before === -1 && activeBox ? activeBox.bottom : null)
    crossUp.push(
      i > 0 && p !== null && pulse[i - 1] !== null && p > t! && pulse[i - 1]! <= trend[i - 1]!,
    )
    crossDown.push(
      i > 0 && p !== null && pulse[i - 1] !== null && p < t! && pulse[i - 1]! >= trend[i - 1]!,
    )
    if (state !== before && state !== 0) {
      activeBox = {
        start: i,
        end: i,
        top: c.high,
        bottom: c.low,
        side: state === 1 ? 'upper' : 'lower',
      }
      boxes.push(activeBox)
    } else if (activeBox && state !== 0) {
      activeBox.end = i
      activeBox.top = Math.max(activeBox.top, c.high)
      activeBox.bottom = Math.min(activeBox.bottom, c.low)
    } else if (state === 0) activeBox = null
  })
  return {
    pulse,
    trend,
    core,
    coreColors,
    upper,
    lower,
    upperActive,
    lowerActive,
    upperStart,
    lowerStart,
    upperRelease,
    lowerRelease,
    crossUp,
    crossDown,
    boxes: boxes.slice(-s.maxBoxes),
    upperReleasePrice,
    lowerReleasePrice,
  }
}

export function trendPressurePlots(v: TrendPressureValues, s: TrendPressureSettings): Plot[] {
  const n = v.pulse.length
  const faded = (color: string) =>
    `${color}${Math.round((100 - s.levelTransparency) * 2.55)
      .toString(16)
      .padStart(2, '0')}`
  const level = (title: string, value: number, color: string): Plot => ({
    title,
    values: Array(n).fill(value),
    color: faded(color),
    pane: 'oscillator',
    lineWidth: 1,
    horizontalLine: value,
    hideLegend: true,
  })
  const marks = (
    flags: boolean[],
    value: number,
    title: string,
    color: string,
    style: 'circles' | 'cross' = 'circles',
  ): Plot => ({
    title,
    values: flags.map((on) => (on ? value : null)),
    pane: 'oscillator',
    color,
    lineWidth: 2,
    style,
    hideLegend: true,
  })
  return [
    level('Upper Bound', 0, s.upperLevel),
    level('Upper Pressure Level', v.upper, s.upperLevel),
    level('Equilibrium', -50, '#777777'),
    level('Lower Pressure Level', v.lower, s.lowerLevel),
    level('Lower Bound', -100, s.lowerLevel),
    { title: 'Z-Pulse', values: v.pulse, color: s.pulseColor, pane: 'oscillator', lineWidth: 1 },
    { title: 'Z-Trend', values: v.trend, color: s.trendColor, pane: 'oscillator', lineWidth: 2 },
    {
      title: 'Pressure Core',
      values: v.core,
      color: s.coreNeutral,
      colors: v.coreColors,
      colorMode: 'bar',
      pane: 'oscillator',
      lineWidth: s.coreWidth,
    },
    marks(v.upperActive, 5, 'Upper Pressure Active', s.hot),
    marks(v.lowerActive, -107, 'Lower Pressure Active', s.cold),
    marks(v.upperStart, 5, 'Upper Pressure Start', s.hot, 'cross'),
    marks(v.lowerStart, -107, 'Lower Pressure Start', s.cold, 'cross'),
    marks(v.upperRelease, 5, 'Upper Pressure Release', s.hot),
    marks(v.lowerRelease, -107, 'Lower Pressure Release', s.cold),
    ...(s.showCrosses
      ? [
          {
            title: 'Bullish Cross',
            values: v.trend.map((t, i) => (v.crossUp[i] ? t : null)),
            color: s.cold,
            pane: 'oscillator' as const,
            style: 'circles' as const,
            lineWidth: 4,
            hideLegend: true,
          },
          {
            title: 'Bearish Cross',
            values: v.trend.map((t, i) => (v.crossDown[i] ? t : null)),
            color: s.hot,
            pane: 'oscillator' as const,
            style: 'circles' as const,
            lineWidth: 4,
            hideLegend: true,
          },
        ]
      : []),
  ]
}
