import * as THREE from 'three';

/**
 * The NPG chibi base is fully rigged (84 bones) but ships with no animation, only its T-pose.
 * These clips are made in code: each is a loop of bone rotations layered on the bind pose.
 * Rotations are in each bone's own space (Blender rig: Y runs along the bone).
 */

type Key = { bone: string; axis: 'x' | 'y' | 'z'; angle: (t: number) => number };

// Axes are the character's own (glTF: faces +Z, up +Y, her left +X), converted to each bone's
// local frame in chibiClips, so one rule works whatever way each bone was built. Keys on a bone
// apply last-listed first (so list "swing" before "lower" to swing an already-lowered arm).
const ARM_DOWN = 1.2;

const armsDownList: Key[] = [
  { bone: 'upper_arm.L', axis: 'z', angle: () => -ARM_DOWN },
  { bone: 'upper_arm.R', axis: 'z', angle: () => ARM_DOWN },
];
const armsDownKeys = new Set(armsDownList);

function stride(amp: number, knee: number, swing: number, bob: number): Key[] {
  const w = Math.PI * 2;
  return [
    { bone: 'upper_arm.L', axis: 'x', angle: (t) => Math.sin(w * t) * swing },
    { bone: 'upper_arm.R', axis: 'x', angle: (t) => -Math.sin(w * t) * swing },
    ...armsDownList,
    { bone: 'upper_leg.L', axis: 'x', angle: (t) => -Math.sin(w * t) * amp },
    { bone: 'upper_leg.R', axis: 'x', angle: (t) => Math.sin(w * t) * amp },
    { bone: 'lower_leg.L', axis: 'x', angle: (t) => Math.max(0, Math.sin(w * t + 1.2)) * knee },
    { bone: 'lower_leg.R', axis: 'x', angle: (t) => Math.max(0, -Math.sin(w * t + 1.2)) * knee },
    { bone: 'upper_torso', axis: 'y', angle: (t) => Math.sin(w * t) * bob },
  ];
}

// One-shot two-handed swing: wind up to her right, then cut across to her left (character axes, as above).
const ease = (t: number) => (t < 0.35 ? -Math.sin((t / 0.35) * Math.PI * 0.5) : t < 0.6 ? -1 + 2 * Math.sin(((t - 0.35) / 0.25) * Math.PI * 0.5) : Math.cos(((t - 0.6) / 0.4) * Math.PI * 0.5));
const attack: Key[] = [
  { bone: 'upper_torso', axis: 'y', angle: (t) => ease(t) * 0.55 },
  { bone: 'lower_torso', axis: 'y', angle: (t) => ease(t) * 0.25 },
  { bone: 'neck', axis: 'y', angle: (t) => -ease(t) * 0.35 },
  { bone: 'upper_arm.L', axis: 'x', angle: (t) => -Math.abs(ease(t)) * 0.9 },
  { bone: 'upper_arm.R', axis: 'x', angle: (t) => -Math.abs(ease(t)) * 0.9 },
  { bone: 'lower_arm.L', axis: 'x', angle: (t) => -Math.abs(ease(t)) * 0.4 },
  { bone: 'lower_arm.R', axis: 'x', angle: (t) => -Math.abs(ease(t)) * 0.4 },
  { bone: 'upper_leg.L', axis: 'x', angle: (t) => Math.abs(ease(t)) * 0.25 },
  { bone: 'lower_leg.R', axis: 'x', angle: (t) => Math.abs(ease(t)) * 0.3 },
];

const CLIPS: Record<string, { duration: number; keys: Key[] }> = {
  idle: {
    duration: 3,
    keys: [
      ...armsDownList,
      { bone: 'upper_torso', axis: 'x', angle: (t) => Math.sin(t * Math.PI * 2) * 0.03 },
      { bone: 'neck', axis: 'y', angle: (t) => Math.sin(t * Math.PI * 2) * 0.08 },
    ],
  },
  walk: { duration: 1, keys: stride(0.45, 0.7, 0.35, 0.08) },
  run: { duration: 0.6, keys: stride(0.75, 1.2, 0.7, 0.15) },
  attack: { duration: 0.7, keys: attack },
};

/**
 * Build idle / walk / run / attack clips for a chibi base scene (call before cloning it).
 * `armsDown: false` for characters whose rest pose already has the arms down (the Tripo girls on the doll's rig);
 * the doll itself is stored T-posed, so by default the arms are lowered first.
 */
export function chibiClips(root: THREE.Object3D, { armsDown = true }: { armsDown?: boolean } = {}): THREE.AnimationClip[] {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  // Each bone's bind orientation relative to the character root, to turn character axes into bone axes.
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const toLocal = (bone: THREE.Bone, axis: THREE.Vector3) => {
    const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const rel = rootQ.clone().multiply(parentQ).multiply(bone.quaternion); // bone's bind frame in root space
    return axis.clone().applyQuaternion(rel.invert());
  };
  const steps = 24;
  return Object.entries(CLIPS).map(([name, { duration, keys }]) => {
    const byBone = new Map<string, Key[]>();
    for (const k of keys) {
      if (!armsDown && armsDownKeys.has(k)) continue;
      byBone.set(k.bone, [...(byBone.get(k.bone) ?? []), k]);
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [boneName, ks] of byBone) {
      const bone = bones.get(THREE.PropertyBinding.sanitizeNodeName(boneName)); // GLTFLoader strips the '.' from 'upper_arm.L'
      if (!bone) continue;
      const times: number[] = [];
      const values: number[] = [];
      const q = new THREE.Quaternion();
      const step = new THREE.Quaternion();
      const axes = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * duration;
        q.copy(bone.quaternion);
        for (const k of ks) q.multiply(step.setFromAxisAngle(toLocal(bone, axes[k.axis]), k.angle(t / duration)));
        times.push(t);
        values.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
    }
    return new THREE.AnimationClip(name, duration, tracks);
  });
}
