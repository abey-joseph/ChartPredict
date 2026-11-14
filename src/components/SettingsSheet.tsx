import { useRef, useState } from 'react';
import { exportAttempts, importAttempts } from '../lib/db';
import type { Settings } from '../lib/settings';

interface Props {
  settings: Settings;
  attempts: number;
  onChange: (s: Partial<Settings>) => void;
  onImported: () => void;
  onClose: () => void;
}

export default function SettingsSheet({ settings, attempts, onChange, onImported, onClose }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const doExport = async () => {
    const data = await exportAttempts();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chart-predict-attempts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setMsg(`Exported ${data.attempts.length} attempts.`);
  };

  const doImport = async (f: File) => {
    try {
      const n = await importAttempts(JSON.parse(await f.text()));
      setMsg(`Imported ${n} attempts (merged; existing ones kept).`);
      onImported();
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  };

  const num = (v: string, lo: number, hi: number, fallback: number) => {
    const x = parseFloat(v);
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label className="toggle">
          <input type="checkbox" checked={settings.blind} onChange={(e) => onChange({ blind: e.target.checked })} />
          <span>
            <b>Blind mode</b>
            <span className="muted small"> — prices rebased so the window starts at 100; no stock, date or real price until you tap Reveal</span>
          </span>
        </label>
        <div className="field">
          <label htmlFor="fee">Fee, round trip (%)</label>
          <input id="fee" type="number" inputMode="decimal" step="0.01" min="0" max="1" defaultValue={settings.feePct}
            onBlur={(e) => onChange({ feePct: num(e.target.value, 0, 1, settings.feePct) })} />
        </div>
        <div className="field">
          <label htmlFor="stop">Initial stop distance (%)</label>
          <input id="stop" type="number" inputMode="decimal" step="0.05" min="0.05" max="5" defaultValue={settings.stopPct}
            onBlur={(e) => onChange({ stopPct: num(e.target.value, 0.05, 5, settings.stopPct) })} />
        </div>
        <p className="muted small">Fee and stop changes apply from the next scenario.</p>

        <h3>Your data</h3>
        <p className="muted small">{attempts} attempts saved on this device. Export now and then; iOS can clear site data.</p>
        <div className="actions two">
          <button onClick={doExport}>Export JSON</button>
          <button onClick={() => file.current?.click()}>Import JSON</button>
        </div>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        {msg && <p className="small">{msg}</p>}

        <h3>Keys (desktop)</h3>
        <p className="muted small">Space play/pause · L long · S short · X exit · N next</p>
        <div className="actions"><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
