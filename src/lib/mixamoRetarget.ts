import * as THREE from 'three';

/**
 * Put a Mixamo animation on the NPG chibi rig. Both stand in a T-pose at rest, so each frame we
 * take how far every Mixamo bone has turned from its rest pose (in its character's own space) and
 * turn the matching chibi bone by the same amount. Rotations only: clips are downloaded "in place".
 */
const MAP: Record<string, string> = {
  Hips: 'pelvis',
  Spine: 'stomach',
  Spine1: 'lower_torso',
  Spine2: 'upper_torso',
  Neck: 'neck',
  Head: 'head',
  LeftShoulder: 'shoulder.L',
  LeftArm: 'upper_arm.L',
  LeftForeArm: 'lower_arm.L',
  LeftHand: 'hand.L',
  RightShoulder: 'shoulder.R',
  RightArm: 'upper_arm.R',
  RightForeArm: 'lower_arm.R',
  RightHand: 'hand.R',
  LeftUpLeg: 'upper_leg.L',
  LeftLeg: 'lower_leg.L',
  LeftFoot: 'foot.L',
  LeftToeBase: 'toe.L',
  RightUpLeg: 'upper_leg.R',
  RightLeg: 'lower_leg.R',
  RightFoot: 'foot.R',
  RightToeBase: 'toe.R',
};

const bonesOf = (root: THREE.Object3D) => {
  const out: THREE.Bone[] = [];
  root.traverse((o) => (o as THREE.Bone).isBone && out.push(o as THREE.Bone));
  return out;
};

/** A bone's orientation relative to its character's root. */
const rel = (root: THREE.Object3D, o: THREE.Object3D) =>
  root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(o.getWorldQuaternion(new THREE.Quaternion()));

export function retargetMixamo(source: THREE.Object3D, clip: THREE.AnimationClip, target: THREE.Object3D, name = clip.name, fps = 30) {
  const strip = (n: string) => n.replace(/^mixamorig\d*:?/, '');
  const src = new Map(bonesOf(source).map((b) => [strip(b.name), b]));
  const tgt = bonesOf(target);
  const byName = new Map(tgt.map((b) => [b.name, b]));
  // Track names bind by object name, and the chibi has a mesh called "head" too: give bones that
  // share a name with a non-bone a unique one.
  const taken = new Set<string>();
  target.traverse((o) => !(o as THREE.Bone).isBone && taken.add(o.name));
  for (const b of tgt) if (taken.has(b.name)) b.name = `${b.name}_bone`;

  const pairs: { s: THREE.Bone; t: THREE.Bone }[] = [];
  for (const [from, to] of Object.entries(MAP)) {
    const s = src.get(from);
    const t = byName.get(THREE.PropertyBinding.sanitizeNodeName(to)) ?? byName.get(to);
    if (s && t) pairs.push({ s, t });
  }

  // Rest poses (both loaded in their bind/T-pose).
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const sRest = new Map(pairs.map(({ s }) => [s, rel(source, s)]));
  const tRest = new Map(tgt.map((b) => [b, rel(target, b)]));
  const tRestLocal = new Map(tgt.map((b) => [b, b.quaternion.clone()]));
  const driven = new Map(pairs.map((p) => [p.t, p.s]));

  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(clip).play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times: number[] = [];
  const values = new Map<THREE.Bone, number[]>(pairs.map(({ t }) => [t, []]));
  for (let f = 0; f < frames; f++) {
    const time = (f / (frames - 1)) * clip.duration;
    mixer.setTime(time);
    source.updateMatrixWorld(true);
    times.push(time);
    // Walk the chibi top-down, working out each bone's pose in her root space this frame.
    const now = new Map<THREE.Object3D, THREE.Quaternion>();
    const relNow = (o: THREE.Object3D | null): THREE.Quaternion => {
      if (!o || o === target) return new THREE.Quaternion();
      const hit = now.get(o);
      if (hit) return hit;
      const parent = relNow(o.parent);
      const s = driven.get(o as THREE.Bone);
      let q: THREE.Quaternion;
      if (s) {
        const delta = rel(source, s).multiply(sRest.get(s)!.clone().invert());
        q = delta.multiply(tRest.get(o as THREE.Bone)!);
      } else q = parent.clone().multiply(tRestLocal.get(o as THREE.Bone) ?? o.quaternion);
      now.set(o, q);
      return q;
    };
    for (const { t } of pairs) {
      const local = relNow(t.parent).clone().invert().multiply(relNow(t));
      values.get(t)!.push(local.x, local.y, local.z, local.w);
    }
  }
  mixer.stopAllAction();
  const tracks = pairs.map(({ t }) => new THREE.QuaternionKeyframeTrack(`${t.name}.quaternion`, times, values.get(t)!));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}
