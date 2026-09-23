/**
 * Bayesian/nQQE/BankFunds — pane and floating window share this file.
 *
 * A faithful port of the published Pine v5 script "Bayesian BBSMA + nQQE
 * Oscillator + Bank funds (whales detector)" (tartigradia's combo, short title
 * `Bayesian/nQQE/BankFunds`). The source is now in hand and every formula below
 * follows it, quirks included: the left-associative `a*b*c/a*b*c` "Bayes"
 * expression, the up/down naming swap between the two probability plots, the
 * two-factor prime expression, the classic QQE ratchet, and `acIsRed and
 * acIsRed` inside the Bill Williams gate. Remaining deviations are presentational
 * only (columns instead of plotcandle bodies, circles instead of `barcolor`,
 * a hidden slow line that is still computed) and are called out next to the
 * code and in `docs/bayesian-nqqe-bankfunds.md`.
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

/**
 * TradingView's v5 palette: the plots use `color.red/green/blue`, the nQQE area
 * `color.lime/red/yellow`, the banker candles the same plus white, and the
 * barcolor stand-in `color.lime` and `color.maroon`.
 */
export const BAYES_COLORS = {
  down: '#ff5252',
  up: '#4caf50',
  prime: '#2962ff',
  nqqeGreen: '#00e676',
  nqqeRed: '#ff5252',
  nqqeYellow: '#ffeb3b',
  bankerYellow: '#ffeb3b',
  bankerGreen: '#4caf50',
  bankerWhite: '#ffffff',
  bankerRed: '#ff5252',
  bankerBlue: '#2962ff',
  long: '#00e676',
  short: '#880e4f',
  gray: '#787b86',
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

/** Missing or malformed settings fall back to the published defaults. Callers always pass this. */
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
 * The expression the published script states, evaluated the way Pine evaluates it:
 * `nz(a*b*c/a*b*c+(1-a)*(1-b)*(1-c))` is left-associative, so it is
 * `((((a*b)*c)/a)*b)*c + (1-a)*(1-b)*(1-c)`.
 * When `a` is not zero that reduces to `(b*c)^2 + (1-a)*(1-b)*(1-c)`, which is
 * not the Bayes ratio the note above the line describes. A zero `a`, or any
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

/**
 * Prime is the same expression with two factors:
 * `nz(sd*su/sd*su + (1-sd)*(1-su))` → `su² + (1-sd)(1-su)` when `sd` is not
 * zero, and `nz` → 0 when it is, or when anything is non-finite.
 */
export function publishedBayesPrime(a: number, b: number): number {
  if (![a, b].every((value) => Number.isFinite(value))) return 0
  if (a === 0) return 0
  const value = ((a * b) / a) * b + (1 - a) * (1 - b)
  return Number.isFinite(value) ? value : 0
}

/** The published regime colours: lime above 60, red below 40, yellow between. */
export function nqqeColor(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return BAYES_COLORS.nqqeYellow
  if (value > 60) return BAYES_COLORS.nqqeGreen
  if (value < 40) return BAYES_COLORS.nqqeRed
  return BAYES_COLORS.nqqeYellow
}

/**
 * Body colour, later paints over earlier — exactly the published plotcandle
 * stack: green above the slow line, white on a 5% drop, red below the slow
 * line, blue below it when that drop did not happen. `dropLine` is
 * `xrf(fundtrend * 0.95, 1)` — the pre-multiplied reference — and the yellow
 * entry marker is not a body colour.
 */
export function bankerBodyColor(fund: number, dropLine: number | null, slow: number): string {
  const dropped = dropLine !== null && Number.isFinite(dropLine) && fund < dropLine
  let color: string = BAYES_COLORS.bankerGreen
  if (fund > slow) color = BAYES_COLORS.bankerGreen
  if (dropped) color = BAYES_COLORS.bankerWhite
  if (fund < slow) color = BAYES_COLORS.bankerRed
  if (fund < slow && !dropped) color = BAYES_COLORS.bankerBlue
  return color
}

/**
 * Yellow entry exactly as published: fund crosses above the slow line and the
 * slow line alone is still under 25. Nothing constrains the fund side.
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
  return crossed && slow < 25
}

export function bayesianSideways(
  prime: number,
  up: number,
  down: number,
  threshold: number,
): boolean {
  return prime < threshold && up < threshold && down < threshold
}

/**
 * The published signal conditions, with Pine's exact float comparisons —
 * `probPrime[1] == 0` and `sigmaProbsUp[1] == 1` are exact equality on values
 * the `nz`/count arithmetic produces as exact 0 and 1. There is no sideways
 * filter: the script computes `sideways` only for a fill it comments out.
 * Bill Williams, when enabled, longs need the AC/AO pair green (AC rising and
 * AO rising) plus open and close beyond the jaw, and shorts need AC not rising
 * (`acIsRed and acIsRed` is a bug in the source, preserved) plus open and
 * close under the jaw.
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
  bull: boolean
  bear: boolean
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
    bull,
    bear,
    awayUp,
    awayDown,
  } = input
  if (prime === null || probUp === null || probDown === null) return null
  // Pine: an `and`/comparison against a na history value is false, so a null
  // previous never fires a transition.
  const longUsingProbPrime = prime > threshold && previousPrime === 0
  const longUsingSigmaProbsUp = probUp < 100 && previousProbUp === 100
  const shortUsingProbPrime = prime === 0 && previousPrime !== null && previousPrime > threshold
  const shortUsingSigmaProbsDown = probDown < 100 && previousProbDown === 100
  const confirmationUp = !useBw || (bull && awayUp)
  const confirmationDown = !useBw || (bear && awayDown)
  if (confirmationDown && (shortUsingProbPrime || shortUsingSigmaProbsDown)) return 'short'
  if (confirmationUp && (longUsingProbPrime || longUsingSigmaProbsUp)) return 'long'
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
 * Pine's published WWMA: `alpha*src + (1-alpha)*nz(prev)` with alpha
 * `1/length`. A null sample emits null and — because `nz` reads the na output
 * as 0 — the next finite sample smooths against 0 again.
 */
function wilderWeighted(values: (number | null)[], length: number): (number | null)[] {
  const alpha = 1 / length
  const out: (number | null)[] = []
  let previous: number | null = null
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) {
      out.push(null)
      previous = null
      continue
    }
    const next: number = alpha * value + (1 - alpha) * (previous ?? 0)
    previous = next
    out.push(next)
  }
  return out
}

/**
 * nQQE fast is `ema(rsi(source, length), smooth)` on the 0–100 RSI scale — the
 * published combo plots it directly with a histogram base of 50, no −50 shift.
 * The slow trail is the classic QQE ratchet over bands `fast ± ATRRSI × 4.236`,
 * where ATRRSI is the WWMA of the WWMA of the absolute fast change. The trail
 * is `display.none` on TradingView; it stays in the values for completeness.
 */
export function nqqeLines(
  src: number[],
  length: number,
  smooth: number,
  factor: number = NQQE_FACTOR,
): { fast: (number | null)[]; trail: (number | null)[]; atr: (number | null)[] } {
  const fast = ta.ema(ta.rsi(src, length), smooth)
  const changes = fast.map((value, i) => {
    const previous = i > 0 ? fast[i - 1] : null
    if (value === null || previous === null) return null
    return Math.abs(value - previous)
  })
  const atr = wilderWeighted(wilderWeighted(changes, length), length)
  const trail: (number | null)[] = []
  let previousStop: number | null = null
  for (let i = 0; i < src.length; i++) {
    const value = fast[i]
    const valueBefore = i > 0 ? fast[i - 1] : null
    const band = atr[i] === null || value === null ? null : atr[i]! * factor
    const up = value === null || band === null ? null : value + band
    const down = value === null || band === null ? null : value - band
    const stop: number = previousStop ?? 0 // nz(QQES[1])
    let next: number = stop
    if (up !== null && up < stop) next = up
    else if (value !== null && value > stop && valueBefore !== null && valueBefore < stop)
      next = down ?? stop
    else if (down !== null && down > stop) next = down
    else if (value !== null && value < stop && valueBefore !== null && valueBefore > stop)
      next = up ?? stop
    trail.push(next)
    previousStop = next
  }
  return { fast, trail, atr }
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

/**
 * The banker's lookback helper: the deepest non-finite-skipping sample at or
 * before `length` bars back. Scanning `k = 0..length`, every finite sample
 * overwrites, so the last finite one wins; an all-na window is na.
 */
export function xrf(values: (number | null)[], length: number): (number | null)[] {
  return values.map((_, i) => {
    let r: number | null = null
    for (let k = 0; k <= length && i - k >= 0; k++) {
      const value = values[i - k]
      if (r === null || (value !== null && Number.isFinite(value))) r = value
    }
    return r
  })
}

/**
 * Published stochastic: `(src - lowest) / (highest - lowest) * 100`, na while
 * the window is incomplete and — Pine division — na on a zero span, not 0.
 */
function stochastic(values: number[], length: number): (number | null)[] {
  const highest = ta.highest(values, length)
  const lowest = ta.lowest(values, length)
  return values.map((value, i) => {
    if (highest[i] === null || lowest[i] === null) return null
    const span = highest[i]! - lowest[i]!
    if (span === 0) return null
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

function nulls(length: number): null[] {
  return Array.from({ length }, () => null)
}

export interface BayesianNqqeValues {
  probDown: (number | null)[]
  probUp: (number | null)[]
  prime: (number | null)[]
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
  // The published AC smooths the difference with the fast length again. The
  // 13-period MA input feeds only a vwma line the script never reads.
  const acMa = ta.sma(acRaw, settings.acFast)
  const ac = acRaw.map((value, i) =>
    value === null || acMa[i] === null ? null : value - acMa[i]!,
  )
  // Offsets are stored for the legend and are not applied. Confirmation reads
  // the unshifted jaw only.
  const lips = smma(hl2, settings.lipsLength)
  const teeth = smma(hl2, settings.teethLength)
  const jaw = smma(hl2, settings.jawLength)

  // Bayesian BBSMA — the published events are strict `close > line` and
  // `close < line`; a close exactly on the line counts for neither. Each
  // direction is normalised over its own pair: P(up) = up/(up+down), na when
  // the window holds no strict comparison at all.
  const period = settings.bayesPeriod
  const count = (line: (number | null)[], direction: 'above' | 'below'): (number | null)[] =>
    close.map((value, i) => {
      const reference = line[i]
      if (reference === null) return null
      if (direction === 'above') return value > reference ? 1 : 0
      return value < reference ? 1 : 0
    })
  const probability = (up: (number | null)[], down: (number | null)[]): (number | null)[] => {
    const sumUp = ta.sma(up, period)
    const sumDown = ta.sma(down, period)
    return sumUp.map((value, i) => {
      const other = sumDown[i]
      if (value === null || other === null) return null
      const total = value + other
      return total === 0 ? null : value / total
    })
  }
  const upUpper = count(upper, 'above')
  const downUpper = count(upper, 'below')
  const upBasis = count(basis, 'above')
  const downBasis = count(basis, 'below')
  const upSma = count(sma, 'above')
  const downSma = count(sma, 'below')
  const pUpUpper = probability(upUpper, downUpper)
  const pUpBasis = probability(upBasis, downBasis)
  const pUpSma = probability(upSma, downSma)
  const pDownUpper = probability(downUpper, upUpper)
  const pDownBasis = probability(downBasis, upBasis)
  const pDownSma = probability(downSma, upSma)
  // The published swap: the red "breaking down" score runs the expression on
  // the UP probabilities, and the green "breaking up" score on the DOWN ones.
  const sigmaProbsDown = pUpUpper.map((value, i) =>
    value === null || pUpBasis[i] === null || pUpSma[i] === null
      ? 0
      : publishedBayesProduct(value, pUpBasis[i]!, pUpSma[i]!),
  )
  const sigmaProbsUp = pDownUpper.map((value, i) =>
    value === null || pDownBasis[i] === null || pDownSma[i] === null
      ? 0
      : publishedBayesProduct(value, pDownBasis[i]!, pDownSma[i]!),
  )
  const probPrime = sigmaProbsDown.map((value, i) => publishedBayesPrime(value, sigmaProbsUp[i]!))

  // Plotted scale: the script multiplies each score by 100.
  const probDown = sigmaProbsDown.map((value) => value * 100)
  const probUp = sigmaProbsUp.map((value) => value * 100)
  const prime = probPrime.map((value) => value * 100)

  const nqqe = nqqeLines(
    priceSource(candles, settings.nqqeSource),
    settings.nqqeRsiLength,
    settings.nqqeSmooth,
  )
  // L3 banker: a two-term balance of the 27-bar close stochastic, then the
  // typical-price stochastic smoothed by EMA 13.
  const closeStoch = stochastic(close, 27)
  const stochFast = xsa(closeStoch, 5, 1)
  const stochSlow = xsa(stochFast, 3, 1)
  const fundtrend = stochFast.map((value, i) =>
    value === null || stochSlow[i] === null
      ? null
      : (3 * value - 2 * stochSlow[i]! - 50) * 1.032 + 50,
  )
  const typical = candles.map(
    (candle) => (2 * candle.close + candle.high + candle.low + candle.open) / 5,
  )
  const bullbear = ta.ema(stochastic(typical, 34), 13)
  const dropLine = xrf(
    fundtrend.map((value) => (value === null ? null : value * 0.95)),
    1,
  )

  const longSignal: (number | null)[] = []
  const shortSignal: (number | null)[] = []
  const entry: (number | null)[] = []
  const bankerColors: string[] = []
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!
    const rising = (line: (number | null)[]) =>
      i > 0 && line[i] !== null && line[i - 1] !== null && line[i]! > line[i - 1]!
    const acRising = rising(ac)
    const aoRising = rising(ao)
    // Confirmation reads the jaw only: prices moving away up/down from the
    // alligator. The AC/AO pair supplies the green/red side.
    const awayUp = jaw[i] !== null && candle.open > jaw[i]! && candle.close > jaw[i]!
    const awayDown = jaw[i] !== null && candle.open < jaw[i]! && candle.close < jaw[i]!
    const signal = strongBayesSignal({
      prime: prime[i],
      previousPrime: i > 0 ? prime[i - 1] : null,
      probUp: probUp[i],
      previousProbUp: i > 0 ? probUp[i - 1] : null,
      probDown: probDown[i],
      previousProbDown: i > 0 ? probDown[i - 1] : null,
      threshold: settings.lowerThreshold,
      useBw: settings.useBwConfirmation,
      bull: acRising && aoRising,
      bear: !acRising,
      awayUp,
      awayDown,
    })
    longSignal.push(signal === 'long' ? prime[i] : null)
    shortSignal.push(signal === 'short' ? prime[i] : null)
    const fund = fundtrend[i]
    const slow = bullbear[i]
    const previousFund = i > 0 ? fundtrend[i - 1] : null
    const previousSlow = i > 0 ? bullbear[i - 1] : null
    entry.push(isBankerEntry(fund, previousFund, slow, previousSlow) ? fund : null)
    bankerColors.push(
      fund === null || slow === null
        ? BAYES_COLORS.bankerGreen
        : bankerBodyColor(fund, dropLine[i], slow),
    )
  }

  return {
    probDown,
    probUp,
    prime,
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

/**
 * The plots the pane draws, in the published paint order: red, green and blue
 * transparent areas from zero, then the regime-coloured nQQE area from 50,
 * then the banker bodies. Length always equals the candle count; values are
 * finite or null. The circles at the end stand in for the script's
 * `barcolor` long/short candles, which a pane cannot paint.
 */
export function bayesianNqqePlots(values: BayesianNqqeValues, settings: BayesianNqqeSettings): Plot[] {
  const length = values.prime.length
  const plots: Plot[] = []
  if (settings.showProbabilities) {
    plots.push(
      {
        title: 'Break Down',
        color: BAYES_COLORS.down,
        values: values.probDown,
        pane: 'oscillator',
        lineWidth: 2,
        style: 'area',
        transp: 60,
      },
      {
        title: 'Break Up',
        color: BAYES_COLORS.up,
        values: values.probUp,
        pane: 'oscillator',
        lineWidth: 2,
        style: 'area',
        transp: 60,
      },
    )
  }
  plots.push({
    title: 'Prime',
    color: BAYES_COLORS.prime,
    values: values.prime,
    pane: 'oscillator',
    lineWidth: 2,
    style: 'area',
    transp: 60,
  })
  if (settings.showNqqe) {
    plots.push({
      title: 'nQQE',
      color: BAYES_COLORS.nqqeYellow,
      values: values.nqqe,
      pane: 'oscillator',
      lineWidth: 2,
      style: 'area',
      transp: 30,
      colors: values.nqqeColors,
      colorMode: 'bar',
      // The published area plot sets histbase=50; the fill hangs from 50.
      histbase: 50,
    })
  }
  // hline(40)/hline(60): dashed gray levels, drawn whether or not nQQE shows.
  plots.push(
    {
      title: '40',
      color: BAYES_COLORS.gray,
      values: nulls(length),
      pane: 'oscillator',
      lineWidth: 1,
      horizontalLine: 40,
      dashed: true,
      hideLegend: true,
    },
    {
      title: '60',
      color: BAYES_COLORS.gray,
      values: nulls(length),
      pane: 'oscillator',
      lineWidth: 1,
      horizontalLine: 60,
      dashed: true,
      hideLegend: true,
    },
  )
  if (settings.showBankFunds) {
    plots.push(
      {
        // plotcandle(fundtrend, bullbearline, ...) — the body between the two
        // prices, so a column from the slow line to the fund line.
        title: 'Banker Fund',
        color: BAYES_COLORS.bankerGreen,
        values: values.fundtrend,
        pane: 'oscillator',
        lineWidth: 1,
        style: 'columns',
        colors: values.bankerColors,
        base: values.bullbear,
        hideLegend: true,
      },
      {
        // plotcandle(0, 50, 0, 50) — a yellow block across the bottom half of
        // the pane on entry bars.
        title: 'Banker entry',
        color: BAYES_COLORS.bankerYellow,
        values: values.entry.map((value) => (value === null ? null : 50)),
        base: values.entry.map(() => 0),
        pane: 'oscillator',
        lineWidth: 1,
        style: 'columns',
        hideLegend: true,
      },
    )
  }
  if (settings.showSignals) {
    plots.push(
      {
        title: 'Long',
        color: BAYES_COLORS.long,
        values: values.longSignal,
        pane: 'oscillator',
        lineWidth: 3,
        style: 'circles',
        hideLegend: true,
      },
      {
        title: 'Short',
        color: BAYES_COLORS.short,
        values: values.shortSignal,
        pane: 'oscillator',
        lineWidth: 3,
        style: 'circles',
        hideLegend: true,
      },
    )
  }
  return plots
}
