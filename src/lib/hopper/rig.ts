/**
 * The hero: the NPG chibi base (public/arena/models/npg/stack/chibi_base.glb, our own asset) driven by a
 * procedural pose. The model ships in a T-pose with no clips, so every frame we layer smoothed bone
 * rotations on the bind pose for idle, run, jump, fall, wall slide, dash and hurt. Rotations are given in
 * the character's own axes (x = her left, y = up, z = forward) and converted to each bone's frame once.
 * On x, a positive angle tips the head forward and swings a hanging limb backward.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const HERO_URL = '/arena/models/npg/stack/chibi_base.glb';

type Axis = 0 | 1 | 2;
type Slot = { bone: THREE.Bone; bind: THREE.Quaternion; axes: THREE.Vector3[]; cur: [number, number, number]; tgt: [number, number, number] };

const BONES = ['pelvis', 'stomach', 'lower_torso', 'upper_torso', 'neck', 'head', 'upper_arm.L', 'upper_arm.R', 'lower_arm.L', 'lower_arm.R', 'upper_leg.L', 'upper_leg.R', 'lower_leg.L', 'lower_leg.R', 'foot.L', 'foot.R'] as const;
type BoneName = (typeof BONES)[number];

export type PoseIn = {
  /** Horizontal speed 0..1 (of run speed; dash goes over 1). */
  speed: number;
  grounded: boolean;
  vy: number;
  wall: number; // -1/0/1 side of the wall being slid on
  dashing: boolean;
  hurt: boolean;
  face: number;
  /** Seconds, for idle breathing. */
  time: number;
};

const ARM_DOWN = 1.2;
const TAU = Math.PI * 2;

export class HeroRig {
  root = new THREE.Group(); // feet at the origin, yaw/lean set here
  squash = new THREE.Group(); // scale pivot at the feet
  model: THREE.Object3D | null = null;
  neck = new THREE.Object3D(); // follows the neck bone (scarf anchor)
  private slots = new Map<BoneName, Slot>();
  private phase = 0;
  private yaw = Math.PI / 2;
  private lean = 0;
  private tmp = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private neckBone: THREE.Bone | null = null;
  height = 1.56;

  constructor() {
    this.root.add(this.squash);
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gl = await loader.loadAsync(HERO_URL);
    const model = gl.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const s = this.height / Math.max(0.01, box.max.y - box.min.y);
    model.scale.multiplyScalar(s);
    model.position.y = -box.min.y * s;
    model.position.x = -((box.max.x + box.min.x) / 2) * s;
    model.position.z = -((box.max.z + box.min.z) / 2) * s;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (m && 'envMapIntensity' in m) m.envMapIntensity = 0.9;
      }
    });
    this.squash.add(model);
    this.model = model;
    model.updateMatrixWorld(true);
    const bones = new Map<string, THREE.Bone>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });
    const rootQ = model.getWorldQuaternion(new THREE.Quaternion()).invert();
    const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    for (const name of BONES) {
      const bone = bones.get(THREE.PropertyBinding.sanitizeNodeName(name)) ?? bones.get(name);
      if (!bone) continue;
      const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      const rel = rootQ.clone().multiply(parentQ).multiply(bone.quaternion).invert(); // character space → bone space
      this.slots.set(name, { bone, bind: bone.quaternion.clone(), axes: basis.map((a) => a.clone().applyQuaternion(rel)), cur: [0, 0, 0], tgt: [0, 0, 0] });
    }
    this.neckBone = bones.get('neck') ?? bones.get('head') ?? null;
  }

  private set(n: BoneName, x = 0, y = 0, z = 0) {
    const s = this.slots.get(n);
    if (s) {
      s.tgt[0] = x;
      s.tgt[1] = y;
      s.tgt[2] = z;
    }
  }

  /** World position of the neck (scarf anchor); valid after update(). */
  neckWorld(out: THREE.Vector3) {
    if (this.neckBone) return this.neckBone.getWorldPosition(out);
    return out.set(0, this.height * 0.8, 0).applyMatrix4(this.root.matrixWorld);
  }

  update(dt: number, p: PoseIn, squashY: number) {
    // Facing: yaw toward ±x, turned a touch toward the camera for a 3/4 view.
    const wantYaw = p.wall !== 0 ? (p.wall > 0 ? -1 : 1) * 1.1 : p.face > 0 ? 1.12 : -1.12;
    this.yaw += (wantYaw - this.yaw) * (1 - Math.exp(-16 * dt));
    this.root.rotation.y = this.yaw;
    const wantLean = p.dashing ? 0.5 : p.grounded ? Math.min(1, p.speed) * 0.1 : THREE.MathUtils.clamp(-p.vy * 0.012, -0.12, 0.1);
    this.lean += (wantLean - this.lean) * (1 - Math.exp(-12 * dt));
    this.squash.rotation.x = this.lean;
    this.squash.scale.set(1 / Math.sqrt(squashY), squashY, 1 / Math.sqrt(squashY));

    const sp = Math.min(1.4, p.speed);
    const w = Math.sin(this.phase * TAU);
    const w2 = Math.sin(this.phase * TAU + 1.2);
    const breathe = Math.sin(p.time * 2.2);
    for (const s of this.slots.values()) s.tgt[0] = s.tgt[1] = s.tgt[2] = 0;

    if (p.hurt) {
      this.set('upper_arm.L', -0.6, 0, -0.4);
      this.set('upper_arm.R', -0.6, 0, 0.4);
      this.set('upper_torso', -0.3);
      this.set('head', -0.3);
      this.set('upper_leg.L', -0.3);
      this.set('upper_leg.R', 0.3);
    } else if (p.dashing) {
      this.set('upper_torso', 0.5);
      this.set('stomach', 0.25);
      this.set('head', -0.35);
      this.set('upper_arm.L', 1.3, 0, -ARM_DOWN + 0.2);
      this.set('upper_arm.R', 1.3, 0, ARM_DOWN - 0.2);
      this.set('upper_leg.L', 0.9);
      this.set('lower_leg.L', 1.4);
      this.set('upper_leg.R', -0.7);
      this.set('lower_leg.R', 0.3);
    } else if (p.wall !== 0 && !p.grounded) {
      const side = p.wall; // wall on this side: the hand on that side reaches up to it
      this.set('upper_arm.L', -2.3 * (side < 0 ? 1 : 0.2), 0, side < 0 ? -0.2 : -ARM_DOWN + 0.4);
      this.set('upper_arm.R', -2.3 * (side > 0 ? 1 : 0.2), 0, side > 0 ? 0.2 : ARM_DOWN - 0.4);
      this.set('upper_leg.L', -0.5);
      this.set('lower_leg.L', 0.9);
      this.set('upper_leg.R', 0.1);
      this.set('lower_leg.R', 0.5);
      this.set('upper_torso', 0.1);
    } else if (!p.grounded) {
      if (p.vy > 0) {
        // Rising: knees tucked, arms thrown up.
        this.set('upper_arm.L', -1.9, 0, -0.45);
        this.set('upper_arm.R', -1.9, 0, 0.45);
        this.set('upper_leg.L', -1.0);
        this.set('lower_leg.L', 1.5);
        this.set('upper_leg.R', 0.35);
        this.set('lower_leg.R', 0.9);
        this.set('upper_torso', -0.05);
      } else {
        // Falling: legs reaching for the ground, arms out for balance.
        this.set('upper_arm.L', -0.5, 0, -0.55);
        this.set('upper_arm.R', -0.5, 0, 0.55);
        this.set('upper_leg.L', -0.65);
        this.set('lower_leg.L', 0.35);
        this.set('upper_leg.R', 0.45);
        this.set('lower_leg.R', 0.7);
        this.set('upper_torso', 0.12);
      }
    } else if (sp > 0.06) {
      // Run cycle: stride, knee lift, counter-swinging arms and a little torso twist.
      const amp = 0.35 + sp * 0.5;
      this.set('upper_leg.L', -w * amp);
      this.set('upper_leg.R', w * amp);
      this.set('lower_leg.L', Math.max(0, w2) * (0.5 + sp * 0.9));
      this.set('lower_leg.R', Math.max(0, -w2) * (0.5 + sp * 0.9));
      const sw = 0.3 + sp * 0.55;
      this.set('upper_arm.L', w * sw, 0, -ARM_DOWN);
      this.set('upper_arm.R', -w * sw, 0, ARM_DOWN);
      this.set('lower_arm.L', -0.4 - sp * 0.7);
      this.set('lower_arm.R', -0.4 - sp * 0.7);
      this.set('upper_torso', 0.04 + sp * 0.12, w * 0.12 * sp);
      this.set('head', -0.04 - sp * 0.08);
      this.set('pelvis', 0, -w * 0.1 * sp);
    } else {
      // Idle: breathing, loose arms, a small head sway.
      this.set('upper_arm.L', 0, 0, -ARM_DOWN);
      this.set('upper_arm.R', 0, 0, ARM_DOWN);
      this.set('upper_torso', breathe * 0.025);
      this.set('head', 0, Math.sin(p.time * 0.9) * 0.1);
    }

    // Cadence follows ground speed.
    if (p.grounded && !p.dashing) this.phase = (this.phase + dt * (1.4 + sp * 2.6)) % 1;
    const k = 1 - Math.exp(-(p.hurt || p.dashing ? 30 : 20) * dt);
    for (const s of this.slots.values()) {
      const q = s.bone.quaternion.copy(s.bind);
      for (let a = 0; a < 3; a++) {
        s.cur[a] += (s.tgt[a] - s.cur[a]) * k;
        if (Math.abs(s.cur[a]) > 1e-4) q.multiply(this.tmp.setFromAxisAngle(s.axes[a as Axis], s.cur[a]));
      }
    }
    void this.v;
  }

  dispose() {
    this.model?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        for (const x of Array.isArray(mat) ? mat : [mat]) {
          for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
          x.dispose();
        }
      }
    });
  }
}
