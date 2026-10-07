/**
 * Mempool Invaders art kit (three.js): glowing wire-edge ship hulls, the data-grid floor, nebula sky, star
 * layers, hazard rails, instanced billboards for labels and coins, GPU-friendly particles, debris shards.
 * Everything is procedural: no external assets.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HW } from './sim';

export type Q = 'low' | 'high';
export const FONTS = { display: 'Impact, "Arial Black", sans-serif', mono: 'ui-monospace, Menlo, monospace', jp: '"Hiragino Sans", "Noto Sans JP", sans-serif' };
export const setFonts = (f: Partial<typeof FONTS>) => Object.assign(FONTS, f);

// ───────────── Hulls ─────────────

type Xf = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number };
function xf(g: THREE.BufferGeometry, t: Xf = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)), new THREE.Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1));
  g.applyMatrix4(m);
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  out.computeVertexNormals();
  return out;
}

/** Flat normals + barycentric edge data (hidden on coplanar neighbours so quads don't show a diagonal). */
function finish(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)!;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const tris = pos.count / 3;
  const bary = new Float32Array(pos.count * 3);
  const hide = new Float32Array(pos.count * 3);
  const key = (i: number) => `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
  const edges = new Map<string, { t: number; k: number }[]>();
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const a = key(t * 3 + ((k + 1) % 3));
      const b = key(t * 3 + ((k + 2) % 3));
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      const l = edges.get(e);
      if (l) l.push({ t, k });
      else edges.set(e, [{ t, k }]);
    }
    for (let j = 0; j < 3; j++) bary[(t * 3 + j) * 3 + j] = 1;
  }
  for (const l of edges.values()) {
    if (l.length < 2) continue;
    const [p, q] = l;
    const d = nor.getX(p.t * 3) * nor.getX(q.t * 3) + nor.getY(p.t * 3) * nor.getY(q.t * 3) + nor.getZ(p.t * 3) * nor.getZ(q.t * 3);
    if (d > 0.999) for (const s of l) for (let j = 0; j < 3; j++) hide[(s.t * 3 + j) * 3 + s.k] = 1;
  }
  g.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
  g.setAttribute('hide', new THREE.BufferAttribute(hide, 3));
  return g;
}

const cone = (r: number, h: number, seg: number, t: Xf = {}) => xf(new THREE.ConeGeometry(r, h, seg).rotateX(Math.PI / 2), t);

/** Hull per tx kind. Local +z is the nose (invaders face the player at +z). */
export function hullGeometry(kind: 'payment' | 'data' | 'social' | 'inscription' | 'token' | 'blast' | 'boss' | 'shard'): THREE.BufferGeometry {
  switch (kind) {
    case 'payment':
      return finish([cone(0.42, 1.5, 3, { z: 0.05 }), cone(0.8, 0.9, 3, { z: -0.15, sx: 1.7, sy: 0.2, rz: Math.PI })]);
    case 'data':
      return finish([xf(new THREE.CylinderGeometry(0.72, 0.72, 0.34, 6), { rx: 0 }), xf(new THREE.BoxGeometry(0.3, 0.3, 0.7), { x: 0.9 }), xf(new THREE.BoxGeometry(0.3, 0.3, 0.7), { x: -0.9 }), cone(0.26, 0.7, 4, { z: 0.78 })]);
    case 'social':
      return finish([cone(0.55, 1.7, 4, { z: 0.1, rz: Math.PI / 4 }), xf(new THREE.OctahedronGeometry(0.34), { x: 0.78, z: -0.2, sy: 0.6 }), xf(new THREE.OctahedronGeometry(0.34), { x: -0.78, z: -0.2, sy: 0.6 })]);
    case 'inscription':
      return finish([xf(new THREE.IcosahedronGeometry(0.72, 0), { sy: 0.78, sz: 1.1 }), xf(new THREE.OctahedronGeometry(0.3), { x: 1.0, z: 0.1 }), xf(new THREE.OctahedronGeometry(0.3), { x: -1.0, z: 0.1 })]);
    case 'token':
      return finish([xf(new THREE.DodecahedronGeometry(0.7), { sy: 0.82 }), xf(new THREE.TorusGeometry(0.98, 0.07, 4, 10).rotateX(Math.PI / 2)), cone(0.4, 0.8, 5, { z: 0.78, sx: 0.8, sy: 0.5 })]);
    case 'blast':
      return finish([xf(new THREE.IcosahedronGeometry(0.8, 0), { sx: 1.5, sy: 0.45, sz: 1.5 }), xf(new THREE.TorusGeometry(1.35, 0.06, 4, 20).rotateX(Math.PI / 2))]);
    case 'boss':
      return finish([xf(new THREE.BoxGeometry(2.1, 2.1, 2.1)), xf(new THREE.IcosahedronGeometry(1.75, 0)), xf(new THREE.OctahedronGeometry(0.55), { x: 1.5, y: 1.5, z: 1.5 }), xf(new THREE.OctahedronGeometry(0.55), { x: -1.5, y: 1.5, z: 1.5 }), xf(new THREE.OctahedronGeometry(0.55), { x: 1.5, y: -1.5, z: 1.5 }), xf(new THREE.OctahedronGeometry(0.55), { x: -1.5, y: -1.5, z: 1.5 })]);
    case 'shard':
      return finish([xf(new THREE.TetrahedronGeometry(0.5))]);
  }
}

/** The player's delta-wing, nose toward -z. */
export function playerGeometry(): THREE.BufferGeometry {
  const V = {
    N: [0, 0.05, -1.55], A: [-0.5, 0.1, 0.15], B: [0.5, 0.1, 0.15], WL: [-1.35, -0.04, 0.8], WR: [1.35, -0.04, 0.8],
    T: [0, 0.48, 0.45], K: [0, -0.22, 0.35], E: [0, 0.02, 0.8], FL: [-1.3, 0.28, 0.8], FR: [1.3, 0.28, 0.8],
  } as const;
  const tris: (keyof typeof V)[][] = [
    ['N', 'A', 'T'], ['N', 'T', 'B'], ['T', 'A', 'WL'], ['T', 'WR', 'B'], ['T', 'WL', 'E'], ['T', 'E', 'WR'],
    ['N', 'K', 'A'], ['N', 'B', 'K'], ['K', 'WL', 'A'], ['K', 'B', 'WR'], ['K', 'E', 'WL'], ['K', 'WR', 'E'],
    ['WL', 'FL', 'A'], ['WR', 'B', 'FR'],
  ];
  const arr: number[] = [];
  for (const t of tris) for (const k of t) arr.push(...V[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return finish([g]);
}

const HULL_VERT = /* glsl */ `
  attribute vec3 bary; attribute vec3 hide; attribute vec4 iState;
  varying vec3 vBary; varying vec3 vHide; varying vec3 vN; varying vec3 vCol; varying vec4 vS; varying vec3 vV;
  void main(){
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vN = normalize(mat3(m) * normal);
    vBary = bary; vHide = hide; vS = iState;
    #ifdef USE_INSTANCING_COLOR
      vCol = instanceColor;
    #else
      vCol = vec3(1.0);
    #endif
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const HULL_FRAG = /* glsl */ `
  uniform float uBeat; uniform vec3 uBody; uniform float uTime; uniform float uGlow;
  varying vec3 vBary; varying vec3 vHide; varying vec3 vN; varying vec3 vCol; varying vec4 vS; varying vec3 vV;
  void main(){
    vec3 N = normalize(vN); vec3 V = normalize(vV);
    vec3 b = vBary + vHide * 8.0;
    float e = min(b.x, min(b.y, b.z));
    float w = fwidth(e);
    float edge = 1.0 - smoothstep(0.0, w * 1.7 + 0.015, e);
    float lam = max(dot(N, normalize(vec3(-0.35, 0.85, 0.55))), 0.0);
    float fres = pow(1.0 - abs(dot(N, V)), 2.4);
    vec3 col = uBody * (0.3 + 0.9 * lam) + vCol * (0.045 + 0.06 * lam);
    col += vCol * (edge * (2.4 + uBeat * 1.6) * uGlow + fres * 0.85);
    // vS.y: charging (about to fire) pulses white; vS.x: hit flash.
    col += vec3(1.0, 0.9, 0.8) * vS.y * (0.5 + 0.5 * sin(uTime * 40.0)) * 0.9;
    col = mix(col, vec3(2.0), clamp(vS.x, 0.0, 1.0));
    float a = clamp(vS.z, 0.0, 1.0);
    gl_FragColor = vec4(col * a, 1.0);
  }`;

export type HullMesh = THREE.InstancedMesh & { state: THREE.InstancedBufferAttribute };
export function makeHullMesh(geo: THREE.BufferGeometry, max: number, mat: THREE.ShaderMaterial): HullMesh {
  geo = geo.clone();
  const state = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  state.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iState', state);
  const m = new THREE.InstancedMesh(geo, mat, max) as unknown as HullMesh;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.state = state;
  m.count = 0;
  m.frustumCulled = false;
  return m;
}
export function hullMaterial(body: [number, number, number], glow = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    uniforms: { uBeat: { value: 0 }, uBody: { value: new THREE.Vector3(...body) }, uTime: { value: 0 }, uGlow: { value: glow } },
    side: THREE.DoubleSide,
  });
}

// ───────────── Atlas + billboards ─────────────

export class Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  private free: number[] = [];
  dirty = false;
  constructor(readonly cols: number, readonly rows: number, readonly cw: number, readonly ch: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = cols * cw;
    this.canvas.height = rows * ch;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    for (let i = cols * rows - 1; i >= 0; i--) this.free.push(i);
  }
  alloc(): number {
    return this.free.pop() ?? -1;
  }
  release(i: number) {
    if (i < 0) return;
    this.clear(i);
    this.free.push(i);
  }
  private origin(i: number): [number, number] {
    return [(i % this.cols) * this.cw, Math.floor(i / this.cols) * this.ch];
  }
  clear(i: number) {
    const [x, y] = this.origin(i);
    this.g.clearRect(x, y, this.cw, this.ch);
    this.dirty = true;
  }
  draw(i: number, fn: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    if (i < 0) return;
    const [x, y] = this.origin(i);
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(x, y, this.cw, this.ch);
    g.clip();
    g.clearRect(x, y, this.cw, this.ch);
    g.translate(x, y);
    fn(g, this.cw, this.ch);
    g.restore();
    this.dirty = true;
  }
  /** u0, v0, du, dv for a cell (v measured from the bottom, as the texture is flipped). */
  rect(i: number, out: [number, number, number, number] = [0, 0, 0, 0]) {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    out[0] = c / this.cols;
    out[1] = 1 - (r + 1) / this.rows;
    out[2] = 1 / this.cols;
    out[3] = 1 / this.rows;
    return out;
  }
  flush() {
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }
  dispose() {
    this.tex.dispose();
  }
}

/** Camera-facing textured quads from an atlas, one draw call. */
export class Billboards {
  readonly mesh: THREE.Mesh;
  private n = 0;
  private pos: Float32Array;
  private size: Float32Array;
  private rect: Float32Array;
  private tint: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  constructor(readonly max: number, map: THREE.Texture, depthTest = true) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max * 2);
    this.rect = new Float32Array(max * 4);
    this.tint = new Float32Array(max * 4);
    const mk = (a: Float32Array, n: number, name: string) => {
      const at = new THREE.InstancedBufferAttribute(a, n);
      at.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, at);
      return at;
    };
    this.attrs = [mk(this.pos, 3, 'aPos'), mk(this.size, 2, 'aSize'), mk(this.rect, 4, 'aRect'), mk(this.tint, 4, 'aTint')];
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map } },
      transparent: true,
      depthWrite: false,
      depthTest,
      vertexShader: /* glsl */ `
        attribute vec3 aPos; attribute vec2 aSize; attribute vec4 aRect; attribute vec4 aTint;
        varying vec2 vUv; varying vec4 vTint;
        void main(){
          vec4 vp = viewMatrix * vec4(aPos, 1.0);
          vp.xy += position.xy * aSize;
          vUv = aRect.xy + uv * aRect.zw; vTint = aTint;
          gl_Position = projectionMatrix * vp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec2 vUv; varying vec4 vTint;
        void main(){
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * vTint.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(t.rgb * vTint.rgb, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }
  begin() {
    this.n = 0;
  }
  add(x: number, y: number, z: number, w: number, h: number, r: readonly number[], cr = 1, cg = 1, cb = 1, ca = 1) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i * 2] = w;
    this.size[i * 2 + 1] = h;
    this.rect[i * 4] = r[0];
    this.rect[i * 4 + 1] = r[1];
    this.rect[i * 4 + 2] = r[2];
    this.rect[i * 4 + 3] = r[3];
    this.tint[i * 4] = cr;
    this.tint[i * 4 + 1] = cg;
    this.tint[i * 4 + 2] = cb;
    this.tint[i * 4 + 3] = ca;
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const a of this.attrs) a.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ───────────── Particles ─────────────

/** Soft additive point sprites simulated on the CPU (typed arrays, swap-remove). */
export class Particles {
  readonly points: THREE.Points;
  private n = 0;
  private px: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private posA: THREE.BufferAttribute;
  private colA: THREE.BufferAttribute;
  private sizeA: THREE.BufferAttribute;
  private col: Float32Array;
  private size: Float32Array;
  private size0: Float32Array;
  constructor(readonly max: number) {
    this.px = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(this.px, 3).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeA = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA);
    g.setAttribute('aCol', this.colA);
    g.setAttribute('aSize', this.sizeA);
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 600 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aCol; attribute float aSize; varying vec4 vC; uniform float uScale;
          void main(){
            vC = aCol;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = max(1.0, aSize * uScale / -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec4 vC;
          void main(){
            vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
            float a = smoothstep(1.0, 0.0, r); a *= a;
            gl_FragColor = vec4(vC.rgb * a * vC.a, a * vC.a);
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }
  setScale(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h;
  }
  get count() {
    return this.n;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, drag = 1.5, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.px[i * 3] = x;
    this.px[i * 3 + 1] = y;
    this.px[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.size0[i] = size;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }
  /** A burst of `n` sparks in a sphere (or flat on the field when `flat`). */
  burst(x: number, y: number, z: number, n: number, speed: number, life: number, size: number, r: number, g: number, b: number, flat = false) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const e = flat ? 0 : (Math.random() - 0.5) * 2;
      const s = speed * (0.25 + Math.random() * 0.75);
      const c = Math.sqrt(1 - e * e);
      this.emit(x, y, z, Math.cos(a) * c * s, (flat ? Math.random() * 0.35 : e) * s, Math.sin(a) * c * s, life * (0.5 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), r, g, b, 1.6, flat ? 0 : 2);
    }
  }
  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          for (let k = 0; k < 3; k++) {
            this.px[i * 3 + k] = this.px[l * 3 + k];
            this.vel[i * 3 + k] = this.vel[l * 3 + k];
          }
          for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[l * 4 + k];
          this.life[i] = this.life[l];
          this.maxLife[i] = this.maxLife[l];
          this.size0[i] = this.size0[l];
          this.drag[i] = this.drag[l];
          this.grav[i] = this.grav[l];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.px[i * 3] += this.vel[i * 3] * dt;
      this.px[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.px[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = Math.min(1, k * 2.2);
      this.size[i] = this.size0[i] * (0.4 + 0.6 * k);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posA.needsUpdate = this.colA.needsUpdate = this.sizeA.needsUpdate = true;
  }
  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ───────────── Scenery ─────────────

const NOISE = /* glsl */ `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
`;

export type FloorU = { uTime: { value: number }; uScroll: { value: number }; uBeat: { value: number }; uPX: { value: number }; uPress: { value: number }; uPulseR: { value: number }; uPulse: { value: number } };

/** The data grid: ink floor, scrolling cells, tx lanes, an aim beam under the ship, beat and bomb rings. */
export function makeFloor() {
  const uniforms: FloorU = { uTime: { value: 0 }, uScroll: { value: 0 }, uBeat: { value: 0 }, uPX: { value: 0 }, uPress: { value: 0 }, uPulseR: { value: 0 }, uPulse: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime, uScroll, uBeat, uPX, uPress, uPulseR, uPulse; varying vec3 vW;
      vec3 PAL(float h){ return h < 0.25 ? vec3(0.15,0.9,1.0) : h < 0.5 ? vec3(0.29,0.48,1.0) : h < 0.75 ? vec3(1.0,0.18,0.57) : vec3(1.0,0.72,0.0); }
      void main(){
        float dz = -vW.z;                       // distance away from the player line
        vec2 p = vec2(vW.x, vW.z - uScroll); // scroll toward the player: the ship flies forward
        vec2 g = p / 1.5; vec2 fw = fwidth(g);
        vec2 gr = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(0.0001));
        float line = 1.0 - min(min(gr.x, gr.y), 1.0);
        vec2 g2 = p / 6.0; vec2 fw2 = fwidth(g2);
        vec2 gr2 = abs(fract(g2 - 0.5) - 0.5) / max(fw2, vec2(0.0001));
        float major = 1.0 - min(min(gr2.x, gr2.y), 1.0);
        float fade = exp(-max(dz, 0.0) * 0.022) * smoothstep(-16.0, 4.0, dz + 6.0);
        vec3 gridC = mix(vec3(0.05, 0.32, 0.55), vec3(0.8, 0.12, 0.45), smoothstep(0.0, 70.0, dz));
        vec3 col = vec3(0.012, 0.012, 0.022);
        col += gridC * line * 0.38 * fade;
        col += vec3(0.5, 0.75, 1.0) * major * 0.5 * fade;
        // tx lanes: dashes flowing toward the player, colour per lane
        float lane = floor(vW.x / 1.5);
        float hl = h21(vec2(lane, 3.0));
        float sp = 2.0 + hl * 7.0 + uPress * 8.0;
        float zz = (vW.z * 0.22 - uTime * sp * 0.22) * (0.6 + hl);
        float dash = smoothstep(0.86, 0.97, fract(zz + hl * 9.0)) * step(0.72, h21(vec2(lane, 9.0)));
        float inLane = smoothstep(0.42, 0.3, abs(fract(vW.x / 1.5) - 0.5));
        col += PAL(h21(vec2(lane, 5.0))) * dash * inLane * 0.8 * fade;
        // aim beam under the ship
        float beam = exp(-abs(vW.x - uPX) * 1.4) * exp(-max(dz, 0.0) * 0.045) * 0.2;
        col += vec3(0.1, 0.8, 1.0) * beam * (0.6 + uBeat * 0.8);
        // beat wave rolling away from the player
        float ring = exp(-abs(dz - uPulseR) * 0.5) * uPulse;
        col += vec3(0.3, 0.7, 1.0) * ring * 0.45 * (0.3 + line);
        col += gridC * uBeat * line * 0.3 * fade;
        // field edge rails glow
        float edge = smoothstep(${HW + 0.4}, ${HW + 0.15}, abs(vW.x));
        col *= mix(0.55, 1.0, edge);
        col += vec3(1.0, 0.6, 0.0) * (1.0 - smoothstep(0.0, 0.18, abs(abs(vW.x) - ${HW + 0.25}))) * 0.55 * fade;
        col += mix(vec3(0.9, 0.12, 0.5), vec3(0.15, 0.7, 1.0), 0.5 + 0.5 * sin(vW.x * 0.02)) * smoothstep(40.0, 260.0, dz) * 0.32;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(120, 330).rotateX(-Math.PI / 2).translate(0, 0, -150), mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** Nebula dome with a bright haze band on the horizon. Follows the camera. */
export function makeSky(q: Q) {
  const uniforms = { uTime: { value: 0 }, uPress: { value: 0 }, uBeat: { value: 0 }, uPX: { value: 0 } };
  const oct = q === 'low' ? 3 : 5;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime, uPress, uBeat, uPX; varying vec3 vD;
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < ${oct}; i++){ s += a * vn(p); p = p * 2.03 + vec2(7.1, 3.7); a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vD);
        vec2 uv = vec2(atan(d.x, -d.z) * 1.4 + uPX * 0.012, d.y * 2.4);
        float t = uTime * 0.012;
        vec2 q = vec2(fbm(uv * 1.3 + t), fbm(uv * 1.3 + vec2(5.2, 1.3) - t));
        float n = fbm(uv * 1.7 + q * 2.2 + vec2(t * 2.0, 0.0));
        float up = smoothstep(-0.05, 0.9, d.y);
        vec3 c1 = vec3(0.35, 0.04, 0.42); vec3 c2 = vec3(0.02, 0.28, 0.6); vec3 c3 = vec3(1.0, 0.25, 0.3);
        vec3 col = mix(c1, c2, smoothstep(0.2, 0.9, q.x)) * n * n * 1.9;
        col += c3 * pow(max(n - 0.55, 0.0), 2.0) * 1.7 * (0.5 + uPress);
        col *= 0.35 + 0.65 * up;
        // horizon haze
        float hz = exp(-abs(d.y + 0.015) * 11.0);
        col += mix(vec3(0.9, 0.12, 0.5), vec3(0.15, 0.7, 1.0), 0.5 + 0.5 * sin(uv.x * 2.0 + uTime * 0.05)) * hz * (0.42 + uBeat * 0.35 + uPress * 0.3);
        col *= 1.0 - 0.7 * smoothstep(0.7, 1.0, d.y);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** Three star layers with different parallax; stars stream toward the camera at a pace set by pressure. */
export function makeStars(q: Q) {
  const layers: { pts: THREE.Points; k: number }[] = [];
  const uniforms = { uScroll: { value: 0 }, uBeat: { value: 0 }, uScale: { value: 600 } };
  const counts = q === 'low' ? [160, 120, 70] : [420, 260, 140];
  counts.forEach((n, li) => {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // A band of sky just above the horizon (the camera sits ~14 up and ~12 back): azimuth +-55 deg, elevation -2..11 deg.
      const az = (Math.random() - 0.5) * 1.9;
      const el = (-0.03 + Math.random() * 0.22) * (0.4 + li * 0.35);
      const D = 160 + Math.random() * 220;
      pos[i * 3] = Math.sin(az) * Math.cos(el) * D;
      pos[i * 3 + 1] = 14 + Math.sin(el) * D;
      pos[i * 3 + 2] = 12 - Math.cos(az) * Math.cos(el) * D;
      const k = Math.random();
      const c = k < 0.6 ? [0.8, 0.9, 1.0] : k < 0.8 ? [0.3, 0.85, 1.0] : k < 0.93 ? [1.0, 0.3, 0.7] : [1.0, 0.75, 0.2];
      col.set(c, i * 3);
      sz[i] = (0.5 + Math.random() * 1.2) * (1 + li * 0.5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uSpeed: { value: 3 + li * 5 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aCol; attribute float aSize; varying vec3 vC; uniform float uScroll, uSpeed, uBeat, uScale;
        void main(){
          vec3 p = position;
          // Stars stream toward the camera (z increases) and wrap at the far end, fading in/out at both ends so nothing pops.
          float zmin = -372.0; float span = 300.0;
          float zt = mod(p.z - zmin + uScroll * uSpeed * 0.25, span);
          p.z = zmin + zt;
          float edge = smoothstep(0.0, 25.0, zt) * smoothstep(span, span - 50.0, zt);
          vC = aCol * (0.55 + uBeat * 0.7) * edge;
          p.x += sin(uScroll * 0.02 + position.y) * 0.5 * uSpeed * 0.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = max(1.0, aSize * uScale / 500.0 * clamp(120.0 / -mv.z, 0.6, 2.5));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vC * a * 1.6, a); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -5;
    layers.push({ pts, k: 0.3 + li * 0.35 });
  });
  return { layers, uniforms };
}

/** Far-off wireframe cubes drifting in the haze: the blocks the transactions came from. */
export function makeFarBlocks() {
  const g = new THREE.Group();
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const items: { m: THREE.LineSegments; spin: number; base: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const s = 8 + Math.random() * 26;
    const hot = i % 3 === 0;
    const mat = new THREE.LineBasicMaterial({ color: hot ? new THREE.Color(2.2, 1.35, 0.1) : new THREE.Color(0.2, 1.1, 1.8), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.LineSegments(edges, mat);
    m.scale.setScalar(s);
    m.position.set((i - 4) * 38 + (Math.random() - 0.5) * 20, 8 + Math.random() * 60, -150 - Math.random() * 150);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    g.add(m);
    items.push({ m, spin: (Math.random() - 0.5) * 0.25, base: m.position.x });
  }
  return { group: g, items, dispose: () => { edges.dispose(); for (const i of items) (i.m.material as THREE.Material).dispose(); } };
}

/** Hazard-striped barrier rails along both field edges, with a beat flash. */
export function makeRails() {
  const uniforms = { uScroll: { value: 0 }, uBeat: { value: 0 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uScroll, uBeat; varying vec3 vW; varying vec3 vL;
      void main(){
        float s = step(0.5, fract((vW.z - uScroll) * 0.22));
        float top = smoothstep(0.3, 0.5, vL.y);
        vec3 amber = vec3(1.0, 0.62, 0.0);
        vec3 col = mix(vec3(0.03), amber * (0.3 + uBeat * 0.8), s) * (0.4 + top);
        col += amber * top * (0.55 + uBeat * 1.2);
        float fade = exp(-max(-vW.z, 0.0) * 0.016);
        gl_FragColor = vec4(col * fade, 1.0);
      }`,
  });
  const geo = new THREE.BoxGeometry(0.34, 0.8, 150);
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s * (HW + 0.45), 0.4, -62);
    m.frustumCulled = false;
    g.add(m);
  }
  return { group: g, uniforms, dispose: () => { geo.dispose(); mat.dispose(); } };
}

// ───────────── Label drawing (atlas cells) ─────────────

const chip = (g: CanvasRenderingContext2D, w: number, h: number, col: string) => {
  g.fillStyle = 'rgba(6,6,10,0.82)';
  g.fillRect(2, 2, w - 4, h - 4);
  g.fillStyle = col;
  g.fillRect(2, 2, 5, h - 4);
  g.fillRect(2, 2, w - 4, 2);
};

/** A tx label: kind tag + short id (ticker + logo drawn by the caller for tokens). */
export function drawTxLabel(g: CanvasRenderingContext2D, w: number, h: number, col: string, tag: string, text: string) {
  chip(g, w, h, col);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = col;
  g.font = `900 ${Math.round(h * 0.34)}px ${FONTS.display}`;
  g.fillText(tag, 12, h * 0.3);
  g.fillStyle = '#e8e6df';
  g.font = `700 ${Math.round(h * 0.34)}px ${FONTS.mono}`;
  g.fillText(text, 12, h * 0.72);
}

/** Token label: round logo (or nothing) on the left, ticker big, "token" tag small. */
export function drawTokenLabel(g: CanvasRenderingContext2D, w: number, h: number, sym: string, icon: HTMLImageElement | null) {
  chip(g, w, h, '#ffb800');
  const r = h * 0.34;
  const cx = 12 + r + 2;
  const cy = h / 2;
  g.fillStyle = '#2a1a04';
  g.strokeStyle = '#ffd36a';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  let drawn = false;
  if (icon?.complete && icon.naturalWidth) {
    try {
      g.save();
      g.beginPath();
      g.arc(cx, cy, r - 1.5, 0, Math.PI * 2);
      g.clip();
      g.drawImage(icon, cx - r + 1.5, cy - r + 1.5, (r - 1.5) * 2, (r - 1.5) * 2);
      g.restore();
      drawn = true;
    } catch {
      /* fall through to the glyph */
    }
  }
  if (!drawn) {
    g.fillStyle = '#ffd36a';
    g.font = `900 ${Math.round(r)}px ${FONTS.display}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('$', cx, cy + 1);
  }
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffd36a';
  g.font = `900 ${Math.round(h * 0.5)}px ${FONTS.display}`;
  g.fillText(sym.slice(0, 7).toUpperCase(), cx + r + 8, h * 0.4);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = `700 ${Math.round(h * 0.22)}px ${FONTS.mono}`;
  g.fillText('BSV-21 TOKEN', cx + r + 8, h * 0.82);
}

export function drawPopup(g: CanvasRenderingContext2D, w: number, h: number, text: string, col: string) {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(h * 0.72)}px ${FONTS.display}`;
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineJoin = 'round';
  g.strokeText(text, w / 2, h / 2);
  g.fillStyle = col;
  g.fillText(text, w / 2, h / 2);
}

const ICON_PATHS: Record<string, string> = {
  spread: 'M12 3 4 20h3l5-11 5 11h3zM11 12h2v9h-2z',
  rail: 'M3 9h10V4l8 8-8 8v-5H3z',
  overdrive: 'M13 2 4 14h6l-1 8 9-12h-6z',
  shield: 'M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5zm0 3 5 2v4c0 3-2 6-5 8-3-2-5-5-5-8V7z',
  bomb: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM11 1h2v4h-2zm0 18h2v4h-2zM1 11h4v2H1zm18 0h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zm11.4 11.4 1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4L17 8.4z',
};
/** Power-up pod face: hex badge with the pictogram. */
export function drawPowerIcon(g: CanvasRenderingContext2D, w: number, h: number, kind: string, col: string) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.46;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = 'rgba(8,8,12,0.9)';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = col;
  g.stroke();
  g.save();
  g.translate(cx - r * 0.62, cy - r * 0.62);
  g.scale((r * 1.24) / 24, (r * 1.24) / 24);
  g.fillStyle = col;
  g.fill(new Path2D(ICON_PATHS[kind] ?? ICON_PATHS.rail));
  g.restore();
}
