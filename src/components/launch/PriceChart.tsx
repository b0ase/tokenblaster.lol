'use client';

import { AreaSeries, CandlestickSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { marketCap, price } from '@/lib/launch/curve';
import type { Trade } from './data';

const FRAMES = [
  ['1m', 60],
  ['5m', 300],
  ['15m', 900],
  ['1h', 3600],
  ['4h', 14400],
  ['1d', 86400],
] as const;

/** Candles (or a line) of price or market cap, built from the coin's trades. */
export function PriceChart({ trades, rate }: { trades: Trade[]; rate: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [frame, setFrame] = useState<number>(300);
  const [kind, setKind] = useState<'candles' | 'line'>('candles');
  const [metric, setMetric] = useState<'mcap' | 'price'>('mcap');
  const [unit, setUnit] = useState<'usd' | 'bsv'>('usd');

  const points = useMemo(() => {
    const t = trades.filter((x) => x.side !== 'burn').slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const scale = unit === 'usd' && rate ? rate / 1e8 : 1 / 1e8;
    return t.map((x) => {
      const sold = BigInt(x.sold_after);
      const v = metric === 'mcap' ? marketCap(sold) * scale : price(sold) * (unit === 'usd' && rate ? rate / 1e8 : 1) * 1e6; // price per 1M tokens
      return { time: Math.floor(new Date(x.created_at).getTime() / 1000), v };
    });
  }, [trades, metric, unit, rate]);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      height: 320,
      layout: { background: { type: ColorType.Solid, color: '#050202' }, textColor: '#e0958a', fontFamily: 'Courier New, monospace' },
      grid: { vertLines: { color: '#2a0a0a' }, horzLines: { color: '#2a0a0a' } },
      rightPriceScale: { borderColor: '#4a1414' },
      timeScale: { borderColor: '#4a1414', timeVisible: true },
      autoSize: true,
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const fmt = (p: number) => (unit === 'usd' ? `$${p >= 1 ? p.toFixed(2) : p.toPrecision(3)}` : p >= 1 ? p.toFixed(3) : p.toPrecision(3));
    const series =
      kind === 'candles'
        ? c.addSeries(CandlestickSeries, { upColor: '#4ade80', downColor: '#f87171', borderVisible: false, wickUpColor: '#4ade80', wickDownColor: '#f87171', priceFormat: { type: 'custom', formatter: fmt } })
        : c.addSeries(AreaSeries, { lineColor: '#ff5a48', topColor: 'rgba(255,90,72,0.35)', bottomColor: 'rgba(255,90,72,0)', priceFormat: { type: 'custom', formatter: fmt } });
    if (kind === 'candles') {
      const bars = new Map<number, { time: UTCTimestamp; open: number; high: number; low: number; close: number }>();
      let prev: number | null = null;
      for (const p of points) {
        const t = (Math.floor(p.time / frame) * frame) as UTCTimestamp;
        const b = bars.get(t);
        if (!b) bars.set(t, { time: t, open: prev ?? p.v, high: Math.max(prev ?? p.v, p.v), low: Math.min(prev ?? p.v, p.v), close: p.v });
        else Object.assign(b, { high: Math.max(b.high, p.v), low: Math.min(b.low, p.v), close: p.v });
        prev = p.v;
      }
      series.setData([...bars.values()]);
    } else {
      const seen = new Map<number, number>();
      for (const p of points) seen.set(p.time, p.v);
      series.setData([...seen].map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    }
    c.timeScale().fitContent();
    return () => {
      c.removeSeries(series);
    };
  }, [points, frame, kind, unit]);

  return (
    <div className="panel">
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        {FRAMES.map(([label, s]) => (
          <button key={label} className={`btn ${frame === s ? 'btn-on' : ''}`} onClick={() => setFrame(s)}>
            {label}
          </button>
        ))}
        <span className="mx-1 text-muted">|</span>
        <button className={`btn ${kind === 'line' ? 'btn-on' : ''}`} onClick={() => setKind('line')}>
          Line
        </button>
        <button className={`btn ${kind === 'candles' ? 'btn-on' : ''}`} onClick={() => setKind('candles')}>
          Candles
        </button>
        <span className="mx-1 text-muted">|</span>
        <button className={`btn ${metric === 'price' ? 'btn-on' : ''}`} onClick={() => setMetric('price')}>
          Price
        </button>
        <button className={`btn ${metric === 'mcap' ? 'btn-on' : ''}`} onClick={() => setMetric('mcap')}>
          MCap
        </button>
        <span className="mx-1 text-muted">|</span>
        <button className={`btn ${unit === 'usd' ? 'btn-on' : ''}`} onClick={() => setUnit('usd')} disabled={!rate}>
          USD
        </button>
        <button className={`btn ${unit === 'bsv' ? 'btn-on' : ''}`} onClick={() => setUnit('bsv')}>
          BSV
        </button>
        <span className="ml-auto text-muted">{metric === 'price' ? 'per 1M tokens' : 'market cap'}</span>
      </div>
      <div ref={box} className="h-[320px] w-full" />
      <p className="mt-1 text-[10px] text-muted">
        Charts by TradingView Lightweight Charts™ · Copyright (c) 2025 TradingView, Inc. ·{' '}
        <a href="https://www.tradingview.com" className="underline">
          tradingview.com
        </a>
      </p>
    </div>
  );
}
