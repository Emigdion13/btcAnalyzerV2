import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WhaleFlow } from '../../shared/coinbase'
import { WhaleFlowBox } from './WhaleFlowBox'

const flow = (overrides: Partial<WhaleFlow> = {}): WhaleFlow => ({
  product: 'BTC-USD',
  phase: 'active',
  net: 500_000,
  bought: 500_000,
  sold: 0,
  count: 3,
  threshold: 250_000,
  windowSeconds: 5,
  intensity: 2,
  prints: [
    {
      id: 1,
      time: 1_700_000_000,
      price: 100_250,
      size: 2,
      notional: 200_500,
      side: 'buy',
    },
  ],
  executionVwap: 100_500,
  executionLow: 100_250,
  executionHigh: 100_750,
  calibrated: true,
  sampled: 300,
  ...overrides,
})

describe('WhaleFlowBox', () => {
  it('shows the full execution map and the exact recent match price', () => {
    const html = renderToStaticMarkup(<WhaleFlowBox flow={flow()} onClose={() => {}} />)
    expect(html).toContain('EXECUTED PRICE MAP')
    expect(html).toContain('$100,500.00')
    expect(html).toContain('$100,250.00')
    expect(html).toContain('$100,750.00')
    expect(html).toContain('data-testid="whale-execution-map"')
  })

  it('falls back to the visible prints for older flow payloads', () => {
    const html = renderToStaticMarkup(
      <WhaleFlowBox
        flow={flow({ executionVwap: undefined, executionLow: undefined, executionHigh: undefined })}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('$100,250.00')
    expect(html).toContain('+$201K')
  })
})
