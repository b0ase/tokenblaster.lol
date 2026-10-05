'use client';

/**
 * Token Snake: snake on a grid where the food is the live BSV chain. Every transaction hitting the
 * network becomes a bite (colour by kind); token transfers are token food wearing their icon, worth
 * more and collected as loot; TokenBlaster blasts are golden food. Speed ramps as you grow.
 *
 * PAID mode: every turn is a real transaction (1 sat to the house + network fee).
 */
import { useEffect, useRef, useState } from 'react';
import { KINDS, type FeedTx, type TxKind } from '@/lib/feed';
import { lootFrom, useLoot, type Haul, type Loot } from '@/lib/loot';
import { drawLoot, refreshLoot } from '@/lib/lootCanvas';
import { useChainFeed } from '@/lib/useChainFeed';
import { usePaidPlay } from '@/lib/usePaidPlay';
import { HoldButton } from './HoldButton';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { ModeBadge, PaidPanel, PlayButtons } from './PaidPanel';
import { GameAudio } from './SoundToggle';
import { sfx } from '@/lib/sfx';

const N = 20; // grid cells per side
const C = 16; // px per cell
const W = N * C;
const START_MS = 150;
const MIN_MS = 62;
const FOODS = 3;

const KIND_COLOR = Object.fromEntries(KINDS.map((k) => [k.id, k.color])) as Record<TxKind, string>;

type Dir = 'up' | 'down' | 'left' | 'right';
const VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
type Food = { x: number; y: number; kind: TxKind | 'quiet'; color: string; loot: Loot | null; label: string; born: number };
type HUD = { score: number; length: number; speed: number };

export function TokenSnake() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feed = useChainFeed();
  const pp = usePaidPlay('Out of sats: load more to keep turning.', 'snake');
  const payFor = pp.payFor;
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const loot = useLoot('snake');
  const lootRef = useRef(loot);
  useEffect(() => {
    lootRef.current = loot;
  });
  useEffect(() => () => lootRef.current.end(), []);
  const [lastRun, setLastRun] = useState<Haul>({});
  const [hud, setHud] = useState<HUD>({ score: 0, length: 4, speed: 1 });
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready');
  const [best, setBest] = useState(0);
  const [eaten, setEaten] = useState(0);
  const control = useRef<{ restart: () => void; key: (k: string, down: boolean) => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let state: 'ready' | 'play' | 'over' = 'ready';
    let snake: { x: number; y: number }[] = [];
    let dir: Dir = 'right';
    let turns: Dir[] = [];
    let grow = 0;
    let foods: Food[] = [];
    let score = 0;
    let ms = START_MS;
    let tickAt = 0;
    let ticks = 0;
    let chainN = 0;
    let popups: { x: number; y: number; t: number; text: string; color: string }[] = [];
    let deadFlash = 0;

    const free = (x: number, y: number) => !snake.some((s) => s.x === x && s.y === y) && !foods.some((f) => f.x === x && f.y === y);
    const spot = () => {
      for (let i = 0; i < 200; i++) {
        const x = Math.floor(Math.random() * N);
        const y = Math.floor(Math.random() * N);
        if (free(x, y)) return { x, y };
      }
      return null;
    };
    const addFood = () => {
      const at = spot();
      if (!at) return;
      // Token transfers and blasts first: they're the prizes.
      const f: FeedTx | null = feedRef.current.take((x) => x.kind === 'token' || x.kind === 'blast') ?? feedRef.current.take();
      if (!f) {
        foods.push({ ...at, kind: 'quiet', color: '#6a1c1c', loot: null, label: 'mempool quiet', born: ticks });
        return;
      }
      chainN++;
      foods.push({ ...at, kind: f.kind, color: KIND_COLOR[f.kind] ?? '#ff5a48', loot: lootFrom(f), label: `${f.kind} ${f.id.slice(0, 8)}`, born: ticks });
    };

    const reset = () => {
      snake = [3, 2, 1, 0].map((x) => ({ x: x + 3, y: Math.floor(N / 2) }));
      dir = 'right';
      turns = [];
      grow = 0;
      foods = [];
      score = 0;
      ms = START_MS;
      chainN = 0;
      popups = [];
      deadFlash = 0;
      for (let i = 0; i < FOODS; i++) addFood();
    };
    reset();

    const over = () => {
      sfx('rekt');
      sfx('gameover');
      state = 'over';
      deadFlash = 30;
      setPhase('over');
      setBest((b) => Math.max(b, score));
      setLastRun({ ...lootRef.current.run });
      lootRef.current.end();
    };

    const tick = () => {
      ticks++;
      if (turns.length) dir = turns.shift()!;
      const [dx, dy] = VEC[dir];
      const head = { x: snake[0].x + dx, y: snake[0].y + dy };
      if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N) return over();
      const body = grow > 0 ? snake : snake.slice(0, -1);
      if (body.some((s) => s.x === head.x && s.y === head.y)) return over();
      snake.unshift(head);
      if (grow > 0) grow--;
      else snake.pop();
      const fi = foods.findIndex((f) => f.x === head.x && f.y === head.y);
      if (fi >= 0) {
        const f = foods.splice(fi, 1)[0];
        let pts = 10;
        let g = 1;
        let text = '+10';
        let color = f.color;
        if (f.loot) {
          f.loot = refreshLoot(f.loot);
          lootRef.current.pickup(f.loot);
          pts = 50;
          g = 3;
          text = `+1 ${f.loot.sym}`;
          color = '#ffd36a';
        } else if (f.kind === 'blast') {
          pts = 100;
          g = 2;
          text = 'BLAST +100';
          color = '#ffe9a0';
        } else if (f.kind === 'quiet') {
          pts = 5;
          text = '+5';
        }
        sfx(f.loot ? 'token' : f.kind === 'blast' ? 'pickup' : 'coin');
        score += pts;
        grow += g;
        ms = Math.max(MIN_MS, ms - 3);
        popups.push({ x: head.x * C + C / 2, y: head.y * C, t: 40, text, color });
        addFood();
      }
      // Quiet filler gets swapped for live txs as they arrive.
      const qi = foods.findIndex((f) => f.kind === 'quiet' && ticks - f.born > 30);
      if (qi >= 0 && feedRef.current.waiting() > 0) {
        foods.splice(qi, 1);
        addFood();
      }
    };

    const draw = (now: number) => {
      ctx.fillStyle = '#050202';
      ctx.fillRect(0, 0, W, W);
      ctx.fillStyle = '#140606';
      for (let i = 1; i < N; i++) {
        ctx.fillRect(i * C, 0, 1, W);
        ctx.fillRect(0, i * C, W, 1);
      }
      ctx.fillStyle = 'rgba(255,90,72,0.03)';
      for (let y = 0; y < W; y += 3) ctx.fillRect(0, y, W, 1);
      // Food.
      for (const f of foods) {
        const cx = f.x * C + C / 2;
        const cy = f.y * C + C / 2;
        if (f.loot) drawLoot(ctx, f.loot, cx, cy, C - 2, now);
        else if (f.kind === 'blast') {
          const p = 0.5 + 0.5 * Math.sin(now / 120);
          ctx.fillStyle = `rgba(255,220,120,${0.25 + 0.3 * p})`;
          ctx.fillRect(f.x * C - 2, f.y * C - 2, C + 4, C + 4);
          ctx.fillStyle = '#ffe9a0';
          ctx.fillRect(f.x * C + 3, f.y * C + 3, C - 6, C - 6);
        } else {
          ctx.fillStyle = f.color;
          const s = f.kind === 'quiet' ? 4 : 8;
          ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
        }
      }
      // Snake.
      const flash = deadFlash > 0 && Math.floor(deadFlash / 4) % 2 === 0;
      snake.forEach((s, i) => {
        ctx.fillStyle = flash ? '#ffffff' : i === 0 ? '#ffd0c0' : i % 2 ? '#ff5a48' : '#d23c30';
        ctx.fillRect(s.x * C + 1, s.y * C + 1, C - 2, C - 2);
      });
      if (snake.length) {
        const h = snake[0];
        const [dx, dy] = VEC[dir];
        ctx.fillStyle = '#050202';
        const ex = h.x * C + C / 2 + dx * 3;
        const ey = h.y * C + C / 2 + dy * 3;
        ctx.fillRect(ex - 1 - dy * 3, ey - 1 - dx * 3, 2, 2);
        ctx.fillRect(ex - 1 + dy * 3, ey - 1 + dx * 3, 2, 2);
      }
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      for (const q of popups) {
        ctx.fillStyle = q.color;
        ctx.fillText(q.text, q.x, q.y - (40 - q.t) * 0.4);
      }
    };

    let raf = 0;
    let hudTick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (state === 'play') {
        if (!tickAt) tickAt = now + ms;
        let guard = 0;
        while (now >= tickAt && state === 'play' && guard++ < 4) {
          tick();
          tickAt += ms;
        }
        if (now - tickAt > 500) tickAt = now + ms;
      }
      for (const q of popups) q.t--;
      popups = popups.filter((q) => q.t > 0);
      if (deadFlash > 0) deadFlash--;
      draw(now);
      if (process.env.NODE_ENV !== 'production') (window as unknown as { __tbSnake?: unknown }).__tbSnake = { snake, foods, dir, state };
      if (++hudTick % 6 === 0 && state === 'play') {
        setHud({ score, length: snake.length, speed: Math.round((START_MS / ms) * 10) / 10 });
        setEaten(chainN);
      }
    };
    raf = requestAnimationFrame(loop);

    const turn = (d: Dir) => {
      const lastDir = turns.length ? turns[turns.length - 1] : dir;
      if (d === lastDir || d === OPP[lastDir] || turns.length >= 2) return;
      if (!payFor.current(['snake', 'turn'])) return; // out of sats: the turn is refused
      turns.push(d);
    };

    control.current = {
      restart: () => {
        lootRef.current.end();
        setLastRun({});
        reset();
        tickAt = 0;
        state = 'play';
        setPhase('play');
        setHud({ score: 0, length: snake.length, speed: 1 });
      },
      key: (k, down) => {
        if (!down) return;
        if (state !== 'play') {
          if (k === 'start') control.current?.restart();
          return;
        }
        if (k in VEC) turn(k as Dir);
      },
    };
    const map: Record<string, string> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ' ': 'start', Enter: 'start' };
    const onKey = (e: KeyboardEvent) => {
      const k = map[e.key];
      if (!k) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      control.current?.key(k, true);
    };
    // Swipe on the board.
    let t0: { x: number; y: number } | null = null;
    const ts = (e: TouchEvent) => {
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const tm = (e: TouchEvent) => {
      if (!t0) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - t0.x;
      const dy = e.touches[0].clientY - t0.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      control.current?.key(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', true);
      t0 = null;
    };
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('touchstart', ts, { passive: true });
    canvas.addEventListener('touchmove', tm, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('touchstart', ts);
      canvas.removeEventListener('touchmove', tm);
    };
  }, [payFor]);

  return (
    <section className="panel">
      <GameAudio track="snake" />
      <div className="relative mx-auto w-full max-w-[520px] overflow-hidden border border-[var(--border-canvas)] bg-canvas" style={{ aspectRatio: '1 / 1', touchAction: 'none' }}>
        <canvas ref={canvasRef} width={W} height={W} className="block h-full w-full" style={{ imageRendering: 'pixelated' }} />
        <div className="pointer-events-none absolute left-2 top-1 flex flex-wrap items-center gap-3 text-xs text-hot">
          <span>SCORE {hud.score.toLocaleString()}</span>
          <span>LEN {hud.length}</span>
          <span>×{hud.speed}</span>
          <LootHud haul={loot.run} max={3} />
        </div>
        <div className="pointer-events-none absolute right-2 top-1 text-xs text-dim">chain: {feed.status}</div>
        <ModeBadge pp={pp} action="turn" actions="turns" />
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 px-3 text-center">
            <p className="text-2xl font-bold text-hot">TOKEN SNAKE</p>
            <p className="text-xs text-dim">Eat the live chain. Arrows / WASD or swipe to turn. Token food is collected as loot; gold blasts are worth the most.</p>
            <PlayButtons pp={pp} game="Token Snake" action="turn" actions="turns" onStart={() => control.current?.restart()} />
          </div>
        )}
        {phase === 'over' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-3 text-center">
            <p className="text-3xl font-bold text-hot">GAME OVER</p>
            <p className="text-sm text-fg">
              Score {hud.score.toLocaleString()} · length {hud.length}. Best: {Math.max(best, hud.score).toLocaleString()}.
            </p>
            <LootLine haul={lastRun} />
            <PlayButtons pp={pp} game="Token Snake" action="turn" actions="turns" onStart={() => control.current?.restart()} practiceLabel="▶ AGAIN · PRACTICE" liveLabel="▶ AGAIN · LIVE" />
          </div>
        )}
      </div>
      <div className="mx-auto mt-2 grid w-48 select-none grid-cols-3 gap-1 sm:hidden" style={{ touchAction: 'none' }}>
        <span />
        <HoldButton ctl={control} k="up" className="btn h-14 text-xl">
          ▲
        </HoldButton>
        <span />
        <HoldButton ctl={control} k="left" className="btn h-14 text-xl">
          ◀
        </HoldButton>
        <HoldButton ctl={control} k="down" className="btn h-14 text-xl">
          ▼
        </HoldButton>
        <HoldButton ctl={control} k="right" className="btn h-14 text-xl">
          ▶
        </HoldButton>
      </div>
      <p className="mt-2 text-xs text-muted">
        The food is mainnet, live: {eaten.toLocaleString()} real transactions served so far. Each bite is a tx coloured by kind; token transfers are token food (+50, collected
        as loot), TokenBlaster blasts are gold (+100), and the snake speeds up with every bite.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="inset px-2 py-1">
          <span className="text-dim">Score: </span>
          <span className="text-hot">{hud.score.toLocaleString()}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Length: </span>
          <span className="text-hot">{hud.length}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Best: </span>
          <span className="text-hot">{Math.max(best, hud.score).toLocaleString()}</span>
        </div>
      </div>
      <LootPanel run={phase === 'over' ? lastRun : loot.run} allTime={loot.allTime} />
      <PaidPanel pp={pp} game="Token Snake" action="turn" actions="turns" />
    </section>
  );
}
