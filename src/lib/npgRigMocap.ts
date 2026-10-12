import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

/**
 * Real Mixamo motion capture on a girl rigged in Tripo. Tripo's rig uses Mixamo's own skeleton and bone names, so a
 * Mixamo clip plays on it directly: we only rename the tracks to her bone names and drop the root motion (clips play in
 * place). Clips live in public/arena/models/npg/anims (the owner's Mixamo downloads).
 */
export const RIG_CLIPS = { walk: 'mixamo_walk.fbx', idle: 'mixamo_zombie_idle.fbx' } as const;

const cache = new Map<string, Promise<THREE.AnimationClip | null>>();
const loadFbx = (file: string) => {
  let p = cache.get(file);
  if (!p) {
    p = new FBXLoader()
      .loadAsync(`/arena/models/npg/anims/${file}`)
      .then((g) => g.animations[0] ?? null)
      .catch(() => null);
    cache.set(file, p);
  }
  return p;
};

const key = (n: string) => n.replace(/^mixamorig\d*[:_]?/, '');

/** The clip with its tracks bound to this model's bones (rotations only, plus the hips' bob). */
export async function rigClip(model: THREE.Object3D, file: string): Promise<THREE.AnimationClip | null> {
  const src = await loadFbx(file);
  if (!src) return null;
  const names = new Map<string, string>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) names.set(key(o.name), o.name);
  });
  const tracks = src.tracks.flatMap((t) => {
    const dot = t.name.lastIndexOf('.');
    const bone = names.get(key(t.name.slice(0, dot)));
    const prop = t.name.slice(dot + 1);
    if (!bone || prop !== 'quaternion') return [];
    const k = t.clone();
    k.name = `${bone}.${prop}`;
    return [k];
  });
  return tracks.length ? new THREE.AnimationClip(src.name || file, src.duration, tracks) : null;
}
