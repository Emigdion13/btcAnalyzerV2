# Chile Reversal

The reversal core of **ROBEX IA CHILERA V18 PRO**, ported to Atlas as a native price overlay.

Atlas indicators are JavaScript, not Pine Script. This is a behavioral port of one part of a published Pine v6 script: the four price-vs-level patterns that encode reversal behavior. Everything else in the original — the 20-point trend score, the 15m prediction panel, the countdown, the alerts — is deliberately not reproduced.

## Why only the reversal core

The Pine original is a **trend-continuation scoring engine**. Reversal behavior appears in exactly four booleans:

```pine
reboteS1  = low  <= soporte1 + grosorZona    and close > soporte1    and close > open
rechazoR1 = high >= resistencia1 - grosorZona and close < resistencia1 and close < open
rompeResistencia = close > R1 + grosorZona and close[1] <= R1 + grosorZona
rompeSoporte     = close < S1 - grosorZona and close[1] >= S1 - grosorZona
```

Each contributes +3 to a score that can exceed 20, so a reversal can never fire a signal on its own — it needs the EMA/RSI/momentum/VWAP stack already leaning the same way. A genuine counter-trend turn scores +3 against 8–12 opposing points and is filtered out by `ventaja >= minVentaja`.

Isolating these four makes the reversal logic itself visible, instead of a trend score that happens to contain it. **Read the marks accordingly: bounces and rejections in a trending market are pullback continuations, not trend reversals.**

## Levels

1. **Pivots.** `ta.pivothigh/pivotlow(high/low, pivotLeft, pivotRight)` on the pivot timeframe (default 15m, matching Pine's hard-coded `"15"`). A pivot is confirmed `pivotRight` bars after it forms and never appears earlier.
2. **Memory.** The last four pivot highs (`ph1..ph4`) and four pivot lows (`pl1..pl4`), pushed only on a _new_ pivot, as in `not na(pivotHigh15) and na(pivotHigh15[1])`.
3. **Selection.** R1/R2 are the two nearest remembered pivot highs strictly above the close; S1/S2 the two nearest pivot lows strictly below it. Recomputed every bar against the current close.
4. **Distance filter.** Candidates further than `maxDistanceAtr × ATR(14)` of the pivot timeframe are discarded.
5. **Fallback.** If R1 or S1 is empty, the 6-bar pivot-timeframe high/low range fills the slot — Pine's `miniHigh`/`miniLow`. Fallback levels render with a dashed border.
6. **Zone.** Half-thickness is `zoneThicknessAtr × ATR(14)`, default 0.10.

### Deliberate correction

Pine's hand-rolled insertion sort can assign `r2`/`s2` while `r1`/`s1` is still `na` — the `ph2` branch runs its `else` when `ph1 <= close`, so a second level can exist with no first. Atlas always assigns the nearest candidate to R1/S1 and the runner-up to R2/S2, and never emits a second level without a first. This is covered by a test.

## Signals

| Marker       | Condition                                                      | Direction |
| ------------ | -------------------------------------------------------------- | --------- |
| **Bounce** ▲ | Wick into the support zone, close above the level, green body  | Bullish   |
| **Reject** ▼ | Wick into the resistance zone, close below the level, red body | Bearish   |
| **Break** ▮  | Close beyond R1 + zone / S1 − zone, previous close inside      | Break     |

Breaks compare against the **previous** bar's level set, matching `close[1] <= resistencia1 + grosorZona`. As in the original, rebound and rejection are evaluated on the **chart** candle against **higher-timeframe** levels; the Pine script mixes resolutions the same way, so a 1m candle poking a 15m pivot counts.

### What the chart keeps on screen

The engine reports every signal in the loaded history; the overlay does not print all of them. Pine paints under `max_labels_count` (default ~50) and garbage-collects the oldest labels, so the overlay does the equivalent: a run of the same pattern at the same level on consecutive bars collapses to its freshest print, and only the newest 40 markers stay (`displayedChileSignals`). Without that, rows of reprinted **Bounce**/**Reject** texts from aged bars smeared together and read as floating artifacts rather than markers of a bar.

On top of the count cap, **markers are ephemeral**. Each one prints when its bar closes, holds full strength for `markerTtlSeconds` (default 60), then fades linearly to nothing over `markerFadeSeconds` (default 15) and stops rendering (`chileMarkerExpiry`). The fade is a CSS animation whose delay encodes the marker's age, so it advances in real time without re-renders, and a negative delay resumes mid-fade for a marker that aged between renders. The clock is wall time on a live feed, where the newest bar tracks the present; demo and replay data are pinned away from the wall clock, so their clock is the close of the newest loaded bar — markers there age in data time as bars stream in. A lifetime of 0 restores the always-on behaviour, subject only to the 40-marker cap.

When the pile still needs manual cleaning, the legend's eraser button (in the indicator row, next to the eye toggle) wipes every marker currently printed; signals that print afterwards still appear. The wipe is recorded as a bar-close cutoff per indicator, so the cleared history never comes back on a later re-render.

Both SVG safety and freshness show up elsewhere too: the overlay is clipped to the main pane, and the legend tags how old the newest signal is (`Reject R1 · 12m`), plus `· fading`/`· faded` once a lifetime is set — the legend is the only trace left after a marker fades off the price pane.

## Higher-timeframe safety

The Pine source reads HTF series with `request.security(..., x[1], lookahead=barmerge.lookahead_on)` — the closed-bar idiom. Atlas reproduces the intent directly: each chart bar maps to the newest pivot-timeframe bar that had already **closed**, so a developing HTF candle's eventual high or low never reaches an earlier chart bar. A test asserts that an extreme low placed in the newest HTF bar does not become a support level.

When the pivot timeframe is at or below the chart timeframe, the HTF requests degenerate to the chart series itself. When it is above, Atlas requests a dedicated feed through the existing shared transport (one stream per distinct resolution, shared with the MACD MTF and peek window). While that feed is still loading, the legend reads `15m feed…` and nothing is drawn — no invented levels.

## Optional confirmation

`requireConfirmation` (off by default) applies the original's scalping gates:

```pine
confirmacionLong  = close > ema9 and close > vwap and rsi > 50
confirmacionShort = close < ema9 and close < vwap and rsi < 50
velaImpulso       = body / range >= 0.45
```

These are what make the Pine signals late by design: at the moment of a true bottom, price is below both EMA 9 and VWAP, so the signal is suppressed until price has already reclaimed them. Leaving it off shows the raw reversal pattern; turning it on shows what the original would actually have printed.

## Inputs

| Setting              | Pine input                               | Default |
| -------------------- | ---------------------------------------- | ------- |
| Pivot timeframe      | hard-coded `"15"`                        | 15m     |
| Pivot left           | `pivotIzq`                               | 2       |
| Pivot right          | `pivotDer`                               | 2       |
| Max distance (ATR)   | `maxDistATR`                             | 2.5     |
| Zone thickness (ATR) | `grosorZonaATR`                          | 0.10    |
| Marker lifetime (s)  | —                                        | 60      |
| Marker fade (s)      | —                                        | 15      |
| Show S/R zones       | `mostrarSR`                              | on      |
| Show breaks          | —                                        | on      |
| Require confirmation | `confirmacionLong/Short` + `velaImpulso` | off     |
| Impulse body ratio   | `velaImpulso` 0.45                       | 0.45    |

## Not a recommendation

This indicator describes price structure that has already printed. It places no orders and makes no forecast. Bounce and rejection marks are pattern matches against lagging pivot levels, not predictions.
