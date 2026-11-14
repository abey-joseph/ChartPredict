import type { Scenario } from './types';

/** Blind mode: every price is multiplied by this so the window starts at exactly 100. */
export function priceScale(s: Scenario, blind: boolean): number {
  return blind ? 100 / s.window[0][1] : 1;
}

const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
const etFmtSec = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export const etTime = (unix: number) => etFmt.format(unix * 1000);
export const etClock = (unix: number) => etFmtSec.format(unix * 1000);

export function fmtPct(x: number, digits = 2): string {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(digits)}%`;
}

export function fmtR(x: number): string {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(2)}R`;
}

export function fmtPrice(x: number): string {
  return x.toFixed(2);
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
