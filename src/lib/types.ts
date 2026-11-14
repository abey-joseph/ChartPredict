/** [unixSecondsUTC, open, high, low, close, volume] — as written by data-pipeline */
export type RawBar = [number, number, number, number, number, number];

export type ScenarioType = 'flat' | 'choppy' | 'trend';
export type TimeBucket = 'open' | 'midday' | 'close';
export type Group = 'MU' | 'chips' | 'QQQ/TSLA';

export interface Tags {
  timeBucket: TimeBucket;
  rangePct: number;
  netMovePct: number;
  efficiency: number;
  type: ScenarioType;
  gapDay: boolean;
  bestLongPct: number;
  bestShortPct: number;
  hadTradeableMove: boolean;
}

export interface IndexEntry extends Tags {
  id: string;
  symbol: string;
  group: Group;
}

export interface Scenario {
  id: string;
  symbol: string;
  name: string;
  group: Group;
  date: string;
  startET: string;
  endET: string;
  sessionCloseET: string;
  startPrice: number;
  priorClose: number | null;
  dayOpen: number;
  warmup: RawBar[];
  sessionBreak: number | null;
  prevSessionDate: string | null;
  window: RawBar[];
  reveal: RawBar[];
  daily: RawBar[];
  filledBars: number;
  tags: Tags & { gapPct: number | null };
}

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const toBar = (r: RawBar): Bar => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] });
