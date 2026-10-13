/**
 * NPG Racing pilots: the rigged NPG card GLBs (public/npg/cards/<slug>-rigged.glb) sitting in the toon ships' open
 * cockpits. Loaded lazily, once per slug, then skeleton-cloned per ship. They play the shared mocap idle with the head
 * held upright (npgRigMocap.holdHeadUp). The models are used exactly as shipped.
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

/** Pilot height in ship units (hulls are ~6 long): a big chibi head poking out of the cockpit. */
const HEIGHT = 2.4;

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

export type Pilot = { update(dt: number, lean: number): void; dispose(): void };

/** Put a pilot in `seat` (origin = cockpit floor, +Z forward). Resolves to null if the GLB can't load. */
export async function seatPilot(seat: THREE.Object3D, slug: string, alive: () => boolean): Promise<Pilot | null> {
  const src = await load(slug);
  if (!src || !alive()) return null;
  const model = cloneSkinned(src.gltf.scene);
  model.scale.setScalar(src.scale);
  model.position.copy(src.offset);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.frustumCulled = false;
      m.castShadow = false;
    }
  });
  const holder = new THREE.Group();
  holder.add(model);
  seat.add(holder);
  const head = findHead(model);
  const mixer = new THREE.AnimationMixer(model);
  const idle = src.clips.find((c) => c.name === IDLE);
  if (idle) mixer.clipAction(idle).play();
  let lean = 0;
  return {
    update(dt, want) {
      mixer.update(dt);
      lean += (want - lean) * Math.min(1, dt * 6);
      holder.rotation.z = lean;
      holdHeadUp(model, head);
    },
    dispose() {
      mixer.stopAllAction();
      seat.remove(holder);
    },
  };
}
