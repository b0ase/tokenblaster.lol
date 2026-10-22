/**
 * The V3XV0ID jet-bike's rider: procedural (no imported model), one skinned mesh with fifteen rigid bones, so the
 * whole rider is a single draw call (plus a small number plate on the back).
 *
 * Built as an athlete in a racing suit: limbs are lathed with muscle profiles (thigh, calf, bicep, forearm), the torso
 * is a lathed chest-to-waist taper with a spine protector, the helmet has a rounded shell, chin bar, wrap-around visor
 * and a small aero spoiler, the gloves wrap their fingers round the bars and the boots have soles and toe caps.
 *
 * Posing is procedural IK in the bike's model space: the hips sit on the seat, the spine tucks (lower on boost) and
 * leans into turns harder than the bike, the head drops into the tuck, two-bone IK takes the shoulders to the wrists
 * (elbows tucked) and the hips to the ankles (knees in against the tank), and the hands and boots are pinned to the
 * grips and pegs.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { merge, part, type Detail, type Surf } from './kit';

const SUIT: Surf = { c: '#0c0d11', m: 0.25, r: 0.34, cc: 0.9 };
const PANEL: Surf = { c: '#1d2027', m: 0.3, r: 0.42, cc: 0.6 };
const SEAM: Surf = { c: '#050506', m: 0.1, r: 0.6 };
const CARBON: Surf = { c: '#15171c', m: 0.4, r: 0.3, cc: 1 };
const CHROME: Surf = { c: '#dfe4ea', m: 1, r: 0.14, cc: 0.5 };
const RUBBER: Surf = { c: '#080809', m: 0, r: 0.85 };
const LED: Surf = { c: '#2f8cff', m: 0, r: 0.5, g: 5 };
const VISOR: Surf = { c: '#1f6dff', m: 0.4, r: 0.04, g: 1.6, cc: 1 };

/** Where the rider meets the bike (bike model space; see jetbike.ts), mirrored in X for the right side. */
export const RIDER_MOUNT = {
  seat: new THREE.Vector3(0, 0.6, -1.25),
  grip: new THREE.Vector3(0.6, 0.52, 0.55),
  peg: new THREE.Vector3(0.44, 0.08, -1.62),
  /** Wrist relative to the grip (the fist wraps the bar, the wrist sits behind and above it). */
  wrist: new THREE.Vector3(0, 0.07, -0.14),
  /** Ankle relative to the peg (the ball of the boot sits on the peg). */
  ankle: new THREE.Vector3(0, 0.15, -0.1),
};

const UA = 0.6;
const FA = 0.56;
const TH = 0.76;
const SH = 0.72;
const SPINE = 1.05;
/** Limb lengths, for tests and anyone posing the rider. */
export const RIDER_LIMBS = { UA, FA, TH, SH, SPINE } as const;

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
  handL,
  handR,
  footL,
  footR,
}

const box = (w: number, h: number, d: number, r = 0.3) => new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * r);

/** A limb lathed along +Z (0..len) from a radius profile [t, r] with rounded, closed ends. */
function lathe(len: number, prof: [number, number][], seg: number, sx = 1, sy = 1) {
  const pts: THREE.Vector2[] = [];
  const r0 = prof[0][1];
  const r1 = prof[prof.length - 1][1];
  for (let k = 0; k <= 3; k++) {
    const a = (k / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.002, r0 * Math.sin(a)), -r0 * 0.5 * Math.cos(a)));
  }
  const n = 14;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    let j = 0;
    while (j < prof.length - 2 && prof[j + 1][0] < t) j++;
    const [ta, ra] = prof[j];
    const [tb, rb] = prof[j + 1];
    const u = Math.max(0, Math.min(1, (t - ta) / (tb - ta || 1)));
    pts.push(new THREE.Vector2(ra + (rb - ra) * (0.5 - 0.5 * Math.cos(Math.PI * u)), t * len));
  }
  for (let k = 0; k <= 3; k++) {
    const a = (k / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.002, r1 * Math.cos(a)), len + r1 * 0.5 * Math.sin(a)));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);
  g.scale(sx, sy, 1);
  return g;
}

/** A thin seam ring round a limb at z. */
const seam = (r: number, z: number, seg: number) => new THREE.TorusGeometry(r, 0.008, 3, seg).translate(0, 0, z);

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

// Profiles: [t along the limb, radius].
const THIGH: [number, number][] = [[0, 0.15], [0.22, 0.175], [0.55, 0.155], [0.88, 0.112], [1, 0.1]];
const CALF: [number, number][] = [[0, 0.1], [0.22, 0.128], [0.5, 0.108], [0.85, 0.074], [1, 0.072]];
const BICEP: [number, number][] = [[0, 0.1], [0.4, 0.112], [0.75, 0.094], [1, 0.078]];
const FORE: [number, number][] = [[0, 0.08], [0.25, 0.094], [0.7, 0.068], [1, 0.056]];
const TORSO: [number, number][] = [[0, 0.2], [0.18, 0.205], [0.45, 0.24], [0.7, 0.27], [0.86, 0.262], [0.95, 0.2], [1, 0.12]];

const torsoR = (t: number) => {
  let j = 0;
  while (j < TORSO.length - 2 && TORSO[j + 1][0] < t) j++;
  const [ta, ra] = TORSO[j];
  const [tb, rb] = TORSO[j + 1];
  return ra + (rb - ra) * Math.max(0, Math.min(1, (t - ta) / (tb - ta)));
};
const TX = 1.32;
const TY = 0.8;

/** Glove (hand frame: origin on the bar's axis, x along the bar, y up, z forward). `inner` is the bike-centre side. */
function hand(P: THREE.BufferGeometry[], bone: B, inner: number, seg: number) {
  // Back of the hand over the top-rear of the bar, running back to the wrist.
  const palm = box(0.15, 0.07, 0.17, 0.4);
  palm.rotateX(-0.55);
  P.push(skin(palm.translate(0, 0.075, -0.075), PANEL, bone));
  // Four fingers wrapped round the bar (arc from behind, over the top, round the front and under).
  for (let i = 0; i < 4; i++) {
    const f = new THREE.TorusGeometry(0.062, 0.022, 5, seg + 2, Math.PI * 1.55);
    f.rotateY(Math.PI / 2);
    P.push(skin(f.translate(-0.054 + i * 0.036, 0, 0), SUIT, bone));
  }
  // Thumb hooked under the bar from the inner side, knuckle guard in chrome, a cuff at the wrist.
  const th = new THREE.CapsuleGeometry(0.022, 0.07, 3, seg);
  th.rotateX(Math.PI / 2 + 0.5);
  P.push(skin(th.translate(inner * 0.085, -0.035, 0.0), SUIT, bone));
  P.push(skin(box(0.15, 0.03, 0.06, 0.4).translate(0, 0.085, 0.01), CHROME, bone));
  const cuff = new THREE.CylinderGeometry(0.075, 0.07, 0.07, seg);
  cuff.rotateX(Math.PI / 2 - 0.55);
  P.push(skin(cuff.translate(0, 0.07, -0.14), PANEL, bone));
}

/** Boot (foot frame: origin at the ankle, x left, y up, z forward). */
function boot(P: THREE.BufferGeometry[], bone: B, seg: number) {
  P.push(skin(lathe(0.2, [[0, 0.08], [1, 0.085]], seg).rotateX(-Math.PI / 2).translate(0, -0.02, 0), PANEL, bone));
  P.push(skin(box(0.13, 0.11, 0.36, 0.4).translate(0, -0.07, 0.07), PANEL, bone));
  P.push(skin(box(0.145, 0.03, 0.39, 0.3).translate(0, -0.135, 0.075), RUBBER, bone));
  P.push(skin(box(0.135, 0.06, 0.08, 0.45).translate(0, -0.07, 0.23), CHROME, bone));
  P.push(skin(box(0.1, 0.07, 0.04, 0.4).translate(0, -0.08, -0.11), CHROME, bone));
  P.push(skin(box(0.14, 0.02, 0.06, 0.4).translate(0, 0.03, 0.02), LED, bone));
}

const cache = new Map<Detail, THREE.BufferGeometry>();

function riderGeo(detail: Detail): THREE.BufferGeometry {
  const hit = cache.get(detail);
  if (hit) return hit;
  const lo = detail === 'low';
  const seg = lo ? 8 : 14;
  const P: THREE.BufferGeometry[] = [];
  // Pelvis (x left, y up, z forward): hips and the seat of the suit.
  P.push(skin(box(0.5, 0.3, 0.42, 0.45), SUIT, B.pelvis));
  P.push(skin(box(0.52, 0.06, 0.24, 0.45).translate(0, 0.1, -0.08), PANEL, B.pelvis));
  // Torso (z = spine to the neck, y = out of the back, x left): chest-to-waist taper.
  P.push(skin(lathe(SPINE, TORSO, seg + 6, TX, TY), SUIT, B.torso));
  // Side panels in the lighter suit fabric, with seams.
  for (const sx of [1, -1]) {
    P.push(skin(box(0.012, 0.012, 0.7, 0.4).translate(sx * torsoR(0.5) * TX * 0.62, torsoR(0.5) * TY * 0.82, 0.45), SEAM, B.torso));
  }
  if (!lo) for (const t of [0.3, 0.62]) P.push(skin(seam(torsoR(t) * 1.01, t * SPINE, seg + 6).scale(TX, TY, 1), SEAM, B.torso));
  // Spine protector: overlapping carbon plates down the back with a chrome ridge, and two team stripes.
  const backY = (t: number) => torsoR(t) * TY;
  for (let k = 0; k < 5; k++) {
    const t = 0.16 + k * 0.15;
    const pl = box(0.24 - k * 0.01, 0.07, 0.19, 0.45);
    pl.rotateX(0.12);
    P.push(skin(pl.translate(0, backY(t) + 0.035, t * SPINE), CARBON, B.torso));
  }
  // Chrome ridge and two team stripes: short segments that follow the back's curve.
  for (let k = 0; k < 5; k++) {
    const t = 0.18 + k * 0.15;
    P.push(skin(box(0.035, 0.03, 0.14, 0.45).translate(0, backY(t) + 0.08, t * SPINE), CHROME, B.torso));
    for (const sx of [1, -1]) P.push(skin(box(0.03, 0.025, 0.15, 0.4).translate(sx * 0.17, backY(t) * 0.93 + 0.01, t * SPINE), LED, B.torso));
  }
  // Shoulder armour: two stacked chrome shells per side.
  for (const sx of [1, -1]) {
    for (const [r, dz] of [[0.15, 0], [0.12, -0.09]] as const) {
      const cap = new THREE.SphereGeometry(r, seg, 8);
      cap.scale(1, 0.55, 1.15);
      cap.rotateZ(-sx * 0.9);
      P.push(skin(cap.translate(sx * 0.31, 0.02, SPINE - 0.14 + dz), CHROME, B.torso));
    }
  }
  // Neck.
  P.push(skin(lathe(0.18, [[0, 0.085], [1, 0.075]], seg).translate(0, 0.02, SPINE - 0.05), SUIT, B.torso));
  // Helmet (z = look, y up): rounded shell, chin bar, wrap visor, crest stripe, aero spoiler.
  const shell = new THREE.SphereGeometry(0.25, seg + 8, seg, 0, Math.PI * 2, 0, Math.PI * 0.72);
  shell.scale(0.94, 0.95, 1.1);
  P.push(skin(shell.translate(0, 0.02, 0), SUIT, B.head));
  const base = new THREE.CylinderGeometry(0.2, 0.17, 0.08, seg + 8);
  P.push(skin(base.scale(0.94, 1, 1.1).translate(0, -0.17, -0.02), SUIT, B.head));
  const A = Math.PI * 0.75;
  const chin = new THREE.TorusGeometry(0.19, 0.06, 6, seg + 2, A);
  chin.rotateX(Math.PI / 2);
  chin.rotateY(A / 2 - Math.PI / 2);
  P.push(skin(chin.scale(0.95, 1.2, 1.12).translate(0, -0.12, 0.02), PANEL, B.head));
  const visor = new THREE.SphereGeometry(0.258, seg + 8, 6, Math.PI / 2 - 1.2, 2.4, 1.02, 0.62);
  visor.scale(0.95, 0.96, 1.11);
  P.push(skin(visor.translate(0, 0.02, 0), VISOR, B.head));
  P.push(skin(box(0.045, 0.025, 0.3, 0.45).translate(0, 0.245, -0.02), LED, B.head));
  const spoiler = box(0.26, 0.03, 0.1, 0.45);
  spoiler.rotateX(0.3);
  P.push(skin(spoiler.translate(0, 0.16, -0.27), CARBON, B.head));
  for (const sx of [1, -1]) P.push(skin(box(0.02, 0.07, 0.1, 0.4).translate(sx * 0.12, 0.13, -0.26), CARBON, B.head));
  // Arms: lathed bicep and forearm, chrome elbow cap, a seam at the elbow.
  for (const [ua, fa] of [[B.uaL, B.faL], [B.uaR, B.faR]] as const) {
    P.push(skin(lathe(UA, BICEP, seg, 1, 0.92), SUIT, ua));
    if (!lo) P.push(skin(seam(0.1, UA * 0.5, seg), SEAM, ua));
    const el = new THREE.SphereGeometry(0.1, seg, 8);
    P.push(skin(el.scale(1, 1, 0.8).translate(0, 0, UA - 0.01), CHROME, ua));
    P.push(skin(lathe(FA, FORE, seg, 1, 0.9), SUIT, fa));
    P.push(skin(lathe(FA * 0.4, [[0, 0.09], [1, 0.072]], seg, 1, 0.9).translate(0, 0, FA * 0.5), PANEL, fa));
  }
  hand(P, B.handL, -1, seg);
  hand(P, B.handR, 1, seg);
  // Legs: lathed thigh and calf, chrome knee armour, seams.
  for (const [th, sh] of [[B.thL, B.shL], [B.thR, B.shR]] as const) {
    P.push(skin(lathe(TH, THIGH, seg, 1, 0.92), SUIT, th));
    P.push(skin(lathe(TH * 0.5, [[0, 0.17], [1, 0.13]], seg, 1.02, 0.94).translate(0, 0, TH * 0.08), PANEL, th));
    const knee = new THREE.SphereGeometry(0.135, seg, 8);
    P.push(skin(knee.scale(1, 1, 1.25).translate(0, 0, TH), CHROME, th));
    P.push(skin(lathe(SH, CALF, seg, 1, 0.92), SUIT, sh));
    if (!lo) P.push(skin(seam(0.1, SH * 0.6, seg), SEAM, sh));
  }
  boot(P, B.footL, seg);
  boot(P, B.footR, seg);
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

/** `plate`: material for the number on the rider's back (the bike's livery), or null for none. */
export function buildRider(mat: THREE.Material, detail: Detail, plate: THREE.Material | null = null): Rider {
  const mesh = new THREE.SkinnedMesh(riderGeo(detail), mat);
  mesh.frustumCulled = false;
  const bones = Array.from({ length: 15 }, () => new THREE.Bone());
  for (const b of bones) mesh.add(b);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  if (plate) {
    // Number on the back, over the spine protector (reads from the chase camera). A second skinned mesh on the same
    // skeleton (rigid to the torso), so it needs no scene-graph tricks.
    const pg = new THREE.PlaneGeometry(0.36, 0.3);
    pg.rotateX(-Math.PI / 2);
    pg.rotateY(Math.PI); // in-plane half turn: the number reads upright from behind
    pg.rotateX(0.1);
    pg.translate(0, torsoR(0.4) * TY + 0.115, 0.4 * SPINE);
    const n = pg.attributes.position.count;
    pg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 === 0 ? B.torso : 0)), 4));
    pg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const pm = new THREE.SkinnedMesh(pg, plate);
    pm.frustumCulled = false;
    pm.bind(mesh.skeleton, new THREE.Matrix4());
    mesh.add(pm);
  }
  const v = () => new THREE.Vector3();
  const [hip, waist, s, back, left, neck, sh, mid, end, head, look, up, pole, tgt] = Array.from({ length: 14 }, v);
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
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  /** `lean` is the bike's roll about +Z in its own frame (positive = left side up): the rider adds to it. */
  const pose = (lean: number, boost: number, thrust: number, t: number) => {
    const L = Math.max(-0.9, Math.min(0.9, lean));
    // Hips: on the seat, sliding toward the inside of the turn, dropping a little in the tuck.
    hip.copy(M.seat).add(tgt.set(-L * 0.2, -0.05 * boost + Math.sin(t * 9) * 0.004, -0.04 * boost));
    // Spine: tucked forward (lower on boost), leaning into the turn harder than the bike.
    const phi = 1.26 + 0.2 * boost + 0.04 * thrust;
    s.set(0, Math.cos(phi), Math.sin(phi));
    back.set(0, Math.sin(phi), -Math.cos(phi));
    rotZ(s, L * 0.6);
    rotZ(back, L * 0.6);
    left.crossVectors(back, s).normalize();
    const pl = rotZ(new THREE.Vector3(1, 0, 0), L * 0.2);
    const pu = rotZ(new THREE.Vector3(0, 1, 0), L * 0.2);
    frame(bones[B.pelvis], hip, pl, pu, new THREE.Vector3().crossVectors(pl, pu));
    waist.copy(hip).addScaledVector(pu, 0.1).add(tgt.set(0, 0, 0.04));
    frame(bones[B.torso], waist, left, back, s);
    neck.copy(waist).addScaledVector(s, SPINE);
    // Head: dropped into the tuck behind the screen, eyes up the track, nearer level than the shoulders.
    head.copy(neck).addScaledVector(s, 0.13).addScaledVector(back, 0.03);
    look.set(0, -0.36 - 0.12 * boost, 1).normalize();
    up.set(0, 1, 0);
    rotZ(up, L * 0.3);
    const hx = new THREE.Vector3().crossVectors(up, look).normalize();
    up.crossVectors(look, hx);
    frame(bones[B.head], head, hx, up, look);
    // Arms: shoulders to the wrists, elbows tucked in and down; fists pinned round the grips.
    for (const [side, ua, fa, hb] of [[1, B.uaL, B.faL, B.handL], [-1, B.uaR, B.faR, B.handR]] as const) {
      sh.copy(neck).addScaledVector(s, -0.13).addScaledVector(left, side * 0.31);
      const grip = new THREE.Vector3(side * M.grip.x, M.grip.y, M.grip.z);
      const wrist = grip.clone().add(M.wrist);
      ik(sh, wrist, UA, FA, pole.set(side * 0.3, -1, -0.15), mid);
      seg(bones[ua], sh, mid);
      seg(bones[fa], mid, wrist);
      frame(bones[hb], grip, X, Y, Z);
    }
    // Legs: hips to the ankles, knees in against the tank; boots on the pegs, toes slightly down.
    const toe = new THREE.Quaternion().setFromAxisAngle(X, 0.18);
    for (const [side, th, shn, fb] of [[1, B.thL, B.shL, B.footL], [-1, B.thR, B.shR, B.footR]] as const) {
      sh.copy(hip).addScaledVector(pl, side * 0.18).addScaledVector(pu, -0.05);
      const ankle = new THREE.Vector3(side * M.peg.x, M.peg.y, M.peg.z).add(M.ankle);
      ik(sh, ankle, TH, SH, pole.set(side * 0.2, 0.5, 1), mid);
      seg(bones[th], sh, mid);
      seg(bones[shn], mid, ankle);
      bones[fb].position.copy(ankle);
      bones[fb].quaternion.copy(toe);
    }
    for (const b of bones) b.updateMatrix();
    mesh.updateMatrixWorld(true);
  };
  pose(0, 0, 0.5, 0);
  return { mesh, pose };
}
