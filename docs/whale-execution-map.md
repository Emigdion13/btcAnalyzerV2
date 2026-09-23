# Whale execution map

Atlas now shows the **price where a detected large sweep actually filled**. This is the missing half
of the order-book readout:

- **Executed price map:** Coinbase `matches` are the tape. For the live five-second whale window,
  Atlas calculates a size-weighted execution price (**VWAP**) from every directional fill and
  shows the lowest and highest fill as the execution range. The largest recent fills are listed
  with their exact price and signed USD notional.
- **Chart guides:** while the sweep is live (or briefly fading), the chart draws a solid VWAP line,
  dotted range boundaries, and a few faint guides at the latest large-fill prices. They disappear
  with the transient sweep; they are not historical support or resistance.
- **Resting level2 map:** the separate Book panel and chart walls show bids and asks that are still
  waiting on Coinbase. Those levels are possible future liquidity, not executed money. A wall can
  be cancelled before price reaches it.

## What the direction means

Coinbase's `match.side` identifies the **maker** order. Atlas inverts it to report the aggressor:

- `BUY` / positive notional means a taker lifted resting asks — money crossed upward into the book.
- `SELL` / negative notional means a taker hit resting bids — money crossed downward out of the book.

This is venue-local executed flow. It cannot identify the wallet or person behind the fills, prove
that all fills came from one whale, see hidden or iceberg size, or see Binance, Kraken, OTC, custody
transfers, or on-chain deposits. The detector groups unusually large directional flow; it does not
claim to identify an individual whale.

## How to read the two layers together

1. A **BUY execution map** near a defended bid wall can show where aggressive buying was absorbed or
   bounced. A **SELL map** near a defended ask wall can show the mirror image.
2. If execution prints walk through a level and the level2 size disappears, the tape confirms that
   resting liquidity was consumed. If the size remains, the move may be meeting absorption.
3. A large wall without a matching execution map is only an intention/advertised-liquidity clue;
   a large execution map without a remaining wall is already executed impact. Neither is a forecast.

The UI deliberately keeps the sweep transient. Once the five-second window and short fade expire,
Atlas removes the number and chart guides rather than leaving a stale execution price on screen.
The current candle and the execution map are provisional exchange data, not a trading signal or
investment advice.
