import { useEffect, useRef, useState } from 'react'
import { GripVertical, Info, X } from 'lucide-react'
import {
  FORCED_FOLLOW_THROUGH,
  LIQUIDATION_BURST_USD,
  LIQUIDATION_VENUES,
  VENUE_LABEL,
  formatChange,
  type ForcedFlow,
  type ForcedState,
} from '../../shared/forced-flow'
import { formatNotional } from '../../shared/whale-flow'
import { formatPrice } from '../lib/market'

const clockTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

const STATE_LABEL: Record<ForcedState, string> = {
  'longs-liquidating': 'Longs being liquidated',
  'shorts-liquidating': 'Shorts being squeezed',
  'new-shorts': 'New shorts opening',
  'new-longs': 'New longs opening',
  'big-move': 'Big move, leverage steady',
  calm: 'No forced flow',
  'warming-up': 'Collecting open interest',
}

const STATE_PILL: Record<ForcedState, string> = {
  'longs-liquidating': 'Forced selling',
  'shorts-liquidating': 'Forced buying',
  'new-shorts': 'New positions',
  'new-longs': 'New positions',
  'big-move': 'Spot-led',
  calm: 'Calm',
  'warming-up': 'Warming up',
}

/** What the state means, in one sentence built from the live numbers. */
function explain(flow: ForcedFlow): string {
  const price = formatChange(flow.priceChange)
  const oi = formatChange(flow.oiChange)
  // Unsigned, for sentences that already say "fell" or "up".
  const oiSize = flow.oiChange === null ? '—' : `${Math.abs(flow.oiChange * 100).toFixed(2)}%`
  const longs = flow.liquidations.longUsd
  const shorts = flow.liquidations.shortUsd
  switch (flow.state) {
    case 'longs-liquidating':
      return longs >= LIQUIDATION_BURST_USD
        ? `${formatNotional(longs).replace('+', '')} of longs force-closed in the last minute. The drop is margin calls, not new sellers.`
        : `Price ${price} in 5m while open interest fell ${oiSize}: longs are being closed out, not shorts piling in.`
    case 'shorts-liquidating':
      return shorts >= LIQUIDATION_BURST_USD
        ? `${formatNotional(shorts).replace('+', '')} of shorts force-closed in the last minute. The pump is margin calls, not new buyers.`
        : `Price ${price} in 5m while open interest fell ${oiSize}: shorts are being closed out, not longs piling in.`
    case 'new-shorts':
      return `Price ${price} in 5m with open interest up ${oiSize}: fresh shorts are pushing it, nobody is being forced.`
    case 'new-longs':
      return `Price ${price} in 5m with open interest up ${oiSize}: fresh longs are pushing it, nobody is being forced.`
    case 'big-move':
      return `Price ${price} in 5m with open interest ${oi}, inside its usual range: the move came from spot or hedged flow, not liquidations.`
    case 'calm':
      return 'Price and open interest are inside their usual five-minute range.'
    case 'warming-up':
      return 'Needs five minutes of open-interest samples before it can compare.'
  }
}

const tone = (state: ForcedState) =>
  state === 'longs-liquidating'
    ? 'down'
    : state === 'shorts-liquidating'
      ? 'up'
      : state === 'new-shorts' || state === 'new-longs' || state === 'big-move'
        ? 'notice'
        : 'quiet'

const percent = (rate: number) => `${Math.round(rate * 100)}%`

/**
 * Live readout of perpetual-futures positioning behind the charted move: is it leverage being
 * force-closed (open interest collapsing, liquidation prints) or new positions opening?
 *
 * Descriptive, not predictive — the info panel carries the measured follow-through, which is the
 * same for forced and unforced moves.
 */
export function ForcedFlowBox({ flow, onClose }: { flow: ForcedFlow | null; onClose: () => void }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const dragState = useRef<{ dx: number; dy: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragState.current
      const box = boxRef.current
      if (!drag || !box) return
      const { width, height } = box.getBoundingClientRect()
      setPosition({
        x: Math.min(
          Math.max(8, event.clientX - drag.dx),
          Math.max(8, window.innerWidth - width - 8),
        ),
        y: Math.min(
          Math.max(8, event.clientY - drag.dy),
          Math.max(8, window.innerHeight - height - 8),
        ),
      })
    }
    const up = () => {
      dragState.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const startDrag = (event: React.PointerEvent) => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    dragState.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    setPosition({ x: rect.left, y: rect.top })
  }

  const state = flow?.state ?? 'warming-up'
  const anchored = position
    ? { left: position.x, top: position.y, right: 'auto' as const, bottom: 'auto' as const }
    : undefined
  const measured =
    state in FORCED_FOLLOW_THROUGH
      ? FORCED_FOLLOW_THROUGH[state as keyof typeof FORCED_FOLLOW_THROUGH]
      : null
  const all = FORCED_FOLLOW_THROUGH.all

  return (
    <div
      ref={boxRef}
      className={`forced-box forced-box-${tone(state)}`}
      style={anchored}
      role="status"
      aria-live="polite"
      aria-label="Forced flow"
      data-testid="forced-flow-box"
      data-state={state}
    >
      <header className="forced-box-head">
        <button
          type="button"
          className="whale-box-grip"
          onPointerDown={startDrag}
          aria-label="Move the forced flow box"
          title="Drag to move"
        >
          <GripVertical size={13} aria-hidden />
        </button>
        <h2>Forced flow</h2>
        <span className={`forced-box-pill forced-box-pill-${tone(state)}`}>
          {STATE_PILL[state]}
        </span>
        <button
          type="button"
          className={`whale-box-icon${showInfo ? ' is-active' : ''}`}
          onClick={() => setShowInfo((v) => !v)}
          aria-label="What this measures"
          aria-expanded={showInfo}
          title="What this measures"
        >
          <Info size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="whale-box-icon"
          onClick={onClose}
          aria-label="Hide the forced flow box"
          title="Hide"
        >
          <X size={13} aria-hidden />
        </button>
      </header>

      {showInfo ? (
        <div className="forced-box-info">
          <p>
            Reads <strong>perpetual futures</strong>, where liquidations happen: open interest from{' '}
            {(['okx', 'kraken', 'deribit', 'hyperliquid', 'coinbase-intl'] as const)
              .map((v) => VENUE_LABEL[v])
              .join(', ')}
            , and liquidation prints from OKX, Kraken and Deribit. Price falling while open interest
            falls unusually fast means longs are being closed out; rising, shorts.
          </p>
          <p>
            <strong>It explains the move, it does not call the next one.</strong> Over 180 days of
            BTC, a big 5m move got half of itself back within 15 minutes {percent(all.back15m)} of
            the time
            {measured && state !== 'big-move'
              ? `; when this rule called it "${STATE_LABEL[state].toLowerCase()}", ${percent(measured.back15m)}`
              : ''}
            . No label beat the all-moves rate by more than noise, and crowded funding did not
            predict direction either.
          </p>
          <p>
            Binance and Bybit block this region, and OKX throttles its feed to one order per second,
            so liquidation totals are a floor.
          </p>
        </div>
      ) : null}

      {!flow ? (
        <p className="forced-box-explain">Waiting for the derivatives feed…</p>
      ) : (
        <>
          <div className="forced-box-headline" data-tone={tone(state)}>
            {STATE_LABEL[state]}
          </div>
          <p className="forced-box-explain">{explain(flow)}</p>

          <div className="forced-box-stats">
            <div
              className="forced-box-stat"
              title={
                flow.thresholds.move !== null
                  ? `Big move = beyond ±${(flow.thresholds.move * 100).toFixed(2)}% (90th percentile of recent 5m windows)`
                  : undefined
              }
            >
              <span className="forced-box-label">PRICE 5M</span>
              <span className="forced-box-value" data-sign={Math.sign(flow.priceChange ?? 0)}>
                {formatChange(flow.priceChange)}
              </span>
            </div>
            <div
              className="forced-box-stat"
              title={
                flow.thresholds.oiDrop !== null && flow.thresholds.oiRise !== null
                  ? `Usual 5m range ${formatChange(flow.thresholds.oiDrop)} … ${formatChange(flow.thresholds.oiRise)}`
                  : undefined
              }
            >
              <span className="forced-box-label">OPEN INT 5M</span>
              <span className="forced-box-value" data-sign={Math.sign(flow.oiChange ?? 0)}>
                {formatChange(flow.oiChange)}
              </span>
            </div>
            <div className="forced-box-stat" title="USD force-closed in the last minute">
              <span className="forced-box-label">LIQ 1M L / S</span>
              <span className="forced-box-value">
                <span className="is-down">
                  {formatNotional(flow.liquidations.longUsd).replace('+', '')}
                </span>
                {' / '}
                <span className="is-up">
                  {formatNotional(flow.liquidations.shortUsd).replace('+', '')}
                </span>
              </span>
            </div>
            <div
              className="forced-box-stat"
              title={`Mean of ${flow.funding.venues.map((v) => VENUE_LABEL[v]).join(', ') || 'no venues'}, per 8 hours`}
            >
              <span className="forced-box-label">FUNDING 8H</span>
              <span className="forced-box-value">
                {flow.funding.rate8h === null ? '—' : formatChange(flow.funding.rate8h, 4)}
                {flow.funding.crowded ? (
                  <span className="forced-box-crowded"> {flow.funding.crowded} crowded</span>
                ) : null}
              </span>
            </div>
          </div>

          {flow.liquidations.recent.length ? (
            <ul className="forced-box-prints" aria-label="Recent liquidations">
              {flow.liquidations.recent.slice(0, 4).map((l, i) => (
                <li
                  key={`${l.venue}:${l.time}:${i}`}
                  className={l.side === 'long' ? 'is-down' : 'is-up'}
                >
                  <span>{VENUE_LABEL[l.venue]}</span>
                  <span>{l.side === 'long' ? 'long liq' : 'short liq'}</span>
                  <span>{formatPrice(l.price, true)}</span>
                  <span>{formatNotional(l.notional).replace('+', '')}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {flow.events.length ? (
            <ul className="forced-box-events" aria-label="Recent forced-flow events">
              {[...flow.events]
                .reverse()
                .slice(0, 3)
                .map((event) => (
                  <li
                    key={event.id}
                    className={event.state === 'longs-liquidating' ? 'is-down' : 'is-up'}
                  >
                    <span>{clockTime(event.start)}</span>
                    <span>
                      {event.state === 'longs-liquidating' ? 'Long squeeze' : 'Short squeeze'}
                    </span>
                    <span>{formatChange(event.priceChange, 1)}</span>
                    <span>OI {formatChange(event.oiChange, 1)}</span>
                  </li>
                ))}
            </ul>
          ) : null}

          <footer className="forced-box-foot">
            <span title="Venues inside the open-interest change">
              OI: {flow.oiVenues.map((v) => VENUE_LABEL[v]).join(' · ') || 'none yet'}
            </span>
            <span className="forced-box-feeds" title="Liquidation feeds">
              {LIQUIDATION_VENUES.map((venue) => (
                <span key={venue} data-feed={flow.feeds[venue] ?? 'down'}>
                  {VENUE_LABEL[venue]}
                </span>
              ))}
            </span>
            {!flow.thresholds.calibrated ? (
              <span className="forced-box-calibrating">
                Calibrating · {flow.thresholds.samples} windows of history
              </span>
            ) : null}
          </footer>
        </>
      )}
    </div>
  )
}
