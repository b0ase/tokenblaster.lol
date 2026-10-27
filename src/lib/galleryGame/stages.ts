/**
 * ESCAPE FROM TERRORNODE: the sets for stages 2 to 4, built in the same engine as the street (./city.ts).
 *
 *   FLOORS  an HQ floor: a long corridor between glass labs (smashable), server racks, desks, neon and a lift
 *           at the far end. New geometry; the facade/curtain-wall look is reused from the city assets.
 *   CORE    a vertical shaft of glowing racks around the TERRORNODE core, which hangs in the middle. The objective
 *           is to jam it with sustained fire: the engine calls `core.set(jam)` and the core goes from hostile red
 *           to cold cyan as it jams.
 *   ROOF    the rooftop: wet concrete, a helipad, the skyline far below, rain, the red beacon, and the hostage
 *           (Dr Kweg S Wong, tied to a chair) behind the LIQUID UNIT's arena.
 *
 * Every set has the same shape as the street's `City` (`World`): shootable glass panes (an instanced mesh with a
 * per-pane hit-point list), shootable server racks, solid surfaces, a floor, and `update`. Sets are built the first
 * time their stage opens (so a player who never gets past the street never pays for them) and kept until the engine
 * is disposed. Coordinates are the street's: the player stands at the origin, looking down -Z, eye 1.62 m.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Look } from '../visuals/look';
import { halo } from '../bsvgun/targets';
import type { Rack, Window } from './city';
import { canvas, JP, rng, skylineTex, softGlow, tex } from './cityAssets';
import { beamMaterial, makeShared, mistMaterial, rainMaterial } from './cityShaders';

/** What the engine needs from a set (the street's `City` satisfies it too). */
export type World = {
  group: THREE.Group;
  windows: THREE.InstancedMesh;
  wins: Window[];
  racks: Rack[];
  /** Solid surfaces (walls, towers): hits spark on them. */
  solids: THREE.Mesh[];
  ground: THREE.Mesh;
  hitLight: THREE.PointLight;
  breakWindow: (w: Window) => void;
  breakRack: (r: Rack) => void;
  rebuild: () => void;
  update: (dt: number, t: number, cam: THREE.Camera) => void;
  dispose: () => void;
};

export type Core = {
  /** Invisible hit sphere. */
  mesh: THREE.Mesh;
  /** World position of the centre (for effects and the crosshair). */
  at: THREE.Vector3;
  /** 0 hostile and red .. 1 jammed and cold. `hit` is how hard it is being shot this instant (0..1). */
  set: (jam: number, hit: number, t: number) => void;
};

export type Hostage = {
  group: THREE.Group;
  head: THREE.Object3D;
  /** Free him: he stands up and walks to `toZ` at `speed` m/s (call every frame via update). */
  free: (toZ: number) => void;
  /** Tied to the chair again, back at his post (a new run). */
  reset: () => void;
  update: (dt: number, t: number) => void;
  dispose: () => void;
};

export type StageSet = World & {
  id: 'floors' | 'core' | 'roof';
  /** Scene mood for this stage. */
  mood: { fog: string; density: number; bg: string };
  core?: Core;
  hostage?: Hostage;
};

type Ctx = { scene: THREE.Scene; high: boolean; look: Look };

const neonMat = (c: string, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
const flatMat = (c: string, rough = 0.6, metal = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

/** Collects boxes into one merged mesh with per-box colour (HDR neon strips, one draw). */
class Strips {
  private parts: THREE.BufferGeometry[] = [];
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: string, k = 3) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const c = new THREE.Color(col).multiplyScalar(k);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
  }
  build(): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts, false)!;
    this.parts.forEach((g) => g.dispose());
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true }));
  }
}

/** Plain merged boxes (no colour), for walls and trim. */
class Solid {
  private parts: THREE.BufferGeometry[] = [];
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.parts.push(g);
  }
  build(mat: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts, false)!;
    this.parts.forEach((g) => g.dispose());
    return new THREE.Mesh(geo, mat);
  }
}

/** An emissive server-rack face (LED rows), scrolled by the sets to blink. */
function rackCanvas() {
  const R = rng(77);
  return canvas(64, 128, (g) => {
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 128; y += 8) {
      g.fillStyle = '#0d1520';
      g.fillRect(4, y, 56, 6);
      for (let x = 8; x < 58; x += 6) {
        g.fillStyle = R() < 0.5 ? '#27e6ff' : R() < 0.3 ? '#ff3030' : '#0a3a44';
        g.fillRect(x, y + 2, 3, 2);
      }
    }
  });
}

const textPlane = (w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void, k = 1.5) => {
  const W = Math.round(w * 200);
  const H = Math.round(h * 200);
  const t = tex(canvas(W, H, (g) => draw(g, W, H)), { aniso: 4 });
  const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color('#ffffff').multiplyScalar(k), toneMapped: false, transparent: true, depthWrite: false });
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(w, h), m), map: t, mat: m };
};

/** The pane / rack hit-point bookkeeping common to the sets. */
function makePanes(cfg: { n: number; w: number; h: number; place: (i: number) => { x: number; y: number; z: number; ry: number }; color: string; opacity?: number }, disp: { dispose: () => void }[]) {
  const geo = new THREE.PlaneGeometry(cfg.w, cfg.h);
  const mat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.05, metalness: 0.25, transparent: true, opacity: cfg.opacity ?? 0.2, envMapIntensity: 2.6, depthWrite: false, side: THREE.DoubleSide });
  disp.push(geo, mat);
  const windows = new THREE.InstancedMesh(geo, mat, cfg.n);
  const wins: Window[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Vector3(0, 0, 0);
  const put = (i: number, on: boolean) => {
    const p = cfg.place(i);
    q.setFromAxisAngle(up, p.ry);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, on ? one : zero);
    windows.setMatrixAt(i, m);
  };
  for (let i = 0; i < cfg.n; i++) {
    const p = cfg.place(i);
    wins.push({ i, x: p.x, y: p.y, hp: 30, broke: false, lit: 1 });
    put(i, true);
  }
  windows.instanceMatrix.needsUpdate = true;
  windows.frustumCulled = false;
  windows.renderOrder = 3;
  return {
    windows,
    wins,
    breakWindow: (w: Window) => {
      w.broke = true;
      put(w.i, false);
      windows.instanceMatrix.needsUpdate = true;
    },
    rebuild: () => {
      for (const w of wins) {
        w.broke = false;
        w.hp = 30;
        put(w.i, true);
      }
      windows.instanceMatrix.needsUpdate = true;
    },
  };
}

function makeRacks(list: { x: number; z: number; ry?: number }[], size: [number, number, number], disp: { dispose: () => void }[], high: boolean, group: THREE.Group) {
  const cv = rackCanvas();
  const racks: Rack[] = [];
  const mats: THREE.MeshStandardMaterial[] = [];
  const geo = new THREE.BoxGeometry(...size);
  disp.push(geo);
  for (const r of list) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ color: '#141a24', metalness: 0.7, roughness: 0.4, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 2.2 });
    disp.push(t, mat);
    mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(r.x, size[1] / 2, r.z);
    m.rotation.y = r.ry ?? 0;
    m.castShadow = high;
    group.add(m);
    racks.push({ mesh: m, hp: 160, broke: false, t: 0 });
  }
  return {
    racks,
    tick: (t: number) => {
      for (let i = 0; i < mats.length; i++) if (!racks[i].broke) mats[i].emissiveMap!.offset.y = Math.floor(t * 6 + i) * 0.125;
    },
    breakRack: (rk: Rack) => {
      rk.broke = true;
      const mat = rk.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.05;
      mat.color.set('#0a0a0a');
      rk.mesh.rotation.z = (Math.random() - 0.5) * 0.25;
    },
    rebuild: () => {
      for (const rk of racks) {
        rk.broke = false;
        rk.hp = 160;
        const mat = rk.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 2.2;
        mat.color.set('#141a24');
        rk.mesh.rotation.z = 0;
      }
    },
  };
}

const disposeAll = (disp: { dispose: () => void }[], group: THREE.Group, scene: THREE.Scene) => {
  scene.remove(group);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mm) (Array.isArray(mm) ? mm : [mm]).forEach((x) => x.dispose());
  });
  disp.forEach((d) => d.dispose());
};

const inertHit = () => {
  const l = new THREE.PointLight('#ffd27a', 0, 26, 1.6);
  return l;
};

// ═════════════════════════════════════════════════════════════════════════════════════════
// STAGE 2: HQ FLOORS
// ═════════════════════════════════════════════════════════════════════════════════════════

export function buildFloors({ scene, high, look }: Ctx): StageSet {
  const group = new THREE.Group();
  group.visible = false;
  const disp: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => (disp.push(o), o);
  const R = rng(14);
  const LX = 6.5; // corridor half width
  const H = 4.4;
  const ZN = 5; // near end
  const ZF = -62; // far wall
  const BAYS = 6;
  const BAY = 9;

  // lights
  group.add(new THREE.HemisphereLight('#7aa4e0', '#10141c', 0.6));
  const l1 = new THREE.PointLight('#d8ecff', high ? 60 : 45, 30, 1.6);
  l1.position.set(0, H - 0.6, -12);
  const l2 = new THREE.PointLight('#8fe0ff', high ? 60 : 45, 30, 1.6);
  l2.position.set(0, H - 0.6, -30);
  const l3 = new THREE.PointLight('#ff4a3a', high ? 80 : 55, 26, 1.6);
  l3.position.set(0, H - 0.8, -52);
  group.add(l1, l2, l3);
  const hitLight = inertHit();
  group.add(hitLight);

  // floor and ceiling
  const floorMat = track(look.material('large_floor_tiles_02', [13, 30], '#69707f', 0.55));
  floorMat.roughness = 0.28;
  floorMat.envMapIntensity = 1.5;
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(2 * (LX + 8), ZN - ZF + 6)), floorMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, (ZN + ZF) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  const ceilMat = track(look.material('metal_plate_02', [14, 30], '#2b3342', 0.6));
  ceilMat.roughness = 0.5;
  const ceiling = new THREE.Mesh(track(new THREE.PlaneGeometry(2 * (LX + 8), ZN - ZF + 6)), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, (ZN + ZF) / 2);
  group.add(ceiling);

  // walls (lab back walls, partitions, the lift wall) merged into one hit target
  const wallMat = track(look.material('concrete_wall_006', [10, 1.2], '#4a5468', 0.15));
  wallMat.roughness = 0.6;
  const wallsB = new Solid();
  const trimB = new Solid();
  const neon = new Strips();
  for (const s of [-1, 1]) {
    const xa = s * LX;
    const xb = s * (LX + 7);
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    wallsB.box(s > 0 ? xb : xb - 0.3, s > 0 ? xb + 0.3 : xb, 0, H, ZF, ZN); // back wall
    for (let i = 0; i <= BAYS; i++) wallsB.box(lo, hi, 0, H, -4.5 - i * BAY - 0.1, -4.5 - i * BAY + 0.1); // partitions
    trimB.box(s > 0 ? xa : xa - 0.25, s > 0 ? xa + 0.25 : xa, 3.55, H, ZF, ZN); // header band
    trimB.box(s > 0 ? xa : xa - 0.25, s > 0 ? xa + 0.25 : xa, 0, 0.25, ZF, ZN); // sill
    for (let k = 0; k <= BAYS * 3; k++) {
      const z = -4.5 - k * 3;
      trimB.box(xa - 0.09, xa + 0.09, 0, 3.6, z - 0.09, z + 0.09); // mullions
      if (k % 3 === 0) neon.box(s * (LX - 0.12) - 0.04, s * (LX - 0.12) + 0.04, 0.3, 3.5, z - 0.03, z + 0.03, k % 6 === 0 ? '#27e6ff' : '#ff2f92', 2.6);
    }
    for (let i = 0; i < BAYS; i++) {
      const zc = -9 - i * BAY;
      const col = (i + (s > 0 ? 1 : 0)) % 2 ? '#27e6ff' : '#ff2f92';
      neon.box(Math.min(s * (LX + 1), s * (LX + 6)), Math.max(s * (LX + 1), s * (LX + 6)), H - 0.15, H - 0.05, zc - 3.5, zc - 3.3, col, 2.2); // lab ceiling strips
      neon.box(Math.min(s * (LX + 1), s * (LX + 6)), Math.max(s * (LX + 1), s * (LX + 6)), H - 0.15, H - 0.05, zc + 3.3, zc + 3.5, col, 2.2);
    }
  }
  // corridor: floor guide lines, ceiling light panels, the red hazard line before the lift
  for (const x of [-2.4, 2.4]) for (let z = 2; z > ZF + 3; z -= 3) neon.box(x - 0.05, x + 0.05, 0.015, 0.03, z - 0.7, z + 0.7, '#27e6ff', 2.2);
  for (let z = -1; z > ZF + 2; z -= 7) {
    neon.box(-1.6, 1.6, H - 0.06, H - 0.01, z - 1.5, z + 1.5, '#e6f2ff', 1.5);
    neon.box(-4.9, -4.3, H - 0.06, H - 0.01, z - 1.5, z + 1.5, '#9fd8ff', 1.1);
    neon.box(4.3, 4.9, H - 0.06, H - 0.01, z - 1.5, z + 1.5, '#9fd8ff', 1.1);
  }
  for (let i = 0; i < 12; i++) neon.box(-LX + i * (2 * LX / 12), -LX + i * (2 * LX / 12) + 0.8, 0.02, 0.035, ZF + 9, ZF + 9.7, '#ff2a2a', 2.6);
  // the far end is OPEN (owner, 24 Oct: one continuous walk): two wall stubs frame a wide stairwell mouth that
  // opens straight into the server core's shaft beyond
  for (const sx of [-1, 1]) wallsB.box(sx > 0 ? LX : -LX - 7, sx > 0 ? LX + 7 : -LX, 0, H, ZF - 0.4, ZF);
  const wallsMesh = wallsB.build(wallMat)!;
  wallsMesh.receiveShadow = true;
  group.add(wallsMesh);
  const trimMat = track(flatMat('#1a1f2a', 0.45, 0.8));
  group.add(trimB.build(trimMat)!);
  const neonMesh = neon.build()!;
  group.add(neonMesh);

  // glass labs: 3 panes a bay, both sides
  const panes = makePanes(
    {
      n: BAYS * 3 * 2,
      w: 2.84,
      h: 3.3,
      color: '#a8ecff',
      opacity: 0.18,
      place: (i) => {
        const s = i < BAYS * 3 ? -1 : 1;
        const k = i % (BAYS * 3);
        return { x: s * (LX - 0.02), y: 1.9, z: -4.5 - 1.5 - k * 3, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 };
      },
    },
    disp,
  );
  group.add(panes.windows);

  // lab interiors: desks, monitors, chairs, a bench of kit; one draw each
  const deskM: THREE.Matrix4[] = [];
  const monM: THREE.Matrix4[] = [];
  const monC: THREE.Color[] = [];
  const chairM: THREE.Matrix4[] = [];
  const bench: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const M = (x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, ry), new THREE.Vector3(sx, sy, sz));
  const MC = ['#27e6ff', '#7cffb0', '#ff9a3a', '#ff2f92', '#8fb8ff'];
  for (const s of [-1, 1])
    for (let i = 0; i < BAYS; i++) {
      const zc = -9 - i * BAY;
      for (let d = 0; d < 3; d++) {
        const z = zc + (d - 1) * 2.6;
        const x = s * (LX + 2.4 + (d % 2) * 1.2);
        deskM.push(M(x, 0.375, z, s > 0 ? Math.PI / 2 : -Math.PI / 2));
        monM.push(M(x - s * 0.1, 1.05, z, s > 0 ? -Math.PI / 2 : Math.PI / 2));
        monC.push(new THREE.Color(MC[Math.floor(R() * MC.length)]).multiplyScalar(1.4));
        chairM.push(M(x - s * 1.1, 0.3, z + (R() - 0.5) * 0.4, R() * 6));
      }
      bench.push(M(s * (LX + 6.3), 0.55, zc, 0, 1, 1, 1));
    }
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, ms: THREE.Matrix4[], cs?: THREE.Color[]) => {
    const im = new THREE.InstancedMesh(track(geo), track(mat), ms.length);
    ms.forEach((m, i) => im.setMatrixAt(i, m));
    cs?.forEach((c, i) => im.setColorAt(i, c));
    im.frustumCulled = false;
    group.add(im);
    return im;
  };
  inst(new THREE.BoxGeometry(1.7, 0.75, 0.8), flatMat('#d7dbe4', 0.4, 0.3), deskM);
  inst(new THREE.PlaneGeometry(0.8, 0.46), neonMat('#ffffff', 1), monM, monC);
  inst(new THREE.CylinderGeometry(0.26, 0.2, 0.6, 8), flatMat('#232a36', 0.7, 0.3), chairM);
  inst(new THREE.BoxGeometry(0.9, 1.1, 5.4), flatMat('#313a4a', 0.5, 0.6), bench);
  // the lab wall screens: a big display on each back wall, per bay
  const screens: THREE.Matrix4[] = [];
  const screenC: THREE.Color[] = [];
  for (const s of [-1, 1])
    for (let i = 0; i < BAYS; i++) {
      screens.push(M(s * (LX + 6.82), 2.3, -9 - i * BAY, s > 0 ? -Math.PI / 2 : Math.PI / 2));
      screenC.push(new THREE.Color(MC[(i * 2 + (s > 0 ? 1 : 0)) % MC.length]).multiplyScalar(1.1));
    }
  inst(new THREE.PlaneGeometry(6.2, 1.9), neonMat('#ffffff', 1), screens, screenC);

  // signs over the lab doors (deadpan satire, katakana underneath)
  const SIGNS_TXT: [string, string, string][] = [
    ['SOUL CHAIN R&D', 'ソウルチェーン研究', '#27e6ff'],
    ['PEER REVIEW IN PROGRESS', '査読中', '#ffb21a'],
    ['PATENT PENDING: YOUR SOUL', 'あなたの魂に特許を', '#ff4a3a'],
    ['OPEN SOURCE (BSV ONLY)', 'BSVなら自由', '#7cffb0'],
    ['EST. 2009', '二〇〇九年創業', '#ff2f92'],
    ['LIFT 02', '昇降機', '#27e6ff'],
  ];
  for (const s of [-1, 1])
    for (let i = 0; i < BAYS; i++) {
      const [en, jp, c] = SIGNS_TXT[(i + (s > 0 ? 3 : 0)) % SIGNS_TXT.length];
      const sp = textPlane(4.6, 0.62, (g, W, Hh) => {
        g.fillStyle = 'rgba(4,8,14,0.9)';
        g.fillRect(0, 0, W, Hh);
        g.strokeStyle = c;
        g.lineWidth = 4;
        g.strokeRect(3, 3, W - 6, Hh - 6);
        g.fillStyle = c;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 ${Hh * 0.34}px Arial, sans-serif`;
        g.fillText(en, W / 2, Hh * 0.36);
        g.font = `700 ${Hh * 0.26}px ${JP}`;
        g.fillText(jp, W / 2, Hh * 0.74);
      });
      disp.push(sp.map, sp.mat, sp.mesh.geometry);
      sp.mesh.position.set(s * (LX - 0.3), 3.98, -9 - i * BAY);
      sp.mesh.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(sp.mesh);
    }

  // the lift at the far end, flanked by the logo and the eye
  {
    const logo = textPlane(5.2, 1.5, (g, W, Hh) => {
      g.fillStyle = '#05080e';
      g.fillRect(0, 0, W, Hh);
      g.font = `900 ${Hh * 0.36}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#eef3fb';
      g.fillText('nSLAVE', W / 2, Hh * 0.38);
      g.fillStyle = '#ff4a3a';
      g.font = `700 ${Hh * 0.17}px Arial, sans-serif`;
      g.fillText('H E A D Q U A R T E R S', W / 2, Hh * 0.72);
      g.fillStyle = '#ff9a8a';
      g.font = `700 ${Hh * 0.13}px ${JP}`;
      g.fillText('エヌスレイブ本社', W / 2, Hh * 0.9);
    });
    logo.mesh.position.set(-4.4, 2.5, ZF + 0.03);
    const eye = textPlane(3.2, 1.5, (g, W, Hh) => {
      g.fillStyle = '#18040a';
      g.fillRect(0, 0, W, Hh);
      g.strokeStyle = '#ff3226';
      g.lineWidth = 8;
      g.beginPath();
      g.ellipse(W / 2, Hh / 2, W * 0.36, Hh * 0.3, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#ff3a2a';
      g.beginPath();
      g.arc(W / 2, Hh / 2, Hh * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#000';
      g.fillRect(W / 2 - 4, Hh * 0.26, 8, Hh * 0.48);
    });
    eye.mesh.position.set(4.4, 2.5, ZF + 0.03);
    disp.push(logo.map, logo.mat, logo.mesh.geometry, eye.map, eye.mat, eye.mesh.geometry);
    group.add(logo.mesh, eye.mesh);
    // the lift doors are gone: the corridor runs on into the core
    const frame = new Strips();
    frame.box(-LX - 0.1, -LX + 0.1, 0, H, ZF - 0.5, ZF + 0.16, '#ff2a2a', 3);
    frame.box(LX - 0.1, LX + 0.1, 0, H, ZF - 0.5, ZF + 0.16, '#ff2a2a', 3);
    group.add(frame.build()!);
  }

  // the shootables: server racks along the corridor
  const rackList: { x: number; z: number; ry?: number }[] = [];
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) rackList.push({ x: s * 5.4, z: -15 - i * 9.5 - (s > 0 ? 4 : 0) });
  const racks = makeRacks(rackList, [1.5, 3.0, 1.0], disp, high, group);

  // ceiling pipes and cable runs
  {
    const pg = track(new THREE.CylinderGeometry(0.14, 0.14, ZN - ZF, 8));
    pg.rotateX(Math.PI / 2);
    for (const x of [-3.4, 3.1]) {
      const p = new THREE.Mesh(pg, track(flatMat('#202734', 0.5, 0.85)));
      p.position.set(x, H - 0.4, (ZN + ZF) / 2);
      group.add(p);
    }
  }
  // volumetric haze in the corridor and an alarm beam from the lift
  const sh = makeShared(new THREE.FogExp2('#0a1018', 0.02));
  const haze = new THREE.Mesh(track(new THREE.PlaneGeometry(2 * LX, H)), track(mistMaterial(sh, '#2a5a78', 0.18)));
  haze.position.set(0, H / 2, -24);
  haze.userData.noAO = true;
  group.add(haze);
  const alarm = new THREE.Mesh(track(new THREE.CylinderGeometry(3.2, 0.3, 6, 16, 1, true)), track(beamMaterial('#ff2a2a', 0.18, 0.9, true, sh)));
  alarm.position.set(0, H - 3, ZF + 3);
  alarm.userData.noAO = true;
  group.add(alarm);
  const alarmGlow = halo('#ff2a1a', 2.2, 0.5);
  alarmGlow.position.set(0, H - 0.3, ZF + 1.2);
  group.add(alarmGlow);

  scene.add(group);
  const solids = [wallsMesh];
  return {
    id: 'floors',
    mood: { fog: '#0a1018', density: 0.018, bg: '#04070d' },
    group,
    windows: panes.windows,
    wins: panes.wins,
    racks: racks.racks,
    solids,
    ground,
    hitLight,
    breakWindow: panes.breakWindow,
    breakRack: racks.breakRack,
    rebuild: () => {
      panes.rebuild();
      racks.rebuild();
    },
    update: (dt, t) => {
      sh.uT.value = t;
      racks.tick(t);
      l3.intensity = (high ? 80 : 55) * (0.55 + 0.45 * Math.max(0, Math.sin(t * 3.2)));
      alarmGlow.material.opacity = 0.1 + 0.4 * Math.max(0, Math.sin(t * 3.2));
      l1.intensity = (high ? 60 : 45) * (Math.sin(t * 17) > 0.97 ? 0.4 : 1);
      hitLight.intensity *= Math.pow(0.002, dt);
    },
    dispose: () => disposeAll(disp, group, scene),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// STAGE 3: SERVER CORE
// ═════════════════════════════════════════════════════════════════════════════════════════

export const CORE_AT = new THREE.Vector3(0, 7, -22);
/** Half-angle of the opening in the core shaft's far wall (radians). */
export const SHAFT_GAP = 0.4;

export function buildCore({ scene, high, look }: Ctx): StageSet {
  const group = new THREE.Group();
  group.visible = false;
  const disp: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => (disp.push(o), o);
  const R = rng(31);
  const CZ = CORE_AT.z; // shaft centre
  const RAD = 26;
  const TOP = 70;

  group.add(new THREE.HemisphereLight('#5a78c0', '#0a0c18', 0.55));
  const coreLight = new THREE.PointLight('#ff2a1a', high ? 420 : 300, 70, 1.4);
  coreLight.position.copy(CORE_AT);
  group.add(coreLight);
  const lowLight = new THREE.PointLight('#27c8e0', high ? 90 : 60, 34, 1.6);
  lowLight.position.set(0, 1.2, -6);
  group.add(lowLight);
  const hitLight = inertHit();
  group.add(hitLight);
  const sh = makeShared(new THREE.FogExp2('#080c1a', 0.012));

  // shaft wall: a dark panelled cylinder with a glowing grid
  const wallTex = track(
    tex(
      canvas(512, 512, (g) => {
        g.fillStyle = '#0a0f1a';
        g.fillRect(0, 0, 512, 512);
        g.strokeStyle = '#1b2a44';
        g.lineWidth = 2;
        for (let i = 0; i <= 8; i++) {
          g.beginPath();
          g.moveTo(i * 64, 0);
          g.lineTo(i * 64, 512);
          g.stroke();
          g.beginPath();
          g.moveTo(0, i * 64);
          g.lineTo(512, i * 64);
          g.stroke();
        }
        g.fillStyle = '#14304a';
        for (let i = 0; i < 40; i++) g.fillRect(Math.floor(R() * 8) * 64 + 8, Math.floor(R() * 8) * 64 + 8, 48, 48);
      }),
      { repeat: true },
    ),
  );
  wallTex.repeat.set(10, 4);
  const wallMat = track(new THREE.MeshStandardMaterial({ map: wallTex, emissiveMap: wallTex, emissive: '#2a6a9a', emissiveIntensity: 0.55, roughness: 0.6, metalness: 0.6, side: THREE.BackSide }));
  // the shaft wall has a tall opening on the far (-Z) side: the walk carries on out onto the roof
  const GAP = SHAFT_GAP;
  const shaft = new THREE.Mesh(track(new THREE.CylinderGeometry(RAD, RAD, TOP, 48, 1, true, Math.PI + GAP, Math.PI * 2 - GAP * 2)), wallMat);
  shaft.position.set(0, TOP / 2 - 2, CZ);
  group.add(shaft);

  // floor: a metal disc with a glowing grid, and neon rings around the pedestal
  const floorMat = track(look.material('metal_plate_02', [10, 10], '#4a5262', 0.55));
  // brushed, not mirror: under sustained fire a glossy floor turned the muzzle and core light into a white sheet
  floorMat.roughness = 0.62;
  floorMat.envMapIntensity = 0.7;
  const ground = new THREE.Mesh(track(new THREE.CircleGeometry(RAD, 64)), floorMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, CZ);
  ground.receiveShadow = true;
  group.add(ground);
  const ringTube = (r: number, y: number, col: string, k: number, tube = 0.07) => {
    const g = track(new THREE.TorusGeometry(r, tube, 6, 96));
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, track(neonMat(col, k)));
    m.position.set(0, y, CZ);
    group.add(m);
    return m;
  };
  ringTube(6, 0.04, '#27e6ff', 2.6);
  ringTube(11, 0.04, '#ff2f92', 2.2);
  ringTube(RAD - 1.2, 0.04, '#27e6ff', 2.2);
  for (let i = 0; i < 7; i++) ringTube(RAD - 0.4, 6.3 + i * 6.5, i % 2 ? '#ff2f92' : '#27e6ff', 2.2, 0.09);

  // racks around the wall: tiers of glowing cabinets (one instanced draw)
  const rackCv = rackCanvas();
  const rackTex = track(new THREE.CanvasTexture(rackCv));
  rackTex.colorSpace = THREE.SRGBColorSpace;
  rackTex.wrapS = rackTex.wrapT = THREE.RepeatWrapping;
  const rackMat = track(new THREE.MeshStandardMaterial({ color: '#141a24', metalness: 0.7, roughness: 0.4, emissive: '#ffffff', emissiveMap: rackTex, emissiveIntensity: 2.0 }));
  const rackGeo = track(new THREE.BoxGeometry(2.3, 5.4, 1.1));
  const wallRacks: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let tier = 0; tier < 7; tier++) {
    const y = 3.2 + tier * 6.5;
    for (let a = -125; a <= 125; a += 6.6) {
      const ang = (a * Math.PI) / 180;
      if (Math.abs(ang) < SHAFT_GAP + 0.06) continue; // keep the exit clear
      const x = Math.sin(ang) * (RAD - 1.1);
      const z = CZ - Math.cos(ang) * (RAD - 1.1);
      q.setFromAxisAngle(up, -ang);
      wallRacks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    }
  }
  const wr = new THREE.InstancedMesh(rackGeo, rackMat, wallRacks.length);
  wallRacks.forEach((m, i) => wr.setMatrixAt(i, m));
  wr.frustumCulled = false;
  group.add(wr);

  // the core: a cage of rings round a pulsing heart, hung from a column of light
  const coreG = new THREE.Group();
  coreG.position.copy(CORE_AT);
  group.add(coreG);
  const heartMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a2a').multiplyScalar(2.4), toneMapped: false }));
  const heart = new THREE.Mesh(track(new THREE.IcosahedronGeometry(2.1, 3)), heartMat);
  coreG.add(heart);
  const shellMat = track(new THREE.MeshStandardMaterial({ color: '#1a1f2c', metalness: 0.9, roughness: 0.2, transparent: true, opacity: 0.35, envMapIntensity: 2 }));
  const shell = new THREE.Mesh(track(new THREE.IcosahedronGeometry(3.0, 1)), shellMat);
  shell.material.wireframe = false;
  coreG.add(shell);
  const rings: THREE.Mesh[] = [];
  const ringMats: THREE.MeshBasicMaterial[] = [];
  for (const [r, tilt, spd] of [[4.2, 0.4, 0.8], [5.4, -0.9, -0.6], [6.6, 1.3, 0.45]] as [number, number, number][]) {
    const m = track(neonMat('#ff4a3a', 2.4));
    ringMats.push(m);
    const g = track(new THREE.TorusGeometry(r, 0.1, 8, 96));
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = tilt;
    mesh.userData.spd = spd;
    coreG.add(mesh);
    rings.push(mesh);
  }
  const coreHalo = halo('#ff2a1a', 18, 0.5);
  coreG.add(coreHalo);
  const colG = track(new THREE.CylinderGeometry(0.35, 0.35, TOP, 10, 1, true));
  const colMat = track(neonMat('#ff4a3a', 1.4));
  const col = new THREE.Mesh(colG, colMat);
  col.position.set(0, TOP / 2 - CORE_AT.y, 0);
  coreG.add(col);
  const pedestal = new THREE.Mesh(track(new THREE.CylinderGeometry(1.7, 2.3, 0.8, 24)), track(flatMat('#1d2434', 0.3, 0.9)));
  pedestal.position.set(CORE_AT.x, 0.4, CZ);
  group.add(pedestal);
  // the hit sphere (invisible), generous so a sweep of the stream lands
  const hitMesh = new THREE.Mesh(track(new THREE.SphereGeometry(4.2, 16, 12)), track(new THREE.MeshBasicMaterial({ visible: false })));
  hitMesh.position.copy(CORE_AT);
  group.add(hitMesh);

  // light shafts, and data rising up the shaft
  const bm = track(beamMaterial('#4da3ff', 0.22, 0.7, true, sh));
  const bg = track(new THREE.CylinderGeometry(3.4, 0.6, 52, 20, 1, true));
  for (const [x, z] of [[-14, -4], [14, -6], [-9, -34], [10, -36]] as [number, number][]) {
    const b = new THREE.Mesh(bg, bm);
    b.position.set(x, 26, z);
    b.userData.noAO = true;
    group.add(b);
  }
  const NP = high ? 700 : 280;
  const pp = new Float32Array(NP * 3);
  for (let i = 0; i < NP; i++) pp.set([(R() - 0.5) * 2 * (RAD - 4), R() * TOP, CZ + (R() - 0.5) * 2 * (RAD - 4)], i * 3);
  const pg = track(new THREE.BufferGeometry());
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  const pts = new THREE.Points(pg, track(new THREE.PointsMaterial({ map: softGlow(), color: new THREE.Color('#7cd8ff').multiplyScalar(1.6), size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true })));
  pts.frustumCulled = false;
  pts.userData.noAO = true;
  group.add(pts);
  const catwalk = new Strips();
  // the platform the player stands on: rails left and right, and a grated edge
  for (const s of [-1, 1]) catwalk.box(s * 4.2 - 0.04, s * 4.2 + 0.04, 0, 1.05, -2, 2, '#27e6ff', 1.4);
  group.add(catwalk.build()!);
  const rail = new THREE.Mesh(track(new THREE.BoxGeometry(8.5, 0.07, 0.07)), track(neonMat('#27e6ff', 2)));
  rail.position.set(0, 1.05, -2.2);
  group.add(rail);
  const edge = new THREE.Mesh(track(new THREE.BoxGeometry(8.4, 1.0, 0.06)), track(new THREE.MeshBasicMaterial({ color: '#00131c', transparent: true, opacity: 0.4, depthWrite: false })));
  edge.position.set(0, 0.5, -2.2);
  group.add(edge);

  // the shootables: a few cabinets on the floor, left and right
  const racks = makeRacks(
    [-8, -13, -18, -24].flatMap((z) => [{ x: -9.5 - (z % 4), z }, { x: 9.5 + (z % 4), z: z - 2 }]),
    [1.6, 3.2, 1.0],
    disp,
    high,
    group,
  );
  // no glass in the shaft: an inert pane set so the engine's code path stays uniform
  const panes = makePanes({ n: 1, w: 0.1, h: 0.1, place: () => ({ x: 0, y: -50, z: 0, ry: 0 }), color: '#000000' }, disp);
  panes.windows.visible = false;
  group.add(panes.windows);

  const solids: THREE.Mesh[] = [shaft];
  scene.add(group);

  const cLow = new THREE.Color('#ff3a2a');
  const cHigh = new THREE.Color('#27e6ff');
  const tmpC = new THREE.Color();
  const core: Core = {
    mesh: hitMesh,
    at: CORE_AT,
    set: (jam, hit, t) => {
      const k = THREE.MathUtils.clamp(jam, 0, 1);
      tmpC.copy(cLow).lerp(cHigh, k);
      heartMat.color.copy(tmpC).multiplyScalar(1.1 + hit * 0.9 + (k > 0.99 ? 1.5 : 0) + Math.sin(t * (6 - k * 4)) * 0.2);
      colMat.color.copy(tmpC).multiplyScalar(1.2);
      for (const m of ringMats) m.color.copy(tmpC).multiplyScalar(1.3 + hit * 0.7);
      coreLight.color.copy(tmpC);
      coreLight.intensity = (high ? 420 : 300) * (0.8 + hit * 0.8 + (k > 0.99 ? 1.5 : 0)) * (0.9 + Math.sin(t * (9 - k * 6)) * 0.1);
      coreHalo.material.color.copy(tmpC);
      coreHalo.material.opacity = 0.22 + hit * 0.25;
      const j = hit * 0.06 * (1 - k * 0.5);
      heart.scale.setScalar(1 + Math.sin(t * (7 - k * 4)) * 0.05 + j + (R() - 0.5) * hit * 0.04);
      rings.forEach((r, i) => {
        const spd = (r.userData.spd as number) * (1.2 - k * 0.95 + hit * 0.8);
        r.rotation.y += spd * 0.016;
        r.rotation.z += spd * 0.01 * (i + 1);
      });
    },
  };
  core.set(0, 0, 0);

  return {
    id: 'core',
    mood: { fog: '#080c1a', density: 0.012, bg: '#03050c' },
    group,
    windows: panes.windows,
    wins: panes.wins,
    racks: racks.racks,
    solids,
    ground,
    hitLight,
    core,
    breakWindow: panes.breakWindow,
    breakRack: racks.breakRack,
    rebuild: () => {
      panes.rebuild();
      racks.rebuild();
    },
    update: (dt, t) => {
      sh.uT.value = t;
      rackTex.offset.y = Math.floor(t * 4) * 0.125;
      racks.tick(t);
      const a = pg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < NP; i++) {
        let y = a.getY(i) + dt * (3 + (i % 5));
        if (y > TOP) y -= TOP;
        a.setY(i, y);
      }
      a.needsUpdate = true;
      hitLight.intensity *= Math.pow(0.002, dt);
    },
    dispose: () => disposeAll(disp, group, scene),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// Dr Kweg S Wong, tied to a chair (and then free). Built from primitives; chibi-friendly, readable at 40 m.
// ═════════════════════════════════════════════════════════════════════════════════════════

export function buildHostage(): Hostage {
  const group = new THREE.Group();
  const disp: { dispose: () => void }[] = [];
  const mat = (c: string, r = 0.7, m = 0.05, e?: string) => {
    const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, emissive: e ?? '#000000', emissiveIntensity: e ? 0.5 : 0 });
    disp.push(x);
    return x;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T) => (disp.push(g), g);
  const body = new THREE.Group();
  group.add(body);
  const skin = mat('#e4bd98');
  const coat = mat('#e8ecf2', 0.8);
  const vest = mat('#8f5b3b', 0.95);
  const red = mat('#d41a1a', 0.5, 0.05, '#ff1a1a');
  const dark = mat('#101216', 0.5, 0.3);
  // legs and shoes
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.075, 0.45, 4, 8)), mat('#2a2f3a'));
    leg.position.set(s * 0.12, 0.34, 0.05);
    body.add(leg);
    const shoe = new THREE.Mesh(geo(new THREE.BoxGeometry(0.13, 0.08, 0.26)), dark);
    shoe.position.set(s * 0.12, 0.05, 0.1);
    body.add(shoe);
  }
  // torso: coat, knitted vest, bow tie
  const torso = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.2, 0.42, 6, 14)), coat);
  torso.position.y = 0.95;
  body.add(torso);
  const vestM = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.205, 0.3, 6, 14)), vest);
  vestM.scale.set(1.0, 1, 0.55);
  vestM.position.set(0, 0.93, 0.1);
  body.add(vestM);
  for (const s of [-1, 1]) {
    const bow = new THREE.Mesh(geo(new THREE.ConeGeometry(0.07, 0.12, 8)), red);
    bow.rotation.z = (s * Math.PI) / 2;
    bow.position.set(s * 0.06, 1.25, 0.2);
    body.add(bow);
  }
  // head: spectacles, the striped engineer's cap
  const head = new THREE.Group();
  head.position.y = 1.5;
  body.add(head);
  const skull = new THREE.Mesh(geo(new THREE.SphereGeometry(0.19, 20, 16)), skin);
  skull.scale.set(1, 1.08, 1);
  head.add(skull);
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(geo(new THREE.TorusGeometry(0.058, 0.01, 6, 20)), dark);
    lens.position.set(s * 0.075, 0.02, 0.175);
    head.add(lens);
    const eye = new THREE.Mesh(geo(new THREE.SphereGeometry(0.014, 8, 6)), dark);
    eye.position.set(s * 0.075, 0.02, 0.18);
    head.add(eye);
  }
  const bridge = new THREE.Mesh(geo(new THREE.BoxGeometry(0.05, 0.01, 0.01)), dark);
  bridge.position.set(0, 0.03, 0.18);
  head.add(bridge);
  const capTex = tex(
    canvas(128, 64, (g) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#f2f2f2' : '#1a3a8a';
        g.fillRect(i * 16, 0, 16, 64);
      }
    }),
    { repeat: true },
  );
  disp.push(capTex);
  const cap = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.17, 0.2, 0.13, 20)), new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.8 }));
  cap.position.y = 0.2;
  head.add(cap);
  const visor = new THREE.Mesh(geo(new THREE.BoxGeometry(0.2, 0.015, 0.12)), mat('#1a3a8a'));
  visor.position.set(0, 0.15, 0.2);
  head.add(visor);
  // arms (behind his back while he is tied, out front when free)
  const arms: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.055, 0.4, 4, 8)), coat);
    arm.position.set(s * 0.26, 0.98, -0.05);
    arm.rotation.z = s * 0.15;
    body.add(arm);
    arms.push(arm);
  }
  // the chair and the ropes
  const chair = new THREE.Group();
  const cm = mat('#2a2f3a', 0.5, 0.6);
  const seat = new THREE.Mesh(geo(new THREE.BoxGeometry(0.6, 0.06, 0.55)), cm);
  seat.position.set(0, 0.5, -0.02);
  const back = new THREE.Mesh(geo(new THREE.BoxGeometry(0.6, 0.8, 0.05)), cm);
  back.position.set(0, 0.9, -0.28);
  chair.add(seat, back);
  for (const [x, z] of [[-0.26, -0.24], [0.26, -0.24], [-0.26, 0.2], [0.26, 0.2]]) {
    const l = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6)), cm);
    l.position.set(x, 0.25, z);
    chair.add(l);
  }
  const ropeMat = mat('#c8b070', 0.9, 0, '#7a6030');
  const rope = new THREE.Group();
  for (const y of [0.82, 1.02]) {
    const r = new THREE.Mesh(geo(new THREE.TorusGeometry(0.215, 0.018, 6, 22)), ropeMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(0, y, 0);
    r.scale.set(1, 1, 0.8);
    rope.add(r);
  }
  group.add(chair, rope);
  // a pool of light on him, so he reads from the other end of the roof
  const spot = new THREE.PointLight('#fff0cf', 40, 12, 1.6);
  spot.position.set(0, 3.2, 1.2);
  group.add(spot);
  const glow = halo('#ffd27a', 2.6, 0.22);
  glow.position.set(0, 1.2, 0.4);
  group.add(glow);

  let state: 'tied' | 'standing' | 'walking' | 'there' = 'tied';
  let toZ = 0;
  let stand = 0;
  return {
    group,
    head,
    free: (z) => {
      if (state !== 'tied') return;
      state = 'standing';
      toZ = z;
      stand = 0;
      rope.visible = false;
    },
    reset: () => {
      state = 'tied';
      group.position.z = -55;
      chair.visible = true;
      chair.position.z = 0;
      rope.visible = true;
      body.position.y = 0;
      head.rotation.set(0.12, 0, 0);
    },
    update: (dt, t) => {
      if (state === 'tied') {
        head.rotation.z = Math.sin(t * 0.7) * 0.05;
        head.rotation.x = 0.12 + Math.sin(t * 0.5) * 0.03;
        body.position.y = 0.0;
        arms.forEach((a, i) => (a.position.set((i ? 1 : -1) * 0.26, 0.98, -0.1), (a.rotation.x = -0.2)));
        return;
      }
      if (state === 'standing') {
        stand = Math.min(1, stand + dt * 0.9);
        chair.position.z = -stand * 0.0;
        head.rotation.x = 0.12 * (1 - stand);
        head.rotation.y = Math.sin(stand * 3) * 0.15;
        if (stand >= 1) {
          state = 'walking';
          chair.visible = false;
        }
        return;
      }
      if (state === 'walking') {
        const dz = toZ - group.position.z;
        const step = Math.min(Math.abs(dz), dt * 2.1) * Math.sign(dz);
        group.position.z += step;
        body.position.y = Math.abs(Math.sin(t * 9)) * 0.03;
        head.rotation.z = Math.sin(t * 4.5) * 0.04;
        arms.forEach((a, i) => (a.position.set((i ? 1 : -1) * 0.26, 0.98, 0.05), (a.rotation.x = Math.sin(t * 4.5 + i * Math.PI) * 0.6)));
        if (Math.abs(toZ - group.position.z) < 0.02) state = 'there';
        return;
      }
      body.position.y = 0;
      head.rotation.x = 0;
      head.rotation.y = Math.sin(t * 0.8) * 0.2;
    },
    dispose: () => disp.forEach((d) => d.dispose()),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// STAGE 4: ROOFTOP
// ═════════════════════════════════════════════════════════════════════════════════════════

export function buildRoof({ scene, high, look }: Ctx): StageSet {
  const group = new THREE.Group();
  group.visible = false;
  const disp: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => (disp.push(o), o);
  const R = rng(48);
  const HW = 24; // half width
  const ZN = 8;
  const ZF = -66;
  const fog = new THREE.FogExp2('#0a1626', 0.0085);
  const sh = makeShared(fog);

  group.add(new THREE.HemisphereLight('#4f78b8', '#150a14', 0.5));
  const moon = new THREE.DirectionalLight('#78a8ff', 0.8);
  moon.position.set(-30, 50, 20);
  moon.target.position.set(0, 0, -30);
  group.add(moon, moon.target);
  const redWash = new THREE.PointLight('#ff2418', high ? 260 : 180, 70, 1.5);
  redWash.position.set(0, 14, ZF + 6);
  group.add(redWash);
  const padLight = new THREE.PointLight('#27c8e0', high ? 120 : 80, 40, 1.6);
  padLight.position.set(0, 3, -30);
  group.add(padLight);
  const hitLight = inertHit();
  group.add(hitLight);

  // sky: storm cloud lit from below, stars, the tower's red glow
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uT: sh.uT },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: /* glsl */ `
        varying vec3 vP; uniform float uT;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vP);
          float y = d.y;
          vec3 c = mix(vec3(0.10,0.04,0.12), vec3(0.02,0.05,0.12), smoothstep(-0.2,0.35,y));
          c = mix(c, vec3(0.006,0.01,0.03), smoothstep(0.25,0.9,y));
          vec2 cp = vec2(atan(d.x,d.z)*1.8 + uT*0.01, y*3.0);
          float cl = fbm(cp*2.2);
          c += vec3(0.20,0.07,0.22) * cl * smoothstep(-0.1,0.3,y) * (1.0-smoothstep(0.3,0.9,y)) * 0.7;
          vec2 g = floor(vec2(atan(d.x,d.z)*80.0, y*120.0));
          float s = step(0.997, h21(g)) * smoothstep(0.2,0.6,y) * (1.0 - cl);
          c += vec3(s) * (0.6 + 0.4*sin(uT*2.0 + h21(g)*30.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(400, 32, 20)), skyMat);
  sky.renderOrder = -10;
  sky.userData.noAO = true;
  group.add(sky);

  // the deck: wet concrete with a painted helipad and tram-lines
  const deckMat = track(look.material('concrete_floor_02', [16, 22], '#2c313c', 0.25));
  deckMat.roughness = 0.3;
  deckMat.envMapIntensity = 1.6;
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(HW * 2, ZN - ZF)), deckMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, (ZN + ZF) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  const padTex = track(
    tex(
      canvas(512, 512, (g) => {
        g.clearRect(0, 0, 512, 512);
        g.strokeStyle = '#ffb21a';
        g.lineWidth = 14;
        g.beginPath();
        g.arc(256, 256, 236, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 6;
        g.beginPath();
        g.arc(256, 256, 214, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#ffb21a';
        g.font = '900 280px Impact, "Arial Black", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('H', 256, 270);
      }),
    ),
  );
  const pad = new THREE.Mesh(track(new THREE.PlaneGeometry(22, 22)), track(new THREE.MeshStandardMaterial({ map: padTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, emissive: '#ffb21a', emissiveMap: padTex, emissiveIntensity: 0.35 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.02, -30);
  group.add(pad);

  // parapets with neon, plant, vents and the antenna farm
  const solid = new Solid();
  const neon = new Strips();
  const PH = 1.15;
  solid.box(-HW - 0.5, -HW, 0, PH, ZF, ZN);
  solid.box(HW, HW + 0.5, 0, PH, ZF, ZN);
  solid.box(-HW - 0.5, HW + 0.5, 0, PH + 0.5, ZF - 0.6, ZF); // the far wall is higher
  neon.box(-HW - 0.05, -HW + 0.05, PH, PH + 0.08, ZF, ZN, '#27e6ff', 2.6);
  neon.box(HW - 0.05, HW + 0.05, PH, PH + 0.08, ZF, ZN, '#ff2f92', 2.6);
  neon.box(-HW, HW, PH + 0.5, PH + 0.58, ZF - 0.04, ZF + 0.02, '#ff2a2a', 2.8);
  for (let z = ZN - 2; z > ZF + 2; z -= 6) {
    neon.box(-HW + 0.02, -HW + 0.12, 0.02, 0.08, z - 0.4, z + 0.4, '#27e6ff', 2);
    neon.box(HW - 0.12, HW - 0.02, 0.02, 0.08, z - 0.4, z + 0.4, '#ff2f92', 2);
  }
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    const x = Math.cos(ang) * 10.4;
    const z = -30 + Math.sin(ang) * 10.4;
    neon.box(x - 0.15, x + 0.15, 0.02, 0.1, z - 0.15, z + 0.15, '#ffb21a', 3);
  }
  const hvac: { x: number; z: number; w: number; d: number; h: number }[] = [
    { x: -18, z: -12, w: 5, d: 3.5, h: 2.2 },
    { x: -19, z: -42, w: 4, d: 6, h: 2.8 },
    { x: 18.5, z: -16, w: 4.5, d: 4, h: 2.4 },
    { x: 19, z: -48, w: 5, d: 5, h: 3 },
    { x: -12, z: -60, w: 6, d: 3, h: 2 },
    { x: 11, z: -61, w: 5, d: 3, h: 2.6 },
  ];
  for (const b of hvac) {
    solid.box(b.x - b.w / 2, b.x + b.w / 2, 0, b.h, b.z - b.d / 2, b.z + b.d / 2);
    neon.box(b.x - b.w / 2, b.x + b.w / 2, b.h - 0.1, b.h, b.z + b.d / 2, b.z + b.d / 2 + 0.03, '#ff9a3a', 1.6);
  }
  const roofSolid = solid.build(track(flatMat('#232833', 0.7, 0.3)))!;
  roofSolid.castShadow = high;
  roofSolid.receiveShadow = true;
  group.add(roofSolid);
  group.add(neon.build()!);

  // the TERRORNODE sign, standing along the far wall
  {
    const sign = textPlane(40, 8, (g, W, Hh) => {
      g.clearRect(0, 0, W, Hh);
      g.font = `900 ${Hh * 0.62}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#ff2a1a';
      g.shadowBlur = 40;
      g.fillStyle = '#ffe9e6';
      g.fillText('TERRORNODE', W / 2, Hh * 0.45);
      g.shadowBlur = 0;
      g.fillStyle = '#ff5646';
      g.font = `700 ${Hh * 0.17}px ${JP}`;
      g.fillText('nSLAVE · テラーノード', W / 2, Hh * 0.9);
    }, 1.7);
    disp.push(sign.map, sign.mat, sign.mesh.geometry);
    sign.mesh.position.set(0, PH + 6.2, ZF - 0.4);
    sign.mesh.userData.noAO = true;
    group.add(sign.mesh);
  }
  // mast with the beacon, and the dish
  {
    const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.12, 0.25, 34, 8)), track(flatMat('#15171d', 0.5, 0.9)));
    mast.position.set(-21, 17, -54);
    group.add(mast);
    const beacon = halo('#ff2020', 6, 0.9);
    beacon.position.set(-21, 34.5, -54);
    group.add(beacon);
    (group.userData as { beacon?: THREE.Sprite }).beacon = beacon;
    const dish = new THREE.Mesh(track(new THREE.SphereGeometry(2.4, 18, 10, 0, Math.PI * 2, 0, 0.9)), track(flatMat('#8a94a6', 0.4, 0.8)));
    dish.position.set(20, 3.2, -56);
    dish.rotation.set(-1.0, 0.5, 0);
    group.add(dish);
  }
  // skyline far below: the city's skyline cards, set low and far
  const S = high ? 1 : 0.5;
  for (const [z, y, tone, haze, dens, k, seed] of [
    [-150, -70, '#0b0e1e', 'rgba(60,40,90,0.5)', 0.16, 1.0, 1],
    [-230, -80, '#0e1a30', 'rgba(50,60,110,0.7)', 0.12, 1.5, 2],
    [-330, -90, '#142a45', 'rgba(70,80,130,0.8)', 0.09, 2.0, 3],
  ] as [number, number, string, string, number, number, number][]) {
    const t = track(skylineTex(seed * 17, tone, haze, dens, S));
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(900 * k, 225 * k)), track(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, toneMapped: true })));
    m.position.set(0, y + 225 * k * 0.5, z);
    m.renderOrder = -5;
    m.userData.noAO = true;
    group.add(m);
  }
  // low cloud banks
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(90, 14)), track(mistMaterial(sh, i % 2 ? '#3a2a60' : '#26407a', 0.3)));
    m.position.set(0, 0.8 + i * 0.5, -10 - i * 14);
    m.rotation.x = -Math.PI / 2;
    m.userData.noAO = true;
    group.add(m);
  }
  // searchlights from the roof edge
  const beamM = track(beamMaterial('#bcd4ff', 0.18, 0.7, true, sh));
  const beamG = track(new THREE.CylinderGeometry(7, 0.5, 140, 20, 1, true));
  const beams: THREE.Group[] = [];
  for (const x of [-HW + 2, HW - 2]) {
    const g = new THREE.Group();
    g.position.set(x, 1, ZF + 4);
    const c = new THREE.Mesh(beamG, beamM);
    c.position.y = 70;
    c.userData.noAO = true;
    c.frustumCulled = false;
    g.add(c);
    group.add(g);
    beams.push(g);
  }
  // rain
  {
    const RN = high ? 3000 : 1100;
    const pos = new Float32Array(RN * 6);
    const seed = new Float32Array(RN * 8);
    const end = new Float32Array(RN * 2);
    for (let i = 0; i < RN; i++) {
      const x = (R() - 0.5) * 60;
      const y = R() * 38;
      const z = -R() * 90 + 12;
      const w = R();
      pos.set([x, y, z, x, y, z], i * 6);
      seed.set([0, 0, 0, w, 0, 0, 0, w], i * 8);
      end.set([0, 1], i * 2);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const rain = new THREE.LineSegments(g, track(rainMaterial(sh, '#8fb0d0')));
    rain.frustumCulled = false;
    rain.userData.noAO = true;
    rain.layers.set(1);
    group.add(rain);
  }

  // the hostage: tied to a chair on the far side of the helipad
  const hostage = buildHostage();
  hostage.group.position.set(0, 0, -55);
  hostage.group.rotation.y = 0;
  group.add(hostage.group);
  // inert panes and racks keep the engine's code uniform (a few antenna cabinets are shootable)
  const racks = makeRacks([{ x: -9, z: -10 }, { x: 9, z: -12 }, { x: -14, z: -26 }, { x: 14, z: -28 }], [1.6, 3.0, 1.0], disp, high, group);
  const panes = makePanes({ n: 1, w: 0.1, h: 0.1, place: () => ({ x: 0, y: -50, z: 0, ry: 0 }), color: '#000000' }, disp);
  panes.windows.visible = false;
  group.add(panes.windows);

  scene.add(group);
  return {
    id: 'roof',
    mood: { fog: '#0a1626', density: 0.0085, bg: '#05060f' },
    group,
    windows: panes.windows,
    wins: panes.wins,
    racks: racks.racks,
    solids: [roofSolid],
    ground,
    hitLight,
    hostage,
    breakWindow: panes.breakWindow,
    breakRack: racks.breakRack,
    rebuild: () => {
      panes.rebuild();
      racks.rebuild();
    },
    update: (dt, t) => {
      sh.uT.value = t;
      racks.tick(t);
      const bc = (group.userData as { beacon?: THREE.Sprite }).beacon;
      if (bc) bc.material.opacity = Math.sin(t * 3) > 0 ? 0.95 : 0.1;
      beams[0].rotation.set(Math.sin(t * 0.33) * 0.5, 0, Math.cos(t * 0.27) * 0.4 - 0.2);
      beams[1].rotation.set(Math.cos(t * 0.29) * 0.5, 0, Math.sin(t * 0.35) * 0.4 + 0.2);
      redWash.intensity = (high ? 260 : 180) * (0.85 + Math.sin(t * 2.2) * 0.15);
      hostage.update(dt, t);
      hitLight.intensity *= Math.pow(0.002, dt);
    },
    dispose: () => {
      hostage.dispose();
      disposeAll(disp, group, scene);
    },
  };
}
