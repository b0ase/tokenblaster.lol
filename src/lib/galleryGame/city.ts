/**
 * Shooting Gallery set: NEO-TOKYO, 2048. A rain-wet night street running up to the TERRORNODE HQ tower
 * (glass curtain wall, lit lobby, a huge animated eye, 8 x 10 smashable windows, a lobby of server racks),
 * walled by dense stepped towers with vertical neon signage, shopfronts, narrow alleys with lanterns and
 * vending machines, fire escapes and rooftop clutter, crossed by an elevated rail line and an expressway,
 * with hover traffic, a giant hologram idol on a rooftop, overhead cables, steam, puddles and rain.
 * All names and brands are invented, apart from our own (TERRORNODE, TOKENBLASTER, bWalletX, NPG).
 *
 * Performance: facades are merged into one mesh per material, every repeated prop is an InstancedMesh, the
 * blade signs are one instanced draw with a texture atlas, rain / ripples / signs / steam / mist animate on the
 * GPU. High adds a half-resolution planar reflection of the street, shadows, more rain and traffic.
 * Low (phones) uses the env map plus streak decals for the wet look and about half the counts.
 *
 * Layers: rain, ripples and the held gun live on layer 1 (the engine enables it on the camera) so the planar
 * reflection, which only sees layer 0, does not mirror them.
 *
 * Coordinates: the player stands at the origin looking down -Z. The tower face is at z = TOWER.z.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Look } from '../visuals/look';
import { halo } from '../bsvgun/targets';
import { adAtlas, canvas, curtainWall, facadeTile, FACADE_H, FACADE_W, JP, lobbyTex, rng, ringTex, shopTile, SHOP, signAtlas, SIGNS, skylineTex, softGlow, tex, vendingTex, type FacadeKind } from './cityAssets';
import { beamMaterial, eyeMaterial, glowMaterial, holoAdMaterial, makeShared, mistMaterial, patchWetGround, rainMaterial, rippleMaterial, signMaterial, steamMaterial, type GroundUniforms } from './cityShaders';
import { buildHoloFigure } from './cityHolo';

export const TOWER = { z: -70, w: 34, h: 56, d: 26, cols: 8, rows: 10, winY0: 12 };
export const EYE = 1.62;

export type Window = { i: number; x: number; y: number; hp: number; broke: boolean; lit: number };
export type Rack = { mesh: THREE.Mesh; hp: number; broke: boolean; t: number };

export type City = {
  group: THREE.Group;
  windows: THREE.InstancedMesh;
  wins: Window[];
  racks: Rack[];
  towerBody: THREE.Mesh;
  /** Solid surfaces the rounds spark on (the tower). */
  solids: THREE.Mesh[];
  ground: THREE.Mesh;
  eye: THREE.Group;
  hitLight: THREE.PointLight;
  /** World position of the tower's brightest light, for the screen-space light-shaft pass. */
  lightWorld: THREE.Vector3;
  breakWindow: (w: Window) => void;
  breakRack: (r: Rack) => void;
  rebuild: () => void;
  /** Call once per frame before the composer renders: refreshes the planar street reflection (High only). */
  beforeRender: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera) => void;
  resize: (w: number, h: number) => void;
  update: (dt: number, t: number, cam: THREE.Camera) => void;
  dispose: () => void;
};

const neon = (c: string, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
const X0 = 27; // street face of the first row of buildings
const X1 = 51; // back of the first row / front of the second
const NEONS = ['#2ec8e0', '#2ec8e0', '#3a8cff', '#2ec8e0', '#3a8cff', '#ff2a46', '#2ec8e0', '#4da3ff'];

type Roof = { xa: number; xb: number; za: number; zb: number; y: number; kind: FacadeKind; h: number };
type Bld = { sx: 1 | -1; za: number; zb: number; h: number; h1: number; kind: FacadeKind };
type Bucket = THREE.BufferGeometry[];

export function buildCity({ renderer, scene, high, look }: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; high: boolean; look: Look }): City {
  const S = high ? 1 : 0.5; // texture scale
  const pick = <T,>(a: T, b: T) => (high ? a : b);
  const group = new THREE.Group();
  const disp: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(o: T) => (disp.push(o), o);
  const R = rng(2048);
  const rr = (a: number, b: number) => a + (b - a) * R();
  const ri = (n: number) => Math.floor(R() * n);
  const T = TOWER;

  // ── IBL: a dark dome with neon strips, so chrome and wet asphalt have something to reflect ──
  const envScene = new THREE.Scene();
  envScene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 lo = vec3(0.05,0.10,0.16); vec3 hi = vec3(0.01,0.02,0.07); gl_FragColor = vec4(mix(lo, hi, smoothstep(-0.1,0.7,h)),1.); }',
      }),
    ),
  );
  const strip = (c: string, k: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  strip('#ff2a2a', 7, 30, 4, 0, 16, -40);
  strip('#27c8e0', 5, 34, 3, -30, 10, -10);
  strip('#ffa24a', 3, 30, 3, 30, 12, -6);
  strip('#2ec8e0', 4, 20, 5, 18, 24, 20);
  strip('#ff2a46', 3, 8, 16, -34, 18, -26);
  strip('#2ec8e0', 5, 6, 20, 34, 20, -30);
  strip('#3a8cff', 4, 6, 12, -20, 14, -44);
  strip('#ffffff', 3, 14, 2, -8, 32, -12);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(envScene, 0.03).texture;
  pm.dispose();
  envScene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  scene.environment = env;
  scene.environmentIntensity = 0.85;
  scene.background = new THREE.Color('#05060f');
  const fog = new THREE.FogExp2('#071420', 0.0066);
  scene.fog = fog;
  const sh = makeShared(fog);

  // ── Sky dome: storm clouds lit magenta from the city below, the red eye's glow, stars ──
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uT: sh.uT },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: /* glsl */ `
        varying vec3 vP; uniform float uT;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vP);
          float y = d.y;
          vec3 c = mix(vec3(0.04,0.11,0.18), vec3(0.02,0.05,0.12), smoothstep(0.0,0.28,y));
          c = mix(c, vec3(0.006,0.01,0.03), smoothstep(0.2,0.8,y));
          vec2 cp = vec2(atan(d.x,d.z)*1.8 + uT*0.006, y*3.0);
          float cl = fbm(cp*2.4);
          c += vec3(0.07,0.20,0.30) * cl * smoothstep(0.0,0.35,y) * (1.0-smoothstep(0.3,0.8,y)) * 0.6;
          vec3 td = normalize(vec3(0.0, 0.55, -1.0));
          c += vec3(0.6,0.03,0.02) * pow(max(dot(d, td), 0.0), 18.0) * 0.8;
          vec2 g = floor(vec2(atan(d.x,d.z)*80.0, y*120.0));
          float s = step(0.997, h21(g)) * smoothstep(0.25,0.6,y) * (1.0 - cl);
          c += vec3(s) * (0.6 + 0.4*sin(uT*2.0 + h21(g)*30.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(400, 32, 20)), skyMat);
  sky.renderOrder = -10;
  sky.userData.noAO = true;
  group.add(sky);

  // ── Lights ──
  group.add(new THREE.HemisphereLight('#4f78b8', '#150a14', 0.38));
  const moon = new THREE.DirectionalLight('#78a8ff', 0.9);
  moon.position.set(-40, 70, 10);
  moon.target.position.set(0, 0, -40);
  if (high) {
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const c = moon.shadow.camera;
    c.left = -50;
    c.right = 50;
    c.top = 60;
    c.bottom = -60;
    c.near = 10;
    c.far = 200;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.05;
  }
  group.add(moon, moon.target);
  const redWash = new THREE.PointLight('#ff2418', high ? 500 : 300, 90, 1.6);
  redWash.position.set(0, T.h - 4, T.z + 14);
  group.add(redWash);
  const lobbyLight = new THREE.PointLight('#ffc27a', high ? 160 : 100, 34, 1.7);
  lobbyLight.position.set(0, 5, T.z + 9);
  group.add(lobbyLight);
  const hitLight = new THREE.PointLight('#ffd27a', 0, 26, 1.6);
  group.add(hitLight);

  // ── Ground: wet asphalt (puddles + planar reflection on High), sidewalks, road paint ──
  const asphalt = look.material('concrete_floor_02', [60, 120], '#3b404c', 0.35);
  asphalt.roughness = 0.34;
  asphalt.envMapIntensity = 1.6;
  track(asphalt);
  const gu: GroundUniforms = { tReflect: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 }, uT: sh.uT, uWet: { value: 1 } };
  patchWetGround(asphalt, gu);
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(200, 400)), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -120);
  ground.receiveShadow = true;
  group.add(ground);

  let refl: Reflector | null = null;
  const reflInv = new THREE.Matrix4();
  const bufSize = new THREE.Vector2();
  if (high) {
    renderer.getDrawingBufferSize(bufSize);
    refl = new Reflector(new THREE.PlaneGeometry(2, 2), { textureWidth: Math.max(64, Math.round(bufSize.x * 0.5)), textureHeight: Math.max(64, Math.round(bufSize.y * 0.5)), clipBias: 0.002, multisample: 0 });
    refl.rotation.x = -Math.PI / 2;
    refl.updateMatrixWorld(true);
    reflInv.copy(refl.matrixWorld).invert();
    gu.tReflect.value = refl.getRenderTarget().texture;
    gu.uReflOn.value = 1;
  }

  const walkMat = track(look.material('large_floor_tiles_02', [8, 90], '#5a5d6a', 0.1));
  walkMat.roughness = 0.45;
  walkMat.envMapIntensity = 1.2;
  for (const sx of [-1, 1]) {
    const walk = new THREE.Mesh(track(new THREE.BoxGeometry(11, 0.25, 400)), walkMat);
    walk.position.set(sx * 21.5, 0.12, -120);
    walk.receiveShadow = true;
    group.add(walk);
  }
  // road paint: dashed centre line, edge lines, zebra crossings, all merged
  const paint: THREE.BufferGeometry[] = [];
  const flat = (w: number, d: number, x: number, z: number, y = 0.03) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y, z);
    paint.push(g);
  };
  for (let z = -4; z > -300; z -= 9) flat(0.25, 4, 0, z);
  for (const sx of [-1, 1]) flat(0.2, 300, sx * 15.4, -150);
  for (const z of [-9, -86, -150]) for (let i = -6; i <= 6; i++) flat(0.7, 3.6, i * 1.9, z);
  const paintMat = track(new THREE.MeshStandardMaterial({ color: '#c9ccd6', roughness: 0.4, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  group.add(new THREE.Mesh(track(mergeGeometries(paint, false)!), paintMat));
  paint.forEach((g) => g.dispose());
  // the Japanese stop marking, painted long on the asphalt
  const stopTex = track(
    tex(
      canvas(256, 512, (g) => {
        g.fillStyle = '#e8eaf2';
        g.font = `900 220px ${JP}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        ['止', 'ま', 'れ'].forEach((c, i) => g.fillText(c, 128, 90 + i * 165));
      }),
    ),
  );
  const stopMark = new THREE.Mesh(track(new THREE.PlaneGeometry(3.4, 6.6)), track(new THREE.MeshStandardMaterial({ map: stopTex, transparent: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false })));
  stopMark.rotation.x = -Math.PI / 2;
  stopMark.position.set(-7, 0.035, -17);
  group.add(stopMark);

  // ── Helpers: instancing, matrices, glow points ──
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], cast = false) => {
    const im = new THREE.InstancedMesh(track(geo), mat, Math.max(1, mats.length));
    im.count = mats.length;
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    im.castShadow = cast;
    im.receiveShadow = true;
    group.add(im);
    return im;
  };
  const up = new THREE.Vector3(0, 1, 0);
  const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, ry), new THREE.Vector3(sx, sy, sz));
  const glows: { p: THREE.Vector3; c: THREE.Color; s: number; ph: number; mode: number }[] = [];
  const addGlow = (x: number, y: number, z: number, col: string | THREE.Color, size: number, mode = 0, k = 1) => glows.push({ p: new THREE.Vector3(x, y, z), c: new THREE.Color(col).multiplyScalar(k), s: size, ph: R(), mode });
  const pools: { p: THREE.Vector3; sx: number; sz: number; c: THREE.Color }[] = [];
  const addPool = (x: number, z: number, sx: number, sz: number, col: string, k = 1, y = 0.03) => pools.push({ p: new THREE.Vector3(x, y, z), sx, sz, c: new THREE.Color(col).multiplyScalar(k * 0.22) });

  // ── Facade / shop / roof materials ──
  const kinds: FacadeKind[] = ['office', 'resi', 'glass', 'old'];
  const facTex = kinds.map((k, i) => facadeTile(k, 7 + i * 29, S));
  facTex.forEach((f) => disp.push(f.map, f.em));
  const facSpec: Record<FacadeKind, [number, number, number, number]> = { office: [0.5, 0.35, 1.1, 1.0], resi: [0.75, 0.15, 1.0, 0.7], glass: [0.22, 0.8, 1.15, 1.5], old: [0.8, 0.1, 1.0, 0.6] };
  const facMat = {} as Record<FacadeKind, THREE.MeshStandardMaterial>;
  kinds.forEach((k, i) => {
    const [ro, me, ei, en] = facSpec[k];
    facMat[k] = track(new THREE.MeshStandardMaterial({ map: facTex[i].map, emissiveMap: facTex[i].em, emissive: '#ffffff', emissiveIntensity: ei, roughness: ro, metalness: me, envMapIntensity: en }));
  });
  const shopT = shopTile(5, S);
  disp.push(shopT.map, shopT.em);
  const shopMat = track(new THREE.MeshStandardMaterial({ map: shopT.map, emissiveMap: shopT.em, emissive: '#ffffff', emissiveIntensity: 1.5, roughness: 0.55, metalness: 0.2 }));
  const trimMat = track(new THREE.MeshStandardMaterial({ color: '#232733', roughness: 0.75, metalness: 0.25 }));
  const roofMat = track(new THREE.MeshStandardMaterial({ color: '#0e1018', roughness: 0.9, metalness: 0.1 }));
  const ironMat = track(new THREE.MeshStandardMaterial({ color: '#0c0e14', roughness: 0.55, metalness: 0.85 }));
  const concreteMat = track(new THREE.MeshStandardMaterial({ color: '#2a2d38', roughness: 0.85, metalness: 0.05 }));

  const buckets: Record<FacadeKind | 'shop' | 'trim' | 'roof' | 'iron' | 'concrete', Bucket> = { office: [], resi: [], glass: [], old: [], shop: [], trim: [], roof: [], iron: [], concrete: [] };
  /** Axis-aligned box from min/max corners; UVs derive from world size so every facade keeps real-world scale. */
  const box = (b: Bucket, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tw = 0, th = 0, ou = 0, ov = 0) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (tw > 0) {
      const p = g.attributes.position as THREE.BufferAttribute;
      const n = g.attributes.normal as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, p.getZ(i) / tw + ou, p.getY(i) / th + ov);
        else if (Math.abs(n.getZ(i)) > 0.5) uv.setXY(i, p.getX(i) / tw + ou, p.getY(i) / th + ov);
        else uv.setXY(i, p.getX(i) / tw, p.getZ(i) / tw);
      }
    }
    b.push(g);
  };

  // ── Buildings: first row (street canyon), second row (taller backdrop) ──
  const roofs: Roof[] = [];
  const firsts: Bld[] = [];
  const alleys: { sx: 1 | -1; z: number }[] = [];
  const neonLines: { g: THREE.BufferGeometry; c: THREE.Color }[] = [];
  const outline = (xa: number, xb: number, za: number, zb: number, y: number, col: string) => {
    const c = new THREE.Color(col).multiplyScalar(3.2);
    const t = 0.16;
    const parts: [number, number, number, number][] = [
      [xa, xb, zb, zb + t],
      [xa, xb, za - t, za],
      [xa, xa + t, zb, za],
      [xb - t, xb, zb, za],
    ];
    for (const [a, b, c0, c1] of parts) {
      const g = new THREE.BoxGeometry(b - a, 0.16, c1 - c0);
      g.translate((a + b) / 2, y, (c0 + c1) / 2);
      neonLines.push({ g, c });
    }
  };
  const vstrip = (x: number, z: number, y0: number, y1: number, col: string) => {
    const g = new THREE.BoxGeometry(0.16, y1 - y0, 0.16);
    g.translate(x, (y0 + y1) / 2, z);
    neonLines.push({ g, c: new THREE.Color(col).multiplyScalar(3.0) });
  };

  const addBuilding = (sx: 1 | -1, za: number, zb: number, h: number, kind: FacadeKind, xin: number, xout: number, first: boolean) => {
    const ou = R() * 4;
    const mk = (xi: number, y0: number, y1: number, a: number, b: number) => {
      const xa = sx > 0 ? xi : -xout;
      const xb = sx > 0 ? xout : -xi;
      box(buckets[kind], xa, xb, y0, y1, b, a, FACADE_W, FACADE_H, ou, -y0 / FACADE_H);
    };
    const slab = (xi: number, y0: number, y1: number, a: number, b: number, ext: number) => {
      const xa = sx > 0 ? xi - ext : -xout - ext;
      const xb = sx > 0 ? xout + ext : -xi + ext;
      box(buckets.trim, xa, xb, y0, y1, b - ext, a + ext);
    };
    const pod = first ? 4.5 : 0;
    if (first) {
      const xa = sx > 0 ? xin : -xout;
      const xb = sx > 0 ? xout : -xin;
      box(buckets.shop, xa, xb, 0, pod, zb, za, SHOP.w, SHOP.h, R() * 4, 0);
      slab(xin, pod, pod + 0.35, za, zb, 0.7);
    }
    const base = pod + (first ? 0.35 : 0);
    const h1 = h > 36 ? Math.max(base + 8, h * 0.6) : h;
    mk(xin, base, h1, za, zb);
    for (let y = base + 14.4; y < h1 - 2; y += 14.4) slab(xin, y, y + 0.22, za, zb, 0.14); // floor-band ledges
    let top = h1;
    let tz = [za, zb];
    let tx = xin;
    if (h > 36) {
      slab(xin, h1, h1 + 0.4, za, zb, 0.3);
      const h2 = h > 52 ? h * 0.85 : h;
      tx = xin + 1.6;
      tz = [za - 0.8, zb + 0.8];
      mk(tx, h1 + 0.4, h2, tz[0], tz[1]);
      top = h2;
      if (h > 52) {
        slab(tx, h2, h2 + 0.4, tz[0], tz[1], 0.3);
        tx = xin + 3.6;
        tz = [za - 2.2, zb + 2.2];
        mk(tx, h2 + 0.4, h, tz[0], tz[1]);
        top = h;
      }
    }
    slab(tx, top, top + 0.55, tz[0], tz[1], 0.22);
    roofs.push({ xa: sx > 0 ? tx : -xout, xb: sx > 0 ? xout : -tx, za: tz[0], zb: tz[1], y: top + 0.55, kind, h: top });
    if (!first) return;
    const xa = sx > 0 ? tx : -xout;
    const xb = sx > 0 ? xout : -tx;
    if (R() < 0.8) outline(xa, xb, tz[0], tz[1], top + 0.65, NEONS[ri(NEONS.length)]);
    if (h > 30 && R() < 0.7) {
      const col = NEONS[ri(NEONS.length)];
      const x = sx * (X0 + 0.12);
      vstrip(x, za - 0.1, base, Math.min(h1, h * 0.75), col);
      vstrip(x, zb + 0.1, base, Math.min(h1, h * 0.75), col);
    }
    firsts.push({ sx, za, zb, h, h1, kind });
    // fire escape zig-zagging up the street face of the shaft
    if ((kind === 'resi' || kind === 'old') && za - zb > 13 && R() < 0.8) {
      const zc = (za + zb) / 2 + rr(-2, 2);
      const fx = sx * (xin - 0.55);
      const n = Math.min(5, Math.floor((h1 - base - 3) / 3.6));
      for (let k = 0; k < n; k++) {
        const y = base + 1.4 + k * 3.6;
        box(buckets.iron, fx - 0.55, fx + 0.55, y, y + 0.08, zc - 1.6, zc + 1.6);
        box(buckets.iron, fx - sx * 0.55 - 0.03, fx - sx * 0.55 + 0.03, y, y + 0.95, zc - 1.6, zc + 1.6);
        box(buckets.iron, fx - 0.55, fx + 0.55, y + 0.9, y + 0.95, zc - 1.6, zc + 1.6);
        if (k < n - 1) {
          const g = new THREE.BoxGeometry(0.8, 0.07, 2.4);
          g.rotateX((k % 2 ? 1 : -1) * Math.atan2(3.6, 2.4));
          g.translate(fx, y + 1.8, zc + (k % 2 ? -0.1 : 0.1));
          buckets.iron.push(g);
        }
      }
    }
  };

  for (const sx of [-1, 1] as const) {
    let z = -3.5;
    let n = 0;
    let hero = false;
    while (z > -200) {
      const w = rr(13, 21);
      const za = z;
      let zb = z - w;
      let h = rr(22, 62);
      let kind = kinds[ri(4)];
      if (sx < 0 && !hero && zb < -70) {
        zb = za - 20;
        h = 32;
        kind = 'office';
        hero = true;
      } else if (za < -26 && za > -72 && h > 40) h = rr(30, 40); // keep sight lines to the tower and the hologram open
      addBuilding(sx, za, zb, h, kind, X0, X1, true);
      z = zb;
      // an alley every third gap, never under a crossing
      const gap = n % 3 === 2 && z > -150 ? 5.4 : rr(1.2, 2.6);
      if (gap > 4) alleys.push({ sx, z: z - gap / 2 });
      z -= gap;
      n++;
    }
    let zz = -2; // second row: a taller backdrop
    while (zz > -210) {
      const w = rr(18, 30);
      addBuilding(sx, zz, zz - w, rr(70, 150), R() < 0.6 ? 'glass' : 'office', X1, X1 + 26, false);
      zz -= w;
    }
  }

  // ── Elevated layers along the street: an expressway over the left kerb, a rail line over the right ──
  const EXL = -20; // expressway centre x
  const EXY = 15.2; // expressway deck underside
  const RLX = 21; // rail centre x
  const RLY = 9.4;
  {
    const z0 = 14;
    const z1 = -230;
    box(buckets.concrete, EXL - 4.7, EXL + 4.7, EXY, EXY + 1.3, z1, z0);
    box(buckets.concrete, EXL - 4.7, EXL - 4.5, EXY + 1.3, EXY + 2.4, z1, z0);
    box(buckets.concrete, EXL + 4.5, EXL + 4.7, EXY + 1.3, EXY + 2.4, z1, z0);
    for (let z = 4; z > -220; z -= 20) {
      box(buckets.concrete, EXL - 0.9, EXL + 0.9, 0, EXY, z - 1.3, z + 1.3);
      box(buckets.concrete, EXL - 3.6, EXL + 3.6, EXY - 1.0, EXY, z - 1.6, z + 1.6);
    }
    for (let z = 0; z > -220; z -= 10) {
      box(buckets.iron, EXL - 4.4, EXL - 4.3, EXY + 1.3, EXY + 6.2, z - 0.05, z + 0.05);
      addGlow(EXL - 3.9, EXY + 6.2, z, '#ffb35a', 1.1, 0, 1.0);
      addGlow(EXL - 3, EXY - 0.3, z - 5, '#ff9a3a', 0.9, 0, 0.8);
      addGlow(EXL + 3, EXY - 0.3, z - 5, '#ff9a3a', 0.9, 0, 0.8);
    }
    // rail viaduct
    box(buckets.concrete, RLX - 2.6, RLX + 2.6, RLY - 0.5, RLY + 0.3, z1, z0);
    box(buckets.concrete, RLX - 2.6, RLX - 2.45, RLY + 0.3, RLY + 1.15, z1, z0);
    box(buckets.concrete, RLX + 2.45, RLX + 2.6, RLY + 0.3, RLY + 1.15, z1, z0);
    box(buckets.iron, RLX - 0.95, RLX - 0.85, RLY + 0.3, RLY + 0.42, z1, z0);
    box(buckets.iron, RLX + 0.85, RLX + 0.95, RLY + 0.3, RLY + 0.42, z1, z0);
    box(buckets.iron, RLX - 0.02, RLX + 0.02, RLY + 4.6, RLY + 4.64, z1, z0); // overhead wire
    for (let z = 0; z > -220; z -= 14) {
      box(buckets.concrete, RLX - 0.7, RLX + 0.7, 0, RLY - 0.5, z - 1.8, z + 1.8);
      box(buckets.iron, RLX + 2.3 - 0.07, RLX + 2.3 + 0.07, RLY + 0.3, RLY + 4.6, z - 0.07, z + 0.07);
      addGlow(RLX, RLY - 0.8, z, '#7ee8ff', 1.0, 2, 0.8);
    }
  }
  // expressway lane dashes
  {
    const dp: THREE.BufferGeometry[] = [];
    for (const x of [EXL - 2.2, EXL + 2.2])
      for (let z = 12; z > -230; z -= 3) {
        const g = new THREE.PlaneGeometry(0.12, 1.4);
        g.rotateX(-Math.PI / 2);
        g.translate(x, EXY + 1.32, z);
        dp.push(g);
      }
    group.add(new THREE.Mesh(track(mergeGeometries(dp, false)!), track(neon('#bcd8ec', 0.9))));
    dp.forEach((g) => g.dispose());
  }

  // ── Merge every bucket into one mesh per material ──
  const bucketMat: Record<string, THREE.Material> = { ...facMat, shop: shopMat, trim: trimMat, roof: roofMat, iron: ironMat, concrete: concreteMat };
  (Object.keys(buckets) as (keyof typeof buckets)[]).forEach((k) => {
    if (!buckets[k].length) return;
    const geo = track(mergeGeometries(buckets[k], false)!);
    buckets[k].forEach((g) => g.dispose());
    const m = new THREE.Mesh(geo, bucketMat[k]);
    m.castShadow = high && k !== 'iron';
    m.receiveShadow = true;
    group.add(m);
  });
  if (neonLines.length) {
    const gs = neonLines.map(({ g, c }) => {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    const geo = track(mergeGeometries(gs, false)!);
    gs.forEach((g) => g.dispose());
    group.add(new THREE.Mesh(geo, track(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true }))));
  }

  // ── Rooftop clutter: water tanks, AC units, antennas with beacons ──
  const tanks: THREE.Matrix4[] = [];
  const acs: THREE.Matrix4[] = [];
  const ants: THREE.Matrix4[] = [];
  for (const rf of roofs) {
    if (rf.xb - rf.xa < 4 || rf.za - rf.zb < 4) continue;
    const px = () => rr(rf.xa + 1.5, rf.xb - 1.5);
    const pz = () => rr(rf.zb + 1.5, rf.za - 1.5);
    if ((rf.kind === 'resi' || rf.kind === 'old') && R() < 0.5) tanks.push(M(px(), rf.y, pz(), 1, rr(0.8, 1.2), 1, R() * 6));
    const nac = Math.floor(rr(1, pick(6, 4)));
    for (let i = 0; i < nac; i++) acs.push(M(px(), rf.y, pz(), rr(0.8, 2.2), rr(0.7, 1.4), rr(0.8, 2), R() * 3));
    if (R() < 0.7) {
      const hh = rr(6, rf.h > 70 ? 26 : 16);
      const x = px();
      const z = pz();
      ants.push(M(x, rf.y + hh / 2, z, 1, hh, 1));
      if (rf.h > 28) addGlow(x, rf.y + hh + 0.3, z, '#ff2a1a', 1.6, 1, 2.5);
    }
  }
  const tankGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const a = new THREE.CylinderGeometry(1.15, 1.15, 2.4, 14);
    a.translate(0, 2.6, 0);
    const b = new THREE.ConeGeometry(1.3, 0.8, 14);
    b.translate(0, 4.2, 0);
    parts.push(a, b);
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      const l = new THREE.CylinderGeometry(0.06, 0.06, 1.5, 4);
      l.translate(lx, 0.75, lz);
      parts.push(l);
    }
    const m = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    return m;
  })();
  if (tanks.length) instanced(tankGeo, track(new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 0.7, metalness: 0.5 })), tanks);
  if (acs.length) instanced(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), track(new THREE.MeshStandardMaterial({ color: '#4a505e', roughness: 0.65, metalness: 0.4 })), acs);
  if (ants.length) instanced(new THREE.CylinderGeometry(0.05, 0.1, 1, 5), track(new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.5, metalness: 0.9 })), ants);

  // ── Blade and flat neon signs: one instanced atlas draw ──
  const sAtlas = signAtlas(S);
  disp.push(sAtlas.texture);
  type SignI = { m: THREE.Matrix4; rect: readonly number[]; mode: number; ph: number; spd: number };
  const signs: SignI[] = [];
  const addSign = (cell: number, x: number, y: number, z: number, s: number, ry: number, flatSign: boolean) => {
    const r = R();
    const mode = r < 0.5 ? 0 : r < 0.7 ? 1 : r < 0.8 ? 2 : r < 0.92 ? 3 : 4;
    const wdt = (flatSign ? 2.2 : 1.8) * s;
    const hgt = wdt * 4;
    signs.push({ m: M(x, y, z, wdt, hgt, 1, ry), rect: sAtlas.rect(cell), mode, ph: R(), spd: rr(1, 2.6) });
    if (high || R() < 0.5) addGlow(x - Math.sin(ry) * 0.1, y, z + Math.cos(ry) * 0.15, SIGNS[cell].c, hgt * 0.24, 0, 0.14);
  };
  const heroCells = [8, 9, 10, 11, 12];
  for (const b of firsts) {
    const n = Math.floor((b.za - b.zb) / pick(6, 7.5)) + 1;
    for (let i = 0; i < n; i++) {
      const cell = R() < 0.3 ? heroCells[ri(heroCells.length)] : ri(SIGNS.length);
      const flatSign = R() < 0.45;
      const s = rr(0.7, 1.5);
      const ymax = Math.min(b.h1 - 2, 30);
      const hgt = (flatSign ? 2.2 : 1.8) * s * 4;
      if (ymax < 10) continue;
      const y = Math.min(ymax - hgt / 2, rr(6 + hgt / 2, ymax));
      const z = rr(b.zb + 1.4, b.za - 1.4);
      if (flatSign) addSign(cell, b.sx * (X0 - 0.14), y, z, s, b.sx > 0 ? -Math.PI / 2 : Math.PI / 2, true);
      else addSign(cell, b.sx * (X0 - 0.95), y, z, s, 0, false);
    }
  }
  for (const a of alleys) addSign(ri(SIGNS.length), a.sx * (X0 + 3), 7.5 + R() * 3, a.z + rr(-1.4, 1.4), 1.3, 0, false);
  {
    const nS = signs.length;
    const geo = new THREE.PlaneGeometry(1, 1);
    const rect = new Float32Array(nS * 4);
    const anim = new Float32Array(nS * 3);
    signs.forEach((s, i) => {
      rect.set(s.rect as unknown as number[], i * 4);
      anim.set([s.ph, s.mode, s.spd], i * 3);
    });
    geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(anim, 3));
    const im = new THREE.InstancedMesh(track(geo), track(signMaterial(sAtlas.texture, sh)), nS);
    signs.forEach((s, i) => im.setMatrixAt(i, s.m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    group.add(im);
  }

  // ── Holographic ad billboards (original brands) on faces and over roofs ──
  const ads = adAtlas(S);
  disp.push(ads.texture);
  const adPlane = track(new THREE.PlaneGeometry(1, 1));
  const addAd = (cell: number, x: number, y: number, z: number, size: number, ry: number, tint: string) => {
    const m = new THREE.Mesh(adPlane, track(holoAdMaterial(ads.texture, ads.rect(cell), sh, tint, R() * 4)));
    m.position.set(x, y, z);
    m.scale.set(size, size, 1);
    m.rotation.y = ry;
    m.userData.noAO = true;
    group.add(m);
  };
  {
    const rightB = firsts.filter((b) => b.sx > 0 && b.za < -18 && b.za > -150 && b.h1 > 18);
    const leftB = firsts.filter((b) => b.sx < 0 && b.za < -18 && b.za > -150 && b.h1 > 18);
    const at = (arr: Bld[], i: number) => arr[Math.min(arr.length - 1, i)];
    if (rightB.length > 3) {
      const [a, b, c] = [at(rightB, 1), at(rightB, 3), at(rightB, 5)];
      addAd(1, X0 - 0.4, Math.min(a.h1 - 6, 17), (a.za + a.zb) / 2, 11, -Math.PI / 2 + 0.2, '#e8f4ff');
      addAd(2, X0 - 0.4, Math.min(b.h1 - 6, 24), (b.za + b.zb) / 2, 10, -Math.PI / 2 + 0.25, '#e6f1ff');
      addAd(4, X0 - 0.4, Math.min(c.h1 - 7, 16), (c.za + c.zb) / 2, 11, -Math.PI / 2 + 0.3, '#ffffff');
    }
    if (leftB.length > 3) {
      const [a, b] = [at(leftB, 2), at(leftB, 4)];
      addAd(3, -X0 + 0.4, Math.min(a.h1 - 6, 15), (a.za + a.zb) / 2, 11, Math.PI / 2 - 0.2, '#e8f4ff');
      addAd(7, -X0 + 0.4, Math.min(b.h1 - 6, 22), (b.za + b.zb) / 2, 10, Math.PI / 2 - 0.25, '#e8f4ff');
    }
    const tall = roofs.filter((r) => r.xa > X0 && r.h > 80 && r.zb < -25 && r.za > -150);
    tall.slice(0, 3).forEach((r, i) => addAd([5, 6, 0][i], (r.xa + r.xb) / 2 - 10, r.y + 9, r.za - 2, 22, -0.4, '#ffffff'));
  }

  // ── The mega-tower hologram: a giant idol on the left rooftop beside TERRORNODE ──
  const heroRoof =
    roofs
      .filter((r) => r.xb > -40 && r.xb < -20 && r.za > -96 && r.zb < -68)
      .sort((a, b) => Math.abs((a.za + a.zb) / 2 + 82) - Math.abs((b.za + b.zb) / 2 + 82))[0] ?? roofs.find((r) => r.xb < 0)!;
  const idol = buildHoloFigure(sh);
  idol.group.scale.setScalar(24 / 1.8);
  idol.group.position.set((heroRoof.xa + heroRoof.xb) / 2 + 2, heroRoof.y, (heroRoof.za + heroRoof.zb) / 2);
  group.add(idol.group);
  disp.push(idol);
  const idolBeam = new THREE.Mesh(track(new THREE.CylinderGeometry(7, 3, 13, 20, 1, true)), track(beamMaterial('#35e8ff', 0.3, 1.0, true, sh)));
  idolBeam.position.copy(idol.group.position).add(new THREE.Vector3(0, 6.5, 0));
  idolBeam.userData.noAO = true;
  group.add(idolBeam);
  addGlow(idol.group.position.x, heroRoof.y + 1, idol.group.position.z, '#35e8ff', 14, 0, 0.55);

  const TRAIN_N = 6;
  const trainBody = new THREE.InstancedMesh(track(new THREE.BoxGeometry(3.0, 3.1, 9)), track(new THREE.MeshStandardMaterial({ color: '#c8ccd8', roughness: 0.35, metalness: 0.7, envMapIntensity: 1.6 })), TRAIN_N);
  const trainWin = new THREE.InstancedMesh(track(new THREE.BoxGeometry(3.06, 0.95, 8.5)), track(neon('#ffeccc', 1.8)), TRAIN_N);
  trainWin.instanceMatrix = trainBody.instanceMatrix;
  trainBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trainBody.frustumCulled = trainWin.frustumCulled = false;
  group.add(trainBody, trainWin);

  // ── Street furniture: lamps, cables, lanterns, vending machines, barriers, trash ──
  const poleMat = track(new THREE.MeshStandardMaterial({ color: '#1b1e25', roughness: 0.5, metalness: 0.8 }));
  const lampBulb = track(neon('#ffcf8a', 3));
  const lamps: THREE.PointLight[] = [];
  const poleTops: THREE.Vector3[] = [];
  const poleGeos: THREE.BufferGeometry[] = [];
  const bulbGeos: THREE.BufferGeometry[] = [];
  const lampPos: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++)
    for (const sx of [-1, 1]) {
      const z = -10 - i * 14 - (sx > 0 ? 7 : 0);
      const p = new THREE.CylinderGeometry(0.12, 0.17, 8, 8);
      p.translate(sx * 16.5, 4, z);
      const a = new THREE.BoxGeometry(2.6, 0.15, 0.15);
      a.translate(sx * 15.3, 8, z);
      poleGeos.push(p, a);
      const b = new THREE.BoxGeometry(0.9, 0.12, 0.4);
      b.translate(sx * 14.3, 7.9, z);
      bulbGeos.push(b);
      poleTops.push(new THREE.Vector3(sx * 16.5, 8.2, z));
      lampPos.push(new THREE.Vector3(sx * 14.3, 7.4, z));
      addGlow(sx * 14.3, 7.85, z, '#ffb860', 1.0, 2, 0.6);
      if (i < 3) {
        const l = new THREE.PointLight('#ffb35a', 60, 26, 1.7);
        l.position.set(sx * 14.3, 7.4, z);
        group.add(l);
        lamps.push(l);
      }
    }
  group.add(new THREE.Mesh(track(mergeGeometries(poleGeos, false)!), poleMat), new THREE.Mesh(track(mergeGeometries(bulbGeos, false)!), lampBulb));
  poleGeos.forEach((g) => g.dispose());
  bulbGeos.forEach((g) => g.dispose());
  // volumetric cones under each lamp, and the light pools they throw on the wet street
  const coneGeo = new THREE.CylinderGeometry(0.25, 4.6, 7.4, 16, 1, true);
  coneGeo.translate(0, 3.7, 0);
  const lampCones = new THREE.InstancedMesh(track(coneGeo), track(beamMaterial('#ffb460', 0.16, 1.2, false, sh)), lampPos.length);
  lampPos.forEach((p, i) => lampCones.setMatrixAt(i, M(p.x, 0.02, p.z)));
  lampCones.userData.noAO = true;
  lampCones.frustumCulled = false;
  group.add(lampCones);
  lampPos.forEach((p) => addPool(p.x * 0.8, p.z, 11, 11, '#ffa550', 1.0));

  // cables: catenaries between pole tops, along and across the street
  const cableGeos: THREE.BufferGeometry[] = [];
  const cableCurves: THREE.CatmullRomCurve3[] = [];
  const cable = (a: THREE.Vector3, b: THREE.Vector3, sag: number, lanterns = false) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0)));
    }
    const c = new THREE.CatmullRomCurve3(pts);
    cableGeos.push(new THREE.TubeGeometry(c, 14, 0.03, 3, false));
    if (lanterns) cableCurves.push(c);
  };
  const lefts = poleTops.filter((p) => p.x < 0).sort((a, b) => b.z - a.z);
  const rights = poleTops.filter((p) => p.x > 0).sort((a, b) => b.z - a.z);
  for (const side of [lefts, rights])
    for (let i = 0; i < side.length - 1; i++)
      for (const o of [0, -0.3, 0.3]) cable(side[i].clone().add(new THREE.Vector3(0, o, 0)), side[i + 1].clone().add(new THREE.Vector3(0, o * 0.8, 0)), 0.7 + o * 0.3);
  for (let i = 0; i < Math.min(lefts.length, rights.length); i += 2) {
    const a = lefts[i];
    const b = rights.reduce((best, c) => (Math.abs(c.z - a.z) < Math.abs(best.z - a.z) ? c : best));
    cable(a.clone(), b.clone().setZ(a.z - 1.5), 1.6, i % 4 === 0);
  }
  group.add(new THREE.Mesh(track(mergeGeometries(cableGeos, false)!), track(new THREE.MeshStandardMaterial({ color: '#07080b', roughness: 0.6, metalness: 0.2 }))));
  cableGeos.forEach((g) => g.dispose());

  // lanterns (chochin): along shop fronts, across the street on strings, down the alleys
  const lanternM: THREE.Matrix4[] = [];
  const lanternC: THREE.Color[] = [];
  const LCOL = ['#ff3a1a', '#ff7a22', '#ff3a1a', '#ff9a3a'];
  const addLantern = (x: number, y: number, z: number, s = 1) => {
    const c = LCOL[ri(LCOL.length)];
    lanternM.push(M(x, y, z, s, s, s));
    lanternC.push(new THREE.Color(c).multiplyScalar(1.5));
    addGlow(x, y, z, c, 0.5 * s, 3, 0.25);
  };
  for (const b of firsts) for (let z = b.za - 1.8; z > b.zb + 1.2; z -= rr(2.4, 3.8)) if (R() < 0.4) addLantern(b.sx * (X0 - 0.9), rr(3.1, 3.7), z);
  for (const c of cableCurves)
    for (let i = 1; i < 12; i++) {
      const p = c.getPoint(i / 12);
      addLantern(p.x, p.y - 0.35, p.z, 0.55);
    }
  for (const a of alleys) {
    const n = pick(9, 5);
    for (let i = 0; i < n; i++) {
      const x = a.sx * (X0 + 2 + i * 2.4);
      addLantern(x, rr(3.9, 4.6), a.z + rr(-1.8, 1.8));
      if (i % 2 === 0) addPool(x, a.z, 6, 6, i % 4 === 0 ? '#ff5a3a' : '#ff9a4a', 0.7);
    }
    // the lit window at the alley's far end
    const lit = new THREE.Mesh(track(new THREE.PlaneGeometry(4.6, 9)), track(new THREE.MeshBasicMaterial({ map: softGlow(), color: new THREE.Color(NEONS[ri(NEONS.length)]).multiplyScalar(1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })));
    lit.position.set(a.sx * (X1 - 0.3), 5, a.z);
    lit.rotation.y = a.sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    lit.userData.noAO = true;
    group.add(lit);
  }
  instanced(new THREE.SphereGeometry(0.3, 10, 8).scale(1, 1.3, 1), track(new THREE.MeshBasicMaterial({ toneMapped: false })), lanternM, lanternC);

  // vending machines in three designs (street side and alleys)
  const vend = vendingTex(S);
  disp.push(vend.map, vend.em);
  const vendMat = track(new THREE.MeshStandardMaterial({ map: vend.map, emissiveMap: vend.em, emissive: '#ffffff', emissiveIntensity: 1.8, roughness: 0.35, metalness: 0.55 }));
  const vendMats: THREE.Matrix4[][] = [[], [], []];
  const VC = ['#2ec8e0', '#3a8cff', '#ff9a3a'];
  const addVend = (x: number, z: number, ry: number) => {
    const t = ri(3);
    vendMats[t].push(M(x, 0.25, z, 1, 1, 1, ry));
    addPool(x + Math.sin(ry) * 1.6, z + Math.cos(ry) * 1.6, 4.5, 4.5, VC[t], 0.9, 0.27);
    addGlow(x + Math.sin(ry) * 0.5, 1.4, z + Math.cos(ry) * 0.5, VC[t], 1.2, 0, 0.25);
  };
  for (const b of firsts)
    for (let z = b.za - 2; z > b.zb + 2; z -= rr(7, 12))
      if (R() < 0.7) {
        const ry = b.sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        addVend(b.sx * (X0 - 1.3), z, ry);
        if (R() < 0.5) addVend(b.sx * (X0 - 1.3), z - 1.1, ry);
      }
  for (const a of alleys) {
    addVend(a.sx * (X0 + 7), a.z - 1.9, Math.PI);
    if (R() < 0.7) addVend(a.sx * (X0 + 12), a.z + 1.9, 0);
  }
  vendMats.forEach((ms, t) => {
    const g = new THREE.BoxGeometry(0.9, 1.9, 0.85);
    g.translate(0, 0.95, 0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (i >= 16 && i < 20) uv.setXY(i, (t + uv.getX(i)) / 3, uv.getY(i));
      else uv.setXY(i, 0.01 + t / 3, 0.99);
    }
    if (ms.length) instanced(g, vendMat, ms);
    else g.dispose();
  });

  // construction barriers with flashing lamps (a work zone in the right lane, more at the kerbs)
  const bcv = tex(
    canvas(128, 32, (g) => {
      g.fillStyle = '#e8e8ea';
      g.fillRect(0, 0, 128, 32);
      g.fillStyle = '#ff7a1a';
      for (let i = -2; i < 10; i++) {
        g.beginPath();
        g.moveTo(i * 16, 32);
        g.lineTo(i * 16 + 8, 32);
        g.lineTo(i * 16 + 24, 0);
        g.lineTo(i * 16 + 16, 0);
        g.fill();
      }
    }),
  );
  disp.push(bcv);
  const barM: THREE.Matrix4[] = [];
  for (let i = 0; i < 7; i++) {
    const x = 6.6 + i * 1.7;
    const z = -27 - i * 0.6;
    barM.push(M(x, 0.5, z, 1, 1, 1, 0.12 + i * 0.01));
    if (i % 2 === 0) addGlow(x, 1.2, z, '#ffb000', 0.9, 1, 3);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) barM.push(M(sx * 14.6, 0.5, -34 - i * 1.7 - (sx > 0 ? 40 : 0), 1, 1, 1, Math.PI / 2));
  instanced(new THREE.BoxGeometry(1.6, 0.8, 0.22), track(new THREE.MeshStandardMaterial({ map: bcv, roughness: 0.5, metalness: 0.1 })), barM, undefined, high);

  // trash: bags, bins, cardboard stacks, clustered at the alley mouths and shop fronts
  const bagM: THREE.Matrix4[] = [];
  const bagC: THREE.Color[] = [];
  const binM: THREE.Matrix4[] = [];
  const binC: THREE.Color[] = [];
  const boxM: THREE.Matrix4[] = [];
  const cluster = (x: number, z: number) => {
    const nb = 4 + ri(4);
    for (let i = 0; i < nb; i++) {
      bagM.push(M(x + rr(-1.1, 1.1), 0.45, z + rr(-1, 1), rr(0.8, 1.3), rr(0.7, 1.1), rr(0.8, 1.3), R() * 6));
      bagC.push(new THREE.Color(['#10131a', '#1a1226', '#0f1a1a', '#2a2a30'][ri(4)]));
    }
    if (R() < 0.6) {
      binM.push(M(x + rr(-1.2, 1.2), 0.25, z + rr(-1, 1)));
      binC.push(new THREE.Color(['#2a3d48', '#3a2a48', '#2f4a36', '#4a3a2a'][ri(4)]));
    }
    const nx = ri(4);
    for (let i = 0; i < nx; i++) boxM.push(M(x + rr(-1.4, 1.4), 0.45 + (i % 2) * 0.4, z + rr(-1, 1), rr(0.8, 1.4), 1, rr(0.8, 1.2), R() * 3));
  };
  for (const a of alleys) {
    cluster(a.sx * (X0 + 0.5), a.z + 1.8);
    cluster(a.sx * (X0 + 5), a.z - 2);
    cluster(a.sx * (X0 - 1.5), a.z + 3.6);
  }
  for (const b of firsts) if (R() < 0.5) cluster(b.sx * (X0 - 1.2), rr(b.zb + 2, b.za - 2));
  if (bagM.length) instanced(new THREE.IcosahedronGeometry(0.35, 1), track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.22, metalness: 0.1, envMapIntensity: 1.8 })), bagM, bagC);
  if (binM.length) instanced(new THREE.CylinderGeometry(0.38, 0.32, 0.95, 10).translate(0, 0.47, 0), track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.3 })), binM, binC);
  if (boxM.length) instanced(new THREE.BoxGeometry(0.6, 0.4, 0.5), track(new THREE.MeshStandardMaterial({ color: '#6b5238', roughness: 0.9 })), boxM);

  // manhole covers, and the steam that rises from them and from alley vents
  const manholes = [new THREE.Vector3(-3.5, 0, -19), new THREE.Vector3(5.5, 0, -34), new THREE.Vector3(-6, 0, -52), new THREE.Vector3(3, 0, -64), new THREE.Vector3(-11, 0, -41), new THREE.Vector3(10, 0, -76)];
  instanced(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 16), track(new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.4, metalness: 0.9 })), manholes.map((p) => M(p.x, 0.04, p.z)));
  const vents = manholes.slice(0, pick(6, 4));
  for (const a of alleys.slice(0, pick(6, 3))) vents.push(new THREE.Vector3(a.sx * (X0 + 3), 0, a.z - 2));
  {
    const per = pick(26, 14);
    const n = vents.length * per;
    const pos = new Float32Array(n * 3);
    const vent = new Float32Array(n * 3);
    const seed = new Float32Array(n * 2);
    vents.forEach((v, vi) => {
      for (let i = 0; i < per; i++) {
        const k = vi * per + i;
        vent.set([v.x, 0.1, v.z], k * 3);
        seed.set([i / per, R()], k * 2);
      }
    });
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVent', new THREE.BufferAttribute(vent, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    const steam = new THREE.Points(geo, track(steamMaterial(softGlow(), sh)));
    steam.frustumCulled = false;
    steam.userData.noAO = true;
    group.add(steam);
    vents.forEach((v) => addPool(v.x, v.z, 5, 5, '#a68cff', 0.35));
  }

  // ── Hover cars: parked along the kerbs, flying in the distance, driving the expressway ──
  const carBody = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const b = new THREE.BoxGeometry(1.9, 0.5, 4.4);
    b.translate(0, 0.5, 0);
    const c = new THREE.BoxGeometry(1.55, 0.5, 2.1);
    c.translate(0, 0.95, -0.25);
    const n = new THREE.BoxGeometry(1.7, 0.28, 1.2);
    n.translate(0, 0.38, 1.9);
    parts.push(b, c, n);
    const m = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    return m;
  })();
  const carGlow = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number]) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set(c, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(g);
    };
    add(1.7, 0.05, 3.7, 0, 0.2, 0, [0.4, 1.6, 2.4]);
    add(1.5, 0.07, 0.06, 0, 0.58, 2.24, [3, 3, 2.8]);
    add(1.7, 0.08, 0.06, 0, 0.58, -2.22, [3, 0.12, 0.1]);
    const m = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    return m;
  })();
  const carPaint = track(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.22, metalness: 0.9, envMapIntensity: 1.8 }));
  const carLight = track(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const PAINT = ['#0b0d12', '#9aa6b4', '#4a1018', '#0e3a46', '#10203a', '#b8c0c8'];
  const GLOWC = ['#2ec8e0', '#3a8cff', '#2ec8e0', '#ff2a46'];
  const nPark = pick(12, 7);
  const parkM: THREE.Matrix4[] = [];
  const parkC: THREE.Color[] = [];
  const parkG: THREE.Color[] = [];
  for (let i = 0; i < nPark; i++) {
    const sx = i % 2 ? 1 : -1;
    const z = -14 - i * rr(9, 12);
    parkM.push(M(sx * 13.3, 0.45, z, 1, 1, 1, R() < 0.5 ? 0 : Math.PI));
    parkC.push(new THREE.Color(PAINT[ri(PAINT.length)]));
    const gc = GLOWC[ri(GLOWC.length)];
    parkG.push(new THREE.Color(gc));
    addPool(sx * 13.3, z, 4.6, 7, gc, 0.55);
    addGlow(sx * 13.3, 0.3, z, gc, 1.2, 0, 0.3);
  }
  instanced(carBody.clone(), carPaint, parkM, parkC, high);
  instanced(carGlow.clone(), carLight, parkM, parkG);

  type Flyer = { x: number; y: number; z: number; ax: 0 | 1; dir: number; spd: number; sc: number; lo: number; hi: number; ry: number };
  const flyers: Flyer[] = [];
  for (let i = 0; i < pick(46, 20); i++) {
    const dir = R() < 0.5 ? 1 : -1;
    if (i % 3 === 0) flyers.push({ x: rr(-170, 170), y: rr(32, 120), z: rr(-110, -260), ax: 0, dir, spd: rr(10, 24), sc: rr(2.2, 4.5), lo: -180, hi: 180, ry: dir > 0 ? Math.PI / 2 : -Math.PI / 2 });
    else flyers.push({ x: (R() < 0.5 ? -1 : 1) * rr(34, 75), y: rr(26, 95), z: rr(-250, 20), ax: 1, dir, spd: rr(12, 28), sc: rr(2, 4), lo: -270, hi: 30, ry: dir > 0 ? Math.PI : 0 });
  }
  const lanesX = [EXL - 3.1, EXL - 1.1, EXL + 1.1, EXL + 3.1];
  for (let i = 0; i < pick(14, 8); i++) {
    const lane = i % 4;
    const dir = lane < 2 ? -1 : 1;
    flyers.push({ x: lanesX[lane], y: EXY + 1.55, z: rr(-200, 10), ax: 1, dir, spd: rr(16, 30), sc: 1, lo: -230, hi: 14, ry: dir < 0 ? 0 : Math.PI });
  }
  const flyBody = new THREE.InstancedMesh(track(carBody), carPaint, flyers.length);
  const flyGlow = new THREE.InstancedMesh(track(carGlow), carLight, flyers.length);
  flyGlow.instanceMatrix = flyBody.instanceMatrix;
  flyBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flyers.forEach((f, i) => {
    flyBody.setColorAt(i, new THREE.Color(PAINT[ri(PAINT.length)]));
    flyGlow.setColorAt(i, new THREE.Color(GLOWC[ri(GLOWC.length)]).lerp(new THREE.Color('#ffffff'), 0.5));
    f.dir *= 1;
  });
  flyBody.frustumCulled = flyGlow.frustumCulled = false;
  group.add(flyBody, flyGlow);

  // light pools (one instanced additive draw): lamps, shop spill, cars, vents, the lobby
  {
    for (const b of firsts) for (let z = b.za - 2.5; z > b.zb + 2; z -= rr(4, 6)) addPool(b.sx * 22.4, z, 8, 5, NEONS[ri(NEONS.length)], 0.5, 0.27);
    addPool(0, T.z + 9, 42, 16, '#ffc98a', 0.9);
    addPool(0, T.z + 12, 30, 14, '#ff2a3a', 0.35);
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(
      track(g),
      track(new THREE.MeshBasicMaterial({ map: softGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
      pools.length,
    );
    pools.forEach((p, i) => {
      // on Low the wet look is faked: stretch pools along the view axis like reflected light
      im.setMatrixAt(i, M(p.p.x, p.p.y, p.p.z, p.sx, 1, p.sz * (high ? 1 : 1.6)));
      im.setColorAt(i, p.c);
    });
    im.frustumCulled = false;
    im.userData.noAO = true;
    group.add(im);
  }

  // ── Ripples on the wet street ──
  {
    const n = pick(420, 160);
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const ph = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) ph.set([R(), rr(0.7, 1.6)], i * 2);
    g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 2));
    const im = new THREE.InstancedMesh(track(g), track(rippleMaterial(ringTex(), sh)), n);
    for (let i = 0; i < n; i++) im.setMatrixAt(i, M(rr(-15, 15), 0.04, rr(8, -60)));
    im.frustumCulled = false;
    im.userData.noAO = true;
    im.layers.set(1);
    group.add(im);
  }

  // ── TERRORNODE HQ tower ──
  const cwT = curtainWall(S);
  disp.push(cwT.map, cwT.em);
  const glass = track(new THREE.MeshPhysicalMaterial({ color: '#0b1222', metalness: 0.9, roughness: 0.16, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const wall = track(new THREE.MeshPhysicalMaterial({ color: '#9fb4d8', map: cwT.map, emissiveMap: cwT.em, emissive: '#ffffff', emissiveIntensity: 1.2, metalness: 0.85, roughness: 0.14, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.06 }));
  const sideWall = track(new THREE.MeshPhysicalMaterial({ color: '#0e1830', map: cwT.map, emissiveMap: cwT.em, emissive: '#ffffff', emissiveIntensity: 0.9, metalness: 0.85, roughness: 0.18, envMapIntensity: 1.8 }));
  const towerBody = new THREE.Mesh(track(new THREE.BoxGeometry(T.w, T.h, T.d)), [sideWall, sideWall, roofMat, glass, wall, sideWall]);
  towerBody.position.set(0, T.h / 2, T.z - T.d / 2);
  towerBody.castShadow = high;
  towerBody.receiveShadow = true;
  group.add(towerBody);
  const mull = track(new THREE.MeshStandardMaterial({ color: '#2a3346', roughness: 0.35, metalness: 0.9 }));
  const cw = (T.w - 4) / T.cols;
  const ch = (T.h - T.winY0 - 10) / T.rows;
  {
    const mg: THREE.BufferGeometry[] = [];
    for (let c = 0; c <= T.cols; c++) {
      const g = new THREE.BoxGeometry(0.35, T.h - T.winY0 - 6, 0.5);
      g.translate(-T.w / 2 + 2 + c * cw, T.winY0 + (T.h - T.winY0 - 6) / 2 - 2, T.z + 0.2);
      mg.push(g);
    }
    for (let r = 0; r <= T.rows; r++) {
      const g = new THREE.BoxGeometry(T.w - 3, 0.3, 0.5);
      g.translate(0, T.winY0 + r * ch - 0.2, T.z + 0.2);
      mg.push(g);
    }
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.8, T.h, 1.2); // fins up the front corners
      g.translate(sx * (T.w / 2 + 0.1), T.h / 2, T.z + 0.3);
      mg.push(g);
    }
    group.add(new THREE.Mesh(track(mergeGeometries(mg, false)!), mull));
    mg.forEach((g) => g.dispose());
  }
  // crown: three setbacks, a spire, LED rings and corner strips
  let towerLed: THREE.MeshBasicMaterial;
  {
    const parts: THREE.BufferGeometry[] = [];
    const tier = (w: number, h: number, y: number, inset: number) => {
      const g = new THREE.BoxGeometry(w, h, T.d - inset * 2);
      g.translate(0, y + h / 2, T.z - T.d / 2);
      parts.push(g);
    };
    tier(T.w - 4, 5, T.h, 2);
    tier(T.w - 12, 5, T.h + 5, 5);
    tier(T.w - 22, 6, T.h + 10, 8);
    group.add(new THREE.Mesh(track(mergeGeometries(parts, false)!), glass));
    parts.forEach((g) => g.dispose());
    const ant = new THREE.Mesh(track(new THREE.CylinderGeometry(0.15, 0.4, 24, 6)), mull);
    ant.position.set(0, T.h + 28, T.z - T.d / 2);
    group.add(ant);
    towerLed = track(neon('#ff2a1a', 2.8));
    const led: THREE.BufferGeometry[] = [];
    for (const [y, w] of [[T.h + 5, T.w - 4], [T.h + 10, T.w - 12], [T.h + 16, T.w - 22]] as [number, number][]) {
      const g = new THREE.BoxGeometry(w, 0.18, 0.18);
      g.translate(0, y, T.z - 1.6 - (T.w - 4 - w) / 8);
      led.push(g);
    }
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.22, T.h, 0.22);
      g.translate(sx * (T.w / 2 - 0.2), T.h / 2, T.z - 0.15);
      led.push(g);
    }
    group.add(new THREE.Mesh(track(mergeGeometries(led, false)!), towerLed));
    led.forEach((g) => g.dispose());
  }
  const beacon = halo('#ff2020', 5, 0.9);
  beacon.position.set(0, T.h + 40.5, T.z - T.d / 2);
  group.add(beacon);

  // windows: one instanced mesh, per-window colour over an office-interior texture
  const paneTex = track(
    tex(
      canvas(128, 128, (g) => {
        g.fillStyle = '#fff';
        g.fillRect(0, 0, 128, 128);
        g.fillStyle = 'rgba(0,0,0,0.16)';
        for (let i = 0; i < 5; i++) g.fillRect(8 + i * 24, 6, 14, 5); // ceiling panels
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(8, 84, 44, 40);
        g.fillRect(70, 92, 50, 32); // desks
        g.beginPath();
        g.arc(90, 70, 9, 0, 6.3);
        g.fill();
        g.fillRect(80, 78, 20, 26); // a worker
        g.fillStyle = '#000';
        g.fillRect(62, 0, 4, 128); // mullion
        g.strokeStyle = '#000';
        g.lineWidth = 8;
        g.strokeRect(0, 0, 128, 128);
      }),
    ),
  );
  const wins: Window[] = [];
  const winGeo = track(new THREE.PlaneGeometry(cw - 0.9, ch - 0.8));
  const winMat = track(new THREE.MeshBasicMaterial({ color: '#ffffff', map: paneTex, toneMapped: true, fog: true }));
  const windows = new THREE.InstancedMesh(winGeo, winMat, T.cols * T.rows);
  const mtx = new THREE.Matrix4();
  const col = new THREE.Color();
  const litColor = (lit: number) =>
    lit > 0.95 ? col.set('#ffc890').multiplyScalar(0.9) : lit > 0.8 ? col.set('#a8c8e8').multiplyScalar(0.6) : lit > 0.62 ? col.set('#6a8cb0').multiplyScalar(0.35) : col.set('#0c1626').multiplyScalar(0.9);
  const placeWindows = () => {
    wins.length = 0;
    let s2 = 4242;
    const r2 = () => ((s2 = (s2 * 16807) % 2147483647) / 2147483647);
    for (let row = 0; row < T.rows; row++)
      for (let c = 0; c < T.cols; c++) {
        const i = row * T.cols + c;
        const x = -T.w / 2 + 2 + cw * (c + 0.5);
        const y = T.winY0 + ch * (row + 0.5);
        const lit = r2();
        wins.push({ i, x, y, hp: 30, broke: false, lit });
        mtx.makeTranslation(x, y, T.z + 0.06);
        windows.setMatrixAt(i, mtx);
        windows.setColorAt(i, litColor(lit));
      }
    windows.instanceMatrix.needsUpdate = true;
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
  };
  placeWindows();
  group.add(windows);
  const burning: Window[] = [];
  const breakWindow = (w: Window) => {
    w.broke = true;
    windows.setColorAt(w.i, col.set('#120604'));
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    if (Math.random() < 0.35) burning.push(w);
  };

  // logo: TERRORNODE / HEADQUARTERS to the right of the huge animated eye
  const logoTex = track(
    tex(
      canvas(1024, 300, (g) => {
        g.clearRect(0, 0, 1024, 300);
        g.font = '900 118px "Arial Black", Impact, sans-serif';
        g.textBaseline = 'middle';
        g.textAlign = 'center';
        g.fillStyle = '#eef3fb';
        g.shadowColor = '#9fc0ff';
        g.shadowBlur = 0;
        g.fillText('TERRORNODE', 512, 118);
        g.font = '700 44px Arial, sans-serif';
        g.fillStyle = '#ff4a3a';
        g.shadowColor = '#ff2020';
        g.fillText('H  E  A  D  Q  U  A  R  T  E  R  S', 512, 224);
        g.font = `700 28px ${JP}`;
        g.fillStyle = '#ff9a8a';
        g.fillText('テラーノード本社', 512, 275);
      }),
    ),
  );
  const logo = new THREE.Mesh(
    track(new THREE.PlaneGeometry(19, 5.6)),
    track(new THREE.MeshBasicMaterial({ map: logoTex, color: new THREE.Color('#ffffff').multiplyScalar(1.5), toneMapped: false, transparent: true, depthWrite: false, fog: false })),
  );
  logo.position.set(7.6, T.h - 4.6, T.z + 0.45);
  group.add(logo);
  const eye = new THREE.Group();
  eye.position.set(-9, T.h - 4.7, T.z + 0.5);
  const eyeMat = track(eyeMaterial(sh));
  const eyeQuad = new THREE.Mesh(track(new THREE.PlaneGeometry(16, 9)), eyeMat);
  eyeQuad.userData.noAO = true;
  const eyeGlow = halo('#ff2a1a', 20, 0.3);
  eyeGlow.position.z = 0.4;
  eye.add(eyeQuad, eyeGlow);
  group.add(eye);
  const lightWorld = new THREE.Vector3(-9, T.h - 4.7, T.z + 3);

  // lobby: a lit atrium behind glass, server racks in the foreground, canopy, entrance light
  const lobbyMat = track(new THREE.MeshBasicMaterial({ map: track(lobbyTex(S)), color: new THREE.Color('#ffffff').multiplyScalar(1.15), toneMapped: true }));
  const lobby = new THREE.Mesh(track(new THREE.PlaneGeometry(T.w - 2.5, 8.2)), lobbyMat);
  lobby.position.set(0, 4.35, T.z + 0.32);
  group.add(lobby);
  {
    const g1: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= 14; i++) {
      const g = new THREE.BoxGeometry(0.16, 8.4, 0.24);
      g.translate(-(T.w - 2.5) / 2 + i * ((T.w - 2.5) / 14), 4.4, T.z + 0.48);
      g1.push(g);
    }
    for (const y of [0.2, 4.4, 8.5]) {
      const g = new THREE.BoxGeometry(T.w - 2.2, 0.24, 0.3);
      g.translate(0, y, T.z + 0.48);
      g1.push(g);
    }
    group.add(new THREE.Mesh(track(mergeGeometries(g1, false)!), mull));
    g1.forEach((g) => g.dispose());
  }
  const canopy = new THREE.Mesh(track(new THREE.BoxGeometry(T.w + 4, 0.6, 7)), mull);
  canopy.position.set(0, 9, T.z + 3);
  group.add(canopy);
  const canopyLight = new THREE.Mesh(track(new THREE.BoxGeometry(T.w + 2, 0.1, 0.4)), track(neon('#27e6ff', 3)));
  canopyLight.position.set(0, 8.66, T.z + 6.3);
  group.add(canopyLight);
  for (let i = 0; i < 9; i++) addGlow(-T.w / 2 + 2 + i * ((T.w - 4) / 8), 8.55, T.z + 5.4, '#ffe0b0', 2.2, 0, 0.8);
  const rackCv = canvas(64, 128, (g) => {
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 128; y += 8) {
      g.fillStyle = '#0d1520';
      g.fillRect(4, y, 56, 6);
      for (let x = 8; x < 58; x += 6) {
        g.fillStyle = Math.random() < 0.5 ? '#27e6ff' : Math.random() < 0.3 ? '#ff3030' : '#0a3a44';
        g.fillRect(x, y + 2, 3, 2);
      }
    }
  });
  const racks: Rack[] = [];
  const rackMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 8; i++) {
    const rt = track(new THREE.CanvasTexture(rackCv));
    rt.colorSpace = THREE.SRGBColorSpace;
    rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
    const mat = track(new THREE.MeshStandardMaterial({ color: '#141a24', metalness: 0.7, roughness: 0.4, emissive: '#ffffff', emissiveMap: rt, emissiveIntensity: 2.2 }));
    rackMats.push(mat);
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(2.6, 6.4, 1.6)), mat);
    m.position.set((i < 4 ? -1 : 1) * (4.2 + (i % 4) * 3.1), 3.2, T.z + 2.2); // a clear aisle down the middle: the walk goes into the lobby
    m.castShadow = high;
    group.add(m);
    racks.push({ mesh: m, hp: 160, broke: false, t: 0 });
  }
  const breakRack = (rk: Rack) => {
    rk.broke = true;
    const mat = rk.mesh.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.05;
    mat.color.set('#0a0a0a');
    rk.mesh.rotation.z = (Math.random() - 0.5) * 0.25;
  };
  const rebuild = () => {
    placeWindows();
    burning.length = 0;
    for (const rk of racks) {
      rk.broke = false;
      rk.hp = 160;
      const mat = rk.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.2;
      mat.color.set('#141a24');
      rk.mesh.rotation.z = 0;
    }
  };

  // ── Searchlights: crown pair (sweeping) and two street-level pillars, soft volumetric cones ──
  const beams: THREE.Group[] = [];
  const beamMat = track(beamMaterial('#bcd4ff', 0.16, 0.7, true, sh));
  const beamGeo = track(new THREE.CylinderGeometry(9, 0.6, 160, 24, 1, true));
  const mkBeam = (x: number, y: number, z: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const cone = new THREE.Mesh(beamGeo, beamMat);
    cone.position.y = 80;
    cone.userData.noAO = true;
    cone.frustumCulled = false;
    g.add(cone);
    group.add(g);
    beams.push(g);
  };
  mkBeam(9, T.h + 2, T.z - 4);
  mkBeam(-9, T.h + 2, T.z - 4);
  if (high) {
    mkBeam(-21, 0.5, -48);
    mkBeam(21, 0.5, -58);
  }

  // ── Mist banks, drifting low across the street ──
  for (let i = 0; i < pick(6, 3); i++) {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(64, 8)), track(mistMaterial(sh, i % 2 ? '#24607c' : '#1e4a78', 0.2)));
    m.position.set(0, 3.2, -8 - i * 14);
    m.userData.noAO = true;
    group.add(m);
  }

  // ── Layered skyline cards: depth and haze beyond the canyon ──
  for (const [z, tone, haze, dens, k, seed] of [
    [-185, '#0b0e1e', 'rgba(20,50,80,0.55)', 0.16, 1.0, 1],
    [-240, '#0e1a30', 'rgba(25,60,95,0.7)', 0.12, 1.35, 2],
    [-310, '#142a45', 'rgba(40,90,120,0.8)', 0.09, 1.8, 3],
  ] as [number, string, string, number, number, number][]) {
    const t = track(skylineTex(seed * 13, tone, haze, dens, S));
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(900 * k, 225 * k)), track(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, toneMapped: true })));
    m.position.set(0, 225 * k * 0.5 - 6, z);
    m.renderOrder = -5;
    m.userData.noAO = true;
    group.add(m);
  }

  // ── Rain: pure vertex-shader streaks ──
  {
    const RN = pick(3600, 1300);
    const pos = new Float32Array(RN * 6);
    const seed = new Float32Array(RN * 8);
    const end = new Float32Array(RN * 2);
    for (let i = 0; i < RN; i++) {
      const x = (Math.random() - 0.5) * 66;
      const y = Math.random() * 38;
      const z = -Math.random() * 100 + 8;
      const w = Math.random();
      pos.set([x, y, z, x, y, z], i * 6);
      seed.set([0, 0, 0, w, 0, 0, 0, w], i * 8);
      end.set([0, 1], i * 2);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const rain = new THREE.LineSegments(g, track(rainMaterial(sh, '#8fb0d0')));
    rain.frustumCulled = false;
    rain.userData.noAO = true;
    rain.layers.set(1);
    group.add(rain);
  }

  // ── Glow points: everything registered above becomes one Points draw ──
  {
    const n = glows.length;
    const pos = new Float32Array(n * 3);
    const colr = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const ph = new Float32Array(n * 2);
    glows.forEach((gl, i) => {
      pos.set([gl.p.x, gl.p.y, gl.p.z], i * 3);
      colr.set([gl.c.r, gl.c.g, gl.c.b], i * 3);
      size[i] = gl.s;
      ph.set([gl.ph, gl.mode], i * 2);
    });
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colr, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 2));
    const pts = new THREE.Points(g, track(glowMaterial(softGlow(), sh)));
    pts.frustumCulled = false;
    pts.userData.noAO = true;
    group.add(pts);
  }

  scene.add(group);

  // ── Per-frame ──
  const tmp = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const tmpE = new THREE.Euler();
  const eyeLook = new THREE.Vector2();
  const update = (dt: number, t: number, cam: THREE.Camera) => {
    sh.uT.value = t;
    skyMat.uniforms.uT.value = t;
    if (cam instanceof THREE.PerspectiveCamera) {
      renderer.getDrawingBufferSize(bufSize);
      sh.uPx.value = bufSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    }
    beacon.material.opacity = Math.sin(t * 3) > 0 ? 0.95 : 0.1;
    beams[0].rotation.set(Math.sin(t * 0.33) * 0.55, 0, Math.cos(t * 0.27) * 0.45 - 0.2);
    beams[1].rotation.set(Math.cos(t * 0.29) * 0.5, 0, Math.sin(t * 0.35) * 0.45 + 0.2);
    if (beams[2]) beams[2].rotation.set(-0.15 + Math.sin(t * 0.21) * 0.25, 0, 0.3 + Math.cos(t * 0.17) * 0.3);
    if (beams[3]) beams[3].rotation.set(-0.1 + Math.cos(t * 0.19) * 0.25, 0, -0.3 + Math.sin(t * 0.23) * 0.3);
    // the eye follows the player
    cam.getWorldPosition(tmp);
    eyeLook.set(THREE.MathUtils.clamp((tmp.x - eye.position.x) / 40, -1, 1), -0.2 + Math.sin(t * 0.7) * 0.15);
    (eyeMat.uniforms.uLook.value as THREE.Vector2).copy(eyeLook);
    eyeGlow.material.opacity = 0.28 + Math.sin(t * 2.3) * 0.08;
    towerLed.color.setRGB(2.4 + Math.sin(t * 4) * 0.7, 0.2, 0.15 + (Math.sin(t * 0.8) > 0.6 ? 1.2 : 0));
    idol.update(t);
    if (burning.length) {
      for (const w of burning) windows.setColorAt(w.i, col.setRGB(1.6 + Math.random() * 0.8, 0.45 + Math.random() * 0.25, 0.08));
      if (windows.instanceColor) windows.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < rackMats.length; i++) {
      const em = rackMats[i].emissiveMap!;
      if (!racks[i].broke) em.offset.y = Math.floor(t * 6 + i) * 0.125;
    }
    for (const l of lamps) l.intensity = 60 * (0.94 + Math.random() * 0.06);
    // flying traffic
    for (let i = 0; i < flyers.length; i++) {
      const f = flyers[i];
      const span = f.hi - f.lo;
      let v = (f.ax === 0 ? f.x : f.z) + f.dir * f.spd * dt;
      if (v > f.hi) v -= span;
      else if (v < f.lo) v += span;
      if (f.ax === 0) f.x = v;
      else f.z = v;
      tmpQ.setFromEuler(tmpE.set(0, f.ry, Math.sin(t * 0.8 + i) * 0.03));
      tmpM.compose(tmp.set(f.x, f.y + (f.sc > 1 ? Math.sin(t * 0.6 + i * 2) * 0.4 : 0), f.z), tmpQ, tmpS.setScalar(f.sc));
      flyBody.setMatrixAt(i, tmpM);
    }
    flyBody.instanceMatrix.needsUpdate = true;
    // the train runs down the viaduct every 16 s
    const trainT = (t % 16) / 16;
    const active = trainT < 0.75;
    const head = 40 - (trainT / 0.75) * 300;
    tmpQ.identity();
    for (let i = 0; i < TRAIN_N; i++) {
      tmpM.compose(tmp.set(RLX, RLY + 1.95, head + i * 9.6), tmpQ, tmpS.setScalar(active ? 1 : 0));
      trainBody.setMatrixAt(i, tmpM);
    }
    trainBody.instanceMatrix.needsUpdate = true;
    hitLight.intensity *= Math.pow(0.002, dt);
  };

  let frames = 0;
  const beforeRender = (r: THREE.WebGLRenderer, sc: THREE.Scene, cam: THREE.PerspectiveCamera) => {
    if (!refl) return;
    // the first frames render the shadow maps; the mirror pass reuses them
    if (frames++ < 3) return;
    refl.getReflectionCamera(cam).layers.set(0); // rain, ripples and the held gun are not reflected
    ground.visible = false; // the street samples this texture, so it must not draw into it
    (refl.onBeforeRender as unknown as (r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera) => void).call(refl, r, sc, cam);
    ground.visible = true;
    gu.uReflMat.value.copy((refl.material as THREE.ShaderMaterial).uniforms.textureMatrix.value as THREE.Matrix4).multiply(reflInv);
  };
  const resize = (w: number, h: number) => {
    refl?.getRenderTarget().setSize(Math.max(64, Math.round(w * 0.5)), Math.max(64, Math.round(h * 0.5)));
  };

  return {
    group,
    windows,
    wins,
    racks,
    towerBody,
    solids: [towerBody],
    ground,
    eye,
    hitLight,
    lightWorld,
    breakWindow,
    breakRack,
    rebuild,
    beforeRender,
    resize,
    update,
    dispose: () => {
      scene.remove(group);
      disp.forEach((d) => d.dispose());
      for (const rk of racks) rk.mesh.geometry.dispose();
      windows.dispose();
      refl?.dispose();
      env.dispose();
      scene.environment = null;
    },
  };
}
