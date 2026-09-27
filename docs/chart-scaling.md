# Chart scaling: fix history and maintainer notes

The candles appearing as a thin line have happened before. There are **three different scale paths** to check before changing chart layout:

1. **Price-range flattening** — the candle pane's Y-axis spans far beyond the traded price (for example, BTC around 80–90k plotted on a 0–200k range). A bad wick or an indicator's zero-based values can do this. Time zoom does not fix a Y-axis problem.
2. **Pane-height compression** — oscillator panes take room away from the candle pane. Check the first pane's pixel height and the number of visible oscillators; do not mistake this for a price-range problem.
3. **Pane migration during series replacement** — removing the only series in the price pane lets Lightweight Charts delete that pane and shift the first oscillator to index 0. Adding the replacement candles then mixes prices and oscillator values. A MACD zero line across the main chart is a telltale sign; Fit cannot repair pane ownership.

## What fixed price-range flattening

The earlier fix was delivered in PRs [#52](https://github.com/Emigdion13/btcAnalyzerV2/pull/52), [#53](https://github.com/Emigdion13/btcAnalyzerV2/pull/53), and [#54](https://github.com/Emigdion13/btcAnalyzerV2/pull/54):

- **Price-pane indicator series must not set the candle scale.** Use the explicit `{ priceRange: null }` provider in `src/lib/indicator-autoscale.ts`. Correction to earlier notes: in the pinned Lightweight Charts 5.2.1 implementation, returning `null` also excludes a series; it does not fall back to the native range. Omitting the provider uses native scaling.
- **The candle series owns its fit.** `candleAutoscale` in `src/lib/price-autoscale.ts` fits visible candle bodies, tolerates normal wicks, and clips extreme wick excursions for _scaling only_. It preserves the base scale margins. A real large candle body must never be clipped.
- **Line and area charts are different.** They use close-based native scaling; wick rules apply to candles, hollow candles, and OHLC bars only.
- **Time zoom and price zoom are separate.** Vertical price zoom pins a manual range; Fit / Latest resets the pin and returns to auto-fit.

## PR 60 follow-up / regression guard

PR #60 added Zeiierman Trend Pressure as an oscillator plus SVG overlays. Its oscillator values (including the `+5` / `-107` event markers) belong only in the oscillator pane; price boxes and release markers are SVG and must not become price-series data. `ChartView.scale.test.tsx` now mounts the actual Trend Pressure indicator alongside the real chart and checks that even a polluted wick cannot expand the candle range to the outlier.

When adding another indicator, keep every oscillator plot marked `pane: 'oscillator'`, and keep its price overlays out of Lightweight Charts' candle series. If a test fails, inspect the provider return value and the series' pane index before adjusting CSS, range math, or stretch factors.

## Quick diagnosis and recovery

- Compare `ChartHandle.priceRange()` against the visible candle bodies and check the actual first-pane height (`ChartView` geometry). A huge price range points to autoscaling; a short pane points to layout.
- Run `npx vitest run src/lib/indicator-autoscale.test.ts src/lib/price-autoscale.test.ts src/components/ChartView.scale.test.tsx`.
- In the app, use **Fit** or **Latest** / **Reset chart view** to clear manually pinned price scales in both the candle and oscillator panes (including CM Ultimate MACD). These actions share the same scale reset, so the navigation reset also clears the candle manual-zoom flag. A pinned range is intentional and is not overwritten by ordinary auto-fit updates.
- The `scale recovery controls` regressions in `ChartView.scale.test.tsx` expand both BTC and CM MACD manually, recover via each of the three controls, then rerender to verify the old pin is not reapplied. This covers recovery from stretched scales; it does not establish what originally stretched a user’s scale.
- Keep any new chart regression test in `ChartView.scale.test.tsx` at the component/engine seam, not only as a pure formula test: pane ownership and scale behavior must be checked against the real Lightweight Charts engine.

## Screenshot follow-up: preserve the candle pane

The screenshot with BTC near $84k and MACD's colored curve / white zero line in the main pane led to a reproducible lifecycle failure, not another range-math issue:

1. Mount candles with MACD and Trend Pressure, without volume or price-series overlays.
2. Change chart style, symbol, or `asset.priceIncrement` (which can arrive with asynchronous product metadata).
3. The main-series effect removes the old candles. LWC automatically deletes the now-empty first pane, promoting MACD to index 0.
4. The new candles join MACD; its native zero-based range flattens the candles. Indicator structure has not changed, so no indicator rebuild repairs their placement.

`ChartView` now calls `setPreserveEmptyPane(true)` **only on the initial price pane**, before adding series. Its identity survives replacements; oscillator panes remain disposable when their indicators are removed.

The real-engine component regressions cover every chart style, symbol and precision replacements, metadata arriving before candles, adding TUX overlays afterward, and removing/re-adding oscillator panes. These assert actual pane membership and candle price range, not just that a reset button sets `autoScale`.
