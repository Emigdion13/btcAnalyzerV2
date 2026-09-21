# Chile panel

The corner readout of **ROBEX IA CHILERA V17 PRO**, ported to Atlas as a floating window.

[Chile Reversal](chile-reversal.md) is the script's engine: the round-timeframe pivot levels, the
four price-vs-level patterns, and the score that turns them plus a trend, momentum and flow stack
into one call for the next round. This window is that engine's `table` — the same result, read off
its newest bar, so the panel and the chart can never disagree about a level or a call. **Alt L**
toggles the window; the toolbar **Floating** selector and the workspace menu also own it.

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
events are pattern matches against lagging pivot levels. Atlas has no alerting hook for it: unlike
the Pine script's `alertcondition`s, the panel only ever describes the current bar.

## Files

- `src/lib/chile-reversal.ts` — the engine: levels, patterns, score, plots (`chile-reversal.test.ts`)
- `src/lib/chile-panel.ts` — the readout layer over `ChileReversalResult.last` (`chile-panel.test.ts`)
- `src/components/ChilePanelWindow.tsx` — the floating window (`ChilePanelWindow.test.tsx`)
