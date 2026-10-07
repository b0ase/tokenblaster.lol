/**
 * Procedural rally stage: a winding road centreline, an elevation profile, an analytic ground
 * height + surface query (used by terrain meshing AND car physics), and a corner-speed profile the
 * rivals drive from. No three.js in here: it is plain numbers.
 */
import { clamp, fbm, lerp, noise1, rng, smooth } from './noise';
import type { Stage } from './stages';

export const STEP = 2; // metres between centreline samples
export const ROAD_HALF = 3.7; // half width of the drivable gravel
const CELL = 24;

export type Track = {
  stage: Stage;
  n: number;
  len: number;
  x: Float32Array;
  z: Float32Array;
  y: Float32Array;
  /** Unit tangent. */
  tx: Float32Array;
  tz: Float32Array;
  /** Heading, radians from +z toward +x. */
  th: Float32Array;
  /** Signed curvature (rad/m), left positive. */
  kappa: Float32Array;
  /** Rival speed limit profile (m/s). */
  vlim: Float32Array;
  /** Cumulative ideal time (s) at each sample for a 1.0-skill driver. */
  tIdeal: Float32Array;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Spatial hash of centreline samples. */
  index: Map<number, number[]>;
};

export type Near = { i: number; s: number; lat: number; dist: number };

const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

export function buildTrack(stage: Stage): Track {
  const n = Math.floor(stage.length / STEP) + 1;
  const r = rng(stage.seed);
  const phases = stage.bends.map(() => r() * Math.PI * 2);
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const y = new Float32Array(n);
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  const th = new Float32Array(n);
  const kappa = new Float32Array(n);

  // Heading wanders around +z: sum of sinusoids, eased in so the start is a straight run-up.
  const heading = (s: number) => {
    let t = 0;
    for (let k = 0; k < stage.bends.length; k++) {
      const [a, w] = stage.bends[k];
      t += a * Math.sin((s / w) * Math.PI * 2 + phases[k]);
    }
    return t * smooth(40, 220, s) * (1 - 0.35 * smooth(stage.length - 160, stage.length - 20, s));
  };
  let px = 0;
  let pz = 0;
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    const h = heading(s);
    th[i] = h;
    tx[i] = Math.sin(h);
    tz[i] = Math.cos(h);
    x[i] = px;
    z[i] = pz;
    px += tx[i] * STEP;
    pz += tz[i] * STEP;
  }
  // Elevation: slow rolling hills, small crest jumps, flat at the start and finish.
  const crests: number[] = [];
  for (let c = 0; c < Math.floor(stage.length / 380); c++) crests.push(260 + c * 360 + r() * 90);
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    let h = noise1(s / 170, stage.seed) * stage.rise * 0.5 + noise1(s / 70, stage.seed + 3) * stage.rise * 0.12;
    for (const c of crests) h += 1.15 * Math.exp(-((s - c) * (s - c)) / (2 * 7 * 7));
    y[i] = h * smooth(0, 80, s) * (1 - 0.8 * smooth(stage.length - 120, stage.length, s));
  }
  // Curvature, smoothed over ~20 m.
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 5);
    const b = Math.min(n - 1, i + 5);
    kappa[i] = (th[b] - th[a]) / ((b - a) * STEP);
  }
  // Corner speed profile: lateral-grip limited, then forward/back passes for accel and braking.
  const vlim = new Float32Array(n);
  const aLat = 10.5 * stage.grip;
  for (let i = 0; i < n; i++) vlim[i] = clamp(Math.sqrt(aLat / (Math.abs(kappa[i]) + 1e-4)), 9, 50);
  for (let i = n - 2; i >= 0; i--) vlim[i] = Math.min(vlim[i], Math.sqrt(vlim[i + 1] * vlim[i + 1] + 2 * 8 * STEP));
  vlim[0] = 3;
  for (let i = 1; i < n; i++) vlim[i] = Math.min(vlim[i], Math.sqrt(vlim[i - 1] * vlim[i - 1] + 2 * 5.5 * STEP));
  const tIdeal = new Float32Array(n);
  for (let i = 1; i < n; i++) tIdeal[i] = tIdeal[i - 1] + STEP / Math.max(2, (vlim[i] + vlim[i - 1]) / 2);

  let minX = 1e9;
  let maxX = -1e9;
  let minZ = 1e9;
  let maxZ = -1e9;
  const index = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minZ = Math.min(minZ, z[i]);
    maxZ = Math.max(maxZ, z[i]);
    const k = key(Math.floor(x[i] / CELL), Math.floor(z[i] / CELL));
    const a = index.get(k);
    if (a) a.push(i);
    else index.set(k, [i]);
  }
  return { stage, n, len: (n - 1) * STEP, x, z, y, tx, tz, th, kappa, vlim, tIdeal, bounds: { minX, maxX, minZ, maxZ }, index };
}

/** Nearest centreline sample to (px,pz), refined along the tangent. */
export function nearest(t: Track, px: number, pz: number, out: Near = { i: 0, s: 0, lat: 0, dist: 0 }): Near {
  const cx = Math.floor(px / CELL);
  const cz = Math.floor(pz / CELL);
  let best = -1;
  let bd = 1e18;
  let found = 0;
  for (let ring = 0; ring < 9; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const a = t.index.get(key(cx + dx, cz + dz));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          const ddx = px - t.x[i];
          const ddz = pz - t.z[i];
          const d = ddx * ddx + ddz * ddz;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    if (best >= 0) {
      found++;
      if (found > 1) break; // one more ring after the first hit: neighbour cells can hold nearer samples
    }
  }
  if (best < 0) best = 0;
  const ddx = px - t.x[best];
  const ddz = pz - t.z[best];
  const along = clamp(ddx * t.tx[best] + ddz * t.tz[best], -STEP, STEP);
  out.i = best;
  out.s = clamp(best * STEP + along, 0, t.len);
  // Left of travel is positive (tangent rotated +90 deg in x/z).
  out.lat = ddx * t.tz[best] - ddz * t.tx[best];
  out.dist = Math.abs(out.lat);
  return out;
}

export function roadY(t: Track, s: number) {
  const f = clamp(s / STEP, 0, t.n - 1.001);
  const i = Math.floor(f);
  return lerp(t.y[i], t.y[i + 1], f - i);
}

const tmp: Near = { i: 0, s: 0, lat: 0, dist: 0 };

/** Ground height at (x,z). `fine` adds the small bumps cars feel but the 2 m terrain mesh doesn't show. */
export function groundY(t: Track, px: number, pz: number, fine = true, near: Near = tmp) {
  nearest(t, px, pz, near);
  const st = t.stage;
  const d = near.dist;
  const ry = roadY(t, near.s);
  // Embankments and hills grow away from the road; far hills rise to hide the world's edge.
  const w = smooth(ROAD_HALF + 1.5, ROAD_HALF + 30, d);
  const far = smooth(34, 95, d);
  const hill = (fbm(px / 85, pz / 85, st.seed, 4) + 0.28) * st.hillAmp * (0.55 + 0.9 * far) + far * far * st.hillAmp * 1.6;
  const side = smooth(ROAD_HALF, ROAD_HALF + 12, d) * 0.9; // gentle roadside bank
  const ditch = -0.28 * smooth(ROAD_HALF + 0.5, ROAD_HALF + 3, d) * (1 - smooth(ROAD_HALF + 3, ROAD_HALF + 8, d));
  let h = ry + w * hill + side + ditch;
  if (fine) {
    const gr = 1 - smooth(ROAD_HALF, ROAD_HALF + 4, d) * 0.5;
    h += fbm(px * 0.7, pz * 0.7, 91, 2) * 0.03 * gr + Math.sin(px * 1.9 + pz * 1.3) * 0.008;
  }
  return h;
}

/** Terrain normal from central differences of the coarse height field. */
export function groundNormal(t: Track, px: number, pz: number, out: { x: number; y: number; z: number }) {
  const e = 0.9;
  const hx = groundY(t, px + e, pz, false) - groundY(t, px - e, pz, false);
  const hz = groundY(t, px, pz + e, false) - groundY(t, px, pz - e, false);
  const inv = 1 / Math.hypot(hx, 2 * e, hz);
  out.x = -hx * inv;
  out.y = 2 * e * inv;
  out.z = -hz * inv;
  return out;
}

/** 0 = gravel road, 1 = verge, 2 = off road. */
export function surfaceAt(d: number) {
  return d < ROAD_HALF ? 0 : d < ROAD_HALF + 1.6 ? 1 : 2;
}

/** Position and heading at stage distance s, plus a lateral offset (left positive). */
export function pointAt(t: Track, s: number, lat: number, out: { x: number; y: number; z: number; yaw: number }) {
  const f = clamp(s / STEP, 0, t.n - 1.001);
  const i = Math.floor(f);
  const u = f - i;
  const cx = lerp(t.x[i], t.x[i + 1], u);
  const cz = lerp(t.z[i], t.z[i + 1], u);
  const ttx = lerp(t.tx[i], t.tx[i + 1], u);
  const ttz = lerp(t.tz[i], t.tz[i + 1], u);
  const l = Math.hypot(ttx, ttz) || 1;
  out.x = cx + (ttz / l) * lat;
  out.z = cz - (ttx / l) * lat;
  out.y = lerp(t.y[i], t.y[i + 1], u);
  out.yaw = Math.atan2(ttx, ttz);
  return out;
}
