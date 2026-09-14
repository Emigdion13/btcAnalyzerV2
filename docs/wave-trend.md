# WaveTrend [LazyBear] compatibility notes

Atlas includes a native TypeScript port of **LazyBear’s WaveTrend Oscillator [WT]**, the open-source
TradingView script whose `study()` title is **WaveTrend [LazyBear]** and whose short title is
`WT_LB`. It is a port of the TS/MT "WaveTrend" oscillator, not a relative of Atlas’s conventional
MACD, its RSI, or the `CM_Ult_MacD_MTF` port.

## Using it

Select **Indicators**, search **WaveTrend** or **LazyBear**, and select **Add**. Select its pane
title or settings icon to edit it. Hiding the indicator leaves a restorable entry in the price-chart
legend and the object tree. It is not part of the default workspace, so existing saved workspaces
are untouched.

| Published input     | Default | Behavior                                                         |
| ------------------- | ------- | ---------------------------------------------------------------- |
| Channel Length      | 10      | `n1` — length of both the ESA and the absolute-deviation average |
| Average Length      | 21      | `n2` — length of the average applied to the channel index        |
| Over Bought Level 1 | 60      | Solid red reference line                                         |
| Over Bought Level 2 | 53      | Dotted red reference line (legacy `style=3`)                     |
| Over Sold Level 1   | -60     | Solid green reference line                                       |
| Over Sold Level 2   | -53     | Dotted green reference line (legacy `style=3`)                   |

All six inputs and visibility persist locally and survive validated workspace export/import.
**Original defaults** restores the published values. Atlas supports integer lengths 1–2000 and
levels within ±100000. The published script hard-codes two values that are therefore not inputs:
the **4**-bar signal average `sma(wt1, 4)` and the **0.015** channel scale. Arbitrary Pine
resolutions do not apply — the indicator always reads the chart’s own candles — and TradingView’s
Style/Visibility tabs are not implemented.

## Calculation and plotting contract

On the chart’s own candles, oldest to newest, with `hlc3 = (high + low + close) / 3`:

1. `ap = hlc3`.
2. `esa = ema(ap, channelLength)`.
3. `d = ema(|ap − esa|, channelLength)`.
4. `ci = (ap − esa) / (0.015 × d)`.
5. `wt1 = ema(ci, averageLength)`.
6. `wt2 = sma(wt1, 4)`.
7. `diff = wt1 − wt2`.

Both EMAs use legacy Pine seeding: the first observation **is** the first value, with
`alpha = 2 / (length + 1)` thereafter. Atlas’s pre-existing SMA-seeded Studio EMA (`ta.ema`) is
unchanged and is not used here. The four-bar signal is a plain arithmetic mean, so the first three
observations of `wt2` (and therefore of `diff`) are unavailable; the Pine-seeded EMAs have no
warm-up gap.

**One documented convention.** At the seeded first bar — and for any perfectly flat price channel —
`d` is zero, so step 4 is `0 / 0`, which Pine leaves undefined. Because `d` can only be zero when
every `|ap − esa|` in the average is zero, the numerator is zero as well; Atlas records **0**, the
flat-price limit, rather than a NaN that would poison the recursive EMA for the rest of the series.
A constant price series consequently plots a flat zero wave instead of an empty pane.

No normalization, rescaling, extra smoothing, threshold filter or signal delay is added. The
oscillator is scale-free about its own channel: multiplying a whole price series by a constant
reproduces the same wave, which is why the ±60/±53 levels are meaningful across symbols.

| Plot      | Original Pine expression                           | Color           | Style                           |
| --------- | -------------------------------------------------- | --------------- | ------------------------------- |
| WT1       | `plot(wt1, color=green)`                           | green `#008000` | line, width 1                   |
| WT2       | `plot(wt2, color=red, style=3)`                    | red `#ff0000`   | legacy cross markers (`3`)      |
| WT1 − WT2 | `plot(wt1-wt2, color=blue, style=area, transp=80)` | blue `#0000ff`  | area from zero, 80% transparent |
| 0         | `plot(0, color=gray)`                              | gray `#808080`  | solid reference line            |
| ±level 1  | `plot(obLevel1, color=red)` / `osLevel1`           | red / green     | solid reference line            |
| ±level 2  | `plot(obLevel2, color=red, style=3)` / `osLevel2`  | red / green     | dotted reference line           |

The colors are the original Pine v1 named colors, not Atlas’s theme. The five reference lines are
drawn on the pane’s price scale and are hidden from the pane legend, so the legend reports only
**WT1**, **WT2** and **WT1 - WT2**. Cross markers and the area are drawn by Atlas’s native renderer,
so they take part in pane autoscaling, resizing and PNG export; the area is filled between the
difference line and **zero**, and its boundary is stroked at full color with the fill at 20% opacity.

## Repainting

The oscillator is computed from the chart’s own history with no lookahead and no multi-timeframe
request, so closed candles are stable. The **open bar is not**: `ap` includes the forming candle’s
high, low and close, so every tick can move the latest WT1, WT2, the area and the last cross marker,
and a candle that closes at a new extreme changes the value its own bar previously showed. Treat
the last bar as provisional; this is not a non-repainting signal or a backtest.

## Parity boundaries — do not confuse logic matching with a verified chart match

Numerical matching requires the **same exchange/product, candle type, timestamps, OHLC series and
history**. Coinbase BTC-USD is not Binance BTCUSDT. The calculation always uses ordinary candles;
changing Atlas’s price chart to hollow/line/area does not create Heikin-Ashi or another synthetic
source. The indicator reads the loaded chart history (normally 300 bars, up to 900); the seeded EMAs
depend on where that history starts, especially with long user-selected lengths. Offline demo
resolutions are independently generated synthetic histories and cannot establish parity with an
exchange or TradingView. Realtime tick batching, anti-aliasing, marker sizing and pane layout are
not certified pixel-for-pixel against TradingView, and no side-by-side TradingView OHLCV export
validation is bundled here.

## Verification

- An independent **exact-rational fixture** (BigInt fractions, no floating point) checks every
  10/21 observation of WT1, WT2 and the difference, including the warm-up and the seeded first bar.
  It is explicitly **not** a TradingView export.
- Unit tests cover the `hlc3` source, independent lengths, the hard-coded 4-bar signal and 0.015
  scale, warm-up placement, the flat-channel convention, empty/short input, scale invariance,
  invalid input rejection, the legend label, all eight plots and the level colors/styles.
- Renderer tests check cross-marker geometry, per-bar colors, the area polygon against the zero
  line, the 80% transparency, the opaque default, and skipped bars without a value.
- Backup tests round-trip every input, including negative levels, and reject malformed lengths and
  levels.
- Browser tests add the indicator from the library, inspect the painted canvas for the original
  palette, edit and persist inputs, and check the mobile layout.

## References and attribution

1. [LazyBear’s original publication (open-source script, 2014)](https://www.tradingview.com/script/2KE8wTuF-Indicator-WaveTrend-Oscillator-WT/).
2. [Pine plot styles, area fills, transparency and conditional plotting](https://www.tradingview.com/pine-script-docs/visuals/plots/).

Atlas is independent of LazyBear and TradingView. This native implementation does not grant
permission to republish someone else’s Pine script on TradingView; its publication rules still
apply.
