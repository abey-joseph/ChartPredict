# Chart Predict

A personal trading-practice PWA. It replays real past 1-minute US stock charts (mostly Micron)
as if they were live. You go long, short, or stay out, and the app scores the result, so you
can find out over many attempts whether your reads are **skill or luck**.

| Phase | What | Status |
|---|---|---|
| 0 | Data pipeline: Longbridge 1-minute candles → 1,000 randomly sampled scenarios | **done**: quotas exact, spot checks match Longbridge |
| 1 | Replay player + trading (Vite + React + TS + Lightweight Charts), PWA | **built, ready for review** |
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
src/lib/              pure logic: tick simulation, trading engine, replay clock, picker, IndexedDB
src/components/       Player, ReplayChart (Lightweight Charts), daily inset, picker + settings sheets
```

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # typecheck + production build into dist/ (with service worker)
```

## How the player works (Phase 1)

**Per scenario:** you see the 90-minute warm-up (muted colours), with a yellow band at the
overnight gap if it reaches into the previous day. The **5D** button shows the last 5 daily
candles. Press ▶ and the 30-minute window plays: **one bar = 60 s at 1×** (5×, 10×, 30× for
12 s, 6 s, 2 s). Each bar forms from 60 simulated ticks, one per simulated second. Up bars
usually dip first and then rally (open → low → high → close); down bars usually do the opposite;
25% of bars use the other order. Ticks start at the real open, end at the real close, touch the
real high and low, and never go outside them. The path is seeded by the scenario, so a bar
forms the same way every time.

**Trading rules** (`src/lib/trading.ts`, unit-tested):

* **Long / Short** enter at the current tick price. One position at a time; the opposite
  button **reverses** (closes, then opens the other way at the same price). **Exit** closes.
  You can trade while paused, but not before pressing ▶.
* On entry a **stop** is placed 0.5% away (configurable). **+ target** adds a target at 2× the
  stop distance. Drag the **SL / TP** handles to move them. They can't be dragged to the wrong
  side of the price.
* A stop or target **fills at its own price** when a tick touches or crosses it. Every tick is
  checked, even at 30× or after a slow frame.
* An open position **auto-closes at the end of the window** at the last close.
* **P&L % = direction × (exit − entry) / entry × 100 − fee** (0.05% round trip by default,
  configurable). **R = net P&L % ÷ stop distance % at entry.** R always uses the *initial*
  stop, so if you widen the stop a full stop-out is worse than −1R.
* **Skip / No trade** ends the scenario and records a no-trade. Once you've traded and are
  flat it becomes **Finish**. It's disabled while a position is open.

**Result screen:** win / loss / no trade, total % and R, every trade (entry → exit, reason,
holding time). It also says whether the window had a tradeable move, then shows the next 60
minutes in blue. **Reveal** shows the stock, real date, time and real prices.

**Blind mode** (default on): all prices are multiplied so the window starts at exactly 100, the
time axis only ever shows HH:MM, and the volume axis is hidden. There's no stock name or date
until Reveal.

**Picking scenarios:** *Next random* draws uniformly among the least-played scenarios of the
whole pool, so nothing repeats until all 1,000 are played and the 60/25/15 mix holds.
*Practice filter* limits the draw by stock, type and time of day; those attempts are saved
with `mode: "practice"` so Phase 2 stats can keep them apart. A new filter only takes effect
after the current scenario is finished or skipped, so a scenario can't be dropped without
being recorded.

**Saved per attempt** (IndexedDB `chartpredict` → `attempts`): scenario id, symbol, group,
mode, blind, fee, stop %, speed and speeds used, no-trade / skipped flags, outcome, total % and
R, plus every trade (direction, entry/exit time and price, exit reason, initial and final
stop, target, gross/net %, R, holding time, reason tag) and the scenario's tags. Settings →
**Export / Import JSON** backs it up. Import merges by attempt id.

**Desktop keys:** Space play/pause · L long · S short · X exit · N next.

## Secrets

Longbridge credentials go only in `data-pipeline/.env`, which is gitignored. Never commit keys.

## Deploy: Cloudflare Pages (free) + Cloudflare Access (free login)

### 1. Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
   Authorise the Cloudflare GitHub app for **this private repo only**.
2. Production branch: the branch you deploy from (e.g. `main` once this is merged).
3. Build settings: framework preset **None** (or Vite) · build command `npm run build` ·
   output directory `dist`.
4. Environment variable: `NODE_VERSION` = `22`.
5. Save and deploy. You get `https://<project>.pages.dev`. Every push to the production
   branch redeploys; other branches get preview URLs.

### 2. Access (only your email can open it)

1. Dashboard → **Zero Trust**. The first time, pick a team name and the **Free** plan.
2. **Settings → Authentication → Login methods**: make sure **One-time PIN** is enabled.
3. **Access → Applications → Add an application → Self-hosted**:
   * Name: Chart Predict. Session duration: **1 month**, so the installed app rarely asks you to log in again.
   * Destinations / domains: `<project>.pages.dev` **and** `*.<project>.pages.dev` (preview deployments).
   * Policy: action **Allow**; Include → **Emails** → your email address.
4. Save. Open the site in a private window: you should get the Cloudflare login page; enter
   your email, then paste the code that's emailed to you.

Already handled in the app: the web manifest is requested *with credentials*
(`crossorigin="use-credentials"`), so the Access cookie goes with it and installing still works.

### 3. Install on iPhone

Open the site in **Safari** → log in → wait a few seconds on the first load (the service worker
downloads the app plus all 1,000 scenarios, about 9 MB, for offline use) → **Share → Add to Home
Screen**. The installed app keeps its own login cookie, separate from Safari, so you'll log in
once more the first time you open it from the home screen.

Your attempts live in the device's IndexedDB. Use **Settings → Export JSON** now and then,
because iOS may clear the data of web apps you haven't opened for weeks.
