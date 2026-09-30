# Level strength · measured, not assumed

Atlas used to give every support/resistance level a strength between 0 and 1: a hand-weighted mix
of the SR box's fill (35%), recency (20%), volume (20%), touches (15%) and the order-book bucket
(10%), or `touches / 5` for a pivot. Nobody had checked whether a 0.8 level holds more often than
a 0.2 one. This note records the check, what changed, and the live journal that tests the one
thing history can't.

Nothing here is a trading signal or investment advice.

## The study

`src/lib/level-hold.backtest.test.ts` replays Coinbase BTC-USD through the production level
pickers (`pivotLevels`, `levelFromSrZone` in `src/lib/level-strength.ts`) on a trailing 300-bar
window, the chart's default load. Levels are read from closed bars only.

- **A test** starts on the first bar that trades through the level's price after closing on the
  near side of it. The level must be traded through, not just come near: a level counted as
  touched 0.25 ATR early gets a head start in the hold/break race below and looks stronger than it
  is. (The first version of the study made that mistake and showed a fake +10-point edge.)
- **Held** means price then trades 1 ATR(14) back away from the level before trading 1 ATR through
  it, within 60 bars. The touch bar can only break: its high came before its low for all a bar can
  tell. The same verdict came out at 0.5 and 2 ATR.
- **The control** is a random price 0.05–1.5 ATR from each close, touched and graded exactly the
  same way. A level is only strong if it holds more often than a price nobody chose.

Measured 2026-09-29: 1m and 3m over 30 days, 5m/15m/30m over 180 days, 1h/2h/4h over two years,
1D over ten years. About 85,000 level tests in all.

| Timeframe | Random price held | Pivot held | SR box held |
| --------- | ----------------- | ---------- | ----------- |
| 1m        | 42.0%             | 41.9%      | 41.5%       |
| 3m        | 45.6%             | 44.6%      | 45.0%       |
| 5m        | 45.9%             | 45.9%      | 44.9%       |
| 15m       | 47.2%             | 47.2%      | 44.9%       |
| 30m       | 47.4%             | 47.5%      | 43.1%       |
| 1h        | 47.9%             | 47.6%      | 42.9%       |
| 2h        | 47.3%             | 47.6%      | 47.4%       |
| 4h        | 47.1%             | 48.3%      | 48.6%       |
| 1D        | 46.4%             | 47.0%      | 39.2%       |

Every rate sits under 50% because a touch keeps some momentum and the touch bar can only break.
That is the same for both columns, so it cancels out of the comparison.

**On BTC, a tested pivot or SR box holds no more often than a random price.** Nothing that
describes a level changed that: the old strength score (AUC 0.50–0.53, where 0.50 is a coin flip),
touches, age, the size of the original bounce, swing prominence, volume at the pivot, the SR box's
fill and volume grading, round numbers, several pivots stacked at one price, old resistance turned
support, higher-timeframe pivots, rejection wicks, how fast price approached. A logistic model on
all of them, trained on the first 60% of each tape and scored on the last 40%, reached an AUC of
0.51–0.56 and predicted worse than the plain base rate on every timeframe except 1m.

## What changed

- `LevelReference.strength` is now the measured edge over a random price for that level kind on
  that timeframe, from `LEVEL_HOLD_RATES`, less the 95% margin of the difference, scaled so a
  10-point edge reads 1 (`levelStrength`). On the table above every level reads **0**. Each level
  also carries `holdRate` and `randomHoldRate`, so the agents can say what the tape said.
- The level-strength and structure agents still name the nearest levels. They only vote when a
  level has a measured edge, and until one does they say so in their reasons. The book imbalance
  term in the level agent is unchanged. The price forecast and whale context still read the
  resting book at a level; only the level's own strength fell to 0.
- Re-running the agent training on its seven BTC scenarios after the change: mean Brier 0.1967
  before and after, and a strike-call hit rate of 70.8% before vs 70.3% after. That's inside the
  noise: removing the level votes cost nothing.

To re-measure a timeframe and update the table:

```bash
LEVEL_HOLD_TF=15m LEVEL_HOLD_DAYS=180 npx vitest run src/lib/level-hold.backtest.test.ts
```

It prints the row for `LEVEL_HOLD_RATES`. If a future tape shows a real edge, `strength` picks it
up and the agents start voting again, with no other change.

## The one thing history can't test: the book

The `STRONG / MED / WEAK` chips on the chart's zones come from the resting level2 book
([order-book notes](order-book-strength.md)), and Coinbase keeps no level2 history. So the chips
are measured live instead, by the **level-touch journal** (`src/lib/level-touch-journal.ts`,
`useLevelTouchJournal`):

1. On every closed bar it watches six prices for the next bar: the nearest pivot and SR box on
   each side of price, and a random control price on each side. The pickers and the control are
   the backtest's own.
2. On each book update, while price is still more than 0.25 ATR from a watched price, it scores the
   resting book defending that price over ±0.25 ATR (`scoreZone`, the chips' own rules). That is
   the book that was there before price arrived, not what's left after the first fills.
3. When the forming bar trades through a watched price, the test is recorded with that book
   reading: `strong`, `medium`, `weak`, or `none`.
4. As bars close it grades each test with `gradeLevelTest`, the backtest's rule. A test history
   can no longer reach, or one that stays undecided for 60 bars, is dropped as expired.

It only runs on a live, non-replay Coinbase chart, never on the demo book, a replay or a metal. The
journal keeps the latest 2,000 tests in local storage.

The **Level tests** table in the order-book box shows, for the chart's product and timeframe, held
over graded tests for each book bucket, for levels and for random prices side by side, with the
backtest's no-book rates for reference. It answers two questions:

- **Does size behind a price make it hold?** Compare the Strong row with the Nothing row.
- **Does it matter more at a chart level?** Compare the Levels and Random columns in the same row.

A row means little under about 100 tests. A 10-point gap needs roughly 200 tests in each of the two rows being compared to stand
clear of the noise.
