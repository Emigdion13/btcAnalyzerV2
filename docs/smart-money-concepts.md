# Smart Money Concepts · Atlas implementation notes

Atlas provides a native, **independent** Smart Money Concepts (SMC) overlay. It is not a Pine Script port, does not include another publisher’s source code, and must not be represented as an exact vendor clone. The terms _BOS_, _CHoCH_, _order block_, _fair value gap_, and _premium/discount_ describe commonly used price-action ideas; their precise rules vary among platforms and traders.

## Starting profile

A new workspace includes the overlay. The defaults were selected to match the familiar configuration requested for this workspace:

| Setting                                      | Default               |
| -------------------------------------------- | --------------------- |
| Mode / style                                 | Historical / Colored  |
| Internal bullish / bearish / label           | All / All / Tiny      |
| Swing bullish / bearish / label              | All / All / Small     |
| Swing length                                 | 50                    |
| Internal / swing order-block capacity        | 5 / 5                 |
| Block filter / mitigation                    | Atr / High/Low        |
| Equal-level confirmation / threshold / label | 3 / 0.1 / Tiny        |
| FVG timeframe / extension                    | Active chart / 1 bar  |
| Daily / weekly / monthly line styles         | Solid / Solid / Solid |

Booleans that do not appear in the compact parameter summary are intentionally stored too: every markup layer (internal/swing structure, swing points, strong/weak highs/lows, both order-block sets, equal highs/lows, fair value gaps, daily/weekly/monthly levels, premium/discount) begins enabled so the first paint resembles the familiar full overlay. Only candle recoloring and the confluence filter begin disabled.

## Calculation contract

Structure, pivots, order blocks, equal levels, prior D/W/M levels, and premium/discount ranges use the loaded chart OHLCV series, oldest to newest. Fair-value gaps use that same series by default, or the selected native FVG source timeframe when configured. No synthetic candles or resampled source bars are introduced.

### Pivots and structure

- A swing high is strictly higher than every high in the configured number of bars before **and** after it; a swing low is strictly lower than every low over the equivalent symmetric window.
- A pivot becomes available only after its right-side confirmation bars. Consequently, its label is delayed by that confirmation period rather than known in advance.
- Internal pivots use a fixed three-bar confirmation window for a faster structural rhythm.
- A candle **close** above an unbroken confirmed high produces a bullish break; a close below an unbroken confirmed low produces a bearish break.
- A break that goes against the established structure direction is labelled **CHoCH**. A break that continues its direction (or establishes the first direction) is labelled **BOS**.
- The optional internal confluence filter requires a bullish breaking candle to close bullishly in its upper half, and a bearish breaking candle to close bearishly in its lower half.

Internal breaks are dashed and swing breaks are solid. The `All`, `BOS`, and `CHoCH` controls independently filter bullish and bearish labels for each layer.

### Order blocks

On a structure break, Atlas searches backward from the break to the associated pivot for the latest opposite-color candle. Candidates with a range greater than twice the selected filter are skipped. `Atr` uses a short Wilder-like true-range average; `Cumulative Mean Range` uses the running mean candle range.

A bullish block spans the selected bearish candle’s high-to-low range; a bearish block spans the selected bullish candle’s high-to-low range. A return into a block is evaluated with either wick high/low or close, as selected. A traversal beyond the far side invalidates the block and removes it. When enabled, a mitigated—but not invalidated—block is dimmed. The requested count limits the newest active blocks in each category.

### Equal levels, FVGs, and range zones

- Equal highs/lows compare consecutive confirmed pivots using `abs(level A − level B) <= ATR × threshold`.
- A bullish fair value gap is a three-candle imbalance where the third low is above the first high and the middle candle is bullish. A bearish gap is the inverse. Auto threshold hides gaps under ten percent of local ATR. Gaps extend the configured number of bars in their selected source timeframe and dim after filling.
- Daily, weekly, and monthly high/low controls draw the prior completed calendar bucket’s range across the next bucket. Weekly buckets start Monday, UTC.
- Premium / equilibrium / discount zones divide the range between the latest confirmed swing high and low into upper 47.5%, middle 5%, and lower 47.5% bands.

## Display behavior and limitations

`Historical` retains a capped recent set of annotations to avoid creating hundreds of SVG nodes on a live chart. `Present` retains only the latest relevant annotation for each direction/type. Both still calculate the full currently loaded history to establish structure and current trend.

The FVG timeframe defaults to the active chart and can instead use one of Atlas's eight native candle timeframes. Changing it requests a separate native OHLCV feed; Atlas does not silently resample a partial chart series. During replay, only alternate-timeframe candles that had closed by the replay cursor are considered.

Different exchanges, sessions, OHLC data, pivot rules, update cadence, settings, and chart history produce different levels. The overlay is an analysis aid only: it does not place orders, generate certified signals, or provide investment advice.
