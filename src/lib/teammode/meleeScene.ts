/**
 * TERRORNODE MELEE: the plaza round the tower, drawn (three.js). Geometry comes from ./arena.ts (the same terraces,
 * cover and tower the server collides with), so what you hide behind is what stops the rounds.
 *
 * Built for 64 players on one screen and a live stream, at a playable frame rate:
 *  - one lathe for the whole terraced bowl, one for the stands (two draw calls for ~40,000 m² of stadium);
 *  - every repeated prop is an InstancedMesh, split into 8 sectors with their own bounding spheres so the frustum
 *    culls whole sectors behind the camera (pillars, crates, barriers, masts, seat lights, the skyline);
 *  - the tower is a THREE.LOD (full detail near, a three-piece stand-in far away);
 *  - no dynamic point lights: the neon is emissive + bloom; one directional moon, shadows on High only.
 * Modern look: wet dark concrete under the city's environment map, cyan/magenta neon edge lines, a red TERRORNODE
 * eye, sweeping searchlights, holo boards on the stands.
 */
import * as THREE from 'three';
import { MELEE, MELEE_R, TIERS, TOWER_R, heightAt, type Cover } from './arena';

export type MeleeScene = {
  group: THREE.Group;
  update: (dt: number, t: number) => void;
  /** The boss phase: the tower's eye and bands burn red. */
  setBoss: (on: boolean) => void;
  dispose: () => void;
  stats: () => { instances: number; meshes: number };
};

const SECTORS = 8;
const sectorOf = (x: number, z: number) => ((Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * SECTORS) % SECTORS) + SECTORS) % SECTORS;

export function buildMelee(o: { high: boolean; key: string; rim: string }): MeleeScene {
  const group = new THREE.Group();
  group.name = 'tn-melee';
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  let instances = 0;
  let meshes = 0;
  const add = (m: THREE.Object3D) => (group.add(m), meshes++, m);
  const key = new THREE.Color(o.key);
  const rim = new THREE.Color(o.rim);
  const red = new THREE.Color('#ff2a3a');

  // ── materials ──
  const concrete = keep(new THREE.MeshStandardMaterial({ color: '#3a3f4c', roughness: 0.5, metalness: 0.35, envMapIntensity: 1.2 }));
  // the plaza floor: polished basalt tiles with thin seams (a canvas texture, also the roughness: wet seams shine)
  const tiles = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#5a5f6c';
    g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = 78 + Math.floor(Math.random() * 30);
        g.fillStyle = `rgb(${v},${v + 4},${v + 14})`;
        g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
      }
    const t = keep(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(9, 9);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const floor = keep(new THREE.MeshStandardMaterial({ color: '#4a5264', map: tiles, roughness: 0.2, metalness: 0.55, envMapIntensity: 1.6 }));
  const steel = keep(new THREE.MeshStandardMaterial({ color: '#4a5060', roughness: 0.28, metalness: 0.85, envMapIntensity: 1.3 }));
  // the two lathes (bowl, stands) are seen from both sides of their profile: double-sided, lit either way
  const bowlMat = keep(new THREE.MeshStandardMaterial({ color: '#3a3f4c', roughness: 0.38, metalness: 0.4, envMapIntensity: 1.3, side: THREE.DoubleSide }));
  const neon = (c: THREE.Color, k = 2.6) => keep(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), toneMapped: false }));
  const neonKey = neon(key);
  const neonRim = neon(rim, 2.2);
  const neonRed = neon(red, 3);

  // ── the bowl: one lathe from the tower foot to the rim wall (terraces and ramps from arena.ts) ──
  const prof: THREE.Vector2[] = [new THREE.Vector2(TOWER_R - 0.5, -0.02)];
  for (let i = 0; i < TIERS.length; i++) {
    const [r0, r1, h] = TIERS[i];
    prof.push(new THREE.Vector2(Math.max(r0, TOWER_R), h), new THREE.Vector2(r1, h));
  }
  prof.push(new THREE.Vector2(MELEE_R, 6.2), new THREE.Vector2(MELEE_R + 1.2, 6.2), new THREE.Vector2(MELEE_R + 1.2, -0.5));
  const bowl = add(new THREE.Mesh(keep(new THREE.LatheGeometry(prof, o.high ? 160 : 96)), bowlMat)) as THREE.Mesh;
  bowl.receiveShadow = o.high;
  // the plaza floor: polished, darker, with inlaid rings
  const plaza = add(new THREE.Mesh(keep(new THREE.RingGeometry(TOWER_R - 0.5, TIERS[0][1], o.high ? 128 : 72, 1)), floor)) as THREE.Mesh;
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  plaza.receiveShadow = o.high;
  const ring = (r: number, y: number, w: number, mat: THREE.Material) => {
    const m = add(new THREE.Mesh(keep(new THREE.RingGeometry(r - w, r, 128, 1)), mat)) as THREE.Mesh;
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
  };
  ring(TOWER_R + 2.2, 0.03, 0.12, neonRed);
  ring(20, 0.03, 0.08, neonKey);
  ring(TIERS[0][1], 0.03, 0.2, neonKey);
  for (let i = 1; i < TIERS.length; i++) {
    ring(TIERS[i][0] + 0.25, TIERS[i][2] + 0.03, 0.18, i % 2 ? neonRim : neonKey);
    ring(TIERS[i][1], TIERS[i][2] + 0.03, 0.12, neonKey);
  }
  // radial runway lines on the floor toward the tower: the sightlines
  {
    const g = keep(new THREE.PlaneGeometry(0.14, TIERS[0][1] - TOWER_R - 3));
    const lines = new THREE.InstancedMesh(g, neonKey, 16);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = (TIERS[0][1] + TOWER_R + 3) / 2;
      m4.makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      m4.setPosition(Math.sin(a) * r, 0.025, Math.cos(a) * r);
      lines.setMatrixAt(i, m4);
    }
    instances += 16;
    add(lines);
  }

  // ── the stands: a second lathe rising behind the rim, with seat lights (instanced) ──
  const standProf = [new THREE.Vector2(MELEE_R + 1.2, 6.2), new THREE.Vector2(MELEE_R + 4, 8), new THREE.Vector2(MELEE_R + 34, 30), new THREE.Vector2(MELEE_R + 36, 34), new THREE.Vector2(MELEE_R + 40, 34), new THREE.Vector2(MELEE_R + 40, 0)];
  add(new THREE.Mesh(keep(new THREE.LatheGeometry(standProf, o.high ? 128 : 72)), bowlMat));
  // the stands read as a stadium: neon tread lines up the rake, a canopy ring with a lit underside
  for (let i = 1; i <= 9; i++) {
    const k = i / 10;
    const r = MELEE_R + 4 + k * 30;
    const y = 8 + k * 22;
    const m = new THREE.Mesh(keep(new THREE.TorusGeometry(r, i % 3 === 0 ? 0.09 : 0.05, 4, o.high ? 160 : 96)), i % 3 === 0 ? neonKey : neonRim);
    m.rotation.x = Math.PI / 2;
    m.position.y = y + 0.05;
    add(m);
  }
  {
    const canopy = new THREE.Mesh(keep(new THREE.RingGeometry(MELEE_R + 18, MELEE_R + 40, o.high ? 128 : 72, 1)), bowlMat);
    canopy.rotation.x = Math.PI / 2;
    canopy.position.y = 44;
    add(canopy);
    const lip = new THREE.Mesh(keep(new THREE.TorusGeometry(MELEE_R + 18, 0.25, 6, o.high ? 160 : 96)), neonKey);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 43.8;
    add(lip);
  }

  // instanced props, one InstancedMesh per sector so the frustum culls them sector by sector
  const scatter = (geo: THREE.BufferGeometry, mat: THREE.Material, pts: { x: number; y: number; z: number; ry?: number; s?: THREE.Vector3 }[], shadow = false) => {
    const by: (typeof pts)[] = Array.from({ length: SECTORS }, () => []);
    for (const p of pts) by[sectorOf(p.x, p.z)].push(p);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const list of by) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.ry ?? 0);
        m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, p.s ?? one);
        im.setMatrixAt(i, m4);
      });
      im.computeBoundingSphere();
      im.castShadow = shadow && o.high;
      im.receiveShadow = o.high;
      instances += list.length;
      add(im);
    }
  };
  {
    const pts: { x: number; y: number; z: number; s: THREE.Vector3 }[] = [];
    const rows = o.high ? 10 : 6;
    const per = o.high ? 160 : 90;
    for (let r = 0; r < rows; r++) {
      const k = r / rows;
      const rad = MELEE_R + 6 + k * 27;
      const y = 9.5 + k * 20;
      for (let i = 0; i < per; i++) {
        if (Math.random() < 0.6) continue; // a scattered crowd of phone lights, not a grid
        const a = ((i + (r % 2) * 0.5) / per) * Math.PI * 2;
        pts.push({ x: Math.sin(a) * rad, y, z: Math.cos(a) * rad, s: new THREE.Vector3(1, 1, 1) });
      }
    }
    const seatA = neon(key, 0.9);
    const seatB = neon(rim, 0.8);
    const g = keep(new THREE.BoxGeometry(0.16, 0.1, 0.16));
    scatter(g, seatA, pts.filter((_, i) => i % 3 !== 0));
    scatter(g, seatB, pts.filter((_, i) => i % 3 === 0));
  }

  // ── cover (pillars, crates, barriers, masts): arena.ts positions, instanced per sector ──
  const pillars = MELEE.cover.filter((c) => c.kind === 'pillar');
  const crates = MELEE.cover.filter((c) => c.kind === 'crate');
  const barriers = MELEE.cover.filter((c) => c.kind === 'barrier');
  const at = (c: Cover) => heightAt(MELEE, c.x, c.z);
  {
    const g = keep(new THREE.CylinderGeometry(1, 1, 1, o.high ? 20 : 12, 1));
    scatter(g, steel, pillars.map((c) => ({ x: c.x, y: at(c) + c.h / 2, z: c.z, s: new THREE.Vector3(c.r, c.h, c.r) })), true);
    // neon collars on every pillar, a glowing cap on the rim masts
    const collar = keep(new THREE.CylinderGeometry(1.04, 1.04, 0.12, o.high ? 20 : 12, 1, true));
    scatter(collar, neonKey, pillars.flatMap((c) => [1.2, c.h * 0.55, c.h - 0.3].map((y) => ({ x: c.x, y: at(c) + y, z: c.z, s: new THREE.Vector3(c.r, 1, c.r) }))));
    const cap = keep(new THREE.SphereGeometry(1, 12, 8));
    scatter(cap, neonRim, pillars.filter((c) => c.h >= 10).map((c) => ({ x: c.x, y: at(c) + c.h + 0.4, z: c.z, s: new THREE.Vector3(0.7, 0.7, 0.7) })));
  }
  {
    const g = keep(new THREE.BoxGeometry(1, 1, 1));
    scatter(g, steel, crates.map((c) => ({ x: c.x, y: at(c) + c.h / 2, z: c.z, ry: Math.atan2(c.x, c.z), s: new THREE.Vector3(c.r * 1.8, c.h, c.r * 1.4) })), true);
    const strip = keep(new THREE.BoxGeometry(1, 0.06, 1.02));
    scatter(strip, neonRim, crates.map((c) => ({ x: c.x, y: at(c) + c.h * 0.7, z: c.z, ry: Math.atan2(c.x, c.z), s: new THREE.Vector3(c.r * 1.82, 1, c.r * 1.42) })));
  }
  {
    const g = keep(new THREE.BoxGeometry(1, 1, 1));
    // waist-high barriers: long side tangent to the ring
    scatter(g, concrete, barriers.map((c) => ({ x: c.x, y: at(c) + c.h / 2, z: c.z, ry: Math.atan2(c.x, c.z) + Math.PI / 2, s: new THREE.Vector3(c.r * 0.7, c.h, c.r * 2.6) })), true);
    const strip = keep(new THREE.BoxGeometry(1.02, 0.05, 1.02));
    scatter(strip, neonKey, barriers.map((c) => ({ x: c.x, y: at(c) + c.h, z: c.z, ry: Math.atan2(c.x, c.z) + Math.PI / 2, s: new THREE.Vector3(c.r * 0.7, 1, c.r * 2.6) })));
  }
  // horde gates: red arches in the rim wall
  {
    const g = keep(new THREE.TorusGeometry(3.2, 0.16, 8, 32, Math.PI));
    scatter(g, neonRed, MELEE.gates.slice(0, 8).map((p) => ({ x: (p.x / 76) * (MELEE_R + 0.9), y: TIERS[TIERS.length - 1][2], z: (p.z / 76) * (MELEE_R + 0.9), ry: Math.atan2(p.x, p.z) + Math.PI / 2 })));
  }

  // ── the skyline beyond the stands: instanced towers (dark glass, one neon strip each) ──
  {
    const pts: { x: number; y: number; z: number; ry: number; s: THREE.Vector3 }[] = [];
    const strips: typeof pts = [];
    const n = o.high ? 90 : 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.05;
      const r = 150 + Math.random() * 70;
      const h = 40 + Math.random() * 110;
      const w = 10 + Math.random() * 14;
      pts.push({ x: Math.sin(a) * r, y: h / 2, z: Math.cos(a) * r, ry: a, s: new THREE.Vector3(w, h, w * 0.8) });
      strips.push({ x: Math.sin(a) * (r - w * 0.42), y: h * (0.3 + Math.random() * 0.6), z: Math.cos(a) * (r - w * 0.42), ry: a, s: new THREE.Vector3(w * 0.9, 0.5, 0.2) });
    }
    const glass = keep(new THREE.MeshStandardMaterial({ color: '#0b0e18', roughness: 0.15, metalness: 0.95 }));
    scatter(keep(new THREE.BoxGeometry(1, 1, 1)), glass, pts);
    scatter(keep(new THREE.BoxGeometry(1, 1, 1)), neonRim, strips.filter((_, i) => i % 2));
    scatter(keep(new THREE.BoxGeometry(1, 1, 1)), neonKey, strips.filter((_, i) => !(i % 2)));
  }

  // ── holo boards on the stands ──
  const boards: THREE.Mesh[] = [];
  {
    const lines = ['TERRORNODE', 'NPG', 'ASSAULT', 'テロノード', 'TOKENBLASTER', 'EROBOTZ'];
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 512, 0);
      grad.addColorStop(0, i % 2 ? o.rim : o.key);
      grad.addColorStop(1, '#ffffff');
      g.fillStyle = 'rgba(4,6,16,0.35)';
      g.fillRect(0, 0, 512, 128);
      g.fillStyle = grad;
      g.font = '900 italic 86px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(lines[i], 256, 68);
      const tex = keep(new THREE.CanvasTexture(c));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(28, 7)), mat);
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const r = MELEE_R + 30;
      m.position.set(Math.sin(a) * r, 38, Math.cos(a) * r);
      m.lookAt(0, 30, 0);
      boards.push(m);
      add(m);
    }
  }

  // ── the TERRORNODE tower: LOD (near: banded, ribbed, eye; far: three pieces) ──
  const towerLod = new THREE.LOD();
  const bands: THREE.Mesh[] = [];
  const bandMat = neon(red, 2.4);
  const eyeMat = neon(red, 4);
  {
    const near = new THREE.Group();
    const segs = o.high ? 32 : 20;
    let y = 0;
    const levels = [
      [TOWER_R, TOWER_R * 0.92, 18],
      [TOWER_R * 0.9, TOWER_R * 0.78, 26],
      [TOWER_R * 0.76, TOWER_R * 0.62, 30],
      [TOWER_R * 0.6, TOWER_R * 0.48, 30],
      [TOWER_R * 0.46, TOWER_R * 0.3, 26],
    ];
    for (const [r0, r1, h] of levels) {
      const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(r1, r0, h, segs, 1)), steel);
      m.position.y = y + h / 2;
      m.castShadow = o.high;
      near.add(m);
      const b = new THREE.Mesh(keep(new THREE.CylinderGeometry(r1 * 1.02, r1 * 1.02, 0.5, segs, 1, true)), bandMat);
      b.position.y = y + h - 0.6;
      near.add(b);
      bands.push(b);
      y += h;
    }
    // vertical ribs of light
    const rib = keep(new THREE.BoxGeometry(0.22, 1, 0.22));
    const ribs = new THREE.InstancedMesh(rib, neonKey, 8);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      m4.compose(new THREE.Vector3(Math.sin(a) * TOWER_R * 0.97, 9, Math.cos(a) * TOWER_R * 0.97), new THREE.Quaternion(), new THREE.Vector3(1, 18, 1));
      ribs.setMatrixAt(i, m4);
    }
    instances += 8;
    near.add(ribs);
    // four tower doors (the horde and the boss come out of them)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      const d = new THREE.Mesh(keep(new THREE.PlaneGeometry(4.5, 6)), neonRed);
      d.position.set(Math.sin(a * 2) * (TOWER_R + 0.05), 3, Math.cos(a * 2) * (TOWER_R + 0.05));
      d.lookAt(d.position.x * 2, 3, d.position.z * 2);
      near.add(d);
    }
    const eye = new THREE.Mesh(keep(new THREE.SphereGeometry(2.6, 24, 16)), eyeMat);
    eye.position.y = y + 3;
    near.add(eye);
    const spire = new THREE.Mesh(keep(new THREE.ConeGeometry(1.1, 18, 12)), steel);
    spire.position.y = y + 12;
    near.add(spire);
    towerLod.addLevel(near, 0);
    const far = new THREE.Group();
    const body = new THREE.Mesh(keep(new THREE.CylinderGeometry(TOWER_R * 0.35, TOWER_R, y, 10, 1)), steel);
    body.position.y = y / 2;
    far.add(body);
    const farEye = new THREE.Mesh(keep(new THREE.SphereGeometry(2.6, 10, 8)), eyeMat);
    farEye.position.y = y + 3;
    far.add(farEye);
    towerLod.addLevel(far, 220);
    add(towerLod);
  }

  // ── searchlights: additive cones sweeping from the rim (no real lights) ──
  const beams: THREE.Mesh[] = [];
  {
    const g = keep(new THREE.ConeGeometry(3.5, 90, 24, 1, true));
    g.translate(0, -45, 0);
    for (let i = 0; i < 4; i++) {
      const mat = keep(new THREE.MeshBasicMaterial({ color: (i % 2 ? rim : key).clone().multiplyScalar(0.07), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      const b = new THREE.Mesh(g, mat);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.position.set(Math.sin(a) * (MELEE_R + 30), 36, Math.cos(a) * (MELEE_R + 30));
      beams.push(b);
      add(b);
    }
  }

  // ── a moon key light (the city's hemisphere fills); shadows on High only ──
  const moon = new THREE.DirectionalLight('#a8bcff', 2.2);
  // a cool fill from below the rim and a warm tower glow on the floor (ambient, no per-pixel cost)
  group.add(new THREE.HemisphereLight('#4a6cff', '#2a0a14', 0.9));
  moon.position.set(60, 120, 40);
  moon.target.position.set(0, 0, 0);
  if (o.high) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const s = moon.shadow.camera;
    [s.left, s.right, s.top, s.bottom, s.near, s.far] = [-90, 90, 90, -90, 10, 300];
    moon.shadow.bias = -0.0005;
  }
  group.add(moon, moon.target);

  let boss = false;
  return {
    group,
    update(dt, t) {
      const pulse = 0.75 + 0.25 * Math.sin(t * (boss ? 6 : 1.6));
      bandMat.color.copy(red).multiplyScalar((boss ? 3.6 : 2.2) * pulse);
      eyeMat.color.copy(red).multiplyScalar((boss ? 6 : 3.2) * (0.85 + 0.15 * Math.sin(t * 3.1)));
      beams.forEach((b, i) => {
        const a = t * 0.23 + i * 1.7;
        b.lookAt(Math.sin(a) * 40, 0, Math.cos(a * 0.8) * 40);
        b.rotateX(-Math.PI / 2);
      });
      for (const [i, b] of boards.entries()) (b.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.2 * Math.sin(t * 2 + i);
      void dt;
    },
    setBoss(on) {
      boss = on;
    },
    stats: () => ({ instances, meshes }),
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
      group.traverse((x) => (x as THREE.InstancedMesh).isInstancedMesh && (x as THREE.InstancedMesh).dispose());
    },
  };
}
