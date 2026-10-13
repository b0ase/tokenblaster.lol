/**
 * NPG Racing cartoon hulls: fat rounded lathe body, stubby round wings, big round engine pods, open cockpit with a
 * pilot seat. Toon-shaded (3-step gradient) with an inverted-hull outline, and a visual-only squash/stretch + bounce.
 * Same Rig contract as ships.ts, so the engine's placement, flames, trails and shields work unchanged; the sim never
 * sees any of this, so scores and multiplayer stay fair.
 * Ship space: +Z forward, +X left, +Y up.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShipSpec } from './sim';
import type { Livery } from './teams';
import type { Rig, ToonState } from './ships';
import { seatPilot, type Pilot } from './npgPilots';

type ToonHull = { body: THREE.BufferGeometry; pods: THREE.BufferGeometry; dark: THREE.BufferGeometry; glow: THREE.BufferGeometry; flame: THREE.BufferGeometry; outline: THREE.BufferGeometry; len: number; span: number; engine: THREE.Vector3[]; seat: THREE.Vector3 };
const cache = new Map<string, ToonHull>();

const ni = (g: THREE.BufferGeometry) => {
  const x = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
  if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
  return x;
};

/** Inverted-hull outline: push every vertex out along its normal. */
function puff(g: THREE.BufferGeometry, d: number) {
  const o = g.clone();
  const p = o.attributes.position;
  const n = o.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
  return o;
}

export function toonHullFor(spec: ShipSpec): ToonHull {
  const hit = cache.get(spec.id);
  if (hit) return hit;
  // Chunkier than the sleek hulls: shorter, wider, rounder whatever the spec.
  const L = spec.length * 0.85;
  const W = Math.max(3.6, spec.span * 0.82);
  // Fat bean fuselage.
  const prof: THREE.Vector2[] = [];
  const R = 1.05;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const r = R * Math.pow(Math.sin(Math.PI * t), 0.55) * (1 - 0.18 * t) + 0.02;
    prof.push(new THREE.Vector2(Math.max(0.02, r), -L / 2 + t * L));
  }
  const fus = new THREE.LatheGeometry(prof, 24);
  fus.rotateX(Math.PI / 2);
  fus.scale(1, 0.72, 1);
  // Nose bumper ball.
  const nose = new THREE.SphereGeometry(0.42, 16, 10);
  nose.scale(1.2, 0.8, 1);
  nose.translate(0, -0.08, L / 2 - 0.15);
  // Stubby round wings: flattened capsules.
  const wings: THREE.BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const w = new THREE.CapsuleGeometry(0.42, W * 0.36, 6, 14);
    w.rotateZ(Math.PI / 2);
    w.scale(1, 0.42, 1.25);
    w.translate(sx * W * 0.3, -0.12, -L * 0.04);
    wings.push(w);
  }
  // Little round tail fin.
  const fin = new THREE.CapsuleGeometry(0.2, 0.55, 4, 10);
  fin.scale(0.6, 1, 1.4);
  fin.rotateX(-0.45);
  fin.translate(0, 0.72, -L * 0.36);
  // Big round engine pods at the wing tips.
  const engine: THREE.Vector3[] = [new THREE.Vector3(W * 0.42, -0.05, -L * 0.22), new THREE.Vector3(-W * 0.42, -0.05, -L * 0.22)];
  const pods: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const flame: THREE.BufferGeometry[] = [];
  for (const e of engine) {
    const pod = new THREE.SphereGeometry(0.62, 18, 12);
    pod.scale(1, 1, 1.55);
    pod.translate(e.x, e.y, e.z + 0.35);
    pods.push(ni(pod));
    const rim = new THREE.TorusGeometry(0.46, 0.13, 8, 18);
    rim.translate(e.x, e.y, e.z - 0.55);
    dark.push(ni(rim));
    const g = new THREE.CircleGeometry(0.4, 18);
    g.rotateY(Math.PI);
    g.translate(e.x, e.y, e.z - 0.6);
    glow.push(ni(g));
    const f = new THREE.ConeGeometry(0.36, 2.6, 12, 1, true);
    f.rotateX(-Math.PI / 2);
    f.translate(e.x, e.y, -1.3);
    flame.push(ni(f));
  }
  // Open cockpit: a chunky dark tub rim flush with the top of the hull and a dark well inside it. The pilot's
  // hips sit well below (inside the hull), so only her chest, shoulders and head show above the rim.
  const seat = new THREE.Vector3(0, 0, L * 0.04);
  const rimY = 0.7;
  const tub = new THREE.TorusGeometry(0.66, 0.2, 10, 24);
  tub.rotateX(Math.PI / 2);
  tub.scale(1, 1, 1.3);
  tub.translate(seat.x, rimY, seat.z);
  dark.push(ni(tub));
  const floor = new THREE.CircleGeometry(0.66, 24);
  floor.rotateX(-Math.PI / 2);
  floor.scale(1, 1, 1.3);
  floor.translate(seat.x, rimY - 0.04, seat.z);
  dark.push(ni(floor));
  const bodyParts = [ni(fus), ni(nose), ...wings.map(ni), ni(fin)];
  const body = mergeGeometries(bodyParts, false);
  const pos = body.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = 0.5 - pos.getX(i) / (W * 1.1);
    uv[i * 2 + 1] = 0.5 + pos.getZ(i) / (L * 1.1);
  }
  body.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const podGeo = mergeGeometries(pods, false);
  const h: ToonHull = {
    body,
    pods: podGeo,
    dark: mergeGeometries(dark, false),
    glow: mergeGeometries(glow, false),
    flame: mergeGeometries(flame, false),
    outline: mergeGeometries([puff(body, 0.07), puff(podGeo, 0.07)], false),
    len: L,
    span: W,
    engine,
    seat,
  };
  cache.set(spec.id, h);
  return h;
}

let gradient: THREE.DataTexture | null = null;
/** 3-step toon ramp. */
function toonRamp() {
  if (gradient) return gradient;
  gradient = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

const bw = (c: string) => (c === '#ffffff' || c === '#f4f4f4' ? '#ffffff' : '#111111');

/**
 * Cartoon livery from above: base coat, two fat racing stripes, paint splats, and the graffiti tag banner
 * (NPG for the girls, EROBOT for the rivals). The tag is always pure white or black, never tinted.
 */
export function paintToonLivery(c: HTMLCanvasElement, l: Livery) {
  const g = c.getContext('2d')!;
  const S = c.width;
  const ero = /EROBOT/i.test(l.team);
  g.fillStyle = l.base;
  g.fillRect(0, 0, S, S);
  if (ero) {
    // Riveted panels + hazard stripes.
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = S * 0.008;
    for (let k = 1; k < 6; k++) {
      g.beginPath();
      g.moveTo(0, (S * k) / 6);
      g.lineTo(S, (S * k) / 6);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) g.fillRect(((x + 0.5) * S) / 8, ((y + 0.5) * S) / 8, S * 0.012, S * 0.012);
    g.fillStyle = l.accent;
    for (let k = -2; k < 10; k++) {
      g.beginPath();
      const x = (k * S) / 8;
      g.moveTo(x, S * 0.62);
      g.lineTo(x + S * 0.06, S * 0.62);
      g.lineTo(x + S * 0.16, S * 0.72);
      g.lineTo(x + S * 0.1, S * 0.72);
      g.closePath();
      g.fill();
    }
  } else {
    // Twin racing stripes nose to tail.
    g.fillStyle = l.accent;
    g.fillRect(S * 0.36, 0, S * 0.09, S);
    g.fillRect(S * 0.55, 0, S * 0.09, S);
    // Paint splats.
    const rnd = (i: number) => (Math.sin(i * 91.7 + l.number.length * 13.1) * 43758.5453) % 1;
    for (let i = 0; i < 14; i++) {
      const x = Math.abs(rnd(i)) * S;
      const y = Math.abs(rnd(i + 50)) * S;
      const r = S * (0.015 + Math.abs(rnd(i + 99)) * 0.04);
      g.fillStyle = i % 3 === 0 ? bw(l.trim) : l.accent;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  // Graffiti tag banner across the middle, readable from the chase cam (nose = canvas top).
  const tag = ero ? 'EROBOT' : 'NPG';
  const ink = bw(l.trim);
  const back = ink === '#ffffff' ? '#111111' : '#ffffff';
  g.save();
  g.translate(S * 0.5, S * 0.47);
  g.rotate(-0.08);
  g.fillStyle = back;
  g.fillRect(-S * 0.44, -S * 0.09, S * 0.88, S * 0.18);
  g.font = `900 italic ${S * (ero ? 0.13 : 0.17)}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = ink;
  g.fillText(tag, 0, S * 0.01);
  g.restore();
  // Number roundel, near the tail.
  g.beginPath();
  g.arc(S * 0.5, S * 0.82, S * 0.08, 0, Math.PI * 2);
  g.fillStyle = back;
  g.fill();
  g.fillStyle = ink;
  g.font = `900 ${S * 0.1}px Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(l.number, S * 0.5, S * 0.825);
}

const shared: { dark?: THREE.MeshToonMaterial; glow?: THREE.MeshBasicMaterial; outline?: THREE.MeshBasicMaterial } = {};

export type ToonOptions = { pilot?: string | null; outline?: boolean; /** Light the pilot (player ship only). */ light?: boolean };

export function buildToonShip(spec: ShipSpec, l: Livery, accentCol: string, o: ToonOptions = {}): Rig {
  const hull = toonHullFor(spec);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  paintToonLivery(canvas, l);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const ramp = toonRamp();
  const bodyMat = new THREE.MeshToonMaterial({ map: tex, gradientMap: ramp, emissiveMap: tex, emissive: new THREE.Color(0.25, 0.25, 0.25), side: THREE.DoubleSide });
  const podMat = new THREE.MeshToonMaterial({ color: new THREE.Color(l.accent === '#ffffff' ? l.base : l.accent), gradientMap: ramp, emissive: new THREE.Color(l.accent === '#ffffff' ? l.base : l.accent).multiplyScalar(0.25) });
  shared.dark ??= new THREE.MeshToonMaterial({ color: '#1a1a22', gradientMap: ramp, side: THREE.DoubleSide });
  shared.glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2f2').multiplyScalar(1.2), side: THREE.DoubleSide });
  shared.outline ??= new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.BackSide });
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentCol).multiplyScalar(3) });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentCol).lerp(new THREE.Color('#ffffff'), 0.4), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  // Squash/stretch lives on its own group, pivoting at the hull's belly, so the engine's tilt stays untouched.
  const toon = new THREE.Group();
  tilt.add(toon);
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = toon) => {
    const me = new THREE.Mesh(g, m);
    me.frustumCulled = false;
    parent.add(me);
    return me;
  };
  mk(hull.body, bodyMat);
  mk(hull.pods, podMat);
  mk(hull.dark, shared.dark);
  if (o.outline !== false) mk(hull.outline, shared.outline);
  const glow = mk(hull.glow, shared.glow);
  // Flames stay on tilt so their length (engine-driven) isn't squashed.
  const flame = mk(hull.flame, flameMat, tilt);
  flame.position.z = hull.engine[0].z - 0.6;
  const shield = new THREE.Mesh(new THREE.SphereGeometry(hull.len * 0.7, 18, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7ad0').multiplyScalar(1.4), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  shield.scale.set(1, 0.7, 1.2);
  shield.visible = false;
  tilt.add(shield);
  const seat = new THREE.Group();
  seat.position.copy(hull.seat);
  toon.add(seat);
  let alive = true;
  let pilot: Pilot | null = null;
  if (o.pilot) void seatPilot(seat, o.pilot, () => alive, o.light).then((p) => (pilot = p));
  // Spring state for the bounce.
  let t = Math.random() * 10;
  let sq = 0;
  let sqV = 0;
  let wasAir = false;
  let wasBoost = false;
  return {
    root, tilt, flame, flameMat, glow, canvas, tex, bodyMat, trimMat, shield, engine: hull.engine,
    toon: {
      update(dt: number, s: ToonState) {
        dt = Math.min(dt, 0.05);
        t += dt;
        // Kicks: landing squashes, boost stretches.
        if (wasAir && !s.air) sqV -= 7;
        if (s.boost && !wasBoost) sqV += 5;
        wasAir = s.air;
        wasBoost = s.boost;
        const target = s.air ? 0.12 : s.boost ? 0.1 : 0;
        // Under-damped spring: wobbly, toy-like.
        sqV += ((target - sq) * 140 - sqV * 7) * dt;
        sq += sqV * dt;
        sq = Math.max(-0.35, Math.min(0.35, sq));
        const k = 1 + sq;
        toon.scale.set(1 / Math.sqrt(k), 1 / k, k);
        // Idle hover bob + a jaunty wiggle that grows with speed.
        toon.position.y = Math.sin(t * 5.2) * 0.07 * (1 - s.thrust * 0.5) + Math.max(0, -sq) * -0.2;
        toon.rotation.z = Math.sin(t * 9) * 0.025 * s.thrust;
        pilot?.update(dt, -s.roll * 0.35);
      },
    },
    setLivery(nl) {
      paintToonLivery(canvas, nl);
      tex.needsUpdate = true;
    },
    dispose() {
      alive = false;
      pilot?.dispose();
      tex.dispose();
      bodyMat.dispose();
      podMat.dispose();
      trimMat.dispose();
      flameMat.dispose();
      shield.geometry.dispose();
      (shield.material as THREE.Material).dispose();
    },
  };
}
