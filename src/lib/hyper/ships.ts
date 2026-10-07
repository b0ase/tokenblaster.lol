/**
 * Procedural anti-gravity ships: lathe fuselage, extruded delta wing, canopy, engine pods, emissive trim.
 * Flat team livery (chevrons, number, ticker, token logo) is painted to a canvas and mapped from above.
 * Ship space: +Z forward, +X left, +Y up.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShipSpec } from './sim';
import type { Livery } from './teams';

type Hull = { body: THREE.BufferGeometry; dark: THREE.BufferGeometry; canopy: THREE.BufferGeometry; trim: THREE.BufferGeometry; glow: THREE.BufferGeometry; flame: THREE.BufferGeometry; len: number; span: number; engine: THREE.Vector3[] };
const cache = new Map<string, Hull>();

const ni = (g: THREE.BufferGeometry) => {
  const x = g.index ? g.toNonIndexed() : g;
  // Keep only the attributes every part shares so merging never fails.
  for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
  return x;
};
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

export function hullFor(spec: ShipSpec): Hull {
  const hit = cache.get(spec.id);
  if (hit) return hit;
  const L = spec.length;
  const W = spec.span;
  // Fuselage.
  const prof: THREE.Vector2[] = [];
  const Rm = 0.62;
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const r = Rm * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.7) * 0.95 + 0.34 * Math.pow(1 - t, 2.2) + 0.015;
    prof.push(new THREE.Vector2(Math.max(0.015, r), -L / 2 + t * L));
  }
  const fus = new THREE.LatheGeometry(prof, 20);
  fus.rotateX(Math.PI / 2);
  fus.scale(1, 0.5, 1);
  // Wing.
  const tipZ = 0.04 * L - spec.sweep * 0.3 * L;
  const sh = new THREE.Shape();
  const P: [number, number][] = [
    [0, 0.42 * L], [W / 2, tipZ], [W / 2 * 0.86, tipZ - 0.13 * L], [W * 0.2, -0.38 * L], [0, -0.34 * L],
    [-W * 0.2, -0.38 * L], [-W / 2 * 0.86, tipZ - 0.13 * L], [-W / 2, tipZ],
  ];
  P.forEach(([x, z], i) => (i === 0 ? sh.moveTo(x, -z) : sh.lineTo(x, -z)));
  sh.closePath();
  const wing = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 1, curveSegments: 1 });
  wing.rotateX(-Math.PI / 2);
  at(wing, 0, -0.13, 0);
  // Fins.
  const finGeo = () => {
    const f = new THREE.BoxGeometry(0.1, 0.95, 1.5);
    f.rotateX(-0.25);
    return f;
  };
  const fl = finGeo();
  at(fl, W / 2 - 0.15, 0.3, tipZ - 0.55);
  fl.rotateZ(0);
  const fr = finGeo();
  at(fr, -W / 2 + 0.15, 0.3, tipZ - 0.55);
  const fc = new THREE.BoxGeometry(0.09, 0.7, 1.6);
  fc.rotateX(-0.3);
  at(fc, 0, 0.42, -L * 0.36);
  // Canopy.
  const can = new THREE.SphereGeometry(0.5, 16, 10);
  can.scale(0.78, 0.5, 1.9);
  at(can, 0, 0.2, L * 0.1);
  // Engines.
  const eng: THREE.Vector3[] = [new THREE.Vector3(W * 0.17, -0.05, -L * 0.4), new THREE.Vector3(-W * 0.17, -0.05, -L * 0.4)];
  const dark: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const flame: THREE.BufferGeometry[] = [];
  for (const e of eng) {
    const c = new THREE.CylinderGeometry(0.4, 0.5, 1.7, 14, 1, true);
    c.rotateX(Math.PI / 2);
    at(c, e.x, e.y, e.z + 0.1);
    dark.push(ni(c));
    const g = new THREE.CircleGeometry(0.3, 14);
    g.rotateY(Math.PI);
    at(g, e.x, e.y, e.z - 0.78);
    glow.push(ni(g));
    const f = new THREE.ConeGeometry(0.27, 2.8, 12, 1, true);
    f.rotateX(-Math.PI / 2);
    // Base at z=0 (mesh is positioned at the engine rear), tip behind.
    f.translate(e.x, e.y, -1.4);
    flame.push(ni(f));
  }
  // Under-keel.
  const keel = new THREE.BoxGeometry(0.5, 0.18, L * 0.7);
  at(keel, 0, -0.32, 0);
  dark.push(ni(keel));
  // Emissive trim: wing-edge lights and a nose strip.
  const trim: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const t1 = new THREE.BoxGeometry(0.08, 0.07, 1.4);
    at(t1, sx * (W / 2 - 0.2), 0.03, tipZ - 0.2);
    trim.push(ni(t1));
    const t2 = new THREE.BoxGeometry(0.06, 0.05, L * 0.34);
    at(t2, sx * 0.34, 0.2, -L * 0.1);
    trim.push(ni(t2));
  }
  const bodyParts = [ni(fus), ni(wing), ni(fl), ni(fr), ni(fc)];
  const body = mergeGeometries(bodyParts, false);
  // Planar UVs from above for the livery.
  const pos = body.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = 0.5 - pos.getX(i) / (W * 1.02);
    uv[i * 2 + 1] = 0.5 + pos.getZ(i) / (L * 1.02);
  }
  body.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const h: Hull = {
    body,
    dark: mergeGeometries(dark, false),
    canopy: ni(can),
    trim: mergeGeometries(trim, false),
    glow: mergeGeometries(glow, false),
    flame: mergeGeometries(flame, false),
    len: L,
    span: W,
    engine: eng,
  };
  cache.set(spec.id, h);
  return h;
}

/** Flat team livery painted from above: big chevrons pointing at the nose, number, ticker, token logo. */
export function paintLivery(c: HTMLCanvasElement, l: Livery) {
  const g = c.getContext('2d')!;
  const S = c.width;
  g.fillStyle = l.base;
  g.fillRect(0, 0, S, S);
  // Chevrons toward the nose (canvas top).
  g.fillStyle = l.accent;
  for (let k = 0; k < 3; k++) {
    const y = S * (0.5 + k * 0.17);
    g.beginPath();
    g.moveTo(S * 0.14, y + S * 0.12);
    g.lineTo(S * 0.5, y - S * 0.1);
    g.lineTo(S * 0.86, y + S * 0.12);
    g.lineTo(S * 0.86, y + S * 0.2);
    g.lineTo(S * 0.5, y);
    g.lineTo(S * 0.14, y + S * 0.2);
    g.closePath();
    g.globalAlpha = 1 - k * 0.22;
    g.fill();
  }
  g.globalAlpha = 1;
  // Spine stripe.
  g.fillStyle = l.trim;
  g.fillRect(S * 0.47, 0, S * 0.06, S * 0.5);
  g.fillRect(S * 0.02, S * 0.04, S * 0.05, S * 0.92);
  g.fillRect(S * 0.93, S * 0.04, S * 0.05, S * 0.92);
  // Number.
  g.save();
  g.translate(S * 0.5, S * 0.3);
  g.fillStyle = l.accent;
  g.font = `900 ${S * 0.26}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.strokeStyle = l.trim;
  g.lineWidth = S * 0.02;
  g.strokeText(l.number, 0, 0);
  g.fillText(l.number, 0, 0);
  g.restore();
  // Ticker and team code along the wing, reading from the nose side.
  g.save();
  g.translate(S * 0.22, S * 0.78);
  g.rotate(-Math.PI / 2);
  g.fillStyle = l.trim === '#ffffff' ? '#111' : l.trim;
  g.font = `bold ${S * 0.07}px ui-monospace, Menlo, monospace`;
  g.fillText(l.team, 0, 0);
  g.restore();
  g.save();
  g.translate(S * 0.78, S * 0.78);
  g.rotate(Math.PI / 2);
  g.fillStyle = l.trim === '#ffffff' ? '#111' : l.trim;
  g.font = `bold ${S * 0.1}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'right';
  g.fillText(l.ticker, 0, 0);
  g.restore();
  // Token logo roundel.
  const lg = l.logo;
  g.beginPath();
  g.arc(S * 0.5, S * 0.92, S * 0.06, 0, Math.PI * 2);
  g.fillStyle = l.trim;
  g.fill();
  if (lg && lg.complete && lg.naturalWidth) {
    try {
      g.save();
      g.beginPath();
      g.arc(S * 0.5, S * 0.92, S * 0.05, 0, Math.PI * 2);
      g.clip();
      g.drawImage(lg, S * 0.45, S * 0.87, S * 0.1, S * 0.1);
      g.restore();
    } catch {
      /* tainted icon */
    }
  }
}

export type Rig = {
  root: THREE.Group;
  /** Local tilt group (yaw/pitch/roll). */
  tilt: THREE.Group;
  flame: THREE.Mesh;
  flameMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  bodyMat: THREE.MeshPhysicalMaterial;
  trimMat: THREE.MeshBasicMaterial;
  shield: THREE.Mesh;
  engine: THREE.Vector3[];
  setLivery(l: Livery): void;
  dispose(): void;
};

const shared: { dark?: THREE.MeshStandardMaterial; canopy?: THREE.MeshPhysicalMaterial; glow?: THREE.MeshBasicMaterial } = {};

export function buildShip(spec: ShipSpec, l: Livery, accentCol: string): Rig {
  const hull = hullFor(spec);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  paintLivery(canvas, l);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.42, 0.42, 0.42), metalness: 0.2, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5, side: THREE.DoubleSide });
  shared.dark ??= new THREE.MeshStandardMaterial({ color: '#15171d', metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide });
  shared.canopy ??= new THREE.MeshPhysicalMaterial({ color: '#04070f', metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3 });
  shared.glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfeaff').multiplyScalar(1.1), side: THREE.DoubleSide });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentCol).multiplyScalar(3.5) });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentCol).lerp(new THREE.Color('#9fe3ff'), 0.5).multiplyScalar(0.9), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const mk = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const me = new THREE.Mesh(g, m);
    me.frustumCulled = false;
    tilt.add(me);
    return me;
  };
  mk(hull.body, bodyMat);
  mk(hull.dark, shared.dark);
  mk(hull.canopy, shared.canopy);
  mk(hull.trim, trimMat);
  const glow = mk(hull.glow, shared.glow);
  const flame = mk(hull.flame, flameMat);
  flame.position.z = hull.engine[0].z - 0.8;
  // Shield bubble.
  const shield = new THREE.Mesh(new THREE.SphereGeometry(hull.len * 0.62, 18, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#58c8ff').multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  shield.scale.set(1, 0.55, 1.35);
  shield.visible = false;
  tilt.add(shield);
  return {
    root, tilt, flame, flameMat, glow, canvas, tex, bodyMat, trimMat, shield, engine: hull.engine,
    setLivery(nl) {
      paintLivery(canvas, nl);
      tex.needsUpdate = true;
    },
    dispose() {
      tex.dispose();
      bodyMat.dispose();
      trimMat.dispose();
      flameMat.dispose();
      shield.geometry.dispose();
      (shield.material as THREE.Material).dispose();
    },
  };
}

/** Additive ribbon trail from a ring buffer of points. */
export class Trail {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private hist: THREE.Vector3[] = [];
  private rights: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshBasicMaterial;
  constructor(private n: number, private color: THREE.Color, private width: number) {
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) {
      this.hist.push(new THREE.Vector3());
      this.rights.push(new THREE.Vector3(1, 0, 0));
    }
  }
  reset(p: THREE.Vector3) {
    for (const h of this.hist) h.copy(p);
  }
  push(p: THREE.Vector3, right: THREE.Vector3, on: number) {
    const last = this.hist.pop()!;
    const lr = this.rights.pop()!;
    last.copy(p);
    lr.copy(right);
    this.hist.unshift(last);
    this.rights.unshift(lr);
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const f = 1 - i / (n - 1);
      const w = this.width * (0.35 + f * 0.65);
      const h = this.hist[i];
      const r = this.rights[i];
      const o = i * 6;
      this.pos[o] = h.x + r.x * w; this.pos[o + 1] = h.y + r.y * w; this.pos[o + 2] = h.z + r.z * w;
      this.pos[o + 3] = h.x - r.x * w; this.pos[o + 4] = h.y - r.y * w; this.pos[o + 5] = h.z - r.z * w;
      const k = f * f * on * (1 - Math.pow(f, 12));
      for (let j = 0; j < 2; j++) {
        this.col[o + j * 3] = this.color.r * k;
        this.col[o + j * 3 + 1] = this.color.g * k;
        this.col[o + j * 3 + 2] = this.color.b * k;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
