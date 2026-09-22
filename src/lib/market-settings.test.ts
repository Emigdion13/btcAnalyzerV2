// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { isMetalInterval, isMetalSymbol } from '../../shared/kalshi'
import { TIMEFRAMES } from './market'
import { initialMarket, initializeCoinbaseWorkspace } from './market-settings'

const key = (name: string) => `atlas.v1.${name}`
const store = (name: string, value: unknown) =>
  localStorage.setItem(key(name), JSON.stringify(value))
const read = <T>(name: string): T => JSON.parse(localStorage.getItem(key(name))!) as T

describe('Kalshi Gold workspace routing', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('opens legacy PAXG shared links as Kalshi XAU', () => {
    window.history.replaceState({}, '', '/?source=coinbase&symbol=PAXG-USD')
    expect(initialMarket()).toEqual({ source: 'coinbase', symbol: 'XAU-USD' })
  })

  it('migrates a previously stored PAXG chart, tab and watchlist back to XAU', () => {
    store('coinbase-initialized', true)
    store('symbol', 'PAXG-USD')
    store('tabs', ['BTC-USD', 'PAXG-USD', 'XAU-USD'])
    store('watchlist', ['PAXG-USD', 'XAG-USD'])

    initializeCoinbaseWorkspace()

    expect(read('symbol')).toBe('XAU-USD')
    expect(read<string[]>('tabs')).toEqual(['BTC-USD', 'XAU-USD'])
    expect(read<string[]>('watchlist')).toEqual(['XAU-USD', 'XAG-USD'])
  })

  it('keeps XAU on Kalshi with 15m+ chart timeframes', () => {
    window.history.replaceState({}, '', '/?symbol=XAU-USD')
    expect(initialMarket()).toEqual({ source: 'coinbase', symbol: 'XAU-USD' })
    expect(isMetalSymbol('XAU-USD')).toBe(true)
    expect(TIMEFRAMES).toEqual(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W'])
    expect(
      TIMEFRAMES.filter((timeframe) => !isMetalSymbol('XAU-USD') || isMetalInterval(timeframe)),
    ).toEqual(['15m', '30m', '1h', '2h', '4h', '1D', '1W'])
  })
})
