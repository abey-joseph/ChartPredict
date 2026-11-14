import { openDB, type IDBPDatabase } from 'idb';
import type { Outcome, Trade } from './trading';
import type { Group, ScenarioType, TimeBucket } from './types';

export type Mode = 'random' | 'practice';

export interface Attempt {
  id: string;
  scenarioId: string;
  symbol: string;
  group: Group;
  createdAt: string;
  mode: Mode;
  blind: boolean;
  feePct: number;
  stopPct: number;
  speed: number;            // speed when the attempt ended
  speedsUsed: number[];
  noTrade: boolean;
  skipped: boolean;         // ended early with the Skip button
  outcome: Outcome;
  netPct: number;
  r: number;
  trades: Trade[];
  reasonTag: string | null; // journal tag (Phase 2)
  tags: { type: ScenarioType; timeBucket: TimeBucket; hadTradeableMove: boolean; bestLongPct: number; bestShortPct: number; gapDay: boolean };
}

const DB_NAME = 'chartpredict';
let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbp ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      const s = d.createObjectStore('attempts', { keyPath: 'id' });
      s.createIndex('scenarioId', 'scenarioId');
      s.createIndex('createdAt', 'createdAt');
    },
  });
  return dbp;
}

export async function saveAttempt(a: Attempt): Promise<void> {
  await (await db()).put('attempts', a);
}

export async function allAttempts(): Promise<Attempt[]> {
  return (await db()).getAllFromIndex('attempts', 'createdAt');
}

export async function attemptCounts(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const a of await allAttempts()) m.set(a.scenarioId, (m.get(a.scenarioId) ?? 0) + 1);
  return m;
}

export interface ExportFile {
  app: 'chart-predict';
  version: 1;
  exportedAt: string;
  attempts: Attempt[];
}

export async function exportAttempts(): Promise<ExportFile> {
  return { app: 'chart-predict', version: 1, exportedAt: new Date().toISOString(), attempts: await allAttempts() };
}

/** Merge by id (existing attempts with the same id are replaced). Returns how many were added/updated. */
export async function importAttempts(file: unknown): Promise<number> {
  const f = file as Partial<ExportFile>;
  if (!f || f.app !== 'chart-predict' || !Array.isArray(f.attempts)) throw new Error('Not a Chart Predict export file');
  const d = await db();
  const tx = d.transaction('attempts', 'readwrite');
  let n = 0;
  for (const a of f.attempts) {
    if (a && typeof a.id === 'string' && typeof a.scenarioId === 'string') {
      await tx.store.put(a);
      n++;
    }
  }
  await tx.done;
  return n;
}

/** Ask the browser not to evict our data (helps on iOS). */
export function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}
