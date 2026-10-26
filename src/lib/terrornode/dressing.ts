/**
 * TERRORNODE level dressing: the geometry that gives each level its own layout on top of the engine's sets.
 * Loaded with `import('./dressing')` only when a level that needs it opens, so the first load never pays for it.
 *
 *   market    night-market stalls down both kerbs (counters, striped awnings, crates as cover), lantern strings
 *             across the street, hanging banners.
 *   rails     the maglev line overhead on both sides: rails on pylons, low barriers as cover, a train that
 *             streaks past every few seconds.
 *   datacore  green data pillars round the shaft walls with scrolling code, floating rack panels.
 *   heart     the reactor heart: a pulsing core high over the arena inside counter-rotating rings, red conduits
 *             along the floor.
 *
 * Coordinates are the set's own (the player starts at the origin looking down -Z). `halfW` is how wide the playable
 * lane is: dressing sits outside it (or overhead) so nothing blocks a shot line down the middle. Everything is merged
 * or instanced (a handful of draws per level) and toneMapped-off neon for the bloom.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelId, Palette } from './levels';

export type Dressing = { group: THREE.Group; update: (dt: number, t: number) => void; dispose: () => void };
export type DressOpts = { high: boolean; palette: Palette; halfW: number; z0: number; z1: number };

const neon = (c: string, k = 2.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
const solid = (c: string, rough = 0.55, metal = 0.35) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

/** Collect boxes into one merged geometry per material. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const a = this.parts.get(mat) ?? [];
    a.push(g);
    this.parts.set(mat, a);
  }
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
    this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, ry);
  }
  build(into: THREE.Group, shadows: boolean) {
    for (const [mat, gs] of this.parts) {
      const g = mergeGeometries(gs, false);
      gs.forEach((x) => x.dispose());
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadows && !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      m.receiveShadow = shadows;
      into.add(m);
    }
    this.parts.clear();
  }
}

/** A canvas texture of falling code (data core) or a striped awning. */
function codeTexture(c: string) {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 256);
  g.font = '12px monospace';
  for (let x = 0; x < 64; x += 9)
    for (let y = 0; y < 256; y += 12) {
      g.globalAlpha = Math.random() * 0.9 + 0.1;
      g.fillStyle = Math.random() < 0.12 ? '#ffffff' : c;
      g.fillText(String.fromCharCode(0x30a0 + Math.floor(Math.random() * 90)), x, y);
    }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function market(o: DressOpts, root: THREE.Group, mats: THREE.Material[]): Dressing['update'] {
  const P = o.palette;
  const b = new Batch();
  const wood = solid('#2a1a14', 0.8, 0.05);
  const steel = solid('#1c1f27', 0.4, 0.7);
  const awnA = new THREE.MeshStandardMaterial({ color: P.key, roughness: 0.6, metalness: 0.1, emissive: P.key, emissiveIntensity: 0.35 });
  const awnB = new THREE.MeshStandardMaterial({ color: P.rim, roughness: 0.6, metalness: 0.1, emissive: P.rim, emissiveIntensity: 0.35 });
  const strip = neon(P.key, 3);
  const stripB = neon(P.rim, 3);
  mats.push(wood, steel, awnA, awnB, strip, stripB);
  const x0 = o.halfW + 1.2;
  let i = 0;
  for (let z = o.z0 - 4; z > o.z1 + 4; z -= 7.5, i++) {
    for (const s of [-1, 1]) {
      const x = s * (x0 + (i % 2) * 0.6);
      b.box(wood, 2.6, 1.0, 1.4, x, 0.5, z); // counter
      b.box(steel, 0.08, 2.6, 0.08, x - 1.25, 1.3, z - 0.65);
      b.box(steel, 0.08, 2.6, 0.08, x + 1.25, 1.3, z - 0.65);
      b.box((i + (s > 0 ? 1 : 0)) % 2 ? awnA : awnB, 3.0, 0.08, 2.0, x, 2.65, z + 0.2); // awning
      b.box(i % 2 ? strip : stripB, 3.0, 0.06, 0.06, x, 2.6, z + 1.2); // awning edge light
      if (i % 2 === 0) b.box(wood, 0.9, 0.9, 0.9, x - s * 2.1, 0.45, z + 1.6, 0.3); // crates: cover
    }
  }
  b.build(root, o.high);
  // lantern strings across the street (instanced)
  const lanterns: THREE.Vector3[] = [];
  for (let z = o.z0 - 8; z > o.z1 + 6; z -= 11)
    for (let k = 0; k <= 12; k++) {
      const u = k / 12;
      const x = (u - 0.5) * 2 * (x0 + 1);
      lanterns.push(new THREE.Vector3(x, 5.6 - Math.sin(u * Math.PI) * 0.9, z));
    }
  const lg = new THREE.SphereGeometry(0.18, 10, 8);
  const lm = neon(P.key, 3.2);
  mats.push(lm);
  const inst = new THREE.InstancedMesh(lg, lm, lanterns.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  lanterns.forEach((p, k) => {
    inst.setMatrixAt(k, m4.makeTranslation(p.x, p.y, p.z));
    inst.setColorAt(k, col.set(k % 3 ? P.key : P.rim).multiplyScalar(3));
  });
  root.add(inst);
  return (_dt, t) => {
    // lanterns sway together
    inst.position.y = Math.sin(t * 1.3) * 0.05;
  };
}

function rails(o: DressOpts, root: THREE.Group, mats: THREE.Material[]): Dressing['update'] {
  const P = o.palette;
  const b = new Batch();
  const conc = solid('#2a2d36', 0.85, 0.1);
  const steel = solid('#14161d', 0.35, 0.8);
  const glow = neon(P.key, 2.8);
  const glowB = neon(P.rim, 2.4);
  mats.push(conc, steel, glow, glowB);
  const x = o.halfW + 2.5;
  const len = Math.abs(o.z1 - o.z0) + 40;
  const zc = (o.z0 + o.z1) / 2;
  for (const s of [-1, 1]) {
    b.box(steel, 1.4, 0.5, len, s * x, 6.2, zc); // the rail beam
    b.box(glow, 0.08, 0.08, len, s * (x - 0.72), 6.0, zc); // under-light
    b.box(glowB, 0.08, 0.08, len, s * (x + 0.72), 6.45, zc);
    for (let z = o.z0 + 6; z > o.z1 - 10; z -= 9) {
      b.box(conc, 0.9, 6.0, 0.9, s * x, 3.0, z); // pylon
      b.box(glow, 0.95, 0.12, 0.95, s * x, 5.7, z);
    }
    // low barriers inside the lane edge: cover from flankers
    for (let z = o.z0 - 6; z > o.z1 + 6; z -= 13) b.box(conc, 2.2, 0.9, 0.45, s * (o.halfW - 1.4), 0.45, z + (s > 0 ? 4 : 0));
  }
  b.build(root, o.high);
  // the train: a lit carriage set that streaks down one rail, then the other
  const train = new THREE.Group();
  const car = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 14), solid('#0d0f16', 0.3, 0.85));
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.5, 12.5), neon(P.rim, 3.4));
  win.position.y = 0.25;
  mats.push(car.material as THREE.Material, win.material as THREE.Material);
  for (let k = 0; k < 3; k++) {
    const c = car.clone();
    const w = win.clone();
    c.position.z = w.position.z = k * 14.6;
    train.add(c, w);
  }
  train.position.y = 7.5;
  root.add(train);
  return (_dt, t) => {
    const period = 7;
    const u = (t % period) / period;
    const side = Math.floor(t / period) % 2 ? 1 : -1;
    train.position.x = side * x;
    train.position.z = o.z1 - 60 + u * (len + 120);
    train.visible = u < 0.85;
  };
}

function datacore(o: DressOpts, root: THREE.Group, mats: THREE.Material[]): Dressing['update'] {
  const P = o.palette;
  const tex = codeTexture(P.key);
  tex.repeat.set(1, 3);
  const code = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(P.key).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.92, depthWrite: false });
  const frame = solid('#0b1410', 0.4, 0.8);
  const edge = neon(P.rim, 2.2);
  mats.push(code, frame, edge);
  const b = new Batch();
  const pillars: [number, number][] = [];
  const zc = (o.z0 + o.z1) / 2;
  const r = o.halfW - 0.6;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const px = Math.cos(a) * r;
    const pz = zc + Math.sin(a) * r * 1.6;
    if (Math.abs(px) < 3) continue; // never in the walk's middle
    pillars.push([px, pz]);
    b.box(frame, 1.3, 0.3, 1.3, px, 0.15, pz);
    b.box(frame, 1.3, 0.3, 1.3, px, 12.2, pz);
    b.box(edge, 1.34, 0.06, 1.34, px, 0.32, pz);
  }
  b.build(root, o.high);
  const pg = new THREE.CylinderGeometry(0.5, 0.5, 11.8, 12, 1, true);
  const inst = new THREE.InstancedMesh(pg, code, pillars.length);
  const m4 = new THREE.Matrix4();
  pillars.forEach(([x, z], k) => inst.setMatrixAt(k, m4.makeTranslation(x, 6.2, z)));
  root.add(inst);
  // floating rack panels high in the shaft
  const panels = new THREE.Group();
  const pm = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(P.rim).multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  mats.push(pm);
  for (let k = 0; k < 8; k++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), pm);
    const a = (k / 8) * Math.PI * 2;
    p.position.set(Math.cos(a) * (r - 2), 9 + (k % 3), zc + Math.sin(a) * (r - 2));
    p.lookAt(0, p.position.y, zc);
    panels.add(p);
  }
  root.add(panels);
  return (dt, t) => {
    tex.offset.y -= dt * 0.35;
    panels.rotation.y = Math.sin(t * 0.1) * 0.05;
    panels.children.forEach((p, k) => (p.position.y += Math.sin(t * 0.8 + k) * dt * 0.15));
  };
}

function heart(o: DressOpts, root: THREE.Group, mats: THREE.Material[]): Dressing['update'] {
  const P = o.palette;
  const zc = o.z1 + (o.z0 - o.z1) * 0.35;
  const at = new THREE.Vector3(0, 11, zc);
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.key).multiplyScalar(3.2), toneMapped: false });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 3), coreMat);
  core.position.copy(at);
  const shellMat = new THREE.MeshStandardMaterial({ color: '#16080a', metalness: 0.9, roughness: 0.25, emissive: P.key, emissiveIntensity: 0.15, wireframe: true });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 1), shellMat);
  shell.position.copy(at);
  const rings: THREE.Mesh[] = [];
  const ringMat = neon(P.rim, 2.6);
  const ringMatB = neon(P.key, 2.2);
  mats.push(coreMat, shellMat, ringMat, ringMatB);
  for (let k = 0; k < 3; k++) {
    const g = new THREE.TorusGeometry(4 + k * 1.6, 0.09 + k * 0.03, 8, 96);
    const m = new THREE.Mesh(g, k % 2 ? ringMatB : ringMat);
    m.position.copy(at);
    m.rotation.set(Math.PI / 2 + k * 0.5, k * 0.7, 0);
    rings.push(m);
    root.add(m);
  }
  root.add(core, shell);
  // conduits along the floor, both sides, feeding the heart
  const b = new Batch();
  const pipe = solid('#1a0c0e', 0.35, 0.8);
  const hot = neon(P.key, 2.4);
  mats.push(pipe, hot);
  for (const s of [-1, 1]) {
    const x = s * (o.halfW + 0.8);
    const len = Math.abs(o.z1 - o.z0);
    b.add(pipe, new THREE.CylinderGeometry(0.35, 0.35, len, 10).rotateX(Math.PI / 2), x, 0.35, (o.z0 + o.z1) / 2);
    b.box(hot, 0.1, 0.1, len, x, 0.72, (o.z0 + o.z1) / 2);
    for (let z = o.z0 - 3; z > o.z1; z -= 6) b.box(pipe, 1.0, 0.9, 0.5, x, 0.45, z);
  }
  // pillars that hold the rings
  for (const s of [-1, 1]) b.box(pipe, 0.7, 11, 0.7, s * 6.5, 5.5, zc);
  b.build(root, o.high);
  const beat = (t: number) => {
    const u = (t * 1.2) % 1;
    return 1 + 0.18 * Math.exp(-u * 9) + 0.1 * Math.exp(-Math.max(0, u - 0.22) * 12) * (u > 0.22 ? 1 : 0);
  };
  return (dt, t) => {
    const k = beat(t);
    core.scale.setScalar(k);
    coreMat.color.set(P.key).multiplyScalar(2.6 + (k - 1) * 8);
    shell.rotation.y += dt * 0.4;
    rings.forEach((r, i) => {
      r.rotation.z += dt * (0.3 + i * 0.15) * (i % 2 ? -1 : 1);
      r.rotation.x += dt * 0.05 * (i + 1);
    });
  };
}

const BUILDERS: Partial<Record<LevelId, (o: DressOpts, root: THREE.Group, mats: THREE.Material[]) => Dressing['update']>> = { market, rails, datacore, heart };

/** Build a level's dressing (null for ASSAULT, which is the engine's own sets untouched). */
export function buildDressing(id: LevelId, o: DressOpts): Dressing | null {
  const f = BUILDERS[id];
  if (!f) return null;
  const group = new THREE.Group();
  group.name = `dressing:${id}`;
  const mats: THREE.Material[] = [];
  const update = f(o, group, mats);
  return {
    group,
    update,
    dispose: () => {
      group.removeFromParent();
      group.traverse((x) => (x as THREE.Mesh).geometry?.dispose());
      for (const m of mats) {
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    },
  };
}
