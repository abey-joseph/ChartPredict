# Chart Predict

A personal trading-practice PWA. It replays real past 1-minute US stock charts (mostly Micron)
as if they were live. You go long, short, or stay out, and the app scores the result, so you
can find out over many attempts whether your reads are **skill or luck**.

| Phase | What | Status |
|---|---|---|
| 0 | Data pipeline: Longbridge 1-minute candles → 1,000 randomly sampled scenarios | **built; awaiting first real run** |
| 1 | Replay player + trading (Vite + React + TS + Lightweight Charts) | not started |
| 2 | Stats + luck check | not started |
| 3 | VWAP/EMA, 5-min view, weak-spot drills | later |

## Scenario mix

| Symbols | Scenarios each | Total |
|---|---|---|
| MU | 600 | 600 |
| NVDA, AMD, AVGO, TSM, WDC | 50 | 250 |
| QQQ, TSLA | 75 | 150 |

Each scenario is a 30-minute playback window, shown with 90 minutes of warm-up and the last 5
daily candles, and followed by a 60-minute reveal. Windows are picked uniformly at random from
all real regular-session trading time, with no filtering on volatility. See
[`data-pipeline/README.md`](data-pipeline/README.md) for the sampling rules and tag thresholds.

## Layout

```
data-pipeline/        Phase 0 Python (Longbridge SDK). See its README.
public/scenarios/     generated scenario JSON (index.json + <id>.json), committed
```

## Secrets

Longbridge credentials go only in `data-pipeline/.env`, which is gitignored. Never commit keys.

## Deployment (Cloudflare Pages + Access)

Setup steps get written when there's an app to deploy (Phase 1).
