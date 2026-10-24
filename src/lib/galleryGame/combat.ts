/**
 * Enemy projectiles and the player's hurt events.
 *
 * Erobot palm-bolts and the boss's liquid shards are real projectiles from a fixed pool (an InstancedMesh pair, no
 * allocation per frame). Each one flies at the player; the ones that were aimed true damage on arrival, the
 * ones aimed wide whip past, and the player's own rounds can shoot a bolt down (a small target, so it takes aim).
 */
import * as THREE from 'three';
import { TUNING } from './tuning';

/** What hurt the player. `angle` is where it came from, in radians relative to the view: 0 ahead, + to the right, +-PI behind. */
export type HurtKind = 'bolt' | 'shard' | 'melee' | 'swipe' | 'lunge' | 'slam';
export type HurtEvent = { angle: number; dmg: number; kind: HurtKind };

const N = 40;

type Bolt = { on: boolean; pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; from: THREE.Vector3; life: number; dmg: number; hits: boolean; kind: 'bolt' | 'shard'; color: THREE.Color };

export class Bolts {
  private bolts: Bolt[] = [];
  private core: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    const coreG = new THREE.CapsuleGeometry(0.07, 0.8, 3, 8);
    const glowG = new THREE.SphereGeometry(0.34, 10, 8);
    this.geos.push(coreG, glowG);
    const coreM = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false });
    const glowM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.mats.push(coreM, glowM);
    this.core = new THREE.InstancedMesh(coreG, coreM, N);
    this.glow = new THREE.InstancedMesh(glowG, glowM, N);
    for (const im of [this.core, this.glow]) {
      im.frustumCulled = false;
      im.userData.noAO = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
      scene.add(im);
    }
    for (let i = 0; i < N; i++) {
      this.bolts.push({ on: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), from: new THREE.Vector3(), life: 0, dmg: 0, hits: false, kind: 'bolt', color: new THREE.Color() });
      this.hide(i);
    }
  }

  get live() {
    let n = 0;
    for (const b of this.bolts) if (b.on) n++;
    return n;
  }

  private hide(i: number) {
    this.m.makeScale(0, 0, 0);
    this.core.setMatrixAt(i, this.m);
    this.glow.setMatrixAt(i, this.m);
  }

  /** Launch one. `hits` false = aimed wide of the player (it whips past). */
  fire(from: THREE.Vector3, target: THREE.Vector3, speed: number, dmg: number, color: string, hits: boolean, kind: 'bolt' | 'shard' = 'bolt') {
    let slot = this.bolts.find((b) => !b.on);
    if (!slot) slot = this.bolts[0];
    slot.on = true;
    slot.pos.copy(from);
    slot.prev.copy(from);
    slot.from.copy(from);
    slot.vel.subVectors(target, from).normalize().multiplyScalar(speed);
    slot.life = 4;
    slot.dmg = dmg;
    slot.hits = hits;
    slot.kind = kind;
    slot.color.set(color);
  }

  /**
   * Advance every bolt. `onHit(from, dmg, kind)` runs for a bolt that reaches the player (a sphere around the camera);
   * the bolt is spent.
   */
  update(dt: number, player: THREE.Vector3, onHit: (from: THREE.Vector3, dmg: number, kind: 'bolt' | 'shard') => void) {
    const hr = TUNING.erobots.bolt.hitRadius;
    let dirty = false;
    for (let i = 0; i < N; i++) {
      const b = this.bolts[i];
      if (!b.on) continue;
      dirty = true;
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let gone = b.life <= 0 || b.pos.z > 3;
      if (b.hits && !gone) {
        // closest point of this step's segment to the player
        this.a.subVectors(b.pos, b.prev);
        const len2 = Math.max(1e-6, this.a.lengthSq());
        const t = THREE.MathUtils.clamp(this.b.subVectors(player, b.prev).dot(this.a) / len2, 0, 1);
        this.b.copy(b.prev).addScaledVector(this.a, t);
        if (this.b.distanceToSquared(player) < hr * hr) {
          onHit(b.from, b.dmg, b.kind);
          gone = true;
        }
      }
      if (gone) {
        b.on = false;
        this.hide(i);
        continue;
      }
      this.q.setFromUnitVectors(this.up, this.a.copy(b.vel).normalize());
      const pulse = 1 + Math.sin((b.life + i) * 40) * 0.12;
      this.m.compose(b.pos, this.q, this.s.set(1, 1, 1));
      this.core.setMatrixAt(i, this.m);
      this.m.compose(b.pos, this.q, this.s.set(pulse, pulse * 1.4, pulse));
      this.glow.setMatrixAt(i, this.m);
      this.core.setColorAt(i, this.c.copy(b.color).multiplyScalar(4));
      this.glow.setColorAt(i, this.c.copy(b.color).multiplyScalar(2.2));
    }
    if (dirty) {
      this.core.instanceMatrix.needsUpdate = this.glow.instanceMatrix.needsUpdate = true;
      if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
      if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
    }
  }

  /** Does this ray strike a bolt before `maxDist`? The nearest one is destroyed and its point returned. */
  shoot(org: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { point: THREE.Vector3; dist: number } | null {
    let best = -1;
    let bd = maxDist;
    for (let i = 0; i < N; i++) {
      const b = this.bolts[i];
      if (!b.on) continue;
      this.a.subVectors(b.pos, org);
      const tc = this.a.dot(dir);
      if (tc < 0.5 || tc > bd) continue;
      const r = TUNING.erobots.bolt.shootRadius + tc * 0.012;
      if (this.a.lengthSq() - tc * tc > r * r) continue;
      bd = tc;
      best = i;
    }
    if (best < 0) return null;
    const b = this.bolts[best];
    b.on = false;
    this.hide(best);
    this.core.instanceMatrix.needsUpdate = this.glow.instanceMatrix.needsUpdate = true;
    return { point: b.pos.clone(), dist: bd };
  }

  clear() {
    for (let i = 0; i < N; i++) {
      this.bolts[i].on = false;
      this.hide(i);
    }
    this.core.instanceMatrix.needsUpdate = this.glow.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.core, this.glow);
    this.core.dispose();
    this.glow.dispose();
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
  }
}
