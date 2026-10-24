'use client';
/**
 * The rounds left, drawn as bullets down the side of the screen (owner, 24 Oct 2026). One small 2D canvas,
 * redrawn at most once per animation frame and only when the count changes, so 1,500 tx/s costs nothing.
 *  - up to 50 rounds: one big bullet each.
 *  - more: tiny bullets packed densely. With huge counts each tiny mark stands for N rounds (N is fixed from the
 *    rounds loaded, so marks disappear in real time as rounds go out). The exact count sits on top in big numbers.
 */
import { useEffect, useRef } from 'react';
import { DR } from '@/lib/dr/tokens';

const BIG_MAX = 50;
const CW = 4; // tiny bullet cell, px
const CH = 3;

export function AmmoColumn({ left, loaded }: { left: number; loaded: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const want = useRef({ left, loaded });
  const raf = useRef(0);
  const perRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    want.current = { left, loaded };
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const c = cv.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const { left: L, loaded: T } = want.current;
      const total = Math.max(T, L);
      if (total <= BIG_MAX) {
        // Big bullets, bottom up: brass case + copper tip.
        const bh = Math.min(16, (h - 4) / BIG_MAX);
        for (let i = 0; i < L; i++) {
          const y = h - (i + 1) * bh;
          g.fillStyle = '#c8962a';
          g.fillRect(4, y + bh * 0.2, w * 0.62, bh * 0.62);
          g.fillStyle = '#e07a3a';
          g.beginPath();
          g.moveTo(4 + w * 0.62, y + bh * 0.2);
          g.lineTo(w - 4, y + bh * 0.51);
          g.lineTo(4 + w * 0.62, y + bh * 0.82);
          g.fill();
        }
        if (perRef.current) perRef.current.textContent = '';
        return;
      }
      const cols = Math.max(1, Math.floor((w - 2) / CW));
      const rows = Math.max(1, Math.floor((h - 2) / CH));
      const per = Math.max(1, Math.ceil(total / (cols * rows)));
      const marks = Math.ceil(L / per);
      g.fillStyle = DR.colour.amber;
      for (let i = 0; i < marks; i++) {
        const r = Math.floor(i / cols);
        const col = i % cols;
        g.fillRect(1 + col * CW, h - 1 - (r + 1) * CH, CW - 1, CH - 1);
      }
      if (perRef.current) perRef.current.textContent = per > 1 ? `1 = ${per.toLocaleString('en-US')}` : '';
    });
  }, [left, loaded]);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0; // so a remount (React dev double-mount) can draw again
    },
    [],
  );

  return (
    <div className="pointer-events-none absolute bottom-16 left-1 top-[200px] flex w-[48px] flex-col items-center gap-0.5 sm:left-2 sm:w-[68px]" aria-label={`${left} rounds left`} data-ammo-column>
      <span className="bg-black/70 px-1 text-center font-mono text-[clamp(12px,1.6vw,20px)] font-bold leading-none tabular-nums" style={{ color: DR.colour.amber }}>
        {left.toLocaleString('en-US')}
      </span>
      <span className="font-mono text-[8px] tracking-widest text-dim">ROUNDS</span>
      <span ref={perRef} className="font-mono text-[8px] text-dim" />
      <canvas ref={cv} className="min-h-0 w-full flex-1 basis-0 bg-black/45" />
    </div>
  );
}
