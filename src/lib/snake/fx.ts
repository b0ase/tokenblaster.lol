/** Token Snake effects: a pooled additive particle field, expanding shock rings and screen-space popups. */
import * as THREE from 'three';
import { particleMaterial } from './art';

export class Sparks {
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private head = 0;
  private geo = new THREE.BufferGeometry();
  constructor(private n: number) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.base = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.mat = particleMaterial();
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1e4;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, life: number, size = 0.3, grav = 0, drag = 0.6) {
    const i = this.head++ % this.n;
    const o = i * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.vel[o] = vx;
    this.vel[o + 1] = vy;
    this.vel[o + 2] = vz;
    this.base[o] = c.r;
    this.base[o + 1] = c.g;
    this.base[o + 2] = c.b;
    this.life[i] = life;
    this.max[i] = life;
    this.baseSize[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }
  /** A burst of `n` sparks flying out from a point. */
  burst(x: number, y: number, z: number, n: number, speed: number, c: THREE.Color, life = 0.8, size = 0.28, grav = 6, up = 0.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * 1.4;
      const s = speed * (0.35 + Math.random() * 0.75);
      this.emit(x, y, z, Math.cos(a) * s * Math.cos(e), Math.abs(Math.sin(e)) * s * (0.6 + up) + up * speed * 0.3, Math.sin(a) * s * Math.cos(e), c, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), grav);
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const o = i * 3;
      this.life[i] = l - dt;
      if (this.life[i] <= 0) {
        this.pos[o + 1] = -1e4;
        this.size[i] = 0;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[o] *= k;
      this.vel[o + 2] *= k;
      this.vel[o + 1] = this.vel[o + 1] * k - this.grav[i] * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < 0.04) {
        this.pos[o + 1] = 0.04;
        this.vel[o + 1] *= -0.35;
      }
      const f = this.life[i] / this.max[i];
      const j = i * 4;
      this.col[j] = this.base[o];
      this.col[j + 1] = this.base[o + 1];
      this.col[j + 2] = this.base[o + 2];
      this.col[j + 3] = Math.min(1, f * 1.6);
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * f);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Pooled flat shock rings (additive). */
export class Rings {
  readonly group = new THREE.Group();
  private items: { m: THREE.Mesh; t: number; dur: number; r0: number; r1: number; op: number }[] = [];
  private geo = new THREE.RingGeometry(0.88, 1, 56);
  private head = 0;
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, t: 1, dur: 1, r0: 0, r1: 1, op: 1 });
    }
  }
  fire(x: number, y: number, z: number, c: THREE.Color, r0: number, r1: number, dur = 0.7, op = 1) {
    const it = this.items[this.head++ % this.items.length];
    it.m.position.set(x, y, z);
    (it.m.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(2.2);
    it.t = 0;
    it.dur = dur;
    it.r0 = r0;
    it.r1 = r1;
    it.op = op;
    it.m.visible = true;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t += dt / it.dur;
      if (it.t >= 1) {
        it.m.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - it.t, 3);
      const r = it.r0 + (it.r1 - it.r0) * e;
      it.m.scale.set(r, r, 1);
      (it.m.material as THREE.MeshBasicMaterial).opacity = it.op * (1 - it.t) * (1 - it.t);
    }
  }
  dispose() {
    this.geo.dispose();
    for (const it of this.items) (it.m.material as THREE.Material).dispose();
  }
}

export type Popup = { x: number; y: number; z: number; t: number; dur: number; text: string; color: string; size: number; rise: number };

/** Popups are drawn on a transparent 2D canvas over the 3D view, projected from world space. */
export function drawPopups(ctx: CanvasRenderingContext2D, popups: Popup[], cam: THREE.PerspectiveCamera, w: number, h: number, dt: number, font: string, v: THREE.Vector3) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    if (p.t >= p.dur) {
      popups.splice(i, 1);
      continue;
    }
    const k = p.t / p.dur;
    v.set(p.x, p.y + p.rise * (1 - Math.pow(1 - k, 2)), p.z).project(cam);
    if (v.z > 1) continue;
    const sx = (v.x * 0.5 + 0.5) * w;
    const sy = (-v.y * 0.5 + 0.5) * h;
    const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.55 : k < 0.22 ? 1.15 - ((k - 0.12) / 0.1) * 0.15 : 1;
    const s = p.size * pop;
    ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    ctx.font = `900 italic ${s}px ${font}`;
    ctx.lineWidth = Math.max(3, s * 0.16);
    ctx.strokeStyle = 'rgba(5,5,10,0.9)';
    ctx.lineJoin = 'round';
    ctx.strokeText(p.text, sx, sy);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, sx, sy);
  }
  ctx.globalAlpha = 1;
}
