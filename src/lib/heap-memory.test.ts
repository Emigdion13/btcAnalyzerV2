import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatHeapShare,
  formatSignedBytes,
  heapDelta,
  heapPressure,
  heapShare,
  heapSparkline,
  readHeapMemory,
  recordHeapSample,
} from './heap-memory'

const sample = (used: number, total = used + 8_000_000, limit = 2_147_483_648, at = 1) => ({
  at,
  used,
  total,
  limit,
})

describe('readHeapMemory', () => {
  it('reads Chromium’s JS heap fields and rejects missing or broken values', () => {
    expect(readHeapMemory(undefined)).toBeNull()
    expect(readHeapMemory({})).toBeNull()
    expect(
      readHeapMemory({ memory: { usedJSHeapSize: 12, totalJSHeapSize: 20, jsHeapSizeLimit: 0 } }),
    ).toBeNull()
    expect(
      readHeapMemory({
        memory: { usedJSHeapSize: Number.NaN, totalJSHeapSize: 20, jsHeapSizeLimit: 100 },
      }),
    ).toBeNull()
    expect(
      readHeapMemory(
        {
          memory: {
            usedJSHeapSize: 42_000_000,
            totalJSHeapSize: 50_000_000,
            jsHeapSizeLimit: 100_000_000,
          },
        },
        99,
      ),
    ).toEqual({ at: 99, used: 42_000_000, total: 50_000_000, limit: 100_000_000 })
  })
})

describe('heapShare and heapPressure', () => {
  it('maps used/limit into a 0–100 share and a pressure band', () => {
    expect(heapShare(sample(25_000_000, 30_000_000, 100_000_000))).toBe(25)
    expect(heapPressure(sample(25_000_000, 30_000_000, 100_000_000))).toBe('ok')
    expect(heapPressure(sample(50_000_000, 60_000_000, 100_000_000))).toBe('watch')
    expect(heapPressure(sample(80_000_000, 85_000_000, 100_000_000))).toBe('high')
    expect(heapPressure(sample(95_000_000, 96_000_000, 100_000_000))).toBe('critical')
    expect(formatHeapShare(sample(9_000_000, 10_000_000, 100_000_000))).toBe('9.0%')
    expect(formatHeapShare(sample(42_000_000, 50_000_000, 100_000_000))).toBe('42%')
  })
})

describe('formatBytes', () => {
  it('picks a compact unit without pretending to be exact to the byte', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(48_000)).toBe('47 KB')
    expect(formatBytes(4_200_000)).toBe('4.0 MB')
    expect(formatBytes(42_300_000)).toBe('40.3 MB')
    expect(formatBytes(400 * 1024 * 1024)).toBe('400 MB')
    expect(formatBytes(2_200_000_000)).toBe('2.05 GB')
    expect(formatSignedBytes(0)).toBe('0 B')
    expect(formatSignedBytes(1_500_000)).toBe('+1.4 MB')
    expect(formatSignedBytes(-1_500_000)).toBe('−1.4 MB')
  })
})

describe('recordHeapSample', () => {
  it('keeps a bounded history and skips identical ticks', () => {
    const first = sample(10, 20, 100, 1)
    const same = sample(10, 20, 100, 2)
    const next = sample(11, 20, 100, 3)
    expect(recordHeapSample([], first)).toEqual([first])
    expect(recordHeapSample([first], same)).toEqual([first])
    expect(recordHeapSample([first], next)).toEqual([first, next])
    const filled = Array.from({ length: 3 }, (_, i) => sample(i + 1, 20, 100, i))
    expect(recordHeapSample(filled, sample(9, 20, 100, 9), 3).map((item) => item.used)).toEqual([
      2, 3, 9,
    ])
    expect(recordHeapSample([first], next, 0)).toEqual([])
  })
})

describe('heapSparkline and heapDelta', () => {
  it('plots used heap across the session and reports growth since the first sample', () => {
    const a = sample(10, 20, 100, 1)
    const b = sample(20, 20, 100, 2)
    expect(heapSparkline([a])).toBe('')
    expect(heapSparkline([a, b], 10, 10)).toBe('0.0,9.0 10.0,1.0')
    expect(heapDelta(a, b)).toBe(10)
    expect(heapDelta(null, b)).toBeNull()
  })
})
