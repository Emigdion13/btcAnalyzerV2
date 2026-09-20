# MTF RSI window — multi-timeframe RSI with a tendency call

The **MTF RSI window** is a floating panel that answers one question five times at once: for
**1m, 5m, 15m, 30m and 1h**, what is the RSI, and which way is that timeframe leaning —
**bullish, bearish, or in range**.

**Alt R** toggles it (the toolbar **Floating** selector and the workspace menu also own it).
It drags anywhere inside the chart, minimizes to a single bias line, and remembers its
position like every other floating window. It stays closed during bar replay, like the other
live readouts.

## Why the tendency is not read off RSI alone

A bare "RSI above 50 = bullish" classifier is exactly the one that whipsaws. RSI is a
_momentum_ oscillator, and momentum is regime-dependent:

- In an uptrend, RSI spends most of its life **above 50** — but a healthy pullback inside that
  uptrend spends time **below 50**. A 50-line classifier calls the pullback "bearish".
- Andrew Cardwell's range rules (the refinement of Wilder's work most RSI practitioners trace
  back to) formalize the regime dependence: a bull market oscillates roughly in the **40–80**
  band, a bear market in the **20–60** band, and the 30/70 readings mean different things in
  each. What a reading _means_ depends on the regime — so the regime has to be classified
  first, by measures that are not RSI.

So each row's tendency is decided in two steps: **is this timeframe trending at all?**, and
only then, **which way?**

## Step 1 — the regime: a fused trend-quality score

Three independent measures are computed on the timeframe's own candles and fused into one
**0–100 trend-quality score**:

| Measure                            | Weight | What it captures that the others miss                  |
| ---------------------------------- | ------ | ------------------------------------------------------ |
| Wilder **ADX(14)**                 | 45%    | Directional strength (consensus: >25 trend, <20 range) |
| Kaufman **efficiency ratio (20)**  | 35%    | Path quality — net move ÷ distance travelled, 0..1     |
| **EMA(20) slope** in ATR(14) units | 20%    | Trend velocity, normalized by volatility               |

`score = 100 × (0.45·min(ADX/50, 1) + 0.35·ER + 0.20·min(10·|slope|/…, 1))`

The measures are deliberately independent: ADX smooths directional movement (it is slow), the
efficiency ratio measures the raw path (it is fast), and the slope is the trend backbone's
speed **in ATR units**, so BTC at $30k and BTC at $120k produce the same number for the same
behaviour. ADX alone misses path quality; the ratio alone misses direction; the slope alone
misses choppy-but-strong moves. The 45/35/20 weighting keeps any one of them from dominating.

### The hysteresis gate

The score drives a hysteretic regime gate, because thresholds without hysteresis flicker:

- **score ≥ 55** → this timeframe is **trending**
- **score < 45** → this timeframe is **ranging**
- **45 ≤ score < 55** → the dead-band: **the previous call stands**

A trend must decay through the whole dead-band before the window calls a range, and a range
must earn its way past the entry threshold to be called a trend. This is the standard way to
stop a boundary value from flip-flopping a verdict every update.

## Step 2 — the direction: a two-of-three vote

Inside a confirmed trend, direction is a majority vote of three measures, where an abstention
is silence rather than a neutral:

1. **+DI vs −DI** (from the same Wilder DMI) — votes only with a **≥ 2-point spread**; a
   hair's-breadth lead is noise.
2. **The EMA(20) slope's sign** — votes only when it moves **≥ 0.02 ATR per bar**.
3. **RSI(14)** — votes only **outside the 45–55 no-man's land**; a coin-flip RSI abstains.

**Two of three bullish votes → bullish; two of three bearish → bearish.** A trend the votes
cannot agree on a direction for reads as **range** — conflicted, not half-bullish. This is
also where Cardwell's insight is quietly applied: an uptrend whose RSI dips to 42 does _not_
flip the call, because the DI lines and the slope still vote with the trend — the same
behaviour Cardwell documented as "RSI pullbacks to 40–50 in an uptrend are continuations, not
reversals".

## Step 3 — stability: confirmation, not instant repaint

The displayed tendency only changes after **two consecutive updates** carrying a different
raw classification (`MTF_TENDENCY_CONFIRMATIONS`). One loud tick — a spike, a thin-book print,
a single bad candle — cannot repaint a verdict; a genuine regime change is one update behind
at most. The confirmation counter is keyed to the feed's fingerprint (bar count + last bar
time + last close), so re-renders and unchanged feeds never advance it.

## The rows

Each row shows, left to right:

- the **timeframe**,
- the **RSI(14)** — Wilder's, over that timeframe's full candle history, **forming bar
  included** (the same honesty rule the timeframe peek's RSI keeps). Coloured by tendency;
  shows `··` while warming.
- a **0–100 gauge** with the 50 midline marked and the reading pinned on it,
- the **tendency chip** — `▲ BULLISH` (green), `▼ BEARISH` (red), `● RANGE` (grey),
  `warming` while there is not enough history (a reading needs ~28 closes; ADX is the last
  component to land), and `no data` when the feed has nothing.
- a **trend-quality bar** — the fused score itself, so "how much of a trend" is visible, not
  just the label. Hovering a row spells out every input: RSI, ADX, both DIs, efficiency,
  slope in ATR/bar, quality, the votes, the verdict, and the bar count.

A row whose feed is stale, reconnecting or offline dims and carries the feed's own state in
its tooltip; the window header reads **DEGRADED** and the footer counts the unfed rungs. Kalshi
silver publishes no 1m/5m resolutions, so those rows read `no data` there — the same honesty
rule the metals feeds use everywhere else.

## The bias line — weighted, top-down

The footer's one-line summary weights each timeframe's tendency on a plain arithmetic ladder —
**1m ×1, 5m ×2, 15m ×3, 30m ×4, 1h ×5** — so the 1h carries five times the 1m's vote, the
top-down rule every multi-timeframe methodology agrees on. Consequences worth stating:

- **Ranges abstain.** They are the absence of a call, not a vote against one, and do not
  dilute the share of the mass that does vote.
- **Two agreeing higher timeframes can call the bias against all three lower ones** (9/15 of
  the mass) — the "HTF leads" scenario.
- **A lone fast-timeframe signal cannot** (the 1m is 1/15 of the mass at most).
- A bias needs a **60% supermajority** of the weighted tendency mass; anything less is
  reported honestly as **MIXED**.

The header dot and the window's frame answer the bias — green leaning bullish, red leaning
bearish, quiet when mixed.

## Data flow and honesty rules

- The window reads the **same feeds every multi-timeframe consumer shares**:
  `requestedIndicatorTimeframes(indicators, chart, extra)` de-duplicates the ladder against
  the chart's own resolution (that rung is served by the chart candles), so opening the
  window while `CM_Ult_MacD_MTF` runs on 1h costs no extra connection for 1h, and hiding the
  window releases the rest.
- Demo mode runs the synthetic history and says so. **Bar replay never reads live candles** —
  the window stays closed while replaying.
- The arithmetic is pure and unit-tested: `src/lib/mtf-rsi.ts` (no React, no DOM). The panel
  is `src/components/MtfRsiWindow.tsx`, which only renders what the lib computes — the
  window cannot disagree with its own arithmetic because there is no second implementation.

## Reference reading

- J. Welles Wilder, _New Concepts in Technical Trading Systems_ (1978) — RSI, ADX, the DI
  pair, and the smoothing every component here uses.
- Andrew Cardwell's RSI range rules (bull 40–80, bear 20–60; the 50 centerline as the bias
  line) — the case that regime context defines what an RSI reading means.
- Perry Kaufman, _Trading Systems and Methods_ — the efficiency ratio.
- Consensus practitioner thresholds: ADX 20–25 as the range/trend line; the composite
  trend-quality fusion (ADX + efficiency + ATR-normalized slope with a hysteresis gate) is a
  standard practitioner pattern for stable TREND/CHOP regime detection.
