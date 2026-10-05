'use client';

import { useEffect, useRef, useState } from 'react';
import { KINDS, type FeedTx, type TxKind } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';
import { useChainFeed } from '@/lib/useChainFeed';

/**
 * Chain Frogger: cross the road where the traffic is the BSV mainnet, live. Every car is a real
 * transaction from the GorillaPool JungleBus stream: its lane is what it carries, its length is its
 * size, token transfers show the token's icon and name. Get hit and you see exactly which
 * transaction ran you over.
 */
const COLS = 13;
const LANES: TxKind[] = ['payment', 'data', 'social', 'inscription', 'token', 'payment', 'data', 'social'];
const ROWS = LANES.length + 2; // safe rows top and bottom
const BEST = 'tokenblaster:frogger-best';

type Car = { f: FeedTx; x: number; w: number; lane: number };

export function Frogger() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const feed = useChainFeed();
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [best, setBest] = useState(0);
  const [killer, setKiller] = useState<FeedTx | null>(null);
  const [over, setOver] = useState(false);
  const [started, setStarted] = useState(false);
  const control = useRef<{ move: (dx: number, dy: number) => void; restart: () => void } | null>(null);

  useEffect(() => {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(BEST) ?? 0);
    } catch {
      /* storage blocked */
    }
    void Promise.resolve().then(() => setBest(saved)); // after mount: storage is client-only
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const cars: Car[] = [];
    let frog = { x: Math.floor(COLS / 2), y: ROWS - 1 };
    let hop = 0; // hop animation 0..1
    let pts = 0;
    let lifeLeft = 3;
    let dead = 0; // time of last death (brief splat pause)
    let level = 1;
    let raf = 0;
    let last = performance.now();
    const laneDir = (l: number) => (l % 2 ? -1 : 1);
    const laneSpeed = (l: number) => (0.9 + (l % 3) * 0.35) * (1 + (level - 1) * 0.15); // cells per second

    const move = (dx: number, dy: number) => {
      if (lifeLeft <= 0 || performance.now() - dead < 600) return;
      setStarted(true);
      frog = { x: Math.max(0, Math.min(COLS - 1, frog.x + dx)), y: Math.max(0, Math.min(ROWS - 1, frog.y + dy)) };
      hop = 1;
      if (frog.y === 0) {
        pts++;
        level = 1 + Math.floor(pts / 3);
        setScore(pts);
        try {
          if (pts > Number(localStorage.getItem(BEST) ?? 0)) {
            localStorage.setItem(BEST, String(pts));
            setBest(pts);
          }
        } catch {
          /* storage blocked */
        }
        frog = { x: Math.floor(COLS / 2), y: ROWS - 1 };
      }
    };
    const restart = () => {
      pts = 0;
      lifeLeft = 3;
      level = 1;
      frog = { x: Math.floor(COLS / 2), y: ROWS - 1 };
      setScore(0);
      setLives(3);
      setOver(false);
      setKiller(null);
    };
    control.current = { move, restart };

    const key = (e: KeyboardEvent) => {
      const k = e.key;
      const d = k === 'ArrowUp' || k === 'w' ? [0, -1] : k === 'ArrowDown' || k === 's' ? [0, 1] : k === 'ArrowLeft' || k === 'a' ? [-1, 0] : k === 'ArrowRight' || k === 'd' ? [1, 0] : null;
      if (!d) return;
      e.preventDefault();
      move(d[0], d[1]);
    };
    window.addEventListener('keydown', key);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dpr = devicePixelRatio;
      const w = (c.width = c.clientWidth * dpr);
      const h = (c.height = c.clientHeight * dpr);
      const cell = w / COLS;
      const row = h / ROWS;

      // Spawn: each lane takes the next live tx of its kind when there's room at its entry edge.
      LANES.forEach((kind, i) => {
        const lane = i + 1;
        const dir = laneDir(lane);
        const entry = cars.filter((car) => car.lane === lane).reduce((m, car) => Math.min(m, dir > 0 ? car.x : COLS - (car.x + car.w)), Infinity);
        if (entry < 1.2) return;
        const f = feedRef.current.take((t) => t.kind === kind || (kind === 'token' && t.kind === 'blast'));
        if (!f) return;
        const len = f.token ? 3 : Math.max(1, Math.min(4, Math.log2(f.bytes) / 3));
        cars.push({ f, w: len, lane, x: dir > 0 ? -len : COLS });
      });

      // Move cars.
      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        car.x += laneDir(car.lane) * laneSpeed(car.lane) * dt;
        if (car.x > COLS + 1 || car.x + car.w < -1) cars.splice(i, 1);
      }

      // Collision.
      if (lifeLeft > 0 && now - dead > 600) {
        const hit = cars.find((car) => car.lane === frog.y && frog.x + 0.8 > car.x && frog.x + 0.2 < car.x + car.w);
        if (hit) {
          dead = now;
          lifeLeft--;
          setLives(lifeLeft);
          setKiller(hit.f);
          if (lifeLeft <= 0) setOver(true);
          frog = { x: Math.floor(COLS / 2), y: ROWS - 1 };
        }
      }

      // Road.
      ctx.fillStyle = '#050202';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1a0b0b';
      ctx.fillRect(0, 0, w, row);
      ctx.fillRect(0, h - row, w, row);
      ctx.strokeStyle = '#3a1010';
      ctx.setLineDash([16 * dpr, 12 * dpr]);
      for (let r = 2; r < ROWS - 1; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * row);
        ctx.lineTo(w, r * row);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = `${9 * dpr}px monospace`;
      ctx.fillStyle = '#7a3a30';
      LANES.forEach((k, i) => ctx.fillText(KINDS.find((x) => x.id === k)!.label.toUpperCase(), 4 * dpr, (i + 1) * row + 10 * dpr));
      ctx.fillText('SAFE · MEMPOOL SHORE', 4 * dpr, 10 * dpr);
      ctx.fillText('START', 4 * dpr, h - row + 10 * dpr);

      // Cars.
      for (const car of cars) {
        const kind = car.f.kind === 'blast' ? 'blast' : LANES[car.lane - 1];
        const col = KINDS.find((k) => k.id === kind)?.color ?? '#ff5a48';
        const x = car.x * cell;
        const y = car.lane * row + row * 0.18;
        const cw = car.w * cell - 4 * dpr;
        const ch = row * 0.64;
        ctx.fillStyle = col;
        ctx.fillRect(x, y, cw, ch);
        ctx.fillStyle = car.f.mined ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';
        ctx.fillRect(x, y + ch * 0.78, cw, ch * 0.22);
        const meta = car.f.token ? tokenMeta(car.f.token) : null;
        if (meta) {
          const s = ch * 0.8;
          if (meta.icon?.complete && meta.icon.naturalWidth) ctx.drawImage(meta.icon, x + 3 * dpr, y + (ch - s) / 2, s, s);
          ctx.fillStyle = '#0a0404';
          ctx.font = `bold ${Math.max(9, ch / dpr / 2.4) * dpr}px monospace`;
          ctx.fillText(`$${meta.sym}`, x + s + 6 * dpr, y + ch * 0.6, Math.max(0, cw - s - 8 * dpr));
        }
      }

      // Frog.
      hop = Math.max(0, hop - dt * 6);
      const fx = frog.x * cell + cell / 2;
      const fy = frog.y * row + row / 2 - Math.sin(hop * Math.PI) * row * 0.25;
      const fr = Math.min(cell, row) * 0.36;
      const splat = now - dead < 600;
      ctx.fillStyle = splat ? '#ff2a2a' : '#5dff7a';
      ctx.beginPath();
      ctx.ellipse(fx, fy, fr, fr * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!splat) {
        ctx.fillStyle = '#0a0404';
        ctx.beginPath();
        ctx.arc(fx - fr * 0.4, fy - fr * 0.45, fr * 0.18, 0, Math.PI * 2);
        ctx.arc(fx + fr * 0.4, fy - fr * 0.45, fr * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // Swipe on phones.
    let touch: { x: number; y: number } | null = null;
    const ts = (e: TouchEvent) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY });
    const te = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x;
      const dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) move(0, -1);
      else if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx), 0);
      else move(0, Math.sign(dy));
      touch = null;
    };
    c.addEventListener('touchstart', ts, { passive: true });
    c.addEventListener('touchend', te);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', key);
      c.removeEventListener('touchstart', ts);
      c.removeEventListener('touchend', te);
    };
  }, []);

  const meta = killer?.token ? tokenMeta(killer.token) : null;
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">Chain Frogger</span>
        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE MAINNET TRAFFIC
            </>
          ) : feed.status === 'off' ? (
            'no feed configured'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div className="relative">
        <canvas ref={canvas} className="inset h-[70vh] min-h-96 w-full touch-none" aria-label="Chain Frogger" />
        {!started && !over && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-center">
            <p className="text-3xl font-bold text-hot">CHAIN FROGGER</p>
            <p className="max-w-md text-sm text-dim">Every car is a real BSV transaction, live from mainnet. Cross to the top. Arrows / WASD, or swipe and tap on a phone.</p>
          </div>
        )}
        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 text-center">
            <p className="text-3xl font-bold text-hot">SPLAT</p>
            <p className="text-sm text-dim">You crossed {score} times. Best: {best}.</p>
            <button onClick={() => control.current?.restart()} className="btn-fire">
              AGAIN
            </button>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="inset px-2 py-1">
          <span className="text-dim">Crossings: </span>
          <span className="text-hot">{score}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Lives: </span>
          <span className="text-hot">{'🐸'.repeat(Math.max(0, lives)) || '—'}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Best: </span>
          <span className="text-hot">{best}</span>
        </div>
      </div>
      {killer && (
        <p className="mt-2 text-sm text-dim">
          Run over by a {KINDS.find((k) => k.id === killer.kind)?.label.toLowerCase()}
          {meta ? ` moving $${meta.sym}` : ''} ({killer.bytes.toLocaleString()} bytes, {killer.mined ? 'mined' : 'in mempool'}):{' '}
          <a href={`https://whatsonchain.com/tx/${killer.id}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            {killer.id.slice(0, 16)}… ↗
          </a>
        </p>
      )}
      <div className="mt-2 flex justify-center gap-2 sm:hidden">
        {(
          [
            ['←', -1, 0],
            ['↑', 0, -1],
            ['↓', 0, 1],
            ['→', 1, 0],
          ] as const
        ).map(([l, dx, dy]) => (
          <button key={l} onClick={() => control.current?.move(dx, dy)} className="btn px-5 py-3 text-xl">
            {l}
          </button>
        ))}
      </div>
    </section>
  );
}
