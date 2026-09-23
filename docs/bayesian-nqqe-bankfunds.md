# Bayesian/nQQE/BankFunds compatibility notes

Atlas includes **Bayesian/nQQE/BankFunds** as a chart oscillator and as a floating window. Both call
`calculateBayesianNqqeBankfunds`. The window is a view of that result. It is not a second formula.

This is a **reconstruction**. The published combo (tartigradia, short title `Bayesian/nQQE/BankFunds`,
TradingView script `43zBXjjp`, 2022-10-08) was not available as source. The numeric legend, tista's
stated three-factor expression, the nQQE = QQE−50 description, and the blackcat L3 banker-fund
mirror are what the port follows. Where those sources disagree with a guess, the code keeps the
published expression and says so.

## Using it

Select **Indicators**, search **Bayesian**, and select **Add**. It is not in the default workspace.
The toolbar **Floating** item **Bayesian** (or **Alt N**) opens the same calculation in its own
window. With no matching indicator on the chart, the window runs the published defaults and can add
the pane.

| Published slot | Default | What Atlas does |
| --- | --- | --- |
| BB SMA | 20 | `ta.sma(close, 20)` basis |
| BB stdev | 2.5 | Population deviation, not sample |
| AO fast / slow | 5 / 34 | `sma(hl2, fast) − sma(hl2, slow)`. SMA, even where a title says EMA |
| AC fast / slow | 5 / 34 | Same SMA difference on these lengths |
| AC/AO MA | 13 | AC is that difference minus `sma` of it |
| Lips / teeth / jaw | 5 / 8 / 13 | SMA-seeded Wilder SMMA, **unshifted** |
| Offsets | 3 / 5 / 8 | Stored and shown in the legend. **Not applied** |
| SMA | 20 | Close is compared with this for the third event |
| Bayes lookback | 20 | Average of the 0/1 events |
| Lower threshold | 15 | Sideways when prime, up and down are all under it |
| nQQE source, RSI, smooth | close, 14, 5 | Wilder RSI, then SMA-seeded EMA, then minus 50 |

Bools are not in the numeric legend. Probabilities, nQQE, banker fund and strong signals start on.
Bill Williams confirmation starts off.

## The score

tista states `Pr(Up|Indicator) = Pr(Indicator|Up) * Pr(Up) / [Pr(Indicator|Up) * Pr(Up) + Pr(Indicator|Down) * Pr(Down)]`.
The expression actually published next to that note is `nz(a*b*c/a*b*c+(1-a)*(1-b)*(1-c))`. Pine
evaluates that left to right:

`((((a*b)*c)/a)*b)*c + (1-a)*(1-b)*(1-c)`

When `a` is not zero this is `(b*c)^2 + (1-a)*(1-b)*(1-c)`, not the ratio. When `a` is zero, or any
input or quotient is not finite, `nz` makes it 0. Atlas implements that expression. Plots are the
score times 100.

The grouping of events is the reconstruction, because the combo body was not obtained:

- Up: close above the BB basis, close at or under the upper band, close under the SMA.
- Down: close under the basis, close above the upper band, close above the SMA.
- Momentum: AO above 0, AC above 0, close above the unshifted lips, teeth and jaw.
- Prime runs the same expression on the up score, `1 −` the down score, and the momentum score,
  on the 0–1 scale. If the up score is 0, prime's `a == 0` path returns 0.

An event is null only while the line it compares is null, so the average stays null until the
window is all finite.

Strong signals, and only those, print as circles on prime:

- Long: not sideways, and prime leaves ~0 through the threshold, or the up score leaves ~100.
- Short: prime falls from above the threshold to ~0 (this transition is the signal, even though
  the destination bar is under the threshold), or, when not sideways, the down score leaves ~100.
- "~0" and "~100" use `1e-4` on the plotted scale. A score of 120 is not "at 100".
- Bill Williams, only when enabled, also requires open and close beyond all three unshifted
  alligator lines. Off, it does not filter.

## nQQE

nQQE is QQE minus 50. RSI is Wilder. The RSI average is Atlas's SMA-seeded EMA, not legacy Pine
seeding. True range is the absolute change of that average. WWMA uses alpha `1/length`, emits null
without moving its previous value, and starts the first finite sample against 0. ATRRSI is WWMA of
that WWMA. Bands are the fast line ± ATRRSI × **4.236**. 4.236 is hard-coded. It is not a setting.
The slow trail is the usual QQE ratchet; the cross that flips it is read on the shifted series, and
the trend defaults to 1. The legend shows the fast line. Green above +10, red below −10, yellow
between. Colours stay on the bar that produced them (`colorMode: 'bar'`).

## Banker fund

This is the hardcoded L3 mirror, not verified `43zBXjjp` bytes. A 27-bar close stochastic
(`span == 0` → 0) is smoothed by `xsa` length 5 weight 1, then length 3 weight 1, then
`× 1.032 + 50`. Bull/bear is an EMA 13 of the 34-bar stochastic of `(2*close+high+low+open)/5`.
Columns run from the fund line to the slow line. They are not a histogram from zero. A missing base
skips the bar.

Body colours, later over earlier: green above the slow line, white on a 5% drop, red below the slow
line, blue below it when that drop did not happen. The yellow entry is a circle, not a body colour,
and only when fund crosses above the slow line with both still under 25.

## Floating window

**Alt N**, or **Floating → Bayesian**. Last twenty minutes, same values as the pane. Areas for the
two probabilities, a prime line, the nQQE line, and banker columns between the two prices. The
scale is the window's own min and max plus padding. It is not mirrored about zero. Levels 0, the
threshold, ±10, 25 and 100 appear only while they sit inside that scale. The readout is Prime,
nQQE and Bank for the bar under the crosshair. No extra timeframe feed.

The open bar repaints, because close, high and low are still forming. Treat the last value as
provisional.
