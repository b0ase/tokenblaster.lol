/**
 * The V3XV0ID jet-bike's rider: procedural (capsules and rounded boxes, no imported model), one skinned mesh with
 * eleven rigid bones, so the whole rider is a single draw call. Obsidian suit, chrome armour, a helmet with a glowing
 * blue visor.
 *
 * Posing is simple procedural IK in the bike's model space: the hips sit on the seat, the spine tucks forward (lower
 * on boost) and leans into turns with the bike's roll, the head stays nearer level, and two-bone IK pins the hands to
 * the grips and the feet to the pegs.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { merge, part, type Detail, type Surf } from './kit';

const SUIT: Surf = { c: '#0b0c10', m: 0.4, r: 0.3, cc: 0.8 };
const PANEL: Surf = { c: '#1a1c22', m: 0.5, r: 0.4, cc: 0.5 };
const CHROME: Surf = { c: '#d3d8df', m: 1, r: 0.2, cc: 0.4 };
const LED: Surf = { c: '#2f8cff', m: 0, r: 0.5, g: 5 };
const VISOR: Surf = { c: '#2f8cff', m: 0.3, r: 0.05, g: 2.4, cc: 1 };

/** Where the rider meets the bike (bike model space; see jetbike.ts). */
export const RIDER_MOUNT = {
  seat: new THREE.Vector3(0, 0.6, -1.25),
  grip: new THREE.Vector3(0.6, 0.52, 0.55),
  peg: new THREE.Vector3(0.44, 0.08, -1.62),
};

const UA = 0.62;
const FA = 0.6;
const TH = 0.74;
const SH = 0.7;
const SPINE = 1.05;
/** Limb lengths, for tests and anyone posing the rider. */
export const RIDER_LIMBS = { UA, FA, TH, SH, SPINE } as const;
/** Girth: the rider is built heroic, not skinny, so it reads on a 6 m bike. */
const G = 1.22;

export enum B {
  pelvis,
  torso,
  head,
  uaL,
  faL,
  uaR,
  faR,
  thL,
  shL,
  thR,
  shR,
}

/** Capsule along +Z from 0 to len. */
function limb(r: number, len: number, seg: number) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 3, seg);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  return g;
}
const box = (w: number, h: number, d: number, r = 0.3) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * r);

function skin(g: THREE.BufferGeometry, s: Surf, bone: B) {
  const x = part(g, s);
  const n = x.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = bone;
    w[i * 4] = 1;
  }
  x.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  x.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  return x;
}

const cache = new Map<Detail, THREE.BufferGeometry>();

function riderGeo(detail: Detail): THREE.BufferGeometry {
  const hit = cache.get(detail);
  if (hit) return hit;
  const seg = detail === 'low' ? 6 : 10;
  const P: THREE.BufferGeometry[] = [];
  // Pelvis (x left, y up, z forward).
  P.push(skin(box(0.44 * G, 0.26 * G, 0.36 * G), SUIT, B.pelvis));
  P.push(skin(box(0.46 * G, 0.06, 0.2 * G, 0.4).translate(0, 0.1 * G, -0.06), PANEL, B.pelvis));
  // Torso (z = spine up to the neck, y = out of the back, x left).
  const torso = new RoundedBoxGeometry(1, 1, 1, 2, 0.32);
  torso.translate(0, 0, 0.5);
  {
    const p = torso.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, p.getZ(i)));
      p.setXYZ(i, p.getX(i) * (0.34 + 0.18 * Math.sin(t * 2.4)) * G, p.getY(i) * (0.22 + 0.08 * t) * G, p.getZ(i) * SPINE);
    }
    torso.computeVertexNormals();
  }
  P.push(skin(torso, SUIT, B.torso));
  // Aero hump down the back (chrome), the V3XV0ID blue spine light, chrome shoulder caps, the neck.
  const hump = box(0.3 * G, 0.12, 0.6, 0.45);
  P.push(skin(hump.translate(0, 0.17 * G, 0.55), CHROME, B.torso));
  P.push(skin(box(0.04, 0.03, 0.62, 0.4).translate(0, 0.17 * G + 0.065, 0.55), LED, B.torso));
  for (const sx of [1, -1]) {
    const cap = new THREE.SphereGeometry(0.12 * G, seg, seg - 2);
    cap.scale(1, 0.8, 1.15);
    P.push(skin(cap.translate(sx * 0.29 * G, 0.02, SPINE - 0.12), CHROME, B.torso));
    P.push(skin(box(0.03, 0.025, 0.55, 0.4).translate(sx * 0.2 * G, 0.15 * G, 0.5), LED, B.torso));
  }
  P.push(skin(limb(0.085, 0.2, seg).translate(0, 0, SPINE - 0.05), SUIT, B.torso));
  // Head (z = look direction, y up): helmet shell, aero tail, chrome crest, glowing visor band.
  const helmet = new THREE.SphereGeometry(0.25, seg + 6, seg);
  helmet.scale(0.92, 0.94, 1.12);
  P.push(skin(helmet, SUIT, B.head));
  const tail = new THREE.ConeGeometry(0.15, 0.34, seg);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.6, 1);
  P.push(skin(tail.translate(0, 0.05, -0.33), SUIT, B.head));
  P.push(skin(box(0.05, 0.035, 0.5, 0.4).translate(0, 0.235, -0.05), CHROME, B.head));
  const visor = new THREE.SphereGeometry(0.256, seg + 6, 6, Math.PI / 2 - 0.95, 1.9, 1.05, 0.62);
  visor.scale(0.93, 0.95, 1.13);
  P.push(skin(visor, VISOR, B.head));
  // Arms: upper arm with a chrome elbow guard, forearm with a gauntlet and a fist.
  for (const [ua, fa] of [[B.uaL, B.faL], [B.uaR, B.faR]] as const) {
    P.push(skin(limb(0.12, UA, seg), SUIT, ua));
    P.push(skin(new THREE.SphereGeometry(0.125, seg, seg - 2).translate(0, 0, UA), CHROME, ua));
    P.push(skin(limb(0.1, FA, seg), SUIT, fa));
    P.push(skin(limb(0.118, FA * 0.45, seg).translate(0, 0, FA * 0.42), PANEL, fa));
    P.push(skin(box(0.15, 0.13, 0.17, 0.35).translate(0, 0, FA + 0.02), PANEL, fa));
  }
  // Legs: thigh, knee armour, shin, boot (the boot points along the shin's +Y, which faces forward when posed).
  for (const [th, sh] of [[B.thL, B.shL], [B.thR, B.shR]] as const) {
    P.push(skin(limb(0.165, TH, seg), SUIT, th));
    const knee = new THREE.SphereGeometry(0.15, seg, seg - 2);
    knee.scale(1, 1, 1.2);
    P.push(skin(knee.translate(0, 0, TH), CHROME, th));
    P.push(skin(limb(0.125, SH, seg), SUIT, sh));
    P.push(skin(box(0.16, 0.34, 0.16, 0.35).translate(0, 0.08, SH + 0.02), PANEL, sh));
    P.push(skin(box(0.17, 0.045, 0.17, 0.4).translate(0, 0.08, SH + 0.1), CHROME, sh));
  }
  const g = merge(P);
  cache.set(detail, g);
  return g;
}

/** Two-bone IK: elbow/knee position for root -> target with lengths a, b, bending toward `pole`. */
export function ik(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const u = new THREE.Vector3().subVectors(target, root);
  const d = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, u.length()));
  u.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const n = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  return out.copy(root).addScaledVector(u, a * cosA).addScaledVector(n, a * sinA);
}

export type Rider = { mesh: THREE.SkinnedMesh; pose(lean: number, boost: number, thrust: number, t: number): void };

export function buildRider(mat: THREE.Material, detail: Detail): Rider {
  const mesh = new THREE.SkinnedMesh(riderGeo(detail), mat);
  mesh.frustumCulled = false;
  const bones = Array.from({ length: 11 }, () => new THREE.Bone());
  for (const b of bones) mesh.add(b);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  const v = () => new THREE.Vector3();
  const [hip, waist, s, back, left, neck, sh, mid, end, head, look, up, pole] = Array.from({ length: 13 }, v);
  const Z = new THREE.Vector3(0, 0, 1);
  const m = new THREE.Matrix4();
  const rotZ = (p: THREE.Vector3, a: number) => p.set(p.x * Math.cos(a) - p.y * Math.sin(a), p.x * Math.sin(a) + p.y * Math.cos(a), p.z);
  const frame = (b: THREE.Bone, pos: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) => {
    b.position.copy(pos);
    b.quaternion.setFromRotationMatrix(m.makeBasis(x, y, z));
  };
  const seg = (b: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
    b.position.copy(from);
    b.quaternion.setFromUnitVectors(Z, end.subVectors(to, from).normalize());
  };
  const M = RIDER_MOUNT;
  /** `lean` is the bike's roll about +Z in its own frame (positive = left side up): the rider adds to it. */
  const pose = (lean: number, boost: number, thrust: number, t: number) => {
    const L = Math.max(-0.9, Math.min(0.9, lean));
    // Hips: on the seat, sliding toward the inside of the turn, dropping a little in the tuck.
    hip.copy(M.seat).add(new THREE.Vector3(-L * 0.2, -0.05 * boost + Math.sin(t * 9) * 0.004, -0.04 * boost));
    // Spine: tucked forward (lower on boost), leaning into the turn harder than the bike.
    const phi = 1.12 + 0.3 * boost + 0.05 * thrust;
    s.set(0, Math.cos(phi), Math.sin(phi));
    back.set(0, Math.sin(phi), -Math.cos(phi));
    rotZ(s, L * 0.6);
    rotZ(back, L * 0.6);
    left.crossVectors(back, s).normalize();
    const pl = rotZ(new THREE.Vector3(1, 0, 0), L * 0.2);
    const pu = rotZ(new THREE.Vector3(0, 1, 0), L * 0.2);
    frame(bones[B.pelvis], hip, pl, pu, new THREE.Vector3().crossVectors(pl, pu));
    waist.copy(hip).addScaledVector(pu, 0.1).add(new THREE.Vector3(0, 0, 0.04));
    frame(bones[B.torso], waist, left, back, s);
    neck.copy(waist).addScaledVector(s, SPINE);
    // Head: chin forward over the tank, kept nearer level than the shoulders.
    head.copy(neck).addScaledVector(s, 0.17).addScaledVector(back, 0.12);
    look.set(0, -0.12 - 0.12 * boost, 1).normalize();
    up.set(0, 1, 0);
    rotZ(up, -L * 0.25);
    const hx = new THREE.Vector3().crossVectors(up, look).normalize();
    up.crossVectors(look, hx);
    frame(bones[B.head], head, hx, up, look);
    // Arms: shoulders to the grips.
    for (const [side, ua, fa] of [[1, B.uaL, B.faL], [-1, B.uaR, B.faR]] as const) {
      sh.copy(neck).addScaledVector(s, -0.12).addScaledVector(left, side * 0.3 * G);
      end.set(side * M.grip.x, M.grip.y, M.grip.z);
      const grip = end.clone();
      ik(sh, grip, UA, FA, pole.set(side * 1, -0.7, -0.3), mid);
      seg(bones[ua], sh, mid);
      seg(bones[fa], mid, grip);
    }
    // Legs: hips to the pegs, knees forward and out against the tank.
    for (const [side, th, shn] of [[1, B.thL, B.shL], [-1, B.thR, B.shR]] as const) {
      sh.copy(hip).addScaledVector(pl, side * 0.17 * G).addScaledVector(pu, -0.04);
      const peg = new THREE.Vector3(side * M.peg.x, M.peg.y, M.peg.z);
      ik(sh, peg, TH, SH, pole.set(side * 0.15, 0.6, 1.4), mid);
      seg(bones[th], sh, mid);
      seg(bones[shn], mid, peg);
    }
    for (const b of bones) b.updateMatrix();
    mesh.updateMatrixWorld(true);
  };
  pose(0, 0, 0.5, 0);
  return { mesh, pose };
}
