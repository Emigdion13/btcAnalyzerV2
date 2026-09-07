# SR Breaks and Retests compatibility notes

Atlas includes a native TypeScript port of **ChartPrime’s “Support and Resistance (High Volume Boxes)”**, published on TradingView under the short title **`SR Breaks and Retests [ChartPrime]`**. The original is released under the Mozilla Public License 2.0 and its source is published by the author. Atlas reimplements the documented calculations and drawing rules natively; it is not a Pine interpreter, not a copy of the original source text, and not an affiliation with or endorsement by ChartPrime or TradingView.

## Using it

New workspaces include the overlay. Existing saved workspaces are not overwritten: select **Indicators**, search **SR Breaks and Retests**, **support**, or **ChartPrime**, and select **Add**. Select its legend name or settings icon to edit it. The overlay is drawn on the price pane, so hiding the indicator leaves a restorable legend entry.

The original default title is **SR Breaks and Retests [ChartPrime] (20, 2, 1)**. The three numbers are the published inputs:

| Original input             | Atlas setting        | Default | Behavior                                                                               |
| -------------------------- | -------------------- | ------- | -------------------------------------------------------------------------------------- |
| Lookback Period            | `lookbackPeriod`     | 20      | Bars required on **each** side to confirm a pivot high/low on the close series         |
| Delta Volume Filter Length | `volumeFilterLength` | 2       | Window for the `highest`/`lowest` delta-volume threshold; higher values filter more    |
| Adjust Box Width           | `boxWidth`           | 1       | Box height as a multiple of ATR. **Higher values give a taller box**                   |
| _(fixed in the original)_  | `atrLength`          | 200     | ATR length behind the box height. Exposed because short charts otherwise show no boxes |
| _`max_boxes_count`_        | `maxBoxes`           | 50      | Newest boxes retained on the chart                                                     |

All inputs and the five markup toggles persist locally and survive validated workspace export/import. **Original defaults** restores the profile above.

> The author’s own tooltip describes “Adjust Box Width” as _“Higher input, thinner box”_. The published code computes `width = ATR × input`, so a higher input produces a **taller** box. Atlas follows the code and documents the actual behavior.

## Calculation contract

Everything runs on the loaded chart OHLCV series, oldest to newest. No synthetic candles, resampling, or extra smoothing are introduced.

### Delta volume

```
isBuyVolume = close > open ? true : close < open ? false : isBuyVolume   // persists across bars
deltaVolume = isBuyVolume ? +volume : -volume
```

The flag is a `var` in the original, so a doji (`close == open`) keeps the previous bar’s direction rather than resetting.

### Pivots, thresholds, and box creation

- Pivots use the **close** series: `pivotHigh(i)` / `pivotLow(i)` report the close at `i - lookbackPeriod` once that bar is greater than or equal to (respectively less than or equal to) every close in the `lookbackPeriod` bars on both sides. Pine compares with `>=`/`<=`, so a plateau still forms a pivot.
- `vol_hi = highest(deltaVolume / 2.5, volumeFilterLength)` and `vol_lo = lowest(deltaVolume / 2.5, volumeFilterLength)`, both including the current bar and undefined during their warm-up.
- A **support** box is created when a pivot low confirms and `deltaVolume > vol_hi`. A **resistance** box is created when a pivot high confirms and `deltaVolume < vol_lo`. Because the thresholds are signed, a “support” box can form on a bar with negative delta volume; the gradient then clamps it to a transparent fill, exactly as the original does.
- Box geometry: left edge `i - lookbackPeriod`, level at the pivot close, outer edge `level − ATR × boxWidth` (support) or `level + ATR × boxWidth` (resistance).
- The fill is the alpha ramp of the original `color.from_gradient` call: green ramps from transparent at `deltaVolume = 0` to 70% opacity at `highest(deltaVolume, 25)`; red ramps from 70% opacity at `lowest(deltaVolume, 25)` to transparent at 0. Values outside the range clamp.
- The box prints `Vol: ` plus the delta volume rounded to two decimals.

### Box lifecycle

The original keeps exactly **one live support box and one live resistance box**. Creating a newer box leaves the previous box on the chart, frozen at the right edge and palette it had at that moment; only the live box keeps extending (`right = bar_index + 1`) and being recolored. Atlas reproduces this, so the chart shows a trail of abutting boxes, and the newest box always extends one bar past the last candle.

### Breaks, holds, and the flip flags

Evaluated on the levels in force for that bar, after any pivot update, using Pine `ta.crossover`/`ta.crossunder` against the previous bar’s values:

| Signal              | Condition                         | Markup                                                              |
| ------------------- | --------------------------------- | ------------------------------------------------------------------- |
| Break of support    | `crossunder(high, level − width)` | Box turns red, dashed border; **Break Sup** label one bar earlier   |
| Support holds       | `crossover(low, level)`           | Box restored to green/solid; green ◆ one bar earlier, below the bar |
| Break of resistance | `crossover(low, level + width)`   | Box turns green, dashed border; **Break Res** label one bar earlier |
| Resistance holds    | `crossunder(high, level)`         | Box restored to red/solid; red ◆ one bar earlier, above the bar     |

Two flip flags remember role reversal: a resistance break sets `resistanceIsSupport`, and a resistance hold clears it; the support side mirrors this. The original’s two extra diamonds use the **previous bar’s** flag:

- `breakoutResistance and resistanceIsSupport[1]` → green ◆ below the bar, “Resistance as Support Holds”.
- `breakoutSupport and supportIsResistance[1]` → red ◆ above the bar, “Support as Resistance Holds”.

A break is labeled only when the corresponding flag was **not** already set, so a retest of an already-broken level prints the diamond without a second **Break** label. Pine treats `na` as false, so the very first break always labels; Atlas matches that.

### Colors

| Element                 | Color                                                    |
| ----------------------- | -------------------------------------------------------- |
| Support border          | `#008000` (Pine `color.green`)                           |
| Resistance border       | `#ff0000` (Pine `color.red`)                             |
| Broken support          | red border, dashed, 20% red fill                         |
| Broken resistance       | green border, dashed, 20% green fill                     |
| Support hold diamond    | `#20ca26`                                                |
| Resistance hold diamond | `#e92929`                                                |
| Break Sup label         | `#7e1e1e` body, body above the anchor, tip pointing down |
| Break Res label         | `#2b6d2d` body, body below the anchor, tip pointing up   |

The label geometry follows `label.style_label_down` / `label.style_label_up` from the original.

## Documented deviations

Three places where the original is undefined or unusable, and Atlas chooses defined behavior instead:

1. **ATR warm-up.** `ta.atr(200)` is undefined for the first 199 bars, so the original passes `na` coordinates to `box.new`, which TradingView cannot draw. Atlas tracks the level but draws no box until ATR exists, and the legend shows `Warming up · n/200 bars before ATR box width`. Hold signals, which only need the level, still work during warm-up. Lower **ATR length for box width** for short histories.
2. **Gradient window.** `ta.highest(Vol, 25)` / `ta.lowest(Vol, 25)` are undefined for 24 bars, which made early boxes fully transparent. Atlas uses the longest window available instead. This affects fill intensity only, never box placement or signals.
3. **Volume text.** Magnitudes of 100,000 or more are abbreviated (`1.2M`) so they fit inside the box; the original prints the full rounded number.

## Repainting and limits

Pivots confirm `lookbackPeriod` bars after they form, so the newest boxes, diamonds, and labels appear late by design and the live box extends as bars print. Changing **Lookback Period**, **Delta Volume Filter Length**, **ATR length**, or **Adjust Box Width** re-derives every box from scratch. Different exchanges, sessions, aggregation, and loaded history produce different levels; the chart loads a bounded history, so the oldest boxes depend on how much data is available.

The overlay is an analysis aid: it does not place orders, generate certified signals, or provide investment advice.

## Verification boundaries

`src/lib/sr-breaks-retests.test.ts` pins the delta-volume sign rule, the SMA-seeded RMA and ATR, close-based pivot confirmation, gradient interpolation, box geometry and freezing, break/hold/retest markup, label placement, the ATR warm-up rule, the box cap, settings validation, and determinism over generated history. The canvas/SVG composition, PNG export, and dialog interaction are covered by `tests/sr-breaks-retests.spec.ts` in a real browser. Atlas does not re-publish the original Pine source and makes no claim of pixel-identical rendering against TradingView.
