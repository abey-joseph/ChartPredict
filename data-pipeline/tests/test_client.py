"""LongbridgeSource adapter, exercised with fake SDK candlesticks (no network)."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from chartpredict_data.bars import NY
from chartpredict_data.client import LongbridgeSource

DAY = date(2026, 3, 10)


@dataclass
class FakeCandle:
    timestamp: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


def candles(day, n, encode):
    t0 = datetime(day.year, day.month, day.day, 9, 30, tzinfo=NY)
    return [FakeCandle(encode(t0 + timedelta(minutes=i)), Decimal("808.366"), Decimal("808.5"),
                       Decimal("804.77"), Decimal("805.1"), 49245 + i) for i in range(n)]


class FakeCtx:
    def __init__(self, encode):
        self.encode = encode

    def candlesticks(self, symbol, period, count, adjust, sessions):
        # latest ~1000 intraday minutes: tail of Nov 4 + all of Nov 5 and Nov 6 (EST)
        out = []
        for d in (date(2026, 11, 4), date(2026, 11, 5), date(2026, 11, 6)):
            out += candles(d, 390, self.encode)
        return out[-count:]

    def history_candlesticks_by_date(self, symbol, period, adjust, start, end, sessions):
        if period == "day":
            return [FakeCandle(self.encode(datetime(d.year, d.month, d.day, tzinfo=NY)),
                               Decimal("1"), Decimal("2"), Decimal("0.5"), Decimal("1.5"), 9)
                    for d in (start, end)]
        assert start == end
        return candles(start, 390, self.encode)


def make(encode):
    src = LongbridgeSource.__new__(LongbridgeSource)
    src.ctx = FakeCtx(encode)
    src._Period = type("P", (), {"Min_1": "1m", "Day": "day"})
    src._Adjust = type("A", (), {"NoAdjust": "none"})
    src._Sessions = type("S", (), {"Intraday": "intraday"})
    src._last_call = 0.0
    src._naive_tz = None
    return src


ENCODINGS = {
    "aware-NY": lambda t: t,
    "aware-UTC": lambda t: t.astimezone(timezone.utc),
    "naive-UTC": lambda t: t.astimezone(timezone.utc).replace(tzinfo=None),
    "naive-NY": lambda t: t.replace(tzinfo=None),
    "naive-local": lambda t: t.astimezone().replace(tzinfo=None),
}


@pytest.mark.parametrize("enc", ENCODINGS)
def test_minutes_land_on_regular_session(enc):
    bars = make(ENCODINGS[enc]).minutes("MU", DAY)
    assert len(bars) == 390
    first = datetime.fromtimestamp(bars[0][0], NY)
    last = datetime.fromtimestamp(bars[-1][0], NY)
    assert (first.date(), first.hour, first.minute) == (DAY, 9, 30)
    assert (last.hour, last.minute) == (15, 59)
    assert bars[0][1:] == ("808.366", "808.5", "804.77", "805.1", 49245)   # exact decimals kept


@pytest.mark.parametrize("enc", ENCODINGS)
def test_daily_dates(enc):
    src = make(ENCODINGS[enc])
    src.minutes("MU", DAY)   # calibration happens on first naive timestamp anyway
    rows = src.daily("MU", date(2026, 3, 2), date(2026, 3, 6))
    assert [r[0] for r in rows] == ["2026-03-02", "2026-03-06"]
