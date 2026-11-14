import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Attempt, Mode } from '../lib/db';
import { etClock, etTime, fmtDate, fmtDuration, fmtPct, fmtPrice, fmtR, priceScale } from '../lib/display';
import { Replay, SPEEDS } from '../lib/replay';
import type { Settings } from '../lib/settings';
import { defaultTarget, type Dir, type Trade } from '../lib/trading';
import { toBar, type Scenario } from '../lib/types';
import DailyInset from './DailyInset';
import ReplayChart, { type ChartBar } from './ReplayChart';

interface Props {
  scenario: Scenario;
  settings: Settings;
  mode: Mode;
  modeLabel: string;
  progress: { played: number; total: number };
  onSettings: (s: Partial<Settings>) => void;
  onAttempt: (a: Attempt) => Promise<void>;
  onNext: () => void;
  onOpenPicker: () => void;
  onOpenSettings: () => void;
  /** a sheet is open on top: pause */
  hold: boolean;
}

export default function Player(p: Props) {
  const { scenario: sc, settings } = p;
  const [replay] = useState(() => new Replay(sc, settings.feePct, settings.stopPct));
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const speed = settings.speed;
  const sim = useRef(0);
  const speedsUsed = useRef(new Set<number>());
  const saved = useRef(false);

  const book = replay.book;
  const blindNow = settings.blind && !revealed;
  const k = priceScale(sc, blindNow);
  const windowStart = sc.window[0][0];

  // ---------------------------------------------------------------- finish + save
  const finish = useCallback(() => {
    if (saved.current || !replay.ended) return;
    saved.current = true;
    setPlaying(false);
    const tot = book.totals();
    const a: Attempt = {
      id: crypto.randomUUID(),
      scenarioId: sc.id,
      symbol: sc.symbol,
      group: sc.group,
      createdAt: new Date().toISOString(),
      mode: p.mode,
      blind: settings.blind,
      feePct: book.feePct,
      stopPct: book.stopPct,
      speed,
      speedsUsed: [...speedsUsed.current].sort((a, b) => a - b),
      noTrade: book.trades.length === 0,
      skipped: replay.endedEarly && book.trades.length === 0,
      outcome: tot.outcome,
      netPct: tot.netPct,
      r: tot.r,
      trades: book.trades,
      reasonTag: book.trades[0]?.reasonTag ?? null,
      tags: {
        type: sc.tags.type, timeBucket: sc.tags.timeBucket, hadTradeableMove: sc.tags.hadTradeableMove,
        bestLongPct: sc.tags.bestLongPct, bestShortPct: sc.tags.bestShortPct, gapDay: sc.tags.gapDay,
      },
    };
    setAttempt(a);
    void p.onAttempt(a);
  }, [book, p, replay, sc, settings.blind, speed]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  // ---------------------------------------------------------------- clock
  useEffect(() => {
    if (!playing) return;
    speedsUsed.current.add(speed);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); // a stalled frame never skips ahead
      last = now;
      sim.current += dt * speed;
      const target = Math.floor(sim.current);
      if (target > replay.g) {
        replay.advanceTo(target);
        bump();
      }
      if (replay.ended) {
        finishRef.current();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, replay]);

  useEffect(() => {
    if (p.hold) setPlaying(false);
  }, [p.hold]);

  // pause when the app is hidden (phone locked, tab switched)
  useEffect(() => {
    const h = () => document.hidden && setPlaying(false);
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  // ---------------------------------------------------------------- actions
  const play = () => {
    if (replay.ended) return;
    if (!replay.started) {
      sim.current = 0;
      replay.advanceTo(0);
    }
    setPlaying((x) => !x);
  };
  const enter = (dir: Dir) => {
    if (!replay.canTrade()) return;
    replay.enter(dir, speed);
    speedsUsed.current.add(speed);
    bump();
  };
  const exit = () => {
    replay.exit();
    bump();
  };
  const skip = () => {
    if (book.pos) return;
    replay.end(true);
    bump();
    finish();
  };
  const toggleTarget = () => {
    if (!book.pos) return;
    book.setTarget(book.pos.target === null ? defaultTarget(book.pos) : null, replay.price);
    bump();
  };
  const dragStop = (displayPrice: number) => {
    book.setStop(displayPrice / k, replay.price);
    bump();
  };
  const dragTarget = (displayPrice: number) => {
    book.setTarget(displayPrice / k, replay.price);
    bump();
  };

  // keyboard (desktop): space play/pause, L long, S short, X exit, N next
  const keys = useRef({ play, enter, exit, skip, next: p.onNext, ended: false });
  keys.current = { play, enter, exit, skip, next: p.onNext, ended: replay.ended };
  const holdRef = useRef(p.hold);
  holdRef.current = p.hold;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || holdRef.current) return;
      const kk = keys.current;
      const key = e.key.toLowerCase();
      if (key === ' ') { e.preventDefault(); kk.play(); }
      else if (key === 'l') kk.enter('long');
      else if (key === 's') kk.enter('short');
      else if (key === 'x') kk.exit();
      else if (key === 'n' && kk.ended) kk.next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------- chart data
  const g = replay.g;
  const ended = replay.ended;
  const bars: ChartBar[] = useMemo(() => {
    const mk = (kind: ChartBar['kind']) => (r: { t: number; o: number; h: number; l: number; c: number; v: number }): ChartBar => ({
      time: r.t, open: r.o * k, high: r.h * k, low: r.l * k, close: r.c * k, volume: r.v, kind,
    });
    const out = sc.warmup.map(toBar).map(mk('warmup'));
    out.push(...replay.visibleBars().map(mk('window')));
    if (ended) out.push(...sc.reveal.map(toBar).map(mk('reveal')));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, ended, k, sc]);

  const barTime = (t: number) => windowStart + Math.floor((t - windowStart) / 60) * 60;
  const markers = useMemo(() => {
    const m: SeriesMarker<Time>[] = [];
    const add = (tr: { dir: Dir; entryTime: number }, exit?: Trade) => {
      m.push({
        time: barTime(tr.entryTime) as UTCTimestamp,
        position: tr.dir === 'long' ? 'belowBar' : 'aboveBar',
        shape: tr.dir === 'long' ? 'arrowUp' : 'arrowDown',
        color: tr.dir === 'long' ? '#26a69a' : '#ef5350',
        text: tr.dir === 'long' ? 'L' : 'S',
      });
      if (exit) {
        m.push({
          time: barTime(exit.exitTime) as UTCTimestamp,
          position: exit.dir === 'long' ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color: exit.netPct > 0 ? '#26a69a' : '#ef5350',
          text: exit.exitReason === 'stop' ? 'SL' : exit.exitReason === 'target' ? 'TP' : 'x',
        });
      }
    };
    book.trades.forEach((t) => add(t, t));
    if (book.pos) add(book.pos);
    return m.sort((a, b) => (a.time as number) - (b.time as number));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.trades.length, book.pos, windowStart]);

  const pos = book.pos;
  const lines = {
    entry: pos ? pos.entryPrice * k : null,
    stop: pos ? pos.stop * k : null,
    target: pos && pos.target !== null ? pos.target * k : null,
  };

  // ---------------------------------------------------------------- render bits
  const showIdentity = !settings.blind || revealed;
  const livePct = book.openNetPct(replay.price);
  const liveR = pos && livePct !== null ? livePct / ((Math.abs(pos.entryPrice - pos.stopAtEntry) / pos.entryPrice) * 100) : null;
  const barNo = replay.started ? replay.barIndex + 1 : 0;
  const tot = book.totals();

  return (
    <div className="player">
      <header className="topbar">
        <button className="chip" onClick={p.onOpenPicker} title="Choose scenarios">
          {p.modeLabel} ▾
        </button>
        <div className="title">
          {showIdentity ? (
            <span><b>{sc.symbol}</b> · {fmtDate(sc.date)}</span>
          ) : (
            <span className="muted">Blind · #{sc.id.slice(0, 6)}</span>
          )}
        </div>
        <span className="muted small">{p.progress.played}/{p.progress.total}</span>
        <button className="icon" onClick={p.onOpenSettings} aria-label="Settings">⚙</button>
      </header>

      <div className="stage">
        <div className="chart-area">
          <ReplayChart
            dataKey={`${sc.id}|${k}`}
            rangeKey={`${sc.id}|${ended}`}
            bars={bars}
            warmupLen={sc.warmup.length}
            totalSlots={sc.warmup.length + sc.window.length + (ended ? sc.reveal.length : 0)}
            breakTime={sc.sessionBreak === null ? null : sc.warmup[sc.sessionBreak]?.[0] ?? sc.window[0][0]}
            lines={lines}
            markers={markers}
            onDragStop={pos && !ended ? dragStop : undefined}
            onDragTarget={pos && !ended ? dragTarget : undefined}
          />
          <div className="overlay-tl">
            <button className={`chip small ${settings.showDaily ? 'on' : ''}`} onClick={() => p.onSettings({ showDaily: !settings.showDaily })}>
              5D
            </button>
            <span className="status">
              {!replay.started && <>Warm-up · window starts {etTime(windowStart)} ET</>}
              {replay.started && !ended && <>{etClock(replay.time)} ET · bar {barNo}/{sc.window.length}</>}
              {ended && <>Ended · next 60 min shown in blue</>}
            </span>
          </div>
          {settings.showDaily && (
            <div className="overlay-daily">
              <DailyInset daily={sc.daily} scale={k} blind={blindNow} refPrice={sc.window[0][1]} />
            </div>
          )}
          {sc.sessionBreak !== null && !ended && <div className="overlay-legend">yellow band = overnight gap</div>}
        </div>

        <aside className="panel">
          {!ended ? (
            <>
              <div className="row controls">
                <button className="play" onClick={play} aria-label={playing ? 'Pause' : 'Play'}>
                  {playing ? '❚❚' : '▶'}
                </button>
                <div className="speeds" role="group" aria-label="Speed">
                  {SPEEDS.map((s) => (
                    <button key={s} className={s === speed ? 'on' : ''} onClick={() => p.onSettings({ speed: s })}>
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
              <div className="progress"><div style={{ width: `${(replay.elapsed / replay.totalTicks) * 100}%` }} /></div>

              <div className={`position ${pos ? pos.dir : ''}`}>
                {pos ? (
                  <>
                    <div>
                      <b>{pos.dir.toUpperCase()}</b> @ {fmtPrice(pos.entryPrice * k)} · SL {fmtPrice(pos.stop * k)}
                      {pos.target !== null && <> · TP {fmtPrice(pos.target * k)}</>}
                    </div>
                    <div className={`pnl ${livePct! >= 0 ? 'pos' : 'neg'}`}>
                      {fmtPct(livePct!)} · {fmtR(liveR!)}
                    </div>
                    <button className="link" onClick={toggleTarget}>{pos.target === null ? '+ target' : '✕ target'}</button>
                  </>
                ) : (
                  <div className="muted">
                    {replay.started ? (book.trades.length ? `Flat · closed so far ${fmtPct(tot.netPct)} · ${fmtR(tot.r)}` : 'Flat') : 'Press ▶ to start the 30-minute window'}
                  </div>
                )}
              </div>

              <div className="actions">
                <button className="long" disabled={!replay.canTrade() || pos?.dir === 'long'} onClick={() => enter('long')}>
                  {pos?.dir === 'short' ? 'Reverse → Long' : 'Long'}
                </button>
                <button className="short" disabled={!replay.canTrade() || pos?.dir === 'short'} onClick={() => enter('short')}>
                  {pos?.dir === 'long' ? 'Reverse → Short' : 'Short'}
                </button>
                <button className="exit" disabled={!pos} onClick={exit}>Exit</button>
                <button className="skip" disabled={!!pos} onClick={skip}>
                  {book.trades.length ? 'Finish' : 'Skip / No trade'}
                </button>
              </div>
            </>
          ) : (
            <Result
              sc={sc}
              trades={book.trades}
              totals={tot}
              k={k}
              revealed={showIdentity}
              canReveal={settings.blind && !revealed}
              onReveal={() => setRevealed(true)}
              onNext={p.onNext}
              savedOk={attempt !== null}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function Result(r: {
  sc: Scenario;
  trades: Trade[];
  totals: { netPct: number; r: number; outcome: string };
  k: number;
  revealed: boolean;
  canReveal: boolean;
  onReveal: () => void;
  onNext: () => void;
  savedOk: boolean;
}) {
  const { sc, totals } = r;
  const label = totals.outcome === 'win' ? 'WIN' : totals.outcome === 'loss' ? 'LOSS' : 'NO TRADE';
  return (
    <div className="result">
      <div className={`outcome ${totals.outcome}`}>
        <span>{label}</span>
        {totals.outcome !== 'no-trade' && (
          <span className="big">{fmtPct(totals.netPct)} · {fmtR(totals.r)}</span>
        )}
      </div>
      {r.trades.length > 0 && (
        <table className="trades">
          <tbody>
            {r.trades.map((t, i) => (
              <tr key={i}>
                <td className={t.dir}>{t.dir === 'long' ? 'L' : 'S'}</td>
                <td>{fmtPrice(t.entryPrice * r.k)} → {fmtPrice(t.exitPrice * r.k)}</td>
                <td className="muted">{t.exitReason}</td>
                <td className="muted">{fmtDuration(t.holdSeconds)}</td>
                <td className={t.netPct >= 0 ? 'pos' : 'neg'}>{fmtPct(t.netPct)}</td>
                <td className={t.r >= 0 ? 'pos' : 'neg'}>{fmtR(t.r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Window {sc.tags.hadTradeableMove ? 'had' : 'had no'} tradeable move (best long {fmtPct(sc.tags.bestLongPct)}, best short {fmtPct(sc.tags.bestShortPct)}, before fees) · {sc.tags.type}
        {r.trades.length > 0 && <> · fee {r.trades[0].feePct}% per trade</>}
      </p>
      {r.revealed ? (
        <div className="identity">
          <div><b>{sc.name}</b> ({sc.symbol})</div>
          <div>{fmtDate(sc.date)} · {sc.startET}–{sc.endET} ET</div>
          <div>Window start ${fmtPrice(sc.startPrice)} · end ${fmtPrice(sc.window[sc.window.length - 1][4])}</div>
        </div>
      ) : null}
      <div className="actions two">
        {r.canReveal && <button className="reveal" onClick={r.onReveal}>Reveal</button>}
        <button className="next" onClick={r.onNext}>Next →</button>
      </div>
      {!r.savedOk && <p className="muted small">Saving…</p>}
    </div>
  );
}
