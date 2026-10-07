/**
 * Arena set dressing and atmosphere: sun with soft shadows, HDRI sky + image-based light, crates,
 * barrels, sandbags, debris, wall and floor decals, grass, a ring of dead trees / rocks / pylons
 * beyond the walls, drifting dust, impact puffs and bullet holes. All CC0 textures (public/arena/CREDITS.md).
 * Everything is instanced; `Quality` trims counts and shadows for phones and weak GPUs.
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
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

// ── The level ──

export type DressParams = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  a: ArenaAssets;
  map: string[];
  cover: [number, number][];
  size: number;
  hallZ: number;
  wallH: number;
  quality: Quality;
};

export type Dressing = {
  /** Props that stop bullets (cover in the horde hall). */
  solids: THREE.Object3D[];
  sun: THREE.DirectionalLight;
  update: (dt: number, now: number, cam: THREE.Vector3) => void;
  setQuality: (q: Quality) => void;
  /** Bullet hit on a surface: dust puff, and a bullet hole when `normal` is given. */
  impact: (point: THREE.Vector3, normal: THREE.Vector3 | null) => void;
  puff: (at: THREE.Vector3, color: string, size: number, life: number, rise?: number) => void;
  setHidden: (hidden: boolean) => void; // hide the things a screen-space AO pass shouldn't see
  dispose: () => void;
};

const SUN_I = 1.25;
const ENV_I = 0.22;
export function dressLevel(p: DressParams): Dressing {
  const { scene, a, map, size, hallZ, wallH } = p;
  const rng = rngFrom(20261007);
  const root = new THREE.Group();
  scene.add(root);
  const spanX = map[0].length * size;
  const spanZ = map.length * size;
  const hallStart = hallZ * size;
  const free = (x: number, z: number) => map[z]?.[x] === '0' || map[z]?.[x] === 'S';
  const centre = (x: number, z: number) => new THREE.Vector3((x + 0.5) * size, 0, (z + 0.5) * size);
  const insts: THREE.InstancedMesh[] = [];
  const keep = (m: THREE.InstancedMesh) => {
    root.add(m);
    insts.push(m);
    return m;
  };

  // ── Sun: low and golden, soft shadows that follow the player ──
  const sun = new THREE.DirectionalLight('#ffd6a0', SUN_I);
  const sunDir = new THREE.Vector3(-30, 26, -20);
  sun.castShadow = p.quality === 'high';
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -26;
  sc.right = sc.top = 26;
  sc.near = 1;
  sc.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // ── Sky and image-based light ──
  let sky: THREE.Texture | null = null;
  let env: THREE.Texture | null = null;
  let disposed = false;
  new RGBELoader()
    .loadAsync('/arena/hdri/sky.hdr')
    .then((tex) => {
      if (disposed) return tex.dispose();
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(p.renderer);
      env = pm.fromEquirectangular(tex).texture;
      pm.dispose();
      sky = tex;
      scene.background = tex;
      scene.backgroundIntensity = 0.5;
        scene.backgroundRotation.set(0, 2.2, 0);
      scene.environment = env;
      scene.environmentRotation.set(0, 2.2, 0);
    })
    .catch(() => undefined); // no sky file: the plain dusk colour stays

  // ── Ground past the walls ──
  const groundMat = a.material('dirt', [90, 90]);
  groundMat.color.set('#a8896a');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(spanX / 2, -0.06, spanZ / 2);
  ground.receiveShadow = true;
  root.add(ground);

  // ── Free cells and which wall each one hugs ──
  type Cell = { x: number; z: number; walls: [number, number][] };
  const cells: Cell[] = [];
  map.forEach((row, z) =>
    [...row].forEach((c, x) => {
      if (c !== '0') return;
      if (Math.abs(x - 1) <= 1 && Math.abs(z - 1) <= 1) return; // keep the spawn clear
      const walls = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).filter(([dx, dz]) => !free(x + dx, z + dz));
      cells.push({ x, z, walls });
    }),
  );
  const edge = (c: Cell, inset: number, jitter: number) => {
    const w = c.walls[Math.floor(rng() * c.walls.length)] ?? [0, 0];
    const o = size / 2 - inset;
    const tx = -w[1];
    const tz = w[0];
    const j = (rng() - 0.5) * 2 * jitter;
    const v = centre(c.x, c.z);
    return { x: v.x + w[0] * o + tx * j, z: v.z + w[1] * o + tz * j, face: Math.atan2(-w[0], -w[1]) };
  };

  // ── Materials ──
  const wood = a.material('weathered_planks', [1, 1]);
  const metal = a.material('rusty_corrugated_iron', [1, 1]);
  const sandMat = a.material('concrete_wall_003', [1, 1]);
  sandMat.color.set('#b49b6c');
  const rockMat = a.material('rock_ground', [1, 1]);
  const barkMat = a.material('weathered_planks', [1, 1]);
  barkMat.color.set('#5b4a3c');

  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const barrelGeo = new THREE.CylinderGeometry(0.4, 0.4, 1, 14);
  const bagGeo = new THREE.CapsuleGeometry(0.2, 0.55, 3, 8);
  bagGeo.rotateZ(Math.PI / 2);
  const chunkGeo = new THREE.BoxGeometry(1, 1, 1);

  const crates: Xf[] = [];
  const barrels: Xf[] = [];
  const bags: Xf[] = [];
  const chunks: Xf[] = [];
  const coverCrates: Xf[] = [];
  const coverBarrels: Xf[] = [];
  const coverBags: Xf[] = [];
  const BARREL_COLS = ['#8a2a1c', '#3b5f8a', '#6b6f3a', '#7a7a74', '#b8742a'];

  const crateStack = (list: Xf[], x: number, z: number, ry: number, n: number) => {
    const s = 0.8 + rng() * 0.5;
    list.push({ x, y: s / 2, z, sx: s, sy: s, sz: s, ry });
    if (n > 1) list.push({ x: x + (rng() - 0.5) * 0.9, y: s / 2, z: z + (rng() - 0.5) * 0.9, sx: s * 0.9, sy: s * 0.9, sz: s * 0.9, ry: ry + 0.6 });
    if (n > 2) list.push({ x: x + (rng() - 0.5) * 0.3, y: s + s * 0.4, z: z + (rng() - 0.5) * 0.3, sx: s * 0.8, sy: s * 0.8, sz: s * 0.8, ry: ry + 0.3 });
  };
  const barrel = (list: Xf[], x: number, z: number, lying = false) => {
    const col = BARREL_COLS[Math.floor(rng() * BARREL_COLS.length)];
    if (lying) list.push({ x, y: 0.4, z, sx: 1, sy: 1, sz: 1, ry: rng() * 6, rz: Math.PI / 2, color: col });
    else list.push({ x, y: 0.5, z, sx: 1, sy: 1, sz: 1, ry: rng() * 6, color: col });
  };
  const sandbagWall = (list: Xf[], x: number, z: number, ry: number, len: number) => {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < len - (row % 2); i++) {
        const off = (i - (len - 1) / 2 + (row % 2) * 0.5) * 0.78;
        list.push({ x: x + c * off, y: 0.17 + row * 0.3, z: z - s * off, sx: 1, sy: 1, sz: 1, ry: ry + (rng() - 0.5) * 0.15 });
      }
  };

  for (const c of cells) {
    if (!c.walls.length) continue;
    const r = rng();
    const e = edge(c, 0.95, 0.9);
    if (r < 0.2) crateStack(crates, e.x, e.z, e.face + (rng() - 0.5) * 0.5, 1 + Math.floor(rng() * 3));
    else if (r < 0.36) {
      barrel(barrels, e.x, e.z, rng() < 0.15);
      if (rng() < 0.6) barrel(barrels, e.x + 0.75, e.z + 0.2);
    } else if (r < 0.48) sandbagWall(bags, e.x, e.z, e.face, 3 + Math.floor(rng() * 2));
    if (rng() < 0.6) {
      const d = edge(c, 0.5, 1.4);
      for (let k = 0; k < 3; k++)
        chunks.push({ x: d.x + (rng() - 0.5) * 1.4, y: 0.05, z: d.z + (rng() - 0.5) * 1.4, sx: 0.1 + rng() * 0.45, sy: 0.07 + rng() * 0.12, sz: 0.1 + rng() * 0.45, ry: rng() * 6, rx: (rng() - 0.5) * 0.4, color: rng() < 0.5 ? '#7d776c' : '#5e5042' });
    }
  }

  // Cover in the horde hall: crates, barrels and sandbags you can fight behind (these also stop bullets).
  for (const [cx, cz] of p.cover) {
    const v = centre(cx, cz);
    const kind = (cx * 3 + cz) % 3;
    if (kind === 0) {
      crateStack(coverCrates, v.x - 0.7, v.z - 0.5, 0.2, 3);
      crateStack(coverCrates, v.x + 0.8, v.z + 0.6, 1.1, 2);
      barrel(coverBarrels, v.x + 0.9, v.z - 0.9);
    } else if (kind === 1) {
      sandbagWall(coverBags, v.x, v.z - 0.9, 0, 4);
      sandbagWall(coverBags, v.x, v.z + 0.9, 0, 4);
      crateStack(coverCrates, v.x, v.z, 0.5, 2);
    } else {
      for (let i = 0; i < 4; i++) barrel(coverBarrels, v.x + (i % 2) * 1.1 - 0.55, v.z + Math.floor(i / 2) * 1.1 - 0.55);
      barrel(coverBarrels, v.x + 0.3, v.z + 0.1, true);
      crateStack(coverCrates, v.x + 0.9, v.z + 1.0, 0.4, 1);
    }
  }

  keep(instanced(crateGeo, wood, crates));
  keep(instanced(barrelGeo, metal, barrels));
  keep(instanced(bagGeo, sandMat, bags));
  keep(instanced(chunkGeo, rockMat, chunks, false));
  const solids: THREE.Object3D[] = [];
  if (coverCrates.length) solids.push(keep(instanced(crateGeo, wood, coverCrates)));
  if (coverBarrels.length) solids.push(keep(instanced(barrelGeo, metal, coverBarrels)));
  if (coverBags.length) solids.push(keep(instanced(bagGeo, sandMat, coverBags)));

  // ── Decals: stains, paint, hazard stripes on the walls; dirt blotches on the floor ──
  const decalTex = [
    paint(128, 256, (c) => {
      // rust / water streaks running down
      for (let i = 0; i < 14; i++) {
        const x = 10 + Math.random() * 108;
        const g = c.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, 'rgba(60,30,15,0.0)');
        g.addColorStop(0.15, 'rgba(60,30,15,0.5)');
        g.addColorStop(1, 'rgba(60,30,15,0)');
        c.fillStyle = g;
        c.fillRect(x, 0, 2 + Math.random() * 7, 90 + Math.random() * 166);
      }
    }),
    paint(256, 256, (c) => {
      // warning stripes
      c.fillStyle = 'rgba(235,180,20,0.9)';
      c.fillRect(0, 96, 256, 64);
      c.fillStyle = 'rgba(20,16,10,0.95)';
      for (let x = -64; x < 300; x += 48) {
        c.beginPath();
        c.moveTo(x, 160);
        c.lineTo(x + 24, 160);
        c.lineTo(x + 56, 96);
        c.lineTo(x + 32, 96);
        c.fill();
      }
      c.strokeStyle = 'rgba(0,0,0,0.5)';
      c.lineWidth = 4;
      c.strokeRect(2, 98, 252, 60);
    }),
    paint(256, 256, (c) => {
      // sprayed arrow and cross
      c.strokeStyle = 'rgba(225,70,50,0.9)';
      c.lineWidth = 14;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(40, 190);
      c.lineTo(200, 80);
      c.moveTo(200, 80);
      c.lineTo(130, 90);
      c.moveTo(200, 80);
      c.lineTo(190, 150);
      c.stroke();
      c.lineWidth = 9;
      c.beginPath();
      c.moveTo(60, 50);
      c.lineTo(110, 100);
      c.moveTo(110, 50);
      c.lineTo(60, 100);
      c.stroke();
    }),
    paint(256, 256, (c) => {
      // chipped plaster / bullet scars
      for (let i = 0; i < 26; i++) {
        const x = 128 + (Math.random() - 0.5) * 170;
        const y = 128 + (Math.random() - 0.5) * 170;
        const r = 3 + Math.random() * 10;
        const g = c.createRadialGradient(x, y, 0, x, y, r * 2);
        g.addColorStop(0, 'rgba(25,20,16,0.85)');
        g.addColorStop(0.45, 'rgba(70,60,50,0.5)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r * 2, 0, 6.3);
        c.fill();
      }
    }),
  ];
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decalMats = decalTex.map((map) => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const decals: THREE.Mesh[] = [];
  const wallFaces: { x: number; z: number; dx: number; dz: number }[] = [];
  map.forEach((row, z) =>
    [...row].forEach((c, x) => {
      if (c !== '1') return;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) if (free(x + dx, z + dz)) wallFaces.push({ x, z, dx, dz });
    }),
  );
  for (let i = 0; i < 70 && wallFaces.length; i++) {
    const f = wallFaces.splice(Math.floor(rng() * wallFaces.length), 1)[0];
    const kind = Math.floor(rng() * decalTex.length);
    const w = kind === 1 ? 2.4 : 1.4 + rng() * 1.4;
    const h = kind === 0 ? w * 2 : kind === 1 ? 1.2 : w;
    const m = new THREE.Mesh(decalGeo, decalMats[kind]);
    m.scale.set(w, h, 1);
    const cx = (f.x + 0.5) * size + f.dx * (size / 2 + 0.012) + -f.dz * (rng() - 0.5) * 1.2;
    const cz = (f.z + 0.5) * size + f.dz * (size / 2 + 0.012) + f.dx * (rng() - 0.5) * 1.2;
    m.position.set(cx, kind === 0 ? wallH - h / 2 - 0.1 : 0.9 + rng() * 1.1, cz);
    m.rotation.y = Math.atan2(f.dx, f.dz);
    m.receiveShadow = true;
    root.add(m);
    decals.push(m);
  }
  const blotchTex = paint(128, 128, (c) => {
    for (let i = 0; i < 40; i++) {
      const x = 64 + (Math.random() - 0.5) * 80;
      const y = 64 + (Math.random() - 0.5) * 80;
      const r = 6 + Math.random() * 22;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    }
  });
  const blotchMat = new THREE.MeshStandardMaterial({ map: blotchTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const blotchGeo = new THREE.PlaneGeometry(1, 1);
  blotchGeo.rotateX(-Math.PI / 2);
  const blotches: Xf[] = [];
  const palette = ['#2a1d12', '#3d3022', '#1a1a18', '#4a2a1a', '#6a5a3a'];
  for (let i = 0; i < 46; i++) {
    const c = cells[Math.floor(rng() * cells.length)];
    if (!c) break;
    const v = centre(c.x, c.z);
    const s = 2 + rng() * 3.2;
    blotches.push({ x: v.x + (rng() - 0.5) * 2, y: 0.012 + (i % 5) * 0.001, z: v.z + (rng() - 0.5) * 2, sx: s, sy: 1, sz: s, ry: rng() * 6, color: palette[i % palette.length] });
  }
  const blotchMesh = keep(instanced(blotchGeo, blotchMat, blotches, false));
  blotchMesh.castShadow = false;

  // ── Grass clumps (crossed quads, swaying) along wall bases and in the cracks ──
  const grassTex = paint(128, 128, (c) => {
    for (let i = 0; i < 34; i++) {
      const x = 8 + Math.random() * 112;
      const h = 50 + Math.random() * 74;
      const g = c.createLinearGradient(0, 128, 0, 128 - h);
      g.addColorStop(0, '#2c4a16');
      g.addColorStop(1, ['#9ab85a', '#c4cf6a', '#7fa042'][i % 3]);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x - 3, 128);
      c.quadraticCurveTo(x + (Math.random() - 0.5) * 20, 128 - h * 0.6, x + (Math.random() - 0.5) * 24, 128 - h);
      c.quadraticCurveTo(x + 2, 128 - h * 0.5, x + 3, 128);
      c.fill();
    }
  });
  const q1 = new THREE.PlaneGeometry(0.9, 0.7);
  q1.translate(0, 0.35, 0);
  const q2 = q1.clone();
  q2.rotateY(Math.PI / 2);
  const grassGeo = mergeGeometries([q1, q2])!;
  const grassUniforms = { uTime: { value: 0 } };
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x += sin(uTime * 1.7 + instanceMatrix[3].x * 0.8 + instanceMatrix[3].z * 0.6) * 0.07 * position.y;\ntransformed.z += cos(uTime * 1.3 + instanceMatrix[3].z * 0.7) * 0.05 * position.y;\n#endif');
  };
  const grass: Xf[] = [];
  const greens = ['#8fbf55', '#a9c860', '#c9c870', '#6e9a40', '#b8a860'];
  for (const c of cells) {
    const n = Math.floor(rng() * 4) - 1;
    for (let k = 0; k < n; k++) {
      const e = edge(c, 0.45 + rng() * 0.6, 1.8);
      for (let j = 0; j < 3; j++) grass.push({ x: e.x + (rng() - 0.5) * 0.7, y: 0, z: e.z + (rng() - 0.5) * 0.7, sx: 0.8 + rng() * 0.9, sy: 0.6 + rng() * 1.0, sz: 0.8 + rng() * 0.9, ry: rng() * 6, color: greens[Math.floor(rng() * greens.length)] });
    }
  }
  const grassMesh = keep(instanced(grassGeo, grassMat, grass, false));

  // ── Past the walls: dead trees, rocks, pylons and a water tower, tall enough to show over the wall tops ──
  const cx0 = spanX / 2;
  const cz0 = spanZ / 2;
  const trunk = new THREE.CylinderGeometry(0.18, 0.42, 1, 6);
  trunk.translate(0, 0.5, 0);
  const limbs: THREE.BufferGeometry[] = [trunk];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.CylinderGeometry(0.03, 0.14, 0.55, 5);
    l.translate(0, 0.27, 0);
    l.rotateZ(0.7 + (i % 2) * 0.25);
    l.rotateY(i * 1.7);
    l.translate(0, 0.45 + i * 0.12, 0);
    limbs.push(l);
  }
  const treeGeo = mergeGeometries(limbs)!;
  const trees: Xf[] = [];
  for (let i = 0; i < 46; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = 1 + rng() * 0.9;
    const x = cx0 + Math.cos(ang) * (62 + rad * 34) * 0.9;
    const z = cz0 + Math.sin(ang) * (92 + rad * 34);
    const h = 6 + rng() * 9;
    trees.push({ x, y: 0, z, sx: h * 0.22, sy: h, sz: h * 0.22, ry: rng() * 6, rz: (rng() - 0.5) * 0.12 });
  }
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const pos = rockGeo.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 0.78 + 0.4 * Math.abs(Math.sin(v.x * 3.1 + v.y * 2.3) * Math.cos(v.z * 2.7));
      pos.setXYZ(i, v.x * n, v.y * n, v.z * n);
    }
    rockGeo.computeVertexNormals();
  }
  const rocks: Xf[] = [];
  for (let i = 0; i < 34; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = 0.75 + rng() * 1.1;
    const w = 3 + rng() * 9;
    rocks.push({ x: cx0 + Math.cos(ang) * (48 + rad * 38) * 0.9, y: 0, z: cz0 + Math.sin(ang) * (78 + rad * 38), sx: w, sy: w * (0.5 + rng() * 0.7), sz: w * (0.7 + rng() * 0.5), ry: rng() * 6, color: i % 3 ? '#9b8a76' : '#7d7062' });
  }
  keep(instanced(treeGeo, barkMat, trees));
  keep(instanced(rockGeo, rockMat, rocks));
  const darkMetal = a.material('rusty_corrugated_iron', [2, 2]);
  darkMetal.color.set('#8a6a50');
  const tower = new THREE.Group();
  {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 4.2, 14), darkMetal);
    tank.position.y = 15;
    const lid = new THREE.Mesh(new THREE.ConeGeometry(3.7, 1.6, 14), darkMetal);
    lid.position.y = 17.9;
    tower.add(tank, lid);
    for (const [lx, lz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 13, 0.35), darkMetal);
      leg.position.set(lx, 6.5, lz);
      tower.add(leg);
    }
    for (const yy of [4, 8, 12]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.2, 0.2), darkMetal);
      brace.position.y = yy;
      const brace2 = brace.clone();
      brace2.rotation.y = Math.PI / 2;
      tower.add(brace, brace2);
    }
    tower.position.set(cx0 - 78, 0, cz0 + 38);
    tower.traverse((o) => (o.castShadow = true));
    root.add(tower);
  }
  for (const [px, pz] of [[cx0 + 70, cz0 - 40], [cx0 + 76, cz0 + 8], [cx0 + 82, cz0 + 56]]) {
    const pylon = new THREE.Group();
    const legM = new THREE.MeshStandardMaterial({ color: '#4a4540', roughness: 0.7, metalness: 0.6 });
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 16, 0.22), legM);
      leg.position.set(lx * 0.8, 8, lz * 0.8);
      leg.rotation.z = lx * -0.02;
      pylon.add(leg);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 0.3), legM);
    arm.position.y = 15.5;
    const arm2 = arm.clone();
    arm2.position.y = 13.5;
    arm2.scale.x = 0.7;
    pylon.add(arm, arm2);
    pylon.position.set(px, 0, pz);
    root.add(pylon);
  }

  // ── Drifting dust in the sunlight ──
  const moteTex = paint(32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,235,200,1)');
    g.addColorStop(1, 'rgba(255,235,200,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  const MOTES = 140;
  const motePos = new Float32Array(MOTES * 3);
  const moteBase = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    moteBase[i * 3] = (rng() - 0.5) * 24;
    moteBase[i * 3 + 1] = rng() * 4;
    moteBase[i * 3 + 2] = (rng() - 0.5) * 24;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({ map: moteTex, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.4, 1.1, 0.8), toneMapped: false });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  root.add(motes);

  // ── Impact puffs and bullet holes ──
  const smokeTex = paint(64, 64, (c) => {
    for (let i = 0; i < 9; i++) {
      const x = 32 + (Math.random() - 0.5) * 22;
      const y = 32 + (Math.random() - 0.5) * 22;
      const g = c.createRadialGradient(x, y, 0, x, y, 20);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    }
  });
  type Puff = { s: THREE.Sprite; born: number; life: number; size: number; rise: number; on: boolean };
  const puffs: Puff[] = [];
  for (let i = 0; i < 28; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    root.add(s);
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
  const holeTex = paint(32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 15);
    g.addColorStop(0, 'rgba(8,6,4,0.95)');
    g.addColorStop(0.35, 'rgba(25,20,14,0.8)');
    g.addColorStop(1, 'rgba(25,20,14,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  const holeMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const holeGeo = new THREE.PlaneGeometry(0.2, 0.2);
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
    puff(tmp.copy(point).addScaledVector(normal ?? new THREE.Vector3(0, 0.3, 0), 0.08), '#d2bd9c', 0.55, 0.8, 0.5);
    if (!normal) return;
    const h = holes[holeAt++ % holes.length];
    h.visible = true;
    h.position.copy(point).addScaledVector(normal, 0.012);
    h.lookAt(tmp.copy(point).add(normal));
    h.rotateZ(Math.random() * 6);
    h.scale.setScalar(0.4 + Math.random() * 0.5);
  };

  // ── Per-frame ──
  const fogDust = new THREE.Color('#a98462');
  const fogHall = new THREE.Color('#2a0c08');
  const fogNow = new THREE.Color();
  const snapped = new THREE.Vector3();
  const update = (dt: number, now: number, cam: THREE.Vector3) => {
    grassUniforms.uTime.value = now / 1000;
    snapped.set(Math.round(cam.x), 0, Math.round(cam.z));
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).add(sunDir);
    sun.target.updateMatrixWorld();
    // Inside the covered horde hall the sky stops lighting things and the haze goes dark red.
    const inHall = THREE.MathUtils.smoothstep(cam.z, hallStart - 4, hallStart + 2);
    scene.environmentIntensity = ENV_I * (1 - inHall * 0.8);
    sun.intensity = SUN_I * (1 - inHall);
    fogNow.copy(fogDust).lerp(fogHall, inHall);
    if (scene.fog) {
      scene.fog.color.copy(fogNow);
      (scene.fog as THREE.FogExp2).density = 0.012 + inHall * 0.022;
    }
    for (let i = 0; i < MOTES; i++) {
      const t = now / 1000;
      const bx = moteBase[i * 3];
      const by = moteBase[i * 3 + 1];
      const bz = moteBase[i * 3 + 2];
      // wrap in a 24 m box around the player so the dust always surrounds them
      const wx = ((((bx + cam.x + Math.sin(t * 0.2 + i) * 0.8 + t * 0.12) % 24) + 36) % 24) - 12;
      motePos[i * 3] = cam.x + wx;
      motePos[i * 3 + 1] = (by + Math.sin(t * 0.3 + i * 1.7) * 0.4 + t * 0.03 * ((i % 3) + 1)) % 4;
      const wz = ((((bz + cam.z + Math.cos(t * 0.17 + i) * 0.8) % 24) + 36) % 24) - 12;
      motePos[i * 3 + 2] = cam.z + wz;
    }
    (moteGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
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
  };

  let moteOn = true;
  const setQuality = (q: Quality) => {
    const hi = q === 'high';
    sun.castShadow = hi;
    const frac = hi ? 1 : 0.45;
    for (const m of insts) m.count = solids.includes(m) ? (m.userData.full as number) : Math.ceil(((m.userData.full as number) || 0) * (m === grassMesh || m === blotchMesh ? frac : hi ? 1 : 0.8));
    decals.forEach((d, i) => (d.visible = hi || i % 2 === 0));
    moteOn = hi;
    motes.visible = hi;
  };
  setQuality(p.quality);

  return {
    solids,
    sun,
    update,
    setQuality,
    impact,
    puff,
    setHidden: (hidden) => {
      grassMesh.visible = !hidden;
      motes.visible = !hidden && moteOn;
    },
    dispose: () => {
      disposed = true;
      scene.remove(root, sun, sun.target);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m.geometry !== undefined) m.geometry.dispose();
      });
      for (const t of [...decalTex, blotchTex, grassTex, moteTex, smokeTex, holeTex]) t.dispose();
      for (const m of [...decalMats, blotchMat, grassMat, moteMat, holeMat]) m.dispose();
      for (const pf of puffs) pf.s.material.dispose();
      sky?.dispose();
      env?.dispose();
      scene.background = null;
      scene.environment = null;
    },
  };
}
