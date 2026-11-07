import random
from collections import Counter
from datetime import date, timedelta

import pytest

from chartpredict_data import config
from chartpredict_data.sampling import rng_for, sample_windows, valid_starts

DAYS = [(date(2026, 1, 5) + timedelta(days=i), 390) for i in range(300)] + [(date(2026, 12, 24), 210)]


def test_valid_starts():
    assert valid_starts(390) == 361      # 09:30 .. 15:30
    assert valid_starts(210) == 181      # 09:30 .. 12:30 on an early close


@pytest.mark.parametrize("quota", [1, 50, 600])
def test_exact_quota_and_spacing(quota):
    picks = sample_windows(DAYS, quota, random.Random(1))
    assert len(picks) == quota
    assert len(set(picks)) == quota
    lengths = dict(DAYS)
    by_day = {}
    for d, s in picks:
        assert 0 <= s <= lengths[d] - config.WINDOW       # window fits in the session
        by_day.setdefault(d, []).append(s)
    for starts in by_day.values():
        starts.sort()
        for a, b in zip(starts, starts[1:]):
            # no overlap AND >= 60 min between end of one and start of the next
            assert b - (a + config.WINDOW) >= config.MIN_GAP


def test_reproducible_with_seed():
    a = sample_windows(DAYS, 200, rng_for("MU"))
    b = sample_windows(DAYS, 200, rng_for("MU"))
    c = sample_windows(DAYS, 200, rng_for("NVDA"))
    assert a == b and a != c


def test_uniform_over_minutes_not_cherry_picked():
    # many single picks on one day: every start minute should be about equally likely
    rng = random.Random(42)
    counts = Counter(sample_windows([(date(2026, 3, 2), 390)], 1, rng)[0][1] for _ in range(72200))
    assert set(counts) == set(range(361))
    expected = 72200 / 361
    chi2 = sum((counts[i] - expected) ** 2 / expected for i in range(361))
    assert chi2 < 460          # df=360, p≈0.0003 cut-off; uniform easily passes


def test_half_day_weighted_by_valid_minutes():
    days = [(date(2026, 1, 2), 390), (date(2026, 1, 3), 210)]
    rng = random.Random(3)
    hits = Counter(sample_windows(days, 1, rng)[0][0] for _ in range(20000))
    share = hits[date(2026, 1, 3)] / 20000
    assert abs(share - 181 / (361 + 181)) < 0.02


def test_impossible_quota_raises():
    with pytest.raises(RuntimeError):
        sample_windows([(date(2026, 1, 2), 390)], 10, random.Random(0))  # max 5 per day
