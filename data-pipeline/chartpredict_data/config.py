"""All Phase 0 knobs in one place. Changing anything here changes the scenario set."""
from datetime import date

# symbol -> number of scenarios (total 1,000: MU 60% / other chips 25% / QQQ+TSLA 15%)
QUOTAS: dict[str, int] = {
    "MU": 600,
    "NVDA": 50,
    "AMD": 50,
    "AVGO": 50,
    "TSM": 50,
    "WDC": 50,
    "QQQ": 75,
    "TSLA": 75,
}

NAMES: dict[str, str] = {
    "MU": "Micron Technology",
    "NVDA": "NVIDIA",
    "AMD": "Advanced Micro Devices",
    "AVGO": "Broadcom",
    "TSM": "Taiwan Semiconductor (ADR)",
    "WDC": "Western Digital",
    "QQQ": "Invesco QQQ Trust",
    "TSLA": "Tesla",
}

# used by the stats page breakdown "MU vs other chips vs QQQ/TSLA"
GROUPS: dict[str, str] = {
    "MU": "MU",
    "NVDA": "chips", "AMD": "chips", "AVGO": "chips", "TSM": "chips", "WDC": "chips",
    "QQQ": "QQQ/TSLA", "TSLA": "QQQ/TSLA",
}

# History range (inclusive). Pinned so a re-run reproduces the exact same set.
# 18 months ending on the last completed session before the build date.
START = date(2025, 5, 7)
END = date(2026, 11, 6)

SEED = 20261107

# minutes
WINDOW = 30            # playback window
WARMUP = 90            # context shown before the window
REVEAL = 60            # shown after the scenario ends
MIN_GAP = 60           # same-day windows: >= 60 min between end of one and start of next
DAILY_CONTEXT = 5      # completed daily candles shown before the scenario day

SESSION_OPEN_MIN = 9 * 60 + 30   # 09:30 ET
FULL_SESSION = 390               # 09:30-16:00
HALF_SESSION = 210               # 09:30-13:00 (early-close days)

# tagging thresholds (documented in data-pipeline/README.md)
FEE_PCT = 0.05            # round trip, % of price
TRADEABLE_PCT = 1.0       # best long/short must beat this after fees
GAP_DAY_PCT = 2.0         # |open - prior close| / prior close
FLAT_RANGE_PCT = 0.40     # window (high-low)/start below this -> flat
TREND_EFFICIENCY = 0.30   # |net| / path length at or above this -> trend, else choppy
OPEN_BUCKET_END = 60      # minutes after open; start < 10:30 -> "open"
CLOSE_BUCKET_LEN = 60     # start within last 60 min of session -> "close"

# data quality: a day needs at least this share of its minute bars to be a candidate
MIN_DAY_COMPLETENESS = 0.95

# API pacing (Longbridge quote API allows ~10 req/s; stay well under)
MIN_REQUEST_INTERVAL_S = 0.15
