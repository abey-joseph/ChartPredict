#!/usr/bin/env python3
"""Phase 0 quality check: re-download a few random scenarios straight from Longbridge
(bypassing raw/ cache) and confirm every bar matches the built files exactly.

    python spotcheck.py            # 3 scenarios, at least one non-MU
    python spotcheck.py -n 5 --seed 7
"""
import argparse
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

from chartpredict_data.client import LongbridgeSource

SCEN = Path(__file__).resolve().parent.parent / "public" / "scenarios"


def same(a: list, b: list) -> bool:
    return len(a) == len(b) and all(
        x[0] == y[0] and all(abs(float(p) - float(q)) < 1e-9 for p, q in zip(x[1:5], y[1:5]))
        and int(x[5]) == int(y[5]) for x, y in zip(a, b))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=3)
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()
    index = json.loads((SCEN / "index.json").read_text())["scenarios"]
    rng = random.Random(args.seed)
    non_mu = [e for e in index if e["symbol"] != "MU"]
    picks = [rng.choice(non_mu)]
    picks += rng.sample([e for e in index if e["id"] != picks[0]["id"]], args.n - 1)

    src = LongbridgeSource()
    failures = 0
    for e in picks:
        s = json.loads((SCEN / f"{e['id']}.json").read_text())
        day = date.fromisoformat(s["date"])
        fresh = {b[0]: b for b in src.minutes(s["symbol"], day)}
        if s["prevSessionDate"]:
            fresh.update({b[0]: b for b in src.minutes(s["symbol"], date.fromisoformat(s["prevSessionDate"]))})
        checks = {}
        for part in ("warmup", "window", "reveal"):
            mine = s[part]
            theirs = [fresh.get(b[0]) for b in mine]
            checks[part] = all(theirs) and same(mine, [list(t) for t in theirs])
        daily = src.daily(s["symbol"], day - timedelta(days=14), day - timedelta(days=1))[-5:]
        from chartpredict_data.bars import daily_ts
        theirs = [[daily_ts(date.fromisoformat(r[0])), *r[1:]] for r in daily]
        checks["daily"] = same(s["daily"], theirs)
        ok = all(checks.values())
        failures += not ok
        w = s["window"]
        print(f"{'PASS' if ok else 'FAIL'}  {s['id']}  {s['symbol']:5} {s['date']} {s['startET']}-{s['endET']} ET  "
              f"window open {w[0][1]} close {w[-1][4]}  "
              + "  ".join(f"{k}={'ok' if v else 'MISMATCH'}({len(s[k])})" for k, v in checks.items()))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
