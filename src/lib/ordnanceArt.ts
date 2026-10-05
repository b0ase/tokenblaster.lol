'use client';

/**
 * Art for 1Sat Ordnance weapons without hand-made images: one offscreen renderer draws the
 * weapon's tinted glTF on a dark gold backdrop. Used for store cards and as the inscription file.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GUNS } from './arenaHD';
import { RARITY_COLOR, type Ordnance } from './ordnance';
import { tintGun } from './ordnanceGun';

let renderer: THREE.WebGLRenderer | null = null;
const envs = new WeakMap<THREE.WebGLRenderer, THREE.Texture>(); // a PMREM texture belongs to one GL context
const models = new Map<string, Promise<THREE.Object3D>>();
const urls = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

function model(base: string) {
  let p = models.get(base);
  if (!p) {
    const def = GUNS.find((g) => g.id === base);
    if (!def) throw new Error(`No gun model ${base}`);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(def.url).then((g) => g.scene);
    models.set(base, p);
  }
  return p;
}

function setup(r: THREE.WebGLRenderer) {
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
}

let logoTex: Promise<THREE.Texture> | null = null;
/** The PNEEs logo as a texture (for the PNEE Shotgun's stock). */
function pneeLogo() {
  logoTex ??= new THREE.TextureLoader().loadAsync('/ordnance/pnee-logo.png').then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  return logoTex;
}

/** Brand marks on a weapon's model (only the PNEE Shotgun so far): a logo on each side of the stock. */
async function brand(o: Ordnance, gun: THREE.Object3D, dim: THREE.Vector3) {
  if (o.id !== 'pnee-shotgun') return;
  const tex = await pneeLogo();
  const long = dim.x >= dim.z ? 'x' : 'z';
  const side = long === 'x' ? 'z' : 'x';
  const size = Math.max(dim.x, dim.z) * 0.1;
  // Which end is the butt? The stock is the deep end: compare vertical spread in each end fifth.
  gun.updateMatrixWorld(true);
  const ends = { lo: [Infinity, -Infinity, 0], hi: [Infinity, -Infinity, 0] }; // y min, y max, |side| max
  const v = new THREE.Vector3();
  gun.traverse((n) => {
    const m = n as THREE.Mesh;
    const pos = m.isMesh ? (m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const e = v[long] < -dim[long] * 0.3 ? ends.lo : v[long] > dim[long] * 0.3 ? ends.hi : null;
      if (e) {
        e[0] = Math.min(e[0], v.y);
        e[1] = Math.max(e[1], v.y);
        e[2] = Math.max(e[2], Math.abs(v[side]));
      }
    }
  });
  const butt = ends.lo[1] - ends.lo[0] >= ends.hi[1] - ends.hi[0] ? -1 : 1;
  const stock = butt < 0 ? ends.lo : ends.hi;
  const yMid = (stock[0] + stock[1]) / 2;
  for (const sgn of [1, -1]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 48), new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.3, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position[long] = butt * dim[long] * 0.38;
    m.position.y = yMid;
    m.position[side] = sgn * (stock[2] + size * 0.02);
    m.rotation.y = side === 'z' ? (sgn > 0 ? 0 : Math.PI) : sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
    gun.add(m);
  }
}

/** A weapon's scene: backdrop, lights, the tinted (and branded) model on a pivot, and a camera. */
async function buildScene(o: Ordnance, r: THREE.WebGLRenderer) {
  let env = envs.get(r);
  if (!env) {
    env = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    envs.set(r, env);
  }
  const scene = new THREE.Scene();
  scene.environment = env;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 180);
  grad.addColorStop(0, '#2a2000');
  grad.addColorStop(1, '#060607');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const bg = new THREE.CanvasTexture(c);
  bg.colorSpace = THREE.SRGBColorSpace;
  scene.background = bg;
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x101114, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(RARITY_COLOR[o.rarity]), 3);
  rim.position.set(-4, 2, -4);
  scene.add(rim);

  const gun = cloneSkinned(await model(o.base)); // the minigun is rigged: a plain clone keeps the original's bones
  tintGun(gun, o.tint, 0.7);
  if (o.base === 'minigun') gun.rotation.y = Math.PI / 2; // modelled barrel-first: turn it side-on
  gun.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gun);
  const dim = box.getSize(new THREE.Vector3());
  gun.position.sub(box.getCenter(new THREE.Vector3()));
  const holder = new THREE.Group(); // centred gun, so brand marks sit in the same frame as its bounds
  holder.add(gun);
  await brand(o, holder, dim);
  const pivot = new THREE.Group();
  pivot.add(holder);
  // Longest axis across the frame, turned three-quarters toward the camera.
  const baseY = (dim.z > dim.x ? Math.PI / 2 : 0) - 0.6;
  pivot.rotation.set(0.18, baseY, 0);
  scene.add(pivot);

  const rad = Math.max(dim.x, dim.y, dim.z);
  const cam = new THREE.PerspectiveCamera(30, 1, rad / 100, rad * 100);
  cam.position.set(0, rad * 0.15, rad * 2.1);
  cam.lookAt(0, 0, 0);
  return { scene, pivot, cam, baseY, dispose: () => bg.dispose() };
}

async function draw(o: Ordnance, size: number): Promise<HTMLCanvasElement> {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  setup(renderer);
  const s = await buildScene(o, renderer);
  renderer.render(s.scene, s.cam);
  s.dispose();
  return renderer.domElement;
}

/**
 * Live, swivelling model in `canvas` (card hover): follows the pointer, drifts when it is still.
 * Returns a stop function that frees the WebGL context.
 */
export function spinGun(o: Ordnance, canvas: HTMLCanvasElement, pointer: { x: number; y: number }): () => void {
  let stopped = false;
  let raf = 0;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.setSize(canvas.clientWidth, canvas.clientHeight, false);
  setup(r);
  void buildScene(o, r).then((s) => {
    if (stopped) return s.dispose();
    const t0 = performance.now();
    let yaw = s.baseY;
    let pitch = 0.18;
    const tick = (now: number) => {
      if (stopped) return s.dispose();
      const t = (now - t0) / 1000;
      // Pointer -1..1 across the card swings the gun ~45° either way, with a slow drift on top.
      const wantYaw = s.baseY + pointer.x * 0.75 + Math.sin(t * 0.8) * 0.2;
      const wantPitch = 0.18 + pointer.y * 0.35;
      yaw += (wantYaw - yaw) * 0.12;
      pitch += (wantPitch - pitch) * 0.12;
      s.pivot.rotation.set(pitch, yaw, Math.sin(t * 1.3) * 0.04);
      r.render(s.scene, s.cam);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    r.dispose();
    r.forceContextLoss();
  };
}

/** Inscription file for a weapon: its hand-made art, else a 768² webp render. */
export async function gunArtFile(o: Ordnance): Promise<{ contentType: string; data: number[] }> {
  if (o.image) {
    const r = await fetch(o.image);
    if (!r.ok) throw new Error(`Could not load ${o.image}`);
    return { contentType: r.headers.get('content-type') ?? 'image/webp', data: Array.from(new Uint8Array(await r.arrayBuffer())) };
  }
  const job = queue.then(async () => {
    const cv = await draw(o, 768);
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/webp', 0.85));
    if (!blob) throw new Error('Could not render the weapon');
    return { contentType: blob.type || 'image/webp', data: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Image URL for a card: hand-made art, else a cached 384² render. */
export function gunArtUrl(o: Ordnance): Promise<string> {
  if (o.image) return Promise.resolve(o.image);
  let p = urls.get(o.id);
  if (!p) {
    p = queue.then(async () => (await draw(o, 384)).toDataURL('image/webp', 0.85));
    queue = p.catch(() => undefined);
    urls.set(o.id, p);
  }
  return p;
}
