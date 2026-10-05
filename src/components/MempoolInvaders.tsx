'use client';

/**
 * Mempool Invaders: Space Invaders where every invader is a live BSV transaction. Each wave's
 * formation is built from the txs hitting the network right now (shape and colour by kind), new
 * txs keep diving in from the top while you fight, blasts fly across as bonus saucers, and token
 * transfers wear their token: shoot one and it drops that token for you to catch (loot).
 *
 * PAID mode: every shot is a real transaction (1 sat to the house + network fee).
 */
import { useEffect, useRef, useState } from 'react';
import { KINDS, type FeedTx, type TxKind } from '@/lib/feed';
import { lootFrom, useLoot, type Haul, type Loot } from '@/lib/loot';
import { drawLoot, refreshLoot } from '@/lib/lootCanvas';
import { useChainFeed } from '@/lib/useChainFeed';
import { usePaidPlay } from '@/lib/usePaidPlay';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { PaidPanel } from './PaidPanel';
import { HoldButton } from './HoldButton';

const W = 320;
const H = 400;
const COLS = 8;
const ROWS = 4;
const CW = 32;
const CH = 26;
const PY = H - 26;

const KIND_COLOR = Object.fromEntries(KINDS.map((k) => [k.id, k.color])) as Record<TxKind, string>;
const POINTS: Record<TxKind, number> = { payment: 10, data: 20, social: 30, inscription: 40, token: 50, blast: 300 };

// 11x8 sprites, two animation frames each.
const SPRITES = {
  crab: [
    ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
    ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.'],
  ],
  squid: [
    ['....XXX....', '...XXXXX...', '..XXXXXXX..', '.XX.XXX.XX.', '.XXXXXXXXX.', '...X...X...', '..X.XXX.X..', '.X.X...X.X.'],
    ['....XXX....', '...XXXXX...', '..XXXXXXX..', '.XX.XXX.XX.', '.XXXXXXXXX.', '....X.X....', '...X...X...', '....X.X....'],
  ],
  octo: [
    ['...XXXXX...', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXX..X..XXX', 'XXXXXXXXXXX', '..XXX.XXX..', '.XX..X..XX.', '..XX...XX..'],
    ['...XXXXX...', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXX..X..XXX', 'XXXXXXXXXXX', '...XX.XX...', '..XX.X.XX..', 'XX.......XX'],
  ],
};
const SHAPE: Record<TxKind, keyof typeof SPRITES> = { payment: 'crab', data: 'crab', social: 'squid', inscription: 'squid', token: 'octo', blast: 'octo' };

type Inv = { kind: TxKind; color: string; loot: Loot | null; alive: boolean; label: string; x: number; y: number; diver?: boolean; vy?: number; quiet?: boolean };
type Shot = { x: number; y: number; vy: number };
type Drop = { x: number; y: number; loot: Loot };
type Boom = { x: number; y: number; t: number; color: string };
type HUD = { score: number; lives: number; wave: number; left: number };

export function MempoolInvaders() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feed = useChainFeed();
  const pp = usePaidPlay('Out of sats: load more to keep shooting.');
  const payFor = pp.payFor;
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const loot = useLoot('invaders');
  const lootRef = useRef(loot);
  useEffect(() => {
    lootRef.current = loot;
  });
  useEffect(() => () => lootRef.current.end(), []);
  const [lastRun, setLastRun] = useState<Haul>({});
  const [hud, setHud] = useState<HUD>({ score: 0, lives: 3, wave: 1, left: 0 });
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready');
  const [best, setBest] = useState(0);
  const [fromChain, setFromChain] = useState(0);
  const control = useRef<{ restart: () => void; key: (k: string, down: boolean) => void } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;

    let state: 'ready' | 'play' | 'over' = 'ready';
    let invs: Inv[] = [];
    let divers: Inv[] = [];
    let shots: Shot[] = [];
    let bombs: Shot[] = [];
    let drops: Drop[] = [];
    let booms: Boom[] = [];
    let popups: { x: number; y: number; t: number; text: string }[] = [];
    let ufo: { x: number; dir: number; label: string } | null = null;
    let ox = 0;
    let oy = 0;
    let dir = 1;
    let wave = 1;
    let score = 0;
    let lives = 3;
    let chainN = 0;
    let frame = 0;
    let cool = 0;
    let invuln = 0;
    let nextDiver = 120;
    let banner = 0;
    let shake = 0;
    const pl = { x: W / 2 };
    const keys = { left: false, right: false, fire: false };
    const stars = Array.from({ length: 50 }, (_, i) => ({ x: (i * 73) % W, y: (i * 151) % H, s: (i % 3) + 1 }));

    const fromTx = (f: FeedTx | null): Inv => {
      if (!f) return { kind: 'payment', color: '#4a1414', loot: null, alive: true, label: 'mempool quiet', x: 0, y: 0, quiet: true };
      chainN++;
      return { kind: f.kind, color: KIND_COLOR[f.kind] ?? '#ff5a48', loot: lootFrom(f), alive: true, label: `${f.kind} ${f.id.slice(0, 8)}`, x: 0, y: 0 };
    };

    const buildWave = () => {
      invs = [];
      // Token transfers lead from the back row so their loot is the prize at the top.
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const f = r === 0 ? (feedRef.current.take((x) => x.kind === 'token') ?? feedRef.current.take((x) => x.kind !== 'blast')) : feedRef.current.take((x) => x.kind !== 'blast');
          const inv = fromTx(f);
          inv.x = c * CW;
          inv.y = r * CH;
          invs.push(inv);
        }
      ox = (W - COLS * CW) / 2;
      oy = 40 + Math.min(60, (wave - 1) * 8);
      dir = 1;
      banner = 90;
    };

    const reset = () => {
      wave = 1;
      score = 0;
      lives = 3;
      chainN = 0;
      shots = [];
      bombs = [];
      drops = [];
      booms = [];
      popups = [];
      divers = [];
      ufo = null;
      pl.x = W / 2;
      invuln = 0;
      buildWave();
    };
    reset();

    const popup = (x: number, y: number, text: string) => popups.push({ x, y, t: 45, text });

    const kill = (v: Inv, cx: number, cy: number, mult = 1) => {
      v.alive = false;
      const pts = (v.quiet ? 5 : POINTS[v.kind]) * mult;
      score += pts;
      booms.push({ x: cx, y: cy, t: 18, color: v.color });
      popup(cx, cy - 6, `+${pts}`);
      if (v.loot) drops.push({ x: cx, y: cy, loot: v.loot });
    };

    const gameOver = () => {
      state = 'over';
      setPhase('over');
      setBest((b) => Math.max(b, score));
      setLastRun({ ...lootRef.current.run });
      lootRef.current.end();
    };

    const hit = () => {
      if (invuln > 0) return;
      lives--;
      shake = 14;
      booms.push({ x: pl.x, y: PY, t: 30, color: '#ffd0c0' });
      invuln = 100;
      if (lives <= 0) gameOver();
    };

    const step = () => {
      frame++;
      if (banner > 0) banner--;
      if (invuln > 0) invuln--;
      if (shake > 0) shake--;
      const mv = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      pl.x = Math.max(12, Math.min(W - 12, pl.x + mv * 2.8));
      if (cool > 0) cool--;
      if (keys.fire && cool === 0 && shots.length < 2 && lives > 0) {
        if (payFor.current(['invaders', 'shot'])) {
          shots.push({ x: pl.x, y: PY - 8, vy: -6 });
          cool = 14;
        } else cool = 20;
      }

      // Formation march: faster as it thins out and as waves go by.
      const alive = invs.filter((v) => v.alive);
      const speed = 0.25 + (1 - alive.length / invs.length) * 1.3 + wave * 0.07;
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const v of alive) {
        minX = Math.min(minX, ox + v.x);
        maxX = Math.max(maxX, ox + v.x + 22);
        maxY = Math.max(maxY, oy + v.y + 16);
      }
      ox += dir * speed;
      if ((dir > 0 && maxX + dir * speed > W - 4) || (dir < 0 && minX + dir * speed < 4)) {
        dir *= -1;
        oy += 10;
      }
      if (alive.length && maxY >= PY - 10) {
        lives = 0;
        gameOver();
        return;
      }

      // Formation fires from the bottom of a random column.
      if (alive.length && Math.random() < 0.012 + wave * 0.004) {
        const shooter = alive[Math.floor(Math.random() * alive.length)];
        const below = alive.filter((v) => v.x === shooter.x && v.y > shooter.y);
        const s = below.length ? below[below.length - 1] : shooter;
        bombs.push({ x: ox + s.x + 11, y: oy + s.y + 16, vy: 2 + wave * 0.15 });
      }

      // Live divers: fresh txs drop in from the top while you fight.
      if (--nextDiver <= 0) {
        nextDiver = Math.max(50, 160 - wave * 12);
        const f = feedRef.current.take((x) => x.kind !== 'blast');
        if (f) {
          const d = fromTx(f);
          d.diver = true;
          d.x = 16 + Math.random() * (W - 54);
          d.y = -16;
          d.vy = 0.5 + wave * 0.06;
          divers.push(d);
        }
      }
      for (const d of divers) {
        d.y += d.vy ?? 0.6;
        d.x += Math.sin((frame + d.y) / 30) * 0.6;
        if (d.y > PY - 16) {
          d.alive = false;
          hit();
          booms.push({ x: d.x + 11, y: d.y + 8, t: 18, color: d.color });
        } else if (invuln === 0 && Math.abs(d.x + 11 - pl.x) < 16 && d.y + 16 > PY - 8) {
          d.alive = false;
          hit();
        }
      }
      divers = divers.filter((d) => d.alive);

      // Blasts fly across the top as bonus saucers.
      if (!ufo && frame % 60 === 0) {
        const f = feedRef.current.take((x) => x.kind === 'blast');
        if (f) {
          chainN++;
          const d = Math.random() < 0.5 ? 1 : -1;
          ufo = { x: d > 0 ? -24 : W + 24, dir: d, label: f.id.slice(0, 8) };
        }
      }
      if (ufo) {
        ufo.x += ufo.dir * 1.2;
        if (ufo.x < -30 || ufo.x > W + 30) ufo = null;
      }

      // Player shots.
      for (const s of shots) {
        s.y += s.vy;
        let used = false;
        for (const v of alive) {
          if (!v.alive) continue;
          const vx = ox + v.x;
          const vy = oy + v.y;
          if (s.x > vx && s.x < vx + 22 && s.y > vy && s.y < vy + 16) {
            kill(v, vx + 11, vy + 8);
            used = true;
            break;
          }
        }
        if (!used)
          for (const d of divers) {
            if (d.alive && s.x > d.x && s.x < d.x + 22 && s.y > d.y && s.y < d.y + 16) {
              kill(d, d.x + 11, d.y + 8, 2);
              used = true;
              break;
            }
          }
        if (!used && ufo && Math.abs(s.x - ufo.x) < 14 && s.y < 30 && s.y > 12) {
          score += POINTS.blast;
          booms.push({ x: ufo.x, y: 20, t: 24, color: '#ffffff' });
          popup(ufo.x, 26, `BLAST +${POINTS.blast}`);
          ufo = null;
          used = true;
        }
        if (used) s.y = -99;
      }
      shots = shots.filter((s) => s.y > -10);
      divers = divers.filter((d) => d.alive);

      // Bombs.
      for (const s of bombs) {
        s.y += s.vy;
        if (lives > 0 && s.y > PY - 8 && s.y < PY + 6 && Math.abs(s.x - pl.x) < 10) {
          s.y = H + 99;
          hit();
        }
      }
      bombs = bombs.filter((s) => s.y < H);

      // Token loot falls; catch it with the ship.
      for (const d of drops) {
        d.y += 1.3;
        if (Math.abs(d.x - pl.x) < 16 && Math.abs(d.y - PY) < 14) {
          d.y = H + 99;
          d.loot = refreshLoot(d.loot);
          lootRef.current.pickup(d.loot);
          score += 100;
          popup(pl.x, PY - 20, `+1 ${d.loot.sym}`);
        }
      }
      drops = drops.filter((d) => d.y < H + 10);

      for (const b of booms) b.t--;
      booms = booms.filter((b) => b.t > 0);
      for (const q of popups) q.t--;
      popups = popups.filter((q) => q.t > 0);

      if (state === 'play' && !invs.some((v) => v.alive) && !divers.length) {
        wave++;
        score += 250;
        bombs = [];
        buildWave();
      }
    };

    const sprite = (kind: TxKind, x: number, y: number, color: string, f: number) => {
      const rows = SPRITES[SHAPE[kind]][f];
      ctx.fillStyle = color;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 11; c++) if (rows[r][c] === 'X') ctx.fillRect(Math.round(x) + c * 2, Math.round(y) + r * 2, 2, 2);
    };

    const drawInv = (v: Inv, x: number, y: number, t: number) => {
      const f = Math.floor(frame / 30) % 2;
      sprite(v.kind, x, y, v.quiet ? '#4a1414' : v.loot ? '#d4a843' : v.color, f);
      if (v.loot) drawLoot(ctx, v.loot, x + 11, y + 6, 11, t);
    };

    const draw = (t: number) => {
      ctx.save();
      if (shake) ctx.translate((Math.random() * 2 - 1) * 2, (Math.random() * 2 - 1) * 2);
      ctx.fillStyle = '#050202';
      ctx.fillRect(-4, -4, W + 8, H + 8);
      for (const s of stars) {
        ctx.fillStyle = s.s === 3 ? '#3a1010' : '#200808';
        ctx.fillRect(s.x, (s.y + frame * s.s * 0.15) % H, s.s, s.s);
      }
      ctx.fillStyle = 'rgba(255,90,72,0.03)';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      // Ground line.
      ctx.fillStyle = '#8a2222';
      ctx.fillRect(0, PY + 10, W, 1);

      for (const v of invs) if (v.alive) drawInv(v, ox + v.x, oy + v.y, t);
      for (const d of divers) {
        ctx.fillStyle = 'rgba(255,90,72,0.15)';
        ctx.fillRect(Math.round(d.x) + 10, 0, 2, Math.max(0, d.y));
        drawInv(d, d.x, d.y, t);
      }
      if (ufo) {
        const ux = Math.round(ufo.x);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(ux - 10, 18, 20, 4);
        ctx.fillRect(ux - 6, 14, 12, 4);
        ctx.fillRect(ux - 13, 22, 26, 3);
        ctx.fillStyle = '#ff5a48';
        if (Math.floor(frame / 6) % 2) for (let i = -9; i <= 9; i += 6) ctx.fillRect(ux + i, 23, 2, 1);
      }
      // Shots and bombs.
      ctx.fillStyle = '#ffd0c0';
      for (const s of shots) ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y), 2, 7);
      ctx.fillStyle = '#ff5a48';
      for (const s of bombs) {
        const z = Math.floor(s.y / 4) % 2;
        ctx.fillRect(Math.round(s.x) - 1 + z, Math.round(s.y), 2, 3);
        ctx.fillRect(Math.round(s.x) - z, Math.round(s.y) + 3, 2, 3);
      }
      for (const d of drops) drawLoot(ctx, d.loot, d.x, d.y + Math.sin(t / 150 + d.x) * 1.5, 14, t);
      // Player ship.
      if (lives > 0 && (invuln === 0 || Math.floor(frame / 5) % 2 === 0)) {
        const x = Math.round(pl.x);
        ctx.fillStyle = '#ff5a48';
        ctx.fillRect(x - 11, PY + 2, 22, 6);
        ctx.fillRect(x - 8, PY - 1, 16, 3);
        ctx.fillStyle = '#ffd0c0';
        ctx.fillRect(x - 2, PY - 7, 4, 6);
        ctx.fillRect(x - 1, PY - 9, 2, 2);
      }
      for (const b of booms) {
        ctx.fillStyle = b.color;
        const r = (18 - b.t) * 0.9 + 2;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.fillRect(Math.round(b.x + Math.cos(a) * r), Math.round(b.y + Math.sin(a) * r), 2, 2);
        }
      }
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd0c0';
      for (const q of popups) ctx.fillText(q.text, q.x, q.y - (45 - q.t) * 0.4);
      if (banner > 0 && state === 'play') {
        ctx.font = 'bold 16px monospace';
        ctx.fillStyle = '#ff5a48';
        ctx.fillText(`WAVE ${wave}`, W / 2, H / 2);
        ctx.font = '8px monospace';
        ctx.fillStyle = '#b06e66';
        ctx.fillText(`${invs.filter((v) => !v.quiet).length} live txs in formation`, W / 2, H / 2 + 16);
      }
      ctx.restore();
    };

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudTick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      acc += Math.min(100, now - last);
      last = now;
      while (acc >= 1000 / 60) {
        acc -= 1000 / 60;
        if (state === 'play') step();
      }
      draw(now);
      if (++hudTick % 6 === 0 && state === 'play') {
        setHud({ score, lives, wave, left: invs.filter((v) => v.alive).length + divers.length });
        setFromChain(chainN);
      }
    };
    raf = requestAnimationFrame(loop);

    control.current = {
      restart: () => {
        lootRef.current.end();
        setLastRun({});
        reset();
        state = 'play';
        setPhase('play');
        setHud({ score: 0, lives: 3, wave: 1, left: invs.length });
      },
      key: (k, down) => {
        if (k === 'left') keys.left = down;
        if (k === 'right') keys.right = down;
        if (k === 'fire') keys.fire = down;
      },
    };
    const map: Record<string, string> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'fire', ArrowUp: 'fire', w: 'fire', W: 'fire' };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = map[e.key];
      if (!k) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      control.current?.key(k, down);
      if (down && k === 'fire' && state !== 'play') control.current?.restart();
    };
    const kd = onKey(true);
    const ku = onKey(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [payFor]);

  return (
    <section className="panel">
      <div className="relative mx-auto w-full max-w-[560px] overflow-hidden border border-[var(--border-canvas)] bg-canvas" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full" style={{ imageRendering: 'pixelated' }} />
        <div className="pointer-events-none absolute left-2 top-1 flex flex-wrap items-center gap-3 text-xs text-hot">
          <span>SCORE {hud.score.toLocaleString()}</span>
          <span>{'♥'.repeat(Math.max(0, hud.lives))}</span>
          <span>WAVE {hud.wave}</span>
          <LootHud haul={loot.run} max={3} />
        </div>
        <div className="pointer-events-none absolute right-2 top-1 text-xs text-dim">chain: {feed.status}</div>
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 px-3 text-center">
            <p className="text-2xl font-bold text-hot">MEMPOOL INVADERS</p>
            <p className="text-xs text-dim">Every invader is a live transaction. ←/→ or A/D to move, SPACE / ↑ / W to fire. Shoot gold token invaders and catch the token they drop.</p>
            <button onClick={() => control.current?.restart()} className="btn-fire">
              START
            </button>
          </div>
        )}
        {phase === 'over' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-3 text-center">
            <p className="text-3xl font-bold text-hot">GAME OVER</p>
            <p className="text-sm text-fg">
              Score {hud.score.toLocaleString()} · wave {hud.wave}. Best: {Math.max(best, hud.score).toLocaleString()}.
            </p>
            <LootLine haul={lastRun} />
            <button onClick={() => control.current?.restart()} className="btn-fire">
              AGAIN
            </button>
          </div>
        )}
      </div>
      <div className="mx-auto mt-2 flex max-w-[560px] select-none items-center justify-between gap-2 sm:hidden" style={{ touchAction: 'none' }}>
        <div className="flex gap-2">
          <HoldButton ctl={control} k="left" className="btn h-14 w-14 text-xl">
            ◀
          </HoldButton>
          <HoldButton ctl={control} k="right" className="btn h-14 w-14 text-xl">
            ▶
          </HoldButton>
        </div>
        <HoldButton ctl={control} k="fire" className="btn-fire h-14 min-w-0 flex-1 !px-2">
          FIRE
        </HoldButton>
      </div>
      <p className="mt-2 text-xs text-muted">
        The invaders are mainnet, live: {fromChain.toLocaleString()} real transactions have marched in so far. Payments and data are crabs, social posts and inscriptions are
        squids, token transfers are gold invaders wearing their token, blasts fly over as bonus saucers, and fresh txs keep diving in while you fight.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="inset px-2 py-1">
          <span className="text-dim">Score: </span>
          <span className="text-hot">{hud.score.toLocaleString()}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Wave: </span>
          <span className="text-hot">{hud.wave}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Best: </span>
          <span className="text-hot">{Math.max(best, hud.score).toLocaleString()}</span>
        </div>
      </div>
      <LootPanel run={phase === 'over' ? lastRun : loot.run} allTime={loot.allTime} />
      <PaidPanel pp={pp} game="Mempool Invaders" action="shot" actions="shots" />
    </section>
  );
}
