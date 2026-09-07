# Whale flow research · where to see big money entering and leaving a coin

**Status: mostly research.** One piece is now built: the **whale flow box** implements tier 0
below (§8.1) — large _executed_ prints from the Coinbase trade stream Atlas already consumes. Every
other layer here remains unimplemented. **No on-chain or vendor feed is wired into the app, no
vendor account exists, and no API key is stored anywhere in this repository.** This document exists to answer one question — _where can we check when whales put money
into or take money out of the coin being analysed, and how early does that show up before price
moves_ — and to record which options would actually fit the Atlas architecture if we later decide
to build one.

Prices, rate limits and free-tier terms below were collected in **September 2026** from vendor
documentation and secondary comparisons. Vendors change these often; re-verify before committing to
one. Nothing here is trading advice, and none of these signals is a certified predictor.

---

## 1. The short answer

"Whale activity" is not one dataset. Big money leaves five different fingerprints, at five
different points in time, in five different places. Most confusion in whale analysis comes from
treating them as interchangeable.

| #   | Layer                                | What it actually tells you                                                                                          | Typical lead time on price                      |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | **Raw on-chain transfers**           | A large holder _moved_ coins. Direction (to/from an exchange) hints at intent.                                      | Minutes → hours before any trade happens        |
| 2   | **Labeled exchange flow aggregates** | How much supply arrived at, or left, exchange wallets in aggregate, and what share came from the largest depositors | 1 hour → 1 day (metric resolution bound)        |
| 3   | **Cohort / venue demand**            | _Which_ cohort is bidding — US institutions vs offshore, ETF creations vs redemptions                               | Real-time (premium) to 1 day lagged (ETF flows) |
| 4   | **Derivatives positioning**          | Where leveraged size sits and which price levels would force it to trade                                            | Standing condition; fires on price touch        |
| 5   | **The executed tape**                | The whale is hitting the book _right now_                                                                           | Zero — this _is_ the price impact               |

Layers 1–2 are "intent". Layer 5 is "impact". The gap between them is the only window a trader
gets, and academic work puts that window at roughly **6–24 hours** for exchange-bound whale
transfers (§5).

Atlas now surfaces layer 5 in the whale flow box — the cheapest available win, needing no vendor at
all (§8.1). Layers 1-4 remain unbuilt.

---

## 2. Layer 1 — raw on-chain transfers (the "intent" layer)

A whale who wants to sell on a centralised venue must first deposit. That deposit is public before
the sell order exists. This is the earliest observable signal, and also the noisiest.

### Where to check

**Whale Alert** — the broad default. Monitors ~13 blockchains and pushes large transfers within
seconds; free visibility via its X/Telegram feeds, paid for programmatic access. The developer
plan is **$29.95/month** (live transaction feed, 90-day history, 13 blockchains, 500 calls/min,
alerts API at 1,000 alerts/hour); the enterprise REST tier is **$699/month** (1,000 CPM, 500
alerts/hour, high-priority delivery). Minimum transaction value visible depends on plan —
$500k on free, $100k on personal — and the WebSocket alert subscription accepts a `min_value_usd`
floor of $100,000. [1](https://developer.whale-alert.io/documentation/) [2](https://developer.whale-alert.io/api-account/documentation)

```
GET  https://api.whale-alert.io/v1/{blockchain}/transactions?start=…&min_value=…&currency=btc
WSS  wss://leviathan.whale-alert.io/ws?api_key=…   → {"type":"subscribe_alerts","min_value_usd":1000000}
```

Strength: speed and chain breadth. Weakness: it tells you a transfer happened between address X and
address Y — it does not reliably tell you whether Y is an exchange, a cold wallet or a custodian.
That attribution problem is what §7 is about. [3](https://mintarex.com/en/blog/reading-on-chain-whale-activity-2026)

**Arkham Intelligence** — the attribution layer. Root `https://api.arkm.com`, API key generated at
`intel.arkm.com` under Settings → API Keys. The relevant endpoints for flow work:

```
GET /transfers?base=binance&flow=out&timeLast=24h&limit=20     # heavy: 1 req/s
GET /transfers?usdGte=1000000&timeLast=24h&limit=50
GET /transfers/histogram          # aggregated counts/USD, granularity 1h or 1d (API tier only)
GET /intelligence/entity/{entity} , /flow/entity/{entity} , /counterparties/entity/{entity}
WSS wss://api.arkm.com/ws/transfers
```

Most endpoints allow ~20 req/s on the basic tier; `/transfers` and `/swaps` are throttled to 1
req/s. The WebSocket is capped at 10,000 transfers/hour and 1,000,000/month, and each subscription
must filter by at least one of `from`, `to`, `tokens`, `base`, or `usdGte >= 10,000,000`.
[4](https://intel.arkm.com/docs/arkham_api_docs.yaml) [5](https://lobehub.com/skills/vyntral-arkham-intelligence-claude-skill-arkham-api)
Arkham's dashboard is genuinely usable free; the API is application-gated. [6](https://info.arkm.com/announcements/announcing-the-arkham-api-pilot-program)

**Nansen** — behavioural labelling ("Smart Money") rather than identity, deepest on EVM chains,
weaker for a Bitcoin-first workflow. Roughly $49–150/month depending on tier, with a pay-per-call
API model reported around $0.01/call. [7](https://www.spark.money/tools/bitcoin-onchain-analytics-comparison) [8](https://paybis.com/blog/tracking-whale-movements/)

**Lookonchain** — free, human-curated feed on X. Zero cost, minutes-to-hours editorial lag, but it
filters the flows that matter, which is exactly the job raw alerts do badly. [3](https://mintarex.com/en/blog/reading-on-chain-whale-activity-2026)

**Raw explorers (free, no key)** — `mempool.space`, Blockstream Esplora, Blockchair,
`blockchain.info`. Unlimited/generous free access, WebSocket support on mempool.space, fully open
source. [9](https://www.spark.money/tools/bitcoin-api-comparison) These give you every large UTXO
movement for free — but **no exchange address labels**, which is the entire value-add of the paid
vendors. Building your own label set is the hard, ongoing, error-prone part; it is the reason
CryptoQuant and Glassnode charge money.

### Note on the ambiguity of "the coin"

Coverage is not uniform across assets. Bitcoin is best served by CryptoQuant/Glassnode/Arkham;
EVM assets by Nansen/Arkham/DeBank; Solana by Arkham and specialist providers. DeBank has no
Bitcoin coverage at all. [10](https://academy.exmon.pro/5-best-on-chain-analytics-tools-track-crypto-whales)
Any Atlas feature would need per-symbol capability flags rather than assuming BTC-grade data for
every product in the Coinbase catalogue.

---

## 3. Layer 2 — labeled exchange flow aggregates

Instead of individual transfers, these are pre-aggregated series: how much arrived at exchanges,
how much left, and how concentrated the arrivals were.

**CryptoQuant** is the specialist here — it monitors 500+ exchanges for inflow/outflow/reserve
changes. [7](https://www.spark.money/tools/bitcoin-onchain-analytics-comparison) API base
`https://api.cryptoquant.com/v1/`, bearer token, JSON or CSV, `window` = `day` | `hour` | `block`:

```
GET /v1/btc/exchange-flows/netflow?exchange=binance&window=hour&from=…
GET /v1/btc/exchange-flows/inflow?exchange=binance&window=day&from=…
      → { inflow_total, inflow_top10, inflow_mean }
GET /v1/btc/flow-indicator/exchange-whale-ratio?exchange=binance&window=day&from=…
GET /v1/btc/inter-entity-flows/exchange-to-exchange?from_exchange=…&to_exchange=…
GET /v1/btc/market-data/coinbase-premium-index
```

[11](https://userguide.cryptoquant.com/api/btc-exchange-flows) [12](https://cryptoquant.com/docs)

The three metrics that specifically isolate _whales_ rather than aggregate flow:

- **Exchange Whale Ratio** — the top-10 largest inflow transactions as a share of total exchange
  inflows. High = the day's deposits are dominated by a handful of very large depositors.
  [13](https://cryptoquant.com/asset/btc/chart/flow-indicator/exchange-whale-ratio)
- **Exchange Inflow — Spent Output Value Bands** — splits inflows by UTXO size, so you can tell
  whether a spike was one whale or ten thousand retail deposits.
  [14](https://dataguide.cryptoquant.com/exchange-flows-indicators/exchange-inflow-spent-output-value-bands)
- **Exchange Inflow — Coin Days Destroyed / Spent Output Age Bands** — weights inflows by how long
  the coins sat still, isolating long-dormant supply waking up.
  [15](https://userguide.cryptoquant.com/cryptoquant-metrics/exchange/exchange-inflow-spent-output-age-bands)

CryptoQuant used exactly this trio (whale ratio + inflow CDD + UTXO value bands) to argue whales
were accumulating rather than distributing, which is a good template for how to combine them.
[16](https://www.theblock.co/post/241736/bitcoin-whales-cryptoquant)

Pricing: a free Basic tier with daily resolution and roughly three years of history; paid from
**$29/month** (Advanced), with **API access starting at the Professional tier (~$99/month)** and
Premium around $699. Minute-level resolution and alerting sit on the higher tiers.
[17](https://www.cointribune.com/en/best-crypto-apis-for-trading-bots-and-ai-agents-in-2026/) [7](https://www.spark.money/tools/bitcoin-onchain-analytics-comparison)
**The free tier's daily resolution is the blocker** — a daily bar cannot resolve a 6-hour signal.

**Glassnode** covers the same ground with cleaner metric hygiene:

```
/v1/metrics/transactions/transfers_volume_whales_to_exchanges_sum
/v1/metrics/transactions/transfers_volume_exchanges_net
/v1/metrics/transactions/transfers_volume_exchanges_net_by_size
/v1/metrics/transactions/transfers_volume_miners_to_exchanges
/v1/metrics/transactions/transfers_volume_lth_to_exchanges_sum
```

[18](https://docs.glassnode.com/basic-api/endpoints/transactions)

Two details matter a great deal if we ever backtest this. First, Glassnode states plainly that
exchange metrics are **mutable** — they rest on a continuously-updated label set, so recent points
shift as labels improve. Second, Glassnode publishes **Point-in-Time (`_pit`) variants** that are
strictly append-only and immutable. [19](https://docs.glassnode.com/basic-api/endpoints/pit)
Any honest backtest of a whale-flow signal **must** use the PiT series, or it will silently
look-ahead through label revisions. This is the single most common way whale backtests lie.

Glassnode's free tier is Tier-1 metrics at 24h resolution with one alert; paid entry ~$29–49/month;
full API access is gated to the Professional tier (~$999/month).
[7](https://www.spark.money/tools/bitcoin-onchain-analytics-comparison)

**Santiment** offers a GraphQL API (`api.santiment.net`) with exchange flow and whale transaction
metrics, and API access on _every_ tier including free — but the free and Pro plans impose a
**30-day lag on restricted metrics**, which makes them research-only, not actionable.
[20](https://academy.santiment.net/products-and-plans/sanapi-plans/) [21](https://cryptoadventure.com/santiment-review-2026-on-chain-metrics-social-signals-alerts-and-api-limits/)

---

## 4. Layers 3 & 4 — who is bidding, and what would force them to trade

### Coinbase Premium Index (layer 3) — highly relevant to Atlas

The percentage gap between BTC/USD on Coinbase and BTC/USDT on Binance. Coinbase's book is where
US institutions, ETF market makers and TradFi funds transact, so the spread isolates that cohort's
demand from global demand.

```
Coinbase Premium = (Coinbase BTC/USD − Binance BTC/USDT) / Binance BTC/USDT × 100
```

[22](https://docs.cryptoquant.com/api-reference/btc-market-data/coinbase-premium-index) [23](https://www.bit.com/knowledge-hub/coinbase-premium)

Atlas is a Coinbase-native app. This is the one institutional-flow signal it could compute almost
natively — it needs exactly one additional free, keyless upstream (a global reference price).

Caveats worth respecting, all from the same analyses that recommend it: the global leg is priced in
USDT, so a stablecoin de-peg contaminates the reading; magnitudes are tiny by design (hundredths of
a percent) because arbitrage compresses them within minutes, so read multi-day trends rather than
ticks; and it is _not_ an ETF-flow proxy — the two diverge routinely, and the divergence is itself
informative. The most instructive recent example: in June 2026 whales absorbed more than 270,000
BTC while the premium stayed negative, which told analysts the accumulation ran through offshore
and OTC channels rather than US regulated venues. The index identifies buyers by _exclusion_ as
much as by presence. [24](https://crypto.news/what-is-the-coinbase-premium-index/)

### Spot ETF flows (layer 3)

Creations and redemptions force the issuer to buy or sell spot. Published daily, same-day evening
at the earliest — so this is confirmation, not a lead. Free sources: **Farside Investors**
(`farside.co.uk/btc/`, raw daily table back to the January 2024 launch) and **SoSoValue** (per-fund
dashboard). [25](https://phemex.com/academy/bitcoin-etf-flows-explained) TFTC republishes the
combined series as open JSON under CC BY 4.0. [26](https://www.tftc.io/bitcoin-etf-flows)
CoinGlass also exposes `/api/bitcoin/etf/flow-history`. [27](http://dlthub.com/context/source/coinglass)

### Derivatives positioning and liquidation clusters (layer 4)

This layer answers a different question: not "will a whale sell", but "what price would _force_
whales to sell". **CoinGlass v4** (`https://open-api-v4.coinglass.com`, `CG-API-KEY` header) is the
reference implementation:

```
/api/futures/openInterest/ohlc-history          /api/futures/liquidation/heatmap/model1|model2
/api/futures/fundingRate/ohlc-history           /api/futures/liquidation/map
/api/futures/liquidation/history                /api/exchange/balance/list
/api/spot/large-limit-order-history             /api/hyperliquid/whale-alert
```

Sub-minute updates across 30+ exchanges. The liquidation heatmap is derived, not raw — it models
where liquidation pressure clusters based on inferred entry prices, and has no real equivalent
elsewhere. **There is no free API tier**; entry is $29/month.
[28](https://dev.to/great-time-flies/coinglass-api-review-2026-is-it-worth-it-for-crypto-quant-traders-2bcf) [29](https://docs.coinglass.com/reference/liquidation-heatmap)

**Hyperliquid** is the interesting free outlier. As an on-chain perp DEX, every trader's wallet,
open positions, leverage and liquidation price are public, served by a **no-auth public REST API**
at `https://api.hyperliquid.xyz/info` (`clearinghouseState` per address, plus a public
leaderboard). [30](https://apify.com/gochujang/hyperliquid-whale-tracker) [31](https://www.dwellir.com/docs/hyperliquid/clearinghouse-state)
It is the only place to see _actual named whale positions with actual liquidation prices_ for free.
The catch: it is one venue, and its positioning is not the whole market.

---

## 5. Timing — how far ahead does any of this fire?

This is the part most whale-tracking content skips. The published evidence:

| Finding                                                                                                                                                                                                | Horizon    | Source                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin whale transfers _to exchanges_ significantly move returns of major cryptocurrencies; effect strongest at **6h and 24h**, and larger for altcoins (contagion) than for BTC itself               | 6–24 h     | Magner & Sanhueza, "The Moby Dick effect", _Finance Research Letters_ 2025 [32](https://neutralis.finance/insights/whale-crypto-large-transfers) [33](https://whale-alert.io/academic-research.html) |
| **USDT** net inflows to exchanges positively predict BTC and ETH returns at **1–2 h**, and negatively predict volatility at 6 h                                                                        | 1–2 h      | Chi, Chu & Hao, arXiv 2411.06327 [34](https://arxiv.org/pdf/2411.06327)                                                                                                                              |
| **BTC** net inflows show _no consistent_ intraday return predictability for BTC — significant only at the **4-hour** interval — but do negatively predict BTC volatility across all intraday intervals | 4 h (weak) | same [34](https://arxiv.org/pdf/2411.06327)                                                                                                                                                          |
| Whale-alert transfers + CryptoQuant on-chain features improve prediction of **next-day volatility spikes** (not direction)                                                                             | 1 day      | Herremans & Low, arXiv 2211.08281 [35](https://arxiv.org/pdf/2211.08281)                                                                                                                             |
| Largest holders tend to _sell_ into price increases while small holders buy                                                                                                                            | structural | BIS Working Paper 1049 [36](https://www.bis.org/publ/work1049.pdf)                                                                                                                                   |

**The honest reading.** The strongest, most replicated result is that whale exchange flows predict
**volatility**, not direction. Directional predictability for BTC specifically is weak and
horizon-fragile; the clearer directional effect is the _contagion_ into altcoins 6–24h after a BTC
whale transfer, and the stablecoin-inflow signal at 1–2h. If Atlas ever surfaces this, it should be
framed as a **risk/volatility regime indicator**, not a buy/sell arrow. That framing also matches
the README's existing "chart viewer, not a prediction engine" stance.

One more decay risk, stated by the analysts who follow the premium most closely: the signal
degrades with fame. As more traders condition on a public indicator, reflexive trades front-run the
pattern it was built to detect, and each cycle prices it faster.
[24](https://crypto.news/what-is-the-coinbase-premium-index/)

---

## 6. Where whale money is _invisible_

Worth stating explicitly, because it bounds how much any of this can ever deliver:

- **OTC desks.** Large blocks settle bilaterally. Nothing hits an exchange book; the on-chain leg
  may be a single custody transfer or nothing at all.
- **Custodial internal trades.** As CryptoQuant's own CEO conceded during the 2021 Gemini episode,
  whales using a custody service "can dump bitcoin instantly without making any on-chain
  transactions." [37](https://finance.yahoo.com/news/cryptoquant-makes-changes-misfired-whale-164247794.html)
  On-chain flow analysis is structurally blind to this, and the share of institutional volume it
  misses grows as custody consolidates.
- **In-exchange balance shuffles.** Movement between sub-accounts never touches a chain.

So the on-chain layers see a _shrinking, biased sample_ of whale intent. Treat an absence of
on-chain signal as no information, never as evidence of no activity.

---

## 7. False positives — the four that dominate raw feeds

Every practitioner source converges on the same list. These are not edge cases; they are the
majority of large transfers by USD value on a typical day. [3](https://mintarex.com/en/blog/reading-on-chain-whale-activity-2026)

1. **Exchange hot ↔ cold rotation.** Scheduled security housekeeping. Dominates the high-USD tail.
2. **Custody migrations.** Anchorage → BitGo → Fireblocks. Directional-looking, zero economic
   position change.
3. **Stablecoin issuer treasury operations.** Tether/Circle moving minted or redeemed supply between
   chains. Looks like a billion-dollar whale; isn't.
4. **Exchange-to-exchange transfers.** Almost always custody rebalancing, not positioning.

Two documented incidents make the cost concrete. In March 2021 a CryptoQuant alert on a $1.1bn
Gemini inflow triggered a visible sell-off; Glassnode, Chainalysis and Coin Metrics all identified
it as a BlockFi custody movement, and CryptoQuant changed its alert wording as a result.
[37](https://finance.yahoo.com/news/cryptoquant-makes-changes-misfired-whale-164247794.html)
In January 2026, CryptoQuant's head of research reported that on-chain signals widely read as
aggressive whale _accumulation_ were mainly exchanges consolidating deposit addresses into cold
storage — and that once internal transfers were filtered out, whales and dolphins had been net
_sellers_ through December. [38](https://finance.yahoo.com/news/large-bitcoin-whale-accumulation-exchange-133534111.html)
The sign of the signal flipped entirely on entity attribution.

**The filter rule that follows:** entity context, not transaction size, separates signal from noise.
If both endpoints are exchanges, custodians or issuers → discard. Unlabelled long-term-holder wallet
→ exchange, or OTC desk → exchange, is the configuration worth an alert.
[3](https://mintarex.com/en/blog/reading-on-chain-whale-activity-2026) Practitioner guidance is to
require multi-factor confirmation — e.g. whale inflow _and_ funding-rate condition _and_ a technical
level — before acting. [39](https://www.bitget.site/academy/crypto-whale-alerts)

That rule has a direct consequence for us: **a cheap raw-transfer feed without entity labels is
close to useless.** The label set is the product. Budget for the labelled tier or don't build it.

---

## 8. Fit with Atlas

Atlas's architecture constrains this usefully. The browser only calls same-origin relative
`/api/…` URLs; a Node adapter (`server/api.ts` → `server/coinbase-service.ts`) holds the single
fixed upstream, caches and coalesces requests, rate-limits outbound calls, and batches pushes into
one SSE frame per second. Any whale feed must follow the same shape — **server-side only, keys in
environment variables, never in the browser bundle, never a browser-configurable upstream URL.**
Layered by cost:

### 8.1 Tier 0 — no new vendor, no key, no new upstream · **IMPLEMENTED**

Atlas's WebSocket already subscribes to the Coinbase `matches` channel and `shared/coinbase.ts`
already parses every fill (`trade_id`, `price`, `size`, `time`) — then discards everything except
its contribution to OHLCV. That discarded tape is **layer 5: whale execution as it happens.**

Available today with no external dependency:

- **Large-print detection.** Flag fills whose `size` exceeds a rolling percentile of recent fills.
  This is a whale actually moving the price, not an inference about intent.
- **Cumulative volume delta / taker imbalance.** `parseTrade` currently drops the `side` field.
  Capturing it enables signed flow. ⚠️ **Coinbase `side` is the _maker_ side** — `side: "sell"`
  means the resting order was a sell and the _taker bought_ (an up-tick). Getting this backwards
  inverts the entire indicator, and it is the most common bug in CVD implementations.
- **Volume z-scores and absorption** at the SR zones the existing `sr-breaks-retests.ts` already
  computes.

This is the highest value-per-unit-effort option by a wide margin, and it is the only one that
survives the sandbox network restriction in §9.

**What shipped.** `shared/whale-flow.ts` detects whale _sweeps_ per product: it aggregates a
five-second window of fills against a percentile-based adaptive threshold, so a whale walking the
book registers while it is still filling rather than only on its single largest print.
`parseTrade` derives `takerSide` by inverting Coinbase's documented maker side; the server
attaches a validated `whaleFlow` snapshot to each SSE frame **only while a sweep is live**, and
omits the field entirely otherwise; `src/components/WhaleFlowBox.tsx` renders the floating
readout, which clears itself once the sweep ends.

**Deliberate limitation.** The readout is ephemeral by design — no rolling total is retained, so a
finished sweep leaves no number on screen. The cost is that this feed can only report execution
already in progress: `matches` carries fills, never intent, so it cannot warn that a whale order
is _about_ to arrive. The realised lead time is the duration of the sweep itself. Pre-trade
visibility would need the `level2` book (resting size, same connection, no new vendor — the
natural next increment) or the on-chain deposit tiers below. Absorption at SR zones and a
persisted CVD series are also still open.

### 8.2 Tier 1 — free, keyless upstreams

- **Coinbase Premium Index** — add one global reference price (Binance BTC/USDT, or Kraken/Bitstamp
  if Binance is geo-restricted from the deployment) and compute the spread server-side. Free, no
  key. Would need a second small REST/WS client alongside the Coinbase one, plus explicit handling
  for the case where only one leg is available — following the README's existing rule that a failed
  connection must never be silently substituted.
- **Spot ETF net flows** — daily, free from Farside/SoSoValue; the TFTC JSON mirror is CC BY 4.0 and
  requires attribution. [26](https://www.tftc.io/bitcoin-etf-flows) Daily granularity only.
- **Hyperliquid whale positions** — `api.hyperliquid.xyz/info`, no auth, real liquidation prices.
- **mempool.space / Esplora** — free raw Bitcoin data, but unusable for flow analysis without a
  label set (§7).

### 8.3 Tier 2 — one paid key

If we want genuine exchange-flow aggregates, the realistic minimum is **CryptoQuant Professional
(~$99/month)** for hourly `netflow` / `inflow_top10` / `exchange-whale-ratio`, or **Glassnode** with
the `_pit` series if backtest integrity is the priority. Whale Alert at $29.95/month gives raw
transfers but not the attribution that makes them meaningful; pairing it with Arkham for entity
resolution is the standard workflow.

**Recommendation:** do tier 0 first. It is free, it needs no new trust boundary, it uses data the
app already receives and throws away, and it measures actual price impact rather than inferring
intent. Revisit tier 2 only if tier 0 proves the UI surface is worth it.

---

## 9. Sandbox reality check

Every outbound endpoint was probed from this workspace on 2026-09-07. **All returned connection
failure (curl exit status, HTTP code `000`, zero bytes)** — mempool.space, Blockstream, Blockchair,
blockchain.info, Coinbase Exchange, Coinbase Advanced, Binance, OKX, Kraken and Bitstamp alike.

This matches the README's existing note that the Arena sandbox cannot reach Coinbase over TLS. Any
whale-flow work done here must therefore be developed against **controlled fixtures**, exactly as
the existing Coinbase integration is, and cannot be claimed as live-verified from this environment.
Tier 0 (§8.1) is the only option that can be tested end-to-end here, because its input is the
Coinbase trade stream Atlas already models in tests.

---

## 10. Source directory

| Source                                    | Answers                               | Access       | Cost                             | Latency        | Key    |
| ----------------------------------------- | ------------------------------------- | ------------ | -------------------------------- | -------------- | ------ |
| Whale Alert                               | Large transfers, 13 chains            | REST + WS    | $29.95/mo; $699/mo enterprise    | Seconds        | Yes    |
| Arkham                                    | _Who_ owns the wallet                 | REST + WS    | Free dashboard; API gated        | Real-time      | Yes    |
| Nansen                                    | Smart-money behaviour (EVM)           | REST         | ~$49–150/mo                      | Near real-time | Yes    |
| Lookonchain                               | Curated high-signal flows             | X feed       | Free                             | Minutes–hours  | No     |
| CryptoQuant                               | Exchange netflow, whale ratio, SOVB   | REST         | Free daily; API from ~$99/mo     | Hour → block   | Yes    |
| Glassnode                                 | Whale→exchange volume, PiT series     | REST         | Free 24h res; full API ~$999/mo  | 10m–24h        | Yes    |
| Santiment                                 | Whale txs + social                    | GraphQL      | Free 1k calls/mo, **30-day lag** | Lagged         | Yes    |
| CoinGlass v4                              | OI, funding, liquidation heatmap, ETF | REST + WS    | **No free tier**, from $29/mo    | <1 min         | Yes    |
| Hyperliquid                               | Real whale positions + liq prices     | REST         | **Free**                         | Real-time      | **No** |
| Farside / SoSoValue                       | Spot ETF creations/redemptions        | Table / JSON | Free                             | Daily          | No     |
| mempool.space / Esplora                   | Raw BTC chain, mempool                | REST + WS    | Free                             | Real-time      | No     |
| **Coinbase `matches` (already in Atlas)** | **Executed whale prints**             | **WS**       | **Free**                         | **Real-time**  | **No** |

---

## 11. References

1. Whale Alert — API documentation. https://developer.whale-alert.io/documentation/
2. Whale Alert — API account documentation & changelog. https://developer.whale-alert.io/api-account/documentation
3. Mintarex — _Reading On-Chain Whale Activity_ (2026). https://mintarex.com/en/blog/reading-on-chain-whale-activity-2026
4. Arkham — API spec. https://intel.arkm.com/docs/arkham_api_docs.yaml
5. Arkham API endpoint reference. https://lobehub.com/skills/vyntral-arkham-intelligence-claude-skill-arkham-api
6. Arkham — API pilot programme. https://info.arkm.com/announcements/announcing-the-arkham-api-pilot-program
7. Spark — _Glassnode vs CryptoQuant vs Nansen_. https://www.spark.money/tools/bitcoin-onchain-analytics-comparison
8. Paybis — _How to Track Crypto Whale Movements_ (2026). https://paybis.com/blog/tracking-whale-movements/
9. Spark — _Bitcoin API Comparison_. https://www.spark.money/tools/bitcoin-api-comparison
10. Exmon Academy — _5 Best On-Chain Analytics Tools_. https://academy.exmon.pro/5-best-on-chain-analytics-tools-track-crypto-whales
11. CryptoQuant — BTC Exchange Flows API. https://userguide.cryptoquant.com/api/btc-exchange-flows
12. CryptoQuant — Data API index. https://cryptoquant.com/docs
13. CryptoQuant — Exchange Whale Ratio. https://cryptoquant.com/asset/btc/chart/flow-indicator/exchange-whale-ratio
14. CryptoQuant — Exchange Inflow Spent Output Value Bands. https://dataguide.cryptoquant.com/exchange-flows-indicators/exchange-inflow-spent-output-value-bands
15. CryptoQuant — Exchange Inflow Spent Output Age Bands. https://userguide.cryptoquant.com/cryptoquant-metrics/exchange/exchange-inflow-spent-output-age-bands
16. The Block — _Bitcoin whales are in accumulation mode, says CryptoQuant_. https://www.theblock.co/post/241736/bitcoin-whales-cryptoquant
17. Cointribune — _Best Crypto APIs for Trading Bots and AI Agents in 2026_. https://www.cointribune.com/en/best-crypto-apis-for-trading-bots-and-ai-agents-in-2026/
18. Glassnode — Transactions endpoints. https://docs.glassnode.com/basic-api/endpoints/transactions
19. Glassnode — Point-In-Time endpoints. https://docs.glassnode.com/basic-api/endpoints/pit
20. Santiment — API plans. https://academy.santiment.net/products-and-plans/sanapi-plans/
21. CryptoAdventure — _Santiment Review 2026_. https://cryptoadventure.com/santiment-review-2026-on-chain-metrics-social-signals-alerts-and-api-limits/
22. CryptoQuant — Coinbase Premium Index API. https://docs.cryptoquant.com/api-reference/btc-market-data/coinbase-premium-index
23. Bit.com Knowledge Hub — _Coinbase Premium_. https://www.bit.com/knowledge-hub/coinbase-premium
24. crypto.news — _What is the Coinbase Premium Index? Full 2026 guide_. https://crypto.news/what-is-the-coinbase-premium-index/
25. Phemex Academy — _Bitcoin ETF Flows Explained_. https://phemex.com/academy/bitcoin-etf-flows-explained
26. TFTC — Bitcoin ETF flows, open JSON (CC BY 4.0). https://www.tftc.io/bitcoin-etf-flows
27. CoinGlass endpoint catalogue. http://dlthub.com/context/source/coinglass
28. _CoinGlass API Review (2026)_. https://dev.to/great-time-flies/coinglass-api-review-2026-is-it-worth-it-for-crypto-quant-traders-2bcf
29. CoinGlass — Liquidation heatmap reference. https://docs.coinglass.com/reference/liquidation-heatmap
30. Hyperliquid public API usage. https://apify.com/gochujang/hyperliquid-whale-tracker
31. Hyperliquid `clearinghouseState` reference. https://www.dwellir.com/docs/hyperliquid/clearinghouse-state
32. Neutralis — summary of Magner & Sanhueza (2025), _Finance Research Letters_. https://neutralis.finance/insights/whale-crypto-large-transfers
33. Whale Alert — academic research index. https://whale-alert.io/academic-research.html
34. Chi, Chu & Hao — _Return and Volatility Forecasting Using On-Chain Flows_, arXiv 2411.06327. https://arxiv.org/pdf/2411.06327
35. Herremans & Low — _Forecasting Bitcoin volatility spikes from whale transactions and CryptoQuant data_, arXiv 2211.08281. https://arxiv.org/pdf/2211.08281
36. BIS Working Paper 1049 — _Crypto trading and Bitcoin prices_. https://www.bis.org/publ/work1049.pdf
37. CoinDesk/Yahoo — _CryptoQuant Makes Changes After Misfired 'Whale' Alert_. https://finance.yahoo.com/news/cryptoquant-makes-changes-misfired-whale-164247794.html
38. Yahoo Finance — _Large Bitcoin 'Whale Accumulation' Was Exchange Housekeeping_ (Jan 2026). https://finance.yahoo.com/news/large-bitcoin-whale-accumulation-exchange-133534111.html
39. Bitget Academy — _Crypto Whale Alerts_ (2026). https://www.bitget.site/academy/crypto-whale-alerts

---

_Research note compiled 2026-09-07. No vendor relationship, account or API key is implied or
established by this document. Whale-flow signals are informational; none constitutes a trading
signal or investment advice._
