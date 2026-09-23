/**
 * Bayesian/nQQE/BankFunds — pane and floating window share this file.
 *
 * The published combo (tartigradia, short title `Bayesian/nQQE/BankFunds`, script
 * `43zBXjjp`) was never obtained as source. What follows is a reconstruction from
 * the published legend, tista's stated three-factor expression, the nQQE = QQE−50
 * description, and the blackcat L3 banker-fund mirror. It is not a byte-for-byte
 * port of the unpublished combo body. The gaps are called out next to the code
 * and in `docs/bayesian-nqqe-bankfunds.md`.
 *
 * One rule: the window is a view of `calculateBayesianNqqeBankfunds`. It does not
 * own a second formula.
 */
import { ta } from './indicator-runtime'
import type {
  BayesianNqqeSettings,
  BayesianNqqeSource,
  Candle,
  Indicator,
  Plot,
} from './types'

export const BAYESIAN_NQQE_SOURCES = [
  'close',
  'open',
  'high',
  'low',
  'hl2',
  'hlc3',
  'ohlc4',
] as const satisfies readonly BayesianNqqeSource[]

/** Hard-coded QQE band factor. It is not a published input, so it is not a setting. */
export const NQQE_FACTOR = 4.236

/** On the 0–100 plotted scale. A score within this of 0 counts as the published "at 0". */
export const BAYES_AT_ZERO = 1e-4
/** A score within this of 100 counts as the published "at 100", not merely "above 100". */
export const BAYES_AT_HUNDRED = 1e-4

export const BAYES_COLORS = {
  down: '#ff0000',
  up: '#00ff00',
  prime: '#ffffff',
  nqqeGreen: '#00ff00',
  nqqeRed: '#ff0000',
  nqqeYellow: '#ffff00',
  bankerYellow: '#ffff00',
  bankerGreen: '#00ff00',
  bankerWhite: '#ffffff',
  bankerRed: '#ff0000',
  bankerBlue: '#0000ff',
  gray: '#808080',
  accent: '#f0c14a',
} as const

export const BAYESIAN_NQQE_DEFAULTS: BayesianNqqeSettings = {
  bbSmaPeriod: 20,
  bbStdDev: 2.5,
  aoFast: 5,
  aoSlow: 34,
  acFast: 5,
  acSlow: 34,
  acAoMa: 13,
  lipsLength: 5,
  teethLength: 8,
  jawLength: 13,
  lipsOffset: 3,
  teethOffset: 5,
  jawOffset: 8,
  smaPeriod: 20,
  bayesPeriod: 20,
  lowerThreshold: 15,
  nqqeSource: 'close',
  nqqeRsiLength: 14,
  nqqeSmooth: 5,
  showProbabilities: true,
  showNqqe: true,
  showBankFunds: true,
  showSignals: true,
  useBwConfirmation: false,
}

const integer = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

export function isBayesianNqqeBankfundsSettings(value: unknown): value is BayesianNqqeSettings {
  if (!value || typeof value !== 'object') return false
  const s = value as BayesianNqqeSettings
  const lengths = [
    s.bbSmaPeriod,
    s.aoFast,
    s.aoSlow,
    s.acFast,
    s.acSlow,
    s.acAoMa,
    s.lipsLength,
    s.teethLength,
    s.jawLength,
    s.smaPeriod,
    s.bayesPeriod,
    s.nqqeRsiLength,
    s.nqqeSmooth,
  ]
  if (!lengths.every((item) => integer(item, 1, 2000))) return false
  if (![s.lipsOffset, s.teethOffset, s.jawOffset].every((item) => integer(item, 0, 200)))
    return false
  if (
    typeof s.bbStdDev !== 'number' ||
    !Number.isFinite(s.bbStdDev) ||
    s.bbStdDev < 0.01 ||
    s.bbStdDev > 100
  )
    return false
  if (
    typeof s.lowerThreshold !== 'number' ||
    !Number.isFinite(s.lowerThreshold) ||
    s.lowerThreshold < 0 ||
    s.lowerThreshold > 100
  )
    return false
  if (!BAYESIAN_NQQE_SOURCES.includes(s.nqqeSource)) return false
  return [
    s.showProbabilities,
    s.showNqqe,
    s.showBankFunds,
    s.showSignals,
    s.useBwConfirmation,
  ].every((item) => typeof item === 'boolean')
}

/** Missing or malformed settings fall back to the published legend. Callers always pass this. */
export function bayesianNqqeSettings(indicator: { bayesianNqqe?: unknown }): BayesianNqqeSettings {
  return isBayesianNqqeBankfundsSettings(indicator.bayesianNqqe)
    ? indicator.bayesianNqqe
    : { ...BAYESIAN_NQQE_DEFAULTS }
}

export function bayesianNqqeIndicatorLabel(indicator: Indicator): string {
  const s = bayesianNqqeSettings(indicator)
  return `Bayesian/nQQE/BankFunds (${s.bbSmaPeriod}, ${s.bbStdDev}, ${s.aoFast}, ${s.aoSlow}, ${s.acFast}, ${s.acSlow}, ${s.acAoMa}, ${s.lipsLength}, ${s.teethLength}, ${s.jawLength}, ${s.lipsOffset}, ${s.teethOffset}, ${s.jawOffset}, ${s.smaPeriod}, ${s.bayesPeriod}, ${s.lowerThreshold}, ${s.nqqeSource}, ${s.nqqeRsiLength}, ${s.nqqeSmooth})`
}

/**
 * The expression the original states, evaluated the way Pine evaluates it:
 * `nz(a*b*c/a*b*c+(1-a)*(1-b)*(1-c))` is left-associative, so it is
 * `((((a*b)*c)/a)*b)*c + (1-a)*(1-b)*(1-c)`.
 * When `a` is not zero that reduces to `(b*c)^2 + (1-a)*(1-b)*(1-c)`, which is
 * not the Bayes ratio the surrounding note describes. A zero `a`, or any
 * non-finite input or quotient, is `nz` → 0.
 */
export function publishedBayesProduct(a: number, b: number, c: number): number {
  if (![a, b, c].every((value) => Number.isFinite(value))) return 0
  if (a === 0) return 0
  const head = ((((a * b) * c) / a) * b) * c
  const tail = (1 - a) * (1 - b) * (1 - c)
  const value = head + tail
  return Number.isFinite(value) ? value : 0
}

export function nqqeColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return BAYES_COLORS.nqqeYellow
  if (value > 10) return BAYES_COLORS.nqqeGreen
  if (value < -10) return BAYES_COLORS.nqqeRed
  return BAYES_COLORS.nqqeYellow
}

/**
 * Body colour, later paints over earlier: green above the slow line, white on a
 * 5% drop, red below the slow line, blue below it when that drop did not happen.
 * The yellow entry marker is not a body colour.
 */
export function bankerBodyColor(fund: number, previous: number | null, slow: number): string {
  const dropped = previous !== null && Number.isFinite(previous) && fund < previous * 0.95
  let color: string = BAYES_COLORS.bankerGreen
  if (fund > slow) color = BAYES_COLORS.bankerGreen
  if (dropped) color = BAYES_COLORS.bankerWhite
  if (fund < slow) color = BAYES_COLORS.bankerRed
  if (fund < slow && !dropped) color = BAYES_COLORS.bankerBlue
  return color
}

/**
 * Yellow entry only when fund crosses above the slow line and both ends of that
 * cross are still under 25. A cross that has already left 25 is not an entry.
 */
export function isBankerEntry(
  fund: number | null,
  previousFund: number | null,
  slow: number | null,
  previousSlow: number | null,
): boolean {
  if (
    fund === null ||
    previousFund === null ||
    slow === null ||
    previousSlow === null ||
    ![fund, previousFund, slow, previousSlow].every((value) => Number.isFinite(value))
  )
    return false
  const crossed = previousFund <= previousSlow && fund > slow
  return crossed && fund < 25 && slow < 25
}

export function bayesianSideways(
  prime: number,
  up: number,
  down: number,
  threshold: number,
): boolean {
  return prime < threshold && up < threshold && down < threshold
}

const atZero = (value: number) => Math.abs(value) <= BAYES_AT_ZERO
const atHundred = (value: number) => Math.abs(value - 100) <= BAYES_AT_HUNDRED

/**
 * Strong signals only. Weak signals are not plotted.
 * Sideways is prime, up and down all under the threshold. The short that falls
 * from above the threshold to ~0 is still emitted: that bar is the transition
 * into the gray zone, and the bar it left was not sideways.
 */
export function strongBayesSignal(input: {
  prime: number | null
  previousPrime: number | null
  probUp: number | null
  previousProbUp: number | null
  probDown: number | null
  previousProbDown: number | null
  threshold: number
  useBw: boolean
  awayUp: boolean
  awayDown: boolean
}): 'long' | 'short' | null {
  const {
    prime,
    previousPrime,
    probUp,
    previousProbUp,
    probDown,
    previousProbDown,
    threshold,
    useBw,
    awayUp,
    awayDown,
  } = input
  if (prime === null || probUp === null || probDown === null) return null
  const sideways = bayesianSideways(prime, probUp, probDown, threshold)
  const leftZero = previousPrime !== null && atZero(previousPrime) && prime > threshold
  const leftHundredUp =
    previousProbUp !== null && atHundred(previousProbUp) && !atHundred(probUp) && probUp < 100
  const fellToZero = previousPrime !== null && previousPrime > threshold && atZero(prime)
  const leftHundredDown =
    previousProbDown !== null &&
    atHundred(previousProbDown) &&
    !atHundred(probDown) &&
    probDown < 100
  if (fellToZero && (!useBw || awayDown)) return 'short'
  if (!sideways && leftHundredDown && (!useBw || awayDown)) return 'short'
  if (!sideways && (leftZero || leftHundredUp) && (!useBw || awayUp)) return 'long'
  return null
}

/** SMA-seeded Wilder SMMA (`ta.rma` shape). A non-finite sample resets the seed. */
function smma(values: number[], length: number): (number | null)[] {
  const seed = ta.sma(values, length)
  const out: (number | null)[] = []
  let prev: number | null = null
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!Number.isFinite(value)) {
      prev = null
      out.push(null)
      continue
    }
    if (prev === null) {
      prev = seed[i]
      out.push(prev)
      continue
    }
    prev = (prev * (length - 1) + value) / length
    out.push(prev)
  }
  return out
}

/**
 * Wilder-like WWMA. Alpha is `1/length`. A null sample emits null and does not
 * move the previous value. The first finite sample is smoothed against 0.
 */
function wwma(values: (number | null)[], length: number): (number | null)[] {
  const alpha = 1 / length
  const out: (number | null)[] = []
  let prev = 0
  let started = false
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) {
      out.push(null)
      continue
    }
    prev = alpha * value + (1 - alpha) * (started ? prev : 0)
    started = true
    out.push(prev)
  }
  return out
}

/**
 * nQQE = EMA(RSI(source, length), smooth) − 50. The EMA is Atlas's SMA-seeded
 * `ta.ema`, not legacy Pine seeding. The slow trail is the QQE ratchet; `factor`
 * defaults to the hard-coded 4.236 and exists so a test can show that the trail
 * actually depends on it. Callers of the indicator never pass it.
 */
export function nqqeLines(
  src: number[],
  length: number,
  smooth: number,
  factor: number = NQQE_FACTOR,
): { fast: (number | null)[]; trail: (number | null)[]; atr: (number | null)[] } {
  const qqef = ta.ema(ta.rsi(src, length), smooth)
  const tr = qqef.map((value, i) => {
    const previous = i > 0 ? qqef[i - 1] : null
    if (value === null || previous === null) return null
    return Math.abs(value - previous)
  })
  const atr = wwma(wwma(tr, length), length)
  const longband: (number | null)[] = []
  const shortband: (number | null)[] = []
  const trend: number[] = []
  const trail: (number | null)[] = []
  for (let i = 0; i < src.length; i++) {
    const rs = qqef[i]
    const delta = atr[i] === null ? null : atr[i]! * factor
    const prevRs = i > 0 ? qqef[i - 1] : null
    const prevLong = i > 0 ? longband[i - 1] : null
    const prevShort = i > 0 ? shortband[i - 1] : null
    const long =
      rs === null || delta === null
        ? null
        : prevRs !== null && prevLong !== null && prevRs > prevLong && rs > prevLong
          ? Math.max(prevLong, rs - delta)
          : rs - delta
    const short =
      rs === null || delta === null
        ? null
        : prevRs !== null && prevShort !== null && prevRs < prevShort && rs < prevShort
          ? Math.min(prevShort, rs + delta)
          : rs + delta
    longband.push(long)
    shortband.push(short)
    const rs2 = i > 1 ? qqef[i - 2] : null
    const short2 = i > 1 ? shortband[i - 2] : null
    const long2 = i > 1 ? longband[i - 2] : null
    const shortCross =
      rs !== null &&
      prevRs !== null &&
      rs2 !== null &&
      prevShort !== null &&
      short2 !== null &&
      ((rs > prevShort && prevRs <= short2) || (rs < prevShort && prevRs >= short2))
    const longCross =
      rs !== null &&
      prevRs !== null &&
      rs2 !== null &&
      prevLong !== null &&
      long2 !== null &&
      ((prevLong > rs && long2 <= prevRs) || (prevLong < rs && long2 >= prevRs))
    const previousTrend = i > 0 ? trend[i - 1]! : 1
    const nextTrend = shortCross ? 1 : longCross ? -1 : previousTrend
    trend.push(nextTrend)
    trail.push(nextTrend === 1 ? long : short)
  }
  return {
    fast: qqef.map((value) => (value === null ? null : value - 50)),
    trail: trail.map((value) => (value === null ? null : value - 50)),
    atr,
  }
}

/**
 * Rolling weighted average used by the L3 banker mirror.
 * `sumf = nz(sumf[1]) - nz(src[len]) + src`. At index `len` the sum is
 * `src[1]..src[len]` (len terms). `ma` stays null until `src[i-len]` is finite.
 * The first valid output is `ma`; later outputs are `(src*wei + prev*(len-wei))/len`.
 * A null sample emits null, clears the smoother, and the next finite bar reseeds from `ma`.
 */
export function xsa(src: (number | null)[], len: number, wei: number): (number | null)[] {
  const out: (number | null)[] = []
  let sumf = 0
  let prev: number | null = null
  for (let i = 0; i < src.length; i++) {
    const value = src[i]
    if (value === null || !Number.isFinite(value)) {
      out.push(null)
      prev = null
      sumf = 0
      continue
    }
    const dropped = i >= len ? src[i - len] : null
    const drop = dropped === null || !Number.isFinite(dropped) ? 0 : dropped
    sumf = sumf - drop + value
    if (i < len || dropped === null || !Number.isFinite(dropped)) {
      out.push(null)
      continue
    }
    const ma = sumf / len
    if (prev === null) {
      out.push(ma)
      prev = ma
    } else {
      const smoothed: number = (value * wei + prev * (len - wei)) / len
      out.push(smoothed)
      prev = smoothed
    }
  }
  return out
}

function stochastic(values: number[], length: number): (number | null)[] {
  const highest = ta.highest(values, length)
  const lowest = ta.lowest(values, length)
  return values.map((value, i) => {
    if (highest[i] === null || lowest[i] === null) return null
    const span = highest[i]! - lowest[i]!
    if (span === 0) return 0
    return ((value - lowest[i]!) / span) * 100
  })
}

function priceSource(candles: Candle[], source: BayesianNqqeSource): number[] {
  return candles.map((candle) => {
    switch (source) {
      case 'open':
        return candle.open
      case 'high':
        return candle.high
      case 'low':
        return candle.low
      case 'hl2':
        return (candle.high + candle.low) / 2
      case 'hlc3':
        return (candle.high + candle.low + candle.close) / 3
      case 'ohlc4':
        return (candle.open + candle.high + candle.low + candle.close) / 4
      default:
        return candle.close
    }
  })
}

function flag(value: boolean | null): 0 | 1 | null {
  return value === null ? null : value ? 1 : 0
}

function bayesScore(
  a: (number | null)[],
  b: (number | null)[],
  c: (number | null)[],
): (number | null)[] {
  return a.map((av, i) => {
    const bv = b[i]
    const cv = c[i]
    if (av === null || bv === null || cv === null) return null
    return publishedBayesProduct(av, bv, cv) * 100
  })
}

function beyond(
  open: number,
  close: number,
  lips: number | null,
  teeth: number | null,
  jaw: number | null,
  direction: 'up' | 'down',
): boolean {
  if (lips === null || teeth === null || jaw === null) return false
  if (direction === 'up')
    return (
      open > lips && close > lips && open > teeth && close > teeth && open > jaw && close > jaw
    )
  return open < lips && close < lips && open < teeth && close < teeth && open < jaw && close < jaw
}

export interface BayesianNqqeValues {
  probDown: (number | null)[]
  probUp: (number | null)[]
  prime: (number | null)[]
  momentum: (number | null)[]
  nqqe: (number | null)[]
  nqqeTrail: (number | null)[]
  nqqeAtr: (number | null)[]
  fundtrend: (number | null)[]
  bullbear: (number | null)[]
  longSignal: (number | null)[]
  shortSignal: (number | null)[]
  entry: (number | null)[]
  ao: (number | null)[]
  ac: (number | null)[]
  lips: (number | null)[]
  teeth: (number | null)[]
  jaw: (number | null)[]
  nqqeColors: string[]
  bankerColors: string[]
}

export function calculateBayesianNqqeBankfunds(
  candles: Candle[],
  settings: BayesianNqqeSettings,
): BayesianNqqeValues {
  if (!isBayesianNqqeBankfundsSettings(settings))
    throw new Error('Bayesian/nQQE/BankFunds settings')
  const close = candles.map((candle) => candle.close)
  const hl2 = candles.map((candle) => (candle.high + candle.low) / 2)
  const basis = ta.sma(close, settings.bbSmaPeriod)
  const deviation = ta.stdev(close, settings.bbSmaPeriod)
  const upper = basis.map((value, i) =>
    value === null || deviation[i] === null ? null : value + settings.bbStdDev * deviation[i]!,
  )
  const sma = ta.sma(close, settings.smaPeriod)
  // AO is the SMA difference, even where a title says EMA. AC is that same
  // difference on its own lengths, minus an SMA of itself.
  const aoFast = ta.sma(hl2, settings.aoFast)
  const aoSlow = ta.sma(hl2, settings.aoSlow)
  const ao = aoFast.map((value, i) =>
    value === null || aoSlow[i] === null ? null : value - aoSlow[i]!,
  )
  const acFast = ta.sma(hl2, settings.acFast)
  const acSlow = ta.sma(hl2, settings.acSlow)
  const acRaw = acFast.map((value, i) =>
    value === null || acSlow[i] === null ? null : value - acSlow[i]!,
  )
  const acMa = ta.sma(acRaw, settings.acAoMa)
  const ac = acRaw.map((value, i) =>
    value === null || acMa[i] === null ? null : value - acMa[i]!,
  )
  // Offsets are stored for the legend and are not applied. Confirmation uses
  // these unshifted lines.
  const lips = smma(hl2, settings.lipsLength)
  const teeth = smma(hl2, settings.teethLength)
  const jaw = smma(hl2, settings.jawLength)

  const compared = (ok: boolean | null) => flag(ok)
  const upBasis = close.map((value, i) => compared(basis[i] === null ? null : value > basis[i]!))
  const upUpper = close.map((value, i) => compared(upper[i] === null ? null : value <= upper[i]!))
  const upSma = close.map((value, i) => compared(sma[i] === null ? null : value < sma[i]!))
  const downBasis = close.map((value, i) => compared(basis[i] === null ? null : value < basis[i]!))
  const downUpper = close.map((value, i) => compared(upper[i] === null ? null : value > upper[i]!))
  const downSma = close.map((value, i) => compared(sma[i] === null ? null : value > sma[i]!))
  const momAo = ao.map((value) => compared(value === null ? null : value > 0))
  const momAc = ac.map((value) => compared(value === null ? null : value > 0))
  const momGator = close.map((value, i) =>
    compared(
      lips[i] === null || teeth[i] === null || jaw[i] === null
        ? null
        : value > lips[i]! && value > teeth[i]! && value > jaw[i]!,
    ),
  )
  const period = settings.bayesPeriod
  const probUp = bayesScore(ta.sma(upBasis, period), ta.sma(upUpper, period), ta.sma(upSma, period))
  const probDown = bayesScore(
    ta.sma(downBasis, period),
    ta.sma(downUpper, period),
    ta.sma(downSma, period),
  )
  const momentum = bayesScore(ta.sma(momAo, period), ta.sma(momAc, period), ta.sma(momGator, period))
  // Prime runs the same expression on the 0–1 scores. Complementing the down
  // score only makes sense on that scale; the plotted series stay × 100.
  const prime = bayesScore(
    probUp.map((value) => (value === null ? null : value / 100)),
    probDown.map((value) => (value === null ? null : 1 - value / 100)),
    momentum.map((value) => (value === null ? null : value / 100)),
  )

  const nqqe = nqqeLines(
    priceSource(candles, settings.nqqeSource),
    settings.nqqeRsiLength,
    settings.nqqeSmooth,
  )
  const closeStoch = stochastic(close, 27)
  const fundtrend = xsa(xsa(closeStoch, 5, 1), 3, 1).map((value) =>
    value === null ? null : value * 1.032 + 50,
  )
  const typical = candles.map(
    (candle) => (2 * candle.close + candle.high + candle.low + candle.open) / 5,
  )
  const bullbear = ta.ema(stochastic(typical, 34), 13)

  const longSignal: (number | null)[] = []
  const shortSignal: (number | null)[] = []
  const entry: (number | null)[] = []
  const bankerColors: string[] = []
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!
    const signal = strongBayesSignal({
      prime: prime[i] ?? null,
      previousPrime: i > 0 ? (prime[i - 1] ?? null) : null,
      probUp: probUp[i] ?? null,
      previousProbUp: i > 0 ? (probUp[i - 1] ?? null) : null,
      probDown: probDown[i] ?? null,
      previousProbDown: i > 0 ? (probDown[i - 1] ?? null) : null,
      threshold: settings.lowerThreshold,
      useBw: settings.useBwConfirmation,
      awayUp: beyond(candle.open, candle.close, lips[i] ?? null, teeth[i] ?? null, jaw[i] ?? null, 'up'),
      awayDown: beyond(
        candle.open,
        candle.close,
        lips[i] ?? null,
        teeth[i] ?? null,
        jaw[i] ?? null,
        'down',
      ),
    })
    longSignal.push(signal === 'long' ? (prime[i] ?? null) : null)
    shortSignal.push(signal === 'short' ? (prime[i] ?? null) : null)
    const fund = fundtrend[i] ?? null
    const slow = bullbear[i] ?? null
    const previousFund = i > 0 ? (fundtrend[i - 1] ?? null) : null
    const previousSlow = i > 0 ? (bullbear[i - 1] ?? null) : null
    entry.push(isBankerEntry(fund, previousFund, slow, previousSlow) ? fund : null)
    bankerColors.push(
      fund === null || slow === null
        ? BAYES_COLORS.bankerGreen
        : bankerBodyColor(fund, previousFund, slow),
    )
  }

  return {
    probDown,
    probUp,
    prime,
    momentum,
    nqqe: nqqe.fast,
    nqqeTrail: nqqe.trail,
    nqqeAtr: nqqe.atr,
    fundtrend,
    bullbear,
    longSignal,
    shortSignal,
    entry,
    ao,
    ac,
    lips,
    teeth,
    jaw,
    nqqeColors: nqqe.fast.map((value) => nqqeColor(value)),
    bankerColors,
  }
}

function nulls(length: number): null[] {
  return Array.from({ length }, () => null)
}

/** Plots the pane draws. Length always equals the candle count; values are finite or null. */
export function bayesianNqqePlots(values: BayesianNqqeValues, settings: BayesianNqqeSettings): Plot[] {
  const length = values.prime.length
  const plots: Plot[] = []
  if (settings.showProbabilities) {
    plots.push({
      title: 'Break Down',
      color: BAYES_COLORS.down,
      values: values.probDown,
      pane: 'oscillator',
      lineWidth: 1,
      style: 'area',
      transp: 75,
    })
    plots.push({
      title: 'Break Up',
      color: BAYES_COLORS.up,
      values: values.probUp,
      pane: 'oscillator',
      lineWidth: 1,
      style: 'area',
      transp: 75,
    })
  }
  // A line, not an area: the published prime is an area, but an area paints over
  // the two probability fills. The values are still the published score.
  plots.push({
    title: 'Prime',
    color: BAYES_COLORS.prime,
    values: values.prime,
    pane: 'oscillator',
    lineWidth: 2,
  })
  if (settings.showNqqe) {
    plots.push({
      title: 'nQQE',
      color: BAYES_COLORS.nqqeYellow,
      values: values.nqqe,
      pane: 'oscillator',
      lineWidth: 2,
      colors: values.nqqeColors,
      colorMode: 'bar',
    })
    plots.push({
      title: 'nQQE trail',
      color: BAYES_COLORS.gray,
      values: values.nqqeTrail,
      pane: 'oscillator',
      lineWidth: 1,
      hideLegend: true,
    })
  }
  if (settings.showBankFunds) {
    plots.push({
      title: 'Banker Fund',
      color: BAYES_COLORS.bankerGreen,
      values: values.fundtrend,
      pane: 'oscillator',
      lineWidth: 1,
      style: 'columns',
      colors: values.bankerColors,
      base: values.bullbear,
      hideLegend: true,
    })
    plots.push({
      title: 'Bull/Bear',
      color: BAYES_COLORS.gray,
      values: values.bullbear,
      pane: 'oscillator',
      lineWidth: 1,
      hideLegend: true,
    })
    plots.push({
      title: 'Banker entry',
      color: BAYES_COLORS.bankerYellow,
      values: values.entry,
      pane: 'oscillator',
      lineWidth: 4,
      style: 'circles',
      hideLegend: true,
    })
  }
  if (settings.showSignals) {
    plots.push({
      title: 'Long',
      color: BAYES_COLORS.up,
      values: values.longSignal,
      pane: 'oscillator',
      lineWidth: 3,
      style: 'circles',
      hideLegend: true,
    })
    plots.push({
      title: 'Short',
      color: BAYES_COLORS.down,
      values: values.shortSignal,
      pane: 'oscillator',
      lineWidth: 3,
      style: 'circles',
      hideLegend: true,
    })
  }
  plots.push(
    {
      title: 'Threshold',
      color: BAYES_COLORS.gray,
      values: nulls(length),
      pane: 'oscillator',
      lineWidth: 1,
      horizontalLine: settings.lowerThreshold,
      hideLegend: true,
    },
    {
      title: 'Zero',
      color: BAYES_COLORS.gray,
      values: nulls(length),
      pane: 'oscillator',
      lineWidth: 1,
      horizontalLine: 0,
      hideLegend: true,
    },
  )
  return plots
}
