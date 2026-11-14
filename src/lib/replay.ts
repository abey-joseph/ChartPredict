import { hashString } from './rng';
import { barTicks, partialBar, TICKS_PER_BAR } from './ticks';
import { TradeBook, type Dir, type Trade } from './trading';
import { toBar, type Bar, type Scenario } from './types';

export const SPEEDS = [1, 5, 10, 30] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Drives one scenario: simulated clock over the 30-minute window, one tick per simulated
 * second (60 per bar), every tick fed to the TradeBook in order so stops/targets can't be
 * skipped even when a frame covers several ticks.
 */
export class Replay {
  readonly bars: Bar[];
  readonly ticks: number[][];
  readonly totalTicks: number;
  readonly book: TradeBook;
  /** last processed global tick (-1 = not started) */
  g = -1;
  ended = false;
  endedEarly = false;

  constructor(readonly scenario: Scenario, feePct: number, stopPct: number) {
    this.bars = scenario.window.map(toBar);
    const seed = hashString(scenario.id);
    this.ticks = this.bars.map((b, i) => barTicks(b, (seed + i * 7919) >>> 0));
    this.totalTicks = this.bars.length * TICKS_PER_BAR;
    this.book = new TradeBook(feePct, stopPct);
  }

  get started(): boolean {
    return this.g >= 0;
  }
  get barIndex(): number {
    return Math.max(0, Math.floor(this.g / TICKS_PER_BAR));
  }
  get tickInBar(): number {
    return Math.max(0, this.g % TICKS_PER_BAR);
  }
  /** seconds of window elapsed (0 .. 1800) */
  get elapsed(): number {
    return this.g + 1;
  }

  priceAt(g: number): number {
    return this.ticks[Math.floor(g / TICKS_PER_BAR)][g % TICKS_PER_BAR];
  }
  timeAt(g: number): number {
    return this.bars[Math.floor(g / TICKS_PER_BAR)].t + (g % TICKS_PER_BAR);
  }
  get price(): number {
    return this.priceAt(Math.max(0, this.g));
  }
  get time(): number {
    return this.timeAt(Math.max(0, this.g));
  }

  /** Window bars visible right now: completed ones plus the forming one. */
  visibleBars(): Bar[] {
    if (!this.started) return [];
    const i = this.barIndex;
    const out = this.bars.slice(0, i);
    out.push(partialBar(this.bars[i], this.ticks[i], this.tickInBar));
    return out;
  }

  /** Advance to global tick `target`, processing every tick on the way. Returns trades closed by stop/target. */
  advanceTo(target: number): Trade[] {
    if (this.ended) return [];
    const last = this.totalTicks - 1;
    const to = Math.min(target, last);
    const closed: Trade[] = [];
    while (this.g < to) {
      this.g++;
      const t = this.book.onTick(this.priceAt(this.g), this.timeAt(this.g));
      if (t) closed.push(t);
    }
    if (this.g >= last) this.end();
    return closed;
  }

  /** Called when the window runs out (or the user skips/finishes): flatten at the current price. */
  end(early = false): void {
    if (this.ended) return;
    if (!this.started) this.g = 0;
    this.book.close(this.price, this.time, 'end');
    this.ended = true;
    this.endedEarly = early;
  }

  canTrade(): boolean {
    return this.started && !this.ended;
  }

  enter(dir: Dir, speed: number, reasonTag: string | null = null): void {
    if (!this.canTrade()) return;
    this.book.open(dir, this.price, this.time, speed, reasonTag);
  }

  exit(): void {
    if (!this.canTrade()) return;
    this.book.close(this.price, this.time, 'exit');
  }
}
