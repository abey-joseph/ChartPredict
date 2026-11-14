import { describe, expect, it } from 'vitest';
import { Replay } from './replay';
import type { RawBar, Scenario } from './types';

function scenario(window: RawBar[]): Scenario {
  return {
    id: 'test', symbol: 'MU', name: 'Micron', group: 'MU', date: '2026-01-05', startET: '10:00', endET: '10:30',
    sessionCloseET: '16:00', startPrice: window[0][1], priorClose: 99, dayOpen: 100,
    warmup: [], sessionBreak: null, prevSessionDate: null, window, reveal: [], daily: [], filledBars: 0,
    tags: { timeBucket: 'midday', rangePct: 1, netMovePct: 0, efficiency: 0, type: 'choppy', gapDay: false, gapPct: 0, bestLongPct: 0, bestShortPct: 0, hadTradeableMove: false },
  };
}

// 30 bars: flat at 100 then bar 10 drops to 98.9 (through a 0.5% long stop at 99.5)
const win: RawBar[] = Array.from({ length: 30 }, (_, i) =>
  i === 10 ? [1_000_000 + i * 60, 100, 100, 98.9, 99, 1] : [1_000_000 + i * 60, i > 10 ? 99 : 100, i > 10 ? 99 : 100, i > 10 ? 99 : 100, i > 10 ? 99 : 100, 1],
);

describe('Replay', () => {
  it('cannot trade before play, then every tick is checked even across a big jump', () => {
    const r = new Replay(scenario(win), 0.05, 0.5);
    r.enter('long', 1);
    expect(r.book.pos).toBeNull();
    r.advanceTo(0);
    r.enter('long', 30);
    expect(r.book.pos!.entryPrice).toBe(100);
    const closed = r.advanceTo(25 * 60);        // one giant frame
    expect(closed).toHaveLength(1);
    expect(closed[0].exitReason).toBe('stop');
    expect(closed[0].exitPrice).toBeCloseTo(99.5, 10);
    expect(closed[0].exitTime).toBeGreaterThanOrEqual(1_000_000 + 600);
    expect(closed[0].exitTime).toBeLessThan(1_000_000 + 660);
  });

  it('open position auto-closes at the end of the window at the last close', () => {
    const r = new Replay(scenario(win), 0.05, 0.5);
    r.advanceTo(15 * 60);
    r.enter('short', 1);
    r.advanceTo(10_000);
    expect(r.ended).toBe(true);
    const t = r.book.trades[0];
    expect(t.exitReason).toBe('end');
    expect(t.exitPrice).toBe(99);
    expect(t.exitTime).toBe(1_000_000 + 29 * 60 + 59);
  });

  it('visible bars end with the forming bar and finish as the real bars', () => {
    const r = new Replay(scenario(win), 0.05, 0.5);
    expect(r.visibleBars()).toHaveLength(0);
    r.advanceTo(10 * 60 + 5);
    const v = r.visibleBars();
    expect(v).toHaveLength(11);
    expect(v[9]).toEqual(r.bars[9]);
    r.advanceTo(1e9);
    expect(r.visibleBars()).toEqual(r.bars);
  });

  it('skip before play is a no-trade', () => {
    const r = new Replay(scenario(win), 0.05, 0.5);
    r.end(true);
    expect(r.ended && r.endedEarly).toBe(true);
    expect(r.book.totals().outcome).toBe('no-trade');
  });
});
