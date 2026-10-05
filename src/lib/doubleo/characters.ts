/**
 * Double-O Satoshi cast: stylised procedural villains and henchmen (boxes, spheres, a few canvas
 * textures). Cartoon parody characters with parody names only: no real names, photos, likenesses or logos.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BRIAN, BRIAN_CO, CZ_SHORT, MICHAEL } from './names';

export type Kind = 'bot' | 'goon' | 'kingpin' | 'custodian' | 'hoarder';

export type CastDef = {
  kind: Kind;
  name: string;
  hp: number;
  speed: number;
  height: number;
  boss: boolean;
  fireMs: number; // between volleys
  shotSpeed: number; // world units / s (dodgeable)
  shotColor: string;
  damage: number;
  volley: number; // projectiles per volley (spread)
  quip: string[];
  grab?: string; // shouted when his shot lands on you
};

export const CAST: Record<Kind, CastDef> = {
  bot: { kind: 'bot', name: 'Guard Bot', hp: 4, speed: 2.6, height: 1.9, boss: false, fireMs: 1500, shotSpeed: 12, shotColor: '#ff5040', damage: 8, volley: 1, quip: ['INTRUDER', 'HALT'] },
  goon: { kind: 'goon', name: 'Paper-Wallet Goon', hp: 3, speed: 3.1, height: 1.85, boss: false, fireMs: 1700, shotSpeed: 11, shotColor: '#ffe060', damage: 7, volley: 1, quip: ['OI!', 'SEED PHRASE?'] },
  kingpin: { kind: 'kingpin', name: CZ_SHORT, hp: 45, speed: 2.2, height: 2.9, boss: true, fireMs: 1300, shotSpeed: 10, shotColor: '#7ad8ff', damage: 9, volley: 5, quip: ['FUNDS ARE SAFU!', 'WITHDRAWALS PAUSED!', 'FUNDS ARE SAFU!'], grab: `${CZ_SHORT.toUpperCase()} SEIZES!` },
  custodian: { kind: 'custodian', name: BRIAN, hp: 32, speed: 2.4, height: 2.6, boss: true, fireMs: 1100, shotSpeed: 11, shotColor: '#e8e8ff', damage: 9, volley: 3, quip: ['YOUR ACCOUNT IS UNDER REVIEW!', 'PLEASE VERIFY YOUR ID', 'TICKET #48213 RECEIVED'] },
  hoarder: { kind: 'hoarder', name: MICHAEL, hp: 32, speed: 2.8, height: 2.5, boss: true, fireMs: 1600, shotSpeed: 17, shotColor: '#ff2030', damage: 11, volley: 2, quip: ["I'LL JUST BUY MORE!", 'NEVER SELLING!', "I'LL JUST BUY MORE!"] },
};

export type Rig = {
  root: THREE.Group;
  body: THREE.Group; // tips over on death
  legs: THREE.Group[];
  arms: THREE.Group[];
  head: THREE.Group;
  hitbox: THREE.Mesh;
  eyes: THREE.Mesh[]; // laser eyes etc. (emissive, pulsed when about to fire)
  beams: THREE.Mesh[];
  muzzle: THREE.Object3D; // where shots leave
  button: THREE.Group | null; // the CZ boss's WITHDRAW button: pops off when hit
  phase: number;
};

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });
const glow = (color: string, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });

const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/** A paper wallet: white sheet with a fake QR block and "PRIVATE KEY - KEEP SECRET" printed on it. */
const paperTex = () =>
  canvasTex('paper', 128, 128, (c) => {
    c.fillStyle = '#f2efe6';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#111';
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if ((x * 7 + y * 13 + x * y) % 3 === 0) c.fillRect(30 + x * 7, 34 + y * 7, 7, 7);
    c.fillRect(30, 34, 18, 18);
    c.fillStyle = '#f2efe6';
    c.fillRect(34, 38, 10, 10);
    c.fillStyle = '#111';
    c.font = 'bold 11px monospace';
    c.fillText('PAPER WALLET', 22, 20);
    c.font = '9px monospace';
    c.fillText('KEEP SECRET!', 30, 112);
  });

const textTex = (text: string, fg: string, bg: string, w = 256, h = 64) =>
  canvasTex(`t:${text}:${fg}:${bg}:${w}`, w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.font = `bold ${Math.floor(h * 0.6)}px monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2, w - 8);
  });

/** A floating name tag (bosses). */
export function nameTag(text: string, color = '#ffd27a') {
  const t = textTex(text, color, 'rgba(8,6,4,0.8)', 512, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.3, 1);
  s.renderOrder = 5;
  return s;
}

/** A wall sign (canvas text on a plane). */
export function signMesh(text: string, fg: string, bg: string) {
  const t = textTex(text, fg, bg, 512, 96);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
  return m;
}

/** Bevelled box: soft edges catch the light like real tailoring. */
const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));

function limb(w: number, h: number, d: number, mat: THREE.Material, pivotY: number, x: number) {
  const g = new THREE.Group();
  g.position.set(x, pivotY, 0);
  const m = new THREE.Mesh(rbox(w, h, d, 0.07), mat);
  m.position.y = -h / 2;
  g.add(m);
  return g;
}

/** Build one character facing +Z, feet at y = 0, scaled to its def height. */
export function buildRig(kind: Kind): Rig {
  const def = CAST[kind];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const s = def.height / 1.9; // everything below is modelled for a 1.9-unit person
  const inner = new THREE.Group();
  inner.scale.setScalar(s);
  body.add(inner);
  const eyes: THREE.Mesh[] = [];
  const beams: THREE.Mesh[] = [];
  let button: THREE.Group | null = null;

  const palette: Record<Kind, { suit: string; legs: string; skin: string; shirt: string }> = {
    bot: { suit: '#3a4250', legs: '#262b33', skin: '#59636f', shirt: '#59636f' },
    goon: { suit: '#f2efe6', legs: '#1b1b1b', skin: '#e2b48e', shirt: '#f2efe6' },
    kingpin: { suit: '#9c7a1a', legs: '#7a5f12', skin: '#e7b08a', shirt: '#111111' },
    custodian: { suit: '#5c6168', legs: '#3c4046', skin: '#d8a888', shirt: '#f4f4f4' },
    hoarder: { suit: '#e8741c', legs: '#2a2a2e', skin: '#e0b090', shirt: '#e8741c' },
  };
  const p = palette[kind];
  const suit = kind === 'goon' ? new THREE.MeshStandardMaterial({ map: paperTex(), roughness: 0.9 }) : std(p.suit, kind === 'kingpin' ? { metalness: 0.45, roughness: 0.55 } : kind === 'bot' ? { metalness: 0.7, roughness: 0.35 } : {});
  const legMat = std(p.legs, kind === 'bot' ? { metalness: 0.7, roughness: 0.4 } : {});
  const skin = std(p.skin, kind !== 'bot' ? { roughness: 0.85 } : kind === 'bot' ? { metalness: 0.7, roughness: 0.35 } : {});

  // Legs, torso, arms.
  const legs = [limb(0.24, 0.85, 0.26, legMat, 0.88, -0.15), limb(0.24, 0.85, 0.26, legMat, 0.88, 0.15)];
  legs.forEach((l) => inner.add(l));
  for (const l of legs) {
    const shoe = new THREE.Mesh(rbox(0.26, 0.12, 0.38, 0.05), std(kind === 'bot' ? '#202428' : '#0b0b0b', { roughness: 0.25, metalness: 0.2 }));
    shoe.position.set(0, -0.85, 0.06);
    l.add(shoe);
  }
  const belly = kind === 'kingpin' ? 0.12 : 0;
  const torso = new THREE.Mesh(rbox(0.62 + belly, 0.72, 0.36 + belly, 0.1), suit);
  torso.position.y = 1.24;
  inner.add(torso);
  if (kind !== 'goon' && kind !== 'bot' && kind !== 'hoarder') {
    // Shirt and tie.
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.02), std(p.shirt));
    shirt.position.set(0, 1.32, 0.19 + belly / 2);
    inner.add(shirt);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.02), std(kind === 'kingpin' ? '#b0141c' : '#1d3a7a'));
    tie.position.set(0, 1.3, 0.205 + belly / 2);
    inner.add(tie);
  }
  const arms = [limb(0.18, 0.7, 0.2, suit, 1.56, -0.42 - belly / 2), limb(0.18, 0.7, 0.2, suit, 1.56, 0.42 + belly / 2)];
  arms.forEach((a) => inner.add(a));
  // Hands.
  for (const a of arms) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), skin);
    hand.position.y = -0.76;
    a.add(hand);
  }
  // Head.
  const head = new THREE.Group();
  head.position.y = 1.6;
  inner.add(head);
  const headMesh = kind === 'bot' ? new THREE.Mesh(rbox(0.42, 0.36, 0.4, 0.08), skin) : new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 24), skin);
  headMesh.position.y = 0.22;
  head.add(headMesh);

  // Right hand holds something that shoots.
  const muzzle = new THREE.Object3D();
  const gunMat = std('#151515', { metalness: 0.6, roughness: 0.4 });
  if (kind === 'custodian') {
    const brief = new THREE.Mesh(rbox(0.12, 0.34, 0.46, 0.03), std('#3b2414', { roughness: 0.35 }));
    brief.position.set(0, -0.9, 0.05);
    arms[1].add(brief);
    const iou = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.14), new THREE.MeshBasicMaterial({ map: textTex('IOU', '#ffd27a', '#3b2414', 128, 48) }));
    iou.rotation.y = Math.PI / 2;
    iou.position.set(0.065, -0.9, 0.05);
    arms[1].add(iou);
  } else if (kind !== 'hoarder') {
    const gun = new THREE.Mesh(rbox(0.09, 0.12, 0.38, 0.03), gunMat);
    gun.position.set(0, -0.78, 0.18);
    arms[1].add(gun);
  }
  muzzle.position.set(0.42 * s, 1.0 * s, 0.6 * s);
  root.add(muzzle);

  // Accessories.
  if (kind === 'bot') {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.02), glow('#ff3020', 4));
    visor.position.set(0, 0.25, 0.205);
    head.add(visor);
    eyes.push(visor);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3), gunMat);
    ant.position.set(0.12, 0.55, 0);
    head.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow('#ff3020', 3));
    tip.position.set(0.12, 0.72, 0);
    head.add(tip);
  } else {
    // Sunglasses for everyone but the hoarder (his eyes are the point).
    if (kind !== 'hoarder') {
      const shades = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.04), std('#050505', { metalness: 0.9, roughness: 0.1 }));
      shades.position.set(0, 0.26, 0.19);
      head.add(shades);
    }
    // Hair.
    if (kind === 'goon' || kind === 'custodian') {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.2), std(kind === 'goon' ? '#2a1a10' : '#a0a0a0'));
      hair.position.y = 0.24;
      head.add(hair);
    }
  }
  if (kind === 'kingpin') {
    const hatMat = std('#0a0a0a', { roughness: 0.4 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 40), hatMat);
    brim.position.y = 0.4;
    head.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 40), hatMat);
    crown.position.y = 0.62;
    head.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.06, 40), std('#c9a227', { metalness: 0.9, roughness: 0.2 }));
    band.position.y = 0.45;
    head.add(band);
    const cigar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8), std('#5a3416'));
    cigar.rotation.x = Math.PI / 2;
    cigar.position.set(0.07, 0.12, 0.28);
    head.add(cigar);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), glow('#ff6020', 4));
    ember.position.set(0.07, 0.12, 0.39);
    head.add(ember);
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 10, 40, Math.PI), std('#ffd84a', { metalness: 1, roughness: 0.2 }));
    chain.rotation.z = Math.PI;
    chain.position.set(0, 1.52, 0.25);
    inner.add(chain);
    const dollar = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: textTex('$', '#ffd84a', '#111111', 64, 64), transparent: true }));
    dollar.position.set(0, 1.12, 0.25);
    inner.add(dollar);
    button = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.06, 16), glow('#ff2a2a', 2));
    cap.rotation.x = Math.PI / 2;
    button.add(cap);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.08), new THREE.MeshBasicMaterial({ map: textTex('WITHDRAW', '#ffffff', '#b0141c', 256, 64) }));
    lbl.position.set(0, -0.13, 0);
    button.add(lbl);
    button.position.set(-0.17, 1.42, 0.27);
    inner.add(button);
  }
  if (kind === 'custodian') {
    const vest = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), new THREE.MeshBasicMaterial({ map: textTex(BRIAN_CO.toUpperCase(), '#111', '#e8e8e8', 256, 64) }));
    vest.position.set(0.17, 1.42, 0.185);
    vest.scale.setScalar(0.6);
    inner.add(vest);
  }
  if (kind === 'hoarder') {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), std('#c75e12'));
    hood.position.y = 0.2;
    hood.rotation.x = -0.25;
    head.add(hood);
    const hodl = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.16), new THREE.MeshBasicMaterial({ map: textTex('HODL', '#ffffff', '#e8741c', 128, 48) }));
    hodl.position.set(0, 1.3, 0.185);
    inner.add(hodl);
    for (const x of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), glow('#ff1020', 6));
      eye.position.set(x, 0.25, 0.19);
      head.add(eye);
      eyes.push(eye);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.3), toneMapped: false, transparent: true, opacity: 0.75 }));
      beam.rotation.x = Math.PI / 2;
      beam.position.set(x, 0.25, 0.19 + 0.5);
      head.add(beam);
      beams.push(beam);
    }
    muzzle.position.set(0, 1.85 * s, 0.4 * s);
  }

  // Shots test this box.
  const w = 0.9 * s;
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(w, def.height, w), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = def.height / 2;
  root.add(hitbox);

  return { root, body, legs, arms, head, hitbox, eyes, beams, muzzle, button, phase: Math.random() * 6 };
}

/** Walk/aim/idle pose. `speed` 0..1 (fraction of a run), `aim` raises the gun arm. */
export function poseRig(r: Rig, dt: number, speed: number, aim: boolean, now: number) {
  r.phase += dt * (4 + speed * 8) * (speed > 0.05 ? 1 : 0);
  const sw = Math.sin(r.phase) * 0.7 * Math.min(1, speed * 1.5);
  r.legs[0].rotation.x = sw;
  r.legs[1].rotation.x = -sw;
  r.arms[0].rotation.x = -sw * 0.8;
  r.arms[1].rotation.x = aim ? -Math.PI / 2 : sw * 0.8;
  r.body.position.y = speed > 0.05 ? Math.abs(Math.cos(r.phase)) * 0.05 : Math.sin(now / 500) * 0.01;
}
