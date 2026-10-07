/**
 * The Arena's hell-forge: a gothic-industrial bunker built from a modular kit (bevelled stone and
 * iron: pilasters, plinths, cornices, ribbed panels, barrel vaults, groin ribs, galleries, pipes,
 * chains, skull ossuaries), lava pools and grates, braziers, embers, glowing runes, gore and impact
 * effects. Everything is procedural or CC0 (public/arena/CREDITS.md) and instanced; `Quality` trims
 * counts, shadows and lights for phones and weak GPUs.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArenaAssets } from './arenaHD';

export type Quality = 'low' | 'high';

// ── Quality preference (auto-picked by device, remembered in this browser) ──

const KEY = 'tb:arena-quality';
export function autoQuality(): Quality {
  if (typeof navigator === 'undefined') return 'high';
  const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return phone || cores <= 4 || mem <= 4 ? 'low' : 'high';
}
export function getQuality(): Quality {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'high') return v;
  } catch {
    /* private mode */
  }
  return autoQuality();
}
export function setQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent('arena:quality', { detail: q }));
}
export function subscribeQuality(cb: () => void) {
  window.addEventListener('arena:quality', cb);
  return () => window.removeEventListener('arena:quality', cb);
}

// ── Helpers ──

const rngFrom = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const paint = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const dummy = new THREE.Object3D();
dummy.rotation.order = 'YXZ';
type Xf = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; rx?: number; rz?: number; color?: THREE.ColorRepresentation };

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Xf[], cast = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const col = new THREE.Color();
  list.forEach((o, i) => {
    dummy.position.set(o.x, o.y, o.z);
    dummy.rotation.set(o.rx ?? 0, o.ry, o.rz ?? 0);
    dummy.scale.set(o.sx, o.sy, o.sz);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    if (o.color !== undefined) m.setColorAt(i, col.set(o.color));
  });
  m.count = list.length;
  m.userData.full = list.length;
  m.castShadow = cast;
  m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

/** Tile a texture by world position (so scaled kit pieces never stretch it). */
function worldUV(mat: THREE.MeshStandardMaterial, scale: number, key: string) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #if defined(USE_MAP) || defined(USE_NORMALMAP) || defined(USE_ROUGHNESSMAP)
      {
        mat4 wm = modelMatrix;
        #ifdef USE_INSTANCING
          wm = modelMatrix * instanceMatrix;
        #endif
        vec3 wpos = (wm * vec4(position, 1.0)).xyz;
        vec3 wn = abs(normalize(mat3(wm) * normal));
        vec2 wuv = wn.y > 0.6 ? wpos.xz : (wn.x > wn.z ? wpos.zy : wpos.xy);
        wuv *= ${scale.toFixed(4)};
        #ifdef USE_MAP
          vMapUv = wuv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = wuv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = wuv;
        #endif
      }
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ── The level ──

export type DressParams = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  a: ArenaAssets;
  map: string[];
  cover: [number, number][];
  lava: [number, number][];
  size: number;
  hallZ: number;
  quality: Quality;
};

export type Dressing = {
  /** The wall cores: bullets hit these (and leave holes). */
  walls: THREE.Object3D[];
  /** Cover in the horde hall: stops bullets too. */
  solids: THREE.Object3D[];
  /** 0..1: how close you are to lava (drives the heat haze). */
  state: { heat: number };
  update: (dt: number, now: number, cam: THREE.Vector3) => void;
  setQuality: (q: Quality) => void;
  /** Bullet hit on a surface: dust puff, and a bullet hole when `normal` is given. */
  impact: (point: THREE.Vector3, normal: THREE.Vector3 | null) => void;
  puff: (at: THREE.Vector3, color: string, size: number, life: number, rise?: number) => void;
  /** Meat, bone and a floor splatter; `big` for the large demons. */
  gore: (at: THREE.Vector3, big: boolean) => void;
  setHidden: (hidden: boolean) => void; // hide the things a screen-space AO pass shouldn't see
  dispose: () => void;
};

const H_TUNNEL = 2.8; // wall height where a barrel vault springs (peak is +2)
const H_ROOM = 5.2;
const H_HALL = 9;

export function dressLevel(p: DressParams): Dressing {
  const { scene, a, map, size, hallZ } = p;
  const rng = rngFrom(666);
  const root = new THREE.Group();
  scene.add(root);
  const spanX = map[0].length * size;
  const spanZ = map.length * size;
  const rows = map.length;
  const cols = map[0].length;
  const free = (x: number, z: number) => map[z]?.[x] === '0' || map[z]?.[x] === 'S';
  const centre = (x: number, z: number) => new THREE.Vector3((x + 0.5) * size, 0, (z + 0.5) * size);
  const insts: THREE.InstancedMesh[] = [];
  const keep = (m: THREE.InstancedMesh | THREE.Mesh) => {
    root.add(m);
    if ((m as THREE.InstancedMesh).isInstancedMesh) insts.push(m as THREE.InstancedMesh);
    return m;
  };
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => {
    disposables.push(o);
    return o;
  };

  // ── Materials ──
  const mk = (id: Parameters<ArenaAssets['material']>[0], tint: string, scale: number, metal?: number, rough?: number) => {
    const m = a.material(id, [1, 1]);
    m.color.set(tint);
    if (metal !== undefined) m.metalness = metal;
    if (rough !== undefined) m.roughness = rough;
    return track(worldUV(m, scale, `uv-${id}-${scale}`));
  };
  const stone = mk('dark_brick_wall', '#8f847b', 0.28, 0.02, 1);
  const stoneDark = mk('rough_block_wall', '#5d5249', 0.25, 0.02, 1);
  const iron = mk('rusty_metal_04', '#8d7d72', 0.4, 0.85, 1);
  const ironDark = mk('rusty_metal_grid', '#5a4f48', 0.5, 0.9, 1);
  const vaultMat = mk('dark_brick_wall', '#6e625a', 0.22, 0.02, 1);
  vaultMat.side = THREE.DoubleSide;
  const rubble = mk('rock_ground', '#6a5d52', 0.5, 0.0, 1);
  const floorMat = mk('cracked_concrete', '#4e433d', 0.22, 0.05, 1);
  const bone = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));
  const boneRod = track(new THREE.MeshStandardMaterial({ color: '#cfc3aa', roughness: 0.8 }));
  const glowEye = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.9, 0.12), toneMapped: false }));
  const glowWin = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 0.12), toneMapped: false }));

  // ── Geometry kit: every piece bevelled ──
  const rbox = (w: number, h: number, d: number, r: number) => track(new RoundedBoxGeometry(w, h, d, 2, r));
  const boxU = rbox(1, 1, 1, 0.06); // scaled per instance, so the bevel scales too: keep it small
  const coreGeo = rbox(1, 1, 1, 0.02);
  const shaft = track(new THREE.CylinderGeometry(0.28, 0.32, 1, 10));
  const cap = track(new THREE.CylinderGeometry(0.46, 0.3, 0.32, 10));
  const base = track(new THREE.CylinderGeometry(0.4, 0.46, 0.38, 10));
  const pipe = track(new THREE.CylinderGeometry(0.1, 0.1, 1, 10));
  const flange = track(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10));
  const barGeo = track(new THREE.CylinderGeometry(0.035, 0.035, 1, 6));
  const chunkGeo = track(new THREE.IcosahedronGeometry(1, 0));
  const linkGeo = track(new THREE.TorusGeometry(0.075, 0.022, 5, 10));
  const boneGeo = track(new THREE.CapsuleGeometry(0.035, 0.42, 3, 6));
  const skullGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, hex: number) => {
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3);
      const col = new THREE.Color(hex);
      for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      parts.push(g.index ? g : g);
    };
    const cran = new THREE.SphereGeometry(0.17, 12, 10);
    cran.scale(1, 1.06, 1.12);
    cran.translate(0, 0.03, 0);
    add(cran, 0xd9cdb4);
    const jaw = new RoundedBoxGeometry(0.2, 0.09, 0.15, 2, 0.03);
    jaw.translate(0, -0.12, 0.05);
    add(jaw, 0xcfc2a8);
    for (const sx of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.048, 8, 6);
      eye.translate(sx * 0.07, 0.02, 0.15);
      add(eye, 0x140a06);
    }
    const nose = new THREE.ConeGeometry(0.025, 0.07, 4);
    nose.rotateX(Math.PI);
    nose.translate(0, -0.04, 0.19);
    add(nose, 0x1a0e0a);
    const g = mergeGeometries(parts.map((q) => (q.index ? q.toNonIndexed() : q)))!;
    return track(g);
  })();
  const archGeo = track(new THREE.TorusGeometry(2, 0.17, 6, 18, Math.PI));
  const vaultGeo = (() => {
    const g = new THREE.CylinderGeometry(2.0, 2.0, size, 18, 1, true, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    return track(g);
  })();
  const ringGeo = track(new THREE.TorusGeometry(1.45, 0.11, 6, 20));
  ringGeo.rotateX(Math.PI / 2);

  // ── Cell classification ──
  const corridor = (x: number, z: number): 'x' | 'z' | null => {
    if (!free(x, z) || z >= hallZ) return null;
    const l = !free(x - 1, z);
    const r = !free(x + 1, z);
    const u = !free(x, z - 1);
    const d = !free(x, z + 1);
    if (l && r && !u && !d) return 'z';
    if (u && d && !l && !r) return 'x';
    return null;
  };
  const ceilOf = (x: number, z: number) => (corridor(x, z) ? H_TUNNEL : z >= hallZ ? H_HALL : H_ROOM);

  // ── Lights: lots of fire, a fixed few real lights moved to whatever is nearest ──
  type Src = { pos: THREE.Vector3; color: string; intensity: number; dist: number; phase: number };
  const sources: Src[] = [];
  const addSrc = (x: number, y: number, z: number, color: string, intensity: number, dist: number) => sources.push({ pos: new THREE.Vector3(x, y, z), color, intensity, dist, phase: rng() * 10 });

  // ── Wall faces and the kit around them ──
  const lists: Record<string, Xf[]> = {};
  const L = (k: string) => (lists[k] ??= []);
  const skullInst: Xf[] = [];
  const eyeInst: Xf[] = [];
  const runeSpots: { x: number; y: number; z: number; ry: number; s: number }[] = [];
  const colSeen = new Set<string>();
  type Face = { cx: number; cz: number; ry: number; hf: number; hall: boolean; edgeWall: boolean };
  const put = (list: Xf[], f: Face, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, extra: Partial<Xf> = {}) => {
    const c = Math.cos(f.ry);
    const s = Math.sin(f.ry);
    list.push({ x: f.cx + c * lx + s * lz, y: ly, z: f.cz - s * lx + c * lz, sx, sy, sz, ry: f.ry + (extra.ry ?? 0), rx: extra.rx, rz: extra.rz, color: extra.color });
  };
  const coreGroups: Record<'a' | 'b', Xf[]> = { a: [], b: [] };
  const rubbleList = L('rubble');
  const faces: Face[] = [];
  map.forEach((row, z) =>
    [...row].forEach((c, x) => {
      if (c !== '1') return;
      let hmax = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        if (!free(x + dx, z + dz)) continue;
        const hf = ceilOf(x + dx, z + dz);
        hmax = Math.max(hmax, hf);
        faces.push({
          cx: (x + 0.5) * size + dx * (size / 2),
          cz: (z + 0.5) * size + dz * (size / 2),
          ry: Math.atan2(dx, dz),
          hf,
          hall: z + dz >= hallZ,
          edgeWall: x === 0 || x === cols - 1 || z === rows - 1,
        });
      }
      if (hmax) coreGroups[(x * 3 + z * 5) % 4 === 0 ? 'b' : 'a'].push({ x: (x + 0.5) * size, y: hmax / 2, z: (z + 0.5) * size, sx: size, sy: hmax, sz: size, ry: 0 });
    }),
  );
  for (const f of faces) {
    const { hf } = f;
    const W = size;
    // Plinth and two-step cornice: the horizontal bands that tie a wall together.
    put(L('plinth'), f, 0, 0.3, 0.12, W, 0.6, 0.34);
    put(L('trim'), f, 0, hf - 0.22, 0.1, W, 0.44, 0.34);
    put(L('trim'), f, 0, hf - 0.56, 0.07, W, 0.26, 0.26);
    // Pilasters on the cell borders (shared by neighbours: drawn once).
    for (const e of [-1, 1]) {
      const wx = f.cx + Math.cos(f.ry) * e * (W / 2);
      const wz = f.cz - Math.sin(f.ry) * e * (W / 2);
      const key = `${Math.round(wx * 2)},${Math.round(wz * 2)},${Math.round(Math.sin(f.ry))},${Math.round(Math.cos(f.ry))},${hf}`;
      if (colSeen.has(key)) continue;
      colSeen.add(key);
      put(L('shaft'), f, e * (W / 2), hf / 2, 0.14, 1, hf - 0.9, 1);
      put(L('cap'), f, e * (W / 2), hf - 0.5, 0.14, 1, 1, 1);
      put(L('base'), f, e * (W / 2), 0.62, 0.14, 1, 1, 1);
    }
    // The bay between: stone panel, or a ribbed iron panel.
    const ironBay = rng() < 0.38;
    if (ironBay) {
      put(L('ironPanel'), f, 0, hf / 2, 0.05, 3.1, hf - 1.7, 0.12);
      for (let i = -3; i <= 3; i++) put(L('rib'), f, i * 0.42, hf / 2, 0.14, 0.09, hf - 2.0, 0.1);
      for (const y of [0.95, hf / 2, hf - 1.0]) put(L('band'), f, 0, y, 0.16, 3.1, 0.14, 0.12);
    } else {
      put(L('panel'), f, 0, hf / 2, 0.05, 3.15, hf - 1.5, 0.14);
      put(L('panel'), f, 0, hf / 2, 0.1, 2.5, hf - 2.1, 0.1);
    }
    const r = rng();
    if (!ironBay && r < 0.26) {
      // Ossuary column: a stack of skulls, some with burning eyes.
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const y = 0.95 + i * 0.4;
        const sx = (rng() - 0.5) * 0.12;
        put(skullInst, f, sx, y, 0.2, 1, 1, 1, { ry: (rng() - 0.5) * 0.5 });
        if (rng() < 0.45) {
          put(eyeInst, f, sx - 0.07, y + 0.02, 0.36, 1, 1, 1);
          put(eyeInst, f, sx + 0.07, y + 0.02, 0.36, 1, 1, 1);
        }
      }
      put(L('bone'), f, 0, 0.75, 0.2, 1, 1, 1, { rz: Math.PI / 2 });
    } else if (!ironBay && r < 0.4) {
      // Barred furnace window: you see the glow behind it.
      put(L('winGlow'), f, 0, 1.9, 0.125, 1.0, 1.8, 1);
      for (let i = -2; i <= 2; i++) put(L('bar'), f, i * 0.2, 1.9, 0.2, 1, 1.9, 1);
      put(L('ironPanel'), f, 0, 2.95, 0.15, 1.3, 0.18, 0.16);
      put(L('ironPanel'), f, 0, 0.93, 0.15, 1.3, 0.18, 0.16);
      addSrc(f.cx + Math.sin(f.ry) * 0.9, 1.9, f.cz + Math.cos(f.ry) * 0.9, '#ff5a1c', 14, 8);
    } else if (r < 0.55) {
      runeSpots.push({ x: f.cx + Math.sin(f.ry) * 0.16, y: Math.min(hf - 1.5, 2.1), z: f.cz + Math.cos(f.ry) * 0.16, ry: f.ry, s: 1.5 });
    }
    if (rng() < 0.28) {
      // Pipework along the wall: two runs and flanges.
      for (const [k, y] of [[0, hf - 1.0], [1, hf - 1.38]] as [number, number][]) {
        put(L('pipe'), f, 0, y, 0.32 + k * 0.02, 1, W - 0.4, 1, { rz: Math.PI / 2 });
        for (const e of [-1.3, 0.1, 1.5]) put(L('flange'), f, e, y, 0.32 + k * 0.02, 1, 1, 1, { rz: Math.PI / 2 });
      }
      put(L('pipe'), f, -1.5, hf / 2, 0.36, 1, hf - 1.0, 1);
    }
    if (f.hall && hf >= 8 && rng() < 0.7) {
      // A gallery high on the hall walls: ledge, corbels, balustrade and a red slit above.
      put(L('trim'), f, 0, 5.1, 0.55, W, 0.3, 1.1);
      for (const e of [-1.3, 1.3]) put(L('corbel'), f, e, 4.5, 0.38, 0.4, 1.0, 0.7);
      for (let i = -4; i <= 4; i++) put(L('bal'), f, i * 0.44, 5.62, 1.0, 1, 0.75, 1);
      put(L('trim'), f, 0, 6.05, 1.0, W, 0.14, 0.22);
      put(L('winGlow'), f, 0, 7.3, 0.12, 0.5, 2.0, 1);
    }
    if (rng() < 0.4) {
      for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
        const s = 0.1 + rng() * 0.32;
        put(rubbleList, f, (rng() - 0.5) * 3.4, s * 0.6, 0.3 + rng() * 0.9, s * 1.4, s, s * 1.2, { ry: rng() * 6, rx: (rng() - 0.5) * 0.6 });
      }
    }
  }
  const coreA = keep(instanced(coreGeo, stone, coreGroups.a));
  const coreB = keep(instanced(coreGeo, stoneDark, coreGroups.b));
  for (const c of [coreA, coreB]) c.userData.wall = true;
  const walls: THREE.Object3D[] = [coreA, coreB];
  keep(instanced(boxU, stone, lists.plinth ?? []));
  keep(instanced(boxU, stoneDark, lists.trim ?? []));
  keep(instanced(boxU, stoneDark, lists.corbel ?? []));
  keep(instanced(shaft, stone, lists.shaft ?? []));
  keep(instanced(cap, stoneDark, lists.cap ?? []));
  keep(instanced(base, stoneDark, lists.base ?? []));
  keep(instanced(boxU, stone, lists.panel ?? []));
  keep(instanced(boxU, iron, lists.ironPanel ?? []));
  keep(instanced(boxU, ironDark, lists.rib ?? []));
  keep(instanced(boxU, ironDark, lists.band ?? []));
  keep(instanced(pipe, ironDark, lists.pipe ?? []));
  keep(instanced(flange, iron, lists.flange ?? []));
  keep(instanced(barGeo, ironDark, lists.bar ?? [], false));
  keep(instanced(barGeo, stoneDark, lists.bal ?? [], false));
  keep(instanced(chunkGeo, rubble, lists.rubble ?? []));
  keep(instanced(boneGeo, boneRod, lists.bone ?? [], false));
  const winPlane = track(new THREE.PlaneGeometry(1, 1));
  keep(instanced(winPlane, glowWin, lists.winGlow ?? [], false)).castShadow = false;
  const skullMesh = keep(instanced(skullGeo, bone, skullInst, false));
  const eyeGeo = track(new THREE.SphereGeometry(0.03, 6, 5));
  keep(instanced(eyeGeo, glowEye, eyeInst, false));

  // ── Ceilings: ribbed barrel vaults over tunnels, groin-ribbed slabs over rooms and halls ──
  const vaults: Xf[] = [];
  const arches: Xf[] = [];
  const slabs: Xf[] = [];
  const diag: Xf[] = [];
  const rings: Xf[] = [];
  const chains: Xf[] = [];
  const lanternSkulls: Xf[] = [];
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++) {
      if (!free(x, z)) continue;
      const cx = (x + 0.5) * size;
      const cz = (z + 0.5) * size;
      const ax = corridor(x, z);
      if (ax) {
        const ry = ax === 'x' ? 0 : Math.PI / 2;
        vaults.push({ x: cx, y: H_TUNNEL, z: cz, sx: 1, sy: 1, sz: 1, ry });
        arches.push({ x: cx, y: H_TUNNEL, z: cz, sx: 1, sy: 1, sz: 1, ry: ax === 'x' ? Math.PI / 2 : 0 });
      } else {
        const h = z >= hallZ ? H_HALL : H_ROOM;
        slabs.push({ x: cx, y: h + 0.3, z: cz, sx: size, sy: 0.6, sz: size, ry: 0 });
        for (const s of [-1, 1]) diag.push({ x: cx, y: h - 0.14, z: cz, sx: size * 1.42, sy: 0.34, sz: 0.34, ry: s * (Math.PI / 4) });
        rings.push({ x: cx, y: h - 0.12, z: cz, sx: 1, sy: 1, sz: 1, ry: 0 });
      }
      if (rng() < 0.16 && x + z > 3) {
        const h = ceilOf(x, z);
        const px = cx + (rng() - 0.5) * 2.2;
        const pz = cz + (rng() - 0.5) * 2.2;
        const top = ax ? H_TUNNEL + 1.55 : h;
        const len = Math.min(top - 1.8, 2 + rng() * 3);
        const n = Math.floor(len / 0.14);
        for (let i = 0; i < n; i++) chains.push({ x: px, y: top - 0.07 - i * 0.14, z: pz, sx: 1, sy: 1, sz: 1, ry: i % 2 ? Math.PI / 2 : 0 });
        if (rng() < 0.6) {
          const ly = top - len - 0.1;
          lanternSkulls.push({ x: px, y: ly, z: pz, sx: 1.5, sy: 1.5, sz: 1.5, ry: rng() * 6 });
          addSrc(px, ly, pz, '#ff6a24', 9, 7);
        }
      }
    }
  keep(instanced(vaultGeo, vaultMat, vaults, false)).castShadow = false;
  keep(instanced(archGeo, stoneDark, arches, false));
  keep(instanced(boxU, stone, slabs, false));
  keep(instanced(boxU, stoneDark, diag, false));
  keep(instanced(ringGeo, ironDark, rings, false));
  keep(instanced(linkGeo, iron, chains, false));
  keep(instanced(skullGeo, bone, lanternSkulls, false));

  // ── Floor, grime, cracks that glow ──
  const blotchTex = track(
    paint(128, 128, (c) => {
      for (let i = 0; i < 40; i++) {
        const x = 64 + (Math.random() - 0.5) * 80;
        const y = 64 + (Math.random() - 0.5) * 80;
        const r = 6 + Math.random() * 22;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.3)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 128, 128);
      }
    }),
  );
  const blotchMat = track(new THREE.MeshStandardMaterial({ map: blotchTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const flatGeo = track(new THREE.PlaneGeometry(1, 1));
  flatGeo.rotateX(-Math.PI / 2);
  const cells: { x: number; z: number }[] = [];
  map.forEach((row, z) => [...row].forEach((c, x) => c === '0' && !(Math.abs(x - 1) <= 1 && Math.abs(z - 1) <= 1) && cells.push({ x, z })));
  const blotches: Xf[] = [];
  const soot = ['#050303', '#120807', '#2a0a06', '#1a1210', '#3a0c08'];
  for (let i = 0; i < 70; i++) {
    const c = cells[Math.floor(rng() * cells.length)];
    const v = centre(c.x, c.z);
    const s = 2 + rng() * 3.4;
    blotches.push({ x: v.x + (rng() - 0.5) * 2, y: 0.012 + (i % 5) * 0.001, z: v.z + (rng() - 0.5) * 2, sx: s, sy: 1, sz: s, ry: rng() * 6, color: soot[i % soot.length] });
  }
  const blotchMesh = keep(instanced(flatGeo, blotchMat, blotches, false));
  const crackTex = track(
    paint(256, 256, (c) => {
      c.strokeStyle = 'rgba(255,120,30,1)';
      c.lineCap = 'round';
      const branch = (x: number, y: number, ang: number, len: number, w: number) => {
        if (len < 8 || w < 0.5) return;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(x, y);
        const nx = x + Math.cos(ang) * len;
        const ny = y + Math.sin(ang) * len;
        c.lineTo(nx, ny);
        c.stroke();
        branch(nx, ny, ang + (Math.random() - 0.5) * 0.9, len * 0.8, w * 0.8);
        if (Math.random() < 0.55) branch(nx, ny, ang + (Math.random() - 0.5) * 2.2, len * 0.6, w * 0.6);
      };
      c.shadowColor = 'rgba(255,90,20,1)';
      c.shadowBlur = 6;
      for (let i = 0; i < 3; i++) branch(128, 128, Math.random() * 6.3, 40, 4);
    }),
  );
  const crackMat = track(new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.8, 0.7, 0.2), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const cracks: Xf[] = [];
  for (let i = 0; i < 26; i++) {
    const c = cells[Math.floor(rng() * cells.length)];
    const v = centre(c.x, c.z);
    const s = 2.4 + rng() * 2.4;
    cracks.push({ x: v.x + (rng() - 0.5) * 1.6, y: 0.02, z: v.z + (rng() - 0.5) * 1.6, sx: s, sy: 1, sz: s, ry: rng() * 6 });
  }
  keep(instanced(flatGeo, crackMat, cracks, false));

  // ── Lava: animated pools you can burn in, and grated lava beneath the hall floor ──
  const lavaU = { uTime: { value: 0 } };
  const lavaMat = track(
    new THREE.ShaderMaterial({
      uniforms: lavaU,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * n(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
        void main(){
          vec2 p = vW.xz * 0.55;
          float t = uTime;
          float a = fbm(p + vec2(t * 0.06, t * 0.04));
          float b = fbm(p * 1.9 - a * 1.7 + vec2(-t * 0.09, t * 0.07));
          float c = smoothstep(0.38, 0.74, b);
          vec3 crust = vec3(0.05, 0.015, 0.008);
          vec3 mid = vec3(1.9, 0.28, 0.03);
          vec3 hot = vec3(5.0, 2.1, 0.45);
          vec3 col = mix(crust, mix(mid, hot, c * c), smoothstep(0.2, 0.55, b + 0.12 * sin(t * 0.7 + a * 6.0)));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  const lavaGeo = track(new THREE.PlaneGeometry(1, 1));
  lavaGeo.rotateX(-Math.PI / 2);
  const glowCol = track(new THREE.CylinderGeometry(1.5, 1.9, 3.6, 12, 1, true));
  const colTex = track(
    paint(8, 64, (c) => {
      const g = c.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.9)');
      c.fillStyle = g;
      c.fillRect(0, 0, 8, 64);
    }),
  );
  const glowColMat = track(new THREE.MeshBasicMaterial({ map: colTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.4, 0.4, 0.08), toneMapped: false, side: THREE.DoubleSide, opacity: 0.35 }));
  const lavaSpots: THREE.Vector3[] = [];
  for (const [lx, lz] of p.lava) {
    const v = centre(lx, lz);
    const pool = new THREE.Mesh(lavaGeo, lavaMat);
    pool.scale.set(size * 0.96, 1, size * 0.96);
    pool.position.set(v.x, 0.03, v.z);
    keep(pool);
    const rimList: Xf[] = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      rimList.push({ x: v.x + dx * (size / 2 - 0.12), y: 0.14, z: v.z + dz * (size / 2 - 0.12), sx: dx ? 0.34 : size, sy: 0.3, sz: dz ? 0.34 : size, ry: 0 });
    }
    keep(instanced(boxU, stoneDark, rimList));
    const col = new THREE.Mesh(glowCol, glowColMat);
    col.position.set(v.x, 1.8, v.z);
    keep(col);
    lavaSpots.push(new THREE.Vector3(v.x, 0, v.z));
    addSrc(v.x, 1.0, v.z, '#ff4a10', 24, 14);
  }
  // Grated cells in the hall: a floor of bars over a river of lava.
  const grateCells: [number, number][] = [];
  for (const c of cells) if (c.z >= hallZ + 3 && (c.x * 2 + c.z) % 7 === 0 && !p.cover.some(([x, z]) => Math.abs(x - c.x) + Math.abs(z - c.z) < 1) && map[c.z][c.x] === '0') grateCells.push([c.x, c.z]);
  {
    // The floor, with a hole under every grate so the lava shows through.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(spanX, 0);
    shape.lineTo(spanX, -spanZ);
    shape.lineTo(0, -spanZ);
    shape.closePath();
    for (const [gx, gz] of grateCells) {
      const hole = new THREE.Path();
      const x0 = gx * size;
      const y0 = -gz * size;
      hole.moveTo(x0, y0);
      hole.lineTo(x0, y0 - size);
      hole.lineTo(x0 + size, y0 - size);
      hole.lineTo(x0 + size, y0);
      hole.closePath();
      shape.holes.push(hole);
    }
    const fg = track(new THREE.ShapeGeometry(shape));
    fg.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(fg, floorMat);
    floor.receiveShadow = true;
    keep(floor);
  }
  const bars: Xf[] = [];
  for (const [gx, gz] of grateCells) {
    const v = centre(gx, gz);
    const pool = new THREE.Mesh(lavaGeo, lavaMat);
    pool.scale.set(size * 0.98, 1, size * 0.98);
    pool.position.set(v.x, -0.55, v.z);
    keep(pool);
    for (let i = -7; i <= 7; i++) bars.push({ x: v.x + i * 0.26, y: 0.02, z: v.z, sx: 1, sy: size * 0.98, sz: 1, ry: 0, rx: Math.PI / 2 });
    for (const e of [-1, 1]) bars.push({ x: v.x, y: 0.02, z: v.z + e * (size / 2 - 0.05), sx: 2.2, sy: size, sz: 2.2, ry: 0, rz: Math.PI / 2 });
    addSrc(v.x, 0.6, v.z, '#ff3f10', 20, 10);
    lavaSpots.push(new THREE.Vector3(v.x, 0, v.z));
  }
  if (bars.length) {
    const barBig = track(new THREE.CylinderGeometry(0.05, 0.05, 1, 6));
    keep(instanced(barBig, ironDark, bars, false));
  }
  // Hall red lights.
  for (const [x, z] of [[4, 19], [11, 19], [7, 25]]) addSrc((x + 0.5) * size, H_HALL - 2, (z + 0.5) * size, '#ff2a10', 30, 22);

  // ── Runes and sigils that glow ──
  const runeTex = (kind: number) =>
    track(
      paint(256, 256, (c) => {
        c.strokeStyle = '#fff';
        c.fillStyle = '#fff';
        c.lineWidth = 7;
        c.lineCap = 'round';
        c.shadowColor = '#fff';
        c.shadowBlur = 12;
        c.translate(128, 128);
        if (kind === 0) {
          c.beginPath();
          c.arc(0, 0, 100, 0, 6.3);
          c.stroke();
          c.beginPath();
          for (let i = 0; i < 5; i++) {
            const ang = -Math.PI / 2 + i * ((Math.PI * 4) / 5);
            c.lineTo(Math.cos(ang) * 100, Math.sin(ang) * 100);
          }
          c.closePath();
          c.stroke();
          c.lineWidth = 4;
          c.beginPath();
          c.arc(0, 0, 78, 0, 6.3);
          c.stroke();
        } else if (kind === 1) {
          c.beginPath();
          c.moveTo(0, -105);
          c.lineTo(70, 20);
          c.lineTo(-70, 20);
          c.closePath();
          c.stroke();
          c.beginPath();
          c.moveTo(0, 105);
          c.lineTo(70, -20);
          c.lineTo(-70, -20);
          c.closePath();
          c.stroke();
          c.beginPath();
          c.arc(0, 0, 22, 0, 6.3);
          c.fill();
        } else {
          for (let i = 0; i < 3; i++) {
            c.beginPath();
            c.moveTo(-70 + i * 70, -90);
            c.lineTo(-70 + i * 70, 90);
            c.lineTo(-40 + i * 70, 40);
            c.moveTo(-90 + i * 70, -20);
            c.lineTo(-50 + i * 70, -50);
            c.stroke();
          }
        }
      }),
    );
  const runeTexes = [runeTex(0), runeTex(1), runeTex(2)];
  const runeMats = runeTexes.map((map2, i) => track(new THREE.MeshBasicMaterial({ map: map2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.6, 0.55 + i * 0.1, 0.12), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
  const runeMeshes: THREE.Mesh[] = [];
  runeSpots.slice(0, 40).forEach((r, i) => {
    const m = new THREE.Mesh(winPlane, runeMats[i % 3]);
    m.position.set(r.x, r.y, r.z);
    m.rotation.y = r.ry;
    m.scale.setScalar(r.s);
    keep(m);
    runeMeshes.push(m);
  });
  // The great sigil on the hall floor.
  const sigil = new THREE.Mesh(flatGeo, runeMats[0]);
  sigil.scale.set(11, 1, 11);
  sigil.position.set(8 * size, 0.025, 21.5 * size - 2);
  keep(sigil);

  // ── Braziers ──
  const flameTex = track(
    paint(64, 96, (c) => {
      const g = c.createRadialGradient(32, 62, 2, 32, 62, 34);
      g.addColorStop(0, 'rgba(255,250,200,1)');
      g.addColorStop(0.35, 'rgba(255,170,50,0.9)');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(32, 2);
      c.bezierCurveTo(64, 40, 58, 92, 32, 94);
      c.bezierCurveTo(6, 92, 0, 40, 32, 2);
      c.fill();
    }),
  );
  type Flame = { s: THREE.Sprite; base: number; ph: number };
  const flames: Flame[] = [];
  const bowlGeo = track(new THREE.CylinderGeometry(0.5, 0.28, 0.4, 10, 1, true));
  const legGeo = track(new THREE.CylinderGeometry(0.06, 0.1, 1.2, 6));
  const braziers: Xf[] = [];
  const legs: Xf[] = [];
  const bpick = cells.filter((c) => (c.x * 5 + c.z * 3) % 6 === 1);
  for (const c of bpick.slice(0, 22)) {
    const w = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).find(([dx, dz]) => !free(c.x + dx, c.z + dz) && map[c.z + dz]?.[c.x + dx] === '1');
    if (!w) continue;
    const v = centre(c.x, c.z);
    const bx = v.x + w[0] * (size / 2 - 0.7);
    const bz = v.z + w[1] * (size / 2 - 0.7);
    braziers.push({ x: bx, y: 1.3, z: bz, sx: 1, sy: 1, sz: 1, ry: 0 });
    legs.push({ x: bx, y: 0.6, z: bz, sx: 1, sy: 1, sz: 1, ry: 0 });
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(3, 1.5, 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      s.position.set(bx + (k - 1) * 0.1, 1.75, bz + (k % 2) * 0.08);
      s.scale.set(0.7, 1.0, 1);
      root.add(s);
      flames.push({ s, base: 0.8 + k * 0.1, ph: rng() * 9 });
      track(s.material);
    }
    addSrc(bx, 1.9, bz, '#ff8a3a', 20, 13);
  }
  keep(instanced(bowlGeo, ironDark, braziers, false)).castShadow = false;
  keep(instanced(legGeo, ironDark, legs, false));

  // ── Bone heaps in corners ──
  const heapSkulls: Xf[] = [];
  const heapBones: Xf[] = [];
  for (const c of cells.filter((q) => (q.x * 7 + q.z * 11) % 9 === 2).slice(0, 14)) {
    const w = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).find(([dx, dz]) => !free(c.x + dx, c.z + dz));
    if (!w) continue;
    const v = centre(c.x, c.z);
    const hx = v.x + w[0] * (size / 2 - 0.8);
    const hz = v.z + w[1] * (size / 2 - 0.8);
    for (let i = 0; i < 7; i++) heapSkulls.push({ x: hx + (rng() - 0.5) * 1.1, y: 0.1 + rng() * 0.28, z: hz + (rng() - 0.5) * 1.1, sx: 1, sy: 1, sz: 1, ry: rng() * 6, rx: (rng() - 0.5) * 1.2, rz: (rng() - 0.5) * 1.2 });
    for (let i = 0; i < 9; i++) heapBones.push({ x: hx + (rng() - 0.5) * 1.4, y: 0.06 + rng() * 0.15, z: hz + (rng() - 0.5) * 1.4, sx: 1, sy: 1, sz: 1, ry: rng() * 6, rz: Math.PI / 2 + (rng() - 0.5) * 0.6 });
  }
  keep(instanced(skullGeo, bone, heapSkulls, false));
  keep(instanced(boneGeo, boneRod, heapBones, false));

  // ── Cover in the horde hall: obelisks, sarcophagi, spiked barricades (solid) ──
  const solids: THREE.Object3D[] = [];
  const addSolid = (m: THREE.Mesh) => {
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    solids.push(m);
    return m;
  };
  for (const [cx, cz] of p.cover) {
    const v = centre(cx, cz);
    const kind = (cx * 3 + cz) % 3;
    const plinth = addSolid(new THREE.Mesh(rbox(3.4, 0.4, 3.4, 0.08), stoneDark));
    plinth.position.set(v.x, 0.2, v.z);
    if (kind === 0) {
      const ob = addSolid(new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 1.0, 4.4, 4)), stone));
      ob.position.set(v.x, 2.6, v.z);
      ob.rotation.y = Math.PI / 4;
      const crystal = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.4)), glowWin);
      crystal.position.set(v.x, 5.3, v.z);
      root.add(crystal);
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(winPlane, runeMats[i % 3]);
        r.scale.setScalar(0.9);
        r.position.set(v.x + Math.sin(i * 1.5708) * 0.75, 1.9, v.z + Math.cos(i * 1.5708) * 0.75);
        r.rotation.y = i * 1.5708;
        root.add(r);
      }
      addSrc(v.x, 5.2, v.z, '#ff5a1c', 18, 11);
    } else if (kind === 1) {
      for (const e of [-1, 1]) {
        const sar = addSolid(new THREE.Mesh(rbox(1.5, 1.1, 3.0, 0.14), stone));
        sar.position.set(v.x + e * 0.9, 0.95, v.z);
        const lid = addSolid(new THREE.Mesh(rbox(1.3, 0.3, 2.8, 0.12), stoneDark));
        lid.position.set(v.x + e * 0.9, 1.6, v.z);
        const sk = new THREE.Mesh(skullGeo, bone);
        sk.scale.setScalar(2.2);
        sk.position.set(v.x + e * 0.9, 2.05, v.z + 1.0);
        root.add(sk);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const beam = addSolid(new THREE.Mesh(rbox(0.22, 2.6, 0.22, 0.05), iron));
        beam.position.set(v.x + (i - 1) * 0.95, 1.5, v.z);
        beam.rotation.z = (i - 1) * 0.5;
        const beam2 = addSolid(new THREE.Mesh(rbox(0.22, 2.6, 0.22, 0.05), iron));
        beam2.position.copy(beam.position);
        beam2.rotation.z = -(i - 1) * 0.5 + (i === 1 ? 0.5 : 0);
        beam2.rotation.x = 0.5;
      }
      const spikes = addSolid(new THREE.Mesh(rbox(3.0, 0.2, 0.2, 0.04), ironDark));
      spikes.position.set(v.x, 2.5, v.z);
      for (let i = 0; i < 6; i++) {
        const sk = new THREE.Mesh(skullGeo, bone);
        sk.scale.setScalar(1.7);
        sk.position.set(v.x - 1.2 + i * 0.48, 0.65 + (i % 2) * 0.15, v.z + 1.0);
        root.add(sk);
      }
      addSrc(v.x, 3.0, v.z, '#ff4a1a', 16, 10);
    }
  }

  // ── Procedural environment: a dark vault with a few furnace-orange windows, for metal to reflect ──
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshBasicMaterial({ color: '#0d0504', side: THREE.BackSide })));
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 2.6, 0.5) });
  for (let i = 0; i < 6; i++) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), panelMat);
    pm.position.set(Math.sin(i * 1.05) * 8, -1 + (i % 3) * 2.2, Math.cos(i * 1.05) * 8);
    pm.lookAt(0, 0, 0);
    envScene.add(pm);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.5, 0.2) }));
  top.position.set(0, 9, 0);
  top.lookAt(0, 0, 0);
  envScene.add(top);
  const pm = new THREE.PMREMGenerator(p.renderer);
  const envTarget = pm.fromScene(envScene, 0.04);
  pm.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.55;
  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  panelMat.dispose();

  // ── Embers and sparks ──
  const emberTex = track(
    paint(32, 32, (c) => {
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,240,200,1)');
      g.addColorStop(0.4, 'rgba(255,140,40,0.8)');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
    }),
  );
  const EMBERS = 260;
  const emberPos = new Float32Array(EMBERS * 3);
  const emberBase = new Float32Array(EMBERS * 4);
  for (let i = 0; i < EMBERS; i++) {
    emberBase[i * 4] = (rng() - 0.5) * 26;
    emberBase[i * 4 + 1] = rng() * 8;
    emberBase[i * 4 + 2] = (rng() - 0.5) * 26;
    emberBase[i * 4 + 3] = 0.25 + rng() * 0.7;
  }
  const emberGeo = track(new THREE.BufferGeometry());
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const emberMat = track(new THREE.PointsMaterial({ map: emberTex, size: 0.1, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(3, 1.3, 0.35), toneMapped: false }));
  const embers = new THREE.Points(emberGeo, emberMat);
  embers.frustumCulled = false;
  root.add(embers);

  // ── Impact puffs, bullet holes ──
  const smokeTex = track(
    paint(64, 64, (c) => {
      for (let i = 0; i < 9; i++) {
        const x = 32 + (Math.random() - 0.5) * 22;
        const y = 32 + (Math.random() - 0.5) * 22;
        const g = c.createRadialGradient(x, y, 0, x, y, 20);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, 64, 64);
      }
    }),
  );
  type Puff = { s: THREE.Sprite; born: number; life: number; size: number; rise: number; on: boolean };
  const puffs: Puff[] = [];
  for (let i = 0; i < 36; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    root.add(s);
    track(s.material);
    puffs.push({ s, born: 0, life: 1, size: 1, rise: 0, on: false });
  }
  let puffAt = 0;
  const puff = (at: THREE.Vector3, color: string, sz: number, life: number, rise = 0.5) => {
    const pf = puffs[puffAt++ % puffs.length];
    pf.on = true;
    pf.born = performance.now();
    pf.life = life * 1000;
    pf.size = sz;
    pf.rise = rise;
    pf.s.material.color.set(color);
    pf.s.position.copy(at);
    pf.s.scale.setScalar(sz * 0.4);
    pf.s.material.opacity = 0.7;
    pf.s.visible = true;
  };
  const holeTex = track(
    paint(32, 32, (c) => {
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 15);
      g.addColorStop(0, 'rgba(8,6,4,0.95)');
      g.addColorStop(0.35, 'rgba(25,20,14,0.8)');
      g.addColorStop(1, 'rgba(25,20,14,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
    }),
  );
  const holeMat = track(new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const holeGeo = track(new THREE.PlaneGeometry(0.2, 0.2));
  const holes: THREE.Mesh[] = [];
  for (let i = 0; i < 56; i++) {
    const h = new THREE.Mesh(holeGeo, holeMat);
    h.visible = false;
    root.add(h);
    holes.push(h);
  }
  let holeAt = 0;
  const tmp = new THREE.Vector3();
  const impact = (point: THREE.Vector3, normal: THREE.Vector3 | null) => {
    puff(tmp.copy(point).addScaledVector(normal ?? new THREE.Vector3(0, 0.3, 0), 0.08), '#8a7a6a', 0.5, 0.7, 0.4);
    if (!normal) return;
    const h = holes[holeAt++ % holes.length];
    h.visible = true;
    h.position.copy(point).addScaledVector(normal, 0.012);
    h.lookAt(tmp.copy(point).add(normal));
    h.rotateZ(Math.random() * 6);
    h.scale.setScalar(0.4 + Math.random() * 0.5);
  };

  // ── Gore: chunks that fly, bounce and rest; blood on the floor ──
  const GIBS = 90;
  const gibGeo = track(new THREE.IcosahedronGeometry(0.5, 0));
  const gibMat = track(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }));
  const gibMesh = new THREE.InstancedMesh(gibGeo, gibMat, GIBS);
  gibMesh.frustumCulled = false;
  gibMesh.castShadow = false;
  const gibCol = new THREE.Color();
  type Gib = { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Vector3; w: THREE.Vector3; s: number; born: number; on: boolean };
  const gibs: Gib[] = [];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < GIBS; i++) {
    gibs.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), s: 0.1, born: 0, on: false });
    gibMesh.setMatrixAt(i, zero);
    gibMesh.setColorAt(i, gibCol.set('#6a0c08'));
  }
  root.add(gibMesh);
  let gibAt = 0;
  let gibsLive = 0;
  const splatTex = track(
    paint(128, 128, (c) => {
      c.fillStyle = '#7a0a06';
      for (let i = 0; i < 26; i++) {
        const a2 = Math.random() * 6.3;
        const d = Math.random() * 46;
        const r = 3 + Math.random() * (14 - d * 0.18);
        c.beginPath();
        c.arc(64 + Math.cos(a2) * d, 64 + Math.sin(a2) * d, r, 0, 6.3);
        c.fill();
      }
      c.beginPath();
      c.arc(64, 64, 22, 0, 6.3);
      c.fill();
    }),
  );
  const splatMat = track(new THREE.MeshStandardMaterial({ map: splatTex, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const splats: THREE.Mesh[] = [];
  for (let i = 0; i < 22; i++) {
    const s = new THREE.Mesh(flatGeo, splatMat);
    s.visible = false;
    root.add(s);
    splats.push(s);
  }
  let splatAt = 0;
  const gore = (at: THREE.Vector3, big: boolean) => {
    const n = big ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const g = gibs[gibAt++ % GIBS];
      g.on = true;
      g.born = performance.now();
      g.p.set(at.x + (Math.random() - 0.5) * 0.4, Math.max(0.3, at.y), at.z + (Math.random() - 0.5) * 0.4);
      g.v.set((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7);
      g.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      g.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      g.s = (big ? 0.12 : 0.08) + Math.random() * 0.14;
      gibMesh.setColorAt(gibs.indexOf(g), gibCol.set(Math.random() < 0.22 ? '#d9cdb4' : Math.random() < 0.5 ? '#6a0c08' : '#2e0604'));
    }
    if (gibMesh.instanceColor) gibMesh.instanceColor.needsUpdate = true;
    gibsLive = 1;
    puff(at, '#7a0f08', big ? 1.6 : 1.0, 0.7, 0.8);
    puff(tmp.copy(at).setY(at.y * 0.5), '#2a0604', big ? 1.2 : 0.7, 0.9, 0.3);
    const sp = splats[splatAt++ % splats.length];
    sp.visible = true;
    sp.position.set(at.x, 0.02 + (splatAt % 5) * 0.001, at.z);
    sp.scale.setScalar((big ? 2.8 : 1.7) + Math.random() * 0.8);
    sp.rotation.y = Math.random() * 6;
  };

  // ── Lights ──
  const camera = p.camera;
  const headlamp = new THREE.SpotLight('#ffd9b4', 26, 26, 0.55, 0.9, 1.5);
  headlamp.position.set(0.15, 0.2, 0.2);
  const headTarget = new THREE.Object3D();
  headTarget.position.set(0, 0, -6);
  camera.add(headlamp, headTarget);
  headlamp.target = headTarget;
  headlamp.shadow.mapSize.set(1024, 1024);
  headlamp.shadow.bias = -0.0006;
  headlamp.shadow.normalBias = 0.04;
  headlamp.shadow.camera.near = 0.3;
  headlamp.shadow.camera.far = 28;
  const MAX_LIGHTS = 6;
  const pool: { l: THREE.PointLight; src: Src | null }[] = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const l = new THREE.PointLight('#ff6a20', 0, 12, 1.6);
    scene.add(l);
    pool.push({ l, src: null });
  }
  let lightCount = MAX_LIGHTS;
  let lastPick = 0;
  const cand: { s: Src; d: number }[] = sources.map((s) => ({ s, d: 0 }));
  const state = { heat: 0 };

  // ── Per-frame ──
  const update = (dt: number, now: number, cam: THREE.Vector3) => {
    const t = now / 1000;
    lavaU.uTime.value = t;
    // Lights: keep the nearest few sources lit, fading between them.
    if (now - lastPick > 110) {
      lastPick = now;
      for (const c of cand) c.d = c.s.pos.distanceToSquared(cam) / (c.s.dist * c.s.dist);
      cand.sort((x, y) => x.d - y.d);
      const want = cand.slice(0, lightCount).map((c) => c.s);
      for (const pl of pool) if (pl.src && !want.includes(pl.src)) pl.src = null;
      for (const s of want) {
        if (pool.some((pl) => pl.src === s)) continue;
        const free2 = pool.find((pl) => !pl.src);
        if (!free2) break;
        free2.src = s;
        free2.l.position.copy(s.pos);
        free2.l.color.set(s.color);
        free2.l.distance = s.dist;
        free2.l.intensity = 0;
      }
    }
    for (const pl of pool) {
      const target = pl.src ? pl.src.intensity * (0.85 + 0.15 * Math.sin(t * 9 + pl.src.phase) * Math.sin(t * 3.7 + pl.src.phase * 2)) : 0;
      pl.l.intensity += (target - pl.l.intensity) * Math.min(1, dt * 7);
    }
    // Heat haze strength: the closer to lava, the stronger.
    let near = 99;
    for (const v of lavaSpots) near = Math.min(near, Math.hypot(v.x - cam.x, v.z - cam.z));
    state.heat = Math.max(0, 1 - near / 9);
    // Runes breathe.
    runeMats.forEach((m, i) => m.color.setRGB(2.2 + Math.sin(t * 1.6 + i) * 0.8, 0.5 + i * 0.1, 0.12));
    glowColMat.opacity = 0.3 + Math.sin(t * 2) * 0.06;
    for (const f of flames) {
      const k = f.base * (0.85 + 0.25 * Math.sin(t * 13 + f.ph) * Math.sin(t * 5.3 + f.ph));
      f.s.scale.set(0.6 * k, 1.0 * k, 1);
    }
    // Embers rise around you.
    for (let i = 0; i < EMBERS; i++) {
      const sp = emberBase[i * 4 + 3];
      const bx = emberBase[i * 4];
      const by = emberBase[i * 4 + 1];
      const bz = emberBase[i * 4 + 2];
      const wx = ((((bx + cam.x + Math.sin(t * 0.7 + i) * 0.9) % 26) + 39) % 26) - 13;
      const wz = ((((bz + cam.z + Math.cos(t * 0.6 + i * 1.3) * 0.9) % 26) + 39) % 26) - 13;
      emberPos[i * 3] = cam.x + wx;
      emberPos[i * 3 + 1] = (by + t * sp * 1.3) % 8;
      emberPos[i * 3 + 2] = cam.z + wz;
    }
    (emberGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    emberMat.size = 0.09 + Math.sin(t * 11) * 0.015;
    for (const pf of puffs) {
      if (!pf.on) continue;
      const k = (now - pf.born) / pf.life;
      if (k >= 1) {
        pf.on = false;
        pf.s.visible = false;
        continue;
      }
      pf.s.scale.setScalar(pf.size * (0.4 + k * 1.1));
      pf.s.position.y += pf.rise * dt;
      pf.s.material.opacity = 0.7 * (1 - k) * (1 - k);
    }
    if (gibsLive) {
      let any = 0;
      for (let i = 0; i < GIBS; i++) {
        const g = gibs[i];
        if (!g.on) continue;
        const age = (now - g.born) / 1000;
        if (age > 6) {
          g.on = false;
          gibMesh.setMatrixAt(i, zero);
          continue;
        }
        any = 1;
        if (g.p.y > g.s * 0.5 + 0.01 || g.v.y > 0.1) {
          g.v.y -= 16 * dt;
          g.p.addScaledVector(g.v, dt);
          g.r.addScaledVector(g.w, dt);
          if (g.p.y < g.s * 0.5) {
            g.p.y = g.s * 0.5;
            g.v.y *= -0.3;
            g.v.x *= 0.55;
            g.v.z *= 0.55;
            g.w.multiplyScalar(0.5);
          }
        }
        dummy.position.copy(g.p);
        dummy.rotation.set(g.r.x, g.r.y, g.r.z);
        dummy.scale.setScalar(age > 5 ? g.s * (6 - age) : g.s);
        dummy.updateMatrix();
        gibMesh.setMatrixAt(i, dummy.matrix);
      }
      gibMesh.instanceMatrix.needsUpdate = true;
      gibsLive = any;
    }
  };

  const setQuality = (q: Quality) => {
    const hi = q === 'high';
    headlamp.castShadow = hi;
    lightCount = hi ? MAX_LIGHTS : 4;
    pool.forEach((pl, i) => {
      pl.l.visible = i < lightCount;
      if (i >= lightCount) pl.src = null;
    });
    const frac = hi ? 1 : 0.55;
    for (const m of insts) {
      if (m === skullMesh || m === blotchMesh) m.count = Math.ceil((m.userData.full as number) * frac);
    }
    embers.visible = true;
    emberGeo.setDrawRange(0, hi ? EMBERS : 110);
    for (let i = 0; i < runeMeshes.length; i++) runeMeshes[i].visible = hi || i % 2 === 0;
  };
  setQuality(p.quality);

  return {
    walls,
    solids,
    state,
    update,
    setQuality,
    impact,
    puff,
    gore,
    setHidden: (hidden) => {
      embers.visible = !hidden;
      for (const f of flames) f.s.visible = !hidden;
    },
    dispose: () => {
      scene.remove(root);
      camera.remove(headlamp, headTarget);
      for (const pl of pool) scene.remove(pl.l);
      for (const d of disposables) d.dispose();
      for (const m of insts) m.dispose();
      envTarget.dispose();
      scene.environment = null;
      gibMesh.dispose();
    },
  };
}
