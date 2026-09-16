import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, GripVertical, Minus, Plus, Radar, X } from 'lucide-react'
import {
  INTERVAL_SECONDS,
  type BarTape,
  type ConnectionState,
  type DataSource,
  type OrderBookView,
} from '../../shared/coinbase'
import { analyzeBarPulse, LEVEL_ATR_HORIZON } from '../lib/bar-pulse'
import type { LevelSource, LevelZone } from '../lib/bar-pulse'
import { useFloatingWindow } from '../lib/floating-window'
import { compactNumber, formatPrice, TIMEFRAMES } from '../lib/market'
import type { Candle, Timeframe } from '../lib/types'

const POSITION_KEY = 'candle-pulse-pos'

const SOURCE_LABELS: Record<LevelSource, string> = {
  swing: 'PIVOT',
  'prior-day': 'PRIOR DAY',
  book: 'BOOK',
}

interface Props {
  ticker: string
  source: DataSource
  state: ConnectionState
  candles: Candle[]
  interval: Timeframe
  chartTimeframe?: Timeframe
  selectedInterval?: string
  onIntervalChange?: (interval: string) => void
  price: number
  book: OrderBookView | null
  tape: BarTape | null
  upColor: string
  downColor: string
  onClose: () => void
}

/**
 * Candle Pulse — the live read on the single bar being built, styled as a cockpit HUD.
 *
 * It is context, not a signal: the tilt gauge says which way the evidence currently points
 * (levels, tape, bar momentum, range position) and the base rate says what those situations
 * have historically done. The forming bar is provisional, so the readout dims when the feed is
 * not live and says "SYNTH" when it is running on offline demo data.
 */
export function BarPulseBox({
  ticker,
  source,
  state,
  candles,
  interval,
  chartTimeframe,
  selectedInterval,
  onIntervalChange,
  price,
  book,
  tape,
  upColor,
  downColor,
  onClose,
}: Props) {
  const [localInterval, setLocalInterval] = useState(selectedInterval ?? 'chart')
  const currentSelection = selectedInterval ?? localInterval
  const [minimized, setMinimized] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const win = useFloatingWindow(POSITION_KEY, 8)

  // Keep local selection in sync if controlled from parent
  useEffect(() => {
    if (selectedInterval) setLocalInterval(selectedInterval)
  }, [selectedInterval])

  // The countdown and clock need their own heartbeat; the candles arrive on the feed's cadence.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [])

  // Demo bars are anchored to a fixed past date, but the app still treats the last one as the
  // live bar (it re-ticks it). Align its bucket to the real current one so the countdown, the
  // clock, and the pace all behave like a live feed. On Coinbase the bar's own time is authoritative.
  const effectiveCandles = useMemo(() => {
    if (source !== 'demo' || !candles.length) return candles
    const last = candles[candles.length - 1]
    const seconds = INTERVAL_SECONDS[interval]
    const bucket = Math.floor(now / seconds) * seconds
    const formingClose = Number.isFinite(price) && price > 0 ? price : last.close
    return [
      ...candles.slice(0, -1),
      {
        ...last,
        time: bucket,
        close: formingClose,
        high: Math.max(last.high, formingClose),
        low: Math.min(last.low, formingClose),
      },
    ]
  }, [source, candles, interval, now, price])

  const read = useMemo(
    () => analyzeBarPulse({ candles: effectiveCandles, interval, now, price, book, tape }),
    [effectiveCandles, interval, now, price, book, tape],
  )

  const { clock, shape, pace, tilt } = read
  const live = state === 'live'
  const dotClass =
    source === 'demo' ? 'is-demo' : live ? 'is-live' : state === 'paused' ? 'is-paused' : 'is-stale'
  const tiltClass = tilt.score >= 12 ? 'tilt-up' : tilt.score <= -12 ? 'tilt-down' : 'tilt-neutral'
  const tapeNet = tape ? tape.bought - tape.sold : 0
  const tapeTotal = tape ? tape.bought + tape.sold : 0

  return (
    <section
      ref={win.boxRef}
      className={`pulse-box ${tiltClass} ${minimized ? 'is-min' : ''} ${win.dragging ? 'is-dragging' : ''} ${
        live || source === 'demo' ? '' : 'is-offline'
      }`}
      role="region"
      aria-label="Candle pulse — live bar analysis"
      style={
        {
          ...(win.position
            ? { left: `${win.position.x}px`, top: `${win.position.y}px`, bottom: 'auto' }
            : undefined),
          '--pulse-up': upColor,
          '--pulse-down': downColor,
        } as React.CSSProperties
      }
    >
      <div className="pulse-scanline" aria-hidden="true" />
      <span className="pulse-corner pulse-corner-tl" aria-hidden="true" />
      <span className="pulse-corner pulse-corner-tr" aria-hidden="true" />
      <span className="pulse-corner pulse-corner-bl" aria-hidden="true" />
      <span className="pulse-corner pulse-corner-br" aria-hidden="true" />

      <div className="pulse-head" onPointerDown={win.startDrag}>
        <GripVertical size={10} className="pulse-grip" aria-hidden="true" />
        <span className={`pulse-dot ${dotClass}`} aria-hidden="true" />
        <Radar size={11} className="pulse-radar" aria-hidden="true" />
        <span className="pulse-title">
          CANDLE PULSE <span className="pulse-sub">{ticker}</span>
        </span>
        <label
          className="pulse-picker"
          title="Select candle timeframe to analyze"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <select
            aria-label="Candle timeframe to analyze"
            value={currentSelection}
            onChange={(e) => {
              const val = e.target.value
              setLocalInterval(val)
              onIntervalChange?.(val)
            }}
          >
            <option value="chart">
              Chart{chartTimeframe ? ` (${chartTimeframe})` : ''}
            </option>
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
          <ChevronDown size={9} aria-hidden="true" />
        </label>
        <span className="pulse-head-actions">
          <button
            type="button"
            className="pulse-btn"
            title={minimized ? 'Expand Candle Pulse' : 'Minimize Candle Pulse'}
            aria-label={minimized ? 'Expand Candle Pulse' : 'Minimize Candle Pulse'}
            onClick={() => setMinimized((m) => !m)}
          >
            {minimized ? <Plus size={11} /> : <Minus size={11} />}
          </button>
          <button
            type="button"
            className="pulse-btn"
            title="Close Candle Pulse (Alt C)"
            aria-label="Close Candle Pulse"
            onClick={onClose}
          >
            <X size={11} />
          </button>
        </span>
      </div>

      {minimized ? (
        <div className="pulse-min">
          <span className={`pulse-min-price ${shape.lean === 'down' ? 'is-down' : ''}`}>
            {formatPrice(price)}
          </span>
          <span className="pulse-min-tilt">{read.ready ? tilt.label : 'WARMING UP'}</span>
          <span className="pulse-min-clock">{clock.clockLabel}</span>
        </div>
      ) : !read.ready ? (
        <div className="pulse-warm">
          <span className="pulse-cap">CALIBRATING</span>
          <p>{read.reason ?? 'Not enough history yet.'}</p>
        </div>
      ) : (
        <div className="pulse-body">
          {/* ── Bar clock ─────────────────────────────────────────────── */}
          <section className="pulse-clock" aria-label="Time until this bar closes">
            <div className="pulse-clock-meta">
              <span className="pulse-cap">BAR CLOSES IN · {interval.toUpperCase()}</span>
              <span className="pulse-clock-time">{clock.clockLabel}</span>
            </div>
            <div className="pulse-clock-track">
              <i style={{ width: `${clock.progress * 100}%` }} />
            </div>
          </section>

          {/* ── Price + bar anatomy ───────────────────────────────────── */}
          <section className="pulse-price" aria-label="Current bar">
            <span className={`pulse-price-value ${shape.lean === 'down' ? 'is-down' : 'is-up'}`}>
              {formatPrice(price)}
            </span>
            <div className="pulse-ohlc">
              <span>
                O <b>{formatPrice(shape.open)}</b>
              </span>
              <span>
                H <b>{formatPrice(shape.high)}</b>
              </span>
              <span>
                L <b>{formatPrice(shape.low)}</b>
              </span>
              <span>
                C <b>{formatPrice(shape.close)}</b>
              </span>
            </div>
            <div className="pulse-range" title="Where the close sits inside this bar's range">
              <div className="pulse-range-track">
                <i
                  className={`pulse-range-fill ${shape.lean === 'down' ? 'is-down' : ''}`}
                  style={{ height: `${shape.closePosition * 100}%` }}
                />
                <b
                  className="pulse-range-open"
                  style={{ bottom: `${((shape.open - shape.low) / (shape.range || 1)) * 100}%` }}
                />
              </div>
              <div className="pulse-range-meta">
                <span className="pulse-cap">IN RANGE</span>
                <span className="pulse-range-pct">{Math.round(shape.closePosition * 100)}%</span>
                <span className="pulse-range-body">BODY {Math.round(shape.bodyRatio * 100)}%</span>
              </div>
            </div>
          </section>

          {/* ── Volume pace ───────────────────────────────────────────── */}
          <section className="pulse-pace" aria-label="Volume pace">
            <div className="pulse-sec-head">
              <span className="pulse-cap">VOLUME PACE</span>
              <b
                className={`pulse-pace-ratio ${
                  pace.paceRatio == null
                    ? ''
                    : pace.paceRatio >= 1.25
                      ? 'is-hot'
                      : pace.paceRatio < 0.75
                        ? 'is-cold'
                        : ''
                }`}
              >
                {pace.paceRatio == null
                  ? 'TRACKING'
                  : `${pace.paceRatio >= 10 ? pace.paceRatio.toFixed(0) : pace.paceRatio.toFixed(2)}×`}
              </b>
            </div>
            <div className="pulse-pace-track">
              <i
                className={pace.paceRatio != null && pace.paceRatio >= 1.25 ? 'is-hot' : ''}
                style={{
                  width: `${Math.min(100, (pace.soFar / (pace.medianBar || 1)) * 100)}%`,
                }}
              />
              {pace.projectedTotal != null && (
                <b
                  className="pulse-pace-projected"
                  title="Projected total if the current pace holds to the close"
                  style={{ left: `calc(${Math.min(100, (pace.projectedTotal / (pace.medianBar || 1)) * 100)}% - 1px)` }}
                />
              )}
            </div>
            <div className="pulse-pace-foot">
              <span>{compactNumber(pace.soFar)} SO FAR</span>
              <span>
                {pace.projectedVsMedian != null
                  ? `${pace.projectedVsMedian >= 0 ? '+' : '−'}${Math.abs(
                      Math.round(pace.projectedVsMedian * 100),
                    )}% VS MEDIAN BAR`
                  : `MEDIAN BAR ${compactNumber(pace.medianBar)}`}
              </span>
            </div>
          </section>

          {/* ── Bar tape ──────────────────────────────────────────────── */}
          <section className="pulse-tape" aria-label="Taker tape inside this bar">
            <div className="pulse-sec-head">
              <span className="pulse-cap">TAPE · THIS BAR</span>
              {tape && (
                <b className={tapeNet >= 0 ? 'pulse-tape-net is-up' : 'pulse-tape-net is-down'}>
                  {tapeNet >= 0 ? '+' : '−'}
                  {compactNumber(Math.abs(tapeNet))}
                </b>
              )}
            </div>
            {tape ? (
              <>
                <div className="pulse-tape-bar">
                  <i
                    className="is-up"
                    style={{ width: `${tapeTotal ? (tape.bought / tapeTotal) * 100 : 0}%` }}
                  />
                  <i
                    className="is-down"
                    style={{ width: `${tapeTotal ? (tape.sold / tapeTotal) * 100 : 0}%` }}
                  />
                </div>
                <div className="pulse-tape-split">
                  <span className="is-up">▲ {compactNumber(tape.bought)}</span>
                  <span className="is-down">▼ {compactNumber(tape.sold)}</span>
                </div>
              </>
            ) : (
              <span className="pulse-none">
                {source === 'demo' ? 'NO TAPE IN OFFLINE DEMO' : 'AWAITING TAPE DATA…'}
              </span>
            )}
          </section>

          {/* ── Defense grid ──────────────────────────────────────────── */}
          <section className="pulse-levels" aria-label="Nearest support and resistance">
            <div className="pulse-sec-head">
              <span className="pulse-cap">DEFENSE GRID</span>
              <span className="pulse-cap-dim">NEAREST S/R</span>
            </div>
            {[...read.levels.resistance.slice(0, 2), ...read.levels.support.slice(0, 2)].length ===
            0 ? (
              <span className="pulse-none">NO LEVELS IN RANGE</span>
            ) : (
              <div className="pulse-levels-rows">
                {read.levels.resistance.slice(0, 2).map((zone) => (
                  <LevelRow key={`r-${zone.side}-${Math.round(zone.price * 100)}`} zone={zone} />
                ))}
                {read.levels.support.slice(0, 2).map((zone) => (
                  <LevelRow key={`s-${zone.side}-${Math.round(zone.price * 100)}`} zone={zone} />
                ))}
              </div>
            )}
          </section>

          {/* ── Tilt gauge ────────────────────────────────────────────── */}
          <section className={`pulse-tilt ${tiltClass}`} aria-label="Bar tilt">
            <div className="pulse-sec-head">
              <span className="pulse-cap">BAR TILT</span>
              <b className={`pulse-tilt-label ${tiltClass}`}>{tilt.label}</b>
            </div>
            <div className="pulse-tilt-track">
              <div
                className={`pulse-tilt-fill ${tilt.score >= 0 ? 'is-up' : 'is-down'}`}
                style={
                  tilt.score >= 0
                    ? { left: '50%', width: `${(tilt.score / 100) * 50}%` }
                    : { right: '50%', width: `${(-tilt.score / 100) * 50}%` }
                }
              />
              <div className="pulse-tilt-center" />
              <div
                className="pulse-tilt-needle"
                style={{ left: `${50 + tilt.score / 2}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="pulse-tilt-scale">
              <span>SELL SIDE</span>
              <span>0</span>
              <span>BUY SIDE</span>
            </div>
            <ul className="pulse-factors">
              {tilt.factors.map((f) => (
                <li
                  key={f.id}
                  title={`${f.label}: ${f.value >= 0 ? '+' : ''}${f.value.toFixed(1)} on a ${
                    f.weight
                  }-point scale`}
                >
                  <span className="pulse-factor-label">{f.label}</span>
                  <i
                    className={`pulse-factor-bar ${f.value >= 0 ? 'is-up' : 'is-down'}`}
                    style={{ width: `${(Math.abs(f.value) / f.weight) * 100}%` }}
                  />
                  <b className={`pulse-factor-value ${f.value >= 0 ? 'is-up' : 'is-down'}`}>
                    {f.value >= 0 ? '+' : ''}
                    {f.value.toFixed(1)}
                  </b>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Base rate + honesty line ──────────────────────────────── */}
          <footer className="pulse-foot">
            {read.baseRate ? (
              <span>
                {Math.round(read.baseRate.upShare * 100)}% OF LAST {read.baseRate.bars} BARS CLOSED
                UP
              </span>
            ) : (
              <span>COLLECTING HISTORY…</span>
            )}
            <span className="pulse-disclaimer">CONTEXT — NOT A SIGNAL</span>
          </footer>
        </div>
      )}
    </section>
  )
}

function LevelRow({ zone }: { zone: LevelZone }) {
  const reach = Math.min(100, (zone.distanceAtr / LEVEL_ATR_HORIZON) * 100)
  return (
    <div className={`pulse-level is-${zone.side}`}>
      <div className="pulse-level-row">
        <span className="pulse-level-tag">{zone.side === 'resistance' ? 'RES' : 'SUP'}</span>
        <span className="pulse-level-price">{formatPrice(zone.price)}</span>
        {zone.holdStats && (
          <span className="pulse-level-hold" title="Recent approaches that closed back on the far side of the level">
            {zone.holdStats.held}/{zone.holdStats.approaches} HELD
          </span>
        )}
        <span
          className="pulse-level-score"
          title="Defense score: confluence of sources, repeated touches, resting book, proximity"
        >
          {zone.score}
        </span>
      </div>
      <div className="pulse-level-row">
        <div className="pulse-level-ruler">
          <i style={{ width: `${reach}%` }} />
          <b style={{ left: `calc(${reach}% - 3px)` }} />
        </div>
        <span className="pulse-level-src">
          {zone.sources.map((s) => SOURCE_LABELS[s]).join(' · ')} · {Math.round(zone.distanceBps)}{' '}
          bps
        </span>
      </div>
    </div>
  )
}
