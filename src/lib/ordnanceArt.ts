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
let env: THREE.Texture | null = null;
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

async function draw(o: Ordnance, size: number): Promise<HTMLCanvasElement> {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  env ??= new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

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
  const pivot = new THREE.Group();
  pivot.add(gun);
  // Longest axis across the frame, turned three-quarters toward the camera.
  if (dim.z > dim.x) pivot.rotation.y = Math.PI / 2;
  pivot.rotation.y += -0.6;
  pivot.rotation.x = 0.18;
  scene.add(pivot);

  const r = Math.max(dim.x, dim.y, dim.z);
  const cam = new THREE.PerspectiveCamera(30, 1, r / 100, r * 100);
  cam.position.set(0, r * 0.15, r * 2.1);
  cam.lookAt(0, 0, 0);
  renderer.render(scene, cam);
  bg.dispose();
  return renderer.domElement;
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
