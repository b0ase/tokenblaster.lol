/** bRacer world: procedural sky, glossy track, tunnels, megastructure city, signage, pads, speed lines, particles. */
import * as THREE from 'three';
import { rng } from '@/lib/rally/noise';
import { drawLogo, drawSign, drawTextSign, SIGN_COUNT } from './signs';
import { frameAt, HALF_W, newFrame, STEP, surfaceH, type Track } from './track';

export type Quality = 'low' | 'high' | 'ultra';

const col = (c: string, k = 1) => new THREE.Color(c).multiplyScalar(k);
const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const texOf = (c: HTMLCanvasElement, srgb: boolean, rep = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};

// ───────────── Sky ─────────────

export function buildSky(p: Track['def']['palette']) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uZen: { value: col(p.zenith) }, uHor: { value: col(p.horizon) }, uGlow: { value: col(p.glow) }, uSun: { value: col(p.sun) }, uFog: { value: col(p.fog) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uSun; uniform vec3 uFog;
      varying vec3 vD;
      float hash(vec3 p){ p = fract(p*0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vD);
        float h = d.y;
        vec3 c = mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.42));
        c = mix(c, uHor * 1.15, exp(-abs(h) * 14.0) * 0.55);
        // Below the horizon: city haze.
        c = mix(c, uFog * 1.2, smoothstep(0.0, -0.25, h));
        // Nebula.
        float n = fbm(d * 2.6 + vec3(3.0, 1.0, 7.0));
        c += uGlow * smoothstep(0.45, 0.85, n) * 0.55 * smoothstep(0.0, 0.5, h);
        // Stars.
        vec3 sp = d * 220.0;
        float st = step(0.9965, hash(floor(sp))) * smoothstep(0.08, 0.4, h);
        c += vec3(st) * 1.6;
        // Planet with a ring.
        vec3 pd = normalize(vec3(0.55, 0.28, -0.78));
        float dp = dot(d, pd);
        float disc = smoothstep(0.9915, 0.993, dp);
        vec3 pc = mix(uGlow * 0.4, uSun, pow(max(dot(normalize(d - pd * dp), vec3(-0.6, 0.5, 0.6)), 0.0), 1.5));
        c = mix(c, pc, disc);
        vec3 q = d - pd * dp;
        float ring = smoothstep(0.1, 0.0, abs(length(q * vec3(1.0, 3.2, 1.0)) - 0.17)) * step(dp, 0.999) * 0.8;
        c += uSun * ring * smoothstep(0.97, 0.99, dp) * 0.8;
        // Horizon sun bloom.
        float sd = max(dot(d, normalize(vec3(-0.5, 0.05, 0.85))), 0.0);
        c += uSun * pow(sd, 24.0) * 0.9 + uHor * pow(sd, 4.0) * 0.25;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// ───────────── Track ─────────────

function trackTextures(p: Track['def']['palette']) {
  const S = 512;
  const c = canvas(S, S);
  const e = canvas(S, S);
  const r = canvas(S, S);
  const g = c.getContext('2d')!;
  const ge = e.getContext('2d')!;
  const gr = r.getContext('2d')!;
  const R = rng(5);
  g.fillStyle = '#10131c';
  g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  gr.fillStyle = '#5a5a5a';
  gr.fillRect(0, 0, S, S);
  // Panels: 6 across, 4 along.
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${Math.floor(R() * 40)},${Math.floor(R() * 44)},${Math.floor(R() * 56)},0.35)`;
    g.fillRect(R() * S, R() * S, 2 + R() * 6, 1 + R() * 3);
  }
  const cols = 6;
  const rows = 4;
  g.strokeStyle = '#04060a';
  gr.strokeStyle = '#d0d0d0';
  g.lineWidth = 5;
  gr.lineWidth = 5;
  for (let i = 0; i <= cols; i++) {
    g.beginPath(); g.moveTo((i * S) / cols, 0); g.lineTo((i * S) / cols, S); g.stroke();
    gr.beginPath(); gr.moveTo((i * S) / cols, 0); gr.lineTo((i * S) / cols, S); gr.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    g.beginPath(); g.moveTo(0, (j * S) / rows); g.lineTo(S, (j * S) / rows); g.stroke();
    gr.beginPath(); gr.moveTo(0, (j * S) / rows); gr.lineTo(S, (j * S) / rows); gr.stroke();
  }
  // Highlight edges of panels.
  g.strokeStyle = 'rgba(120,140,190,0.18)';
  g.lineWidth = 1.5;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) g.strokeRect((i * S) / cols + 4, (j * S) / rows + 4, S / cols - 8, S / rows - 8);
  // Glossy streaks.
  for (let i = 0; i < 18; i++) {
    gr.fillStyle = `rgba(0,0,0,${0.15 + R() * 0.25})`;
    gr.fillRect(R() * S, 0, 6 + R() * 18, S);
  }
  // Edge light bars (emissive) and lane dashes.
  const bar = (x: number, w: number, colr: string) => {
    ge.fillStyle = colr;
    ge.fillRect(x, 0, w, S);
    g.fillStyle = '#050608';
    g.fillRect(x, 0, w, S);
  };
  bar(0, 14, p.a1);
  bar(S - 14, 14, p.a2);
  ge.fillStyle = p.a1;
  ge.globalAlpha = 0.5;
  ge.fillRect(26, 0, 4, S);
  ge.fillStyle = p.a2;
  ge.fillRect(S - 30, 0, 4, S);
  ge.globalAlpha = 1;
  for (let k = 0; k < 4; k++) {
    ge.fillStyle = 'rgba(255,255,255,0.75)';
    ge.fillRect(S / 2 - 4, k * (S / 4) + 20, 8, S / 8);
  }
  // Data ticks.
  for (let i = 0; i < 40; i++) {
    ge.fillStyle = R() > 0.5 ? p.a1 : p.a2;
    ge.globalAlpha = 0.3 + R() * 0.4;
    ge.fillRect(40 + R() * (S - 80), R() * S, 3 + R() * 10, 3);
  }
  ge.globalAlpha = 1;
  return { map: texOf(c, true), emissive: texOf(e, true), rough: texOf(r, false) };
}

function chevronTex(base: string, fg: string, hazard = false) {
  const c = canvas(256, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = fg;
  if (hazard) {
    for (let k = -2; k < 8; k++) {
      g.beginPath();
      g.moveTo(k * 64, 0);
      g.lineTo(k * 64 + 32, 0);
      g.lineTo(k * 64 + 32 + 256, 256);
      g.lineTo(k * 64 + 256, 256);
      g.fill();
    }
  } else {
    for (let k = 0; k < 2; k++) {
      const y = 20 + k * 128;
      g.beginPath();
      g.moveTo(20, y + 90);
      g.lineTo(128, y);
      g.lineTo(236, y + 90);
      g.lineTo(236, y + 130);
      g.lineTo(128, y + 40);
      g.lineTo(20, y + 130);
      g.closePath();
      g.fill();
    }
  }
  return texOf(c, true);
}

/** A strip of the track surface as a conforming mesh (decals, pads). */
function strip(tr: Track, s0: number, s1: number, lat0: number, lat1: number, lift: number, vRep: number, ls = 2) {
  const f = newFrame();
  const segs = Math.max(2, Math.ceil((s1 - s0) / STEP));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const s = s0 + ((s1 - s0) * i) / segs;
    frameAt(tr, s, f);
    for (let j = 0; j <= ls; j++) {
      const lat = lat0 + ((lat1 - lat0) * j) / ls;
      const h = surfaceH(tr.pipe[f.i], lat) + lift;
      pos.push(f.px + f.rx * lat + f.ux * h, f.py + f.ry * lat + f.uy * h, f.pz + f.rz * lat + f.uz * h);
      uv.push(j / ls, ((s - s0) / (s1 - s0)) * vRep);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < ls; j++) {
    const a = i * (ls + 1) + j;
    idx.push(a, a + 1, a + ls + 1, a + 1, a + ls + 2, a + ls + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ribbon through a lateral/height profile for every sample. */
function profileMesh(tr: Track, prof: [number, number][], vEvery: number, pipeAware: boolean) {
  const n = tr.n;
  const m = prof.length;
  const pos = new Float32Array((n + 1) * m * 3);
  const uv = new Float32Array((n + 1) * m * 2);
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    for (let j = 0; j < m; j++) {
      const [lat, h0] = prof[j];
      const h = h0 + (pipeAware ? surfaceH(tr.pipe[k], lat) : 0);
      const o = (i * m + j) * 3;
      pos[o] = tr.px[k] + tr.rx[k] * lat + tr.ux[k] * h;
      pos[o + 1] = tr.py[k] + tr.ry[k] * lat + tr.uy[k] * h;
      pos[o + 2] = tr.pz[k] + tr.rz[k] * lat + tr.uz[k] * h;
      uv[(i * m + j) * 2] = j / (m - 1);
      uv[(i * m + j) * 2 + 1] = (i * STEP) / vEvery;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j;
    idx.push(a, a + 1, a + m, a + 1, a + m + 1, a + m);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export type World = {
  group: THREE.Group;
  sky: THREE.Mesh;
  update(dt: number, time: number, camPos: THREE.Vector3): void;
  cells: { setActive(i: number, on: boolean): void; count: number };
  weapons: { setActive(i: number, on: boolean): void; pos: THREE.Vector3[] };
  cellPos: THREE.Vector3[];
  padTex: THREE.Texture;
  strobe: (t: number) => void;
  dispose(): void;
};

const WINDOW_MAT = (tint: number) => {
  const m = new THREE.MeshStandardMaterial({ color: '#272b38', metalness: 0.6, roughness: 0.4 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying vec3 vWn; varying float vSeed;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wq = vec4(transformed, 1.0);
        vec3 nq = objectNormal;
        #ifdef USE_INSTANCING
          wq = instanceMatrix * wq;
          nq = mat3(instanceMatrix) * nq;
          vSeed = instanceMatrix[3].x * 0.0137 + instanceMatrix[3].z * 0.0071;
        #else
          vSeed = 0.0;
        #endif
        vWp = (modelMatrix * wq).xyz;
        vWn = normalize(nq);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp; varying vec3 vWn; varying float vSeed;\nfloat wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float sideF = 1.0 - step(0.6, abs(vWn.y));
          vec2 uvw = vec2(dot(vWp.xz, vec2(vWn.z, -vWn.x)), vWp.y);
          vec2 cell = uvw / vec2(${(3.6 + tint * 0.8).toFixed(1)}, 5.0);
          vec2 id = floor(cell); vec2 fr = fract(cell);
          float win = step(0.18, fr.x) * step(fr.x, 0.82) * step(0.3, fr.y) * step(fr.y, 0.78);
          float hh = wh(id + vSeed * 17.0);
          float lit = step(0.52, hh);
          vec3 wc = mix(vec3(1.0, 0.82, 0.55), vColor.rgb * 2.4, step(0.6, wh(id.yx + 3.0 + vSeed)));
          totalEmissiveRadiance += wc * win * lit * sideF * (0.8 + 1.1 * wh(id + 7.0));
          // Roof-edge neon band every so often.
          float band = step(0.93, fract(vWp.y * 0.012 + vSeed)) * sideF;
          totalEmissiveRadiance += vColor.rgb * 1.8 * band;
        }`,
      );
  };
  return m;
};

export function buildWorld(tr: Track, q: Quality, renderer: THREE.WebGLRenderer, pitLane = true): World {
  const p = tr.def.palette;
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T) => (disposables.push(o), o);
  const sky = buildSky(p);
  const f = newFrame();
  const R = rng(tr.def.seed * 7 + 1);

  // Track surface.
  const tt = trackTextures(p);
  own(tt.map); own(tt.emissive); own(tt.rough);
  const topMat = own(new THREE.MeshStandardMaterial({ map: tt.map, emissiveMap: tt.emissive, emissive: '#ffffff', emissiveIntensity: 1.25, roughnessMap: tt.rough, roughness: 1, metalness: 0.7, envMapIntensity: 0.9, side: THREE.DoubleSide }));
  const LS = 24;
  const topProf: [number, number][] = [];
  for (let j = 0; j <= LS; j++) topProf.push([-HALF_W + (2 * HALF_W * j) / LS, 0]);
  const top = new THREE.Mesh(own(profileMesh(tr, topProf, 18, true)), topMat);
  top.frustumCulled = false;
  group.add(top);
  // Structure under and beside the track.
  const darkMat = own(new THREE.MeshStandardMaterial({ color: '#12141b', metalness: 0.85, roughness: 0.4, side: THREE.DoubleSide, envMapIntensity: 1.2 }));
  const under = new THREE.Mesh(
    own(profileMesh(tr, [[-HALF_W - 0.6, 1.5], [-HALF_W - 0.6, -1.2], [-8, -1.8], [-5, -5.5], [5, -5.5], [8, -1.8], [HALF_W + 0.6, -1.2], [HALF_W + 0.6, 1.5]], 6, false)),
    darkMat,
  );
  under.frustumCulled = false;
  group.add(under);
  // Neon rails (HDR basic, bloom picks them up).
  const mkRail = (lat: number, colr: string) => {
    const prof: [number, number][] = [[lat - 0.45, 1.55], [lat + 0.45, 1.55]];
    const m = new THREE.Mesh(own(profileMesh(tr, prof, 10, true)), own(new THREE.MeshBasicMaterial({ color: col(colr, 4.2), side: THREE.DoubleSide })));
    m.frustumCulled = false;
    group.add(m);
    const wall = new THREE.Mesh(own(profileMesh(tr, [[lat + Math.sign(lat) * 0.5, 0], [lat + Math.sign(lat) * 0.5, 1.5], [lat - Math.sign(lat) * 0.5, 1.5]], 10, true)), darkMat);
    wall.frustumCulled = false;
    group.add(wall);
  };
  mkRail(-HALF_W, p.a1);
  mkRail(HALF_W, p.a2);

  // Boost pads (animated chevrons), jump ramps (hazard), weapon pads.
  const padTex = own(chevronTex('#06090f', '#ffffff'));
  padTex.repeat.set(1, 1);
  const padMat = own(new THREE.MeshBasicMaterial({ map: padTex, color: col(p.a1, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const padGeos = tr.pads.map((pd) => strip(tr, pd.s - 4, pd.s + 12, pd.lat - 5, pd.lat + 5, 0.1, 4));
  for (const g of padGeos) {
    const m = new THREE.Mesh(own(g), padMat);
    m.frustumCulled = false;
    group.add(m);
  }
  const hazTex = own(chevronTex('#ffe600', '#111111', true));
  const hazMat = own(new THREE.MeshBasicMaterial({ map: hazTex, color: col('#ffffff', 1.6), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  for (const js of tr.jumps) {
    const m = new THREE.Mesh(own(strip(tr, js - 4, js + 14, -HALF_W + 1, HALF_W - 1, 0.1, 3, 8)), hazMat);
    m.frustumCulled = false;
    group.add(m);
  }

  // Pit lane: a green recharge strip along the left edge.
  if (pitLane) {
    const pc = canvas(256, 256);
    const pg = pc.getContext('2d')!;
    pg.fillStyle = '#04140a';
    pg.fillRect(0, 0, 256, 256);
    pg.fillStyle = '#18ff7a';
    pg.fillRect(0, 0, 256, 10);
    pg.fillRect(0, 246, 256, 10);
    pg.fillRect(120, 70, 16, 116);
    pg.fillRect(70, 120, 116, 16);
    const pitTex = own(texOf(pc, true));
    const pitMat = own(new THREE.MeshBasicMaterial({ map: pitTex, color: col('#ffffff', 1.5), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const [a, b] = tr.def.pit;
    const pm = new THREE.Mesh(own(strip(tr, a * tr.len, b * tr.len, -HALF_W + 1, -9, 0.1, ((b - a) * tr.len) / 12, 4)), pitMat);
    pm.frustumCulled = false;
    group.add(pm);
  }
  // Cells (energy), weapon pads: instanced.
  const dummy = new THREE.Object3D();
  const cellGeo = own(new THREE.OctahedronGeometry(0.8, 0));
  const cellMat = own(new THREE.MeshBasicMaterial({ color: col('#ffe66a', 3.2) }));
  const cells = new THREE.InstancedMesh(cellGeo, cellMat, Math.max(1, tr.cells.length));
  cells.frustumCulled = false;
  const cellPos = tr.cells.map((c) => {
    frameAt(tr, c.s, f);
    return new THREE.Vector3(f.px + f.rx * c.lat + f.ux * 2.2, f.py + f.ry * c.lat + f.uy * 2.2, f.pz + f.rz * c.lat + f.uz * 2.2);
  });
  const cellOn = tr.cells.map(() => true);
  group.add(cells);
  const wpos = tr.weapons.map((w) => {
    frameAt(tr, w.s, f);
    return { p: new THREE.Vector3(f.px + f.rx * w.lat + f.ux * 0.15, f.py + f.ry * w.lat + f.uy * 0.15, f.pz + f.rz * w.lat + f.uz * 0.15), u: new THREE.Vector3(f.ux, f.uy, f.uz), t: new THREE.Vector3(f.tx, f.ty, f.tz) };
  });
  const wpadGeo = own(new THREE.CylinderGeometry(2.6, 2.6, 0.14, 6));
  const wpadMat = own(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const wpads = new THREE.InstancedMesh(wpadGeo, wpadMat, Math.max(1, wpos.length));
  wpads.frustumCulled = false;
  const wcubeGeo = own(new THREE.BoxGeometry(1.5, 1.5, 1.5));
  const wcubes = new THREE.InstancedMesh(wcubeGeo, own(new THREE.MeshBasicMaterial({ color: '#ffffff' })), Math.max(1, wpos.length));
  wcubes.frustumCulled = false;
  group.add(wpads, wcubes);
  const wOn = wpos.map(() => true);
  const hueCol = new THREE.Color();
  const q0 = new THREE.Quaternion();
  const bas = new THREE.Matrix4();
  const lv = new THREE.Vector3();
  // Tunnels.
  const tunnelRanges: [number, number][] = tr.def.tunnels.map(([a, b]) => [a * tr.len, b * tr.len]);
  const rib = canvas(256, 128);
  {
    const g = rib.getContext('2d')!;
    g.fillStyle = '#0b0d13';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1c2030';
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 2, 4, 28, 120);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 6);
    g.fillRect(0, 122, 256, 6);
  }
  const ribTex = own(texOf(rib, true));
  const tunnelMat = own(new THREE.MeshStandardMaterial({ map: ribTex, emissiveMap: ribTex, emissive: col(p.a1), emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide }));
  let ringCount = 0;
  const ringData: { m: THREE.Matrix4; ph: number }[] = [];
  for (const [s0, s1] of tunnelRanges) {
    const arch: [number, number][] = [];
    for (let k = 0; k <= 16; k++) {
      const th = (k / 16) * Math.PI;
      arch.push([-Math.cos(th) * 21, Math.pow(Math.sin(th), 0.75) * 19]);
    }
    const first = Math.floor(s0 / STEP);
    const last = Math.ceil(s1 / STEP);
    const sub: Track = tr;
    const m = last - first;
    const pos = new Float32Array((m + 1) * arch.length * 3);
    const uv = new Float32Array((m + 1) * arch.length * 2);
    for (let i = 0; i <= m; i++) {
      const kk = (first + i) % tr.n;
      for (let j = 0; j < arch.length; j++) {
        const [lat, h] = arch[j];
        const o = (i * arch.length + j) * 3;
        pos[o] = sub.px[kk] + sub.rx[kk] * lat + sub.ux[kk] * h;
        pos[o + 1] = sub.py[kk] + sub.ry[kk] * lat + sub.uy[kk] * h;
        pos[o + 2] = sub.pz[kk] + sub.rz[kk] * lat + sub.uz[kk] * h;
        uv[(i * arch.length + j) * 2] = j / (arch.length - 1);
        uv[(i * arch.length + j) * 2 + 1] = (i * STEP) / 16;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < arch.length - 1; j++) {
      const a = i * arch.length + j;
      idx.push(a, a + 1, a + arch.length, a + 1, a + arch.length + 1, a + arch.length);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(own(g), tunnelMat);
    mesh.frustumCulled = false;
    group.add(mesh);
    for (let s = s0 + 6; s < s1 - 4; s += 14) {
      frameAt(tr, s, f);
      bas.makeBasis(new THREE.Vector3(f.rx, f.ry, f.rz), new THREE.Vector3(f.ux, f.uy, f.uz), new THREE.Vector3(f.tx, f.ty, f.tz));
      bas.setPosition(f.px + f.ux * 0.3, f.py + f.uy * 0.3, f.pz + f.uz * 0.3);
      ringData.push({ m: bas.clone(), ph: ringCount++ });
    }
  }
  const ringGeo = own(new THREE.TorusGeometry(19.6, 0.55, 6, 28, Math.PI));
  const ringMat = own(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, Math.max(1, ringData.length));
  rings.frustumCulled = false;
  ringData.forEach((r, i) => rings.setMatrixAt(i, r.m));
  rings.count = ringData.length;
  rings.instanceMatrix.needsUpdate = true;
  rings.setColorAt(0, new THREE.Color(1, 1, 1));
  group.add(rings);
  const c1 = col(p.a1);
  const c2 = col(p.a2);
  const tmpC = new THREE.Color();
  const strobe = (t: number) => {
    for (let i = 0; i < ringData.length; i++) {
      const k = Math.max(0, Math.sin(t * 9 - i * 0.9));
      tmpC.copy(i % 2 ? c1 : c2).multiplyScalar(0.25 + Math.pow(k, 3) * 5.5);
      rings.setColorAt(i, tmpC);
    }
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  };

  // Gates: start/sector arches with banner.
  const bannerC = canvas(1024, 256);
  {
    const g = bannerC.getContext('2d')!;
    g.fillStyle = '#0b0b10';
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = p.a2;
    g.fillRect(0, 0, 1024, 26);
    g.fillStyle = p.a1;
    g.fillRect(0, 230, 1024, 26);
    drawLogo(g, 70, 200, 150, p.a2, '#fff', '#000');
  }
  const bannerTex = own(texOf(bannerC, true, false));
  const bannerMat = own(new THREE.MeshBasicMaterial({ map: bannerTex, color: col('#ffffff', 1.6), side: THREE.DoubleSide }));
  for (let k = 0; k < 3; k++) {
    const s = k === 0 ? 0 : (k / 3) * tr.len;
    frameAt(tr, s, f);
    const Rv = new THREE.Vector3(f.rx, f.ry, f.rz);
    const Uv = new THREE.Vector3(f.ux, f.uy, f.uz);
    const Tv = new THREE.Vector3(f.tx, f.ty, f.tz);
    const gate = new THREE.Group();
    const arch = new THREE.Mesh(own(new THREE.TorusGeometry(24, 1.3, 8, 40, Math.PI)), own(new THREE.MeshBasicMaterial({ color: col(k === 0 ? p.a2 : p.a1, 3.5) })));
    gate.add(arch);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(own(new THREE.BoxGeometry(3, 12, 3)), darkMat);
      post.position.set(sx * 24, 3, 0);
      gate.add(post);
    }
    if (k === 0) {
      const banner = new THREE.Mesh(own(new THREE.PlaneGeometry(36, 9)), bannerMat);
      banner.position.set(0, 21, 0);
      gate.add(banner);
    }
    bas.makeBasis(Rv, Uv, Tv.clone().negate());
    // Plane faces -Z in gate space = toward the driver.
    gate.quaternion.setFromRotationMatrix(bas);
    gate.position.set(f.px, f.py, f.pz);
    group.add(gate);
  }

  // Signage.
  const signTexs: THREE.CanvasTexture[] = [];
  for (let i = 0; i < SIGN_COUNT; i++) {
    const c = canvas(1024, 512);
    drawSign(c, i, p.a1, p.a2);
    signTexs.push(own(texOf(c, true, false)));
  }
  // Pack signage text joins the rotation (tracks without it keep exactly the stock boards).
  tr.def.signs.forEach((msg, i) => {
    const c = canvas(1024, 512);
    drawTextSign(c, msg, i, p.a1, p.a2);
    signTexs.push(own(texOf(c, true, false)));
  });
  const signGeo = own(new THREE.PlaneGeometry(44, 22));
  const signLists: THREE.Matrix4[][] = signTexs.map(() => []);
  const sd = (tr.len / 190) | 0;
  for (let k = 0; k < sd; k++) {
    const s = (k + 0.5) * (tr.len / sd);
    if (tr.tunnel[Math.floor(s / STEP) % tr.n] || tr.inLoop[Math.floor(s / STEP) % tr.n]) continue;
    frameAt(tr, s, f);
    const side = k % 2 ? 1 : -1;
    const off = HALF_W + 20 + R() * 8 + (tr.pipe[f.i] > 0 ? 10 : 0);
    const up = 16 + R() * 14;
    const X = side > 0 ? new THREE.Vector3(-f.tx, -f.ty, -f.tz) : new THREE.Vector3(f.tx, f.ty, f.tz);
    const Z = side > 0 ? new THREE.Vector3(-f.rx, -f.ry, -f.rz) : new THREE.Vector3(f.rx, f.ry, f.rz);
    const m = new THREE.Matrix4().makeBasis(X, new THREE.Vector3(f.ux, f.uy, f.uz), Z);
    m.setPosition(f.px + f.rx * side * off + f.ux * up, f.py + f.ry * side * off + f.uy * up, f.pz + f.rz * side * off + f.uz * up);
    signLists[k % signTexs.length].push(m);
  }
  signLists.forEach((list, i) => {
    if (!list.length) return;
    const mat = own(new THREE.MeshBasicMaterial({ map: signTexs[i], color: col('#ffffff', 1.5), side: THREE.DoubleSide }));
    const im = new THREE.InstancedMesh(signGeo, mat, list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    im.frustumCulled = false;
    group.add(im);
  });

  // Pylons.
  const pyl: THREE.Matrix4[] = [];
  for (let s = 30; s < tr.len; s += 64) {
    const i = Math.floor(s / STEP) % tr.n;
    if (tr.inLoop[i] || tr.tunnel[i] || tr.py[i] < 40) continue;
    const y0 = tr.py[i] - 5.5 * tr.uy[i];
    const m = new THREE.Matrix4().compose(new THREE.Vector3(tr.px[i], y0 / 2, tr.pz[i]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tr.tx[i], tr.tz[i])), new THREE.Vector3(5, Math.max(1, y0), 5));
    pyl.push(m);
  }
  const pylGeo = new THREE.BoxGeometry(1, 1, 1);
  own(pylGeo);
  const pylons = new THREE.InstancedMesh(pylGeo, darkMat, Math.max(1, pyl.length));
  pyl.forEach((m, i) => pylons.setMatrixAt(i, m));
  pylons.count = pyl.length;
  pylons.frustumCulled = false;
  group.add(pylons);

  // City: instanced towers with procedural lit windows; canyon walls hug the track.
  const cell = 64;
  const hashCell = new Map<number, number[]>();
  const hk = (ix: number, iz: number) => ix * 100003 + iz;
  for (let i = 0; i < tr.n; i += 2) {
    const ix = Math.floor(tr.px[i] / cell);
    const iz = Math.floor(tr.pz[i] / cell);
    const k = hk(ix, iz);
    const a = hashCell.get(k);
    if (a) a.push(i);
    else hashCell.set(k, [i]);
  }
  const nearTrack = (x: number, z: number, rad: number) => {
    const ix = Math.floor(x / cell);
    const iz = Math.floor(z / cell);
    const r = Math.ceil(rad / cell);
    let minD = 1e9;
    let minY = 1e9;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const arr = hashCell.get(hk(ix + a, iz + b));
      if (!arr) continue;
      for (const i of arr) {
        const d = Math.hypot(tr.px[i] - x, tr.pz[i] - z);
        if (d < rad) {
          if (d < minD) minD = d;
          if (tr.py[i] - 20 < minY) minY = tr.py[i] - 20;
        }
      }
    }
    return { d: minD, minY };
  };
  const maxB = q === 'ultra' ? 3800 : q === 'high' ? 2600 : 1100;
  const buildings: { x: number; z: number; w: number; d: number; h: number; tint: number }[] = [];
  const bd = tr.bounds;
  const reach = 520;
  const cand: { x: number; z: number }[] = [];
  for (let gx = Math.floor((bd.minX - reach) / cell); gx <= Math.floor((bd.maxX + reach) / cell); gx++) {
    for (let gz = Math.floor((bd.minZ - reach) / cell); gz <= Math.floor((bd.maxZ + reach) / cell); gz++) cand.push({ x: (gx + 0.5) * cell, z: (gz + 0.5) * cell });
  }
  for (const c of cand) {
    const nt = nearTrack(c.x, c.z, reach);
    if (nt.d > reach) continue;
    const w = 26 + R() * 24;
    const d = 26 + R() * 24;
    const fall = 1 - nt.d / reach;
    let h = 24 + R() * R() * 240 * (0.4 + fall) + (nt.d < 160 ? 80 * R() : 0);
    if (R() < 0.03) h += 220 + R() * 300;
    if (nt.d < 70 + w * 0.5) {
      h = Math.min(h, nt.minY - 14 - R() * 30);
      if (h < 14) continue;
    }
    buildings.push({ x: c.x + (R() - 0.5) * 6, z: c.z + (R() - 0.5) * 6, w, d, h, tint: R() });
  }
  // Keep the nearest (most visible) first when over budget.
  if (buildings.length > maxB) {
    const cx = (bd.minX + bd.maxX) / 2;
    const cz = (bd.minZ + bd.maxZ) / 2;
    void cx; void cz;
    for (let i = buildings.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [buildings[i], buildings[j]] = [buildings[j], buildings[i]];
    }
    buildings.length = maxB;
  }
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  bGeo.translate(0, 0.5, 0);
  own(bGeo);
  const variants = [WINDOW_MAT(0), WINDOW_MAT(0.5), WINDOW_MAT(1)].map((m) => own(m));
  const groups: typeof buildings[] = [[], [], []];
  buildings.forEach((b, i) => groups[i % 3].push(b));
  const tints = [col(p.a1, 0.9), col(p.a2, 0.9), col('#ffcf8a', 0.9), col(p.glow, 0.9)];
  groups.forEach((list, vi) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(bGeo, variants[vi], list.length);
    const m = new THREE.Matrix4();
    list.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(b.tint * 4) * 0.0), new THREE.Vector3(b.w, b.h, b.d));
      im.setMatrixAt(i, m);
      im.setColorAt(i, tints[Math.floor(b.tint * 4) % 4]);
    });
    im.frustumCulled = false;
    group.add(im);
  });
  // Ground.
  const gc = canvas(256, 256);
  {
    const g = gc.getContext('2d')!;
    g.fillStyle = '#07080c';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 4);
    g.fillRect(0, 0, 4, 256);
    g.fillStyle = '#7a7f90';
    for (let k = 0; k < 8; k++) g.fillRect(k * 32 + 8, 126, 16, 3);
  }
  const gt = own(texOf(gc, true));
  gt.repeat.set(160, 160);
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(cell * 160, cell * 160)), own(new THREE.MeshStandardMaterial({ map: gt, emissiveMap: gt, emissive: col(p.glow, 0.6), roughness: 0.55, metalness: 0.4 })));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bd.minX + bd.maxX) / 2, 0, (bd.minZ + bd.maxZ) / 2);
  // Texture tile aligns with the building grid: shift by half a cell.
  gt.offset.set(0, 0);
  group.add(ground);

  void renderer;
  const update = (dt: number, time: number, camPos: THREE.Vector3) => {
    padTex.offset.y -= dt * 1.6;
    sky.position.copy(camPos);
    for (let i = 0; i < tr.cells.length; i++) {
      if (!cellOn[i]) {
        dummy.scale.setScalar(0);
      } else {
        dummy.position.copy(cellPos[i]);
        dummy.rotation.set(time * 1.8 + i, time * 2.2, 0);
        dummy.scale.setScalar(1 + Math.sin(time * 4 + i) * 0.12);
      }
      dummy.updateMatrix();
      cells.setMatrixAt(i, dummy.matrix);
    }
    cells.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < wpos.length; i++) {
      const w = wpos[i];
      lv.copy(w.t);
      q0.setFromUnitVectors(new THREE.Vector3(0, 1, 0), w.u);
      dummy.position.copy(w.p);
      dummy.quaternion.copy(q0);
      dummy.scale.setScalar(wOn[i] ? 1 : 0.0001);
      dummy.updateMatrix();
      wpads.setMatrixAt(i, dummy.matrix);
      hueCol.setHSL((time * 0.4 + i * 0.13) % 1, 1, 0.55).multiplyScalar(2.6);
      wpads.setColorAt(i, hueCol);
      dummy.position.copy(w.p).addScaledVector(w.u, 2.6 + Math.sin(time * 3 + i) * 0.3);
      dummy.rotation.set(time * 1.2, time * 2, time * 0.7);
      dummy.scale.setScalar(wOn[i] ? 1 : 0.0001);
      dummy.updateMatrix();
      wcubes.setMatrixAt(i, dummy.matrix);
      wcubes.setColorAt(i, hueCol);
    }
    wpads.instanceMatrix.needsUpdate = true;
    wcubes.instanceMatrix.needsUpdate = true;
    if (wpads.instanceColor) wpads.instanceColor.needsUpdate = true;
    if (wcubes.instanceColor) wcubes.instanceColor.needsUpdate = true;
  };
  return {
    group, sky, update, padTex, strobe,
    cells: { count: tr.cells.length, setActive: (i, on) => { cellOn[i] = on; } },
    weapons: { setActive: (i, on) => { wOn[i] = on; }, pos: wpos.map((w) => w.p) },
    cellPos,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// ───────────── Speed lines ─────────────

export class SpeedLines {
  mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;
  private off = 0;
  constructor(count: number, a1: string) {
    const pos = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    const R = rng(99);
    for (let i = 0; i < count; i++) {
      const x = R();
      const y = R();
      const z = R();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uOff: { value: 0 }, uSpeed: { value: 0 }, uColor: { value: col(a1, 1.0) } },
      vertexShader: `
        attribute float aEnd; uniform float uOff; uniform float uSpeed; varying float vA;
        void main(){
          float ang = position.x * 6.2831853;
          float rad = mix(3.2, 22.0, pow(position.y, 1.6));
          float depth = fract(position.z - uOff);
          float z = -(depth * 130.0 + 3.0);
          float len = clamp(uSpeed * 22.0, 0.0, 26.0);
          z -= aEnd * len;
          vec3 p = vec3(cos(ang) * rad * 1.5, sin(ang) * rad * 0.8, z);
          vA = (1.0 - aEnd) * smoothstep(1.0, 0.7, depth) * smoothstep(0.0, 0.1, depth) * smoothstep(0.1, 0.5, uSpeed) * (0.4 + position.y * 0.6);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, 1.0); }',
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }
  update(dist: number, speed01: number) {
    this.off = dist / 130;
    this.mat.uniforms.uOff.value = this.off;
    this.mat.uniforms.uSpeed.value = speed01;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ───────────── Particles ─────────────

export class Particles {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private colr: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private head = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.PointsMaterial;
  private tex: THREE.CanvasTexture;
  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.colr = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colr, 3));
    const c = canvas(64, 64);
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.mat = new THREE.PointsMaterial({ size: 2.4, map: this.tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1e5;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, life: number, grav = 0) {
    const i = this.head++ % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([c.r, c.g, c.b], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.grav[i] = grav;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      if (this.life[i] <= 0) {
        this.pos[o + 1] = -1e5;
        continue;
      }
      this.vel[o + 1] -= this.grav[i] * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    // Fade by scaling colour with remaining life (additive).
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const k = this.life[i] / this.max[i];
      for (let j = 0; j < 3; j++) this.colr[i * 3 + j] = this.base[i * 3 + j] * k;
    }
    this.geo.attributes.color.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
