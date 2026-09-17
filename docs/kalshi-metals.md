# Kalshi metal ladders

Kalshi publishes quarter-hour reference ladders for gold (`XAU-USD`) and silver (`XAG-USD`), and
the server adapter supports both. In the Atlas UI, however, **Gold is now Coinbase's `PAXG-USD`**
with real 1-minute trade candles; only Silver uses this Kalshi transport. The distinction is
intentional: PAXG is tokenised gold traded on Coinbase, while Kalshi's ladder is a Pyth-referenced
settlement series rather than an exchange tape.

Kalshi's two public series are:

| Metal  | Chart symbol | Series        | Reference in the rule text | Rounding   |
| ------ | ------------ | ------------- | -------------------------- | ---------- |
| Gold   | `XAU-USD`    | `KXGOLD15M`   | `PYTH_GOLD`                | 2 decimals |
| Silver | `XAG-USD`    | `KXSILVER15M` | `PYTH_SILVER`              | 3 decimals |

Everything shown for `XAG-USD` is a number Kalshi put on the record. Nothing is interpolated,
resampled from a finer feed, or borrowed from another candle. `PAXG-USD` bypasses this pipeline
and uses Coinbase's normal REST/WebSocket OHLCV path.

## What Kalshi publishes

The ladders are public: `GET /trade-api/v2/markets?series_ticker=KXGOLD15M` needs no
authentication. Each record is one 15-minute window and carries two prices:

- **`floor_strike`** — the metal price at the window's _open_, published as soon as the window
  exists. This is the number the contract settles against.
- **`expiration_value`** — the price at the window's _close_, filled in when the market is graded
  (empty string until then).

The rule text names the source, verbatim from a live record:

> "If the close price of the 1-minute candlestick for Gold … is at least the close price of the
> 1-minute **Pyth GOLD** candlestick … then the market resolves to Yes."
> "The settlement value is rounded to the nearest **2** decimal places."

So a metal settles on **Pyth's 1-minute candle close** — an instantaneous print, not a
60-second average like the crypto ladders' CF Benchmarks index. Silver rounds to 3 decimals,
which is why the chart's price scale reads `priceIncrement` per asset instead of assuming two.

Two properties of the data drive the whole implementation:

1. **The chain is exact.** Window _N+1_'s `floor_strike` equals window _N_'s `expiration_value`
   (`…2200-00` settles at `4300.16`; the next window `…2215-15` opens with strike `4300.16`).
   Taking the graded value where it exists and the neighbouring strike otherwise yields one
   point per quarter hour with no duplicates and no gaps invented.
2. **The live window's strike is the freshest boundary point.** Kalshi publishes it about a
   second after the cut, and grades the closed window about eighteen seconds later — so the
   just-closed bar can be finished from the _open_ market's strike before its own settlement
   lands. The forming window itself is never drawn as a bar (see below).

## How bars are built

`shared/kalshi-metals.ts` turns the merged points into candles:

- A 15-minute bar exists **only where two points sit exactly one window apart**: `open` is the
  earlier value, `close` the later one.
- `high`/`low` are the **envelope of those two points** — `max`/`min` of open and close. That is
  the tightest bound the data supports, and it is labelled as such in the UI: Pyth printed other
  prices inside the quarter hour that Kalshi did not publish.
- `volume` is **0 / null**. Kalshi's `volume_fp` counts _contracts traded on the ladder_, not
  ounces of metal traded. Presenting it as candle volume would be a category error, so no volume
  is shown for metals (the sidebar says so on hover).
- Higher timeframes (1h, 4h, 1D, 1W) are aggregated from the 15-minute bars with the repo's
  existing `aggregateCandles`, UTC-aligned.
- **Gaps stay gaps.** A quarter hour Kalshi did not publish produces no bar. Fewer bars than
  requested is normal near the series start, which is documented in the API response's
  `coverage` (`from`, `to`, `ageSeconds`, `complete`).

### The forming window

The window that is open right now has a strike but no settlement, so it has an `open` and no
`close`. Drawing it as a partial bar would make a settlement-derived chart look like a live tape.
Instead it is exposed separately as `pending` — strike, ticker, rule text, tie-break, and
`impliedUp` (the ladder's own contract price, i.e. its implied chance of an UP close, kept
distinct from the metal price) — and the chart may draw it as a strike overlay, never as a bar.

### Supported resolutions

Kalshi publishes one value per quarter hour, so a **Kalshi ladder chart** supports **15m, 1h, 4h,
1D, 1W** and nothing finer. `METAL_INTERVALS` / `isMetalInterval` are the single source of truth.
This limitation applies to `XAG-USD` in the UI—not to Coinbase `PAXG-USD`, which supports all
Atlas timeframes including 1m, 3m and 5m.

- The timeframe toolbar hides 1m/3m/5m for Kalshi silver; the timeframe dropdown disables them
  with an explanatory tooltip; any other entry point falls back to 15m and says why.
- The client hook refuses to _request_ an unsupported resolution — it does not ask the server and
  then discard the answer.
- `/api/coinbase/*` rejects synthetic `XAU-USD` / `XAG-USD` product IDs. `PAXG-USD` is a real
  Coinbase product and is deliberately routed through the Coinbase adapter.

## API

| Route                                                     | Purpose                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /api/kalshi/metals`                                  | The metal feeds the server knows, with series, index, rounding |
| `GET /api/kalshi/metals/history?symbol=&interval=&limit=` | Bars, points, quote, `pending`, `coverage`, `asOf`, `message`  |
| `GET /api/kalshi/strike?product=XAU-USD`                  | The published strike, for the strike overlay                   |

`limit` is clamped to 2–900. History is fetched by paging **settled** windows backwards with
`max_close_ts` (integer unix milliseconds — ISO strings are rejected by Kalshi with a
`strconv.ParseInt` 400), `METAL_PAGE_SIZE` = 1000 per page, capped at `METAL_PAGE_CAP` = 10
pages ≈ 104 days, and the requested lookback is clamped to `METAL_MAX_LOOKBACK_SECONDS`
(100 days). Cursors are deliberately **not** used: following a cursor with changed filters
returns inconsistent pages. The series itself began in July 2026, so the deepest bars available
are a property of Kalshi's history, not of this cap.

Each page is re-validated after assembly, and the response carries `asOf` (the server's clock) so
the client measures staleness against the server rather than against itself. Two missed windows
(`ageSeconds > 2 × 900`) marks the feed **stale** with the real age in the message, because that
means the ladder has stopped publishing rather than that the metal has stopped moving.

## Client

`src/lib/useKalshiMetalMarket.ts` mirrors `useCoinbaseMarket`'s contract (`candles`, `quote`,
`quotes`, `state`, `message`, `retry`) so the app can treat a metal chart like any other live
chart, with three differences that follow from the data:

- **No stream.** There is nothing to subscribe to, so it polls at the ladder's rhythm
  (`metalPollDelayMs`): hard for 30 s either side of a boundary — when the next strike lands and
  when the settlement is graded — and idles up to 30 s in between. The tab-visibility and
  `playing` guards are the same as the Coinbase hook's.
- **No provisional bar.** A settlement point is final, so `snapshot.provisional` is always
  `false`, unlike a forming Coinbase candle.
- **Validated by symbol and interval.** A late response for another metal or another resolution
  is rejected (`isKalshiMetalHistory(data, symbol, interval)`) rather than painted under the
  current chart.

`App.tsx` keeps two venues side by side: `venueForSymbol(symbol, source)` decides which one
serves the chart, and `venueLabel` names it in the status bar, chart badge, dialogs and exported
images. `PAXG-USD` receives Coinbase candles, volume, tape and order-book data; `XAG-USD` receives
Kalshi settlement candles without fabricated volume or book data. `MetalTimeframeFeed` handles
the alternate-timeframe feeds for Kalshi silver.

## Honesty rules this integration keeps

1. `PAXG-USD` is always labelled PAX Gold / Coinbase; it is not misrepresented as generic XAU.
2. `XAG-USD` is always labelled Silver / Kalshi; it is never labelled Coinbase.
3. A Kalshi quote's `updatedAt` is the settlement time, up to a quarter hour old. The age is shown.
4. No volume, market cap, or sparkline is invented for Kalshi silver.
5. Sub-15-minute silver resolutions do not exist and are not synthesised; PAXG uses real Coinbase
   candles at those resolutions.
6. The Kalshi forming window is not a bar, and gaps in the ladder remain gaps.

## Tests

- `shared/kalshi-metals.test.ts` — point parsing/merging from Kalshi's verbatim records
  (`shared/fixtures/kalshi-metals-markets.json`), bar construction and gaps, daily/weekly
  aggregation bucket semantics, quote maths and 24-hour window, coverage, lookback clamping and
  quantisation, `impliedUp`, and payload validation.
- `server/kalshi-metals.test.ts` — route behaviour, `max_close_ts` paging with identical filters,
  the page cap, the live strike finishing the just-closed bar, `METAL_NOT_ON_COINBASE` guards.
- `src/lib/market.test.ts` — metal asset metadata, resolution precision, venue routing.
- `src/lib/useKalshiMetalMarket.test.tsx` — poll cadence, request shape, refusal to fetch an
  unsupported resolution, symbol/interval mismatch rejection, stale-ladder reporting, watchlist
  quotes, and clearing state when the metal changes.
