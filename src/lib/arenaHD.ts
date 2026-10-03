/**
 * HD arena assets (all CC0, credits in public/arena/CREDITS.md): PBR wall/floor textures from
 * Poly Haven and animated skeleton characters from Kay Lousberg's KayKit. Loads once, then hands
 * out materials and ready-to-animate monster instances.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type MonsterKind = 'warrior' | 'rogue' | 'mage' | 'minion';
export const MONSTER_KINDS: MonsterKind[] = ['warrior', 'rogue', 'mage', 'minion'];

const TEX = ['castle_brick_07', 'metal_plate', 'rough_block_wall', 'rusty_metal_02', 'painted_metal_shutter', 'concrete_floor_worn_001', 'metal_grate_rusty', 'corrugated_iron_02'] as const;
type TexId = (typeof TEX)[number];

export type ArenaAssets = {
  material: (id: TexId, repeat?: [number, number]) => THREE.MeshStandardMaterial;
  models: Record<MonsterKind, GLTF>;
};

/** Load everything; `onProgress` gets 0..1. */
export async function loadArenaAssets(renderer: THREE.WebGLRenderer, onProgress: (p: number) => void): Promise<ArenaAssets> {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, done, total) => onProgress(total ? done / total : 0);
  const tl = new THREE.TextureLoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url: string, srgb: boolean) =>
    new Promise<THREE.Texture>((ok, no) =>
      tl.load(
        url,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = aniso;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          ok(t);
        },
        undefined,
        no,
      ),
    );
  const gl = new GLTFLoader(manager);

  const [maps, models] = await Promise.all([
    Promise.all(
      TEX.map(async (id) => {
        const base = `/arena/tex/${id}`;
        const [map, normalMap, roughnessMap] = await Promise.all([load(`${base}/diff.jpg`, true), load(`${base}/nor.jpg`, false), load(`${base}/rough.jpg`, false)]);
        return [id, { map, normalMap, roughnessMap }] as const;
      }),
    ),
    Promise.all(MONSTER_KINDS.map(async (k) => [k, await gl.loadAsync(`/arena/models/skeleton_${k}.glb`)] as const)),
  ]);
  const byId = new Map(maps);

  return {
    material: (id, repeat = [1, 1]) => {
      const src = byId.get(id)!;
      const clone = (t: THREE.Texture) => {
        const c = t.clone();
        c.repeat.set(repeat[0], repeat[1]);
        c.needsUpdate = true;
        return c;
      };
      return new THREE.MeshStandardMaterial({
        map: clone(src.map),
        normalMap: clone(src.normalMap),
        roughnessMap: clone(src.roughnessMap),
        metalness: id.includes('metal') || id.includes('iron') || id.includes('shutter') ? 0.55 : 0.05,
      });
    },
    models: Object.fromEntries(models) as Record<MonsterKind, GLTF>,
  };
}

/** One animated monster: model clone, mixer, named actions, and a hitbox for shots. */
export class Monster {
  root = new THREE.Group();
  mixer: THREE.AnimationMixer;
  hitbox: THREE.Mesh;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(
    public kind: MonsterKind,
    gltf: GLTF,
  ) {
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // skinned bounds lie when animated
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    // Shots test this box, not the skinned mesh (whose bounds stay in bind pose).
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(1, 2.1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 1.05;
    this.root.add(this.hitbox);
  }

  /** Cross-fade to an animation. `once` plays it a single time and holds the last frame. */
  play(name: string, { once = false, fade = 0.15, speed = 1 } = {}) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return next;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.play();
    if (this.current) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    return next;
  }
}
