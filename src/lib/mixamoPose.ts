import * as THREE from 'three';

/**
 * Procedural idle + attack for Tripo's own Mixamo rigs (bones named `mixamorig:*`). Every rotation is given about a
 * WORLD axis in the model's rest frame (Y up, facing +Z) and converted into each bone's local frame, so it doesn't matter
 * how Tripo oriented the bones.
 */
type Rot = [axis: 'x' | 'y' | 'z', angle: number][];
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export type MixamoRig = { pose: (t: number, attack: number) => void };

export function mixamoRig(model: THREE.Object3D): MixamoRig | null {
  const bones = new Map<string, { bone: THREE.Bone; rest: THREE.Quaternion; world: THREE.Quaternion }>();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const key = o.name.replace(/^mixamorig[:_]?/, '');
    bones.set(key, { bone: o as THREE.Bone, rest: o.quaternion.clone(), world: o.getWorldQuaternion(new THREE.Quaternion()) });
  });
  if (!bones.has('Hips') || !bones.has('RightArm')) return null;
  const root = model.getWorldQuaternion(new THREE.Quaternion());
  const q = new THREE.Quaternion();
  const d = new THREE.Quaternion();
  const wInv = new THREE.Quaternion();

  const set = (name: string, rot: Rot) => {
    const b = bones.get(name);
    if (!b) return;
    // world-space rotation R (in the model's frame) -> local delta W^-1 R W
    d.identity();
    for (const [a, ang] of rot) d.multiply(q.setFromAxisAngle(AX[a], ang));
    d.premultiply(root.clone().invert()).multiply(root); // into model frame
    wInv.copy(b.world).invert();
    const local = wInv.clone().multiply(d).multiply(b.world);
    b.bone.quaternion.copy(b.rest).multiply(local);
  };

  return {
    // t: seconds; attack: 0 (idle) .. 1 (the swing's progress), -1 when not attacking
    pose(t, attack) {
      const br = Math.sin(t * 2.2);
      const sw = Math.sin(t * 1.1);
      let twist = 0;
      let lean = 0;
      let arm = 0;
      let fore = 0;
      if (attack >= 0) {
        // wind up (0-0.35) then slash across (0.35-0.7) then recover
        const k = attack;
        const wind = k < 0.35 ? k / 0.35 : k < 0.7 ? 1 - (k - 0.35) / 0.35 : 0;
        const cut = k < 0.35 ? 0 : k < 0.7 ? (k - 0.35) / 0.35 : 1 - (k - 0.7) / 0.3;
        twist = wind * 0.6 - cut * 0.7;
        lean = cut * 0.25;
        arm = wind * 1.6 - cut * 0.4;
        fore = wind * 0.6;
      }
      set('Hips', [['y', sw * 0.05 + twist * 0.3]]);
      set('Spine', [['x', br * 0.025 + lean * 0.5], ['y', twist * 0.35]]);
      set('Spine1', [['x', br * 0.02 + lean * 0.5], ['y', twist * 0.35]]);
      set('Spine2', [['x', br * 0.015]]);
      set('Neck', [['y', -twist * 0.3 + sw * 0.08]]);
      set('Head', [['y', Math.sin(t * 0.7) * 0.15 - twist * 0.2], ['x', Math.sin(t * 1.7) * 0.04]]);
      // arms: small sway at idle; the right arm raises (about the model's X) and cuts across on attack
      set('LeftArm', [['z', -br * 0.04], ['x', -sw * 0.05 + lean * 0.3]]);
      set('LeftForeArm', [['x', -0.05 - br * 0.03]]);
      set('RightArm', [['x', -arm], ['z', br * 0.04]]);
      set('RightForeArm', [['x', -0.05 - fore - br * 0.03]]);
      set('LeftUpLeg', [['x', -lean * 0.4]]);
      set('RightUpLeg', [['x', lean * 0.6]]);
      set('LeftLeg', [['x', lean * 0.4]]);
    },
  };
}
