# Kalshi 15m floating window

The floating **Kalshi 15m** window (toolbar → Floating → Kalshi 15m, or `Alt K`) shows the
15-minute up/down contract that is running right now, in the shape Kalshi's own page shows it:

```
 Target · 5:45pm      Now ↑ $20.03
 $80,850.66           $80,870.69
 [  Up · 70%  ]        [  Down · 30%  ]
     1.38x                 3.18x
 Closes in 07:42  ▓▓▓▓░░░░  BTC · 15 min
```

It is a web port of the standalone floating window that shipped in the `Kalshi-15min/` folder
(`kalshi_flotante.py`, a Tkinter app). The app already had the hard half of that project —
a same-origin server that proxies Kalshi, and the shared strike vocabulary — so the port adds
only the real-time half: the live order book, the last trade, the settlement index, the payout
math, and the window itself.

## What each number is

| On screen                | Source                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `Target` and the price   | The market's `floor_strike` — the exact strike Kalshi settles on. Decimals read off the market's own subtitle. |
| `Target · 5:45pm`        | The window's `open_time`, shown in **US Eastern** — Kalshi's clock.                                       |
| `Now` and the price      | The live settlement index, the same number Kalshi's page prints. Green above the target, red below; an even price reads Up (ties resolve `greater_or_equal`). |
| `Up · 70%` / `Down · 30%`| **The last trade price, clamped to the current bid/ask** — the % Kalshi itself displays.                  |
| `1.38x` / `3.18x`        | What $1 pays **net of Kalshi's taker fee**: `1 / (ask + 0.07 · m · ask · (1 − ask))`, with `m` the series' published `fee_multiplier`. |
| `Closes in 07:42`        | Countdown to `close_time`, with the window's progress bar. Amber under 60 s, red under 15 s.             |
| Coin chips               | The ladder Kalshi actually runs: the seven crypto coins plus gold and silver. The selection is remembered, not tied to the chart. |

### The % is the last trade, not the quote

Kalshi does not display the bid, the ask, or the midpoint. The original window's author deduced
the rule from two real observations — with bid/ask 70/71 the app showed 70, and with 44/45 the
web showed 45; only the last executed trade explains both. The implementation (`floatChance` in
`shared/kalshi-float.ts`) is therefore:

- last trade inside the spread → that price;
- last trade outside the spread (the book moved without a print) → the nearest edge;
- no trade yet → the midpoint when both sides quote, else the single side.

An open market is never shown as 0 or 100.

### Why the book and the trades, not the market list

`GET /markets?series_ticker=…` — the list that carries `yes_bid_dollars` and friends — is served
by Kalshi from a **15-second CloudFront cache** (`Cache-Control: max-age=15`, measured). A % that
lags by up to fifteen seconds is a different number. The window therefore reads

- `GET /markets/{ticker}/orderbook` — best executable prices, not cached upstream, and
- `GET /markets/trades?ticker={ticker}` — the last trade

both uncached, with a 1.2 s local reuse. If the order book stops answering, the % falls back to
the cached list prices and the footer **says so in amber** — a degraded number is labelled, never
passed off as live.

### The "Now" index

`Now` comes from the same public, **undocumented** endpoint Kalshi's own page reads:

```
GET https://api.elections.kalshi.com/v1/live_data/assets/{SYMBOL}/1s?last_sec=10
```

Crypto uses the bare coin name (`BTC`); the metals use the Pyth feed names (`PYTH:GOLD`,
`PYTH:SILVER`) — gold answers literally as `Metal.Index.1OZGOLD/USD`, the index its own rule text
names. The feed emits a point every second even when the value does not change, so an empty
window means the feed is paused (normal outside hours, shown as **`Now · no ticks`**), not that
the price did not move.

Because the endpoint is undocumented, failure is by design and labelled:

- **crypto** falls back to a Coinbase print (footer: `Now ≈ Coinbase — approximate`), and
- **the metals** show no value at all — no public substitute is close enough on a 15-minute
  horizon (gold futures run ~$36 off; Yahoo's gas natural is a different contract).

A dead symbol parks itself for 15 s (60 s on a rate limit, 5 min when the symbol does not exist)
so one broken feed cannot stall the whole cycle.

## How the server assembles one snapshot

`GET /api/kalshi/float?product=BTC-USD` (read-only, no authentication — the browser never sees
Kalshi directly, which 403s requests that carry an `Origin` header) reads four things at four
cadences, because they change at four speeds:

| Piece                       | Upstream                                  | Local reuse |
| --------------------------- | ----------------------------------------- | ----------- |
| the market list (ticker, target, hours) | `/markets?series_ticker=…&status=open` | 4 s          |
| the order book              | `/markets/{ticker}/orderbook`             | 1.2 s       |
| the last trade              | `/markets/trades?ticker=…`                | 1.2 s       |
| the live index              | `/v1/live_data/assets/{SYM}/1s`           | 1.2 s       |
| the fee multiplier          | `/series/{series}`                        | 1 h (1 min after a failure) |

Two window-boundary rules, learned by the original window, carry over:

- **The clock governs.** Right after the cut, Kalshi's cached list can still carry only the
  *next* (future) window. A market whose `open_time` is in the future is not the running
  contract — the snapshot reports "waiting for the next contract" instead of drawing a countdown
  to a future cut. And in the first half-minute of a window, a missing running market busts the
  local cache once with a unique query parameter, then stops asking.
- **A future window never replaces a running one.** The same 15 s upstream cache that produces
  the gap above can also produce a list where the next market is all there is; the selection
  prefers the window whose open is already in the past.

Every failure degrades one labelled part of the response instead of failing the read: no book →
the list fallback with a warning; no index → the Coinbase print for crypto; no market at all → a
well-formed empty snapshot in which `Now` keeps flowing (the index does not care about
contracts).

The client (`src/lib/useKalshiFloat.ts`) polls once a second — the answer changes every second,
so there is no window-rhythm idling like the strike hook has. A dropped poll keeps the last good
snapshot on screen, and once it is six seconds old the window dims and the tag reads **STALE**:
an old number is never drawn as a live one.

## Read-only, like everything else here

No API key, no write routes, no orders — the `Up`/`Down` pills are indicators, not buttons that
buy. The server does `GET` only, against the public market-data endpoints, and the browser talks
to this origin alone.
