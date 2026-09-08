# Pivot Points High Low & Missed Reversal Levels · Atlas implementation notes

Atlas includes a native TypeScript port of **LuxAlgo’s “Pivot Points High Low & Missed Reversal Levels [LuxAlgo]”**, an open-source TradingView indicator (published February 17, 2022; minor update October 4, 2022) rendered in the TradingView legend as **`Pivot Points High Low & Missed Reversal Levels [LuxAlgo] (50)`**. LuxAlgo publishes the Pine Script v5 source on TradingView under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** license (CC BY-NC-SA 4.0); this port follows that published source statement by statement (see `THIRD_PARTY_NOTICES.md` for the attribution and license terms).

This is a port of one specific published indicator. It is not a Pine interpreter, not a bundle of LuxAlgo’s other indicators, and not affiliated with or endorsed by LuxAlgo.

## Using it

Add it from **Indicators → Pivot Points High Low & Missed Reversal Levels**. The legend shows the effective input, e.g. `Pivot Points High Low & Missed Reversal Levels (50)`, plus a live count of rendered regular pivots and missed reversals. Select the legend name or the settings icon to edit the published inputs; **(50) defaults** restores them in one click. Settings, visibility and the indicator itself persist locally and in validated workspace exports.

| Original input   | Default               | Range         | Behavior                                                                      |
| ---------------- | --------------------- | ------------- | ----------------------------------------------------------------------------- |
| Pivot Length     | 50                    | integer 1–500 | Bars on each side of a pivot (`ta.pivothigh/pivotlow(length, length)`)        |
| Regular Pivots   | on                    | toggle        | `▼` / `▲` labels at confirmed pivot highs / lows                              |
| · High / Low     | `#ef5350` / `#26a69a` | hex           | Regular label colors; also tint the historical missed-reversal levels at 50 % |
| Missed Pivots    | on                    | toggle        | `👻` labels, dashed zig-zag legs and the level of each missed reversal        |
| · High / Low     | `#ef5350` / `#26a69a` | hex           | Ghost label colors; also color the zig-zag legs and the estimate              |
| Text Label Color | `#ffffff`             | hex           | Color of the `▼` / `▲` glyphs                                                 |

### Reading the chart

- **Regular pivots** are the “Bar Count Reversals” of classic pivot-point analysis: a bar whose high (low) is the extreme of the `length` bars on each side. They confirm `length` bars after the fact, so every label is offset `-length` bars from the bar that confirmed it.
- **Missed reversals** are the prices this method skips. When two pivot highs print in a row, the lowest low between them was a reversal that never qualified as a pivot low; when a pivot high forms _below_ the running high since the last pivot low, both that running high and the low that followed it were missed. Each missed reversal is marked with a `👻`, the zig-zag detours through it with dashed legs, and a horizontal **level** starts there and runs until the next missed reversal (or, for the newest one, until the latest bar).
- The **most recent `👻`** is an _estimate_: after a pivot high it sits on the lowest low since that pivot, after a pivot low on the highest high. It readjusts on every new lower low / higher high, is joined to the last pivot with a dashed leg, and carries its own level to the latest bar. When the reversal confirms, the estimate becomes a regular pivot.

## Calculation contract

The engine walks the loaded OHLCV series oldest-to-newest and reproduces the original’s per-bar statement order, so the `var` state (`max`, `min`, `max_x1`, `min_x1`, `follow_max`, `follow_min`, their bars, `os`, `px1`, `py1`) transitions exactly as in Pine.

1. **Pivots**: `ph = ta.pivothigh(length, length)`, `pl = ta.pivotlow(length, length)` on the bar highs and lows. A pivot is confirmed `length` bars after it forms and is placed at `bar_index - length`. Atlas reproduces the built-in tie behavior reverse-engineered from TradingView: the center must be the most recent extreme of its window — future-side values must be strictly beyond it, past-side values may tie. An exact double top therefore marks only the second top.
2. **Running extremes**: on every bar, `max := math.max(high[length], max)` and `min := math.min(low[length], min)` track the extremes since the last pivot (both reset to the pivot price when a pivot prints). `max_x1` / `min_x1` move only on a _strict_ new extreme (`if max > max[1]`), so an equal high keeps the first bar. Pine’s `math.max` / `math.min` return `na` while `high[length]` is `na`, so the trackers only start `length` bars in — Atlas leaves them unset for the same bars.
3. **Followers**: `follow_min` is reset to `low[length]` whenever `max` makes a new high (and `follow_max` to `high[length]` whenever `min` makes a new low), then keeps tracking the low (high) that follows the running extreme.
4. **On a pivot high** (`ph`):
   - if the previous bar’s state was already “high” (`os[1] == 1`), the running `min` was a **missed low**: `👻` at `(min_x1, min)`, dashed zig-zag leg to it, and a new level from it;
   - else if `ph < max`, the running `max` was a **missed high** and `follow_min` a **missed low**: two `👻`, two dashed legs (into the max, then into the follow-min), a level from each — the first level is cut back to the bar of the second (`line.set_x2(ghost_level, px1)`);
   - then, with _Regular Pivots_ on, `▼` at `(bar_index - length, ph)` and a zig-zag leg to it, **dashed** when a reversal was skipped (`ph < max or os[1] == 1`) and solid otherwise;
   - finally `py1 := ph`, `px1 := bar_index - length`, `os := 1`, `max := ph`, `min := ph` — state updates happen whether or not the labels are shown.
5. **On a pivot low** (`pl`): the mirror image (`os[1] == 0` → missed high at `(max_x1, max)`; `pl > min` → missed low at `(min_x1, min)` and missed high at `(follow_max_x1, follow_max)`; `▲` at `(bar_index - length, pl)`; `os := 0`). When a bar confirms a pivot high and a pivot low at once, the low is processed second against the state the high just wrote, exactly as Pine executes the two `if` blocks.
6. **Levels**: every missed reversal starts a 2-px level in the _regular_ color of its side at 50 % opacity (`color.new(reg_ph_css, 50)` for a missed high, `color.new(reg_pl_css, 50)` for a missed low). The newest level is extended to the latest bar on every bar (`line.set_x2(ghost_level[1], n)`); when the next missed reversal prints, the previous level is frozen at that reversal’s bar.
7. **Estimate** (Pine’s `barstate.islast` block, recomputed on every new bar): after a pivot high the estimate is the lowest low from the pivot to the latest bar; after a pivot low the highest high. Pine searches a newest-first array with `array.indexof`, so ties resolve to the **newest** bar — Atlas does the same. With _Missed Pivots_ on, a `👻` prints there and a dashed leg joins it to the last pivot (`miss_ph_css` after a pivot high, `miss_pl_css` after a pivot low). The estimate’s own level, from the estimate bar to the latest bar in the _missed_ color at 50 % opacity, sits outside the `show_miss` condition in the original and therefore prints even with missed pivots hidden.
8. **Zig-zag colors** follow the original exactly: every upward leg (into a high) is drawn in the _missed low_ color and every downward leg (into a low) in the _missed high_ color — including the regular legs — which is why the default zig-zag reads green rising and red falling.
9. **Labels**: `▼` / `▲` are `size.small`, `style_label_down` above a pivot high and `style_label_up` below a pivot low, in the regular colors with the _Text Label Color_ glyph; `👻` labels are `size.small` in the missed colors. Every label carries the original `str.tostring(price, '#.####')` tooltip (Pine’s `#.####` formatting — up to four decimals, trailing zeros dropped — reproduced in `pivotTooltip`). **Labels are drawn transparent**: the published color outlines the plate and tints its pointer, but the plate is never filled (`fill="none"`), so the candles behind a label stay visible; the glyphs read through a dark halo stroked behind them (`paint-order: stroke`), the same treatment every other in-chart message uses (`src/components/ChartMessage.tsx`).
10. **Drawing limits**: the original declares `max_labels_count = 500` and `max_lines_count = 500`; Atlas retains the newest 500 labels and the newest 500 lines (zig-zag legs plus levels), oldest dropped first, and caps _Pivot Length_ at 500 (`max_bars_back`).

## Deliberate deviation (one)

Pine initialises `px1 = 0` and `py1 = 0.`, so on TradingView the first zig-zag leg runs from bar 0 at price 0 to the first pivot — a near-vertical artifact thousands of bars back in history that nobody sees. Atlas loads a finite window (900 candles by default), where that leg would slice through the visible chart. Atlas therefore treats the origin as unset: the zig-zag starts at the first confirmed pivot, and the estimate’s dashed leg is not drawn before a pivot exists (the estimate label and level still print, as in the original, because they only depend on `os` and `px1 = 0`). Everything after the first pivot — every leg, label, level and state transition — is unchanged.

## Limitations

Pivots are only known after their confirmation bars, so `▼` / `▲` labels appear `length` bars behind the live edge and the newest `👻` is by construction a repainting estimate — it moves with every new extreme until a pivot confirms it. Finite history, venue differences and chart window length affect which pivots exist (a pivot needs `2 × length + 1` bars; the legend shows a warm-up notice until then). Replay recomputes over the visible history, as TradingView replay does. The overlay is an analysis aid only: it does not place orders, generate certified signals, or constitute investment advice.
