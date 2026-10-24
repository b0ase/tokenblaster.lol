/**
 * The LIQUID UNIT: OMNICORE's chrome robot. A featureless humanoid in mirror-polished liquid metal
 * (MeshPhysical, metal 1, clearcoat, the city IBL in it) with a vertex shader that keeps the surface
 * moving: slow mercury wobble everywhere, a crater plus a spreading ripple ring at every hit that heals
 * over in about a second. Only sustained fire takes it down: let up and it regenerates. At zero it
 * melts into a puddle, then pulls itself back up, 1.5x tougher, further down the street. Original design.
 */
import * as THREE from 'three';

const HITS = 12;

export class LiquidUnit {
  group = new THREE.Group();
  /** Meshes the ray can hit. */
  parts: THREE.Mesh[] = [];
  hp: number;
  max: number;
  wave = 1;
  melt = 0; // 0 standing; 0..1 melting; 1..2 reforming
  private lastHit = -10;
  private t = 0;
  private step = 0;
  private z = -30;
  private x = 0;
  private uniforms = { uTime: { value: 0 }, uHits: { value: Array.from({ length: HITS }, () => new THREE.Vector4(0, -100, 0, -100)) }, uAgitate: { value: 0 } };
  private hitCursor = 0;
  private mat: THREE.MeshPhysicalMaterial;
  private puddle: THREE.Mesh;
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private body = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];

  constructor(
    private base: number,
    high: boolean,
  ) {
    this.hp = this.max = base;
    const mat = new THREE.MeshPhysicalMaterial({ color: '#dfe7f1', metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.4 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime; uniform float uAgitate; uniform vec4 uHits[${HITS}];
          float lq(vec3 p){ return sin(p.x*7.0+uTime*2.1)*sin(p.y*5.0-uTime*1.7)*sin(p.z*6.0+uTime*1.3); }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          float disp = lq(wp) * (0.012 + 0.05 * uAgitate);
          for (int i = 0; i < ${HITS}; i++) {
            vec4 h = uHits[i];
            float age = uTime - h.w;
            if (age < 0.0 || age > 1.6) continue;
            float d = distance(wp, h.xyz);
            disp -= 0.16 * exp(-d * d * 60.0) * exp(-age * 3.2);           // the crater
            disp += 0.045 * sin(d * 34.0 - age * 26.0) * exp(-age * 2.6) * exp(-d * 3.5); // the ripple
          }
          transformed += normal * disp;`,
        );
    };
    this.mat = mat;
    const seg = high ? 1 : 0.6;
    const mk = (geo: THREE.BufferGeometry, parent: THREE.Object3D, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      this.parts.push(m);
      return m;
    };
    const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, Math.round(10 * seg), Math.round(28 * seg));
    // torso + pelvis + neck + head (smooth, faceless)
    mk(cap(0.3, 0.52), this.body, 0, 1.42, 0, 1.15, 1, 0.72);
    mk(cap(0.22, 0.12), this.body, 0, 0.98, 0, 1.2, 1, 0.8);
    mk(cap(0.07, 0.1), this.body, 0, 1.9, 0);
    mk(new THREE.SphereGeometry(0.15, Math.round(40 * seg), Math.round(28 * seg)), this.body, 0, 2.08, 0.01, 0.92, 1.18, 1.0);
    // shoulders
    mk(new THREE.SphereGeometry(0.13, 24, 16), this.body, -0.38, 1.74, 0);
    mk(new THREE.SphereGeometry(0.13, 24, 16), this.body, 0.38, 1.74, 0);
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.15, 0.92, 0);
      mk(cap(0.1, 0.36), hip, 0, -0.24, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      hip.add(knee);
      mk(cap(0.085, 0.36), knee, 0, -0.22, 0);
      mk(new THREE.BoxGeometry(0.15, 0.07, 0.3), knee, 0, -0.46, 0.06);
      this.body.add(hip);
      this.legs.push(hip);
      const sh = new THREE.Group();
      sh.position.set(side * 0.42, 1.72, 0);
      mk(cap(0.075, 0.3), sh, 0, -0.2, 0);
      const el = new THREE.Group();
      el.position.y = -0.4;
      sh.add(el);
      if (side > 0) {
        // the right forearm is a long blade
        mk(new THREE.ConeGeometry(0.07, 0.95, 16), el, 0, -0.45, 0.04, 1, 1, 0.35);
      } else {
        mk(cap(0.065, 0.28), el, 0, -0.18, 0);
        mk(new THREE.SphereGeometry(0.075, 16, 12), el, 0, -0.4, 0);
      }
      this.body.add(sh);
      this.arms.push(sh);
    }
    this.body.scale.setScalar(2.6);
    this.group.add(this.body);
    const pgeo = new THREE.CircleGeometry(1, 64);
    this.geos.push(pgeo);
    this.puddle = new THREE.Mesh(pgeo, mat);
    this.puddle.rotation.x = -Math.PI / 2;
    this.puddle.position.y = 0.03;
    this.puddle.visible = false;
    this.group.add(this.puddle);
    this.group.position.set(this.x, 0, this.z);
  }

  get alive() {
    return this.melt === 0;
  }

  /** Damage from accepted transactions. Returns true if this took it down. */
  hit(n: number, at: THREE.Vector3) {
    if (!this.alive) return false;
    this.hp -= n;
    this.lastHit = this.t;
    const v = this.uniforms.uHits.value[this.hitCursor++ % HITS];
    v.set(at.x, at.y, at.z, this.t);
    if (this.hp <= 0) {
      this.hp = 0;
      this.melt = 0.0001;
      return true;
    }
    return false;
  }

  setBase(n: number) {
    this.base = n;
    this.max = n * Math.pow(1.5, this.wave - 1);
    this.hp = Math.min(this.hp, this.max);
    if (this.alive) this.hp = this.max;
  }

  /** Where to aim for the chest, in world space. */
  chest(out: THREE.Vector3) {
    return out.set(this.group.position.x, 3.6, this.group.position.z);
  }

  update(dt: number) {
    this.t += dt;
    this.uniforms.uTime.value = this.t;
    const recent = this.t - this.lastHit < 0.25;
    this.uniforms.uAgitate.value += ((recent ? 1 : 0) - this.uniforms.uAgitate.value) * Math.min(1, dt * 6);
    if (this.melt > 0) {
      this.melt += dt * 0.45;
      const k = Math.min(1, this.melt);
      const back = Math.max(0, this.melt - 1.15) / 0.85;
      this.body.visible = this.melt < 1 || back > 0.05;
      const sy = this.melt < 1 ? 1 - k * 0.97 : 0.03 + back * 0.97;
      const sxz = this.melt < 1 ? 1 + k * 1.2 : 2.2 - back * 1.2;
      this.body.scale.set(2.6 * sxz, 2.6 * sy, 2.6 * sxz);
      this.puddle.visible = true;
      const pr = this.melt < 1 ? 0.4 + k * 2.4 : 2.8 * (1 - back) + 0.2;
      this.puddle.scale.setScalar(pr);
      this.uniforms.uAgitate.value = 1;
      if (this.melt >= 1 && this.melt - dt * 0.45 < 1) {
        // re-form further down the street, tougher
        this.wave++;
        this.max = this.base * Math.pow(1.5, this.wave - 1);
        this.hp = this.max;
        this.z = -32 - Math.random() * 6;
        this.x = (Math.random() - 0.5) * 16;
        this.group.position.set(this.x, 0, this.z);
      }
      if (this.melt >= 2) {
        this.melt = 0;
        this.body.scale.setScalar(2.6);
        this.body.visible = true;
        this.puddle.visible = false;
      }
      return;
    }
    // Relentless walk toward the player; it stops 16 m out and paces.
    const speed = 1.6;
    if (this.z < -16) {
      this.z += speed * dt;
      this.step += dt * 4.2;
    } else this.step += dt * 2;
    this.x += Math.sin(this.t * 0.4) * dt * 1.2;
    this.x = THREE.MathUtils.clamp(this.x, -12, 12);
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = Math.atan2(-this.x, -this.z) * 0.6;
    const sw = Math.sin(this.step);
    this.legs[0].rotation.x = sw * 0.55;
    this.legs[1].rotation.x = -sw * 0.55;
    this.arms[0].rotation.x = -sw * 0.4;
    this.arms[1].rotation.x = sw * 0.3 - 0.2;
    this.body.position.y = Math.abs(Math.cos(this.step)) * 0.06;
    // regenerate when the fire stops
    if (this.t - this.lastHit > 0.45) this.hp = Math.min(this.max, this.hp + this.max * 0.07 * dt);
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mat.dispose();
  }
}
