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
import { bare, flameGeo, flameMaterial, kitMaterial, liveryCanvas, merge, mergeBare, onFrame, part, ring, rng, rtaper, shieldMesh, SURF, tube, type Detail, type Surf } from './kit';

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

const P = (s: Omit<ClawSpec, 'seed' | 'twist'> & { twist?: number }): ClawSpec => ({ seed: 0, twist: 0, ...s });

/** The named claws. Ids are stable (collectibles key on them); add new ones at the end. */
export const CLAW_PRESETS: readonly ClawSpec[] = [
  P({ preset: 'grabber', name: 'GRABBER', blurb: 'Three-finger grabber round a hot orb', arms: 3, segments: 2, armLen: 1, armThick: 1, pincer: 'hook', core: 'orb', coreSize: 1, plates: 'armoured', jets: 2, scale: 1, spread: 0.32, layout: 'ring', tint: '#f97316', metal: '#d9dde3' }),
  P({ preset: 'nipper', name: 'NIPPER', blurb: 'Small, quick scissor claw', arms: 2, segments: 2, armLen: 0.78, armThick: 0.75, pincer: 'scissor', core: 'hex', coreSize: 0.75, plates: 'smooth', jets: 1, scale: 0.82, spread: 0.25, layout: 'flat', tint: '#ffa23a', metal: '#e4e7ec' }),
  P({ preset: 'crusher', name: 'CRUSHER', blurb: 'Heavy lobster crusher', arms: 2, segments: 2, armLen: 1.05, armThick: 1.45, pincer: 'crusher', core: 'orb', coreSize: 1.35, plates: 'armoured', jets: 3, scale: 1.18, spread: 0.3, layout: 'flat', tint: '#e8590c', metal: '#6b717b' }),
  P({ preset: 'needle', name: 'NEEDLE', blurb: 'Four long needle fingers', arms: 4, segments: 3, armLen: 1.32, armThick: 0.72, pincer: 'needle', core: 'crystal', coreSize: 0.85, plates: 'smooth', jets: 2, scale: 0.95, spread: 0.18, layout: 'ring', twist: Math.PI / 4, tint: '#ff7a1a', metal: '#cfd4db' }),
  P({ preset: 'kingcrab', name: 'KING CRAB', blurb: 'Two crab pincers, spiked shell', arms: 2, segments: 3, armLen: 1.1, armThick: 1.15, pincer: 'crab', core: 'hex', coreSize: 1.1, plates: 'spiked', jets: 2, scale: 1.08, spread: 0.42, layout: 'flat', tint: '#ff6a00', metal: '#d4b483' }),
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

/** Joint angles at rest (positive = outward). */
function restAngles(sp: ClawSpec): number[] {
  const s = sp.spread;
  if (isPincer(sp.pincer)) return sp.segments === 2 ? [0.55 + s, -(0.75 + s * 0.7)] : [0.6 + s, -0.55, -(0.35 + s * 0.5)];
  if (sp.pincer === 'needle') return sp.segments === 2 ? [0.12 + s, -0.32] : [0.12 + s, -0.16, -0.22];
  return sp.segments === 2 ? [0.22 + s, -(0.62 + s * 0.4)] : [0.2 + s, -0.32, -0.48];
}

type ClawGeo = {
  hull: THREE.BufferGeometry;
  livery: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
  core: THREE.BufferGeometry;
  halo: THREE.BufferGeometry | null;
  segs: THREE.BufferGeometry[];
  segLen: number[];
  dactyl: THREE.BufferGeometry | null;
  /** Dactyl pivot in the last segment's frame. */
  pivot: THREE.Vector3;
  knuckles: { pos: THREE.Vector3; ang: number }[];
  rest: number[];
  jets: THREE.Vector3[];
  nozzleZ: number;
  coreZ: number;
  len: number;
};

const geoCache = new Map<string, ClawGeo>();

const metalOf = (sp: ClawSpec): Surf => ({ c: sp.metal, m: 1, r: 0.18, cc: 0.4 });
const paintOf = (sp: ClawSpec): Surf => ({ c: sp.tint, m: 0.55, r: 0.26, cc: 1 });
const ledOf = (sp: ClawSpec, g = 3.2): Surf => ({ c: sp.tint, m: 0, r: 0.5, g });

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

function teeth(out: THREE.BufferGeometry[], sp: ClawSpec, n: number, z0: number, z1: number, y: number, dir: 1 | -1, size: number) {
  for (let k = 0; k < n; k++) {
    const c = new THREE.ConeGeometry(size, size * 2.2, 4);
    if (dir < 0) c.rotateX(Math.PI);
    c.translate(0, y + dir * size, z0 + ((z1 - z0) * (k + 0.5)) / n);
    out.push(part(c, SURF.chrome, true));
  }
}

/** One arm segment, local frame: joint at the origin, along +Z, outward = +Y. */
function segmentGeo(sp: ClawSpec, len: number, w0: number, w1: number, last: boolean, detail: Detail, R: () => number) {
  const out: THREE.BufferGeometry[] = [];
  const metal = metalOf(sp);
  const paint = paintOf(sp);
  const h0 = w0 * 0.85;
  const h1 = w1 * 0.85;
  out.push(part(rtaper(w0, h0, w1, h1, len * 0.98, 0.22), metal));
  // Knuckle joint across X.
  const j = new THREE.CylinderGeometry(w0 * 0.55, w0 * 0.55, w0 * 1.25, 14);
  j.rotateZ(Math.PI / 2);
  out.push(part(j, SURF.steel));
  const cap = new THREE.CylinderGeometry(w0 * 0.32, w0 * 0.32, w0 * 1.42, 12);
  cap.rotateZ(Math.PI / 2);
  out.push(part(cap, metal));
  // Armour on the outer face.
  const top = (t: number) => (h0 + (h1 - h0) * t) / 2;
  if (sp.plates === 'armoured') {
    for (let k = 0; k < 3; k++) {
      const z0 = len * (0.1 + k * 0.29);
      const t = z0 / len;
      const pl = rtaper(w0 * 1.18 - (w0 - w1) * t, 0.09, w0 * 1.1 - (w0 - w1) * (t + 0.3), 0.07, len * 0.31, 0.3);
      pl.rotateX(0.07);
      pl.translate(0, top(t) + 0.04, z0);
      out.push(part(pl, paint));
      // Side guards.
      for (const sx of [1, -1]) {
        const sg = rtaper(0.05, h0 * 0.6, 0.05, h1 * 0.55, len * 0.27, 0.3);
        sg.translate(sx * (w0 * 0.55 - (w0 - w1) * t * 0.5), 0, z0 + 0.02);
        out.push(part(sg, paint));
      }
    }
  } else {
    const pl = rtaper(w0 * 1.08, 0.08, w1 * 1.04, 0.06, len * 0.84, 0.35);
    pl.translate(0, top(0.4) + 0.03, len * 0.08);
    out.push(part(pl, paint));
  }
  if (sp.plates === 'spiked') {
    for (const t of [0.3, 0.68]) {
      const c = new THREE.ConeGeometry(w0 * 0.16, w0 * 0.75, 5);
      c.rotateX(-0.55);
      c.translate(0, top(t) + w0 * 0.32, len * t);
      out.push(part(c, { c: '#1a1a1f', m: 0.9, r: 0.3 }, true));
    }
  }
  // LED strips + a PCB trace with pads along the plate.
  for (const sx of [1, -1]) {
    const s = rtaper(0.035, 0.035, 0.03, 0.03, len * 0.7, 0.4, 1);
    s.translate(sx * w0 * 0.5, top(0.4) + 0.06, len * 0.14);
    out.push(part(s, ledOf(sp)));
  }
  if (detail !== 'low') {
    const tr = rtaper(0.022, 0.02, 0.022, 0.02, len * 0.55, 0.4, 1);
    const tx = (R() - 0.5) * w0 * 0.4;
    tr.translate(tx, top(0.5) + 0.11, len * 0.2);
    out.push(part(tr, ledOf(sp, 2.2)));
    for (const zz of [0.2, 0.75]) {
      const pad = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8);
      pad.translate(tx, top(0.5) + 0.11, len * zz);
      out.push(part(pad, ledOf(sp, 4)));
    }
    // Hydraulic piston on the inner face.
    out.push(part(tube(w0 * 0.17, w0 * 0.17, len * 0.12, len * 0.52, 10), SURF.dark).translate(0, -h0 / 2 - w0 * 0.12, 0));
    out.push(part(tube(w0 * 0.085, w0 * 0.085, len * 0.5, len * 0.88, 8), SURF.chrome).translate(0, -h0 / 2 - w0 * 0.12, 0));
  }
  if (last) tipGeo(out, sp, len, w1, detail);
  return merge(out);
}

/** The business end, appended to the last segment at z=len. Pincer types add the fixed jaw here (dactyl is separate). */
/** Pincer hands are built bigger than the arm that carries them (a crusher is mostly hand). */
const handScale = (p: Pincer) => (p === 'crusher' ? 1.8 : p === 'crab' ? 2.2 : p === 'scissor' ? 1.6 : 1);

function tipGeo(out: THREE.BufferGeometry[], sp: ClawSpec, len: number, w0: number, detail: Detail) {
  const w = w0 * handScale(sp.pincer);
  const metal = metalOf(sp);
  const paint = paintOf(sp);
  const th = sp.armThick;
  const add = (g: THREE.BufferGeometry, s: Surf, flat = false) => out.push(part(g.translate(0, 0, len), s, flat));
  switch (sp.pincer) {
    case 'hook': {
      add(hookGeo(w * 0.62, 0.95 * th, -0.42 * th), paint);
      if (detail !== 'low') teeth(out, sp, 3, len + 0.12, len + 0.6 * th, -w * 0.32, -1, 0.06 * th);
      break;
    }
    case 'needle': {
      add(ring(w * 0.45, 0.03, 0.05), ledOf(sp, 4));
      add(hookGeo(w * 0.42, 1.25 * th, -0.08, 8), metal);
      const tip = new THREE.SphereGeometry(0.06, 8, 6);
      add(tip.translate(0, -0.08, 1.25 * th), ledOf(sp, 6));
      break;
    }
    case 'crab': {
      // Propodus (the palm of the pincer), a chrome ridge, an LED band; the fixed jaw curves up to meet the dactyl.
      add(rtaper(w * 1.1, w * 0.9, w * 1.25, w * 1.0, w * 1.6, 0.45), paint);
      add(rtaper(w * 0.28, w * 0.22, w * 0.2, w * 0.18, w * 1.4, 0.4).translate(0, w * 0.5, w * 0.1), metal);
      if (detail !== 'low') add(rtaper(w * 1.28, w * 0.06, w * 1.28, w * 0.06, w * 0.08, 0.4, 1).translate(0, w * 0.52, w * 1.2), ledOf(sp, 3.5));
      add(hookGeo(w * 0.42, w * 2.0, w * 0.4).translate(0, -w * 0.28, w * 1.45), paint);
      if (detail !== 'low') teeth(out, sp, 4, len + w * 1.7, len + w * 3.0, -w * 0.12, 1, 0.07 * th);
      break;
    }
    case 'crusher': {
      // A lobster's crusher: a heavy knobbly palm and two blunt jaws lined with molars.
      add(rtaper(w * 1.3, w * 1.1, w * 1.45, w * 1.2, w * 1.5, 0.5), paint);
      add(rtaper(w * 0.32, w * 0.26, w * 0.22, w * 0.2, w * 1.3, 0.4).translate(0, w * 0.6, w * 0.1), metal);
      if (detail !== 'low') {
        for (const [x, y, z] of [[0.45, 0.5, 0.4], [-0.45, 0.5, 0.7], [0.5, 0.35, 1.1], [-0.5, 0.3, 0.3], [0.2, 0.62, 0.9], [-0.25, 0.6, 1.25]]) {
          add(new THREE.SphereGeometry(w * 0.11, 8, 6).translate(x * w, y * w, z * w), SURF.dark);
        }
        add(rtaper(w * 1.48, w * 0.06, w * 1.48, w * 0.06, w * 0.08, 0.4, 1).translate(0, w * 0.6, w * 1.25), ledOf(sp, 3.5));
      }
      add(rtaper(w * 0.95, w * 0.75, w * 0.65, w * 0.5, w * 1.5, 0.4).translate(0, -w * 0.32, w * 1.35), paint);
      for (let k = 0; k < 4; k++) add(new THREE.SphereGeometry(w * 0.15, 8, 6).translate(0, w * 0.05, w * (1.55 + k * 0.3)), SURF.chrome);
      break;
    }
    case 'scissor': {
      add(rtaper(w * 0.9, w * 0.8, w * 0.75, w * 0.7, w * 0.9, 0.3), paint);
      const blade = rtaper(0.06, w * 0.85, 0.04, 0.05, w * 3.6, 0.2);
      blade.rotateX(0.06);
      add(blade.translate(-0.04, -w * 0.16, w * 0.75), SURF.chrome);
      add(rtaper(0.025, 0.035, 0.02, 0.02, w * 3.3, 0.4, 1).translate(-0.04, -w * 0.58, w * 0.8), ledOf(sp, 3.5));
      break;
    }
  }
}

/** The moving jaw for pincer types, local frame at its pivot (opens toward +Y). */
function dactylGeo(sp: ClawSpec, w0: number, detail: Detail): { g: THREE.BufferGeometry; pivot: THREE.Vector3 } | null {
  const w = w0 * handScale(sp.pincer);
  const paint = paintOf(sp);
  const th = sp.armThick;
  const out: THREE.BufferGeometry[] = [];
  switch (sp.pincer) {
    case 'crab': {
      out.push(part(hookGeo(w * 0.4, w * 2.2, -w * 0.5), paint));
      const j = new THREE.CylinderGeometry(w * 0.24, w * 0.24, w * 0.95, 10);
      out.push(part(j.rotateZ(Math.PI / 2), SURF.steel));
      if (detail !== 'low') teeth(out, sp, 4, w * 0.4, w * 1.7, -w * 0.18, -1, 0.07 * th);
      return { g: merge(out), pivot: new THREE.Vector3(0, w * 0.38, w * 1.5) };
    }
    case 'crusher': {
      out.push(part(rtaper(w * 0.9, w * 0.7, w * 0.6, w * 0.45, w * 1.5, 0.4), paint));
      const j = new THREE.CylinderGeometry(w * 0.3, w * 0.3, w * 1.1, 10);
      out.push(part(j.rotateZ(Math.PI / 2), SURF.steel));
      for (let k = 0; k < 4; k++) out.push(part(new THREE.SphereGeometry(w * 0.15, 8, 6).translate(0, -w * 0.32, w * (0.25 + k * 0.3)), SURF.chrome));
      return { g: merge(out), pivot: new THREE.Vector3(0, w * 0.4, w * 1.4) };
    }
    case 'scissor': {
      const blade = rtaper(0.06, w * 0.85, 0.04, 0.05, w * 3.6, 0.2);
      blade.rotateX(-0.06);
      out.push(part(blade.translate(0.04, w * 0.16, 0), SURF.chrome));
      out.push(part(rtaper(0.025, 0.035, 0.02, 0.02, w * 3.3, 0.4, 1).translate(0.04, w * 0.58, 0.05), ledOf(sp, 3.5)));
      const j = new THREE.CylinderGeometry(w * 0.22, w * 0.22, w * 0.5, 10);
      out.push(part(j.rotateZ(Math.PI / 2), SURF.chrome));
      return { g: merge(out), pivot: new THREE.Vector3(0, 0, w * 0.75) };
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
  // Rib rings.
  for (const z of [-2.25, -1.7, -1.15, -0.7]) {
    const rr = ring(rAt(z) + 0.02, 0.055, z, seg);
    hull.push(part(rr.scale(1, SQ, 1), SURF.dark));
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
  if (sp.plates === 'armoured') {
    for (const side of [Math.PI / 2, (3 * Math.PI) / 2]) hull.push(part(shell(-2.3, -0.7, side - 0.45, side + 0.45, 0.06), paint));
  }
  if (sp.plates === 'spiked') {
    for (let k = 0; k < 4; k++) {
      const z = -2.3 + k * 0.5;
      const c = new THREE.ConeGeometry(0.1 * bulk, 0.55 * bulk, 5);
      c.rotateX(-0.6);
      c.translate(0, rAt(z) * SQ + 0.12, z);
      hull.push(part(c, { c: '#1a1a1f', m: 0.9, r: 0.3 }, true));
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
  // Arms.
  const th = sp.armThick;
  const reach = (isPincer(sp.pincer) ? 1.95 : 2.35) * sp.armLen;
  const fr = sp.segments === 2 ? [0.53, 0.47] : [0.38, 0.33, 0.29];
  const segLen = fr.map((f) => f * reach);
  const wBase = 0.34 * th * (sp.arms >= 4 ? 0.85 : 1);
  const segs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < sp.segments; i++) {
    const w0 = wBase * (1 - i * 0.16);
    const w1 = wBase * (1 - (i + 1) * 0.16);
    segs.push(segmentGeo(sp, segLen[i], w0, w1, i === sp.segments - 1, detail, R));
  }
  const wTip = wBase * (1 - sp.segments * 0.16);
  const dact = dactylGeo(sp, wTip, detail);
  const rX = Rp * 0.92;
  const rY = Rp * 0.7;
  const knuckles = armAngles(sp).map((ang) => ({ pos: new THREE.Vector3(Math.cos(ang) * rX, Math.sin(ang) * rY, -0.15), ang }));
  // Energy core.
  const cs = sp.coreSize;
  let core: THREE.BufferGeometry;
  if (sp.core === 'orb') core = new THREE.SphereGeometry(0.46 * cs, lo ? 14 : 28, lo ? 10 : 18);
  else if (sp.core === 'hex') {
    core = new THREE.CylinderGeometry(0.46 * cs, 0.46 * cs, 0.42 * cs, 6);
    core.rotateX(Math.PI / 2);
    core.rotateZ(Math.PI / 6);
  } else {
    core = new THREE.OctahedronGeometry(0.42 * cs, 0);
    core.scale(0.85, 0.85, 1.7);
  }
  core.translate(0, 0, coreZ);
  const halo = lo ? null : new THREE.SphereGeometry(0.66 * cs, 18, 12).scale(1, 1, sp.core === 'crystal' ? 1.4 : 1).translate(0, 0, coreZ);
  const g: ClawGeo = {
    hull: merge(hull),
    livery: livery,
    trim: mergeBare(trim),
    glow: mergeBare(glow),
    flame: flameGeo(jets, jr * 0.8, 3.0, lo ? 8 : 14),
    core,
    halo,
    segs,
    segLen,
    dactyl: dact?.g ?? null,
    pivot: dact?.pivot ?? new THREE.Vector3(),
    knuckles,
    rest: restAngles(sp),
    jets,
    nozzleZ,
    coreZ,
    len: 5.8,
  };
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

export function buildClaw(spec: ShipSpec, l: Livery, accentCol: string, cs: ClawSpec, detail: Detail = 'high'): Rig {
  const G = clawGeo(cs, detail);
  const mat = (clawMat ??= kitMaterial({ side: THREE.DoubleSide }, 'claw'));
  clawGlow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9b0').multiplyScalar(1.6), side: THREE.DoubleSide });
  const { canvas, tex } = liveryCanvas(256);
  paintClaw(canvas, l, cs.tint);
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, emissive: new THREE.Color(cs.tint).multiplyScalar(0.25), emissiveMap: tex, envMapIntensity: 1.5, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.tint).multiplyScalar(3.2) });
  const flameMat = flameMaterial(new THREE.Color(cs.tint).lerp(new THREE.Color('#ffd27a'), 0.35).getStyle(), 0.8);
  const coreMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cs.tint).multiplyScalar(0.35), emissive: new THREE.Color(cs.tint).lerp(new THREE.Color('#ffcf80'), 0.25), emissiveIntensity: 2.6, emissiveMap: circuit(), roughness: 0.25, metalness: 0.3 });
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cs.tint).multiplyScalar(0.9), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide });
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
  const joints: THREE.Group[][] = [];
  const dactyls: THREE.Group[] = [];
  for (const kn of G.knuckles) {
    const base = new THREE.Group();
    base.position.copy(kn.pos);
    base.rotation.z = kn.ang - Math.PI / 2;
    model.add(base);
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = base;
    G.segs.forEach((sg, i) => {
      const j = new THREE.Group();
      if (i > 0) j.position.z = G.segLen[i - 1];
      parent.add(j);
      mk(sg, mat, j);
      chain.push(j);
      parent = j;
    });
    if (G.dactyl) {
      const d = new THREE.Group();
      d.position.set(G.pivot.x, G.pivot.y, G.pivot.z + G.segLen[G.segLen.length - 1]);
      parent.add(d);
      mk(G.dactyl, mat, d);
      dactyls.push(d);
    }
    joints.push(chain);
  }
  const pose = (open: number, t: number, roll: number, jitter: number) => {
    joints.forEach((chain, a) => {
      const ang = G.knuckles[a].ang;
      // Arms on the outside of a turn flex out, the inside ones tuck in.
      const turn = roll * Math.cos(ang) * 0.35;
      const servo = Math.sin(t * 9 + a * 2.1 + cs.seed) * 0.015 + jitter * Math.sin(t * 31 + a) * 0.05;
      chain.forEach((j, i) => {
        const rest = G.rest[i] ?? 0;
        const o = i === 0 ? open * 0.45 + turn + servo : -open * (0.25 + 0.1 * i) - turn * 0.4;
        j.rotation.x = -(rest + o);
      });
      const d = dactyls[a];
      if (d) d.rotation.x = -(0.08 + open * 0.7 + Math.max(0, Math.sin(t * 2.2 + a)) * 0.08);
    });
  };
  pose(0.2, 0, 0, 0);
  const shield = shieldMesh(5.8 * k);
  tilt.add(shield);
  let prevRoll = 0;
  onFrame(core, tilt, flame, (m) => {
    core.rotation.z += m.dt * (0.4 + m.thrust * 1.6 + m.boost * 3);
    core.rotation.x = Math.sin(m.t * 0.7) * 0.15;
    const twitch = Math.min(1, Math.abs(m.roll - prevRoll) * 25);
    prevRoll = m.roll;
    pose(0.08 + m.thrust * 0.22 + m.boost * 0.6 + Math.sin(m.t * 1.6 + cs.seed) * 0.03, m.t, m.roll, twitch);
    coreMat.emissiveIntensity = 2.2 + m.thrust * 0.8 + m.boost * 1.8 + Math.sin(m.t * 6) * 0.15;
  });
  return {
    root, tilt, flame, flameMat, glow, canvas, tex, bodyMat, trimMat, shield,
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
      shield.geometry.dispose();
      (shield.material as THREE.Material).dispose();
    },
  };
}
