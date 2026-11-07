"""Fake data source for tests and `build.py --demo` (no network, no credentials).

Generates a weekday calendar with a few holidays/early closes and random-walk minute bars.
Output from this source is NOT real market data and is never written to public/.
"""
from __future__ import annotations

import math
import random
from datetime import date, datetime, time, timedelta

from .bars import NY, RawBar

HOLIDAYS = {date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4), date(2025, 9, 1),
            date(2025, 11, 27), date(2025, 12, 25), date(2026, 1, 1), date(2026, 1, 19),
            date(2026, 2, 16), date(2026, 4, 3), date(2026, 5, 25), date(2026, 6, 19),
            date(2026, 7, 3), date(2026, 9, 7)}
EARLY_CLOSE = {date(2025, 7, 3), date(2025, 11, 28), date(2025, 12, 24), date(2026, 12, 24)}
VOL = {"MU": 0.0016, "NVDA": 0.0012, "AMD": 0.0014, "AVGO": 0.0012, "TSM": 0.0010,
       "WDC": 0.0015, "QQQ": 0.0005, "TSLA": 0.0018}


def trading_days(start: date, end: date) -> list[date]:
    out, d = [], start
    while d <= end:
        if d.weekday() < 5 and d not in HOLIDAYS:
            out.append(d)
        d += timedelta(days=1)
    return out


def _fmt(x: float) -> str:
    return f"{x:.2f}"


class SyntheticSource:
    def __init__(self, seed: int = 1, missing_rate: float = 0.0) -> None:
        self.seed, self.missing_rate = seed, missing_rate
        self._days: dict[tuple[str, date], list[RawBar]] = {}
        self.calls = 0

    def _gen(self, symbol: str, start: date, end: date) -> None:
        rng = random.Random(f"{self.seed}:{symbol}")
        px = 100.0
        vol = VOL.get(symbol, 0.001)
        for d in trading_days(start, end):
            # overnight gap, with mild pull back toward 100 so long runs stay sane
            px *= math.exp(rng.gauss(0, vol * 6) - 0.05 * math.log(px / 100))
            n = 210 if d in EARLY_CLOSE else 390
            open_ts = int(datetime.combine(d, time(9, 30), NY).timestamp())
            bars: list[RawBar] = []
            drift = rng.gauss(0, vol / 40)
            for i in range(n):
                o = px
                c = o * math.exp(rng.gauss(drift, vol))
                h = max(o, c) * (1 + abs(rng.gauss(0, vol / 2)))
                lo = min(o, c) * (1 - abs(rng.gauss(0, vol / 2)))
                px = c
                if rng.random() < self.missing_rate:
                    continue
                bars.append((open_ts + 60 * i, _fmt(o), _fmt(h), _fmt(lo), _fmt(c),
                             rng.randint(1000, 90000)))
            self._days[(symbol, d)] = bars

    def _ensure(self, symbol: str) -> None:
        if not any(k[0] == symbol for k in self._days):
            self._gen(symbol, date(2025, 3, 1), date(2026, 12, 31))

    def daily(self, symbol: str, start: date, end: date):
        self.calls += 1
        self._ensure(symbol)
        out = []
        for (sym, d), bars in sorted(self._days.items()):
            if sym != symbol or not (start <= d <= end) or not bars:
                continue
            out.append((d.isoformat(), bars[0][1], max((b[2] for b in bars), key=float),
                        min((b[3] for b in bars), key=float), bars[-1][4],
                        sum(b[5] for b in bars)))
        return out

    def minutes(self, symbol: str, day: date) -> list[RawBar]:
        self.calls += 1
        self._ensure(symbol)
        return list(self._days.get((symbol, day), []))
