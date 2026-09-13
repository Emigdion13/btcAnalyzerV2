# Kalshi BTC 15-minute strategy research

Generated: 2026-09-13T12:15:07.934653+00:00

Sample: **5,678 KXBTC15M markets**, 2026-07-10T16:31:00+00:00 through 2026-09-08T16:29:00+00:00 UTC.

## Bottom line

The train/validation-selected configuration was **macd-thrust** on **5m BTC candles**, config `5-13-4`, entering at minute **12** only when the predicted side cost no more than **40%**. It held through settlement.

On the untouched test block it made **$434.02** across 48 simulated 100-contract entries (34.28% ROI on deployed cost; 35.4% directional accuracy). The bootstrapped 95% interval for mean P&L per 100-contract trade was **$-2.73 to $21.46**. Because that interval includes zero, this is a **promising but statistically inconclusive** result—not a demonstrated edge.

This is a historical midpoint simulation, **not proof of executable profit**. Entry and early-exit fills are stressed by 1¢ on each side and use the 7% × p × (1−p) taker-fee coefficient, but historical queue position and full depth are unavailable.

## Selected strategy by split

| Split | Trades | P&L / trade | ROI | Direction | Avg entry | Early exits |
|---|---:|---:|---:|---:|---:|---:|
| Train | 152 | $4.04 | 17.15% | 27.6% | 21.4% | 0.0% |
| Validation | 52 | $9.52 | 41.11% | 32.7% | 21.0% | 0.0% |
| Test | 48 | $9.04 | 34.28% | 35.4% | 24.1% | 0.0% |

## What each instrument contributed

- **BTC candles:** point-in-time OHLCV; only bars already closed and available at the decision timestamp were used.
- **RSI:** Wilder RSI periods 7/14/21 were tested as reversal and momentum rules.
- **MACD:** 5/13/4, 8/21/5, and 12/26/9 were tested, both sign and histogram-thrust variants.
- **Support/resistance:** prior 20/50-bar highs and lows, gated at 0.25/0.50 ATR(14), were tested.
- **Kalshi price:** the predicted UP or DOWN side had to be a low-priced contract at entry; this is the lower-% to higher-% setup.
- **Kalshi order book:** not claimed. The archive contains minute midpoint snapshots, not queue-aware historical L2.
- **BTC order book:** not used. A sufficiently long point-in-time L2 archive aligned to this sample was unavailable.

## Family comparison on untouched test data

These rows use one train/validation-selected configuration per family; the test block did not choose them.

| Family | Configuration | Trades | P&L / trade | ROI | Direction |
|---|---|---:|---:|---:|---:|
| macd-thrust | 5m, `5-13-4`, m12, cap 40%, tp 0% | 48 | $9.04 | 34.28% | 35.4% |
| macd | 15m, `12-26-9`, m12, cap 35%, tp 0% | 266 | $3.57 | 19.57% | 21.8% |
| rsi-momentum | 15m, `14-45-55`, m12, cap 35%, tp 0% | 154 | $2.09 | 11.17% | 20.8% |
| rsi-reversal | 15m, `7-30-70`, m2, cap 40%, tp 0% | 49 | $-2.00 | -6.12% | 30.6% |
| ensemble-rsi+macd+sr | 1m, `fixed`, m2, cap 50%, tp 0% | 48 | $-7.80 | -18.05% | 35.4% |
| sr-bounce | 5m, `20-0.5`, m12, cap 40%, tp 0% | 74 | $-6.21 | -33.80% | 12.2% |

## Data provenance and reproduction

The analysis used the public research archive in [SudoAptInstallMyBalls/Kalshi-Bot-Beta](https://github.com/SudoAptInstallMyBalls/Kalshi-Bot-Beta) at commit `9801a9b85e1332b31feddf481fc28971d1b5aae4`: `BTC-forecasts.jsonl` supplies point-in-time Kalshi midpoints/outcomes and `BTC/spot.sqlite` supplies Binance BTCUSDT one-minute candles. The raw archive is not copied into this repository. Results can be regenerated after cloning that archive with:

```bash
python scripts/analyze-kalshi-btc15m.py \
  --forecasts /path/to/BTC-forecasts.jsonl \
  --spot-db /path/to/BTC/spot.sqlite
```

The observations were sanity-checked for timestamp ordering, market count, probability bounds, and whole-market chronological splits, but are third-party archived observations rather than a first-party certified Kalshi research export.

## Method and guardrails

1. The supplied chronological `train`, `validation`, and `test` labels were preserved.
2. Configurations needed at least 100 train trades and 50 validation trades.
3. Within each family, train ROI first reduced the search to its top five configurations; validation ROI selected one. The global winner was selected from family winners by validation ROI.
4. The test split was opened only after selection. No indicator sees a candle before its recorded availability timestamp; support/resistance excludes the current bar.
5. Each simulated order buys 100 contracts at side midpoint +1¢. Settlement pays $100 if correct. A configured probability target exits at later midpoint −1¢. Taker fees are rounded up to cents per order.
6. P&L is not compounded and no martingale/Kelly sizing is used.

## Limitations

- Midpoint is not an executable ask. Even the 1¢ stress may be too optimistic in fast markets.
- Full Kalshi/BTC order books, latency, queue priority, partial fills, outages, and taxes are absent.
- BTC candles are Binance BTCUSDT while Kalshi settles from 60 one-second CF Benchmarks BRTI observations; basis can flip close outcomes.
- Multiple configurations were searched. The chronological holdout reduces overfitting but does not eliminate it; forward paper trading is required.
- A profitable backtest is not investment advice or a guarantee of future profit.

## Practical rule to paper-test

At minute 12 of a KXBTC15M window, compute the selected macd-thrust signal on completed 5m candles using `5-13-4`. Select UP or DOWN only when the signal is decisive and that side's executable ask is ≤40%. Hold to settlement. Skip the window if any input is stale or the spread/depth cannot support the intended size.
