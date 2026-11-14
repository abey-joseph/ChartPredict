/**
 * Trading rules (pure, unit-tested):
 *  - One position at a time. Long/Short while flat opens; the opposite button while in a
 *    position reverses (close at the current price, open the other way at the same price).
 *  - On entry a stop is placed `stopPct` away (default 0.5%). Stop and optional target can be
 *    moved but must stay on the correct side of the current price.
 *  - A stop or target fills at its own price when a tick touches or crosses it.
 *  - P&L % = direction-signed (exit - entry) / entry * 100, minus the round-trip fee %.
 *  - R = net P&L % / stop distance % at entry (initial stop; moving the stop later doesn't change R's unit).
 */
export type Dir = 'long' | 'short';
export type ExitReason = 'stop' | 'target' | 'exit' | 'reverse' | 'end';

export interface Position {
  dir: Dir;
  entryPrice: number;
  entryTime: number;
  stopAtEntry: number;
  stop: number;
  target: number | null;
  speed: number;
  reasonTag: string | null;
}

export interface Trade {
  dir: Dir;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  exitReason: ExitReason;
  stopAtEntry: number;
  stopDistPct: number;
  finalStop: number;
  target: number | null;
  grossPct: number;
  feePct: number;
  netPct: number;
  r: number;
  holdSeconds: number;
  speed: number;
  reasonTag: string | null;
}

export function initialStop(dir: Dir, price: number, stopPct: number): number {
  return dir === 'long' ? price * (1 - stopPct / 100) : price * (1 + stopPct / 100);
}

export function defaultTarget(pos: Position, multipleOfStop = 2): number {
  const d = Math.abs(pos.entryPrice - pos.stopAtEntry) * multipleOfStop;
  return pos.dir === 'long' ? pos.entryPrice + d : pos.entryPrice - d;
}

export function grossPct(dir: Dir, entry: number, exit: number): number {
  return ((dir === 'long' ? exit - entry : entry - exit) / entry) * 100;
}

export function closePosition(pos: Position, exitPrice: number, exitTime: number, reason: ExitReason, feePct: number): Trade {
  const g = grossPct(pos.dir, pos.entryPrice, exitPrice);
  const net = g - feePct;
  const stopDistPct = (Math.abs(pos.entryPrice - pos.stopAtEntry) / pos.entryPrice) * 100;
  return {
    dir: pos.dir,
    entryTime: pos.entryTime,
    entryPrice: pos.entryPrice,
    exitTime,
    exitPrice,
    exitReason: reason,
    stopAtEntry: pos.stopAtEntry,
    stopDistPct,
    finalStop: pos.stop,
    target: pos.target,
    grossPct: g,
    feePct,
    netPct: net,
    r: stopDistPct > 0 ? net / stopDistPct : 0,
    holdSeconds: exitTime - pos.entryTime,
    speed: pos.speed,
    reasonTag: pos.reasonTag,
  };
}

export type Outcome = 'win' | 'loss' | 'no-trade';

export class TradeBook {
  pos: Position | null = null;
  trades: Trade[] = [];
  constructor(public feePct: number, public stopPct: number) {}

  open(dir: Dir, price: number, time: number, speed = 1, reasonTag: string | null = null): Trade | null {
    let closed: Trade | null = null;
    if (this.pos) {
      if (this.pos.dir === dir) return null;
      closed = this.close(price, time, 'reverse');
    }
    const stop = initialStop(dir, price, this.stopPct);
    this.pos = { dir, entryPrice: price, entryTime: time, stopAtEntry: stop, stop, target: null, speed, reasonTag };
    return closed;
  }

  close(price: number, time: number, reason: ExitReason): Trade | null {
    if (!this.pos) return null;
    const t = closePosition(this.pos, price, time, reason, this.feePct);
    this.trades.push(t);
    this.pos = null;
    return t;
  }

  /** Move the stop; clamped so it stays on the losing side of the current price. */
  setStop(price: number, current: number): void {
    if (!this.pos) return;
    const eps = current * 0.0001;
    this.pos.stop = this.pos.dir === 'long' ? Math.min(price, current - eps) : Math.max(price, current + eps);
  }

  /** Set / move / clear (null) the target; clamped to the winning side of the current price. */
  setTarget(price: number | null, current: number): void {
    if (!this.pos) return;
    if (price === null) {
      this.pos.target = null;
      return;
    }
    const eps = current * 0.0001;
    this.pos.target = this.pos.dir === 'long' ? Math.max(price, current + eps) : Math.min(price, current - eps);
  }

  /** Feed one tick. Returns the trade if the stop or target was hit. */
  onTick(price: number, time: number): Trade | null {
    const p = this.pos;
    if (!p) return null;
    if (p.dir === 'long') {
      if (price <= p.stop) return this.close(p.stop, time, 'stop');
      if (p.target !== null && price >= p.target) return this.close(p.target, time, 'target');
    } else {
      if (price >= p.stop) return this.close(p.stop, time, 'stop');
      if (p.target !== null && price <= p.target) return this.close(p.target, time, 'target');
    }
    return null;
  }

  /** Mark-to-market of the open position, net of fees. */
  openNetPct(price: number): number | null {
    if (!this.pos) return null;
    return grossPct(this.pos.dir, this.pos.entryPrice, price) - this.feePct;
  }

  totals(): { netPct: number; r: number; outcome: Outcome } {
    if (this.trades.length === 0) return { netPct: 0, r: 0, outcome: 'no-trade' };
    const netPct = this.trades.reduce((s, t) => s + t.netPct, 0);
    const r = this.trades.reduce((s, t) => s + t.r, 0);
    return { netPct, r, outcome: netPct > 0 ? 'win' : 'loss' };
  }
}
