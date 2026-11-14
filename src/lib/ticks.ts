import type { Bar } from './types';
import { mulberry32 } from './rng';

/** One simulated tick per second of the bar: 60 per 1-minute bar. */
export const TICKS_PER_BAR = 60;

/**
 * Simulated price path inside one 1-minute bar.
 *
 * Path goes open -> first extreme -> second extreme -> close. Up bars usually dip first
 * (open->low->high->close), down bars usually pop first; 25% of the time the other order.
 * Noise is added between waypoints but tapered to zero at each waypoint and clamped to
 * [low, high], so: tick[0] = open, tick[59] = close, the low and high are each hit
 * exactly once-or-more, and nothing ever goes outside the real bar.
 */
export function barTicks(bar: Bar, seed: number, n = TICKS_PER_BAR): number[] {
  const { o, h, l, c } = bar;
  const rnd = mulberry32(seed);
  const up = c >= o;
  const lowFirst = up ? rnd() < 0.75 : rnd() < 0.25;
  const e1 = lowFirst ? l : h;
  const e2 = lowFirst ? h : l;
  // waypoint tick indices: 0 < i1 < i2 < n-1
  const i1 = 1 + Math.floor(rnd() * Math.max(1, Math.floor((n - 3) * 0.5)));
  const i2 = Math.min(n - 2, i1 + 1 + Math.floor(rnd() * (n - 2 - i1)));
  const pts: [number, number][] = [[0, o], [i1, e1], [i2, e2], [n - 1, c]];
  const span = h - l;
  const out = new Array<number>(n);
  for (let s = 0; s < pts.length - 1; s++) {
    const [ia, pa] = pts[s];
    const [ib, pb] = pts[s + 1];
    for (let i = ia; i <= ib; i++) {
      const f = ib === ia ? 1 : (i - ia) / (ib - ia);
      const base = pa + (pb - pa) * f;
      const noise = (rnd() - 0.5) * span * 0.35 * Math.sin(Math.PI * f);
      out[i] = Math.min(h, Math.max(l, base + noise));
    }
  }
  out[0] = o;
  out[i1] = e1;
  out[i2] = e2;
  out[n - 1] = c;
  return out;
}

/** The bar as it looks after `k + 1` ticks (k = 0 .. n-1). Final tick gives the real bar. */
export function partialBar(bar: Bar, ticks: number[], k: number): Bar {
  if (k >= ticks.length - 1) return bar;
  let hi = ticks[0];
  let lo = ticks[0];
  for (let i = 1; i <= k; i++) {
    if (ticks[i] > hi) hi = ticks[i];
    if (ticks[i] < lo) lo = ticks[i];
  }
  return { t: bar.t, o: bar.o, h: hi, l: lo, c: ticks[k], v: Math.round((bar.v * (k + 1)) / ticks.length) };
}
