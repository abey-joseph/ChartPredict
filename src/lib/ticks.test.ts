import { describe, expect, it } from 'vitest';
import { barTicks, partialBar, TICKS_PER_BAR } from './ticks';

const bars = [
  { t: 0, o: 100, h: 101, l: 99.5, c: 100.8, v: 6000 },
  { t: 60, o: 100.8, h: 100.9, l: 99.9, c: 100, v: 600 },
  { t: 120, o: 50, h: 50, l: 50, c: 50, v: 0 },            // flat (filled) bar
  { t: 180, o: 10, h: 10.02, l: 10, c: 10.02, v: 10 },     // open = low, close = high
];

describe('simulated ticks', () => {
  it('start at open, end at close, touch high and low, never leave the bar', () => {
    for (const b of bars) {
      for (let seed = 0; seed < 200; seed++) {
        const t = barTicks(b, seed);
        expect(t).toHaveLength(TICKS_PER_BAR);
        expect(t[0]).toBe(b.o);
        expect(t[TICKS_PER_BAR - 1]).toBe(b.c);
        expect(Math.max(...t)).toBe(b.h);
        expect(Math.min(...t)).toBe(b.l);
      }
    }
  });

  it('is deterministic per seed', () => {
    expect(barTicks(bars[0], 42)).toEqual(barTicks(bars[0], 42));
    expect(barTicks(bars[0], 42)).not.toEqual(barTicks(bars[0], 43));
  });

  it('partial bar grows into the real bar', () => {
    const t = barTicks(bars[0], 7);
    const p0 = partialBar(bars[0], t, 0);
    expect(p0).toMatchObject({ o: 100, h: 100, l: 100, c: 100 });
    let prevH = p0.h, prevL = p0.l;
    for (let k = 1; k < TICKS_PER_BAR; k++) {
      const p = partialBar(bars[0], t, k);
      expect(p.h).toBeGreaterThanOrEqual(prevH);
      expect(p.l).toBeLessThanOrEqual(prevL);
      expect(p.c).toBe(t[k]);
      prevH = p.h; prevL = p.l;
    }
    expect(partialBar(bars[0], t, TICKS_PER_BAR - 1)).toEqual(bars[0]);
  });
});
