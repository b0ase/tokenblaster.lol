/**
 * Block Hopper level generator. Every live transaction becomes the next platform (length from its size,
 * look from its kind), a mined block becomes a wide checkpoint gate, and an empty mempool becomes grey
 * filler. Pure data: the engine builds the visuals from `fresh` and tears them down from `gone`.
 *
 * Reachability is a hard rule: from any main-path platform the next one is never further than MAX_GAP
 * away or MAX_RISE higher (a held jump clears 3.1 m and a run jump about 7 m; see sim.ts).
 */
import type { FeedTx } from '@/lib/feed';
import type { Loot } from '@/lib/loot';
import { KIND_STYLE, type BlockInfo } from './brand';
import type { Plat, World } from './sim';

export const MAX_GAP = 5.3;
export const MAX_RISE = 2.3;
const TOP_MIN = 1.5;
const TOP_MAX = 11;
const SLAB = 7;

export type Coin = { id: number; x: number; y: number; got: boolean; value: number; view?: unknown };
export type Enemy = { id: number; plat: Plat; x: number; y: number; dir: number; speed: number; dead: number; tokenId: string; sym: string; loot: Loot | null; view?: unknown };
export type Spring = { id: number; plat: Plat; x: number; t: number; view?: unknown };
export type Drop = { id: number; x: number; y: number; vy: number; loot: Loot; got: boolean; plat: Plat | null; view?: unknown };
export type Fresh = { k: 'plat'; o: Plat } | { k: 'coin'; o: Coin } | { k: 'enemy'; o: Enemy } | { k: 'spring'; o: Spring } | { k: 'drop'; o: Drop };
export type Gone = Fresh;
export type Src = { tx?: FeedTx | null; block?: BlockInfo | null };

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Level implements World {
  plats: Plat[] = [];
  coins: Coin[] = [];
  enemies: Enemy[] = [];
  springs: Spring[] = [];
  drops: Drop[] = [];
  fresh: Fresh[] = [];
  gone: Gone[] = [];
  /** The last main-path platform (where the next one is attached). */
  last!: Plat;
  /** Transactions turned into level so far (live ones, not filler). */
  built = 0;
  private ids = 0;
  private rng: () => number;
  private springOn: Plat | null = null;
  private sinceCrumble = 9;
  private sinceBlock = 0;

  constructor(
    seed = 1,
    private lootOf: (f: FeedTx) => Loot | null = () => null,
  ) {
    this.rng = mulberry32(seed);
    this.reset(seed);
  }

  reset(seed = 1) {
    this.rng = mulberry32(seed);
    this.plats = [];
    this.coins = [];
    this.enemies = [];
    this.springs = [];
    this.drops = [];
    this.fresh = [];
    this.gone = [];
    this.built = 0;
    this.springOn = null;
    this.sinceCrumble = 9;
    this.sinceBlock = 0;
    this.last = this.addPlat({ x0: -14, x1: 26, top: 4, kind: 'quiet', label: 'START · BLOCK HOPPER', sub: 'RUN THE LIVE CHAIN', txid: '', bytes: 0, color: KIND_STYLE.quiet.color });
  }

  near(x0: number, x1: number): Plat[] {
    const out: Plat[] = [];
    for (const p of this.plats) if (p.x1 >= x0 && p.x0 <= x1) out.push(p);
    return out;
  }

  /** Main-path platform under or just ahead of x (for respawns). */
  platAt(x: number): Plat | null {
    let best: Plat | null = null;
    for (const p of this.plats) if (!p.oneWay && p.solid && p.x1 > x + 1 && (!best || p.x0 < best.x0)) best = p;
    return best;
  }

  private addPlat(o: Partial<Plat> & { x0: number; x1: number; top: number }): Plat {
    const p: Plat = {
      id: ++this.ids,
      bot: o.top - SLAB,
      oneWay: false,
      solid: true,
      kind: 'quiet',
      label: '',
      sub: '',
      txid: '',
      bytes: 0,
      color: KIND_STYLE.quiet.color,
      crumble: null,
      gate: null,
      ...o,
    };
    this.plats.push(p);
    this.fresh.push({ k: 'plat', o: p });
    return p;
  }
  private addCoin(x: number, y: number, value = 25) {
    const c: Coin = { id: ++this.ids, x, y, got: false, value };
    this.coins.push(c);
    this.fresh.push({ k: 'coin', o: c });
  }

  addDrop(x: number, y: number, loot: Loot, vy = 0, plat: Plat | null = null) {
    const d: Drop = { id: ++this.ids, x, y, vy, loot, got: false, plat };
    this.drops.push(d);
    this.fresh.push({ k: 'drop', o: d });
  }

  /** Build the next stretch from one live transaction, a block, or (neither) filler. `diff` is 0..1. */
  extend(src: Src, diff: number): Plat {
    const rng = this.rng;
    const prev = this.last;
    const f = src.tx ?? null;
    const blk = src.block ?? null;
    const kind = blk ? 'block' : f ? f.kind : 'quiet';
    const st = KIND_STYLE[kind];

    // Where does it go?
    const len = blk ? 34 : f ? clamp(4.8 + Math.sqrt(f.bytes) * 0.27, 5.4, 20) : 6 + rng() * 4;
    let gap = blk ? 3.4 : 2.3 + rng() * (1.5 + diff * 1.1);
    if (kind === 'data') gap = Math.min(gap, 4.2); // crumblers should be generous
    gap = Math.min(gap, MAX_GAP - 0.1);
    let dy: number;
    if (blk) dy = clamp(5 - prev.top, -1, 1);
    else {
      const r = rng();
      dy = r < 0.38 ? 0 : r < 0.64 ? 0.5 + rng() * (1.5 + diff * 0.3) : -(0.6 + rng() * 2.8);
      if (prev.top + dy > TOP_MAX - 1) dy = -Math.abs(dy) - 0.5;
      if (prev.top + dy < TOP_MIN + 1) dy = Math.abs(dy) + 0.4;
      dy = clamp(dy, -3.6, MAX_RISE - 0.15);
    }
    const top = clamp(prev.top + dy, TOP_MIN, TOP_MAX);

    // A spring on the last platform may have an upper route waiting: an aerial slab of this tx's kind.
    if (this.springOn && f && !blk && (f.kind === 'inscription' || rng() < 0.4)) {
      const sp = this.springOn;
      this.springOn = null;
      const x0 = sp.x1 + 0.5;
      const aTop = sp.top + 5.1;
      const a = this.addPlat({ x0, x1: x0 + clamp(len * 0.7, 6, 11), top: aTop, bot: aTop - 0.55, oneWay: true, kind: f.kind, label: `${st.tag} · ${f.id.slice(0, 8)}`, sub: `${f.bytes} B · BONUS`, txid: f.id, bytes: f.bytes, color: st.color });
      this.built++;
      for (let i = 0; i < 6; i++) this.addCoin(a.x0 + 1.2 + i * ((a.x1 - a.x0 - 2.4) / 5), aTop + 1.1, 40);
      const l = this.lootOf(f);
      if (l) this.addDrop((a.x0 + a.x1) / 2, aTop + 1.7, l);
      return this.last;
    }
    this.springOn = null;

    const x0 = prev.x1 + gap;
    const p = this.addPlat({
      x0,
      x1: x0 + len,
      top,
      kind,
      label: blk ? `BLOCK #${blk.height.toLocaleString('en-GB')}` : f ? `${st.tag} · ${f.id.slice(0, 8)}` : 'MEMPOOL QUIET',
      sub: blk ? `${blk.txCount.toLocaleString('en-GB')} TXS · ${blk.miner || 'UNKNOWN'}` : f ? `${f.bytes} B${f.sats ? ` · ${f.sats.toLocaleString('en-GB')} SATS` : ''}` : 'waiting for the next one',
      txid: f?.id ?? '',
      bytes: f?.bytes ?? 0,
      color: st.color,
    });
    this.last = p;
    if (f) this.built++;
    this.sinceCrumble++;
    this.sinceBlock++;

    if (blk) {
      p.gate = { height: blk.height, txCount: blk.txCount, miner: blk.miner, taken: false };
      for (let i = 0; i < 9; i++) this.addCoin(p.x0 + 6 + i * 2.7, top + 1.2 + Math.sin((i / 8) * Math.PI) * 1.6, 50);
      this.sinceBlock = 0;
      return p;
    }
    if (!f) return p;

    // Coins over the gap for payments: a little arc to jump through.
    if (f.kind === 'payment' && rng() < 0.55) {
      const n = 4;
      const ax = prev.x1 + 0.4;
      const bx = p.x0 - 0.4;
      const base = Math.max(prev.top, top);
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        this.addCoin(ax + (bx - ax) * u, base + 1.4 + Math.sin(u * Math.PI) * 1.9);
      }
    } else if (f.kind === 'blast') {
      const n = clamp(Math.floor(len / 1.8), 4, 9);
      for (let i = 0; i < n; i++) this.addCoin(p.x0 + 1.2 + i * ((len - 2.4) / (n - 1)), top + 1.2, 30);
    } else if (f.kind === 'token') {
      const l = this.lootOf(f);
      if (len >= 6.4) {
        const e: Enemy = { id: ++this.ids, plat: p, x: (p.x0 + p.x1) / 2, y: top, dir: rng() < 0.5 ? -1 : 1, speed: 1.5 + diff * 1.3 + rng() * 0.6, dead: 0, tokenId: f.token ?? '', sym: f.token?.slice(0, 6) ?? 'TOKEN', loot: l };
        this.enemies.push(e);
        this.fresh.push({ k: 'enemy', o: e });
      }
      if (l) this.addDrop(p.x0 + Math.min(2.2, len / 4), top + 2.2 + rng(), l);
    } else if (f.kind === 'social') {
      const s: Spring = { id: ++this.ids, plat: p, x: p.x0 + len * 0.62, t: 0 };
      this.springs.push(s);
      this.fresh.push({ k: 'spring', o: s });
      this.springOn = p;
    } else if (f.kind === 'data' && this.sinceCrumble > 3 && len >= 6.2) {
      p.crumble = { state: 0, t: 0 };
      this.sinceCrumble = 0;
    } else if (f.kind === 'inscription') {
      for (let i = 0; i < 3; i++) this.addCoin(p.x0 + len * (0.3 + 0.2 * i), top + 1.5 + (i === 1 ? 1 : 0), 35);
    }
    return p;
  }

  /** Forget everything well behind x. */
  cull(x: number) {
    const lim = x - 45;
    const keep = <T extends { x1?: number; x?: number }>(arr: T[], k: Gone['k'], at: (o: T) => number) => {
      let w = 0;
      for (const o of arr) {
        if (at(o) < lim) this.gone.push({ k, o } as unknown as Gone);
        else arr[w++] = o;
      }
      arr.length = w;
    };
    keep(this.plats, 'plat', (p) => p.x1);
    keep(this.coins, 'coin', (c) => c.x);
    keep(this.enemies, 'enemy', (e) => e.plat.x1);
    keep(this.springs, 'spring', (s) => s.plat.x1);
    keep(this.drops, 'drop', (d) => d.x);
  }
}
