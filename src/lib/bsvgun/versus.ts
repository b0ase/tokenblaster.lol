/**
 * BSVGun VERSUS: the pure rules (no three, no network), shared by the engine and the tests.
 *
 * Sync model. Everyone in the room gets the same `rid` (the race id the host publishes in 'go') and the same shooter
 * count, so `planRound(rid, n)` yields the identical target schedule on every client: which kind, which flight pattern,
 * and the seed that drives its launch parameters, at which round-time. The engine runs the targets on a fixed-step
 * simulation clock, so a plan entry flies the same path everywhere. Nothing about targets is ever sent over the wire.
 *
 * Claims. A shooter who downs target `n` at round-time `t` broadcasts a claim {n, i, t, d, b, m}. Every client keeps a
 * ClaimBook: per target the EARLIEST valid claim wins (ties go to the lower player id), points are recomputed from the
 * claim by the same formula everywhere, and the scoreboard is a pure function of the set of claims. So the order the
 * messages arrive in does not matter, and a late earlier claim simply takes the target over. Claims are sanity-checked
 * (known shooter, target exists, inside its flight window, not from the future, plausible range/multiplier/rate).
 * Cosmetic and score-only: nothing here touches payments (LIVE shots still go through useShots/useBlaster).
 */
import type { FeedTx } from '../feed';
import { GAME_COINS } from '../gameCoins';
import { TARGET_INFO, type Pattern, type TargetKind } from './targets';

export const ROUND_SECS = 75;
/** Countdown before the first target, seconds. */
export const COUNTDOWN = 3;
/** After time is up we wait this long for stragglers' claims before showing results. */
export const GRACE = 3.2;
export const MAX_SHOOTERS = 8;

export const hashSeed = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** mulberry32. */
export const rng = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Seconds a target can be alive at most (matches the engine's per-pattern `life`). */
export const LIFE: Record<Pattern, number> = { clay: 8, duck: 12, popup: 8, rail: 12, float: 10, blockrail: 20, static: 1e9 };

export type PlanEv = { i: number; t: number; kind: TargetKind; pattern: Pattern; seed: number; flock: boolean };

const WEIGHTS: [TargetKind, number][] = [
  ['payment', 0.3],
  ['token', 0.2],
  ['social', 0.15],
  ['data', 0.15],
  ['inscription', 0.1],
  ['blast', 0.1],
];

/** The whole round's target schedule: identical for the same (rid, n). More shooters, denser stream. */
export function planRound(rid: string, n: number): PlanEv[] {
  const shooters = Math.max(1, Math.min(MAX_SHOOTERS, Math.floor(n) || 1));
  const r = rng(hashSeed(`${rid}|${shooters}`));
  const dense = 1 + 0.22 * (shooters - 1);
  const raw: Omit<PlanEv, 'i'>[] = [];
  const pick = (kind: TargetKind, t: number, flock = false): Omit<PlanEv, 'i'> => {
    let pattern = TARGET_INFO[kind].pattern;
    if ((kind === 'token' || kind === 'inscription') && r() < 0.3) pattern = 'clay';
    return { t: Math.round(t * 1000) / 1000, kind, pattern, seed: Math.floor(r() * 0xffffffff) >>> 0, flock };
  };
  let t = 0.4;
  while (t < ROUND_SECS - 2.5) {
    const prog = t / ROUND_SECS;
    let w = r();
    let kind: TargetKind = 'payment';
    for (const [k, p] of WEIGHTS) {
      if ((w -= p) < 0) {
        kind = k;
        break;
      }
    }
    raw.push(pick(kind, t));
    t += ((0.95 - prog * 0.4) / dense) * (0.75 + r() * 0.5);
  }
  // Rare ones on a fixed rhythm, so every shooter races for the same golden whales and the same block.
  for (const base of [15, 38, 58]) raw.push(pick('whale', base + r() * 5));
  raw.push(pick('block', 30));
  for (let k = 0; k < 10; k++) raw.push(pick('payment', 30.15 + k * 0.13, true));
  raw.sort((a, b) => a.t - b.t || a.seed - b.seed);
  return raw.map((e, i) => ({ ...e, i }));
}

/** The simulated transaction a plan entry is built from (deterministic from its seed). */
export function planTx(ev: Pick<PlanEv, 'kind' | 'seed'>): FeedTx {
  const r = rng(ev.seed ^ 0x9e3779b9);
  const whale = ev.kind === 'whale';
  const kind: FeedTx['kind'] = ev.kind === 'whale' || ev.kind === 'block' ? 'payment' : ev.kind;
  const sats = whale ? 60_000_000 + Math.floor(r() * 400_000_000) : Math.floor(10 ** (2 + r() * 5));
  const id = Array.from({ length: 16 }, () => Math.floor(r() * 16).toString(16)).join('');
  const coins = Object.values(GAME_COINS);
  const token = kind === 'token' ? coins[Math.floor(r() * coins.length)].id : undefined;
  return { id: `sim${id}`, kind, bytes: Math.floor(200 + r() * 3000), sats, mined: false, token, appName: kind === 'social' ? 'MAP · sim' : undefined, op: ev.kind === 'block' ? 'VS' : undefined };
}

/** A shooter's claim on a target. t is round-seconds on the shooter's clock, ms-quantised. */
export type Claim = { n: number; i: string; t: number; d: number; b: 0 | 1; m: number };

export const claimPoints = (ev: PlanEv, c: Claim): number => {
  const info = TARGET_INFO[ev.kind];
  const d = Math.min(140, Math.max(0, c.d));
  const m = Math.min(8, Math.max(1, Math.floor(c.m)));
  let pts = Math.round(info.pts * (1 + Math.min(1, d / 90)) * m * (c.b ? 1.5 : 1));
  if (ev.flock) pts = Math.round(pts * 1.2);
  return pts;
};

const earlier = (a: Claim, b: Claim) => (a.t !== b.t ? a.t < b.t : a.i < b.i);
/** Quantise a claim time for the wire (and so for tie-breaks). */
export const qt = (t: number) => Math.round(t * 1000) / 1000;

export type AddResult = 'new' | 'won' | 'lost' | 'dup';

export class ClaimBook {
  /** Every accepted claim by key `n|i`. */
  readonly all = new Map<string, Claim>();
  /** The winning claim per target. */
  readonly winners = new Map<number, Claim>();
  private ids: Set<string>;
  constructor(
    readonly plan: PlanEv[],
    ids: string[],
  ) {
    this.ids = new Set(ids);
  }

  /** Sanity-check an untrusted claim. `nowW` is my own round clock now (claims from the future are refused). */
  validate(raw: unknown, nowW: number): Claim | null {
    const c = raw as Partial<Claim> | null;
    if (!c || typeof c !== 'object') return null;
    const { n, i, t, d, b, m } = c;
    if (typeof n !== 'number' || !Number.isInteger(n) || typeof i !== 'string' || !this.ids.has(i)) return null;
    if (typeof t !== 'number' || typeof d !== 'number' || typeof m !== 'number' || !Number.isFinite(t) || !Number.isFinite(d) || !Number.isFinite(m)) return null;
    if (b !== 0 && b !== 1) return null;
    const ev = this.plan[n];
    if (!ev) return null;
    if (t < ev.t - 0.3 || t > ev.t + LIFE[ev.pattern] + 0.3) return null; // outside the target's flight
    if (t > nowW + 1.0 || t < 0) return null; // from the future
    if (d < 0 || d > 150) return null; // nothing on this range is further
    if (!Number.isInteger(m) || m < 1 || m > 8) return null;
    // Rate: no human (or weapon here) clears 30 targets in one second.
    let near = 0;
    for (const o of this.all.values()) if (o.i === i && Math.abs(o.t - t) < 1 && ++near >= 30) return null;
    return { n, i, t: qt(t), d, b, m };
  }

  /** Merge a (validated) claim. Order-independent: the same set of claims always gives the same winners. */
  add(c: Claim): AddResult {
    const key = `${c.n}|${c.i}`;
    if (this.all.has(key)) return 'dup';
    this.all.set(key, c);
    const w = this.winners.get(c.n);
    if (!w) {
      this.winners.set(c.n, c);
      return 'new';
    }
    if (earlier(c, w)) {
      this.winners.set(c.n, c);
      return 'won';
    }
    return 'lost';
  }

  /** Per shooter: score, kills. Pure function of the claims. */
  totals(): Map<string, { score: number; kills: number }> {
    const out = new Map<string, { score: number; kills: number }>();
    for (const id of this.ids) out.set(id, { score: 0, kills: 0 });
    for (const c of this.winners.values()) {
      const o = out.get(c.i);
      if (!o) continue;
      o.score += claimPoints(this.plan[c.n], c);
      o.kills++;
    }
    return out;
  }

  /** Mine, for the end-of-round re-send (broadcasts are best-effort). */
  mine(id: string): Claim[] {
    return [...this.all.values()].filter((c) => c.i === id);
  }

  /** Stable ranking: score desc, kills desc, id. */
  ranking(): { id: string; score: number; kills: number }[] {
    return [...this.totals().entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score || b.kills - a.kills || (a.id < b.id ? -1 : 1));
  }
}

/** Distinct colours for the booths / tracer rings, by slot. */
export const SHOOTER_COLOURS = ['#ff3a2a', '#27e6ff', '#ffb800', '#3dff7a', '#ff5fa8', '#a98bff', '#ff8a2a', '#e8f0ff'];
