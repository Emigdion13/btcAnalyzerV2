import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MacdAiDecisionBox } from './MacdAiDecisionBox'
import { MacdAiPanel } from './MacdAiPanel'
import {
  analyzeMacdForecast,
  defaultMacdAiLearningState,
  defaultMacdForecastJournal,
  type MacdForecast,
} from '../lib/macd-forecast'
import type { Candle } from '../lib/types'

// Pin the floating window open so the expanded forecast body renders.
vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/storage')>()
  return { ...actual, useLocalState: () => [false, () => {}] }
})

function forecastFixture(): MacdForecast {
  const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
    time: i * 60,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }))
  const macd: number[] = []
  const signal: number[] = []
  for (let i = 0; i < 40; i++) {
    const gap = -1.2 + (i / 39) * 1.1
    const level = -2 + (i / 39) * 1.6
    signal.push(level)
    macd.push(level + gap)
  }
  const forecast = analyzeMacdForecast({
    candles,
    timeframe: '5m',
    values: { macd, signal, histogram: macd.map((value, i) => value - signal[i]) },
    resolution: '5m',
    settingsLabel: 'CM_Ult_MacD_MTF (5, 12, 26, 9)',
    symbol: 'BTC-USD',
  })
  if (!forecast) throw new Error('fixture produced no forecast')
  return forecast
}

describe('MACD AI surfaces', () => {
  it('renders the floating forecast window with the coming cross first', () => {
    const html = renderToStaticMarkup(
      createElement(MacdAiDecisionBox, {
        assetLabel: 'BTC-USD',
        source: 'coinbase',
        timeframe: '5m',
        forecast: forecastFixture(),
        cmActive: true,
        feedState: 'live',
        onOpenPanel: () => {},
        onClose: () => {},
      }),
    )
    expect(html).toContain('MACD AI')
    expect(html).toContain('Bullish cross')
    expect(html).toContain('MID LINE')
    expect(html).toContain('MACD agents')
  })

  it('explains itself when the CM pane is missing', () => {
    const html = renderToStaticMarkup(
      createElement(MacdAiDecisionBox, {
        assetLabel: 'BTC-USD',
        source: 'coinbase',
        timeframe: '5m',
        forecast: null,
        cmActive: false,
        feedState: 'live',
        onOpenPanel: () => {},
        onClose: () => {},
      }),
    )
    expect(html).toContain('No CM')
    expect(html).toContain('CM_Ult_MacD_MTF')
  })

  it('renders the forecast panel with timeline, specialists and learning', () => {
    const html = renderToStaticMarkup(
      createElement(MacdAiPanel, {
        assetLabel: 'BTC-USD',
        source: 'coinbase',
        timeframe: '5m',
        forecast: forecastFixture(),
        cmActive: true,
        settingsLabel: 'CM_Ult_MacD_MTF (5, 12, 26, 9)',
        learning: defaultMacdAiLearningState(),
        journal: defaultMacdForecastJournal(),
        onClose: () => {},
        onToggleAutoJournal: () => {},
        onClearJournal: () => {},
        onResetLearning: () => {},
      }),
    )
    expect(html).toContain('MACD AI')
    expect(html).toContain('What happens next')
    expect(html).toContain('Specialist opinions')
    expect(html).toContain('Cross Timer')
    expect(html).toContain('Learning &amp; journal')
  })
})
