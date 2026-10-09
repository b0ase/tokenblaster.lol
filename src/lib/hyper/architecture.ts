/**
 * bRacer megastructure: geometry that follows the track (solid bevelled slab, energy barriers, cable runs,
 * tunnels) and trackside architecture (pylons, under-girders, gantries, grandstand, pit block).
 *
 * Swept meshes are built in culled chunks with analytic normals (no faceting, no chunk seams); props are
 * instanced per chunk so the frustum culls them.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { frameAt, HALF_W, newFrame, STEP, surfaceH, type Track } from './track';

export type Prof = [number, number][];
export type SweepOpts = {
  /** Crisp bevels: each profile segment gets its own normals. */
  hard?: boolean;
  /** Profile metres per texture repeat (u); unset = 0..1 across the profile. */
  uLen?: number;
  /** Track metres per texture repeat (v). */
  vLen: number;
  /** Follow half-pipe surface height (edges clamp to the deck edge). */
  pipe?: boolean;
};

/**
 * Sweep a profile along samples i0..i1 (inclusive, may exceed n to close the loop). Profiles are ordered
 * so D x T is the outward (visible) normal: for a solid, go clockwise as seen from behind (r right, u up).
 */
export function sweepGeo(tr: Track, prof: Prof, i0: number, i1: number, o: SweepOpts) {
  const n = tr.n;
  const m = prof.length;
  const rows = i1 - i0 + 1;
  const P = new Float32Array((rows + 2) * m * 3);
  for (let r = 0; r < rows + 2; r++) {
    const k = (((i0 - 1 + r) % n) + n) % n;
    for (let j = 0; j < m; j++) {
      const [lat, h0] = prof[j];
      const lc = Math.max(-HALF_W, Math.min(HALF_W, lat));
      const h = h0 + (o.pipe ? surfaceH(tr.pipe[k], lc) : 0);
      const q = (r * m + j) * 3;
      P[q] = tr.px[k] + tr.rx[k] * lat + tr.ux[k] * h;
      P[q + 1] = tr.py[k] + tr.ry[k] * lat + tr.uy[k] * h;
      P[q + 2] = tr.pz[k] + tr.rz[k] * lat + tr.uz[k] * h;
    }
  }
  const arc = [0];
  for (let j = 1; j < m; j++) arc.push(arc[j - 1] + Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]));
  const uOf = (j: number) => (o.uLen ? arc[j] / o.uLen : arc[j] / (arc[m - 1] || 1));
  const cols = o.hard ? (m - 1) * 2 : m;
  const pos = new Float32Array(rows * cols * 3);
  const nor = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const T = new THREE.Vector3();
  const D = new THREE.Vector3();
  const D2 = new THREE.Vector3();
  const N = new THREE.Vector3();
  const get = (r: number, j: number, out: THREE.Vector3) => {
    const q = (r * m + j) * 3;
    return out.set(P[q], P[q + 1], P[q + 2]);
  };
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const seg = (r: number, j: number, out: THREE.Vector3) => out.copy(get(r, j + 1, A)).sub(get(r, j, B)).normalize();
  for (let r = 0; r < rows; r++) {
    const rr = r + 1;
    for (let c = 0; c < cols; c++) {
      const j = o.hard ? (c >> 1) + (c & 1) : c;
      get(rr + 1, j, T).sub(get(rr - 1, j, A)).normalize();
      if (o.hard) seg(rr, c >> 1, D);
      else {
        seg(rr, Math.max(0, j - 1), D);
        seg(rr, Math.min(m - 2, j), D2);
        D.add(D2).normalize();
      }
      N.crossVectors(D, T).normalize();
      const q = (r * cols + c) * 3;
      get(rr, j, A);
      pos[q] = A.x;
      pos[q + 1] = A.y;
      pos[q + 2] = A.z;
      nor[q] = N.x;
      nor[q + 1] = N.y;
      nor[q + 2] = N.z;
      uv[(r * cols + c) * 2] = uOf(j);
      uv[(r * cols + c) * 2 + 1] = ((i0 + r) * STEP) / o.vLen;
    }
  }
  const idx: number[] = [];
  const step = o.hard ? 2 : 1;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c += step) {
    const a = r * cols + c;
    const b = a + 1;
    const cc = a + cols;
    const d = cc + 1;
    idx.push(a, b, cc, b, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export type Own = <T extends { dispose(): void }>(o: T) => T;

/** Add a swept profile as frustum-culled chunks. range is in sample indices [a, b) (b may be n to close). */
export function addSweep(group: THREE.Object3D, own: Own, tr: Track, prof: Prof, mat: THREE.Material, o: SweepOpts, range?: [number, number], chunk = 80) {
  const [a, b] = range ?? [0, tr.n];
  const out: THREE.Mesh[] = [];
  for (let i = a; i < b; i += chunk) {
    const e = Math.min(b, i + chunk);
    const m = new THREE.Mesh(own(sweepGeo(tr, prof, i, e, o)), mat);
    group.add(m);
    out.push(m);
  }
  return out;
}

/** Mirror a right-side profile to the left and join: input runs from the deck edge outward and around. */
export function mirrorJoin(right: Prof): Prof {
  const left = right.map(([l, h]) => [-l, h] as [number, number]).reverse();
  return [...right, ...left];
}

/** Instanced props bucketed by lap position so each bucket can be frustum culled. */
export class Bucketed {
  private buckets = new Map<number, THREE.Matrix4[]>();
  private colors = new Map<number, THREE.Color[]>();
  constructor(private span: number) {}
  add(s: number, m: THREE.Matrix4, c?: THREE.Color) {
    const k = Math.floor(s / this.span);
    let a = this.buckets.get(k);
    if (!a) {
      a = [];
      this.buckets.set(k, a);
      this.colors.set(k, []);
    }
    a.push(m);
    if (c) this.colors.get(k)!.push(c);
  }
  get size() {
    let n = 0;
    for (const a of this.buckets.values()) n += a.length;
    return n;
  }
  /** One InstancedMesh per bucket; with lodDist, small detail drops out beyond that distance (THREE.LOD). */
  build(group: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, lodDist = 0) {
    const out: THREE.InstancedMesh[] = [];
    const c = new THREE.Vector3();
    for (const [k, list] of this.buckets) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      const cs = this.colors.get(k)!;
      if (cs.length === list.length) cs.forEach((cc, i) => im.setColorAt(i, cc));
      im.computeBoundingSphere();
      if (lodDist > 0 && im.boundingSphere) {
        c.copy(im.boundingSphere.center);
        const lod = new THREE.LOD();
        lod.position.copy(c);
        im.position.copy(c).negate();
        im.computeBoundingSphere();
        lod.addLevel(im, 0);
        lod.addLevel(new THREE.Object3D(), lodDist + (im.boundingSphere?.radius ?? 0));
        group.add(lod);
      } else group.add(im);
      out.push(im);
    }
    return out;
  }
}

/** Matrix for the track frame at s: local x = right, y = up, z = backward (toward an approaching ship). */
export function frameMatrix(tr: Track, s: number, lat = 0, h = 0, f = newFrame()) {
  frameAt(tr, s, f);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(f.rx, f.ry, f.rz), new THREE.Vector3(f.ux, f.uy, f.uz), new THREE.Vector3(-f.tx, -f.ty, -f.tz));
  m.setPosition(f.px + f.rx * lat + f.ux * h, f.py + f.ry * lat + f.uy * h, f.pz + f.rz * lat + f.uz * h);
  return m;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, r = 0) => {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const merge = (gs: THREE.BufferGeometry[]) => {
  const ng = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ng) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  }
  const m = mergeGeometries(ng, false)!;
  gs.forEach((g) => g.dispose());
  return m;
};

// ───────────── Profiles ─────────────

const H = HALF_W;
/** Deck slab with kerbs: right half from the deck edge, clockwise; mirrored for the left. */
export const SLAB: Prof = mirrorJoin([
  [H, 0.02],
  [H + 0.25, 0.95],
  [H + 0.55, 1.2],
  [H + 1.55, 1.2],
  [H + 1.85, 0.9],
  [H + 1.85, -0.9],
  [H + 1.45, -1.6],
  [H + 1.45, -2.7],
  [H + 0.6, -3.4],
  [9.5, -3.6],
  [6.5, -6.4],
]);

export const BARRIER_LAT = H + 0.62;
export const BARRIER_TOP = 3.9;

// ───────────── Energy barrier ─────────────

export function energyMaterial(colr: THREE.Color, density: number, cheap: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uCol: { value: colr }, uTime: { value: 0 }, uDen: { value: density } },
    vertexShader: `
      varying vec2 vUv; varying float vD;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uCol; uniform float uTime; uniform float uDen; varying vec2 vUv; varying float vD;
      void main(){
        float u = vUv.x; float v = vUv.y;
        float pv = fract(v);
        // Panel frames at each post, a hot emitter strip along the base, thin scanlines and a travelling pulse.
        float frame = smoothstep(0.03, 0.0, pv) + smoothstep(0.97, 1.0, pv);
        float base = smoothstep(0.14, 0.0, u) * 1.4;
        float top = smoothstep(0.93, 1.0, u) * 0.7;
        ${cheap ? 'float lines = 0.0; float scan = 0.0; float chev = 0.0;' : `
        float lines = smoothstep(0.35, 0.5, abs(fract(u * 7.0) - 0.5)) * 0.12;
        float chev = smoothstep(0.06, 0.0, abs(fract(pv * 2.0 + abs(u - 0.5) * 0.9) - 0.5)) * 0.08 * step(0.2, u) * step(u, 0.8);
        float scan = smoothstep(0.1, 0.0, abs(fract(v * 0.125 - uTime * 0.6) - 0.5)) * 0.5;`}
        float body = (0.05 + lines + chev + scan) * pow(1.0 - u, 1.5);
        float a = clamp(body + frame * 0.45 + top + base, 0.0, 2.5);
        float fogF = exp(-pow(vD * uDen, 2.0));
        gl_FragColor = vec4(uCol * a * fogF, 1.0);
      }`,
  });
}

// ───────────── Pylons + under-girders ─────────────

export function pylonParts() {
  const body = new THREE.CylinderGeometry(1, 1.3, 1, 8, 1).toNonIndexed();
  body.translate(0, 0.5, 0);
  body.computeVertexNormals();
  const cap = merge([box(22, 2.4, 4.2, 0, 0, 0, 0.5), box(18, 1.2, 3.2, 0, -1.6, 0, 0.3)]);
  const foot = merge([box(6.5, 1.6, 6.5, 0, 0.8, 0, 0.4), box(4.4, 1.4, 4.4, 0, 2.2, 0, 0.3)]);
  const band = new THREE.CylinderGeometry(1.36, 1.36, 0.5, 8, 1).toNonIndexed();
  band.computeVertexNormals();
  return { body, cap, foot, band };
}

/** Transverse girder with diagonal braces and a cable tray, in track-frame space under the slab. */
export function braceGeo() {
  const gs: THREE.BufferGeometry[] = [box(19, 0.9, 0.9, 0, -4.4, 0, 0.15)];
  for (const sx of [-1, 1]) {
    const d = new THREE.BoxGeometry(0.6, 4.6, 0.6);
    d.rotateZ(sx * 0.95);
    d.translate(sx * 4.6, -4.6, 0);
    gs.push(d);
    gs.push(box(1.4, 0.7, 0.7, sx * (H + 0.8), -3.0, 0, 0.12));
  }
  return merge(gs);
}

// ───────────── Gantry ─────────────

/** Overhead gantry in frame space: legs on the kerbs, chunky truss beam, sign frame. */
export function gantryParts(span = H + 1.05) {
  const gs: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    gs.push(box(2.4, 17, 2.8, sx * span, 1.2 + 8.5, 0, 0.35));
    gs.push(box(3.6, 1.6, 4, sx * span, 1.2 + 0.8, 0, 0.3));
    gs.push(box(3.0, 2.2, 3.4, sx * span, 1.2 + 15.4, 0, 0.3));
  }
  // Beam: top and bottom chords plus verticals (truss).
  const w = span * 2 + 2;
  gs.push(box(w, 1.3, 2.6, 0, 18.4, 0, 0.3));
  gs.push(box(w, 1.0, 2.2, 0, 13.6, 0, 0.25));
  for (let k = -6; k <= 6; k++) {
    const x = (k / 6) * (span - 1);
    const v = new THREE.BoxGeometry(0.45, 4.0, 0.45);
    v.rotateZ(k % 2 ? 0.55 : -0.55);
    v.translate(x, 16, 0);
    gs.push(v);
  }
  const frame = merge(gs);
  // Light strip under the lower chord.
  const light = merge([box(w - 4, 0.25, 0.5, 0, 13.0, 0.4)]);
  return { frame, light };
}

// ───────────── Tunnel ─────────────

/** Octagonal tunnel interior, ordered so normals face inward; starts on the right kerb ledge. */
export const TUNNEL: Prof = [
  [H + 1.85, 1.2],
  [22.5, 1.2],
  [22.5, 9.5],
  [16.5, 19.5],
  [6.5, 23],
  [-6.5, 23],
  [-16.5, 19.5],
  [-22.5, 9.5],
  [-22.5, 1.2],
  [-H - 1.85, 1.2],
];
/** Outer skin of the tunnel shell (seen from outside), clockwise outward. */
export const TUNNEL_OUT: Prof = [
  [-24.5, -1],
  [-24.5, 10.2],
  [-18, 21.4],
  [-7, 25.2],
  [7, 25.2],
  [18, 21.4],
  [24.5, 10.2],
  [24.5, -1],
];

/** A rib frame following the tunnel outline, inset toward the centre; depth along z. */
export function ribGeo(outline: Prof, inset: number, thick: number, depth: number) {
  const gs: THREE.BufferGeometry[] = [];
  for (let j = 0; j < outline.length - 1; j++) {
    const [x0, y0] = outline[j];
    const [x1, y1] = outline[j + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.5) continue;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    // Inward normal for the TUNNEL ordering (segment direction rotated +90deg).
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const g = new THREE.BoxGeometry(len + thick * 0.9, thick, depth);
    g.rotateZ(ang);
    g.translate((x0 + x1) / 2 + nx * inset, (y0 + y1) / 2 + ny * inset, 0);
    gs.push(g);
  }
  return merge(gs);
}

// ───────────── Grandstand + pit block ─────────────

/** Stepped grandstand in frame space on the right of the start line, with canopy and masts. */
export function grandstandParts(len: number) {
  const tiers: THREE.BufferGeometry[] = [];
  const crowd: THREE.BufferGeometry[] = [];
  const x0 = H + 6;
  for (let k = 0; k < 7; k++) {
    tiers.push(box(3.2, 1.4, len, x0 + k * 3.2, -2 + k * 1.6, 0, 0.2));
    const c = new THREE.PlaneGeometry(len, 1.6);
    // Riser face (crowd) toward the track: plane normal -> -x.
    c.rotateY(-Math.PI / 2);
    c.translate(x0 + k * 3.2 - 1.62, -1.2 + k * 1.6 + 0.9, 0);
    crowd.push(c);
  }
  // Back wall and structure down to the ground handled by the caller (tower block).
  tiers.push(box(2, 16, len, x0 + 7 * 3.2 + 1, 4, 0, 0.3));
  // Canopy: tilted slab and three masts.
  const can = new RoundedBoxGeometry(28, 1.2, len + 6, 2, 0.4);
  can.rotateZ(0.16);
  can.translate(x0 + 10, 19, 0);
  tiers.push(can);
  for (const z of [-len / 2 + 4, 0, len / 2 - 4]) tiers.push(box(1.2, 18, 1.2, x0 + 23, 10, z, 0.25));
  const glow = merge([box(0.3, 0.3, len, x0 + 1, 17.5, 0), box(0.3, 0.3, len, x0 + 12, 19.4, 0)]);
  return { frame: merge(tiers), crowd: merge(crowd), glow };
}

/** Pit building in frame space left of the pit lane: long block with garage bays facing the track. */
export function pitParts(len: number) {
  const x = -(H + 10);
  const frame = merge([box(14, 12, len, x - 3, 4.5, 0, 0.5), box(18, 1.4, len + 4, x - 1, 11.2, 0, 0.4), box(1.4, 1.4, len, x + 6.2, 10.4, 0, 0.3)]);
  const bays = new THREE.PlaneGeometry(len - 4, 8);
  bays.rotateY(Math.PI / 2);
  bays.translate(x + 4.05, 3.6, 0);
  return { frame, bays };
}
