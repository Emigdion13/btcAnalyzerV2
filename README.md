# Atlas · btcAnalyzerV2

A professional, Coinbase-connected charting workspace inspired by TradingView. Built with React, TypeScript, a Node.js market-data adapter, and TradingView Lightweight Charts™.

**Coinbase is the default data source. Offline demo data is available only by explicit selection; connection failures never substitute synthetic prices. This is a chart viewer—not a prediction engine or a complete TradingView replacement. Custom indicators use JavaScript, not Pine Script. No orders are placed.**

## Run locally

Requires **Node.js 22.13+** (native fetch, WebSocket, and TypeScript stripping).

```bash
npm ci
npm run dev
```

Vite listens on `0.0.0.0:5173`, with the Coinbase API mounted on the same origin. Arena preview hosts under `*.e2b.app` are allowed. No Coinbase credentials or exchange account are required. The server needs outbound HTTPS and WebSocket access to Coinbase.

```bash
npm run build       # Type-check and create a production build
npm run preview     # Preview the production build WITH the Coinbase API
npm start           # Production Node server (run npm run build first)
npm run lint        # ESLint
npm test            # Unit tests
npm run test:e2e    # Browser integration tests
npm run format      # Format source files
```

For browser tests, install Chromium and its OS dependencies first:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

The tests can use an existing compatible Chromium binary with `CHROMIUM_EXECUTABLE_PATH`. Set `TEST_BASE_URL` to test a separately running production build; otherwise Playwright starts or reuses the development server.

## Coinbase connection & timeframes

Choose **Coinbase · real USD markets** from the connection menu at the bottom left. Open a pair such as `BTC-USD`, `ETH-USD`, or `SOL-USD`, then select a timeframe. The quick toolbar exposes **1m, 3m, 5m, and 15m**, including on mobile.

| Chart timeframe | Coinbase source       | Aggregation                     |
| --------------- | --------------------- | ------------------------------- |
| 1m              | 60-second candles     | Native                          |
| 3m              | 60-second candles     | Three UTC-aligned 1m candles    |
| 5m              | 300-second candles    | Native                          |
| 15m             | 900-second candles    | Native                          |
| 1h              | 3,600-second candles  | Native                          |
| 4h              | 3,600-second candles  | Four UTC-aligned hours          |
| 1D              | 86,400-second candles | Native                          |
| 1W              | 86,400-second candles | Monday 00:00 UTC weekly buckets |

The symbol picker uses Coinbase's available, online USD product catalog. Unavailable/delisted products are rejected by the backend rather than silently mapped to a different coin. Before the catalog is reachable, suggested major pairs are explicitly unverified and prices remain blank. Existing demo USDT symbols, drawings, and alerts remain separate from Coinbase USD symbols.

### Data flow

- Browser requests use relative `/api/coinbase/*` URLs; the server contacts a fixed Coinbase upstream. There is no browser-facing `localhost` API or arbitrary upstream URL proxy.
- REST supplies the product catalog, 24h quotes, and historical candles. History defaults to 300 bars and range shortcuts request up to 900. Requests are paginated within Coinbase's 300-native-candle limit, sorted, deduplicated, and validated.
- A shared server-side WebSocket consumes `ticker`, `matches`, and `heartbeat` channels. The server batches quote/candle changes into one same-origin SSE update per second. New trades update OHLCV and create new candles at interval boundaries.
- Catalog and REST requests are cached/coalesced, upstream requests are rate-limited, reconnects back off, heartbeats detect a stalled stream, and periodic/reconnect REST reconciliation repairs missing trade history.
- Closed-data gaps are **not** replaced with invented flat candles. Sparse products can have fewer returned bars than requested.
- **Current candles are provisional.** A REST candle does not expose a last-trade ID. To avoid double-counting volume, stream events preceding REST receipt are skipped; this can briefly undercount the receipt window until authoritative REST reconciliation. Do not treat the open candle as finalized data.
- Alerts pause when the selected feed is disconnected/stale/paused, and during replay. Demo quotes cannot trigger Coinbase alerts. Replay freezes a snapshot; incoming live updates do not move its history.

Public API references: [candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [product stats](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats), and [WebSocket channels](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels).

### Hosting and connection failures

```bash
npm ci
npm run build
PORT=5173 npm start
```

The production server binds to `0.0.0.0` and serves both `dist/` and the API. **Hosting `dist/` alone on a static-only host will not provide market data.** Deploy the Node server or route `/api/coinbase/*` to an equivalent running adapter. Do not buffer SSE responses; allow long-lived connections.

Outbound endpoints:

- `https://api.exchange.coinbase.com`
- `wss://ws-feed.exchange.coinbase.com`

If DNS, TLS, regional restrictions, or network policy prevent access, the UI displays **Coinbase is unavailable** (or a stale-data banner if verified history was already loaded). Use **Retry Coinbase**, check the hosting network, or explicitly switch to **Offline demo**. No API keys can fix blocked network access. This Arena sandbox currently fails direct Coinbase TLS connections; the failure state is intentional and the integration is tested with controlled Coinbase-format fixtures, not claimed to be live-verified here.

### Same-origin API

- `GET /api/coinbase/products`
- `GET /api/coinbase/quotes?products=BTC-USD,ETH-USD`
- `GET /api/coinbase/candles?product=BTC-USD&interval=3m&limit=300`
- `GET /api/coinbase/stream?product=BTC-USD&interval=3m&limit=300&products=BTC-USD,ETH-USD`

All endpoints are read-only. Product syntax, catalog availability, intervals, sample limits, upstream payloads, and imported workspace data are validated. Public API hosting still needs deployment-level abuse protection before serving large anonymous audiences.

## What works

- **Canvas charting:** candlesticks, hollow candles, OHLC bars, line, and area charts; interactive crosshair, pan, zoom, linear/log/percentage price scales, auto-fit, and focus mode.
- **Markets:** Coinbase USD products, live quote subscriptions for open charts/watchlists/alerts, source-aware symbol search, sortable watchlists, and a market overview. Twelve synthetic instruments remain available in explicit demo mode.
- **Timeframes:** 1m, 3m, 5m, 15m, 1h, 4h, 1D, and 1W. Range shortcuts choose an appropriate interval and viewport.
- **Built-in indicators:** SMA, EMA, Bollinger Bands, Wilder RSI, conventional MACD/signal lines, **CM_Ult_MacD_MTF (ChrisMoody’s original)**, an independent **Smart Money Concepts** price-action overlay, **SR Breaks and Retests (ChartPrime’s published (20, 2, 1) indicator)**, **Pivot Points High Low & Missed Reversal Levels (LuxAlgo’s open-source (50) indicator)**, daily UTC-reset VWAP, and volume. Indicator settings and visibility are editable.
- **Indicator Studio:** highlighted JavaScript editor, named numeric inputs, custom price overlays and oscillator panes, templates, a saved-script library, and compilation feedback.
- **Drawings:** price-pane trend lines, horizontal levels, rectangles, Fibonacci retracements, measurements, and text notes. Undo/redo, visibility, locking, and an object tree. Drawings are scoped to symbol + timeframe.
- **Order-book depth & zone strength:** live support/resistance walls constructed from the resting `level2` book, plus a per-zone strength reading (`STRONG/MED/WEAK`) on every SMC order block, FVG, and SR box — how much of each price-action level the book is actually funding right now. A floating readout shows walls, totals, and near-mid bid/ask imbalance. Live on Coinbase (panel + overlay); demo mode shows the overlay over an explicitly synthetic book.
- **Bar replay:** step backward/forward, pause/play, and 1×/2×/5×/10× playback through a frozen snapshot of the loaded history.
- **Alerts:** one-time in-app price-condition notifications against the selected, connected feed. No email, background monitoring, or trading integration.
- **Your work:** locally saved drafts, scripts, charts, drawings, preferences, watchlists, alerts, and notes. Explicit **Save** adds or updates a script in the library; drafts are also retained automatically.
- **Exports:** chart PNGs (including drawings), OHLCV CSVs, and validated JSON workspace backup/import. Share links contain only the symbol, interval, and chart style—not private scripts or drawings.
- **Responsive layout:** collapsible side panels and editor, desktop/tablet/mobile layouts, and keyboard shortcuts.

## CM_Ult_MacD_MTF (60, 12, 26, 9)

The original ChrisMoody indicator is included in new workspaces and available under **Indicators → CM_Ult_MacD_MTF** for existing ones. It is a separate built-in, not a renamed conventional MACD:

- Close-based EMA 12 minus EMA 26, with a **9-period SMA signal**, matching the original EMA initialization.
- Original aqua/blue/red/maroon histogram, yellow flat-value fallback, lime/red MACD, yellow signal, absolute crossover dots and solid white zero line.
- All original input switches and independent fast/slow/signal lengths, with persistent settings and workspace-backup support.
- Dedicated alternate-timeframe Coinbase history/stream subscriptions; no chart-timeframe or demo-data substitution on failure.

**“60” is the alternate timeframe input, not necessarily the active resolution.** The original “Use Current Chart Resolution?” option is checked by default. Uncheck it and leave **60 · 1 hour** selected to use hourly calculations on another chart timeframe.

**The original repaints:** legacy Pine historical lookahead is intentionally retained, and open-candle values/dots can change. Replay freezes native histories and avoids using a future final close for an incomplete source candle. Finite history, different exchanges and live data timing affect numerical parity. This implementation has formula/renderer/browser fixture tests, not a certified side-by-side TradingView data match. Supported source resolutions are the app’s eight intervals; arbitrary Pine resolutions are not implemented.

See [the compatibility specification, limitations and original-source references](docs/cm-ult-macd.md).

## Smart Money Concepts (SMC)

Atlas now includes an **independent, native Smart Money Concepts overlay**. It is a clean-room implementation of commonly used price-action methods—not a copy of, or an affiliation with, another publisher’s proprietary indicator or source code.

Add it from **Indicators → Smart Money Concepts**, or use the preloaded overlay in a new workspace. Its starting configuration matches the requested familiar profile: **Historical**, **Colored**, internal/swing structure **All**, **Tiny/Small** labels, **50**-bar swings, **5** internal and **5** swing block slots, **Atr** filtering, **High/Low** mitigation, equal-level confirmation **3** / threshold **0.1**, current-chart FVG timeframe with **1** extension bar, and solid daily/weekly/monthly level styles.

The overlay draws confirmed-pivot internal and swing **BOS/CHoCH**, optional **HH/HL/LH/LL** pivot labels, active opposite-candle order blocks, ATR-scaled **EQH/EQL**, three-candle fair-value gaps, prior daily/weekly/monthly high-low levels, and premium/equilibrium/discount bands. Fair-value gaps can use the active chart (the default) or a separately loaded native timeframe—never a silently resampled chart series. It can recolor candlesticks from the latest confirmed internal bias. The **Present** mode intentionally retains only the latest markup set; **Historical** retains a capped recent history so the chart remains responsive.

This is deterministic OHLCV analysis, not a prediction service. Pivots are only known after their confirmation bars, calculations vary by venue/history, and every level is informational rather than a trading signal or investment advice.

## SR Breaks and Retests

Atlas includes a **faithful native port of ChartPrime’s “Support and Resistance (High Volume Boxes)”**, the TradingView indicator whose short title renders as **SR Breaks and Retests [ChartPrime] (20, 2, 1)**. ChartPrime publishes the Pine Script v5 source under the Mozilla Public License 2.0, and the Atlas engine reproduces that published calculation statement by statement—delta volume, close pivots, volume-gated zones, ATR(200) depth, break/hold crosses, role-reversal memory, and every marker offset and color.

Add it from **Indicators → SR Breaks and Retests**. The three published inputs—**Lookback Period 20**, **Delta Volume Filter Length 2**, **Adjust Box Width 1**—are editable and persist like every other indicator. Zones render as SVG boxes with volume-graded fills and “Vol:” labels; breaks print **Break Sup / Break Res** labels; holds and successful retests print ◆ diamonds, all at the original’s exact anchors. Every message drawn inside the chart — those break labels included — is transparent: the published colors outline the label and tint the glyphs, but no plate is filled over the price action, so the candles behind a message always stay visible.

Because Atlas loads a finite candle window (900 bars by default) while TradingView computes over much deeper history, one documented difference exists: the original hides the very first “Break” label of a session (`not na_flag` is `na` in Pine), which is invisible on TradingView’s deep history but would read as a missing label here. Atlas shows that first label so short windows match what the original displays on screen. Everything else— including quirks like a replacement zone printing a retest diamond instead of a second break label—matches the original behavior.

See [the compatibility notes, calculation contract and provenance](docs/sr-breaks-retests.md).

## Pivot Points High Low & Missed Reversal Levels

Atlas includes a **faithful native port of LuxAlgo’s “Pivot Points High Low & Missed Reversal Levels [LuxAlgo]”**, the open-source TradingView indicator whose legend renders as **Pivot Points High Low & Missed Reversal Levels [LuxAlgo] (50)**. LuxAlgo publishes the Pine Script v5 source under CC BY-NC-SA 4.0, and the Atlas engine reproduces that published calculation statement by statement—`ta.pivothigh/pivotlow(length, length)` reversals, the running max/min and follow-up extremes between pivots, the two ways a reversal is missed (two pivots of the same kind in a row, or a pivot forming inside the prior swing), the zig-zag with its dashed detours, the missed-reversal levels, and the trailing reversal estimate.

Add it from **Indicators → Pivot Points High Low & Missed Reversal Levels**. The published inputs—**Pivot Length 50**, the **Regular Pivots** and **Missed Pivots** toggles with their high/low colors, and the **Text Label Color**—are editable and persist like every other indicator. Confirmed pivots print **▼ / ▲** labels `length` bars behind the live edge; every reversal the method skipped prints a **👻**, the zig-zag detours through it with dashed legs, and a horizontal level starts there and runs to the next missed reversal; the newest 👻 is an estimate of the reversal in progress that readjusts with every new higher high or lower low and carries its own level to the latest bar. As with every message drawn inside the chart, the labels are transparent: the published colors outline the label and tint the glyphs, but no plate is filled over the price action.

One documented difference exists, again because Atlas loads a finite candle window: Pine starts the zig-zag at bar 0, price 0—an artifact buried thousands of bars back on TradingView but a visible slash across a 900-bar window—so Atlas starts the zig-zag at the first confirmed pivot. Everything from that pivot on matches the original.

See [the compatibility notes, calculation contract and provenance](docs/pivot-points-missed-reversals.md).

## Write a custom indicator

Open **Indicator Studio**, edit the script, and select **Add to chart** (Ctrl/⌘ + Enter).

```js
const period = input.number('Period', 20)
const average = ta.ema(close, period)

plot(average, {
  title: 'My EMA',
  color: '#b9ee82',
  pane: 'price',
  lineWidth: 2,
})
```

Available arrays, oldest to newest: `open`, `high`, `low`, `close`, `volume`, and `time` (UTC Unix seconds). Each plot must return one finite number or `null` per candle. `null` denotes a warm-up gap.

| API                                                     | Purpose                                              |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `ta.sma(values, period)`                                | Simple moving average                                |
| `ta.ema(values, period)`                                | Exponential average, initialized with an SMA seed    |
| `ta.rsi(values, period)`                                | Wilder-smoothed RSI                                  |
| `ta.stdev(values, period)`                              | Rolling population standard deviation                |
| `ta.highest(values, period)`                            | Rolling maximum                                      |
| `ta.lowest(values, period)`                             | Rolling minimum                                      |
| `ta.crossover(a, b)`                                    | Boolean array of upward crossings                    |
| `input.number(name, defaultValue, min = 1, max = 2000)` | Named, editable numeric input; names must be unique  |
| `plot(values, options)`                                 | Draw a line on the price chart or an oscillator pane |

Plot options: `title`, six-digit hex `color`, `pane` (`"price"` or `"oscillator"`), and `lineWidth` (1–4). Period-based TA helpers require integer periods from 1 to 2000. An oscillator example and Bollinger Band template are included in the editor menu and in-app field guide.

### Execution boundaries

Custom code is evaluated in a disposable Web Worker created inside a sandboxed, opaque-origin iframe—not in the React application window. The iframe's CSP denies network requests and external resources. A dedicated MessageChannel carries results, which are independently validated by the parent. Runaway jobs are terminated after approximately two seconds, and cancelled jobs are disposed when the chart context changes.

Limits: 40,000 source characters, eight plots, thirty inputs per script, and sixteen indicators per chart. The script library holds up to thirty scripts. Browser storage quotas still apply.

**Use scripts and backups you trust.** Browser isolation and a timeout are not a hardened resource-limited VM; malicious code can still consume memory/CPU inside its worker. This is not a production multi-tenant execution service. A restrictive deployment-wide CSP must account for the sandbox's inline bootstrap, blob workers, and worker-local evaluation; for stricter hosting policies, move the sandbox to a dedicated origin.

## Data and performance

Coinbase prices, OHLCV, and 24h statistics come from the adapter described above. Unavailable statistics remain blank; the live view does not reuse demo prices, fake sparklines, or estimated market caps.

For explicit offline demo mode only, `src/lib/market.ts` generates 900 reproducible OHLCV bars per instrument/timeframe, ending at a reference snapshot on **September 7, 2026**. Demo prices change locally every five seconds while the page is visible and are always labeled synthetic.

The chart instance is retained between updates. Incremental updates are used when only the last candle changes; historical corrections trigger a full series update. Built-ins are memoized. Custom indicator calculations are batched approximately every 2.5 seconds in disposable workers (manual **Add to chart** runs immediately). Custom results align by candle timestamp, so rolling history and exchange gaps cannot shift plots to the wrong bars. Native chart rendering, animation-frame-throttled drawings, lazy-loaded dialogs, cacheable vendor chunks, and locally served fonts keep the UI focused and lightweight.

## Project structure

```text
src/
  App.tsx                       Workspace state and interactions
  components/
    ChartView.tsx               Canvas engine, indicator panes, drawings, image export
    IndicatorStudio.tsx        Code editor, object tree, OHLCV data window
    Sidebar.tsx                Watchlist, symbol detail, alerts, trading notes
    Dialogs.tsx                Lazy-loaded search, library, settings, docs, sharing
    ui.tsx                     Accessible dialogs, menus, buttons, notifications
  lib/
    market.ts                  Asset metadata, explicit demo feed, quote formatting
    useCoinbaseMarket.ts       Abortable history loading, live SSE, retry/stale states
    market-settings.ts         Non-destructive migration to source-scoped pairs
    indicator-runtime.ts       Self-contained technical-analysis helpers
    indicators.ts              Built-in plot calculations and script templates
    cm-ult-macd.ts              Original CM MACD math, inputs, colors and MTF projection
    smart-money-concepts.ts     Independent SMC pivots, BOS/CHoCH, OB/FVG and overlay models
    sr-breaks-retests.ts        ChartPrime SR Breaks and Retests port: zones, breaks, retests
    pivot-points-missed-reversals.ts  LuxAlgo pivot highs/lows, missed reversals, zig-zag and levels
    indicator-plot-series.ts    Fixed-width histogram and absolute-dot canvas renderers
    script-runner.ts           Isolated execution and result validation
    workspace-backup.ts        Backup schema validation and rollback-safe persistence
    storage.ts                 Versioned local persistence and downloads
    types.ts                   Shared domain types
  styles.css                   Responsive terminal design
  **/*.test.ts                 Unit tests
shared/coinbase.ts              Validated transport types, aggregation, live candle tracker
server/                        Coinbase REST/WS adapter, SSE API, Vite/production servers
tests/workspace.spec.ts         Existing offline-workspace integration tests
tests/coinbase.spec.ts          Coinbase UI/transport fixtures and failure tests
```

Tests cover CM MACD reference values, colors, MTF/replay boundaries and canvas rendering; OHLCV invariants, Coinbase aggregation/pagination and product validation, real SSE framing with a controlled WebSocket, stream rollover/deduplication, explicit network failures, stale/replay behavior, indicators, script isolation, drawing interactions, persistence, exports/imports, and mobile layouts. Coinbase browser tests intercept the transport; fixtures are test-only and are never served by the application.

## Next production milestones

1. Verify end-to-end against Coinbase from a network-enabled deployment; add production monitoring, durable caches, abuse controls, and deeper outage/load testing. The current integration has automated fixture coverage, not live validation from this restricted sandbox.
2. Deeper chart tooling: multi-chart layouts, configurable sessions, drawing selection/editing, more indicator visualization types, and larger-history loading.
3. Optional authenticated storage and cloud sync, with explicit ownership and sharing permissions.
4. A separate strategy/backtesting engine with realistic fees, slippage, and reproducible results. Pine Script compatibility is not implemented.
5. Broader browser/device accessibility testing, performance profiling against larger datasets, and deployment/security hardening before any trading integration.

## Whale flow box

A floating, draggable readout of a **whale sweep in progress on the charted Coinbase product**. It answers "is big money hitting the bid or lifting the offer _right now_, and how much" — showing a signed figure such as `+$1.24M` or `-$20.0M`, the bought/sold split, and the individual large prints with time, size and value.

**It is deliberately ephemeral.** The box is not a running total: it shows a figure only while a sweep is happening, and clears once the sweep is over. A five-second window is aggregated so the leading edge of a whale walking the book is flagged while it is still filling, and the reading moves through three states — `Building` (a directional sweep has started but has not yet cleared the size threshold), `Happening now` (it has), and `Done` (it stopped; the peak figure lingers ~4s and then disappears). At rest the box collapses to a dim "watching" pill with no number at all.

- **Executed flow, not on-chain flow.** Every figure comes from fills on Coinbase's `matches` channel, which Atlas already consumes for OHLCV. It is real price impact as it happens — but it cannot see wallet deposits, custody transfers, OTC blocks, or other venues. The box states this in its info panel; see [whale flow sources](docs/whale-flow-sources.md) for the layers it does **not** cover.
- **Direction is the taker's.** Coinbase reports the _maker_ side on a match, so `side: "sell"` is a taker buy (an up-tick). Atlas inverts this once, in `parseTrade`, and every downstream figure uses the aggressor's perspective. Trades with a missing or malformed side still count toward volume but are excluded from directional flow.
- **The threshold adapts per product.** "Large" is the 99th percentile of recently observed trade notionals on that specific product, floored at $25,000, so BTC-USD and a thin altcoin are each measured against their own book. Until ~200 trades have been sampled the box is explicitly labeled **calibrating** rather than showing a fabricated threshold.
- **It never shows stale numbers.** The readout is suppressed unless the feed is `live`; a paused, stale, reconnecting or replaying chart clears it instead of leaving a frozen dollar figure on screen. Flow is cleared on symbol change and is not shown in demo mode or during bar replay.

Drag it by the grip, collapse the print list, or hide it entirely from the header — the choice persists. Re-show it from the workspace menu (**Show whale flow box**).

**It reports what is executing, not what is about to execute.** The `matches` channel publishes fills that have already happened, so nothing here is a forecast of an order arriving in the next few seconds — the lead time is the length of the sweep itself, which for a large order being worked across the book is typically a few seconds of warning between its first fills and its last. Genuine pre-trade visibility now comes from the resting order-book size (`level2`), built as the [order-book depth & zone strength](#order-book-depth--zone-strength) feature; an on-chain deposit feed remains catalogued in [whale flow sources](docs/whale-flow-sources.md) and is not wired up. Empirically, exchange-flow signals of this kind predict **volatility** far more reliably than direction, so treat a large reading as a warning that the market is about to move, not as a trade signal. Atlas places no orders and this is not investment advice.

## Order-book depth & zone strength

Indicators describe _where_ price reacted before; this feature measures whether anyone is
willing to defend that level **right now**, using the resting `level2` order book on the same
shared Coinbase WebSocket — no new vendor or API key.

- **S/R walls from the book.** The full book is clustered each second into `level2` price
  levels; clusters that stand out from the book's own texture are drawn as dashed
  support/resistance lines, labeled with their resting USD and the liquidity in front of them.
- **Strength per zone.** Every SMC order block / FVG and SR box gets a `STRONG/MED/WEAK` chip
  showing how much USD is currently resting inside its price range (bids for support-side zones,
  asks for resistance-side), weighted by how long that size has rested unchanged. Zones with no
  resting liquidity show no chip — the book is not defending them at this moment.
- **Readout panel.** A floating "Book" panel (workspace menu → _Hide/Show book depth &
  strength_) lists the current walls, bid/ask totals, and a near-mid imbalance meter. Like the
  whale flow box it is a live-connection element: it only appears while a real Coinbase feed is
  active, never during replay, and clears entirely when the book is unavailable so no stale
  depth is implied.
- **Demo mode.** Offline demo mode shows the chart walls and per-zone strength chips over an
  explicitly **synthetic** book (built from the demo candles' swing extremes), so the analysis
  layer stays explorable without a connection; the floating panel itself is Coinbase-live only.
  Coinbase mode never mixes in synthetic data.

Resting size is an invitation, not a lock: levels can be pulled or walked within seconds, the
book sees only Coinbase, and hidden intent is invisible. See
[the implementation notes and exact strength rules](docs/order-book-strength.md).

## Research notes (not implemented)

[Whale flow sources](docs/whale-flow-sources.md) surveys where large-holder inflows and outflows can be observed — raw on-chain transfers, labeled exchange-flow aggregates, the Coinbase Premium Index, ETF flows, derivatives positioning, and the executed tape — with published lead times, documented false positives, per-source pricing, and how each would (or would not) fit the same-origin adapter. **No whale or on-chain feed is wired into Atlas, no vendor account exists, and no API key is stored in this repository.** The note also records that the largest immediate opportunity needs no vendor at all: the Coinbase `matches` stream already parsed in `shared/coinbase.ts` carries per-fill size that is currently discarded after OHLCV aggregation.

Atlas is independent of TradingView and Coinbase. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the bundled licenses. Lightweight Charts attribution is provided in the status bar and About dialog.
