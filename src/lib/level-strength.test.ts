import { describe, expect, it } from 'vitest'
import {
  gradeLevelTest,
  levelStrength,
  pivotLevels,
  LEVEL_HOLD_RATES,
  LEVEL_TEST_HORIZON_BARS,
} from './level-strength'
import type { Candle, Timeframe } from './types'

const bar = (time: number, low: number, high: number, close = (low + high) / 2): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 1,
})

describe('gradeLevelTest', () => {
  // A support at 100 with ATR 10: held means a later high of 110 before a low of 90.
  it('holds when price trades 1 ATR back away before 1 ATR through', () => {
    const tape = [bar(0, 99, 104), bar(1, 97, 106), bar(2, 101, 110)]
    expect(gradeLevelTest(tape, 0, 100, 'support', 10)).toBe('held')
  })

  it('breaks when price trades 1 ATR through first', () => {
    const tape = [bar(0, 99, 104), bar(1, 90, 103), bar(2, 101, 115)]
    expect(gradeLevelTest(tape, 0, 100, 'support', 10)).toBe('broke')
  })

  it('never credits the touch bar with a hold — its high came first', () => {
    expect(gradeLevelTest([bar(0, 99, 112)], 0, 100, 'support', 10)).toBeNull()
    expect(gradeLevelTest([bar(0, 89, 112)], 0, 100, 'support', 10)).toBe('broke')
  })

  it('calls a bar that reaches both sides a break', () => {
    const tape = [bar(0, 99, 104), bar(1, 89, 111)]
    expect(gradeLevelTest(tape, 0, 100, 'support', 10)).toBe('broke')
  })

  it('mirrors for resistance', () => {
    expect(gradeLevelTest([bar(0, 96, 101), bar(1, 90, 99)], 0, 100, 'resistance', 10)).toBe('held')
    expect(gradeLevelTest([bar(0, 96, 101), bar(1, 95, 110)], 0, 100, 'resistance', 10)).toBe(
      'broke',
    )
  })

  it('leaves a test undecided past the horizon', () => {
    const tape = Array.from({ length: LEVEL_TEST_HORIZON_BARS + 5 }, (_, i) =>
      i === LEVEL_TEST_HORIZON_BARS + 2 ? bar(i, 101, 120) : bar(i, 98, 105),
    )
    expect(gradeLevelTest(tape, 0, 100, 'support', 10)).toBeNull()
  })
})

describe('levelStrength', () => {
  it('reads 0 on every timeframe the tape has measured so far', () => {
    for (const timeframe of Object.keys(LEVEL_HOLD_RATES) as Timeframe[]) {
      expect(levelStrength(timeframe, 'pivot')).toBe(0)
      expect(levelStrength(timeframe, 'sr-zone')).toBe(0)
    }
  })

  it('counts only the edge that clears its own margin, scaled so 10 points is full strength', () => {
    const saved = structuredClone(LEVEL_HOLD_RATES['5m'])
    try {
      LEVEL_HOLD_RATES['5m'].random = { rate: 0.46, n: 100000 }
      LEVEL_HOLD_RATES['5m'].pivot = { rate: 0.52, n: 100000 }
      const strength = levelStrength('5m', 'pivot')
      expect(strength).toBeGreaterThan(0.5)
      expect(strength).toBeLessThan(0.6)
      // The same six points on 200 tests is inside the noise.
      LEVEL_HOLD_RATES['5m'].pivot = { rate: 0.52, n: 200 }
      expect(levelStrength('5m', 'pivot')).toBe(0)
    } finally {
      LEVEL_HOLD_RATES['5m'] = saved
    }
  })
})

describe('pivotLevels', () => {
  it('carries the measured hold rates on every level it pins', () => {
    const tape = Array.from({ length: 40 }, (_, i) => {
      const mid = 100 + 5 * Math.sin(i / 3)
      return bar(i, mid - 1, mid + 1, mid)
    })
    const price = tape[tape.length - 1].close
    const { nearestSupport, nearestResistance } = pivotLevels(tape, 1, price, '15m')
    for (const level of [nearestSupport, nearestResistance]) {
      expect(level).not.toBeNull()
      expect(level!.holdRate).toBe(LEVEL_HOLD_RATES['15m'].pivot.rate)
      expect(level!.randomHoldRate).toBe(LEVEL_HOLD_RATES['15m'].random.rate)
      expect(level!.strength).toBe(0)
    }
    expect(nearestSupport!.price).toBeLessThan(price)
    expect(nearestResistance!.price).toBeGreaterThan(price)
  })
})
