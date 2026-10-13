/**
 * NPG Racing pilots: the rigged NPG card GLBs (public/npg/cards/<slug>-rigged.glb) sitting INSIDE the toon karts'
 * cockpits: hips sunk into the hull, legs folded away (bone scale), only chest, shoulders and a slightly big head
 * poking out, kart-racer style. Loaded lazily, once per slug, then skeleton-cloned per ship. They play the shared
 * mocap idle with the head held upright (npgRigMocap.holdHeadUp). The models are used as shipped (never undressed).
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { findHead, holdHeadUp, IDLE, rigClips } from '@/lib/npgRigMocap';

/** The girls that can drive (rigged, not Erobots). */
export const NPG_PILOTS = ['phi-phi', 'hikaru', 'yamarashii', 'miyuki', 'payne', 'peggy', 'scarlet', 'matoko', 'ayumi', 'kimiko', 'kazuyo', 'nao', 'aika', 'doctor'];
/** The evil Erobots: the bot bodies left out of NPG Arena drive the rival ships. */
export const EROBOT_PILOTS = ['bot', 'tech', 'graf-bot', 'frog-bot', 'stripey-bot'];

type Src = { gltf: GLTF; clips: THREE.AnimationClip[]; scale: number; offset: THREE.Vector3 };
const cache = new Map<string, Promise<Src | null>>();
let loader: GLTFLoader | null = null;

/** Pilot height in ship units (hulls are ~5 long): big chibi head, most of her hidden in the tub. */
const HEIGHT = 2.3;
/** Where her hips sit, hull-local (the hull's top is ~0.75 at the cockpit): low, so only chest-up shows. */
const HIPS_Y = 0.12;
const HEAD_SCALE = 1.18;

function load(slug: string): Promise<Src | null> {
  let p = cache.get(slug);
  if (!p) {
    loader ??= new GLTFLoader();
    p = loader
      .loadAsync(`/npg/cards/${slug}-rigged.glb`)
      .then(async (gltf) => {
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const h = Math.max(0.001, box.max.y - box.min.y);
        const scale = HEIGHT / h;
        const offset = new THREE.Vector3(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
        const clips = await rigClips(model, slug).catch(() => []);
        return { gltf, clips, scale, offset };
      })
      .catch(() => null);
    cache.set(slug, p);
  }
  return p;
}

const bone = (model: THREE.Object3D, re: RegExp) => {
  const out: THREE.Object3D[] = [];
  model.traverse((o) => (o as THREE.Bone).isBone && re.test(o.name.replace(/^mixamorig\d*[:_]?/, '')) && out.push(o));
  return out;
};

function instance(src: Src) {
  const model = cloneSkinned(src.gltf.scene);
  model.scale.setScalar(src.scale);
  model.position.copy(src.offset);
  model.traverse((o) => {
    if (o.name.startsWith('Icosphere')) o.visible = false; // Tripo's rig-preview marker
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.frustumCulled = false;
      m.castShadow = false;
    }
  });
  const legs = bone(model, /^(Left|Right)UpLeg$/);
  const head = findHead(model) as THREE.Object3D | null;
  const hips = bone(model, /^Hips$/)[0] ?? null;
  /** Fold the legs away and puff the head; re-applied after every mixer step. */
  const pose = () => {
    for (const l of legs) l.scale.setScalar(0.001);
    head?.scale.setScalar(HEAD_SCALE);
  };
  pose();
  return { model, head, hips, pose };
}

export type Pilot = { update(dt: number, lean: number): void; dispose(): void };

/** Put a pilot in `seat` (hull-local, +Z forward). Resolves to null if the GLB can't load. */
export async function seatPilot(seat: THREE.Object3D, slug: string, alive: () => boolean, light = false): Promise<Pilot | null> {
  const src = await load(slug);
  if (!src || !alive()) return null;
  const { model, head, hips, pose } = instance(src);
  const holder = new THREE.Group();
  holder.add(model);
  seat.add(holder);
  // Sink her so the hips sit low inside the hull.
  holder.updateMatrixWorld(true);
  if (hips) {
    const hp = holder.worldToLocal(hips.getWorldPosition(new THREE.Vector3()));
    holder.position.y = HIPS_Y - hp.y;
  } else holder.position.y = HIPS_Y - HEIGHT * 0.3;
  const lights: THREE.Light[] = [];
  if (light) {
    // Player only: a warm key from the chase cam side and a pink rim from the front, so she reads as a girl.
    const key = new THREE.PointLight('#fff1e6', 9, 6, 1.6);
    key.position.set(0, 2.4, -2.6);
    const rim = new THREE.PointLight('#ff4fb0', 7, 5, 1.6);
    rim.position.set(0, 2.0, 1.6);
    seat.add(key, rim);
    lights.push(key, rim);
  }
  const mixer = new THREE.AnimationMixer(model);
  const idle = src.clips.find((c) => c.name === IDLE);
  if (idle) mixer.clipAction(idle).play();
  let lean = 0;
  return {
    update(dt, want) {
      mixer.update(dt);
      pose();
      lean += (want - lean) * Math.min(1, dt * 6);
      holder.rotation.z = lean;
      holdHeadUp(model, head);
    },
    dispose() {
      mixer.stopAllAction();
      seat.remove(holder, ...lights);
    },
  };
}

/** Head-and-shoulders portrait (PNG data URL) for the pilot picker, rendered with the game's renderer. */
export async function pilotPortrait(renderer: THREE.WebGLRenderer, slug: string): Promise<string | null> {
  const src = await load(slug);
  if (!src) return null;
  const W = 192, H = 224;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#40204a', 1.8));
  const k = new THREE.DirectionalLight('#ffffff', 2.6);
  k.position.set(1.5, 2, 3);
  const r = new THREE.DirectionalLight('#22e6ff', 3);
  r.position.set(-2, 1.5, -1.5);
  scene.add(k, r);
  const { model, head } = instance(src);
  const g = new THREE.Group();
  g.add(model);
  g.rotation.y = 0.3;
  scene.add(g);
  const idle = src.clips.find((c) => c.name === IDLE);
  if (idle) {
    const m = new THREE.AnimationMixer(model);
    m.clipAction(idle).play();
    m.update(0.4);
  }
  holdHeadUp(model, head);
  g.updateMatrixWorld(true);
  const hp = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, HEIGHT * 0.75, 0);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 20);
  cam.position.set(0, hp.y + 0.05, hp.z + 2.6);
  cam.lookAt(0, hp.y - 0.05, hp.z);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prev = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  renderer.setRenderTarget(prev);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  c.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
