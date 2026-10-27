'use client';
/**
 * The rounds left, drawn as bullets down the left side of the screen (owner, 24 Oct 2026). It drains in real time.
 * One small 2D canvas, redrawn at most once per animation frame and only when the count changes, so 1,500 tx/s
 * costs nothing.
 *  - up to 50 rounds: one big bullet each.
 *  - more: tiny bullets packed densely. With huge counts each tiny mark stands for N rounds (N is fixed from the
 *    rounds loaded, so marks disappear in real time as rounds go out). The exact count sits on top in big numbers.
 */
import { useEffect, useRef } from 'react';
import { Icon, Ticker } from '../coinop/ui';

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
        // Big rounds, bottom up: a bright brass case with a hot tip.
        const bh = Math.min(16, (h - 4) / BIG_MAX);
        for (let i = 0; i < L; i++) {
          const y = h - (i + 1) * bh;
          const cg = g.createLinearGradient(0, y, 0, y + bh);
          cg.addColorStop(0, '#ffe29a');
          cg.addColorStop(1, '#b07a1c');
          g.fillStyle = cg;
          g.fillRect(4, y + bh * 0.2, w * 0.62, bh * 0.62);
          g.fillStyle = '#ff5a3c';
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
      // Teal at the bottom to amber at the top of the stack: a fuel gauge you can read at a glance.
      const lg = g.createLinearGradient(0, h, 0, 0);
      lg.addColorStop(0, '#3fd8e8');
      lg.addColorStop(0.6, '#8fe3c8');
      lg.addColorStop(1, '#ffb62e');
      g.fillStyle = lg;
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

  const low = loaded > 0 && left / Math.max(1, loaded) < 0.1;
  return (
    <div className="tbx-in-l tbx-glass pointer-events-none absolute bottom-16 left-1.5 top-[138px] z-10 flex w-[52px] flex-col items-center gap-1 px-1 py-2 sm:left-3 sm:top-[116px] sm:w-[72px]" data-ammo-col aria-label={`${left.toLocaleString('en-US')} rounds left`} data-ammo-column>
      <Icon name="bullet" size={14} className={low ? 'text-[var(--tbx-red)]' : 'text-[var(--tbx-amber)]'} />
      <Ticker value={left} ease={0.3} className="text-center text-[clamp(12px,1.5vw,18px)] font-bold leading-none" style={{ color: low ? 'var(--tbx-red)' : 'var(--tbx-text)' }} />
      <span className="text-[8px] font-semibold tracking-[0.25em] text-[var(--tbx-dim)]">ROUNDS</span>
      <span ref={perRef} className="text-[8px] text-[var(--tbx-mute)]" />
      <canvas ref={cv} className="mt-0.5 min-h-0 w-full flex-1 basis-0 rounded bg-black/40" />
    </div>
  );
}
