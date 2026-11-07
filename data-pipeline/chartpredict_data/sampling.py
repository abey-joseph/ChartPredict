"""Uniform random sampling of window start minutes — no cherry-picking.

Every (day, start minute) where the whole window fits inside that day's regular session
is equally likely. Draws that would overlap / sit too close to an already chosen window
on the same day are rejected and redrawn. Nothing about price or volatility is looked at.
"""
from __future__ import annotations

import bisect
import random
from datetime import date

from . import config


def valid_starts(session_length: int, window: int = config.WINDOW) -> int:
    return max(0, session_length - window + 1)


def sample_windows(
    days: list[tuple[date, int]],      # (trading day, session length in minutes)
    quota: int,
    rng: random.Random,
    window: int = config.WINDOW,
    min_gap: int = config.MIN_GAP,
) -> list[tuple[date, int]]:
    """Return `quota` (day, start_minute) picks in draw order."""
    weights = [valid_starts(n, window) for _, n in days]
    cum: list[int] = []
    total = 0
    for w in weights:
        total += w
        cum.append(total)
    if total == 0:
        raise ValueError("no valid window starts")

    spacing = window + min_gap          # start-to-start distance on the same day
    chosen: dict[date, list[int]] = {}
    picks: list[tuple[date, int]] = []
    attempts = 0
    while len(picks) < quota:
        attempts += 1
        if attempts > 1000 * quota + 100_000:
            raise RuntimeError(f"could not place {quota} windows; only got {len(picks)}")
        u = rng.randrange(total)
        k = bisect.bisect_right(cum, u)
        start = u - (cum[k - 1] if k else 0)
        day = days[k][0]
        taken = chosen.setdefault(day, [])
        if any(abs(start - s) < spacing for s in taken):
            continue
        taken.append(start)
        picks.append((day, start))
    return picks


def rng_for(symbol: str, seed: int = config.SEED) -> random.Random:
    # str seeds are hashed deterministically by `random` (not affected by PYTHONHASHSEED)
    return random.Random(f"{seed}:{symbol}")
