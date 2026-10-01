# Randy V8.10 DISCIPLINADO

A native TypeScript port of the **Randy V8.10 DISCIPLINADO** Pine v6 indicator, written for BTC and
Kalshi's 15-minute contracts. Unlike the other ports it is the author's own script, so there is no
third-party provenance to record — only the calculation contract below.

Add it from **Indicators → Randy V8.10**, or open the floating window with **Alt J** (toolbar
**Floating → Randy V8.10**). It is built for a **1-minute chart**; the window says `USE 1M` on any
other resolution, and the EMA 9/20 only draw on 1m, exactly like the Pine `es1m` guard.

## What it shows

The one input a trader normally touches is the **Target**: the contract's strike, typed as Kalshi
shows it. The window has a Target field (Enter commits it into the chart indicator's profile — and
adds the indicator if the chart has none), and a **KALSHI** button that fills Kalshi's published
strike for the live window when the pair is one of its crypto markets.

| Window row   | Pine              | Meaning                                                                                  |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------- |
| TARGET       | `TARGET`          | strike and `close − target` (a strike more than 5% from the close is `CHECK TARGET`)     |
| TIME         | `TIEMPO`          | seconds left in the 15m contract                                                         |
| DIRECTION    | `DIRECCION`       | the SCALP score as an UP/DOWN split that sums to 100                                     |
| TARGET METER | `upPct`/`downPct` | distance-to-strike against the movement left, blended with the market score; sums to 100 |
| STRENGTH     | `FUERZA`          | impulse violence 0–100, separate from direction                                          |
| 1M + 5M      | `alineado*`       | the 1M and live 5M scores agree with the close vs EMA 9                                  |
| STAGE        | `ETAPA`           | CHARGING → CHARGED → ENTER, plus the late and protect states                             |
| MAP 1H/15M   | `MAPA`            | where BTC sits against the 15M/1H highs and lows                                         |
| REASON       | `RAZON`           | why the final call says what it says                                                     |

The final call is one of `REVIEW TARGET`, `PROTECT UP/DOWN`, `DON'T CHASE UP/DOWN`, `ENTER UP/DOWN`,
`CHARGED UP/DOWN`, `CHARGING UP/DOWN`, `TURN / IMPULSE UP/DOWN`, `SIT OUT` and `WAIT` — the Pine
ladder in the same order. **The percentages are a V8 technical estimate. They are not Kalshi's price
and not a guaranteed probability**; the window says so, and so does the tooltip.

On the chart the indicator draws the Pine plots as ordinary price lines — EMA 9/20 (1m only), the
thick aqua **Target**, 5M support/resistance, and the 15M (orange) and 1H (fuchsia) map highs/lows —
plus a dot under/over every confirmed **ENTER**. Its legend carries the current call and the
SCALP split. The TARGET is a single number, so on history it is the _current_ strike applied to every
bar, as in the Pine script: old ENTER dots are only meaningful for the contract you typed.

## Calculation contract

All of the following is the Pine script, statement for statement, in `src/lib/randy-v8.ts`:

1. `f_contextScore` (1H, 15M, 5M) and `f_microScore` (1M) — the fixed-weight sums over EMA stack,
   RSI, structure, sequence, candle body/close position, rejection, engulfing, volume and breaks,
   each clamped to ±100. Missing values (`na`) fail every comparison, as in Pine.
2. The market score `0.27·15M + 0.10·5M closed + 0.24·5M live + 0.21·1M + 0.08·1H + 0.10·map + S/R`.
3. The TARGET core: `capacity = (0.65·ATR1 + 0.35·ATR5/√5)·√minutesLeft·1.10`, the ratio and the
   velocity-projected ratio, the time/distance weight, the context gate, and the ±22 violent-move
   adjustment, then `upPct = round(clamp(50 + scoreV8/2, 1, 99))`.
4. The SCALP score, its evidence count, the pre-alert / CHARGED / ENTER thresholds, `lateUP/lateDOWN`
   (DON'T CHASE), `sitOut`, and `protegerUP/DOWN` driven by the block's last trigger.
5. The strict TARGET confirmation (`confirmBars` 1M closes) which only decides whether ENTER reads
   `TARGET + IMPULSE` or just `IMPULSE`, as in the Pine `mantener*` flags.

**Higher timeframes are read as the Pine script reads them.** Every 1H/15M/5M value except 5M LIVE
is the _closed_ bar (`x[1]` under `lookahead_on`), found by the same walk Chile Reversal uses. **5M
LIVE** is the 5m bar _forming_ at each 1m bar; here it is rebuilt from the chart's own 1m bars up to
and including the current one (one step of every EMA/RSI/ATR recursion from the last closed 5m bar),
so history never sees a 5m bucket's future. The tests prove both: the forming recursion reproduces
the closed bar when fed its final values, and truncating the data never changes an earlier bar.

**The clock.** History uses the bar's close (`time_close`); the live bar uses the wall clock. A bar is
_confirmed_ (`barstate.isconfirmed`) unless it is the live newest bar: the confirmation streaks
advance, and ENTER dots print, on confirmed bars only.

## What differs from the Pine script

- The Pine `alert()` calls and `alertcondition`s are not ported — Atlas has no Pine alert channel.
  Use the window and the legend; custom indicator alarms do not cover this indicator yet.
- The unused **Score SCALP fuerte** input is dropped (the script declared it and never read it).
- The Pine source pasted for this port had two lines damaged in transit (the `ENTRAR UP` branch of
  the decision ladder and the `CHARGED UP` alert). The ENTER UP branch is rebuilt as the exact mirror
  of the intact ENTER DOWN branch: `mode = mantenerUP ? "TARGET + IMPULSO" : "IMPULSO"`.
- Texts are English in the UI; each tooltip keeps the Pine label (`TIEMPO`, `DIRECCION`, `RAZON`…).
  Every settings field lists its Pine input label.

Tests: `src/lib/randy-v8.test.ts` (engine), `src/components/RandyV8Window.test.ts` (window) and
`tests/randy-v8.spec.ts` (browser, demo mode).
