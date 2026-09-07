import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Braces,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Keyboard,
  Layers,
  LockKeyhole,
  Monitor,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react'
import type {
  Asset,
  DataSource,
  MarketQuote,
  ChartSettings,
  Indicator,
  PriceAlert,
  SavedScript,
  ScriptResult,
} from '../lib/types'
import { DEFAULT_SETTINGS } from '../lib/types'
import { formatPrice, formatChange, changeClass, quoteCurrency, compactNumber } from '../lib/market'
import { INDICATOR_CATALOG, SCRIPT_TEMPLATES } from '../lib/indicators'
import { CoinIcon, EmptyState, IconButton, Modal, Sparkline, Toggle } from './ui'
import { CmMacdSettingsDialog } from './CmMacdSettingsDialog'
import { SmcSettingsDialog } from './SmcSettingsDialog'

export function SymbolSearch({
  onClose,
  onSelect,
  watchlist,
  onToggleWatchlist,
  adding,
  assets,
  quotes,
  source,
  verified,
}: {
  onClose: () => void
  onSelect: (symbol: string) => void
  watchlist: string[]
  onToggleWatchlist: (symbol: string) => void
  adding: boolean
  assets: Asset[]
  quotes: Record<string, MarketQuote>
  source: DataSource
  verified: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All assets')
  const [highlight, setHighlight] = useState(0)
  const matching = assets.filter(
    (a) =>
      `${a.symbol} ${a.name}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter !== 'Watchlist' || watchlist.includes(a.symbol)),
  )
  const results = matching.slice(0, 100)
  return (
    <Modal
      title={adding ? 'Build your watchlist' : 'Find your next perspective'}
      description={
        adding ? 'Keep the assets that matter within reach.' : 'Search a symbol to open its chart.'
      }
      onClose={onClose}
      className="symbol-search-modal"
      eyebrow="SYMBOL SEARCH"
      footer={
        <span className="dialog-footnote">
          <ShieldCheck size={14} />
          {source === 'demo'
            ? 'Synthetic demo prices. No exchange account required.'
            : verified
              ? 'Available Coinbase USD pairs. Open or watch a pair to stream its quote.'
              : 'Waiting for Coinbase to verify pair availability. Prices are not simulated.'}
        </span>
      }
    >
      <div className="search-field search-large">
        <Search size={19} />
        <input
          data-autofocus
          aria-label="Search symbols"
          placeholder="Search symbols, e.g. BTC or Ethereum"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((i) => Math.min(results.length - 1, i + 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((i) => Math.max(0, i - 1))
            }
            if (e.key === 'Enter' && results[highlight]) onSelect(results[highlight].symbol)
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="filter-pills">
        {['All assets', 'Watchlist'].map((item) => (
          <button
            key={item}
            className={filter === item ? 'active' : ''}
            onClick={() => {
              setFilter(item)
              setHighlight(0)
            }}
          >
            {item === 'Watchlist' && <Star size={12} />}
            {item}
          </button>
        ))}
        <span className="results-count">
          {matching.length} pairs{matching.length > 100 ? ' · showing first 100' : ''}
        </span>
      </div>
      <div className="symbol-results">
        {results.map((asset, i) => (
          <div
            className={`symbol-result ${highlight === i ? 'highlighted' : ''}`}
            key={asset.symbol}
            onMouseEnter={() => setHighlight(i)}
          >
            <button className="symbol-result-main" onClick={() => onSelect(asset.symbol)}>
              <CoinIcon asset={asset} size={34} />
              <span className="symbol-result-name">
                <strong>
                  {asset.symbol}
                  <span>SPOT</span>
                </strong>
                <small>
                  {asset.name} / {quoteCurrency(asset)}
                </small>
              </span>
              <span className="result-exchange">{source === 'coinbase' ? 'COINBASE' : 'DEMO'}</span>
              <span className="result-quote">
                <strong className="mono">{formatPrice(quotes[asset.symbol]?.price)}</strong>
                <small className={changeClass(quotes[asset.symbol]?.change)}>
                  {formatChange(quotes[asset.symbol]?.change)}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
            <button
              className={`watch-star ${watchlist.includes(asset.symbol) ? 'starred' : ''}`}
              onClick={() => onToggleWatchlist(asset.symbol)}
              aria-label={`${watchlist.includes(asset.symbol) ? 'Remove' : 'Add'} ${asset.name} ${watchlist.includes(asset.symbol) ? 'from' : 'to'} watchlist`}
            >
              <Star size={16} fill={watchlist.includes(asset.symbol) ? 'currentColor' : 'none'} />
            </button>
          </div>
        ))}
        {!results.length && (
          <EmptyState
            icon={Search}
            title="No symbols found"
            description="Try a ticker like BTC, or the asset’s full name."
          />
        )}
      </div>
    </Modal>
  )
}

export function IndicatorLibrary({
  onClose,
  indicators,
  onAdd,
  scripts,
  onEditScript,
  onApplyScript,
  onDeleteScript,
  onNew,
  onDocs,
  initialTab = 'built-in',
}: {
  onClose: () => void
  indicators: Indicator[]
  onAdd: (kind: Indicator['kind']) => void
  scripts: SavedScript[]
  onEditScript: (script: SavedScript) => void
  onApplyScript: (script: SavedScript) => void
  onDeleteScript: (id: string) => void
  onNew: () => void
  onDocs: () => void
  initialTab?: 'built-in' | 'scripts'
}) {
  const [tab, setTab] = useState(initialTab)
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const catalog = INDICATOR_CATALOG.filter(
    (i) =>
      `${i.name} ${i.short} ${i.description}`.toLowerCase().includes(query.toLowerCase()) &&
      (category === 'All' || i.category === category),
  )
  const matchingScripts = scripts.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
  return (
    <Modal
      title="A different lens on the market."
      description="Find an indicator. Uncover your next insight."
      eyebrow="INDICATOR LIBRARY"
      onClose={onClose}
      className="indicator-library-modal"
      footer={
        <div className="library-footer">
          <span>
            <Terminal size={14} />
            Your ideas, without limits.
          </span>
          <button className="text-button" onClick={onDocs}>
            Build a custom indicator <ArrowUpRight size={14} />
          </button>
        </div>
      }
    >
      <div className="dialog-tabs">
        <button className={tab === 'built-in' ? 'active' : ''} onClick={() => setTab('built-in')}>
          <Layers size={15} />
          Built-in indicators<span>{INDICATOR_CATALOG.length}</span>
        </button>
        <button className={tab === 'scripts' ? 'active' : ''} onClick={() => setTab('scripts')}>
          <Code2 size={15} />
          My scripts<span>{scripts.length}</span>
        </button>
      </div>
      <div className="search-field">
        <Search size={17} />
        <input
          aria-label="Search indicators"
          placeholder={tab === 'built-in' ? 'Search indicators…' : 'Search your scripts…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {tab === 'built-in' ? (
        <>
          <div className="filter-pills">
            {['All', 'Trend', 'Momentum', 'Volatility', 'Volume', 'Price Action'].map((item) => (
              <button
                className={category === item ? 'active' : ''}
                key={item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="indicator-catalog">
            {catalog.map((entry) => {
              const existing = indicators.some(
                (i) => i.kind === entry.kind && i.period === entry.period,
              )
              return (
                <div className="indicator-catalog-row" key={entry.kind}>
                  <span className="catalog-icon" style={{ color: entry.color }}>
                    <Activity size={23} strokeWidth={1.5} />
                  </span>
                  <div>
                    <h3>
                      {entry.name}
                      <span>{entry.short}</span>
                    </h3>
                    <p>{entry.description}</p>
                  </div>
                  <button
                    className={`button ${existing ? 'button-added' : 'button-secondary'}`}
                    onClick={() => onAdd(entry.kind)}
                    disabled={existing}
                  >
                    {existing ? <Check size={14} /> : <Plus size={14} />}
                    {existing ? 'Added' : 'Add'}
                  </button>
                </div>
              )
            })}
            {!catalog.length && (
              <EmptyState
                icon={Search}
                title="No matching indicators"
                description="Try a different name or category."
              />
            )}
          </div>
        </>
      ) : (
        <div className="script-library">
          <div className="script-library-top">
            <span>
              {scripts.length} saved {scripts.length === 1 ? 'script' : 'scripts'} · stored locally
            </span>
            <button className="button button-secondary" onClick={onNew}>
              <Plus size={14} />
              New script
            </button>
          </div>
          {matchingScripts.map((script) => (
            <div className="saved-script-card" key={script.id}>
              <span className="catalog-icon">
                <FileCode2 size={24} strokeWidth={1.4} />
              </span>
              <div>
                <h3>{script.name}</h3>
                <p>
                  JavaScript · Saved{' '}
                  {new Date(script.updatedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <IconButton
                icon={Pencil}
                label={`Edit ${script.name}`}
                onClick={() => onEditScript(script)}
              />
              <IconButton
                icon={Trash2}
                label={`Delete ${script.name}`}
                onClick={() => onDeleteScript(script.id)}
              />
              <button className="button button-secondary" onClick={() => onApplyScript(script)}>
                <Play size={12} />
                Apply
              </button>
            </div>
          ))}
          {!matchingScripts.length && (
            <EmptyState
              icon={Braces}
              title={scripts.length ? 'No matching scripts' : 'Your next edge starts here.'}
              description={
                scripts.length
                  ? 'Try a different search.'
                  : 'Write an idea in JavaScript, add it to your chart, and make it your own.'
              }
            >
              <button className="button button-primary" onClick={onNew}>
                <Plus size={14} />
                Create an indicator
              </button>
            </EmptyState>
          )}
        </div>
      )}
    </Modal>
  )
}

export function ChartSettingsDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: ChartSettings
  onChange: (settings: ChartSettings) => void
  onClose: () => void
}) {
  const set = <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) =>
    onChange({ ...settings, [key]: value })
  return (
    <Modal
      title="Make yourself at home."
      description="A chart that feels like your workspace."
      eyebrow="CHART SETTINGS"
      onClose={onClose}
      className="settings-modal"
      footer={
        <>
          <button className="button button-quiet" onClick={() => onChange(DEFAULT_SETTINGS)}>
            Restore defaults
          </button>
          <button className="button button-primary" onClick={onClose}>
            Done <Check size={14} />
          </button>
        </>
      }
    >
      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-options">
          {[
            { name: 'Midnight', color: '#101318' },
            { name: 'Graphite', color: '#17191f' },
            { name: 'Deep blue', color: '#101722' },
          ].map((theme) => (
            <button
              key={theme.color}
              className={settings.background === theme.color ? 'selected' : ''}
              onClick={() => set('background', theme.color)}
            >
              <div className="theme-preview" style={{ background: theme.color }}>
                <svg viewBox="0 0 100 42">
                  <path
                    d="M2 35 14 29 24 32 35 20 46 25 57 13 66 18 77 8 88 12 99 3"
                    fill="none"
                    stroke="#b9ee82"
                    strokeWidth="1.6"
                  />
                </svg>
                {settings.background === theme.color && <Check size={13} />}
              </div>
              <span>{theme.name}</span>
            </button>
          ))}
        </div>
        <div className="color-settings">
          <label>
            Rising candles
            <span>
              <input
                aria-label="Rising candle color"
                type="color"
                value={settings.upColor}
                onChange={(e) => set('upColor', e.target.value)}
              />
              <code>{settings.upColor}</code>
            </span>
          </label>
          <label>
            Falling candles
            <span>
              <input
                aria-label="Falling candle color"
                type="color"
                value={settings.downColor}
                onChange={(e) => set('downColor', e.target.value)}
              />
              <code>{settings.downColor}</code>
            </span>
          </label>
        </div>
      </div>
      <div className="settings-section">
        <h3>Canvas & scales</h3>
        <div className="setting-row">
          <div>
            <strong>Grid lines</strong>
            <p>A little structure behind the price.</p>
          </div>
          <Toggle
            checked={settings.grid}
            onChange={(value) => set('grid', value)}
            label="Show grid lines"
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Crosshair</strong>
            <p>Keep time and price in view.</p>
          </div>
          <Toggle
            checked={settings.crosshair}
            onChange={(value) => set('crosshair', value)}
            label="Show crosshair"
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Auto-fit price scale</strong>
            <p>Fit the visible candles to the chart.</p>
          </div>
          <Toggle
            checked={settings.autoScale}
            onChange={(value) => set('autoScale', value)}
            label="Auto-fit price scale"
          />
        </div>
        <div className="setting-row">
          <strong>Price scale</strong>
          <select
            aria-label="Price scale"
            value={settings.priceMode}
            onChange={(e) => set('priceMode', e.target.value as ChartSettings['priceMode'])}
          >
            <option value="normal">Linear</option>
            <option value="log">Logarithmic</option>
            <option value="percent">Percentage</option>
          </select>
        </div>
      </div>
    </Modal>
  )
}

export function IndicatorSettingsDialog(props: {
  indicator: Indicator
  result?: ScriptResult
  onSave: (indicator: Indicator) => void
  onClose: () => void
  onEditSource: () => void
}) {
  if (props.indicator.kind === 'cm-ult-macd') return <CmMacdSettingsDialog {...props} />
  if (props.indicator.kind === 'smart-money-concepts') return <SmcSettingsDialog {...props} />
  return <StandardIndicatorSettingsDialog {...props} />
}

function StandardIndicatorSettingsDialog({
  indicator,
  result,
  onSave,
  onClose,
  onEditSource,
}: {
  indicator: Indicator
  result?: ScriptResult
  onSave: (indicator: Indicator) => void
  onClose: () => void
  onEditSource: () => void
}) {
  const [period, setPeriod] = useState(String(indicator.period))
  const [color, setColor] = useState(indicator.color)
  const [visible, setVisible] = useState(indicator.visible)
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      result?.inputs.map((i) => [i.name, String(indicator.inputValues?.[i.name] ?? i.value)]) ?? [],
    ),
  )
  const hasPeriod = !['custom', 'vwap', 'volume'].includes(indicator.kind)
  return (
    <Modal
      title={`${indicator.name} settings`}
      description={
        indicator.kind === 'custom'
          ? 'Fine-tune your own perspective.'
          : 'Small adjustments. A clearer signal.'
      }
      onClose={onClose}
      className="compact-modal"
      footer={
        <>
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="indicator-settings-form" className="button button-primary">
            Apply changes
          </button>
        </>
      }
    >
      <form
        id="indicator-settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({
            ...indicator,
            period: Number(period),
            color,
            visible,
            ...(indicator.kind === 'custom'
              ? {
                  inputValues: Object.fromEntries(
                    Object.entries(inputs).map(([key, value]) => [key, Number(value)]),
                  ),
                }
              : {}),
          })
        }}
      >
        {hasPeriod && (
          <label className="field">
            {indicator.kind === 'macd' ? 'Fast EMA period' : 'Length'}
            <input
              data-autofocus
              type="number"
              min="1"
              max="2000"
              step="1"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              required
            />
            <small>Number of candles used in the calculation.</small>
          </label>
        )}
        {indicator.kind === 'bb' && (
          <div className="info-box">
            Bands use two population standard deviations around the simple moving average.
          </div>
        )}
        {indicator.kind === 'macd' && (
          <div className="info-box">
            Slow period scales at 26/12 of the fast period. Signal period is 9. MACD and signal
            lines are shown.
          </div>
        )}
        {indicator.kind === 'custom' &&
          result?.inputs.map((input) => (
            <label className="field" key={input.name}>
              {input.name}
              <input
                type="number"
                min={input.min}
                max={input.max}
                step="any"
                value={inputs[input.name]}
                onChange={(e) => setInputs({ ...inputs, [input.name]: e.target.value })}
                required
              />
            </label>
          ))}
        {!['custom', 'volume'].includes(indicator.kind) && (
          <label className="field">
            Line color
            <div className="indicator-color-row">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label="Indicator line color"
              />
              <code>{color}</code>
              {['#d6ad68', '#7796e8', '#ad91e5', '#b9ee82', '#ed6773'].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`color-swatch ${color === value ? 'selected' : ''}`}
                  style={{ background: value }}
                  aria-label={`Use ${value}`}
                  onClick={() => setColor(value)}
                />
              ))}
            </div>
          </label>
        )}
        {indicator.kind === 'volume' && (
          <div className="info-box">
            Volume bars use your rising and falling candle colors. Change them in Chart settings.
          </div>
        )}
        <div className="setting-row">
          <div>
            <strong>Visible on chart</strong>
            <p>Hide the indicator without removing it.</p>
          </div>
          <Toggle label="Indicator visible" checked={visible} onChange={setVisible} />
        </div>
        {indicator.kind === 'custom' && (
          <button
            type="button"
            className="button button-secondary full-width"
            onClick={onEditSource}
          >
            <Code2 size={15} />
            Edit source in Indicator Studio
          </button>
        )}
      </form>
    </Modal>
  )
}

export function AlertDialog({
  asset,
  currentPrice,
  source,
  onClose,
  onCreate,
}: {
  asset: Asset
  currentPrice: number
  source: DataSource
  onClose: () => void
  onCreate: (alert: Pick<PriceAlert, 'symbol' | 'condition' | 'price' | 'note'>) => void
}) {
  const [price, setPrice] = useState((currentPrice * 1.005).toFixed(currentPrice < 1 ? 5 : 2))
  const [condition, setCondition] = useState<'above' | 'below'>('above')
  const [note, setNote] = useState('')
  return (
    <Modal
      title="Let the price come to you."
      eyebrow="CREATE AN ALERT"
      description="Set your level. Get back to the bigger picture."
      className="compact-modal"
      onClose={onClose}
      footer={
        <>
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" form="price-alert-form">
            <Bell size={14} />
            Create alert
          </button>
        </>
      }
    >
      <div className="alert-symbol-preview">
        <CoinIcon asset={asset} size={35} />
        <div>
          <strong>{asset.symbol}</strong>
          <span>
            {asset.name} · {source === 'coinbase' ? 'Coinbase' : 'Demo'}
          </span>
        </div>
        <span className="mono">{formatPrice(currentPrice)}</span>
      </div>
      <form
        id="price-alert-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (Number(price) > 0 && Number.isFinite(Number(price)))
            onCreate({ symbol: asset.symbol, condition, price: Number(price), note: note.trim() })
        }}
      >
        <div className="form-grid">
          <label className="field">
            Condition
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as 'above' | 'below')}
            >
              <option value="above">Price is above</option>
              <option value="below">Price is below</option>
            </select>
          </label>
          <label className="field">
            Target price · {quoteCurrency(asset)}
            <input
              data-autofocus
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              min="0.00000001"
              step="any"
              max="1000000000000"
              required
            />
          </label>
        </div>
        <label className="field">
          A note to your future self <span className="optional">Optional</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
            placeholder="e.g. Watch for a breakout above resistance"
          />
        </label>
        <div className="alert-delivery">
          <Bell size={16} />
          <div>
            <strong>In-app notification</strong>
            <span>Triggers once when the condition is met.</span>
          </div>
          <Check size={16} />
        </div>
        <div className="info-box">
          <CircleHelp size={16} />
          <span>
            Alerts pause during replay or disconnection and use only the selected data source. No
            trades are placed and no emails are sent.
          </span>
        </div>
      </form>
    </Modal>
  )
}

export function ShareDialog({
  url,
  onClose,
  onCopy,
  onDownload,
  capture,
}: {
  url: string
  onClose: () => void
  onCopy: () => Promise<boolean>
  onDownload: () => void
  capture: () => Promise<Blob | null>
}) {
  const [copied, setCopied] = useState(false)
  const [image, setImage] = useState('')
  useEffect(() => {
    let active = true,
      objectUrl = ''
    capture()
      .then((blob) => {
        if (!active || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setImage(objectUrl)
      })
      .catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [capture])
  return (
    <Modal
      title="A perspective worth sharing."
      description="Send the view. Keep your edge."
      eyebrow="SHARE YOUR CHART"
      onClose={onClose}
      className="share-modal"
      footer={
        <span className="dialog-footnote">
          <LockKeyhole size={14} />
          Your scripts, notes and drawings stay private.
        </span>
      }
    >
      <div className="share-preview">
        {image ? (
          <img src={image} alt="Preview of your chart snapshot" />
        ) : (
          <ChartNoAxesCombined size={42} strokeWidth={1} />
        )}
      </div>
      <label className="field">
        Workspace link
        <div className="copy-field">
          <input
            value={url}
            readOnly
            aria-label="Shareable workspace link"
            onFocus={(e) => e.target.select()}
          />
          <button className="button button-primary" onClick={async () => setCopied(await onCopy())}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <small>Opens this symbol, timeframe, and chart style. Not a public upload.</small>
      </label>
      <button className="download-snapshot" onClick={onDownload}>
        <span className="snapshot-icon">
          <Download size={20} />
        </span>
        <span>
          <strong>Download a chart snapshot</strong>
          <small>A crisp PNG of your chart, indicators, and drawings.</small>
        </span>
        <ArrowUpRight size={17} />
      </button>
    </Modal>
  )
}

export function MarketsDialog({
  onClose,
  onSelect,
  assets: catalog,
  quotes,
  source,
  verified,
}: {
  onClose: () => void
  onSelect: (symbol: string) => void
  assets: Asset[]
  quotes: Record<string, MarketQuote>
  source: DataSource
  verified: boolean
}) {
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState('market')
  const assets = useMemo(() => {
    const result = catalog.filter((a) =>
      `${a.name} ${a.symbol}`.toLowerCase().includes(query.toLowerCase()),
    )
    if (sort !== 'market')
      result.sort((a, b) => {
        const av = quotes[a.symbol]?.change,
          bv = quotes[b.symbol]?.change
        if (av == null) return bv == null ? 0 : 1
        if (bv == null) return -1
        return (bv - av) * (sort === 'gainers' ? 1 : -1)
      })
    return result.slice(0, 100)
  }, [catalog, query, sort, quotes])
  const quoted = catalog.filter((a) => quotes[a.symbol]),
    gaining = quoted.filter((a) => (quotes[a.symbol].change ?? 0) > 0)
  return (
    <Modal
      title="The bigger picture."
      description={
        source === 'coinbase'
          ? 'Explore Coinbase USD markets. Open a pair to stream its price.'
          : 'An illustrative market, built for experimentation.'
      }
      eyebrow="MARKET OVERVIEW"
      onClose={onClose}
      className="markets-modal"
      footer={
        <span className="dialog-footnote">
          <Monitor size={14} />
          {source === 'coinbase'
            ? 'Quotes are loaded for open charts, watchlist pairs and alerts. Missing values are not estimated.'
            : 'Illustrative demo snapshot. These are not current market prices.'}
        </span>
      }
    >
      <div className="market-summary">
        <div>
          <span>{verified ? 'Available pairs' : 'Suggested pairs'}</span>
          <strong>{catalog.length}</strong>
          <small>
            {source === 'coinbase'
              ? verified
                ? 'Coinbase USD catalog'
                : 'Availability not yet verified'
              : 'Synthetic demo assets'}
          </small>
        </div>
        <div>
          <span>Quotes loaded</span>
          <strong>
            {quoted.length}
            <em>{gaining.length} positive</em>
          </strong>
          <small>Observed 24h changes only</small>
        </div>
        <div>
          <span>Market data source</span>
          <strong>{source === 'coinbase' ? 'Coinbase' : 'Demo'}</strong>
          <small>
            {source === 'coinbase' ? 'Public exchange data' : 'Locally generated prices'}
          </small>
        </div>
      </div>
      <div className="market-filters">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search market overview"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
          />
        </div>
        <select aria-label="Sort markets" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="market">Default order</option>
          <option value="gainers">Top gainers</option>
          <option value="losers">Top losers</option>
        </select>
      </div>
      <div className="market-table-wrap">
        <table className="market-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Price</th>
              <th>24h change</th>
              <th>24h base volume</th>
              <th>{source === 'coinbase' ? 'Venue' : 'Demo trend'}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.symbol}>
                <td>
                  <button className="market-asset" onClick={() => onSelect(asset.symbol)}>
                    <CoinIcon asset={asset} size={31} />
                    <span>
                      <strong>{asset.name}</strong>
                      <small>{asset.symbol}</small>
                    </span>
                  </button>
                </td>
                <td className="mono">{formatPrice(quotes[asset.symbol]?.price, true)}</td>
                <td className={changeClass(quotes[asset.symbol]?.change)}>
                  <span className="market-change">
                    {formatChange(quotes[asset.symbol]?.change)}
                  </span>
                </td>
                <td className="mono muted">
                  {source === 'demo' ? '—' : compactNumber(quotes[asset.symbol]?.volume)}
                </td>
                <td>
                  {source === 'demo' ? (
                    <Sparkline asset={asset} />
                  ) : (
                    <span className="venue-label">Coinbase</span>
                  )}
                </td>
                <td>
                  <IconButton
                    icon={ArrowUpRight}
                    label={`Open ${asset.name} chart`}
                    onClick={() => onSelect(asset.symbol)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!assets.length && (
          <EmptyState
            icon={Search}
            title="No matching assets"
            description="Try another ticker or asset name."
          />
        )}
      </div>
    </Modal>
  )
}

const SHORTCUTS = [
  ['Search symbols', 'Ctrl / ⌘ K'],
  ['Save script', 'Ctrl / ⌘ S'],
  ['Run indicator', 'Ctrl / ⌘ Enter'],
  ['Trend line', 'Alt T'],
  ['Horizontal line', 'Alt H'],
  ['Undo drawing', 'Ctrl / ⌘ Z'],
  ['Redo drawing', 'Ctrl / ⌘ Shift Z'],
  ['Cancel drawing / close dialog', 'Esc'],
  ['Zoom in / out', '+ / −'],
  ['Keyboard shortcuts', '?'],
]
export function DocsDialog({
  onClose,
  onTemplate,
  initialTab = 'start',
}: {
  onClose: () => void
  onTemplate: (name: string, source: string) => void
  initialTab?: 'start' | 'api' | 'shortcuts' | 'about'
}) {
  const [tab, setTab] = useState(initialTab)
  return (
    <Modal
      title="A little guidance. A lot of possibility."
      eyebrow="ATLAS FIELD GUIDE"
      onClose={onClose}
      className="docs-modal"
    >
      <div className="dialog-tabs">
        <button className={tab === 'start' ? 'active' : ''} onClick={() => setTab('start')}>
          <Sparkles size={14} />
          Getting started
        </button>
        <button className={tab === 'api' ? 'active' : ''} onClick={() => setTab('api')}>
          <Code2 size={14} />
          Indicator API
        </button>
        <button className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')}>
          <Keyboard size={14} />
          Shortcuts
        </button>
        <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>
          About
        </button>
      </div>
      <div className="docs-content">
        {tab === 'start' && (
          <>
            <h3>A considered space for your next idea.</h3>
            <p>
              Atlas brings advanced charts and your own indicators into one focused workspace.
              Here’s where to begin.
            </p>
            <div className="getting-started-grid">
              {[
                {
                  icon: Search,
                  title: '01 · Find your market',
                  text: 'Search a symbol or choose from your watchlist. Switch timeframes, scroll to pan, and use your mouse wheel to zoom.',
                },
                {
                  icon: Activity,
                  title: '02 · Find your signal',
                  text: 'Add built-in indicators from the toolbar. Hover an indicator’s legend to edit its settings, hide it, or remove it.',
                },
                {
                  icon: Pencil,
                  title: '03 · Mark your perspective',
                  text: 'Select a drawing tool on the left. Click one point for a price line, or two points for trends, ranges, and Fibonacci levels.',
                },
                {
                  icon: Code2,
                  title: '04 · Make it your own',
                  text: 'Write JavaScript in Indicator Studio, then press Add to chart. Your plots follow the active symbol and timeframe.',
                },
              ].map((item) => (
                <div key={item.title}>
                  <item.icon size={21} />
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
            <div className="info-box">
              <ShieldCheck size={18} />
              <span>
                Coinbase mode uses public exchange data; offline demo mode is explicitly synthetic.
                No trades are placed, and your work stays in this browser.
              </span>
            </div>
          </>
        )}
        {tab === 'api' && (
          <>
            <h3>Your logic. Your indicator.</h3>
            <p>
              Scripts use JavaScript, not Pine Script. Each data array contains one value per
              candle, ordered oldest to newest. Return <code>null</code> during warm-up periods.
            </p>
            <div className="api-source">
              <div>
                <FileCode2 size={14} />
                Your first moving average
                <button
                  className="text-button"
                  onClick={() => onTemplate(SCRIPT_TEMPLATES[0].name, SCRIPT_TEMPLATES[0].source)}
                >
                  Try this <ArrowUpRight size={12} />
                </button>
              </div>
              <pre>{`const period = input.number("Period", 20);\nconst average = ta.ema(close, period);\n\nplot(average, {\n  title: "My EMA",\n  color: "#b9ee82",\n  pane: "price",\n  lineWidth: 2\n});`}</pre>
            </div>
            <h4>Available data</h4>
            <div className="api-tags">
              {['open', 'high', 'low', 'close', 'volume', 'time'].map((tag) => (
                <code key={tag}>{tag}</code>
              ))}
            </div>
            <p>
              <code>time</code> is an array of UTC Unix timestamps in seconds. Price and volume
              arrays contain finite numbers.
            </p>
            <h4>Technical analysis helpers</h4>
            <div className="api-methods">
              {[
                ['ta.sma(values, period)', 'Simple moving average.'],
                ['ta.ema(values, period)', 'EMA initialized with an SMA seed.'],
                ['ta.rsi(values, period)', 'Wilder-smoothed relative strength index.'],
                ['ta.stdev(values, period)', 'Population standard deviation.'],
                ['ta.highest(values, period)', 'Rolling maximum.'],
                ['ta.lowest(values, period)', 'Rolling minimum.'],
                ['ta.crossover(a, b)', 'Boolean array: a crosses above b.'],
              ].map(([name, description]) => (
                <div key={name}>
                  <code>{name}</code>
                  <span>{description}</span>
                </div>
              ))}
            </div>
            <h4>Inputs & plots</h4>
            <p>
              <code>input.number(name, defaultValue, min = 1, max = 2000)</code> creates an editable
              numeric setting. Periods must be integers from 1 to 2000.
            </p>
            <p>
              <code>plot(values, options)</code> accepts one number or null per candle. Options:{' '}
              <code>title</code>, a six-digit hex <code>color</code>, <code>lineWidth</code> (1–4),
              and <code>pane</code> ("price" or "oscillator"). Maximum eight plots and thirty inputs
              per script.
            </p>
            <div className="info-box">
              <ShieldCheck size={17} />
              <span>
                Scripts execute in disposable workers inside an opaque-origin sandbox. Network
                requests are blocked by CSP. Runs are terminated after about two seconds. Use
                scripts you understand; resource limits are not a substitute for reviewing code.
              </span>
            </div>
          </>
        )}
        {tab === 'shortcuts' && (
          <>
            <h3>Stay in your flow.</h3>
            <p>Less reaching for the mouse. More room for the market.</p>
            <div className="shortcut-list">
              {SHORTCUTS.map(([name, keys]) => (
                <div key={name}>
                  <span>{name}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>
            <p className="muted">
              Drawing shortcuts apply when you’re not typing. Escape also exits focus mode.
              Double-click the price scale to reset its range.
            </p>
          </>
        )}
        {tab === 'about' && (
          <>
            <div className="about-atlas">
              <img src="/favicon.svg" alt="" />
              <h3>Atlas</h3>
              <span>Your edge, in focus.</span>
            </div>
            <p>
              A local-first charting workspace built for clarity, experimentation, and the joy of
              understanding a market.
            </p>
            <div className="api-methods">
              <div>
                <strong>Chart engine</strong>
                <span>TradingView Lightweight Charts™</span>
              </div>
              <div>
                <strong>Data source</strong>
                <span>Coinbase REST + live trades · optional offline demo</span>
              </div>
              <div>
                <strong>Indicator language</strong>
                <span>JavaScript · isolated Web Workers</span>
              </div>
              <div>
                <strong>Storage</strong>
                <span>This browser only · no cloud sync</span>
              </div>
            </div>
            <div className="info-box">
              Atlas is an independent application, not affiliated with or endorsed by TradingView or
              Coinbase. No brokerage connectivity, financial advice, or Pine Script compatibility is
              provided.
            </div>
            <p className="attribution-text">
              TradingView Lightweight Charts™. Copyright (c) 2026 TradingView, Inc. Licensed under
              Apache 2.0.{' '}
              <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
                Visit TradingView <ExternalLink size={11} />
              </a>
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

export function WorkspaceDialog({
  name,
  onNameChange,
  onExport,
  onImport,
  onClose,
}: {
  name: string
  onNameChange: (name: string) => void
  onExport: () => void
  onImport: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(name)
  return (
    <Modal
      title="Room to make it yours."
      eyebrow="YOUR WORKSPACE"
      onClose={onClose}
      className="compact-modal"
      footer={
        <button className="button button-primary" type="submit" form="workspace-form">
          Save workspace <Check size={14} />
        </button>
      }
    >
      <div className="workspace-profile">
        <span className="profile-avatar">A</span>
        <div>
          <strong>Personal workspace</strong>
          <span>No account needed. Just your next idea.</span>
        </div>
        <span className="local-badge">LOCAL</span>
      </div>
      <form
        id="workspace-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) {
            onNameChange(draft.trim())
            onClose()
          }
        }}
      >
        <label className="field">
          Workspace name
          <input
            data-autofocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={48}
            required
          />
        </label>
      </form>
      <div className="workspace-storage">
        <ShieldCheck size={22} />
        <div>
          <strong>Yours, right here.</strong>
          <p>
            Your watchlist, drawings, scripts, alerts, and notes are saved in this browser. Clearing
            browser data will remove them. Export a backup to keep your work.
          </p>
        </div>
      </div>
      <button className="download-snapshot" onClick={onExport}>
        <span className="snapshot-icon">
          <FolderOpen size={19} />
        </span>
        <span>
          <strong>Export workspace backup</strong>
          <small>Your settings and work, as a JSON file.</small>
        </span>
        <Download size={17} />
      </button>
      <button className="button button-quiet full-width workspace-import" onClick={onImport}>
        <Upload size={14} />
        Import a workspace backup
      </button>
    </Modal>
  )
}

export function TextNoteDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (text: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <Modal
      title="Leave a little perspective."
      description="Add a note to this point on the chart."
      onClose={onClose}
      className="compact-modal"
      footer={
        <>
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" form="chart-note-form" type="submit">
            Add note <Plus size={14} />
          </button>
        </>
      }
    >
      <form
        id="chart-note-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) onAdd(text.trim())
        }}
      >
        <label className="field">
          Chart note
          <input
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Previous resistance"
            required
            maxLength={50}
          />
        </label>
      </form>
    </Modal>
  )
}
export function ConfirmDialog({
  title,
  message,
  actionLabel = 'Continue',
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  actionLabel?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="compact-modal"
      footer={
        <>
          <button className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" onClick={onConfirm}>
            {actionLabel}
            <ArrowRight size={14} />
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </Modal>
  )
}
