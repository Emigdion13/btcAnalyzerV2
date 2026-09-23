# Bayesian/nQQE/BankFunds compatibility notes

Atlas includes **Bayesian/nQQE/BankFunds** as a chart oscillator and as a floating window. Both call
`calculateBayesianNqqeBankfunds`. The window is a view of that result. It is not a second formula.

The port is **faithful to the published source**. The script is tartigradia's Pine v5 combo
("Bayesian BBSMA + nQQE Oscillator + Bank funds (whales detector)", short title
`Bayesian/nQQE/BankFunds`), an earlier reconstruction in Atlas was guessed from the legend, and the
real script body has since replaced it. Every formula below is the published one, quirks included,
and each remaining presentational difference is listed at the end.

## Using it

Select **Indicators**, search **Bayesian**, and select **Add**. It is not in the default workspace.
The toolbar **Floating** item **Bayesian** (or **Alt N**) opens the same calculation in its own
window. With no matching indicator on the chart, the window runs the published defaults and can add
the pane.

## Inputs

The settings map one-to-one to the published inputs:

| Published input | Default | How it is used |
| --- | --- | --- |
| BB SMA Period | 20 | `ta.sma(close, 20)` basis |
| BB Standard Deviation | 2.5 | Population deviation, × the basis, upper band only |
| AO Fast / Slow EMA Length | 5 / 34 | `ta.sma(hl2, 5) − ta.sma(hl2, 34)`. SMA, even where the title says EMA |
| AC Fast / Slow SMA Length | 5 / 34 | The same difference, smoothed by `ta.sma(diff, acFast)` again |
| AC AO MA Period | 13 | Feeds a vwma line the script computes and never reads |
| Lips / Teeth / Jaw Length | 5 / 8 / 13 | SMA-seeded Wilder SMMA, unshifted. Only the jaw is read |
| Lips / Teeth / Jaw Offset | 3 / 5 / 8 | Stored and shown in the legend. Not applied (the script only plots with them) |
| SMA Period | 20 | Third event line |
| Bayesian Lookback Period | 20 | Average of the 0/1 events |
| Lower Threshold | 15 | Signal threshold, and the sideways read |
| nQQE source / RSI Length / SF | close / 14 / 5 | `ta.ema(ta.rsi(src, 14), 5)` |
| Bill Williams confirmation | off | AC/AO pair plus the jaw |
| Show Crossing Signals | off | Not ported; the shapes are `display`-only labels in the script |

## The Bayesian half

Three events per direction, strict: `close > line` and `close < line` against the BB upper band,
the BB basis, and the SMA. A close exactly on a line counts for neither side. Each direction is
averaged over the lookback and normalised inside its own pair — `P(up) = up/(up+down)`, which is
Pine `na` when no strict comparison exists in the window.

The published expression is not Bayes' theorem. Left-associative Pine turns
`nz(a*b*c/a*b*c+(1-a)*(1-b)*(1-c))` into `((((a*b)*c)/a)*b)*c + (1-a)*(1-b)*(1-c)` — effectively
`(b*c)² + (1-a)(1-b)(1-c)` — and `nz` makes the whole thing 0 when `a` is 0 or anything is `na`.
Atlas implements exactly that.

The source then swaps its own naming: the red **Break Down** area runs the expression on the *up*
probabilities, and the green **Break Up** area on the *down* probabilities. Prime is the two-factor
version of the same expression — `nz(down*up/down*up + (1-down)*(1-up))`, that is
`up² + (1-down)(1-up)` — plotted blue. All three areas are `style=area` from zero at transp 60,
multiplied by 100.

### Signals

The published conditions, with Pine's exact float comparisons:

- Long: prime leaves exact 0 through the threshold, or the up score falls off exact 100.
- Short: prime falls to exact 0 from above the threshold (no sideways gate — the script computes
  `sideways` only for a fill it comments out), or the down score falls off exact 100.
- Exact means exact: the `nz`/count arithmetic produces exact 0 and 1, and `1e-4` off is not a
  signal.
- Bill Williams, only when enabled: longs need AC rising **and** AO rising plus open and close
  above the jaw; shorts need AC not rising — the source's `acIsRed and acIsRed` is a bug, preserved
  — plus open and close below the jaw.

## nQQE

The fast line is `ta.ema(ta.rsi(src, 14), 5)` on the 0–100 RSI scale, plotted as a `style=area`
with `histbase=50` at transp 30, coloured lime above 60, red below 40, yellow between. The bands
are `fast ± ATRRSI × 4.236`, where ATRRSI is the published WWMA (alpha `1/length`, `nz`-seeded, so
a null sample restarts it) of the WWMA of the absolute fast change. The slow line is the classic
QQE ratchet over those bands; the script hides it with `display.none`, and Atlas computes it
without plotting it. Dashed gray levels sit at 40 and 60.

## Banker fund

`fundtrend = (3·xsa(stoch(close, 27), 5, 1) − 2·xsa(xsa(stoch(close, 27), 5, 1), 3, 1) − 50) × 1.032 + 50`,
where a zero span is Pine `na`, so a flat tape draws nothing. The slow line is
`ta.ema(stoch((2·close+high+low+open)/5, 34), 13)`. Bodies span the two prices; body colours are
the published stack, later over earlier: green above the slow line, white on a 5% drop
(`fund < xrf(fund·0.95, 1)`), red below the slow line, blue below it when the drop did not happen.
The yellow entry — fund crossing above the slow line with the slow line alone under 25 — is
`plotcandle(0, 50, 0, 50)`, a block across the bottom half of the pane.

## Presentation differences that remain

These change how it looks next to TradingView, not what it computes:

- Banker bodies and the entry block draw as columns between the two prices, not plotcandle bodies.
- The long/short signal is drawn as circles on prime in the pane. The script paints the **price
  chart bars** lime/maroon with `barcolor`, which a pane cannot do.
- The hidden nQQE fast/slow lines and the optional crossing labels are not drawn (they are
  `display.none` or off by default in the script too).
- The commented-out threshold fill stays unported.

## Floating window

**Alt N**, or **Floating → Bayesian**. Last twenty minutes, same values as the pane. Areas for the
two probabilities and prime, the nQQE line, and banker columns between the two prices. The scale is
the window's own min and max plus padding, not mirrored about zero. Levels 0, the threshold, 25,
40, 60 and 100 appear only while they sit inside that scale. The readout is Prime, nQQE and Bank
for the bar under the crosshair. No extra timeframe feed.

The open bar repaints, because close, high and low are still forming. Treat the last value as
provisional.
