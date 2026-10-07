/** Block Hopper effects: additive particles, the scarf, dash streaks and the glitch wall that chases you. */
import * as THREE from 'three';

export class Particles {
  mesh: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private siz: Float32Array;
  private alp: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private base: Float32Array;
  private head = 0;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;

  constructor(n: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.siz = new Float32Array(n);
    this.alp = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.base = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vC=aColor; vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        varying vec3 vC; varying float vA;
        void main(){ float d=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.15,d)*vA; if(a<.01) discard; gl_FragColor=vec4(vC*a,a); }`,
    });
    this.mesh = new THREE.Points(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setScale(h: number, fov: number) {
    this.mat.uniforms.uScale.value = (h * 0.5) / Math.tan((fov * Math.PI) / 360);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, grav = 0, drag = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    const p = i * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.vel[p] = vx;
    this.vel[p + 1] = vy;
    this.vel[p + 2] = vz;
    this.col[p] = r;
    this.col[p + 1] = g;
    this.col[p + 2] = b;
    this.life[i] = life;
    this.max[i] = life;
    this.base[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  /** A burst of `count` sparks in all directions. */
  burst(x: number, y: number, z: number, count: number, speed: number, life: number, size: number, c: THREE.Color, grav = 9, up = 0) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s * 0.5, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), c.r, c.g, c.b, grav, 1.2);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      let l = this.life[i];
      if (l <= 0) {
        if (this.alp[i] !== 0) {
          this.alp[i] = 0;
          this.siz[i] = 0;
        }
        continue;
      }
      l -= dt;
      this.life[i] = l;
      const p = i * 3;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[p] *= k;
      this.vel[p + 1] = (this.vel[p + 1] - this.grav[i] * dt) * k;
      this.vel[p + 2] *= k;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      const u = Math.max(0, l / this.max[i]);
      this.alp[i] = Math.min(1, u * 2.2);
      this.siz[i] = this.base[i] * (0.4 + 0.6 * u);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** A flowing ribbon behind the neck. */
export class Scarf {
  mesh: THREE.Mesh;
  private n = 13;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private geo = new THREE.BufferGeometry();
  private arr: Float32Array;
  private mat: THREE.MeshBasicMaterial;
  private seg = 0.17;
  private t = 0;
  private ready = false;

  constructor(color: THREE.Color) {
    const n = this.n;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.arr = new Float32Array(n * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.arr, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.5), side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  /** `anchor` is the neck in world space; `vx`/`vy` the hero's velocity (the scarf trails it). */
  update(dt: number, anchor: THREE.Vector3, vx: number, vy: number, face: number) {
    const n = this.n;
    this.t += dt;
    if (!this.ready) {
      for (let i = 0; i < n; i++) {
        this.px[i] = anchor.x - face * i * this.seg;
        this.py[i] = anchor.y;
        this.pz[i] = anchor.z - 0.05;
      }
      this.ready = true;
    }
    this.px[0] = anchor.x;
    this.py[0] = anchor.y;
    this.pz[0] = anchor.z - 0.1;
    const speed = Math.hypot(vx, vy);
    for (let i = 1; i < n; i++) {
      // Drift opposite to motion, sag a little, flutter more toward the tip.
      this.px[i] += -vx * 0.012 * dt * 60 * 0.06 - face * 0.5 * dt * Math.min(1, speed / 6);
      this.py[i] += -vy * 0.004 - 2.2 * dt * (1 - Math.min(1, speed / 9) * 0.8) + Math.sin(this.t * 14 + i * 0.9) * 0.012 * (i / n) * Math.min(1, speed / 4);
      const dx = this.px[i] - this.px[i - 1];
      const dy = this.py[i] - this.py[i - 1];
      const d = Math.hypot(dx, dy) || 1e-4;
      this.px[i] = this.px[i - 1] + (dx / d) * this.seg;
      this.py[i] = this.py[i - 1] + (dy / d) * this.seg;
      this.pz[i] += (this.pz[0] - this.pz[i]) * 0.3;
    }
    for (let i = 0; i < n; i++) {
      const w = 0.17 * (1 - (i / n) * 0.75);
      const o = i * 6;
      this.arr[o] = this.px[i];
      this.arr[o + 1] = this.py[i] + w;
      this.arr[o + 2] = this.pz[i];
      this.arr[o + 3] = this.px[i];
      this.arr[o + 4] = this.py[i] - w;
      this.arr[o + 5] = this.pz[i];
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  reset() {
    this.ready = false;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Fading additive slabs left behind a dash. */
export class Streaks {
  group = new THREE.Group();
  private items: { m: THREE.Mesh; life: number; max: number }[] = [];
  private geo = new THREE.PlaneGeometry(1, 1);
  private head = 0;

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, life: 0, max: 1 });
    }
  }

  add(x: number, y: number, w: number, h: number, color: THREE.Color, life = 0.28) {
    const it = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;
    it.m.position.set(x, y, 0.2);
    it.m.scale.set(w, h, 1);
    (it.m.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(2);
    it.life = it.max = life;
    it.m.visible = true;
  }

  update(dt: number) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      const u = Math.max(0, it.life / it.max);
      (it.m.material as THREE.MeshBasicMaterial).opacity = u * 0.55;
      if (it.life <= 0) it.m.visible = false;
    }
  }

  dispose() {
    this.geo.dispose();
    for (const it of this.items) (it.m.material as THREE.Material).dispose();
  }
}

/** The REORG: a wall of red static that advances along the chain. Everything behind its edge is lost. */
export function makeWall() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uEdge: { value: 0 }, uTime: { value: 0 }, uPower: { value: 1 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uEdge; uniform float uTime; uniform float uPower; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        float row = floor(vW.y*3.0);
        float jit = (h(vec2(row, floor(uTime*12.0)))-0.5)*1.4;
        float d = uEdge + jit - vW.x;           // distance behind the edge
        if (d < 0.0) discard;
        float body = exp(-d*0.09)*0.55;
        float edge = exp(-d*4.5)*1.8;
        float cell = h(floor(vec2(vW.x*1.7, vW.y*3.0)) + floor(uTime*9.0));
        float blocks = step(0.78, cell) * exp(-d*0.12);
        float scan = 0.65 + 0.35*sin(vW.y*22.0 - uTime*30.0);
        vec3 c = vec3(1.0,0.12,0.06)*(body*scan + blocks*0.9) + vec3(1.0,0.75,0.45)*edge;
        float a = (body + edge + blocks) * uPower;
        gl_FragColor = vec4(c*uPower, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 120), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return { mesh, mat };
}
