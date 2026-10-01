import { useEffect, useState } from 'react'
import { GripVertical, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { bucketStart } from '../../shared/coinbase'
import type { ConnectionState, DataSource, RandyV8Settings, Timeframe } from '../lib/types'
import type { RandyBar, RandyTone, RandyV8Result } from '../lib/randy-v8'
import { useFloatingWindow } from '../lib/floating-window'
import { formatPrice } from '../lib/market'
import { useLocalState } from '../lib/storage'

const POSITION_KEY = 'randy-panel-pos'

export interface RandyV8WindowProps {
  ticker: string
  source: DataSource
  timeframe: Timeframe
  /** The chart indicator's profile, or the published defaults while there is none. */
  settings: RandyV8Settings
  /** The engine's own result for these candles — the same one the chart lines come from. */
  result: RandyV8Result
  /** Worst state among the 5m / 15m / 1h feeds the engine reads. */
  feedState: ConnectionState
  /** False when the chart has no Randy V8.10 indicator, so the window runs defaults. */
  hasIndicator: boolean
  /** Kalshi’s published strike for the live 15m window, when it is one of its crypto markets. */
  kalshiStrike: number | null
  onAddIndicator: () => void
  /** Writes the typed strike into the chart indicator's profile. */
  onTargetChange: (target: number) => void
  onClose: () => void
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`

const toneClass = (tone: RandyTone) => `is-${tone}`

/**
 * The floating Randy V8.10 panel: the Pine script's corner `table` — Target, contract clock,
 * direction, impulse strength, 1M + 5M alignment, stage, map, reason and the final call — as a
 * draggable window instead of a table pinned to a pane corner.
 *
 * It is a view of `calculateRandyV8`: the same candles, profile and result the chart's lines are
 * built from, so the window and the chart can never disagree. The percentages are a V8 technical
 * estimate, not Kalshi's price and not a statistical probability — the window says so.
 */
export function RandyV8Window({
  ticker,
  source,
  timeframe,
  settings,
  result,
  feedState,
  hasIndicator,
  kalshiStrike,
  onAddIndicator,
  onTargetChange,
  onClose,
}: RandyV8WindowProps) {
  const [minimized, setMinimized] = useLocalState('randy-panel-min', false)
  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(POSITION_KEY, 6)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [draft, setDraft] = useState(settings.target > 0 ? String(settings.target) : '')

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now() / 1000)
    }, 1000)
    return () => clearInterval(id)
  }, [])
  // The profile is the source of truth: an edit made in the settings dialog shows up here.
  useEffect(() => {
    setDraft(settings.target > 0 ? String(settings.target) : '')
  }, [settings.target])

  const bar: RandyBar | null = result.last
  const ready = !!bar?.ready
  const demo = source === 'demo'
  const degraded = !demo && feedState !== 'live'
  const on1m = timeframe === '1m'

  // The countdown ticks on the window's own heartbeat while the newest bar is live.
  const live = bar ? Math.abs(now - (bar.time + 60)) <= 60 : false
  const secondsLeft =
    bar && live
      ? Math.max(Math.trunc(bucketStart(bar.time, '15m') + 900 - now), 0)
      : (bar?.secondsLeft ?? 0)

  const commit = () => {
    const raw = draft.trim()
    const value = raw === '' ? 0 : Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(value) || value < 0) {
      setDraft(settings.target > 0 ? String(settings.target) : '')
      return
    }
    if (value !== settings.target) onTargetChange(value)
  }

  const tone: RandyTone = ready && bar ? bar.decisionTone : 'neutral'
  const dotColor =
    tone === 'up'
      ? 'var(--green)'
      : tone === 'down'
        ? 'var(--red)'
        : tone === 'warn'
          ? '#f59e0b'
          : tone === 'protect'
            ? '#14b8a6'
            : 'var(--muted)'

  const waiting = !ready
    ? result.missingFeeds.length
      ? `${result.missingFeeds.join(' / ')} feed loading…`
      : 'Warming the indicators…'
    : null

  const targetText =
    bar && bar.targetValid
      ? `$${formatPrice(settings.target, false, 2)} | ${bar.distance >= 0 ? '+' : '-'}$${formatPrice(Math.abs(bar.distance), false, 2)}`
      : bar?.targetEntered
        ? 'CHECK TARGET'
        : 'ENTER A TARGET'
  const targetTone: RandyTone =
    bar && bar.targetValid
      ? bar.distance > 0
        ? 'up'
        : bar.distance < 0
          ? 'down'
          : 'warn'
      : 'neutral'

  const rows: { key: string; label: string; value: string; tone: RandyTone; title: string }[] = bar
    ? [
        {
          key: 'time',
          label: 'TIME',
          value: clock(secondsLeft),
          tone: secondsLeft <= settings.sitOutLastSec ? 'warn' : 'neutral',
          title: 'Pine TIEMPO — time left in the 15-minute contract',
        },
        {
          key: 'direction',
          label: 'DIRECTION',
          value: `UP ${bar.dirUpPct}% | DOWN ${bar.dirDownPct}%`,
          tone: bar.dirUpPct >= 60 ? 'up' : bar.dirDownPct >= 60 ? 'down' : 'neutral',
          title:
            'Pine DIRECCION — the SCALP direction score as a 0–100 split. A V8 technical reading, not Kalshi’s price and not a guaranteed probability.',
        },
        {
          key: 'meter',
          label: 'TARGET METER',
          value: bar.targetValid ? `UP ${bar.meterUpPct}% | DOWN ${bar.meterDownPct}%` : '··',
          tone: bar.meterUpPct >= 60 ? 'up' : bar.meterDownPct >= 60 ? 'down' : 'neutral',
          title:
            'Pine upPct / downPct — distance to the Target against the movement left in the time left, blended with the market score. Always sums to 100.',
        },
        {
          key: 'strength',
          label: 'STRENGTH',
          value: `${Math.round(bar.strength)}/100`,
          tone:
            bar.strength >= 75
              ? bar.scalpScore >= 0
                ? 'up'
                : 'down'
              : bar.strength >= 50
                ? 'warn'
                : 'neutral',
          title: 'Pine FUERZA — how violent the impulse is, separate from which way it points',
        },
        {
          key: 'aligned',
          label: '1M + 5M',
          value:
            bar.aligned === 'up'
              ? 'ALIGNED UP'
              : bar.aligned === 'down'
                ? 'ALIGNED DOWN'
                : 'NOT ALIGNED',
          tone: bar.aligned === 'up' ? 'up' : bar.aligned === 'down' ? 'down' : 'warn',
          title:
            'Pine alineadoUP / alineadoDOWN — the 1M and live 5M scores agree with the close vs EMA 9',
        },
        {
          key: 'stage',
          label: 'STAGE',
          value: bar.stageText,
          tone: bar.stageTone,
          title: 'Pine ETAPA — CHARGING → CHARGED → ENTER, with the late and protect states',
        },
        {
          key: 'map',
          label: 'MAP 1H/15M',
          value: bar.mapText,
          tone: bar.mapTone,
          title: 'Pine MAPA 1H/15M — where BTC sits against the big highs and lows',
        },
        {
          key: 'reason',
          label: 'REASON',
          value: bar.reasonText,
          tone: 'neutral',
          title: 'Pine RAZON',
        },
      ]
    : []

  return (
    <section
      ref={boxRef}
      className={`randy-panel${minimized ? ' is-minimized' : ''}${dragging ? ' is-dragging' : ''}${
        degraded ? ' is-degraded' : ''
      }`}
      data-testid="randy-v8-window"
      data-decision={ready && bar ? bar.decision : 'waiting'}
      role="region"
      aria-label="Randy V8.10 window"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="randy-panel-head" onPointerDown={startDrag}>
        <GripVertical size={11} className="randy-panel-grip" aria-hidden="true" />
        <span
          className="randy-panel-dot"
          style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
          aria-hidden="true"
        />
        <span className="randy-panel-title">RANDY V8.10</span>
        {demo ? (
          <span className="randy-panel-tag">SYNTH</span>
        ) : degraded ? (
          <span className="randy-panel-tag">DEGRADED</span>
        ) : on1m ? (
          <span className="randy-panel-tag is-live">1M LIVE</span>
        ) : (
          <span className="randy-panel-tag is-warn" title="V8.10 is tuned for a 1-minute chart">
            USE 1M
          </span>
        )}
        <span className="randy-panel-head-space" />
        {!hasIndicator && (
          <button
            type="button"
            className="randy-panel-button"
            aria-label="Add the Randy V8.10 lines to the chart"
            title="Add Randy V8.10 — then its settings drive this window"
            onClick={onAddIndicator}
          >
            <Plus size={11} />
          </button>
        )}
        {position ? (
          <button
            type="button"
            className="randy-panel-button"
            aria-label="Snap the Randy V8.10 window back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="randy-panel-button"
          aria-label={
            minimized ? 'Expand the Randy V8.10 window' : 'Minimize the Randy V8.10 window'
          }
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="randy-panel-button is-close"
          aria-label="Hide the Randy V8.10 window"
          title="Hide"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div className="randy-panel-min-row">
          <span className={`randy-panel-call ${toneClass(tone)}`}>
            {waiting ? 'WAIT' : bar?.decisionText}
          </span>
          {bar && ready ? (
            <>
              <span className="randy-panel-clock mono">{clock(secondsLeft)}</span>
              <span className="randy-panel-min-odds mono">
                {bar.dirUpPct}/{bar.dirDownPct}
              </span>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <p className="randy-panel-sub">
            {ticker} · {timeframe} chart · a V8 technical estimate, not Kalshi’s price
          </p>

          <div className="randy-panel-target">
            <label htmlFor="randy-target-input">TARGET</label>
            <input
              id="randy-target-input"
              className="mono"
              inputMode="decimal"
              placeholder="Kalshi strike"
              value={draft}
              aria-label="Target Kalshi / to beat"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setDraft(settings.target > 0 ? String(settings.target) : '')
                  event.currentTarget.blur()
                }
              }}
            />
            {kalshiStrike !== null && kalshiStrike !== settings.target ? (
              <button
                type="button"
                className="randy-panel-kalshi"
                title={`Use Kalshi’s published strike for this window ($${formatPrice(kalshiStrike)})`}
                onClick={() => onTargetChange(kalshiStrike)}
              >
                KALSHI
              </button>
            ) : null}
          </div>
          <div
            className={`randy-panel-targetline ${toneClass(targetTone)} mono`}
            title="Pine TARGET"
          >
            {targetText}
          </div>

          {waiting ? (
            <p className="randy-panel-waiting" role="status">
              {waiting}
            </p>
          ) : bar ? (
            <>
              <div
                className={`randy-panel-decision ${toneClass(bar.decisionTone)}`}
                data-testid="randy-v8-decision"
                title="Pine DECISION"
              >
                <strong>{bar.decisionText}</strong>
                <span>{bar.modeText}</span>
              </div>
              <dl className="randy-panel-rows">
                {rows.map((row) => (
                  <div key={row.key} className="randy-panel-row" title={row.title}>
                    <dt>{row.label}</dt>
                    <dd className={`mono ${toneClass(row.tone)}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}
