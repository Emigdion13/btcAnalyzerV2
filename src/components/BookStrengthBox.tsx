import { useState } from 'react'
import { BookOpenText, Info, RotateCcw, X } from 'lucide-react'
import type { OrderBookView } from '../../shared/coinbase'
import { formatNotional } from '../../shared/whale-flow'
import { LEVEL_HOLD_RATES } from '../lib/level-strength'
import type { BookRead, LevelTouchStats, TouchTally } from '../lib/level-touch-journal'
import { formatPrice } from '../lib/market'
import type { Timeframe } from '../lib/types'

const clockTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

function WallList({
  walls,
  side,
}: {
  walls: OrderBookView['supports']
  side: 'support' | 'resistance'
}) {
  if (!walls.length)
    return (
      <p className="book-wall-empty">
        {side === 'support'
          ? 'No outstanding bid wall below price.'
          : 'No outstanding ask wall above price.'}
      </p>
    )
  const color = side === 'support' ? '#2ebd85' : '#f6465d'
  return (
    <ul className={`book-walls ${side === 'support' ? 'is-support' : 'is-resistance'}`}>
      {walls.map((wall) => (
        <li
          key={`${wall.side}:${wall.price}`}
          title={`Resting persistence ${Math.round(wall.persistence * 100)}%`}
        >
          <span className="book-wall-price" style={{ color }}>
            {formatPrice(wall.price)}
          </span>
          <span className="book-wall-size">{formatNotional(wall.notional)}</span>
          <span className="book-wall-depth">front {formatNotional(wall.depth)}</span>
        </li>
      ))}
    </ul>
  )
}

const BOOK_READ_LABEL: Record<BookRead, string> = {
  strong: 'Strong',
  medium: 'Medium',
  weak: 'Weak',
  none: 'Nothing',
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`

function TallyCell({ tally }: { tally: TouchTally }) {
  if (!tally.tests) return <td className="book-tests-empty">—</td>
  return (
    <td title={`${tally.held} held of ${tally.tests} tests`}>
      {tally.held}/{tally.tests}{' '}
      <span className="book-tests-rate">{percent(tally.held / tally.tests)}</span>
    </td>
  )
}

/**
 * The live level-touch journal for this chart: how often tested prices held, split by the
 * resting book behind them, for chart levels and for random control prices.
 */
function LevelTests({
  stats,
  timeframe,
  onReset,
}: {
  stats: LevelTouchStats
  timeframe: Timeframe
  onReset: () => void
}) {
  const baseline = LEVEL_HOLD_RATES[timeframe]
  return (
    <div className="book-tests" data-testid="book-level-tests">
      <h3 className="book-box-column-title book-tests-title">
        Level tests · {timeframe}
        <button
          type="button"
          className="book-tests-reset"
          aria-label="Reset the level-test journal"
          title="Reset the level-test journal"
          onClick={onReset}
        >
          <RotateCcw size={9} />
        </button>
      </h3>
      <table className="book-tests-table">
        <thead>
          <tr>
            <th scope="col">Book behind price</th>
            <th scope="col">Levels</th>
            <th scope="col">Random</th>
          </tr>
        </thead>
        <tbody>
          {stats.rows.map((row) => (
            <tr key={row.book}>
              <th scope="row">{BOOK_READ_LABEL[row.book]}</th>
              <TallyCell tally={row.levels} />
              <TallyCell tally={row.random} />
            </tr>
          ))}
          <tr className="book-tests-total">
            <th scope="row">All</th>
            <TallyCell tally={stats.levels} />
            <TallyCell tally={stats.random} />
          </tr>
        </tbody>
      </table>
      <p className="book-tests-note">
        Held = price went 1 ATR back away before 1 ATR through. Without the book, the backtest had{' '}
        {timeframe} pivots at {percent(baseline.pivot.rate)} and random prices at{' '}
        {percent(baseline.random.rate)}. A row means little under ~100 tests
        {stats.open ? ` · ${stats.open} open` : ''}.
      </p>
    </div>
  )
}

/**
 * Persistent readout of the charted product's resting order book: the S/R walls the book itself
 * is constructing (with USD size and the liquidity in front of each) and the near-mid imbalance.
 *
 * Refreshes at the 1 Hz SSE cadence while the feed is live. It shows resting orders — size that
 * can be pulled or walked at any moment — not a commitment or a trade signal.
 */
export function BookStrengthBox({
  book,
  onClose,
  levelTests,
}: {
  book: OrderBookView
  onClose: () => void
  levelTests?: { stats: LevelTouchStats; timeframe: Timeframe; onReset: () => void }
}) {
  const [showInfo, setShowInfo] = useState(false)
  const imbalance = book.imbalance
  const bidShare = 50 + imbalance * 50 // 0..100, >50 = bids dominate
  const positive = imbalance >= 0
  return (
    <section className="book-box" data-testid="book-box">
      <header className="book-box-head">
        <BookOpenText size={12} className="book-box-icon" aria-hidden="true" />
        <h2>Book · {book.product}</h2>
        <button
          type="button"
          className={`book-box-info ${showInfo ? 'is-active' : ''}`}
          aria-label="About the order book readout"
          title="About this readout"
          onClick={() => setShowInfo((open) => !open)}
        >
          <Info size={11} />
        </button>
        <button
          type="button"
          className="book-box-close"
          aria-label="Hide book depth & strength"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </header>
      {showInfo && (
        <p className="book-box-info-note">
          Resting USD from the Coinbase level2 book, refreshed live. Walls are clusters that stand
          out from the book’s own depth; size can be pulled or walked at any moment.
        </p>
      )}
      <div className="book-box-stats">
        <div className="book-box-stat">
          <span className="book-box-label">MID</span>
          <span className="book-box-value">{formatPrice(book.mid)}</span>
        </div>
        <div className="book-box-stat">
          <span className="book-box-label">SPREAD</span>
          <span className="book-box-value">{formatPrice(book.spread)}</span>
        </div>
        <div className="book-box-stat">
          <span className="book-box-label">BIDS</span>
          <span className="book-box-value">{formatNotional(book.bidsTotal)}</span>
        </div>
        <div className="book-box-stat">
          <span className="book-box-label">ASKS</span>
          <span className="book-box-value">{formatNotional(book.asksTotal)}</span>
        </div>
      </div>
      <div
        className="book-box-imbalance"
        aria-label={`Near-mid imbalance ${Math.round(imbalance * 100)}% ${positive ? 'bid-heavy' : 'ask-heavy'}`}
      >
        <div className="book-box-imbalance-track">
          <div
            className={`book-box-imbalance-fill ${positive ? 'is-bid' : 'is-ask'}`}
            style={{ width: `${Math.min(100, Math.max(0, bidShare))}%` }}
          />
        </div>
        <span className="book-box-imbalance-label">
          {positive ? 'bids heavy' : 'asks heavy'} {Math.abs(Math.round(imbalance * 100))}%
        </span>
      </div>
      <div className="book-box-columns">
        <div className="book-box-column">
          <h3 className="book-box-column-title">Resistance</h3>
          <WallList walls={book.resistances} side="resistance" />
        </div>
        <div className="book-box-column">
          <h3 className="book-box-column-title">Support</h3>
          <WallList walls={book.supports} side="support" />
        </div>
      </div>
      {levelTests && <LevelTests {...levelTests} />}
      <footer className="book-box-foot">
        resting persistence {Math.round(book.persistenceSeconds)}s · {clockTime(book.asOf)}
      </footer>
    </section>
  )
}
