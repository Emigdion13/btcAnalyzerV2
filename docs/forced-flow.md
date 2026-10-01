# Forced flow · liquidations behind the move

Sometimes BTC makes a move that seems to come from nowhere: a sharp wick with no news and no
visible buyer or seller on Coinbase. Often the cause is leverage being force-closed on the
futures venues. Coinbase spot cannot see that: a liquidation happens on a derivatives exchange, and
the spot chart only shows the wick it leaves. The **Forced flow** box reads the perpetual-futures
venues reachable without an account and says, for the last five minutes, whether the move is
forced.

Nothing here is a trading signal or investment advice.

## What it reads

| Source                                | What                                       | How                |
| ------------------------------------- | ------------------------------------------ | ------------------ |
| OKX (`BTC-USDT-SWAP`, `BTC-USD-SWAP`) | open interest, mark, funding, liquidations | REST every 15s, WS |
| Kraken Futures (`PF_XBTUSD`)          | open interest, mark, funding, liquidations | REST every 15s, WS |
| Deribit (`BTC-PERPETUAL`)             | open interest, mark, funding, liquidations | REST every 15s, WS |
| Hyperliquid (`BTC`)                   | open interest, mark, funding               | REST every 15s     |
| Coinbase International (`BTC-PERP`)   | open interest, mark                        | REST every 15s     |

All are public market data: no keys, no accounts, no orders. **Binance and Bybit are not read**,
because both refuse connections from this region (HTTP 451 and a CloudFront 403, checked
2026-09-30). They are the two largest perpetual venues, so the open interest here is roughly half
the market and the liquidation totals are a floor. OKX also throttles its liquidation feed to the
latest order per instrument per second.

The server (`server/derivatives-service.ts`) only starts polling and connecting once a chart
streams a product with perpetuals, and stops five seconds after the last chart closes. The
snapshot rides on the chart's existing 1 Hz stream as `forcedFlow`.

## The rule

`classifyForcedFlow` in `shared/forced-flow.ts`, used by both the live box and the backtest:

1. **Liquidation burst.** At least $100K force-closed on one side in the last 60 seconds, and at
   least twice the other side, is forced flow on its own (open-interest polls lag a cascade).
2. Otherwise the five-minute window must be a **big move**: |price change| at or above the 90th
   percentile of recent five-minute windows.
3. Then the open-interest change across the venues that reported at both ends of the window decides:
   - at or below its 10th percentile: positions are being closed, so it is **longs being
     liquidated** (price down) or **shorts being squeezed** (price up);
   - at or above its 90th percentile: **new shorts** or **new longs** opening;
   - in between: **big move, leverage steady**, i.e. spot-led or hedged flow.

The percentile thresholds come from about five days of non-overlapping five-minute windows. They
are seeded at startup from OKX's own five-minute OI and candle history, then fed with live windows.

Funding is the mean 8-hour-equivalent rate across OKX, Kraken, Deribit and Hyperliquid. Above
0.03% per 8h reads **longs crowded**, below −0.01% **shorts crowded**.

The chart marks each long or short squeeze with a small **LIQ** triangle on the bar where it began,
for four hours. Markers are hidden when the box is hidden.

## Does a forced move snap back?

The popular story is that a liquidation wick is mechanical, so once the forced orders are done
price returns. `src/lib/forced-flow.backtest.test.ts` tests this with the same rule on 180 days of
Coinbase BTC-USD five-minute bars (2026-04 → 2026-09), using Kraken Futures' published OI history.
Kraken is the only free source with months of OI history from here; OKX keeps five days at five
minutes. Each big move is graded on whether price traded back half the move within 15 minutes and
within an hour. The control is every big move, whatever OI did.

| Label                     | Moves | Half back in 15m | Half back in 60m | vs all moves, 15m (95% CI) |
| ------------------------- | ----- | ---------------- | ---------------- | -------------------------- |
| All big moves             | 5,432 | 59.0%            | 77.6%            |                            |
| Longs being liquidated    | 621   | 60.2%            | 78.1%            | −2.9 … +3.6 pp             |
| Shorts being squeezed     | 844   | 57.6%            | 75.8%            | −4.8 … +1.6 pp             |
| New shorts                | 588   | 61.4%            | 78.6%            | +0.5 … +7.0 pp             |
| New longs                 | 504   | 58.7%            | 77.4%            | −5.5 … +3.3 pp             |
| Big move, leverage steady | 2,875 | 58.7%            | 77.8%            | −1.7 … +1.1 pp             |
| Heavy liquidation volume  | 1,647 | 59.9%            | 76.7%            | −0.3 … +2.5 pp             |

**Forced moves retrace no more often than any other move of the same size.** The one interval that
clears zero (new shorts at 15m) is gone at 60m. With seven comparisons, one marginal result is what
chance alone would give. Both halves of the period agree with the full table.

Two more checks, done while building this:

- **Crowding does not predict direction.** OKX funding over 94 days (282 settlements): after the
  highest third of funding, BTC rose over the next 8h 60.6% of the time, against 49.5% after the
  lowest third. That is the opposite of "crowded longs get dragged down", and with 94 samples per
  group it is inside the noise. Kraken's long/short account ratio over 180 days showed nothing at
  all (50.0% / 48.9% / 52.3% up over the next hour by tercile).
- **OKX at higher resolution** (60 days of hourly OI, 15 days at 15m, 5 days at 5m) had only 45–59
  big moves per resolution: too few to confirm or contradict anything.

So the box **explains** a move — it tells you a wick was margin calls and not a news buyer — but it
does not tell you what happens next. The info panel says so, with these numbers.

To re-measure:

```
FORCED_FLOW_DAYS=180 npx vitest run src/lib/forced-flow.backtest.test.ts
```

The printed rows are what `FORCED_FOLLOW_THROUGH` in `shared/forced-flow.ts` holds.

## What would make it better

- **Binance and Bybit open interest and liquidations.** Most of the market. They would need a
  connection from a region they serve.
- **Aggregated history.** Coinalyze's free API serves cross-venue OI and liquidation history but
  needs an API key, i.e. an account.
- **A liquidation heatmap** (estimated clusters of liquidation prices) is sold by CoinGlass from
  $29/month. It is a model of inferred entry prices, not data. Hyperliquid's public positions are
  the only free source of real liquidation prices, for one venue. See
  [whale flow sources](whale-flow-sources.md#derivatives-positioning-and-liquidation-clusters-layer-4).
