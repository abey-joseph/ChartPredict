from datetime import date

import pytest

from chartpredict_data import config
from chartpredict_data.bars import Bar, build_session, session_open_ts
from chartpredict_data.scenarios import best_long_pct, best_short_pct, build_scenario, index_entry, tags_for

DAY = date(2026, 3, 10)
PREV = date(2026, 3, 9)


def raw_day(day, n=390, px=100.0, step=0.01, skip=()):
    t0 = session_open_ts(day)
    out = []
    for i in range(n):
        if i in skip:
            continue
        o = px + i * step
        c = o + step
        out.append((t0 + 60 * i, f"{o:.4f}", f"{c + 0.005:.4f}", f"{o - 0.005:.4f}", f"{c:.4f}", 100 + i))
    return out


def B(o, h, l, c):
    return Bar(0, o, h, l, c, 1)


def test_tags_hand_calculated():
    # start 100. path: 100 -> 101 -> 100.5 -> 102 ; |moves| = 1 + .5 + 1.5 = 3 ; net = +2
    w = [B(100, 101.2, 99.8, 101), B(101, 101.1, 100.4, 100.5), B(100.5, 102.3, 100.5, 102)]
    t = tags_for(w, 390, 100, day_open=100, prior_close=97)
    assert t["rangePct"] == pytest.approx((102.3 - 99.8) / 100 * 100)        # 2.5
    assert t["netMovePct"] == pytest.approx(2.0)
    assert t["efficiency"] == pytest.approx(2 / 3, abs=1e-4)
    assert t["type"] == "trend"
    assert t["timeBucket"] == "midday"
    assert t["gapDay"] is True and t["gapPct"] == pytest.approx(3.0928, abs=1e-4)
    # best long: low 99.8 (bar0) -> high 102.3 (bar2) = 2.5050%
    assert t["bestLongPct"] == pytest.approx((102.3 - 99.8) / 99.8 * 100, abs=1e-4)
    # best short: high 101.2 (bar0) -> low 100.4 (bar1) = 0.7905%
    assert t["bestShortPct"] == pytest.approx((101.2 - 100.4) / 101.2 * 100, abs=1e-4)
    assert t["hadTradeableMove"] is True


def test_same_bar_extremes_do_not_count():
    # one wild bar then nothing: low->high inside bar 0 is NOT a tradeable long
    w = [B(100, 105, 95, 100), B(100, 100.1, 99.9, 100)]
    assert best_long_pct(w) == pytest.approx((100.1 - 95) / 95 * 100)
    assert best_short_pct(w) == pytest.approx((105 - 99.9) / 105 * 100)


def test_flat_choppy_buckets_and_fee_edge():
    flat = [B(100, 100.2, 99.9, 100.1), B(100.1, 100.15, 99.95, 100)]
    t = tags_for(flat, 390, 0, 100, 100)
    assert t["type"] == "flat" and t["timeBucket"] == "open" and t["hadTradeableMove"] is False
    chop = [B(100, 101, 99.5, 100.8), B(100.8, 100.9, 99.4, 99.5), B(99.5, 100.9, 99.4, 100.1)]
    assert tags_for(chop, 390, 0, 100, 100)["type"] == "choppy"
    assert tags_for(chop, 390, 330, 100, 100)["timeBucket"] == "close"   # 15:00
    assert tags_for(chop, 390, 329, 100, 100)["timeBucket"] == "midday"
    assert tags_for(chop, 210, 150, 100, 100)["timeBucket"] == "close"   # 12:00 on a half day
    # exactly 1.05% move: 1.05 - 0.05 fee = 1.00, which is NOT more than 1%
    edge = [B(100, 100, 100, 100), B(100, 101.05, 100, 101)]
    assert tags_for(edge, 390, 60, 100, 100)["hadTradeableMove"] is False


def test_build_session_fills_and_half_day():
    s = build_session(DAY, raw_day(DAY, skip={5, 6}))
    assert s.length == 390 and s.missing == 2 and len(s.bars) == 390
    assert s.bars[5].filled and s.bars[5].v == 0 and s.bars[5].o == s.bars[4].c
    assert s.bars[7].t - s.bars[0].t == 7 * 60
    half = build_session(date(2025, 12, 24), raw_day(date(2025, 12, 24), n=210))
    assert half.length == 210 and half.missing == 0


def daily_rows():
    return [(f"2026-03-0{d}", "99", "101", "98", f"{100 + d}", 1000) for d in (2, 3, 4, 5, 6)] + \
           [("2026-03-09", "100", "104", "99", "100.5", 1000)]


def test_warmup_crosses_previous_session():
    prev = build_session(PREV, raw_day(PREV, px=90))
    cur = build_session(DAY, raw_day(DAY))
    s = build_scenario("NVDA", cur, 20, prev, daily_rows(), ("2026-03-10", "103.0", "0", "0", "0", 0))
    assert len(s["warmup"]) == 90 and s["sessionBreak"] == 70
    assert s["warmup"][69][0] == prev.bars[-1].t        # last bar of previous day
    assert s["warmup"][70][0] == cur.bars[0].t          # 09:30 of scenario day
    assert s["prevSessionDate"] == "2026-03-09"
    assert [b[0] for b in s["window"]] == [cur.bars[i].t for i in range(20, 50)]
    assert len(s["reveal"]) == 60 and s["reveal"][0][0] == cur.bars[50].t
    assert s["startET"] == "09:50" and s["endET"] == "10:20"
    assert len(s["daily"]) == 5 and s["daily"][-1][4] == 100.5   # day before, not the scenario day
    assert s["priorClose"] == 100.5 and s["dayOpen"] == 103.0
    assert s["tags"]["gapDay"] is True                             # +2.49%


def test_reveal_cut_at_close_and_no_warmup_break_midday():
    cur = build_session(DAY, raw_day(DAY))
    s = build_scenario("MU", cur, 345, None, daily_rows(), None)
    assert s["sessionBreak"] is None and len(s["warmup"]) == 90
    assert len(s["reveal"]) == 390 - 375                  # 15:45 .. 15:59 only
    s2 = build_scenario("MU", cur, 360, None, daily_rows(), None)
    assert s2["reveal"] == [] and s2["endET"] == "16:00"


def test_index_entry_has_no_dates_or_prices():
    cur = build_session(DAY, raw_day(DAY))
    e = index_entry(build_scenario("QQQ", cur, 200, None, daily_rows(), None))
    blob = repr(e)
    assert "2026" not in blob and "date" not in e and "startPrice" not in e
    assert set(e) >= {"id", "symbol", "timeBucket", "rangePct", "netMovePct", "efficiency",
                      "type", "gapDay", "hadTradeableMove"}
