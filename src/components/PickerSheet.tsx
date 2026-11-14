import { useMemo, useState } from 'react';
import { applyFilter, unseenCount } from '../lib/picker';
import { EMPTY_FILTER, type Filter, type PickerState } from '../lib/settings';
import type { IndexEntry, ScenarioType, TimeBucket } from '../lib/types';

const SYMBOLS = ['MU', 'NVDA', 'AMD', 'AVGO', 'TSM', 'WDC', 'QQQ', 'TSLA'];
const TYPES: ScenarioType[] = ['flat', 'choppy', 'trend'];
const BUCKETS: TimeBucket[] = ['open', 'midday', 'close'];

interface Props {
  index: IndexEntry[];
  counts: Map<string, number>;
  state: PickerState;
  onApply: (s: PickerState) => void;
  onClose: () => void;
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function PickerSheet({ index, counts, state, onApply, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>(state.filter);
  const pool = useMemo(() => applyFilter(index, filter), [index, filter]);
  const allUnseen = unseenCount(index, counts);

  const Chips = <T extends string>({ items, sel, on }: { items: T[]; sel: T[]; on: (v: T) => void }) => (
    <div className="chips">
      {items.map((x) => (
        <button key={x} className={`chip ${sel.includes(x) ? 'on' : ''}`} onClick={() => on(x)}>{x}</button>
      ))}
    </div>
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Scenarios</h2>
        <button className="primary block" onClick={() => onApply({ mode: 'random', filter: EMPTY_FILTER })}>
          Next random <span className="muted small">— whole pool, {allUnseen} of {index.length} unplayed</span>
        </button>
        <p className="muted small">
          Random keeps the real mix (60% MU, 25% other chips, 15% QQQ/TSLA) and doesn't repeat a scenario until you've played them all.
          It's the mode to use when you're measuring skill.
        </p>

        <h3>Practice filter</h3>
        <label className="lbl">Stock</label>
        <Chips items={SYMBOLS} sel={filter.symbols} on={(v) => setFilter({ ...filter, symbols: toggle(filter.symbols, v) })} />
        <label className="lbl">Type</label>
        <Chips items={TYPES} sel={filter.types} on={(v) => setFilter({ ...filter, types: toggle(filter.types, v) })} />
        <label className="lbl">Time of day</label>
        <Chips items={BUCKETS} sel={filter.buckets} on={(v) => setFilter({ ...filter, buckets: toggle(filter.buckets, v) })} />
        <p className="muted small">
          {pool.length} match · {unseenCount(pool, counts)} unplayed. Practice attempts are labelled so the stats can keep them
          apart, because knowing the type in advance is a hint.
        </p>
        <div className="actions two">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={pool.length === 0} onClick={() => onApply({ mode: 'practice', filter })}>
            Practice these
          </button>
        </div>
      </div>
    </div>
  );
}
