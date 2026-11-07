# Phase 0 — data pipeline

Downloads real 1-minute regular-session candles from **Longbridge OpenAPI** and builds the
1,000 practice scenarios the app replays.

```
data-pipeline/
  build.py             # fetch (cached) -> sample -> tag -> write public/scenarios/ + summary.txt
  spotcheck.py         # re-download random scenarios and compare bar-for-bar
  chartpredict_data/
    config.py          # quotas, date range, seed, every threshold below
    client.py          # Longbridge SDK adapter + raw/ cache
    sampling.py        # uniform random window picking
    scenarios.py       # warm-up / window / reveal assembly + tags
    pipeline.py        # orchestration + printed summary
    synthetic.py       # fake data for tests and --demo
  tests/               # pytest, no network needed
  raw/                 # cache, gitignored
```

## 1. Set up

Python 3.10+.

```bash
cd data-pipeline
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                    # then fill it in — never commit .env
```

**Credentials.** The SDK (`longbridge` 5.3.0) supports two methods; the script uses whichever
`.env` provides:

| Method | `.env` keys | Notes |
|---|---|---|
| OAuth 2.0 (Longbridge's recommended) | `LONGBRIDGE_CLIENT_ID` | Register an OAuth client in the Longbridge developer portal (open.longbridge.com) with redirect URI `http://localhost:60355/callback`. The first run opens your browser to log in; the SDK caches the token in `~/.longbridge/openapi/tokens/`. |
| Legacy API key | `LONGBRIDGE_APP_KEY`, `LONGBRIDGE_APP_SECRET`, `LONGBRIDGE_ACCESS_TOKEN` | From the developer portal's app page. |

Your account needs US market data (LV1) for 1-minute history. That's the same entitlement the
Longbridge app uses.

## 2. Run

```bash
python build.py            # ~3,000 requests on the first run (one per symbol per day), about 10 min
python build.py --offline  # rebuild from raw/ only (e.g. after changing a threshold)
python spotcheck.py        # 3 random scenarios (>= 1 non-MU) vs a fresh download
python -m pytest -q        # unit tests
```

Requests are paced at about 6/s and retried with exponential backoff. Re-runs only download
days missing from `raw/`, and an interrupted run carries on where it stopped.

Output:

* `../public/scenarios/index.json` — `{version, seed, count, scenarios: [...]}`; each entry
  is `id, symbol, group` plus tags. **No dates, times or prices.**
* `../public/scenarios/<id>.json` — the full scenario (below).
* `summary.txt` — the printed summary (commit it with the data).

Then commit `public/scenarios/` and `data-pipeline/summary.txt`.

`python build.py --demo` runs the whole pipeline on **synthetic** random-walk data into
`demo-out/` (gitignored). It's only a smoke test and never touches `public/`.

## 3. Sampling rules (no cherry-picking)

* **History:** 2025-05-07 → 2026-11-06 (18 months), pinned in `config.py` so a re-run
  rebuilds the identical set. The trading calendar comes from Longbridge's daily candles, so
  holidays are skipped and early-close days (13:00) are handled.
* **Valid start minute:** any minute where the whole 30-minute window fits inside that day's
  regular session: 09:30 … 15:30 (361 starts) on a normal day, 09:30 … 12:30 on an early close.
* **Draw:** for each symbol, start minutes are drawn uniformly at random over *all* valid
  (day, minute) pairs, so every minute of every day is equally likely. Seeded RNG per symbol:
  `random.Random("20261107:<SYMBOL>")`.
* **Same-day spacing:** a draw is rejected and redrawn if it would overlap another window of
  that symbol on the same day, or start less than **60 minutes after the other window ends**
  (start-to-start ≥ 90 min). This also stops one scenario's 60-minute reveal from showing the
  next scenario's window.
* **Nothing is filtered on price action.** Flat, dull windows appear at their natural rate.
  Tags are computed *after* sampling.
* **Data quality:** a day is a candidate only if ≥ 95% of its minute bars exist and the
  previous session exists (for warm-up). Isolated missing minutes (rare for these names) are
  forward-filled as flat zero-volume bars. The summary reports the count.

## 4. What each scenario contains

All bars are `[unixSecondsUTC, open, high, low, close, volume]`, using real unadjusted prices
exactly as Longbridge returns them.

| Field | Meaning |
|---|---|
| `warmup` | the 90 regular-session minutes before the window. If the window starts before 11:00, this reaches into the previous session's last bars. |
| `sessionBreak` | index in `warmup` where the scenario day begins (`null` if all warm-up is same-day). The UI draws the overnight gap here. |
| `window` | the 30 playback bars |
| `reveal` | up to 60 bars after the window, cut off at the close (so 15:20 → 10 bars, 15:30 → none) |
| `daily` | the last 5 **completed** daily candles before the scenario day. The scenario day's own candle is never included, because it would give away the outcome. |
| `symbol`, `name`, `date`, `startET`, `endET`, `startPrice`, `priorClose`, `dayOpen` | for the reveal only. The UI must not show them before then. |
| `tags` | see below |

## 5. Tags (stats only, computed after sampling)

Here `start` = open of the first window bar and `end` = close of the last.

| Tag | Definition |
|---|---|
| `timeBucket` | by window start: **open** = 09:30–10:29, **close** = within the last 60 min of the session (15:00–15:30 starts; 12:00+ on early-close days), else **midday** |
| `rangePct` | (max high − min low) / start × 100 |
| `netMovePct` | (end − start) / start × 100 |
| `efficiency` | \|end − start\| / path, where path = Σ\|closeᵢ − closeᵢ₋₁\| (with close₋₁ = start). 1 = straight line, ~0 = went nowhere |
| `type` | **flat** if `rangePct` < **0.40**; otherwise **trend** if `efficiency` ≥ **0.30**; otherwise **choppy** |
| `gapDay` | \|day open − prior daily close\| / prior close > **2%** |
| `bestLongPct` | best buy-at-a-low → sell-at-a-*later*-bar's-high inside the window. Low and high of the same bar don't count, since the order inside a bar is unknown. |
| `bestShortPct` | same, mirrored (sell at a high, cover at a later low) |
| `hadTradeableMove` | max(bestLong, bestShort) − **0.05%** fee > **1%** |

**Why these thresholds.** A 30-bar random walk has an expected efficiency of about 0.15. Real
MU/QQQ/NVDA windows checked against Longbridge cluster at 0.0–0.5 with a median near 0.17, so
≥ 0.30 marks roughly the most directional fifth. A range under 0.40% can't clear a 0.5% stop
plus fees either way, so "flat" means there was nothing there to trade. All thresholds live in
`config.py`; changing them and running `build.py --offline` re-tags without re-downloading.
