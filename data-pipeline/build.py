#!/usr/bin/env python3
"""Phase 0: download Longbridge 1-minute data and build the 1,000-scenario set.

    python build.py            # real data -> ../public/scenarios/, summary.txt
    python build.py --offline  # rebuild from raw/ cache only, no network
    python build.py --demo     # synthetic data -> demo-out/ (pipeline smoke test)
"""
import argparse
import sys
from pathlib import Path

from chartpredict_data import config
from chartpredict_data.client import CachedSource, LongbridgeSource, RAW_DIR
from chartpredict_data.pipeline import build, summarize

HERE = Path(__file__).resolve().parent


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="use cached raw/ data only")
    ap.add_argument("--demo", action="store_true", help="synthetic data, writes demo-out/")
    args = ap.parse_args()

    if args.demo:
        from chartpredict_data.synthetic import SyntheticSource
        src = SyntheticSource()
        out = HERE / "demo-out" / "scenarios"
        summary_path = HERE / "demo-out" / "summary.txt"
    else:
        inner = None if args.offline else LongbridgeSource()
        src = CachedSource(inner, RAW_DIR, offline=args.offline)
        out = HERE.parent / "public" / "scenarios"
        summary_path = HERE / "summary.txt"

    result = build(src, out)
    text = summarize(result)
    if args.demo:
        text = "*** SYNTHETIC DEMO DATA — NOT REAL MARKET DATA ***\n\n" + text
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(text + "\n")
    print()
    print(text)
    print(f"\nwrote {len(result['scenarios'])} scenarios to {out}")
    print(f"summary saved to {summary_path}")
    if any(len([s for s in result["scenarios"] if s["symbol"] == k]) != q
           for k, q in config.QUOTAS.items()):
        sys.exit("quota mismatch")


if __name__ == "__main__":
    main()
