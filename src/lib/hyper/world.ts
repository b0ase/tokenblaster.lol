/** bRacer world: procedural sky, glossy track, tunnels, megastructure city, signage, pads, speed lines, particles. */
import * as THREE from 'three';
import { rng } from '@/lib/rally/noise';
import { drawLogo, drawSign, drawTextSign, SIGN_COUNT } from './signs';
import { frameAt, HALF_W, newFrame, STEP, surfaceH, type Track } from './track';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { addSweep, BARRIER_LAT, BARRIER_TOP, braceGeo, Bucketed, energyMaterial, frameMatrix, gantryParts, grandstandParts, pitParts, pylonParts, ribGeo, SLAB, TUNNEL, TUNNEL_OUT, type Prof } from './architecture';
import { baysTex, crowdTex, deckTextures, plateTextures, sponsorTex, stripTex } from './artTex';
import { buildBackdrop } from './backdrop';

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
        // Stratus decks near the horizon, lit on the sun side.
        {
          vec3 sdir = normalize(vec3(-0.5, 0.05, 0.85));
          vec2 cp = d.xz / (abs(h) + 0.09);
          float cl = fbm(vec3(cp * vec2(0.55, 1.6), 2.0));
          float deck = smoothstep(0.0, 0.05, h) * smoothstep(0.42, 0.08, h);
          float cm = smoothstep(0.48, 0.78, cl) * deck;
          float lit = pow(max(dot(d, sdir), 0.0), 2.0);
          vec3 cc = mix(uFog * 1.3, uHor * 1.25 + uSun * 0.5 * lit, 0.35 + 0.65 * lit);
          c = mix(c, cc, cm * 0.75);
          c += uSun * smoothstep(0.6, 0.85, cl) * deck * lit * 0.35;
        }
        // Horizon sun bloom (HDR core for the bloom pass).
        c += uSun * pow(max(dot(d, normalize(vec3(-0.5, 0.05, 0.85))), 0.0), 600.0) * 5.0;
        float sd = max(dot(d, normalize(vec3(-0.5, 0.05, 0.85))), 0.0);
        c += uSun * pow(sd, 24.0) * 0.9 + uHor * pow(sd, 4.0) * 0.25;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 64, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// ───────────── Track ─────────────

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
    // Boost pad: framed field, twin chevrons and DR corner ticks (scrolls along the track).
    g.fillRect(0, 0, 10, 256);
    g.fillRect(246, 0, 10, 256);
    for (let y = 0; y < 256; y += 32) {
      g.fillRect(18, y + 6, 10, 4);
      g.fillRect(228, y + 6, 10, 4);
    }
    for (let k = 0; k < 2; k++) {
      const y = 20 + k * 128;
      g.beginPath();
      g.moveTo(40, y + 90);
      g.lineTo(128, y + 10);
      g.lineTo(216, y + 90);
      g.lineTo(216, y + 120);
      g.lineTo(128, y + 44);
      g.lineTo(40, y + 120);
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
          float lit = step(0.4, hh);
          vec3 wc = mix(vec3(1.0, 0.82, 0.55), vColor.rgb * 2.4, step(0.6, wh(id.yx + 3.0 + vSeed)));
          totalEmissiveRadiance += wc * win * lit * sideF * (1.3 + 1.6 * wh(id + 7.0));
          // DR-palette neon corner strips on every few columns.
          totalEmissiveRadiance += vColor.rgb * 2.2 * sideF * step(0.965, fract(uvw.x * 0.031 + vSeed)) * step(0.5, wh(vec2(vSeed, 1.0)));
          // Roof-edge neon band every so often.
          float band = step(0.93, fract(vWp.y * 0.012 + vSeed)) * sideF;
          totalEmissiveRadiance += vColor.rgb * 2.8 * band;
        }`,
      );
  };
  return m;
};

/** Canyon mesas: banded sandstone strata by world height, sun-warmed rims, cool shadowed bases. */
const ROCK_MAT = (warm: string) => {
  const m = new THREE.MeshStandardMaterial({ color: '#7a4a36', metalness: 0.05, roughness: 0.9 });
  const w = new THREE.Color(warm);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWarm = { value: w };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp2;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wq2 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wq2 = instanceMatrix * wq2;
        #endif
        vWp2 = (modelMatrix * wq2).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp2; uniform vec3 uWarm;\nfloat rh(float x){ return fract(sin(x * 91.7) * 43758.5); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float y = vWp2.y * 0.11 + sin(vWp2.x * 0.02 + vWp2.z * 0.017) * 1.6;
          float band = rh(floor(y));
          vec3 a = vec3(0.42, 0.22, 0.15);
          vec3 b = vec3(0.70, 0.42, 0.28);
          diffuseColor.rgb = mix(a, b, band) * (0.75 + 0.25 * fract(y));
          diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 120.0, vWp2.y));
          // Vertical erosion runnels.
          float run = rh(floor(vWp2.x * 0.35 + vWp2.z * 0.35));
          diffuseColor.rgb *= 0.82 + 0.18 * run;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uWarm * 0.05 * smoothstep(60.0, 260.0, vWp2.y);`);
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

  const hi = q !== 'low';
  const TS = hi ? 1024 : 512;
  const scenery = tr.def.scenery ?? 'megacity';
  const backdrop = buildBackdrop(tr, scenery, hi, own);
  group.add(backdrop.group);
  const groundY = backdrop.showGround ? 0 : Math.min(0, tr.bounds.minY - 90);
  const fm = newFrame();

  // Track deck: glossy machined plating with normal-mapped seams and wet patches.
  const tt = deckTextures(p, TS, hi);
  own(tt.map); own(tt.emissive); own(tt.rough);
  if (tt.normal) own(tt.normal);
  const topMat = own(new THREE.MeshStandardMaterial({ map: tt.map, emissiveMap: tt.emissive, emissive: '#ffffff', emissiveIntensity: 1.5, roughnessMap: tt.rough, roughness: 0.85, metalness: 0.5, normalMap: tt.normal, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 1.7, side: THREE.DoubleSide }));
  const LS = 24;
  const topProf: Prof = [];
  for (let j = 0; j <= LS; j++) topProf.push([-HALF_W + (2 * HALF_W * j) / LS, 0]);
  addSweep(group, own, tr, topProf, topMat, { vLen: 18, pipe: true });

  // Solid bevelled slab with kerbs, keel and a running-light stripe on the outer face.
  const pt = plateTextures(TS, hi);
  own(pt.map); own(pt.rough);
  if (pt.normal) own(pt.normal);
  const darkMat = own(new THREE.MeshStandardMaterial({ map: pt.map, roughnessMap: pt.rough, normalMap: pt.normal, color: '#c4cad8', metalness: 0.82, roughness: 1, envMapIntensity: 1.25, side: THREE.DoubleSide }));
  const steelMat = own(new THREE.MeshStandardMaterial({ map: pt.map, roughnessMap: pt.rough, normalMap: pt.normal, color: '#8a90a0', metalness: 0.9, roughness: 1, envMapIntensity: 1.1 }));
  addSweep(group, own, tr, SLAB, darkMat, { hard: true, uLen: 6, vLen: 8, pipe: true });
  const stripT = own(stripTex());
  const stripe = (lat: number, colr: string) => {
    const prof: Prof = lat > 0 ? [[lat, -0.15], [lat, -0.65]] : [[lat, -0.65], [lat, -0.15]];
    addSweep(group, own, tr, prof, own(new THREE.MeshBasicMaterial({ map: stripT, color: col(colr, 3) })), { vLen: 5, pipe: true });
  };
  stripe(HALF_W + 1.88, p.a2);
  stripe(-HALF_W - 1.88, p.a1);

  // Energy barriers: segmented panels with a hex field and scanning pulse, steel posts, neon cap rail.
  const eMats = [own(energyMaterial(col(p.a1, 1.4), p.fogDensity, !hi)), own(energyMaterial(col(p.a2, 1.4), p.fogDensity, !hi))];
  for (const [side, mat, colr] of [[-1, eMats[0], p.a1], [1, eMats[1], p.a2]] as const) {
    const L = side * BARRIER_LAT;
    addSweep(group, own, tr, [[L, 1.2], [L, BARRIER_TOP]], mat, { vLen: 8, pipe: true });
    const cap: Prof = [[L - 0.22, BARRIER_TOP - 0.1], [L - 0.22, BARRIER_TOP + 0.3], [L + 0.22, BARRIER_TOP + 0.3], [L + 0.22, BARRIER_TOP - 0.1]];
    addSweep(group, own, tr, cap, own(new THREE.MeshBasicMaterial({ color: col(colr, 4.2) })), { hard: true, vLen: 10, pipe: true });
  }
  const postGeo = own(new RoundedBoxGeometry(0.55, BARRIER_TOP - 1.0, 0.7, 2, 0.12));
  postGeo.translate(0, 1.2 + (BARRIER_TOP - 1.2) / 2, 0);
  const posts = new Bucketed(200);
  for (let s = 0; s < tr.len; s += 8) {
    for (const side of [-1, 1]) posts.add(s, frameMatrix(tr, s, side * BARRIER_LAT, surfaceH(tr.pipe[Math.floor(s / STEP) % tr.n], side * HALF_W), fm));
  }
  posts.build(group, postGeo, steelMat, hi ? 700 : 350);

  // Under-structure: cable bundles (HIGH) and transverse girders with diagonal braces.
  if (hi) {
    const cableMat = own(new THREE.MeshStandardMaterial({ color: '#16181e', metalness: 0.3, roughness: 0.55 }));
    const tube = (lat: number, h: number, r: number): Prof => {
      const out: Prof = [];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI - (k * Math.PI * 2) / 8;
        out.push([lat + Math.cos(a) * r, h + Math.sin(a) * r]);
      }
      return out;
    };
    for (const sx of [-1, 1]) for (const [dl, r] of [[0.4, 0.34], [1.15, 0.26]] as const) addSweep(group, own, tr, tube(sx * (HALF_W - dl), -3.0 - r * 1.4, r), cableMat, { vLen: 6, pipe: true });
  }
  const braces = new Bucketed(200);
  for (let s = 5; s < tr.len; s += hi ? 10 : 20) {
    if (tr.tunnel[Math.floor(s / STEP) % tr.n]) continue;
    braces.add(s, frameMatrix(tr, s, 0, 0, fm));
  }
  braces.build(group, own(braceGeo()), steelMat, hi ? 650 : 300);

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
  const lv = new THREE.Vector3();
  // Tunnels: octagonal plated shell, chunky ribs, ceiling light strips, strobing light rings, hazard portals.
  const tunnelRanges: [number, number][] = tr.def.tunnels.map(([a, b]) => [a * tr.len, b * tr.len]);
  const tunnelMat = own(new THREE.MeshStandardMaterial({ map: pt.map, emissiveMap: pt.map, roughnessMap: pt.rough, normalMap: pt.normal, color: '#c8d0e0', metalness: 0.55, roughness: 1, emissive: col('#ffffff').lerp(col(p.a1), 0.35), emissiveIntensity: 0.55, envMapIntensity: 0.35, side: THREE.DoubleSide }));
  const ribMat = own(new THREE.MeshStandardMaterial({ map: pt.map, emissiveMap: pt.map, roughnessMap: pt.rough, color: '#dfe4ee', metalness: 0.6, roughness: 1, emissive: col('#ffffff').lerp(col(p.a2), 0.5), emissiveIntensity: 0.4, envMapIntensity: 0.6 }));
  const tLight = own(new THREE.MeshBasicMaterial({ map: stripT, color: col('#ffffff', 2.6) }));
  const tLightC = own(new THREE.MeshBasicMaterial({ map: stripT, color: col(p.a1, 3.2) }));
  const ribs = new Bucketed(200);
  const ringData: { m: THREE.Matrix4; ph: number }[] = [];
  const portals: THREE.Matrix4[] = [];
  let ringCount = 0;
  for (const [s0, s1] of tunnelRanges) {
    const first = Math.floor(s0 / STEP);
    const last = Math.ceil(s1 / STEP);
    addSweep(group, own, tr, TUNNEL, tunnelMat, { hard: true, uLen: 6, vLen: 8 }, [first, last], 40);
    addSweep(group, own, tr, TUNNEL_OUT, darkMat, { hard: true, uLen: 8, vLen: 8 }, [first, last], 40);
    // Ceiling strips sit just inside the upper chamfers; wall strips at shoulder height.
    addSweep(group, own, tr, [[12.5, 20.6], [9.5, 21.6]], tLight, { vLen: 4 }, [first, last], 40);
    addSweep(group, own, tr, [[-9.5, 21.6], [-12.5, 20.6]], tLight, { vLen: 4 }, [first, last], 40);
    addSweep(group, own, tr, [[22.35, 5.6], [22.35, 6.6]], tLightC, { vLen: 3 }, [first, last], 40);
    addSweep(group, own, tr, [[-22.35, 6.6], [-22.35, 5.6]], tLightC, { vLen: 3 }, [first, last], 40);
    for (let s = s0 + 3; s < s1 - 2; s += 7) ribs.add(s, frameMatrix(tr, s, 0, 0, fm));
    for (let s = s0 + 6; s < s1 - 4; s += 14) ringData.push({ m: frameMatrix(tr, s, 0, 0.05, fm), ph: ringCount++ });
    portals.push(frameMatrix(tr, s0 + 1, 0, 0, fm), frameMatrix(tr, s1 - 1, 0, 0, fm));
  }
  const inner = TUNNEL.slice(1, -1);
  if (ribs.size) ribs.build(group, own(ribGeo(inner, 0.75, 1.5, 1.3)), ribMat, hi ? 500 : 260);
  // Emissive rib edges: thin bright lips on both faces of every rib.
  if (ribs.size) ribs.build(group, own(ribGeo(inner, 1.55, 0.18, 1.5)), own(new THREE.MeshBasicMaterial({ color: col(p.a1, 1.8) })), hi ? 500 : 260);
  const ringGeo = own(ribGeo(inner, 1.6, 0.22, 0.5));
  const ringMat = own(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, Math.max(1, ringData.length));
  ringData.forEach((r, i) => rings.setMatrixAt(i, r.m));
  rings.count = ringData.length;
  rings.instanceMatrix.needsUpdate = true;
  rings.setColorAt(0, new THREE.Color(1, 1, 1));
  rings.computeBoundingSphere();
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
  const hazTex2 = own(chevronTex('#ffd400', '#0c0c0c', true));
  hazTex2.repeat.set(3, 1);
  if (portals.length) {
    const pf = new THREE.InstancedMesh(own(ribGeo(inner, -1.6, 4.2, 4)), darkMat, portals.length);
    const ph = new THREE.InstancedMesh(own(ribGeo(inner, 0.4, 1.0, 4.4)), own(new THREE.MeshStandardMaterial({ map: hazTex2, emissiveMap: hazTex2, emissive: '#ffffff', emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.5 })), portals.length);
    portals.forEach((m, i) => {
      pf.setMatrixAt(i, m);
      ph.setMatrixAt(i, m);
    });
    pf.computeBoundingSphere();
    ph.computeBoundingSphere();
    group.add(pf, ph);
  }

  // Gantries: chunky truss frames on the kerbs with DR sponsor boards and light strips. Start line gets the
  // banner and the start-light array.
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
  const gp = gantryParts();
  own(gp.frame);
  own(gp.light);
  const gSpots: number[] = [0];
  const nG = Math.max(3, Math.round(tr.len / (hi ? 260 : 420)));
  const clear = (s: number) => {
    for (let d = -16; d <= 16; d += 4) {
      const i = Math.floor((((s + d) % tr.len) + tr.len) % tr.len / STEP) % tr.n;
      if (tr.tunnel[i] || tr.inLoop[i] || tr.pipe[i] > 0.02 || tr.uy[i] < 0.8) return false;
    }
    return true;
  };
  for (let k = 1; k < nG; k++) {
    let s = (k / nG) * tr.len;
    for (let tries = 0; tries < 8 && !clear(s); tries++) s += 12;
    if (clear(s)) gSpots.push(s);
  }
  const gM = gSpots.map((s) => frameMatrix(tr, s, 0, 0, fm));
  const gFrames = new THREE.InstancedMesh(gp.frame, steelMat, gM.length);
  const gLights = new THREE.InstancedMesh(gp.light, own(new THREE.MeshBasicMaterial({ color: col(p.a1, 3.5) })), gM.length);
  gM.forEach((m, i) => {
    gFrames.setMatrixAt(i, m);
    gLights.setMatrixAt(i, m);
  });
  gFrames.computeBoundingSphere();
  gLights.computeBoundingSphere();
  group.add(gFrames, gLights);
  const boardGeo = own(new THREE.PlaneGeometry(2 * (HALF_W + 1.05) - 2, 3.6));
  boardGeo.translate(0, 16, 1.36);
  const sponsorLists: THREE.Matrix4[][] = [[], [], [], [], [], []];
  gM.forEach((m, i) => {
    if (i > 0) sponsorLists[(i + tr.def.seed) % 6].push(m);
  });
  sponsorLists.forEach((list, i) => {
    if (!list.length) return;
    const t = own(sponsorTex(i, p));
    const im = new THREE.InstancedMesh(boardGeo, own(new THREE.MeshBasicMaterial({ map: t, color: col('#ffffff', 1.35) })), list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    im.computeBoundingSphere();
    group.add(im);
  });
  {
    const start = new THREE.Group();
    start.applyMatrix4(gM[0]);
    const banner = new THREE.Mesh(own(new THREE.PlaneGeometry(36, 9)), bannerMat);
    banner.position.set(0, 24.6, 0.2);
    start.add(banner);
    const back = new THREE.Mesh(own(new RoundedBoxGeometry(37.5, 10.4, 1, 2, 0.3)), steelMat);
    back.position.set(0, 24.6, -0.4);
    start.add(back);
    const lamp = own(new THREE.MeshBasicMaterial({ color: col('#ff2030', 3.2) }));
    const lampGeo = own(new THREE.CylinderGeometry(0.75, 0.75, 0.4, 16));
    lampGeo.rotateX(Math.PI / 2);
    for (let k = 0; k < 5; k++) for (let r = 0; r < 2; r++) {
      const l = new THREE.Mesh(lampGeo, lamp);
      l.position.set((k - 2) * 2.4, 15.4 + r * 1.7, 1.6);
      start.add(l);
    }
    group.add(start);
  }

  // Grandstand at the start line and the pit block beside the pit lane, each on a megastructure tower.
  const towerMat = own(WINDOW_MAT(0.5));
  const tower = (s: number, lat: number, w: number, d: number, topH: number) => {
    frameAt(tr, s, fm);
    const x = fm.px + fm.rx * lat;
    const z = fm.pz + fm.rz * lat;
    const y = fm.py + fm.ry * lat + fm.uy * topH;
    if (y - groundY < 4) return;
    const m = new THREE.Mesh(own(new THREE.BoxGeometry(w, y - groundY, d)), towerMat);
    m.position.set(x, groundY + (y - groundY) / 2, z);
    m.rotation.y = Math.atan2(fm.tx, fm.tz);
    group.add(m);
  };
  {
    const sS = 34;
    const gs = grandstandParts(56);
    const gm = frameMatrix(tr, sS, 0, 0, fm);
    const crowdT = own(crowdTex(p));
    crowdT.repeat.set(6, 1);
    const stand = new THREE.Group();
    stand.applyMatrix4(gm);
    stand.add(new THREE.Mesh(own(gs.frame), darkMat), new THREE.Mesh(own(gs.crowd), own(new THREE.MeshBasicMaterial({ map: crowdT, color: col('#ffffff', 1.8) }))), new THREE.Mesh(own(gs.glow), own(new THREE.MeshBasicMaterial({ color: col(p.a2, 4) }))));
    group.add(stand);
    tower(sS, HALF_W + 17, 30, 54, -3);
  }
  if (pitLane) {
    const [a, b] = tr.def.pit;
    const len = Math.min(110, (b - a) * tr.len * 0.8);
    const sP = ((a + b) / 2) * tr.len;
    const pp = pitParts(len);
    const pm = new THREE.Group();
    pm.applyMatrix4(frameMatrix(tr, sP, 0, 0, fm));
    pm.add(new THREE.Mesh(own(pp.frame), darkMat), new THREE.Mesh(own(pp.bays), own(new THREE.MeshBasicMaterial({ map: own(baysTex('#18ff7a')), color: col('#ffffff', 1.4) }))));
    group.add(pm);
    tower(sP, -(HALF_W + 13), 18, len, -1.5);
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
  const signFrames = new Bucketed(300);
  const signPoles = new Bucketed(300);
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
    // Billboard housing and two masts down to the ground (they no longer float).
    signFrames.add(s, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.85)));
    const c = new THREE.Vector3().setFromMatrixPosition(m);
    for (const sx of [-15, 15]) {
      const top = c.y - 9;
      if (top - groundY < 2) continue;
      signPoles.add(s, new THREE.Matrix4().compose(new THREE.Vector3(c.x + X.x * sx, groundY, c.z + X.z * sx), new THREE.Quaternion(), new THREE.Vector3(1, top - groundY, 1)));
    }
  }
  signFrames.build(group, own(new RoundedBoxGeometry(46.5, 24.5, 1.4, 2, 0.4)), steelMat);
  const poleGeo = own(new THREE.CylinderGeometry(0.9, 1.1, 1, 8, 1));
  poleGeo.translate(0, 0.5, 0);
  signPoles.build(group, poleGeo, darkMat);
  signLists.forEach((list, i) => {
    if (!list.length) return;
    const mat = own(new THREE.MeshBasicMaterial({ map: signTexs[i], color: col('#ffffff', 1.5), side: THREE.DoubleSide }));
    const im = new THREE.InstancedMesh(signGeo, mat, list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    im.computeBoundingSphere();
    group.add(im);
  });

  // Pylons: crosshead under the keel, twin tapered octagonal columns to the ground, footings, light bands.
  const pyP = pylonParts();
  own(pyP.body); own(pyP.cap); own(pyP.foot); own(pyP.band);
  const pCap = new Bucketed(300);
  const pBody = new Bucketed(300);
  const pFoot = new Bucketed(300);
  const pBand = new Bucketed(300);
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (let s = 30; s < tr.len; s += 46) {
    const i = Math.floor(s / STEP) % tr.n;
    if (tr.inLoop[i] || tr.tunnel[i] || tr.py[i] - groundY < 40 || tr.uy[i] < 0.75) continue;
    pCap.add(s, frameMatrix(tr, s, 0, -7.6, fm));
    frameAt(tr, s, fm);
    const yaw = new THREE.Quaternion().setFromAxisAngle(yAxis, Math.atan2(fm.tx, fm.tz));
    for (const lat of [-7, 7]) {
      const x = fm.px + fm.rx * lat + fm.ux * -8.6;
      const y = fm.py + fm.ry * lat + fm.uy * -8.6;
      const z = fm.pz + fm.rz * lat + fm.uz * -8.6;
      const h = y - groundY;
      if (h < 6) continue;
      pBody.add(s, new THREE.Matrix4().compose(new THREE.Vector3(x, groundY, z), yaw, new THREE.Vector3(1.7, h, 1.7)));
      pFoot.add(s, new THREE.Matrix4().compose(new THREE.Vector3(x, groundY, z), yaw, new THREE.Vector3(1, 1, 1)));
      for (const bh of [h - 4, h * 0.5]) pBand.add(s, new THREE.Matrix4().compose(new THREE.Vector3(x, groundY + bh, z), yaw, new THREE.Vector3(1.7 * (1 - (bh / h) * 0.23) / 1, 1, 1.7 * (1 - (bh / h) * 0.23))));
    }
  }
  pCap.build(group, pyP.cap, steelMat);
  pBody.build(group, pyP.body, darkMat);
  if (backdrop.showGround) pFoot.build(group, pyP.foot, steelMat, 900);
  pBand.build(group, pyP.band, own(new THREE.MeshBasicMaterial({ color: col(p.a1, 3) })), 1400);

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
  const maxB = backdrop.hideCity ? 0 : Math.round((q === 'ultra' ? 3800 : q === 'high' ? 2600 : 1100) * (scenery === 'canyon' ? 0.55 : 1));
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
  const canyon = scenery === 'canyon';
  // Mesas: stepped strata ledges with a noisy outline (flat-shaded for crisp rock faces).
  const rockBase = new THREE.CylinderGeometry(0.5, 0.62, 1, 11, 9);
  {
    const ps = rockBase.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < ps.count; i++) {
      const x = ps.getX(i);
      const y = ps.getY(i);
      const z = ps.getZ(i);
      const a = Math.atan2(z, x);
      const layer = Math.round((y + 0.5) * 9);
      const k = 1 + 0.16 * Math.sin(a * 3 + layer * 1.7) + 0.08 * Math.sin(a * 7 - layer) - (layer % 3 === 0 ? 0.07 : 0);
      ps.setXYZ(i, x * k, y, z * k);
    }
  }
  const rockGeo = own(rockBase.toNonIndexed());
  rockBase.dispose();
  rockGeo.translate(0, 0.5, 0);
  rockGeo.computeVertexNormals();
  const variants = (canyon ? [WINDOW_MAT(0), ROCK_MAT(p.sun), WINDOW_MAT(1)] : [WINDOW_MAT(0), WINDOW_MAT(0.5), WINDOW_MAT(1)]).map((m) => own(m));
  const groups: typeof buildings[] = [[], [], []];
  buildings.forEach((b, i) => groups[i % 3].push(b));
  const tints = [col(p.a1, 0.9), col(p.a2, 0.9), col('#ffcf8a', 0.9), col(p.glow, 0.9)];
  groups.forEach((list, vi) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(canyon && vi === 1 ? rockGeo : bGeo, variants[vi], list.length);
    const m = new THREE.Matrix4();
    list.forEach((b, i) => {
      const rk = canyon && vi === 1;
      m.compose(new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rk ? b.tint * 6.28 : 0), new THREE.Vector3(b.w * (rk ? 1.6 : 1), rk ? b.h * 0.8 : b.h, b.d * (rk ? 1.6 : 1)));
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
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(cell * 160, cell * 160)), own(new THREE.MeshStandardMaterial({ map: gt, emissiveMap: gt, emissive: backdrop.groundTint, roughness: 0.55, metalness: 0.4 })));
  ground.visible = backdrop.showGround;
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((bd.minX + bd.maxX) / 2, 0, (bd.minZ + bd.maxZ) / 2);
  // Texture tile aligns with the building grid: shift by half a cell.
  gt.offset.set(0, 0);
  group.add(ground);

  void renderer;
  const update = (dt: number, time: number, camPos: THREE.Vector3) => {
    padTex.offset.y -= dt * 1.6;
    sky.position.copy(camPos);
    for (const m of eMats) m.uniforms.uTime.value = time;
    backdrop.update(time, camPos);
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
