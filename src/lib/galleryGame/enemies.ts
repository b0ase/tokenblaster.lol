/**
 * EROBOTS: TERRORNODE's foot soldiers, our own Tripo characters (bot, frog-bot, graf-bot, stripey-bot, tech) in
 * Neo-Tokyo 2048. They step out of the tower lobby, run down the street, plant themselves and fire palm-bolts
 * at the player; take hits with a recoil flash, scorch decals and sparks; and die on a Mixamo-style death clip
 * followed by a debris burst.
 *
 * Assets: `public/gallery/erobots/{hi,lo}/<id>.glb` (meshopt + WebP, Mixamo skeleton at identity rest) and one
 * shared clip library, `mixamo-anims.glb` (Quaternius UAL, CC0), retargeted by bone name at load (port of
 * ninja-punk-girls-com `rigMocap.ts` / `rig.ts`). See public/gallery/erobots/LICENSE-quaternius.txt.
 *
 * Performance: one pooled slot per live enemy (cap 10 High / 6 Low), built once. Geometry, textures and the
 * retargeted clips are shared by every clone (SkeletonUtils.clone shares geometry; only skeleton + a tiny
 * material wrapper are per slot), High loads the 36k-tri models, Low the 9k-tri ones. Hit tests are analytic
 * ray-vs-sphere against bone-following proxies (no mesh raycasts). Nothing allocates in the frame loop.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { halo } from '../bsvgun/targets';
import type { Fx } from '../bsvgun/fx';
import type { Bolts } from './combat';
import { TUNING, ramp, roleWeights } from './tuning';

const ROOT = '/gallery/erobots';
const IDS = ['bot', 'tech', 'frog-bot', 'stripey-bot', 'graf-bot'] as const;
type Id = (typeof IDS)[number];
/** Standing height in metres: menacing, a head taller than a person. */
const HEIGHT = 2.2;
const HP = TUNING.erobots.hp;
const rand = (r: readonly [number, number]) => r[0] + Math.random() * (r[1] - r[0]);

// ── Retarget (port of rigMocap.ts) ───────────────────────────────────────────────────────────────────────

/** The Hips position track was baked at Kimiko's rest height; each model gets its offset. */
const KIMIKO_HIPS = new THREE.Vector3(-0.0172, 0.2806, 0.0248);
const HIPS_REST: Record<Id, THREE.Vector3> = {
  bot: new THREE.Vector3(0, 0.25, 0.0387),
  tech: new THREE.Vector3(0, 0.25, 0.0334),
  'graf-bot': new THREE.Vector3(0, 0.25, 0.0356),
  'frog-bot': new THREE.Vector3(0, 0.25, 0.0468),
  'stripey-bot': new THREE.Vector3(0, 0.25, 0.0696),
};
const keyOf = (n: string) => n.replace(/^mixamorig\d*[:_]?/, '');
let library: Promise<THREE.AnimationClip[]> | null = null;
const loadLibrary = () =>
  (library ??= new GLTFLoader()
    .loadAsync(`${ROOT}/mixamo-anims.glb`)
    .then((g) => g.animations)
    .catch(() => []));

function retarget(src: THREE.AnimationClip[], model: THREE.Object3D, id: Id): Map<string, THREE.AnimationClip> {
  const names = new Map<string, string>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) names.set(keyOf(o.name), o.name);
  });
  const off = HIPS_REST[id].clone().sub(KIMIKO_HIPS);
  const spineDamp = 0.3;
  const hipsDamp = 0.2;
  const q = new THREE.Quaternion();
  const ident = new THREE.Quaternion();
  const out = new Map<string, THREE.AnimationClip>();
  for (const c of src) {
    const tracks = c.tracks.flatMap((t) => {
      const dot = t.name.lastIndexOf('.');
      const bn = keyOf(t.name.slice(0, dot));
      const bone = names.get(bn);
      if (!bone || /^(Neck|Head)$/.test(bn)) return []; // the big heads ride on the spine
      const k = t.clone();
      k.name = `${bone}${t.name.slice(dot)}`;
      const damp = /^Spine\d?$/.test(bn) ? spineDamp : bn === 'Hips' ? hipsDamp : 0;
      if (damp > 0 && t.name.endsWith('.quaternion')) {
        const v = k.values;
        for (let i = 0; i < v.length; i += 4) q.fromArray(v, i).slerp(ident, damp).toArray(v, i);
      }
      if (t.name.endsWith('.position')) {
        const v = k.values;
        for (let i = 0; i < v.length; i += 3) {
          v[i] += off.x;
          v[i + 1] += off.y;
          v[i + 2] += off.z;
        }
      }
      return [k];
    });
    out.set(c.name, new THREE.AnimationClip(c.name, c.duration, tracks));
  }
  return out;
}

// ── Shared scratch / textures ────────────────────────────────────────────────────────────────────────────

const V = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
};
let decalTex: THREE.CanvasTexture | null = null;
function scorchTexture() {
  if (decalTex) return decalTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,200,120,0.95)');
  r.addColorStop(0.18, 'rgba(255,110,40,0.85)');
  r.addColorStop(0.42, 'rgba(18,10,8,0.9)');
  r.addColorStop(0.75, 'rgba(8,6,6,0.35)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  decalTex = new THREE.CanvasTexture(c);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  return decalTex;
}

/** Hit proxies: bone, child bone (the sphere sits halfway to it), radius as a fraction of height. */
const PROXIES: [string, string | null, number][] = [
  ['Head', 'HeadTop_End', 0.105], // index 0: the head (double damage)
  ['Spine2', 'Neck', 0.125],
  ['Spine', 'Spine1', 0.11],
  ['Hips', 'Spine', 0.1],
  ['LeftUpLeg', 'LeftLeg', 0.065],
  ['RightUpLeg', 'RightLeg', 0.065],
  ['LeftLeg', 'LeftFoot', 0.055],
  ['RightLeg', 'RightFoot', 0.055],
  ['LeftArm', 'LeftForeArm', 0.05],
  ['RightArm', 'RightForeArm', 0.05],
];

type State = 'off' | 'boot' | 'run' | 'aim' | 'melee' | 'dying' | 'down';
type Role = 'shooter' | 'rusher' | 'flanker';
type Slot = {
  id: Id;
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  act: Record<'walk' | 'run' | 'aim' | 'shoot' | 'hurt' | 'death' | 'knock' | 'punch' | 'hook', THREE.AnimationAction>;
  cur: THREE.AnimationAction | null;
  mats: THREE.MeshStandardMaterial[];
  proxies: { bone: THREE.Object3D; local: THREE.Vector3; r: number }[];
  hand: THREE.Object3D | null;
  decals: THREE.Mesh[];
  decalI: number;
  glow: THREE.Sprite;
  state: State;
  t: number;
  hp: number;
  flash: number;
  stopZ: number;
  strafe: number;
  baseX: number;
  speed: number;
  nextShot: number;
  hurtT: number;
  boot: number;
  burst: boolean;
  role: Role;
  /** Flankers: which side they swing out to, and how far. */
  side: number;
  flankX: number;
  startZ: number;
  /** Seconds of palm charge left before a bolt leaves (telegraph), and until the next one starts. */
  charge: number;
  /** Melee: seconds to the next swing, and to the damage of the swing in progress (-1 none). */
  swingIn: number;
  swingHit: number;
  meleeX: number;
  /** Knock-back velocity while dying. */
  dv: THREE.Vector3;
};

export type ErHit = { slot: Slot; point: THREE.Vector3; dist: number; head: boolean };
export type ErResult = { killed: boolean; heavy: boolean; score: number };

/** Where the Erobots come from and how they move in the current stage's set (tuned per stage in tuning.ts). */
export type Lane = { spawnZ: number; halfW: number; stopZ: readonly [number, number]; flankX: readonly [number, number]; strafeX: number; snipeX: number; liveBase: number; liveCap: number; wallX: number };

export class ErobotWave {
  /** Resolves when the models are in and enemies can spawn (the game doesn't wait for it). */
  ready: Promise<void>;
  private slots: Slot[] = [];
  private cap: number;
  private group = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private decalMat: THREE.MeshBasicMaterial;
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  private spawnT = 1.5;
  private hold = 0;
  private disposed = false;
  private marker: HTMLDivElement | null = null;
  private markerT = 0;
  private markAt = 0;
  /** Camera shake the engine should add this frame (0..1), read-and-clear. */
  impulse = 0;
  kills = 0;
  /** The stage's level: damage, fire rate, speed and health scale with it (tuning.ts waveRamp). */
  wave = 1;
  /** The current stage's lane (spawn line, plant depth, widths, live caps). */
  lane: Lane = TUNING.stages[0].lane;
  /** Seconds of grace left: nobody fires or swings until it runs out (the opening, and after Continue). */
  grace: number = TUNING.player.openingGrace;
  /** False while the player is down: nobody attacks. */
  playerAlive = true;
  /** Dev only: false stops new spawns. */
  spawning = true;

  constructor(
    private scene: THREE.Scene,
    private fx: Fx,
    private opts: { high: boolean; canvas: HTMLCanvasElement; reticle: () => { x: number; y: number }; light?: THREE.PointLight; flash?: (at: THREE.Vector3, color: string, intensity: number, ms: number) => void; bolts: Bolts; melee: (from: THREE.Vector3, dmg: number) => void },
  ) {
    this.cap = opts.high ? 10 : 6;
    this.group.name = 'erobots';
    scene.add(this.group);
    this.decalMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false, color: new THREE.Color(1.5, 1.2, 1.1) });
    this.makeMarker();
    this.ready = this.load().catch(() => undefined);
  }

  /** Chest of the nearest live enemy (for the dev auto-aim). */
  nearest(out: THREE.Vector3): boolean {
    let best = 1e9;
    let found = false;
    for (const s of this.slots) {
      if (s.state !== 'run' && s.state !== 'aim' && s.state !== 'melee') continue;
      const d = s.root.position.lengthSq();
      if (d < best) {
        best = d;
        found = true;
        out.copy(s.root.position).setY(1.4);
      }
    }
    return found;
  }

  get live() {
    let n = 0;
    for (const s of this.slots) if (s.state === 'boot' || s.state === 'run' || s.state === 'aim' || s.state === 'melee') n++;
    return n;
  }

  // ── Loading ──

  private async load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const dir = this.opts.high ? 'hi' : 'lo';
    const [lib, ...gl] = await Promise.all([loadLibrary(), ...IDS.map((id) => loader.loadAsync(`${ROOT}/${dir}/${id}.glb`).catch(() => null))]);
    if (this.disposed || !lib.length) return;
    const clipsById = new Map<Id, Map<string, THREE.AnimationClip>>();
    IDS.forEach((id, i) => {
      if (gl[i]) clipsById.set(id, retarget(lib, gl[i]!.scene, id));
    });
    const have = IDS.filter((id) => gl[IDS.indexOf(id)]);
    if (!have.length) return;
    for (let i = 0; i < this.cap; i++) {
      const id = have[i % have.length];
      this.slots.push(this.makeSlot(id, gl[IDS.indexOf(id)]!.scene, clipsById.get(id)!));
    }
  }

  private makeSlot(id: Id, src: THREE.Object3D, clips: Map<string, THREE.AnimationClip>): Slot {
    const model = cloneSkinned(src);
    const mats: THREE.MeshStandardMaterial[] = [];
    let hand: THREE.Object3D | null = null;
    model.traverse((o) => {
      if (/^Icosphere/.test(o.name)) o.visible = false;
      if ((o as THREE.Bone).isBone && !hand && /RightHand$/.test(o.name)) hand = o;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        m.castShadow = this.opts.high;
        const mat = (m.material as THREE.MeshStandardMaterial).clone(); // textures stay shared
        mat.envMapIntensity = 1.4;
        mat.emissive = new THREE.Color('#000000');
        m.material = mat;
        mats.push(mat);
      }
    });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const s = HEIGHT / (box.max.y - box.min.y || 1);
    model.scale.setScalar(s);
    model.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    const root = new THREE.Group();
    root.add(model);
    root.visible = false;
    this.group.add(root);
    model.updateMatrixWorld(true);

    const bones = new Map<string, THREE.Object3D>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(keyOf(o.name), o);
    });
    const proxies: Slot['proxies'] = [];
    const ws = new THREE.Vector3();
    for (const [bn, cn, r] of PROXIES) {
      const b = bones.get(bn);
      if (!b) continue;
      const c = cn ? bones.get(cn) : null;
      b.getWorldScale(ws);
      proxies.push({ bone: b, local: c ? c.position.clone().multiplyScalar(0.5) : new THREE.Vector3(), r });
    }

    const mixer = new THREE.AnimationMixer(model);
    const mk = (name: string, loop: boolean, scale = 1) => {
      const clip = clips.get(name) ?? clips.get('Idle_Loop')!;
      const a = mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.timeScale = scale;
      return a;
    };
    const act = {
      walk: mk('Walk_Loop', true, 1.1),
      run: mk('Sprint_Loop', true, 0.9),
      aim: mk('Spell_Simple_Idle_Loop', true),
      shoot: mk('Spell_Simple_Shoot', false, 1.3),
      hurt: mk('Hit_Chest', false, 1.5),
      death: mk('Death01', false, 1.1),
      knock: mk('Hit_Knockback', false, 1.1),
      punch: mk('Punch_Jab', false, 1.5),
      hook: mk('Melee_Hook', false, 1.4),
    };
    const glow = halo('#ff3a22', 1.3, 0);
    this.group.add(glow);
    const decals: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.visible = false;
      d.userData.noAO = true;
      decals.push(d);
    }
    return { id, root, model, mixer, act, cur: null, mats, proxies, hand, decals, decalI: 0, glow, state: 'off', t: 0, hp: HP, flash: 0, stopZ: -14, strafe: 0, baseX: 0, speed: 6, nextShot: 0, hurtT: 0, boot: 0, burst: false, role: 'shooter', side: 1, flankX: 12, startZ: 0, charge: 0, swingIn: 0, swingHit: -1, meleeX: 0, dv: new THREE.Vector3() };
  }

  // ── Spawning ──

  private play(s: Slot, a: THREE.AnimationAction, fade = 0.2) {
    if (s.cur === a) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    s.cur?.fadeOut(fade);
    s.cur = a;
  }

  private spawn(s: Slot) {
    const T = TUNING.erobots;
    const w = this.wave;
    const rw = roleWeights(w);
    const r = Math.random();
    s.role = r < rw.shooter ? 'shooter' : r < rw.shooter + rw.rusher ? 'rusher' : 'flanker';
    s.state = 'boot';
    s.t = 0;
    s.boot = 0;
    s.hp = HP * ramp(TUNING.waveRamp.erobotHp, w);
    s.flash = 0;
    s.burst = false;
    s.charge = 0;
    s.swingIn = 0;
    s.swingHit = -1;
    s.dv.set(0, 0, 0);
    s.speed = rand(T.runSpeed) * ramp(TUNING.waveRamp.erobotSpeed, w);
    s.stopZ = rand(this.lane.stopZ);
    s.strafe = (Math.random() < 0.5 ? -1 : 1) * T.strafeSpeed * (0.6 + Math.random() * 0.6);
    s.nextShot = (1.0 + Math.random() * 1.5) / ramp(TUNING.waveRamp.erobotRate, w);
    s.side = Math.random() < 0.5 ? -1 : 1;
    s.flankX = rand(this.lane.flankX);
    s.meleeX = (Math.random() - 0.5) * 3.2;
    const x = (Math.random() - 0.5) * 2 * this.lane.halfW;
    s.baseX = x;
    s.startZ = this.lane.spawnZ;
    s.root.position.set(x, 0, s.startZ);
    s.root.rotation.set(0, 0, 0);
    s.root.scale.set(1, 0.05, 1);
    s.root.visible = true;
    for (const d of s.decals) {
      d.visible = false;
      d.parent?.remove(d);
    }
    for (const m of s.mats) m.emissive.set('#27e6ff');
    this.play(s, s.act.walk, 0.05);
    V.a.set(x, 1.2, this.lane.spawnZ);
    this.fx.ring(V.a, '#27e6ff', 3.2, 0.5);
    this.fx.sparks(V.a, '#7cf9ff', 24, 7);
    this.opts.flash?.(V.a, '#27c8e0', 70, 400); // teleport-in
  }

  /** Switch to a stage's lane and level. Anything still on the floor is cleared. */
  setStage(lane: Lane, level: number) {
    this.lane = lane;
    this.wave = level;
    this.clearAll();
  }

  /** Drop everything on the street (Continue): the wave starts again from nothing. */
  clearAll() {
    for (const s of this.slots) {
      s.state = 'off';
      s.root.visible = false;
      s.cur = null;
      s.mixer.stopAllAction();
      for (const d of s.decals) d.parent?.remove(d);
    }
    this.spawnT = 1.5;
    this.hold = 0;
  }

  // ── Frame ──

  update(dt: number, camera: THREE.Camera, trigger: boolean) {
    if (!this.slots.length) return;
    const T = TUNING.erobots;
    const w = this.wave;
    this.grace = Math.max(0, this.grace - dt);
    // Hold the trigger and the lobby disgorges more of them; let go and the wave thins to a trickle.
    this.hold = trigger ? Math.min(14, this.hold + dt) : Math.max(0, this.hold - dt * 1.5);
    const L = this.lane;
    const capW = Math.min(this.cap, L.liveCap);
    const want = Math.min(capW, L.liveBase + Math.floor(this.hold * T.holdBonusPerSec));
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.live < want && this.spawning) {
      const free = this.slots.find((s) => s.state === 'off');
      if (free) this.spawn(free);
      this.spawnT = Math.max(T.spawnMin, (T.spawnEvery - this.hold * 0.05) / ramp(TUNING.waveRamp.erobotRate, w));
    }
    const cx = camera.position.x;
    const rate = ramp(TUNING.waveRamp.erobotRate, w);
    for (const s of this.slots) {
      if (s.state === 'off') continue;
      s.t += dt;
      s.mixer.update(dt);
      // hit flash decays (emissive back to the boot-up cyan or nothing)
      s.flash = Math.max(0, s.flash - dt * 6);
      const e = s.flash;
      const boot = s.state === 'boot' ? Math.max(0, 1 - s.t / 0.5) : 0;
      const burn = s.state === 'dying' ? Math.max(0, 1 - s.t / 1.6) : 0;
      for (const m of s.mats) {
        if (burn > 0.01) m.emissive.setRGB(1, 0.32, 0.08);
        else if (e > 0.01) m.emissive.setRGB(1, 0.45, 0.15);
        else m.emissive.setRGB(0.15 * boot, 0.9 * boot, 1 * boot);
        m.emissiveIntensity = burn > 0.01 ? burn * 2.2 : e > 0.01 ? e * 1.4 : boot * 1.6;
      }
      const p = s.root.position;
      switch (s.state) {
        case 'boot': {
          s.boot = Math.min(1, s.t / 0.35);
          s.root.scale.set(1, 0.05 + 0.95 * (1 - Math.pow(1 - s.boot, 3)), 1);
          p.z += s.speed * 0.5 * dt;
          if (s.t > 0.5) {
            s.state = 'run';
            s.root.scale.set(1, 1, 1);
            this.play(s, s.act.run, 0.25);
          }
          break;
        }
        case 'run': {
          p.z += s.speed * dt;
          const stop = s.role === 'shooter' ? s.stopZ : TUNING.erobots.melee.stopZ;
          const u = THREE.MathUtils.clamp((p.z - s.startZ) / (stop - s.startZ), 0, 1);
          if (s.role === 'flanker') {
            // swing wide along an arc, then cut in on the player
            p.x = s.baseX * (1 - u) + s.side * s.flankX * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * u) + s.meleeX * u * u * u;
            // and snipe on the way in
            s.nextShot -= dt;
            if (s.nextShot <= 0 && Math.abs(p.x) > this.lane.snipeX && this.grace <= 0 && this.playerAlive) {
              s.nextShot = (1.6 + Math.random() * 1.4) / rate;
              this.fireBolt(s, camera);
            }
          } else if (s.role === 'rusher') {
            p.x = s.baseX * (1 - u) + s.meleeX * u + Math.sin(s.t * 3.1 + s.baseX) * 0.9 * (1 - u);
          } else p.x = s.baseX + Math.sin(s.t * 1.7 + s.baseX) * 0.8;
          this.face(s, cx, p.z, dt, 7);
          if (p.z >= stop) {
            if (s.role === 'shooter') {
              s.state = 'aim';
              s.t = 0;
              this.play(s, s.act.aim, 0.3);
            } else {
              s.state = 'melee';
              s.t = 0;
              s.swingIn = 0.15;
              this.play(s, s.act.aim, 0.15);
            }
          }
          break;
        }
        case 'aim': {
          // keep the pressure on: strafe fast and creep in
          p.x += s.strafe * dt;
          if (Math.abs(p.x) > this.lane.strafeX) s.strafe = -s.strafe;
          p.x = THREE.MathUtils.clamp(p.x, -this.lane.wallX, this.lane.wallX);
          p.z = Math.min(-6, p.z + T.creepSpeed * dt);
          this.face(s, cx, p.z, dt, 8);
          if (s.charge > 0) {
            s.charge -= dt;
            if (s.charge <= 0 && this.playerAlive) {
              s.act.shoot.reset().setEffectiveWeight(1).fadeIn(0.1).play();
              s.act.shoot.crossFadeTo?.(s.act.aim, 0, false);
              s.cur = s.act.shoot;
              this.fireBolt(s, camera);
              s.hurtT = 0.55; // returns to aim after the cast
            }
          } else if (this.grace <= 0 && this.playerAlive) {
            s.nextShot -= dt;
            if (s.nextShot <= 0) {
              s.nextShot = rand(T.bolt.every) / rate;
              s.charge = 0.28; // the palm lights up first: a fair warning
            }
          }
          if (s.cur === s.act.shoot || s.cur === s.act.hurt) {
            s.hurtT -= dt;
            if (s.hurtT <= 0) this.play(s, s.act.aim, 0.2);
          }
          break;
        }
        case 'melee': {
          // right in the player's face: swing, wind-up first, then the damage
          p.x += (s.meleeX - p.x) * Math.min(1, dt * 3);
          this.face(s, cx, p.z, dt, 10);
          if (s.swingHit >= 0) {
            s.swingHit -= dt;
            if (s.swingHit <= 0) {
              s.swingHit = -1;
              if (this.playerAlive && this.grace <= 0) this.opts.melee(V.a.copy(p).setY(1.4), T.melee.damage * ramp(TUNING.waveRamp.erobotDamage, w));
            }
          } else {
            s.swingIn -= dt;
            if (s.swingIn <= 0 && this.grace <= 0 && this.playerAlive) {
              s.swingIn = T.melee.every / Math.sqrt(rate);
              s.swingHit = T.melee.windup;
              const a = Math.random() < 0.5 ? s.act.punch : s.act.hook;
              a.reset().setEffectiveWeight(1).fadeIn(0.06).play();
              s.cur = a;
            }
          }
          if (s.swingHit < 0 && s.cur !== s.act.aim && s.cur !== s.act.hurt && s.swingIn < T.melee.every * 0.35) this.play(s, s.act.aim, 0.2);
          break;
        }
        case 'dying': {
          p.addScaledVector(s.dv, dt);
          s.dv.multiplyScalar(Math.exp(-dt * 3.2));
          if (!s.burst && s.t > 0.4) {
            s.burst = true;
            this.fx.sparks(V.a.copy(p).setY(0.9), '#ff6a2a', 40, 11);
            this.fx.shatter(V.a, '#566074', 20, 8, 0.9);
            this.fx.ring(V.a, '#ff9a4a', 3.4, 0.45);
            this.opts.flash?.(V.a, '#ff6a2a', 90, 1300); // the wreck goes up and burns on
          }
          if (s.t > 2.0) {
            s.state = 'down';
            s.t = 0;
          }
          break;
        }
        case 'down': {
          // sink through the sidewalk after a beat so corpses never pile up
          p.y -= dt * 1.4;
          if (s.t > 1.1) {
            s.state = 'off';
            s.root.visible = false;
            s.cur = null;
            s.mixer.stopAllAction();
            for (const d of s.decals) d.parent?.remove(d);
          }
          break;
        }
      }
      // heat glow at the palm while charging or shooting
      const charging = s.charge > 0 ? 1 - s.charge / 0.28 : 0;
      s.glow.material.opacity = s.state === 'aim' ? Math.max(charging * 1.4, s.cur === s.act.shoot ? Math.max(0, s.hurtT - 0.2) * 1.6 : 0) : 0;
      if (s.glow.material.opacity > 0 && s.hand) s.glow.position.setFromMatrixPosition(s.hand.matrixWorld);
    }
    // hit-marker fade
    if (this.markerT > 0 && this.marker) {
      this.markerT -= dt;
      if (this.markerT <= 0) this.marker.style.opacity = '0';
    }
  }

  private face(s: Slot, cx: number, z: number, dt: number, rate: number) {
    const want = Math.atan2(cx - s.root.position.x, 0 - z);
    let d = want - s.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.root.rotation.y += d * Math.min(1, dt * rate);
  }

  private fireBolt(s: Slot, camera: THREE.Camera) {
    const B = TUNING.erobots.bolt;
    const w = this.wave;
    const from = (s.hand ? V.b.setFromMatrixPosition(s.hand.matrixWorld) : V.b.copy(s.root.position).setY(1.6)).clone();
    const miss = Math.random() < Math.max(B.missMin, B.miss - B.missPerWave * (w - 1));
    // a true bolt is aimed at the player's head; a wide one whips past to either side
    const target = V.c.copy(camera.position);
    if (miss) target.add(V.d.set((Math.random() < 0.5 ? -1 : 1) * (1.4 + Math.random() * 1.6), (Math.random() - 0.4) * 1.2, 0));
    else target.add(V.d.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, 0));
    this.opts.bolts.fire(from, target, B.speed * ramp(TUNING.waveRamp.erobotSpeed, w), B.damage * ramp(TUNING.waveRamp.erobotDamage, w), '#ff4a30', !miss);
    this.fx.sparks(from, '#ff7a50', 6, 4);
    this.opts.flash?.(from, '#ff3a2a', 55, 110); // muzzle flash on the robot's arm
    if (miss) this.impulse = Math.max(this.impulse, 0.08);
  }

  // ── Hits ──

  /** Nearest enemy proxy the ray strikes before `maxDist` (analytic spheres on the animated bones). */
  raycast(org: THREE.Vector3, dir: THREE.Vector3, maxDist: number): ErHit | null {
    let best: ErHit | null = null;
    let bd = maxDist;
    for (const s of this.slots) {
      if (s.state === 'off' || s.state === 'down') continue;
      for (let i = 0; i < s.proxies.length; i++) {
        const pr = s.proxies[i];
        V.a.copy(pr.local).applyMatrix4(pr.bone.matrixWorld);
        const r = pr.r * HEIGHT * TUNING.erobots.hitScale;
        V.d.subVectors(V.a, org);
        const tc = V.d.dot(dir);
        if (tc < 0) continue;
        const d2 = V.d.lengthSq() - tc * tc;
        if (d2 > r * r) continue;
        const th = tc - Math.sqrt(r * r - d2);
        if (th < bd && th > 0) {
          bd = th;
          if (!best) best = { slot: s, point: new THREE.Vector3(), dist: th, head: false };
          best.slot = s;
          best.dist = th;
          best.head = i === 0;
          best.point.copy(dir).multiplyScalar(th).add(org);
        }
      }
    }
    return best;
  }

  /** Apply `dmg` to the struck robot. */
  hit(h: ErHit, dmg: number, dir: THREE.Vector3): ErResult {
    const s = h.slot;
    const at = h.point;
    if (s.state === 'dying' || s.state === 'down' || s.state === 'off') return { killed: false, heavy: false, score: 0 };
    const total = dmg * (h.head ? TUNING.erobots.headMultiplier : 1);
    s.hp -= total;
    s.flash = 1;
    this.fx.sparks(at, h.head ? '#ffe9a0' : '#ffb347', h.head ? 5 : 3, 6);
    if (Math.random() < 0.5) this.opts.flash?.(at, h.head ? '#ffe9a0' : '#ffb347', 30, 70);
    this.addDecal(s, at, dir);
    if (s.hp <= 0) {
      this.kill(s, at, dir, h.head);
      this.mark(true, h.head);
      return { killed: true, heavy: true, score: h.head ? 450 : 300 };
    }
    // flinch (skip the clip while it's mid-cast to keep aiming readable); a charging shooter is interrupted
    if (s.state === 'aim' || s.state === 'run') {
      if (s.state === 'aim' || Math.random() < 0.35) {
        s.charge = 0;
        s.act.hurt.reset().setEffectiveWeight(1).fadeIn(0.05).play();
        s.cur = s.act.hurt;
        s.hurtT = 0.45;
        if (s.state === 'run') {
          s.hurtT = 0.01;
        }
      }
    }
    this.mark(false, h.head);
    return { killed: false, heavy: total >= HP * 0.35, score: Math.round(total) };
  }

  private kill(s: Slot, at: THREE.Vector3, dir: THREE.Vector3, head: boolean) {
    s.state = 'dying';
    s.t = 0;
    s.charge = 0;
    s.swingHit = -1;
    this.kills++;
    // half the deaths fly back along the shot, half drop where they stand
    const knock = Math.random() < 0.55;
    const a = knock ? s.act.knock : s.act.death;
    a.reset().setEffectiveWeight(1).fadeIn(0.05).play();
    s.cur?.fadeOut(0.1);
    s.cur = a;
    s.dv.set(dir.x, 0, dir.z).normalize().multiplyScalar(knock ? 8.5 : 3.5);
    this.fx.sparks(at, '#ff6a2a', 46, 13);
    this.fx.sparks(at, '#ffe9a0', head ? 30 : 14, 16);
    this.fx.shatter(at, '#566074', 26, 9, 0.9);
    this.fx.shatter(at, '#27e6ff', 8, 7, 0.45);
    this.fx.ring(at, '#ff6a2a', 3.4, 0.4);
    this.opts.flash?.(at, '#ff7a30', head ? 160 : 120, 560);
    if (this.opts.light) {
      this.opts.light.position.copy(at);
      this.opts.light.color.set('#ff7a30');
      this.opts.light.intensity = 130;
    }
    this.impulse = Math.max(this.impulse, head ? 0.5 : 0.3);
  }

  private addDecal(s: Slot, at: THREE.Vector3, dir: THREE.Vector3) {
    // stick a scorch mark on the nearest proxy's bone so it rides the animation
    let near: Slot['proxies'][number] | null = null;
    let nd = 1e9;
    for (const pr of s.proxies) {
      const d = V.a.copy(pr.local).applyMatrix4(pr.bone.matrixWorld).distanceToSquared(at);
      if (d < nd) {
        nd = d;
        near = pr;
      }
    }
    if (!near) return;
    const d = s.decals[s.decalI++ % s.decals.length];
    d.parent?.remove(d);
    near.bone.add(d);
    // sit just off the surface (towards the shooter), facing it
    V.b.copy(at).addScaledVector(dir, -0.04);
    d.position.copy(near.bone.worldToLocal(V.b));
    const bs = near.bone.getWorldScale(V.c).x || 1;
    const size = (0.22 + Math.random() * 0.14) / bs;
    d.scale.setScalar(size);
    const q = near.bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    const look = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), V.a.copy(dir).negate());
    d.quaternion.copy(q.multiply(look));
    d.rotateZ(Math.random() * 6.28);
    d.visible = true;
  }

  // ── Hit marker (a DOM overlay at the reticle; the engine's HUD isn't touched) ──

  private makeMarker() {
    const host = this.opts.canvas.parentElement;
    if (!host) return;
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;pointer-events:none;opacity:0;z-index:5;will-change:transform,opacity';
    el.innerHTML =
      '<svg viewBox="-22 -22 44 44" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="filter:drop-shadow(0 0 4px currentColor)">' +
      '<path d="M-14-14L-6-6M14-14L6-6M-14 14L-6 6M14 14L6 6"/></svg>';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(el);
    this.marker = el;
  }

  /** Pop the hit-marker: white tick on a hit, bigger red on a kill, gold on a head hit. */
  mark(kill: boolean, head = false) {
    const el = this.marker;
    if (!el) return;
    const now = performance.now();
    if (!kill && now - this.markAt < 55) return; // 40 rays a frame: one pop is plenty
    this.markAt = now;
    const r = this.opts.reticle();
    el.style.color = kill ? '#ff4a3a' : head ? '#ffd24a' : '#ffffff';
    el.style.transition = 'none';
    el.style.opacity = '1';
    el.style.transform = `translate(${r.x}px,${r.y}px) scale(${kill ? 1.5 : 1.1})`;
    void el.offsetWidth;
    el.style.transition = 'transform 140ms ease-out, opacity 260ms ease-in';
    el.style.transform = `translate(${r.x}px,${r.y}px) scale(${kill ? 1.1 : 0.85})`;
    this.markerT = kill ? 0.3 : 0.12;
  }

  dispose() {
    this.disposed = true;
    this.marker?.remove();
    for (const s of this.slots) {
      s.mixer.stopAllAction();
      s.glow.material.dispose();
      s.mats.forEach((m) => m.dispose());
    }
    // geometry and textures are shared with the loader cache of the (now gone) scene: free them once
    const seen = new Set<THREE.BufferGeometry>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && m.geometry !== this.decalGeo && !seen.has(m.geometry)) {
        seen.add(m.geometry);
        m.geometry.dispose();
      }
    });
    this.decalGeo.dispose();
    this.decalMat.dispose();
    this.scene.remove(this.group);
    this.geos.forEach((g) => g.dispose());
  }
}
