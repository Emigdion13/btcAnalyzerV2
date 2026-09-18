# TMO Scalper compatibility notes

Atlas includes a native TypeScript port of **L&L Capital's TMO Scalper**, the multi-timeframe
scalping variant of Mobius's (T)rue (M)omentum (O)scillator, published on TradingView with the
study and short title **TMO Scalper**. It is a sibling of the WaveTrend and CM_Ult_MacD_MTF
ports, not of the conventional RSI/MACD family: it plots three timeframe "wheels" of one
momentum formula, and it prints a wheel's cross only while the next bigger wheel already turns
the same way.

## Using it

Select **Indicators**, search **TMO Scalper**, and select **Add**. Select its pane title or
settings icon to edit it. Hiding the indicator leaves a restorable entry in the pane legend and
the object tree. It is not part of the default workspace, so existing saved workspaces are
untouched.

| Published input    | Default | Behavior                                                                                                 |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------- |
| TMO 1              | 1       | Fast wheel's aggregation — normally the chart's own minutes                                              |
| TMO 2              | 5       | Middle wheel; its crosses are the traded signals                                                         |
| TMO 3              | 30      | Slow wheel; gates TMO 2, the day's trend gauge                                                           |
| Length             | 14      | bars of close-vs-open sums before smoothing                                                              |
| Calc Length        | 5       | first EMA over the sums                                                                                  |
| Smooth Length      | 3       | the Main EMA and the Signal EMA                                                                          |
| Signal Size        | 3       | cross-dot radius                                                                                         |
| Signal Offset      | 2       | distance a cross dot plots off the Main line (published default 0; the documented (3, 2) profile pins 2) |
| Extreme Overbought | 9       | level for the TMO 2 extreme ▼ flag                                                                       |
| Extreme Oversold   | -9      | level for the TMO 2 extreme ▲ flag                                                                       |

plus four display toggles: TMO 1 signals, TMO 2 signals, TMO 2 extreme signals, and the
Main/Signal line pairs. All inputs, toggles and visibility persist locally and survive
validated workspace export/import.

### Floating window

The floating selector's **TMO Scalper** entry (or **Alt O**) opens a floating window with the
last twenty minutes of the same values, autoscaled to the window's own extremes and symmetric
about zero. It draws the three wheels' Main lines with their dashed Signal shadows, the gated
cross dots, and the ▲/▼ markers for TMO 2 and extreme flags. The ±15 cutoff pair and the ±9
extreme levels appear only when the window's scale reaches them. The readouts quote each wheel
at its own timeframe label, and the call underneath follows the strategy guide's order: an
extreme TMO 2 cross first, then a plain gated cross, then the zone, then the slow wheel's
direction. Hovering history retells it as history (`BAR`), so a stale signal never passes
itself off as live.

## Calculation and plotting contract

On each aggregation's own candles, oldest to newest:

1. `data = Σ sign(close − open[i])` over `i = 1 … length−1`. Comparisons against a bar that
   does not exist (the first `length−1` bars) count 0, exactly the Pine `na` boolean behavior.
2. `EMA = ema(data, calcLength)`.
3. `Main = ema(EMA, smoothLength)`.
4. `Signal = ema(Main, smoothLength)`.
5. Every value is plotted in the display scale `15 × value ÷ length`; the ±15 cutoff pair is
   where a saturated wheel converges, the reason the published levels sit at ±15.

All three EMAs use Pine v5 seeding (the first value is the seed), so the wheels have no
warm-up gap — the partial-sum convention above is the entire start-up behavior.

**Crosses and the gate.** A bullish TMO 1 dot needs `crossover(Main1, Signal1)` **and**
`Main2 > Signal2` on the same bar; bearish mirrors. TMO 2 dots need the TMO 3 wheel aligned,
which is the published "the big wheels must be spinning for a small wheel to spin" rule.
Dots plot at `Main ∓ offset` like the original. The **TMO 2 extreme** ▲/▼ pair is the
strategy-profile addition the legend's trailing arrows refer to: a middle-wheel cross fired
**from** an extreme zone — an up cross with the wheel at or below the oversold level, a down
cross from overbought. It is deliberately _not_ trend-gated, because an oversold lift prints
while the slow wheel is still red by definition; the gated dots and the counter-move flags
are therefore independent answers to two different questions. The original script has no such
plot; everything else matches it plot for plot.

**Time-frame aggregation — the one convention Atlas adds.** TradingView computes each wheel
through `request.security`, which sees every published aggregation natively. Atlas streams
only its eight chart intervals, so any aggregation that is not one of them is **folded locally
from the coarsest stream that divides it exactly** — 30m is folded 2-to-1 from the 15m stream,
45m 3-to-1 from the same, 2D 2-to-1 from the daily. Dividing exactly means the folded OHLC is
identical to a native bucket's, and the coarsest source buys the longest wheel history; every
chosen stream is itself a Coinbase-native granularity, so the feeds need no further
resampling. Weekly buckets start Monday 00:00 UTC like the chart's own 1W bars; all other
buckets are UTC-aligned. A bucket that has not closed keeps its partial values, so the
unclosed higher-TF wheel moves tick by tick exactly like `security` in realtime. Pine options
'M' and longer have no feed to fold from and are intentionally not offered.

Projection onto the chart is the step function `security(gaps_off, lookahead_off)` draws:
a wheel's value is the value of its bucket that the chart bar sits in, flat between bucket
starts. Before the oldest loaded source bar there are no values; the pane and the window both
say which feed is missing, stale or limited rather than guessing.

**Replay caveat.** In bar replay the resampled wheels read the closed feed snapshot of the
snapshot window, so a wheel's unclosed bucket reflects its final replay-snapshot value, not a
tick-by-tick reconstruction. This is the same class of approximation the CM_Ult_MacD_MTF port
documents for its HTF developing bar, reduced to the bucket level.

| Plot                         | Original Pine expression                               | Color                                         | Style                                                      |
| ---------------------------- | ------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------- |
| TMO 1/2 Main & Signal        | `plot(15*Main/tmolength …)`                            | `#27c22e` rising / `#ff0000` falling, per bar | line                                                       |
| TMO 3 Main & Signal          | `plot(15*Main3/tmolength …)`                           | `#006400` rising / `#800000` falling          | line                                                       |
| TMO 1 Bullish/Bearish Signal | `plot(crossover…, style_circles, linewidth=dotsize)`   | `#0de50d` / `#ff0000`                         | circles                                                    |
| TMO 2 Bullish/Bearish Signal | `plot(crossover…, style_circles, linewidth=dotsize+2)` | `#006400` / `#800000`                         | circles (shown by default; the published style hides them) |
| TMO 2 Extreme ▲/▼            | — Atlas addition —                                     | `#7cfc00` / `#ff4081`                         | triangles in the window, circles in the pane               |
| OB/OS Cutoff                 | `hline(±15)`                                           | `#ff0000` / `#27c22e`                         | solid                                                      |
| Zero Line                    | `hline(0)`                                             | `#2a2e39`                                     | solid                                                      |

**Documented deviations.** The translucent `fill()` between each wheel's Main and Signal
lines is not reproduced (Atlas pane plots have no band-fill between two series); the
direction-colored lines carry the same information. The original's `display.none` TMO 2 dot
toggles default to **on** here, because the requested profile asks for them. The hidden ±10
OB/OS filler hlines and the OB/OS background fills are omitted as decoration-only. TradingView
Style/Visibility tabs are not implemented.

No signal here is normalized, delayed or second-guessed: the unclosed bar of every wheel
repaints with each tick until that wheel's bar closes, which is the original's own behavior
and the reason signals are a state to read, not a promise.
