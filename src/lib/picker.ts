import type { Filter } from './settings';
import type { IndexEntry } from './types';

export function applyFilter(pool: IndexEntry[], f: Filter): IndexEntry[] {
  return pool.filter(
    (e) =>
      (f.symbols.length === 0 || f.symbols.includes(e.symbol)) &&
      (f.types.length === 0 || f.types.includes(e.type)) &&
      (f.buckets.length === 0 || f.buckets.includes(e.timeBucket)),
  );
}

/**
 * Uniform pick among the least-played scenarios of the pool: nothing repeats until every
 * scenario in the pool has been played, and drawing from the whole pool keeps the
 * MU 60% / chips 25% / QQQ+TSLA 15% mix.
 */
export function pickNext(
  pool: IndexEntry[],
  counts: Map<string, number>,
  rnd: () => number = Math.random,
  avoidId?: string,
): IndexEntry | null {
  if (pool.length === 0) return null;
  let min = Infinity;
  for (const e of pool) min = Math.min(min, counts.get(e.id) ?? 0);
  let cands = pool.filter((e) => (counts.get(e.id) ?? 0) === min);
  if (cands.length > 1 && avoidId) cands = cands.filter((e) => e.id !== avoidId);
  return cands[Math.floor(rnd() * cands.length)];
}

export function unseenCount(pool: IndexEntry[], counts: Map<string, number>): number {
  return pool.reduce((n, e) => n + ((counts.get(e.id) ?? 0) === 0 ? 1 : 0), 0);
}
