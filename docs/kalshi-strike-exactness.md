# Kalshi strike exactness

The strike line used to be derived from Coinbase candles. It was close, and it was wrong.
This document records what Kalshi actually settles on, how far the old line drifted from it,
and what the chart does now.

## What Kalshi settles on

Every `KX*15M` market carries its rule verbatim on the market record. For BTC, pulled live
from `GET /trade-api/v2/markets?series_ticker=KXBTC15M`:

> "If the **simple average of the sixty seconds of CF Benchmarks' BRTI** before 5:15 PM EDT on
> Sep 13, 2026 is **at least** the **simple average of the sixty seconds of CF Benchmarks' BRTI**
> before 5:00 PM EDT on September 13, 2026, then the market resolves to Yes."

Four properties follow, and the old code got three of them wrong:

|            | Kalshi's rule                                     | Old behaviour                                |
| ---------- | ------------------------------------------------- | -------------------------------------------- |
| Source     | CF Benchmarks **BRTI**, a multi-venue index       | **Coinbase** BTC-USD alone                   |
| Strike     | **60-second average** ending at the window open   | Instant `candle.open` at the boundary        |
| Settlement | **60-second average** ending at the window close  | Last Coinbase close                          |
| Tie        | Resolves **UP** (`strike_type: greater_or_equal`) | Resolved UP (`delta >= 0`) — already correct |

BRTI is not a trade index. It is built from the **order books** of the constituent exchanges
(Bitstamp, Coinbase, Gemini, itBit, Kraken, LMAX Digital, Bullish, Crypto.com): the books are
consolidated, each level capped at 100 BTC, cumulative bid/ask/mid price-volume curves are built,
and an exponentially weighted mid is taken, roughly once per second. No amount of Coinbase trade
data reproduces that exactly.

Rounding is per-coin and **not** constant — BTC and ETH publish 2 decimals, HYPE publishes 4.
Read `custom_strike.round_digits` off the market record; do not hardcode it.

## The measured gap

`shared/fixtures/kalshi-strike-audit.json` holds real Coinbase BTC-USD one-minute candles and the
real `floor_strike` values Kalshi published for the same windows (recorded 2026-09-13). The audit
is pinned as a regression test in `shared/kalshi.test.ts`.

```
window open (UTC)   Kalshi strike   naive CB open   60s-avg estimate
20:00                  77254.95          −1.22            −1.23
20:15                  77266.75          +7.60            −5.97
20:30                  77289.61          −1.49            +5.31
20:45                  77291.46          +2.53            −1.77
21:00                  77314.22          +9.09            +3.37

naive (boundary open)      bias +3.30   MAE 4.39   max 9.09
estimate (60s trailing)    bias −0.06   MAE 3.53   max 5.97
```

Two things to take from that:

1. **Most of the error was methodology, not venue.** Switching from the boundary print to an
   average of the preceding minute removed essentially all of the bias (+3.30 → −0.06) and cut the
   worst case by a third. Kalshi averages, so an honest estimate has to average.
2. **The residual ~$3.50 MAE is irreducible locally.** It is the Coinbase↔BRTI basis plus the
   order-book-versus-trades difference. It cannot be estimated away — only fetched.

Why a few dollars matters: a 15-minute BTC window routinely closes within single-digit dollars of
the strike. A $9 error does not decorate the chart, it flips the UP/DOWN read.

## What the chart does now

`resolveStrike()` in `src/lib/coinbase-strike.ts` picks the level, in strict order:

1. **A hand-pinned custom strike**, if the user set one. Labelled `MANUAL PIN`.
2. **Kalshi's published `floor_strike`**, when the fetched window matches the window on screen and
   the interval is 15 minutes. Labelled `KALSHI · BRTI`. This is exact by definition — it _is_ the
   number the contract settles against.
3. **A 60-second trailing average of the candles**, when the grid is fine enough to resolve one
   (sub-minute). Labelled `COINBASE EST`.
4. **The old boundary-candle open**, only when the grid is too coarse to average. Still labelled
   an estimate.

Cases 3 and 4 are never presented as authoritative. The price-scale tag reads `STRIKE (EST)`
rather than `STRIKE`, and the HUD names the source, because a confident wrong number is worse than
an admitted approximation.

The resolution also reports the local estimate _alongside_ the authoritative strike, so the HUD can
show the **CB basis** — the live gap between Coinbase trades and the index Kalshi measures. That
gap is the usual explanation for a strike line that "looks wrong" against a printed price.

Window matching is strict on purpose. A published strike is only applied when
`kalshi.windowStart === result.intervalStart` and the interval is exactly 15 minutes; a strike
fetched for a different window, or for a coin the chart is not showing, is discarded rather than
used approximately.

## The CF Benchmarks overlay

`src/lib/brti-overlay.ts` draws the index itself over the Coinbase candles, so the basis is visible
rather than merely quoted.

Points are **snapped to the candle grid**: each candle takes the last index value falling inside its
own bucket. This is not cosmetic. lightweight-charts shares one time scale across every series, so
feeding per-second index samples under a one-minute candle series would inject thousands of extra
time points and visibly compress the candles. Snapping keeps the overlay aligned with bars the
trader is already reading.

Without an API key the input is sparse and that is correct: exact values only exist at quarter-hour
boundaries, so the overlay is a polyline through those anchors.

## Data sources

### Free, no credentials — the exact strike

Kalshi's market data is public. `GET /trade-api/v2/markets?series_ticker=KXBTC15M&status=open`
returns `floor_strike`, live about a second after the window opens. Settled markets also return
`expiration_value`, and one window's `expiration_value` is exactly the next window's `floor_strike`,
so a run of settled markets yields an exact index series at every quarter hour going backwards.
This is what the chart uses by default, via `GET /api/kalshi/strike?product=BTC-USD`.

### Optional, free Kalshi API key — the index itself

With `KALSHI_API_KEY_ID` and a private key, the server additionally calls Kalshi's CF Benchmarks
REST passthrough (`/trade-api/v2/cfbenchmarks/values` and `/cfbenchmarks/history/values`), which
forwards to `cfbenchmarks.com/api/v1/`. That upgrades the overlay from quarter-hour anchors to a
real second-by-second index line.

```sh
export KALSHI_API_KEY_ID="your-key-id"
export KALSHI_API_PRIVATE_KEY_PATH="/absolute/path/to/kalshi-key.pem"
# or inline, if you prefer: KALSHI_API_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
```

Requests are signed `RSA-PSS / SHA-256` over `timestamp + method + path`, where the path is taken
from the API root and **excludes the query string** — signing the full URL is the classic silent
401, and `kalshiAuthHeaders` is tested against a real keypair for exactly that reason.

Note the passthrough is entitlement-gated. A `403` is surfaced as "not entitled" and costs nothing
else: the free strike feed carries on working.

Two CF Benchmarks quirks the service is built around: `/history/values` only publishes an hour once
that hour is roughly complete (up to 15 minutes of lag), so the previous hour is used for backfill
and `/values` supplies fresh ticks; and `timestamp` must be truncated to the `timespan` granularity.

There is also a websocket route — Kalshi's `cfbenchmarks_value` channel streams the raw index plus
`avg_60s_data`, which _is_ the strike at a boundary and _is_ the live settlement value ticking
toward the cut. That is the natural next step if sub-second accuracy at the cut becomes the goal;
it is not wired up here.

## Polling

A strike locks once, at the window open, and cannot change for the rest of the window. So
`kalshiPollDelayMs` polls hard for the first 20 seconds after a boundary and the last 20 before the
cut, and idles at up to 30 seconds in between — never sleeping past the point where the fast
pre-cut polling should begin. The settled-anchor series is cached far longer than the live strike,
since it only gains a row per quarter hour.

## Coins

Kalshi runs the 15-minute ladder on seven coins, each with its own index. See
`KALSHI_COIN_FEEDS` in `shared/kalshi.ts`:

| Coinbase | Kalshi series | CF Benchmarks index |
| -------- | ------------- | ------------------- |
| BTC-USD  | KXBTC15M      | BRTI                |
| ETH-USD  | KXETH15M      | ETHUSD_RTI          |
| SOL-USD  | KXSOL15M      | SOLUSD_RTI          |
| XRP-USD  | KXXRP15M      | XRPUSD_RTI          |
| DOGE-USD | KXDOGE15M     | DOGEUSD_RTI         |
| HYPE-USD | KXHYPE15M     | HYPEUSD_RTI         |
| BNB-USD  | KXBNB15M      | BNBUSD_RTI          |

BTC is the historic exception: its index predates the `{COIN}USD_RTI` naming and is simply `BRTI`.
Kalshi's rule text also spells the others without the underscore (`ETHUSDRTI`), so both forms are
carried on each feed.

A pair Kalshi does not list — AVAX, LINK, ADA — reports `unsupported` and quietly keeps the
Coinbase estimate. Nothing is invented for a market that does not exist.

## What is still approximate

- **Settlement, not just the strike.** Kalshi resolves on a 60-second average of the index at the
  _close_. The HUD still compares the latest Coinbase print against the strike, so in the final
  minute a contract can read UP on screen and settle DOWN. Fetching the live settlement value needs
  the websocket route above.
- **The candles themselves** remain Coinbase trades. Only the strike and the overlay are index-based.
- **Demo mode never claims a Kalshi strike.** A simulated chart has no real window for Kalshi to
  have published against, so the feed is disabled rather than fabricated.
