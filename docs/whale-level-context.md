# Whale sweep level context · Atlas implementation notes

The whale-flow detector measures executed money: a sweep is a signed notional, a fill count and a
phase. It has never known **where** that money was going, so the same $500K of taker buying scored
identically whether it was pressing off a defended support, walking through a resistance whose
resting asks had just been eaten, or disappearing into a wall three times its size that had not
moved. The third case is the detector's most common false positive.

This feature closes that gap. It is the shipped form of §4.1 ("S/R context on the sweep") of the
[ROBEX comparison note](whale-flow-vs-robex.md): the heaviest-weighted events in that Pine engine
are the ones that happen _at a level_ — `reboteSoporte`, `rompeResistencia`, `rechazoResistencia`,
each worth +3 against a maximum of +2 for any trend or momentum factor. Atlas already computed
everything needed to ask the same question of a sweep, from two sources it already trusts:

- the nearest confirmed **S/R level** the level-strength specialist pins (SR zones first, pivots as
  the fallback) — see [`sr-breaks-retests.md`](sr-breaks-retests.md);
- the **resting level2 book** — how much USD is sitting inside that level's band, how long it has
  been sitting there, and which walls the book itself is constructing — see
  [`order-book-strength.md`](order-book-strength.md).

Nothing here is a trading signal or investment advice.

## What it decides

`whaleLevelContext(flow, frame)` in `src/lib/whale-level-context.ts` takes the live sweep plus the
frame `analyzeMarket` already has (last close, ATR(14), `LevelStrengthSummary`, `OrderBookView`)
and returns one of four verdicts, a strength multiplier, an optional flip of the vote, and the
plain language the whale agent says about it.

| Verdict    | Situation                                                                                                    | ROBEX analogue       | Effect on the whale vote                 |
| ---------- | ------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------- |
| `break`    | The sweep's own fills traded the whole level band and less size is left resting there than the sweep brought | `rompeResistencia`   | Boost: strength ×1.24, confidence +0.10  |
| `absorbed` | The sweep is pressing into a level (or a wall) still in front of it                                          | `rechazoResistencia` | Damp by absorption; **flip** if decisive |
| `defended` | The path ahead is open and the level behind the push is held by material resting size                        | `reboteSoporte`      | Boost: strength ×1.08–1.24, +0.06        |
| `clear`    | Nothing confirmed within 1 ATR                                                                               | —                    | Neutral: the raw tape read stands        |

Both directions are symmetric. For a **buy** sweep the obstacle ahead is the nearest resistance (and
the nearest ask wall), the one behind is the nearest support (and the nearest bid wall). For a
**sell** sweep the roles swap, so the same $1.5M ask wall that fades a buy sweep reads as a defended
ceiling a sell sweep is rejecting off.

## What counts as an obstacle

An obstacle is the **closer** of two things on one side of price:

1. a confirmed price-action level, priced against the book with `scoreZone` over its band (resting
   notional, `hold`, zone bucket, walls inside); or
2. a detected book **wall** with no chart level at that price (`OrderBookView.supports` /
   `.resistances`), which gets a tight ±0.05 ATR band of its own.

A wall resting within `max(0.35 ATR, half the band)` of a level is folded into that level rather
than treated as a second obstacle — one price, one obstacle, the strongest evidence from both
sources. Obstacles further than `WHALE_LEVEL_REACH_ATR` (1 ATR) are reported but never scored;
walls on the wrong side of price (an ask below it, a stale book) are ignored outright.

How far the sweep has already walked comes from **its own fills**: the extreme price among the
prints on the aggressor side, which is a conservative bound because the tracker carries only the
largest prints. Counter-flow prints in the same window are the other party's business and are not
used. With no prints on that side, the frame price is the bound. §4.4 of the research note (start
and peak price on the burst itself) would make this exact rather than bounded.

## The exact rules

All constants are exported from `src/lib/whale-level-context.ts`.

| Constant                   | Value | Meaning                                                                 |
| -------------------------- | ----- | ----------------------------------------------------------------------- |
| `WHALE_LEVEL_REACH_ATR`    | 1.0   | An obstacle further than this, in ATR, is not part of the sweep's story |
| `WHALE_ABSORPTION_FLIP`    | 0.75  | Absorption at or above this may flip the vote against the tape          |
| `WHALE_FLIP_WALL_RATIO`    | 0.5   | …but only with resting size of at least half the sweep behind it        |
| `WHALE_DEFENSE_WALL_RATIO` | 0.25  | Resting size behind the push must reach a quarter of it to boost        |

**Break.** `penetration ≥ 1` (the sweep traded the whole band) **and** the size still resting there
is smaller than the sweep's own net. Strength ×1.24.

**Absorbed.** Everything else in front of the sweep, scored 0..1:

```
absorption = 0.26 · proximity          // 1 at ≤0.25 ATR, 0 at ≥1.25 ATR
           + 0.15 · wallRatio          // resting size ÷ sweep size, capped at 2×
           + 0.14 · bucket · material  // zone bucket: strong 1, medium 0.7, weak 0.35
           + 0.14 · hold    · material // rest persistence, 0.5 while the window warms
           + 0.16 · conviction         // level strength, or 0.85 for a detected wall
           − 0.20 · penetration        // progress into the level is credited
```

where `wallRatio = resting notional ÷ |net|` and `material = min(1, wallRatio ÷ 0.5)`.

The `material` gate matters: zone buckets are **relative to the book's own texture**, so on a quiet
book a few thousand dollars can bucket as `strong`. Gating the bucket and hold terms on the size
being material against the sweep is what keeps dust from reading as a defense.

- `absorption ≥ 0.75` **and** `wallRatio ≥ 0.5` → **flip**: the vote is cast against the executed
  money at strength ×0.45, confidence −0.08, with a warning that says exactly that.
- otherwise → **damp**: strength × `clamp(1 − 0.8·absorption, 0.2, 1)`, confidence
  −(0.03 + 0.13·absorption), and the warning states the cut as a percentage.
- with no book at all the maximum reachable absorption is ~0.42, so **a chart level on its own can
  never flip a vote** — arguing against executed money requires resting size to argue with.

**Defended.** Only when the path ahead is open: `wallRatio ≥ 0.25` and the obstacle is a detected
wall or a `strong`/`medium` zone. Strength × `clamp(1.08 + 0.16·defense, 1, 1.24)`, where `defense`
blends the bucket (0.45), the size ratio (0.3) and the hold (0.25); confidence +0.06.

**Clear.** Multiplier 1, no adjustment, and a line naming the nearest obstacle and how far off it
is — silence is a measurement too.

## What the agent does with it

`analyzeWhale(flow, frame)` in `src/lib/market-agents.ts` keeps its detector half untouched —
direction from the sign of the net, conviction from tier, intensity and one-sidedness, phase
weighting — and applies the context on top:

```
strength = clamp(rawStrength × multiplier, 0, 1)
vote     = flip ? −direction : direction
score    = clamp(vote × strength × phaseWeight, −1, 1)
```

The level line is appended to the agent's reasons, its cautions are prepended to its warnings (so
the line that changed the call is the one the panel shows), and the numbers behind the verdict are
exposed as metrics: `levelVerdict`, `levelRole`, `levelSource`, `levelPrice`, `levelDistanceAtr`,
`levelWallNotional`, `levelBucket`, `levelWalls`, `levelPenetration`, `levelAbsorption`,
`levelMultiplier`, `levelFlip`, `levelBook`, plus `rawStrength` and the contextualized `strength`.
Flipped votes are graded by the journal and `learnFromOutcome` like any other vote, so the whale
agent's trust weights adapt to how its level reads actually turn out.

Demo mode, bar replay and any product without a level2 book simply run with `book: null`: the
classifier still reads the price-action levels and says out loud that no wall can confirm them.

## What it cannot tell you

- **Resting size is not a commitment.** A wall can be pulled or re-posted in the time it takes to
  read this; the book refreshes at 1 Hz against a 5 s sweep, so an eaten wall may still be reported
  for up to a second, and a fresh one may not be counted yet.
- **One venue, visible size only.** Coinbase level2 sees no hidden or iceberg intent, no other
  exchange, and nothing on-chain. "Absorbed" means _this book is currently resting more size in the
  path than the sweep brought_ — not _the sweep will fail_.
- **The level is a hypothesis.** SR zones and pivots are price-action reads; the book only measures
  how much of that hypothesis is currently funded.
- **A flip is a judgement, not a measurement.** It is the one place Atlas argues against executed
  money, which is why it is gated on absorption ≥ 0.75 _and_ resting size ≥ half the sweep, and why
  every flip carries a warning saying so.

## Where it lives

- `src/lib/whale-level-context.ts` — the pure classifier: obstacle selection, the absorption and
  defense scores, the verdicts, and the language. No state, no I/O.
- `src/lib/whale-level-context.test.ts` — unit tests over all four verdicts, both directions,
  wall-only obstacles, dust-vs-material size, penetration from the sweep's own fills, the
  wrong-side-of-price guard and the unwarmed persistence window.
- `src/lib/market-agents.ts` — `analyzeWhale` takes the frame, applies the multiplier/flip, and
  merges the reasons, warnings and metrics; `analyzeMarket` passes
  `{ price, atr, levels: levelStrength.summary, book: snapshot.book }`, all of which it already
  had in scope.
- `src/lib/market-agents.test.ts` — integration tests through `analyzeMarket`: a sweep flipped by a
  defended resistance, damped (never flipped) without a book, boosted through a broken level, and a
  sell sweep strengthened by the same wall that fades a buy.
- Reuses `scoreZone`, `PERSISTENCE_SECONDS` and the wall detection in `shared/order-book.ts`
  unchanged; no wire-format, server or UI contract moved.
