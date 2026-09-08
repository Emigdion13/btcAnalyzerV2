# SR Breaks and Retests · Atlas implementation notes

Atlas includes a native TypeScript port of **ChartPrime’s “Support and Resistance (High Volume Boxes)”**, published on TradingView as an invite-only indicator with the short title **`SR Breaks and Retests [ChartPrime]`** and rendered in the TradingView legend as **`SR Breaks and Retests [ChartPrime] (20, 2, 1)`**. ChartPrime publishes the full Pine Script v5 source of this indicator on their website under the **Mozilla Public License 2.0**; this port follows that published source, and the license permits derivative works with attribution (see `THIRD_PARTY_NOTICES.md`).

This is a port of one specific published indicator version (V1.3, May 2024). It is not a Pine interpreter, not a bundle of ChartPrime’s other indicators, and not affiliated with or endorsed by ChartPrime.

## Using it

Add it from **Indicators → SR Breaks and Retests**. The legend shows the effective inputs, e.g. `SR Breaks and Retests (20, 2, 1)`, plus a live count of rendered zones. Select the legend name or the settings icon to edit the three published inputs; **(20, 2, 1) defaults** restores them in one click. Settings, visibility and the indicator itself persist locally and in validated workspace exports.

| Original input             | Default | Range         | Behavior                                                                 |
| -------------------------- | ------- | ------------- | ------------------------------------------------------------------------ |
| Lookback Period            | 20      | integer ≥ 1   | Bars on each side of a close pivot; a pivot confirms this many bars late |
| Delta Volume Filter Length | 2       | integer ≥ 1   | “Higher input, will filter low volume boxes” (original tooltip)          |
| Adjust Box Width           | 1       | 0 – 1000, 0.1 | Zone depth as a multiple of ATR(200); higher input, thinner box          |

## Calculation contract

The engine walks the loaded OHLCV series oldest-to-newest and reproduces the original’s per-bar statement order, so state transitions match Pine’s `var` semantics exactly.

1. **Delta volume** (`upAndDownVolume`): `+volume` on up candles, `−volume` on down candles. Doji bars (`close == open`) inherit the last non-flat direction; the series starts biased positive. A box is only created when the detection bar’s delta volume beats the filter (support: `Vol > ta.highest(Vol / 2.5, vol_len)`; resistance: `Vol < ta.lowest(Vol / 2.5, vol_len)`), so `na` filter windows disable detection, as in Pine.
2. **Pivots**: `ta.pivothigh/pivotlow(close, lookback, lookback)`. A pivot is confirmed `lookback` bars after it forms. Atlas reproduces the built-in tie behavior reverse-engineered from TradingView: the center must be the most recent extreme of its window — future-side values must be strictly beyond it, past-side values may tie. An exact double top therefore marks only the second top.
3. **Zones**: a support zone spans `[level − ATR(200) × width, level]` under a positive-delta-volume pivot low; a resistance zone spans `[level, level + ATR(200) × width]` above a negative-delta-volume pivot high. The box anchors at the pivot bar, and its right edge is re-anchored one bar past the newest bar on every update (`set_right(bar_index + 1)`) until a replacement zone freezes it at the replacement bar. At most **50** zones are retained (`max_boxes_count`).
4. **ATR(200)**: Wilder RMA seeded by the SMA of the first 200 true ranges, `na` until 200 bars exist — the original warm-up. Zones created earlier keep a `na` boundary and do not render, exactly like Pine’s `na` box bottoms; hold diamonds can still print because they only need the level.
5. **Breaks and holds**, using the level series (a replacement zone compares against the previous bar’s post-update values, as Pine’s series history does):
   - `brekout_res = ta.crossover(low, resistance + depth)` — the whole bar clears the resistance zone → the zone flips to **support** (green, dashed, faint fill) and a **Break Res** label prints at the previous bar and the previous level value.
   - `res_holds = ta.crossunder(high, resistance)` — price falls back under the level → red ◆ above the previous bar; the live zone restores its original colors.
   - Support is symmetric: `brekout_sup = ta.crossunder(high, support − depth)` → **Break Sup** label; `sup_holds = ta.crossover(low, support)` → green ◆ below the previous bar.
6. **Retests and role memory**: the `res_is_sup` / `sup_is_res` flags persist until an opposite event, **across zone replacements**. A broken-then-reentered zone that holds prints **Resistance as Support Holds ◆** / **Support as Resistance Holds ◆**, and—faithfully to the original—the first break of a replacement zone can print that retest diamond instead of a second break label.
7. **Volume grading**: the fill opacity interpolates the original gradients — support maps `Vol` from `[0, ta.highest(Vol, 25)]` to transparent→green@30%, resistance maps `Vol` from `[ta.lowest(Vol, 25), 0]` to red@30%→transparent. Box text is the original `"Vol: " + str.tostring(math.round(Vol, 2))`.
8. **Colors** are the original constants: Pine `color.green` `#4caf50` and `color.red` `#f44336` borders, `#20ca26`/`#e92929` diamonds, `#7e1e1e`/`#2b6d2d` for the break labels, foreground text from the chart theme. **Break labels are drawn transparent**: the published color outlines the 60 × 17 label and tints its pointer, but the plate is never filled (`fill="none"`), so the candles behind “Break Sup” / “Break Res” stay visible. The glyphs use `#f2808a` / `#6fd477` — the published colors lightened enough to read over price action without a background — with a dark halo stroked behind them (`paint-order: stroke`), the same treatment every other in-chart message uses (`src/components/ChartMessage.tsx`).

## Deliberate deviation (one)

The original hides the very first “Break” label because Pine evaluates `not na_flag` to `na`. On TradingView this is invisible: the first event happens thousands of bars back in history. Atlas loads a finite window (900 candles by default), so the window’s first break would show no label and read as a defect. Atlas treats an unset flag as `false`, so that first break prints its label — matching what the original displays on screen for the same visible bars. Every subsequent flag transition, including the sticky retest behavior above, is unchanged.

## Limitations

Pivots are only known after their confirmation bars, so zones and breaks appear with the original’s delay; live candles are provisional until closed. Finite history, venue differences, and chart window length affect which zones exist (ATR(200) needs 200 bars; the legend shows a warm-up notice until then). Replay recomputes over the visible history, as TradingView replay does. The overlay is an analysis aid only: it does not place orders, generate certified signals, or constitute investment advice.
