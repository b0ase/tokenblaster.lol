/**
 * Double-O Satoshi multiplayer helpers (pure, no THREE / DOM, so they are unit-tested).
 *
 * Modes: CO-OP (2-4 agents run a mission together, the host simulates the world) and DEATHMATCH (agents hunt each
 * other through a mission map; bots optional). Rooms: quick match (one shared room per mission+mode) or a private
 * room (`?room=CODE`). Netcode: PoseBuffer interpolates remote agents ~120 ms in the past (like racemp/buffer.ts);
 * Scores is a mergeable frag log so the kill feed and the scoreboard always agree.
 */

export type MpMode = 'solo' | 'coop' | 'dm';
export const MODES: { id: MpMode; name: string; blurb: string }[] = [
  { id: 'solo', name: 'SOLO', blurb: 'Just you and the villains.' },
  { id: 'coop', name: 'CO-OP', blurb: '2-4 agents run the mission together against the villains.' },
  { id: 'dm', name: 'DEATHMATCH', blurb: 'Hunt each other through the map. First to the frag limit wins.' },
];

export const FRAG_LIMIT = 10;
export const DM_SECS = 300;
export const RESPAWN_MS = 3000;
export const INVULN_MS = 2000;
export const COUNTDOWN_MS = 3000;

const CODE_RE = /^[a-z0-9]{3,12}$/;
/** A private-room code from untrusted input (URL, text box): lowercase alphanumerics, 3-12 chars. */
export function cleanRoomCode(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const c = s.trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
}
export function newRoomCode(rand: () => number = Math.random): string {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(rand() * a.length)];
  return s;
}
export function cleanMode(s: unknown): MpMode | null {
  return s === 'solo' || s === 'coop' || s === 'dm' ? s : null;
}

/** Realtime topic. CO-OP quick match keeps the original per-mission topic, so existing head counts still work. */
export function roomName(levelId: string, mode: MpMode, code: string | null): string {
  const base = `doubleokweg-${levelId}`;
  const m = mode === 'dm' ? '-dm' : '';
  return code ? `${base}${m}-p-${code}` : `${base}${m}`;
}

/** Shareable link for a private room. */
export function roomLink(origin: string, path: string, levelId: string, mode: MpMode, code: string): string {
  return `${origin}${path}?room=${code}&mode=${mode}&m=${levelId}`;
}

// ── Pose interpolation ──

export type Pose = { x: number; z: number; yaw: number };
type Snap = Pose & { ts: number };
const fin = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Snapshot buffer for one remote agent. Wire: { ts: sender Date.now(), x, z, yaw }. */
export class PoseBuffer {
  private buf: Snap[] = [];
  private off = 0;
  private offSet = false;
  /** Date.now() of the last accepted snapshot. */
  lastRecv = 0;
  /** Set when the last accepted snapshot was a teleport (respawn): consumers should snap, not glide. */
  teleported = false;
  constructor(
    private interpMs = 120,
    private maxExtrap = 0.25,
    /** World units per second nobody can exceed (run 8 x adrenaline 1.5 = 12). Faster = a teleport. */
    private maxSpeed = 14,
  ) {}

  get size() {
    return this.buf.length;
  }

  /** false when the packet was rejected. */
  push(d: { ts?: unknown; x?: unknown; z?: unknown; yaw?: unknown }, now: number): boolean {
    const ts = fin(d.ts, 0, 1e14);
    const x = fin(d.x, -2000, 2000);
    const z = fin(d.z, -2000, 2000);
    const yaw = fin(d.yaw, -1000, 1000);
    if (ts === null || x === null || z === null || yaw === null) return false;
    const prev = this.buf[this.buf.length - 1];
    this.teleported = false;
    if (prev) {
      if (ts <= prev.ts) return false;
      const dt = Math.max(0.02, (ts - prev.ts) / 1000);
      if (Math.hypot(x - prev.x, z - prev.z) > this.maxSpeed * dt + 6) {
        this.buf = []; // respawn / teleport: forget the past so the agent snaps instead of sliding across the map
        this.teleported = true;
      }
    }
    const lag = now - ts;
    if (!this.offSet || lag < this.off) {
      this.off = lag;
      this.offSet = true;
    } else this.off += (lag - this.off) * 0.02;
    this.buf.push({ ts, x, z, yaw });
    if (this.buf.length > 30) this.buf.shift();
    this.lastRecv = now;
    return true;
  }

  sample(now: number): Pose | null {
    if (!this.buf.length) return null;
    const t = now - this.off - this.interpMs;
    while (this.buf.length > 2 && this.buf[1].ts <= t) this.buf.shift();
    const a = this.buf[0];
    const b = this.buf[1];
    if (!b) return { x: a.x, z: a.z, yaw: a.yaw };
    if (t <= a.ts) return { x: a.x, z: a.z, yaw: a.yaw };
    if (t >= b.ts) {
      // Late packets: carry on at the last velocity for a moment, then hold.
      const dt = Math.max(1, b.ts - a.ts) / 1000;
      const ex = Math.min(this.maxExtrap, (t - b.ts) / 1000);
      return { x: b.x + ((b.x - a.x) / dt) * ex, z: b.z + ((b.z - a.z) / dt) * ex, yaw: b.yaw };
    }
    const k = (t - a.ts) / Math.max(1, b.ts - a.ts);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k) };
  }
}

// ── Frag log (DEATHMATCH scoreboard) ──

export type Frag = { key: string; k: string | null; v: string };

/** Every frag is `victim#deathNumber` (the victim reports their own deaths). Merging logs is idempotent. */
export class Scores {
  private log = new Map<string, Frag>();
  reset() {
    this.log.clear();
  }
  /** true when new. */
  add(f: Frag): boolean {
    if (this.log.has(f.key) || this.log.size >= 400) return false;
    this.log.set(f.key, { key: f.key, k: f.k, v: f.v });
    return true;
  }
  entries(): Frag[] {
    return [...this.log.values()];
  }
  /** Merge a peer's log (untrusted). Returns the frags that were new. */
  merge(raw: unknown): Frag[] {
    const out: Frag[] = [];
    if (!Array.isArray(raw)) return out;
    for (const e of raw.slice(0, 400)) {
      const o = e as Partial<Frag> | null;
      if (!o || typeof o.key !== 'string' || typeof o.v !== 'string' || o.key.length > 40 || o.v.length > 24) continue;
      const k = typeof o.k === 'string' && o.k.length <= 24 ? o.k : null;
      if (this.add({ key: o.key, k, v: o.v })) out.push({ key: o.key, k, v: o.v });
    }
    return out;
  }
  kills(id: string) {
    let n = 0;
    for (const f of this.log.values()) if (f.k === id && f.v !== id) n++;
    return n;
  }
  deaths(id: string) {
    let n = 0;
    for (const f of this.log.values()) if (f.v === id) n++;
    return n;
  }
  /** Top fragger, once someone reaches `limit` (ties: fewest deaths, then id). */
  winner(ids: string[], limit = FRAG_LIMIT): string | null {
    const sorted = this.rank(ids);
    return sorted.length && sorted[0].k >= limit ? sorted[0].id : null;
  }
  rank(ids: string[]): { id: string; k: number; d: number }[] {
    return ids.map((id) => ({ id, k: this.kills(id), d: this.deaths(id) })).sort((a, b) => b.k - a.k || a.d - b.d || (a.id < b.id ? -1 : 1));
  }
}

/** Respawn point: of `tries` random candidates the one farthest from everybody else. */
export function pickSpawn(cells: [number, number][], others: [number, number][], rand: () => number = Math.random, tries = 12): [number, number] | null {
  if (!cells.length) return null;
  let best = cells[0];
  let bestD = -1;
  for (let i = 0; i < tries; i++) {
    const c = cells[Math.floor(rand() * cells.length)];
    let d = 1e9;
    for (const o of others) d = Math.min(d, Math.hypot(o[0] - c[0], o[1] - c[1]));
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
