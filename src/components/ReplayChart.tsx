import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { etTime } from '../lib/display';

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  kind: 'warmup' | 'window' | 'reveal';
}

export interface Lines {
  entry: number | null;
  stop: number | null;
  target: number | null;
}

interface Props {
  /** changes when the whole series must be redrawn (new scenario, blind <-> real prices) */
  dataKey: string;
  /** changes when the visible range should be reset */
  rangeKey: string;
  bars: ChartBar[];
  warmupLen: number;
  totalSlots: number;            // warm-up + window (+ reveal) bars the range should make room for
  breakTime: number | null;      // first bar of the scenario day when warm-up crosses sessions
  lines: Lines;
  markers: SeriesMarker<Time>[];
  onDragStop?: (displayPrice: number) => void;
  onDragTarget?: (displayPrice: number) => void;
}

const COLORS = {
  up: '#26a69a',
  down: '#ef5350',
  upWarm: 'rgba(38,166,154,0.55)',
  downWarm: 'rgba(239,83,80,0.55)',
  upReveal: '#5c9dff',
  downReveal: '#9a7cff',
};

function candleColor(b: ChartBar): string {
  const up = b.close >= b.open;
  if (b.kind === 'warmup') return up ? COLORS.upWarm : COLORS.downWarm;
  if (b.kind === 'reveal') return up ? COLORS.upReveal : COLORS.downReveal;
  return up ? COLORS.up : COLORS.down;
}

function toCandle(b: ChartBar): CandlestickData<Time> {
  const c = candleColor(b);
  return { time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close, color: c, borderColor: c, wickColor: c };
}

function toVol(b: ChartBar): HistogramData<Time> {
  const up = b.close >= b.open;
  const a = b.kind === 'window' ? 0.45 : 0.22;
  const color = b.kind === 'reveal' ? `rgba(92,157,255,${a})` : up ? `rgba(38,166,154,${a})` : `rgba(239,83,80,${a})`;
  return { time: b.time as UTCTimestamp, value: b.volume, color };
}

export default function ReplayChart(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const vols = useRef<ISeriesApi<'Histogram'> | null>(null);
  const brk = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLines = useRef<Partial<Record<keyof Lines, IPriceLine>>>({});
  const drawn = useRef({ key: '', len: 0 });
  const dragging = useRef(false);
  const [handleY, setHandleY] = useState<{ stop: number | null; target: number | null; right: number; h: number }>({ stop: null, target: null, right: 60, h: 0 });

  // ---- create chart once
  useLayoutEffect(() => {
    const el = wrap.current!;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0b0e11' }, textColor: '#8b94a7', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
        // never show dates on the axis (blind mode) — always HH:MM New York time
        tickMarkFormatter: (t: Time) => etTime(t as number),
      },
      localization: { timeFormatter: (t: Time) => `${etTime(t as number)} ET`, priceFormatter: (x: number) => x.toFixed(2) },
    });
    brk.current = chart.addSeries(HistogramSeries, { priceScaleId: 'brk', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('brk').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    vols.current = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    candles.current = chart.addSeries(CandlestickSeries, { priceLineVisible: false, lastValueVisible: true });
    markersApi.current = createSeriesMarkers(candles.current, []);
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      priceLines.current = {};
      drawn.current = { key: '', len: 0 };
    };
  }, []);

  // ---- bars: full redraw on key change, otherwise incremental updates
  useEffect(() => {
    const cs = candles.current!, vs = vols.current!;
    const d = drawn.current;
    if (d.key !== p.dataKey || p.bars.length < d.len) {
      cs.setData(p.bars.map(toCandle));
      vs.setData(p.bars.map(toVol));
    } else {
      for (let i = Math.max(0, d.len - 1); i < p.bars.length; i++) {
        cs.update(toCandle(p.bars[i]));
        vs.update(toVol(p.bars[i]));
      }
    }
    drawn.current = { key: p.dataKey, len: p.bars.length };
  }, [p.dataKey, p.bars]);

  // ---- overnight gap band
  useEffect(() => {
    brk.current!.setData(p.breakTime === null ? [] : [{ time: p.breakTime as UTCTimestamp, value: 1, color: 'rgba(255,214,102,0.10)' }]);
  }, [p.breakTime, p.dataKey]);

  // ---- visible range
  useEffect(() => {
    const chart = chartRef.current!;
    const narrow = (wrap.current?.clientWidth ?? 800) < 600;
    const from = narrow ? Math.max(0, p.warmupLen - 40) : 0;
    chart.timeScale().setVisibleLogicalRange({ from: from - 0.5, to: p.totalSlots + 1.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rangeKey]);

  // ---- autoscale: keep entry / SL / TP in view. Frozen while dragging so the scale can't run away.
  const applyAutoscale = (l: Lines) => {
    const vals = [l.entry, l.stop, l.target].filter((x): x is number => x !== null);
    candles.current!.applyOptions({
      autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = orig();
        if (!r || !r.priceRange || vals.length === 0) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...vals), maxValue: Math.max(r.priceRange.maxValue, ...vals) } };
      },
    });
  };
  useEffect(() => {
    if (!dragging.current) applyAutoscale(p.lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.lines.entry, p.lines.stop, p.lines.target]);

  // ---- price lines
  useEffect(() => {
    const cs = candles.current!;
    const spec: Record<keyof Lines, { color: string; title: string; style: LineStyle }> = {
      entry: { color: '#c9d1e0', title: 'Entry', style: LineStyle.Dotted },
      stop: { color: COLORS.down, title: 'SL', style: LineStyle.Dashed },
      target: { color: COLORS.up, title: 'TP', style: LineStyle.Dashed },
    };
    (Object.keys(spec) as (keyof Lines)[]).forEach((k) => {
      const price = p.lines[k];
      const existing = priceLines.current[k];
      if (price === null) {
        if (existing) cs.removePriceLine(existing);
        delete priceLines.current[k];
      } else if (existing) {
        existing.applyOptions({ price });
      } else {
        priceLines.current[k] = cs.createPriceLine({ price, color: spec[k].color, lineWidth: 1, lineStyle: spec[k].style, axisLabelVisible: true, title: spec[k].title });
      }
    });
  }, [p.lines.entry, p.lines.stop, p.lines.target, p.dataKey]);

  useEffect(() => {
    markersApi.current!.setMarkers(p.markers);
  }, [p.markers]);

  // ---- keep drag handles glued to their lines (cheap: 2 lookups per frame)
  const linesRef = useRef(p.lines);
  linesRef.current = p.lines;
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const cs = candles.current, chart = chartRef.current;
      if (cs && chart) {
        const { stop, target } = linesRef.current;
        const ys = stop === null ? null : cs.priceToCoordinate(stop);
        const yt = target === null ? null : cs.priceToCoordinate(target);
        const right = chart.priceScale('right').width() + 4;
        const h = chart.paneSize().height;
        // off-scale prices come back as null or outside the pane: pin them to the edge
        const pin = (price: number | null, y: number | null) =>
          price === null ? null : y === null ? (price > (cs.coordinateToPrice(h / 2) ?? 0) ? -1 : h + 1) : y;
        const a = pin(stop, ys), t = pin(target, yt);
        const sig = `${a?.toFixed(1)}|${t?.toFixed(1)}|${right}|${h}`;
        if (sig !== last) {
          last = sig;
          setHandleY({ stop: a, target: t, right, h });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const startDrag = (which: 'stop' | 'target') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    dragging.current = true;
    const move = (ev: PointerEvent) => {
      const rect = wrap.current!.getBoundingClientRect();
      const price = candles.current!.coordinateToPrice(ev.clientY - rect.top);
      if (price === null) return;
      (which === 'stop' ? p.onDragStop : p.onDragTarget)?.(price);
    };
    const up = () => {
      dragging.current = false;
      applyAutoscale(linesRef.current);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const place = (y: number) => Math.min(Math.max(y, 16), Math.max(16, handleY.h - 16));
  const arrow = (y: number) => (y < 0 ? '↑' : y > handleY.h ? '↓' : '⇅');
  return (
    <div className="chart-wrap" ref={wrap}>
      {handleY.stop !== null && p.onDragStop && (
        <div className="drag-handle stop" style={{ top: place(handleY.stop), right: handleY.right }} onPointerDown={startDrag('stop')} aria-label="Drag stop">
          SL {arrow(handleY.stop)}
        </div>
      )}
      {handleY.target !== null && p.onDragTarget && (
        <div className="drag-handle target" style={{ top: place(handleY.target), right: handleY.right }} onPointerDown={startDrag('target')} aria-label="Drag target">
          TP {arrow(handleY.target)}
        </div>
      )}
    </div>
  );
}
