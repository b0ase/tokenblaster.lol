/**
 * Mempool Invaders multiplayer (CO-OP / VERSUS). Transport and rooms come from src/lib/racemp (RaceSession: lobby,
 * quick match, private ?room=CODE, ready, go). This file is the game's own netcode, with no three.js and no money:
 *
 *  - Everybody simulates the whole game locally. The room LEADER (first pilot on the grid still heard from) is the only
 *    one that spawns things: it sends the wave manifest (the live txs in slot order; the formation layout, delays and
 *    direction come from the room seed, so they agree), later spawns (divers, saucers, boss summons) and every enemy
 *    bolt. If the leader drops out, the next pilot takes over (they already hold the full state).
 *  - Kills are CLAIMED by the shooter ('k'). First valid claim wins: the earliest (time, id) pair; a loser's points are
 *    revoked. Claims are sanity-checked (known pilot, current wave, rate-limited, clock window).
 *  - Ships are sent at ~12 Hz and drawn ~110 ms in the past from a snapshot buffer, shots are cosmetic copies.
 *  - Nothing here moves money. Identity (X handle + avatar) is the shared layer in src/lib/identity.ts.
 */
import { readWire, verifyWire } from '@/lib/identity';
import type { RaceInfo, RaceLink } from '@/lib/racemp/session';

export type InvCfg = { mode: 'coop' | 'versus' };
export const DEFAULT_INV_CFG: InvCfg = { mode: 'coop' };
export const validateInvCfg = (c: unknown): InvCfg | null => {
  const m = (c as { mode?: unknown } | null)?.mode;
  return m === 'coop' || m === 'versus' ? { mode: m } : null;
};
/** Gameplay events routed by RaceSession to link.on (must not clash with go/cfg/lc/fin/res). */
export const INV_EVENTS = ['ip', 'w', 'sp', 'eb', 'h', 'k', 'bd', 'bk', 'f', 'vs'];
/** Ship colours by place on the grid (also the avatar ring). */
export const SHIP_COLOURS = ['#e8261d', '#27e6ff', '#c8ff1a', '#ff2f92', '#ffb800', '#4a7bff', '#f4efe2', '#ff7a1a'];

// ───────────── Seeded randomness ─────────────

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────── Pose snapshots ─────────────

/** x over time for one remote ship: sample() lerps between the two snapshots around `now - delay`. */
export class PoseBuffer {
  private s: { t: number; x: number; vx: number }[] = [];
  push(t: number, x: number, vx: number) {
    const last = this.s[this.s.length - 1];
    if (last && t <= last.t) return;
    this.s.push({ t, x, vx });
    if (this.s.length > 24) this.s.shift();
  }
  sample(now: number, delay = 110): number {
    const n = this.s.length;
    if (!n) return 0;
    const rt = now - delay;
    if (rt <= this.s[0].t) return this.s[0].x;
    const last = this.s[n - 1];
    if (rt >= last.t) return last.x + last.vx * Math.min(0.25, (rt - last.t) / 1000); // extrapolate briefly
    for (let i = n - 1; i > 0; i--) {
      const a = this.s[i - 1];
      const b = this.s[i];
      if (rt >= a.t) return a.x + ((b.x - a.x) * (rt - a.t)) / Math.max(1, b.t - a.t);
    }
    return last.x;
  }
  get size() {
    return this.s.length;
  }
}

// ───────────── Claims ─────────────

export type Claim = { by: string; t: number };
/** Does claim `a` beat claim `b`? Earliest time wins; ties go to the lower id. */
export const claimBeats = (a: Claim, b: Claim) => a.t < b.t || (a.t === b.t && a.by < b.by);

// ───────────── Wire ─────────────

export type WireRow = [id: string, kind: string, bytes: number, token: string | 0, ghost: 0 | 1];
export type WaveMsg = { n: number; bl: number; bd: 0 | 1; bp: { h: number; c: number } | null; t: WireRow[] };
export type SpawnMsg = { m: 'd' | 's'; r: WireRow; x: number; bx: number; vx: number; gy: number };
export type BoltRow = [x: number, gy: number, vx: number, vy: number, big: 0 | 1];
export type Peer = {
  id: string;
  index: number;
  name: string;
  handle: string | null;
  verified: boolean;
  colour: string;
  buf: PoseBuffer;
  lives: number;
  score: number;
  kills: number;
  down: boolean;
  shield: boolean;
  /** Firing bits from the pose: 1 firing, 2 spread, 4 rail, 8 overdrive (remote shots are simulated from these, no per-shot messages). */
  fb: number;
  cool: number;
  wave: number;
  seen: number;
  claimTokens: number;
  claimAt: number;
};

export type NetHandlers = {
  onWave(m: WaveMsg): void;
  onSpawn(m: SpawnMsg): void;
  onBolts(b: BoltRow[]): void;
  onHit(id: string, d: number): void;
  onKill(id: string, claim: Claim): void;
  onBossHit(d: number): void;
  onBossKill(claim: Claim): void;
  onForm(f: { x: number; gy: number; dir: number; wt: number; bt: number | null }): void;
  onVs(n: number, from: Peer): void;
  onPeers(): void;
};

const num = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const LEADER_TIMEOUT = 3500;

function readRow(v: unknown): WireRow | null {
  if (!Array.isArray(v) || v.length < 5) return null;
  const id = str(v[0], 80);
  const kind = str(v[1], 12);
  if (!id || !['payment', 'data', 'social', 'inscription', 'token', 'blast'].includes(kind)) return null;
  return [id, kind, num(v[2], 0, 4e6, 250), v[3] ? str(v[3], 80) : 0, v[4] ? 1 : 0];
}

export class InvadersNet {
  readonly me: string;
  readonly ids: string[];
  readonly peers = new Map<string, Peer>();
  readonly seed: number;
  readonly cfg: InvCfg;
  private waveSeen = '';
  private lastWave: { msg: WaveMsg; at: number } | null = null;
  private outBolts: BoltRow[] = [];
  private poseT = 0;
  private formT = 0;
  private downFlag = false;
  sent = 0;
  got = 0;
  private disposed = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** Current wave number as the engine sees it (claims for other waves are ignored). */
  wave = 1;

  constructor(private link: RaceLink<InvCfg>, race: RaceInfo<InvCfg>, private h: NetHandlers) {
    this.me = link.id;
    this.ids = race.ids.slice(0, 8);
    this.cfg = race.cfg;
    this.seed = hashSeed(race.rid);
    const now = performance.now();
    this.ids.forEach((id, index) => {
      const w = readWire(race.players[id]);
      const pl = race.players[id];
      this.peers.set(id, {
        id,
        index,
        name: str(pl?.name, 16) || `PILOT ${index + 1}`,
        handle: w.x ?? null,
        verified: false,
        colour: SHIP_COLOURS[index % SHIP_COLOURS.length],
        buf: new PoseBuffer(),
        lives: 3,
        score: 0,
        kills: 0,
        down: false,
        shield: false,
        fb: 0,
        cool: 0,
        wave: 1,
        seen: now,
        claimTokens: 40,
        claimAt: now,
      });
      if (w.x && w.xk && w.xs) void verifyWire(w, id).then((ok) => {
        const p = this.peers.get(id);
        if (ok && p && !this.disposed) {
          p.verified = true;
          this.h.onPeers();
        }
      });
    });
    link.on = (ev, p) => this.recv(ev, p);
  }

  get count() {
    return this.ids.length;
  }
  get versus() {
    return this.cfg.mode === 'versus';
  }
  /** A pilot is "present" if it is me or we heard from it recently. */
  present(id: string, now = performance.now()) {
    return id === this.me || now - (this.peers.get(id)?.seen ?? -1e9) < LEADER_TIMEOUT;
  }
  leaderId(now = performance.now()) {
    return this.ids.find((id) => this.present(id, now)) ?? this.me;
  }
  isLeader() {
    return this.leaderId() === this.me;
  }
  others(now = performance.now()) {
    return [...this.peers.values()].filter((p) => p.id !== this.me && this.present(p.id, now));
  }
  /** Any other pilot still alive on the line (not down, not gone)? */
  anyOtherUp(now = performance.now()) {
    return this.others(now).some((p) => !p.down && p.lives > 0);
  }
  /** x of the nearest living ship to `x` among the other pilots (null if none). */
  nearestOther(x: number, now = performance.now()): number | null {
    let best: number | null = null;
    for (const p of this.others(now)) {
      if (p.down) continue;
      const px = p.buf.sample(now);
      if (best === null || Math.abs(px - x) < Math.abs(best - x)) best = px;
    }
    return best;
  }

  private fromLeader(id: string) {
    return this.ids.indexOf(id) >= 0 && this.ids.indexOf(id) <= this.ids.indexOf(this.leaderId());
  }

  // ── send ──

  private send(ev: string, p: Record<string, unknown>) {
    if (this.disposed) return;
    this.sent++;
    this.link.send(ev, { ...p, i: this.me });
  }
  /** Send now and once more shortly after (broadcast is best-effort; the receivers dedupe). */
  private send3(ev: string, p: Record<string, unknown>) {
    this.send(ev, p);
    this.timers.push(setTimeout(() => this.send(ev, p), 350));
  }
  private lastPose = '';
  private poseAge = 0;
  sendPose(s: { x: number; vx: number; lives: number; score: number; kills: number; down: boolean; shield: boolean; fb: number; wave: number }) {
    this.downFlag = s.down;
    const msg = { x: +s.x.toFixed(2), vx: +s.vx.toFixed(1), l: s.lives, s: s.score, k: s.kills, d: s.down ? 1 : 0, sh: s.shield ? 1 : 0, fb: s.fb, w: s.wave };
    const sig = `${msg.x}|${msg.l}|${msg.s}|${msg.d}|${msg.fb}|${msg.w}`;
    if (sig === this.lastPose && this.poseAge < 0.4) return; // idle ships only need an occasional heartbeat
    this.lastPose = sig;
    this.poseAge = 0;
    this.send('ip', msg);
  }
  sendWave(m: WaveMsg) {
    this.lastWave = { msg: m, at: performance.now() };
    this.send3('w', m as unknown as Record<string, unknown>);
  }
  sendSpawn(m: SpawnMsg) {
    this.send3('sp', m as unknown as Record<string, unknown>);
  }
  queueBolt(b: BoltRow) {
    if (this.outBolts.length < 40) this.outBolts.push(b);
  }
  sendHit(id: string, d: number) {
    this.send('h', { w: this.wave, id, d });
  }
  sendKill(id: string, t: number) {
    this.send3('k', { w: this.wave, id, t });
  }
  sendBossHit(d: number) {
    this.send('bd', { w: this.wave, d });
  }
  sendBossKill(t: number) {
    this.send3('bk', { w: this.wave, t });
  }
  sendVs(to: string, n: number) {
    this.send('vs', { to, n });
  }
  /** Frame hook: flush bolts, formation sync (leader, ~6 Hz) and the wave keepalive. */
  tick(dt: number, f: () => { x: number; gy: number; dir: number; wt: number; bt: number | null } | null) {
    if (this.outBolts.length && this.isLeader()) {
      this.send('eb', { w: this.wave, b: this.outBolts });
    }
    this.outBolts = [];
    this.formT -= dt;
    if (this.formT <= 0 && this.isLeader()) {
      this.formT = 0.2;
      const s = f();
      if (s) this.send('f', { w: this.wave, x: +s.x.toFixed(2), gy: +s.gy.toFixed(2), d: s.dir, wt: +s.wt.toFixed(2), bt: s.bt === null ? -1 : +s.bt.toFixed(2) });
      // Keepalive: a pilot that missed the manifest can still join the wave.
      if (this.lastWave && performance.now() - this.lastWave.at > 2500) {
        this.lastWave.at = performance.now();
        this.send('w', this.lastWave.msg as unknown as Record<string, unknown>);
      }
    }
  }
  get poseDue() {
    return this.poseT;
  }
  poseTick(dt: number): boolean {
    this.poseT -= dt;
    this.poseAge += dt;
    if (this.poseT > 0) return false;
    this.poseT = 1 / 10;
    return true;
  }

  // ── receive ──

  private recv(ev: string, raw: unknown) {
    if (this.disposed) return;
    const d = (raw ?? {}) as Record<string, unknown>;
    const from = str(d.i, 16);
    const peer = this.peers.get(from);
    if (!peer || from === this.me) return;
    const now = performance.now();
    this.got++;
    peer.seen = now;
    switch (ev) {
      case 'ip': {
        peer.buf.push(now, num(d.x, -20, 20), num(d.vx, -40, 40));
        peer.lives = num(d.l, -5, 9, peer.lives);
        peer.score = num(d.s, 0, 1e9, peer.score);
        peer.kills = num(d.k, 0, 1e6, peer.kills);
        peer.down = d.d === 1;
        peer.shield = d.sh === 1;
        peer.fb = num(d.fb, 0, 15, 0) | 0;
        peer.wave = num(d.w, 1, 9999, peer.wave) | 0;
        this.h.onPeers();
        break;
      }
      case 'w': {
        if (!this.fromLeader(from)) return;
        const t = Array.isArray(d.t) ? (d.t.slice(0, 72).map(readRow).filter(Boolean) as WireRow[]) : [];
        if (!t.length) return;
        const bp = d.bp && typeof d.bp === 'object' ? { h: num((d.bp as Record<string, unknown>).h, 0, 1e8), c: num((d.bp as Record<string, unknown>).c, 0, 1e7) } : null;
        const msg: WaveMsg = { n: num(d.n, 1, 9999, 1) | 0, bl: num(d.bl, 0, 1e5), bd: d.bd ? 1 : 0, bp, t };
        const key = `${msg.n}|${t[0][0]}|${t.length}`;
        if (key === this.waveSeen) return;
        this.waveSeen = key;
        this.h.onWave(msg);
        break;
      }
      case 'sp': {
        if (!this.fromLeader(from)) return;
        const r = readRow(d.r);
        if (!r) return;
        this.h.onSpawn({ m: d.m === 's' ? 's' : 'd', r, x: num(d.x, -30, 30), bx: num(d.bx, -20, 20), vx: num(d.vx, -20, 20), gy: num(d.gy, -5, 60, 33) });
        break;
      }
      case 'eb': {
        if (!this.fromLeader(from) || !Array.isArray(d.b)) return;
        if (num(d.w, 0, 9999, 0) !== this.wave) return;
        const rows: BoltRow[] = [];
        for (const b of d.b.slice(0, 40)) if (Array.isArray(b)) rows.push([num(b[0], -30, 30), num(b[1], -5, 60), num(b[2], -30, 30), num(b[3], -40, 40), b[4] ? 1 : 0]);
        this.h.onBolts(rows);
        break;
      }
      case 'f': {
        if (!this.fromLeader(from)) return;
        if (num(d.w, 0, 9999, 0) !== this.wave) return;
        const bt = num(d.bt, -1, 1e4, -1);
        this.h.onForm({ x: num(d.x, -30, 30), gy: num(d.gy, -10, 80), dir: d.d === -1 ? -1 : 1, wt: num(d.wt, 0, 1e4), bt: bt < 0 ? null : bt });
        break;
      }
      case 'h':
        if (Math.abs(num(d.w, 0, 9999, 0) - this.wave) > 1) return;
        this.h.onHit(str(d.id, 80), num(d.d, 0, 4, 1));
        break;
      case 'k': {
        if (!this.claimOk(peer, d, now)) return;
        this.h.onKill(str(d.id, 80), { by: from, t: num(d.t, 0, 4e15) });
        break;
      }
      case 'bd':
        if (Math.abs(num(d.w, 0, 9999, 0) - this.wave) > 1) return;
        this.h.onBossHit(num(d.d, 0, 60, 1));
        break;
      case 'bk': {
        if (!this.claimOk(peer, d, now)) return;
        this.h.onBossKill({ by: from, t: num(d.t, 0, 4e15) });
        break;
      }
      case 'vs':
        if (d.to === this.me) this.h.onVs(num(d.n, 1, 3, 1) | 0, peer);
        break;
    }
  }

  /** Claim sanity: current wave (+-1), plausible wall clock, and at most ~15 claims/s per pilot (bomb bursts allowed by the bucket). */
  private claimOk(p: Peer, d: Record<string, unknown>, now: number) {
    if (Math.abs(num(d.w, 0, 9999, 0) - this.wave) > 1) return false;
    if (Math.abs(num(d.t, 0, 4e15, 0) - Date.now()) > 4000) return false;
    p.claimTokens = Math.min(90, p.claimTokens + ((now - p.claimAt) / 1000) * 15);
    p.claimAt = now;
    if (p.claimTokens < 1) return false;
    p.claimTokens -= 1;
    return true;
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    if (this.link.on) this.link.on = null;
  }
}
