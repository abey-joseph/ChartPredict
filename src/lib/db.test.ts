import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { allAttempts, attemptCounts, exportAttempts, importAttempts, saveAttempt, type Attempt } from './db';

const a = (id: string, scenarioId: string, createdAt: string) =>
  ({ id, scenarioId, createdAt, trades: [], outcome: 'no-trade' } as unknown as Attempt);

describe('attempt storage', () => {
  it('saves, counts, exports and re-imports', async () => {
    await saveAttempt(a('1', 'x', '2026-01-01T00:00:00Z'));
    await saveAttempt(a('2', 'x', '2026-01-02T00:00:00Z'));
    await saveAttempt(a('3', 'y', '2026-01-03T00:00:00Z'));
    expect((await attemptCounts()).get('x')).toBe(2);
    const file = await exportAttempts();
    expect(file.attempts.map((t) => t.id)).toEqual(['1', '2', '3']);
    const roundTrip = JSON.parse(JSON.stringify({ ...file, attempts: [...file.attempts, a('4', 'z', '2026-01-04T00:00:00Z')] }));
    expect(await importAttempts(roundTrip)).toBe(4);
    expect((await allAttempts()).length).toBe(4);   // merged by id, no duplicates
    await expect(importAttempts({ hello: 1 })).rejects.toThrow();
  });
});
