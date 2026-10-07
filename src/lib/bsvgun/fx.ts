/**
 * Range effects, all pooled: shattering shards (instanced), additive sparks (points), tracer beams,
 * expanding shock rings. Nothing allocates per frame.
 */
import * as THREE from 'three';
import { glowTexture } from './targets';

const tmpC = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpD = new THREE.Vector3();

export class Fx {
  private shards: THREE.InstancedMesh;
  private sp: Float32Array; // pos xyz
  private sv: Float32Array; // vel xyz
  private sr: Float32Array; // rot xyz
  private sw: Float32Array; // spin xyz
  private sl: Float32Array; // life remaining
  private sm: Float32Array; // max life
  private sz: Float32Array; // size
  private sg: Float32Array; // gravity
  private nS: number;
  private cursorS = 0;

  private points: THREE.Points;
  private pp: Float32Array;
  private pv: Float32Array;
  private pc: Float32Array; // base colour rgb
  private pl: Float32Array;
  private pm: Float32Array;
  private nP: number;
  private cursorP = 0;

  private tracers: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; w: number }[] = [];
  private tCursor = 0;
  private rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; r: number }[] = [];
  private rCursor = 0;
  private group = new THREE.Group();

  constructor(
    private scene: THREE.Scene,
    high: boolean,
  ) {
    this.nS = high ? 700 : 220;
    this.nP = high ? 900 : 260;
    const geo = new THREE.TetrahedronGeometry(0.16);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.25 });
    this.shards = new THREE.InstancedMesh(geo, mat, this.nS);
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sp = new Float32Array(this.nS * 3);
    this.sv = new Float32Array(this.nS * 3);
    this.sr = new Float32Array(this.nS * 3);
    this.sw = new Float32Array(this.nS * 3);
    this.sl = new Float32Array(this.nS);
    this.sm = new Float32Array(this.nS).fill(1);
    this.sz = new Float32Array(this.nS).fill(1);
    this.sg = new Float32Array(this.nS).fill(14);
    tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < this.nS; i++) {
      this.shards.setMatrixAt(i, tmpM);
      this.shards.setColorAt(i, tmpC.set('#ffffff'));
    }
    this.group.add(this.shards);

    const pg = new THREE.BufferGeometry();
    this.pp = new Float32Array(this.nP * 3).fill(0);
    for (let i = 0; i < this.nP; i++) this.pp[i * 3 + 1] = -999;
    this.pv = new Float32Array(this.nP * 3);
    this.pc = new Float32Array(this.nP * 3);
    this.pl = new Float32Array(this.nP);
    this.pm = new Float32Array(this.nP).fill(1);
    const col = new Float32Array(this.nP * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pp, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.points = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ size: 0.55, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, toneMapped: false }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);

    const tn = high ? 24 : 12;
    const tg = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    for (let i = 0; i < tn; i++) {
      const m = new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(tg, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, mat: m, life: 0, max: 1, w: 0.05 });
    }
    const rg = new THREE.RingGeometry(0.86, 1, 40);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(rg, m);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat: m, life: 0, max: 1, r: 1 });
    }
    scene.add(this.group);
  }

  /** Shatter: `n` shards of `color` flying out of `at`. */
  shatter(at: THREE.Vector3, color: string, n: number, speed = 9, size = 1, flat = false) {
    const c = tmpC.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.cursorS++ % this.nS;
      const j = i * 3;
      this.sp[j] = at.x + (Math.random() - 0.5) * 0.4;
      this.sp[j + 1] = at.y + (Math.random() - 0.5) * 0.4;
      this.sp[j + 2] = at.z + (Math.random() - 0.5) * 0.4;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.35 + Math.random() * 0.85);
      this.sv[j] = Math.sin(ph) * Math.cos(th) * sp;
      this.sv[j + 1] = Math.cos(ph) * sp * 0.8 + 2.5;
      this.sv[j + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.sr[j] = this.sr[j + 1] = this.sr[j + 2] = Math.random() * 6;
      this.sw[j] = (Math.random() - 0.5) * 18;
      this.sw[j + 1] = (Math.random() - 0.5) * 18;
      this.sw[j + 2] = (Math.random() - 0.5) * 18;
      this.sm[i] = this.sl[i] = 0.9 + Math.random() * 0.9;
      this.sz[i] = size * (0.6 + Math.random() * 0.9) * (flat ? 0.7 : 1);
      this.sg[i] = flat ? 3.2 : 14; // feathers flutter down, shards fall
      if (flat) {
        this.sv[j] *= 0.5;
        this.sv[j + 2] *= 0.5;
      }
      this.shards.setColorAt(i, tmpC.copy(c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.18));
    }
    if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
  }

  /** Additive sparks. */
  sparks(at: THREE.Vector3, color: string, n: number, speed = 8) {
    const c = tmpC.set(color);
    const col = (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    for (let k = 0; k < n; k++) {
      const i = this.cursorP++ % this.nP;
      const j = i * 3;
      this.pp[j] = at.x;
      this.pp[j + 1] = at.y;
      this.pp[j + 2] = at.z;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.2 + Math.random());
      this.pv[j] = Math.sin(ph) * Math.cos(th) * sp;
      this.pv[j + 1] = Math.cos(ph) * sp;
      this.pv[j + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.pc[j] = c.r * 1.6;
      this.pc[j + 1] = c.g * 1.6;
      this.pc[j + 2] = c.b * 1.6;
      this.pm[i] = this.pl[i] = 0.25 + Math.random() * 0.5;
      col[j] = this.pc[j];
      col[j + 1] = this.pc[j + 1];
      col[j + 2] = this.pc[j + 2];
    }
  }

  /** A tracer beam from a to b that fades in `life` seconds. */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color: string, width = 0.05, life = 0.09) {
    const t = this.tracers[this.tCursor++ % this.tracers.length];
    tmpD.subVectors(b, a);
    const len = tmpD.length();
    if (len < 0.01) return;
    t.mesh.visible = true;
    t.mesh.position.copy(a).addScaledVector(tmpD, 0.5);
    t.mesh.quaternion.setFromUnitVectors(UP, tmpD.multiplyScalar(1 / len));
    t.mesh.scale.set(width, len, width);
    t.mat.color.set(color).multiplyScalar(2.2);
    t.mat.opacity = 1;
    t.life = t.max = life;
    t.w = width;
  }

  /** An expanding ring that faces the camera. */
  ring(at: THREE.Vector3, color: string, radius = 4, life = 0.45) {
    const r = this.rings[this.rCursor++ % this.rings.length];
    r.mesh.visible = true;
    r.mesh.position.copy(at);
    r.mat.color.set(color).multiplyScalar(1.8);
    r.life = r.max = life;
    r.r = radius;
  }

  update(dt: number, camera: THREE.Camera) {
    for (let i = 0; i < this.nS; i++) {
      if (this.sl[i] <= 0) continue;
      this.sl[i] -= dt;
      const j = i * 3;
      this.sv[j + 1] -= this.sg[i] * dt;
      this.sv[j] *= 1 - 0.4 * dt;
      this.sv[j + 2] *= 1 - 0.4 * dt;
      this.sp[j] += this.sv[j] * dt;
      this.sp[j + 1] += this.sv[j + 1] * dt;
      this.sp[j + 2] += this.sv[j + 2] * dt;
      if (this.sp[j + 1] < 0.05 && this.sv[j + 1] < 0) {
        this.sp[j + 1] = 0.05;
        this.sv[j + 1] *= -0.3;
        this.sv[j] *= 0.6;
        this.sv[j + 2] *= 0.6;
        this.sw[j] *= 0.5;
        this.sw[j + 1] *= 0.5;
        this.sw[j + 2] *= 0.5;
      }
      this.sr[j] += this.sw[j] * dt;
      this.sr[j + 1] += this.sw[j + 1] * dt;
      this.sr[j + 2] += this.sw[j + 2] * dt;
      const k = this.sl[i] > 0 ? Math.min(1, (this.sl[i] / this.sm[i]) * 3) * this.sz[i] : 0;
      tmpP.set(this.sp[j], this.sp[j + 1], this.sp[j + 2]);
      tmpQ.setFromEuler(tmpE.set(this.sr[j], this.sr[j + 1], this.sr[j + 2]));
      tmpS.set(k, k, k);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.shards.setMatrixAt(i, tmpM);
    }
    this.shards.instanceMatrix.needsUpdate = true;

    const col = (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < this.nP; i++) {
      if (this.pl[i] <= 0) {
        if (this.pp[i * 3 + 1] > -900) {
          this.pp[i * 3 + 1] = -999;
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        }
        continue;
      }
      this.pl[i] -= dt;
      const j = i * 3;
      this.pv[j + 1] -= 7 * dt;
      this.pp[j] += this.pv[j] * dt;
      this.pp[j + 1] += this.pv[j + 1] * dt;
      this.pp[j + 2] += this.pv[j + 2] * dt;
      const f = Math.max(0, this.pl[i] / this.pm[i]);
      col[j] = this.pc[j] * f;
      col[j + 1] = this.pc[j + 1] * f;
      col[j + 2] = this.pc[j + 2] * f;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.mesh.visible = false;
        continue;
      }
      const f = t.life / t.max;
      t.mat.opacity = f;
      t.mesh.scale.x = t.mesh.scale.z = t.w * (0.4 + f * 0.6);
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const f = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.3 + f * r.r);
      r.mat.opacity = (1 - f) * 0.9;
      r.mesh.quaternion.copy(camera.quaternion);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.shards.geometry.dispose();
    (this.shards.material as THREE.Material).dispose();
    this.shards.dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.tracers[0]?.mesh.geometry.dispose();
    for (const t of this.tracers) t.mat.dispose();
    this.rings[0]?.mesh.geometry.dispose();
    for (const r of this.rings) r.mat.dispose();
  }
}
