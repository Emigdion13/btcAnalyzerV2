# CM_Ult_MacD_MTF compatibility notes

Atlas includes a native TypeScript port of **ChrisMoody’s original 2014 CM_MacD_Ult_MTF**, whose short title is `CM_Ult_MacD_MTF`. This is a separate indicator from Atlas’s conventional MACD. It is not the later `_V2` release, a strategy, a Pine interpreter, or a prediction engine.

## Using it

New workspaces include the indicator. Existing saved workspaces are not overwritten: select **Indicators**, search **CM_Ult_MacD_MTF** or **ChrisMoody**, and select **Add**. Select its pane title or settings icon to edit it. Hiding the indicator leaves a restorable entry in the price-chart legend and the object tree.

The original default title is **CM_Ult_MacD_MTF (60, 12, 26, 9)**. **60 does not, by itself, force a one-hour calculation.** It is the stored alternate-resolution input. The original **Use Current Chart Resolution?** switch defaults to **checked**. Uncheck it and leave **60 · 1 hour** selected to calculate a fixed hourly MACD on, for example, a 5m or 15m chart. The pane badge explicitly shows the effective resolution.

| Original input                                    | Default | Behavior                                                                    |
| ------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| Use Current Chart Resolution?                     | Checked | Follow the price chart’s resolution                                         |
| Use Different Timeframe? Uncheck Box Above        | 60 / 1h | Alternate source resolution; retained while disabled                        |
| Show MacD & Signal Line? Also Turn Off Dots Below | Checked | Show both lines; does **not** implicitly disable the independent dots input |
| Show Dots When MacD Crosses Signal Line?          | Checked | Show both upward and downward crossover dots                                |
| Show Histogram?                                   | Checked | Show the histogram                                                          |
| Change MacD Line Color-Signal Line Cross?         | Checked | Dynamic lime/red MACD and dots; yellow signal                               |
| MacD Histogram 4 Colors?                          | Checked | Original four momentum colors, with a yellow fallback                       |
| Fast Length                                       | 12      | Fast close EMA length                                                       |
| Slow Length                                       | 26      | Independent slow close EMA length                                           |
| Signal Length                                     | 9       | SMA length, **not EMA**                                                     |

All inputs and visibility persist locally and survive validated workspace export/import. **Original defaults** resets the original calculation/display inputs. The platform supports integer lengths 1–2000 and its eight exchange-backed resolutions: 1m, 3m, 5m, 15m, 1h, 4h, 1D, and 1W. Arbitrary Pine resolutions and the TradingView Style/Visibility tabs are not implemented.

## Calculation and plotting contract

On the selected resolution’s **close** series:

1. `fast = EMA(close, fastLength)`, `slow = EMA(close, slowLength)`.
2. Each EMA starts at the first available close, using `alpha = 2 / (length + 1)`. Atlas’s pre-existing SMA-seeded Studio EMA remains unchanged.
3. `macd = fast - slow`.
4. `signal = SMA(macd, signalLength)`. The first `signalLength - 1` signal observations are unavailable.
5. `histogram = macd - signal`.
6. Project these values onto chart timestamps before calculating colors or crossings.

No rescaling/normalization, price prediction, extra moving averages, smoothing, threshold filter, or signal delay is added. Fast and slow lengths can be equal or reversed, as in the original.

The histogram uses strict comparisons to the **previous projected chart value**, not the previous native timeframe observation:

| Condition                           | Original Pine v1 color | Hex       |
| ----------------------------------- | ---------------------- | --------- |
| Above zero, increasing              | aqua                   | `#00ffff` |
| Above zero, decreasing              | blue                   | `#0000ff` |
| At/below zero, decreasing           | red                    | `#ff0000` |
| At/below zero, increasing           | maroon                 | `#800000` |
| Unchanged or comparison unavailable | yellow                 | `#ffff00` |
| Four-color option off               | gray                   | `#808080` |

MACD is **lime (`#00ff00`) when MACD >= signal**, red otherwise. The signal is yellow. Turning dynamic MACD colors off produces **red MACD/dots and a lime signal**, not two arbitrary theme colors.

Dots occur when the difference becomes strictly positive after being nonpositive, or strictly negative after being nonnegative. Equality alone is not a crossing. A dot is placed at the **signal’s actual value**, not above/below the price candle. There is no first-sample/warm-up crossing.

Plot widths follow the reference: MACD 4, signal 2, histogram 4, circles 4, solid white zero line 2. Histogram strokes retain their pixel width while zooming; circles use an absolute oscillator coordinate. Native chart rendering includes these plots in resizing, autoscaling and PNG exports. The dedicated renderer consumes the chart engine’s `barColor` field (the engine removes `color` from custom-series `originalData`).

The original expressions `smd and outMacD ? outMacD : na` and analogous signal/histogram expressions suppress **exact zero** plot values as well as disabled/unavailable values. This is preserved; it is not an epsilon filter. Crossover dots can still be drawn at signal zero. The white zero line remains when all four plots are disabled.

## Multi-timeframe behavior and repainting

The original source has no version directive, so it uses legacy Pine v1 `security()` behavior, equivalent to **gaps off / lookahead on** on historical bars. Silently changing this to a modern non-repainting implementation would move its historical values and dots.

- Higher-resolution historical values appear from the **start** of their source bucket, not only at its closing chart candle.
- Values are carried through source gaps; no artificial OHLCV candles are inserted.
- Histogram comparisons happen after projection: unchanged higher-timeframe steps are **yellow**, not repeated aqua/blue/red/maroon bars. Crossings are also evaluated after projection, so dots are not simply copied onto every smaller bar.
- Lower-resolution historical requests select the **first available intrabar**. Realtime requests use the latest available intrabar. A lower-timeframe request cannot display every intrabar event on a coarser chart.
- For observed realtime higher-timeframe bars, the developing observation is recomputed from the chart close and the preceding native EMA states. Smaller chart bars are **not** appended to the hourly EMA as extra observations. Earlier observed chart closes retain their own developing values within a calculation session.
- **Open-bar values and dots can change. Recalculation/reload can repaint history.** This is explicitly identified in the settings; these are not confirmed/non-repainting trade alerts.

The existing Coinbase adapter supplies up to **900 native-resolution candles per distinct alternate timeframe**, with shared upstream caching, abortable requests, validated SSE updates, explicit error/stale states, and a retry control. A short minute chart is not aggregated into a pretend full hourly history. No synthetic values or ordinary chart MACD are substituted when the alternate feed fails. Duplicate requests for the same pair/resolution share a single frontend indicator feed.

Replay freezes both the price history and the loaded alternate histories. An incomplete higher-timeframe candle is reconstructed from visible replay closes; its future final close is not read. Completed historical source candles retain the original historical lookahead placement. Lower-timeframe data past the replay cursor is ignored. Selecting an alternate timeframe that was not loaded into the frozen snapshot displays an explicit instruction to exit replay and load it.

## Parity boundaries — do not confuse logic matching with a verified chart match

Numerical matching requires the **same exchange/product, candle type, timestamps, close series, and history**. Coinbase BTC-USD is not Binance BTCUSDT. This indicator always uses ordinary close prices; changing Atlas’s price chart to hollow/line/area does not create Heikin-Ashi or other synthetic candle sources.

The current-resolution calculation uses the loaded chart history (normally 300 Coinbase bars, up to 900). Alternate requests use at most 900 source candles; older uncovered chart bars remain unavailable. Initial EMA values depend on the starting history, especially for long user-selected periods. Offline demo resolutions are independently generated synthetic histories and cannot establish parity with an exchange or TradingView.

The browser receives Coinbase trades in one-second batches, not TradingView’s exact tick stream. Realtime values, anti-aliasing, relative circle sizing, and chart layout are not certified pixel-for-pixel against TradingView. There is **no side-by-side TradingView OHLCV export validation** bundled here, nor a claim of live validation from a network-restricted sandbox.

## Verification

- An independent synthetic **exact-rational recurrence fixture** checks every 12/26/9 MACD, SMA-signal and histogram observation, including warm-up. It is explicitly **not** a TradingView export.
- Unit tests cover all color/equality/zero cases, independent switches and lengths, first/latest intrabar selection, weekly UTC boundaries, gaps, history coverage, post-projection dots/colors, developing candles and replay future-data exclusion.
- Renderer tests check fixed histogram widths at multiple zoom levels and device-pixel ratios, absolute circles, actual per-bar colors and zero-line scaling.
- Browser tests inspect the **painted canvas palette**, settings persistence/validation, visibility/removal/library search, mobile overflow, PNG export, native timeframe requests/updates/errors/retry, symbol isolation and replay freezing.
- Backup tests round-trip every input and reject malformed booleans, resolutions and periods.

## References and attribution

1. [ChrisMoody’s original April 16, 2014 publication](https://www.tradingview.com/script/OQx7vju0-MacD-Custom-Indicator-Multiple-Time-Frame-All-Available-Options/).
2. [Readable mirror of the April 10, 2014 source, including original plot widths](https://github.com/markshuang/PineScript/blob/master/CM_MacD_Ult_MTF). The original credits TheLark for the crossover-dot idea. Other mirrors change widths or convert it into a strategy; those changes are not the target here.
3. [Pine v3 documentation of legacy v1/v2 security, lookahead and lower-timeframe selection](https://www.tradingview.com/pine-script-docs/v3/essential/context-switching-the-security-function/).
4. [Pine plot styles, histogram widths, circles and conditional plotting](https://www.tradingview.com/pine-script-docs/visuals/plots/).

Atlas is independent of ChrisMoody and TradingView. This native implementation does not grant permission to republish someone else’s Pine script on TradingView; its publication rules still apply.
