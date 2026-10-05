/**
 * Double-O Kweg cast: stylised procedural villains and henchmen (boxes, spheres, a few canvas
 * textures). Cartoon parody characters with parody names only: no real names, photos, likenesses or logos.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BRIAN, BRIAN_CO, CZ_SHORT, MICHAEL, SAM, SAM_CO } from './names';

export type Kind = 'bot' | 'goon' | 'kingpin' | 'custodian' | 'hoarder' | 'partyboy';

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
  partyboy: { kind: 'partyboy', name: SAM, hp: 40, speed: 2.6, height: 2.5, boss: true, fireMs: 1000, shotSpeed: 13, shotColor: '#40e0ff', damage: 9, volley: 4, quip: ['IT WAS A ROUNDING ERROR!', 'THE BACKDOOR WAS A FEATURE!', 'I DONT RECALL!'] },
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
  /** Rigged-model characters: drive the animation mixer instead of swinging box limbs. */
  anim?: (dt: number, speed: number, aim: boolean) => void;
  /** Rigged-model characters: play the death clip (false if the model has none). */
  die?: () => boolean;
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

// ── Rigged models (credits: docs/doubleo-models.md) ──────────────────────────────
type ModelId = 'agent' | 'goon' | 'bot';
type ModelDef = {
  url: string;
  height: number;
  facing: number; // extra yaw so the model faces +Z
  clips: { idle: string; walk: string; run: string; death?: string; attack?: string };
};
const MODELS: Record<ModelId, ModelDef> = {
  agent: { url: '/arena/models/doubleo/agent.glb', height: 1.9, facing: 0, clips: { idle: 'Rig|idle', walk: 'Rig|walk', run: 'Rig|run' } },
  goon: { url: '/arena/models/doubleo/goon.glb', height: 1.85, facing: 0, clips: { idle: 'idle_patrol', walk: 'walk_patrol', run: 'run', death: 'death_1' } },
  bot: { url: '/arena/models/doubleo/bot.glb', height: 2.1, facing: 0, clips: { idle: 'Armature|idol', walk: 'Armature|walk.001', run: 'Armature|walk.001', death: 'Armature|death .001' } }, // 'thwamp' leaps about: no good mid-fight
};
const loaded: Partial<Record<ModelId, GLTF>> = {};
let loading: Promise<void> | null = null;

/** Load the rigged cast once (henchmen + agents). Failures leave the procedural rigs in place. */
export function loadCastModels(): Promise<void> {
  loading ??= (async () => {
    const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    await Promise.all(
      (Object.keys(MODELS) as ModelId[]).map(async (id) => {
        try {
          loaded[id] = await gl.loadAsync(MODELS[id].url);
        } catch {
          /* keep the box rig */
        }
      }),
    );
  })();
  return loading;
}

function findBone(root: THREE.Object3D, ...names: string[]) {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && names.some((n) => o.name.toLowerCase().includes(n))) hit = o;
  });
  return hit as THREE.Object3D | null;
}

/** A Rig backed by a rigged glTF: same interface, so AI, hits and multiplayer don't care. */
function modelRig(id: ModelId, gltf: GLTF, def: CastDef, agent?: string): Rig {
  const md = MODELS[id];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const model = cloneSkinned(gltf.scene); // skinned: a plain clone would keep the original's bones
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const height = agent ? md.height : def.height;
  const k = height / Math.max(0.001, size.y);
  model.scale.multiplyScalar(k);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
  model.position.set(-c.x, -box.min.y * k, -c.z);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false; // skinned bounds lie when animated
    if (agent) {
      // Each player's agent: a dark spy suit that picks up their colour.
      const tint = (mat: THREE.Material) => {
        const n = mat.clone() as THREE.MeshStandardMaterial;
        n.color?.set('#84849a').lerp(new THREE.Color(agent), 0.22); // one texture for suit and face: darken gently
        return n;
      };
      m.material = Array.isArray(m.material) ? m.material.map(tint) : tint(m.material);
    } else {
      // The goon's Thompson ships untextured (white): make it gunmetal.
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[])
        if (mat.name === 'Gun_Thompson' && !mat.map) {
          mat.color.set('#1c1c1f');
          mat.metalness = 0.7;
          mat.roughness = 0.35;
        }
    }
  });
  const turn = new THREE.Group();
  turn.rotation.y = md.facing;
  turn.add(model);
  body.add(turn);

  const eyes: THREE.Mesh[] = [];
  model.updateMatrixWorld(true);
  /** World units → a bone's local units (rigs often carry an armature scale like 0.01). */
  const u = (bone: THREE.Object3D, v: number) => v / Math.max(1e-6, bone.getWorldScale(new THREE.Vector3()).x);
  const chest = findBone(model, 'spine2', 'spine_02', 'chest', 'spine1', 'spine');
  if (agent && chest) {
    // Lapel pin in the player's colour, so squads can tell agents apart at a glance.
    const pin = new THREE.Mesh(new THREE.SphereGeometry(u(chest, 0.05), 12, 8), glow(agent, 2.5));
    pin.position.set(u(chest, 0.1), u(chest, 0.05), u(chest, 0.14));
    chest.add(pin);
  }
  if (id === 'goon' && chest) {
    // The gag survives: a paper wallet pinned to the thug's chest.
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(u(chest, 0.26), u(chest, 0.26)), new THREE.MeshStandardMaterial({ map: paperTex(), roughness: 0.9, side: THREE.DoubleSide }));
    sheet.position.set(0, 0, u(chest, 0.17));
    chest.add(sheet);
  }
  if (id === 'bot') {
    // Its own eye material glows red.
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) if (mat.name === 'eyes' && mat.emissive) {
        mat.emissive.set('#ff2a1a');
        mat.emissiveIntensity = 3;
      }
    });
  }

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map(gltf.animations.map((cl) => [cl.name, mixer.clipAction(cl)] as const));
  let current: THREE.AnimationAction | null = null;
  const play = (name: string | undefined, once = false) => {
    const next = name ? actions.get(name) : undefined;
    if (!next || next === current) return Boolean(next);
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (current) current.crossFadeTo(next, 0.2, false);
    current = next;
    return true;
  };
  play(md.clips.idle);
  let dead = false;

  const w = 0.9 * (height / 1.9);
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(w, height, w), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = height / 2;
  root.add(hitbox);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.3, height * 0.62, 0.55);
  root.add(muzzle);
  const empty = () => new THREE.Group();

  return {
    root,
    body,
    legs: [empty(), empty()],
    arms: [empty(), empty()],
    head: empty(),
    hitbox,
    eyes,
    beams: [],
    muzzle,
    button: null,
    phase: Math.random() * 6,
    anim: (dt, speed, aim) => {
      if (!dead) play(aim && md.clips.attack ? md.clips.attack : speed > 0.6 ? md.clips.run : speed > 0.05 ? md.clips.walk : md.clips.idle);
      mixer.update(dt * (speed > 0.6 && md.clips.run === md.clips.walk ? 1.6 : 1));
    },
    die: () => {
      dead = true;
      return play(md.clips.death, true);
    },
  };
}

/** Build one character facing +Z, feet at y = 0, scaled to its def height. */
export function buildRig(kind: Kind, agent?: string): Rig {
  const def = CAST[kind];
  const mid: ModelId | null = agent ? 'agent' : kind === 'bot' || kind === 'goon' ? kind : null;
  const gltf = mid ? loaded[mid] : undefined;
  if (mid && gltf) return modelRig(mid, gltf, def, agent);
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
    partyboy: { suit: '#5a6a3a', legs: '#2a3a5a', skin: '#e8b898', shirt: '#7a8a5a' },
  };
  const p = agent ? { suit: '#0d0d10', legs: '#0d0d10', skin: '#e2b48e', shirt: '#f4f4f4' } : palette[kind];
  const suit = kind === 'goon' && !agent ? new THREE.MeshStandardMaterial({ map: paperTex(), roughness: 0.9 }) : std(p.suit, kind === 'kingpin' ? { metalness: 0.45, roughness: 0.55 } : kind === 'bot' ? { metalness: 0.7, roughness: 0.35 } : {});
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
  if (agent || (kind !== 'goon' && kind !== 'bot' && kind !== 'hoarder' && kind !== 'partyboy')) {
    // Shirt and tie.
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.02), std(p.shirt));
    shirt.position.set(0, 1.32, 0.19 + belly / 2);
    inner.add(shirt);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.02), agent ? glow(agent, 1.6) : std(kind === 'kingpin' ? '#b0141c' : '#1d3a7a'));
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
  if (kind === 'custodian' && !agent) {
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
  if (kind === 'custodian' && !agent) {
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

  // ── Boss detail: faces, necks, tailoring and signature props (cartoon parody, no likenesses) ──
  if (def.boss) {
    const dark = std('#1a1410', { roughness: 0.9 });
    // Neck.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.14, 16), skin);
    neck.position.y = 1.62;
    inner.add(neck);
    // Ears and nose.
    for (const x of [-0.21, 0.21]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(x, 0.22, 0);
      head.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 12), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.2, 0.22);
    head.add(nose);
    // Eyes (the hoarder's glow already; the rest get cartoon eyes under any shades).
    if (kind !== 'hoarder' && kind !== 'kingpin') {
      for (const x of [-0.075, 0.075]) {
        const white = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 10), std('#ffffff', { roughness: 0.3 }));
        white.position.set(x, 0.27, 0.18);
        head.add(white);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), dark);
        pupil.position.set(x, 0.27, 0.215);
        head.add(pupil);
      }
    }
    // Eyebrows: cartoon-angry, or worried for the custodian.
    for (const sgn of [-1, 1]) {
      const brow = new THREE.Mesh(rbox(0.09, 0.02, 0.02, 0.008), std(kind === 'custodian' ? '#8a8a8a' : '#2a1a10'));
      brow.position.set(sgn * 0.075, 0.33, 0.19);
      brow.rotation.z = sgn * (kind === 'custodian' ? 0.25 : -0.3);
      head.add(brow);
    }
    // Mouth: a grin (or a nervous line for the custodian).
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 20, kind === 'custodian' ? 0.6 : Math.PI), dark);
    mouth.rotation.z = kind === 'custodian' ? Math.PI * 1.35 : Math.PI;
    mouth.position.set(0, 0.13, 0.2);
    head.add(mouth);
    // Tailoring: lapels for the suits, a belt for everyone.
    if (kind === 'kingpin' || kind === 'custodian') {
      for (const sgn of [-1, 1]) {
        const lapel = new THREE.Mesh(rbox(0.1, 0.36, 0.03, 0.01), std(kind === 'kingpin' ? '#7a5f12' : '#44484e', { roughness: 0.5 }));
        lapel.position.set(sgn * (0.13 + belly / 4), 1.38, 0.19 + belly / 2);
        lapel.rotation.z = sgn * 0.35;
        inner.add(lapel);
      }
    }
    const belt = new THREE.Mesh(rbox(0.64 + belly, 0.07, 0.38 + belly, 0.03), std('#151515', { roughness: 0.4 }));
    belt.position.y = 0.9;
    inner.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.02), std('#d4a843', { metalness: 0.9, roughness: 0.25 }));
    buckle.position.set(0, 0.9, 0.2 + belly / 2);
    inner.add(buckle);
  }
  if (kind === 'custodian' && !agent) {
    // Left hand: a support-ticket clipboard.
    const board = new THREE.Mesh(rbox(0.28, 0.36, 0.02, 0.01), std('#6b4a2a'));
    board.position.set(0, -0.82, 0.12);
    board.rotation.x = -0.4;
    arms[0].add(board);
    const ticket = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.3), new THREE.MeshBasicMaterial({ map: textTex('TICKET #48213', '#111', '#f4f4f4', 256, 64) }));
    ticket.position.set(0, 0, 0.012);
    board.add(ticket);
  }
  if (kind === 'hoarder') {
    // He stands on a pile he will never spend.
    const coin = new THREE.CylinderGeometry(0.11, 0.11, 0.025, 18);
    const gold = std('#f2a900', { metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(coin, gold);
      const a = (i * 2.4) % (Math.PI * 2);
      const r = 0.25 + (i % 5) * 0.08;
      c.position.set(Math.cos(a) * r, 0.02 + (i % 3) * 0.03, Math.sin(a) * r);
      c.rotation.set(Math.random() * 0.6, 0, Math.random() * 0.6);
      inner.add(c);
    }
  }
  if (kind === 'partyboy' && !agent) {
    // Big curly hair.
    const hairMat = std('#2b1a12', { roughness: 0.95 });
    for (let i = 0; i < 22; i++) {
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.075 + (i % 3) * 0.015, 10, 8), hairMat);
      const a = (i / 22) * Math.PI * 2;
      const up = i % 2 ? 0.36 : 0.3;
      curl.position.set(Math.cos(a) * 0.19, up + Math.sin(i) * 0.03, Math.sin(a) * 0.19 - 0.02);
      head.add(curl);
    }
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), hairMat);
    crown.scale.set(1, 0.6, 1);
    crown.position.y = 0.38;
    head.add(crown);
    // Cargo shorts over bare shins, and a slogan tee.
    for (const l of legs) {
      const shorts = new THREE.Mesh(rbox(0.28, 0.4, 0.3, 0.06), std('#6b6a4a', { roughness: 0.9 }));
      shorts.position.y = -0.2;
      l.add(shorts);
      const shin = l.children[0] as THREE.Mesh;
      if (shin?.isMesh) shin.material = skin;
    }
    const tee = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.18), new THREE.MeshBasicMaterial({ map: textTex(SAM_CO.toUpperCase(), '#ffffff', '#5a6a3a', 256, 96), transparent: true }));
    tee.position.set(0, 1.3, 0.185);
    inner.add(tee);
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
  if (r.anim) return r.anim(dt, speed, aim);
  r.phase += dt * (4 + speed * 8) * (speed > 0.05 ? 1 : 0);
  const sw = Math.sin(r.phase) * 0.7 * Math.min(1, speed * 1.5);
  r.legs[0].rotation.x = sw;
  r.legs[1].rotation.x = -sw;
  r.arms[0].rotation.x = -sw * 0.8;
  r.arms[1].rotation.x = aim ? -Math.PI / 2 : sw * 0.8;
  r.body.position.y = speed > 0.05 ? Math.abs(Math.cos(r.phase)) * 0.05 : Math.sin(now / 500) * 0.01;
}

/** A tux-wearing agent (other players): black suit, white shirt, a tie in the player's colour. */
export const buildAgent = (tint: string) => buildRig('goon', tint);
