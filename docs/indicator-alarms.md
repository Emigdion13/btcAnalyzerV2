# Custom indicator alarms (MACD · RSI · CM_Williams_Vix_Fix)

Atlas's price alerts watch a number; indicator alarms watch a **moment**. Build one with
**Alt B** (or the **+** in the alerts panel's _Indicator alarms_ section) and choose:

- the **pair** and **timeframe** the alarm owns,
- the **indicator** — `CM_Ult_MacD_MTF`, the conventional MACD, Wilder RSI, or
  `CM_Williams_Vix_Fix`,
- the **condition** — a cross, an "about to cross", a green/red turn, a ChrisMoody histogram
  colour, a level, a spike,
- up to **three more conditions** to combine with it (see _Combining conditions_ below),
- how it **re-arms** and whether it reads the **forming bar** or only **closed bars**.

Everything is evaluated by the app's own indicator code on candles from the same read-only,
same-origin API the chart uses. An alarm can never disagree with the pane it is named after,
because there is no second implementation to drift.

## How a condition fires

Every condition is a **state** on the newest bar — _the MACD line is above its signal_, _RSI is
above 70_, _the VIX Fix bar is lime_. An alarm fires on the bar that state first becomes true,
and never twice for the same bar however many times a forming bar repaints.

| Card says                 | Meaning                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `Watching ·`              | Armed, the state is not true yet, and this is the live reading |
| `Holding ·`               | The state is true right now                                    |
| `Fired 14:05 UTC`         | The last time it fired, with a ×N count for repeat alarms      |
| `Paused`                  | Switched off from the card                                     |
| `Not on this data source` | The alarm's venue is not the one this workspace is reading     |

A combined alarm is judged the same way, one bar at a time: `All of them` is true only on a bar
where every leg is true, and `Any of them` on a bar where at least one is. A leg that fired on an
earlier bar is not still "holding" — that is what makes an AND gate mean the _same bar_.

Crosses compare two bars, which is why they fire on the bar of the cross rather than while the
lines are merely on the same side: _MACD turns green_ fires on the bar the MACD line moves from
at-or-below its signal to above it, exactly the bar `CM_Ult_MacD_MTF` paints lime.

## "About to cross" without a number to tune

The proximity conditions — _MACD is about to cross above the signal line_, _RSI is about to
cross above a level_, _WVF is about to trigger a spike_ — answer the question **"how far away is
it, in bars of typical movement?"**

```
bars to the cross ≈ distance to the trigger ÷ mean |change per bar| over the last 20 bars
```

The alarm fires while the gap is **still open**, **narrowing**, and within the alarm's _within_
setting (default **3 bars**, editable 1–20). That normalisation is the point: 0.4 MACD points is
a rounding error on a 1D BTC chart and a mile on 1m, and RSI moves a different number of points
on every instrument. Nothing needs to be tuned per pair, and nothing fires once the cross has
already happened — that is what the cross conditions are for.

If a series has fewer than four usable deltas (a fresh chart, a short history) the proximity
reading reports "no cross closing yet" instead of inventing a number.

## Combining conditions

One alarm can watch up to **four conditions at once** — the primary one, plus three more from
**Add condition** — and say how they combine:

| Match           | Fires when                                                             |
| --------------- | ---------------------------------------------------------------------- |
| **All of them** | every condition holds **on the same bar** (default)                    |
| **Any of them** | any single condition becomes true; the toast names the leg that did it |

`All of them` is an AND gate on one bar: _MACD turns green **and** RSI is above 70 on the bar of
the cross_ — a cross that is already confirmed by momentum, rather than two alarms you have to
read side by side. `Any of them` is the OR gate: one alarm, several independent reasons to look.

Rules the builder enforces, and the importer re-checks:

- **One MACD flavour per alarm.** The CM and classic MACD would want the same series slot and
  "MACD turns green" would stop meaning one thing, so picking one removes the other from the
  picker. Mixing MACD with RSI and the VIX Fix is the point; mixing MACD with MACD is not.
- **No duplicate legs.** The same indicator + condition twice is not a combination.
- Legs share the alarm's settings: one RSI length, one MACD length set, one VIX Fix input set,
  one pair, one timeframe, one re-arm.
- The **preview** evaluates the combination live from the open chart and says what it is waiting
  on — `Waiting on RSI above 70`, `All 2 conditions hold: …`, `Triggered by …`.
- The **chime** follows the legs: all bullish (or all bearish) sounds like that, and a genuinely
  two-sided combination — a bullish leg gated on a bearish one — gets the flat pair instead of
  picking a side you did not pick.

## What each indicator offers

**`CM_Ult_MacD_MTF` (12, 26, 9)** — ChrisMoody's maths (Pine's seeded EMA, SMA signal), evaluated
at the alarm's own timeframe.

| Group           | Conditions                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Crosses & turns | turns green (crosses above signal), turns red (crosses below signal), about to cross up/down, crosses above/below zero                         |
| Levels          | MACD line above / below a level                                                                                                                |
| Histogram       | rising, falling, and ChrisMoody's four colours — aqua (rally building), blue (rally fading), maroon (sell-off fading), red (sell-off building) |

**MACD (classic)** — the EMA/EMA/EMA maths the conventional pane plots, with the same crosses,
levels and momentum conditions. It has no colour change, so the four histogram colours are not
offered; green and red simply mean the MACD line above or below its signal line.

**RSI (14, any length)** — crosses above / below a level (defaults 70 / 30), about to cross above
/ below, above / below a level, turns up out of a dip, turns down from a peak.

**`CM_Williams_Vix_Fix` (22, 20, 2, 50, 0.85, 1.01)** — a fear spike fires (the published lime
bar), the spike ends, about to trigger, crosses above the Bollinger upper band, crosses above the
percentile range high, above / below a level. All six published inputs are editable per alarm.

## Where the candles come from

- **The open chart's pair** is read from the live stream the app is already running, so an alarm
  on what you are looking at reacts to the same ticks the pane does.
- **Any other pair** the alarm names is polled from `/api/coinbase/candles` (or Kalshi's
  `/api/kalshi/metals/history` for silver) every **45 seconds**, up to 12 distinct pairs at once.
  Polling is skipped for a pair whose venue this workspace is not reading — a Coinbase alarm has
  nothing to do in demo mode.
- **Demo pairs** are generated locally, with the demo tape's live quote applied to the last bar,
  exactly like the demo chart.

`Forming bar` reads the bar that is still building: fastest, and the right choice for "about to
cross" — but its numbers can repaint until the bar closes. `Closed bars only` waits for the venue
to finish publishing a bar, so a 15m alarm can be up to one bar behind but never repaints.

## Limits and honesty

- Alarms **pause while the feed is disconnected, and during replay**, exactly like price alerts.
- **One fire per bar.** A `repeat: bar` alarm re-arms on every new bar that satisfies it; a
  `repeat: once` alarm switches itself off after its first fire.
- **Up to 25 alarms**, 12 distinct polled pairs. 50 price alerts remain separate. A combined
  alarm still costs one polled pair, however many legs it reads.
- The chime is synthesised with Web Audio (no asset, no fetch) and can be silenced per alarm or
  globally from the panel. Browsers require one interaction before audio is allowed — the
  builder's **Test the chime** button says so when it applies.
- **In-app only.** No email, no push, no server-side monitoring, no background service, and no
  orders. Nothing is evaluated while the workspace is closed.
- Alarms are stored with the rest of the workspace (and in workspace backups), so they survive a
  reload and travel with an exported file.
