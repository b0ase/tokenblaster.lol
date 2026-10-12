import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Motion-capture clips for every character on the chibi doll's rig: the Quaternius Universal Animation Library (CC0,
 * public/npg/anims/LICENSE-quaternius.txt), retargeted onto the doll skeleton (arms-down rest). Clips are rotation-only
 * here: the pelvis position track was baked for Ayumi's proportions, so it's dropped and each character stays planted.
 * Names: Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Sprint_Loop, Jump_Start, Jump_Loop, Jump_Land, Sword_Idle, Sword_Attack,
 * Punch_Jab, Punch_Cross, Roll, Hit_Chest, Hit_Head, Death01, Dance_Loop, Crouch_Idle_Loop, Crouch_Fwd_Loop,
 * Spell_Simple_Shoot, Pistol_Idle_Loop, Pistol_Shoot.
 */
let clips: Promise<THREE.AnimationClip[]> | null = null;

export function npgMocap(): Promise<THREE.AnimationClip[]> {
  clips ??= new GLTFLoader()
    .loadAsync('/npg/anims/npg-anims.glb')
    .then((g) =>
      g.animations.map((c) => {
        const k = c.clone();
        k.tracks = k.tracks.filter((t) => !t.name.endsWith('.position') && !t.name.endsWith('.scale'));
        return k;
      }),
    )
    .catch(() => []);
  return clips;
}

export const mocap = (list: THREE.AnimationClip[], name: string) => list.find((c) => c.name === name || c.name.startsWith(name));
