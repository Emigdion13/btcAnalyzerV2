# Atlas · btcAnalyzerV2

A professional, Coinbase-connected charting workspace inspired by TradingView. Built with React, TypeScript, a Node.js market-data adapter, and TradingView Lightweight Charts™.

**Coinbase is the default data source for crypto pairs; gold and silver come from Kalshi's settlement ladders. Offline demo data is available only by explicit selection; connection failures never substitute synthetic prices. Custom indicators use JavaScript, not Pine Script. No orders are placed.**

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
- A shared server-side WebSocket consumes `ticker`, `matches`, and `heartbeat` channels. The server batches quote/candle changes into one same-origin SSE update per second. New trades update OHLCV and create new candles at interval boundaries, and the server accumulates each forming bar's taker buy/sell notional from trade `side` — the per-bar **tape** the Candle Pulse HUD reports.
- Catalog and REST requests are cached/coalesced, upstream requests are rate-limited, reconnects back off, heartbeats detect a stalled stream, and periodic/reconnect REST reconciliation repairs missing trade history.
- Closed-data gaps are **not** replaced with invented flat candles. Sparse products can have fewer returned bars than requested.
- **Current candles are provisional.** A REST candle does not expose a last-trade ID. To avoid double-counting volume, stream events preceding REST receipt are skipped; this can briefly undercount the receipt window until authoritative REST reconciliation. Do not treat the open candle as finalized data.
- Alerts and custom indicator alarms pause when the selected feed is disconnected/stale/paused, and during replay. Demo quotes cannot trigger Coinbase alerts, and a Coinbase alarm cannot be triggered by demo candles. Replay freezes a snapshot; incoming live updates do not move its history.

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
- `https://external-api.kalshi.com` (public, unauthenticated: strike overlay, gold and silver settlements, and the 15m floating window's order book / trades / series)
- `https://api.elections.kalshi.com` (public, unauthenticated, **undocumented**: the live settlement index the Kalshi 15m window shows as "Now". Kalshi may change it without notice; when it stops answering, crypto falls back to a labelled Coinbase print and the metals show no value — see [Kalshi 15m floating window](docs/kalshi-float-window.md))

If DNS, TLS, regional restrictions, or network policy prevent access, the UI displays **Coinbase is unavailable** (or a stale-data banner if verified history was already loaded). Use **Retry Coinbase**, check the hosting network, or explicitly switch to **Offline demo**. No API keys can fix blocked network access. This Arena sandbox currently fails direct Coinbase TLS connections; the failure state is intentional and the integration is tested with controlled Coinbase-format fixtures, not claimed to be live-verified here.

### Same-origin API

- `GET /api/coinbase/products`
- `GET /api/coinbase/quotes?products=BTC-USD,ETH-USD`
- `GET /api/coinbase/candles?product=BTC-USD&interval=3m&limit=300`
- `GET /api/coinbase/stream?product=BTC-USD&interval=3m&limit=300&products=BTC-USD,ETH-USD`

All endpoints are read-only. Product syntax, catalog availability, intervals, sample limits, upstream payloads, and imported workspace data are validated. Public API hosting still needs deployment-level abuse protection before serving large anonymous audiences.

## Gold and silver from Kalshi

`XAU-USD` and `XAG-USD` are live markets too — just from a different venue. Coinbase lists no silver product and only tokenised gold (PAXG), so the metals are read from **Kalshi's public 15-minute ladders** (`KXGOLD15M`, `KXSILVER15M`), which settle per troy ounce in USD on **Pyth's 1-minute candle close** (matching TradingView spot gold and the source Kalshi 15m uses). Full detail, including the settlement chain and the paging rules, is in [`docs/kalshi-metals.md`](docs/kalshi-metals.md).

- Every number shown is a value Kalshi put on the record: a window's `floor_strike` (its open) or its graded `expiration_value` (its close). Nothing is interpolated or borrowed from a crypto feed.
- Bars exist only where two published points sit exactly one quarter hour apart; `high`/`low` are the envelope of those two points, and that bound is labelled as such in the UI.
- **No volume** for metals. Kalshi's `volume_fp` counts contracts on the ladder, not ounces traded, so the field is left empty rather than mislabelled.
- Supported resolutions are **15m, 1h, 4h, 1D, 1W**. Kalshi publishes nothing finer, so 1m/3m/5m are hidden for a metal, disabled with an explanation in the dropdown, and refused client-side — never resampled into existence.
- The window forming right now has a strike but no settlement: it is exposed as a strike overlay, never drawn as a partial bar.
- Gaps in the ladder stay gaps, and the quote carries the settlement time, so a price up to a quarter hour old says how old it is.
- The venue is named wherever a price appears: status bar, chart badge, watchlist detail, symbol search, markets table, and exported images read **Kalshi** for metals and **Coinbase** for pairs.

Kalshi endpoints for its published ladders and the floating window:

- `GET /api/kalshi/metals`
- `GET /api/kalshi/metals/history?symbol=XAU-USD&interval=15m&limit=300`
- `GET /api/kalshi/strike?product=BTC-USD`
- `GET /api/kalshi/float?product=BTC-USD` — the running 15-minute market: strike, the displayed % (live order book + last trade), the net payout multipliers, and the settlement index ("Now")

## What works

- **Canvas charting:** candlesticks, hollow candles, OHLC bars, line, and area charts; interactive crosshair, pan, zoom, linear/log/percentage price scales, auto-fit, and focus mode.
- **Markets:** Coinbase USD products, gold and silver from Kalshi's settlement ladders, live quote subscriptions for open charts/watchlists/alerts, venue-aware symbol search, sortable watchlists, and a market overview. Twelve synthetic instruments remain available in explicit demo mode.
- **Timeframes:** 1m, 3m, 5m, 15m, 1h, 4h, 1D, and 1W. Range shortcuts choose an appropriate interval and viewport. The metals support 15m and coarser, which is all Kalshi publishes.
- **Timeframe peek:** a floating window onto any other resolution — while you trade 1m it draws the last candles of, say, 15m _including the bar still forming_, with a countdown to that timeframe's close, a resolution dropdown, and an auto mode that follows the chart.
- **Candle Pulse:** a cockpit-HUD floating window that reads the single bar being built right now — countdown to its close, O/H/L/C anatomy with close-position-in-range, volume pace vs the typical bar (with a projection to the close), the taker buy/sell tape inside this bar, the nearest defensible support/resistance zones (scored on confluence of pivots, prior day, and resting book, with a "held X/Y" track record), and a composite **BAR TILT** gauge — `UP-LEAN / DOWN-LEAN / NO EDGE` — that says which way the evidence points, explicitly labelled **context, not a signal**. **Alt C** toggles it; draggable and minimizable.
- **Built-in indicators:** SMA, EMA, Bollinger Bands, Wilder RSI, **RSI Divergence (Wilder RSI with regular + hidden divergence)**, conventional MACD/signal lines (with optional **regular + hidden histogram divergence**), **CM_Ult_MacD_MTF (ChrisMoody’s original, also with divergence)**, **WaveTrend [LazyBear] (10, 21)**, **Zeiierman Trend Pressure** (Z-Pulse, Z-Trend, Pressure Core and exhaustion boxes), **CM_Williams_Vix_Fix (ChrisMoody’s published (22, 20, 2, 50, 0.85, 1.01) market-bottom finder)**, **TUX EMA Scalper+SuperTrend (3, 7, 20, close)** with EMA-cross BUY/SELL arrows and green/pink SuperTrend context, an independent **Smart Money Concepts** price-action overlay, **SR Breaks and Retests (ChartPrime’s published (20, 2, 1) indicator)**, **Pivot Points High Low & Missed Reversal Levels (LuxAlgo’s open-source (50) indicator)**, daily UTC-reset VWAP, volume, and **Bayesian/nQQE/BankFunds** (a reconstructed BBSMA + nQQE + banker-fund oscillator; the pane and its floating window share one calculation). Indicator settings and visibility are editable.
- **Indicator Studio:** highlighted JavaScript editor, named numeric inputs, custom price overlays and oscillator panes, templates, a saved-script library, and compilation feedback.
- **Drawings:** price-pane trend lines, horizontal levels, rectangles, Fibonacci retracements, measurements, and text notes. Undo/redo, visibility, locking, and an object tree. Drawings are scoped to symbol + timeframe.
- **Order-book depth & zone strength:** live support/resistance walls constructed from the resting `level2` book, plus a per-zone strength reading (`STRONG/MED/WEAK`) on every SMC order block, FVG, and SR box — how much of each price-action level the book is actually funding right now. A floating readout shows walls, totals, and near-mid bid/ask imbalance. Live on Coinbase (panel + overlay); demo mode shows the overlay over an explicitly synthetic book. See [order-book notes](docs/order-book-strength.md).
- **Whale execution map:** when the executed-tape detector sees a live large directional sweep, the chart and Whale flow box show the exact Coinbase match prices, a complete size-weighted execution VWAP, and the fill range. This is intentionally separate from level2: the execution map says where money already traded; the book says where visible liquidity is still resting. See [whale execution map](docs/whale-execution-map.md).
- **RSI meter:** the RSI reading as a floating window on the chart instead of a whole oscillator pane — value, bar-over-bar change, the 30/50/70 meter and the overbought/oversold call, draggable and minimizable. The toolbar **RSI** button (and the workspace menu) own the window; RSI also stays in the indicator library, and the two share one length, so promoting the window's indicator gives you the pane without re-typing a period.
- **MTF RSI window:** one floating panel with the RSI and a tendency call for 1m, 5m, 15m, 30m and 1h at once. The tendency — bullish / bearish / in range — is deliberately not read off RSI alone: a fused trend-quality score (Wilder ADX(14) 45%, Kaufman efficiency ratio 35%, ATR-normalized EMA(20) slope 20%) drives a hysteretic trend/range gate (≥55 in, <45 out), direction is a two-of-three vote of +DI/−DI, the slope's sign and RSI outside its 45–55 no-man's land, and a label only moves after two consecutive disagreeing readings. Higher timeframes carry more of the overall bias (1h weighs five times the 1m; ranges abstain). **Alt R** toggles it; see [MTF RSI window](docs/mtf-rsi-window.md).
- **Chile panel:** the corner readout of _ROBEX IA CHILERA V17 PRO_ as a floating window — the call for the next round (UP / DOWN / WAIT), the countdown to it, each side's share of the 14-contributions-a-side score, buyers/sellers from close position in the bar, volume vs its 20-bar average, the round-timeframe RSI, the trend call and the S/R state, with the contributions behind the call as chips. It borrows the chart's Chile Reversal profile and reads the newest bar of that indicator's own engine result, so the panel and the overlay can never disagree. Beside the V17 call it shows **THIS ROUND** — the odds the current round settles above its strike, from how far price has moved and how much time is left; on a Kalshi crypto window against Kalshi's published strike and 60-second settlement average, with **Kalshi's own price** beside them — an **RSI EXTREME** marker when the round opened on a 5m RSI below 30 or above 70, and a **scorecard** grading all three against what the rounds did. On 180 days of Coinbase BTC-USD the V17 call was right 47.2% of the time, the odds' favourite won 76.2% and the RSI extremes 58.6%; against 60 days of Kalshi prices the market was still the better forecaster. The harness that measures it is `src/lib/chile-backtest.test.ts`. **Alt L** toggles it; see [Chile panel](docs/chile-panel.md).
- **Kalshi 15m window:** the running Kalshi 15-minute up/down contract as a floating window, in the shape Kalshi's own page shows it — the target (the exact `floor_strike`) with its open time in Kalshi's US-Eastern clock, the **Now** value of the index the market settles on (the same public endpoint Kalshi's page reads, with a labelled Coinbase fallback for crypto), the Up/Down % **as Kalshi displays it** (last trade clamped to the live order book), the net payout multipliers, and a countdown to the cut with the window's progress bar. Coin chips follow the user, not the chart. Read-only market data polled once a second; a six-second-old snapshot is dimmed and stamped **STALE**, never drawn as live. **Alt K** toggles it; see [Kalshi 15m floating window](docs/kalshi-float-window.md).
- **CM MACD, WaveTrend, RSI Divergence & VIX Fix windows:** the last twenty minutes of `CM_Ult_MacD_MTF`, `WaveTrend [LazyBear]`, `RSI Divergence`, and `CM_Williams_Vix_Fix` as floating windows on the chart, each zoomed to its own scale — bars wide enough to read a single wave, the original colour rules (aqua/blue/red/maroon histogram, lime MACD and yellow signal with the crossover dots; green wt1, dotted red wt2 and the blue area between them; violet RSI line with 70/50/30 levels and divergence detection; lime/gray fear histogram with the aqua upper band and orange range-high), and the overbought/oversold bands as soon as the window's own scale reaches them. They plot the values the pane plots, so a window and a pane can never disagree, and the numbers follow the bar your crosshair is on. The toolbar **Floating** selector — one dropdown for every floating window — owns the windows (or **Alt M**, **Alt W**, **Alt D**, **Alt V**, **Alt N**). **Alt N** opens Bayesian/nQQE/BankFunds on that same shared calculation, scaled to the window's own highs and lows rather than mirrored about zero. Each one drags, minimizes, zooms by ±4 bars, and keeps its position and zoom. With no matching indicator on the chart a window runs the published defaults and offers the pane, so its settings stay one click away.
- **Bar replay:** step backward/forward, pause/play, and 1×/2×/5×/10× playback through a frozen snapshot of the loaded history.
- **Alerts:** one-time in-app price-condition notifications against the selected, connected feed. No email, background monitoring, or trading integration.
- **Custom indicator alarms (Alt B):** build your own trigger on **MACD**, **RSI** or **CM_Williams_Vix_Fix** — a _cross before it happens_, a green/red turn, a ChrisMoody histogram colour, a level, a lime fear spike. Each alarm names its own pair and timeframe, so an RSI 15m alarm on BTC-USD keeps watching while you chart ETH 1m; the open chart's pair is read from the live stream and any other pair is polled every 45 seconds. Conditions are "about to cross" with **no threshold to tune** — the gap is measured in bars of typical movement — and up to **four conditions combine in one alarm**: _All of them_ must hold on the same bar (a MACD cross gated on RSI), or _Any of them_ fires on its own. A fire is once per bar, optionally with a synthesised chime. Never email, never an order. See [custom indicator alarms](docs/indicator-alarms.md).
- **Your work:** locally saved drafts, scripts, charts, drawings, preferences, watchlists, alerts, indicator alarms, and notes. Explicit **Save** adds or updates a script in the library; drafts are also retained automatically.
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

## MACD histogram divergence

Both MACD built-ins — the conventional **MACD** and **CM_Ult_MacD_MTF** — can overlay **regular** and **hidden** divergences detected on the MACD histogram. Open either indicator's settings to toggle each type, adjust the pivot lookback and the min/max bar gap between compared pivots, and choose whether to draw connecting lines, labels, or both.

- **Regular bullish** — price makes a lower low while the histogram makes a higher low (possible reversal up).
- **Regular bearish** — price makes a higher high while the histogram makes a lower high (possible reversal down).
- **Hidden bullish** — price makes a higher low while the histogram makes a lower low (uptrend continuation); drawn with a dashed line.
- **Hidden bearish** — price makes a lower high while the histogram makes a higher high (downtrend continuation); drawn with a dashed line.

Pivots are confirmed only after `pivotLookback` bars close on **each** side, so the newest bars stay unconfirmed and the overlay can repaint as new candles arrive. Divergence is drawn on the oscillator pane, is included in chart screenshots, and its settings persist in workspace backups. It is informational deterministic analysis, not a trading signal.

## Smart Money Concepts (SMC)

Atlas now includes an **independent, native Smart Money Concepts overlay**. It is a clean-room implementation of commonly used price-action methods—not a copy of, or an affiliation with, another publisher’s proprietary indicator or source code.

Add it from **Indicators → Smart Money Concepts**, or use the preloaded overlay in a new workspace. Its starting configuration matches the requested familiar profile: **Historical**, **Colored**, internal/swing structure **All**, **Tiny/Small** labels, **50**-bar swings, **5** internal and **5** swing block slots, **Atr** filtering, **High/Low** mitigation, equal-level confirmation **3** / threshold **0.1**, current-chart FVG timeframe with **1** extension bar, and solid daily/weekly/monthly level styles.

The overlay draws confirmed-pivot internal and swing **BOS/CHoCH**, optional **HH/HL/LH/LL** pivot labels, active opposite-candle order blocks, ATR-scaled **EQH/EQL**, three-candle fair-value gaps, prior daily/weekly/monthly high-low levels, and premium/equilibrium/discount bands. Fair-value gaps can use the active chart (the default) or a separately loaded native timeframe—never a silently resampled chart series. It can recolor candlesticks from the latest confirmed internal bias. The **Present** mode intentionally retains only the latest markup set; **Historical** retains a capped recent history so the chart remains responsive.

This is deterministic OHLCV analysis, not a prediction service. Pivots are only known after their confirmation bars, calculations vary by venue/history, and every level is informational rather than a trading signal or investment advice.

## SR Breaks and Retests

Atlas includes a **faithful native port of ChartPrime’s “Support and Resistance (High Volume Boxes)”**, the TradingView indicator whose short title renders as **SR Breaks and Retests [ChartPrime] (20, 2, 1)**. ChartPrime publishes the Pine Script v5 source under the Mozilla Public License 2.0, and the Atlas engine reproduces that published calculation statement by statement—delta volume, clivots, volume-gated zones, ATR(200) depth, break/hold crosses, role-reversal memory, and every marker offset and color.

Add it from **Indicators → SR Breaks and Retests**. The three published inputs—**Lookback Period 20**, **Delta Volume Filter Length 2**, **Adjust Box Width 1**—are editable and persist like every other indicator. Zones render as SVG boxes with volume-graded fills and “Vol:” labels; breaks print **Break Sup / Break Res** labels; holds and successful retests print ◆ diamonds, all at the original’s exact anchors. Every message drawn inside the chart — those break labels included — is transparent: the published colors outline the label and tint the glyphs, but no plate is filled over the price action, so the candles behind a message always stay visible.

Because Atlas loads a finite candle window (900 bars by default) while TradingView computes over much deeper history, one documented difference exists: the original hides the very first “Break” label of a session (`not na_flag` is `na` in Pine), which is invisible on TradingView’s deep history but would read as a missing label here. Atlas shows that first label so short windows match what the original displays on screen. Everything else— including quirks like a replacement zone printing a retest diamond instead of a second break label—matches the original behavior.

See [the compatibility notes, calculation contract and provenance](docs/sr-breaks-retests.md).

## Pivot Points High Low & Missed Reversal Levels

Atlas includes a **faithful native port of LuxAlgo’s “Pivot Points High Low & Missed Reversal Levels [LuxAlgo]”**, the open-source TradingView indicator whose legend renders as **Pivot Points High Low & Missed Reversal Levels [LuxAlgo] (50)**. LuxAlgo publishes the Pine Script v5 source under CC BY-NC-SA 4.0, and the Atlas engine reproduces that published calculation statement by statement—`ta.pivothigh/pivotlow(length, length)` reversals, the running max/min and follow-up extremes between pivots, the two ways a reversal is missed (two pivots of the same kind in a row, or a pivot forming inside the prior swing), the zig-zag with its dashed detours, the missed-reversal levels, and the trailing reversal estimate.

Add it from **Indicators → Pivot Points High Low & Missed Reversal Levels**. The published inputs—**Pivot Length 50**, the **Regular Pivots** and **Missed Pivots** toggles with their high/low colors, and the **Text Label Color**—are editable and persist like every other indicator. Confirmed pivots print **▼ / ▲** labels `length` bars behind the live edge; every reversal the method skipped prints a **👻**, the zig-zag detours through it with dashed legs, and a horizontal level starts there and runs to the next missed reversal; the newest 👻 is an estimate of the reversal in progress that readjusts with every new higher high or lower low and carries its own level to the latest bar. As with every message drawn inside the chart, the labels are transparent: the published colors outline the label and tint the glyphs, but no plate is filled over the price action.

One documented difference exists, again because Atlas loads a finite candle window: Pine starts the zig-zag at bar 0, price 0—an artifact buried thousands of bars back on TradingView but a visible slash across a 900-bar window—so Atlas starts the zig-zag at the first confirmed pivot. Everything from that pivot on matches the original.

See [the compatibility notes, calculation contract and provenance](docs/pivot-points-missed-reversals.md).

## Chile Reversal

Atlas includes **Chile Reversal**, the Pine v6 script _ROBEX IA CHILERA V17 PRO_ ported whole as a native price overlay: the round-timeframe pivot levels, the four price-vs-level patterns, the 14-contributions-a-side score that calls the next round, and every plot the script paints.

Add it from **Indicators → Chile Reversal**. Pivot highs and lows from a higher timeframe (default **15m**, matching Pine's hard-coded `"15"`) become **R1/R2** and **S1/S2** exact-price lines; candidates further than **2.5 ATR** from price are discarded, and a 6-bar high/low range fills an empty slot as a dashed fallback line. Those levels feed four patterns worth **+3** each — a bounce off support, a rejection at resistance, and the two break comparisons — into the score alongside the ROBEX supertrend, the round EMA stack and RSI, the 5m momentum read, chart pressure, VWAP, buyers/sellers from close position and the round's own shape. The call needs **6** points and a **2**-point lead, and a lateral market suppresses both. An **ARRIBA**/**ABAJO** label prints only where the script prints one: a chart bar that closes a round, once that bar has confirmed. Higher-timeframe levels are read only from **closed** bars, so a developing round candle's eventual extreme never reaches an earlier chart bar; the 5m momentum read is the deliberate exception, because the original asks for it without `[1]`.

The overlay also draws what the script draws: the ROBEX Trend supertrend line, EMA 9/21 with the fill between them, session VWAP, and the R1/R2/S1/S2 lines with their prices. Each is switchable, and the level lines span `largoLinea` bars back.

The score's corner panel is the floating **Chile panel** window (**Alt L**, or the toolbar **Floating** selector): the same engine's `table`, read off the newest bar of the same result, so the window and the chart can never disagree about a level or a call. It starts open on roomy viewports (1050×940+, the Candle Pulse rule — a laptop chart has no free corner left for it) and is one keystroke away everywhere, drags, minimizes to the call, the countdown and the this-round odds, and remembers its position. See [Chile panel](docs/chile-panel.md).

See [the calculation contract, the one documented correction, and provenance](docs/chile-reversal.md).

## Chart scaling maintenance note

If candles collapse into a thin band, distinguish a stretched **price range** from a short **price pane** before changing layout. The prior autoscale fixes and the regression checks for indicator overlays, glitch wicks, and PR 60's Trend Pressure oscillator are documented in [Chart scaling notes](docs/chart-scaling.md). For a manually pinned range, use **Fit** or **Latest** to restore auto-fit.

## Zeiierman Trend Pressure

Add **Trend Pressure** from Indicators for the oscillator and price boxes; open **Floating → Trend Pressure** for a draggable, zoomable readout of the same pulse, trend and pressure-core values. Its Pine v6 inputs are editable. See [compatibility and license notes](docs/zeiierman-trend-pressure.md).

## WaveTrend [LazyBear] (10, 21)

Atlas includes **WaveTrend [LazyBear]**, a faithful native port of LazyBear's open-source Pine v1 script (`study(title="WaveTrend [LazyBear]", shorttitle="WT_LB")`), itself the TradingView port of the TS/MT WaveTrend oscillator.

Add it from **Indicators → WaveTrend [LazyBear]**. On each candle's `hlc3`, the port reproduces the published recurrence in order: `esa = ema(ap, 10)`, `d = ema(|ap − esa|, 10)`, `ci = (ap − esa) / (0.015 × d)`, **WT1** `= ema(ci, 21)`, **WT2** `= sma(WT1, 4)`, and the difference between them. Both EMAs use legacy Pine seeding (the first observation is the first value, `alpha = 2/(length+1)` afterwards), not Atlas's SMA-seeded Studio EMA. WT1 plots green, WT2 plots as the original's legacy dotted `style=3` markers, and `WT1 − WT2` fills from zero in transparent blue, exactly as published. The ±60 and ±53 overbought/oversold levels are drawn as the original's solid (level 1) and dotted (level 2) reference lines, in the original Pine colors.

The six published inputs — **Channel Length 10**, **Average Length 21** and the four levels — are editable and persist like every other indicator. The **4**-bar signal and the **0.015** channel scale are hard-coded in the original, so they are not inputs. The open bar repaints, because `hlc3` includes the forming candle: treat the last value as provisional.

See [the calculation contract, the flat-channel convention, and provenance](docs/wave-trend.md).

## CM_Williams_Vix_Fix (22, 20, 2, 50, 0.85, 1.01)

Atlas includes **CM_Williams_Vix_Fix**, a faithful native port of ChrisMoody's published Pine v1 script, which generalizes Larry Williams' synthetic VIX to any asset to find market bottoms.

Add it from **Indicators → CM_Williams_Vix_Fix**. The port reproduces the published recurrence in order: `wvf = ((highest(close, 22) − low) / highest(close, 22)) × 100`, the Bollinger band `sma(wvf, 20) ± 2 × stdev(wvf, 20)`, `rangeHigh = highest(wvf, 50) × 0.85` and `rangeLow = lowest(wvf, 50) × 1.01`. A bar at or above the upper band or the range-high paints lime — the fear spike — and everything else stays gray. The orange range lines and the aqua upper band draw only when the original's own `hp`/`sd` toggles are on; both ship off, exactly as published.

All eight published inputs are editable, and the toolbar **VIX Fix** button (Alt V) opens the same values as a floating window at its own one-sided scale from zero, with a verdict that names a fresh lime bar a potential bottom. The open bar repaints, because the ratio includes the forming candle: treat the last value as provisional.

See [the calculation contract and provenance](docs/cm-williams-vix-fix.md).

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

## Memory maintenance

Every run mode schedules a **memory purge every 30 minutes** (`ATLAS_MAINTENANCE_MINUTES` to change, `0` to disable). The sweep drops everything no live chart still needs — cached histories, quotes, and trade bookmarks for pairs nobody is watching, REST and Kalshi pages past their useful lifetime, and stranded index-sample buffers — then, because all of this repo's scripts start Node with `--expose-gc`, forces a full garbage collection so the freed heap goes back to the operating system immediately. Subscribed charts keep every byte of live state; anything purged is simply re-fetched on demand. Each sweep prints one log line:

```
[atlas] memory purge — charts:3 quotes:2 tradeBookmarks:2 failedReconciles:0 restPages:41 kalshiPages:6 indexBuffers:0 · rss 212.4 MB → 118.9 MB
```

## Project structure

```text
src/
  App.tsx                       Workspace state and interactions
  components/
    ChartView.tsx               Canvas engine, indicator panes, drawings, image export
    IndicatorStudio.tsx        Code editor, object tree, OHLCV data window
    Sidebar.tsx                Watchlist, symbol detail, alerts, trading notes
    Dialogs.tsx                Lazy-loaded search, library, settings, docs, sharing
    TimeframePeekBox.tsx       Floating second-resolution window, forming bar included
    ChilePanelWindow.tsx       Floating Chile panel: next-round call, this-round odds, scorecard
    IndicatorAlarmDialog.tsx   Custom MACD/RSI/VIX Fix alarm builder, with live preview
    IndicatorAlarmList.tsx     Indicator-alarm cards inside the alerts panel
    ui.tsx                     Accessible dialogs, menus, buttons, notifications
  lib/
    market.ts                  Asset metadata, demo feed, venue routing, quote formatting
    useCoinbaseMarket.ts       Abortable history loading, live SSE, retry/stale states
    useKalshiMetalMarket.ts    Silver settlement polling, staleness, watchlist quotes
    useKalshiStrike.ts         Kalshi's published strike, polled at the window rhythm
    market-settings.ts         Non-destructive migration to source-scoped pairs
    indicator-runtime.ts       Self-contained technical-analysis helpers
    indicators.ts              Built-in plot calculations and script templates
    cm-ult-macd.ts              Original CM MACD math, inputs, colors and MTF projection
    wave-trend.ts               LazyBear WaveTrend math, inputs, colors and area/cross plots
    bayesian-nqqe-bankfunds.ts  Reconstructed BBSMA + nQQE + banker fund; pane and window share it
    cm-williams-vix-fix.ts      ChrisMoody Williams VIX Fix math, inputs, colors and histogram
    macd-divergence.ts          Histogram pivots and regular/hidden divergence detection
    smart-money-concepts.ts     Independent SMC pivots, BOS/CHoCH, OB/FVG and overlay models
    sr-breaks-retests.ts        ChartPrime SR Breaks and Retests port: zones, breaks, retests
    pivot-points-missed-reversals.ts  LuxAlgo pivot highs/lows, missed reversals, zig-zag and levels
    indicator-plot-series.ts    Fixed-width histogram and absolute-dot canvas renderers
    indicator-alarms.ts        Alarm condition catalog, series, cross/proximity evaluation
    useIndicatorAlarms.ts      Live-stream and polled alarm monitoring, firing and bookkeeping
    alarm-sound.ts             Web Audio chime, synthesised at fire time
    alarm-status.ts            What an alarm card reports about its own readiness
    timeframe-peek.ts          Auto resolution choice, window stats, forming bar and SVG geometry
    chile-reversal.ts          Chile V17 engine: levels, patterns, score, plots, closed-bar mapping
    chile-panel.ts             Readout over the newest scored bar: clock, fuerza, call
    chile-odds.ts              This-round odds: P(settle above strike) from distance and time left
    chile-kalshi.ts            Kalshi's strike, settlements and price for the Chile panel
    chile-rsi-extreme.ts       5m RSI extreme at the round open: signal, grading, priced journal
    chile-scorecard.ts         Grades the V17 call and the odds; per-profile saved journal
    floating-window.ts        Shared drag/dock/remember logic for the floating chart windows
    market-agents.ts           Agent/forecast engines: dormant, no UI wires them up
    script-runner.ts           Isolated execution and result validation
    workspace-backup.ts        Backup schema validation and rollback-safe persistence
    storage.ts                 Versioned local persistence and downloads
    types.ts                   Shared domain types
  styles.css                   Responsive terminal design
  **/*.test.ts                 Unit tests
shared/coinbase.ts              Validated transport types, aggregation, live candle tracker
shared/kalshi.ts                Kalshi feed tables: crypto ladders, metal ladders, windows
shared/kalshi-metals.ts         Settlement points, metal candles, quote, coverage, validation
shared/fixtures/                Verbatim upstream records used by the tests
server/                        Coinbase REST/WS adapter, Kalshi adapter, SSE API, servers
tests/indicator-alarms.spec.ts  Building, reading, pausing and persisting alarms in the browser
tests/workspace.spec.ts         Existing offline-workspace integration tests
tests/coinbase.spec.ts          Coinbase UI/transport fixtures and failure tests
```

Tests cover CM MACD reference values, colors, MTF/replay boundaries and canvas rendering; alarm
conditions, cross and proximity arithmetic, combined _all of / any of_ alarms, the firing path
(live stream, closed bars, replay and venue gating), the builder's form and validation, the alarm
chime and its fallbacks; OHLCV invariants, Coinbase aggregation/pagination and product validation, real SSE framing with a controlled WebSocket, stream rollover/deduplication, explicit network failures, stale/replay behavior, Kalshi settlement parsing, metal bar construction and ladder paging, metal poll cadence and refusal to request unsupported resolutions, indicators, script isolation, drawing interactions, persistence, exports/imports, and mobile layouts. Coinbase browser tests intercept the transport; fixtures are test-only and are never served by the application.

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

## Timeframe peek window

Charting 1m while a 15m structure decides the session is a scrolling problem: the context lives in another tab. The **peek window** puts it on the chart — a floating panel drawing the last few candles of any other resolution, **including the bar that is still forming**.

- **Any resolution, up or down.** The dropdown lists every timeframe Atlas supports and defaults to **Auto**, which picks the resolution nearest 15× the chart (1m → 15m, 5m → 1h, 1h → 1D), so the window is a different zoom rather than a squashed copy. **Alt P** toggles it; the header dropdown re-points it without leaving the chart.
- **The forming bar is labelled as forming.** It is drawn outlined with a live pip, and the meter below counts down to that resolution's close. Its high and low are the extremes so far and its close is the current tick — not a settled close — so nothing on screen implies the 15m candle has decided anything yet. Bars stay visible but go quiet (dimmed, carrying the feed's own state) while the stream is stale, reconnecting, or offline.
- **One stream, not a second one.** The window reads the same `IndicatorTimeframes` feeds the multi-timeframe indicators share: `requestedIndicatorTimeframes(indicators, chart, extra)` de-duplicates, so peeking at 1h while `CM_Ult_MacD_MTF` runs on 1h costs a single connection, and hiding the window releases it. **Bar replay never peeks at live candles** — the window is hidden while replaying, like the whale-flow and book readouts.
- **The rest is stated, not implied.** `1 bar = 15 chart bars` gives the ratio, volume is that resolution's volume, and the price axis is the window's own range rather than the chart's. Demo mode draws the synthetic bars and says so.
- **The momentum of the resolution you are watching.** The window carries a large RSI(14) readout computed on that resolution's full candle history — the forming bar's live close included — never on just the few bars on screen. The number is colour-coded by zone exactly like the RSI meter (overbought red, oversold green, bull lime, bear amber), glows and breathes at the extremes, and sits on a gradient gauge with 30/70 marks and a gliding marker. Until `period + 1` closes exist it says _warming up_ rather than guessing; the minimized chip keeps a compact coloured reading.

Drag it anywhere inside the chart (the position persists), minimize it to a single price line, or hide it from the toolbar Floating selector, the workspace menu, or its own close button. Below 1050px — the width the side panels collapse at — the window starts closed so it never sits on the price legend, and opening it there is remembered like any other preference. The window holds 4–40 bars and the volume strip toggles. Geometry, auto-resolution, and stats live in `src/lib/timeframe-peek.ts`; the panel is `src/components/TimeframePeekBox.tsx`.

## Candle Pulse

**Candle Pulse** answers the question the other readouts leave open: _what is this bar doing right now?_ It is a floating HUD on the single candle being built — countdown to its close, the bar's anatomy, how hard it is being traded, what is defending the price above and below it, and a composite gauge of where the evidence currently points.

- **Bar clock** — where inside the bar we are and how long until it closes, as a filling bar plus a live `mm:ss` countdown. On Coinbase the bar's own timestamp is authoritative; in the offline demo (whose synthetic bars are anchored to a fixed past date) the widget aligns the forming bar to the real current bucket so the clock behaves like a live feed.
- **Bar anatomy** — O/H/L/C, the close's position inside the bar's own range (with the open marked), and the body/range ratio.
- **Volume pace** — volume so far against what this share of a median bar has normally traded, the pace multiple (`1.42×`, glowing hot past `1.25×`), and a white projection tick showing where the bar lands at the close if the current pace holds. The first 5% of a bar reads `TRACKING` rather than guessing.
- **Bar tape** — the taker buy/sell split executed _inside this bar_, with the net. The server accumulates per-bar taker notional from the `matches` channel (`CandleTracker.tape`, reset at every bar roll and every REST receipt — the same provisional caveat as the bar's volume, and omitted from the stream until the first side-bearing trade). Trades with no side still count toward volume but never toward the tape. The offline demo has no executed tape and says so.
- **Defense grid** — the two nearest support and resistance zones, each scored `0–100`: confluence of independent sources (confirmed fractal pivots of the recent closed bars, the prior UTC day, and resting order-book walls), repeated touches, USD of book at the zone, and proximity. The best zone on each side also carries a `held X/Y` count — of recent bars that traded into the zone from the right side, how many closed back out of it.
- **BAR TILT** — the composite in `[-100, 100]`: level pressure (the net cushion of strong support below vs strong resistance above), bar tape, bar momentum (direction × body × range position × pace), and range position. Labels are `UP-LEAN`, `DOWN-LEAN`, or `NO EDGE` (below ±12). Every factor shows its signed contribution, with the full reasoning on hover.
- **Base rate, and the honesty line** — the footer states how often recent bars closed up, and the panel is stamped **CONTEXT — NOT A SIGNAL**: the tilt says which way the evidence points, never what the close will be. The forming bar is provisional, so the panel dims when the feed is not live.

**Alt C** toggles the window (toolbar **Floating** selector and workspace menu also own it). A dropdown in the header lets you select what candle timing to analyze — either following the chart resolution (`Chart`) or analyzing any specific candle interval (`1m`, `3m`, `5m`, `15m`, `1h`, `4h`, `1D`, `1W`) independent of the main chart. It is draggable anywhere inside the chart (position persists), minimizes to a single price/tilt/countdown line, and stays out of the way during bar replay like the other live readouts. The HUD is the tallest floating window, so it earns the same "roomy viewport" default as the former AI decision window: it starts open only at 1050×940+ viewports and is one keystroke away in every viewport. An explicit show/hide wins over the default and is remembered. The readout is deterministic OHLCV + book arithmetic over the loaded window — `src/lib/bar-pulse.ts` (pure, unit-tested) and `src/components/BarPulseBox.tsx`.

## MTF RSI window

**MTF RSI** answers, all on one floating panel: for **1m, 5m, 15m, 30m and 1h**, what is the RSI and which way is that timeframe leaning — **bullish, bearish, or in range**. **Alt R** toggles it (the **Floating** selector and workspace menu also own it); it starts open on roomy viewports (1050×940+, the Candle Pulse rule), drags, minimizes to a bias line, and remembers its position.

- **The tendency is not read off RSI alone.** RSI is momentum, and momentum is regime-dependent — an uptrend's healthy pullback spends time below 50, which a bare "RSI > 50" classifier calls bearish (Cardwell's range rules make the same point: bulls oscillate 40–80, bears 20–60, so a reading's meaning depends on the regime). The regime is classified first, by measures that are not RSI.
- **Step 1 — is it trending?** A 0–100 trend-quality score fuses three independent measures: Wilder **ADX(14)** (45%), Kaufman's **efficiency ratio over 20 closes** (35%), and the **EMA(20) slope in ATR(14) units** (20%) — directional strength, path quality, and volatility-normalized velocity, each covering a blind spot of the others. The gate is hysteretic: **≥ 55 trending, < 45 ranging, in between the previous call stands** — a boundary value can never flip the verdict by itself.
- **Step 2 — which way?** Inside a trend, direction is a **two-of-three vote**: +DI vs −DI (needs a 2-point spread), the slope's sign (needs ≥ 0.02 ATR/bar), and RSI (votes only outside the 45–55 no-man's land). Abstentions are silence, not neutrals; a trend with no directional majority reads as range — conflicted, not half-bullish. An uptrend whose RSI dips to 42 does not flip the call: the DIs and slope still vote with the trend.
- **Step 3 — stability.** The displayed label only moves after **two consecutive disagreeing updates**, so one loud tick cannot repaint it. Rows with too little history (~28 closes) say **warming**; feeds that are stale, reconnecting or offline dim and say so — the header reads **DEGRADED** and the footer counts unfed rungs. Kalshi silver's missing 1m/5m resolutions read `no data` rather than a guess.
- **Each row** shows the timeframe, the Wilder RSI(14) over that resolution's full history (forming bar included — the peek's honesty rule), a 0–100 gauge with the 50 midline, the tendency chip, and a trend-quality bar. The row tooltip spells out every input: RSI, ADX, both DIs, efficiency, slope in ATR/bar, quality, the votes, the verdict, the bar count.
- **The bias line** weights the tendencies on an arithmetic ladder — 1m ×1 through 1h ×5 — so two agreeing higher timeframes outvote the whole lower ladder while a lone 1m signal cannot swing anything. Ranges abstain (absence of a call, not a vote against), and a bias needs a 60% supermajority of the weighted mass; anything less reads **MIXED**. The window's frame answers the bias.
- **One stream, not six.** The ladder rides the same shared indicator feeds every multi-timeframe consumer uses, de-duplicated against the chart's own resolution (that rung is the chart candles). Demo mode runs its synthetic history and says so; **bar replay never reads live candles** — the window stays closed.

The arithmetic is pure and unit-tested in `src/lib/mtf-rsi.ts`; the panel is `src/components/MtfRsiWindow.tsx`. Methodology, thresholds, and their sources: [MTF RSI window](docs/mtf-rsi-window.md).

## Kalshi 15m window

**Kalshi 15m** answers, on one floating panel, the question the strike line leaves open: _what is the running 15-minute contract doing right now?_ **Alt K** toggles it (the **Floating** selector also owns it); it starts open on roomy viewports (1050×940+, the Candle Pulse rule), drags, minimizes to a coin/%/countdown line, and remembers its position and your coin. It is a port of the standalone floating window from the `Kalshi-15min/` folder, rebuilt on the app's same-origin Kalshi transport.

- **The target, spelled Kalshi's way.** The market's `floor_strike` — the exact strike the contract settles on — with its open time in **US Eastern**, the clock Kalshi's own page shows.
- **Now is the settlement index.** The live value comes from the same public, undocumented endpoint Kalshi's page reads its "Now" from (`api.elections.kalshi.com/v1/live_data/assets/{SYM}/1s`), green above the target, red below. Crypto falls back to a Coinbase print **labelled approximate**; the metals have no labelled substitute at all — nothing public is close enough on a 15-minute horizon.
- **The % is what Kalshi displays: the last trade, clamped to the live book.** Not the bid, the ask, or the midpoint — deduced from real observations and pinned by tests. The order book and last trade come from the uncached endpoints; the 15-second-cached market list is a labelled amber fallback, never the primary source.
- **The "x" is net of the taker fee.** `1 / (ask + 0.07 · m · ask · (1 − ask))` with the series' published `fee_multiplier` — the same numbers under each side on kalshi.com.
- **The clock governs at the cut.** A window that opened in the future is not the running contract — the panel waits rather than counting down to a future cut — and the first half-minute after a cut busts the local cache once instead of trusting a stale list.
- **Old never looks live.** Every failure degrades one labelled part of the snapshot (footer, amber), and once the last good snapshot is six seconds old the whole window dims and the tag reads **STALE**.

Read-only like everything else: public market data, no API key, no orders — the pills are indicators, not buttons. The logic is pure and unit-tested in `shared/kalshi-float.ts`; the snapshot is `KalshiService.floatFor` (`/api/kalshi/float`); the window is `src/components/KalshiFloatWindow.tsx`. Methodology and failure modes: [Kalshi 15m floating window](docs/kalshi-float-window.md).

## AI — removed from the app, engines kept on disk

Both AI features are gone from the workspace: the floating **AI decision window** (was **Alt A**) and
its agent panel, the floating **MACD AI forecast window** (was **Alt M**) and its panel, the two
toolbar and rail buttons, the two shortcuts, and the AI fields in the workspace-backup schema. Nothing
computes or renders a forecast, and the shipped bundle no longer carries the model weights.

The analysis engines stay in the repository — no longer imported by `src/App.tsx`, still covered by
their own unit tests — so a rework starts from working maths instead of from scratch:

| Path                                | What it holds                                            |
| ----------------------------------- | -------------------------------------------------------- |
| `src/lib/market-agents.ts`          | Specialist agents, ensemble vote, adaptive trust weights |
| `src/lib/price-forecast.ts`         | Horizon projection, drift and band maths                 |
| `src/lib/agent-journal.ts`          | Forecast journal, settling and scoring                   |
| `src/lib/agent-pretrained.ts`       | Generated pre-trained agent weights                      |
| `src/lib/macd-forecast.ts`          | MACD forecast engine, journal and learning state         |
| `src/lib/macd-pretrained.ts`        | Generated pre-trained MACD weights                       |
| `src/lib/macd-training-data/*.json` | The BTC history both trainers replay                     |
| `docs/price-ai-forecast.md`         | Original design notes                                    |

The removed UI (`AgentPanel.tsx`, `AgentDecisionBox.tsx`, `MacdAiPanel.tsx`, `MacdAiDecisionBox.tsx`
and their tests) is in git history if any of it is worth rebuilding from.

## Research notes

[Whale flow vs. ROBEX IA CHILERA](docs/whale-flow-vs-robex.md) compares the whale detector with a
multi-factor Pine scoring engine and lists six borrowable ideas with effort/value ratings. Its
top item — S/R and book-wall context on the sweep — is now implemented as
[whale sweep level context](docs/whale-level-context.md); the remaining five (regime awareness,
edge/participation gating, price-follow confirmation, a session-level baseline, and an event
journal) are still proposals.

[Whale flow sources](docs/whale-flow-sources.md) — not implemented — surveys where large-holder inflows and outflows can be observed — raw on-chain transfers, labeled exchange-flow aggregates, the Coinbase Premium Index, ETF flows, derivatives positioning, and the executed tape — with published lead times, documented false positives, per-source pricing, and how each would (or would not) fit the same-origin adapter. **No whale or on-chain feed is wired into Atlas, no vendor account exists, and no API key is stored in this repository.** The note also records that the largest immediate opportunity needs no vendor at all: the Coinbase `matches` stream already parsed in `shared/coinbase.ts` carries per-fill size that is currently discarded after OHLCV aggregation.

Atlas is independent of TradingView and Coinbase. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the bundled licenses. Lightweight Charts attribution is provided in the status bar and About dialog.
