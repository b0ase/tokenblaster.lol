'use client';

import { useEffect, useRef } from 'react';

export type GrainApi = {
  /** A transaction landed: throw `n` hairline ticks onto the frame. */
  tick: (n: number, big?: boolean) => void;
};

type Fleck = { x: number; y: number; w: number; h: number; life: number; dens: number; rgb: [number, number, number] };

const hex = (s: string): [number, number, number] | null => {
  const m = s.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Signal grain over the hero: sparse single-pixel specks and short hairline flecks that flicker in place (never
 * fall), in the palette's paper / red / amber, plus horizontal scan tears now and then. Chain-reactive: the base
 * density follows the live tx rate (`pulse`) and every transaction throws a tick onto the frame (`tick()`), a
 * big one a whole burst. Pauses off-screen and in hidden tabs. Nothing under reduced motion.
 */
export function SignalGrain({ pulse, reduce, onApi, opacity = 0.7 }: { pulse: { current: { rate: number } }; reduce: boolean; onApi?: (api: GrainApi | null) => void; opacity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cb = useRef(onApi);
  useEffect(() => {
    cb.current = onApi;
  });

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || reduce) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0;
    const size = () => {
      const r = c.getBoundingClientRect();
      W = c.width = Math.max(1, Math.round(r.width * dpr));
      H = c.height = Math.max(1, Math.round(r.height * dpr));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);

    // palette (re-read now and then: ?palette= can switch it live)
    let cols: [number, number, number][] = [[242, 239, 230], [232, 38, 29], [255, 184, 0]];
    const readPalette = () => {
      const cs = getComputedStyle(document.documentElement);
      const got = [cs.getPropertyValue('--text'), cs.getPropertyValue('--accent-fill'), cs.getPropertyValue('--accent-2')].map(hex);
      if (got.every(Boolean)) cols = got as [number, number, number][];
    };
    readPalette();
    const palT = setInterval(readPalette, 2500);

    const flecks: Fleck[] = [];
    const tears: { y: number; h: number; dx: number; life: number }[] = [];
    const spawn = (big = false) => {
      const vertical = Math.random() < 0.7;
      const len = ((big ? 10 : 3) + Math.random() * (big ? 60 : 22)) * dpr;
      flecks.push({
        x: (Math.random() * W) | 0,
        y: (Math.random() * H) | 0,
        w: vertical ? (Math.random() < 0.8 ? 1 : 2) : len | 0,
        h: vertical ? len | 0 : 1,
        life: 1 + ((Math.random() * (big ? 6 : 3)) | 0),
        dens: 0.2 + Math.random() * 0.4,
        rgb: cols[(Math.random() * 3) | 0],
      });
    };
    cb.current?.({
      tick: (n, big) => {
        for (let i = 0; i < n && flecks.length < 160; i++) spawn(big);
        if (big) tears.push({ y: Math.random() * H, h: (4 + Math.random() * 30) * dpr, dx: (Math.random() - 0.5) * 60 * dpr, life: 3 });
      },
    });

    let vis = true;
    const io = new IntersectionObserver((es) => {
      vis = es[0]?.isIntersecting ?? true;
    });
    io.observe(c);
    let raf = 0, frame = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!vis || document.hidden) return;
      // ~30 fps is plenty for grain and halves the cost
      if (frame++ % 2) return;
      ctx.clearRect(0, 0, W, H);
      const rate = Math.min(40, pulse.current.rate);
      // specks: a sparse base, denser with the chain
      const N = ((W * H) / 2600) * (0.1 + rate / 80);
      for (let i = 0; i < N; i++) {
        const a = Math.random(), k = cols[(Math.random() * 3) | 0];
        ctx.fillStyle = `rgba(${k[0]},${k[1]},${k[2]},${(0.05 + a * a * 0.3).toFixed(3)})`;
        ctx.fillRect((Math.random() * W) | 0, (Math.random() * H) | 0, 1, 1);
      }
      const want = Math.max(3, ((W * H) / 150000) | 0) + ((rate / 2) | 0);
      while (flecks.length < want) spawn();
      for (let f = flecks.length - 1; f >= 0; f--) {
        const k = flecks[f];
        // a dotted hairline: each pixel on or off by the fleck's density
        ctx.fillStyle = `rgb(${k.rgb[0]},${k.rgb[1]},${k.rgb[2]})`;
        if (k.h > k.w) for (let y = 0; y < k.h; y++) { if (Math.random() < k.dens) ctx.fillRect(k.x, k.y + y, k.w, 1); }
        else for (let x = 0; x < k.w; x++) { if (Math.random() < k.dens) ctx.fillRect(k.x + x, k.y, 1, 1); }
        if (--k.life <= 0) flecks.splice(f, 1);
      }
      // scan tears: a band of the frame shoved sideways, drawn as a paper hairline pair
      for (let t = tears.length - 1; t >= 0; t--) {
        const z = tears[t];
        ctx.fillStyle = `rgba(${cols[0][0]},${cols[0][1]},${cols[0][2]},0.35)`;
        ctx.fillRect(0, z.y, W, 1);
        ctx.fillRect(z.dx, z.y + z.h, W, 1);
        if (--z.life <= 0) tears.splice(t, 1);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(palT);
      io.disconnect();
      ro.disconnect();
      cb.current?.(null);
    };
  }, [reduce, pulse]);

  return <canvas ref={ref} className="tbh-fill" style={{ opacity, mixBlendMode: 'screen' }} aria-hidden="true" />;
}
