#!/usr/bin/env python3
"""Walk-forward research for Kalshi KXBTC15M using point-in-time BTC candles.

The script intentionally accepts external data paths instead of committing a large market
archive. Expected inputs:
  * Kalshi minute snapshots as JSONL, one row per market/minute. Required fields:
    ticker, ts, minute, y, block, marketMidpoint.
  * SQLite `spot_candles(open_ms, available_ms, close, source, raw_json)`, where raw_json is
    a Binance-compatible kline [open_ms, open, high, low, close, volume, ...].

Signals only use candles whose `available_ms <= decision ts`. Model selection uses train and
validation blocks; the test block is never used to choose a configuration.
"""
from __future__ import annotations

import argparse
import bisect
import collections
import datetime as dt
import json
import math
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean, median
from typing import Iterable, Optional

FEE_RATE = 0.07
CONTRACTS = 100
SLIPPAGE = 0.01  # midpoint-to-fill stress assumption on entry and an early exit
MIN_PRICE = 0.05


@dataclass(frozen=True)
class Bar:
    available_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class Snapshot:
    ticker: str
    ts: int
    minute: int
    result_up: bool
    block: str
    midpoint_up: float


@dataclass(frozen=True)
class Candidate:
    family: str
    timeframe: int
    config: str
    entry_minute: int
    max_entry: float
    target: float

    @property
    def name(self) -> str:
        return (
            f"{self.family}|{self.timeframe}m|{self.config}|m{self.entry_minute}"
            f"|cap{self.max_entry:.2f}|tp{self.target:.2f}"
        )


@dataclass
class Trade:
    ticker: str
    block: str
    side_up: bool
    result_up: bool
    minute: int
    entry_mid: float
    entry_fill: float
    exit_mid: float
    exit_fill: float
    exited_early: bool
    pnl: float
    cost: float


def ceil_cent(value: float) -> float:
    return math.ceil(value * 100 - 1e-10) / 100


def fee(count: int, price: float) -> float:
    return ceil_cent(FEE_RATE * count * price * (1 - price))


def load_spot(path: Path) -> list[Bar]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    rows = conn.execute(
        "SELECT available_ms, close, raw_json FROM spot_candles ORDER BY available_ms"
    )
    bars: list[Bar] = []
    for available_ms, fallback_close, raw in rows:
        try:
            k = json.loads(raw)
            bars.append(
                Bar(
                    int(available_ms),
                    float(k[1]),
                    float(k[2]),
                    float(k[3]),
                    float(k[4]),
                    float(k[5]),
                )
            )
        except (ValueError, TypeError, IndexError, json.JSONDecodeError):
            c = float(fallback_close)
            bars.append(Bar(int(available_ms), c, c, c, c, 0.0))
    conn.close()
    if not bars:
        raise ValueError("spot_candles is empty")
    return bars


def aggregate(bars: list[Bar], minutes: int) -> list[Bar]:
    if minutes == 1:
        return bars
    period = minutes * 60_000
    grouped: dict[int, list[Bar]] = collections.defaultdict(list)
    for bar in bars:
        # available_ms is the close/availability boundary; assign it to the bar that just ended.
        bucket_end = ((bar.available_ms - 1) // period + 1) * period
        grouped[bucket_end].append(bar)
    result = []
    for end in sorted(grouped):
        group = grouped[end]
        # Never manufacture a "complete" higher-timeframe bar from a data gap.
        if len(group) != minutes or group[-1].available_ms > end:
            continue
        result.append(
            Bar(
                end,
                group[0].open,
                max(x.high for x in group),
                min(x.low for x in group),
                group[-1].close,
                sum(x.volume for x in group),
            )
        )
    return result


def ema(values: list[float], period: int) -> list[Optional[float]]:
    out: list[Optional[float]] = [None] * len(values)
    if len(values) < period:
        return out
    seed = mean(values[:period])
    out[period - 1] = seed
    alpha = 2 / (period + 1)
    previous = seed
    for i in range(period, len(values)):
        previous = values[i] * alpha + previous * (1 - alpha)
        out[i] = previous
    return out


def rsi(values: list[float], period: int) -> list[Optional[float]]:
    out: list[Optional[float]] = [None] * len(values)
    if len(values) <= period:
        return out
    gains = [max(0.0, values[i] - values[i - 1]) for i in range(1, len(values))]
    losses = [max(0.0, values[i - 1] - values[i]) for i in range(1, len(values))]
    avg_gain, avg_loss = mean(gains[:period]), mean(losses[:period])
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period + 1, len(values)):
        avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def macd(values: list[float], fast: int, slow: int, signal: int):
    fast_line, slow_line = ema(values, fast), ema(values, slow)
    line: list[Optional[float]] = [None] * len(values)
    valid_values, valid_indices = [], []
    for i, (f, s) in enumerate(zip(fast_line, slow_line)):
        if f is not None and s is not None:
            line[i] = f - s
            valid_values.append(f - s)
            valid_indices.append(i)
    signal_compact = ema(valid_values, signal)
    signal_line: list[Optional[float]] = [None] * len(values)
    for idx, value in zip(valid_indices, signal_compact):
        signal_line[idx] = value
    return line, signal_line


def atr(bars: list[Bar], period: int = 14) -> list[Optional[float]]:
    out: list[Optional[float]] = [None] * len(bars)
    if len(bars) <= period:
        return out
    tr = []
    for i, bar in enumerate(bars):
        previous = bars[i - 1].close if i else bar.open
        tr.append(max(bar.high - bar.low, abs(bar.high - previous), abs(bar.low - previous)))
    value = mean(tr[1 : period + 1])
    out[period] = value
    for i in range(period + 1, len(bars)):
        value = (value * (period - 1) + tr[i]) / period
        out[i] = value
    return out


def load_snapshots(path: Path) -> tuple[list[Snapshot], dict[str, list[Snapshot]]]:
    rows: list[Snapshot] = []
    by_ticker: dict[str, list[Snapshot]] = collections.defaultdict(list)
    with path.open() as handle:
        for line in handle:
            raw = json.loads(line)
            mid = raw.get("marketMidpoint")
            if mid is None or not (0 < float(mid) < 1):
                continue
            row = Snapshot(
                str(raw["ticker"]),
                int(raw["ts"]),
                int(raw["minute"]),
                bool(raw["y"]),
                str(raw["block"]),
                float(mid),
            )
            rows.append(row)
            by_ticker[row.ticker].append(row)
    for ticker in by_ticker:
        by_ticker[ticker].sort(key=lambda x: x.ts)
    return rows, by_ticker


class Features:
    def __init__(self, bars_by_tf: dict[int, list[Bar]]):
        self.frames = {}
        for timeframe, bars in bars_by_tf.items():
            close = [x.close for x in bars]
            indicators = {f"rsi{p}": rsi(close, p) for p in (7, 14, 21)}
            for fast, slow, sig in ((5, 13, 4), (8, 21, 5), (12, 26, 9)):
                line, signal_line = macd(close, fast, slow, sig)
                indicators[f"macd{fast}-{slow}-{sig}"] = (line, signal_line)
            indicators["atr"] = atr(bars)
            self.frames[timeframe] = {
                "bars": bars,
                "times": [x.available_ms for x in bars],
                "indicators": indicators,
            }

    def index(self, timeframe: int, ts: int) -> int:
        return bisect.bisect_right(self.frames[timeframe]["times"], ts) - 1

    def signal(self, family: str, timeframe: int, config: str, ts: int) -> Optional[bool]:
        frame = self.frames[timeframe]
        bars: list[Bar] = frame["bars"]
        i = self.index(timeframe, ts)
        if i < 2:
            return None
        ind = frame["indicators"]

        if family in ("rsi-reversal", "rsi-momentum"):
            period, low, high = (int(x) for x in config.split("-"))
            value = ind[f"rsi{period}"][i]
            if value is None:
                return None
            if family == "rsi-reversal":
                return True if value <= low else False if value >= high else None
            return False if value <= low else True if value >= high else None

        if family in ("macd", "macd-thrust"):
            line, signal_line = ind[f"macd{config}"]
            if line[i] is None or signal_line[i] is None:
                return None
            histogram = line[i] - signal_line[i]
            if family == "macd-thrust":
                if line[i - 1] is None or signal_line[i - 1] is None:
                    return None
                previous = line[i - 1] - signal_line[i - 1]
                if histogram > 0 and histogram > previous:
                    return True
                if histogram < 0 and histogram < previous:
                    return False
                return None
            return histogram > 0

        if family == "sr-bounce":
            lookback, max_atr = config.split("-")
            lookback, max_atr = int(lookback), float(max_atr)
            current_atr = ind["atr"][i]
            if current_atr is None or current_atr <= 0 or i < lookback:
                return None
            # Levels end at i-1: no current-bar look-ahead.
            history = bars[i - lookback : i]
            support = min(x.low for x in history)
            resistance = max(x.high for x in history)
            ds = abs(bars[i].close - support) / current_atr
            dr = abs(resistance - bars[i].close) / current_atr
            if ds <= max_atr and ds < dr:
                return True
            if dr <= max_atr and dr < ds:
                return False
            return None

        if family.startswith("ensemble-"):
            # Fixed components make the ablation interpretable rather than adding another grid.
            votes = []
            component_names = family.removeprefix("ensemble-").split("+")
            if "rsi" in component_names:
                votes.append(self.signal("rsi-reversal", timeframe, "14-35-65", ts))
            if "macd" in component_names:
                votes.append(self.signal("macd-thrust", timeframe, "8-21-5", ts))
            if "sr" in component_names:
                votes.append(self.signal("sr-bounce", timeframe, "20-0.5", ts))
            usable = [x for x in votes if x is not None]
            needed = 2 if len(component_names) >= 3 else len(component_names)
            if len(usable) < needed or len(set(usable)) != 1:
                return None
            return usable[0]

        raise ValueError(f"Unknown family: {family}")


def candidate_grid() -> Iterable[Candidate]:
    configs = {
        "rsi-reversal": ["7-30-70", "7-35-65", "14-30-70", "14-35-65", "21-35-65"],
        "rsi-momentum": ["7-40-60", "7-45-55", "14-40-60", "14-45-55"],
        "macd": ["5-13-4", "8-21-5", "12-26-9"],
        "macd-thrust": ["5-13-4", "8-21-5", "12-26-9"],
        "sr-bounce": ["20-0.25", "20-0.5", "50-0.25", "50-0.5"],
        "ensemble-rsi+macd": ["fixed"],
        "ensemble-macd+sr": ["fixed"],
        "ensemble-rsi+macd+sr": ["fixed"],
    }
    for family, family_configs in configs.items():
        for timeframe in (1, 3, 5, 15):
            for config in family_configs:
                for minute in (1, 2, 3, 4, 8, 12):
                    for cap in (0.35, 0.40, 0.45, 0.50):
                        for target in (0.0, 0.10, 0.20):
                            yield Candidate(family, timeframe, config, minute, cap, target)


def make_trade(
    candidate: Candidate,
    row: Snapshot,
    side_up: bool,
    path: list[Snapshot],
) -> Optional[Trade]:
    side_mid = row.midpoint_up if side_up else 1 - row.midpoint_up
    if side_mid < MIN_PRICE or side_mid > candidate.max_entry:
        return None
    entry = min(0.99, side_mid + SLIPPAGE)
    entry_cost = CONTRACTS * entry + fee(CONTRACTS, entry)
    exited_early = False
    exit_mid = 1.0 if side_up == row.result_up else 0.0
    exit_fill = exit_mid
    payout = CONTRACTS * exit_mid
    if candidate.target > 0:
        for later in path:
            if later.ts <= row.ts:
                continue
            later_mid = later.midpoint_up if side_up else 1 - later.midpoint_up
            if later_mid >= side_mid + candidate.target:
                exit_mid = later_mid
                exit_fill = max(0.01, later_mid - SLIPPAGE)
                payout = CONTRACTS * exit_fill - fee(CONTRACTS, exit_fill)
                exited_early = True
                break
    return Trade(
        row.ticker,
        row.block,
        side_up,
        row.result_up,
        row.minute,
        side_mid,
        entry,
        exit_mid,
        exit_fill,
        exited_early,
        payout - entry_cost,
        entry_cost,
    )


def metrics(trades: list[Trade]) -> dict:
    if not trades:
        return {"n": 0, "pnl": 0.0, "roi": 0.0, "win_rate": 0.0, "profit_factor": 0.0}
    pnl = sum(x.pnl for x in trades)
    gains = sum(max(0, x.pnl) for x in trades)
    losses = -sum(min(0, x.pnl) for x in trades)
    return {
        "n": len(trades),
        "pnl": round(pnl, 2),
        "pnl_per_trade": round(pnl / len(trades), 4),
        "roi": round(pnl / sum(x.cost for x in trades), 6),
        "win_rate": round(sum(x.pnl > 0 for x in trades) / len(trades), 6),
        "direction_accuracy": round(sum(x.side_up == x.result_up for x in trades) / len(trades), 6),
        "avg_entry_probability": round(mean(x.entry_mid for x in trades), 4),
        "median_entry_probability": round(median(x.entry_mid for x in trades), 4),
        "early_exit_rate": round(sum(x.exited_early for x in trades) / len(trades), 6),
        "profit_factor": round(gains / losses, 4) if losses else 999.0,
    }


def evaluate(candidate: Candidate, features: Features, rows, paths) -> list[Trade]:
    result = []
    for row in rows:
        if row.minute != candidate.entry_minute:
            continue
        side = features.signal(candidate.family, candidate.timeframe, candidate.config, row.ts)
        if side is None:
            continue
        trade = make_trade(candidate, row, side, paths[row.ticker])
        if trade:
            result.append(trade)
    return result


def bootstrap_interval(trades: list[Trade], rounds: int = 2000) -> list[float]:
    # Deterministic xorshift avoids a dependency and makes the report reproducible.
    if not trades:
        return [0.0, 0.0]
    state = 0xA17C9E21
    values = []
    n = len(trades)
    for _ in range(rounds):
        total = 0.0
        for _ in range(n):
            state ^= (state << 13) & 0xFFFFFFFF
            state ^= state >> 17
            state ^= (state << 5) & 0xFFFFFFFF
            total += trades[state % n].pnl
        values.append(total / n)
    values.sort()
    return [round(values[int(rounds * 0.025)], 4), round(values[int(rounds * 0.975)], 4)]


def markdown(report: dict) -> str:
    winner = report["selected_strategy"]
    test = winner["test"]
    lines = [
        "# Kalshi BTC 15-minute strategy research",
        "",
        f"Generated: {report['generated_at']}",
        "",
        f"Sample: **{report['sample']['markets']:,} KXBTC15M markets**, "
        f"{report['sample']['start']} through {report['sample']['end']} UTC.",
        "",
        "## Bottom line",
        "",
        f"The train/validation-selected configuration was **{winner['candidate']['family']}** on "
        f"**{winner['candidate']['timeframe']}m BTC candles**, config "
        f"`{winner['candidate']['config']}`, entering at minute **{winner['candidate']['entry_minute']}** "
        f"only when the predicted side cost no more than **{winner['candidate']['max_entry']:.0%}**. "
        + (
            f"It took profit after a **{winner['candidate']['target']:.0%}** probability rise."
            if winner['candidate']['target']
            else "It held through settlement."
        ),
        "",
        f"On the untouched test block it made **${test['pnl']:,.2f}** across "
        f"{test['n']:,} simulated 100-contract entries ({test['roi']:.2%} ROI on deployed cost; "
        f"{test['direction_accuracy']:.1%} directional accuracy). The bootstrapped 95% interval for "
        f"mean P&L per 100-contract trade was **${winner['test_mean_pnl_95ci'][0]:.2f} to "
        f"${winner['test_mean_pnl_95ci'][1]:.2f}**. Because that interval includes zero, this is a "
        f"**promising but statistically inconclusive** result—not a demonstrated edge.",
        "",
        "This is a historical midpoint simulation, **not proof of executable profit**. Entry and early-exit "
        "fills are stressed by 1¢ on each side and use the 7% × p × (1−p) taker-fee coefficient, but "
        "historical queue position and full depth are unavailable.",
        "",
        "## Selected strategy by split",
        "",
        "| Split | Trades | P&L / trade | ROI | Direction | Avg entry | Early exits |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for split in ("train", "validation", "test"):
        m = winner[split]
        lines.append(
            f"| {split.title()} | {m['n']:,} | ${m.get('pnl_per_trade', 0):.2f} | "
            f"{m['roi']:.2%} | {m.get('direction_accuracy', 0):.1%} | "
            f"{m.get('avg_entry_probability', 0):.1%} | {m.get('early_exit_rate', 0):.1%} |"
        )
    lines += [
        "",
        "## What each instrument contributed",
        "",
        "- **BTC candles:** point-in-time OHLCV; only bars already closed and available at the decision timestamp were used.",
        "- **RSI:** Wilder RSI periods 7/14/21 were tested as reversal and momentum rules.",
        "- **MACD:** 5/13/4, 8/21/5, and 12/26/9 were tested, both sign and histogram-thrust variants.",
        "- **Support/resistance:** prior 20/50-bar highs and lows, gated at 0.25/0.50 ATR(14), were tested.",
        "- **Kalshi price:** the predicted UP or DOWN side had to be a low-priced contract at entry; this is the lower-% to higher-% setup.",
        "- **Kalshi order book:** not claimed. The archive contains minute midpoint snapshots, not queue-aware historical L2.",
        "- **BTC order book:** not used. A sufficiently long point-in-time L2 archive aligned to this sample was unavailable.",
        "",
        "## Family comparison on untouched test data",
        "",
        "These rows use one train/validation-selected configuration per family; the test block did not choose them.",
        "",
        "| Family | Configuration | Trades | P&L / trade | ROI | Direction |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for item in report["family_winners"]:
        c, m = item["candidate"], item["test"]
        lines.append(
            f"| {c['family']} | {c['timeframe']}m, `{c['config']}`, m{c['entry_minute']}, "
            f"cap {c['max_entry']:.0%}, tp {c['target']:.0%} | {m['n']:,} | "
            f"${m.get('pnl_per_trade', 0):.2f} | {m['roi']:.2%} | "
            f"{m.get('direction_accuracy', 0):.1%} |"
        )
    lines += [
        "",
        "## Data provenance and reproduction",
        "",
        "The analysis used the public research archive in "
        "[SudoAptInstallMyBalls/Kalshi-Bot-Beta](https://github.com/SudoAptInstallMyBalls/Kalshi-Bot-Beta) "
        "at commit `9801a9b85e1332b31feddf481fc28971d1b5aae4`: "
        "`BTC-forecasts.jsonl` supplies point-in-time Kalshi midpoints/outcomes and "
        "`BTC/spot.sqlite` supplies Binance BTCUSDT one-minute candles. The raw archive is not copied "
        "into this repository. Results can be regenerated after cloning that archive with:",
        "",
        "```bash",
        "python scripts/analyze-kalshi-btc15m.py \\",
        "  --forecasts /path/to/BTC-forecasts.jsonl \\",
        "  --spot-db /path/to/BTC/spot.sqlite",
        "```",
        "",
        "The observations were sanity-checked for timestamp ordering, market count, probability bounds, "
        "and whole-market chronological splits, but are third-party archived observations rather than a "
        "first-party certified Kalshi research export.",
        "",
        "## Method and guardrails",
        "",
        "1. The supplied chronological `train`, `validation`, and `test` labels were preserved.",
        "2. Configurations needed at least 100 train trades and 50 validation trades.",
        "3. Within each family, train ROI first reduced the search to its top five configurations; validation ROI selected one. The global winner was selected from family winners by validation ROI.",
        "4. The test split was opened only after selection. No indicator sees a candle before its recorded availability timestamp; support/resistance excludes the current bar.",
        "5. Each simulated order buys 100 contracts at side midpoint +1¢. Settlement pays $100 if correct. A configured probability target exits at later midpoint −1¢. Taker fees are rounded up to cents per order.",
        "6. P&L is not compounded and no martingale/Kelly sizing is used.",
        "",
        "## Limitations",
        "",
        "- Midpoint is not an executable ask. Even the 1¢ stress may be too optimistic in fast markets.",
        "- Full Kalshi/BTC order books, latency, queue priority, partial fills, outages, and taxes are absent.",
        "- BTC candles are Binance BTCUSDT while Kalshi settles from 60 one-second CF Benchmarks BRTI observations; basis can flip close outcomes.",
        "- Multiple configurations were searched. The chronological holdout reduces overfitting but does not eliminate it; forward paper trading is required.",
        "- A profitable backtest is not investment advice or a guarantee of future profit.",
        "",
        "## Practical rule to paper-test",
        "",
        f"At minute {winner['candidate']['entry_minute']} of a KXBTC15M window, compute the selected "
        f"{winner['candidate']['family']} signal on completed {winner['candidate']['timeframe']}m candles "
        f"using `{winner['candidate']['config']}`. Select UP or DOWN only when the signal is decisive and "
        f"that side's executable ask is ≤{winner['candidate']['max_entry']:.0%}. "
        + (
            f"Offer out after a {winner['candidate']['target']:.0%} increase in contract probability; otherwise hold to settlement."
            if winner['candidate']['target']
            else "Hold to settlement."
        )
        + " Skip the window if any input is stale or the spread/depth cannot support the intended size.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--forecasts", type=Path, required=True)
    parser.add_argument("--spot-db", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, default=Path("docs/kalshi-btc15m-results.json"))
    parser.add_argument("--report-out", type=Path, default=Path("docs/kalshi-btc15m-strategy.md"))
    args = parser.parse_args()

    spot = load_spot(args.spot_db)
    features = Features({tf: aggregate(spot, tf) for tf in (1, 3, 5, 15)})
    rows, paths = load_snapshots(args.forecasts)
    print(f"Loaded {len(rows):,} snapshots across {len(paths):,} markets")

    scored = []
    total = 0
    for candidate in candidate_grid():
        total += 1
        trades = evaluate(candidate, features, rows, paths)
        grouped = {block: [x for x in trades if x.block == block] for block in ("train", "validation", "test")}
        train, validation = metrics(grouped["train"]), metrics(grouped["validation"])
        if train["n"] < 100 or validation["n"] < 50:
            continue
        scored.append((candidate, grouped, train, validation))
    print(f"Evaluated {total:,} configurations; {len(scored):,} passed sample floors")

    family_winners = []
    for family in sorted(set(x[0].family for x in scored)):
        pool = [x for x in scored if x[0].family == family]
        train_top = sorted(pool, key=lambda x: (x[2]["roi"], x[2]["n"]), reverse=True)[:5]
        selected = max(train_top, key=lambda x: (x[3]["roi"], x[3]["n"]))
        candidate, grouped, train_m, validation_m = selected
        family_winners.append(
            {
                "candidate": asdict(candidate),
                "train": train_m,
                "validation": validation_m,
                "test": metrics(grouped["test"]),
                "_trades": grouped,
            }
        )
    if not family_winners:
        raise RuntimeError("No configuration met the minimum sample sizes")
    winner = max(family_winners, key=lambda x: (x["validation"]["roi"], x["validation"]["n"]))
    winner["test_mean_pnl_95ci"] = bootstrap_interval(winner["_trades"]["test"])

    ts_values = [x.ts for x in rows]
    report = {
        "generated_at": dt.datetime.now(dt.UTC).isoformat(),
        "assumptions": {
            "contracts_per_trade": CONTRACTS,
            "midpoint_slippage_each_leg": SLIPPAGE,
            "taker_fee_rate": FEE_RATE,
            "minimum_entry_probability": MIN_PRICE,
            "selection": "top five train ROI per family, then validation ROI; test untouched",
        },
        "sample": {
            "snapshots": len(rows),
            "markets": len(paths),
            "start": dt.datetime.fromtimestamp(min(ts_values) / 1000, dt.UTC).isoformat(),
            "end": dt.datetime.fromtimestamp(max(ts_values) / 1000, dt.UTC).isoformat(),
            "blocks": dict(collections.Counter(x.block for x in rows)),
        },
        "selected_strategy": {k: v for k, v in winner.items() if k != "_trades"},
        "family_winners": [
            {k: v for k, v in item.items() if k != "_trades"}
            for item in sorted(family_winners, key=lambda x: x["test"]["roi"], reverse=True)
        ],
    }
    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.write_text(json.dumps(report, indent=2) + "\n")
    args.report_out.write_text(markdown(report))
    print(f"Selected: {Candidate(**report['selected_strategy']['candidate']).name}")
    print(json.dumps(report["selected_strategy"]["test"], indent=2))
    print(f"Wrote {args.report_out} and {args.json_out}")


if __name__ == "__main__":
    main()
