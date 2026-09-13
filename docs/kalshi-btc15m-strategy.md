# Kalshi BTC 15-minute strategy research

Generated: 2026-09-13T19:03:34.637497+00:00

Sample: **5,678 KXBTC15M markets**, 2026-07-10T16:31:00+00:00 through 2026-09-08T16:29:00+00:00 UTC.

## Bottom line

The train/validation-selected configuration was **stoch-reversal** on **5m BTC candles**, config `14-3-20-80`, entering at minute **12** only when the predicted side cost no more than **35%**. It held through settlement.

On the untouched test block it returned **−$327.75** across 122 simulated 100-contract entries (−15.40% ROI on deployed cost; 14.8% directional accuracy). The bootstrapped 95% interval for mean P&L per 100-contract trade was **−$8.47 to $3.66**. It lost money out of sample, so the laboratory rejected it.

This is a historical midpoint simulation, **not proof of executable profit**. Entry and early-exit fills are stressed by 1¢ on each side and use the 7% × p × (1−p) taker-fee coefficient, but historical queue position and full depth are unavailable.

## Selected strategy by split

| Split | Trades | P&L / trade | ROI | Direction | Avg entry | Early exits |
|---|---:|---:|---:|---:|---:|---:|
| Train | 263 | $2.85 | 16.49% | 20.2% | 15.4% | 0.0% |
| Validation | 116 | $10.15 | 61.21% | 26.7% | 14.7% | 0.0% |
| Test | 122 | $-2.69 | -15.40% | 14.8% | 15.5% | 0.0% |

## Indicator laboratory

The expanded search evaluated **29,088 combinations** across 1m/3m/5m/15m candles, six entry times, four low-price caps, and hold/+10/+20-point exits. It covered Wilder RSI; standard and fast MACD; SMA/EMA crosses; Bollinger Bands; Stochastic; Williams %R; CCI; MFI; ROC; Donchian channels; ADX/DMI; rolling VWAP; OBV; ATR-normalized support/resistance; and indicator ensembles. These are reproducible non-repainting families—not every community or proprietary TradingView script.

**Laboratory verdict: no indicator earned the label “will make you win.”** The configuration selected without looking at test data was spectacular in validation and then lost 15.4% out of sample. That reversal is direct evidence of search overfitting.

Exploratory—not newly validated—observations from the test leaderboard:

- **Highest test win rate with at least 50 trades:** 1m CCI(14), ±100 momentum, minute 1, ≤50% entry: 52.6% over 97 trades and 11.5% simulated ROI, but it lost 7.6% in validation.
- **Most stable point estimates:** 1m CCI(20), ±100 reversal, minute 12, ≤40% entry: +14.5% train, +10.3% validation, +7.3% test over 308/140/149 trades. Its test bootstrap interval was −$4.53 to +$7.35 per 100-contract trade, so it remains a paper-test candidate, not a proven edge.
- The earlier **5m MACD 5/13/4 thrust** result remained +34.3% in test, but only 48 test trades qualified and its confidence interval also crossed zero.

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
| williams-momentum | 3m, `7-80-20`, m4, cap 45%, tp 0% | 58 | $10.91 | 26.73% | 51.7% |
| stoch-momentum | 5m, `14-3-20-80`, m12, cap 50%, tp 0% | 110 | $5.54 | 20.37% | 32.7% |
| donchian-breakout | 3m, `10-0.25`, m4, cap 50%, tp 0% | 48 | $9.02 | 19.97% | 54.2% |
| macd | 15m, `12-26-9`, m12, cap 35%, tp 0% | 266 | $3.57 | 19.57% | 21.8% |
| obv-momentum | 15m, `10`, m12, cap 40%, tp 0% | 285 | $3.61 | 18.12% | 23.5% |
| adx-directional | 15m, `7-25`, m12, cap 35%, tp 0% | 168 | $3.20 | 17.58% | 21.4% |
| roc-momentum | 3m, `3-0.1`, m4, cap 45%, tp 0% | 48 | $6.49 | 17.43% | 43.8% |
| vwap-trend | 5m, `50-0.1`, m12, cap 40%, tp 0% | 161 | $3.36 | 16.60% | 23.6% |
| cci-momentum | 1m, `14-100`, m1, cap 50%, tp 0% | 97 | $5.42 | 11.49% | 52.6% |
| rsi-momentum | 15m, `14-45-55`, m12, cap 35%, tp 0% | 154 | $2.09 | 11.17% | 20.8% |
| mfi-reversal | 1m, `7-20-80`, m12, cap 40%, tp 0% | 95 | $1.87 | 10.30% | 20.0% |
| ema-cross | 3m, `50-200`, m12, cap 35%, tp 0% | 255 | $1.76 | 9.24% | 20.8% |
| cci-reversal | 1m, `20-100`, m12, cap 40%, tp 0% | 149 | $1.14 | 7.30% | 16.8% |
| bollinger-breakout | 15m, `20-1.5`, m12, cap 40%, tp 0% | 72 | $1.15 | 5.84% | 20.8% |
| sma-cross | 3m, `50-200`, m12, cap 35%, tp 0% | 251 | $0.78 | 4.13% | 19.5% |
| williams-reversal | 15m, `14-80-20`, m12, cap 35%, tp 0% | 80 | $0.22 | 1.19% | 18.8% |
| bollinger-reversal | 5m, `10-1.5`, m12, cap 35%, tp 0% | 81 | $-0.27 | -1.96% | 13.6% |
| mfi-momentum | 15m, `14-30-70`, m12, cap 45%, tp 0% | 63 | $-1.06 | -4.90% | 20.6% |
| roc-reversal | 3m, `5-0.1`, m12, cap 35%, tp 0% | 112 | $-0.71 | -5.01% | 13.4% |
| vwap-reversal | 5m, `20-0.1`, m12, cap 35%, tp 0% | 149 | $-0.90 | -5.28% | 16.1% |
| rsi-reversal | 15m, `7-30-70`, m2, cap 40%, tp 0% | 49 | $-2.00 | -6.12% | 30.6% |
| stoch-reversal | 5m, `14-3-20-80`, m12, cap 35%, tp 0% | 122 | $-2.69 | -15.40% | 14.8% |
| ensemble-rsi+macd+sr | 1m, `fixed`, m2, cap 50%, tp 0% | 48 | $-7.80 | -18.05% | 35.4% |
| donchian-reversal | 5m, `10-0.25`, m12, cap 35%, tp 0% | 88 | $-3.54 | -23.76% | 11.4% |
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

## Practical conclusion

Do **not** deploy the validation winner: it failed the untouched test. If continuing the research, preregister a new forward paper-test before collecting any new outcomes. The leading stability candidate is: at minute 12, calculate 1m CCI(20); CCI ≤−100 signals UP (mean reversal), CCI ≥+100 signals DOWN, enter only when that side’s actual ask is ≤40%, and hold to settlement. Skip stale, wide-spread, or shallow-book windows. This rule is a hypothesis for new data—not a promise or live-trading recommendation.
