"""Longbridge OpenAPI access (official `longbridge` Python SDK) + on-disk raw cache.

Auth (checked in this order, values from the environment or data-pipeline/.env):
  1. LONGBRIDGE_APP_KEY + LONGBRIDGE_APP_SECRET + LONGBRIDGE_ACCESS_TOKEN  (legacy API key)
  2. LONGBRIDGE_CLIENT_ID  (OAuth 2.0 — opens a browser once, token cached by the SDK)
"""
from __future__ import annotations

import json
import os
import sys
import time as _time
import webbrowser
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from . import config
from .bars import NY, RawBar

PIPELINE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = PIPELINE_DIR / "raw"

DailyRaw = tuple[str, str, str, str, str, int]   # (yyyy-mm-dd, o, h, l, c, v)


class Source(Protocol):
    def daily(self, symbol: str, start: date, end: date) -> list[DailyRaw]: ...
    def minutes(self, symbol: str, day: date) -> list[RawBar]: ...


def load_dotenv(path: Path) -> None:
    """Tiny .env reader (KEY=VALUE lines); existing environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if v and k.strip() not in os.environ:
            os.environ[k.strip()] = v


class LongbridgeSource:
    def __init__(self) -> None:
        load_dotenv(PIPELINE_DIR / ".env")
        from longbridge.openapi import (  # imported lazily so tests don't need the SDK
            AdjustType, Config, OAuthBuilder, Period, QuoteContext, TradeSessions,
        )
        self._Period, self._Adjust, self._Sessions = Period, AdjustType, TradeSessions

        if all(os.environ.get(k) for k in
               ("LONGBRIDGE_APP_KEY", "LONGBRIDGE_APP_SECRET", "LONGBRIDGE_ACCESS_TOKEN")):
            cfg = Config.from_apikey_env()
        elif os.environ.get("LONGBRIDGE_CLIENT_ID"):
            def open_url(url: str) -> None:
                print(f"\nLog in to Longbridge in your browser:\n  {url}\n", flush=True)
                webbrowser.open(url)
            oauth = OAuthBuilder(os.environ["LONGBRIDGE_CLIENT_ID"]).build(open_url)
            cfg = Config.from_oauth(oauth)
        else:
            sys.exit("No Longbridge credentials. Copy data-pipeline/.env.example to "
                     "data-pipeline/.env and fill in LONGBRIDGE_CLIENT_ID or the API key trio.")
        self.ctx = QuoteContext(cfg)
        self._last_call = 0.0
        self._naive_tz = None

    # -- plumbing ---------------------------------------------------------
    def _call(self, fn, *args):
        delay = 1.0
        for attempt in range(6):
            wait = config.MIN_REQUEST_INTERVAL_S - (_time.monotonic() - self._last_call)
            if wait > 0:
                _time.sleep(wait)
            self._last_call = _time.monotonic()
            try:
                return fn(*args)
            except Exception as e:  # rate limit / transient network
                if attempt == 5:
                    raise
                print(f"  ! {e!r} — retrying in {delay:.0f}s", flush=True)
                _time.sleep(delay)
                delay *= 2

    _LOCAL = "local"   # naive datetimes in the machine's local zone (DST-aware via astimezone)

    @classmethod
    def _as_utc(cls, dt: datetime, tz) -> datetime:
        if tz == cls._LOCAL:
            return dt.astimezone(timezone.utc)          # Python treats naive as local time
        return dt.replace(tzinfo=tz).astimezone(timezone.utc)

    def _calibrate(self) -> None:
        """Work out how the SDK encodes timestamps if it hands back naive datetimes.

        The last ~2.5 sessions of QQQ 1m bars must map exactly onto 09:30..15:59 New York
        time (first and last minute both present); pick the interpretation that does.
        """
        bars = self._call(self.ctx.candlesticks, "QQQ.US", self._Period.Min_1, 1000,
                          self._Adjust.NoAdjust, self._Sessions.Intraday)
        ts = [b.timestamp for b in bars]
        if not ts or ts[0].tzinfo is not None:
            self._naive_tz = None
            return
        fits = []
        for tz in (self._LOCAL, timezone.utc, NY):
            hm = [(t.weekday(), t.hour, t.minute) for t in
                  (self._as_utc(d, tz).astimezone(NY) for d in ts)]
            inside = all(w < 5 and (9, 30) <= (h, m) <= (15, 59) for w, h, m in hm)
            edges = {(h, m) for _, h, m in hm} >= {(9, 30), (15, 59)}
            if inside and edges:
                fits.append(tz)
        if not fits:
            raise RuntimeError(f"Cannot interpret SDK timestamps, sample: {ts[:3]}")
        self._naive_tz = fits[0]   # if several fit they are the same zone in practice

    def _utc(self, dt: datetime) -> datetime:
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc)
        if self._naive_tz is None:
            self._calibrate()
        return self._as_utc(dt, self._naive_tz or timezone.utc)

    # -- Source API -------------------------------------------------------
    def daily(self, symbol: str, start: date, end: date) -> list[DailyRaw]:
        out: list[DailyRaw] = []
        cur = start
        while cur <= end:   # stay well under the 1,000-bar cap per call
            chunk_end = min(end, cur + timedelta(days=365))
            bars = self._call(self.ctx.history_candlesticks_by_date, f"{symbol}.US",
                              self._Period.Day, self._Adjust.NoAdjust, cur, chunk_end,
                              self._Sessions.Intraday)
            for b in bars:
                d = self._utc(b.timestamp).astimezone(NY).date()
                out.append((d.isoformat(), str(b.open), str(b.high), str(b.low),
                            str(b.close), int(b.volume)))
            cur = chunk_end + timedelta(days=1)
        return sorted(set(out))

    def minutes(self, symbol: str, day: date) -> list[RawBar]:
        bars = self._call(self.ctx.history_candlesticks_by_date, f"{symbol}.US",
                          self._Period.Min_1, self._Adjust.NoAdjust, day, day,
                          self._Sessions.Intraday)
        out: list[RawBar] = []
        for b in bars:
            t = self._utc(b.timestamp)
            if t.astimezone(NY).date() != day:
                continue
            out.append((int(t.timestamp()), str(b.open), str(b.high), str(b.low),
                        str(b.close), int(b.volume)))
        out.sort()
        return out


class CachedSource:
    """Wraps a Source; raw/<SYMBOL>/<date>.json and raw/<SYMBOL>/daily.json."""

    def __init__(self, inner: Source, root: Path = RAW_DIR, offline: bool = False) -> None:
        self.inner, self.root, self.offline = inner, root, offline
        self.fetched = 0

    def daily(self, symbol: str, start: date, end: date) -> list[DailyRaw]:
        p = self.root / symbol / "daily.json"
        key = f"{start}:{end}"
        if p.exists():
            obj = json.loads(p.read_text())
            if obj.get("range") == key:
                return [tuple(r) for r in obj["bars"]]
        if self.offline:
            raise FileNotFoundError(p)
        bars = self.inner.daily(symbol, start, end)
        self.fetched += 1
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"range": key, "bars": bars}))
        return bars

    def minutes(self, symbol: str, day: date) -> list[RawBar]:
        p = self.root / symbol / f"{day.isoformat()}.json"
        if p.exists():
            return [tuple(r) for r in json.loads(p.read_text())]
        if self.offline:
            raise FileNotFoundError(p)
        bars = self.inner.minutes(symbol, day)
        self.fetched += 1
        if not bars:   # don't cache an empty answer; it gets retried next run
            return bars
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(bars))
        tmp.replace(p)   # atomic: an interrupted run never leaves a half-written day
        return bars
