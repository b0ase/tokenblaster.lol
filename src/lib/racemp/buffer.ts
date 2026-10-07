/**
 * Snapshot buffer for ONE remote vehicle (see the API notes in session.ts).
 *
 * Wire format (what you broadcast as event 's'):  { i: senderId, ts: ms (sender clock), p: progress, v: speed,
 * l: lap, f: flags, a: number[] (channels), x?: any extra }.  `progress` must be monotone (distance driven).
 * push() validates and clamps; sample() returns the vehicle ~interpMs in the past, interpolated between the two
 * snapshots around that moment, or extrapolated for up to maxExtrap seconds when packets are late.
 */
export type NetState = { prog: number; v: number; lap: number; fl: number; a: number[]; x?: unknown };
type Snap = NetState & { ts: number };

export type BufferOpts = {
  /** Fastest the vehicle can possibly go (progress units / s). Faster claims are clamped and counted as suspect. */
  maxSpeed: number;
  /** Per-channel [min, max] clamps for `a` (also fixes the expected channel count). */
  clamp: [number, number][];
  /** If channels a[q..q+3] are a quaternion, interpolate them as one (nlerp, shortest arc). */
  quat?: number;
  /** Flag bit meaning "destroyed / frozen": no extrapolation while set. */
  frozenBit?: number;
  interpMs?: number;
  maxExtrap?: number;
  /** Suspect count after which this ship is no longer updated. */
  maxSuspect?: number;
};

const fin = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

export class SnapshotBuffer {
  private buf: Snap[] = [];
  private off = 0;
  private offSet = false;
  suspect = 0;
  /** performance.now() of the last accepted snapshot (0 = none yet). */
  lastRecv = 0;
  /** Latest sample() result. */
  cur: NetState | null = null;
  constructor(private o: BufferOpts) {}

  reset() {
    this.buf = [];
    this.offSet = false;
    this.suspect = 0;
    this.lastRecv = 0;
    this.cur = null;
  }
  get size() {
    return this.buf.length;
  }
  get frozen() {
    return this.suspect > (this.o.maxSuspect ?? 12);
  }

  /** Returns false when the packet was rejected. */
  push(d: Record<string, unknown>, now: number): boolean {
    if (this.frozen) return false;
    const ts = fin(d.ts, 0, 1e12);
    const prog = fin(d.p, -200, 1e7);
    const v = fin(d.v, 0, this.o.maxSpeed * 1.05);
    const lap = fin(d.l, 0, 999);
    const fl = fin(d.f, 0, 65535);
    const a = d.a;
    if (ts === null || prog === null || v === null || lap === null || fl === null || !Array.isArray(a) || a.length < this.o.clamp.length) return false;
    const ch: number[] = [];
    for (let i = 0; i < this.o.clamp.length; i++) {
      const c = fin(a[i], this.o.clamp[i][0], this.o.clamp[i][1]);
      if (c === null) return false;
      ch.push(c);
    }
    const prev = this.buf[this.buf.length - 1];
    let p2 = prog;
    if (prev) {
      if (ts <= prev.ts) return false;
      const lim = this.o.maxSpeed * Math.max(0.02, (ts - prev.ts) / 1000) + 14;
      if (prog - prev.prog > lim) {
        p2 = prev.prog + lim; // no teleporting: clamp to what a vehicle can do
        this.suspect++;
      } else if (prog < prev.prog - 6) p2 = prev.prog;
    }
    const sample = now - ts;
    if (!this.offSet || sample < this.off) {
      this.off = sample;
      this.offSet = true;
    } else this.off += (sample - this.off) * 0.02;
    this.buf.push({ ts, prog: p2, v, lap, fl, a: ch, x: d.x });
    if (this.buf.length > 40) this.buf.shift();
    this.lastRecv = now;
    return true;
  }

  sample(now: number): NetState | null {
    if (!this.buf.length) return null;
    const t = now - this.off - (this.o.interpMs ?? 130);
    while (this.buf.length > 2 && this.buf[1].ts <= t) this.buf.shift();
    const a = this.buf[0];
    const b = this.buf[1];
    let out: NetState;
    if (!b || t >= b.ts) {
      const L = b ?? a;
      const ex = Math.min(this.o.maxExtrap ?? 0.3, Math.max(0, (t - L.ts) / 1000));
      const frozen = this.o.frozenBit ? L.fl & this.o.frozenBit : 0;
      out = { prog: L.prog + (frozen ? 0 : L.v * ex), v: L.v, lap: L.lap, fl: L.fl, a: L.a, x: L.x };
    } else if (t <= a.ts) out = a;
    else {
      const k = (t - a.ts) / Math.max(1, b.ts - a.ts);
      const ch = a.a.map((x, i) => x + (b.a[i] - x) * k);
      const q = this.o.quat;
      if (q !== undefined) {
        // Shortest-arc nlerp for the quaternion channels.
        const dot = a.a[q] * b.a[q] + a.a[q + 1] * b.a[q + 1] + a.a[q + 2] * b.a[q + 2] + a.a[q + 3] * b.a[q + 3];
        const sg = dot < 0 ? -1 : 1;
        let n = 0;
        for (let j = 0; j < 4; j++) {
          ch[q + j] = a.a[q + j] + (sg * b.a[q + j] - a.a[q + j]) * k;
          n += ch[q + j] * ch[q + j];
        }
        n = Math.sqrt(n) || 1;
        for (let j = 0; j < 4; j++) ch[q + j] /= n;
      }
      out = { prog: a.prog + (b.prog - a.prog) * k, v: a.v + (b.v - a.v) * k, lap: k < 0.5 ? a.lap : b.lap, fl: k < 0.5 ? a.fl : b.fl, a: ch, x: k < 0.5 ? a.x : b.x };
    }
    this.cur = out;
    return out;
  }
}
