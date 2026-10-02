'use client';

import { useEffect, useRef, useState } from 'react';
import { PACKS, formatCount, formatUsd, packSats, usd } from '@/lib/pricing';

/**
 * The gun: pick a pack, see its price in dollars, fire. Firing for real needs the pack server
 * (pay once, it fires the blasts for your token), so for now Fire runs a practice burst on screen
 * only: nothing is sent and nothing is paid.
 */
export function Gun() {
  const [i, setI] = useState(1);
  const [bsvUsd, setBsvUsd] = useState<number | null>(null);
  const [fired, setFired] = useState(0);
  const [firing, setFiring] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const bullets = useRef<{ x: number; y: number; v: number }[]>([]);

  useEffect(() => {
    fetch('/api/price')
      .then((r) => r.json())
      .then((d: { bsvUsd?: number }) => d.bsvUsd && setBsvUsd(d.bsvUsd))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0;
    const draw = () => {
      const w = (c.width = c.clientWidth * devicePixelRatio);
      const h = (c.height = c.clientHeight * devicePixelRatio);
      ctx.fillStyle = '#0b0b10';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd24d';
      for (const b of bullets.current) {
        b.x += b.v * devicePixelRatio;
        ctx.fillRect(b.x, b.y * h, 14 * devicePixelRatio, 3 * devicePixelRatio);
      }
      bullets.current = bullets.current.filter((b) => b.x < w);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pack = PACKS[i];
  const sats = packSats(pack);

  const practice = () => {
    if (firing) return;
    setFiring(true);
    const total = pack;
    const started = performance.now();
    const ms = 3000;
    const tick = () => {
      const t = Math.min(1, (performance.now() - started) / ms);
      setFired(Math.round(total * t));
      for (let k = 0; k < 6; k++) bullets.current.push({ x: 0, y: 0.15 + Math.random() * 0.7, v: 10 + Math.random() * 14 });
      if (t < 1) requestAnimationFrame(tick);
      else setFiring(false);
    };
    setFired(0);
    requestAnimationFrame(tick);
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-[#2a2a35] bg-[#14141c] p-5">
      <canvas ref={canvas} className="h-40 w-full rounded-lg border border-[#2a2a35]" aria-hidden />
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-xs tracking-widest text-[#a8a8b8]">PACK</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setI((v) => Math.max(0, v - 1))}
              disabled={i === 0}
              className="h-9 w-9 rounded-lg border border-[#2a2a35] text-white disabled:opacity-30"
              aria-label="Smaller pack"
            >
              ‹
            </button>
            <span className="w-20 text-center font-mono text-3xl font-bold text-[#9f8]">{formatCount(pack)}</span>
            <button
              onClick={() => setI((v) => Math.min(PACKS.length - 1, v + 1))}
              disabled={i === PACKS.length - 1}
              className="h-9 w-9 rounded-lg border border-[#2a2a35] text-white disabled:opacity-30"
              aria-label="Bigger pack"
            >
              ›
            </button>
          </div>
          <span className="font-mono text-lg text-white">{bsvUsd ? formatUsd(usd(sats, bsvUsd)) : '…'}</span>
          <span className="font-mono text-xs text-[#a8a8b8]">{sats.toLocaleString()} sats</span>
        </div>
        <div className="flex flex-1 flex-col items-center gap-2">
          <button
            onClick={practice}
            disabled={firing}
            className="rounded-xl bg-[#ffd24d] px-8 py-3 font-mono text-lg font-bold text-black disabled:opacity-60"
          >
            {firing ? 'FIRING…' : 'FIRE'}
          </button>
          <span className="text-center text-xs text-[#a8a8b8]">
            Practice burst: nothing is sent or paid. Real packs arrive with the pack server.
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="font-mono text-xs tracking-widest text-[#a8a8b8]">FIRED</span>
          <span className="font-mono text-3xl font-bold text-white">{fired.toLocaleString()}</span>
        </div>
      </div>
    </section>
  );
}
