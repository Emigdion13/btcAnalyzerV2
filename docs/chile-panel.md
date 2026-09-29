# Chile panel

The corner readout of **ROBEX IA CHILERA V17 PRO**, ported to Atlas as a floating window.

[Chile Reversal](chile-reversal.md) is the script's engine: the round-timeframe pivot levels, the
four price-vs-level patterns, and the score that turns them plus a trend, momentum and flow stack
into one call for the next round. This window is that engine's `table` — the same result, read off
its newest bar, so the panel and the chart can never disagree about a level or a call. **Alt L**
toggles the window; the toolbar **Floating** selector and the workspace menu also own it.

Like the Candle Pulse and the MTF RSI window it starts open only on a roomy viewport
(**1050×940+**). A 1440×900 chart has no free corner for it: the indicator legend owns the
top-left, the oscillator HUD cards tile the width just below it, the peek window the bottom-right
and the MTF RSI window the bottom-left. Below that size it starts closed and one keystroke away;
an explicit show or hide wins over the default and is remembered. Where it does open, `max-height`
keeps it inside the (clipping) chart container, so it can cover neither the legend above it nor
the top bar.

```pine
minScore = input.int(6, "Fuerza minima", minval=3, maxval=20)
minVentaja = input.int(2, "Ventaja minima", minval=1, maxval=8)
factorTrend = input.float(2.4, "Sensibilidad ROBEX Trend", minval=1.0, maxval=5.0, step=0.1)
atrTrendLen = input.int(10, "ATR ROBEX Trend", minval=5, maxval=30)
```

## The score

Fourteen contributions a side, mirrored. Nothing is weighted by conviction; each one is the
original's fixed number of points.

| Points | Up                                                      | Down                        |
| ------ | ------------------------------------------------------- | --------------------------- |
| 2      | `robexUp` — supertrend direction                        | `robexDown`                 |
| 2      | `trend15Up` — round EMA 9 > EMA 21                      | `trend15Down`               |
| 1      | `slopeUp` — both round EMAs rising                      | `slopeDown`                 |
| 2 / 1  | round RSI ≥ 55 / > 50                                   | ≤ 45 / < 50                 |
| 1 + 1  | `higherHigh`, `higherLow`                               | `lowerHigh`, `lowerLow`     |
| 2      | `momentumUp` — 5m EMA stack, RSI > 52, green 5m bar     | `momentumDown`              |
| 1      | `pressureUp` — chart EMA stack, close > EMA 9, RSI > 52 | `pressureDown`              |
| 1      | `sobreVWAP`                                             | `bajoVWAP`                  |
| 1      | `buyersStrong` — close position ≥ 60%                   | `sellersStrong`             |
| 1      | volume ≥ 1.20× and buyers strong                        | volume ≥ 1.20× and sellers  |
| 2 / 1  | `rondaFuerteUp` / `rondaUp`                             | `rondaFuerteDown` / down    |
| 3      | bounce off support, break of resistance                 | rejection, break of support |

```pine
fuerzaArriba = math.round(scoreUpPos * 100.0 / totalScore)
if not mercadoLateral and scoreUp >= minScore and ventajaUp >= minVentaja
    prediccion := 1
```

`fuerza` is each side's share of the total, which is what the window's split bar draws. The call
needs the minimum score **and** the minimum edge, and a lateral market suppresses both:

```pine
mercadoLateral = distanciaEMA < atrSeguro * 0.025 and rsiLocal > 47 and rsiLocal < 53
```

A flat market with the EMAs braided together and the local RSI inside 47–53 scores nothing at all,
however the trend stack reads. The window shows a **SIDEWAYS** chip while that holds.

## What the window reads

| Window row    | Pine panel row        | Source                                                               |
| ------------- | --------------------- | -------------------------------------------------------------------- |
| call          | `PROXIMA 15M`         | `prediccion` — ARRIBA / ABAJO / ESPERAR, shown as UP / DOWN / WAIT   |
| countdown     | `TIEMPO`              | seconds to the next round close; red at 60 s, amber at 180 s         |
| up/down force | `FUERZA ARRIBA/ABAJO` | each side's share of the score                                       |
| buyers        | `COMPRADORES`         | `round((close − low) / range × 100)` — **not** a tape reading        |
| sellers       | `VENDEDORES`          | the complement                                                       |
| volume        | `VOLUMEN`             | `volume / sma(volume, 20)` — NORMAL / HIGH ≥ 1.20 / VERY HIGH ≥ 1.60 |
| RSI           | `RSI 15M`             | Wilder RSI 14 on the **closed** round bar                            |
| trend         | `TENDENCIA`           | supertrend and the round EMA cross have to agree to name a trend     |
| S/R           | `S/R 15M`             | proximity, then reversal state — see below                           |

The countdown is the only thing that moves between candles; the call itself updates on every chart
bar, exactly like the Pine panel, which repaints on `barstate.islast`. A **ROUND CLOSE** chip marks
the bar the original would print its signals on (`fin15 and barstate.isconfirmed`).

**Buyers and sellers are a shape reading, not flow.** There is no order flow in a candle: the
number is where in the bar the close landed. A bar that closes at its high reads 100% buyers
whether it was bought up or shorted into. The tooltip says so.

## One engine, two surfaces

`lib/chile-panel.ts` computes nothing. It reads `ChileReversalResult.last` — the newest bar the
engine scored — and shapes it for the window, so the reversal points, the S/R row (whose proximity
band is the original's `0.20 × ATR`) and the score split are the same numbers the overlay drew.
The panel cannot cheer a pattern the chart has not got, because it never evaluates one itself.

The one live read is inherited from the engine. The original requests the 5m series _without_ `[1]`:

```pine
ema9_5 = request.security(syminfo.tickerid, "5", ta.ema(close, 9))
```

so it is the forming 5m bar — two points of the score can move as that bar develops. Every other
higher-timeframe read is the closed-bar idiom (`x[1]` under `lookahead_on`) through the same mapper
the overlay uses, so the panel and the chart read one and the same round candle. A 5m feed that has
not answered contributes nothing rather than a made-up 2 points, and the round feed being down
stops the score entirely — the window says `15m feed loading…` instead of showing zeros, and
`Warming the 15m ATR…` while `ta.atr(14)` has not filled.

## How the V17 call has done

Before anything was added to the window, the V17 call was measured. `src/lib/chile-backtest.test.ts`
replays real Coinbase BTC-USD 5m history through the production engine (5m chart, 15m rounds,
default profile) and grades every round-close call against the round it was about:

| 120 days, June–September 2026 | Result                                             |
| ----------------------------- | -------------------------------------------------- |
| Rounds graded                 | 11,424 (49.5% finished up)                         |
| V17 call, next round          | **47.2% right** ±1.0 (4,738 of 10,034; 1,388 WAIT) |
| Repeat the last round         | 48.4%                                              |
| Fade the last round           | 51.6%                                              |

A one-off analysis of the same tape, with a line-for-line replica of the engine that reproduces the
47.2% to within 0.1 point, broke the record down further. It is below a coin flip in every month of
the sample — 46.2%, 47.3%, 48.4%, 47.2% — through a 20% fall and a 25% rally alike. Twelve of the
thirteen score families are trend readings that mostly
agree with each other (five of them side with the supertrend 71–89% of the time), and in this tape
a 15-minute round mildly mean-reverts, so each trend vote is slightly wrong and stacking them makes
the call confidently wrong: an edge of +8 or more was followed by an up round 44.8% of the time.
Every family taken alone points the wrong way except the bounce/rejection pair (51.2%).

The engine is kept exactly as ported — it is a published script, and the chart overlay prints its
labels — but the window no longer lets it stand alone. It adds the odds below, and a scorecard so
the call's record is always on screen.

### Every other indicator, too

A second one-off analysis asked the same of everything else Atlas ships: 38 readings from RSI,
MACD, the EMAs, Bollinger, VWAP, volume, WaveTrend, CM_Ult_MacD, Williams VixFix, Trend Pressure,
TMO, TUX EMA + SuperTrend, Bayesian/nQQE/BankFunds, the PAC channel and the V17 score itself, each
computed with the production code on 180 days of Coinbase BTC-USD 5m (April–September 2026). Each
was checked first for repainting — recomputed on the tape cut off at ten points, its value at the
cut had to match the full run — and none repaints.

- **Next round.** Read the way it reads, every trend and momentum reading was right 47–49% of the
  time: the same mean reversion that sinks V17. A model of all 38 fitted on April to mid-July scored
  51.3% on mid-July to September — nothing a fee would leave standing.
- **This round.** None added anything to the distance-and-clock odds below: every out-of-sample
  log-loss gain sat inside its noise, and all 38 together scored slightly worse than the odds alone.

The one exception is the reversion at its sharpest, which the window now marks: see
[RSI extremes](#rsi-extremes).

## This round: the odds

The V17 call is about the **next** round. Once a round is under way, the question a 15-minute
up/down contract asks is about **this** one: does it settle above the price it is played against?
The **THIS ROUND** line answers it from the two things that decide it — how far price has moved
from the strike, and how much time is left for it to come back:

```
P(settle > strike) = Φ(Δ / (σ · √(τ / S)))
```

`Δ` is the distance from the strike in round ATR, `τ` the seconds of movement still to come, `S` the
round length, and `σ = 0.63` one round's close-to-close spread in round ATR — a maximum-likelihood
fit on the June–September tape (0.61 on a 5m chart, 0.65 on a 1m chart). While the round is open
the odds are capped at 97/3: the walk is slightly overconfident in its tails. Once the round has
closed, the line reads `CLOSED ABOVE` or `CLOSED BELOW` until the next round's first bar arrives.

What the strike and the settlement are depends on the round:

- **A Kalshi window** — a 15-minute round on a real feed of a coin Kalshi lists (BTC, ETH, SOL,
  XRP, DOGE, HYPE, BNB), charted at 15m or finer — is played the way Kalshi settles it. The strike
  is Kalshi's published `floor_strike`, the 60-second BRTI average ending at the open, labelled
  `Kalshi strike` in the window; the Coinbase open missed it by $12.60 on average for BTC. The
  settlement is the 60-second average ending at the close, so the last minute moves the result
  like a third of a minute would: `τ` is the clock less 40 seconds, and inside the final minute
  `τ³ / (3 · 60²)` (the part of the average already printed is taken at the current price, since a
  chart bar cannot resolve seconds). Until Kalshi has published the strike — about a second into the
  window — the round is played against its open.
- **Anything else** — another round length, a pair Kalshi does not list, the metal ladders (which
  settle on a Pyth one-minute close, not an average), demo data — is played against the round's own
  open, to its last print: `Δ` is the engine's `round.move`.

The V17 score is deliberately **not** in the formula. In the first one-off analysis, a logistic fit
on 23,037 mid-round bar closes gave it a small negative weight once `Δ` and `τ` were known, and it
improved the out-of-sample log loss by 0.0007 — nothing. When the V17 call disagreed with the side
of the open, the round finished the V17 way only 30% of the time with 10 minutes left and 20% with 5. None of the other indicators did better (see above).

| 120 days, 5m chart | Odds favourite won | Brier (coin flip 0.250) |
| ------------------ | ------------------ | ----------------------- |
| 10 minutes left    | 70.4%              | 0.192                   |
| 5 minutes left     | 81.9%              | 0.130                   |
| All bar closes     | 76.2%              | 0.161                   |

Calibrated within about five points in every decile: rounds the odds put at 70–80% finished above
their open 78.9% of the time, rounds put at 30–40% finished above 29.7% of the time. `σ` was fitted
on this same tape; fitted on its first 70% alone, the last 30% calibrated just as well (70–80%
predictions finished above 75.8% of the time).

### Against Kalshi's own price

A 76% favourite is only worth something if the market has not already priced it — and every trader
on the contract can see the distance and the clock. A third one-off analysis pulled Kalshi's
minute-by-minute bid and ask for 5,719 KXBTC15M windows (30 July – 29 September 2026), set the odds
beside the market's mid at the end of each minute, and graded both on Kalshi's own result. Fitted
where anything was fitted on the first 30 days, scored on the last 30 (39,142 market-minutes):

| Last 30 days                             | Favourite won | Brier      |
| ---------------------------------------- | ------------- | ---------- |
| **Kalshi's market price**                | **75.7%**     | **0.1583** |
| The odds against the Coinbase open       | 75.0%         | 0.1644     |
| + Kalshi's strike                        | 75.5%         | 0.1619     |
| + the 60-second settlement average       | 75.5%         | 0.1615     |
| Realised volatility instead of round ATR | 75.5%         | 0.1625     |
| Hour-of-day volatility                   | 75.5%         | 0.1627     |

The panel ships the fourth row. The strike and the settlement rule are most of the gap; with one
minute left they took the Brier score from 0.081 to 0.066 (the market: 0.057). Volatility models
fitted on the first half did not help on the second, and refitting `σ` against Kalshi's strike gave
0.61 and no better score, so `σ` stays at 0.63.

The market is still ahead at every minute of the round. A logistic blend of the two gave the odds a
weight of about 0.1 against the market's 0.95 and no out-of-sample gain; where the odds and the mid
disagreed by 5 points or more, the side the odds preferred won about as often as its ask implied —
47.9% of the time against a 47.8% price. So the window shows the market beside its own number:
**KALSHI UP x% · DOWN y%**, Kalshi's displayed price for this very round (the last trade, clamped
to the bid and ask), with the fee-inclusive cost of each side in the tooltip. A price for any other
window is never shown, and a feed that has stopped refreshing dims.

The clock is the chart markers' clock (`chileMarkerNowSeconds`): wall time on a live feed, the
data's own edge on demo history. A chart whose bar is longer than the round (a 1h chart on 15m
rounds) holds several rounds in one bar and shows no odds.

## RSI extremes

The mean reversion that makes every trend reading slightly wrong is strongest after a stretched
move. When the **5m RSI(14) closes below 30 as a round opens**, the round has tended to finish up;
**above 70**, down. The window marks such a round with an **RSI EXTREME** line — `5m RSI 27 at
open → UP` — for as long as it runs:

| Tape                                               | Rounds | Right      |
| -------------------------------------------------- | ------ | ---------- |
| Coinbase BTC-USD, April – mid July 2026            | 785    | 58.5%      |
| Coinbase BTC-USD, mid July – September 2026        | 541    | 58.4%      |
| Kalshi's settlement, April – September 2026        | 1,292  | 56.6% ±2.7 |
| The production code on 180 days (`chile-backtest`) | 1,337  | 58.6% ±2.6 |

It came out between 54.6% and 61.4% in every one of the six months, and it fires about seven times
a day. Against the market it is thinner: in the first minute of those 1,292 Kalshi windows the ask
for the signal's side averaged 52.3%, so the market prices a little of it. After Kalshi's taker fee
(`0.07 · P · (1 − P)` a contract) that left about **+2.7¢ per contract**, with a 95% range of
roughly 0 to +5¢.

That is promising, not proven. The reading was picked out of 38 on those same months, and the
bottom of its range is break-even. Only a live record can settle it, so the window keeps one — the
**RSI EXTREMES** scorecard row below, with the price each signal's side actually cost.

The reading is the RSI of the 5m bar that closes as the round opens — the same 5m series the V17
momentum read uses, whatever the chart timeframe — and a bar still forming is never read. It is
measured on 15-minute rounds only; with any other round length the window neither marks it nor
keeps its record.

## The scorecard

Three rows under the readouts grade the window against what the rounds actually did:

- **V17 CALLS** — every round-close call (`official && confirmed`) graded against the next round's
  open → close. WAIT is recorded and never scored; a flat round is not scored either.
- **THIS-ROUND ODDS** — every closed bar's odds in the loaded history, graded against how its own
  round finished, with the Brier score in the tooltip. On a Kalshi window each bar is played against
  Kalshi's strike and graded on Kalshi's published settlement (a tie resolves up, as Kalshi's does);
  rounds Kalshi's feed no longer carries — it holds about the last 15 hours — are left out rather
  than graded some other way.
- **RSI EXTREMES** — every round that opened on an extreme, graded against how it settled: on
  Kalshi's published result where there is one, otherwise the Coinbase open → close. While the
  window is open between one and two minutes into a signal round on a Kalshi pair, it records the
  fee-inclusive price of the signal's side (`1 / Kalshi's x`), and the row reads `paid 53¢` beside
  the hit rate. Priced, the row is judged against what it cost: green only once the win rate less
  the price clears zero at 95%.

The V17 and odds rows turn green or red only when their 95% interval clears 50%; a short record
reads neutral. None of the numbers repaints: a round-close call reads only closed higher-timeframe
bars plus a 5m bar that closes with it, a closed bar's odds are fixed, and an RSI reading is taken
off a closed 5m bar, so grading the loaded history grades what the window said live. The V17 grades
are also saved on the device, one journal per market, chart timeframe and score profile (the last
500 calls, twelve profiles), so the record outgrows the few hundred bars a chart loads. The RSI
record is saved per market alone (the last 500 signals, twelve markets): it reads neither the chart
timeframe nor the V17 profile, and a Kalshi-settled grade is never replaced by a Coinbase one.
Offline demo data is graded but never saved.

To measure a longer stretch than the bundled 15 days:

```bash
CHILE_BACKTEST_DAYS=120 npx vitest run src/lib/chile-backtest.test.ts
```

The harness grades the V17 call, the odds and the RSI extremes on Coinbase's own rounds; the
comparisons with Kalshi's price were one-off analyses, since Kalshi's minute history is fetched one
window at a time.

## Profile

The window borrows the whole profile of the chart's **Chile Reversal** indicator — pivots, distance
filter, and the four score inputs — because it is the same engine run with the same settings. With
no Chile indicator on the chart it runs the published defaults and offers to add one, which is
where the inputs live:

| Setting                 | Pine input    | Default |
| ----------------------- | ------------- | ------- |
| Minimum strength        | `minScore`    | 6       |
| Minimum edge            | `minVentaja`  | 2       |
| ROBEX trend sensitivity | `factorTrend` | 2.4     |
| ROBEX trend ATR         | `atrTrendLen` | 10      |

The round and the pivot timeframe are the same setting (`resolution`, default 15m), and the
momentum read is always 5m, as in the original.

## Not a recommendation

The score is a tally of evidence that has already printed, mostly on a higher timeframe than the
chart you are watching. It places no orders, has no entry, stop or target, and the +3 reversal
events are pattern matches against lagging pivot levels. Measured, it calls the next round slightly
worse than a coin flip. The this-round odds are a random walk with a fitted spread: they know the
distance and the clock, not news, fat tails or the order book, and Kalshi's own price has called
the round better than they do. The RSI extreme is one reading whose edge over the market's price
has not been shown to survive the fee. Atlas has no alerting hook for any of them: unlike the Pine
script's `alertcondition`s, the panel only ever describes the current bar.

## Files

- `src/lib/chile-reversal.ts` — the engine: levels, patterns, score, plots (`chile-reversal.test.ts`)
- `src/lib/chile-panel.ts` — the readout layer over `ChileReversalResult.last` (`chile-panel.test.ts`)
- `src/lib/chile-odds.ts` — the this-round odds (`chile-odds.test.ts`)
- `src/lib/chile-kalshi.ts` — Kalshi's strike, settlements and price, as the window reads them
  (`chile-kalshi.test.ts`)
- `src/lib/chile-rsi-extreme.ts` — the RSI extreme: reading, grading, priced journal
  (`chile-rsi-extreme.test.ts`)
- `src/lib/chile-scorecard.ts` — grading and the saved journal (`chile-scorecard.test.ts`)
- `src/lib/chile-backtest.test.ts` — the harness behind the tables on this page, on the bundled
  tape `src/lib/macd-training-data/btc-usd-5m-15d.json` or a fetched one
- `src/components/ChilePanelWindow.tsx` — the floating window (`ChilePanelWindow.test.tsx`)
