import type { Mode } from './db';
import type { Group, ScenarioType, TimeBucket } from './types';

export interface Settings {
  blind: boolean;
  feePct: number;
  stopPct: number;
  speed: number;
  showDaily: boolean;
}

export interface Filter {
  symbols: string[];
  types: ScenarioType[];
  buckets: TimeBucket[];
}

export interface PickerState {
  mode: Mode;
  filter: Filter;
}

export const DEFAULT_SETTINGS: Settings = { blind: true, feePct: 0.05, stopPct: 0.5, speed: 1, showDaily: false };
export const EMPTY_FILTER: Filter = { symbols: [], types: [], buckets: [] };
export const GROUP_OF: Record<string, Group> = {
  MU: 'MU', NVDA: 'chips', AMD: 'chips', AVGO: 'chips', TSM: 'chips', WDC: 'chips', QQQ: 'QQQ/TSLA', TSLA: 'QQQ/TSLA',
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode etc. */
  }
}

export const loadSettings = () => load('cp.settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => store('cp.settings', s);
export const loadPicker = () => load<PickerState>('cp.picker', { mode: 'random', filter: EMPTY_FILTER });
export const savePicker = (p: PickerState) => store('cp.picker', p);
