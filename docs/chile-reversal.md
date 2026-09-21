# Chile Reversal

**ROBEX IA CHILERA V17 PRO**, ported to Atlas as a native price overlay.

Atlas indicators are JavaScript, not Pine Script. This is a behavioral port of the published Pine v6 script — the whole script, not a slice of it: the higher-timeframe pivot levels, the four price-vs-level patterns, the score that turns them into a call for the next round, and the chart output the original paints. The floating [Chile panel](chile-panel.md) window is the same engine's `table`, read off the newest bar of the same result, so the two can never disagree about a level or a call. The original's `alertcondition`s are not reproduced.

## Levels

Pine's level block, in order:

1. **Pivots.** `ta.pivothigh/pivotlow(high/low, pivotIzq, pivotDer)` on the round timeframe (default **15m**, matching the hard-coded `"15"`). A pivot is confirmed `pivotDer` bars after it forms and never appears earlier.
2. **Memory.** The last four pivot highs (`ph1..ph4`) and four pivot lows (`pl1..pl4`), pushed only on a _new_ pivot, as in `not na(pivotHigh15) and na(pivotHigh15[1])`.
3. **Selection.** R1/R2 are the two nearest remembered pivot highs strictly above the close; S1/S2 the two nearest pivot lows strictly below it. Recomputed every bar against the current close.
4. **Distance filter.** Candidates further than `maxDistATR × ATR(14)` of the round timeframe are discarded.
5. **Fallback.** If R1 or S1 is empty, the 6-bar round-timeframe high/low range fills the slot — Pine's `miniHigh`/`miniLow`. Fallback lines render dashed.

Levels are **exact prices**. V17 has no zone thickness, so the comparisons are against the level itself:

```pine
reboteS1  = low  <= soporte1    and close > soporte1    and close > open
rechazoR1 = high >= resistencia1 and close < resistencia1 and close < open
rompeResistencia = close > resistencia1 and close[1] <= resistencia1
rompeSoporte     = close < soporte1     and close[1] >= soporte1
```

### Deliberate correction

Pine's hand-rolled insertion sort can assign `r2`/`s2` while `r1`/`s1` is still `na` — the `ph2` branch runs its `else` when `ph1 <= close`, so a second level can exist with no first. Atlas always assigns the nearest candidate to R1/S1 and the runner-up to R2/S2, and never emits a second level without a first. This is covered by a test.

### A quirk the port keeps

Because R1 is re-resolved every bar as a pivot strictly **above** the close, `rompeResistencia = close > resistencia1 and close[1] <= resistencia1` cannot hold: by the time the close is above the level, that level is no longer the one R1 points at. The same is true of `rompeSoporte`. Both therefore contribute nothing to the score in the original, and Atlas keeps that instead of "fixing" it — a test pins the behaviour so a later change cannot silently make it fire.

## The score

Fourteen contributions a side, mirrored. Each one is the original's fixed number of points; nothing is weighted by conviction.

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
fuerzaAbajo  = 100 - fuerzaArriba
ventaja      = scoreUpPos - scoreDownPos

mercadoLateral = math.abs(ema9 - ema21) < atrLocal * 0.025 and rsiLocal > 47 and rsiLocal < 53
```

The call for the next round needs `minScore` points on one side **and** a `minVentaja`-point lead over the other, and `mercadoLateral` suppresses both: a braided EMA pair (`|EMA 9 − EMA 21| < 0.025 × ATR`) with the local RSI strictly inside 47–53 is ESPERAR however the trend stack reads.

## Labels on the chart

The original prints `ARRIBA`/`ABAJO` under one condition:

```pine
fin15 = minute(time_close, "GMT") % 15 == 0
if fin15 and barstate.isconfirmed
    label.new(bar_index, low,  "ARRIBA", style=label.style_label_up)
```

So a label belongs to a chart bar that **closes a round**, and only once that bar has closed. Atlas reproduces both halves: `official` is the round-close test, `confirmed` is `barstate.isconfirmed` (a bar is confirmed when its close time has passed), and a label needs a prediction other than ESPERAR. Labels sit at the bar's low for ARRIBA and its high for ABAJO, `shape.labelup`/`labeldown` as in Pine.

### What stays on screen

The engine reports every label in the loaded history; the overlay does not paint all of them. Pine paints under `max_labels_count` and garbage-collects the oldest, so the overlay keeps the newest 40 (`displayedChileSignals`).

On top of the cap, **labels are ephemeral**. Each one holds full strength for `markerTtlSeconds` (default 60), then fades linearly to nothing over `markerFadeSeconds` (default 15) and stops rendering (`chileMarkerExpiry`). The fade is a CSS animation whose delay encodes the label's age, so it advances in real time without re-renders, and a negative delay resumes mid-fade for a label that aged between renders. The clock is wall time on a live feed, where the newest bar tracks the present; demo and replay data are pinned away from the wall clock, so their clock is the close of the newest loaded bar — labels there age in data time as bars stream in. A lifetime of 0 restores always-on labels, subject only to the cap.

When the pile still needs cleaning, the legend's eraser button wipes every label currently printed; labels that print afterwards still appear. The wipe is recorded as a bar-close cutoff per indicator, so the cleared history never comes back on a later re-render. The legend tags how old the newest label is (`ARRIBA 12/3 · 12m`), plus `· fading`/`· faded` once a lifetime is set — the legend is the only trace left after a label fades off the price pane.

## The plots

Everything the script draws, drawn by the overlay and switchable from the settings dialog:

| Plot           | Pine                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------- |
| ROBEX Trend    | `ta.supertrend(factorTrend, atrTrendLen)`, `plot.style_linebr`, 3 px                         |
| EMA 9 / EMA 21 | `ta.ema(close, 9)` / `ta.ema(close, 21)` on the chart resolution, with the fill between them |
| VWAP           | `ta.vwap(hlc3)` for the session                                                              |
| R1/R2/S1/S2    | `line.new(bar_index - largoLinea, nivel, bar_index + 5, nivel)` plus the `"R1  price"` label |

## Higher-timeframe safety

The Pine source reads its HTF series with `request.security(..., x[1], lookahead=barmerge.lookahead_on)` — the closed-bar idiom. Atlas reproduces the intent directly: each chart bar maps to the newest round-timeframe bar that had already **closed**, so a developing round candle's eventual high or low never reaches an earlier chart bar. A test asserts that an extreme low placed in the newest HTF bar does not become a support level.

The **5m momentum read is the exception**, because the original asks for it without `[1]`: it is the 5m bar _containing_ the chart bar, so its EMA stack, RSI and body are forming values on the live edge. That is a repaint the script itself has — two points of the score can change as the 5m bar develops — and Atlas keeps it rather than inventing a stricter rule.

When the round timeframe is at or below the chart timeframe, the request degenerates to the chart series itself. When it is above, Atlas asks for a dedicated feed through the existing shared transport (one stream per distinct resolution, shared with the MACD MTF and peek window), including the 5m read. While a feed is still loading, the legend reads `15m feed…` and nothing is drawn — no invented levels.

## Inputs

| Setting                 | Pine input        | Default |
| ----------------------- | ----------------- | ------- |
| Round timeframe         | hard-coded `"15"` | 15m     |
| Minimum strength        | `minScore`        | 6       |
| Minimum edge            | `minVentaja`      | 2       |
| ROBEX trend sensitivity | `factorTrend`     | 2.4     |
| ROBEX trend ATR         | `atrTrendLen`     | 10      |
| Pivot left              | `pivotIzq`        | 2       |
| Pivot right             | `pivotDer`        | 2       |
| Max distance (ATR)      | `maxDistATR`      | 2.5     |
| Line length             | `largoLinea`      | 35      |
| Show ROBEX Trend        | —                 | on      |
| Show EMA 9/21           | —                 | on      |
| Show VWAP               | —                 | on      |
| Show nearby S/R levels  | `mostrarSR`       | on      |
| Label lifetime (s)      | —                 | 60      |
| Label fade (s)          | —                 | 15      |

The three plot toggles marked `—` are Atlas inputs for the corresponding `plot` calls, not inputs the script exposes. The rest are the original's names. These are the same inputs the [Chile panel](chile-panel.md) window borrows: one profile, one engine, two surfaces.

## Not a recommendation

This indicator describes price structure that has already printed. It places no orders and makes no forecast. A score of 12 to 4 is a reading of the last closed round, not a prediction of the next one.
