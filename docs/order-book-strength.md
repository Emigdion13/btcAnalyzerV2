# Order-book depth & zone strength · Atlas implementation notes

Atlas's indicators — SMC order blocks and FVGs, ChartPrime SR boxes, and S/R drawn by hand —
describe **where** price has previously reacted. They say nothing about whether anyone is
currently willing to defend that price. This feature answers that second question from the only
place the answer can be read in real time on a single venue: the resting **level2 order book**.

It is built directly on the Coinbase feed Atlas already streams. No new vendor, no API key, and
no synthetic data in Coinbase mode: the level2 channel (`snapshot` + `l2update`) rides the same
shared WebSocket as `ticker`/`matches`, is validated the same way, and is dropped from the SSE
payload whenever it is unavailable so no stale depth can linger on screen.

## What it constructs

### 1. S/R walls — support & resistance built *by the book*

The book is sliced into clusters of adjacent price levels. A **wall** is a cluster whose resting
USD stands out from the book's own texture:

- levels are merged while their price gap stays inside `max(2×spread, 0.005% × mid)`;
- the cluster's strongest level must exceed `max($250k, 4×` the side's lower-quartile level
  notional`)` — a wall is *notable relative to the same side's ordinary liquidity*, so a
  uniformly deep book simply has no walls;
- the cluster must total at least $200k, and more than an ordinary background strip of the same
  width would hold.

The strongest such clusters below mid are **supports**, the strongest above mid are
**resistances** (up to three per side), and they are redrawn every second as dashed
support/resistance lines across the chart, labeled with their USD size and the liquidity resting
**in front** of them. These are the S/R levels the resting order flow itself is constructing
right now.

### 2. Strength of every price-action zone

Every SMC order block / FVG and every SR box already has a price range. The book is binned into
an adaptive depth profile (≤ ~280 slices across the transmitted span, each with the USD resting
on the relevant side and how long it has rested), and a zone is priced by summing the slices it
overlaps:

- bullish OBs / bullish FVGs / support boxes are scored against **resting bids** inside their
  range;
- bearish OBs / bearish FVGs / resistance boxes are scored against **resting asks**;
- the chip on the box shows `STRONG/MED/WEAK $…` plus, in the side readout, the resting share.

**How strong means what** (explicit and reproducible):

| Bucket     | Rule                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `STRONG`   | ≥ 60% of the book's strongest same-side wall is resting inside the zone **and** it has rested |
|            | (persistence ≥ 40%) once the 60 s persistence window has warmed                                  |
| `MED`      | ≥ 15% of the strongest-wall benchmark and resting, or ≥ 60% of it even if freshly posted        |
| `WEAK`     | liquidity is present but well below what the book itself treats as a wall                        |
| (no chip)  | no resting size currently sits inside the zone — a price-action level the book is not defending  |

The **persistence** component is the closest the book gets to a measured *defense*: size that
keeps resting unchanged while price trades around it (60 s in Atlas's window) is far more
meaningful than size that churns every few seconds. While the window is still calibrating (first
minute after a snapshot), size alone may rate `STRONG` — the same judgment a trader looking at
the book would make.

## What it cannot tell you

Resting size is **not** a commitment:

- every level can be cancelled or walked within seconds — a wall is an invitation, not a lock;
- the level2 feed sees only Coinbase; nothing about Binance, Kraken, dark pools, or the rest of
  the market appears here;
- iceberg/hidden intent is invisible by construction — visible size is what the book admits;
- support/resistance from price action stays a *hypothesis*; this feature only measures how much
  of the hypothesis the current book is funding, on this venue, at this instant.

Nothing in this feature predicts the future, places orders, or constitutes trading advice. The
whale-flow research note ([`whale-flow-sources.md`](whale-flow-sources.md)) classifies this as a
pre-trade, impact-layer signal: resting depth sits between on-chain intent and the executed
tape, and its honest lead time is "until the size is pulled or filled".

## Where it lives

- `shared/order-book.ts` — wire parsing (`snapshot`/`l2update`), the `OrderBook` tracker,
  profile/wall analysis (`OrderBook.view`), and the pure `scoreZone` strength rules. Unit-tested
  against realistic BTC-USD-style books.
- `shared/coinbase.ts` — `OrderBookView`/`OrderBookWall`/`OrderBookBin` wire types, the
  `isOrderBookView` validator, and the optional `StreamPayload.book` field (mirroring the whale
  flow contract: absent = clear, never a zeroed reading).
- `server/coinbase-service.ts` — subscribes `level2` for the product(s) with an open chart only
  (never watchlist-only pairs), maintains one book per product, and attaches the analyzed view
  to the 1 Hz SSE payload. SSE-level tests cover subscribe/ignore/update behavior.
- `src/lib/useCoinbaseMarket.ts` — browser-side validation and gating: the book is only exposed
  while the feed state is genuinely `live`, and is cleared on symbol change, mirroring the whale
  flow box.
- `src/components/ChartView.tsx` — the book overlay (wall lines) and the per-zone strength chips
  on existing SMC/SR boxes. Everything disappears during bar replay.
- `src/components/BookStrengthBox.tsx` — a floating readout of the walls, totals and near-mid
  imbalance (bids-vs-asks share), toggleable from the workspace menu.
- `src/lib/demo-book.ts` — an explicitly **synthetic** book for the app's labeled demo mode
  (swing extremes and round numbers of the demo candles become walls), so the whole overlay can
  be explored offline. It is never shown in Coinbase mode and is tagged `DEMO BOOK` when shown.

## Testing reality

This sandbox cannot open a TLS connection to Coinbase (every outbound HTTPS probe fails), so —
exactly like the rest of the Coinbase integration — the feature is developed and verified against
**controlled fixtures**: crafted full books at the unit level, and fixture `level2` messages
through the real SSE path at the service level. Live depth should be validated from a
network-enabled deployment before any production claim. Demo mode additionally provides a
clearly-labeled synthetic book so the visual layer can be exercised anywhere.
