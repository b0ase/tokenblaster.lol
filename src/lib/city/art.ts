/**
 * Satoshi City art kit (all code-made, no downloads):
 *  - interior-mapped windows: a shader patch that fakes a lit room behind every pane (parallax walls,
 *    floor, ceiling light, blinds), so facades read as buildings at night instead of a tiled texture
 *  - wet-street light: coloured light pools under lamps and neon, camera-facing reflection streaks on
 *    the wet road, and a small pool of real point lights that follows the player
 *  - Satoshi Square: DR-palette paving with LED inlays, a faceted ₿ monument with neon edges over a
 *    floating block stack, a fountain with animated jets, planters
 * Everything static is merged; nothing allocates per frame.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CURB_H, rng } from './layout';
import type { CityQuality } from '@/lib/visuals/cityQuality';

export const DRC = { ink: '#0a0a0c', paper: '#f2efe6', red: '#e8261d', amber: '#ffb800', cyan: '#27e6ff', magenta: '#ff2f92', acid: '#c8ff1a', blue: '#2a5bff' };

/** Shared uniforms every patched material reads (one write per frame drives the whole city). */
export const cityUniforms = { uNight: { value: 0 }, uTime: { value: 0 } };

export type WindowStyle = {
  /** Window cells per UV unit (UV is 8 m x 16 m per tile on the city's building boxes). */
  cells: [number, number];
  /** Pane rectangle inside a cell, 0..1: x0, y0, x1, y1. */
  pane: [number, number, number, number];
  /** Room depth in metres. */
  depth: number;
  /** Fraction of rooms with the lights on at night. */
  lit: number;
  glass: string;
  seed: number;
};

/**
 * Patch a MeshStandard/Physical building material with interior-mapped windows. Needs world-aligned
 * box faces (normals on the axes or rotated about Y) and the building UV layout from buildingGeo.
 */
export function interiorWindows(mat: THREE.MeshStandardMaterial, st: WindowStyle) {
  mat.emissive.set('#ffffff');
  mat.emissiveMap = null;
  mat.emissiveIntensity = 1;
  const u = {
    uCells: { value: new THREE.Vector2(...st.cells) },
    uPane: { value: new THREE.Vector4(...st.pane) },
    uCellM: { value: new THREE.Vector3(8 / st.cells[0], 16 / st.cells[1], st.depth) },
    uLit: { value: st.lit },
    uGlass: { value: new THREE.Color(st.glass) },
    uSeed: { value: st.seed },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, cityUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN; varying vec2 vBU;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vBW = (modelMatrix * vec4(transformed, 1.0)).xyz; vBN = normalize(mat3(modelMatrix) * objectNormal); vBU = uv;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBW; varying vec3 vBN; varying vec2 vBU;
uniform vec2 uCells; uniform vec4 uPane; uniform vec3 uCellM; uniform float uLit; uniform vec3 uGlass; uniform float uSeed; uniform float uNight;
float bh(vec2 p){ return fract(sin(dot(p + uSeed, vec2(127.1, 311.7))) * 43758.5453); }
vec3 bRoom; float bWin;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 n = normalize(vBN);
  float wall = 1.0 - step(0.5, abs(n.y));
  vec2 c = vBU * uCells;
  vec2 id = floor(c);
  vec2 f = fract(c);
  vec2 pf = (f - uPane.xy) / (uPane.zw - uPane.xy);
  bWin = wall * step(0.0, pf.x) * step(pf.x, 1.0) * step(0.0, pf.y) * step(pf.y, 1.0) * step(5.0, vBW.y);
  bRoom = vec3(0.0);
  if (bWin > 0.5) {
    vec3 t = normalize(cross(-n, vec3(0.0, 1.0, 0.0)));
    vec3 V = normalize(vBW - cameraPosition);
    vec3 d = vec3(dot(V, t) / uCellM.x, V.y / uCellM.y, max(1e-3, dot(V, -n)) / uCellM.z);
    vec3 p = vec3(f, 0.0);
    float tx = d.x > 0.0 ? (1.0 - p.x) / d.x : -p.x / min(d.x, -1e-4);
    float ty = d.y > 0.0 ? (1.0 - p.y) / d.y : -p.y / min(d.y, -1e-4);
    float tz = 1.0 / d.z;
    float tm = min(tx, min(ty, tz));
    vec3 h = p + d * tm;
    float r = bh(id);
    float r2 = bh(id + 17.3);
    vec3 tint = r2 < 0.55 ? vec3(1.0, 0.78, 0.52) : r2 < 0.8 ? vec3(0.75, 0.88, 1.0) : r2 < 0.9 ? vec3(1.0, 0.45, 0.75) : vec3(0.45, 1.0, 0.9);
    vec3 col;
    if (tm == tz) col = vec3(0.55, 0.52, 0.5) * (0.75 + 0.25 * step(0.3, h.y)) * (1.0 - 0.6 * step(h.y, 0.32) * step(0.2, h.x) * step(h.x, 0.75));
    else if (tm == ty) col = d.y > 0.0 ? vec3(1.3) * (1.0 - 0.8 * length(h.xz - vec2(0.5))) : vec3(0.28, 0.24, 0.22);
    else col = vec3(0.42, 0.4, 0.4);
    col *= mix(1.0, 0.5, h.z);
    float on = step(r, uLit);
    // blinds on a third of the windows
    float blind = step(0.66, bh(id + 3.1)) * step(1.0 - bh(id + 7.7) * 0.7, pf.y);
    col = mix(col, vec3(0.9, 0.85, 0.75) * (0.55 + 0.45 * step(0.5, fract(pf.y * 14.0))), blind);
    bRoom = col * tint * mix(0.03, 1.0, on);
    diffuseColor.rgb = mix(diffuseColor.rgb, uGlass, 0.9);
  }
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.14, bWin);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance = bRoom * bWin * (0.06 + uNight * 1.25);',
      );
  };
  mat.customProgramCacheKey = () => `iw${st.seed}`;
  mat.needsUpdate = true;
  return mat;
}

const glowTex = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    t = new THREE.CanvasTexture(c);
    return t;
  };
})();

export type LightSource = { x: number; y: number; z: number; col: string; pool: number; power: number; ox?: number; oz?: number };

/**
 * Night street light: coloured pools on the ground, wet-road reflection streaks that turn towards the
 * camera, and N real point lights re-assigned to the sources nearest the player (N is fixed per tier so
 * no shader recompiles).
 */
export function createStreetLight(scene: THREE.Scene, sources: LightSource[], quality: CityQuality) {
  const n = sources.length;
  // Pools (additive, instanced, coloured).
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, n);
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  sources.forEach((s, k) => {
    tmp.position.set(s.x + (s.ox ?? 0), CURB_H + 0.03, s.z + (s.oz ?? 0));
    tmp.scale.set(s.pool, 1, s.pool);
    tmp.updateMatrix();
    pools.setMatrixAt(k, tmp.matrix);
    pools.setColorAt(k, col.set(s.col).multiplyScalar(0.55 * s.power));
  });
  pools.frustumCulled = false;
  pools.renderOrder = 1;
  scene.add(pools);

  // Reflection streaks: one quad per source, built in the vertex shader to stretch towards the camera.
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new Float32Array(n * 4);
  const iCol = new Float32Array(n * 3);
  sources.forEach((s, k) => {
    iPos.set([s.x, s.y, s.z, s.pool * 0.22], k * 4);
    col.set(s.col);
    iCol.set([col.r * s.power, col.g * s.power, col.b * s.power], k * 3);
  });
  quad.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
  quad.setAttribute('iCol', new THREE.InstancedBufferAttribute(iCol, 3));
  quad.instanceCount = n;
  const streakMat = new THREE.ShaderMaterial({
    uniforms: { uWet: { value: 0 }, uTime: cityUniforms.uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      attribute vec4 iPos; attribute vec3 iCol; varying vec2 vQ; varying vec3 vC; varying float vF; varying vec2 vW;
      void main(){
        vec2 src = iPos.xz;
        vec2 dir = cameraPosition.xz - src; float dl = length(dir); dir /= max(dl, 1e-3);
        vec2 ac = vec2(-dir.y, dir.x);
        // a light at height y reflects to a streak whose length grows as the eye gets lower
        float len = clamp(iPos.y * dl / max(cameraPosition.y + iPos.y, 0.5), 2.0, 26.0);
        float ww = iPos.w;
        vec2 p = src + ac * position.x * ww + dir * (position.y * len - 0.6);
        vQ = position.xy; vC = iCol; vF = 1.0 - smoothstep(60.0, 150.0, dl); vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, ${(CURB_H * 0.5 + 0.02).toFixed(3)}, p.y, 1.0);
      }`,
    fragmentShader: `
      uniform float uWet; uniform float uTime; varying vec2 vQ; varying vec3 vC; varying float vF; varying vec2 vW;
      void main(){
        float qa = vQ.x * 2.6; float across = exp(-qa * qa * 3.0);
        float along = smoothstep(0.0, 0.08, vQ.y) * pow(1.0 - vQ.y, 1.6);
        float rip = 0.65 + 0.35 * sin(vW.x * 3.1 + vW.y * 2.3 + uTime * 2.0) * sin(vW.y * 4.7 - vW.x * 1.3 - uTime * 1.3);
        gl_FragColor = vec4(vC * across * along * rip * uWet * vF, 1.0);
      }`,
  });
  const streaks = new THREE.Mesh(quad, streakMat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 2;
  scene.add(streaks);

  // Real lights near the player.
  let count = quality === 'high' ? 8 : 3;
  const lights: THREE.PointLight[] = [];
  for (let k = 0; k < 8; k++) {
    const l = new THREE.PointLight('#ffffff', 0, 26, 1.6);
    l.visible = k < count;
    lights.push(l);
    scene.add(l);
  }
  const order = sources.map((_, k) => k);
  const dist = new Float32Array(n);
  let nextPick = 0;
  let night = 0;
  const setNight = (nt: number) => {
    night = nt;
    poolMat.opacity = Math.min(1, nt * 1.2);
    pools.visible = nt > 0.02;
    streakMat.uniforms.uWet.value = Math.max(0, nt - 0.15) * 1.1;
    streaks.visible = nt > 0.16;
  };
  const update = (now: number, fx: number, fz: number) => {
    if (now < nextPick) return;
    nextPick = now + 220;
    for (let k = 0; k < n; k++) dist[k] = (sources[k].x - fx) ** 2 + (sources[k].z - fz) ** 2;
    order.sort((a, b) => dist[a] - dist[b]);
    for (let k = 0; k < count; k++) {
      const s = sources[order[k]];
      const l = lights[k];
      if (!s) {
        l.intensity = 0;
        continue;
      }
      l.position.set(s.x + (s.ox ?? 0) * 0.5, s.y - 0.4, s.z + (s.oz ?? 0) * 0.5);
      l.color.set(s.col);
      l.intensity = night * 14 * s.power;
    }
  };
  const setQuality = (q: CityQuality) => {
    count = q === 'high' ? 8 : 3;
    lights.forEach((l, k) => {
      l.visible = k < count;
    });
    nextPick = 0;
  };
  return { setNight, update, setQuality };
}

/** DR plaza paving: graphite tiles, a light stone cross, concentric inlays, chevrons, big floor type. */
function plazaTextures(size: number) {
  const S = 2048;
  const ppm = S / size;
  const c = document.createElement('canvas');
  const e = document.createElement('canvas');
  c.width = c.height = e.width = e.height = S;
  const x = c.getContext('2d')!;
  const ex = e.getContext('2d')!;
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, S, S);
  const r = rng(404);
  const tile = 1.2 * ppm;
  for (let ty = 0; ty < S; ty += tile)
    for (let tx = 0; tx < S; tx += tile) {
      const v = 38 + r() * 14;
      x.fillStyle = `rgb(${v},${v},${v + 4})`;
      x.fillRect(tx, ty, tile, tile);
    }
  x.strokeStyle = 'rgba(0,0,0,0.55)';
  x.lineWidth = 2;
  for (let k = 0; k <= S; k += tile) {
    x.beginPath();
    x.moveTo(k, 0);
    x.lineTo(k, S);
    x.moveTo(0, k);
    x.lineTo(S, k);
    x.stroke();
  }
  const C = S / 2;
  const m = (v: number) => v * ppm;
  // light stone avenues on the axes
  for (const vert of [true, false]) {
    x.save();
    x.translate(C, C);
    if (vert) x.rotate(Math.PI / 2);
    for (let a = -size / 2; a < size / 2; a += 0.8) {
      for (let b = -2.4; b < 2.4; b += 0.8) {
        const v = 180 + r() * 30;
        x.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        x.fillRect(m(a), m(b), m(0.8) - 2, m(0.8) - 2);
      }
    }
    // amber chevrons pointing at the monument
    x.fillStyle = DRC.amber;
    for (const sgn of [-1, 1])
      for (let a = 14; a < size / 2 - 3; a += 3.2) {
        x.beginPath();
        x.moveTo(m(sgn * a), m(-1.2));
        x.lineTo(m(sgn * (a - 1.2)), 0);
        x.lineTo(m(sgn * a), m(1.2));
        x.lineTo(m(sgn * (a + 0.5)), m(1.2));
        x.lineTo(m(sgn * (a - 0.7)), 0);
        x.lineTo(m(sgn * (a + 0.5)), m(-1.2));
        x.fill();
      }
    x.restore();
  }
  // rings: paper band, chequer band, LED lines
  const ring = (r0: number, r1: number, style: string) => {
    x.beginPath();
    x.arc(C, C, m(r1), 0, Math.PI * 2);
    x.arc(C, C, m(r0), 0, Math.PI * 2, true);
    x.fillStyle = style;
    x.fill();
  };
  ring(7.2, 9.4, '#d9d4c8');
  for (let k = 0; k < 48; k++) {
    x.beginPath();
    const a0 = (k / 48) * Math.PI * 2;
    const a1 = ((k + 1) / 48) * Math.PI * 2;
    x.arc(C, C, m(12), a0, a1);
    x.arc(C, C, m(10.4), a1, a0, true);
    x.fillStyle = k % 2 ? '#111114' : '#e8e3d6';
    x.fill();
  }
  ring(12.6, 13.0, DRC.red);
  const led = (rad: number, colr: string, w: number) => {
    for (const ctx of [x, ex]) {
      ctx.beginPath();
      ctx.arc(C, C, m(rad), 0, Math.PI * 2);
      ctx.strokeStyle = colr;
      ctx.lineWidth = m(w);
      ctx.stroke();
    }
  };
  led(9.8, DRC.cyan, 0.16);
  led(14.2, DRC.magenta, 0.12);
  // LED strips running out along the avenues
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    for (const side of [-2.6, 2.6]) {
      for (const ctx of [x, ex]) {
        ctx.strokeStyle = DRC.cyan;
        ctx.lineWidth = m(0.1);
        ctx.beginPath();
        ctx.moveTo(C + m(dx * 14.2 + dy * side), C + m(dy * 14.2 + dx * side));
        ctx.lineTo(C + m(dx * (size / 2) + dy * side), C + m(dy * (size / 2) + dx * side));
        ctx.stroke();
      }
    }
  // floor type, DR style, in the four quadrants
  const words: [string, string][] = [
    ['SATOSHI SQ.', 'サトシ広場'],
    ['BLOCK 0', 'ジェネシス'],
    ['PROOF OF WORK', 'プルーフ'],
    ['21,000,000', 'サトシ'],
  ];
  words.forEach(([w, jp], k) => {
    const qx = k % 2 ? 1 : -1;
    const qy = k < 2 ? -1 : 1;
    x.save();
    x.translate(C + m(qx * 16), C + m(qy * 21.5));
    x.fillStyle = 'rgba(242,239,230,0.85)';
    x.font = `italic 900 ${m(2.1)}px Impact, "Arial Black", sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(w, 0, 0, m(17));
    x.fillStyle = DRC.amber;
    x.font = `700 ${m(0.9)}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
    x.fillText(jp, 0, m(1.9), m(17));
    x.fillRect(-m(8), m(2.8), m(16), m(0.18));
    x.restore();
  });
  // wear
  for (let k = 0; k < 900; k++) {
    x.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
    const s = r() * 30 + 4;
    x.fillRect(r() * S, r() * S, s, s);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissiveMap = new THREE.CanvasTexture(e);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

/** A ₿ outline: stem plus two bowls (holes cut), centred on the origin, height h. */
function bitcoinShape(h: number) {
  const w = h * 0.62;
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const mid = 0;
  const top = h / 2;
  const bot = -h / 2;
  const rTop = (top - mid) / 2;
  const rBot = (mid - bot) / 2;
  const xr = w / 2 - rBot;
  s.moveTo(x0, bot);
  s.lineTo(xr, bot);
  s.absarc(xr, bot + rBot, rBot, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(xr - rBot * 0.15, mid);
  s.absarc(xr - rTop * 0.15 - 0.0001, mid + rTop, rTop * 0.92, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(x0, top);
  s.lineTo(x0, bot);
  const t = h * 0.15;
  const hole = (y0: number, y1: number, rr: number, xc: number) => {
    const p = new THREE.Path();
    p.moveTo(x0 + t, y0);
    p.lineTo(xc, y0);
    p.absarc(xc, (y0 + y1) / 2, (y1 - y0) / 2, -Math.PI / 2, Math.PI / 2, false);
    p.lineTo(x0 + t, y1);
    p.lineTo(x0 + t, y0);
    return p;
  };
  s.holes.push(hole(bot + t, mid - t * 0.4, rBot - t, xr));
  s.holes.push(hole(mid + t * 0.4, top - t, rTop - t, xr - rTop * 0.15));
  // the two serifs through top and bottom
  const bars: THREE.Shape[] = [];
  for (const bx of [x0 + w * 0.22, x0 + w * 0.48])
    for (const [y0, y1] of [
      [top - 0.01, top + h * 0.13],
      [bot - h * 0.13, bot + 0.01],
    ]) {
      const b = new THREE.Shape();
      b.moveTo(bx, y0);
      b.lineTo(bx + h * 0.09, y0);
      b.lineTo(bx + h * 0.09, y1);
      b.lineTo(bx, y1);
      b.lineTo(bx, y0);
      bars.push(b);
    }
  return [s, ...bars];
}

/** Satoshi Square centrepiece, paving, fountain and planters. Returns a per-frame update. */
export function buildPlaza(scene: THREE.Scene, cx: number, cz: number, size: number) {
  const group = new THREE.Group();
  group.position.set(cx, CURB_H, cz);
  scene.add(group);
  const y0 = 0;
  // Paving with LED inlays.
  const tex = plazaTextures(size);
  const paveMat = new THREE.MeshStandardMaterial({ map: tex.map, emissive: '#ffffff', emissiveMap: tex.emissiveMap, emissiveIntensity: 0.2, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.9 });
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), paveMat);
  pave.position.y = y0 + 0.012;
  pave.receiveShadow = true;
  group.add(pave);

  // Fountain basin: dark granite rim with an LED lip, black mirror water, jets.
  const granite = new THREE.MeshStandardMaterial({ color: '#1c1c22', roughness: 0.35, metalness: 0.2 });
  const lip = new THREE.MeshBasicMaterial({ color: new THREE.Color(DRC.cyan), toneMapped: false });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.9, 0.7, 64, 1, true), granite);
  rim.position.y = 0.35;
  const rimIn = new THREE.Mesh(new THREE.CylinderGeometry(6.1, 6.1, 0.7, 64, 1, true), granite);
  rimIn.position.y = 0.35;
  (rimIn.material as THREE.Material).side = THREE.DoubleSide;
  const rimTop = new THREE.Mesh(new THREE.RingGeometry(6.1, 6.6, 64).rotateX(-Math.PI / 2), granite);
  rimTop.position.y = 0.7;
  const lipRing = new THREE.Mesh(new THREE.TorusGeometry(6.62, 0.035, 6, 96).rotateX(Math.PI / 2), lip);
  lipRing.position.y = 0.66;
  const waterMat = new THREE.MeshStandardMaterial({ color: '#05070c', roughness: 0.12, metalness: 0.9, envMapIntensity: 2 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(6.1, 64).rotateX(-Math.PI / 2), waterMat);
  water.position.y = 0.5;
  for (const o of [rim, rimIn, rimTop]) {
    o.castShadow = o.receiveShadow = true;
  }
  group.add(rim, rimIn, rimTop, lipRing, water);

  // Plinth: stacked bevelled slabs (block-chain) with emissive seams.
  const plinthMat = new THREE.MeshStandardMaterial({ color: '#16161b', roughness: 0.3, metalness: 0.6 });
  const seamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(DRC.magenta).multiplyScalar(2.2), toneMapped: false });
  const slabs: THREE.BufferGeometry[] = [];
  const seams: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const s = 3.2 - k * 0.6;
    slabs.push(new THREE.BoxGeometry(s, 0.7, s).rotateY(k * 0.26).translate(0, 0.55 + k * 0.78, 0));
    seams.push(new THREE.BoxGeometry(s + 0.04, 0.05, s + 0.04).rotateY(k * 0.26).translate(0, 0.92 + k * 0.78, 0));
  }
  const plinth = new THREE.Mesh(mergeGeometries(slabs), plinthMat);
  plinth.castShadow = plinth.receiveShadow = true;
  const seamMesh = new THREE.Mesh(mergeGeometries(seams), seamMat);
  group.add(plinth, seamMesh);

  // The ₿: faceted (chamfered) extrusion, dark gold chrome, with neon edge lines.
  const H = 7.5;
  const shapes = bitcoinShape(H);
  const coinGeo = new THREE.ExtrudeGeometry(shapes, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.28, bevelSize: 0.22, bevelSegments: 1, curveSegments: 10 });
  coinGeo.translate(0.15, 0, -0.55);
  coinGeo.computeVertexNormals();
  const gold = new THREE.MeshStandardMaterial({ color: '#c99a2e', metalness: 1, roughness: 0.18, envMapIntensity: 1.6, flatShading: true, emissive: '#3a2200', emissiveIntensity: 0.4 });
  const coin = new THREE.Mesh(coinGeo, gold);
  coin.castShadow = true;
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(DRC.amber).multiplyScalar(2.4), toneMapped: false, transparent: true, opacity: 0.9 });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(coinGeo, 28), edgeMat);
  const coinPivot = new THREE.Group();
  coinPivot.position.y = 3.4 + H / 2 + 1.4;
  coinPivot.add(coin, edges);
  group.add(coinPivot);

  // Orbiting holographic blocks: 21 translucent cubes in a slow helix round the ₿.
  const holoMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(DRC.cyan).multiplyScalar(1.4), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const holoEdge = new THREE.LineBasicMaterial({ color: new THREE.Color(DRC.cyan).multiplyScalar(2), toneMapped: false, transparent: true, opacity: 0.8 });
  const cubeGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const cubeEdges = new THREE.EdgesGeometry(cubeGeo);
  const ORB = 21;
  const orbit = new THREE.InstancedMesh(cubeGeo, holoMat, ORB);
  const orbitLines: THREE.LineSegments[] = [];
  const orbitGroup = new THREE.Group();
  orbitGroup.add(orbit);
  for (let k = 0; k < ORB; k++) {
    const l = new THREE.LineSegments(cubeEdges, holoEdge);
    orbitLines.push(l);
    orbitGroup.add(l);
  }
  orbit.frustumCulled = false;
  group.add(orbitGroup);

  // Jets: thin additive columns round the rim that pulse; a mist ring.
  const jetMat = new THREE.MeshBasicMaterial({ color: '#cfefff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const JETS = 16;
  const jets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.11, 1, 6, 1, true).translate(0, 0.5, 0), jetMat, JETS);
  jets.frustumCulled = false;
  group.add(jets);
  const mistMat = new THREE.MeshBasicMaterial({ map: glowTex(), color: '#9fdcff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  const mist = new THREE.Mesh(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), mistMat);
  mist.position.y = 0.56;
  group.add(mist);
  // Up-lights in the water aimed at the ₿.
  const up = new THREE.SpotLight('#ffcf7a', 0, 30, 0.5, 0.6, 1.2);
  up.position.set(0, 0.6, 4.5);
  up.target = coinPivot;
  group.add(up);

  // Corner planters: raised granite boxes with a lit rim, hedges and two trees each (trees from world).
  const planterGeos: THREE.BufferGeometry[] = [];
  const hedgeGeos: THREE.BufferGeometry[] = [];
  const planterLed: THREE.BufferGeometry[] = [];
  const r = rng(99);
  for (const [qx, qz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const px = qx * 18;
    const pz = qz * 18;
    for (const [w, d, ox, oz] of [
      [12, 0.5, 0, -5.75],
      [12, 0.5, 0, 5.75],
      [0.5, 11, -5.75, 0],
      [0.5, 11, 5.75, 0],
    ]) {
      planterGeos.push(new THREE.BoxGeometry(w, 0.75, d).translate(px + ox, 0.375, pz + oz));
      planterLed.push(new THREE.BoxGeometry(w + 0.02, 0.04, d + 0.02).translate(px + ox, 0.62, pz + oz));
    }
    for (let k = 0; k < 18; k++) {
      const g = new THREE.IcosahedronGeometry(0.7 + r() * 0.5, 1);
      g.scale(1.3, 0.6, 1.3);
      g.translate(px + (r() - 0.5) * 9.5, 0.8, pz + (r() - 0.5) * 9.5);
      hedgeGeos.push(g);
    }
  }
  const planters = new THREE.Mesh(mergeGeometries(planterGeos), granite);
  planters.castShadow = planters.receiveShadow = true;
  const hedgeMat = new THREE.MeshStandardMaterial({ color: '#4f8a3a', roughness: 0.85, flatShading: true });
  const hedges = new THREE.Mesh(mergeGeometries(hedgeGeos), hedgeMat);
  hedges.castShadow = hedges.receiveShadow = true;
  const pLedMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(DRC.amber).multiplyScalar(1.6), toneMapped: false });
  const pLed = new THREE.Mesh(mergeGeometries(planterLed), pLedMat);
  const soil = new THREE.Mesh(
    mergeGeometries(
      [
        [-18, -18],
        [18, -18],
        [-18, 18],
        [18, 18],
      ].map(([x, z]) => new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2).translate(x, 0.62, z)),
    ),
    new THREE.MeshStandardMaterial({ color: '#2c3a22', roughness: 1 }),
  );
  soil.receiveShadow = true;
  group.add(planters, hedges, pLed, soil);

  const m4 = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const ee = new THREE.Euler();
  const vv = new THREE.Vector3();
  const ss = new THREE.Vector3();
  let nightV = 0;
  const update = (now: number, night: number) => {
    nightV = night;
    const t = now / 1000;
    coinPivot.rotation.y = t * 0.35;
    coinPivot.position.y = 3.4 + H / 2 + 1.4 + Math.sin(t * 0.8) * 0.25;
    for (let k = 0; k < ORB; k++) {
      const a = (k / ORB) * Math.PI * 2 * 1.5 + t * 0.25;
      const rad = 5.2 + Math.sin(k * 1.7) * 0.4;
      vv.set(Math.cos(a) * rad, 2.6 + (k / ORB) * 10 + Math.sin(t + k) * 0.2, Math.sin(a) * rad);
      ee.set(t * 0.4 + k, t * 0.3 + k * 0.5, 0);
      qq.setFromEuler(ee);
      const s = 0.55 + ((k * 7) % 5) * 0.12;
      m4.compose(vv, qq, ss.set(s, s, s));
      orbit.setMatrixAt(k, m4);
      orbitLines[k].position.copy(vv);
      orbitLines[k].quaternion.copy(qq);
      orbitLines[k].scale.setScalar(s);
    }
    orbit.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < JETS; k++) {
      const a = (k / JETS) * Math.PI * 2;
      const hgt = 1.6 + 1.2 * (0.5 + 0.5 * Math.sin(t * 2.2 + k * 0.9));
      m4.compose(vv.set(Math.cos(a) * 5.4, 0.5, Math.sin(a) * 5.4), qq.setFromAxisAngle(ss.set(-Math.sin(a), 0, Math.cos(a)), 0.18), ss.set(1, hgt, 1));
      jets.setMatrixAt(k, m4);
    }
    jets.instanceMatrix.needsUpdate = true;
    holoMat.opacity = 0.18 + nightV * 0.22;
    holoEdge.opacity = 0.4 + nightV * 0.5;
    paveMat.emissiveIntensity = 0.15 + nightV * 2.2;
    gold.emissiveIntensity = 0.25 + nightV * 0.5;
    up.intensity = nightV * 400;
    jetMat.opacity = 0.35 + nightV * 0.3;
    edgeMat.opacity = 0.35 + nightV * 0.65;
  };
  return { update };
}
