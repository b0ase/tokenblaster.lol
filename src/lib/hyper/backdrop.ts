/**
 * Distant backdrops per track theme (content pack `theme.scenery`): megacity skyline bands, canyon mesas,
 * an orbital cloud sea with a ring megastructure; plus layered haze sheets and floating dust motes.
 * All far layers skip scene fog and tint themselves toward the horizon so they read as atmosphere.
 */
import * as THREE from 'three';
import { rng } from '@/lib/rally/noise';
import { cnv, texOf } from './artTex';
import type { Scenery } from '@/lib/content/schema';
import type { Track } from './track';

type Pal = Track['def']['palette'];
type Own = <T extends { dispose(): void }>(o: T) => T;
const col = (c: string, k = 1) => new THREE.Color(c).multiplyScalar(k);

/** Silhouette band texture: towers with lit windows, alpha outside the silhouettes. */
function skylineTex(seed: number, a1: string, a2: string, tall: number) {
  const W = 4096;
  const H = 512;
  const c = cnv(W, H);
  const g = c.getContext('2d')!;
  const R = rng(seed);
  g.clearRect(0, 0, W, H);
  let x = 0;
  while (x < W) {
    const w = 18 + R() * 70;
    const h = 40 + Math.pow(R(), 2.2) * (H - 60) * tall;
    g.fillStyle = '#ffffff';
    g.fillRect(x, H - h, w, h);
    // Spires and stepped crowns.
    if (R() < 0.25) g.fillRect(x + w * 0.4, H - h - 30 - R() * 60, Math.max(2, w * 0.12), 90);
    if (R() < 0.4) g.fillRect(x + w * 0.15, H - h - 14, w * 0.7, 14);
    x += w + R() * 6;
  }
  // Window lights in a second canvas multiplied by the silhouette alpha later (stored in RGB, alpha kept).
  const lit = cnv(W, H);
  const gl = lit.getContext('2d')!;
  gl.drawImage(c, 0, 0);
  gl.globalCompositeOperation = 'source-atop';
  gl.fillStyle = '#05060b';
  gl.fillRect(0, 0, W, H);
  for (let i = 0; i < 14000; i++) {
    const v = R();
    gl.fillStyle = v < 0.08 ? a1 : v < 0.14 ? a2 : `rgba(255,${200 + Math.floor(R() * 40)},${140 + Math.floor(R() * 60)},${0.4 + R() * 0.6})`;
    gl.fillRect(R() * W, H - R() * H, 2, 2);
  }
  // Aviation beacons on the tallest roofs.
  for (let i = 0; i < 60; i++) {
    gl.fillStyle = '#ff2a2a';
    gl.fillRect(R() * W, H - 380 * tall - R() * 100, 3, 3);
  }
  return texOf(lit, true);
}

function bandMaterial(map: THREE.Texture, tint: THREE.Color, haze: THREE.Color, hazeK: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uMap: { value: map }, uTint: { value: tint }, uHaze: { value: haze }, uK: { value: hazeK } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uTint; uniform vec3 uHaze; uniform float uK; varying vec2 vUv;
      void main(){
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.5) discard;
        // Lower parts sink into haze; windows stay visible through it.
        float h = mix(1.0, 0.25, smoothstep(0.0, 0.7, vUv.y));
        vec3 c = mix(t.rgb * uTint, uHaze, clamp(uK * h, 0.0, 1.0));
        c += t.rgb * uTint * 0.6;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Ring band around the circuit centre. */
function band(cx: number, cz: number, r: number, h: number, y0: number, mat: THREE.Material, rep: number) {
  const g = new THREE.CylinderGeometry(r, r, h, 160, 1, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
  const m = new THREE.Mesh(g, mat);
  m.position.set(cx, y0 + h / 2, cz);
  // Seen from inside.
  (mat as THREE.ShaderMaterial).side = THREE.BackSide;
  m.renderOrder = -5;
  m.frustumCulled = false;
  return m;
}

/** Ring of noise-height ridges/mesas (vertex coloured silhouettes). */
function ridgeRing(cx: number, cz: number, r: number, hMax: number, seed: number, near: THREE.Color, far: THREE.Color, mesa: boolean) {
  const segs = 360;
  const rowsN = 6;
  const R = rng(seed);
  const amp: number[] = [];
  const ph: number[] = [];
  for (let k = 0; k < 7; k++) {
    amp.push(R());
    ph.push(R() * 6.283);
  }
  const ht = (a: number) => {
    let v = 0;
    for (let k = 0; k < 7; k++) v += (amp[k] / (k + 1)) * Math.sin(a * (k * 3 + 2) + ph[k]);
    v = 0.5 + v * 0.5;
    if (mesa) v = Math.min(1, Math.round(v * 3.2) / 3.2 + 0.08) * 0.9;
    return Math.max(0.08, v) * hMax;
  };
  const pos: number[] = [];
  const colr: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const top = ht(a);
    for (let j = 0; j <= rowsN; j++) {
      const t = j / rowsN;
      const rr = r + (mesa ? 0 : (1 - t) * 60);
      pos.push(cx + Math.cos(a) * rr, -40 + top * t + 40 * t, cz + Math.sin(a) * rr);
      const c = far.clone().lerp(near, t * 0.7);
      if (mesa && t === 1) c.lerp(new THREE.Color(1, 0.6, 0.4), 0.18);
      colr.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rowsN; j++) {
    const a = i * (rowsN + 1) + j;
    const b = a + rowsN + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = -5;
  m.frustumCulled = false;
  return m;
}

export type Backdrop = { group: THREE.Group; update(time: number, cam: THREE.Vector3): void; hideCity: boolean; groundTint: THREE.Color; showGround: boolean };

export function buildBackdrop(tr: Track, scenery: Scenery, hi: boolean, own: Own): Backdrop {
  const p: Pal = tr.def.palette;
  const group = new THREE.Group();
  const bd = tr.bounds;
  const cx = (bd.minX + bd.maxX) / 2;
  const cz = (bd.minZ + bd.maxZ) / 2;
  const span = Math.max(bd.maxX - bd.minX, bd.maxZ - bd.minZ) / 2;
  const haze = col(p.horizon).lerp(col(p.fog), 0.45);
  const updates: ((t: number, c: THREE.Vector3) => void)[] = [];
  let hideCity = false;
  let showGround = true;
  const groundTint = col(p.glow, 0.6);

  if (scenery === 'megacity') {
    const t1 = own(skylineTex(tr.def.seed + 3, p.a1, p.a2, 1));
    const m1 = own(bandMaterial(t1, new THREE.Color(1.2, 1.2, 1.3), haze, 0.72));
    const b1 = band(cx, cz, span + 1500, 520, -20, m1, 3);
    own(b1.geometry);
    group.add(b1);
    if (hi) {
      const t2 = own(skylineTex(tr.def.seed + 9, p.a1, p.a2, 0.7));
      const m2 = own(bandMaterial(t2, new THREE.Color(0.9, 0.9, 1), haze, 0.88));
      const b2 = band(cx, cz, span + 2100, 420, -20, m2, 4);
      own(b2.geometry);
      group.add(b2);
    }
  } else if (scenery === 'canyon') {
    const near = col(p.fog, 1.4).lerp(new THREE.Color('#3a1a14'), 0.5);
    const r1 = ridgeRing(cx, cz, span + 1300, 420, tr.def.seed, near, haze, true);
    own(r1.geometry);
    own(r1.material as THREE.Material);
    group.add(r1);
    const r2 = ridgeRing(cx, cz, span + 2000, 620, tr.def.seed + 5, haze.clone().multiplyScalar(0.9), col(p.horizon, 0.8), false);
    own(r2.geometry);
    own(r2.material as THREE.Material);
    group.add(r2);
    groundTint.copy(col('#ff7a3a', 0.35));
  } else {
    // Orbital: no city, a churning cloud sea far below and a ring megastructure arcing across the sky.
    hideCity = true;
    showGround = false;
    const seaMat = own(
      new THREE.ShaderMaterial({
        fog: false,
        transparent: false,
        uniforms: { uT: { value: 0 }, uA: { value: col(p.fog, 1.5) }, uB: { value: col(p.horizon, 0.8) }, uG: { value: col(p.glow, 0.5) } },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `
          uniform float uT; uniform vec3 uA; uniform vec3 uB; uniform vec3 uG; varying vec3 vW;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
          float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.1; a*=0.5; } return s; }
          void main(){
            vec2 p = vW.xz * 0.0016 + vec2(uT * 0.01, uT * 0.004);
            float c = fbm(p + fbm(p * 1.7));
            float puff = smoothstep(0.38, 0.75, c);
            vec3 col = mix(uA * 0.5, uB * 1.2, puff);
            col += uG * pow(puff, 3.0) * 0.8;
            // Billows: darker crevices between puffs.
            col *= 0.55 + 0.45 * smoothstep(0.3, 0.6, fbm(p * 3.0 + c));
            float dist = length(vW.xz - cameraPosition.xz);
            col = mix(col, uB, smoothstep(1500.0, 4200.0, dist) * 0.8);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    const sea = new THREE.Mesh(own(new THREE.PlaneGeometry(9000, 9000, 1, 1)), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(cx, Math.min(0, bd.minY - 90), cz);
    sea.frustumCulled = false;
    group.add(sea);
    updates.push((t, c) => {
      seaMat.uniforms.uT.value = t;
      sea.position.x = c.x;
      sea.position.z = c.z;
    });
    // Ring megastructure: segmented torus with lit panels, tilted across the sky.
    const ring = new THREE.Mesh(own(new THREE.TorusGeometry(2600, 70, 10, 160)), own(new THREE.MeshBasicMaterial({ color: col(p.fog, 2.2), fog: false })));
    ring.rotation.set(1.15, 0.3, 0.2);
    ring.position.set(cx + 400, 900, cz - 2400);
    ring.frustumCulled = false;
    ring.renderOrder = -6;
    group.add(ring);
    const lights = new THREE.Mesh(own(new THREE.TorusGeometry(2600, 72, 4, 320)), own(new THREE.MeshBasicMaterial({ color: col(p.a1, 2.4), wireframe: true, fog: false, transparent: true, opacity: 0.35 })));
    lights.rotation.copy(ring.rotation);
    lights.position.copy(ring.position);
    lights.frustumCulled = false;
    group.add(lights);
  }

  // Haze sheets: soft noise layers that sit between the city and the track (HIGH only).
  if (hi) {
    const hzMat = own(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uT: { value: 0 }, uC: { value: haze.clone().multiplyScalar(0.9) }, uCam: { value: new THREE.Vector3() } },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `
          uniform float uT; uniform vec3 uC; uniform vec3 uCam; varying vec3 vW;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
          void main(){
            vec2 p = vW.xz * 0.004 + vec2(uT * 0.02, 0.0);
            float c = n(p) * 0.6 + n(p * 2.3) * 0.4;
            float d = length(vW.xz - uCam.xz);
            float a = smoothstep(0.35, 0.8, c) * 0.22 * smoothstep(60.0, 400.0, d);
            gl_FragColor = vec4(uC, a);
          }`,
      }),
    );
    const levels = scenery === 'orbital' ? [bd.minY - 40, bd.minY + 30] : [25, 70];
    for (const y of levels) {
      const sh = new THREE.Mesh(own(new THREE.PlaneGeometry(span * 2 + 2400, span * 2 + 2400)), hzMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.set(cx, y, cz);
      sh.renderOrder = 2;
      group.add(sh);
    }
    updates.push((t, c) => {
      hzMat.uniforms.uT.value = t;
      hzMat.uniforms.uCam.value.copy(c);
    });
    // Dust motes drifting around the camera.
    const N = 700;
    const pos = new Float32Array(N * 3);
    const R = rng(77);
    for (let i = 0; i < N * 3; i++) pos[i] = R() * 140;
    const dg = own(new THREE.BufferGeometry());
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dm = own(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        uniforms: { uCam: { value: new THREE.Vector3() }, uT: { value: 0 }, uC: { value: col(p.sun, 0.9) } },
        vertexShader: `
          uniform vec3 uCam; uniform float uT; varying float vA;
          void main(){
            vec3 p = position + vec3(uT * 1.5, sin(uT * 0.3 + position.x) * 2.0, uT * 0.7);
            p = mod(p - uCam + 70.0, 140.0) - 70.0 + uCam;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float d = -mv.z;
            vA = smoothstep(70.0, 20.0, d) * smoothstep(1.0, 6.0, d);
            gl_PointSize = 90.0 / max(d, 1.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: 'uniform vec3 uC; varying float vA; void main(){ vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(q)) * vA * 0.5; gl_FragColor = vec4(uC * a, 1.0); }',
      }),
    );
    const dust = new THREE.Points(dg, dm);
    dust.frustumCulled = false;
    group.add(dust);
    updates.push((t, c) => {
      dm.uniforms.uT.value = t;
      dm.uniforms.uCam.value.copy(c);
    });
  }

  return {
    group,
    hideCity,
    showGround,
    groundTint,
    update(t, c) {
      for (const u of updates) u(t, c);
    },
  };
}
