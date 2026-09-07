import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Info, X } from 'lucide-react'
import type { WhaleFlow } from '../../shared/coinbase'
import { formatNotional } from '../../shared/whale-flow'

const WINDOW_LABEL = (seconds: number) =>
  seconds % 3600 === 0 ? `${seconds / 3600}h` : `${Math.round(seconds / 60)}m`

const clockTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

/**
 * Floating readout of large EXECUTED trades on the charted Coinbase product.
 *
 * Deliberately not called an on-chain whale tracker: it reports orders filled on this venue's
 * book, which is price impact as it happens, not wallet movement or intent. The disclosure in the
 * footer says so, because conflating the two is the single most common error in whale analysis.
 */
export function WhaleFlowBox({ flow, onClose }: { flow: WhaleFlow | null; onClose: () => void }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const dragState = useRef<{ dx: number; dy: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Keep the box on screen when the viewport shrinks.
  useEffect(() => {
    if (!position) return
    const clamp = () => {
      const box = boxRef.current
      if (!box) return
      const { width, height } = box.getBoundingClientRect()
      setPosition((p) =>
        p
          ? {
              x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - width - 8)),
              y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - height - 8)),
            }
          : p,
      )
    }
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [position])

  useEffect(() => {
    if (!dragState.current) return
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
  })

  const startDrag = (event: React.PointerEvent) => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    dragState.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    // Switch from the CSS-anchored default to explicit coordinates on first drag.
    setPosition({ x: rect.left, y: rect.top })
  }

  const net = flow?.net ?? 0
  const direction = net > 0 ? 'in' : net < 0 ? 'out' : 'flat'
  const prints = useMemo(() => flow?.prints.slice(0, expanded ? 12 : 4) ?? [], [flow, expanded])

  return (
    <div
      ref={boxRef}
      className={`whale-box whale-box-${direction}`}
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
      role="complementary"
      aria-label="Large executed trade flow"
    >
      <header className="whale-box-head">
        <button
          type="button"
          className="whale-box-grip"
          onPointerDown={startDrag}
          aria-label="Move the whale flow box"
          title="Drag to move"
        >
          <GripVertical size={13} aria-hidden />
        </button>
        <h2>Whale flow</h2>
        {flow ? <span className="whale-box-window">{WINDOW_LABEL(flow.windowSeconds)}</span> : null}
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
          aria-label="Hide the whale flow box"
          title="Hide"
        >
          <X size={13} aria-hidden />
        </button>
      </header>

      {showInfo ? (
        <p className="whale-box-info">
          Large orders <strong>filled on this Coinbase book</strong>, sized against recent trades on
          the same product. This is executed price impact, not on-chain wallet movement — it cannot
          see deposits, custody transfers, OTC blocks, or other venues.
        </p>
      ) : null}

      {!flow ? (
        <p className="whale-box-empty">
          Waiting for a live Coinbase trade stream. No flow is shown while the feed is paused,
          stale, or disconnected.
        </p>
      ) : (
        <>
          <div className="whale-box-net">
            <span className="whale-box-net-value" data-direction={direction}>
              {formatNotional(net)}
            </span>
            <span className="whale-box-net-label">
              {direction === 'in' ? 'net into' : direction === 'out' ? 'net out of' : 'balanced ·'}{' '}
              {flow.product.replace('-USD', '')}
            </span>
          </div>

          <div className="whale-box-split">
            <div className="whale-box-leg">
              <span className="whale-box-leg-label">Bought</span>
              <span className="whale-box-leg-value is-buy">{formatNotional(flow.bought)}</span>
            </div>
            <div className="whale-box-leg">
              <span className="whale-box-leg-label">Sold</span>
              <span className="whale-box-leg-value is-sell">
                {flow.sold ? formatNotional(-flow.sold) : '$0'}
              </span>
            </div>
          </div>

          {!flow.calibrated ? (
            <p className="whale-box-calibrating">
              Calibrating threshold · {flow.sampled} trades sampled. Figures are provisional until
              this product has enough trade history to size a large print.
            </p>
          ) : null}

          {prints.length ? (
            <ul className="whale-box-prints">
              {prints.map((print) => (
                <li key={print.id} className={print.side === 'buy' ? 'is-buy' : 'is-sell'}>
                  <span className="whale-print-time">{clockTime(print.time)}</span>
                  <span className="whale-print-size">
                    {print.size.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                  <span className="whale-print-value">{formatNotional(print.notional)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="whale-box-empty">
              No trade above {formatNotional(flow.threshold).replace('+', '')} in the last{' '}
              {WINDOW_LABEL(flow.windowSeconds)}.
            </p>
          )}

          <footer className="whale-box-foot">
            <span>
              {flow.count} print{flow.count === 1 ? '' : 's'} ≥{' '}
              {formatNotional(flow.threshold).replace('+', '')}
            </span>
            {flow.prints.length > 4 ? (
              <button
                type="button"
                className="whale-box-more"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </footer>
        </>
      )}
    </div>
  )
}
