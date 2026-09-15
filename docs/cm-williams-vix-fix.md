# CM_Williams_Vix_Fix (22, 20, 2, 50, 0.85, 1.01)

Atlas ships a behavioral port of ChrisMoody's `CM_Williams_Vix_Fix` — Larry
Williams' synthetic VIX, generalized from equity indexes to any asset so that
fear spikes read as market bottoms. The published study plots a single
histogram; this port reproduces it bar for bar, then adds the floating
VIX Fix window the same way the MACD, WaveTrend and RSI Divergence windows
work.

Source: <https://www.tradingview.com/script/og7JPrRA-CM-Williams-Vix-Fix-Finds-Market-Bottoms/>

## Published inputs

| Pine                       | Atlas            | Meaning                                            |
| -------------------------- | ---------------- | -------------------------------------------------- |
| `pd` (22)                  | `pd`             | Lookback for the highest close in the fear ratio   |
| `bbl` (20)                 | `bbl`            | Bollinger length of the WVF average and deviation  |
| `mult` (2.0, min 1, max 5) | `mult`           | Bollinger standard-deviation multiplier            |
| `lb` (50)                  | `lb`             | Lookback for the percentile range-high / range-low |
| `ph` (0.85)                | `ph`             | Highest percentile factor on the highest WVF       |
| `pl` (1.01)                | `pl`             | Lowest percentile factor on the lowest WVF         |
| `hp` (false)               | `showHighRange`  | Draw the orange range-high / range-low lines       |
| `sd` (false)               | `showStdDevLine` | Draw the aqua Bollinger upper band                 |

## Published recurrence

Computed in the published order on every candle:

```
wvf       = ((highest(close, pd) - low) / highest(close, pd)) * 100
sDev      = mult * stdev(wvf, bbl)
midLine   = sma(wvf, bbl)
lowerBand = midLine - sDev        # computed, never plotted
upperBand = midLine + sDev
rangeHigh = highest(wvf, lb) * ph
rangeLow  = lowest(wvf, lb) * pl
lime      = wvf >= upperBand or wvf >= rangeHigh
```

The histogram is lime on a fear spike and gray otherwise. The midline and the
lower band exist only as intermediate values — the original never plots them,
and neither does Atlas.

## Parity boundaries

- **Warm-up is `na`, not zero.** `highest`/`lowest`/`sma`/`stdev` return `na`
  until their window holds enough real WVF values, and Pine comparisons against
  `na` are false — so early bars are gray, and the upper band appears once `bbl`
  WVF values exist while the range needs `lb` of them.
- **Rolling statistics match Pine's population semantics.** `stdev` divides by
  N (population), and `sma` requires a full window of non-`na` inputs, exactly
  like the Pine v1 built-ins the script calls.
- **A zero highest close yields `na`.** Prices are never zero on a real tape;
  the guard only keeps a synthetic flat-zero series from dividing by zero.
- **The open bar repaints.** Like the original, WVF, the bands and the range
  move with every tick until the candle closes. Lime on a forming bar is a
  developing reading, not a confirmed signal.
- **No divergence overlay.** The original has none, so the indicator carries no
  divergence settings — unlike the MACD and RSI Divergence built-ins.
- **Original Pine v1 palette:** lime `#00ff00`, gray `#808080`, orange
  `#ff9800`, aqua `#00ffff`.

## Floating window

The toolbar **Floating** selector's VIX Fix item (Alt V) opens the last twenty minutes of the
same values the pane plots, at their own one-sided scale from zero — WVF never
goes negative, so a symmetric oscillator scale would waste half the card. The
histogram keeps the lime/gray rule, the aqua upper band and the orange
range-high appear exactly when the pane's own toggles draw them, and the card's
verdict names a fresh lime bar a potential bottom, warns within 15% of the
nearest trigger, and otherwise calls the tape quiet.
