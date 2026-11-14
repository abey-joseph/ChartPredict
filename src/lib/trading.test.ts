import { describe, expect, it } from 'vitest';
import { closePosition, initialStop, TradeBook } from './trading';

describe('P&L, R and fees — hand-calculated', () => {
  it('long: 100.00 -> 101.00, 0.5% stop, 0.05% fee', () => {
    // gross = +1.00%, net = 1.00 - 0.05 = 0.95%, stop distance 0.5% -> R = 0.95 / 0.5 = 1.9
    const b = new TradeBook(0.05, 0.5);
    b.open('long', 100, 1000);
    expect(b.pos!.stop).toBeCloseTo(99.5, 10);
    const t = b.close(101, 1300, 'exit')!;
    expect(t.grossPct).toBeCloseTo(1.0, 10);
    expect(t.netPct).toBeCloseTo(0.95, 10);
    expect(t.stopDistPct).toBeCloseTo(0.5, 10);
    expect(t.r).toBeCloseTo(1.9, 10);
    expect(t.holdSeconds).toBe(300);
    expect(b.totals()).toEqual({ netPct: expect.closeTo(0.95, 10), r: expect.closeTo(1.9, 10), outcome: 'win' });
  });

  it('short stopped out: 50.00, stop 50.25 -> -0.55%, -1.1R', () => {
    const b = new TradeBook(0.05, 0.5);
    b.open('short', 50, 0);
    expect(b.pos!.stop).toBeCloseTo(50.25, 10);
    expect(b.onTick(50.2, 1)).toBeNull();
    const t = b.onTick(50.31, 2)!;            // gaps through the stop: fills AT the stop
    expect(t.exitReason).toBe('stop');
    expect(t.exitPrice).toBeCloseTo(50.25, 10);
    expect(t.grossPct).toBeCloseTo(-0.5, 10);
    expect(t.netPct).toBeCloseTo(-0.55, 10);
    expect(t.r).toBeCloseTo(-1.1, 10);
    expect(b.pos).toBeNull();
    expect(b.totals().outcome).toBe('loss');
  });

  it('a scratch trade loses the fee', () => {
    const t = closePosition({ dir: 'long', entryPrice: 200, entryTime: 0, stopAtEntry: 199, stop: 199, target: null, speed: 1, reasonTag: null }, 200, 60, 'exit', 0.05);
    expect(t.netPct).toBeCloseTo(-0.05, 10);
    expect(t.r).toBeCloseTo(-0.1, 10);          // stop 0.5% away
  });

  it('fee is configurable', () => {
    const b = new TradeBook(0.2, 1);
    b.open('long', 100, 0);
    expect(b.pos!.stop).toBeCloseTo(99, 10);
    const t = b.close(102, 1, 'exit')!;
    expect(t.netPct).toBeCloseTo(1.8, 10);
    expect(t.r).toBeCloseTo(1.8, 10);
  });
});

describe('stop / target triggers', () => {
  it('long target fills at the target price', () => {
    const b = new TradeBook(0.05, 0.5);
    b.open('long', 100, 0);
    b.setTarget(101, 100);
    expect(b.onTick(100.99, 1)).toBeNull();
    const t = b.onTick(101.4, 2)!;
    expect(t.exitReason).toBe('target');
    expect(t.exitPrice).toBe(101);
    expect(t.netPct).toBeCloseTo(0.95, 10);
  });

  it('touching the stop exactly triggers it', () => {
    const b = new TradeBook(0.05, 0.5);
    b.open('long', 100, 0);
    expect(b.onTick(99.5, 1)!.exitReason).toBe('stop');
  });

  it('short target', () => {
    const b = new TradeBook(0, 0.5);
    b.open('short', 100, 0);
    b.setTarget(99, 100);
    expect(b.onTick(99.0, 1)!.exitReason).toBe('target');
  });

  it('dragged stop is used for the fill but R keeps the initial stop distance', () => {
    const b = new TradeBook(0.05, 0.5);
    b.open('long', 100, 0);
    b.setStop(100.2, 100.6);          // trail into profit while price is 100.6
    const t = b.onTick(100.1, 5)!;
    expect(t.exitPrice).toBeCloseTo(100.2, 10);
    expect(t.finalStop).toBeCloseTo(100.2, 10);
    expect(t.netPct).toBeCloseTo(0.15, 10);
    expect(t.r).toBeCloseTo(0.3, 10);  // 0.15 / 0.5
  });

  it('stop and target are clamped to the correct side of price', () => {
    const b = new TradeBook(0, 0.5);
    b.open('long', 100, 0);
    b.setStop(101, 100);               // can't put a long stop above price
    expect(b.pos!.stop).toBeLessThan(100);
    b.setTarget(99, 100);              // nor a target below it
    expect(b.pos!.target!).toBeGreaterThan(100);
    b.setTarget(null, 100);
    expect(b.pos!.target).toBeNull();
    b.open('short', 100, 1);
    b.setStop(99, 100);
    expect(b.pos!.stop).toBeGreaterThan(100);
  });

  it('reverse closes then opens the other way at the same price', () => {
    const b = new TradeBook(0.05, 0.5);
    b.open('long', 100, 0);
    expect(b.open('long', 101, 1)).toBeNull();   // same direction: ignored
    const closed = b.open('short', 101, 2)!;
    expect(closed.exitReason).toBe('reverse');
    expect(closed.netPct).toBeCloseTo(0.95, 10);
    expect(b.pos!.dir).toBe('short');
    expect(b.pos!.entryPrice).toBe(101);
    expect(b.pos!.stop).toBeCloseTo(initialStop('short', 101, 0.5), 10);
    b.close(100, 3, 'end');
    expect(b.trades).toHaveLength(2);
    expect(b.totals().netPct).toBeCloseTo(0.95 + (1 / 101) * 100 - 0.05, 10);
  });

  it('no trades -> no-trade', () => {
    expect(new TradeBook(0.05, 0.5).totals().outcome).toBe('no-trade');
  });
});
