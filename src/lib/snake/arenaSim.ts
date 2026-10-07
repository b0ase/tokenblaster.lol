/**
 * Token Snake ARENA rules, with no rendering and no network: the pure maths of the slither-style multiplayer mode.
 * Everything here is deterministic or a plain function so it is unit-tested (src/lib/snakeArena.test.ts).
 *
 *  - World: a square neon arena, side `SIDE`, centred on the origin (x right, z down), walls kill.
 *  - Snake: a head that steers at a limited turn rate at constant speed (boost = faster, costs mass) trailing a path of
 *    points; the body is that path trimmed to a length that grows with mass.
 *  - Food: `FOOD_SLOTS` seeded slots. Slot s at generation g is ALWAYS at the same place with the same kind, so every
 *    client sees the same food without a server; the first eater claims (s, g), everyone bumps the slot to g+1.
 *  - Dead snakes burst into corpse orbs (positions travel in the death message, so everyone spawns the same ones).
 *  - Each client is authoritative for its OWN snake; remote snakes are interpolated and the victim's client decides
 *    collisions against them (lenient), then broadcasts the death.
 */
import type { FoodKind } from './sim';

export const SIDE = 84;
export const HALF = SIDE / 2;
export const MAX_SNAKES = 10;
export const SPEED = 6.4;
export const BOOST_SPEED = 11.5;
export const TURN_RATE = 3.5; // rad/s
export const MASS0 = 12;
export const MIN_BOOST_MASS = 14;
export const BOOST_COST = 3.5; // mass per second
export const MAX_MASS = 600;
export const SPACING = 0.22; // metres between path points
export const FOOD_SLOTS = 70;
export const SHIELD_SECS = 2.6;
export const SEND_HZ = 12;
export const INTERP = 0.16; // seconds remote snakes are rendered in the past

export const massToLen = (m: number) => 3.2 + 0.4 * m;
export const radiusOf = (m: number) => Math.min(1.3, 0.34 + 0.045 * Math.sqrt(Math.max(0, m)));
export const speedOf = (boost: boolean) => (boost ? BOOST_SPEED : SPEED);

// ───────────── Seeded food ─────────────

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
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

const KIND_TABLE: [FoodKind, number][] = [
  ['quiet', 0.6],
  ['payment', 0.11],
  ['data', 0.1],
  ['social', 0.07],
  ['inscription', 0.07],
  ['token', 0.04],
  ['blast', 0.01],
];
export const ARENA_GROW: Record<FoodKind, number> = { quiet: 1, payment: 1, data: 1, social: 1.5, inscription: 2, token: 3, blast: 5 };
export const ARENA_POINTS: Record<FoodKind, number> = { quiet: 5, payment: 10, data: 10, social: 15, inscription: 20, token: 50, blast: 100 };

/** Where / what slot `slot` holds at generation `gen` for a room seed. Same inputs, same output, on every client. */
export function foodAt(seed: number, slot: number, gen: number): { x: number; z: number; kind: FoodKind } {
  const r = mulberry32((seed ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(gen + 1, 0x85ebca6b)) >>> 0);
  const m = 3;
  const x = (r() * 2 - 1) * (HALF - m);
  const z = (r() * 2 - 1) * (HALF - m);
  let k = r();
  let kind: FoodKind = 'quiet';
  for (const [name, w] of KIND_TABLE) {
    if (k < w) {
      kind = name;
      break;
    }
    k -= w;
  }
  return { x, z, kind };
}

export type FoodSlot = { gen: number; x: number; z: number; kind: FoodKind };
export class FoodField {
  slots: FoodSlot[] = [];
  /** Corpse orbs by id ("<death>.<i>"). */
  corpses = new Map<string, Corpse>();
  constructor(readonly seed: number) {
    for (let s = 0; s < FOOD_SLOTS; s++) this.slots.push({ gen: 0, ...foodAt(seed, s, 0) });
  }
  /** Mark (slot, gen) eaten: the slot moves on. Returns false when that generation was already gone (stale). */
  claim(slot: number, gen: number): boolean {
    const f = this.slots[slot];
    if (!f || gen < f.gen) return false;
    f.gen = gen + 1;
    Object.assign(f, foodAt(this.seed, slot, f.gen));
    return true;
  }
  /** Merge a peer's generation table (late joiners converge on the others). */
  merge(gens: number[]) {
    const changed: number[] = [];
    for (let s = 0; s < Math.min(gens.length, FOOD_SLOTS); s++) {
      const g = gens[s];
      if (Number.isInteger(g) && g > this.slots[s].gen && g < 1e6) {
        this.slots[s].gen = g;
        Object.assign(this.slots[s], foodAt(this.seed, s, g));
        changed.push(s);
      }
    }
    return changed;
  }
  gens() {
    return this.slots.map((s) => s.gen);
  }
}

export type Corpse = { id: string; x: number; z: number; v: number; col: number; born: number };

/** Sample up to `max` orb positions evenly along a body path (oldest..newest) for a death burst. */
export function corpseSpots(path: { x: number; z: number }[], max = 36): number[] {
  const out: number[] = [];
  if (!path.length) return out;
  const n = Math.min(max, path.length);
  for (let i = 0; i < n; i++) {
    const p = path[Math.floor((i * (path.length - 1)) / Math.max(1, n - 1))];
    out.push(Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10);
  }
  return out;
}

/** Validate an untrusted death message into corpse orbs (bounded count, positions in the arena, small values). */
export function readCorpses(did: string, pts: unknown, mass: unknown, col: number, now: number): Corpse[] {
  if (!Array.isArray(pts) || pts.length > 80 || pts.length % 2) return [];
  const m = typeof mass === 'number' && Number.isFinite(mass) ? Math.max(0, Math.min(MAX_MASS, mass)) : MASS0;
  const n = pts.length / 2;
  if (!n) return [];
  const v = Math.max(0.5, Math.min(8, (m * 0.8) / n));
  const out: Corpse[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const z = pts[i * 2 + 1];
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > HALF + 1 || Math.abs(z) > HALF + 1) continue;
    out.push({ id: `${did}.${i}`, x, z, v, col, born: now });
  }
  return out;
}

/** Boosting sheds mass: every BOOST_DROP of it falls behind you as one small orb anyone can eat (slither-style). */
export const BOOST_DROP = 1.4;
export const BOOST_ORB_V = Math.round(BOOST_DROP * 0.8 * 10) / 10;
export const boostOrbId = (owner: string, seq: number) => `${owner}.b${seq}`;

/** Validate an untrusted boost-orb message {c, x, z, v}: the id must be the sender's, inside the arena, small value. */
export function readBoostOrb(from: string, p: Record<string, unknown>, col: number, now: number): Corpse | null {
  const id = typeof p.c === 'string' ? p.c.slice(0, 40) : '';
  if (!id.startsWith(`${from}.b`)) return null;
  const { x, z, v } = p;
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > HALF + 1 || Math.abs(z) > HALF + 1) return null;
  const val = typeof v === 'number' && Number.isFinite(v) ? Math.max(0.1, Math.min(BOOST_DROP, v)) : BOOST_ORB_V;
  return { id, x, z, v: val, col, born: now };
}

// ───────────── Snake body ─────────────

export type Pt = { x: number; z: number };

/** A path of points (oldest first, head last), trimmed to the body length for the snake's mass. */
export class Body {
  pts: Pt[] = [];
  hx = 0;
  hz = 0;
  /** Reset to a straight line behind (x, z) heading `a`. */
  reset(x: number, z: number, a: number, mass: number) {
    this.hx = x;
    this.hz = z;
    this.pts = [];
    const len = massToLen(mass);
    const n = Math.ceil(len / SPACING);
    for (let i = n; i >= 0; i--) this.pts.push({ x: x - Math.cos(a) * i * SPACING, z: z - Math.sin(a) * i * SPACING });
  }
  /** Move the head to (x, z); extends the path every SPACING and trims the tail to the body length. */
  moveTo(x: number, z: number, mass: number) {
    this.hx = x;
    this.hz = z;
    const last = this.pts[this.pts.length - 1];
    if (!last) {
      this.pts.push({ x, z });
      return;
    }
    let lx = last.x;
    let lz = last.z;
    let d = Math.hypot(x - lx, z - lz);
    if (d > 6) {
      // A jump (respawn / teleport): start a fresh path rather than drawing a streak across the arena.
      this.pts = [{ x, z }];
      return;
    }
    while (d >= SPACING) {
      const k = SPACING / d;
      lx += (x - lx) * k;
      lz += (z - lz) * k;
      this.pts.push({ x: lx, z: lz });
      d = Math.hypot(x - lx, z - lz);
    }
    this.trim(mass);
  }
  trim(mass: number) {
    const keep = Math.ceil(massToLen(mass) / SPACING) + 1;
    if (this.pts.length > keep) this.pts.splice(0, this.pts.length - keep);
  }
}

/**
 * Does a head at (x, z) with radius `r` touch another snake's body? `skip` = metres of body next to the other
 * snake's head that do not count (so a head-on pass is not a kill from both sides); `tailSkip` = metres at the tail end
 * ignored (the real tail has already moved on by the latency we render behind). `lenient` < 1 shrinks the touch
 * distance so latency never kills you on a near miss.
 */
export function hitsBody(x: number, z: number, r: number, body: Body, otherR: number, skip: number, tailSkip = 0, lenient = 0.78): boolean {
  const reach = (r + otherR) * lenient;
  const r2 = reach * reach;
  const end = body.pts.length - 1 - Math.ceil(skip / SPACING); // points beyond the neck
  for (let i = Math.ceil(tailSkip / SPACING); i <= end; i++) {
    const p = body.pts[i];
    const dx = p.x - x;
    if (dx > reach || dx < -reach) continue;
    const dz = p.z - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

export const outOfBounds = (x: number, z: number, r: number) => Math.abs(x) > HALF - r * 0.5 || Math.abs(z) > HALF - r * 0.5;

/** Steer `a` toward `target` by at most TURN_RATE*dt. */
export function steer(a: number, target: number, dt: number): number {
  const d = Math.atan2(Math.sin(target - a), Math.cos(target - a));
  const m = TURN_RATE * dt;
  return wrapAngle(a + Math.max(-m, Math.min(m, d)));
}

/** Keep headings in (-pi, pi]: the wire (and PoseBuffer) bound them, and unbounded sums would eventually be rejected. */
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ───────────── Remote snake interpolation ─────────────

export type Pose = { t: number; x: number; z: number; a: number; m: number; b: boolean; s: boolean; k: number };
type Snap = Pose & { t0: number };

/**
 * Interpolation of ONE remote snake's head from its ~12 Hz pose samples: sample(now) returns the pose INTERP seconds
 * in the past (extrapolating briefly along the heading when packets are late). Samples are validated: finite, inside
 * the arena, and no faster than a snake can go (teleports are clamped and counted as `suspect`).
 */
export class PoseBuffer {
  private q: Snap[] = [];
  private off = Infinity;
  suspect = 0;
  lastRecv = 0;
  life = 0;
  reset() {
    this.q = [];
    this.off = Infinity;
    this.suspect = 0;
  }
  get size() {
    return this.q.length;
  }
  get last(): Pose | null {
    return this.q[this.q.length - 1] ?? null;
  }
  /** `d` is the wire message; `now` this client's clock in seconds. */
  push(d: Record<string, unknown>, now: number): boolean {
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
    const ts = num(d.ts, 0, 1e9);
    let x = num(d.x, -HALF - 2, HALF + 2);
    let z = num(d.z, -HALF - 2, HALF + 2);
    const a = num(d.a, -100, 100);
    const m = num(d.m, 0, MAX_MASS);
    if (ts === null || x === null || z === null || a === null || m === null) return false;
    const prev = this.q[this.q.length - 1];
    if (prev && ts <= prev.t0) return false;
    // Clock offset: the smallest (now - ts) seen is closest to the true one-way delay.
    const o = now - ts;
    this.off = Math.min(this.off, o) + (o > this.off ? 0.002 : 0);
    if (prev) {
      const lim = BOOST_SPEED * 1.35 * Math.max(0.03, ts - prev.t0) + 1.2;
      const d0 = Math.hypot(x - prev.x, z - prev.z);
      if (d0 > lim) {
        const k = lim / d0;
        x = prev.x + (x - prev.x) * k;
        z = prev.z + (z - prev.z) * k;
        this.suspect++;
      }
    }
    this.q.push({ t: ts + this.off, x, z, a, m, b: d.b === 1 || d.b === true, s: d.s === 1 || d.s === true, k: num(d.k, 0, 9999) ?? 0, t0: ts });
    if (this.q.length > 40) this.q.shift();
    this.lastRecv = now;
    return true;
  }
  sample(now: number): Pose | null {
    const q = this.q;
    if (!q.length) return null;
    const tt = now - INTERP;
    if (tt <= q[0].t) return stripSnap(q[0]);
    const l = q[q.length - 1];
    if (tt >= l.t) {
      const dt = Math.min(0.25, tt - l.t);
      const sp = speedOf(l.b);
      return { t: l.t, a: l.a, m: l.m, b: l.b, s: l.s, k: l.k, x: l.x + Math.cos(l.a) * sp * dt, z: l.z + Math.sin(l.a) * sp * dt };
    }
    let i = q.length - 1;
    while (i > 0 && q[i - 1].t > tt) i--;
    const A = q[i - 1];
    const B = q[i];
    const f = (tt - A.t) / Math.max(1e-4, B.t - A.t);
    const da = Math.atan2(Math.sin(B.a - A.a), Math.cos(B.a - A.a));
    return { t: tt, x: A.x + (B.x - A.x) * f, z: A.z + (B.z - A.z) * f, a: A.a + da * f, m: A.m + (B.m - A.m) * f, b: B.b, s: B.s, k: B.k };
  }
}

// ───────────── Colours, board ─────────────

export const SNAKE_COLOURS = [0x27e6ff, 0xff2f92, 0xc8ff1a, 0xffb800, 0x6f9bff, 0xff6a3a, 0xb36bff, 0x2affb0, 0xff4f6e, 0xf4efe2];
export const colourIndex = (id: string) => hashStr(id) % SNAKE_COLOURS.length;
export const cssOf = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export type BoardRow = { id: string; mass: number; kills: number };
/** Leaderboard by length (mass), ties by id so every client orders the same. */
export const board = (rows: BoardRow[]) => rows.slice().sort((a, b) => b.mass - a.mass || (a.id < b.id ? -1 : 1));

function stripSnap(s: Snap): Pose {
  return { t: s.t, x: s.x, z: s.z, a: s.a, m: s.m, b: s.b, s: s.s, k: s.k };
}
