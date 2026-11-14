import { CandlestickSeries, ColorType, createChart, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { RawBar } from '../lib/types';

interface Props {
  daily: RawBar[];
  scale: number;
  blind: boolean;
  /** dashed line at the price where the window starts */
  refPrice: number;
}

/** The last 5 completed daily candles before the scenario day. Labels are D-5..D-1 in blind mode. */
export default function DailyInset({ daily, scale, blind, refPrice }: Props) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const n = daily.length;
    const labelOf = new Map(daily.map((b, i) => {
      const d = new Date(b[0] * 1000);
      return [b[0], blind ? `D-${n - i}` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })];
    }));
    const chart = createChart(el.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#11151b' }, textColor: '#8b94a7', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false, tickMarkFormatter: (t: Time) => labelOf.get(t as number) ?? '' },
      localization: { timeFormatter: (t: Time) => labelOf.get(t as number) ?? '', priceFormatter: (x: number) => x.toFixed(2) },
      handleScroll: false,
      handleScale: false,
    });
    const s = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      priceLineVisible: false, lastValueVisible: false,
    });
    s.setData(daily.map((b) => ({ time: b[0] as UTCTimestamp, open: b[1] * scale, high: b[2] * scale, low: b[3] * scale, close: b[4] * scale })));
    s.createPriceLine({ price: refPrice * scale, color: '#c9d1e0', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'now' });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [daily, scale, blind, refPrice]);
  return <div className="daily-inset" ref={el} />;
}
