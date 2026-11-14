import { describe, expect, it } from 'vitest';
import { applyFilter, pickNext } from './picker';
import { mulberry32 } from './rng';
import type { IndexEntry } from './types';

const e = (id: string, symbol: string, type = 'choppy', timeBucket = 'midday'): IndexEntry =>
  ({ id, symbol, group: 'MU', type, timeBucket } as IndexEntry);

describe('picker', () => {
  it('never repeats until every scenario has been seen', () => {
    const pool = Array.from({ length: 50 }, (_, i) => e(`s${i}`, 'MU'));
    const counts = new Map<string, number>();
    const rnd = mulberry32(1);
    for (let round = 1; round <= 3; round++) {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const p = pickNext(pool, counts, rnd)!;
        expect(seen.has(p.id)).toBe(false);
        seen.add(p.id);
        counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
      }
      expect(seen.size).toBe(50);
    }
  });

  it('keeps the pool mix (60/25/15) when drawing from the whole pool', () => {
    const pool = [
      ...Array.from({ length: 600 }, (_, i) => e(`m${i}`, 'MU')),
      ...Array.from({ length: 250 }, (_, i) => e(`c${i}`, 'NVDA')),
      ...Array.from({ length: 150 }, (_, i) => e(`q${i}`, 'QQQ')),
    ];
    const rnd = mulberry32(5);
    const tally: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) {
      const p = pickNext(pool, new Map(), rnd)!;
      tally[p.symbol] = (tally[p.symbol] ?? 0) + 1;
    }
    expect(tally.MU / 20000).toBeCloseTo(0.6, 1);
    expect(tally.NVDA / 20000).toBeCloseTo(0.25, 1);
    expect(tally.QQQ / 20000).toBeCloseTo(0.15, 1);
  });

  it('filters by stock, type and bucket', () => {
    const pool = [e('a', 'MU', 'trend', 'open'), e('b', 'MU', 'flat', 'open'), e('c', 'QQQ', 'trend', 'close')];
    expect(applyFilter(pool, { symbols: ['MU'], types: ['trend'], buckets: [] }).map((x) => x.id)).toEqual(['a']);
    expect(applyFilter(pool, { symbols: [], types: [], buckets: ['close'] }).map((x) => x.id)).toEqual(['c']);
    expect(pickNext([], new Map())).toBeNull();
  });

  it('avoids immediately repeating the current scenario when it can', () => {
    const pool = [e('a', 'MU'), e('b', 'MU')];
    for (let i = 0; i < 20; i++) expect(pickNext(pool, new Map(), Math.random, 'a')!.id).toBe('b');
  });
});
