/**
 * Level dressing for Double-O Satoshi: floor stains, hazard stripes, wall grime, skirting, ceiling
 * beams, barrels, wall consoles with glowing screens, sconces, light shafts and drifting dust.
 * Everything is instanced (a handful of draw calls) and placed procedurally from the level map, so
 * props sit against walls and never block the paths or doorways.
 */
import * as THREE from 'three';
import type { Grid } from '@/lib/doubleo/grid';
import { DOORS, SIZE, type Level } from '@/lib/doubleo/levels';
import type { LookSpec } from './look';

const WALL_H = 3.6;
const hash = (x: number, z: number, s: number) => (((x * 73856093) ^ (z * 19349663) ^ (s * 83492791)) >>> 0) % 1000 / 1000;

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const stainTex = () =>
  canvasTex(128, 128, (c) => {
    for (let i = 0; i < 14; i++) {
      const x = 64 + (Math.random() - 0.5) * 60;
      const y = 64 + (Math.random() - 0.5) * 60;
      const r = 10 + Math.random() * 28;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    }
  });

const hazardTex = () =>
  canvasTex(256, 32, (c) => {
    c.fillStyle = '#e8b81a';
    c.fillRect(0, 0, 256, 32);
    c.fillStyle = '#16140f';
    for (let x = -32; x < 288; x += 32) {
      c.beginPath();
      c.moveTo(x, 32);
      c.lineTo(x + 16, 32);
      c.lineTo(x + 32, 0);
      c.lineTo(x + 16, 0);
      c.fill();
    }
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 80; i++) c.fillRect(Math.random() * 256, Math.random() * 32, 2 + Math.random() * 6, 1);
  });

const grimeTex = () =>
  canvasTex(64, 128, (c) => {
    for (let i = 0; i < 9; i++) {
      const x = 4 + Math.random() * 56;
      const g = c.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(10,8,4,0.55)');
      g.addColorStop(0.7, 'rgba(10,8,4,0.12)');
      g.addColorStop(1, 'rgba(10,8,4,0)');
      c.fillStyle = g;
      c.fillRect(x, 0, 2 + Math.random() * 5, 40 + Math.random() * 88);
    }
  });

const screenTex = (tint: string) =>
  canvasTex(128, 96, (c) => {
    c.fillStyle = '#021208';
    c.fillRect(0, 0, 128, 96);
    c.strokeStyle = tint;
    c.fillStyle = tint;
    c.lineWidth = 2;
    c.beginPath();
    let y = 60;
    for (let x = 0; x <= 128; x += 8) {
      y = Math.max(14, Math.min(60, y + (Math.random() - 0.5) * 22));
      c.lineTo(x, y);
    }
    c.stroke();
    c.font = '9px monospace';
    for (let i = 0; i < 4; i++) c.fillText(`${(Math.random() * 99999) | 0}  OK`, 6, 76 + i * 0 + (i % 2) * 10);
    c.globalAlpha = 0.18;
    for (let i = 0; i < 96; i += 3) c.fillRect(0, i, 128, 1);
  });


/** The view through a window: painted sky, horizon and terrain per mission (null = underground, no windows). */
const viewTex = (id: string) => {
  if (id === 'vault' || id === 'facility') return null;
  return canvasTex(256, 128, (c) => {
    const sky = c.createLinearGradient(0, 0, 0, 90);
    const [top, bot] = id === 'tower' ? ['#0a1030', '#ff8a50'] : id === 'yacht' ? ['#3a78c8', '#cfe6f5'] : ['#2a3a5a', '#f0a868'];
    sky.addColorStop(0, top);
    sky.addColorStop(1, bot);
    c.fillStyle = sky;
    c.fillRect(0, 0, 256, 128);
    if (id === 'yacht') {
      // Open sea with a sun glitter path.
      const sea = c.createLinearGradient(0, 82, 0, 128);
      sea.addColorStop(0, '#2a6a9a');
      sea.addColorStop(1, '#0a2a4a');
      c.fillStyle = sea;
      c.fillRect(0, 82, 256, 46);
      c.fillStyle = 'rgba(255,240,200,0.6)';
      for (let i = 0; i < 40; i++) c.fillRect(110 + Math.random() * 40, 84 + Math.random() * 40, 6 + Math.random() * 12, 1.5);
    } else if (id === 'tower') {
      // City skyline with lit windows.
      for (let x = 0; x < 256; x += 12) {
        const h = 14 + Math.random() * 50;
        c.fillStyle = '#10121e';
        c.fillRect(x, 96 - h, 11, h + 32);
        c.fillStyle = '#ffd890';
        for (let k = 0; k < h / 6; k++) if (Math.random() > 0.5) c.fillRect(x + 2 + (k % 2) * 4, 96 - h + 3 + k * 6, 2, 2);
      }
    } else {
      // Farm: dusk mountains and bare terrain.
      c.fillStyle = '#2a2430';
      c.beginPath();
      c.moveTo(0, 96);
      for (let x = 0; x <= 256; x += 16) c.lineTo(x, 50 + Math.random() * 36);
      c.lineTo(256, 96);
      c.fill();
      const gr = c.createLinearGradient(0, 90, 0, 128);
      gr.addColorStop(0, '#3a3228');
      gr.addColorStop(1, '#14100c');
      c.fillStyle = gr;
      c.fillRect(0, 90, 256, 38);
    }
  });
};

const shaftTex = () =>
  canvasTex(8, 64, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 8, 64);
  }, false);

const DIRS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export type Dressing = { update: (dt: number, cam: THREE.Vector3) => void };

export function dressLevel(g: THREE.Group, grid: Grid, L: Level, spec: LookSpec, trimMat: THREE.Material, high: boolean): Dressing {
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const cellOf = (x: number, z: number) => ({ cx: (x + 0.5) * SIZE, cz: (z + 0.5) * SIZE });
  const floorCells: [number, number][] = [];
  grid.rows.forEach((r, z) => [...r].forEach((c, x) => c === '.' && floorCells.push([x, z])));
  const isWall = (x: number, z: number) => grid.ch(x, z) === '#';
  const nearDoor = (x: number, z: number) => DIRS.some(([dx, dz]) => DOORS.has(grid.ch(x + dx, z + dz))) || DOORS.has(grid.ch(x, z));
  /** Direction index of a wall beside this cell (or -1). */
  const wallDir = (x: number, z: number, s: number) => {
    const ds = DIRS.map((_, i) => i).filter((i) => isWall(x + DIRS[i][0], z + DIRS[i][1]));
    return ds.length ? ds[Math.floor(hash(x, z, s) * ds.length)] : -1;
  };
  const addInst = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], shadow = false) => {
    if (!mats.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    colors?.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.frustumCulled = false;
    g.add(im);
    return im;
  };
  const place = (px: number, py: number, pz: number, ry: number, sx = 1, sy = 1, sz = 1) => {
    q.setFromEuler(e.set(0, ry, 0));
    return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));
  };

  // ── Floor decals: stains and hazard stripes in the doorways ──
  const stainM: THREE.Matrix4[] = [];
  for (const [x, z] of floorCells) {
    if (hash(x, z, 1) > 0.4) continue;
    const { cx, cz } = cellOf(x, z);
    const s = 1.6 + hash(x, z, 2) * 2.4;
    q.setFromEuler(e.set(-Math.PI / 2, 0, hash(x, z, 3) * 6.28, 'XYZ'));
    stainM.push(m4.clone().compose(new THREE.Vector3(cx + (hash(x, z, 4) - 0.5) * 1.5, 0.012, cz + (hash(x, z, 5) - 0.5) * 1.5), q, new THREE.Vector3(s, s, 1)));
  }
  addInst(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: stainTex(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), stainM);
  const hazM: THREE.Matrix4[] = [];
  for (const d of grid.doors.values()) {
    const { cx, cz } = cellOf(d.x, d.z);
    for (const side of [-1, 1]) {
      const off = side * (SIZE / 2 + 0.3);
      q.setFromEuler(e.set(-Math.PI / 2, 0, d.alongX ? 0 : Math.PI / 2, 'XYZ'));
      hazM.push(m4.clone().compose(new THREE.Vector3(d.alongX ? cx : cx + off, 0.014, d.alongX ? cz + off : cz), q, new THREE.Vector3(SIZE * 0.9, 0.5, 1)));
    }
  }
  addInst(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }), hazM);

  // ── Wall grime streaks + skirting + ceiling beams ──
  const grimeM: THREE.Matrix4[] = [];
  const skirtM: THREE.Matrix4[] = [];
  const beamM: THREE.Matrix4[] = [];
  for (const [x, z] of floorCells) {
    const { cx, cz } = cellOf(x, z);
    DIRS.forEach(([dx, dz], i) => {
      if (!isWall(x + dx, z + dz)) return;
      const ry = Math.atan2(-dx, -dz); // plane normal (+z) faces into the room
      const wx = cx + dx * (SIZE / 2 - 0.012);
      const wz = cz + dz * (SIZE / 2 - 0.012);
      if (hash(x, z, 10 + i) < 0.45) grimeM.push(place(wx, WALL_H - 1.2, wz, ry, SIZE * 0.8, 2.3, 1));
      const nx = cx + dx * (SIZE / 2 - 0.07);
      const nz = cz + dz * (SIZE / 2 - 0.07);
      skirtM.push(place(nx, 0.17, nz, dx !== 0 ? Math.PI / 2 : 0, SIZE, 0.34, 0.14));
    });
    if ((x + z * 2) % 3 === 1 && !nearDoor(x, z)) beamM.push(place(cx, WALL_H - 0.2, cz, hash(x, z, 6) > 0.5 ? 0 : Math.PI / 2, SIZE, 0.36, 0.34));
  }
  addInst(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: grimeTex(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), grimeM);
  addInst(new THREE.BoxGeometry(1, 1, 1), trimMat, skirtM);
  addInst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: spec.ceilingTint, roughness: 0.8, metalness: 0.3 }), beamM, undefined, high);

  // ── Props against walls ──
  const barrelM: THREE.Matrix4[] = [];
  const barrelC: THREE.Color[] = [];
  const consoleM: THREE.Matrix4[] = [];
  const sconceM: THREE.Matrix4[] = [];
  const conduitM: THREE.Matrix4[] = [];
  const pal = L.id === 'tower' || L.id === 'yacht' ? ['#5a1a1a', '#1a3a5a', '#d8d2c0'] : ['#a0201c', '#1f4f8a', '#4a5a40', '#8a7a2a'];
  for (const [x, z] of floorCells) {
    if (nearDoor(x, z)) continue;
    const { cx, cz } = cellOf(x, z);
    const wd = wallDir(x, z, 20);
    if (wd < 0) continue;
    const [dx, dz] = DIRS[wd];
    const along = hash(x, z, 21) - 0.5; // slide along the wall
    const tx = -dz;
    const tz = dx;
    const r = hash(x, z, 22);
    if (r < 0.14) {
      // A cluster of 2 barrels.
      for (let k = 0; k < 2; k++) {
        const o = (k - 0.5) * 0.75 + along * 0.8;
        barrelM.push(place(cx + dx * 1.72 + tx * o, 0.45, cz + dz * 1.72 + tz * o, 0, 1, 1, 1));
        barrelC.push(new THREE.Color(pal[Math.floor(hash(x, z, 23 + k) * pal.length)]));
      }
    } else if (r < 0.26 && L.id !== 'tower' && L.id !== 'yacht') {
      consoleM.push(place(cx + dx * 1.72, 0.55, cz + dz * 1.72, Math.atan2(-dx, -dz), 1.4, 1.1, 0.5));
    } else if (r < 0.46) {
      sconceM.push(place(cx + dx * 1.9 + tx * along, 2.5, cz + dz * 1.9 + tz * along, Math.atan2(-dx, -dz), 0.22, 0.5, 0.12));
    } else if (r < 0.56) {
      conduitM.push(place(cx + dx * 1.92 + tx * 0.4, WALL_H / 2, cz + dz * 1.92 + tz * 0.4, 0, 0.1, WALL_H, 0.1));
    }
  }
  const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14);
  const barrels = addInst(drum, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.7 }), barrelM, barrelC, high);
  if (barrels) barrels.instanceColor!.needsUpdate = true;
  addInst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.5, metalness: 0.6 }), consoleM, undefined, high);
  // Console screens: a glowing quad in front of each console (bloom picks it up).
  const screenM: THREE.Matrix4[] = [];
  const scr = new THREE.Vector3();
  for (const m of consoleM) {
    m.decompose(scr, q, new THREE.Vector3());
    e.setFromQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    screenM.push(place(scr.x + fwd.x * 0.26, 0.85, scr.z + fwd.z * 0.26, e.y, 1.1, 0.7, 1));
  }
  addInst(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: screenTex(spec.grade.high[1] > 1.04 ? '#60ff90' : '#60d0ff'), color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false }), screenM);
  addInst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(2.4), toneMapped: false }), sconceM);
  addInst(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), new THREE.MeshStandardMaterial({ color: '#3a3f44', metalness: 0.8, roughness: 0.45 }), conduitM);


  // ── Windows on the outer walls: sky and terrain beyond (tower, yacht deck, farm) ──
  const vt = viewTex(L.id);
  if (vt) {
    const glass: THREE.Matrix4[] = [];
    const frame: THREE.Matrix4[] = [];
    for (const [x, z] of floorCells) {
      if (nearDoor(x, z) || hash(x, z, 40) > 0.5) continue;
      DIRS.forEach(([dx, dz]) => {
        const ex = x + dx;
        const ez = z + dz;
        if (!isWall(ex, ez) || ex > 0 && ex < grid.w - 1 && ez > 0 && ez < grid.h - 1) return;
        const { cx, cz } = cellOf(x, z);
        const ry = Math.atan2(-dx, -dz);
        const wx = cx + dx * (SIZE / 2 - 0.03);
        const wz = cz + dz * (SIZE / 2 - 0.03);
        glass.push(place(wx, 2.05, wz, ry, 2.6, 1.5, 1));
        for (const [ox, oy, sw, sh] of [[0, 0.78, 2.8, 0.14], [0, -0.78, 2.8, 0.14], [-1.36, 0, 0.14, 1.7], [1.36, 0, 0.14, 1.7], [0, 0, 0.07, 1.5]] as const) {
          const tx = -dz;
          const tz = dx;
          frame.push(place(wx - dx * 0.0 + tx * ox + dx * -0.02, 2.05 + oy, wz + tz * ox + dz * -0.02, ry, sw, sh, 0.1));
        }
      });
    }
    addInst(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: vt, color: new THREE.Color(1.2, 1.2, 1.2), toneMapped: false }), glass);
    addInst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#1c1c20', metalness: 0.7, roughness: 0.4 }), frame);
  }

  // ── Light shafts from the ceiling panels (cheap fake volumetrics) ──
  const shaft = new THREE.MeshBasicMaterial({ map: shaftTex(), color: new THREE.Color(L.theme.light), transparent: true, opacity: 0.04, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const cone = new THREE.CylinderGeometry(0.3, 1.25, WALL_H - 0.2, 14, 1, true);
  let shafts = 0;
  for (const [x, z] of floorCells) {
    if ((x + z * 2) % 3 !== 0 || hash(x, z, 30) > 0.28 || shafts >= (high ? 14 : 6)) continue;
    const { cx, cz } = cellOf(x, z);
    const m = new THREE.Mesh(cone, shaft);
    m.position.set(cx, WALL_H / 2 - 0.05, cz);
    m.renderOrder = 5;
    g.add(m);
    shafts++;
  }

  // ── Dust motes drifting through the air around the agent ──
  const N = high ? 140 : 60;
  const dp = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) dp[i] = (Math.random() - 0.5) * 18;
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.035, color: new THREE.Color(L.theme.light).multiplyScalar(1.5), transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true, toneMapped: false }));
  dust.frustumCulled = false;
  g.add(dust);
  const local = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) local[i] = dp[i];
  let t = 0;
  return {
    update(dt, cam) {
      t += dt;
      for (let i = 0; i < N; i++) {
        local[i * 3] += Math.sin(t * 0.3 + i) * 0.1 * dt;
        local[i * 3 + 1] += (0.06 + Math.sin(t * 0.5 + i * 1.7) * 0.05) * dt;
        local[i * 3 + 2] += Math.cos(t * 0.27 + i * 0.7) * 0.1 * dt;
        for (let k = 0; k < 3; k++) {
          const half = k === 1 ? 2 : 9;
          if (local[i * 3 + k] > half) local[i * 3 + k] -= half * 2;
        }
        dp[i * 3] = cam.x + local[i * 3];
        dp[i * 3 + 1] = Math.max(0.1, Math.min(WALL_H - 0.1, 1.8 + local[i * 3 + 1]));
        dp[i * 3 + 2] = cam.z + local[i * 3 + 2];
      }
      dg.attributes.position.needsUpdate = true;
    },
  };
}
