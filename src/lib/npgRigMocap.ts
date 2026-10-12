import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Real motion capture for NPG girls on the fixed Tripo rigs (public/npg/cards/<slug>-rigged.glb: Mixamo bone names,
 * every bone's rest rotation = identity, weights recomputed). public/npg/anims/mixamo-anims.glb holds 34 Quaternius UAL
 * clips (CC0, LICENSE-quaternius.txt) retargeted onto that rest, so one file plays on every girl: we only rename the
 * tracks to her bone nodes. The Hips position track was baked at Kimiko's rest height; other girls get their offset.
 */
const KIMIKO_HIPS = new THREE.Vector3(-0.0172, 0.2806, 0.0248);
const HIPS_REST: Record<string, THREE.Vector3> = {
  kimiko: KIMIKO_HIPS,
  nao: new THREE.Vector3(0.0019, 0.244, 0.0327),
  miyuki: new THREE.Vector3(0.0019, 0.2236, 0.044),
};

export const IDLE = 'Idle_Loop';
// front-facing moves only: the combos turn her away from the card
export const ATTACKS = ['Sword_Attack', 'Punch_Jab', 'Sword_Regular_A', 'Punch_Cross', 'Sword_Regular_B', 'Melee_Hook'];

let lib: Promise<THREE.AnimationClip[]> | null = null;
const library = () =>
  (lib ??= new GLTFLoader()
    .loadAsync('/npg/anims/mixamo-anims.glb')
    .then((g) => g.animations)
    .catch(() => []));

const key = (n: string) => n.replace(/^mixamorig\d*[:_]?/, '');

/** All clips, bound to this girl's bones. */
export async function rigClips(model: THREE.Object3D, slug: string): Promise<THREE.AnimationClip[]> {
  const src = await library();
  const names = new Map<string, string>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) names.set(key(o.name), o.name);
  });
  const off = (HIPS_REST[slug] ?? KIMIKO_HIPS).clone().sub(KIMIKO_HIPS);
  return src.map((c) => {
    const tracks = c.tracks.flatMap((t) => {
      const dot = t.name.lastIndexOf('.');
      const bone = names.get(key(t.name.slice(0, dot)));
      // chibi heads are huge: the mocap's head/neck nods read as a broken neck, so the head rides on the spine
      if (!bone || /^(Neck|Head)$/.test(key(t.name.slice(0, dot)))) return [];
      const k = t.clone();
      k.name = `${bone}${t.name.slice(dot)}`;
      // every bone rests at identity, so halving the spine's rotation keeps the big head over her body
      if (/^(Spine\d?|Hips)$/.test(key(t.name.slice(0, dot))) && t.name.endsWith('.quaternion')) {
        const v = k.values;
        const q = new THREE.Quaternion();
        for (let i = 0; i < v.length; i += 4) {
          q.fromArray(v, i).slerp(new THREE.Quaternion(), 0.6).toArray(v, i);
        }
      }
      if (t.name.endsWith('.position')) {
        const v = k.values;
        for (let i = 0; i < v.length; i += 3) {
          v[i] += off.x;
          v[i + 1] += off.y;
          v[i + 2] += off.z;
        }
      }
      return [k];
    });
    return new THREE.AnimationClip(c.name, c.duration, tracks);
  });
}
