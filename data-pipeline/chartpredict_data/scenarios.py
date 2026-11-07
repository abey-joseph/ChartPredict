"""Turn a sampled (symbol, day, start) into a scenario: warm-up, window, reveal, tags."""
from __future__ import annotations

import hashlib
from datetime import date

from . import config
from .bars import Bar, Session, daily_ts, et_label


# ---------------------------------------------------------------- tags
def best_long_pct(window: list[Bar]) -> float:
    """Best possible long: buy at a bar's low, sell at the high of a LATER bar.

    Same-bar low->high is excluded because the order inside a bar is unknown.
    """
    best = 0.0
    lo = window[0].l
    for b in window[1:]:
        best = max(best, (b.h - lo) / lo * 100)
        lo = min(lo, b.l)
    return best


def best_short_pct(window: list[Bar]) -> float:
    best = 0.0
    hi = window[0].h
    for b in window[1:]:
        best = max(best, (hi - b.l) / hi * 100)
        hi = max(hi, b.h)
    return best


def tags_for(window: list[Bar], session_length: int, start: int,
             day_open: float, prior_close: float | None) -> dict:
    start_px = window[0].o
    hi = max(b.h for b in window)
    lo = min(b.l for b in window)
    end_px = window[-1].c
    path = 0.0
    prev = start_px
    for b in window:
        path += abs(b.c - prev)
        prev = b.c
    net = end_px - start_px
    range_pct = (hi - lo) / start_px * 100
    efficiency = abs(net) / path if path > 0 else 0.0

    if range_pct < config.FLAT_RANGE_PCT:
        kind = "flat"
    elif efficiency >= config.TREND_EFFICIENCY:
        kind = "trend"
    else:
        kind = "choppy"

    if start < config.OPEN_BUCKET_END:
        bucket = "open"
    elif start >= session_length - config.CLOSE_BUCKET_LEN:
        bucket = "close"
    else:
        bucket = "midday"

    gap_pct = None if not prior_close else (day_open - prior_close) / prior_close * 100
    bl, bs = best_long_pct(window), best_short_pct(window)
    return {
        "timeBucket": bucket,
        "rangePct": round(range_pct, 4),
        "netMovePct": round(net / start_px * 100, 4),
        "efficiency": round(efficiency, 4),
        "type": kind,
        "gapDay": bool(gap_pct is not None and abs(gap_pct) > config.GAP_DAY_PCT),
        "gapPct": None if gap_pct is None else round(gap_pct, 4),
        "bestLongPct": round(bl, 4),
        "bestShortPct": round(bs, 4),
        "hadTradeableMove": max(bl, bs) - config.FEE_PCT > config.TRADEABLE_PCT,
    }


# ---------------------------------------------------------------- assembly
def scenario_id(symbol: str, day: date, start: int, seed: int = config.SEED) -> str:
    return hashlib.sha1(f"{seed}|{symbol}|{day}|{start}".encode()).hexdigest()[:10]


def build_scenario(
    symbol: str,
    session: Session,
    start: int,
    prev_session: Session | None,
    daily_before: list[tuple],       # completed daily rows before the day, oldest first
    day_daily: tuple | None,         # the scenario day's own daily row (for its open)
) -> dict:
    W, WU, RV = config.WINDOW, config.WARMUP, config.REVEAL
    bars = session.bars
    window = bars[start:start + W]
    assert len(window) == W

    today_warm = bars[max(0, start - WU):start]
    need_prev = WU - len(today_warm)
    prev_warm = prev_session.bars[-need_prev:] if (need_prev and prev_session) else []
    warmup = prev_warm + today_warm
    session_break = len(prev_warm) if prev_warm else None   # index in warmup where today starts

    reveal = bars[start + W:min(start + W + RV, session.length)]

    prior_close = float(daily_before[-1][4]) if daily_before else (
        prev_session.bars[-1].c if prev_session else None)
    day_open = float(day_daily[1]) if day_daily else bars[0].o

    tags = tags_for(window, session.length, start, day_open, prior_close)

    daily = [[daily_ts(date.fromisoformat(r[0])), float(r[1]), float(r[2]), float(r[3]),
              float(r[4]), int(r[5])] for r in daily_before[-config.DAILY_CONTEXT:]]

    sid = scenario_id(symbol, session.day, start)
    filled = sum(b.filled for b in warmup + window + reveal)
    scenario = {
        "id": sid,
        "symbol": symbol,
        "name": config.NAMES[symbol],
        "group": config.GROUPS[symbol],
        "date": session.day.isoformat(),
        "startET": et_label(session.day, start),
        "endET": et_label(session.day, start + W),
        "sessionCloseET": et_label(session.day, session.length),
        "startPrice": window[0].o,
        "priorClose": prior_close,
        "dayOpen": day_open,
        # bars are [unixSecondsUTC, open, high, low, close, volume]
        "warmup": [b.as_list() for b in warmup],
        "sessionBreak": session_break,
        "prevSessionDate": prev_session.day.isoformat() if prev_warm else None,
        "window": [b.as_list() for b in window],
        "reveal": [b.as_list() for b in reveal],
        "daily": daily,
        "filledBars": filled,
        "tags": tags,
    }
    return scenario


def index_entry(s: dict) -> dict:
    """What the picker sees: no date, no prices, no times."""
    return {"id": s["id"], "symbol": s["symbol"], "group": s["group"], **{
        k: v for k, v in s["tags"].items() if k != "gapPct"}}
