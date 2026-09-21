import { useEffect, useMemo, useRef, useState } from 'react'
import { GripVertical, Minus, Plus, RotateCcw, X } from 'lucide-react'
import type { KalshiFloatResponse } from '../../shared/kalshi-float'
import {
  isMetalFeed,
  KALSHI_COIN_FEEDS,
  KALSHI_METAL_FEEDS,
  kalshiFeedForProduct,
} from '../../shared/kalshi'
import { useFloatingWindow } from '../lib/floating-window'
import { useLocalState } from '../lib/storage'
import { useKalshiFloat } from '../lib/useKalshiFloat'

const POSITION_KEY = 'kalshi-float-pos'
const COIN_KEY = 'kalshi-float-coin'

/** One clock tick for the countdown, decoupled from the data polls. */
const COUNTDOWN_TICK_MS = 1_000

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/** The open time the way Kalshi spells it: 5:45pm (its clock is US Eastern). */
function etLabel(timeSeconds: number): string {
  return ET_FORMATTER.format(timeSeconds * 1000).replace(' AM', 'am').replace(' PM', 'pm')
}

function formatMoney(value: number | null, decimals: number): string {
  if (value === null) return '—'
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(clamped / 60)
  return `${minutes}:${String(clamped % 60).padStart(2, '0')}`
}

const CRYPTO_CHIPS = KALSHI_COIN_FEEDS.map((feed) => ({
  product: feed.product,
  label: feed.product.replace(/-USD$/, ''),
  metal: false,
}))
const METAL_CHIPS = KALSHI_METAL_FEEDS.map((feed) => ({
  product: feed.symbol,
  label: feed.ticker,
  metal: true,
}))

interface Props {
  /** The charted product — the default coin when the user has not picked one. */
  product: string
  /** The toolbar toggle owns visibility, so closing the window is the same choice. */
  onClose: () => void
}

/**
 * The floating Kalshi 15-minute window: a live readout of the contract that is
 * running right now, in the shape Kalshi's own page shows it.
 *
 *   Target · 5:45pm   — the strike (`floor_strike`) and open time in Kalshi's
 *                       US-Eastern clock
 *   Now ↑ $20.03      — the index the market settles on, its live value and its
 *                       distance from the target
 *   Up · 70% / 1.38x  — the percentage Kalshi displays (last trade clamped to
 *                       the live book) and what $1 pays net of the taker fee
 *
 * Everything is read-only market data through the same-origin server: the
 * buttons are indicators, not orders. A stale snapshot is dimmed and labelled,
 * never drawn as live, and the coin chips follow the user, not the chart.
 */
export function KalshiFloatWindow({ product, onClose }: Props) {
  const [minimized, setMinimized] = useLocalState('kalshi-float-min', false)
  const [coin, setCoin] = useLocalState<string>(
    COIN_KEY,
    kalshiFeedForProduct(product) ? product : 'BTC-USD',
  )
  // A ladder can lose a coin; an unknown selection falls back instead of polling 400s.
  const activeCoin = kalshiFeedForProduct(coin) ? coin : 'BTC-USD'

  const { response, message, stale } = useKalshiFloat({ product: activeCoin, enabled: true })

  // The countdown runs on its own second tick: a paused poll must not freeze
  // the clock, and the data poll does not guarantee exactly-one-per-second.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const hasMarket = !!response?.close
  useEffect(() => {
    if (!hasMarket) return
    const timer = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), COUNTDOWN_TICK_MS)
    return () => clearInterval(timer)
  }, [hasMarket])

  // The "Now" price flashes in the direction of the tick, like Kalshi's page.
  const prevNow = useRef<number | null>(null)
  let nowColor: 'up' | 'down' | 'flat' = 'flat'
  const currentNow = response ? response.now : null
  if (currentNow !== null && prevNow.current !== null && currentNow !== prevNow.current) {
    nowColor = currentNow > prevNow.current ? 'up' : 'down'
  }
  if (currentNow !== null) prevNow.current = currentNow

  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(POSITION_KEY, 6)

  const close = response?.close ?? null
  const left = close !== null ? close - nowSec : null

  return (
    <section
      ref={boxRef}
      className={`kalshi-float-window${minimized ? ' is-minimized' : ''}${
        dragging ? ' is-dragging' : ''
      }${stale ? ' is-stale' : ''}`}
      data-testid="kalshi-float-window"
      data-coin={activeCoin}
      data-stale={stale}
      role="region"
      aria-label="Kalshi 15-minute market window"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="kalshi-float-head" onPointerDown={startDrag}>
        <GripVertical size={11} className="kalshi-float-grip" aria-hidden="true" />
        <span className="kalshi-float-title">KALSHI 15M</span>
        <span
          className={`kalshi-float-tag ${
            response ? (stale ? 'is-stale' : 'is-live') : 'is-waiting'
          }`}
        >
          {response ? (stale ? 'STALE' : 'LIVE') : '…'}
        </span>
        <span className="kalshi-float-head-space" />
        {position ? (
          <button
            type="button"
            className="kalshi-float-button"
            aria-label="Snap the Kalshi window back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="kalshi-float-button"
          aria-label={minimized ? 'Expand the Kalshi window' : 'Minimize the Kalshi window'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="kalshi-float-button is-close"
          aria-label="Hide the Kalshi window"
          title="Hide"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div className="kalshi-float-min-row">
          <span className="kalshi-float-min-coin mono">{activeCoin.replace(/-USD$/, '')}</span>
          <span className={`kalshi-float-min-pct mono is-${upSide(response)}`}>
            {response?.upPct !== null && response?.upPct !== undefined
              ? `${response.upPct}% up`
              : '—'}
          </span>
          <span className="kalshi-float-min-clock mono">
            {left !== null && left >= 0 ? formatCountdown(left) : '—'}
          </span>
        </div>
      ) : (
        <KalshiFloatBody
          response={response}
          message={message}
          coin={activeCoin}
          nowSec={nowSec}
          left={left}
          nowColor={nowColor}
          onCoinChange={setCoin}
        />
      )}
    </section>
  )
}

/** Which side the pills should lean, for the minimized row. */
function upSide(response: KalshiFloatResponse | null): 'up' | 'down' | 'none' {
  if (!response || response.upPct === null || response.upPct === undefined) return 'none'
  return response.upPct >= 50 ? 'up' : 'down'
}

interface BodyProps {
  response: KalshiFloatResponse | null
  message: string
  coin: string
  nowSec: number
  left: number | null
  nowColor: 'up' | 'down' | 'flat'
  onCoinChange: (coin: string) => void
}

/** The paintable surface of the window, pure: everything it draws arrives in. */
export function KalshiFloatBody({
  response,
  message,
  coin,
  nowSec,
  left,
  nowColor,
  onCoinChange,
}: BodyProps) {
  const hasMarket = !!response && response.ticker !== null
  const decimals = response?.decimals ?? 2
  const target = response?.target ?? null
  const now = response?.now ?? null
  const upPct = response?.upPct ?? null
  const downPct = response?.downPct ?? null
  const open = response?.open ?? null
  const close = response?.close ?? null

  const diff = hasMarket && now !== null && target !== null ? now - target : null
  const diffSide = diff === null ? null : diff >= 0 ? 'up' : 'down'

  const loading = !response
  const footer = loading ? 'Connecting…' : message

  const progress = useMemo(() => {
    if (!hasMarket || open === null || close === null || left === null || close <= open) return 0
    return Math.min(1, Math.max(0, (nowSec - open) / (close - open)))
  }, [hasMarket, open, close, left, nowSec])

  const clockColor =
    left === null ? '' : left < 15 ? 'is-red' : left < 60 ? 'is-amber' : 'is-white'

  return (
    <>
      <div className="kalshi-float-panels">
        <div className="kalshi-float-panel">
          <span className="kalshi-float-kicker">
            {hasMarket && open !== null ? `Target · ${etLabel(open)}` : 'Target'}
          </span>
          <span className="kalshi-float-value mono" data-testid="kalshi-float-target">
            {loading ? '—' : formatMoney(target, decimals)}
          </span>
        </div>
        <div className="kalshi-float-panel">
          <span className={`kalshi-float-kicker ${diffSide ? `is-${diffSide}` : ''}`}>
            {loading
              ? 'Now'
              : now === null
                ? response?.quiet
                  ? 'Now · no ticks'
                  : 'Now · n/a'
                : `Now ${diffSide === 'up' ? '↑' : '↓'} ${formatMoney(Math.abs(diff ?? 0), decimals)}`}
          </span>
          <span
            className={`kalshi-float-value mono is-${nowColor}`}
            data-testid="kalshi-float-now"
          >
            {loading ? '—' : formatMoney(now, decimals)}
          </span>
        </div>
      </div>

      <div className="kalshi-float-pills" role="group" aria-label="Market odds">
        <div className="kalshi-float-pill is-up" data-testid="kalshi-float-up">
          <span className="kalshi-float-pill-label">
            Up · {upPct === null ? '—' : `${upPct}%`}
          </span>
          <span className="kalshi-float-pill-x mono">
            {response?.upX !== null && response?.upX !== undefined
              ? `${response.upX.toFixed(2)}x`
              : '—'}
          </span>
        </div>
        <div className="kalshi-float-pill is-down" data-testid="kalshi-float-down">
          <span className="kalshi-float-pill-label">
            Down · {downPct === null ? '—' : `${downPct}%`}
          </span>
          <span className="kalshi-float-pill-x mono">
            {response?.downX !== null && response?.downX !== undefined
              ? `${response.downX.toFixed(2)}x`
              : '—'}
          </span>
        </div>
      </div>

      <div className="kalshi-float-clock">
        {loading ? (
          <span className="kalshi-float-clock-label">Waiting for the market…</span>
        ) : !hasMarket ? (
          <span className="kalshi-float-clock-label is-waiting">
            {isMetalFeed(feedOf(coin)) ? 'No open contract right now' : 'Waiting for the next contract…'}
          </span>
        ) : left !== null && left <= 0 ? (
          <span className="kalshi-float-clock-label is-waiting">
            Settling — next contract shortly
          </span>
        ) : (
          <>
            <span className="kalshi-float-clock-label">Closes in</span>
            <span className={`kalshi-float-countdown mono ${clockColor}`}>
              {left !== null ? formatCountdown(left) : '—'}
            </span>
            <span className="kalshi-float-progress" aria-hidden="true">
              <i style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
            </span>
            <span className="kalshi-float-clock-coin mono">
              {coin.replace(/-USD$/, '')} · 15 min
            </span>
          </>
        )}
      </div>

      <div className="kalshi-float-chips" role="listbox" aria-label="Choose the market">
        {CRYPTO_CHIPS.map((chip) => (
          <Chip
            key={chip.product}
            label={chip.label}
            active={chip.product === coin}
            onClick={() => onCoinChange(chip.product)}
          />
        ))}
        <span className="kalshi-float-chips-sep" aria-hidden="true" />
        {METAL_CHIPS.map((chip) => (
          <Chip
            key={chip.product}
            label={chip.label}
            active={chip.product === coin}
            onClick={() => onCoinChange(chip.product)}
          />
        ))}
      </div>

      <footer className={`kalshi-float-foot ${footerIsCaution(footer) ? 'is-caution' : ''}`}>
        {footer}
      </footer>
    </>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`kalshi-float-chip${active ? ' is-active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/** The footer turns amber when the numbers on screen come from a fallback. */
function footerIsCaution(message: string): boolean {
  return (
    message.includes('market list') ||
    message.includes('Coinbase') ||
    message.includes('unavailable') ||
    message.includes('emitting ticks')
  )
}

function feedOf(coin: string) {
  return kalshiFeedForProduct(coin) ?? KALSHI_COIN_FEEDS[0]
}
