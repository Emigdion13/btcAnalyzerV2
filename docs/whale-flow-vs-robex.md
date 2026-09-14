# Whale flow vs. ROBEX IA CHILERA — what the Pine script gets right that our whale logic should steal

**Status: analysis, with §4.1 now shipped.** It compares the ROBEX IA CHILERA
V18 PRO Pine indicator (a bar-based, multi-factor scoring engine) against the whale-flow logic
already in Atlas (`shared/whale-flow.ts` → `WhaleFlowTracker`, and the decision layer
`analyzeWhale()` in `src/lib/market-agents.ts`). The goal is one question: _which parts of
ROBEX's decision machinery would make our whale logic better, and which parts we must not copy._

The highest-value item in §4 — S/R and book-wall context on the sweep — is implemented as
[`whale-level-context.md`](whale-level-context.md); §4.1 below records what was proposed and what
shipped. §4.2–§4.6 remain proposals.

Nothing here is trading advice.

---

## 1. The one-line answer

The two systems are not competitors — they measure different things at different depths:

- **ROBEX is an inference engine.** Every input is a derivative of OHLCV bars (EMAs, RSI,
  Supertrend, VWAP, pivots). Its "compradores/vendedores" figure is **fabricated**: it is the
  candle's close position inside its own range (`(close − low) / (high − low)`), which is a
  *guess* at who won the bar, not a measurement of who traded.
- **Our whale flow is a measurement engine.** It reads the executed tape (`matches` channel) and
  reports *actual* signed money: taker buys vs. taker sells, dollar-sized and direction-signed.

So the transfer is **one-directional and specific**. We should not copy ROBEX's order-flow
numbers (ours are the ground truth their numbers fake). What ROBEX has that we lack is its
**decision machinery**: multi-factor confirmation, edge/threshold gating, lateral-market
suppression, heavy S/R context weighting, and signal hygiene (confirmation + cooldown). Those
are the parts worth porting onto the whale detector.

---

## 2. What each system actually is

| Dimension | ROBEX IA CHILERA (Pine) | Our whale logic (Atlas) |
| --- | --- | --- |
| Data source | OHLCV bars, 1 current TF + 15m + 5m via `request.security` | Executed fills (`matches`) + resting book (`level2`) |
| What it measures | Price-action *proxies* for intent | *Actual* executed money (taker direction × notional) |
| Signal form | Discrete `-1 / 0 / +1` per 15m round, plus scalp arrows | Ephemeral sweep: `building → active → fading` |
| Signal strength | Composite score (additive weights) + normalized `fuerza%` + `ventaja` (edge) | `intensity` = net ÷ adaptive threshold; then `strength` blend in the agent |
| Context | Built-in: trend, S/R, lateral filter, multi-TF | None inside the whale agent itself — context lives in *other* agents |
| Memory | Persistent panel (running scores, countdown) | Deliberately ephemeral — no stale number survives |
| The killer weakness | Its order flow is fabricated; MTF reads risk lookahead | A single factor with zero context: size, direction, nothing else |

---

## 3. The comparison that matters: what ROBEX conditions a signal on

ROBEX never acts on one factor. Its prediction requires **all of these at once**:

1. `score ≥ minScore` **and** `ventaja ≥ minVentaja` — both raw strength *and* directional edge
   over the opposing case, not just the raw tally.
2. `not mercadoLateral` — a chop filter (`|ema9−ema21| < ATR·0.025` and RSI in 47–53) that
   suppresses signals when the market has no direction to predict.
3. **S/R context carries the heaviest single weights** — `reboteSoporte`, `rechazoResistencia`,
   `rompeResistencia`, `rompeSoporte` are each worth **+3**, more than any trend/momentum factor
   (which top out at +2).
4. **Confirmation + candle quality** for scalps — `close > ema9`, `close > vwap`, `RSI > 50`,
   and `cuerpoRatio ≥ 0.45` (an impulse candle, not a doji).
5. **Cooldown** — `scalpCooldown` bars between signals, so one setup can't re-fire on itself.

Our whale agent (`analyzeWhale`) currently conditions on **none** of that. It takes the sweep and
votes: direction = sign(net), strength = `0.45·tier + 0.30·intensity + 0.25·oneSided`, scaled by
phase. That is a fine *detector*, but a thin *decision-maker* — it has no idea whether the money
is hitting into support or into resistance, whether it's being absorbed, or whether price even
moved in the sweep's direction.

---

## 4. What to steal, in priority order

### 4.1 S/R context on the sweep — the highest-value change (maps to ROBEX's +3 events)

ROBEX gives its biggest weights to *what happens at a level* (bounce / reject / break). The repo
already computes everything needed: `analyzeLevelStrength()` produces a `LevelStrengthSummary`
with `nearestSupport` / `nearestResistance` (price, strength, `distanceAtr`, `bookBucket`,
`bookNotional`), and the level2 book exposes resting walls (`supports` / `resistances` in
`OrderBookView`).

Today `analyzeWhale(flow)` takes only the sweep. It should take the level summary too, and
classify the sweep the way ROBEX classifies a candle:

| Sweep situation | ROBEX analogue | Effect on the whale vote |
| --- | --- | --- |
| Buy sweep, price **at/under support**, book shows a resting bid wall ahead | `reboteSoporte` | Boost — a level is being defended by size |
| Buy sweep **through resistance**, breaking a wall | `rompeResistencia` | Boost — absorption is failing, continuation likely |
| Buy sweep **into resistance**, wall holds and price stalls | `rechazoResistencia` | **Invert or kill** — the whale is being faded; this is the case our agent currently calls wrong most often |
| Sweep with **no level within ~1 ATR** | — | Neutral — keep the raw read |

This is the single change that turns the whale agent from "there is money" into "there is money
*here*, and here is whether it will work." It is also the place where a whale sweep plus the
resting book actually becomes predictive: the book shows the wall the sweep is about to hit.

**Where:** `analyzeWhale()` gains a parameter (level summary + `OrderBookView`), called from
`analyzeMarket()` where `levelStrength.summary` and `snapshot.book` are already in scope.

**Shipped.** Implemented as `whaleLevelContext()` in `src/lib/whale-level-context.ts`, wired into
`analyzeWhale(flow, frame)`. All four rows above exist as verdicts — `defended`, `break`,
`absorbed` (damp, or **flip** against the tape when absorption ≥ 0.75 *and* the resting size is at
least half the sweep), and `clear` — with two refinements the table above did not spell out:
an obstacle may also be a book wall with **no** chart level at that price (the book sees walls the
SR engine does not), and a chart level on its own can never flip a vote, only damp it, because
arguing against executed money needs resting size to argue with. Rules, constants and the exact
scoring live in [`whale-level-context.md`](whale-level-context.md).

### 4.2 Regime awareness (maps to ROBEX's `mercadoLateral` suppression)

ROBEX refuses to predict in a lateral market. Our ensemble already has `MarketRegime`
(`trend-up / trend-down / range / breakout / breakdown / chop`) and already varies the whale
weight by regime (0.07–0.10 in `BASE_WEIGHTS`). But `analyzeWhale` itself never sees the regime,
so it votes the same direction and confidence whether the sweep is *with* the trend or *against*
it.

- **Counter-trend sweep in a strong trend** → down-weight and warn ("whale fading the trend").
- **Sweep in `range`/`chop`** → up-weight slightly and *label it*: a directional sweep in chop is
  often the first fingerprint of the breakout, which is exactly when the whale agent should speak
  loudest rather than stay neutral.
- **Sweep aligned with `breakout`/`breakdown`** → confirmation, boost confidence.

This is cheap: pass `regime` into `analyzeWhale` and apply a small multiplier plus a warning line.

### 4.3 Edge over the opposing flow, not just ratio (maps to ROBEX's `ventaja`)

ROBEX gates on `ventaja` (score-up − score-down), not just score. The whale agent's closest term
is `oneSided = |bought − sold| / (bought + sold)`, but a ratio is fragile when the window is
thin: two fills, one each way, gives `oneSided = 0`, while the *net* already tells the real story.
The `net` is used for direction but the *edge* (`net` vs. the *opposing* flow, plus participation)
is not surfaced as a gate.

Concretely, a $50K sweep walked across 30 fills should not earn the same conviction as a $50K
single print. Add:

- **participation** = fill count (already in `flow.count`) as a confidence component;
- **persistence** = how long the sweep has stayed one-directional (derivable in the tracker from
  `endsAt` / window residency), so a sustained sweep outranks a one-shot;
- **net edge** = `|net| / max(gross, threshold)` as the "ventaja" analogue, gating the vote the
  way `minVentaja` gates ROBEX's prediction.

### 4.4 Price confirmation after the sweep (maps to ROBEX's `confirmacionLong/Short`)

ROBEX's scalps require price to already be on the right side (`close > ema9`, `close > vwap`,
RSI > 50) **and** an impulse body. Our whale agent votes the instant a sweep prints, before price
has done anything. The tape itself contains the confirmation: the tracker can record **price at
sweep start vs. price at sweep peak** and report whether the market *followed* the money.

- A buy sweep that **moved price up** → the money worked; vote with full strength.
- A buy sweep with **price flat or down** → the book absorbed it; the whale is being faded — this
  is the most common false positive and currently scores identically to a working sweep.

This is a small, pure measurement (a start-price and peak-price on the `BurstMemory`), and it
converts "impact happened" into "impact *worked*".

### 4.5 A session-level baseline above the 5s window (maps to ROBEX's 15m + 5m layering)

The tracker's threshold is calibrated on ~1500 recent trades — a few minutes of history. So
"whale" means "unusual vs. the last few minutes." ROBEX layers 15m and 5m for exactly this
reason. Cheap addition: keep a rolling percentile/max of the *peak sweep magnitudes* already
detected, so the UI can distinguish a **burst whale** ($50K in a quiet minute) from a **session
whale** ($1M+ event that is rare even on this product). The burst whale is the actionable
near-term signal; the session whale is the regime fact worth remembering.

### 4.6 Signal hygiene: cooldown + event journal (maps to ROBEX's `scalpCooldown` + panel)

Two small borrowings:

- **Cooldown.** The tracker's `burstOpen`/`lastBurst` already prevent a single sweep from
  double-counting at the *detector* level, but the *agent* re-votes every second a sweep is
  active. That's fine for an ensemble, but when we log or alert on sweeps we want one **event**
  per sweep, not one per second — a latch analogous to `scalpCooldown`.
- **Memory without a stale number.** Our `WhaleFlowBox` is deliberately ephemeral (a documented,
  good design — see below). ROBEX's panel persists. The right compromise is an append-only
  **event journal** of confirmed sweeps (size, S/R context from §4.1, price outcome from §4.4),
  which the existing `agent-journal.ts` / learning infrastructure can already grade. We get
  ROBEX's "panel memory" without putting a stale figure on the chart.

---

## 5. What our whale logic already does *better* — don't regress

1. **Real order flow.** ROBEX's `compradores/vendedores` is `(close − low)/(high − low)`, a
   candle-position proxy. Ours is the actual taker-side tape, correctly inverted
   (`parseTrade` maps Coinbase's maker `side` to `takerSide`). This is the one place we are
   strictly ahead, and it is the thing to *keep*.
2. **Adaptive, venue-relative thresholds.** ROBEX's thresholds are fixed integers. Our percentile
   threshold adapts per product, floors at $50K, and never treats dust as a whale. Keep it.
3. **Ephemerality as honesty.** No running total means no stale figure pretending to be current.
   ROBEX's panel *does* show a stale-looking fuerza% between rounds. Keep the number ephemeral;
   add the journal (§4.6) for memory.
4. **Anti-lookahead by construction.** The tape is executed data — there is nothing to repaint.
   ROBEX's `request.security(…, lookahead=barmerge.lookahead_on)` reads are offset with `[1]` to
   dodge repaint, but MTF lookahead in Pine is a real, easy-to-get-wrong hazard. Ours has none.

---

## 6. What *not* to copy

- **The fabricated compradores/vendedores.** We already have the real thing; importing ROBEX's
  candle-position proxy would be a downgrade.
- **Fixed integer weights.** Our agents are already weighted, learnable (`agent-journal.ts` /
  `learnFromOutcome`), and regime-tilted. Don't replace that with hard-coded `+1/+2/+3` tallies.
- **The 15m-round framing.** ROBEX only fires on `:00/:15/:30/:45`. Our sweep is continuous by
  nature; forcing it onto a 15m clock would throw away most of its lead time. (The Kalshi strike
  framing in the ensemble already handles the window-call half when it matters.)
- **The "prediction" label.** Our README stance is a chart viewer, not a prediction engine, and
  the whale doc is explicit that a sweep cannot predict a trade before it happens. Keep that
  honesty; frame the improvements as *contextualizing impact*, not as a crystal ball.

---

## 7. Effort / value at a glance

| # | Change | Where | Effort | Value |
| --- | --- | --- | --- | --- |
| 4.1 | S/R + book-wall context on the sweep — **shipped**, see [`whale-level-context.md`](whale-level-context.md) | `analyzeWhale` (+ callers) | Medium | **Highest** |
| 4.2 | Regime awareness | `analyzeWhale` (+ callers) | Low | High |
| 4.3 | Edge / participation / persistence gating | `whale-flow.ts` + `analyzeWhale` | Low | High |
| 4.4 | Price-follow confirmation | `WhaleFlowTracker` (`BurstMemory`) | Low | High (kills the top false positive) |
| 4.5 | Session-level baseline | `WhaleFlowTracker` | Low | Medium |
| 4.6 | Event latch + journal | server/agent wiring | Medium | Medium |

4.1 is done. Of the five that remain, 4.2–4.4 are the ones that meaningfully change a decision,
and all three are small, self-contained edits with clear test coverage already scaffolded in
`shared/whale-flow.test.ts` and `src/lib/market-agents.test.ts`.

---

_Research note compiled 2026-09-13. Whale-flow signals are informational; none constitutes a
trading signal or investment advice._
