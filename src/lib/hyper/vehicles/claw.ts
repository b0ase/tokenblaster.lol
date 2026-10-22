/**
 * CLAW-DEX "jet claws": a parametric family of mechanical claws, after the ClawMiner / CLAW-DEX art (chrome and
 * orange metal, PCB traces, a glowing core held in the grip). A claw is a jet-powered wrist housing at the back, a
 * palm hub, 2-5 articulated arms, and an energy core held between them.
 *
 * Claws are COSMETIC: speed, grip and handling come from the hull the player picked (Needle/Wedge/Manta), exactly as
 * for every other team. Size varies only within roughly +-25% of the standard ship so collisions and camera read the
 * same.
 *
 * A claw is a ClawSpec. Named presets (CLAW_PRESETS) have stable ids; clawSpec(preset, seed) applies a small
 * deterministic variation, so the same (preset, seed) always builds the same claw (collectible-ready). Seed 0 is the
 * preset exactly.
 */
import * as THREE from 'three';
import type { ShipSpec } from '../sim';
import type { Livery } from '../teams';
import type { Rig } from '../ships';
import { bare, brushedTex, flameGeo, flameMaterial, kitMaterial, liveryCanvas, merge, mergeBare, onFrame, part, ring, rng, rtaper, shieldMesh, SURF, tube, type Detail, type Surf } from './kit';

export type Pincer = 'hook' | 'crab' | 'crusher' | 'needle' | 'scissor';
export type ClawCore = 'orb' | 'hex' | 'crystal';
export type Plates = 'smooth' | 'armoured' | 'spiked';

export type ClawSpec = {
  /** Stable preset id. */
  preset: string;
  name: string;
  blurb: string;
  /** 0 = the preset as designed; anything else = a deterministic variation of it. */
  seed: number;
  /** Arms around the core, 2-5. */
  arms: number;
  /** Segments per arm, 2 or 3. */
  segments: number;
  /** Arm reach multiplier. */
  armLen: number;
  /** Arm thickness multiplier. */
  armThick: number;
  pincer: Pincer;
  core: ClawCore;
  coreSize: number;
  plates: Plates;
  /** Jet nozzles, 1-4. */
  jets: number;
  /** Overall size multiplier (0.8-1.2). */
  scale: number;
  /** How far the arms splay open at rest (radians). */
  spread: number;
  /** ring: arms evenly round the core (a grabber); flat: arms out to the sides (a crab). */
  layout: 'ring' | 'flat';
  /** Lobster-style: every second arm carries a smaller crab cutter instead of the main pincer. */
  asym: boolean;
  /** Rotation of the arm ring (radians). */
  twist: number;
  /** Plate colour (the orange family). */
  tint: string;
  /** Frame metal colour. */
  metal: string;
};

export const CLAW_LIMITS = {
  arms: [2, 5],
  segments: [2, 3],
  armLen: [0.7, 1.35],
  armThick: [0.7, 1.5],
  coreSize: [0.7, 1.4],
  jets: [1, 4],
  scale: [0.8, 1.2],
  spread: [0.1, 0.8],
} as const;

const P = (s: Omit<ClawSpec, 'seed' | 'twist' | 'asym'> & { twist?: number; asym?: boolean }): ClawSpec => ({ seed: 0, twist: 0, asym: false, ...s });

/** The named claws. Ids are stable (collectibles key on them); add new ones at the end. */
export const CLAW_PRESETS: readonly ClawSpec[] = [
  P({ preset: 'grabber', name: 'GRABBER', blurb: 'Three-finger grabber round a hot orb', arms: 3, segments: 2, armLen: 1, armThick: 1, pincer: 'hook', core: 'orb', coreSize: 1, plates: 'armoured', jets: 2, scale: 1, spread: 0.32, layout: 'ring', tint: '#f97316', metal: '#d9dde3' }),
  P({ preset: 'nipper', name: 'NIPPER', blurb: 'Small, quick scissor claw', arms: 2, segments: 2, armLen: 0.82, armThick: 0.85, pincer: 'scissor', core: 'hex', coreSize: 0.75, plates: 'smooth', jets: 1, scale: 0.9, spread: 0.25, layout: 'flat', tint: '#ffa23a', metal: '#e4e7ec' }),
  P({ preset: 'crusher', name: 'CRUSHER', blurb: 'Lobster: one crusher, one cutter', asym: true, arms: 2, segments: 2, armLen: 1.05, armThick: 1.45, pincer: 'crusher', core: 'orb', coreSize: 1.35, plates: 'armoured', jets: 3, scale: 1.18, spread: 0.3, layout: 'flat', tint: '#e8590c', metal: '#6b717b' }),
  P({ preset: 'needle', name: 'NEEDLE', blurb: 'Four long needle fingers', arms: 4, segments: 3, armLen: 1.32, armThick: 0.72, pincer: 'needle', core: 'crystal', coreSize: 0.85, plates: 'smooth', jets: 2, scale: 0.95, spread: 0.18, layout: 'ring', twist: Math.PI / 4, tint: '#ff7a1a', metal: '#cfd4db' }),
  P({ preset: 'kingcrab', name: 'KING CRAB', blurb: 'Two wide crab pincers, spiked shell', arms: 2, segments: 3, armLen: 1.1, armThick: 1.25, pincer: 'crab', core: 'hex', coreSize: 1.1, plates: 'spiked', jets: 2, scale: 1.08, spread: 0.42, layout: 'flat', tint: '#ff6a00', metal: '#d4b483' }),
  P({ preset: 'hydra', name: 'HYDRA', blurb: 'Five hooked arms, three jets', arms: 5, segments: 3, armLen: 0.95, armThick: 0.85, pincer: 'hook', core: 'orb', coreSize: 0.95, plates: 'spiked', jets: 3, scale: 1.04, spread: 0.36, layout: 'ring', tint: '#d9480f', metal: '#9aa1ab' }),
];

const clamp = (v: number, [a, b]: readonly [number, number]) => Math.max(a, Math.min(b, v));

export const clawPresetById = (id: string | null | undefined) => (id ? CLAW_PRESETS.find((p) => p.preset === id.trim().toLowerCase()) : undefined);

/**
 * The claw for (preset, seed). Unknown presets fall back to the first. Seed 0 is the preset itself; other seeds vary
 * reach, thickness, core size, splay, size and shade a little, deterministically.
 */
export function clawSpec(preset?: string | null, seed = 0): ClawSpec {
  const base = clawPresetById(preset) ?? CLAW_PRESETS[0];
  const s = Math.floor(Math.abs(seed)) >>> 0;
  if (!s) return { ...base };
  const r = rng(s ^ 0x9e3779b9);
  const j = (x: number) => 1 + (r() - 0.5) * x;
  const c = new THREE.Color(base.tint);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + (r() - 0.5) * 0.035 + 1) % 1, clamp(hsl.s * j(0.1), [0.6, 1]), clamp(hsl.l * j(0.14), [0.35, 0.62]));
  return {
    ...base,
    seed: s,
    armLen: clamp(base.armLen * j(0.16), CLAW_LIMITS.armLen),
    armThick: clamp(base.armThick * j(0.16), CLAW_LIMITS.armThick),
    coreSize: clamp(base.coreSize * j(0.2), CLAW_LIMITS.coreSize),
    spread: clamp(base.spread + (r() - 0.5) * 0.14, CLAW_LIMITS.spread),
    scale: clamp(base.scale * j(0.08), CLAW_LIMITS.scale),
    twist: base.twist + (r() - 0.5) * 0.3,
    tint: `#${c.getHexString()}`,
  };
}

/** Preset for the n-th claw on a grid (n = 0 is the player): every claw racer on a grid gets a different shape. */
export const clawPresetFor = (n: number) => CLAW_PRESETS[((n % CLAW_PRESETS.length) + CLAW_PRESETS.length) % CLAW_PRESETS.length].preset;

// ───────────── Geometry ─────────────

/** Arm layout in the palm plane: angle of each arm (0 = +X/left, pi/2 = up). */
function armAngles(sp: ClawSpec): number[] {
  const n = sp.arms;
  if (sp.layout === 'flat') {
    if (n === 2) return [0, Math.PI];
    if (n === 3) return [0.15, Math.PI - 0.15, -Math.PI / 2];
    if (n === 4) return [0.38, -0.38, Math.PI - 0.38, Math.PI + 0.38];
    return [0.42, -0.42, Math.PI - 0.42, Math.PI + 0.42, Math.PI / 2];
  }
  return Array.from({ length: n }, (_, i) => Math.PI / 2 + sp.twist + (i * Math.PI * 2) / n);
}

const isPincer = (p: Pincer) => p === 'crab' || p === 'crusher' || p === 'scissor';
/** A lobster carries one crusher and one smaller cutter: with `asym`, every second arm is a crab-style cutter. */
const pincerOf = (sp: ClawSpec, arm: number): Pincer => (sp.asym && arm % 2 === 1 ? 'crab' : sp.pincer);

/** Joint angles at rest (positive = outward). */
function restAngles(sp: ClawSpec, p: Pincer): number[] {
  const s = sp.spread;
  if (isPincer(p)) return sp.segments === 2 ? [0.55 + s, -(0.75 + s * 0.7)] : [0.6 + s, -0.55, -(0.35 + s * 0.5)];
  if (p === 'needle') return sp.segments === 2 ? [0.12 + s, -0.32] : [0.12 + s, -0.16, -0.22];
  return sp.segments === 2 ? [0.22 + s, -(0.62 + s * 0.4)] : [0.2 + s, -0.32, -0.48];
}

type ArmGeo = {
  pincer: Pincer;
  segs: THREE.BufferGeometry[];
  segLen: number[];
  /** Root width of each segment (rams and pins scale with it). */
  segW: number[];
  dactyl: THREE.BufferGeometry | null;
  /** Dactyl pivot in the last segment's frame. */
  pivot: THREE.Vector3;
  rest: number[];
};

type ClawGeo = {
  hull: THREE.BufferGeometry;
  livery: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
  core: THREE.BufferGeometry;
  halo: THREE.BufferGeometry | null;
  arms: ArmGeo[];
  knuckles: { pos: THREE.Vector3; ang: number }[];
  /** Palm radius (ram anchors sit inside it). */
  palmR: number;
  /** Unit ram parts (sleeve, rod), or null on low detail. */
  ram: { sleeve: THREE.BufferGeometry; rod: THREE.BufferGeometry } | null;
  jets: THREE.Vector3[];
  nozzleZ: number;
  coreZ: number;
};

const geoCache = new Map<string, ClawGeo>();

const metalOf = (sp: ClawSpec): Surf => ({ c: sp.metal, m: 1, r: 0.24, cc: 0.25 });
const paintOf = (sp: ClawSpec): Surf => ({ c: sp.tint, m: 0.5, r: 0.3, cc: 1, pcb: 1.6 });
const ledOf = (sp: ClawSpec, g = 3.2): Surf => ({ c: sp.tint, m: 0, r: 0.5, g });
/** Blade steel: brushed, a little darker than chrome so a pair of blades does not flare. */
const BLADE: Surf = { c: '#6c737c', m: 1, r: 0.3, cc: 0.3 };
/** The ground cutting edge: a bright line that reads at race distance. */
const EDGE: Surf = { c: '#fff0d8', m: 0, r: 0.3, g: 2.8 };
const SPIKE: Surf = { c: '#17181c', m: 0.9, r: 0.28, cc: 0.4 };

/** A curved cone along +Z of length `len`, bending toward `bend` (y) at the tip. */
function hookGeo(r: number, len: number, bend: number, seg = 6) {
  const g = new THREE.ConeGeometry(r, len, seg, 6);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getZ(i) / len;
    p.setY(i, p.getY(i) + bend * t * t);
  }
  g.computeVertexNormals();
  return g;
}

/** Extrude a side profile drawn in (u = along the arm, v = outward) with `depth` across X, centred on X = 0. */
function profile(pts: [number, number][], depth: number, bevel: number, curve = 6): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  pts.forEach(([u, v], i) => (i ? sh.lineTo(u, v) : sh.moveTo(u, v)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  // (u, v, d) -> (x = -d, y = v, z = u): a proper rotation, so winding and normals stay right.
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  return g;
}

/** Sample a quadratic Bezier into points (excluding the start). */
function quad(a: [number, number], c: [number, number], b: [number, number], n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const s = 1 - t;
    out.push([s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** Serrated edge from `a` to `b`, teeth sticking out toward `dir` (+1 = +v). */
function serrate(a: [number, number], b: [number, number], n: number, depth: number, dir: 1 | -1): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.5) / n;
    const t1 = (i + 1) / n;
    out.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 + dir * depth]);
    out.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
  }
  return out;
}

function teeth(out: THREE.BufferGeometry[], n: number, z0: number, z1: number, y: number, dir: 1 | -1, size: number) {
  for (let k = 0; k < n; k++) {
    const c = new THREE.ConeGeometry(size, size * 2.2, 4);
    if (dir < 0) c.rotateX(Math.PI);
    c.translate(0, y + dir * size, z0 + ((z1 - z0) * (k + 0.5)) / n);
    out.push(part(c, SURF.chrome, true));
  }
}

/** A hex bolt head facing +X (or -X), centred at (x, y, z). */
function bolt(out: THREE.BufferGeometry[], x: number, y: number, z: number, r: number) {
  const b = new THREE.CylinderGeometry(r, r, r * 0.6, 6);
  b.rotateZ(Math.PI / 2);
  out.push(part(b.translate(x, y, z), SURF.chrome, true));
}

/** A row of rivets on a +Y facing surface. */
function rivets(out: THREE.BufferGeometry[], x: number, y: number, z0: number, z1: number, n: number, r: number) {
  for (let k = 0; k < n; k++) {
    const c = new THREE.CylinderGeometry(r, r, r * 0.8, 6);
    out.push(part(c.translate(x, y, z0 + ((z1 - z0) * k) / Math.max(1, n - 1)), SURF.chrome));
  }
}

/** One arm segment, local frame: joint at the origin, along +Z, outward = +Y. */
function segmentGeo(sp: ClawSpec, p: Pincer, len: number, w0: number, w1: number, last: boolean, detail: Detail, R: () => number) {
  const out: THREE.BufferGeometry[] = [];
  const metal = metalOf(sp);
  const paint = paintOf(sp);
  const lo = detail === 'low';
  const h0 = w0 * 0.85;
  const h1 = w1 * 0.85;
  out.push(part(rtaper(w0, h0, w1, h1, len * 0.98, 0.22), metal));
  // Knuckle: steel drum, chrome caps, a pin through with hex heads both sides.
  const j = new THREE.CylinderGeometry(w0 * 0.55, w0 * 0.55, w0 * 1.25, lo ? 8 : 14);
  j.rotateZ(Math.PI / 2);
  out.push(part(j, SURF.steel));
  const cap = new THREE.CylinderGeometry(w0 * 0.34, w0 * 0.34, w0 * 1.42, lo ? 8 : 12);
  cap.rotateZ(Math.PI / 2);
  out.push(part(cap, metal));
  if (!lo) for (const sx of [1, -1]) bolt(out, sx * w0 * 0.74, 0, 0, w0 * 0.18);
  // Armour on the outer face, carrying the PCB traces.
  const top = (t: number) => (h0 + (h1 - h0) * t) / 2;
  const wAt = (t: number) => w0 + (w1 - w0) * t;
  if (sp.plates === 'armoured') {
    for (let k = 0; k < 3; k++) {
      const z0 = len * (0.1 + k * 0.29);
      const t = z0 / len;
      const pl = rtaper(wAt(t) * 1.18, 0.09, wAt(t + 0.3) * 1.12, 0.07, len * 0.31, 0.3);
      pl.rotateX(0.07);
      pl.translate(0, top(t) + 0.04, z0);
      out.push(part(pl, paint));
      if (!lo) rivets(out, 0, top(t) + 0.1, z0 + len * 0.04, z0 + len * 0.26, 2, w0 * 0.06);
      for (const sx of [1, -1]) {
        const sg = rtaper(0.05, h0 * 0.6, 0.05, h1 * 0.55, len * 0.27, 0.3);
        sg.translate(sx * wAt(t) * 0.56, 0, z0 + 0.02);
        out.push(part(sg, SURF.carbon));
      }
    }
  } else {
    const pl = rtaper(w0 * 1.08, 0.08, w1 * 1.04, 0.06, len * 0.84, 0.35);
    pl.translate(0, top(0.4) + 0.03, len * 0.08);
    out.push(part(pl, paint));
    if (!lo) {
      // Panel seams across the plate and rivets down both edges.
      for (const t of [0.36, 0.64]) out.push(part(rtaper(wAt(t) * 1.06, 0.02, wAt(t) * 1.06, 0.02, 0.025, 0.4, 1).translate(0, top(t) + 0.08, len * t), SURF.dark));
      for (const sx of [1, -1]) rivets(out, sx * wAt(0.5) * 0.42, top(0.5) + 0.075, len * 0.15, len * 0.85, detail === 'ultra' ? 5 : 3, w0 * 0.05);
    }
  }
  if (sp.plates === 'spiked') {
    for (const t of [0.22, 0.52, 0.8]) {
      const c = new THREE.ConeGeometry(w0 * 0.2, w0 * 0.95, 5);
      c.rotateX(-0.55);
      c.translate(0, top(t) + w0 * 0.42, len * t);
      out.push(part(c, SPIKE, true));
    }
  }
  // LED strips along the plate edges.
  for (const sx of [1, -1]) {
    const s = rtaper(0.035, 0.035, 0.03, 0.03, len * 0.7, 0.4, 1);
    s.translate(sx * w0 * 0.5, top(0.4) + 0.06, len * 0.14);
    out.push(part(s, ledOf(sp)));
  }
  if (!lo) {
    // Cable run down the flank, sagging a little between clips.
    for (const sx of detail === 'ultra' ? [1, -1] : [1]) {
      const x = sx * wAt(0.5) * 0.6;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, -h0 * 0.1, len * 0.06), new THREE.Vector3(x * 1.08, -h0 * 0.3, len * 0.5), new THREE.Vector3(x, -h1 * 0.1, len * 0.94)]);
      out.push(part(new THREE.TubeGeometry(curve, 8, w0 * 0.07, 5), SURF.rubber));
      for (const t of [0.06, 0.94]) out.push(part(rtaper(w0 * 0.2, w0 * 0.2, w0 * 0.2, w0 * 0.2, w0 * 0.12, 0.3, 1).translate(x, -h0 * 0.1, len * t - w0 * 0.06), SURF.steel));
    }
    // Ram eyes on the inner face (the rams themselves move: see buildClaw).
    const eye = new THREE.CylinderGeometry(w0 * 0.12, w0 * 0.12, w0 * 0.5, 8);
    eye.rotateZ(Math.PI / 2);
    out.push(part(eye.translate(0, -h0 / 2 - w0 * 0.12, len * 0.45), SURF.steel));
  }
  if (last) tipGeo(out, sp, p, len, w1, detail);
  void R;
  return merge(out);
}

/** Pincer hands are built bigger than the arm that carries them (a crusher is mostly hand). */
const handScale = (p: Pincer) => (p === 'crusher' ? 1.6 : p === 'crab' ? 2.3 : p === 'scissor' ? 2.6 : 1);

// Crab claw profile (u along, v outward), in units of the hand width w.
const CRAB = { P: 1.5, H: 1.25, F: 2.1 };
// Crusher: deeper palm, short blunt fingers.
const CRUSH = { P: 1.3, H: 1.4, F: 1.2 };

/** The business end, appended to the last segment at z=len. Pincer types add the fixed jaw here (dactyl is separate). */
function tipGeo(out: THREE.BufferGeometry[], sp: ClawSpec, p: Pincer, len: number, w0: number, detail: Detail) {
  const w = w0 * handScale(p) * (sp.asym && p === 'crab' ? 0.55 : 1);
  const metal = metalOf(sp);
  const paint = paintOf(sp);
  const th = sp.armThick;
  const lo = detail === 'low';
  const add = (g: THREE.BufferGeometry, s: Surf, flat = false) => out.push(part(g.translate(0, 0, len), s, flat));
  switch (p) {
    case 'hook': {
      add(hookGeo(w * 0.62, 0.95 * th, -0.42 * th, lo ? 5 : 7), paint);
      // A lit tip so the claws read from behind and at distance.
      add(new THREE.SphereGeometry(w * 0.16, 8, 6).translate(0, -0.42 * th * 0.96, 0.93 * th), ledOf(sp, 5));
      if (!lo) teeth(out, 3, len + 0.12, len + 0.6 * th, -w * 0.32, -1, 0.06 * th);
      break;
    }
    case 'needle': {
      add(ring(w * 0.45, 0.03, 0.05), ledOf(sp, 4));
      add(hookGeo(w * 0.42, 1.25 * th, -0.08, 8), metal);
      add(new THREE.SphereGeometry(0.06, 8, 6).translate(0, -0.08, 1.25 * th), ledOf(sp, 6));
      break;
    }
    case 'crab': {
      // A wide crab claw: rounded palm sweeping into the fixed finger, serrated along the inner (+v) edge.
      const { P, H, F } = CRAB;
      const pts: [number, number][] = [[0, -0.42 * H * w]];
      pts.push(...quad([0, -0.42 * H * w], [P * 0.4 * w, -0.66 * H * w], [P * 0.95 * w, -0.6 * H * w], lo ? 3 : 6));
      pts.push(...quad([P * 0.95 * w, -0.6 * H * w], [(P + F * 0.6) * w, -0.55 * H * w], [(P + F) * w, 0.02 * H * w], lo ? 4 : 8));
      pts.push(...serrate([(P + F) * w * 0.97, 0.02 * H * w], [(P + 0.08) * w, 0.16 * H * w], lo ? 3 : 6, 0.13 * H * w, 1));
      pts.push([P * 0.95 * w, 0.38 * H * w]);
      pts.push(...quad([P * 0.95 * w, 0.38 * H * w], [P * 0.45 * w, 0.66 * H * w], [0, 0.42 * H * w], lo ? 3 : 6));
      add(profile(pts, 0.62 * H * w, 0.1 * w, 4), paint);
      // Spines along the top of the palm and a chrome knuckle plate where it meets the arm.
      if (sp.plates === 'spiked') for (const u of [0.3, 0.7, 1.05]) add(new THREE.ConeGeometry(w * 0.12, w * 0.5, 5).rotateX(-0.5).translate(0, (0.5 + 0.12 * Math.sin(u * 3)) * H * w, u * w), SPIKE, true);
      add(rtaper(w * 0.9, w * 0.9, w * 0.85, w * 0.85, w * 0.22, 0.4), metal);
      if (!lo) add(rtaper(0.62 * H * w + 0.04, w * 0.05, 0.62 * H * w + 0.04, w * 0.05, w * 0.6, 0.4, 1).translate(0, -0.05 * w, P * 0.35 * w), ledOf(sp, 3.5));
      break;
    }
    case 'crusher': {
      // A lobster's crusher: a deep, heavy palm and short blunt fingers lined with molars.
      const { P, H, F } = CRUSH;
      const pts: [number, number][] = [[0, -0.4 * H * w]];
      pts.push(...quad([0, -0.4 * H * w], [P * 0.5 * w, -0.74 * H * w], [P * w, -0.62 * H * w], lo ? 3 : 6));
      pts.push(...quad([P * w, -0.62 * H * w], [(P + F * 0.75) * w, -0.6 * H * w], [(P + F) * w, -0.12 * H * w], lo ? 3 : 6));
      pts.push([(P + F * 1.02) * w, 0.04 * H * w]);
      pts.push(...serrate([(P + F) * w, 0.06 * H * w], [(P + 0.1) * w, 0.12 * H * w], lo ? 2 : 4, 0.09 * H * w, 1));
      pts.push([P * 0.92 * w, 0.4 * H * w]);
      pts.push(...quad([P * 0.92 * w, 0.4 * H * w], [P * 0.45 * w, 0.68 * H * w], [0, 0.4 * H * w], lo ? 3 : 6));
      add(profile(pts, 0.8 * H * w, 0.14 * w, 4), paint);
      add(rtaper(w * 0.3, w * 0.22, w * 0.2, w * 0.16, P * w, 0.4).translate(0, 0.58 * H * w, w * 0.05), metal);
      add(rtaper(w * 0.95, w * 0.95, w * 0.9, w * 0.9, w * 0.22, 0.4), metal);
      if (!lo) {
        for (const t of [0.25, 0.55, 0.85]) add(new THREE.SphereGeometry(w * 0.11, 8, 6).translate(0, 0.12 * H * w + w * 0.06, (P + F * t) * w), SURF.chrome);
        add(rtaper(0.8 * H * w + 0.04, w * 0.05, 0.8 * H * w + 0.04, w * 0.05, w * 0.6, 0.4, 1).translate(0, -0.08 * w, P * 0.3 * w), ledOf(sp, 3.5));
      }
      break;
    }
    case 'scissor': {
      // Housing, the fixed blade (a real cross-section: bevelled edges, a ground cutting edge) and the pivot bolt.
      add(rtaper(w * 0.75, w * 0.7, w * 0.62, w * 0.6, w * 0.85, 0.3), paint);
      blade(out, w, -w * 0.08, len + w * 0.85, false);
      const pin = new THREE.CylinderGeometry(w * 0.16, w * 0.16, w * 0.5, 10);
      pin.rotateZ(Math.PI / 2);
      add(pin.translate(0, 0, w * 0.85), SURF.steel);
      for (const sx of [1, -1]) {
        const nut = new THREE.CylinderGeometry(w * 0.2, w * 0.2, w * 0.1, 6);
        nut.rotateZ(Math.PI / 2);
        add(nut.translate(sx * w * 0.25, 0, w * 0.85), SURF.chrome, true);
      }
      break;
    }
  }
}

/** One scissor blade along +Z from the pivot: tang behind, curved spine below, straight cutting edge above, and a
 * bright ground edge along the cut. Pushed into `out`; `flip` turns it over (the moving blade). */
function blade(out: THREE.BufferGeometry[], w: number, x: number, z: number, flip: boolean) {
  const L = w * 3.4;
  const W = w * 1.35;
  const pts: [number, number][] = [[-0.22 * L, -0.24 * W], [0, -0.42 * W]];
  pts.push(...quad([0, -0.42 * W], [0.62 * L, -0.5 * W], [L, 0.04 * W], 8));
  pts.push([0.15 * L, 0.3 * W], [-0.22 * L, 0.2 * W]);
  const body = profile(pts, w * 0.13, w * 0.05, 4);
  const [u0, v0, u1, v1] = [0.15 * L, 0.3 * W, L * 0.97, 0.06 * W];
  const len = Math.hypot(u1 - u0, v1 - v0);
  const edge = rtaper(w * 0.2, 0.035, w * 0.12, 0.025, len, 0.4, 1);
  edge.rotateX(-Math.atan2(v1 - v0, u1 - u0));
  edge.translate(0, v0, u0);
  for (const [g, s] of [[body, BLADE], [edge, EDGE]] as const) {
    if (flip) g.rotateZ(Math.PI);
    out.push(part(g.translate(x, 0, z), s));
  }
}

/** The moving jaw for pincer types, local frame at its pivot (opens toward +Y). */
function dactylGeo(sp: ClawSpec, p: Pincer, w0: number, detail: Detail): { g: THREE.BufferGeometry; pivot: THREE.Vector3 } | null {
  const w = w0 * handScale(p) * (sp.asym && p === 'crab' ? 0.55 : 1);
  const paint = paintOf(sp);
  const lo = detail === 'low';
  const out: THREE.BufferGeometry[] = [];
  switch (p) {
    case 'crab': {
      const { P, H, F } = CRAB;
      const L = F * 1.05 * w;
      const pts: [number, number][] = [[0, -0.12 * H * w], [0, 0.16 * H * w]];
      pts.push(...quad([0, 0.16 * H * w], [L * 0.45, 0.42 * H * w], [L, -0.16 * H * w], lo ? 4 : 8));
      pts.push(...serrate([L * 0.96, -0.16 * H * w], [0.1 * w, -0.16 * H * w], lo ? 3 : 6, 0.12 * H * w, -1));
      out.push(part(profile(pts, 0.5 * H * w, 0.08 * w, 4), paint));
      const j = new THREE.CylinderGeometry(w * 0.2, w * 0.2, 0.62 * H * w + 0.1, 10);
      out.push(part(j.rotateZ(Math.PI / 2), SURF.steel));
      if (!lo) for (const sx of [1, -1]) bolt(out, sx * (0.31 * H * w + 0.05), 0, 0, w * 0.13);
      return { g: merge(out), pivot: new THREE.Vector3(0, 0.3 * H * w, P * 0.92 * w) };
    }
    case 'crusher': {
      const { P, H, F } = CRUSH;
      const L = F * 1.12 * w;
      const pts: [number, number][] = [[0, -0.16 * H * w], [0, 0.22 * H * w]];
      pts.push(...quad([0, 0.22 * H * w], [L * 0.5, 0.52 * H * w], [L, -0.08 * H * w], lo ? 3 : 6));
      pts.push([L, -0.22 * H * w]);
      pts.push(...serrate([L * 0.96, -0.22 * H * w], [0.1 * w, -0.2 * H * w], lo ? 2 : 4, 0.09 * H * w, -1));
      out.push(part(profile(pts, 0.66 * H * w, 0.12 * w, 4), paint));
      const j = new THREE.CylinderGeometry(w * 0.24, w * 0.24, 0.8 * H * w + 0.1, 10);
      out.push(part(j.rotateZ(Math.PI / 2), SURF.steel));
      if (!lo) {
        for (const sx of [1, -1]) bolt(out, sx * (0.4 * H * w + 0.05), 0, 0, w * 0.14);
        for (const t of [0.35, 0.7]) out.push(part(new THREE.SphereGeometry(w * 0.1, 8, 6).translate(0, -0.2 * H * w - w * 0.05, L * t), SURF.chrome));
      }
      return { g: merge(out), pivot: new THREE.Vector3(0, 0.3 * H * w, P * 0.9 * w) };
    }
    case 'scissor': {
      // The fixed blade flipped about its own length: spine above, cutting edge below.
      blade(out, w, w * 0.08, 0, true);
      return { g: merge(out), pivot: new THREE.Vector3(0, 0, w * 0.85) };
    }
    default:
      return null;
  }
}

function clawGeo(sp: ClawSpec, detail: Detail): ClawGeo {
  const key = `${JSON.stringify({ ...sp, name: '', blurb: '' })}|${detail}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const R = rng((sp.seed || 1) * 7919 + sp.arms * 31);
  const metal = metalOf(sp);
  const paint = paintOf(sp);
  const lo = detail === 'low';
  const seg = lo ? 10 : 20;
  const bulk = 0.82 + 0.18 * ((sp.armThick + sp.coreSize) / 2);
  const zRear = -2.55;
  const zFront = -0.5;
  const hull: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  // Wrist housing: lathe along Z, squashed.
  const rAt = (z: number) => {
    const t = (z - zRear) / (zFront - zRear);
    return bulk * (0.5 + 0.26 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.06 * t);
  };
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const z = zRear + ((zFront - zRear) * i) / 14;
    prof.push(new THREE.Vector2(rAt(z), z));
  }
  const SQ = 0.74;
  const house = new THREE.LatheGeometry(prof, seg);
  house.rotateX(Math.PI / 2);
  house.scale(1, SQ, 1);
  hull.push(part(house, metal));
  const capR = new THREE.CircleGeometry(rAt(zRear), seg);
  capR.rotateY(Math.PI);
  hull.push(part(capR.scale(1, SQ, 1).translate(0, 0, zRear), SURF.dark));
  // Rib rings, with rivets round the two big ones.
  for (const z of [-2.25, -1.7, -1.15, -0.7]) {
    const rr = ring(rAt(z) + 0.02, 0.055, z, seg);
    hull.push(part(rr.scale(1, SQ, 1), SURF.dark));
  }
  if (!lo) {
    for (const z of [-1.7, -1.15]) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const r0 = rAt(z) + 0.075;
        const rv = new THREE.SphereGeometry(0.03, 5, 4);
        hull.push(part(rv.translate(Math.sin(a) * r0, Math.cos(a) * r0 * SQ, z), SURF.chrome));
      }
    }
  }
  // Armour shells over the top: front and rear in paint, the middle carries the livery.
  const shell = (z0: number, z1: number, a0: number, a1: number, lift: number) => {
    const r = Math.max(rAt(z0), rAt(z1)) + lift;
    const g = new THREE.CylinderGeometry(r, r, z1 - z0, lo ? 8 : 16, 1, true, a0, a1 - a0);
    g.rotateX(Math.PI / 2);
    g.scale(1, SQ, 1);
    g.translate(0, 0, (z0 + z1) / 2);
    return g;
  };
  const hw = sp.plates === 'armoured' ? 1.0 : 0.85;
  hull.push(part(shell(-2.45, -1.95, Math.PI - hw, Math.PI + hw, 0.07), paint));
  hull.push(part(shell(-0.98, -0.55, Math.PI - hw, Math.PI + hw, 0.07), paint));
  const livery = shell(-1.88, -1.05, Math.PI - hw, Math.PI + hw, 0.08);
  if (sp.plates !== 'smooth') {
    for (const side of [Math.PI / 2, (3 * Math.PI) / 2]) hull.push(part(shell(-2.3, -0.7, side - 0.45, side + 0.45, 0.06), sp.plates === 'spiked' ? SURF.carbon : paint));
  }
  if (sp.plates === 'spiked') {
    // A heavy spiked shell: a dorsal row and a row down each flank.
    for (let k = 0; k < 5; k++) {
      const z = -2.35 + k * 0.42;
      const big = k % 2 === 0 ? 1.25 : 0.9;
      const c = new THREE.ConeGeometry(0.13 * bulk * big, 0.7 * bulk * big, 5);
      c.rotateX(-0.6);
      hull.push(part(c.translate(0, rAt(z) * SQ + 0.14, z), SPIKE, true));
      for (const sx of [1, -1]) {
        const s2 = new THREE.ConeGeometry(0.1 * bulk * big, 0.5 * bulk * big, 5);
        s2.rotateX(-0.6);
        s2.rotateZ(-sx * 1.2);
        hull.push(part(s2.translate(sx * (rAt(z) * 0.82 + 0.12), rAt(z) * SQ * 0.55 + 0.05, z), SPIKE, true));
      }
    }
  }
  // Hydraulic rams down both flanks into the palm.
  if (!lo) {
    for (const sx of [1, -1]) {
      const x = sx * (rAt(-1.4) + 0.12);
      hull.push(part(tube(0.11, 0.11, -2.1, -1.05, 12).translate(x, 0.05, 0), SURF.dark));
      hull.push(part(tube(0.055, 0.055, -1.1, -0.42, 10).translate(x, 0.05, 0), SURF.chrome));
      hull.push(part(rtaper(0.2, 0.22, 0.2, 0.22, 0.25, 0.3).translate(x, 0.05, -2.2), SURF.steel));
      hull.push(part(rtaper(0.035, 0.035, 0.035, 0.035, 0.9, 0.4, 1).translate(x, 0.17, -2.0), ledOf(sp, 3)));
      // Cable loom from the housing into the palm.
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x * 0.92, -0.18, -2.0), new THREE.Vector3(x * 1.05, -0.3, -1.2), new THREE.Vector3(x * 0.85, -0.2, -0.45)]);
      hull.push(part(new THREE.TubeGeometry(curve, 10, 0.035, 5), SURF.rubber));
    }
  }
  // Palm hub.
  const Rp = 0.62 * bulk * (sp.layout === 'flat' ? 1 : 1.08);
  const palm = new THREE.CylinderGeometry(Rp, Rp * 1.08, 0.42, 6);
  palm.rotateX(Math.PI / 2);
  palm.rotateZ(Math.PI / 6);
  hull.push(part(palm.scale(1, 0.82, 1).translate(0, 0, -0.3), metal, true));
  hull.push(part(ring(Rp * 1.02, 0.07, -0.1, 6).rotateZ(Math.PI / 6).scale(1, 0.82, 1), paint, true));
  trim.push(bare(ring(Rp * 0.72, 0.035, -0.06, lo ? 12 : 24).scale(1, 0.82, 1)));
  if (!lo) for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    hull.push(part(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * Rp * 0.88, Math.sin(a) * Rp * 0.88 * 0.82, -0.08), SURF.chrome, true));
  }
  // Core cradle.
  const coreZ = 0.42 + 0.12 * sp.coreSize;
  hull.push(part(tube(0.13, 0.09, -0.1, coreZ - 0.3 * sp.coreSize, 10), SURF.chrome));
  // Jets.
  const jr = [0.48, 0.36, 0.3, 0.27][sp.jets - 1] * bulk;
  const jetXY: [number, number][] =
    sp.jets === 1 ? [[0, 0]] : sp.jets === 2 ? [[0.38 * bulk, -0.04], [-0.38 * bulk, -0.04]] : sp.jets === 3 ? [[0.44 * bulk, -0.1], [-0.44 * bulk, -0.1], [0, 0.22 * bulk]] : [[0.34 * bulk, -0.16], [-0.34 * bulk, -0.16], [0.34 * bulk, 0.2], [-0.34 * bulk, 0.2]];
  const nozzleZ = zRear - 0.55;
  const glow: THREE.BufferGeometry[] = [];
  const jets: THREE.Vector3[] = [];
  for (const [x, y] of jetXY) {
    jets.push(new THREE.Vector3(x, y, nozzleZ));
    hull.push(part(tube(jr * 0.88, jr, nozzleZ, zRear + 0.12, lo ? 10 : 18, true).translate(x, y, 0), SURF.steel));
    hull.push(part(tube(jr * 0.7, jr * 0.8, nozzleZ + 0.02, zRear + 0.1, lo ? 10 : 18, true).translate(x, y, 0), SURF.dark));
    hull.push(part(ring(jr, 0.05, nozzleZ, lo ? 10 : 18).translate(x, y, 0), SURF.chrome));
    if (!lo) for (let k = 1; k <= 2; k++) hull.push(part(ring(jr * 0.98, 0.025, nozzleZ + k * 0.17, 16).translate(x, y, 0), SURF.dark));
    const gd = new THREE.CircleGeometry(jr * 0.72, 16);
    gd.rotateY(Math.PI);
    glow.push(bare(gd.translate(x, y, nozzleZ + 0.15)));
  }
  // Hover pads underneath (anti-grav).
  for (const z of [-2.0, -0.95]) {
    for (const sx of [1, -1]) {
      const x = sx * 0.42 * bulk;
      const yb = -rAt(z) * SQ;
      hull.push(part(tube(0.2, 0.2, -0.04, 0.04, 12).rotateX(Math.PI / 2).translate(x, yb - 0.02, z), SURF.dark));
      const d = new THREE.CircleGeometry(0.15, 12);
      d.rotateX(Math.PI / 2);
      trim.push(bare(d.translate(x, yb - 0.065, z)));
    }
  }
  // Arms (shared geometry between arms of the same pincer).
  const th = sp.armThick;
  const wBase = 0.34 * th * (sp.arms >= 4 ? 0.85 : 1);
  const fr = sp.segments === 2 ? [0.53, 0.47] : [0.38, 0.33, 0.29];
  const byPincer = new Map<Pincer, ArmGeo>();
  const armFor = (p: Pincer): ArmGeo => {
    const have = byPincer.get(p);
    if (have) return have;
    const reach = (isPincer(p) ? 1.95 : 2.35) * sp.armLen * (sp.asym && p === 'crab' ? 0.9 : 1);
    const segLen = fr.map((f) => f * reach);
    const segW: number[] = [];
    const segs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < sp.segments; i++) {
      const w0 = wBase * (1 - i * 0.16);
      const w1 = wBase * (1 - (i + 1) * 0.16);
      segW.push(w0);
      segs.push(segmentGeo(sp, p, segLen[i], w0, w1, i === sp.segments - 1, detail, R));
    }
    const dact = dactylGeo(sp, p, wBase * (1 - sp.segments * 0.16), detail);
    const a: ArmGeo = { pincer: p, segs, segLen, segW, dactyl: dact?.g ?? null, pivot: dact?.pivot ?? new THREE.Vector3(), rest: restAngles(sp, p) };
    byPincer.set(p, a);
    return a;
  };
  const angles = armAngles(sp);
  const arms = angles.map((_, i) => armFor(pincerOf(sp, i)));
  const rX = Rp * 0.92;
  const rY = Rp * 0.7;
  const knuckles = angles.map((ang) => ({ pos: new THREE.Vector3(Math.cos(ang) * rX, Math.sin(ang) * rY, -0.15), ang }));
  // Energy core, and a halo of the same shape (a sphere round a hex prism read as a stray disc).
  const cs = sp.coreSize;
  const coreShape = (s: number) => {
    if (sp.core === 'orb') return new THREE.SphereGeometry(0.46 * cs * s, lo ? 14 : 28, lo ? 10 : 18);
    if (sp.core === 'hex') {
      const g = new THREE.CylinderGeometry(0.46 * cs * s, 0.46 * cs * s, 0.42 * cs * s, 6);
      g.rotateX(Math.PI / 2);
      g.rotateZ(Math.PI / 6);
      return g;
    }
    const g = new THREE.OctahedronGeometry(0.42 * cs * s, 0);
    g.scale(0.85, 0.85, 1.7);
    return g;
  };
  const core = coreShape(1).translate(0, 0, coreZ);
  const halo = lo ? null : coreShape(sp.core === 'orb' ? 1.42 : 1.22).translate(0, 0, coreZ);
  const ram = lo ? null : { sleeve: part(tube(1, 1, 0, 1, 10), SURF.dark), rod: part(tube(1, 1, 0, 1, 8), SURF.chrome) };
  const g: ClawGeo = {
    hull: merge(hull),
    livery,
    trim: mergeBare(trim),
    glow: mergeBare(glow),
    flame: flameGeo(jets, jr * 0.8, 3.0, lo ? 8 : 14),
    core,
    halo,
    arms,
    knuckles,
    palmR: Rp,
    ram,
    jets,
    nozzleZ,
    coreZ,
  };
  // Seeded claws make new geometry; keep the cache bounded (live rigs keep their own references).
  if (geoCache.size >= 32) geoCache.delete(geoCache.keys().next().value!);
  geoCache.set(key, g);
  return g;
}

// ───────────── Textures ─────────────

/** PCB traces with pads (white on black), the ClawMiner look; used as the core's and the plates' emissive map. */
function paintCircuit(c: HTMLCanvasElement, seed: number, bg = '#000', fg = '#fff', alpha = 1) {
  const g = c.getContext('2d')!;
  const S = c.width;
  const r = rng(seed);
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  g.globalAlpha = alpha;
  g.strokeStyle = fg;
  g.fillStyle = fg;
  g.lineWidth = Math.max(1, S / 160);
  g.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    let x = Math.round((r() * S) / 16) * 16;
    let y = Math.round((r() * S) / 16) * 16;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      const d = 16 * (1 + Math.floor(r() * 4));
      const dir = Math.floor(r() * 4);
      if (dir === 0) x += d;
      else if (dir === 1) y += d;
      else if (dir === 2) {
        x += d;
        y += d;
      } else {
        x -= d;
        y += d;
      }
      g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath();
    g.arc(x, y, S / 70, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

let circuitTex: THREE.CanvasTexture | null = null;
function circuit() {
  if (circuitTex) return circuitTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  paintCircuit(c, 4242);
  circuitTex = new THREE.CanvasTexture(c);
  circuitTex.colorSpace = THREE.SRGBColorSpace;
  circuitTex.wrapS = circuitTex.wrapT = THREE.RepeatWrapping;
  return circuitTex;
}

/** The claw's livery plate: tint with dark PCB traces, the CLAW-DEX hex with the race number, ticker and decal. */
export function paintClaw(c: HTMLCanvasElement, l: Livery, tint: string) {
  const g = c.getContext('2d')!;
  const S = c.width;
  paintCircuit(c, 99, tint, '#1a0c04', 0.35);
  // Hex badge (the CLAW-DEX mark), centre.
  const hex = (r: number) => {
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      const x = S * 0.5 + Math.cos(a) * r;
      const y = S * 0.5 + Math.sin(a) * r;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
  };
  hex(S * 0.25);
  g.fillStyle = '#111';
  g.fill();
  hex(S * 0.2);
  g.strokeStyle = tint;
  g.lineWidth = S * 0.025;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `900 ${S * 0.2}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(l.number, S * 0.5, S * 0.52);
  g.fillStyle = '#111';
  g.font = `bold ${S * 0.08}px ui-monospace, Menlo, monospace`;
  g.fillText(l.ticker, S * 0.5, S * 0.86, S * 0.9);
  if (l.decal) {
    g.fillStyle = '#111';
    g.fillRect(0, S * 0.04, S, S * 0.11);
    g.fillStyle = l.decal.bg;
    g.fillRect(0, S * 0.05, S, S * 0.09);
    g.fillStyle = l.decal.fg;
    g.font = `900 ${S * 0.07}px Impact, "Arial Black", sans-serif`;
    g.fillText(l.decal.text, S * 0.5, S * 0.097, S * 0.9);
  }
}

// ───────────── Rig ─────────────

let clawMat: THREE.MeshPhysicalMaterial | null = null;
let clawGlow: THREE.MeshBasicMaterial | null = null;

type Ram = { a: THREE.Object3D; pa: THREE.Vector3; b: THREE.Object3D; pb: THREE.Vector3; sleeve: number; rod: number; r: number };

export function buildClaw(spec: ShipSpec, l: Livery, accentCol: string, cs: ClawSpec, detail: Detail = 'high'): Rig {
  const G = clawGeo(cs, detail);
  const mat = (clawMat ??= kitMaterial({ side: THREE.DoubleSide, roughnessMap: brushedTex() }, 'claw', circuit()));
  clawGlow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9b0').multiplyScalar(1.6), side: THREE.DoubleSide });
  const { canvas, tex } = liveryCanvas(256);
  paintClaw(canvas, l, cs.tint);
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, emissive: new THREE.Color(cs.tint).multiplyScalar(0.25), emissiveMap: tex, envMapIntensity: 1.5, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.tint).multiplyScalar(3.2) });
  const flameMat = flameMaterial(new THREE.Color(cs.tint).lerp(new THREE.Color('#ffd27a'), 0.35).getStyle(), 0.8);
  const coreMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cs.tint).multiplyScalar(0.35), emissive: new THREE.Color(cs.tint).lerp(new THREE.Color('#ffcf80'), 0.25), emissiveIntensity: 2.6, emissiveMap: circuit(), roughness: 0.25, metalness: 0.3 });
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.tint).multiplyScalar(0.7), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide });
  void accentCol;
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const k = cs.scale * Math.max(0.85, Math.min(1.15, spec.length / 5.8));
  const model = new THREE.Group();
  model.scale.setScalar(k);
  tilt.add(model);
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = model) => {
    const me = new THREE.Mesh(g, m);
    me.frustumCulled = false;
    parent.add(me);
    return me;
  };
  mk(G.hull, mat);
  mk(G.livery, bodyMat);
  mk(G.trim, trimMat);
  const glow = mk(G.glow, clawGlow);
  const flame = mk(G.flame, flameMat);
  flame.position.z = G.nozzleZ;
  const core = mk(G.core, coreMat);
  if (G.halo) mk(G.halo, haloMat);
  // Arms: knuckle group -> joint chain; the dactyl rides the last joint.
  const bases: THREE.Group[] = [];
  const joints: THREE.Group[][] = [];
  const dactyls: (THREE.Group | null)[] = [];
  const rams: Ram[] = [];
  G.knuckles.forEach((kn, ai) => {
    const A = G.arms[ai];
    const base = new THREE.Group();
    base.position.copy(kn.pos);
    base.rotation.z = kn.ang - Math.PI / 2;
    model.add(base);
    bases.push(base);
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = base;
    A.segs.forEach((sg, i) => {
      const j = new THREE.Group();
      if (i > 0) j.position.z = A.segLen[i - 1];
      parent.add(j);
      mk(sg, mat, j);
      chain.push(j);
      // A ram across every joint, on the inner face: it extends as the arm opens.
      const w = A.segW[i];
      const y = -(w * 0.85) / 2 - w * 0.12;
      if (i === 0) rams.push({ a: base, pa: new THREE.Vector3(0, -G.palmR * 0.3, -0.28), b: j, pb: new THREE.Vector3(0, y, A.segLen[0] * 0.45), sleeve: 0, rod: 0, r: w * 0.17 });
      else {
        const wp = A.segW[i - 1];
        rams.push({ a: chain[i - 1], pa: new THREE.Vector3(0, -(wp * 0.85) / 2 - wp * 0.12, A.segLen[i - 1] * 0.45), b: j, pb: new THREE.Vector3(0, y, A.segLen[i] * 0.45), sleeve: 0, rod: 0, r: w * 0.15 });
      }
      parent = j;
    });
    let d: THREE.Group | null = null;
    if (A.dactyl) {
      d = new THREE.Group();
      d.position.set(A.pivot.x, A.pivot.y, A.pivot.z + A.segLen[A.segLen.length - 1]);
      parent.add(d);
      mk(A.dactyl, mat, d);
    }
    dactyls.push(d);
    joints.push(chain);
  });
  const pose = (open: number, t: number, roll: number, jitter: number) => {
    joints.forEach((chain, a) => {
      const ang = G.knuckles[a].ang;
      const rest = G.arms[a].rest;
      // Arms on the outside of a turn flex out, the inside ones tuck in.
      const turn = roll * Math.cos(ang) * 0.35;
      const servo = Math.sin(t * 9 + a * 2.1 + cs.seed) * 0.015 + jitter * Math.sin(t * 31 + a) * 0.05;
      chain.forEach((j, i) => {
        const o = i === 0 ? open * 0.45 + turn + servo : -open * (0.25 + 0.1 * i) - turn * 0.4;
        j.rotation.x = -((rest[i] ?? 0) + o);
      });
      const d = dactyls[a];
      if (d) d.rotation.x = -(0.04 + open * 0.75 + Math.max(0, Math.sin(t * 2.2 + a)) * 0.08);
    });
  };
  // Rams: one instanced sleeve + rod per joint, re-aimed every frame (2 draw calls for all of them).
  const ramMesh = G.ram && rams.length ? { s: new THREE.InstancedMesh(G.ram.sleeve, mat, rams.length), r: new THREE.InstancedMesh(G.ram.rod, mat, rams.length) } : null;
  const inv = new THREE.Matrix4();
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  const m4 = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const aimRams = (init: boolean) => {
    if (!ramMesh) return;
    model.updateMatrixWorld(true);
    inv.copy(model.matrixWorld).invert();
    rams.forEach((rm, i) => {
      pA.copy(rm.pa).applyMatrix4(rm.a.matrixWorld).applyMatrix4(inv);
      pB.copy(rm.pb).applyMatrix4(rm.b.matrixWorld).applyMatrix4(inv);
      dir.subVectors(pB, pA);
      const d = dir.length();
      if (init) {
        rm.sleeve = d * 0.62;
        rm.rod = d * 0.62;
      }
      dir.divideScalar(d || 1);
      q.setFromUnitVectors(Z, dir);
      ramMesh.s.setMatrixAt(i, m4.compose(pA, q, sc.set(rm.r, rm.r, rm.sleeve)));
      q.setFromUnitVectors(Z, dir.negate());
      ramMesh.r.setMatrixAt(i, m4.compose(pB, q, sc.set(rm.r * 0.5, rm.r * 0.5, rm.rod)));
    });
    ramMesh.s.instanceMatrix.needsUpdate = true;
    ramMesh.r.instanceMatrix.needsUpdate = true;
  };
  if (ramMesh) {
    for (const im of [ramMesh.s, ramMesh.r]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      model.add(im);
    }
  }
  pose(0.2, 0, 0, 0);
  aimRams(true);
  const shield = shieldMesh(5.8 * k);
  tilt.add(shield);
  let prevRoll = 0;
  onFrame(core, tilt, flame, (m) => {
    core.rotation.z += m.dt * (0.4 + m.thrust * 1.6 + m.boost * 3);
    core.rotation.x = Math.sin(m.t * 0.7) * 0.15;
    const twitch = Math.min(1, Math.abs(m.roll - prevRoll) * 25);
    prevRoll = m.roll;
    pose(0.08 + m.thrust * 0.22 + m.boost * 0.6 + Math.sin(m.t * 1.6 + cs.seed) * 0.03, m.t, m.roll, twitch);
    aimRams(false);
    coreMat.emissiveIntensity = 2.2 + m.thrust * 0.8 + m.boost * 1.8 + Math.sin(m.t * 6) * 0.15;
  });
  return {
    root, tilt, flame, flameMat, glow, canvas, tex, bodyMat, trimMat, shield,
    // Higher and a little further back, looking down: the arms read ahead of the jets from the chase camera.
    cam: { back: 1.02, up: 1.6, tilt: 0.1 },
    engine: (G.jets.length === 1 ? [G.jets[0], G.jets[0]] : G.jets).map((e) => e.clone().multiplyScalar(k)),
    setLivery(nl) {
      paintClaw(canvas, nl, cs.tint);
      tex.needsUpdate = true;
    },
    dispose() {
      tex.dispose();
      bodyMat.dispose();
      trimMat.dispose();
      flameMat.dispose();
      coreMat.dispose();
      haloMat.dispose();
      ramMesh?.s.dispose();
      ramMesh?.r.dispose();
      shield.geometry.dispose();
      (shield.material as THREE.Material).dispose();
    },
  };
}
