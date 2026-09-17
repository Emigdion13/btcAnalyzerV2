// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { isMetalInterval, isMetalSymbol } from '../../shared/kalshi'
import { TIMEFRAMES } from './market'
import { initialMarket, initializeCoinbaseWorkspace } from './market-settings'

const key = (name: string) => `atlas.v1.${name}`
const store = (name: string, value: unknown) =>
  localStorage.setItem(key(name), JSON.stringify(value))
const read = <T>(name: string): T => JSON.parse(localStorage.getItem(key(name))!) as T

describe('PAX Gold workspace routing', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('opens old XAU shared links as Coinbase PAXG', () => {
    window.history.replaceState({}, '', '/?source=coinbase&symbol=XAU-USD')
    expect(initialMarket()).toEqual({ source: 'coinbase', symbol: 'PAXG-USD' })
  })

  it('migrates a previously initialized Gold chart, tab and watchlist', () => {
    store('coinbase-initialized', true)
    store('symbol', 'XAU-USD')
    store('tabs', ['BTC-USD', 'XAU-USD', 'PAXG-USD'])
    store('watchlist', ['XAU-USD', 'XAG-USD'])

    initializeCoinbaseWorkspace()

    expect(read('symbol')).toBe('PAXG-USD')
    expect(read<string[]>('tabs')).toEqual(['BTC-USD', 'PAXG-USD'])
    expect(read<string[]>('watchlist')).toEqual(['PAXG-USD', 'XAG-USD'])
  })

  it('keeps PAXG on Coinbase with every normal chart timeframe available', () => {
    window.history.replaceState({}, '', '/?symbol=PAXG-USD')
    expect(initialMarket()).toEqual({ source: 'coinbase', symbol: 'PAXG-USD' })
    expect(isMetalSymbol('PAXG-USD')).toBe(false)
    expect(TIMEFRAMES).toEqual(['1m', '3m', '5m', '15m', '1h', '4h', '1D', '1W'])
    expect(
      TIMEFRAMES.filter((timeframe) => !isMetalSymbol('PAXG-USD') || isMetalInterval(timeframe)),
    ).toEqual(TIMEFRAMES)
  })
})
