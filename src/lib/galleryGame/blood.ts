/**
 * ACT 2 BLOOD (owner, 27 Oct 2026: "copious blood on the walls and street on the way out"; 17+ violence, no sexual
 * content). Cheap on purpose: two instanced meshes (ground splats and wall drips), one procedural texture each, no
 * per-frame work. A fixed pool: `scatter()` paints the set when Act 2 opens, `splat()` adds one where an Erobotz unit
 * dies (a ring buffer, oldest first). The mobile-lite tier gets a third of the decals and a quarter of the texels.
 *
 * Coordinates are the host set's local space (the roof): the engine converts a world hit point with `worldToLocal`.
 */
import * as THREE from 'three';
import { canvas, rng, tex } from './cityAssets';

export type Blood = {
  /** Add to the host set's group (before the route is laid, so it takes the set's layer). */
  ground: THREE.InstancedMesh;
  walls: THREE.InstancedMesh;
  /** Paint the whole set (Act 2 opens). */
  scatter: () => void;
  /** One splat at a local point on the floor (a kill). */
  splat: (local: THREE.Vector3) => void;
  /** Clean floors again (a new run). */
  clear: () => void;
  dispose: () => void;
};

export type BloodTier = 'high' | 'low' | 'lite';
export const BLOOD_BUDGET: Record<BloodTier, { scatter: number; kills: number; walls: number; px: number }> = {
  high: { scatter: 150, kills: 160, walls: 70, px: 256 },
  low: { scatter: 90, kills: 80, walls: 40, px: 192 },
  lite: { scatter: 45, kills: 40, walls: 20, px: 128 },
};

/** A splat: a dark core, lobes and flecks thrown out. */
function splatCanvas(px: number, seed: number) {
  const R = rng(seed);
  return canvas(px, px, (g) => {
    g.clearRect(0, 0, px, px);
    const c = px / 2;
    const blob = (x: number, y: number, r: number, a: number) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.9})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    blob(c, c, px * 0.26, 1);
    for (let i = 0; i < 9; i++) {
      const a = R() * Math.PI * 2;
      const d = px * (0.12 + R() * 0.16);
      blob(c + Math.cos(a) * d, c + Math.sin(a) * d, px * (0.06 + R() * 0.1), 0.95);
    }
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2;
      const d = px * (0.25 + R() * 0.22);
      blob(c + Math.cos(a) * d, c + Math.sin(a) * d, px * (0.008 + R() * 0.025), 1);
    }
  });
}

/** A wall hit: a spray at the top with drips running down. */
function dripCanvas(px: number, seed: number) {
  const R = rng(seed);
  const W = px;
  const H = px * 2;
  return canvas(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) {
      const x = W * (0.2 + R() * 0.6);
      const y = H * (0.08 + R() * 0.18);
      g.globalAlpha = 0.6 + R() * 0.4;
      g.beginPath();
      g.arc(x, y, W * (0.02 + R() * 0.07), 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 7; i++) {
      const x = W * (0.25 + R() * 0.5);
      const w = W * (0.015 + R() * 0.03);
      const y0 = H * 0.18;
      const y1 = H * (0.4 + R() * 0.55);
      g.globalAlpha = 0.9;
      g.fillRect(x - w / 2, y0, w, y1 - y0);
      g.beginPath();
      g.arc(x, y1, w * 0.9, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

const bloodMat = (map: THREE.Texture) =>
  new THREE.MeshBasicMaterial({
    color: '#860710',
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: THREE.DoubleSide,
  });

/**
 * The blood for a set. `area`: the floor it paints (x half-width, z from..to, local), `wallX` the side walls and
 * `farZ` the far wall it drips on.
 */
export function buildBlood(tier: BloodTier, area: { halfW: number; z0: number; z1: number; wallX: number; farZ: number; wallH: number }): Blood {
  const B = BLOOD_BUDGET[tier];
  const gTex = tex(splatCanvas(B.px, 91), { srgb: false });
  const wTex = tex(dripCanvas(B.px / 2, 37), { srgb: false });
  const gGeo = new THREE.PlaneGeometry(1, 1);
  gGeo.rotateX(-Math.PI / 2);
  const wGeo = new THREE.PlaneGeometry(1, 2);
  const gMat = bloodMat(gTex);
  const wMat = bloodMat(wTex);
  const cap = B.scatter + B.kills;
  const ground = new THREE.InstancedMesh(gGeo, gMat, cap);
  const walls = new THREE.InstancedMesh(wGeo, wMat, B.walls);
  for (const m of [ground, walls]) {
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 4;
    m.userData.noAO = true;
    m.name = 'blood';
    m.setColorAt(0, new THREE.Color('#ffffff')); // the colour attribute exists from the start (no recompile later)
  }
  const R = rng(2048);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const tint = (mesh: THREE.InstancedMesh, i: number) => mesh.setColorAt(i, col.setRGB(0.75 + R() * 0.5, 0.6 + R() * 0.3, 0.6 + R() * 0.3));
  let next = B.scatter; // kill splats ring after the scattered ones
  const put = (i: number, x: number, z: number, size: number, y = 0.035) => {
    q.setFromAxisAngle(up, R() * Math.PI * 2);
    s.set(size * (0.8 + R() * 0.5), 1, size * (0.8 + R() * 0.5));
    p.set(x, y + (i % 7) * 0.002, z);
    ground.setMatrixAt(i, m4.compose(p, q, s));
    tint(ground, i);
  };
  const scatter = () => {
    const { halfW, z0, z1 } = area;
    for (let i = 0; i < B.scatter; i++) {
      // pools along the walk, heavier in the middle of the lane (where the fighting is)
      const x = (R() - 0.5) * 2 * halfW * Math.pow(R(), 0.6);
      const z = z0 + (z1 - z0) * R();
      put(i, x, z, i % 9 === 0 ? 4 + R() * 3 : 0.8 + R() * 2.2);
    }
    ground.count = Math.max(ground.count, B.scatter);
    for (let i = 0; i < B.walls; i++) {
      const side = i % 3;
      const h = area.wallH;
      const size = 0.9 + R() * 1.6;
      if (side < 2) {
        // side walls, facing in
        q.setFromAxisAngle(up, side === 0 ? Math.PI / 2 : -Math.PI / 2);
        p.set((side === 0 ? -1 : 1) * (area.wallX - 0.06), Math.max(size, h * (0.3 + R() * 0.6)), area.z0 + (area.z1 - area.z0) * R());
      } else {
        q.identity();
        p.set((R() - 0.5) * 2 * area.halfW, Math.max(size, h * (0.3 + R() * 0.6)), area.farZ + 0.08);
      }
      s.set(size, size, 1);
      walls.setMatrixAt(i, m4.compose(p, q, s));
      tint(walls, i);
    }
    walls.count = B.walls;
    ground.instanceMatrix.needsUpdate = true;
    walls.instanceMatrix.needsUpdate = true;
    if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  };
  const splat = (local: THREE.Vector3) => {
    const i = next;
    next = next + 1 >= cap ? B.scatter : next + 1;
    put(i, local.x, local.z, 1.2 + R() * 2.4);
    ground.count = Math.max(ground.count, i + 1);
    ground.instanceMatrix.needsUpdate = true;
    if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
  };
  const clear = () => {
    ground.count = 0;
    walls.count = 0;
    next = B.scatter;
  };
  return {
    ground,
    walls,
    scatter,
    splat,
    clear,
    dispose: () => {
      for (const d of [gTex, wTex, gGeo, wGeo, gMat, wMat]) d.dispose();
      ground.dispose();
      walls.dispose();
    },
  };
}
