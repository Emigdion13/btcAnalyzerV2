import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellPlus,
  Check,
  ChevronDown,
  Download,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import type { Asset, PriceAlert, MarketQuote, DataSource, ConnectionState } from '../lib/types'
import {
  ASSETS,
  formatPrice,
  getAsset,
  compactNumber,
  quoteCurrency,
  formatChange,
  changeClass,
} from '../lib/market'
import { downloadFile, useLocalState } from '../lib/storage'
import { CoinIcon, Dropdown, EmptyState, IconButton, MenuItem, Toggle } from './ui'

interface WatchlistProps {
  symbols: string[]
  selected: Asset
  quotes: Record<string, MarketQuote>
  source: DataSource
  feedState: ConnectionState
  onSelect: (symbol: string) => void
  onAdd: () => void
  onToggleWatchlist: (symbol: string) => void
  onAlert: () => void
  onClose: () => void
  onMarkets: () => void
}
export function Watchlist({
  symbols,
  selected,
  quotes,
  source,
  feedState,
  onSelect,
  onAdd,
  onToggleWatchlist,
  onAlert,
  onClose,
  onMarkets,
}: WatchlistProps) {
  const [group, setGroup] = useLocalState('watchlist-group', 'All assets')
  const [sort, setSort] = useState<{
    key: 'price' | 'change' | 'symbol'
    direction: number
  } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState('')
  const listed = useMemo(() => {
    const list = symbols
      .map(getAsset)
      .filter(
        (a) =>
          (group === 'All assets' || a.category === group) &&
          `${a.symbol} ${a.name}`.toLowerCase().includes(query.toLowerCase()),
      )
    if (sort)
      list.sort((a, b) => {
        if (sort.key === 'symbol') return a.symbol.localeCompare(b.symbol) * sort.direction
        const av = quotes[a.symbol]?.[sort.key],
          bv = quotes[b.symbol]?.[sort.key]
        if (av == null) return bv == null ? 0 : 1
        if (bv == null) return -1
        return (av - bv) * sort.direction
      })
    return list
  }, [symbols, group, sort, query, quotes])
  const toggleSort = (key: 'price' | 'change' | 'symbol') =>
    setSort((previous) => ({
      key,
      direction: previous?.key === key ? -previous.direction : key === 'symbol' ? 1 : -1,
    }))
  const quote = quotes[selected.symbol],
    price = quote?.price,
    low = quote?.low,
    high = quote?.high,
    open = quote?.open,
    change = quote?.change
  const currency = quoteCurrency(selected)
  const range =
    price != null && low != null && high != null && high > low
      ? Math.max(2, Math.min(98, ((price - low) / (high - low)) * 100))
      : null
  return (
    <aside className="side-panel watchlist-panel" aria-label="Watchlist and symbol details">
      <div className="panel-heading">
        <h2>
          Watchlist <span className="count-badge">{symbols.length}</span>
        </h2>
        <div className="row">
          <IconButton
            icon={Search}
            label="Filter watchlist"
            active={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen)
              setQuery('')
            }}
          />
          <IconButton icon={Plus} label="Add symbol to watchlist" onClick={onAdd} />
          <IconButton icon={X} label="Close watchlist" className="mobile-only" onClick={onClose} />
        </div>
      </div>
      <div className="watchlist-subheading">
        <Dropdown
          trigger={() => (
            <button className="watchlist-selector">
              {group === 'All assets'
                ? source === 'coinbase'
                  ? 'Coinbase pairs'
                  : 'Demo watchlist'
                : group}
              <ChevronDown size={13} />
            </button>
          )}
        >
          {(close) => (
            <>
              {['All assets', 'Layer 1', 'DeFi', 'Other'].map((item) => (
                <MenuItem
                  key={item}
                  selected={group === item}
                  onClick={() => {
                    setGroup(item)
                    close()
                  }}
                >
                  {item === 'All assets' ? 'All pairs' : item}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
        <span
          className={`demo-badge ${source === 'coinbase' ? 'coinbase-feed-badge' : ''} ${feedState !== 'live' ? 'not-live' : ''}`}
        >
          {source === 'demo' ? 'DEMO' : feedState === 'live' ? 'LIVE' : feedState.toUpperCase()}
        </span>
      </div>
      {searchOpen && (
        <div className="watchlist-search">
          <Search size={14} />
          <input
            aria-label="Filter watchlist symbols"
            autoFocus
            placeholder="Find in watchlist…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <div className="watchlist-columns">
        {(['symbol', 'price', 'change'] as const).map((key) => (
          <button key={key} onClick={() => toggleSort(key)}>
            {key === 'symbol' ? 'Symbol' : key === 'price' ? 'Last price' : 'Chg%'}
            {sort?.key === key && (
              <ArrowDown
                size={10}
                style={{ transform: sort.direction === 1 ? 'rotate(180deg)' : undefined }}
              />
            )}
          </button>
        ))}
      </div>
      <div className="watchlist-rows">
        {listed.map((asset) => (
          <div
            className={`watchlist-row ${selected.symbol === asset.symbol ? 'selected' : ''}`}
            key={asset.symbol}
          >
            <button
              className="watchlist-asset"
              onClick={() => onSelect(asset.symbol)}
              aria-label={`View ${asset.name} chart`}
            >
              <CoinIcon asset={asset} size={27} />
              <span>
                <strong>
                  {asset.ticker}
                  <em>{quoteCurrency(asset)}</em>
                </strong>
                <small>{asset.name}</small>
              </span>
              <span className="watchlist-price mono">
                {formatPrice(quotes[asset.symbol]?.price)}
              </span>
              <span
                className={`watchlist-change mono ${changeClass(quotes[asset.symbol]?.change)}`}
              >
                {formatChange(quotes[asset.symbol]?.change)}
              </span>
            </button>
            <button
              className="remove-watchlist"
              aria-label={`Remove ${asset.name} from watchlist`}
              title={`Remove ${asset.name}`}
              onClick={() => onToggleWatchlist(asset.symbol)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {!listed.length && (
          <div className="small-empty">
            <Search size={22} />
            <p>No symbols here yet.</p>
            <button className="text-button" onClick={onAdd}>
              Add a symbol
            </button>
          </div>
        )}
      </div>
      <button className="watchlist-market-link" onClick={onMarkets}>
        <span>
          <span className="tiny-dot" />
          Explore {source === 'coinbase' ? 'Coinbase markets' : 'the demo market'}
        </span>
        <ArrowUpRight size={14} />
      </button>
      <section className="symbol-detail">
        <div className="detail-heading">
          <div className="row">
            <CoinIcon asset={selected} size={31} />
            <div>
              <h3>
                {selected.ticker}
                <span> / {currency}</span>
              </h3>
              <p>
                {selected.name} · {source === 'coinbase' ? 'Coinbase' : 'Demo data'}
              </p>
            </div>
          </div>
          <Dropdown
            align="right"
            trigger={() => <IconButton icon={MoreHorizontal} label="Symbol actions" />}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={BellPlus}
                  onClick={() => {
                    onAlert()
                    close()
                  }}
                >
                  Create price alert
                </MenuItem>
                <MenuItem
                  icon={Star}
                  onClick={() => {
                    onToggleWatchlist(selected.symbol)
                    close()
                  }}
                >
                  {symbols.includes(selected.symbol) ? 'Remove from watchlist' : 'Add to watchlist'}
                </MenuItem>
                <MenuItem
                  icon={Search}
                  onClick={() => {
                    onMarkets()
                    close()
                  }}
                >
                  Market overview
                </MenuItem>
              </>
            )}
          </Dropdown>
        </div>
        <div className="detail-price">
          {formatPrice(price)}
          <span>{currency}</span>
        </div>
        <div className={`detail-change ${changeClass(change)}`}>
          {change != null &&
            (change >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />)}
          <span className="mono">
            {price != null && open != null
              ? `${price >= open ? '+' : ''}${formatPrice(price - open)} (${formatChange(change)})`
              : 'Waiting for a verified quote'}
          </span>
          <small>24h</small>
        </div>
        <div className="day-range">
          <div>
            <span>24h range</span>
            <span className="range-label">{currency}</span>
          </div>
          <div className={`range-track ${range === null ? 'no-data' : ''}`}>
            {range !== null && <i style={{ left: `${range}%` }} />}
          </div>
          <div className="range-values mono">
            <span>{formatPrice(low)}</span>
            <span>{formatPrice(high)}</span>
          </div>
        </div>
        <div className="detail-stats">
          <div>
            <span>24h volume · {source === 'coinbase' ? selected.ticker : 'USD'}</span>
            <strong>
              {source === 'coinbase' ? compactNumber(quote?.volume) : `$${selected.volume}`}
            </strong>
          </div>
          <div>
            <span>{source === 'coinbase' ? 'Exchange' : 'Market cap'}</span>
            <strong>{source === 'coinbase' ? 'Coinbase' : `$${selected.marketCap}`}</strong>
          </div>
          <div>
            <span>24h open</span>
            <strong>{formatPrice(open)}</strong>
          </div>
          <div>
            <span>Quote received · UTC</span>
            <strong>
              {quote
                ? new Date(quote.updatedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' })
                : '—'}
            </strong>
          </div>
        </div>
        <div className="detail-disclaimer">
          {source === 'demo'
            ? 'Simulated prices. Real possibilities.'
            : feedState === 'live'
              ? 'Public Coinbase data · no account required.'
              : 'Not live. Previously received quotes may be stale.'}
        </div>
      </section>
    </aside>
  )
}

export function AlertsPanel({
  alerts,
  source,
  connected,
  onAdd,
  onRemove,
  onToggle,
  onSelect,
  onClose,
}: {
  alerts: PriceAlert[]
  source: DataSource
  connected: boolean
  onAdd: () => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
  onSelect: (symbol: string) => void
  onClose: () => void
}) {
  return (
    <aside className="side-panel alerts-panel">
      <div className="panel-heading">
        <h2>
          Price alerts{' '}
          <span className="count-badge">
            {alerts.filter((a) => a.enabled && !a.triggeredAt).length}
          </span>
        </h2>
        <div className="row">
          <IconButton icon={Plus} label="Create price alert" onClick={onAdd} />
          <IconButton icon={X} label="Close alerts" onClick={onClose} />
        </div>
      </div>
      <div className="panel-intro">
        <span className="eyebrow">KEEP YOUR EYES ON WHAT MATTERS</span>
        <p>Your levels. We’ll watch them.</p>
        <button className="button button-primary" onClick={onAdd}>
          <BellPlus size={15} />
          Create an alert
        </button>
      </div>
      <div className="alert-list">
        {!alerts.length ? (
          <EmptyState
            icon={Bell}
            title="A little peace of mind"
            description="Set a price level and get an in-app notification when a fresh price from its data source meets it."
          />
        ) : (
          alerts.map((alert) => (
            <div className={`alert-card ${alert.triggeredAt ? 'triggered' : ''}`} key={alert.id}>
              <div className="row between">
                <button className="alert-asset" onClick={() => onSelect(alert.symbol)}>
                  <CoinIcon asset={getAsset(alert.symbol)} size={23} />
                  <strong>{alert.symbol}</strong>
                </button>
                <IconButton icon={Trash2} label="Delete alert" onClick={() => onRemove(alert.id)} />
              </div>
              <div className="alert-target">
                {alert.condition === 'above' ? 'Price above' : 'Price below'}
                <strong className="mono">{formatPrice(alert.price)}</strong>
              </div>
              {alert.note && <p>{alert.note}</p>}
              <div className="row between">
                <span className={`alert-state ${alert.triggeredAt ? 'positive' : ''}`}>
                  {alert.triggeredAt ? (
                    <>
                      <Check size={12} />
                      Triggered{' '}
                      {new Date(alert.triggeredAt).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      })}{' '}
                      UTC
                    </>
                  ) : (
                    <>
                      <span className={`tiny-dot ${alert.enabled ? '' : 'gray'}`} />
                      {!alert.enabled
                        ? 'Paused'
                        : (alert.symbol.endsWith('-USD') ? 'coinbase' : 'demo') !== source
                          ? 'Different data source'
                          : connected
                            ? 'Watching price'
                            : 'Waiting for connection'}
                    </>
                  )}
                </span>
                {!alert.triggeredAt && (
                  <Toggle
                    label="Enable alert"
                    checked={alert.enabled}
                    onChange={() => onToggle(alert.id)}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="panel-footnote">
        Alerts are monitored only on the selected, connected data source while this workspace is
        open and not replaying. No orders are placed.
      </div>
    </aside>
  )
}

export function NotesPanel({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useLocalState('notes', '')
  return (
    <aside className="side-panel notes-panel">
      <div className="panel-heading">
        <h2>Trading notes</h2>
        <div className="row">
          <IconButton
            icon={Download}
            label="Export notes"
            disabled={!notes.trim()}
            onClick={() => downloadFile('atlas-trading-notes.md', notes, 'text/markdown')}
          />
          <IconButton icon={X} label="Close notes" onClick={onClose} />
        </div>
      </div>
      <div className="panel-intro">
        <span className="eyebrow">A CLEARER HEAD. A BETTER PLAN.</span>
        <p>Think it through.</p>
      </div>
      <div className="notes-date">
        <FileText size={14} />
        Your personal trading journal
      </div>
      <textarea
        className="notes-input"
        aria-label="Trading notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={
          'What are you watching today?\n\nKey levels\n—\n\nThe bigger picture\n—\n\nRisk before reward\n—'
        }
        maxLength={50000}
      />
      <div className="notes-footer">
        <span>
          <Check size={12} />
          Saved in this browser
        </span>
        <span>{notes.length.toLocaleString()} characters</span>
      </div>
      <div className="panel-footnote">
        Private to this browser. Export your notes to keep a backup.
      </div>
    </aside>
  )
}

export const DEFAULT_WATCHLIST = ASSETS.slice(0, 10).map((asset) => asset.symbol)
