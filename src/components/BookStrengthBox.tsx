import { useState } from 'react'
import { BookOpenText, Info, X } from 'lucide-react'
import type { OrderBookView } from '../../shared/coinbase'
import { formatNotional } from '../../shared/whale-flow'
import { formatPrice } from '../lib/market'

const clockTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

function WallList({ walls, side }: { walls: OrderBookView['supports']; side: 'support' | 'resistance' }) {
  if (!walls.length)
    return (
      <p className="book-wall-empty">
        {side === 'support' ? 'No outstanding bid wall below price.' : 'No outstanding ask wall above price.'}
      </p>
    )
  const color = side === 'support' ? '#2ebd85' : '#f6465d'
  return (
    <ul className={`book-walls ${side === 'support' ? 'is-support' : 'is-resistance'}`}>
      {walls.map((wall) => (
        <li key={`${wall.side}:${wall.price}`} title={`Resting persistence ${Math.round(wall.persistence * 100)}%`}>
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

/**
 * Persistent readout of the charted product's resting order book: the S/R walls the book itself
 * is constructing (with USD size and the liquidity in front of each) and the near-mid imbalance.
 *
 * Refreshes at the 1 Hz SSE cadence while the feed is live. It shows resting orders — size that
 * can be pulled or walked at any moment — not a commitment or a trade signal.
 */
export function BookStrengthBox({
  book,
  synthetic,
  onClose,
}: {
  book: OrderBookView
  synthetic: boolean
  onClose: () => void
}) {
  const [showInfo, setShowInfo] = useState(false)
  const imbalance = book.imbalance
  const bidShare = 50 + imbalance * 50 // 0..100, >50 = bids dominate
  const positive = imbalance >= 0
  return (
    <section className={`book-box ${synthetic ? 'is-synthetic' : ''}`} data-testid="book-box">
      <header className="book-box-head">
        <BookOpenText size={12} className="book-box-icon" aria-hidden="true" />
        <h2>Book · {book.product}</h2>
        {synthetic && <span className="book-box-synthetic">DEMO BOOK</span>}
        <button
          type="button"
          className={`book-box-info ${showInfo ? 'is-active' : ''}`}
          aria-label="About the order book readout"
          title="About this readout"
          onClick={() => setShowInfo((open) => !open)}
        >
          <Info size={11} />
        </button>
        <button type="button" className="book-box-close" aria-label="Hide book depth & strength" onClick={onClose}>
          <X size={12} />
        </button>
      </header>
      {showInfo && (
        <p className="book-box-info-note">
          Resting USD from the Coinbase level2 book, refreshed live. {synthetic
            ? 'This is a labeled synthetic book for demo mode — not exchange data.'
            : 'Walls are clusters that stand out from the book’s own depth; size can be pulled or walked at any moment.'}
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
      <div className="book-box-imbalance" aria-label={`Near-mid imbalance ${Math.round(imbalance * 100)}% ${positive ? 'bid-heavy' : 'ask-heavy'}`}>
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
      <footer className="book-box-foot">
        resting persistence {Math.round(book.persistenceSeconds)}s · {clockTime(book.asOf)}
      </footer>
    </section>
  )
}
