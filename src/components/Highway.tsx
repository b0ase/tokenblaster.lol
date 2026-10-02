'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChainStats } from '@/lib/chain';

const LANES = 5;
const COLORS = ['#ffd24d', '#7cf', '#f6a', '#9f8', '#fff'];

/**
 * Bare-bones "highway": each car is a transaction. Until we decode the live transaction stream,
 * traffic density follows the mempool size from /api/chain (polled every 5 s).
 */
export function Highway() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<ChainStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/chain')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((s: ChainStats) => alive && (setStats(s), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    type Car = { lane: number; x: number; speed: number; color: string; w: number };
    const cars: Car[] = [];
    // Cars per frame scale with the mempool (capped so the canvas stays readable).
    const rate = Math.min(1.5, (stats?.mempoolTxs ?? 200) / 2000);
    let frame = 0;
    const draw = () => {
      const w = (c.width = c.clientWidth * devicePixelRatio);
      const h = (c.height = c.clientHeight * devicePixelRatio);
      const lane = h / LANES;
      ctx.fillStyle = '#0b0b10';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2a2a35';
      ctx.setLineDash([20 * devicePixelRatio, 16 * devicePixelRatio]);
      for (let i = 1; i < LANES; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * lane);
        ctx.lineTo(w, i * lane);
        ctx.stroke();
      }
      if (Math.random() < rate) {
        const l = Math.floor(Math.random() * LANES);
        cars.push({ lane: l, x: -60, speed: 2 + Math.random() * 4, color: COLORS[l], w: 30 + Math.random() * 40 });
      }
      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        car.x += car.speed * devicePixelRatio;
        if (car.x > w + 80) {
          cars.splice(i, 1);
          continue;
        }
        ctx.fillStyle = car.color;
        ctx.fillRect(car.x, car.lane * lane + lane * 0.3, car.w * devicePixelRatio, lane * 0.4);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [stats?.mempoolTxs]);

  return (
    <section className="flex flex-col gap-3">
      <canvas ref={canvas} className="h-56 w-full rounded-xl border border-[#2a2a35]" aria-label="Live BSV traffic" />
      <div className="flex flex-wrap gap-4 font-mono text-sm text-[#a8a8b8]">
        {error && <span className="text-[#f77]">Chain data unavailable, retrying…</span>}
        {stats && (
          <>
            <span>Block {stats.height.toLocaleString()}</span>
            <span>Mempool {stats.mempoolTxs.toLocaleString()} tx</span>
            <span>{(stats.mempoolBytes / 1e6).toFixed(2)} MB</span>
          </>
        )}
      </div>
    </section>
  );
}
