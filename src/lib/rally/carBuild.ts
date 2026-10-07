/**
 * Procedural high-detail rally cars (no third-party model: licence-clean by construction).
 * Lofted smooth bodywork + cabin, PBR clearcoat paint with a painted livery atlas (token logo and
 * parody sponsors), glass, lights, spoiler, roof scoop, auxiliary lamps, and real wheels with
 * tyre tread, rims, brake discs and calipers. Dirt builds up through a shader uniform.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, rng } from './noise';
import type { Quality } from './world';

export type BodyKind = 'hatch' | 'coupe' | 'sedan' | 'wagon';
export type Livery = { base: string; accent: string; trim: string; number: string; sponsors: string[]; ticker: string; logo: HTMLImageElement | null; seed: number };

type Ctrl = [number, number][];
const L = 4.1;
export const WHEEL_VIS_R = 0.345;
export const WHEEL_X = 0.8;
export const WHEEL_Z = 1.28;

/** Catmull-Rom through control points, clamped. */
function sample(c: Ctrl, t: number) {
  if (t <= c[0][0]) return c[0][1];
  if (t >= c[c.length - 1][0]) return c[c.length - 1][1];
  let i = 0;
  while (c[i + 1][0] < t) i++;
  const p0 = c[Math.max(0, i - 1)][1];
  const p1 = c[i][1];
  const p2 = c[i + 1][1];
  const p3 = c[Math.min(c.length - 1, i + 2)][1];
  const u = (t - c[i][0]) / (c[i + 1][0] - c[i][0]);
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

const WIDTH: Ctrl = [[0, 0.74], [0.06, 0.85], [0.18, 0.9], [0.5, 0.91], [0.82, 0.9], [0.94, 0.86], [1, 0.72]];
const PROFILES: Record<BodyKind, { belt: Ctrl; roof: Ctrl; cs: number; ce: number; len: number }> = {
  hatch: {
    belt: [[0, 0.8], [0.05, 0.94], [0.2, 0.98], [0.5, 0.99], [0.72, 0.96], [0.88, 0.85], [0.97, 0.71], [1, 0.6]],
    roof: [[0.14, 0.98], [0.2, 1.28], [0.3, 1.46], [0.58, 1.47], [0.68, 1.3], [0.77, 0.95]],
    cs: 0.14, ce: 0.77, len: 0.96,
  },
  coupe: {
    belt: [[0, 0.74], [0.05, 0.9], [0.2, 0.96], [0.5, 0.97], [0.72, 0.94], [0.88, 0.82], [0.97, 0.68], [1, 0.56]],
    roof: [[0.2, 0.96], [0.3, 1.22], [0.42, 1.33], [0.56, 1.33], [0.66, 1.2], [0.73, 0.94]],
    cs: 0.2, ce: 0.73, len: 1.0,
  },
  sedan: {
    belt: [[0, 0.82], [0.05, 0.96], [0.2, 1.0], [0.5, 0.99], [0.72, 0.96], [0.88, 0.85], [0.97, 0.72], [1, 0.6]],
    roof: [[0.22, 1.0], [0.3, 1.3], [0.4, 1.4], [0.56, 1.4], [0.65, 1.28], [0.73, 0.96]],
    cs: 0.22, ce: 0.73, len: 1.1,
  },
  wagon: {
    belt: [[0, 0.84], [0.05, 0.97], [0.2, 1.0], [0.5, 0.99], [0.72, 0.96], [0.88, 0.85], [0.97, 0.72], [1, 0.6]],
    roof: [[0.1, 1.0], [0.14, 1.32], [0.22, 1.45], [0.58, 1.46], [0.67, 1.3], [0.75, 0.96]],
    cs: 0.1, ce: 0.75, len: 1.1,
  },
};

function closure(t: number) {
  const e = 0.035;
  if (t < e) return Math.sqrt(Math.max(0, 1 - ((e - t) / e) ** 2));
  if (t > 1 - e) return Math.sqrt(Math.max(0, 1 - ((t - (1 - e)) / e) ** 2));
  return 1;
}

type LoftOpts = { m: number; n: number; t0: number; t1: number; len: number; expo: number; yb: (t: number) => number; yt: (t: number) => number; w: (t: number) => number; close: boolean };

function loft(o: LoftOpts) {
  const { m, n } = o;
  const pos: number[] = [];
  for (let i = 0; i <= n; i++) {
    const tt = o.t0 + ((o.t1 - o.t0) * i) / n;
    const z = (tt - 0.5) * L * o.len;
    const s = o.close ? closure(tt) : 1;
    const yb = o.yb(tt);
    const yt = Math.max(o.yt(tt), yb + 0.001);
    const hh = ((yt - yb) / 2) * s;
    const yc = (yt + yb) / 2;
    const w = o.w(tt) * s;
    for (let k = 0; k < m; k++) {
      const th = (k / m) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const e = 2 / o.expo;
      pos.push(Math.sign(c) * Math.abs(c) ** e * w, yc + Math.sign(sn) * Math.abs(sn) ** e * hh, z);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < m; k++) {
      const a = i * m + k;
      const b = i * m + ((k + 1) % m);
      const c = (i + 1) * m + k;
      const d = (i + 1) * m + ((k + 1) % m);
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Livery atlas: [0,.33] left flank, [.33,.66] right flank, [.66,1] roof/hood. Two UV sets, blended per pixel. */
function addUVs(g: THREE.BufferGeometry, len: number) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const uvTop = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const t = z / (L * len) + 0.5;
    uv[i * 2] = x < 0 ? t * 0.33 : 0.33 + (1 - t) * 0.33;
    uv[i * 2 + 1] = y / 1.5;
    uvTop[i * 2] = 0.66 + 0.34 * clamp((x + 1) / 2, 0, 1);
    uvTop[i * 2 + 1] = clamp(t, 0, 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uvTop', new THREE.BufferAttribute(uvTop, 2));
}

/** Split triangles into paint and glass by surface orientation. */
function splitGlass(g: THREE.BufferGeometry, t0: number, t1: number, len: number) {
  const idx = g.index!.array;
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const paint: number[] = [];
  const glass: number[] = [];
  for (let f = 0; f < idx.length; f += 3) {
    let ny = 0;
    let tz = 0;
    for (let q = 0; q < 3; q++) {
      ny += nrm.getY(idx[f + q]) / 3;
      tz += p.getZ(idx[f + q]) / 3;
    }
    const t = tz / (L * len) + 0.5;
    const u = (t - t0) / (t1 - t0);
    const pillar = u < 0.05 || u > 0.95 || (u > 0.47 && u < 0.52);
    const isGlass = ny < 0.84 && ny > -0.2 && !pillar && u > 0.0 && u < 1;
    (isGlass ? glass : paint).push(idx[f], idx[f + 1], idx[f + 2]);
  }
  return { paint, glass };
}

function noiseCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

const DIRT_GLSL = `
float dHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(dHash(i+vec3(0,0,0)),dHash(i+vec3(1,0,0)),f.x), mix(dHash(i+vec3(0,1,0)),dHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(dHash(i+vec3(0,0,1)),dHash(i+vec3(1,0,1)),f.x), mix(dHash(i+vec3(0,1,1)),dHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
`;

/** Mud that builds up from the sills with `u.value` (0 clean .. 1 caked). */
function dirtify(mat: THREE.MeshStandardMaterial, u: { value: number }, col: THREE.Color, tag: string) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uDirt = u;
    sh.uniforms.uDirtCol = { value: col };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vOP; uniform float uDirt; uniform vec3 uDirtCol;\n${DIRT_GLSL}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float dBase = smoothstep(1.05, 0.22, vOP.y) * 0.85 + 0.15;
        float dN = dNoise(vOP * 5.0) * 0.55 + dNoise(vOP * 17.0) * 0.45;
        float dirtK = clamp(dBase * uDirt * 1.5 + (dN - 0.5) * 0.5 * uDirt, 0.0, 1.0);
        dirtK = smoothstep(0.18, 0.75, dirtK);
        diffuseColor.rgb = mix(diffuseColor.rgb, uDirtCol * (0.7 + 0.5 * dN), dirtK * 0.92);
        roughnessFactor = mix(roughnessFactor, 0.97, dirtK);`,
      );
  };
  mat.customProgramCacheKey = () => 'dirt-' + tag;
}

export type CarRig = {
  root: THREE.Group;
  model: THREE.Group;
  wheels: { steer: THREE.Group; spin: THREE.Group }[];
  dirt: { value: number };
  setLights(brake: number, head: number): void;
  setLivery(l: Livery): void;
  dispose(): void;
};

export class CarFactory {
  private geo = new Map<string, THREE.BufferGeometry>();
  private mats: Record<string, THREE.Material> = {};
  private tex: THREE.Texture[] = [];
  readonly hi: boolean;
  readonly seg: number;
  constructor(
    readonly quality: Quality,
    envIntensity = 1,
  ) {
    this.hi = quality !== 'low';
    this.seg = quality === 'ultra' ? 1.35 : quality === 'high' ? 1 : 0.6;
    const m = this.mats;
    const treadCv = noiseCanvas(256, 64, (g) => {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, 256, 64);
      g.strokeStyle = '#fff';
      g.lineWidth = 6;
      for (let x = -64; x < 300; x += 22) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 26, 32);
        g.lineTo(x, 64);
        g.stroke();
      }
    });
    const tread = new THREE.CanvasTexture(treadCv);
    tread.wrapS = tread.wrapT = THREE.RepeatWrapping;
    tread.repeat.set(10, 1);
    this.tex.push(tread);
    m.tyre = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92, metalness: 0, bumpMap: tread, bumpScale: 1.6 });
    m.rim = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.28, metalness: 0.95, envMapIntensity: envIntensity });
    m.disc = new THREE.MeshStandardMaterial({ color: '#8d8f94', roughness: 0.45, metalness: 0.9 });
    m.caliper = new THREE.MeshStandardMaterial({ color: '#d4141c', roughness: 0.4, metalness: 0.3 });
    m.black = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.6, metalness: 0.1 });
    m.plastic = new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.75, metalness: 0 });
    m.carbon = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.32, metalness: 0.5 });
    m.chrome = new THREE.MeshStandardMaterial({ color: '#e8eaee', roughness: 0.12, metalness: 1, envMapIntensity: envIntensity });
    m.glass = new THREE.MeshPhysicalMaterial({ color: '#0b1218', roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7 * envIntensity, transparent: true, opacity: 0.88 });
    m.lamp = new THREE.MeshStandardMaterial({ color: '#f4f6ff', emissive: '#dfe8ff', emissiveIntensity: 1.2, roughness: 0.1 });
  }
  private g(key: string, make: () => THREE.BufferGeometry) {
    let v = this.geo.get(key);
    if (!v) {
      v = make();
      this.geo.set(key, v);
    }
    return v;
  }

  private wheelGeos() {
    const seg = Math.round(48 * this.seg);
    const tyre = this.g('tyre', () => {
      const pts = [[0.2, -0.125], [0.27, -0.14], [0.322, -0.13], [0.343, -0.09], [0.348, 0], [0.343, 0.09], [0.322, 0.13], [0.27, 0.14], [0.2, 0.125]].map(([r, y]) => new THREE.Vector2(r, y));
      const gg = new THREE.LatheGeometry(pts, seg);
      gg.rotateZ(Math.PI / 2);
      return gg;
    });
    const rim = this.g('rim', () => {
      const parts: THREE.BufferGeometry[] = [];
      const barrel = new THREE.LatheGeometry([[0.2, -0.12], [0.23, -0.125], [0.236, -0.1], [0.215, 0], [0.236, 0.1], [0.23, 0.125], [0.2, 0.12]].map(([r, y]) => new THREE.Vector2(r, y)), seg);
      barrel.rotateZ(Math.PI / 2);
      parts.push(barrel);
      const face = new THREE.CircleGeometry(0.215, Math.max(12, seg / 2));
      face.rotateY(Math.PI / 2);
      face.translate(0.09, 0, 0);
      parts.push(face);
      for (let i = 0; i < 10; i++) {
        const sp = new THREE.BoxGeometry(0.03, 0.2, 0.034);
        sp.translate(0.1, 0.11, 0);
        sp.rotateX((i / 10) * Math.PI * 2);
        parts.push(sp);
      }
      const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20);
      hub.rotateZ(Math.PI / 2);
      hub.translate(0.1, 0, 0);
      parts.push(hub);
      return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
    });
    const disc = this.g('disc', () => {
      const d = new THREE.CylinderGeometry(0.185, 0.185, 0.026, 36, 1);
      d.rotateZ(Math.PI / 2);
      d.translate(-0.02, 0, 0);
      return d;
    });
    const caliper = this.g('caliper', () => {
      const c = new THREE.BoxGeometry(0.06, 0.1, 0.17);
      c.translate(-0.03, 0.0, 0);
      c.translate(0, 0.14, 0);
      return c;
    });
    return { tyre, rim, disc, caliper };
  }

  build(kind: BodyKind, livery: Livery, drawLogo = true): CarRig {
    const prof = PROFILES[kind];
    const hi = this.hi;
    const m = Math.round(46 * this.seg);
    const n = Math.round(80 * this.seg);
    const belt = (t: number) => sample(prof.belt, t);
    const w = (t: number) => sample(WIDTH, t);
    const key = `${kind}:${this.quality}`;
    const body = this.g('body:' + key, () => {
      const gg = loft({ m, n, t0: 0, t1: 1, len: prof.len, expo: 3.2, yb: (t) => 0.27 + 0.1 * (1 - Math.sin(Math.min(1, t * 10) * Math.PI / 2)) + 0.1 * Math.max(0, (t - 0.9) / 0.1), yt: belt, w, close: true });
      addUVs(gg, prof.len);
      return gg;
    });
    const cab = this.g('cabin:' + key, () => {
      const c0 = prof.cs;
      const c1 = prof.ce;
      const roofCtl = prof.roof;
      const gg = loft({ m: Math.round(36 * this.seg), n: Math.round(46 * this.seg), t0: c0, t1: c1, len: prof.len, expo: 3.0, yb: (t) => belt(t) - 0.2, yt: (t) => Math.max(belt(t), sample(roofCtl, t)), w: (t) => w(t) * 0.86, close: false });
      addUVs(gg, prof.len);
      return gg;
    });
    const split = this.g('cabsplit:' + key, () => {
      const s = splitGlass(cab, prof.cs, prof.ce, prof.len);
      const gp = new THREE.BufferGeometry();
      gp.setAttribute('position', cab.attributes.position);
      gp.setAttribute('normal', cab.attributes.normal);
      gp.setAttribute('uv', cab.attributes.uv);
      gp.setAttribute('uvTop', cab.attributes.uvTop);
      gp.setIndex(s.paint);
      const gl = new THREE.BufferGeometry();
      gl.setAttribute('position', cab.attributes.position);
      gl.setAttribute('normal', cab.attributes.normal);
      gl.setAttribute('uv', cab.attributes.uv);
      gl.setAttribute('uvTop', cab.attributes.uvTop);
      gl.setIndex(s.glass);
      this.geo.set('cabpaint:' + key, gp);
      this.geo.set('cabglass:' + key, gl);
      return gp;
    });
    void split;

    // Livery atlas.
    const W = hi ? 2048 : 1024;
    const H = W / 2;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.tex.push(tex);
    const paintLivery = (lv: Livery) => drawLivery(cv, lv, kind, drawLogo);
    paintLivery(livery);

    const dirt = { value: 0 };
    const dirtCol = new THREE.Color('#5c4630');
    const paint = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, metalness: 0.32, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.25 });
    paint.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 uvTop; varying vec2 vUvTop; varying vec3 vONrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvTop = uvTop; vONrm = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vUvTop; varying vec3 vONrm;')
        .replace('#include <map_fragment>', 'vec4 lvS = texture2D( map, vMapUv ); vec4 lvT = texture2D( map, vUvTop ); diffuseColor *= mix( lvS, lvT, smoothstep( 0.74, 0.9, normalize( vONrm ).y ) );');
    };
    dirtify(paint, dirt, dirtCol, 'paint');
    const rimM = (this.mats.rim as THREE.MeshStandardMaterial).clone();
    dirtify(rimM, dirt, dirtCol, 'rim');
    const tyreM = (this.mats.tyre as THREE.MeshStandardMaterial).clone();
    dirtify(tyreM, dirt, dirtCol, 'tyre');
    const tail = new THREE.MeshStandardMaterial({ color: '#7a0b10', emissive: '#ff1010', emissiveIntensity: 0.35, roughness: 0.2 });
    const head = (this.mats.lamp as THREE.MeshStandardMaterial).clone();

    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const model = new THREE.Group();
    root.add(model);
    const own: THREE.Material[] = [paint, rimM, tyreM, tail, head];
    const add = (geom: THREE.BufferGeometry, mat: THREE.Material, cast = true) => {
      const me = new THREE.Mesh(geom, mat);
      me.castShadow = cast;
      me.receiveShadow = true;
      model.add(me);
      return me;
    };
    add(body, paint);
    add(this.geo.get('cabpaint:' + key)!, paint);
    add(this.geo.get('cabglass:' + key)!, this.mats.glass, false);

    // Detail parts, merged per material.
    const det: Record<string, THREE.BufferGeometry[]> = { black: [], carbon: [], chrome: [], plastic: [], paint: [] };
    const box = (mat: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0) => {
      const b = new THREE.BoxGeometry(sx, sy, sz);
      if (rx) b.rotateX(rx);
      b.translate(x, y, z);
      det[mat].push(b);
    };
    const zf = (prof.len * L) / 2;
    // Front splitter + lower intake + grille.
    box('carbon', 1.62, 0.05, 0.34, 0, 0.27, zf - 0.12);
    box('black', 0.9, 0.2, 0.05, 0, 0.45, zf - 0.04);
    box('black', 0.5, 0.12, 0.05, -0.62, 0.42, zf - 0.08);
    box('black', 0.5, 0.12, 0.05, 0.62, 0.42, zf - 0.08);
    // Rear diffuser + exhaust + tow eye.
    box('carbon', 1.5, 0.08, 0.3, 0, 0.3, -zf + 0.1);
    const ex = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 14);
    ex.rotateX(Math.PI / 2);
    ex.translate(0.42, 0.36, -zf + 0.05);
    det.chrome.push(ex);
    box('paint', 0.07, 0.07, 0.09, -0.35, 0.34, zf + 0.02);
    // Roof scoop + wing.
    const roofY = sample(prof.roof, (prof.cs + prof.ce) / 2);
    const roofZ = ((prof.cs + prof.ce) / 2 - 0.5) * L * prof.len;
    box('black', 0.34, 0.1, 0.4, 0, roofY + 0.04, roofZ + 0.1);
    box('black', 0.3, 0.07, 0.1, 0, roofY + 0.12, roofZ + 0.3, -0.3);
    if (kind !== 'sedan') {
      const wz = -zf + 0.08;
      const wy = belt(0.02) + 0.3;
      box('carbon', 1.55, 0.04, 0.34, 0, wy + 0.18, wz, 0.08);
      box('carbon', 0.04, 0.3, 0.28, 0.7, wy + 0.04, wz);
      box('carbon', 0.04, 0.3, 0.28, -0.7, wy + 0.04, wz);
      box('carbon', 0.04, 0.12, 0.38, 0.8, wy + 0.2, wz);
      box('carbon', 0.04, 0.12, 0.38, -0.8, wy + 0.2, wz);
    } else box('carbon', 1.4, 0.03, 0.14, 0, belt(0.03) + 0.08, -zf + 0.15);
    // Mirrors + handles + mud flaps.
    for (const sx of [-1, 1]) {
      const zc = (0.72 - 0.5) * L * prof.len;
      box('black', 0.07, 0.11, 0.16, sx * 0.92, sample(prof.belt, 0.72) + 0.2, zc - 0.05);
      box('chrome', 0.02, 0.03, 0.14, sx * 0.915, 0.97, (0.45 - 0.5) * L * prof.len);
      box('black', 0.025, 0.2, 0.3, sx * 0.97, 0.3, -WHEEL_Z - 0.46);
      box('black', 0.025, 0.2, 0.3, sx * 0.97, 0.3, WHEEL_Z + 0.46);
      // Sill guard
      box('black', 0.05, 0.08, 1.3, sx * 0.9, 0.3, 0);
    }
    const detMat: Record<string, THREE.Material> = { black: this.mats.black, carbon: this.mats.carbon, chrome: this.mats.chrome, plastic: this.mats.plastic, paint };
    for (const k of Object.keys(det)) if (det[k].length) add(mergeGeometries(det[k].map((x) => (x.index ? x.toNonIndexed() : x)))!, detMat[k]);

    // Lamps: head clusters, aux light bar, tail lights.
    const lampGeo = this.g('lampGeo', () => {
      const s = new THREE.SphereGeometry(0.1, 16, 12);
      s.scale(1.6, 0.8, 0.6);
      return s;
    });
    const auxGeo = this.g('auxGeo', () => {
      const c = new THREE.CylinderGeometry(0.075, 0.075, 0.07, 18);
      c.rotateX(Math.PI / 2);
      return c;
    });
    for (const sx of [-1, 1]) {
      const hl = add(lampGeo, head, false);
      hl.position.set(sx * 0.62, 0.74, zf - 0.1);
      hl.rotation.y = sx * 0.25;
    }
    for (const x of [-0.45, -0.15, 0.15, 0.45]) {
      const a = add(auxGeo, head, false);
      a.position.set(x, 0.9, zf - 0.24);
      const rim = add(auxGeo, this.mats.chrome, false);
      rim.scale.set(1.18, 1.18, 0.8);
      rim.position.set(x, 0.9, zf - 0.265);
    }
    for (const sx of [-1, 1]) {
      const tl = add(this.g('tailGeo', () => new THREE.BoxGeometry(0.4, 0.1, 0.05)), tail, false);
      tl.position.set(sx * 0.56, belt(0.03) - 0.06, -zf + 0.04);
    }

    // Wheels with suspension-ready pivots.
    const wg = this.wheelGeos();
    const wheels: CarRig['wheels'] = [];
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 === 0 ? 1 : -1;
      const sz = i < 2 ? 1 : -1;
      const steer = new THREE.Group();
      steer.position.set(sx * WHEEL_X, WHEEL_VIS_R, sz * WHEEL_Z);
      const spin = new THREE.Group();
      steer.add(spin);
      const mir = sx < 0 ? -1 : 1;
      const t = new THREE.Mesh(wg.tyre, tyreM);
      const r = new THREE.Mesh(wg.rim, rimM);
      const d = new THREE.Mesh(wg.disc, this.mats.disc);
      for (const o of [t, r, d]) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.scale.x = mir;
        spin.add(o);
      }
      if (hi) {
        const cal = new THREE.Mesh(wg.caliper, this.mats.caliper);
        cal.scale.x = mir;
        cal.castShadow = true;
        cal.position.y = -0.14 + 0.0;
        cal.rotation.x = 0;
        steer.add(cal);
      }
      model.add(steer);
      wheels.push({ steer, spin });
    }
    // Wheel arch liners (dark) so the wheel sits in a real opening.
    const archG = this.g('arch', () => {
      const a = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 24, 1, true, -Math.PI / 2, Math.PI);
      a.rotateZ(Math.PI / 2);
      return a;
    });
    const archM = new THREE.MeshStandardMaterial({ color: '#08090a', roughness: 1, side: THREE.DoubleSide });
    own.push(archM);
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(archG, archM);
      a.position.set((i % 2 === 0 ? 1 : -1) * (WHEEL_X - 0.02), WHEEL_VIS_R + 0.03, (i < 2 ? 1 : -1) * WHEEL_Z);
      model.add(a);
    }

    return {
      root,
      model,
      wheels,
      dirt,
      setLights: (brake, headOn) => {
        tail.emissiveIntensity = 0.35 + brake * 3.2;
        head.emissiveIntensity = 0.5 + headOn * 1.1;
      },
      setLivery: (lv) => {
        paintLivery(lv);
        tex.needsUpdate = true;
      },
      dispose: () => {
        tex.dispose();
        for (const mm of own) mm.dispose();
      },
    };
  }

  dispose() {
    for (const g of this.geo.values()) g.dispose();
    for (const t of this.tex) t.dispose();
    for (const mm of Object.values(this.mats)) mm.dispose();
  }
}

// ───────────── Livery painter ─────────────

function drawLivery(cv: HTMLCanvasElement, lv: Livery, kind: BodyKind, drawLogo: boolean) {
  const g = cv.getContext('2d')!;
  const W = cv.width;
  const H = cv.height;
  const R = rng(lv.seed);
  g.fillStyle = lv.base;
  g.fillRect(0, 0, W, H);
  // Subtle metallic flake.
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = R() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    g.fillRect(R() * W, R() * H, 2, 2);
  }
  const vy = (v: number) => H - (v / 1.5) * H; // body height (m) -> canvas y
  const flank = (x0: number, noseRight: boolean) => {
    const fw = W * 0.33;
    g.save();
    g.beginPath();
    g.rect(x0, 0, fw, H);
    g.clip();
    g.translate(x0, 0);
    if (!noseRight) {
      g.translate(fw, 0);
      g.scale(-1, 1);
    }
    // Draw as if the nose is on the right: x grows toward the front.
    const X = (t: number) => t * fw;
    // Racing stripe + swoosh in accent.
    g.fillStyle = lv.accent;
    g.beginPath();
    g.moveTo(X(0), vy(0.7));
    g.lineTo(X(0.4), vy(0.62));
    g.lineTo(X(1), vy(0.74));
    g.lineTo(X(1), vy(0.58));
    g.lineTo(X(0.42), vy(0.44));
    g.lineTo(X(0), vy(0.5));
    g.closePath();
    g.fill();
    g.fillStyle = lv.trim;
    g.fillRect(X(0), vy(0.31), fw, vy(0.26) - vy(0.31));
    // Panel lines (doors).
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 3;
    const dl = (t: number) => {
      g.beginPath();
      g.moveTo(X(t), vy(0.95));
      g.lineTo(X(t), vy(0.3));
      g.stroke();
    };
    dl(0.37);
    dl(0.53);
    dl(0.69);
    // Door roundel + number.
    const dx = X(kind === 'coupe' ? 0.5 : 0.45);
    const dy = vy(0.74);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(dx, dy, H * 0.085, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(dx, dy);
    if (!noseRight) g.scale(-1, 1);
    g.fillStyle = '#0b0b0b';
    g.font = `bold ${H * 0.115}px Impact, "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(lv.number, 0, H * 0.008);
    g.restore();
    // Token logo above the front wheel + ticker on the rear quarter.
    const lx = X(0.8);
    const ly = vy(0.56);
    if (drawLogo && lv.logo && lv.logo.complete && lv.logo.naturalWidth) {
      try {
        g.save();
        g.beginPath();
        g.arc(lx, ly, H * 0.075, 0, Math.PI * 2);
        g.clip();
        g.drawImage(lv.logo, lx - H * 0.075, ly - H * 0.075, H * 0.15, H * 0.15);
        g.restore();
      } catch {
        /* tainted logo: skip */
      }
    }
    // Sponsor text (kept readable: flip back when mirrored).
    const text = (s: string, t: number, v: number, size: number, col: string, rot = 0) => {
      g.save();
      g.translate(X(t), vy(v));
      if (!noseRight) g.scale(-1, 1);
      g.rotate(rot);
      g.fillStyle = col;
      g.font = `bold ${size}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s, 0, 0);
      g.restore();
    };
    text(lv.ticker, 0.22, 0.72, H * 0.1, '#ffffff');
    text(lv.sponsors[0] ?? '', 0.2, 0.46, H * 0.062, '#111111');
    text(lv.sponsors[1] ?? '', 0.62, 0.4, H * 0.052, '#ffffff');
    text(lv.sponsors[2] ?? '', 0.86, 0.38, H * 0.046, '#ffffff');
    g.restore();
  };
  flank(0, true);
  flank(W * 0.33, false);
  // Roof + hood region.
  const x0 = W * 0.66;
  const tw = W * 0.34;
  g.save();
  g.beginPath();
  g.rect(x0, 0, tw, H);
  g.clip();
  g.fillStyle = lv.base;
  g.fillRect(x0, 0, tw, H);
  g.fillStyle = lv.accent;
  g.fillRect(x0 + tw * 0.4, 0, tw * 0.2, H);
  g.fillStyle = lv.trim;
  g.fillRect(x0 + tw * 0.375, 0, tw * 0.02, H);
  g.fillRect(x0 + tw * 0.605, 0, tw * 0.02, H);
  // Hood (front is v->1 = canvas top): big number + logo.
  g.save();
  g.translate(x0 + tw / 2, H * 0.12);
  g.rotate(-Math.PI / 2);
  g.fillStyle = '#ffffff';
  g.font = `bold ${tw * 0.34}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(lv.number, 0, 0);
  g.restore();
  if (drawLogo && lv.logo && lv.logo.complete && lv.logo.naturalWidth) {
    try {
      g.drawImage(lv.logo, x0 + tw * 0.3, H * 0.28, tw * 0.4, tw * 0.4);
    } catch {
      /* tainted */
    }
  }
  g.restore();
}
