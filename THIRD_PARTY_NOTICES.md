# Third-party notices

## TradingView Lightweight Charts™

Copyright (c) 2026 TradingView, Inc.

This product includes [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/), licensed under the Apache License, Version 2.0.

A copy of the Apache 2.0 license is included in `public/licenses/lightweight-charts-apache-2.0.txt`. An attribution link is available in the application's status bar and About dialog. Atlas is independent of, and is not endorsed by, TradingView or Coinbase.

## CM_Ult_MacD_MTF indicator

The native TypeScript `CM_Ult_MacD_MTF` implementation follows the calculations and visual rules of **ChrisMoody’s original 2014 CM_MacD_Ult_MTF**, published as an open-source indicator on [TradingView](https://www.tradingview.com/script/OQx7vju0-MacD-Custom-Indicator-Multiple-Time-Frame-All-Available-Options/). The original credits **TheLark** for the crossover-dot idea. A [readable source mirror](https://github.com/markshuang/PineScript/blob/master/CM_MacD_Ult_MTF) was used to verify the original input defaults, SMA signal, colors and plot widths.

This is an independent native implementation, not the later V2 update or a bundled Pine interpreter. Attribution does not imply endorsement by ChrisMoody, TheLark or TradingView, or permission to republish the original Pine script outside its applicable terms. See [the compatibility notes](docs/cm-ult-macd.md) for the behavioral contract, repainting and verification boundaries.

## SR Breaks and Retests indicator

The native TypeScript `SR Breaks and Retests` implementation is a port of **ChartPrime's "Support and Resistance (High Volume Boxes)"**, a TradingView indicator whose short title is "SR Breaks and Retests [ChartPrime]". The original Pine Script v5 source is published by ChartPrime at [chartprime.com/indicator/support-and-resistance-high-volume-boxes](https://chartprime.com/indicator/support-and-resistance-high-volume-boxes) under the **Mozilla Public License 2.0**, which permits derivative works with attribution and same-license availability of the source. This notice satisfies that attribution; it does not imply endorsement by ChartPrime or affiliation with TradingView. See [the compatibility notes](docs/sr-breaks-retests.md) for the behavioral contract, the single documented deviation, and verification boundaries.

## Pivot Points High Low & Missed Reversal Levels indicator

The native TypeScript `Pivot Points High Low & Missed Reversal Levels` implementation is a port of **LuxAlgo's "Pivot Points High Low & Missed Reversal Levels [LuxAlgo]"**, an open-source TradingView indicator. The original Pine Script v5 source is published by LuxAlgo at [tradingview.com/script/OxJJqZiN-Pivot-Points-High-Low-Missed-Reversal-Levels-LuxAlgo](https://www.tradingview.com/script/OxJJqZiN-Pivot-Points-High-Low-Missed-Reversal-Levels-LuxAlgo/) under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** license (© LuxAlgo). Under that license this derivative port is attributed here, is provided for non-commercial use, and is made available under the same license terms as the original; the attribution does not imply endorsement by LuxAlgo or affiliation with TradingView. See [the compatibility notes](docs/pivot-points-missed-reversals.md) for the behavioral contract, the single documented deviation, and verification boundaries.

## Fonts and icons

- DM Sans: Copyright 2014 The DM Sans Project Authors. SIL Open Font License 1.1. See `node_modules/@fontsource/dm-sans/LICENSE`.
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors. SIL Open Font License 1.1. See `node_modules/@fontsource/jetbrains-mono/LICENSE`.
- Lucide: ISC license. See `node_modules/lucide-react/LICENSE`.

Coinbase mode obtains public market data at runtime from Coinbase Exchange. Coinbase data is not bundled with this repository. Explicit offline demo mode generates synthetic data locally; test fixtures are not served by the application.
