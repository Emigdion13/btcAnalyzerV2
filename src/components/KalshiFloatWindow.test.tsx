// @vitest-environment jsdom
/**
 * The Kalshi 15m window, rendered for real. The body is pure, so the tests pin
 * the honest states it must show: a full snapshot, a no-market snapshot, and
 * the loading state the window starts in — numbers it does not have are "—",
 * never invented.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { KalshiFloatResponse } from '../../shared/kalshi-float'
import { KalshiFloatBody, KalshiFloatWindow } from './KalshiFloatWindow'

const OPEN = 1_789_333_200 // 2026-09-13T21:00:00Z
const CLOSE = 1_789_334_100 // 2026-09-13T21:15:00Z
const NOW = OPEN + 600 // ten minutes in: five minutes left

const fullResponse: KalshiFloatResponse = {
  source: 'kalshi',
  product: 'BTC-USD',
  series: 'KXBTC15M',
  ticker: 'KXBTC15M-26SEP131715-15',
  target: 77314.22,
  decimals: 2,
  open: OPEN,
  close: CLOSE,
  upPct: 69,
  downPct: 31,
  upX: 1.4185,
  downX: 2.983,
  now: 77330.1,
  nowSource: 'kalshi',
  quiet: false,
  pctSource: 'book',
  asOf: NOW * 1000,
  message: 'Now = the index Kalshi settles on · % from the live order book · read-only',
}

const noMarket: KalshiFloatResponse = {
  ...fullResponse,
  ticker: null,
  target: null,
  open: null,
  close: null,
  upPct: null,
  downPct: null,
  upX: null,
  downX: null,
  message: 'Waiting for the next contract…',
}

const body = (props: Partial<Parameters<typeof KalshiFloatBody>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(KalshiFloatBody, {
      response: fullResponse,
      message: fullResponse.message,
      coin: 'BTC-USD',
      nowSec: NOW,
      left: CLOSE - NOW,
      nowColor: 'flat',
      onCoinChange: () => {},
      ...props,
    }),
  )

describe('KalshiFloatWindow', () => {
  it('starts in the loading state: chips and a waiting line, no invented numbers', () => {
    const html = renderToStaticMarkup(
      createElement(KalshiFloatWindow, { product: 'BTC-USD', onClose: () => {} }),
    )
    expect(html).toContain('data-testid="kalshi-float-window"')
    expect(html).toContain('data-coin="BTC-USD"')
    // The metals wear their chart tickers (XAU / XAG), the coins their bare names.
    for (const label of ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'HYPE', 'BNB', 'XAU', 'XAG']) {
      expect(html).toContain(`>${label}</button>`)
    }
    expect(html).toContain('Connecting…')
    // The market is not on screen yet: the target and Now are em-dashes.
    expect(html).toContain('data-testid="kalshi-float-target">—</span>')
    expect(html).toContain('data-testid="kalshi-float-now">—</span>')
    expect(html).toContain('is-waiting')
  })

  it('a remembered minimized preference renders the one-line readout', () => {
    localStorage.setItem('atlas.v1.kalshi-float-min', 'true')
    const html = renderToStaticMarkup(
      createElement(KalshiFloatWindow, { product: 'BTC-USD', onClose: () => {} }),
    )
    expect(html).toContain('kalshi-float-min-row')
    expect(html).toContain('data-stale="false"')
    localStorage.removeItem('atlas.v1.kalshi-float-min')
  })
})

describe('KalshiFloatBody', () => {
  it('paints the full snapshot the way Kalshi spells it', () => {
    const html = body()
    // The target, with the open time in Kalshi's US-Eastern clock (21:00Z = 5:00pm EDT).
    expect(html).toContain('Target · 5:00pm')
    expect(html).toContain('data-testid="kalshi-float-target">$77,314.22</span>')
    // Now: the live index value and its distance from the target.
    expect(html).toContain('Now ↑ $15.88')
    expect(html).toContain('data-testid="kalshi-float-now">$77,330.10</span>')
    // The pills: the % as displayed and the net payout.
    expect(html).toContain('Up · 69%')
    expect(html).toContain('1.42x')
    expect(html).toContain('Down · 31%')
    expect(html).toContain('2.98x')
    // Five minutes to the cut, on the running contract.
    expect(html).toContain('Closes in')
    expect(html).toContain('5:00')
    expect(html).toContain('BTC · 15 min')
    expect(html).toContain('read-only')
  })

  it('price below the target points down', () => {
    const html = body({
      response: { ...fullResponse, now: 77300.5 },
      nowSec: NOW,
    })
    expect(html).toContain('Now ↓ $13.72')
  })

  it('a no-market snapshot waits, and still shows the index when it has one', () => {
    const html = body({ response: noMarket, message: noMarket.message })
    expect(html).toContain('Waiting for the next contract…')
    expect(html).toContain('data-testid="kalshi-float-target">—</span>')
    expect(html).toContain('Up · —')
    expect(html).toContain('Down · —')
    // The index does not depend on a contract: Now keeps flowing.
    expect(html).toContain('data-testid="kalshi-float-now">$77,330.10</span>')
  })

  it('a metal with no open contract says exactly that, for its hours reason', () => {
    const html = body({
      response: { ...noMarket, product: 'XAU-USD', message: 'No open contract right now' },
      coin: 'XAU-USD',
    })
    expect(html).toContain('No open contract right now')
    // No running contract, so no countdown line and no "coin · 15 min" label either.
    expect(html).not.toContain('Closes in')
    expect(html).not.toContain('· 15 min')
  })

  it('a paused index reads "no ticks" — normal outside hours, not a failure', () => {
    const message = 'The index is not emitting ticks right now (underlying paused)'
    const html = body({
      response: { ...noMarket, quiet: true, now: null },
      message,
    })
    expect(html).toContain('Now · no ticks')
    expect(html).toContain('emitting ticks')
  })

  it('the footer turns cautionary for fallback data', () => {
    const listHtml = body({
      response: { ...fullResponse, pctSource: 'list' },
      message: '% from the market list, up to ~20s delayed (the order book did not answer)',
    })
    expect(listHtml).toContain('is-caution')
    const coinbaseHtml = body({
      response: { ...fullResponse, nowSource: 'coinbase' },
      message: 'Now ≈ Coinbase — approximate; the Kalshi index did not answer',
    })
    expect(coinbaseHtml).toContain('is-caution')
    const cleanHtml = body()
    expect(cleanHtml).not.toContain('is-caution')
  })
})
