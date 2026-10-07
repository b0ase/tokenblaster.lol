/**
 * Bullet impacts for first-person shooters: a burst of hot sparks, a puff of dust and a fading
 * bullet hole stuck to the wall. Pooled and allocation-free per shot.
 */
import * as THREE from 'three';

const SPARKS = 260;
const HOLES = 28;
const PUFFS = 10;

function radialTex(draw: (c: CanvasRenderingContext2D, s: number) => void, size = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeImpacts(scene: THREE.Scene, enabledSparks = true) {
  // Sparks: one Points object, ring-buffer of particles.
  const pos = new Float32Array(SPARKS * 3).fill(-999);
  const vel = new Float32Array(SPARKS * 3);
  const life = new Float32Array(SPARKS);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparkTex = radialTex((c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,200,90,0.9)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: sparkTex, size: 0.14, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(3, 2.2, 1.2), toneMapped: false }));
  pts.frustumCulled = false;
  pts.renderOrder = 12;
  scene.add(pts);
  let head = 0;

  // Dust puffs.
  const puffTex = radialTex((c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(200,190,170,0.55)');
    g.addColorStop(1, 'rgba(200,190,170,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });
  const puffs = Array.from({ length: PUFFS }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    scene.add(s);
    return { s, born: -1, v: new THREE.Vector3() };
  });
  let puffHead = 0;

  // Bullet holes.
  const holeTex = radialTex((c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.3, 'rgba(10,8,6,0.8)');
    g.addColorStop(0.55, 'rgba(25,20,14,0.35)');
    g.addColorStop(1, 'rgba(25,20,14,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      c.beginPath();
      c.moveTo(s / 2, s / 2);
      c.lineTo(s / 2 + Math.cos(a) * s * 0.45, s / 2 + Math.sin(a) * s * 0.45);
      c.stroke();
    }
  });
  const holeGeo = new THREE.PlaneGeometry(0.28, 0.28);
  const holes = Array.from({ length: HOLES }, () => {
    const m = new THREE.Mesh(holeGeo, new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.visible = false;
    scene.add(m);
    return { m, born: -1 };
  });
  let holeHead = 0;

  const tmp = new THREE.Vector3();
  return {
    /** A coin or bolt strikes a surface at `point` whose outward normal is `normal`. `solid` leaves a hole. */
    hit(point: THREE.Vector3, normal: THREE.Vector3, solid: boolean, now: number) {
      const n = enabledSparks ? (solid ? 12 : 7) : 3;
      for (let i = 0; i < n; i++) {
        const k = head++ % SPARKS;
        pos[k * 3] = point.x;
        pos[k * 3 + 1] = point.y;
        pos[k * 3 + 2] = point.z;
        tmp.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(2.2).addScaledVector(normal, 1.5 + Math.random() * 2.5);
        vel[k * 3] = tmp.x;
        vel[k * 3 + 1] = tmp.y;
        vel[k * 3 + 2] = tmp.z;
        life[k] = 0.35 + Math.random() * 0.4;
      }
      if (solid) {
        const h = holes[holeHead++ % HOLES];
        h.m.visible = true;
        h.m.position.copy(point).addScaledVector(normal, 0.012);
        h.m.lookAt(tmp.copy(point).add(normal));
        h.m.rotateZ(Math.random() * 6.28);
        h.m.scale.setScalar(0.7 + Math.random() * 0.8);
        (h.m.material as THREE.MeshBasicMaterial).opacity = 1;
        h.born = now;
        const p = puffs[puffHead++ % PUFFS];
        p.s.visible = true;
        p.s.position.copy(point).addScaledVector(normal, 0.1);
        p.s.scale.setScalar(0.25);
        p.v.copy(normal).multiplyScalar(0.6).setY(0.35);
        p.born = now;
      }
    },
    update(dt: number, now: number) {
      let any = false;
      for (let k = 0; k < SPARKS; k++) {
        if (life[k] <= 0) continue;
        any = true;
        life[k] -= dt;
        if (life[k] <= 0) {
          pos[k * 3 + 1] = -999;
          continue;
        }
        vel[k * 3 + 1] -= 9 * dt;
        pos[k * 3] += vel[k * 3] * dt;
        pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
        pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        if (pos[k * 3 + 1] < 0.02) {
          pos[k * 3 + 1] = 0.02;
          vel[k * 3 + 1] *= -0.3;
        }
      }
      if (any) geo.attributes.position.needsUpdate = true;
      for (const p of puffs) {
        if (p.born < 0) continue;
        const t = (now - p.born) / 700;
        if (t >= 1) {
          p.s.visible = false;
          p.born = -1;
          continue;
        }
        p.s.position.addScaledVector(p.v, dt);
        p.s.scale.setScalar(0.25 + t * 0.9);
        p.s.material.opacity = (1 - t) * 0.8;
      }
      for (const h of holes) {
        if (h.born < 0) continue;
        const age = now - h.born;
        if (age > 22000) {
          h.m.visible = false;
          h.born = -1;
        } else if (age > 16000) (h.m.material as THREE.MeshBasicMaterial).opacity = 1 - (age - 16000) / 6000;
      }
    },
    clear() {
      life.fill(0);
      pos.fill(-999);
      geo.attributes.position.needsUpdate = true;
      for (const h of holes) {
        h.m.visible = false;
        h.born = -1;
      }
      for (const p of puffs) {
        p.s.visible = false;
        p.born = -1;
      }
    },
    dispose() {
      scene.remove(pts, ...holes.map((h) => h.m), ...puffs.map((p) => p.s));
      geo.dispose();
      pts.material.dispose();
      sparkTex.dispose();
      puffTex.dispose();
      holeTex.dispose();
      holeGeo.dispose();
      for (const h of holes) (h.m.material as THREE.Material).dispose();
      for (const p of puffs) p.s.material.dispose();
    },
  };
}
