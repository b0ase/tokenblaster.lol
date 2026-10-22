/**
 * Shared kit for bRacer's team vehicles (./index.ts): parts with per-vertex surface data, one material per vehicle
 * type, a per-frame animation hook, and the shield/flame conventions the engine expects from a Rig (../ships.ts).
 *
 * Every opaque part of a vehicle is merged into as few meshes as possible. A part carries its own colour, metalness,
 * roughness, glow and clearcoat as vertex attributes, so one shared material draws chrome, paint, rubber and LED
 * strips in a single draw call. Ship space: +Z forward, +X left, +Y up.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Detail level, from the engine's quality setting. */
export type Detail = 'low' | 'high' | 'ultra';

/**
 * Surface of a part: colour (sRGB hex), metalness, roughness, glow (emissive gain of the colour), clearcoat, and pcb:
 * how strongly the material's PCB-trace map lights up in the part's colour (0 = none).
 */
export type Surf = { c: string; m: number; r: number; g?: number; cc?: number; pcb?: number };

export const SURF = {
  chrome: { c: '#d9dde3', m: 1, r: 0.16, cc: 0.3 },
  brushed: { c: '#c3c8cf', m: 1, r: 0.3 },
  steel: { c: '#5d636c', m: 1, r: 0.34 },
  dark: { c: '#16181d', m: 0.85, r: 0.38 },
  rubber: { c: '#0d0d0f', m: 0, r: 0.8 },
  carbon: { c: '#1b1d22', m: 0.35, r: 0.42, cc: 0.6 },
} satisfies Record<string, Surf>;

/** Non-indexed copy with exactly position, normal, uv, color and aSurf (merge-safe). */
export function part(g: THREE.BufferGeometry, s: Surf, flat = false): THREE.BufferGeometry {
  const x = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
  if (flat || !x.attributes.normal) {
    x.deleteAttribute('normal');
    x.computeVertexNormals();
  }
  // Degenerate triangles (a serrated profile can make some) leave zero normals, which shade as NaN and, through
  // bloom, black out the whole frame. Give them a harmless normal.
  const nm = x.attributes.normal;
  for (let i = 0; i < nm.count; i++) {
    const l = Math.hypot(nm.getX(i), nm.getY(i), nm.getZ(i));
    if (!(l > 1e-6)) nm.setXYZ(i, 0, 1, 0);
  }
  if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
  const n = x.attributes.position.count;
  const col = new Float32Array(n * 3);
  const surf = new Float32Array(n * 4);
  const pcb = new Float32Array(n).fill(s.pcb ?? 0);
  const c = new THREE.Color(s.c);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    surf[i * 4] = s.m;
    surf[i * 4 + 1] = s.r;
    surf[i * 4 + 2] = s.g ?? 0;
    surf[i * 4 + 3] = s.cc ?? 0;
  }
  x.setAttribute('color', new THREE.BufferAttribute(col, 3));
  x.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
  x.setAttribute('aPcb', new THREE.BufferAttribute(pcb, 1));
  return x;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false);
  if (!m) throw new Error('vehicle: parts did not merge');
  for (const p of parts) p.dispose();
  m.computeBoundingSphere();
  return m;
}

/** Bare position-only (or position+uv) parts for basic/additive meshes. */
export function bare(g: THREE.BufferGeometry, keepUv = false): THREE.BufferGeometry {
  const x = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(x.attributes)) if (k !== 'position' && !(keepUv && k === 'uv')) x.deleteAttribute(k);
  return x;
}
export function mergeBare(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false);
  if (!m) throw new Error('vehicle: bare parts did not merge');
  for (const p of parts) p.dispose();
  return m;
}

/**
 * The kit material: MeshPhysicalMaterial whose metalness, roughness, clearcoat and an extra emissive term come from
 * the part's vertex attributes. Texture maps (a brushed roughness map, say) still multiply on top.
 */
export function kitMaterial(p: THREE.MeshPhysicalMaterialParameters = {}, key = 'kit', pcbMap: THREE.Texture | null = null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 1, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.6, ...p });
  if (pcbMap) m.defines = { ...m.defines, USE_UV: '' };
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSurf;\nvarying vec4 vSurf;\nattribute float aPcb;\nvarying float vPcb;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;\nvPcb = aPcb;');
    if (pcbMap) {
      s.uniforms.pcbMap = { value: pcbMap };
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D pcbMap;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * texture2D( pcbMap, vUv * 1.5 ).r * vPcb;');
    }
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vSurf;\nvarying float vPcb;')
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replace('float roughnessFactor = roughness;', 'float roughnessFactor = vSurf.y;'))
      .replace('#include <metalnessmap_fragment>', THREE.ShaderChunk.metalnessmap_fragment.replace('float metalnessFactor = metalness;', 'float metalnessFactor = vSurf.x;'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vSurf.z;')
      .replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * vSurf.w;');
  };
  m.customProgramCacheKey = () => `bracer-${key}${pcbMap ? '-pcb' : ''}`;
  return m;
}

/** Tapered (optionally rounded) box along +Z from z=0 to z=len: w0×h0 at the root, w1×h1 at the end. */
export function taper(w0: number, h0: number, w1: number, h1: number, len: number, segs = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, segs);
  g.translate(0, 0, 0.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getZ(i);
    p.setXYZ(i, p.getX(i) * (w0 + (w1 - w0) * t), p.getY(i) * (h0 + (h1 - h0) * t), t * len);
  }
  g.computeVertexNormals();
  return g;
}

/** Rounded tapered box along +Z (0..len). `r` is the corner radius as a fraction of the unit box. */
export function rtaper(w0: number, h0: number, w1: number, h1: number, len: number, r = 0.2, segs = 2): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(1, 1, 1, segs, r);
  g.translate(0, 0, 0.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, Math.min(1, p.getZ(i)));
    p.setXYZ(i, p.getX(i) * (w0 + (w1 - w0) * t), p.getY(i) * (h0 + (h1 - h0) * t), p.getZ(i) * len);
  }
  g.computeVertexNormals();
  return g;
}

/** Cylinder along Z (axis +Z), centred at z0..z1. */
export function tube(r0: number, r1: number, z0: number, z1: number, seg = 16, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, Math.abs(z1 - z0), seg, 1, open);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  return g;
}

/** Ring (torus) in the XY plane around the Z axis. */
export function ring(r: number, t: number, z: number, seg = 24): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, t, 6, seg);
  g.translate(0, 0, z);
  return g;
}

/** Engine flame: cone(s) whose base sits at z=0 and tip trails behind, one per engine point (x, y only). */
export function flameGeo(engines: THREE.Vector3[], r: number, len: number, seg = 12, core = true): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const e of engines) {
    for (const [rr, ll] of core ? [[r, len], [r * 0.4, len * 0.55]] : [[r, len]]) {
      const f = new THREE.ConeGeometry(rr, ll, seg, 1, true);
      f.rotateX(-Math.PI / 2);
      f.translate(e.x, e.y, -ll / 2);
      parts.push(bare(f));
    }
  }
  return mergeBare(parts);
}

export function flameMaterial(col: string, gain = 1) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(gain), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
}

export function shieldMesh(len: number) {
  const shield = new THREE.Mesh(new THREE.SphereGeometry(len * 0.62, 18, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#58c8ff').multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  shield.scale.set(1, 0.55, 1.35);
  shield.visible = false;
  return shield;
}

/** Livery canvas + texture (the canvas is what Rig.setLivery repaints). */
export function liveryCanvas(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, tex };
}

/** Deterministic PRNG (mulberry32). Same seed, same sequence: vehicles built from a seed are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a vehicle can read about its own motion each frame, without the engine telling it: thrust and boost come from
 * the flame's length (the engine sets flame.scale.z = 0.3 + thrust*0.6 + boost*0.9 + jitter), turn from the tilt.
 */
export type Motion = { t: number; dt: number; thrust: number; boost: number; roll: number; yaw: number };

export function onFrame(anchor: THREE.Object3D, tilt: THREE.Object3D, flame: THREE.Object3D, fn: (m: Motion) => void) {
  const m: Motion = { t: 0, dt: 0, thrust: 0.3, boost: 0, roll: 0, yaw: 0 };
  let last = -1;
  anchor.onBeforeRender = () => {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (last >= 0 && now - last < 0.004) return; // already stepped this frame (several passes render the scene)
    m.dt = last < 0 ? 0 : Math.min(0.1, now - last);
    last = now;
    m.t = now;
    const z = flame.scale.z;
    const k = Math.min(1, m.dt * 6);
    m.thrust += (Math.max(0, Math.min(1, (z - 0.35) / 0.6)) - m.thrust) * k;
    m.boost += ((z > 1.3 ? 1 : 0) - m.boost) * Math.min(1, m.dt * 4);
    const q = tilt.quaternion;
    m.roll += (2 * Math.asin(Math.max(-1, Math.min(1, q.z))) - m.roll) * k;
    m.yaw += (2 * Math.asin(Math.max(-1, Math.min(1, q.y))) - m.yaw) * k;
    fn(m);
  };
}

/** Brushed metal: fine streaks, for a roughness/bump map. Deterministic. Shared. */
let brushed: THREE.CanvasTexture | null = null;
export function brushedTex() {
  if (brushed) return brushed;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const r = rng(1337);
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = Math.floor(150 + r() * 105);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.globalAlpha = 0.35 + r() * 0.5;
    g.fillRect(r() * 256 - 64, r() * 256, 40 + r() * 200, 1);
  }
  g.globalAlpha = 1;
  brushed = new THREE.CanvasTexture(c);
  brushed.wrapS = brushed.wrapT = THREE.RepeatWrapping;
  brushed.repeat.set(2, 6);
  return brushed;
}

/** Stable non-zero 31-bit seed from a string (FNV-1a): the same racer always gets the same variation. */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}
