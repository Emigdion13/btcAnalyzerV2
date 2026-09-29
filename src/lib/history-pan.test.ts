import { describe, expect, it } from 'vitest'
import { historyEnd, historyLabel, historyStep, panHistory, windowHistory } from './history-pan'

// 100 one-minute bars starting at 12:00 UTC on 29 September 2026.
const START = Date.UTC(2026, 8, 29, 12, 0) / 1000
const times = Array.from({ length: 100 }, (_, index) => START + index * 60)

describe('historyEnd', () => {
  it('ends on the newest bar while the window is live', () => {
    expect(historyEnd(times, null, 20)).toBe(100)
    expect(historyEnd([], null, 20)).toBe(0)
  })

  it('ends on the bar at or before the anchor time', () => {
    expect(historyEnd(times, times[59]!, 20)).toBe(60)
    // An anchor between two bars lands on the earlier one: it never shows a bar from after it.
    expect(historyEnd(times, times[59]! + 30, 20)).toBe(60)
  })

  it('keeps the window full when the anchor is older than the history', () => {
    expect(historyEnd(times, times[3]!, 20)).toBe(20)
    expect(historyEnd(times, START - 3600, 20)).toBe(20)
    expect(historyEnd(times.slice(0, 5), times[1]!, 20)).toBe(5)
  })
})

describe('panHistory', () => {
  it('walks back and forward in bars, anchored to a time', () => {
    const back = panHistory(times, null, 20, -10)
    expect(back).toBe(times[89])
    expect(panHistory(times, back, 20, -5)).toBe(times[84])
    expect(panHistory(times, back, 20, 4)).toBe(times[93])
  })

  it('stays on the same bars when a new candle arrives', () => {
    const anchor = panHistory(times, null, 20, -10)
    const grown = [...times, START + 100 * 60]
    expect(historyEnd(grown, anchor, 20)).toBe(90)
  })

  it('returns to live on reaching the newest bar, so the window follows new candles again', () => {
    const anchor = panHistory(times, null, 20, -3)
    expect(panHistory(times, anchor, 20, 3)).toBeNull()
    expect(panHistory(times, anchor, 20, 50)).toBeNull()
  })

  it('stops at the oldest full window instead of running off the history', () => {
    expect(panHistory(times, null, 20, -500)).toBe(times[19])
    expect(panHistory([], null, 20, -5)).toBeNull()
  })
})

describe('window history', () => {
  it('says nothing is behind while live, and how many bars are older', () => {
    expect(windowHistory(times, 100, 20)).toEqual({ behind: 0, older: 80, label: null })
  })

  it('counts the bars behind live and names the newest bar in view', () => {
    expect(windowHistory(times, 60, 20)).toEqual({ behind: 40, older: 40, label: '12:59' })
    expect(windowHistory(times, 20, 20).older).toBe(0)
  })

  it('steps a quarter of the window per click, never less than a bar', () => {
    expect(historyStep(20)).toBe(5)
    expect(historyStep(12)).toBe(3)
    expect(historyStep(2)).toBe(1)
  })

  it('adds the date once the look back crosses midnight', () => {
    const live = Date.UTC(2026, 8, 29, 0, 5) / 1000
    expect(historyLabel(live - 60, live)).toBe('00:04')
    expect(historyLabel(live - 600, live)).toBe('28/9 23:55')
  })
})
