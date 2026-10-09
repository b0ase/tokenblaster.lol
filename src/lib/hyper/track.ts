/**
 * Hashrate GP tracks: closed 3D splines (hills, drops, loops, corkscrews, half-pipes, tunnels), resampled by arc
 * length with rotation-minimising frames so loops and rolls work. Everything is generated from small definitions.
 */
import * as THREE from 'three';
import { rng } from '@/lib/rally/noise';
import type { Music, Scenery } from '@/lib/content/schema';

export const STEP = 2.5;
export const HALF_W = 17;

export type Palette = {
  zenith: string;
  horizon: string;
  glow: string;
  fog: string;
  a1: string;
  a2: string;
  sun: string;
  fogDensity: number;
};

/** Track ids are content-pack folder names (content/bracer/tracks/<slug>/track.json). */
export type TrackId = string;

export type TrackDef = {
  id: TrackId;
  name: string;
  /** Katakana flourish and product code for the poster look. */
  kana: string;
  code: string;
  blurb: string;
  author: string;
  licence: string;
  credit?: string;
  /** True for packs shipped by the core team (the three launch circuits). */
  core: boolean;
  order: number;
  seed: number;
  R: number;
  oval: number;
  harm: [number, number, number][];
  /** Height: [harmonic, amplitude, phase]. */
  hy: [number, number, number][];
  base: number;
  /** Gaussian drops: [theta, depth, width (rad)]. */
  drops: [number, number, number][];
  /** Explicit control points (replaces the ring parameters above when set). Bank in radians. */
  points?: { x: number; y: number; z: number; bank: number }[];
  loops: { k: number; r: number; w: number }[];
  /** [start, end, turns] as fractions of the lap. */
  twists: [number, number, number][];
  tunnels: [number, number][];
  pipes: [number, number][];
  jumps: number[];
  pads: [number, number][];
  weapons: number[];
  /** Pit-lane recharge strip along the left edge, as a fraction of the lap. */
  pit: [number, number];
  palette: Palette;
  signs: string[];
  music: Music;
  /** Backdrop family (content pack theme.scenery). */
  scenery: Scenery;
  par?: { lapSeconds?: number; raceSeconds?: number };
};

export type Track = {
  def: TrackDef;
  n: number;
  len: number;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  tx: Float32Array; ty: Float32Array; tz: Float32Array;
  ux: Float32Array; uy: Float32Array; uz: Float32Array;
  rx: Float32Array; ry: Float32Array; rz: Float32Array;
  /** Curvature along the surface normal (positive = valley) and to the right. */
  kn: Float32Array;
  kr: Float32Array;
  /** Lateral gravity factor (0 inside corkscrews and loops). */
  gl: Float32Array;
  pipe: Float32Array;
  tunnel: Uint8Array;
  inLoop: Uint8Array;
  vlim: Float32Array;
  tIdeal: Float32Array;
  pads: { s: number; lat: number }[];
  weapons: { s: number; lat: number }[];
  jumps: number[];
  cells: { s: number; lat: number }[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
};

const A = new THREE.Vector3();
const B = new THREE.Vector3();

function rodrigues(v: THREE.Vector3, axis: THREE.Vector3, ang: number) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = axis.dot(v);
  A.copy(axis).cross(v).multiplyScalar(s);
  B.copy(axis).multiplyScalar(d * (1 - c));
  v.multiplyScalar(c).add(A).add(B);
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildTrack(def: TrackDef): Track {
  const N = 64;
  const pts: THREE.Vector3[] = [];
  const tag: boolean[] = [];
  const ringPt = (th: number) => {
    const r = def.R * (1 + def.harm.reduce((sum, [k, a, ph]) => sum + a * Math.cos(k * th + ph), 0) * 0.55);
    let y = def.base;
    for (const [k, a, ph] of def.hy) y += a * Math.sin(k * th + ph);
    for (const [t0, d, w] of def.drops) {
      let dt = th - t0;
      dt = Math.atan2(Math.sin(dt), Math.cos(dt));
      y -= d * Math.exp(-(dt * dt) / (w * w));
    }
    return new THREE.Vector3(r * Math.cos(th), y, r * def.oval * Math.sin(th));
  };
  // Control-point layouts: the points as given (bank per point, in radians).
  const cp = def.points?.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const ctrlBank: number[] = [];
  const count = cp ? cp.length : N;
  for (let k = 0; k < count; k++) {
    const th = (k / N) * Math.PI * 2;
    const loop = def.loops.find((l) => l.k === k);
    const bk = def.points ? def.points[k].bank : 0;
    if (!loop) {
      pts.push(cp ? cp[k].clone() : ringPt(th));
      tag.push(false);
      ctrlBank.push(bk);
      continue;
    }
    const P0 = cp ? cp[k].clone() : ringPt(th);
    const H = cp ? cp[(k + 1) % count].clone().sub(cp[(k + count - 1) % count]) : ringPt(th + 0.02).sub(ringPt(th - 0.02));
    H.y = 0;
    H.normalize();
    const S = new THREE.Vector3(0, 1, 0).cross(H); // left
    const out = new THREE.Vector3(P0.x, 0, P0.z).normalize();
    if (S.dot(out) < 0) S.negate();
    pts.push(P0.clone().addScaledVector(H, -90));
    tag.push(false);
    ctrlBank.push(0);
    const M = 14;
    for (let i = 0; i <= M; i++) {
      const ph = (i / M) * Math.PI * 2;
      pts.push(P0.clone().addScaledVector(H, loop.r * Math.sin(ph)).add(new THREE.Vector3(0, loop.r * (1 - Math.cos(ph)), 0)).addScaledVector(S, (loop.w * ph) / (Math.PI * 2)));
      tag.push(true);
      ctrlBank.push(0);
    }
    pts.push(P0.clone().addScaledVector(S, loop.w).addScaledVector(H, 90));
    tag.push(false);
    ctrlBank.push(0);
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = pts.length * 60;
  const lens = curve.getLengths(curve.arcLengthDivisions);
  const total = lens[lens.length - 1];
  const n = Math.round(total / STEP);
  const len = n * STEP;
  const sp = curve.getSpacedPoints(n);
  const t = {
    def, n, len,
    px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
    tx: new Float32Array(n), ty: new Float32Array(n), tz: new Float32Array(n),
    ux: new Float32Array(n), uy: new Float32Array(n), uz: new Float32Array(n),
    rx: new Float32Array(n), ry: new Float32Array(n), rz: new Float32Array(n),
    kn: new Float32Array(n), kr: new Float32Array(n), gl: new Float32Array(n),
    pipe: new Float32Array(n), tunnel: new Uint8Array(n), inLoop: new Uint8Array(n),
    vlim: new Float32Array(n), tIdeal: new Float32Array(n),
    pads: [], weapons: [], jumps: [], cells: [],
    bounds: { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minY: 1e9, maxY: -1e9 },
  } as Track;
  const b = t.bounds;
  for (let i = 0; i < n; i++) {
    t.px[i] = sp[i].x;
    t.py[i] = sp[i].y;
    t.pz[i] = sp[i].z;
    b.minX = Math.min(b.minX, sp[i].x);
    b.maxX = Math.max(b.maxX, sp[i].x);
    b.minZ = Math.min(b.minZ, sp[i].z);
    b.maxZ = Math.max(b.maxZ, sp[i].z);
    b.minY = Math.min(b.minY, sp[i].y);
    b.maxY = Math.max(b.maxY, sp[i].y);
  }
  const T: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const c = (i + 1) % n;
    T.push(new THREE.Vector3(t.px[c] - t.px[a], t.py[c] - t.py[a], t.pz[c] - t.pz[a]).normalize());
  }
  // Loop flags (arc length of the tagged control points).
  const uAt = (ctrl: number) => lens[Math.min(lens.length - 1, Math.max(0, Math.round((ctrl / pts.length) * (lens.length - 1))))] / total;
  let i0 = -1;
  for (let k = 0; k <= pts.length; k++) {
    const on = k < pts.length && tag[k];
    if (on && i0 < 0) i0 = k;
    if (!on && i0 >= 0) {
      for (let i = Math.floor(uAt(i0 - 1) * n); i <= Math.min(n - 1, Math.ceil(uAt(k) * n)); i++) t.inLoop[i] = 1;
      i0 = -1;
    }
  }
  // Parallel transport frames.
  const U: THREE.Vector3[] = [];
  const u = new THREE.Vector3(0, 1, 0);
  u.addScaledVector(T[0], -u.dot(T[0])).normalize();
  U.push(u.clone());
  const ax = new THREE.Vector3();
  for (let i = 1; i < n; i++) {
    ax.crossVectors(T[i - 1], T[i]);
    const sin = ax.length();
    if (sin > 1e-7) {
      ax.divideScalar(sin);
      rodrigues(u, ax, Math.atan2(sin, T[i - 1].dot(T[i])));
    }
    u.addScaledVector(T[i], -u.dot(T[i])).normalize();
    U.push(u.clone());
  }
  ax.crossVectors(T[n - 1], T[0]);
  const sin0 = ax.length();
  if (sin0 > 1e-7) {
    ax.divideScalar(sin0);
    rodrigues(u, ax, Math.atan2(sin0, T[n - 1].dot(T[0])));
  }
  const cr = new THREE.Vector3().crossVectors(u, U[0]);
  const resid = Math.atan2(cr.dot(T[0]), u.dot(U[0]));
  for (let i = 0; i < n; i++) rodrigues(U[i], T[i], (resid * i) / n);
  // Bank from horizontal turning (not in loops), plus explicit twists.
  const bank = new Float32Array(n);
  const psi = (i: number) => Math.atan2(T[i].x, T[i].z);
  for (let i = 0; i < n; i++) {
    const a = (i + 3) % n;
    const c = (i - 3 + n) % n;
    if (Math.abs(T[i].y) > 0.55 || Math.abs(T[a].y) > 0.55 || Math.abs(T[c].y) > 0.55 || t.inLoop[i]) continue;
    let d = psi(a) - psi(c);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    bank[i] = Math.max(-0.62, Math.min(0.62, (-d / (6 * STEP)) * 115));
  }
  const sm = new Float32Array(n);
  const K = 14;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -K; j <= K; j++) s += bank[(i + j + n) % n];
      sm[i] = s / (2 * K + 1);
    }
    bank.set(sm);
  }
  const tw = new Float32Array(n);
  for (const [f0, f1, turns] of def.twists) for (let i = 0; i < n; i++) tw[i] += turns * Math.PI * 2 * smooth01(f0, f1, i / n);
  if (def.points && ctrlBank.some((x) => x !== 0)) {
    // Authored bank: interpolate the per-point angles along the lap (arc fraction of each control point).
    const at = ctrlBank.map((_, k) => uAt(k));
    for (let i = 0; i < n; i++) {
      const f = i / n;
      let k = 0;
      while (k < at.length - 1 && at[k + 1] <= f) k++;
      const k2 = (k + 1) % at.length;
      const span = (k2 === 0 ? 1 : at[k2]) - at[k];
      const x = span > 1e-9 ? Math.max(0, Math.min(1, (f - at[k]) / span)) : 0;
      const e = x * x * (3 - 2 * x);
      tw[i] += ctrlBank[k] + (ctrlBank[k2] - ctrlBank[k]) * e;
    }
  }
  const R0 = new THREE.Vector3();
  const Rg = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    R0.crossVectors(T[i], U[i]);
    const bk = bank[i] + tw[i];
    U[i].multiplyScalar(Math.cos(bk)).addScaledVector(R0, Math.sin(bk)).normalize();
    Rg.crossVectors(T[i], U[i]);
    t.tx[i] = T[i].x; t.ty[i] = T[i].y; t.tz[i] = T[i].z;
    t.ux[i] = U[i].x; t.uy[i] = U[i].y; t.uz[i] = U[i].z;
    t.rx[i] = Rg.x; t.ry[i] = Rg.y; t.rz[i] = Rg.z;
  }
  const inTw = new Uint8Array(n);
  for (const [f0, f1] of def.twists) for (let i = Math.floor(f0 * n) - 8; i < Math.ceil(f1 * n) + 8; i++) inTw[(i + n) % n] = 1;
  for (let i = 0; i < n; i++) {
    const a = (i + n - 2) % n;
    const c = (i + 2) % n;
    const dx = (T[c].x - T[a].x) / (4 * STEP);
    const dy = (T[c].y - T[a].y) / (4 * STEP);
    const dz = (T[c].z - T[a].z) / (4 * STEP);
    t.kn[i] = dx * t.ux[i] + dy * t.uy[i] + dz * t.uz[i];
    t.kr[i] = dx * t.rx[i] + dy * t.ry[i] + dz * t.rz[i];
    t.gl[i] = inTw[i] || t.inLoop[i] ? 0 : -t.ry[i];
    const f = i / n;
    for (const r of def.tunnels) if (f >= r[0] && f <= r[1]) t.tunnel[i] = 1;
    let p = 0;
    for (const [a0, b0] of def.pipes) p = Math.max(p, smooth01(a0, a0 + 0.012, f) * (1 - smooth01(b0 - 0.012, b0, f)));
    t.pipe[i] = p;
  }
  // Rival speed limits (corner and loop limited) with braking and acceleration passes.
  const VMAX = 178;
  for (let i = 0; i < n; i++) {
    let v = Math.min(VMAX, Math.sqrt(95 / Math.max(Math.abs(t.kr[i]), 1e-5)));
    if (t.inLoop[i]) v = Math.min(v, 120);
    t.vlim[i] = v;
  }
  for (let i = n * 2 - 1; i >= 0; i--) {
    const a = i % n;
    const c = (i + 1) % n;
    t.vlim[a] = Math.min(t.vlim[a], Math.sqrt(t.vlim[c] * t.vlim[c] + 2 * 55 * STEP));
  }
  for (let i = 0; i < n * 2; i++) {
    const a = i % n;
    const c = (i + 1) % n;
    t.vlim[c] = Math.min(t.vlim[c], Math.sqrt(t.vlim[a] * t.vlim[a] + 2 * 40 * STEP));
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    t.tIdeal[i] = acc;
    acc += STEP / t.vlim[i];
  }
  for (const [f, lat] of def.pads) t.pads.push({ s: f * len, lat });
  for (const f of def.jumps) t.jumps.push(f * len);
  for (const f of def.weapons) for (const lat of [-9, 0, 9]) t.weapons.push({ s: f * len, lat });
  const rr = rng(def.seed + 5);
  for (let g = 0; g < 18; g++) {
    const s0 = (g / 18) * len + rr() * 120;
    const lat0 = (rr() - 0.5) * 18;
    for (let j = 0; j < 5; j++) {
      const s = (s0 + j * 14) % len;
      if (t.inLoop[Math.floor(s / STEP) % n]) continue;
      t.cells.push({ s, lat: lat0 + Math.sin(j * 0.8) * 3 });
    }
  }
  return t;
}

/** Interpolated frame at distance s along the lap. */
export type Frame = { px: number; py: number; pz: number; tx: number; ty: number; tz: number; ux: number; uy: number; uz: number; rx: number; ry: number; rz: number; i: number; f: number };
export const newFrame = (): Frame => ({ px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 1, ux: 0, uy: 1, uz: 0, rx: -1, ry: 0, rz: 0, i: 0, f: 0 });
export function frameAt(t: Track, s: number, o: Frame): Frame {
  const n = t.n;
  let x = (s / STEP) % n;
  if (x < 0) x += n;
  const i = Math.floor(x);
  const f = x - i;
  const j = (i + 1) % n;
  const L = (a: Float32Array) => a[i] + (a[j] - a[i]) * f;
  o.i = i;
  o.f = f;
  o.px = L(t.px); o.py = L(t.py); o.pz = L(t.pz);
  const tx0 = L(t.tx), ty0 = L(t.ty), tz0 = L(t.tz);
  let m = Math.hypot(tx0, ty0, tz0) || 1;
  const tx = tx0 / m, ty = ty0 / m, tz = tz0 / m;
  o.tx = tx; o.ty = ty; o.tz = tz;
  let ux = L(t.ux), uy = L(t.uy), uz = L(t.uz);
  const d = ux * tx + uy * ty + uz * tz;
  ux -= tx * d; uy -= ty * d; uz -= tz * d;
  m = Math.hypot(ux, uy, uz) || 1;
  o.ux = ux / m; o.uy = uy / m; o.uz = uz / m;
  o.rx = ty * o.uz - tz * o.uy;
  o.ry = tz * o.ux - tx * o.uz;
  o.rz = tx * o.uy - ty * o.ux;
  return o;
}

/** Surface height at lateral offset (half-pipe walls curl up). */
export const surfaceH = (pipe: number, lat: number) => {
  const a = Math.abs(lat) - 9;
  return a > 0 ? pipe * 0.22 * a * a : 0;
};
export const surfaceSlope = (pipe: number, lat: number) => {
  const a = Math.abs(lat) - 9;
  return a > 0 ? Math.sign(lat) * pipe * 0.44 * a : 0;
};
