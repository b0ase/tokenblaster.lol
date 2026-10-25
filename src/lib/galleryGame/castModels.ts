/**
 * Hand weapons for the Erobot cast (cast.ts), built once at load: each is one merged, vertex-coloured
 * BufferGeometry (one draw call per weapon), shared by every body of that character. Low tier builds fewer
 * segments (LOD). Built in metres with the grip at the origin, the business end along -X (the right hand's finger
 * axis at the Mixamo identity rest).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponKind } from './cast';

type Part = THREE.BufferGeometry;
const C = new THREE.Color();

function tint(g: Part, color: string): Part {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  C.set(color);
  for (let i = 0; i < n; i++) C.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function place(g: Part, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): Part {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  return g;
}

function merge(parts: Part[]): Part {
  const clean = parts.map((p) => {
    // mixed indexed (sphere, box) and non-indexed (icosahedron) parts: flatten all of them
    const g = p.index ? p.toNonIndexed() : p;
    if (g !== p) p.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') g.deleteAttribute(k);
    return g;
  });
  const out = mergeGeometries(clean, false)!;
  clean.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

// ── Weapons ───────────────────────────────────────────────────────────────────────────────────────────────

const box = (w: number, h: number, d: number, at: [number, number, number], color: string, rot: [number, number, number] = [0, 0, 0]) => tint(place(new THREE.BoxGeometry(w, h, d), at, rot), color);
const cyl = (r0: number, r1: number, len: number, seg: number, at: [number, number, number], rot: [number, number, number], color: string) => tint(place(new THREE.CylinderGeometry(r0, r1, len, seg), at, rot), color);
const ALONG_X: [number, number, number] = [0, 0, Math.PI / 2];

/** Returns the merged mesh geometry and the muzzle (local, metres) the shots leave from. */
export function buildWeapon(kind: WeaponKind, high: boolean): { geo: Part | null; muzzle: THREE.Vector3 } {
  const seg = high ? 12 : 6;
  const chrome = '#d9dde6';
  const dark = '#1b1d26';
  const pink = '#ff3d9a';
  const p: Part[] = [];
  const muzzle = new THREE.Vector3();
  switch (kind) {
    case 'blaster': // Payne: twin-barrel pink blaster
      p.push(box(0.34, 0.12, 0.1, [-0.14, 0.04, 0], dark), box(0.08, 0.16, 0.08, [0, -0.06, 0], dark, [0, 0, -0.3]));
      p.push(cyl(0.035, 0.035, 0.32, seg, [-0.36, 0.06, 0.03], ALONG_X, chrome), cyl(0.035, 0.035, 0.32, seg, [-0.36, 0.06, -0.03], ALONG_X, chrome));
      p.push(box(0.2, 0.03, 0.11, [-0.12, 0.115, 0], pink));
      muzzle.set(-0.54, 0.06, 0);
      break;
    case 'rockets': // Peggy: a four-tube pod launcher on the forearm
      p.push(box(0.5, 0.22, 0.22, [-0.2, 0.08, 0], chrome));
      for (const [y, z] of [[0.13, 0.06], [0.13, -0.06], [0.03, 0.06], [0.03, -0.06]] as const) p.push(cyl(0.045, 0.045, 0.06, seg, [-0.47, y, z], ALONG_X, pink));
      p.push(box(0.12, 0.05, 0.24, [-0.05, 0.22, 0], pink));
      muzzle.set(-0.52, 0.08, 0);
      break;
    case 'rail': // Matoko: long rail rifle with a teal coil
      p.push(box(0.9, 0.08, 0.07, [-0.35, 0.05, 0], dark), box(0.18, 0.14, 0.06, [0.12, -0.02, 0], dark));
      p.push(box(0.75, 0.02, 0.1, [-0.45, 0.1, 0], chrome), box(0.75, 0.02, 0.1, [-0.45, 0.0, 0], chrome));
      for (let i = 0; i < 4; i++) p.push(cyl(0.06, 0.06, 0.04, seg, [-0.2 - i * 0.14, 0.05, 0], ALONG_X, '#16d6c2'));
      muzzle.set(-0.84, 0.05, 0);
      break;
    case 'axe': // Phi-Phi RED AXE / Scarlet BLACK AX (tinted per character at build time via `pink` swap below)
      p.push(cyl(0.03, 0.03, 0.9, seg, [0, 0.3, 0], [0, 0, 0], dark));
      p.push(tint(place(new THREE.CylinderGeometry(0.32, 0.32, 0.04, seg, 1, false, 0, Math.PI), [0, 0.62, 0], [Math.PI / 2, 0, Math.PI / 2]), '#e8233a'));
      p.push(box(0.08, 0.18, 0.06, [0, 0.62, 0], chrome));
      muzzle.set(0, 0.62, 0);
      break;
    case 'flail': // Hikaru THRASHER: chain flail with a spiked chrome head
      p.push(cyl(0.035, 0.03, 0.35, seg, [0, 0.12, 0], [0, 0, 0], dark));
      for (let i = 0; i < 4; i++) p.push(tint(place(new THREE.TorusGeometry(0.04, 0.012, 3, 6), [0, 0.33 + i * 0.07, 0], [0, i % 2 ? Math.PI / 2 : 0, 0]), chrome));
      p.push(tint(place(new THREE.IcosahedronGeometry(0.13, high ? 1 : 0), [0, 0.68, 0]), chrome));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        p.push(tint(place(new THREE.ConeGeometry(0.035, 0.12, 4), [Math.cos(a) * 0.15, 0.68, Math.sin(a) * 0.15], [0, -a, -Math.PI / 2]), '#27e6ff'));
      }
      muzzle.set(0, 0.68, 0);
      break;
    case 'glove': // Yamarashii BOXING GLOVE: oversized, glossy red
      p.push(tint(place(new THREE.SphereGeometry(0.2, seg, seg / 2), [-0.12, 0, 0], [0, 0, 0], [1.25, 1, 1.05]), '#e8233a'));
      p.push(cyl(0.13, 0.13, 0.14, seg, [0.06, 0, 0], ALONG_X, '#ffffff'));
      muzzle.set(-0.3, 0, 0);
      break;
    case 'paddle': // Miyuki PADDLE: a chrome-edged battle paddle
      p.push(cyl(0.03, 0.03, 0.45, seg, [0, 0.12, 0], [0, 0, 0], dark));
      p.push(tint(place(new THREE.CylinderGeometry(0.2, 0.2, 0.05, seg * 2), [0, 0.52, 0], [Math.PI / 2, 0, 0], [1, 1, 1.5]), '#ff2a3a'));
      p.push(tint(place(new THREE.TorusGeometry(0.2, 0.02, 3, seg * 2), [0, 0.52, 0], [0, 0, 0], [1, 1.5, 1]), chrome));
      muzzle.set(0, 0.52, 0);
      break;
    case 'palm':
    default:
      return { geo: null, muzzle };
  }
  return { geo: merge(p), muzzle };
}

export function weaponMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.75, envMapIntensity: 1.4 });
}

/** Recolour a built weapon geometry's red parts (Scarlet's axe is BLACK AX in canon). */
export function recolour(geo: Part, from: string, to: string) {
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  const f = new THREE.Color(from);
  const t = new THREE.Color(to);
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(col.getX(i) - f.r) + Math.abs(col.getY(i) - f.g) + Math.abs(col.getZ(i) - f.b) < 0.02) col.setXYZ(i, t.r, t.g, t.b);
  }
  col.needsUpdate = true;
}
