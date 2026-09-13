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
| Show S/R zones       | `mostrarSR`                              | on      |
| Show breaks          | —                                        | on      |
| Require confirmation | `confirmacionLong/Short` + `velaImpulso` | off     |
| Impulse body ratio   | `velaImpulso` 0.45                       | 0.45    |

## Not a recommendation

This indicator describes price structure that has already printed. It places no orders and makes no forecast. Bounce and rejection marks are pattern matches against lagging pivot levels, not predictions.
