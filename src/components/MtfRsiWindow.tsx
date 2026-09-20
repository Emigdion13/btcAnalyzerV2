import { useMemo, useRef, useState } from 'react'
import {
  GripVertical,
  Info,
  Minus,
  MoveHorizontal,
  Plus,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import type { ConnectionState } from '../lib/types'
import { useFloatingWindow } from '../lib/floating-window'
import { useLocalState } from '../lib/storage'
import { formatPrice } from '../lib/market'
import {
  analyzeMtfRsi,
  classifyMtfRsi,
  mtfAlignment,
  MTF_RSI_PERIOD,
  MTF_RSI_TIMEFRAMES,
  mtfReadingDetail,
} from '../lib/mtf-rsi'
import type {
  MtfRsiReading,
  MtfRsiTimeframe,
  MtfRsiVerdict,
  MtfTendencyState,
} from '../lib/mtf-rsi'

const POSITION_KEY = 'mtf-rsi-pos'

/** The offline states a row reports instead of pretending its numbers are current. */
const UNFED_STATES = ['offline', 'stale', 'reconnecting']

export interface MtfRsiRowFeed {
  resolution: MtfRsiTimeframe
  candles: CandleList
  state: ConnectionState
  message: string
}

/** Structural candle type — the same shape every feed here ships. */
type CandleList = { time: number; open: number; high: number; low: number; close: number }[]

interface Props {
  ticker: string
  /** One feed per watched resolution, from the same connections the indicators share. */
  rows: MtfRsiRowFeed[]
  /** The toolbar toggle owns visibility, so closing the window is the same choice as the button. */
  onClose: () => void
}

interface RowModel {
  resolution: MtfRsiTimeframe
  reading: MtfRsiReading
  verdict: MtfRsiVerdict | null
  unfed: boolean
  stale: boolean
  message: string
  /** Last price on this timeframe, for the row tooltip. */
  lastPrice: number | null
}

/**
 * The floating multi-timeframe RSI window: one row per watched resolution — 1m through 1h —
 * with that timeframe's RSI, its zone, and the tendency call (bullish, bearish, in range) the
 * classifier behind `lib/mtf-rsi` makes from ADX, the efficiency ratio and the ATR-normalized
 * EMA slope, not from RSI alone.
 *
 * It is a view, not a second opinion: every number is computed from the same candles the MTF
 * indicators and the timeframe peek read. Rows whose feed is down say so instead of dressing a
 * stale reading up as live, and the overall bias line is a weighted summary, with higher
 * timeframes carrying more of the vote.
 */
export function MtfRsiWindow({ ticker, rows, onClose }: Props) {
  const [minimized, setMinimized] = useLocalState('mtf-rsi-min', false)
  const [showInfo, setShowInfo] = useState(false)
  const { boxRef, position, dragging, startDrag, reset } = useFloatingWindow(POSITION_KEY, 6)

  // The tendency state machine is keyed by the feed's fingerprint (bar count + last bar time +
  // last close), so a re-render never double-advances it under StrictMode and a feed that has
  // not changed never nudges the confirmation counter.
  const statesRef = useRef(new Map<MtfRsiTimeframe, { fp: string; state: MtfTendencyState }>())

  const model = useMemo(() => {
    const byResolution = new Map(rows.map((row) => [row.resolution, row]))
    const rowsOut: RowModel[] = []
    const verdicts: Partial<Record<MtfRsiTimeframe, MtfRsiVerdict['tendency'] | null>> = {}
    for (const resolution of MTF_RSI_TIMEFRAMES) {
      const row = byResolution.get(resolution)
      const candles = row?.candles ?? []
      const last = candles.at(-1)
      const fp = `${candles.length}:${last?.time ?? 0}:${last?.close ?? 0}`
      const reading = analyzeMtfRsi(candles)
      let verdict: MtfRsiVerdict | null = null
      if (row) {
        const cached = statesRef.current.get(resolution)
        // Without enough history there is no score, and a missing reading is never called a
        // range — the row says "warming" and the summary waits. Pure in, pure out: the state
        // is persisted only when the feed actually moved, so double renders and unchanged
        // feeds both land on the same confirmed verdict.
        if (reading.score !== null) {
          const next = classifyMtfRsi(reading, cached?.state ?? null)
          if (!cached || cached.fp !== fp)
            statesRef.current.set(resolution, { fp, state: next.state })
          verdict = next.verdict
          verdicts[resolution] = verdict.tendency
        }
      }
      rowsOut.push({
        resolution,
        reading,
        verdict,
        unfed: !row || (!candles.length && UNFED_STATES.includes(row.state)),
        stale: !!row && row.state !== 'live',
        message: row?.message ?? '',
        lastPrice: last?.close ?? null,
      })
    }
    return { rows: rowsOut, alignment: mtfAlignment(verdicts) }
  }, [rows])

  const { alignment } = model
  const unfedCount = model.rows.filter((row) => row.unfed).length
  const everyRowLive = model.rows.every((row) => !row.stale)
  const dotColor =
    alignment.bias === 'bullish'
      ? 'var(--green)'
      : alignment.bias === 'bearish'
        ? 'var(--red)'
        : 'var(--muted)'

  return (
    <section
      ref={boxRef}
      className={`mtf-rsi-window${minimized ? ' is-minimized' : ''}${dragging ? ' is-dragging' : ''}${
        everyRowLive ? '' : ' is-degraded'
      }`}
      data-testid="mtf-rsi-window"
      data-bias={alignment.bias}
      role="region"
      aria-label="Multi-timeframe RSI window"
      style={
        position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined
      }
    >
      <header className="mtf-rsi-head" onPointerDown={startDrag}>
        <GripVertical size={11} className="mtf-rsi-grip" aria-hidden="true" />
        <span
          className="mtf-rsi-dot"
          style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
          aria-hidden="true"
        />
        <span className="mtf-rsi-title">MTF RSI</span>
        {everyRowLive ? (
          <span className="mtf-rsi-tag is-live">LIVE</span>
        ) : (
          <span className="mtf-rsi-tag">DEGRADED</span>
        )}
        <span className="mtf-rsi-head-space" />
        {position ? (
          <button
            type="button"
            className="mtf-rsi-button"
            aria-label="Snap the MTF RSI window back to its docked spot"
            title="Reset position"
            onClick={reset}
          >
            <RotateCcw size={10} />
          </button>
        ) : null}
        <button
          type="button"
          className="mtf-rsi-button"
          aria-label={minimized ? 'Expand the MTF RSI window' : 'Minimize the MTF RSI window'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized(!minimized)}
        >
          {minimized ? <Plus size={11} /> : <Minus size={11} />}
        </button>
        <button
          type="button"
          className="mtf-rsi-button is-close"
          aria-label="Hide the MTF RSI window"
          title="Hide"
          onClick={onClose}
        >
          <X size={11} />
        </button>
      </header>

      {minimized ? (
        <div className="mtf-rsi-min-row">
          <span className={`mtf-rsi-bias is-${alignment.bias}`}>
            <TendencyIcon
              tendency={
                alignment.bias === 'bearish'
                  ? 'bearish'
                  : alignment.bias === 'bullish'
                    ? 'bullish'
                    : 'range'
              }
            />
            {alignment.bias === 'unavailable' ? 'NO DATA' : alignment.bias.toUpperCase()}
          </span>
          <span className="mtf-rsi-min-trend mono">
            {alignment.trending}/{MTF_RSI_TIMEFRAMES.length} trending
          </span>
        </div>
      ) : (
        <>
          <p className="mtf-rsi-sub">
            {ticker} · RSI {MTF_RSI_PERIOD} per timeframe · tendency from ADX + efficiency + slope
          </p>
          <div className="mtf-rsi-rows" role="table" aria-label="RSI and tendency per timeframe">
            {model.rows.map((row) => (
              <MtfRsiRow key={row.resolution} row={row} />
            ))}
          </div>
          <footer className="mtf-rsi-foot">
            <span
              className={`mtf-rsi-bias is-${alignment.bias}`}
              title="Higher timeframes carry more of the vote; ranges abstain"
            >
              {alignment.bias === 'unavailable' ? (
                '—'
              ) : (
                <TendencyIcon tendency={alignment.bias === 'mixed' ? 'range' : alignment.bias} />
              )}
              {alignment.bias === 'unavailable'
                ? 'NO DATA'
                : alignment.bias === 'mixed'
                  ? 'MIXED'
                  : alignment.bias.toUpperCase()}
            </span>
            <span className="mtf-rsi-align mono" title="Timeframes with a confirmed tendency">
              {alignment.trending}/{MTF_RSI_TIMEFRAMES.length} trending
            </span>
            {unfedCount ? (
              <span className="mtf-rsi-unfed" title={`${unfedCount} feed(s) unavailable`}>
                {unfedCount} unfed
              </span>
            ) : null}
            <button
              type="button"
              className={`mtf-rsi-chip${showInfo ? ' is-on' : ''}`}
              aria-label="How the tendency is determined"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((open) => !open)}
            >
              <Info size={10} />
            </button>
          </footer>
          {showInfo ? (
            <p className="mtf-rsi-note">
              Each row's RSI is the classic Wilder {MTF_RSI_PERIOD} over that timeframe's closes,
              forming bar included. The tendency is not read off RSI alone: a 0–100 trend-quality
              score fuses Wilder ADX(14) (45%), Kaufman's efficiency ratio over 20 closes (35%) and
              the EMA(20) slope in ATR(14) units (20%). Score ≥ 55 is a trend, &lt; 45 a range, and
              in between the previous call stands — hysteresis, so a trend must decay before the
              window calls a range. Inside a trend the direction is a 2-of-3 vote: +DI vs −DI, the
              slope's sign, and RSI outside the 45–55 no-man's land. The label only moves after two
              consecutive disagreeing readings, so one loud bar cannot repaint it. The overall bias
              weights the 1h five times the 1m; ranges abstain.
              {unfedCount ? ` ${unfedCount} timeframe feed(s) are unavailable right now.` : ''}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

function TendencyIcon({ tendency }: { tendency: 'bullish' | 'bearish' | 'range' }) {
  if (tendency === 'bullish') return <TrendingUp size={11} aria-hidden="true" />
  if (tendency === 'bearish') return <TrendingDown size={11} aria-hidden="true" />
  return <MoveHorizontal size={11} aria-hidden="true" />
}

function MtfRsiRow({ row }: { row: RowModel }) {
  const { reading, verdict, resolution, unfed, stale, message } = row
  const tending = verdict?.tendency ?? null
  const detail = verdict ? mtfReadingDetail(reading, verdict) : 'Not enough history yet'
  const title = [
    `${resolution} — ${detail}`,
    row.lastPrice !== null ? `last ${formatPrice(row.lastPrice)}` : null,
    stale && message ? `feed ${message}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={`mtf-rsi-row is-${tending ?? 'none'}${unfed ? ' is-unfed' : ''}${stale && !unfed ? ' is-stale' : ''}`}
      role="row"
      title={title}
    >
      <span className="mtf-rsi-tf mono">{resolution}</span>
      <span className="mtf-rsi-value mono">
        {unfed ? '—' : reading.rsi !== null ? reading.rsi.toFixed(1) : '··'}
      </span>
      <span className="mtf-rsi-gauge" aria-hidden="true">
        <span className="mtf-rsi-gauge-track">
          <span className="mtf-rsi-gauge-mid" />
          <i
            style={{
              left: `${reading.rsi === null ? 50 : Math.min(100, Math.max(0, reading.rsi))}%`,
            }}
          />
        </span>
      </span>
      <span className={`mtf-rsi-tendency is-${tending ?? 'none'}`}>
        {unfed ? (
          'no data'
        ) : tending ? (
          <>
            <TendencyIcon tendency={tending} />
            {tending === 'range' ? 'RANGE' : tending.toUpperCase()}
          </>
        ) : (
          'warming'
        )}
      </span>
      <span
        className={`mtf-rsi-strength is-${verdict?.strength ?? 'weak'}`}
        title={
          reading.score !== null
            ? `Trend quality ${reading.score.toFixed(0)}/100`
            : 'Trend quality unavailable'
        }
        aria-hidden="true"
      >
        <i
          style={{
            width: `${reading.score === null ? 0 : Math.min(100, Math.max(0, reading.score))}%`,
          }}
        />
      </span>
    </div>
  )
}
