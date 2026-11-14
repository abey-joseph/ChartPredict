import { useCallback, useEffect, useMemo, useState } from 'react';
import Player from './components/Player';
import PickerSheet from './components/PickerSheet';
import SettingsSheet from './components/SettingsSheet';
import { attemptCounts, requestPersistence, saveAttempt, type Attempt } from './lib/db';
import { applyFilter, pickNext } from './lib/picker';
import { loadPicker, loadSettings, savePicker, saveSettings, type PickerState, type Settings } from './lib/settings';
import type { IndexEntry, Scenario } from './lib/types';

const BASE = import.meta.env.BASE_URL;

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [picker, setPicker] = useState<PickerState>(loadPicker);
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [sheet, setSheet] = useState<'none' | 'picker' | 'settings'>('none');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [seq, setSeq] = useState(0);          // remounts the player even if the same scenario comes back
  const [done, setDone] = useState(false);     // current scenario finished and saved

  const updateSettings = useCallback((s: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...s };
      saveSettings(next);
      return next;
    });
  }, []);

  const refreshCounts = useCallback(async () => setCounts(await attemptCounts()), []);

  useEffect(() => {
    requestPersistence();
    Promise.all([getJSON<{ scenarios: IndexEntry[] }>('scenarios/index.json'), attemptCounts()])
      .then(([idx, c]) => {
        setIndex(idx.scenarios);
        setCounts(c);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const loadNext = useCallback(
    async (state: PickerState = picker, avoid?: string) => {
      if (!index) return;
      const pool = state.mode === 'random' ? index : applyFilter(index, state.filter);
      const pick = pickNext(pool, await attemptCounts(), Math.random, avoid);
      if (!pick) return setError('No scenarios match this filter.');
      try {
        setScenario(await getJSON<Scenario>(`scenarios/${pick.id}.json`));
        setSeq((n) => n + 1);
        setDone(false);
        setError('');
      } catch (e) {
        setError(String(e));
      }
    },
    [index, picker],
  );

  // first scenario once the index is in
  useEffect(() => {
    if (index && !scenario) void loadNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const onAttempt = useCallback(
    async (a: Attempt) => {
      await saveAttempt(a);
      setDone(true);
      await refreshCounts();
    },
    [refreshCounts],
  );

  const pool = useMemo(() => (index ? (picker.mode === 'random' ? index : applyFilter(index, picker.filter)) : []), [index, picker]);
  const played = pool.filter((e) => (counts.get(e.id) ?? 0) > 0).length;
  const modeLabel =
    picker.mode === 'random'
      ? 'Random'
      : `Practice: ${[...picker.filter.symbols, ...picker.filter.types, ...picker.filter.buckets].join(' · ') || 'all'}`;
  const totalAttempts = [...counts.values()].reduce((a, b) => a + b, 0);

  if (error && !scenario) return <div className="splash">{error}</div>;
  if (!scenario) return <div className="splash">Loading scenarios…</div>;

  return (
    <>
      <Player
        key={`${scenario.id}-${seq}`}
        hold={sheet !== 'none'}
        scenario={scenario}
        settings={settings}
        mode={picker.mode}
        modeLabel={modeLabel}
        progress={{ played, total: pool.length }}
        onSettings={updateSettings}
        onAttempt={onAttempt}
        onNext={() => void loadNext(picker, scenario.id)}
        onOpenPicker={() => setSheet('picker')}
        onOpenSettings={() => setSheet('settings')}
      />
      {(error || toast) && <div className="toast" onClick={() => setToast('')}>{error || toast}</div>}
      {sheet === 'picker' && index && (
        <PickerSheet
          index={index}
          counts={counts}
          state={picker}
          onClose={() => setSheet('none')}
          onApply={(s) => {
            setPicker(s);
            savePicker(s);
            setSheet('none');
            // never abandon a scenario unrecorded: a new filter starts with the next one
            if (done) void loadNext(s, scenario.id);
            else {
              setToast('Applies from the next scenario. Finish or skip this one first.');
              setTimeout(() => setToast(''), 3500);
            }
          }}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          settings={settings}
          attempts={totalAttempts}
          onChange={updateSettings}
          onImported={refreshCounts}
          onClose={() => setSheet('none')}
        />
      )}
    </>
  );
}
