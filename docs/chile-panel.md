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

## This round: the odds

The V17 call is about the **next** round. Once a round is under way, the question a 15-minute
up/down contract asks is about **this** one: does it close above the price it opened at? The
**THIS ROUND** line answers it from the two things that decide it — how far price has moved from
the open, and how much time is left for it to come back:

```
P(close > open) = Φ(Δ / (σ · √(τ / S)))
```

`Δ` is the engine's `round.move` (close minus the round open, in round ATR), `τ` the seconds left,
`S` the round length, and `σ = 0.63` one round's close-to-close spread in round ATR — a
maximum-likelihood fit on the same tape (0.61 on a 5m chart, 0.65 on a 1m chart). While the round is
open the odds are capped at 97/3: the walk is slightly overconfident in its tails, and the last
Coinbase trade is not the print a contract settles on. Once the round has closed, the line reads
`CLOSED ABOVE` or `CLOSED BELOW` until the next round's first bar arrives.

The V17 score is deliberately **not** in the formula. In the same one-off analysis, a logistic fit on
23,037 mid-round bar closes
gave it a small negative weight once `Δ` and `τ` were known, and it improved the out-of-sample log
loss by 0.0007 — nothing. When the V17 call disagreed with the side of the open, the round finished
the V17 way only 30% of the time with 10 minutes left and 20% with 5.

| 120 days, 5m chart | Odds favourite won | Brier (coin flip 0.250) |
| ------------------ | ------------------ | ----------------------- |
| 10 minutes left    | 70.4%              | 0.192                   |
| 5 minutes left     | 81.9%              | 0.130                   |
| All bar closes     | 76.2%              | 0.161                   |

Calibrated within about five points in every decile: rounds the odds put at 70–80% finished above
their open 78.9% of the time, rounds put at 30–40% finished above 29.7% of the time. `σ` was fitted
on this same tape; fitted on its first 70% alone, the last 30% calibrated just as well (70–80%
predictions finished above 75.8% of the time).

The clock is the chart markers' clock (`chileMarkerNowSeconds`): wall time on a live feed, the
data's own edge on demo history. A chart whose bar is longer than the round (a 1h chart on 15m
rounds) holds several rounds in one bar and shows no odds.

## The scorecard

Two rows under the readouts grade the window against what the rounds actually did:

- **V17 CALLS** — every round-close call (`official && confirmed`) graded against the next round's
  open → close. WAIT is recorded and never scored; a flat round is not scored either.
- **THIS-ROUND ODDS** — every closed bar's odds in the loaded history, graded against how its own
  round finished, with the Brier score in the tooltip.

A row turns green or red only when its 95% interval clears 50%; a short record reads neutral.
Neither number repaints: a round-close call reads only closed higher-timeframe bars plus a 5m bar
that closes with it, and a closed bar's odds are fixed, so grading the loaded history grades what
the window said live. The V17 grades are also saved on the device, one journal per market, chart
timeframe and score profile (the last 500 calls, twelve profiles), so the record outgrows the few
hundred bars a chart loads. Offline demo data is graded but never saved.

To measure a longer stretch than the bundled 15 days:

```bash
CHILE_BACKTEST_DAYS=120 npx vitest run src/lib/chile-backtest.test.ts
```

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
distance and the clock, not news, fat tails or the settlement print. Atlas has no alerting hook for
either: unlike the Pine script's `alertcondition`s, the panel only ever describes the current bar.

## Files

- `src/lib/chile-reversal.ts` — the engine: levels, patterns, score, plots (`chile-reversal.test.ts`)
- `src/lib/chile-panel.ts` — the readout layer over `ChileReversalResult.last` (`chile-panel.test.ts`)
- `src/lib/chile-odds.ts` — the this-round odds (`chile-odds.test.ts`)
- `src/lib/chile-scorecard.ts` — grading and the saved journal (`chile-scorecard.test.ts`)
- `src/lib/chile-backtest.test.ts` — the harness behind the tables on this page, on the bundled
  tape `src/lib/macd-training-data/btc-usd-5m-15d.json` or a fetched one
- `src/components/ChilePanelWindow.tsx` — the floating window (`ChilePanelWindow.test.tsx`)
