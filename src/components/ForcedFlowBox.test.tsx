import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isForcedFlow, type ForcedFlow } from '../../shared/forced-flow'
import { ForcedFlowBox } from './ForcedFlowBox'

const flow = (overrides: Partial<ForcedFlow> = {}): ForcedFlow => ({
  product: 'BTC-USD',
  asOf: 1_790_828_700,
  state: 'longs-liquidating',
  windowSeconds: 300,
  priceChange: -0.0042,
  oiChange: -0.0061,
  openInterest: 75_000,
  mark: 83_400,
  oiVenues: ['okx', 'hyperliquid'],
  thresholds: { move: 0.0021, oiDrop: -0.0024, oiRise: 0.0026, samples: 1440, calibrated: true },
  liquidations: {
    longUsd: 40_000,
    shortUsd: 0,
    longUsd5m: 220_000,
    shortUsd5m: 5_000,
    burstSeconds: 60,
    recent: [
      {
        venue: 'okx',
        time: 1_790_828_690,
        price: 83_420,
        size: 1.2,
        notional: 100_104,
        side: 'long',
      },
    ],
  },
  funding: { rate8h: 0.0004, venues: ['okx', 'deribit'], crowded: 'longs' },
  feeds: { okx: 'live', kraken: 'live', deribit: 'down' },
  events: [
    {
      id: 'BTC-USD:longs-liquidating:1790828640',
      state: 'longs-liquidating',
      start: 1_790_828_640,
      end: 1_790_828_700,
      price: 83_500,
      priceChange: -0.0042,
      oiChange: -0.0061,
      liquidatedUsd: 220_000,
    },
  ],
  ...overrides,
})

describe('ForcedFlowBox', () => {
  it('explains a long squeeze with the OI and price that define it', () => {
    expect(isForcedFlow(flow())).toBe(true)
    const html = renderToStaticMarkup(<ForcedFlowBox flow={flow()} onClose={() => {}} />)
    expect(html).toContain('Longs being liquidated')
    expect(html).toContain('open interest fell 0.61%')
    expect(html).toContain('-0.42%')
    expect(html).toContain('longs crowded')
    expect(html).toContain('long liq')
    expect(html).toContain('Long squeeze')
    expect(html).toContain('data-feed="down"')
  })

  it('names a cascade from liquidation prints when the burst is large', () => {
    const html = renderToStaticMarkup(
      <ForcedFlowBox
        flow={flow({
          state: 'shorts-liquidating',
          priceChange: 0.003,
          liquidations: { ...flow().liquidations, shortUsd: 1_500_000, longUsd: 0 },
        })}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('Shorts being squeezed')
    expect(html).toContain('$1.50M of shorts force-closed in the last minute')
  })

  it('says it is waiting instead of drawing numbers it does not have', () => {
    const html = renderToStaticMarkup(<ForcedFlowBox flow={null} onClose={() => {}} />)
    expect(html).toContain('Waiting for the derivatives feed')
    expect(html).not.toContain('OPEN INT 5M')
  })

  it('flags an uncalibrated threshold', () => {
    const html = renderToStaticMarkup(
      <ForcedFlowBox
        flow={flow({
          state: 'warming-up',
          thresholds: { move: null, oiDrop: null, oiRise: null, samples: 12, calibrated: false },
        })}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('Calibrating · 12 windows')
  })
})
