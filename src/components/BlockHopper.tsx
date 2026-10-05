'use client';

/**
 * Block Hopper: a side-scrolling platformer whose level is the live BSV chain. Every incoming
 * transaction becomes the next stretch of ground (width from its size, slopes from data txs),
 * blasts drop coins, token transfers send out enemies wearing their token icon, social txs are
 * springs, and new blocks are big checkpoint platforms.
 *
 * Physics are our own Sonic-style take: ground speed along the surface with acceleration,
 * deceleration and friction, slope gravity, momentum carried into jumps, variable jump height,
 * coyote time and jump buffering. Fixed 60 Hz step, units are logical pixels per frame.
 *
 * PAID mode: every jump is a real transaction (1 sat to the house + network fee), same queue and
 * batch drain as Chain Frogger.
 */
import { useEffect, useRef, useState } from 'react';
import { KINDS, type FeedTx, type TxKind } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';
import { useChainFeed } from '@/lib/useChainFeed';
import { usePaidPlay } from '@/lib/usePaidPlay';
import { HighScores, useRunClock } from './HighScores';
import { ModeBadge, PaidPanel, PlayButtons } from './PaidPanel';
import { lootFrom, useLoot, type Haul, type Loot } from '@/lib/loot';
import { drawLoot, refreshLoot } from '@/lib/lootCanvas';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { GameAudio } from './SoundToggle';
import { sfx } from '@/lib/sfx';


// Logical resolution (scaled up crisp).
const W = 480;
const H = 270;

// Physics constants (px / frame at 60 fps).
const ACC = 0.1;
const DEC = 0.5;
const FRC = 0.06;
const TOP = 7;
const MAX = 14;
const AIR = 0.12;
const GRV = 0.25;
const JMP = 6.6;
const JMP_CUT = 3.6;
const SLP = 0.16;
const COYOTE = 7;
const BUFFER = 8;
const SPRING = 10.5;

const KIND_COLOR = Object.fromEntries(KINDS.map((k) => [k.id, k.color])) as Record<TxKind, string>;

type Seg = { x0: number; y0: number; x1: number; y1: number; color: string; label: string; checkpoint?: boolean; tx?: string };
type Coin = { x: number; y: number; got: boolean };
type Enemy = { x: number; y: number; seg: Seg; dir: number; dead: number; icon: HTMLImageElement | null; tokenId?: string; sym: string; loot: Loot | null };
type Spring = { x: number; seg: Seg; t: number };
type Pickup = { x: number; y: number; vy: number; seg: Seg | null; loot: Loot; got: boolean; born: number };

type HUD = { score: number; lives: number; dist: number; coins: number; speed: number };

const surfaceY = (s: Seg, x: number) => s.y0 + ((x - s.x0) / (s.x1 - s.x0)) * (s.y1 - s.y0);
const segAngle = (s: Seg) => Math.atan2(s.y1 - s.y0, s.x1 - s.x0);

export function BlockHopper() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feed = useChainFeed();
  const pp = usePaidPlay('Out of sats: load more to keep jumping.', 'hopper');
  const payFor = pp.payFor;
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const loot = useLoot('hopper');
  const [lastRun, setLastRun] = useState<Haul>({});
  const lootRef = useRef(loot);
  useEffect(() => {
    lootRef.current = loot;
  });
  // Leaving mid-run still banks what was grabbed.
  useEffect(() => () => lootRef.current.end(), []);

  const [hud, setHud] = useState<HUD>({ score: 0, lives: 3, dist: 0, coins: 0, speed: 0 });
  const [phase, setPhase] = useState<'ready' | 'play' | 'over'>('ready');
  const runSecs = useRunClock(phase === 'play');
  const [best, setBest] = useState(0);
  const [fromChain, setFromChain] = useState(0);
  const control = useRef<{ restart: () => void; key: (k: string, down: boolean) => void } | null>(null);

  // Recent blocks → checkpoint platforms.
  const blocksRef = useRef<{ seen: number; pending: { height: number; txCount: number; miner: string }[] }>({ seen: 0, pending: [] });
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/blocks');
        if (!r.ok) return;
        const d = (await r.json()) as { blocks?: { height: number; txCount: number; miner: string }[] };
        const list = (d.blocks ?? []).slice().sort((a, c) => a.height - c.height);
        const br = blocksRef.current;
        if (!br.seen) {
          // First load: the newest few become the opening checkpoints.
          br.pending.push(...list.slice(-3));
        } else br.pending.push(...list.filter((x) => x.height > br.seen));
        if (list.length) br.seen = Math.max(br.seen, list[list.length - 1].height);
      } catch {
        /* blocks are a bonus; the tx feed still builds the level */
      }
    };
    void poll();
    const t = setInterval(() => alive && void poll(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let segs: Seg[] = [];
    let coins: Coin[] = [];
    let enemies: Enemy[] = [];
    let springs: Spring[] = [];
    let pickups: Pickup[] = [];
    let cursor = { x: 0, y: 180 };
    let chainN = 0;
    let rng = 1;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const p = { x: 40, y: 0, vx: 0, vy: 0, gsp: 0, ground: null as Seg | null, coyote: 0, buffer: 0, jumping: false, face: 1, invuln: 0, anim: 0 };
    let trail: { x: number; y: number }[] = [];
    let cam = { x: 0, y: 0, lead: 0 };
    let state: 'ready' | 'play' | 'over' = 'ready';
    let lives = 3;
    let score = 0;
    let nCoins = 0;
    let maxX = 0;
    let shake = 0;
    let popups: { x: number; y: number; t: number; text: string }[] = [];
    const keys = { left: false, right: false, jump: false };
    let jumpWasDown = false;

    const addSeg = (len: number, rise: number, color: string, label: string, extra?: Partial<Seg>) => {
      const s: Seg = { x0: cursor.x, y0: cursor.y, x1: cursor.x + len, y1: cursor.y + rise, color, label, ...extra };
      segs.push(s);
      cursor = { x: s.x1, y: s.y1 };
      return s;
    };
    const gap = (min: number, max: number, dyMax: number) => {
      cursor.x += min + rand() * (max - min);
      cursor.y = Math.max(90, Math.min(220, cursor.y + (rand() * 2 - 1) * dyMax));
    };

    /** Build the next stretch of level from one live tx (or a block, or idle filler). */
    const extend = () => {
      const br = blocksRef.current.pending.shift();
      if (br) {
        gap(30, 60, 30);
        const s = addSeg(360, 0, '#ffe58a', `BLOCK #${br.height.toLocaleString()} · ${br.txCount.toLocaleString()} txs · ${br.miner}`, { checkpoint: true });
        for (let i = 0; i < 8; i++) coins.push({ x: s.x0 + 60 + i * 30, y: s.y0 - 30 - Math.sin(i / 7 * Math.PI) * 30, got: false });
        return;
      }
      const f: FeedTx | null = feedRef.current.take();
      if (!f) {
        gap(24, 50, 25);
        addSeg(70 + rand() * 60, 0, '#3a2e08', 'mempool quiet…');
        return;
      }
      chainN++;
      const color = KIND_COLOR[f.kind] ?? '#f5b800';
      const len = Math.max(56, Math.min(320, 48 + f.bytes / 6));
      const label = `${f.kind} · ${f.id.slice(0, 8)} · ${f.bytes}B`;
      gap(20, 30 + Math.min(80, len / 3), 45);
      if ((f.kind === 'data' || f.kind === 'inscription') && len > 110) {
        // A slope: run down it to build speed (sometimes up).
        const down = rand() < 0.7;
        const rise = (down ? 1 : -1) * len * (0.25 + rand() * 0.3);
        if (cursor.y + rise < 70) cursor.y = 70 - rise;
        if (cursor.y + rise > 240) cursor.y = 240 - rise;
        addSeg(len, rise, color, label, { tx: f.id });
        addSeg(40, 0, color, '', { tx: f.id });
        return;
      }
      const s = addSeg(len, 0, color, label, { tx: f.id });
      if (f.kind === 'blast') {
        const n = Math.max(3, Math.min(8, Math.floor(len / 30)));
        for (let i = 0; i < n; i++) coins.push({ x: s.x0 + 20 + i * ((len - 40) / Math.max(1, n - 1)), y: s.y0 - 22, got: false });
      } else if (f.kind === 'payment' && rand() < 0.5) {
        coins.push({ x: (s.x0 + s.x1) / 2, y: s.y0 - 40, got: false });
      } else if (f.kind === 'token') {
        const m = f.token ? tokenMeta(f.token) : null;
        const l = lootFrom(f);
        enemies.push({ x: (s.x0 + s.x1) / 2, y: s.y0, seg: s, dir: rand() < 0.5 ? -1 : 1, dead: 0, icon: m?.icon ?? null, tokenId: f.token, sym: m?.sym ?? f.token?.slice(0, 6) ?? 'TOKEN', loot: l });
        // The transfer itself floats above its platform as a token to grab.
        if (l) pickups.push({ x: s.x0 + Math.min(40, len / 4), y: s.y0 - 34 - rand() * 16, vy: 0, seg: null, loot: l, got: false, born: chainN });
      } else if (f.kind === 'social') {
        springs.push({ x: s.x1 - 24, seg: s, t: 0 });
      }
    };

    const reset = () => {
      segs = [];
      coins = [];
      enemies = [];
      springs = [];
      pickups = [];
      popups = [];
      trail = [];
      cursor = { x: -60, y: 180 };
      rng = (Date.now() & 0xffff) + 1;
      addSeg(380, 0, '#f5b800', 'START · Block Hopper');
      Object.assign(p, { x: 40, y: 180, vx: 0, vy: 0, gsp: 0, ground: segs[0], coyote: 0, buffer: 0, jumping: false, face: 1, invuln: 0 });
      cam = { x: 40 - W * 0.35, y: 180 - H * 0.6, lead: 0 };
      lives = 3;
      score = 0;
      nCoins = 0;
      maxX = 40;
      chainN = 0;
    };
    reset();

    const findGround = (x: number, yFrom: number, yTo: number): Seg | null => {
      let bestS: Seg | null = null;
      let bestY = Infinity;
      for (const s of segs) {
        if (x < s.x0 || x > s.x1) continue;
        const sy = surfaceY(s, x);
        if (sy >= yFrom - 0.01 && sy <= yTo && sy < bestY) {
          bestY = sy;
          bestS = s;
        }
      }
      return bestS;
    };

    const popup = (x: number, y: number, text: string) => popups.push({ x, y, t: 50, text });

    const respawn = () => {
      const target = cam.x + W * 0.3;
      const s = segs.find((q) => q.x1 > target + 20) ?? segs[segs.length - 1];
      const x = Math.max(s.x0 + 10, Math.min(s.x1 - 10, target));
      Object.assign(p, { x, y: surfaceY(s, x), vx: 0, vy: 0, gsp: 0, ground: s, jumping: false, invuln: 120 });
      trail = [];
    };

    const hurt = () => {
      if (p.invuln > 0) return;
      lives--;
      shake = 12;
      sfx('hurt');
      if (lives <= 0) {
        sfx('gameover');
        state = 'over';
        setPhase('over');
        setLastRun({ ...lootRef.current.run });
        lootRef.current.end();
        setBest((bst) => Math.max(bst, score));
        return;
      }
      respawn();
    };

    const doJump = () => {
      if (!payFor.current(['hopper', 'jump'])) return false;
      const a = p.ground ? segAngle(p.ground) : 0;
      p.vx = p.gsp * Math.cos(a) + JMP * Math.sin(a);
      p.vy = p.gsp * Math.sin(a) - JMP * Math.cos(a);
      p.ground = null;
      p.jumping = true;
      p.coyote = 0;
      p.buffer = 0;
      sfx('jump');
      return true;
    };

    const step = () => {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const jumpPressed = keys.jump && !jumpWasDown;
      jumpWasDown = keys.jump;
      if (jumpPressed) p.buffer = BUFFER;
      else if (p.buffer > 0) p.buffer--;
      if (p.invuln > 0) p.invuln--;

      if (p.ground) {
        const s = p.ground;
        const a = segAngle(s);
        // Slope gravity pulls along the surface.
        p.gsp += SLP * Math.sin(a);
        if (dir !== 0) {
          p.face = dir;
          if (p.gsp * dir < 0) p.gsp += DEC * dir; // turning around: brake hard
          else if (Math.abs(p.gsp) < TOP) p.gsp = dir * Math.min(TOP, Math.abs(p.gsp) + ACC);
        } else {
          p.gsp -= Math.min(Math.abs(p.gsp), FRC) * Math.sign(p.gsp);
        }
        p.gsp = Math.max(-MAX, Math.min(MAX, p.gsp));
        p.coyote = COYOTE;
        if (p.buffer > 0) doJump();
        if (p.ground) {
          const nx = p.x + p.gsp * Math.cos(a);
          // Stay on this segment or the one it joins; otherwise fly off the end with our momentum.
          let ng: Seg | null = nx >= s.x0 && nx <= s.x1 ? s : null;
          if (!ng) {
            const yHere = surfaceY(s, Math.max(s.x0, Math.min(s.x1, nx)));
            ng = findGround(nx, yHere - 6, yHere + 6);
          }
          if (ng) {
            p.x = nx;
            p.y = surfaceY(ng, nx);
            p.ground = ng;
            const na = segAngle(ng);
            if (ng !== s) p.gsp = p.gsp * Math.cos(na - a);
          } else {
            p.vx = p.gsp * Math.cos(a);
            p.vy = p.gsp * Math.sin(a);
            p.ground = null;
            p.x = nx;
          }
        }
      } else {
        if (p.coyote > 0) {
          p.coyote--;
          if (p.buffer > 0 && !p.jumping) doJump();
        }
        if (dir !== 0) {
          p.face = dir;
          if (Math.abs(p.vx + dir * AIR) < TOP || p.vx * dir < 0) p.vx += dir * AIR;
        }
        if (p.jumping && !keys.jump && p.vy < -JMP_CUT) p.vy = -JMP_CUT; // variable height
        if (p.vy < 0 && p.vy > -4) p.vx *= 1 - 1 / 128; // light air drag near the apex
        p.vy = Math.min(p.vy + GRV, 12);
        const ny = p.y + p.vy;
        const nx = p.x + p.vx;
        if (p.vy >= 0) {
          const g = findGround(nx, p.y - 2, ny + 1);
          if (g) {
            const a = segAngle(g);
            p.x = nx;
            p.y = surfaceY(g, nx);
            p.ground = g;
            p.jumping = false;
            // Land: project air velocity onto the surface.
            p.gsp = p.vx * Math.cos(a) + p.vy * Math.sin(a);
          } else {
            p.x = nx;
            p.y = ny;
          }
        } else {
          p.x = nx;
          p.y = ny;
        }
        if (p.ground && p.buffer > 0) doJump();
      }

      // Springs.
      for (const sp of springs) {
        if (sp.t > 0) sp.t--;
        const sy = surfaceY(sp.seg, sp.x);
        if (Math.abs(p.x - sp.x) < 10 && p.y > sy - 10 && p.y <= sy + 1 && (p.ground || p.vy >= 0)) {
          if (p.ground) p.vx = p.gsp * Math.cos(segAngle(p.ground));
          p.ground = null;
          p.vy = -SPRING;
          p.jumping = false;
          sp.t = 12;
          sfx('spring');
          popup(sp.x, sy - 20, 'SPRING!');
        }
      }

      // Coins.
      for (const c of coins) {
        if (c.got) continue;
        if (Math.abs(c.x - p.x) < 10 && Math.abs(c.y - (p.y - 9)) < 13) {
          c.got = true;
          nCoins++;
          score += 10;
          sfx('coin');
        }
      }

      // Enemies: patrol their platform; stomp from above, or get hurt.
      for (const e of enemies) {
        if (e.dead) {
          e.dead--;
          continue;
        }
        e.x += e.dir * 0.6;
        if (e.x < e.seg.x0 + 8 || e.x > e.seg.x1 - 8) e.dir *= -1;
        e.y = surfaceY(e.seg, e.x);
        if (!e.icon && e.tokenId) e.icon = tokenMeta(e.tokenId)?.icon ?? null;
        if (Math.abs(e.x - p.x) < 12 && Math.abs(e.y - 8 - (p.y - 8)) < 14) {
          if (!p.ground && p.vy > 0 && p.y < e.y - 6) {
            e.dead = -1;
            p.vy = keys.jump ? -JMP : -4.5;
            score += 50;
            sfx('stomp');
            popup(e.x, e.y - 24, `+50 ${e.sym}`);
            // A stomped token enemy drops its token.
            if (e.loot) pickups.push({ x: e.x, y: e.y - 14, vy: -3, seg: e.seg, loot: e.loot, got: false, born: chainN });
          } else hurt();
        }
      }
      enemies = enemies.filter((e) => e.dead !== -1 && e.seg.x1 > cam.x - 200);

      // Token pickups: dropped ones fall back to their platform; touch to collect.
      for (const k of pickups) {
        if (k.got) continue;
        if (k.seg) {
          k.vy = Math.min(k.vy + GRV, 6);
          k.y += k.vy;
          const gy = surfaceY(k.seg, Math.max(k.seg.x0, Math.min(k.seg.x1, k.x))) - 18;
          if (k.y > gy) {
            k.y = gy;
            k.seg = null;
          }
        }
        if (Math.abs(k.x - p.x) < 13 && Math.abs(k.y - (p.y - 8)) < 16) {
          k.got = true;
          k.loot = refreshLoot(k.loot);
          lootRef.current.pickup(k.loot);
          sfx('token');
          score += 100;
          popup(k.x, k.y - 14, `+1 ${k.loot.sym}`);
        }
      }
      pickups = pickups.filter((k) => !k.got && k.x > cam.x - 300);

      // Trail at speed.
      const speed = p.ground ? Math.abs(p.gsp) : Math.hypot(p.vx, p.vy);
      if (speed > 6) trail.push({ x: p.x, y: p.y });
      if (trail.length > 10 || (speed <= 6 && trail.length)) trail.shift();

      // Camera leads where we are heading.
      const vxNow = p.ground ? p.gsp * Math.cos(segAngle(p.ground)) : p.vx;
      const leadTarget = Math.max(-110, Math.min(110, vxNow * 14));
      cam.lead += (leadTarget - cam.lead) * 0.04;
      cam.x += (p.x + cam.lead - W * 0.4 - cam.x) * 0.15;
      // Vertical follow, but never below the level's floor so a fall leaves the screen.
      cam.y += (Math.min(p.y, 240) - H * 0.6 - cam.y) * 0.08;

      // Fell off the chain.
      if (p.y > cam.y + H + 40) {
        if (p.invuln > 0) respawn();
        else hurt();
      }

      maxX = Math.max(maxX, p.x);
      // Build ahead, forget behind.
      while (cursor.x < cam.x + W + 400) extend();
      segs = segs.filter((s) => s.x1 > cam.x - 300);
      coins = coins.filter((c) => c.x > cam.x - 300);
      springs = springs.filter((s) => s.seg.x1 > cam.x - 300);
      for (const q of popups) q.t--;
      popups = popups.filter((q) => q.t > 0);
      if (shake > 0) shake--;
      p.anim += Math.max(0.15, speed * 0.08);
      return speed;
    };

    // --- drawing ---
    const drawPlayer = (x: number, y: number, alpha: number, ball: boolean) => {
      ctx.globalAlpha = alpha;
      const px = Math.round(x);
      const py = Math.round(y);
      if (ball) {
        ctx.fillStyle = '#ffe58a';
        ctx.fillRect(px - 6, py - 14, 12, 12);
        ctx.fillRect(px - 7, py - 12, 14, 8);
        ctx.fillStyle = '#f5b800';
        const r = Math.floor(p.anim) % 4;
        ctx.fillRect(px - 4 + (r % 2) * 4, py - 12 + (r >> 1) * 4, 4, 4);
      } else {
        const f = p.face;
        ctx.fillStyle = '#ffe58a'; // body
        ctx.fillRect(px - 5, py - 16, 10, 10);
        ctx.fillStyle = '#f5b800'; // visor
        ctx.fillRect(px + (f > 0 ? 0 : -5), py - 13, 5, 3);
        ctx.fillStyle = '#ffd24d'; // spikes
        ctx.fillRect(px - 5 - f * 3, py - 15, 3, 2);
        ctx.fillRect(px - 5 - f * 4, py - 11, 3, 2);
        // legs: run cycle
        const ph = Math.floor(p.anim) % 4;
        ctx.fillStyle = '#ffe58a';
        const run = Math.abs(p.gsp) > 0.3;
        ctx.fillRect(px - 4 + (run ? [0, 2, 0, -2][ph] : 0), py - 6, 3, 6);
        ctx.fillRect(px + 1 + (run ? [0, -2, 0, 2][ph] : 0), py - 6, 3, 6);
      }
      ctx.globalAlpha = 1;
    };

    const draw = (t: number) => {
      const sx = shake ? (Math.random() * 2 - 1) * 3 : 0;
      ctx.fillStyle = '#060607';
      ctx.fillRect(0, 0, W, H);
      // Parallax: far grid of "blocks".
      ctx.fillStyle = '#140606';
      for (let i = 0; i < 14; i++) {
        const bx = Math.floor(((i * 97 - cam.x * 0.2) % (W + 80) + W + 80) % (W + 80)) - 40;
        const bh = 40 + ((i * 53) % 90);
        ctx.fillRect(bx, H - bh - 20 - ((i * 31) % 40), 26, bh);
      }
      ctx.fillStyle = '#1e0909';
      for (let i = 0; i < 9; i++) {
        const bx = Math.floor(((i * 151 - cam.x * 0.45) % (W + 120) + W + 120) % (W + 120)) - 60;
        ctx.fillRect(bx, H - 40 - ((i * 37) % 50), 44, 80);
      }
      // Scanlines.
      ctx.fillStyle = 'rgba(245,184,0,0.03)';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

      ctx.save();
      ctx.translate(-Math.round(cam.x) + sx, -Math.round(cam.y));
      // Platforms.
      ctx.font = '8px monospace';
      ctx.textBaseline = 'top';
      for (const s of segs) {
        if (s.x1 < cam.x - 10 || s.x0 > cam.x + W + 10) continue;
        ctx.fillStyle = s.checkpoint ? '#2a2000' : '#17191e';
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
        ctx.lineTo(s.x1, Math.max(s.y0, s.y1) + 400);
        ctx.lineTo(s.x0, Math.max(s.y0, s.y1) + 400);
        ctx.closePath();
        ctx.fill();
        // Brick pattern on flat stretches.
        if (s.y0 === s.y1) {
          ctx.fillStyle = '#1a1300';
          for (let by = s.y0 + 8; by < s.y0 + 60; by += 8) for (let bx = s.x0 + ((by / 8) % 2) * 8; bx < s.x1 - 2; bx += 16) ctx.fillRect(Math.round(bx), by, 1, 7);
        }
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0 + 1);
        ctx.lineTo(s.x1, s.y1 + 1);
        ctx.stroke();
        ctx.strokeStyle = '#7a5c00';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x0 + 0.5, s.y0);
        ctx.lineTo(s.x0 + 0.5, s.y0 + 400);
        ctx.moveTo(s.x1 - 0.5, s.y1);
        ctx.lineTo(s.x1 - 0.5, s.y1 + 400);
        ctx.stroke();
        if (s.label && s.x1 - s.x0 > 70) {
          ctx.fillStyle = s.checkpoint ? '#ffe58a' : '#8a8a86';
          ctx.fillText(s.label.slice(0, Math.floor((s.x1 - s.x0 - 8) / 5)), s.x0 + 4, Math.max(s.y0, s.y1) + 6);
        }
      }
      // Springs.
      for (const sp of springs) {
        const sy = surfaceY(sp.seg, sp.x);
        const hgt = sp.t > 0 ? 12 : 6;
        ctx.fillStyle = '#ffd24d';
        for (let i = 0; i < hgt; i += 3) ctx.fillRect(sp.x - 5 + (i % 6 ? 2 : 0), sy - i - 2, 8, 1);
        ctx.fillStyle = '#ffe58a';
        ctx.fillRect(sp.x - 7, sy - hgt - 3, 14, 3);
      }
      // Coins.
      for (const c of coins) {
        if (c.got) continue;
        const wob = Math.abs(Math.cos(t / 180 + c.x * 0.05));
        const w = Math.max(1, Math.round(6 * wob));
        ctx.fillStyle = '#d4a843';
        ctx.fillRect(Math.round(c.x - w / 2), Math.round(c.y - 4), w, 8);
        ctx.fillStyle = '#ffe9a0';
        if (w > 2) ctx.fillRect(Math.round(c.x - w / 2) + 1, Math.round(c.y - 3), 1, 3);
      }
      // Token pickups (bobbing, glowing).
      for (const k of pickups) {
        if (k.x < cam.x - 20 || k.x > cam.x + W + 20) continue;
        drawLoot(ctx, k.loot, k.x, k.y + (k.seg ? 0 : Math.sin(t / 220 + k.x * 0.07) * 3), 14, t);
      }
      ctx.font = '8px monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      // Enemies.
      for (const e of enemies) {
        const ex = Math.round(e.x);
        const ey = Math.round(e.y);
        ctx.fillStyle = '#b0302a';
        ctx.fillRect(ex - 8, ey - 16, 16, 16);
        if (e.icon?.complete && e.icon.naturalWidth) {
          try {
            ctx.drawImage(e.icon, ex - 7, ey - 15, 14, 14);
          } catch {
            /* broken icon: keep the box */
          }
        } else {
          ctx.fillStyle = '#ffe58a';
          ctx.fillText(e.sym.slice(0, 2), ex - 5, ey - 13);
        }
        ctx.fillStyle = '#ffe58a';
        ctx.fillRect(ex - 6 + (Math.floor(t / 120) % 2) * 2, ey - 1, 3, 1);
        ctx.fillRect(ex + 3 - (Math.floor(t / 120) % 2) * 2, ey - 1, 3, 1);
      }
      // Player trail and player.
      const ball = !p.ground;
      trail.forEach((q, i) => drawPlayer(q.x, q.y, ((i + 1) / trail.length) * 0.35, ball));
      if (state !== 'over' && (p.invuln === 0 || Math.floor(t / 80) % 2 === 0)) drawPlayer(p.x, p.y, 1, ball);
      // Popups.
      ctx.fillStyle = '#ffe58a';
      for (const q of popups) ctx.fillText(q.text, Math.round(q.x - q.text.length * 2.5), Math.round(q.y - (50 - q.t) * 0.5));
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
      let speed = 0;
      while (acc >= 1000 / 60) {
        acc -= 1000 / 60;
        if (state === 'play') speed = step();
        else jumpWasDown = keys.jump;
      }
      draw(now);
      if (++hudTick % 6 === 0 && state === 'play') {
        const dist = Math.floor(Math.max(0, maxX - 40) / 16);
        setHud({ score: score + dist, lives, dist, coins: nCoins, speed: Math.round(speed * 10) / 10 });
        setFromChain(chainN);
      }
    };
    raf = requestAnimationFrame(loop);

    const start = () => {
      if (state === 'ready') {
        state = 'play';
        sfx('start');
        setPhase('play');
      }
    };
    control.current = {
      restart: () => {
        lootRef.current.end();
        setLastRun({});
        reset();
        state = 'play';
        setPhase('play');
        setHud({ score: 0, lives: 3, dist: 0, coins: 0, speed: 0 });
      },
      key: (k, down) => {
        if (k === 'left') keys.left = down;
        if (k === 'right') keys.right = down;
        if (k === 'jump') keys.jump = down;
        if (down) start();
      },
    };
    const map: Record<string, string> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump' };
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const k = map[e.key];
      if (!k) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      control.current?.key(k, down);
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
      <GameAudio track="hopper" />
      <div className="relative mx-auto w-full max-w-[960px] overflow-hidden border border-[var(--border-canvas)] bg-canvas" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full" style={{ imageRendering: 'pixelated' }} />
        <div className="pointer-events-none absolute left-2 top-1 flex gap-3 text-xs text-hot">
          <span>SCORE {hud.score.toLocaleString()}</span>
          <span>{'♥'.repeat(Math.max(0, hud.lives))}</span>
          <span className="hidden sm:inline">{hud.dist.toLocaleString()} m</span>
          <span className="hidden sm:inline">SPD {hud.speed}</span>
          <LootHud haul={loot.run} max={3} />
        </div>
        <div className="pointer-events-none absolute right-2 top-1 text-xs text-dim">
          chain: {feed.status}
        </div>
        <ModeBadge pp={pp} action="jump" actions="jumps" />
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-center">
            <p className="text-2xl font-bold text-hot">BLOCK HOPPER</p>
            <p className="px-3 text-xs text-dim">Run the live chain. ←/→ or A/D to run, SPACE / ↑ / W to jump (hold for higher).</p>
            <PlayButtons pp={pp} game="Block Hopper" action="jump" actions="jumps" onStart={() => control.current?.restart()} />
          </div>
        )}
        {phase === 'over' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
            <p className="text-3xl font-bold text-hot">GAME OVER</p>
            <p className="text-sm text-fg">
              Score {hud.score.toLocaleString()} · {hud.dist.toLocaleString()} m · {hud.coins} coins. Best: {Math.max(best, hud.score).toLocaleString()}.
            </p>
            <LootLine haul={lastRun} />
            <HighScores game="hopper" score={hud.score} secs={runSecs} live={pp.paid} txid={pp.lastTx} />
            <PlayButtons pp={pp} game="Block Hopper" action="jump" actions="jumps" onStart={() => control.current?.restart()} practiceLabel="▶ AGAIN · PRACTICE" liveLabel="▶ AGAIN · LIVE" />
          </div>
        )}
      </div>
      {/* Touch controls */}
      <div className="mt-2 flex select-none items-center justify-between gap-2 sm:hidden" style={{ touchAction: 'none' }}>
        <div className="flex gap-2">
          <button onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            control.current?.key('left', true);
          }}
          onPointerUp={() => control.current?.key('left', false)}
          onPointerCancel={() => control.current?.key('left', false)}
          onContextMenu={(e) => e.preventDefault()} className="btn h-14 w-14 text-xl">◀</button>
          <button onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            control.current?.key('right', true);
          }}
          onPointerUp={() => control.current?.key('right', false)}
          onPointerCancel={() => control.current?.key('right', false)}
          onContextMenu={(e) => e.preventDefault()} className="btn h-14 w-14 text-xl">▶</button>
        </div>
        <button onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            control.current?.key('jump', true);
          }}
          onPointerUp={() => control.current?.key('jump', false)}
          onPointerCancel={() => control.current?.key('jump', false)}
          onContextMenu={(e) => e.preventDefault()} className="btn-fire h-14 min-w-0 flex-1 !px-2">JUMP</button>
      </div>
      <p className="mt-2 text-xs text-muted">
        The level is mainnet, live: {fromChain.toLocaleString()} real transactions have become ground so far. Width is tx size; data and inscriptions are slopes, blasts drop coins, token transfers walk out as enemies wearing their token and float up as token coins to grab (stomp the enemy and it drops one too), social posts are springs, new blocks are checkpoints.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="inset px-2 py-1">
          <span className="text-dim">Score: </span>
          <span className="text-hot">{hud.score.toLocaleString()}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Lives: </span>
          <span className="text-hot">{Math.max(0, hud.lives)}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Best: </span>
          <span className="text-hot">{Math.max(best, hud.score).toLocaleString()}</span>
        </div>
      </div>
      <LootPanel run={phase === 'over' ? lastRun : loot.run} allTime={loot.allTime} />
      <PaidPanel pp={pp} game="Block Hopper" action="jump" actions="jumps" />
    </section>
  );
}
