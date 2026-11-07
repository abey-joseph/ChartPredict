"""Fetch -> sessions -> sample -> assemble -> write -> summary."""
from __future__ import annotations

import json
import shutil
import statistics
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

from . import config
from .bars import Session, build_session
from .client import Source
from .sampling import rng_for, sample_windows, valid_starts
from .scenarios import build_scenario, index_entry


def load_symbol(src: Source, symbol: str, start: date, end: date, log=print):
    """Return (daily rows, {day: Session}, candidate days, excluded days)."""
    # daily: pad before START so the first candidate has 5 prior candles + a prior session
    daily = src.daily(symbol, start - timedelta(days=21), end)
    days_all = [date.fromisoformat(r[0]) for r in daily]
    first_idx = next((i for i, d in enumerate(days_all) if d >= start), len(days_all))
    if first_idx < config.DAILY_CONTEXT:
        raise RuntimeError(f"{symbol}: not enough daily history before {start}")
    need_minutes = days_all[first_idx - 1:]          # prior session for warm-up too
    sessions: dict[date, Session] = {}
    for n, d in enumerate(need_minutes, 1):
        if n % 50 == 0 or n == len(need_minutes):
            log(f"  {symbol}: minute bars {n}/{len(need_minutes)}")
        s = build_session(d, src.minutes(symbol, d))
        if s is not None:
            sessions[d] = s
    candidates, excluded = [], []
    for i in range(first_idx, len(days_all)):
        d, prev = days_all[i], days_all[i - 1]
        s = sessions.get(d)
        if s is None or s.completeness < config.MIN_DAY_COMPLETENESS:
            excluded.append((d, "no data" if s is None else f"{s.missing} missing minutes"))
        elif prev not in sessions:
            excluded.append((d, "prior session missing"))
        else:
            candidates.append(d)
    return daily, sessions, candidates, excluded


def build(src: Source, out_dir: Path, start: date = config.START, end: date = config.END,
          quotas: dict[str, int] = config.QUOTAS, log=print) -> dict:
    all_scen: list[dict] = []
    meta: dict[str, dict] = {}
    for symbol, quota in quotas.items():
        log(f"[{symbol}] loading {start} .. {end}")
        daily, sessions, candidates, excluded = load_symbol(src, symbol, start, end, log)
        day_list = [(d, sessions[d].length) for d in candidates]
        picks = sample_windows(day_list, quota, rng_for(symbol))
        daily_by_day = {date.fromisoformat(r[0]): r for r in daily}
        ordered_days = sorted(daily_by_day)
        for d, st in picks:
            i = ordered_days.index(d)
            before = [daily_by_day[x] for x in ordered_days[:i]]
            prev = sessions.get(ordered_days[i - 1])
            all_scen.append(build_scenario(symbol, sessions[d], st, prev, before,
                                           daily_by_day[d]))
        meta[symbol] = {
            "quota": quota,
            "tradingDays": len(candidates),
            "halfDays": sum(1 for d in candidates if sessions[d].length < config.FULL_SESSION),
            "validStartMinutes": sum(valid_starts(n) for _, n in day_list),
            "excludedDays": [(d.isoformat(), why) for d, why in excluded],
        }

    ids = [s["id"] for s in all_scen]
    assert len(ids) == len(set(ids)), "scenario id collision"

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    for s in all_scen:
        (out_dir / f"{s['id']}.json").write_text(json.dumps(s, separators=(",", ":")))
    index = {
        "version": 1,
        "seed": config.SEED,
        "count": len(all_scen),
        "scenarios": sorted((index_entry(s) for s in all_scen), key=lambda e: e["id"]),
    }
    (out_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    return {"scenarios": all_scen, "meta": meta}


# ---------------------------------------------------------------- summary
def _pct(n: int, d: int) -> str:
    return f"{(100 * n / d):5.1f}%" if d else "   - "


def summarize(result: dict, start: date = config.START, end: date = config.END,
              quotas: dict[str, int] = config.QUOTAS) -> str:
    scen, meta = result["scenarios"], result["meta"]
    by_sym: dict[str, list[dict]] = defaultdict(list)
    for s in scen:
        by_sym[s["symbol"]].append(s)
    L: list[str] = []
    L.append(f"Chart Predict scenario set — {len(scen)} scenarios, history {start} .. {end}, "
             f"seed {config.SEED}")
    L.append("")
    L.append("Per symbol                quota  got   days  half  valid-starts  excl  "
             "tradeable  median range%")
    ok = True
    for sym, q in quotas.items():
        got = by_sym[sym]
        m = meta[sym]
        trade = sum(s["tags"]["hadTradeableMove"] for s in got)
        med = statistics.median(s["tags"]["rangePct"] for s in got) if got else 0
        flag = "" if len(got) == q else "  <-- MISMATCH"
        ok &= len(got) == q
        L.append(f"  {sym:5} {config.NAMES[sym][:18]:18} {q:5} {len(got):4}  {m['tradingDays']:5} "
                 f"{m['halfDays']:5}  {m['validStartMinutes']:12}  {len(m['excludedDays']):4}  "
                 f"{_pct(trade, len(got)):>9}  {med:12.2f}{flag}")
    L.append(f"  quotas matched exactly: {'YES' if ok else 'NO'}")
    L.append("")

    def table(title: str, key: str, cats: list[str]) -> None:
        L.append(f"{title:26}" + "".join(f"{c:>9}" for c in cats) + "     n")
        rows = [("ALL", scen)] + [(sym, by_sym[sym]) for sym in quotas]
        for name, group in rows:
            c = Counter(s["tags"][key] for s in group)
            L.append(f"  {name:24}" + "".join(f"{_pct(c[x], len(group)):>9}" for x in cats)
                     + f"  {len(group):4}")
        L.append("")

    table("Type", "type", ["flat", "choppy", "trend"])
    table("Time bucket", "timeBucket", ["open", "midday", "close"])

    L.append("Other tags")
    gap = sum(s["tags"]["gapDay"] for s in scen)
    trade = sum(s["tags"]["hadTradeableMove"] for s in scen)
    cross = sum(1 for s in scen if s["sessionBreak"] is not None)
    filled = sum(s["filledBars"] for s in scen)
    L.append(f"  gap days (>{config.GAP_DAY_PCT}% open vs prior close): {gap} ({_pct(gap, len(scen)).strip()})")
    L.append(f"  had tradeable move (>{config.TRADEABLE_PCT}% after {config.FEE_PCT}% fees): "
             f"{trade} ({_pct(trade, len(scen)).strip()})")
    L.append(f"  warm-up crosses into previous session: {cross}")
    L.append(f"  forward-filled (missing) minute bars across all scenarios: {filled}")
    L.append("")
    L.append("Tradeable share by group")
    for g in ("MU", "chips", "QQQ/TSLA"):
        grp = [s for s in scen if s["group"] == g]
        t = sum(s["tags"]["hadTradeableMove"] for s in grp)
        L.append(f"  {g:10} {_pct(t, len(grp))}  ({t}/{len(grp)})")
    excl = [(sym, d, why) for sym, m in meta.items() for d, why in m["excludedDays"]]
    if excl:
        L.append("")
        L.append("Excluded days")
        for sym, d, why in excl[:40]:
            L.append(f"  {sym:5} {d}  {why}")
        if len(excl) > 40:
            L.append(f"  ... and {len(excl) - 40} more")
    return "\n".join(L)
