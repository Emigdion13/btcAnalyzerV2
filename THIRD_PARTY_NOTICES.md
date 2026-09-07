# Third-party notices

## TradingView Lightweight Charts™

Copyright (c) 2026 TradingView, Inc.

This product includes [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/), licensed under the Apache License, Version 2.0.

A copy of the Apache 2.0 license is included in `public/licenses/lightweight-charts-apache-2.0.txt`. An attribution link is available in the application's status bar and About dialog. Atlas is independent of, and is not endorsed by, TradingView or Coinbase.

## CM_Ult_MacD_MTF indicator

The native TypeScript `CM_Ult_MacD_MTF` implementation follows the calculations and visual rules of **ChrisMoody’s original 2014 CM_MacD_Ult_MTF**, published as an open-source indicator on [TradingView](https://www.tradingview.com/script/OQx7vju0-MacD-Custom-Indicator-Multiple-Time-Frame-All-Available-Options/). The original credits **TheLark** for the crossover-dot idea. A [readable source mirror](https://github.com/markshuang/PineScript/blob/master/CM_MacD_Ult_MTF) was used to verify the original input defaults, SMA signal, colors and plot widths.

This is an independent native implementation, not the later V2 update or a bundled Pine interpreter. Attribution does not imply endorsement by ChrisMoody, TheLark or TradingView, or permission to republish the original Pine script outside its applicable terms. See [the compatibility notes](docs/cm-ult-macd.md) for the behavioral contract, repainting and verification boundaries.

## SR Breaks and Retests indicator

The native TypeScript `SR Breaks and Retests` overlay follows the calculations, defaults, colors and drawing rules of **ChartPrime’s “Support and Resistance (High Volume Boxes)”**, published by ChartPrime on [TradingView](https://www.tradingview.com/script/Uz2AJ0i4-Support-and-Resistance-High-Volume-Boxes-ChartPrime/) and on [chartprime.com](https://chartprime.com/indicator/support-and-resistance-high-volume-boxes) under the **Mozilla Public License 2.0**.

Atlas ships an independent implementation of the documented behavior, not the original Pine source and not a Pine interpreter. Where the original is undefined on short histories (the fixed `ATR(200)` box width, the 25-bar gradient window, and an unbounded volume string), Atlas defines and documents the behavior instead. Attribution does not imply endorsement by ChartPrime or TradingView. See [the compatibility notes](docs/sr-breaks-retests.md) for the calculation contract, repainting behavior and verification boundaries.

## Fonts and icons

- DM Sans: Copyright 2014 The DM Sans Project Authors. SIL Open Font License 1.1. See `node_modules/@fontsource/dm-sans/LICENSE`.
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors. SIL Open Font License 1.1. See `node_modules/@fontsource/jetbrains-mono/LICENSE`.
- Lucide: ISC license. See `node_modules/lucide-react/LICENSE`.

Coinbase mode obtains public market data at runtime from Coinbase Exchange. Coinbase data is not bundled with this repository. Explicit offline demo mode generates synthetic data locally; test fixtures are not served by the application.
