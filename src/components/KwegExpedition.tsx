'use client';

/**
 * Kweg's Expedition: Professor Doctor Sir Kweg S Wong esq. pilots his pachyderm-powered submarine
 * through three stages chasing Satoshi's submarine coordinates. The live BSV chain shapes the world:
 * payments are bubbles, data txs are obstacles, inscriptions drift as jellies/books, social posts
 * swim by as fish, token transfers drop their own token as loot, TokenBlaster blasts are golden.
 * Hidden $KWEG coins and elephants only show up on SONAR. Each stage has a parody rival to outrace;
 * rivals are never harmed, only outwitted.
 *
 * PAID mode: every SONAR PING is a real transaction (1 sat to the house + network fee).
 */
import { useEffect, useRef, useState } from 'react';
import type { FeedTx } from '@/lib/feed';
import { lootFrom, useLoot, type Haul, type Loot } from '@/lib/loot';
import { drawLoot, refreshLoot } from '@/lib/lootCanvas';
import { tokenMeta } from '@/lib/tokenMeta';
import { useChainFeed } from '@/lib/useChainFeed';
import { HighScores, useRunClock } from './HighScores';
import { HoldButton } from './HoldButton';
import { LootHud, LootLine, LootPanel } from './LootPanel';
import { CoinOpButtons, coinOpModeLabel, useCoinOp } from './InsertCoin';
import { GameAudio } from './SoundToggle';
import { sfx } from '@/lib/sfx';

export const KWEG_ID = '17ee7fcc9c5764dc9983af912e044da8d11f26db17a5f68a0757a250db5cf983_0';
const W = 960;
const H = 540;
const STAGE_LEN = 6500;
const BASE_SPEED = 270;
const RIVAL_SPEED = 262;
const HULL = 4;
const PING_CD = 2.2;
const DASH_CD = 3.2;
const BEST_KEY = 'tokenblaster.kweg.best';

type RivalId = 'headstrong' | 'fayloor' | 'seizey';
const STAGES: { name: string; rival: RivalId; intro: string }[] = [
  { name: 'LIBRARY OF PATENTS', rival: 'headstrong', intro: 'Every book in here is patent pending. Some of them are mine.' },
  { name: 'ELEPHANT SEA', rival: 'fayloor', intro: 'Elephant-detection sonar: CALIBRATED.' },
  { name: 'MEMPOOL TRENCH', rival: 'seizey', intro: "Satoshi's submarine coordinates are down here. I can smell the peer review." },
];
const RIVALS: Record<RivalId, { name: string; short: string; mishap: string[]; recover: string; beaten: string; won: string }> = {
  headstrong: {
    name: 'Brian Headstrong', short: 'Headstrong',
    mishap: ['Listing the coordinates as a token... wait, my jet-ski is frozen.', 'ACCOUNT UNDER REVIEW. My own account?!', 'Please hold. Your jet-ski matters to us.'],
    recover: 'Review complete. Fee: 1.5%.',
    beaten: 'Brian Headstrong is still on hold with Coinbasement support. Estimated wait: 6-8 business weeks.',
    won: 'Brian Headstrong listed the coordinates as a token. They are now frozen. Expedition over.',
  },
  fayloor: {
    name: 'Michael Fayloor', short: 'Fayloor',
    mishap: ['Pfffft... a leak. I will just buy more.', 'Balloons are a store of value!', 'Altitude go down. Conviction go up.'],
    recover: "I'll just buy more balloons.",
    beaten: 'Michael Fayloor floats off muttering "I\'ll just buy more." He has bought 400 more balloons.',
    won: 'Michael Fayloor reached the coordinates first, then bought them. With balloons. Expedition over.',
  },
  seizey: {
    name: 'Seizey Binants', short: 'Seizey',
    mishap: ['Funds are SAFU! *barge sinks slightly*', 'Seizey seizes! ...the withdrawals button just popped off.', 'Funds are SAFU! Barge is less SAFU.'],
    recover: 'Barge un-paused. Everything is fine.',
    beaten: 'Seizey is bailing out Bin-Ants with a teacup. "Funds are SAFU," he says, from the lifeboat.',
    won: 'Seizey seizes! The coordinates are now held in Bin-Ants custody. Withdrawals temporarily suspended.',
  },
};
const QUIPS = [
  'Scholarly rigor: MAXIMUM.',
  'I hold the only valid license to practice Aeronautical Zoological Law on the blockchain.',
  'Patent pending. Everything is patent pending.',
  'Maritime Law is on my side. I checked. Twice.',
  'CEO of Bitcoin (self-appointed). The appointment went very well.',
  'The Maritime Pachyderm Suite reports all elephants accounted for.',
  'An elephant never forgets. Neither does the blockchain.',
];

type Kind = 'coin' | 'token' | 'gold' | 'bubble' | 'block' | 'jelly' | 'fish' | 'elephant';
type Ent = { kind: Kind; x: number; y: number; vx: number; r: number; hidden: boolean; seen: number; ph: number; loot: Loot | null; dead?: boolean };
type Part = { x: number; y: number; vx: number; vy: number; t: number; life: number; color: string; size: number; text?: string };
type Phase = 'ready' | 'play' | 'card' | 'over' | 'won';
type HUD = { score: number; kweg: number; hull: number; stage: number; ping: number; dash: number };

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const OBSTACLE: Kind[] = ['block', 'jelly'];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function bubbleText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = 'bold 14px system-ui, sans-serif';
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (ctx.measureText(line + ' ' + w).width > 230 && line) {
      lines.push(line);
      line = w;
    } else line = line ? line + ' ' + w : w;
  }
  lines.push(line);
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
  const bh = lines.length * 17 + 10;
  const bx = Math.min(Math.max(x - bw / 2, 6), W - bw - 6);
  const by = Math.max(y - bh, 40);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1d1d2b';
  ctx.lineWidth = 2.5;
  roundRect(ctx, bx, by, bw, bh, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1d1d2b';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 9, by + 6 + i * 17));
}

function drawKweg(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, dash: boolean, blink: boolean) {
  if (blink && Math.floor(t * 12) % 2) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 2) * 0.04);
  if (dash) {
    ctx.fillStyle = 'rgba(255,60,60,0.35)';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(-30 * i, 0, 46, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // propeller
  ctx.fillStyle = '#ffcf33';
  const sp = Math.abs(Math.sin(t * 30));
  ctx.beginPath();
  ctx.ellipse(-54, 0, 5, 18 * sp + 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b6274';
  ctx.fillRect(-52, -3, 10, 6);
  // cockpit dome + Kweg
  ctx.fillStyle = 'rgba(200,240,255,0.55)';
  ctx.strokeStyle = '#3d4458';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-6, -18, 22, Math.PI, 0);
  ctx.fill();
  ctx.stroke();
  // sweater vest + bow tie
  ctx.fillStyle = '#c99a4a';
  ctx.fillRect(-15, -22, 18, 10);
  ctx.fillStyle = '#e02424';
  ctx.beginPath();
  ctx.moveTo(-6, -22);
  ctx.lineTo(-12, -26);
  ctx.lineTo(-12, -18);
  ctx.closePath();
  ctx.moveTo(-6, -22);
  ctx.lineTo(0, -26);
  ctx.lineTo(0, -18);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.fillStyle = '#f5c99c';
  ctx.beginPath();
  ctx.arc(-6, -33, 10, 0, Math.PI * 2);
  ctx.fill();
  // striped engineer cap
  ctx.save();
  ctx.beginPath();
  ctx.arc(-6, -35, 11, Math.PI, 0);
  ctx.closePath();
  ctx.clip();
  for (let i = -18; i < 8; i += 4) {
    ctx.fillStyle = (i / 4) % 2 ? '#6c86ab' : '#e3ebf3';
    ctx.fillRect(i, -48, 4, 16);
  }
  ctx.restore();
  ctx.fillStyle = '#56709a';
  ctx.fillRect(-4, -37, 14, 3);
  // round glasses
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  for (const gx of [-9, -1]) {
    ctx.beginPath();
    ctx.arc(gx, -31, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#111';
  ctx.fillRect(-8, -32, 2, 2);
  ctx.fillRect(0, -32, 2, 2);
  // elephant hull
  ctx.fillStyle = '#9aa3b8';
  ctx.strokeStyle = '#3d4458';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 48, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c7d0e0';
  ctx.beginPath();
  ctx.ellipse(-6, -8, 30, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // portholes
  ctx.fillStyle = '#7fd6ff';
  ctx.strokeStyle = '#3d4458';
  ctx.lineWidth = 2;
  for (const px of [-28, -12]) {
    ctx.beginPath();
    ctx.arc(px, 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // head + ear
  ctx.fillStyle = '#9aa3b8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(42, -4, 19, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8590a8';
  ctx.beginPath();
  ctx.ellipse(32, -2, 11, 15 + Math.sin(t * 6) * 3, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // trunk periscope
  ctx.strokeStyle = '#9aa3b8';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(56, 2);
  ctx.quadraticCurveTo(74, 4, 70, -24);
  ctx.stroke();
  ctx.fillStyle = '#ffcf33';
  ctx.beginPath();
  ctx.arc(70, -27, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(50, 6, 9, 3);
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(48, -9, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRival(ctx: CanvasRenderingContext2D, id: RivalId, x: number, y: number, t: number, trouble: number, balloons: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(trouble > 0 ? Math.sin(t * 14) * 0.08 : Math.sin(t * 1.5) * 0.03);
  const face = (fx: number, fy: number, skin = '#f1c7a1') => {
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(fx, fy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(fx + 1, fy - 3, 2, 2);
    ctx.fillRect(fx + 5, fy - 3, 2, 2);
  };
  if (id === 'fayloor') {
    // extra balloons
    for (let i = 0; i < Math.min(balloons, 14); i++) {
      const bx = -70 + (i % 7) * 23 + Math.sin(t * 2 + i) * 3;
      const by = -70 - Math.floor(i / 7) * 26;
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by + 11);
      ctx.lineTo(bx * 0.5, -30);
      ctx.stroke();
      ctx.fillStyle = ['#ff7a1a', '#ffb000', '#ff4d2e', '#ffd34d'][i % 4];
      ctx.beginPath();
      ctx.ellipse(bx, by, 9, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff8a1c';
    ctx.strokeStyle = '#8a3b00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, 90, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb35c';
    ctx.beginPath();
    ctx.ellipse(-10, -14, 60, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8a1c';
    ctx.beginPath();
    ctx.moveTo(-84, -6);
    ctx.lineTo(-108, -30);
    ctx.lineTo(-100, 0);
    ctx.lineTo(-108, 30);
    ctx.lineTo(-84, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FAYLOOR', 0, 4);
    ctx.fillStyle = '#7a4a22';
    ctx.fillRect(-22, 36, 44, 16);
    face(0, 30);
    // laser eyes (cosmetic)
    ctx.strokeStyle = `rgba(255,0,0,${0.5 + 0.5 * Math.sin(t * 20)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(3, 27);
    ctx.lineTo(70, 22);
    ctx.moveTo(7, 27);
    ctx.lineTo(70, 30);
    ctx.stroke();
  } else if (id === 'headstrong') {
    // corporate jet-ski on a river of ink
    ctx.fillStyle = trouble > 0 ? '#bfe8ff' : '#1652f0';
    ctx.strokeStyle = '#0b2a7a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-60, 0);
    ctx.lineTo(55, 0);
    ctx.quadraticCurveTo(70, -4, 62, -16);
    ctx.lineTo(-40, -16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COINBASEMENT', 4, -8);
    ctx.fillStyle = '#222b40';
    ctx.fillRect(-12, -40, 16, 24); // suit
    ctx.fillStyle = '#fff';
    ctx.fillRect(-6, -40, 4, 10);
    face(-4, -48);
    ctx.fillStyle = '#eee';
    ctx.beginPath();
    ctx.arc(-4, -52, 9, Math.PI, 0); // shiny head
    ctx.fill();
    if (trouble > 0) {
      ctx.fillStyle = 'rgba(160,220,255,0.6)';
      ctx.fillRect(-64, -60, 132, 64);
      ctx.fillStyle = '#0b2a7a';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText('ACCOUNT UNDER REVIEW', 0, -66);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 4; i++) ctx.fillRect(-70 - i * 14 - ((t * 200) % 14), 2 - i, 10, 3);
    }
  } else {
    // Bin-Ants floating casino barge
    const sink = trouble > 0 ? 14 : 0;
    ctx.translate(0, sink);
    ctx.fillStyle = '#f0b90b';
    ctx.strokeStyle = '#6b4e00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-90, -10);
    ctx.lineTo(90, -10);
    ctx.lineTo(70, 22);
    ctx.lineTo(-70, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(-60, -46, 100, 36);
    ctx.fillStyle = '#f0b90b';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BIN-ANTS', -10, -28);
    // little ant mascot on the roof
    ctx.fillStyle = '#111';
    for (const ax of [-40, -32, -24]) {
      ctx.beginPath();
      ctx.arc(ax, -52, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff3b3b';
    if (trouble <= 0) {
      ctx.fillRect(48, -40, 30, 14);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px system-ui, sans-serif';
      ctx.fillText('WITHDRAW', 63, -33);
    } else {
      // the withdrawals button pops off
      ctx.save();
      ctx.translate(70 + (1.2 - trouble) * 60, -60 - (1.2 - trouble) * 40);
      ctx.rotate(t * 6);
      ctx.fillRect(-15, -7, 30, 14);
      ctx.restore();
    }
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-84, -26, 16, 16);
    face(-76, -34, '#f3d2ae');
  }
  ctx.restore();
}

export function KwegExpedition() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feed = useChainFeed();
  // Coin-op: 10p buys a credit (src/lib/coinop.ts); practice is free and puts nothing on chain.
  const co = useCoinOp("Kweg's Expedition", 'kweg');
  const [run, setRun] = useState<{ paid: boolean; txid: string | null }>({ paid: false, txid: null });
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const loot = useLoot('kweg');
  const lootRef = useRef(loot);
  useEffect(() => {
    lootRef.current = loot;
  });
  useEffect(() => () => lootRef.current.end(), []);
  const [lastRun, setLastRun] = useState<Haul>({});
  const [hud, setHud] = useState<HUD>({ score: 0, kweg: 0, hull: HULL, stage: 0, ping: 1, dash: 1 });
  const [phase, setPhase] = useState<Phase>('ready');
  const runSecs = useRunClock(phase === 'play' || phase === 'card');
  const [card, setCard] = useState<{ title: string; text: string } | null>(null);
  const [best, setBest] = useState(0);
  const control = useRef<{ restart: () => void; next: () => void; key: (k: string, down: boolean) => void } | null>(null);

  useEffect(() => {
    try {
      const b = Number(localStorage.getItem(BEST_KEY) ?? 0);
      if (b) void Promise.resolve().then(() => setBest(b));
    } catch {
      /* no storage */
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    tokenMeta(KWEG_ID); // start the icon lookup
    const kwegLoot = (): Loot => refreshLoot({ id: KWEG_ID, sym: 'KWEG', icon: null });

    let state: Phase = 'ready';
    let t = 0;
    let stage = 0;
    let dist = 0; // within the stage
    let rival = { dist: 300, trouble: 0, say: '', sayT: 0, nextMishap: 8, balloons: 3, y: 120 };
    const k = { x: 200, y: H / 2, hull: HULL, inv: 0, stun: 0, dash: 0, dashCd: 0, pingCd: 0, tow: 0 };
    let ents: Ent[] = [];
    let parts: Part[] = [];
    let pings: { x: number; y: number; r: number }[] = [];
    let score = 0;
    let kweg = 0;
    let spawnT = 0;
    let coinT = 1;
    let eleT = 4;
    let quip = { text: STAGES[0].intro, t: 4 };
    let quipNext = 9;
    let banner = { text: '', t: 0 };
    let shake = 0;
    const keys = new Set<string>();
    let touch: { x: number; y: number } | null = null;

    const pop = (x: number, y: number, text: string, color = '#1d1d2b') => parts.push({ x, y, vx: 0, vy: -40, t: 0, life: 1.1, color, size: 18, text });
    const burst = (x: number, y: number, color: string, n = 10) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 60 + Math.random() * 160;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.6 + Math.random() * 0.4, color, size: 3 + Math.random() * 4 });
      }
    };
    const rivalSay = (text: string) => {
      rival.say = text;
      rival.sayT = 3.2;
    };
    const mishap = (why?: string) => {
      if (rival.trouble > 0) return;
      const R = RIVALS[STAGES[stage].rival];
      rival.trouble = 3.5;
      rivalSay(why ?? pick(R.mishap));
    };

    const startStage = (s: number) => {
      stage = s;
      dist = 0;
      rival = { dist: 320, trouble: 0, say: '', sayT: 0, nextMishap: 7 + Math.random() * 5, balloons: 3, y: 120 };
      ents = [];
      pings = [];
      banner = { text: `STAGE ${s + 1}: ${STAGES[s].name}`, t: 3 };
      quip = { text: STAGES[s].intro, t: 4 };
      rivalSay(
        STAGES[s].rival === 'headstrong'
          ? "I'm listing those coordinates as a token. Wen listing? Now listing."
          : STAGES[s].rival === 'fayloor'
            ? 'Those coordinates? I will simply buy them.'
            : 'Seizey seizes! Those coordinates are SAFU. With me.',
      );
      state = 'play';
      setPhase('play');
    };
    const restart = () => {
      score = 0;
      kweg = 0;
      Object.assign(k, { x: 200, y: H / 2, hull: HULL, inv: 1, stun: 0, dash: 0, dashCd: 0, pingCd: 0, tow: 0 });
      parts = [];
      lootRef.current.end();
      setCard(null);
      startStage(0);
    };
    const finish = (won: boolean, text: string) => {
      sfx(won ? 'level' : 'gameover');
      state = won ? 'won' : 'over';
      const haul = { ...lootRef.current.run };
      setLastRun(haul);
      lootRef.current.end();
      setCard({ title: won ? 'Coordinates secured. Peer review: pending.' : 'EXPEDITION ABORTED', text });
      setPhase(state);
      score = Math.floor(score);
      setHud((h) => ({ ...h, score }));
      setBest((b) => {
        const nb = Math.max(b, score);
        try {
          localStorage.setItem(BEST_KEY, String(nb));
        } catch {
          /* fine */
        }
        return nb;
      });
    };

    const sonar = () => {
      if (state !== 'play' || k.pingCd > 0) return;
      k.pingCd = PING_CD;
      pings.push({ x: k.x + 60, y: k.y - 25, r: 0 });
      sfx('sonar');
      score += 1;
    };
    const dashGo = () => {
      if (state !== 'play' || k.dashCd > 0) return;
      k.dash = 0.5;
      k.dashCd = DASH_CD;
      sfx('stamp');
      pop(k.x, k.y - 50, 'PATENT PENDING!', '#e02424');
    };

    control.current = {
      restart,
      next: () => {
        if (state !== 'card') return;
        setCard(null);
        startStage(stage + 1);
      },
      key: (key, down) => {
        if (down) keys.add(key);
        else keys.delete(key);
        if (down && key === 'sonar') sonar();
        if (down && key === 'dash') dashGo();
      },
    };

    const spawnFromTx = (f: FeedTx) => {
      const y = 70 + Math.random() * (H - 140);
      const base: Ent = { kind: 'bubble', x: W + 40, y, vx: 0, r: 10, hidden: false, seen: 0, ph: Math.random() * 6, loot: null };
      switch (f.kind) {
        case 'token':
          return ents.push({ ...base, kind: 'token', r: 18, loot: lootFrom(f) });
        case 'blast':
          return ents.push({ ...base, kind: 'gold', r: 18 });
        case 'payment':
          return ents.push({ ...base, kind: 'bubble', r: Math.min(16, 6 + Math.log10(Math.max(f.sats, 10)) * 1.5) });
        case 'social':
          return ents.push({ ...base, kind: 'fish', r: 14, vx: -40 });
        case 'inscription':
          return ents.push({ ...base, kind: 'jelly', r: 20 });
        default:
          return ents.push({ ...base, kind: 'block', r: 22, vx: -20 + Math.random() * 30 });
      }
    };

    const update = (dt: number) => {
      t += dt;
      if (state !== 'play') return;
      // movement
      const sp = 330;
      let mx = 0;
      let my = 0;
      if (keys.has('up')) my -= 1;
      if (keys.has('down')) my += 1;
      if (keys.has('left')) mx -= 1;
      if (keys.has('right')) mx += 1;
      if (touch) {
        const dx = touch.x - k.x;
        const dy = touch.y - k.y;
        mx = Math.max(-1, Math.min(1, dx / 40));
        my = Math.max(-1, Math.min(1, dy / 40));
      }
      k.x = Math.max(70, Math.min(W * 0.62, k.x + mx * sp * dt));
      k.y = Math.max(70, Math.min(H - 40, k.y + my * sp * dt));
      for (const key of ['inv', 'stun', 'dash', 'dashCd', 'pingCd', 'tow'] as const) k[key] = Math.max(0, k[key] - dt);
      const speed = BASE_SPEED * (k.stun > 0 ? 0.45 : 1) * (k.dash > 0 ? 2.3 : 1) * (k.tow > 0 ? 1.45 : 1);
      dist += speed * dt;
      score += Math.floor(speed * dt * 0.05 * 10) / 10;

      // rival
      rival.nextMishap -= dt;
      if (rival.nextMishap <= 0) {
        mishap();
        rival.nextMishap = 9 + Math.random() * 8;
      }
      if (rival.trouble > 0) {
        rival.trouble -= dt;
        if (rival.trouble <= 0) {
          rivalSay(RIVALS[STAGES[stage].rival].recover);
          rival.balloons += 3;
        }
      }
      rival.sayT -= dt;
      const rs = rival.trouble > 0 ? 70 : RIVAL_SPEED + stage * 8 + (STAGES[stage].rival === 'fayloor' ? rival.balloons : 0);
      rival.dist += rs * dt;
      const rx = k.x + (rival.dist - dist) * 0.55;
      rival.y = (STAGES[stage].rival === 'fayloor' ? 150 : STAGES[stage].rival === 'headstrong' ? H - 70 : 150) + Math.sin(t * 1.3) * 10;
      // overtaking during a patent dash outwits them
      if (k.dash > 0 && Math.abs(rx - k.x) < 80 && rival.trouble <= 0) {
        mishap(STAGES[stage].rival === 'fayloor' ? 'PRIOR ART?! My balloon! ...I will just buy more.' : undefined);
        pop(rx, rival.y - 40, 'PRIOR ART!', '#e02424');
        score += 50;
      }

      // pings reveal hidden things
      for (const p of pings) {
        p.r += 560 * dt;
        for (const e of ents)
          if (e.hidden && Math.hypot(e.x - p.x, e.y - p.y) < p.r) {
            e.hidden = false;
            e.seen = 6;
            burst(e.x, e.y, '#7fffd4', 6);
          }
        if (p.r > 120 && p.r < 140 && rx > -50 && rx < W + 50 && Math.hypot(rx - p.x, rival.y - p.y) < 300) {
          const ps = STAGES[stage].rival;
          mishap(ps === 'fayloor' ? 'Your sonar popped a balloon. I will just buy more.' : ps === 'seizey' ? 'Sonar detected! Seizey seizes! Withdrawals paused. Funds are SAFU!' : 'Sonar ping flagged as suspicious. Freezing my own account.');
        }
      }
      pings = pings.filter((p) => p.r < 560);

      // spawning
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = 0.42 - stage * 0.06;
        const f = Math.random() < 0.35 ? feedRef.current.take((x) => x.kind === 'token' || x.kind === 'blast') : null;
        const g = f ?? feedRef.current.take();
        if (g) spawnFromTx(g);
        else if (Math.random() < 0.5) {
          // quiet mempool: stage scenery still gets in the way
          ents.push({ kind: Math.random() < 0.6 ? 'bubble' : pick(OBSTACLE), x: W + 40, y: 70 + Math.random() * (H - 140), vx: 0, r: 16, hidden: false, seen: 0, ph: Math.random() * 6, loot: null });
        }
      }
      coinT -= dt;
      if (coinT <= 0) {
        coinT = 1.6 + Math.random() * 1.4;
        const hidden = Math.random() < 0.6;
        const y0 = 90 + Math.random() * (H - 200);
        const n = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) ents.push({ kind: 'coin', x: W + 40 + i * 42, y: y0 + Math.sin(i * 0.9) * 30, vx: 0, r: 14, hidden, seen: 0, ph: i, loot: null });
      }
      eleT -= dt;
      if (eleT <= 0) {
        eleT = 6 + Math.random() * 4;
        ents.push({ kind: 'elephant', x: W + 60, y: 100 + Math.random() * (H - 200), vx: -10, r: 30, hidden: true, seen: 0, ph: 0, loot: null });
      }

      // entities
      for (const e of ents) {
        e.x += (e.vx - speed) * dt;
        e.ph += dt;
        if (e.seen > 0) e.seen -= dt;
        if (e.kind === 'jelly') e.y += Math.sin(e.ph * 2.2) * 60 * dt;
        if (e.kind === 'fish') e.y += Math.sin(e.ph * 4) * 30 * dt;
        if (e.kind === 'elephant' && !e.hidden && e.seen > 0) e.y += Math.sign(k.y - e.y) * 60 * dt;
        if (e.x < -80) e.dead = true;
        if (e.dead) continue;
        const d = Math.hypot(e.x - (k.x + 10), e.y - k.y);
        if (d > e.r + 30) continue;
        if (e.hidden) continue; // hidden things are only collectible once pinged
        switch (e.kind) {
          case 'coin':
            e.dead = true;
            kweg++;
            score += 10;
            sfx('coin');
            lootRef.current.pickup(kwegLoot());
            burst(e.x, e.y, '#ffd34d', 8);
            pop(e.x, e.y - 20, '+1 $KWEG', '#b8860b');
            break;
          case 'token':
            e.dead = true;
            score += 50;
            sfx('token');
            if (e.loot) {
              const l = refreshLoot(e.loot);
              lootRef.current.pickup(l);
              pop(e.x, e.y - 20, `+1 ${l.sym}`, '#b8860b');
            }
            burst(e.x, e.y, '#ffd34d', 12);
            break;
          case 'gold':
            e.dead = true;
            score += 100;
            k.tow = Math.max(k.tow, 2);
            sfx('token');
            burst(e.x, e.y, '#fff3a0', 16);
            pop(e.x, e.y - 20, 'BLAST! +100', '#b8860b');
            break;
          case 'bubble':
            e.dead = true;
            score += 2;
            sfx('click', 0.6);
            burst(e.x, e.y, '#bfefff', 5);
            break;
          case 'fish':
            e.dead = true;
            score += 15;
            sfx('pickup');
            pop(e.x, e.y - 20, '+15 gossip fish', '#d9480f');
            break;
          case 'elephant':
            e.dead = true;
            k.tow = 4;
            score += 40;
            sfx('spring');
            pop(e.x, e.y - 30, 'ELEPHANT TOW!', '#5b6274');
            quip = { text: 'A Maritime Pachyderm! Detected by sonar, as the patent describes.', t: 3 };
            break;
          default:
            if (k.dash > 0) {
              e.dead = true;
              score += 25;
              sfx('stamp');
              burst(e.x, e.y, '#e02424', 12);
              pop(e.x, e.y - 20, 'PATENTED!', '#e02424');
            } else if (k.inv <= 0) {
              e.dead = true;
              k.hull--;
              k.inv = 1.4;
              k.stun = 0.8;
              shake = 0.3;
              sfx('hurt');
              burst(e.x, e.y, '#ff6b6b', 14);
              quip = { text: pick(['Unscholarly!', 'That obstacle will hear from my lawyers. I am my lawyers.', 'Hull integrity: a matter for peer review.']), t: 2.5 };
              if (k.hull <= 0) return finish(false, 'The pachyderm submarine needs repairs. Scholarly rigor remains at MAXIMUM.');
            }
        }
      }
      ents = ents.filter((e) => !e.dead);

      for (const p of parts) {
        p.t += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (!p.text) p.vy += 200 * dt;
      }
      parts = parts.filter((p) => p.t < p.life);
      quip.t -= dt;
      quipNext -= dt;
      if (quipNext <= 0) {
        quipNext = 10 + Math.random() * 6;
        quip = { text: pick(QUIPS), t: 3.5 };
      }
      banner.t -= dt;
      shake = Math.max(0, shake - dt);

      // stage ends
      const R = RIVALS[STAGES[stage].rival];
      if (rival.dist >= STAGE_LEN && dist < STAGE_LEN) return finish(false, R.won);
      if (dist >= STAGE_LEN) {
        score += 200;
        if (stage === STAGES.length - 1)
          return finish(true, `${R.beaten} Satoshi's submarine coordinates are now in the Maritime Pachyderm Suite, filed under "patent pending".`);
        state = 'card';
        sfx('level');
        setCard({ title: `You outraced ${R.name}!`, text: R.beaten });
        setPhase('card');
      }
    };

    const drawBg = () => {
      const scroll = dist + stage * 10000;
      if (stage === 0) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#fff2d6');
        g.addColorStop(1, '#f2cf93');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        // bookshelves
        const off = (scroll * 0.3) % 160;
        for (let i = -1; i < 8; i++) {
          const idx = Math.floor((scroll * 0.3) / 160) + i;
          const x = i * 160 - off;
          ctx.fillStyle = '#8a5a3a';
          ctx.fillRect(x + 10, 60, 140, H - 160);
          for (let s = 0; s < 4; s++) {
            const sy = 70 + s * ((H - 180) / 4);
            for (let b = 0; b < 9; b++) {
              const h = 40 + hash(idx * 31 + s * 7 + b) * 25;
              ctx.fillStyle = ['#e63946', '#2a9d8f', '#e9c46a', '#457b9d', '#f4a261', '#8d5ab4'][Math.floor(hash(idx + s * 3 + b * 11) * 6)];
              ctx.fillRect(x + 18 + b * 14.5, sy + 60 - h, 12, h);
            }
            ctx.fillStyle = '#5e3a22';
            ctx.fillRect(x + 10, sy + 60, 140, 6);
          }
        }
        // ink river
        ctx.fillStyle = '#2b3a67';
        ctx.fillRect(0, H - 60, W, 60);
        ctx.fillStyle = '#4a5f9e';
        for (let x = -((scroll * 0.9) % 60); x < W; x += 60) ctx.fillRect(x, H - 58, 30, 3);
        ctx.fillStyle = '#5e3a22';
        ctx.fillRect(0, H - 100, W, 0);
      } else if (stage === 1) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#8fdcff');
        g.addColorStop(0.3, '#bdeeff');
        g.addColorStop(0.31, '#2fb3e6');
        g.addColorStop(1, '#0a5aa0');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff6a8';
        ctx.beginPath();
        ctx.arc(820, 60, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 0; i < 4; i++) {
          const cx = ((i * 300 - scroll * 0.1) % 1200 + 1200) % 1200 - 120;
          ctx.beginPath();
          ctx.ellipse(cx, 40 + i * 12, 50, 14, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // waves
        ctx.strokeStyle = '#e8fbff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) ctx.lineTo(x, H * 0.305 + Math.sin(x * 0.03 + t * 3 + scroll * 0.01) * 4);
        ctx.stroke();
        // light rays + seaweed
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        for (let i = 0; i < 5; i++) {
          const x = ((i * 230 - scroll * 0.2) % 1150 + 1150) % 1150 - 100;
          ctx.beginPath();
          ctx.moveTo(x, H * 0.31);
          ctx.lineTo(x + 60, H * 0.31);
          ctx.lineTo(x + 160, H);
          ctx.lineTo(x + 40, H);
          ctx.fill();
        }
        ctx.fillStyle = '#e0c48a';
        ctx.fillRect(0, H - 24, W, 24);
        ctx.strokeStyle = '#2e9e5b';
        ctx.lineWidth = 6;
        for (let i = -1; i < 14; i++) {
          const idx = Math.floor((scroll * 0.7) / 80) + i;
          const x = i * 80 - ((scroll * 0.7) % 80);
          const h = 40 + hash(idx) * 70;
          ctx.beginPath();
          ctx.moveTo(x, H - 20);
          ctx.quadraticCurveTo(x + Math.sin(t * 2 + idx) * 14, H - 20 - h / 2, x + Math.sin(t * 2 + idx) * 8, H - 20 - h);
          ctx.stroke();
        }
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#2a1a63');
        g.addColorStop(1, '#0b0726');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.font = '12px monospace';
        ctx.fillStyle = 'rgba(140,200,255,0.12)';
        for (let i = 0; i < 18; i++) {
          const x = ((i * 97 - scroll * 0.2) % 1100 + 1100) % 1100 - 70;
          ctx.fillText(Math.floor(hash(i + Math.floor(scroll / 1100)) * 0xffffffff).toString(16), x, 60 + ((i * 53) % (H - 120)));
        }
        for (const [top, col] of [[true, '#3d2a7a'], [false, '#46308c']] as const) {
          ctx.fillStyle = col;
          ctx.beginPath();
          const y0 = top ? 0 : H;
          ctx.moveTo(0, y0);
          for (let i = -1; i < 26; i++) {
            const idx = Math.floor((scroll * 0.8) / 40) + i;
            const x = i * 40 - ((scroll * 0.8) % 40);
            const h = 18 + hash(idx * (top ? 3 : 7)) * 34;
            ctx.lineTo(x, top ? h : H - h);
          }
          ctx.lineTo(W, y0);
          ctx.fill();
        }
      }
    };

    const drawEnt = (e: Ent) => {
      if (e.hidden) {
        // a faint shimmer: something is there, ping to see it
        ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.08 * Math.sin(e.ph * 5)})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      if (e.seen > 0) {
        ctx.strokeStyle = `rgba(127,255,212,${Math.min(1, e.seen)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      switch (e.kind) {
        case 'coin': {
          ctx.save();
          ctx.translate(e.x, e.y);
          ctx.scale(Math.max(0.25, Math.abs(Math.cos(e.ph * 3))), 1);
          drawLoot(ctx, kwegLoot(), 0, 0, 28, t * 1000);
          ctx.restore();
          break;
        }
        case 'token':
          if (e.loot) drawLoot(ctx, refreshLoot(e.loot), e.x, e.y, 34, t * 1000);
          break;
        case 'gold': {
          ctx.fillStyle = 'rgba(255,230,120,0.4)';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r + 8 + Math.sin(e.ph * 6) * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffd34d';
          ctx.strokeStyle = '#b8860b';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#b8860b';
          ctx.font = 'bold 18px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('★', e.x, e.y + 1);
          break;
        }
        case 'bubble':
          ctx.strokeStyle = stage === 0 ? 'rgba(120,90,200,0.7)' : 'rgba(230,250,255,0.85)';
          ctx.fillStyle = stage === 0 ? 'rgba(180,160,255,0.25)' : 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(e.x - e.r * 0.35, e.y - e.r * 0.35, e.r * 0.25, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'fish':
          ctx.fillStyle = '#ff8c42';
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, 16, 10, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(e.x + 14, e.y);
          ctx.lineTo(e.x + 26, e.y - 9);
          ctx.lineTo(e.x + 26, e.y + 9);
          ctx.fill();
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(e.x - 8, e.y - 2, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('...', e.x + 2, e.y - 12);
          break;
        case 'elephant':
          ctx.fillStyle = '#a7b0c4';
          ctx.strokeStyle = '#4d566b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, 30, 20, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(e.x - 26, e.y - 8, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = '#a7b0c4';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(e.x - 38, e.y - 4);
          ctx.quadraticCurveTo(e.x - 50, e.y - 20, e.x - 44, e.y - 36);
          ctx.stroke();
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(e.x - 30, e.y - 12, 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'jelly':
          if (stage === 0) {
            // a flapping law book
            const f = Math.abs(Math.sin(e.ph * 8)) * 14;
            ctx.fillStyle = '#7b2d26';
            ctx.beginPath();
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(e.x - 22, e.y - f);
            ctx.lineTo(e.x - 22, e.y + 14 - f);
            ctx.lineTo(e.x, e.y + 14);
            ctx.lineTo(e.x + 22, e.y + 14 - f);
            ctx.lineTo(e.x + 22, e.y - f);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#ffe9b0';
            ctx.font = 'bold 8px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('LAW', e.x - 11, e.y + 7 - f / 2);
          } else {
            const p = 1 + Math.sin(e.ph * 4) * 0.12;
            ctx.fillStyle = stage === 1 ? 'rgba(255,120,200,0.85)' : 'rgba(120,255,230,0.85)';
            ctx.beginPath();
            ctx.ellipse(e.x, e.y, 20 * p, 16 / p, 0, Math.PI, 0);
            ctx.fill();
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = 2;
            for (let i = -2; i <= 2; i++) {
              ctx.beginPath();
              ctx.moveTo(e.x + i * 7, e.y);
              ctx.quadraticCurveTo(e.x + i * 7 + Math.sin(e.ph * 5 + i) * 6, e.y + 14, e.x + i * 7, e.y + 26);
              ctx.stroke();
            }
          }
          break;
        default:
          if (stage === 0) {
            // flying patent scroll
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.rotate(Math.sin(e.ph * 2) * 0.3);
            ctx.fillStyle = '#fff7e0';
            ctx.strokeStyle = '#a07a3a';
            ctx.lineWidth = 2;
            ctx.fillRect(-20, -24, 40, 48);
            ctx.strokeRect(-20, -24, 40, 48);
            ctx.fillStyle = '#d9c08a';
            ctx.fillRect(-24, -28, 48, 7);
            ctx.fillRect(-24, 21, 48, 7);
            ctx.fillStyle = '#b02a2a';
            ctx.font = 'bold 8px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('PATENT', 0, -8);
            ctx.fillStyle = '#999';
            for (let i = 0; i < 3; i++) ctx.fillRect(-14, 0 + i * 6, 28, 2);
            ctx.restore();
          } else if (stage === 1) {
            ctx.fillStyle = '#9c5b2e';
            ctx.strokeStyle = '#5c3218';
            ctx.lineWidth = 3;
            roundRect(ctx, e.x - 18, e.y - 22, 36, 44, 8);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(e.x - 18, e.y - 8);
            ctx.lineTo(e.x + 18, e.y - 8);
            ctx.moveTo(e.x - 18, e.y + 8);
            ctx.lineTo(e.x + 18, e.y + 8);
            ctx.stroke();
          } else {
            ctx.fillStyle = '#7a4dff';
            ctx.strokeStyle = '#c8b6ff';
            ctx.lineWidth = 2;
            roundRect(ctx, e.x - 20, e.y - 20, 40, 40, 6);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#e8e0ff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('TX', e.x, e.y);
          }
      }
    };

    const draw = () => {
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      drawBg();
      for (const e of ents) drawEnt(e);
      // rival
      const rid = STAGES[stage].rival;
      const rx = k.x + (rival.dist - dist) * 0.55;
      if (rx > -140 && rx < W + 140) {
        drawRival(ctx, rid, rx, rival.y, t, rival.trouble, rival.balloons);
        if (rival.trouble > 0 && Math.random() < 0.4) parts.push({ x: rx + (Math.random() - 0.5) * 80, y: rival.y - 10, vx: -80, vy: -30, t: 0, life: 0.6, color: rid === 'fayloor' ? '#ffffff' : rid === 'seizey' ? '#9fd8ff' : '#d8f2ff', size: 5 });
      } else if (state === 'play') {
        const right = rx > W;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1d1d2b';
        ctx.lineWidth = 2;
        const ax = right ? W - 150 : 10;
        roundRect(ctx, ax, rival.y - 14, 140, 28, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1d1d2b';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${right ? '' : '◀ '}${RIVALS[rid].short} ${Math.round(Math.abs(rival.dist - dist) / 10)}m${right ? ' ▶' : ''}`, ax + 70, rival.y);
      }
      if (rival.sayT > 0 && state === 'play') bubbleText(ctx, `${RIVALS[rid].short}: ${rival.say}`, Math.min(Math.max(rx, 150), W - 150), rival.y - 50);
      // pings
      for (const p of pings) {
        ctx.strokeStyle = `rgba(127,255,212,${1 - p.r / 560})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawKweg(ctx, k.x, k.y, t, k.dash > 0, k.inv > 0 && state === 'play');
      if (k.tow > 0) {
        ctx.fillStyle = '#5b6274';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('ELEPHANT TOW', k.x, k.y + 40);
      }
      for (const p of parts) {
        ctx.globalAlpha = 1 - p.t / p.life;
        if (p.text) {
          ctx.font = `900 ${p.size}px system-ui`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#fff';
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y);
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // race bar
      const bx = 180;
      const bw = W - 360;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      roundRect(ctx, bx - 10, 8, bw + 20, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#c9c9d6';
      ctx.fillRect(bx, 20, bw, 3);
      ctx.font = 'bold 16px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e02424';
      ctx.fillText('✕', bx + bw, 21);
      const rp = Math.min(1, rival.dist / STAGE_LEN);
      const kp = Math.min(1, dist / STAGE_LEN);
      ctx.fillStyle = rid === 'fayloor' ? '#ff8a1c' : rid === 'headstrong' ? '#1652f0' : '#f0b90b';
      ctx.beginPath();
      ctx.arc(bx + rp * bw, 21, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6c86ab';
      ctx.strokeStyle = '#1d1d2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx + kp * bw, 21, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1d1d2b';
      ctx.font = 'bold 11px system-ui';
      ctx.fillText('K', bx + kp * bw, 21.5);
      // stage name + hull
      ctx.textAlign = 'left';
      ctx.font = 'bold 13px system-ui';
      ctx.fillStyle = stage === 2 ? '#e8e0ff' : '#1d1d2b';
      ctx.fillText(STAGES[stage].name, 10, 52);
      ctx.textAlign = 'right';
      ctx.fillText('HULL ' + '♥'.repeat(Math.max(0, k.hull)) + '♡'.repeat(Math.max(0, HULL - k.hull)), W - 10, 52);
      if (banner.t > 0) {
        ctx.globalAlpha = Math.min(1, banner.t);
        ctx.font = '900 40px system-ui';
        ctx.textAlign = 'center';
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#1d1d2b';
        ctx.strokeText(banner.text, W / 2, H / 2 - 60);
        ctx.fillStyle = '#ffd34d';
        ctx.fillText(banner.text, W / 2, H / 2 - 60);
        ctx.globalAlpha = 1;
      }
      if (quip.t > 0 && state === 'play') {
        ctx.font = 'italic bold 14px system-ui';
        const text = `Kweg: “${quip.text}”`;
        const w = ctx.measureText(text).width + 20;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        roundRect(ctx, W / 2 - w / 2, H - 34, w, 24, 12);
        ctx.fill();
        ctx.fillStyle = '#1d1d2b';
        ctx.textAlign = 'center';
        ctx.fillText(text, W / 2, H - 21);
      }
    };

    let last = performance.now();
    let hudAt = 0;
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      draw();
      if (now - hudAt > 150 && state === 'play') {
        hudAt = now;
        setHud({ score: Math.floor(score), kweg, hull: k.hull, stage, ping: 1 - k.pingCd / PING_CD, dash: 1 - k.dashCd / DASH_CD });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const map: Record<string, string> = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'sonar', z: 'sonar', Z: 'sonar', x: 'dash', X: 'dash', Shift: 'dash' };
    const kd = (e: KeyboardEvent) => {
      const m = map[e.key];
      if (!m) {
        if (e.key === 'Enter') {
          if (state === 'card') control.current?.next();
          else if (state === 'ready') restart(); // practice; credit games start from the title buttons
        }
        return;
      }
      if (state === 'play') e.preventDefault();
      if (!keys.has(m)) control.current?.key(m, true);
    };
    const ku = (e: KeyboardEvent) => {
      const m = map[e.key];
      if (m) control.current?.key(m, false);
    };
    const toCanvas = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H - 30 };
    };
    const pd = (e: PointerEvent) => {
      if (state !== 'play') return;
      canvas.setPointerCapture?.(e.pointerId);
      touch = toCanvas(e);
    };
    const pm = (e: PointerEvent) => {
      if (touch) touch = toCanvas(e);
    };
    const pu = () => {
      touch = null;
    };
    // Dev only: jump to the end of the current stage, e.g. __kweg.skip(), to check every stage and card.
    if (process.env.NODE_ENV !== 'production')
      (window as unknown as { __kweg?: unknown }).__kweg = {
        skip: () => {
          dist = STAGE_LEN - 400;
          k.inv = 30;
        },
      };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    canvas.addEventListener('pointerdown', pd);
    canvas.addEventListener('pointermove', pm);
    canvas.addEventListener('pointerup', pu);
    canvas.addEventListener('pointercancel', pu);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      canvas.removeEventListener('pointerdown', pd);
      canvas.removeEventListener('pointermove', pm);
      canvas.removeEventListener('pointerup', pu);
      canvas.removeEventListener('pointercancel', pu);
    };
  }, []);

  const overlay = 'absolute inset-0 overflow-y-auto flex flex-col items-center justify-center gap-2 bg-[#fff6e0]/90 px-4 text-center text-[#1d1d2b]';
  const bigBtn = 'rounded-full border-[3px] border-[#1d1d2b] bg-[#ffd34d] px-6 py-2 font-sans text-lg font-black text-[#1d1d2b] shadow-[0_4px_0_#1d1d2b] active:translate-y-1 active:shadow-none';
  const cdBtn = (ready: number) => `rounded-xl border-[3px] border-[#1d1d2b] px-3 font-sans font-black text-[#1d1d2b] ${ready >= 1 ? 'bg-[#7fffd4]' : 'bg-[#cfd6e0]'}`;

  /** Start a game: a credit game spends one credit (its coin's txid goes with the run), practice is free. */
  const start = (paid: boolean) => {
    const txid = paid ? co.consume() : null;
    if (paid && !txid) return;
    setRun({ paid, txid });
    control.current?.restart();
  };

  return (
    <section className="panel">
      <GameAudio track="kweg" />
      <div className="relative mx-auto w-full max-w-[960px] overflow-hidden rounded border border-[var(--border-canvas)] bg-[#fff2d6]" style={{ aspectRatio: '16 / 9', touchAction: 'none' }}>
        <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full" />
        <div className="pointer-events-none absolute bottom-[12%] left-2 flex flex-wrap items-center gap-2 rounded bg-white/80 px-2 py-0.5 font-sans text-[11px] font-bold text-[#1d1d2b] sm:text-xs">
          <span>SCORE {hud.score.toLocaleString()}</span>
          <span>$KWEG {hud.kweg}</span>
          <LootHud haul={loot.run} max={3} />
        </div>
        <div className="pointer-events-none absolute bottom-[12%] right-2 rounded bg-white/80 px-2 py-0.5 font-sans text-[11px] text-[#1d1d2b]">chain: {feed.status}</div>
        {phase === 'play' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
            <span className="border border-[var(--border-canvas)] bg-black/60 px-3 py-0.5 text-xs font-bold tracking-widest text-dim">{coinOpModeLabel(run.paid, co.credits)}</span>
          </div>
        )}
        {phase === 'ready' && (
          <div className={overlay}>
            <p className="font-sans text-2xl font-black sm:text-4xl">KWEG&apos;S EXPEDITION</p>
            <p className="max-w-lg font-sans text-xs sm:text-sm">
              Professor Doctor Sir Kweg S Wong esq. races three rivals to Satoshi&apos;s submarine coordinates. Arrows / WASD or drag to steer · SPACE = sonar ping (finds hidden $KWEG
              and elephants) · X = patent-stamp dash.
            </p>
            <div className="rounded-xl bg-[#1d1d2b] p-3 font-mono"><CoinOpButtons co={co} start={start} perCredit="1 credit = 1 expedition, until the hull gives out." playLabel="BEGIN" practiceLabel="▶ BEGIN · PRACTICE" /></div>
          </div>
        )}
        {card && (phase === 'card' || phase === 'over' || phase === 'won') && (
          <div className={overlay}>
            <p className="font-sans text-xl font-black sm:text-3xl">{card.title}</p>
            <p className="max-w-lg font-sans text-xs sm:text-sm">{card.text}</p>
            {phase !== 'card' && (
              <>
                <p className="font-sans text-xs sm:text-sm">
                  Score {hud.score.toLocaleString()} · best {Math.max(best, hud.score).toLocaleString()}
                </p>
                <div className="font-sans text-xs">
                  <LootLine haul={lastRun} />
                </div>
                <HighScores game="kweg" score={hud.score} secs={runSecs} live={run.paid} txid={run.txid} meta={run.paid ? { stage: hud.stage + 1, coinop: 1 } : { stage: hud.stage + 1 }} />
              </>
            )}
            {phase === 'card' ? (
              <button onClick={() => control.current?.next()} className={bigBtn}>
                ONWARD
              </button>
            ) : (
              <div className="rounded-xl bg-[#1d1d2b] p-3 font-mono"><CoinOpButtons co={co} start={start} perCredit="1 credit = 1 expedition, until the hull gives out." /></div>
            )}
          </div>
        )}
      </div>
      <div className="mx-auto mt-2 flex max-w-[960px] select-none items-stretch justify-between gap-2 sm:hidden" style={{ touchAction: 'none' }}>
        <div className="grid w-36 grid-cols-3 gap-1">
          <span />
          <HoldButton ctl={control} k="up" className="btn h-12 text-xl">
            ▲
          </HoldButton>
          <span />
          <HoldButton ctl={control} k="left" className="btn h-12 text-xl">
            ◀
          </HoldButton>
          <HoldButton ctl={control} k="down" className="btn h-12 text-xl">
            ▼
          </HoldButton>
          <HoldButton ctl={control} k="right" className="btn h-12 text-xl">
            ▶
          </HoldButton>
        </div>
        <div className="flex flex-1 gap-2">
          <HoldButton ctl={control} k="sonar" className={`${cdBtn(hud.ping)} flex-1 text-sm`}>
            SONAR
          </HoldButton>
          <HoldButton ctl={control} k="dash" className={`${cdBtn(hud.dash)} flex-1 text-sm`}>
            PATENT DASH
          </HoldButton>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        The world is mainnet, live: payments float by as bubbles, data txs become patent scrolls, barrels and TX blocks, inscriptions drift as law books and jellyfish, social posts
        swim past as gossip fish, token transfers drop their own token as loot and TokenBlaster blasts are golden. Hidden $KWEG coins and Maritime Pachyderms only show on sonar.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="inset px-2 py-1">
          <span className="text-dim">Score: </span>
          <span className="text-hot">{hud.score.toLocaleString()}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">$KWEG: </span>
          <span className="text-hot">{hud.kweg}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Best: </span>
          <span className="text-hot">{Math.max(best, hud.score).toLocaleString()}</span>
        </div>
      </div>
      <LootPanel run={phase === 'over' || phase === 'won' ? lastRun : loot.run} allTime={loot.allTime} />
      {co.chooserEl}
    </section>
  );
}
