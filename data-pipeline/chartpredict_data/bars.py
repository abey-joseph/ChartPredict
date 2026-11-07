"""Bar types and session helpers.

A raw bar is (ts, open, high, low, close, volume) where ts is a UTC unix timestamp
(seconds, bar open time) and prices are decimal strings exactly as Longbridge returned them.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from . import config

NY = ZoneInfo("America/New_York")

RawBar = tuple[int, str, str, str, str, int]


@dataclass(frozen=True)
class Bar:
    t: int          # UTC unix seconds, bar open
    o: float
    h: float
    l: float
    c: float
    v: int
    filled: bool = False   # synthesised because the minute was missing

    def as_list(self) -> list:
        return [self.t, self.o, self.h, self.l, self.c, self.v]


def bar_from_raw(r: RawBar) -> Bar:
    return Bar(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), int(r[5]))


def session_open_ts(day: date) -> int:
    return int(datetime.combine(day, time(9, 30), NY).timestamp())


def minute_index(ts: int, day: date) -> int:
    return (ts - session_open_ts(day)) // 60


def daily_ts(day: date) -> int:
    """Daily candles are keyed by 00:00 UTC of the trading date (chart 'business day')."""
    return int(datetime.combine(day, time(0, 0), timezone.utc).timestamp())


def et_label(day: date, minute: int) -> str:
    t = datetime.combine(day, time(9, 30)) + timedelta(minutes=minute)
    return t.strftime("%H:%M")


@dataclass
class Session:
    """One regular session of one symbol, normalised to a dense list of minute bars."""
    day: date
    length: int            # 390 normally, 210 on early-close days
    bars: list[Bar]        # len == length
    missing: int           # how many minutes had to be filled

    @property
    def completeness(self) -> float:
        return 1 - self.missing / self.length


def build_session(day: date, raw: list[RawBar]) -> Session | None:
    """Place bars by minute index, detect early close, forward-fill missing minutes."""
    if not raw:
        return None
    by_idx: dict[int, Bar] = {}
    for r in raw:
        b = bar_from_raw(r)
        i = minute_index(b.t, day)
        if 0 <= i < config.FULL_SESSION:
            by_idx[i] = b
    if not by_idx:
        return None
    last = max(by_idx)
    # an early-close day has nothing after 12:59; allow a little slack for sparse data
    length = config.HALF_SESSION if last < config.HALF_SESSION + 30 else config.FULL_SESSION
    open_ts = session_open_ts(day)
    bars: list[Bar] = []
    missing = 0
    prev_close: float | None = None
    first = min(by_idx)
    for i in range(length):
        b = by_idx.get(i)
        if b is None:
            missing += 1
            ref = prev_close if prev_close is not None else by_idx[first].o
            b = Bar(open_ts + 60 * i, ref, ref, ref, ref, 0, filled=True)
        bars.append(b)
        prev_close = b.c
    return Session(day, length, bars, missing)
