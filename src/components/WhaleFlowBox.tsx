import { useEffect, useRef, useState } from 'react'
import { Activity, GripVertical, Info, X } from 'lucide-react'
import type { WhaleFlow } from '../../shared/coinbase'
import {
  formatNotional,
  summarizeWhalePrints,
  type WhaleExecutionSummary,
} from '../../shared/whale-flow'
import { formatPrice } from '../lib/market'

const clockTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

const PHASE_LABEL: Record<WhaleFlow['phase'], string> = {
  building: 'Building',
  active: 'Happening now',
  fading: 'Done',
}

/**
 * Absolute-size tier for the sweep. $50K+ net pushes are the ones that walk books —
 * they get their own badge so the crazy prints are unmissable at a glance.
 */
const sizeTier = (net: number): string | null => {
  const abs = Math.abs(net)
  if (abs >= 1_000_000) return '$1M+ mega sweep'
  if (abs >= 500_000) return '$500K+ huge sweep'
  if (abs >= 100_000) return '$100K+ large sweep'
  if (abs >= 50_000) return '$50K+ sweep'
  return null
}

/** Prefer the complete server-side map; the print fallback keeps older payloads readable. */
const executionMap = (flow: WhaleFlow | null): WhaleExecutionSummary | null => {
  if (!flow) return null
  if (
    Number.isFinite(flow.executionVwap) &&
    Number.isFinite(flow.executionLow) &&
    Number.isFinite(flow.executionHigh)
  )
    return {
      vwap: flow.executionVwap!,
      low: flow.executionLow!,
      high: flow.executionHigh!,
      grossNotional: flow.bought + flow.sold,
    }
  return summarizeWhalePrints(flow.prints)
}

/**
 * Transient readout of a whale sweep on the charted Coinbase product.
 *
 * Ephemeral by design: a figure appears while a large directional sweep is under way, lingers a
 * few seconds after it stops, then disappears. Nothing stale is left on screen. When no sweep is
 * running the box collapses to a dim "watching" pill so the feature is still discoverable without
 * displaying a number.
 */
export function WhaleFlowBox({ flow, onClose }: { flow: WhaleFlow | null; onClose: () => void }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const dragState = useRef<{ dx: number; dy: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

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

  const net = flow?.net ?? 0
  const direction = net > 0 ? 'in' : net < 0 ? 'out' : 'flat'
  const phase = flow?.phase ?? 'idle'
  const execution = executionMap(flow)
  const anchored = position
    ? { left: position.x, top: position.y, right: 'auto' as const, bottom: 'auto' as const }
    : undefined

  return (
    <div
      ref={boxRef}
      className={`whale-box whale-box-${direction} whale-phase-${phase}${flow ? '' : ' is-watching'}`}
      style={anchored}
      role="status"
      aria-live="polite"
      aria-label="Live whale sweep"
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
        {flow ? (
          <>
            {sizeTier(flow.net) ? (
              <span className="whale-box-tier" title="Absolute net size of this sweep">
                {sizeTier(flow.net)}
              </span>
            ) : null}
            <span className={`whale-box-phase whale-box-phase-${phase}`}>
              {phase === 'active' ? <span className="whale-pip" aria-hidden /> : null}
              {PHASE_LABEL[flow.phase]}
            </span>
          </>
        ) : (
          <span className="whale-box-phase whale-box-phase-idle">Watching</span>
        )}
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
          A burst of large orders <strong>filled on this Coinbase book</strong> within{' '}
          {flow?.windowSeconds ?? 5}s. The price map below uses the exact match prices, so it shows{' '}
          <strong>where the money actually traded</strong>; the separate level2 panel shows where
          money is still resting. It clears once the sweep stops — it cannot identify a wallet,
          predict a trade before it happens, or see OTC blocks and other venues.
        </p>
      ) : null}

      {!flow ? (
        <p className="whale-box-watching">
          <Activity size={12} aria-hidden />
          No large sweep right now.
        </p>
      ) : (
        <>
          <div className="whale-box-net">
            <span className="whale-box-net-value" data-direction={direction}>
              {formatNotional(net)}
            </span>
            <span className="whale-box-net-label">
              {direction === 'in'
                ? 'sweeping into'
                : direction === 'out'
                  ? 'sweeping out of'
                  : 'on'}{' '}
              {flow.product.replace('-USD', '')} · {flow.count} fill{flow.count === 1 ? '' : 's'}
            </span>
          </div>

          {execution ? (
            <div className="whale-box-execution" data-testid="whale-execution-map">
              <div className="whale-box-execution-head">
                <span>EXECUTED PRICE MAP</span>
                <span title="Gross directional notional across every fill in the live window">
                  {formatNotional(execution.grossNotional).replace('+', '')}
                </span>
              </div>
              <div className="whale-box-execution-main">
                <span className="whale-box-execution-label">VWAP</span>
                <strong>{formatPrice(execution.vwap, true)}</strong>
              </div>
              <div className="whale-box-execution-range">
                <span>range</span>
                <span>
                  {formatPrice(execution.low, true)} → {formatPrice(execution.high, true)}
                </span>
              </div>
            </div>
          ) : null}

          <div
            className="whale-box-meter"
            role="presentation"
            title={`${flow.intensity.toFixed(1)}× the ${formatNotional(flow.threshold).replace('+', '')} sweep threshold`}
          >
            <span
              className="whale-box-meter-fill"
              style={{ width: `${Math.min(100, (flow.intensity / 2) * 100)}%` }}
            />
          </div>

          {!flow.calibrated ? (
            <p className="whale-box-calibrating">
              Calibrating · {flow.sampled} trades sampled. Size is provisional until this product
              has enough history.
            </p>
          ) : null}

          {flow.prints.length ? (
            <ul className="whale-box-prints">
              {flow.prints.slice(0, 4).map((print) => (
                <li
                  key={print.id}
                  className={print.side === 'buy' ? 'is-buy' : 'is-sell'}
                  title={`${print.size.toLocaleString(undefined, { maximumFractionDigits: 4 })} units executed`}
                >
                  <span className="whale-print-time">{clockTime(print.time)}</span>
                  <span className="whale-print-price">{formatPrice(print.price, true)}</span>
                  <span className="whale-print-value">{formatNotional(print.notional)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}
