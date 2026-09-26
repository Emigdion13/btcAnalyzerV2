# Chart scaling: fix history and maintainer notes

The candles appearing as a thin line have happened before. There are **two different scale paths** to check before changing chart layout:

1. **Price-range flattening** — the candle pane's Y-axis spans far beyond the traded price (for example, BTC around 80–90k plotted on a 0–200k range). A bad wick or an indicator's zero-based values can do this. Time zoom does not fix a Y-axis problem.
2. **Pane-height compression** — oscillator panes take room away from the candle pane. Check the first pane's pixel height and the number of visible oscillators; do not mistake this for a price-range problem.

## What fixed price-range flattening

The earlier fix was delivered in PRs [#52](https://github.com/Emigdion13/btcAnalyzerV2/pull/52), [#53](https://github.com/Emigdion13/btcAnalyzerV2/pull/53), and [#54](https://github.com/Emigdion13/btcAnalyzerV2/pull/54):

- **Price-pane indicator series must not set the candle scale.** In Lightweight Charts, an `autoscaleInfoProvider` returning `null` means “use the series' native range.” It does **not** exclude the series. Return `{ priceRange: null }` for price-pane overlays in `src/lib/indicator-autoscale.ts`.
- **The candle series owns its fit.** `candleAutoscale` in `src/lib/price-autoscale.ts` fits visible candle bodies, tolerates normal wicks, and clips extreme wick excursions for *scaling only*. It preserves the base scale margins. A real large candle body must never be clipped.
- **Line and area charts are different.** They use close-based native scaling; wick rules apply to candles, hollow candles, and OHLC bars only.
- **Time zoom and price zoom are separate.** Vertical price zoom pins a manual range; Fit / Latest resets the pin and returns to auto-fit.

## PR 60 follow-up / regression guard

PR #60 added Zeiierman Trend Pressure as an oscillator plus SVG overlays. Its oscillator values (including the `+5` / `-107` event markers) belong only in the oscillator pane; price boxes and release markers are SVG and must not become price-series data. `ChartView.scale.test.tsx` now mounts the actual Trend Pressure indicator alongside the real chart and checks that even a polluted wick cannot expand the candle range to the outlier.

When adding another indicator, keep every oscillator plot marked `pane: 'oscillator'`, and keep its price overlays out of Lightweight Charts' candle series. If a test fails, inspect the provider return value and the series' pane index before adjusting CSS, range math, or stretch factors.

## Quick diagnosis and recovery

- Compare `ChartHandle.priceRange()` against the visible candle bodies and check the actual first-pane height (`ChartView` geometry). A huge price range points to autoscaling; a short pane points to layout.
- Run `npx vitest run src/lib/indicator-autoscale.test.ts src/lib/price-autoscale.test.ts src/components/ChartView.scale.test.tsx`.
- In the app, use **Fit** or **Latest** / **Reset chart view** to clear a manually pinned price scale. A pinned range is intentional and is not overwritten by ordinary auto-fit updates.
- Keep any new chart regression test in `ChartView.scale.test.tsx` at the component/engine seam, not only as a pure formula test: the real Lightweight Charts autoscale provider semantics caused the original regression.
