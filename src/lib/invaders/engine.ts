/**
 * Mempool Invaders engine (three.js). Every ship is a live BSV transaction: shape and colour by kind, size by
 * bytes, ticker labels on tokens. The formation is sized from the mempool backlog, fresh txs dive in while you
 * fight, blasts cross as saucers, a block landing summons a boss. Combo, power-ups, bombs, beat-synced
 * everything. The React shell (src/components/MempoolInvaders.tsx) owns menus, HUD text and the coin-op.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { FeedTx, TxKind } from '../feed';
import { lootFrom, type Loot } from '../loot';
import { refreshLoot } from '../lootCanvas';
import { tokenMeta } from '../tokenMeta';
import { sfx } from '../sfx';
import { InvadersAudio } from './audio';
import { disposeAvatarTag, fitAvatarTag, makeAvatarTag, tagKey } from '../avatarTag';
import type { RaceLink } from '../racemp/session';
import { InvadersNet, claimBeats, mulberry32, type BoltRow, type Claim, type InvCfg, type NetHandlers, type Peer, type SpawnMsg, type WaveMsg, type WireRow } from './mp';
import {
  Atlas, Billboards, Particles, drawPopup, drawPowerIcon, drawTokenLabel, drawTxLabel, hullGeometry, hullMaterial, makeFarBlocks, makeFloor, makeHullMesh, makeRails, makeSky, makeStars, playerGeometry,
  type HullMesh, type Q,
} from './art';
import {
  COMBO_WINDOW, HW, KIND_HEX, KIND_NAME, KIND_ORDER, KIND_POINTS, POWER_META, comboKill, comboTick, fireDelay, fireSpecs, formationSlots, hpFor, multFor, newCombo, nextMultAt, pressureFrom, rollPower, sizeFor, waveSpec,
  type Combo, type Power, type ShotSpec, type Slot,
} from './sim';

export type Phase = 'loading' | 'menu' | 'playing' | 'paused' | 'over';
export type Hud = {
  score: number; hi: number; lives: number; maxLives: number; wave: number; combo: number; mult: number; comboT: number; nextAt: number | null; bombs: number; shield: boolean;
  powers: { key: Power; t: number }[]; boss: { name: string; hp: number } | null; pressure: number; txs: number; left: number; kills: number; beat: number; fps: number;
};
export type Result = { score: number; wave: number; kills: number; maxCombo: number; secs: number; tokens: number; bosses: number; team?: number; board?: BoardRow[]; mode?: 'coop' | 'versus' };
/** One pilot on the multiplayer scoreboard. */
export type BoardRow = { id: string; handle: string | null; name: string; verified: boolean; colour: string; score: number; kills: number; lives: number; down: boolean; me: boolean };
export type Toast = { text: string; tone: 'good' | 'bad' | 'info' };
export type Banner = { title: string; sub: string; tone: 'wave' | 'boss' | 'clear' };
export type Callbacks = {
  onPhase: (p: Phase) => void;
  onHud: (h: Hud) => void;
  onToast: (t: Toast) => void;
  onBanner: (b: Banner) => void;
  onLoading: (msg: string, pct: number) => void;
  onOver: (r: Result) => void;
  onLoot: (l: Loot) => void;
  onFlash: (k: 'hit' | 'bomb' | 'power' | 'beat') => void;
  onPerf?: (p: { fps: number; level: number }) => void;
  /** LIVE mode: a shot or power-up use could not be paid (no ammo loaded). */
  onNoAmmo?: () => void;
  /** Multiplayer scoreboard (about 4 Hz, only when it changed). */
  onBoard?: (rows: BoardRow[], mode: 'coop' | 'versus', team: number) => void;
};
export type Opts = { quality: Q; take: (pred?: (f: FeedTx) => boolean) => FeedTx | null; waiting: () => number; status: () => string; hi: number; cb: Callbacks;
  /** Pay-per-action hook (LIVE token-blasting): queue one tiny tx for this action. false = cannot pay, so the action is refused. Free modes always return true. */
  payFor: (action: string[]) => boolean;
  /** Multiplayer: the room link (set before begin() when the room leader said GO). */
  mp?: RaceLink<InvCfg>;
  /** Multiplayer: how this pilot is named locally (X handle shown over the ship). */
  me?: { name: string; handle: string | null };
};

type Inv = {
  alive: boolean; kind: TxKind; ghost: boolean; tx: FeedTx | null; col: THREE.Color; size: number; hp: number; maxHp: number; x: number; gy: number; vx: number; mode: 'form' | 'dive' | 'saucer';
  slot: Slot | null; col0: number; t: number; delay: number; flash: number; charge: number; fireIn: number; label: number; loot: Loot | null; seed: number; baseX: number; shot: boolean; pts: number; showLabel: boolean;
  /** Network id (the tx id), slot index in the wave manifest (-1 = not a formation ship), private = versus invader sent to me only. */
  id: string; si: number; priv: boolean;
};
type Bolt = { alive: boolean; x: number; gy: number; vx: number; vy: number; dmg: number; pierce: number; rail: boolean; hit: Inv[]; boss: boolean; remote?: boolean };
type EBolt = { alive: boolean; x: number; gy: number; vx: number; vy: number; big: boolean };
type Pod = { x: number; gy: number; kind: Power; cell: number; t: number };
type Coin = { x: number; gy: number; loot: Loot; cell: number; t: number };
type Pop = { x: number; y: number; gy: number; cell: number; t: number; max: number };
type Shard = { alive: boolean; p: THREE.Vector3; v: THREE.Vector3; ax: THREE.Vector3; ang: number; spin: number; t: number; max: number; s: number; c: THREE.Color };
type Ring = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; dur: number; max: number; active: boolean };
type Boss = { x: number; gy: number; hp: number; maxHp: number; t: number; name: string; atk: number; sum: number; flash: number; phase: 1 | 2; dead: boolean; dieT: number; tx: number };

const P_GY = 0;
const SHIP_Y = 0.55;
const MAX_INV = 72;
const TMP = {
  v: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler(), m: new THREE.Matrix4(), c: new THREE.Color(),
  ray: new THREE.Raycaster(), plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit: new THREE.Vector3(), ndc: new THREE.Vector2(),
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uAb: { value: 0 }, uHit: { value: 0 }, uBeat: { value: 0 }, uWarp: { value: new THREE.Vector3(0.5, 0.6, 0) }, uFlash: { value: new THREE.Vector4(0, 0, 0, 0) }, uAspect: { value: 1.6 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uAb, uHit, uBeat, uAspect; uniform vec3 uWarp; uniform vec4 uFlash; varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; d.x *= uAspect;
      float r = length(d);
      // bomb shockwave: a ring of distortion expanding from the centre
      float w = exp(-abs(r - uWarp.y) * 14.0) * uWarp.x;
      vec2 dir = d / (r + 1e-4);
      vec2 uv = vUv - dir * w * 0.045 * vec2(1.0 / uAspect, 1.0);
      float ca = (uAb + uHit * 0.012 + w * 0.02) * (0.25 + r);
      vec2 o = dir * ca * vec2(1.0 / uAspect, 1.0);
      vec3 col = vec3(texture2D(tDiffuse, uv + o).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - o).b);
      col *= 1.0 - smoothstep(0.45, 1.05, r) * 0.55;
      col = mix(col, col * vec3(1.6, 0.4, 0.35), uHit * smoothstep(0.1, 0.75, r));
      col += uFlash.rgb * uFlash.a;
      col *= 0.965 + 0.035 * sin(vUv.y * 1100.0);
      col += (rnd(vUv) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

class Pad {
  private prev: boolean[] = [];
  active = false;
  read(): { mx: number; fire: boolean; bomb: boolean; pause: boolean } {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && Array.from(pads).find((x) => x && x.connected);
    if (!p) {
      this.active = false;
      return { mx: 0, fire: false, bomb: false, pause: false };
    }
    const b = (i: number) => p.buttons[i]?.pressed ?? false;
    const ax = p.axes[0] ?? 0;
    const dead = Math.abs(ax) < 0.14 ? 0 : (ax - Math.sign(ax) * 0.14) / 0.86;
    const mx = clamp(dead + (b(15) ? 1 : 0) - (b(14) ? 1 : 0), -1, 1);
    const edge = (...i: number[]) => i.some((k) => b(k) && !this.prev[k]);
    const out = { mx, fire: b(0) || b(7) || b(5), bomb: edge(1, 2, 3, 4, 6), pause: edge(9) };
    this.prev = p.buttons.map((x) => x.pressed);
    if (out.fire || mx || out.bomb) this.active = true;
    return out;
  }
}

export class InvadersEngine {
  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(54, 1.6, 0.1, 700);
  private camBase = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private clock = new THREE.Clock(false);
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private fxLevel = 2;
  private dpr = 1;
  private maxDpr = 1.5;
  private audio = new InvadersAudio();

  // art
  private floor!: ReturnType<typeof makeFloor>;
  private sky!: ReturnType<typeof makeSky>;
  private stars!: ReturnType<typeof makeStars>;
  private blocks!: ReturnType<typeof makeFarBlocks>;
  private rails!: ReturnType<typeof makeRails>;
  private hulls = {} as Record<TxKind, HullMesh>;
  private hullMats: THREE.ShaderMaterial[] = [];
  private playerMesh!: HullMesh;
  private bossMesh!: HullMesh;
  private boltMesh!: THREE.InstancedMesh;
  private ebMesh!: THREE.InstancedMesh;
  private shardMesh!: THREE.InstancedMesh;
  private shieldMesh!: THREE.Mesh;
  private parts!: Particles;
  private labels!: Atlas;
  private sprites!: Atlas;
  private labelBB!: Billboards;
  private spriteBB!: Billboards;
  private rings: Ring[] = [];
  private geos: THREE.BufferGeometry[] = [];

  // sim
  phase: Phase = 'loading';
  private mode: 'attract' | 'play' = 'attract';
  private invs: Inv[] = [];
  private bolts: Bolt[] = [];
  private ebolts: EBolt[] = [];
  private pods: Pod[] = [];
  private coins: Coin[] = [];
  private pops: Pop[] = [];
  private shards: Shard[] = [];
  private boss: Boss | null = null;
  private form = { x: 0, gy: 16, dir: 1, speed: 2, descent: 0.3, intro: 0, spec: waveSpec(1, 0, false), total: 1, fireT: 1, diveT: 4, saucerT: 12 };
  private pl = { x: 0, vx: 0, cool: 0, invuln: 0, bank: 0, recoil: 0 };
  private score = 0;
  private lives = 3;
  private wave = 1;
  private kills = 0;
  private tokensCaught = 0;
  private bossKills = 0;
  private bombs = 1;
  private shield = false;
  private shieldFlash = 0;
  private powerT: Record<'spread' | 'rail' | 'overdrive', number> = { spread: 0, rail: 0, overdrive: 0 };
  private combo: Combo = newCombo();
  private lastMult = 1;
  private runSecs = 0;
  private waveT = 0;
  private waveState: 'intro' | 'fight' | 'clear' = 'intro';
  private clearT = 0;
  private bombR = -1;
  private bombHit = false;
  private blockPending: { height: number; txCount: number } | null = null;
  private blockSeen = 0;
  private blockTimer: ReturnType<typeof setInterval> | null = null;
  private overT = 0;
  private hi = 0;

  // multiplayer (all null/empty in a solo game)
  private net: InvadersNet | null = null;
  private claims = new Map<string, Claim>();
  private myClaim = new Map<string, number>();
  private bossClaim: { t: number; pts: number } | null = null;
  private remoteMesh!: HullMesh;
  private tags = new Map<string, { sprite: THREE.Sprite; key: string }>();
  private boardT = 0;
  private boardKey = '';
  private vsKills = 0;
  private firing = false;

  // feel
  private trauma = 0;
  private freeze = 0;
  private slow = 1;
  private slowT = 0;
  private hitFlash = 0;
  private bloomKick = 0;
  private flashRGBA = new THREE.Vector4();
  private pulseR = 0;
  private pulse = 0;
  private scroll = 0;
  private press = 0.15;
  private txRate = 0;
  private rateT = 0;
  private lastWaiting = 0;
  private taken = 0;
  private time = 0;
  private fpsMs = 16;
  private lowFrames = 0;
  private perfCool = 4;
  private perfT = 0;
  private frameN = 0;

  // input
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private pad = new Pad();
  private padNow = { mx: 0, fire: false, bomb: false, pause: false };
  private ptr: { active: boolean; x: number } = { active: false, x: 0 };
  touch = { bomb: false };
  private hudOut: Hud;

  constructor(private el: HTMLElement, public opts: Opts) {
    this.hi = opts.hi;
    this.hudOut = { score: 0, hi: opts.hi, lives: 3, maxLives: 3, wave: 1, combo: 0, mult: 1, comboT: 0, nextAt: 5, bombs: 1, shield: false, powers: [], boss: null, pressure: 0, txs: 0, left: 0, kills: 0, beat: 0, fps: 60 };
  }

  // ───────────── Init ─────────────

  async init() {
    const { cb } = this.opts;
    const q = this.opts.quality;
    const hi = q === 'high';
    cb.onLoading('Spinning up the renderer', 0.05);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.maxDpr = hi ? 1.6 : 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    renderer.setPixelRatio(this.dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    this.el.appendChild(renderer.domElement);
    this.fxLevel = hi ? 2 : 1;
    this.scene.background = new THREE.Color('#05030a');
    this.camera.near = 0.1;

    cb.onLoading('Painting the data grid', 0.2);
    await new Promise((r) => setTimeout(r, 0));
    if (this.disposed) return;
    this.sky = makeSky(q);
    this.floor = makeFloor();
    this.stars = makeStars(q);
    this.blocks = makeFarBlocks();
    this.rails = makeRails();
    this.scene.add(this.sky.mesh, this.floor.mesh, this.rails.group, this.blocks.group);
    for (const l of this.stars.layers) this.scene.add(l.pts);

    cb.onLoading('Forging the hulls', 0.45);
    await new Promise((r) => setTimeout(r, 0));
    if (this.disposed) return;
    const enemyMat = hullMaterial([0.02, 0.022, 0.04], 1);
    const bossMat = hullMaterial([0.05, 0.015, 0.02], 1.2);
    const playerMat = hullMaterial([0.5, 0.5, 0.56], 1.1);
    this.hullMats.push(enemyMat, bossMat, playerMat);
    for (const k of KIND_ORDER) {
      const geo = hullGeometry(k);
      this.geos.push(geo);
      const m = makeHullMesh(geo, MAX_INV, enemyMat);
      this.hulls[k] = m;
      this.scene.add(m);
    }
    const bg = hullGeometry('boss');
    const pg = playerGeometry();
    this.geos.push(bg, pg);
    this.bossMesh = makeHullMesh(bg, 1, bossMat);
    this.playerMesh = makeHullMesh(pg, 1, playerMat);
    this.remoteMesh = makeHullMesh(pg, 8, playerMat);
    this.scene.add(this.bossMesh, this.playerMesh, this.remoteMesh);

    // bolts, shards, shield
    const oct = new THREE.OctahedronGeometry(1);
    this.geos.push(oct);
    const basic = () => new THREE.MeshBasicMaterial({ color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.boltMesh = new THREE.InstancedMesh(oct, basic(), 80);
    this.ebMesh = new THREE.InstancedMesh(oct, basic(), 140);
    this.shardMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.22), basic(), 180);
    for (const m of [this.boltMesh, this.ebMesh, this.shardMesh]) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
    }
    this.shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), new THREE.MeshBasicMaterial({ color: hdr('#4a7bff', 2.4), wireframe: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.shieldMesh.visible = false;
    this.scene.add(this.shieldMesh);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, t: 0, dur: 1, max: 10, active: false });
    }
    for (let i = 0; i < 180; i++) this.shards.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), ax: new THREE.Vector3(1, 0, 0), ang: 0, spin: 0, t: 0, max: 1, s: 1, c: new THREE.Color() });
    this.parts = new Particles(hi ? 2600 : 900);
    this.scene.add(this.parts.points);

    cb.onLoading('Cutting the labels', 0.65);
    await new Promise((r) => setTimeout(r, 0));
    this.labels = new Atlas(4, 24, 256, 64);
    this.sprites = new Atlas(16, 8, 64, 64);
    this.labelBB = new Billboards(110, this.labels.tex, true);
    this.spriteBB = new Billboards(48, this.sprites.tex, false);
    this.scene.add(this.labelBB.mesh, this.spriteBB.mesh);

    this.scene.add(this.camera);
    this.buildComposer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();
    this.attach();
    this.audio.start();
    this.watchBlocks();
    this.clock.start();
    renderer.setAnimationLoop(() => this.loop());
    cb.onLoading('Reading the mempool', 0.9);
    this.startAttract();
    this.setPhase('menu');
    cb.onLoading('Ready', 1);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.opts.cb.onPhase(p);
  }

  // ───────────── Post ─────────────

  private buildComposer() {
    const r = this.renderer;
    this.composer?.dispose();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.fxLevel >= 2 ? 4 : 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    const bs = this.fxLevel >= 2 ? 0.8 : 0.5;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bs, size.y * bs), 0.4, 0.5, 0.92);
    comp.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    comp.addPass(this.grade);
    comp.addPass(new OutputPass());
    comp.setPixelRatio(this.dpr);
    comp.setSize(this.el.clientWidth || 1, this.el.clientHeight || 1);
    this.composer = comp;
  }

  private resize() {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(w, h);
    if (this.grade) this.grade.uniforms.uAspect.value = w / h;
    this.fitCamera(w / h);
    this.parts.setScale(h * this.dpr * 0.72);
    this.stars.uniforms.uScale.value = h * this.dpr;
  }

  /** Pull the camera back (and tilt it) until the whole field width fits. */
  private fitCamera(aspect: number) {
    const portrait = aspect < 1;
    const pitch = portrait ? 0.95 : 0.4;
    this.camera.fov = portrait ? 58 : 56;
    this.camera.aspect = aspect;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const target = new THREE.Vector3(0, 0, portrait ? -12 : -11);
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    // Pull back until the player line (the widest part of the field) fits across the frame.
    const probe = new THREE.Vector3(HW + 0.3, 0, 0);
    let lo = 6;
    let hi = 200;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      this.camera.position.copy(target).addScaledVector(dir, mid);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld(true);
      const p = probe.clone().project(this.camera);
      if (Math.abs(p.x) > 0.96) lo = mid;
      else hi = mid;
    }
    this.camBase.copy(target).addScaledVector(dir, hi);
    this.camLook.copy(target);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld(true);
    // Lens shift: slide the frame so the ship sits near the bottom and the horizon haze shows above the field.
    const y0 = new THREE.Vector3(0, SHIP_Y, 0).project(this.camera).y;
    const want = portrait ? -0.8 : -0.76;
    const fh = 1000;
    this.camera.setViewOffset(1000 * aspect, fh, 0, ((want - y0) * fh) / 2 * -1 * -1, 1000 * aspect, fh);
    this.camera.updateProjectionMatrix();
  }

  // ───────────── Input ─────────────

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.phase === 'playing' || this.phase === 'paused') {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    }
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => void this.keys.delete(e.code);
  private onBlur = () => {
    this.keys.clear();
    this.ptr.active = false;
    if (this.phase === 'playing') this.pause(true);
  };
  private worldX(clientX: number, clientY: number): number {
    const r = this.renderer.domElement.getBoundingClientRect();
    TMP.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    TMP.ray.setFromCamera(TMP.ndc, this.camera);
    return TMP.ray.ray.intersectPlane(TMP.plane, TMP.hit) ? TMP.hit.x : 0;
  }
  private onPtrDown = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.ptr.active = true;
    this.ptr.x = this.worldX(e.clientX, e.clientY);
  };
  private onPtrMove = (e: PointerEvent) => {
    if (this.ptr.active) this.ptr.x = this.worldX(e.clientX, e.clientY);
  };
  private onPtrUp = () => {
    this.ptr.active = false;
  };
  private visHandler = () => {
    if (document.hidden && this.phase === 'playing') this.pause(true);
  };
  private attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.visHandler);
    const c = this.renderer.domElement;
    c.addEventListener('pointerdown', this.onPtrDown);
    c.addEventListener('pointermove', this.onPtrMove);
    c.addEventListener('pointerup', this.onPtrUp);
    c.addEventListener('pointercancel', this.onPtrUp);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  private key(...c: string[]) {
    return c.some((k) => this.keys.has(k));
  }
  private edge(...c: string[]) {
    return c.some((k) => this.pressed.has(k));
  }

  // ───────────── Public control ─────────────

  begin() {
    if (this.phase === 'loading') return;
    this.stopNet();
    this.resetGame();
    const link = this.opts.mp;
    if (link?.race) this.net = new InvadersNet(link, link.race, this.handlers());
    this.mode = 'play';
    this.setPhase('playing');
    const net = this.net;
    if (net) {
      // Ships side by side on the defence line.
      const i = net.peers.get(net.me)?.index ?? 0;
      this.pl.x = (((i + 0.5) / net.count) - 0.5) * (HW * 1.7);
      this.claims.clear();
      this.myClaim.clear();
      this.opts.cb.onToast({ text: net.versus ? `VERSUS · ${net.count} PILOTS` : `CO-OP · ${net.count} PILOTS`, tone: 'info' });
    }
    if (net && !net.isLeader()) {
      // Guests wait for the leader's wave manifest.
      this.wave = 0;
      this.waveState = 'clear';
      this.clearT = 0;
    } else this.startWave(1);
    this.audio.fx('wave');
  }
  get multiplayer() {
    return this.net !== null;
  }
  pause(on: boolean) {
    if (on && this.net) return; // the room does not wait for anyone
    if (on && this.phase === 'playing') this.setPhase('paused');
    else if (!on && this.phase === 'paused') this.setPhase('playing');
  }
  toMenu() {
    this.startAttract();
    this.setPhase('menu');
  }
  get running() {
    return this.phase === 'playing';
  }

  // ───────────── Blocks ─────────────

  private watchBlocks() {
    const poll = async () => {
      try {
        const r = await fetch('/api/chain', { cache: 'no-store' });
        const j = (await r.json()) as { height?: number };
        const h = Number(j.height) || 0;
        if (!h || this.disposed) return;
        if (this.blockSeen && h > this.blockSeen) {
          this.blockPending = { height: h, txCount: 0 };
          this.opts.cb.onToast({ text: `BLOCK #${h} LANDED · BOSS INBOUND`, tone: 'info' });
          fetch('/api/blocks', { cache: 'no-store' })
            .then((x) => x.json())
            .then((b: { blocks?: { height: number; txCount: number }[] }) => {
              const hit = b.blocks?.find((x) => x.height === h);
              if (hit && this.blockPending?.height === h) this.blockPending.txCount = hit.txCount;
            })
            .catch(() => undefined);
        }
        this.blockSeen = h;
      } catch {
        /* offline: boss waves still come every fifth wave */
      }
    };
    void poll();
    this.blockTimer = setInterval(() => void poll(), 25000);
  }

  // ───────────── Game state ─────────────

  private clearField() {
    for (const v of this.invs) this.labels.release(v.label);
    for (const p of this.pods) this.sprites.release(p.cell);
    for (const c of this.coins) this.sprites.release(c.cell);
    for (const p of this.pops) this.labels.release(p.cell);
    this.invs = [];
    this.bolts = [];
    this.ebolts = [];
    this.pods = [];
    this.coins = [];
    this.pops = [];
    this.boss = null;
    for (const s of this.shards) s.alive = false;
  }

  private resetGame() {
    this.clearField();
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.kills = 0;
    this.tokensCaught = 0;
    this.bossKills = 0;
    this.bombs = 1;
    this.shield = false;
    this.powerT = { spread: 0, rail: 0, overdrive: 0 };
    this.combo = newCombo();
    this.lastMult = 1;
    this.runSecs = 0;
    this.pl = { x: 0, vx: 0, cool: 0, invuln: 1.2, bank: 0, recoil: 0 };
    this.bombR = -1;
    this.trauma = 0;
    this.freeze = 0;
    this.slow = 1;
    this.slowT = 0;
    this.overT = 0;
  }

  private startAttract() {
    this.stopNet();
    this.resetGame();
    this.mode = 'attract';
    this.startWave(1 + Math.floor(Math.random() * 3));
    this.pl.invuln = 9999;
  }

  private ghostTx(): FeedTx {
    const k = Math.random();
    const kind: TxKind = k < 0.4 ? 'payment' : k < 0.58 ? 'data' : k < 0.74 ? 'social' : k < 0.9 ? 'inscription' : 'token';
    const id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return { id, kind, bytes: Math.floor(Math.exp(rnd(Math.log(220), Math.log(90000)))), sats: 0, mined: false };
  }

  private makeInv(tx: FeedTx | null, ghostFlag?: boolean): Inv {
    const ghost = ghostFlag ?? !tx;
    const f = tx ?? this.ghostTx();
    this.taken += tx ? 1 : 0;
    const col = new THREE.Color(KIND_HEX[f.kind]);
    const maxHp = hpFor(f.kind, f.bytes);
    const v: Inv = {
      alive: true, kind: f.kind, ghost, tx: f, col, size: sizeFor(f.bytes) * 1.0, hp: maxHp, maxHp, x: 0, gy: 40, vx: 0, mode: 'form', slot: null, col0: 0, t: 0, delay: 0, flash: 0, charge: 0, fireIn: 0, label: -1,
      loot: ghost ? null : lootFrom(f), seed: Math.random() * 100, baseX: 0, shot: false, pts: ghost ? 5 : KIND_POINTS[f.kind], showLabel: false, id: f.id, si: -1, priv: false,
    };
    return v;
  }

  private labelFor(v: Inv) {
    if (v.label < 0) v.label = this.labels.alloc();
    if (v.label < 0) return;
    const hex = `#${v.col.getHexString()}`;
    this.labels.draw(v.label, (g, w, h) => {
      if (v.loot) {
        const m = tokenMeta(v.loot.id);
        drawTokenLabel(g, w, h, m?.sym ?? v.loot.sym, m?.icon ?? null);
      } else drawTxLabel(g, w, h, hex, v.ghost ? 'GHOST' : KIND_NAME[v.kind], (v.tx?.id ?? '').slice(0, 10));
    });
  }

  private startWave(n: number, man?: WaveMsg) {
    const net = this.net;
    this.wave = n;
    if (net) net.wave = n;
    this.waveT = 0;
    this.waveState = 'intro';
    // Multiplayer: layout, delays, direction and the boss schedule come from the room seed; the txs come from the leader's manifest.
    const rng = net ? mulberry32(net.seed ^ Math.imul(n, 0x9e3779b1)) : Math.random;
    if (man) this.blockPending = man.bp ? { height: man.bp.h, txCount: man.bp.c } : null;
    const wantBoss = man ? man.bd === 1 : !!this.blockPending && n >= 2;
    const backlog = man ? man.bl : this.opts.waiting();
    const spec = waveSpec(n, backlog, wantBoss);
    const bp = wantBoss && this.blockPending ? { h: this.blockPending.height, c: this.blockPending.txCount } : null;
    const slots = formationSlots(man ? man.t.length : spec.count, spec.pattern);
    slots.sort((a, b) => b.z - a.z || Math.abs(a.x) - Math.abs(b.x));
    const invs: Inv[] = [];
    const rows: WireRow[] = [];
    let tokens = 0;
    slots.forEach((s, si) => {
      let v: Inv;
      if (man) v = this.invFromRow(man.t[si]);
      else {
        let tx: FeedTx | null = null;
        if (tokens < spec.tokens) {
          tx = this.opts.take((f) => f.kind === 'token');
          if (tx) tokens++;
        }
        tx ??= this.opts.take((f) => f.kind !== 'blast' && f.kind !== 'token');
        v = this.makeInv(tx);
        if (net) rows.push(this.rowOf(v));
      }
      v.slot = s;
      v.si = si;
      v.delay = rng() * 1.3 + (s.z * 0.12);
      if (net) v.seed = rng() * 100;
      if (this.claims.has(v.id)) v.alive = false;
      invs.push(v);
    });
    // Front-of-column ships (every other column) and tokens wear their label.
    this.invs = this.invs.filter((v) => v.mode !== 'form');
    this.invs.push(...invs);
    this.form = { x: 0, gy: 10 + Math.min(4, n * 0.3), dir: rng() < 0.5 ? 1 : -1, speed: spec.speed, descent: spec.descent, intro: 0, spec, total: invs.length, fireT: 2.2, diveT: spec.diverEvery * 0.8, saucerT: 10 + rng() * 8 };
    if (spec.boss) this.spawnBoss(n, wantBoss);
    if (net && !man && net.isLeader()) net.sendWave({ n, bl: backlog, bd: wantBoss ? 1 : 0, bp, t: rows });
    if (net && n > 1 && this.lives <= 0 && this.phase === 'playing') {
      this.lives = 1;
      this.pl.invuln = 2.4;
      this.opts.cb.onToast({ text: 'REVIVED FOR THE NEW WAVE', tone: 'good' });
    }
    this.opts.cb.onBanner(spec.boss ? { title: 'BOSS', sub: `${this.boss?.name ?? 'BLOCK'} · ${this.boss?.tx ? `${this.boss.tx.toLocaleString()} TXS` : 'THE BLOCK LANDS'}`, tone: 'boss' } : { title: `WAVE ${n}`, sub: `${invs.filter((v) => !v.ghost).length} LIVE TXS IN FORMATION${this.opts.waiting() > 20 ? ` · ${this.opts.waiting()} IN THE MEMPOOL` : ''}`, tone: 'wave' });
    if (spec.boss) this.audio.fx('warn');
    else if (n > 1) this.audio.fx('wave');
    this.ring(0, P_GY, 14, 0.9, hdr('#27e6ff', 1.6));
  }

  private rowOf(v: Inv): WireRow {
    return [v.id, v.kind, v.tx?.bytes ?? 250, v.tx?.token ?? 0, v.ghost ? 1 : 0];
  }
  private invFromRow(r: WireRow): Inv {
    const tx: FeedTx = { id: r[0], kind: r[1] as TxKind, bytes: r[2], sats: 0, mined: false, ...(r[3] ? { token: r[3] } : {}) };
    return this.makeInv(tx, r[4] === 1);
  }

  private spawnBoss(n: number, block: boolean) {
    const info = block ? this.blockPending : null;
    this.blockPending = null;
    const hp = 34 + n * 5 + Math.min(40, Math.floor((info?.txCount ?? 0) / 400));
    this.boss = { x: 0, gy: 34, hp, maxHp: hp, t: 0, name: info ? `BLOCK #${info.height}` : `BLOCK #${this.blockSeen || '------'}`, atk: 2.5, sum: 6, flash: 0, phase: 1, dead: false, dieT: 0, tx: info?.txCount ?? 0 };
  }

  // ───────────── Spawning helpers ─────────────

  private ring(x: number, gy: number, max: number, dur: number, c: THREE.Color) {
    const r = this.rings.find((q) => !q.active) ?? this.rings[0];
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.max = max;
    r.mat.color.copy(c);
    r.mesh.position.set(x, 0.08, -gy);
    r.mesh.visible = true;
  }

  private popup(x: number, y: number, gy: number, text: string, col: string, life = 1.0) {
    const cell = this.labels.alloc();
    if (cell < 0) return;
    this.labels.draw(cell, (g, w, h) => drawPopup(g, w, h, text, col));
    this.pops.push({ x, y, gy, cell, t: life, max: life });
  }

  private shard(x: number, y: number, z: number, c: THREE.Color) {
    const s = this.shards.find((k) => !k.alive);
    if (!s) return;
    s.alive = true;
    s.p.set(x, y, z);
    s.v.set(rnd(-5, 5), rnd(2, 7), rnd(-5, 5));
    s.ax.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
    s.ang = 0;
    s.spin = rnd(-12, 12);
    s.t = s.max = rnd(0.6, 1.3);
    s.s = rnd(0.6, 1.5);
    s.c.copy(c).multiplyScalar(2.2);
  }

  private explode(x: number, gy: number, col: THREE.Color, size: number, big = false) {
    const n = Math.round((big ? 46 : 20) * (this.fxLevel >= 2 ? 1 : 0.55));
    this.parts.burst(x, SHIP_Y, -gy, n, big ? 11 : 7.5, big ? 1.1 : 0.7, big ? 0.9 : 0.55, col.r * 2.4, col.g * 2.4, col.b * 2.4);
    this.parts.burst(x, 0.15, -gy, Math.round(n * 0.4), 9, 0.5, 0.4, 1.8, 1.8, 2.0, true);
    for (let i = 0; i < (big ? 12 : 5); i++) this.shard(x, SHIP_Y, -gy, col);
    this.ring(x, gy, (big ? 6.5 : 3.2) * size, big ? 0.7 : 0.45, hdr(`#${col.getHexString()}`, 2.2));
    this.trauma = Math.min(1, this.trauma + (big ? 0.5 : 0.1 + size * 0.06));
  }

  // ───────────── Player actions ─────────────

  private fire(): boolean {
    if (this.mode === 'play' && !this.opts.payFor(['shot'])) {
      this.opts.cb.onNoAmmo?.();
      return false;
    }
    const spread = this.powerT.spread > 0;
    const rail = this.powerT.rail > 0;
    const specs = fireSpecs(spread, rail);
    for (const s of specs) if (!this.spawnBolt(this.pl.x, s, false)) break;
    this.pl.recoil = 1;
    this.audio.fx(rail ? 'rail' : 'shot');
    this.parts.emit(this.pl.x, SHIP_Y + 0.1, -(P_GY + 1.7), rnd(-1, 1), 0.5, -rnd(2, 6), 0.18, 0.4, 0.5, 2.2, 2.6, 4);
    return true;
  }

  /** A player bolt (mine, or a cosmetic copy of another pilot's: those never collide, their kills arrive as claims). */
  private spawnBolt(x: number, s: ShotSpec, remote: boolean): boolean {
    const b = this.bolts.find((q) => !q.alive) ?? (this.bolts.length < 80 ? (this.bolts[this.bolts.push({ alive: false, x: 0, gy: 0, vx: 0, vy: 0, dmg: 1, pierce: 0, rail: false, hit: [], boss: false }) - 1]) : null);
    if (!b) return false;
    b.alive = true;
    b.x = x + Math.sin(s.ang) * 0.3;
    b.gy = P_GY + 1.5;
    b.vx = Math.sin(s.ang) * s.speed;
    b.vy = Math.cos(s.ang) * s.speed;
    b.dmg = s.dmg;
    b.pierce = s.pierce;
    b.rail = s.rail;
    b.hit.length = 0;
    b.boss = false;
    b.remote = remote;
    return true;
  }

  private bomb() {
    if (this.bombs <= 0 || this.bombR >= 0) return;
    if (this.mode === 'play' && !this.opts.payFor(['purge'])) {
      this.opts.cb.onNoAmmo?.();
      return;
    }
    this.bombs--;
    this.bombR = 0;
    this.bombHit = false;
    this.audio.fx('bomb');
    this.trauma = 1;
    this.freeze = 0.09;
    this.bloomKick = 1.6;
    this.opts.cb.onFlash('bomb');
    this.ring(this.pl.x, P_GY, 60, 1.1, hdr('#ffb800', 2.6));
    this.opts.cb.onToast({ text: 'MEMPOOL PURGE', tone: 'good' });
  }

  private damagePlayer() {
    if (this.pl.invuln > 0) return;
    if (this.net && this.lives <= 0) return; // already down
    if (this.shield) {
      this.shield = false;
      this.shieldFlash = 1;
      this.pl.invuln = 1.1;
      this.audio.fx('shieldBreak');
      this.ring(this.pl.x, P_GY, 7, 0.6, hdr('#4a7bff', 2.4));
      this.parts.burst(this.pl.x, SHIP_Y, -P_GY, 26, 9, 0.6, 0.5, 0.6, 1.2, 3);
      this.trauma = Math.min(1, this.trauma + 0.45);
      return;
    }
    this.lives--;
    this.trauma = 1;
    this.freeze = 0.14;
    this.hitFlash = 1;
    this.opts.cb.onFlash('hit');
    this.audio.fx('hit');
    this.explode(this.pl.x, P_GY, new THREE.Color('#ffd0c0'), 1.2, true);
    this.combo.count = 0;
    this.combo.timer = 0;
    this.powerT = { spread: 0, rail: 0, overdrive: 0 };
    for (const b of this.ebolts) if (Math.hypot(b.x - this.pl.x, b.gy - P_GY) < 7) b.alive = false;
    this.pl.invuln = 2.4;
    if (this.lives <= 0) {
      if (this.net?.anyOtherUp()) this.goDown();
      else this.gameOver();
    }
  }

  /** Co-op/versus: out of hulls but the others fight on; you come back at the next wave. */
  private goDown() {
    this.lives = 0;
    this.shield = false;
    this.opts.cb.onToast({ text: 'YOU ARE DOWN · BACK NEXT WAVE', tone: 'bad' });
    this.explode(this.pl.x, P_GY, new THREE.Color('#ff4a2e'), 1.8, true);
  }

  private gameOver() {
    if (this.phase === 'over') return;
    this.audio.fx('bossDown');
    this.slow = 0.18;
    this.slowT = 1.6;
    this.overT = 1.7;
    this.explode(this.pl.x, P_GY, new THREE.Color('#ff4a2e'), 2, true);
    this.phase = 'over';
    this.opts.cb.onPhase('over');
    const board = this.net ? this.buildBoard() : undefined;
    this.opts.cb.onOver({ score: this.score, wave: this.wave, kills: this.kills, maxCombo: this.combo.best, secs: this.runSecs, tokens: this.tokensCaught, bosses: this.bossKills, team: board ? board.reduce((a, r) => a + r.score, 0) : undefined, board, mode: this.net?.cfg.mode });
  }

  // ───────────── Kills ─────────────

  private comboNow() {
    return this.audio.beatDistance(performance.now()) < 85;
  }

  private award(base: number, x: number, gy: number, col: string, big = false): number {
    const onBeat = this.mode === 'play' && this.comboNow();
    const mult = comboKill(this.combo, onBeat);
    const pts = base * (this.mode === 'play' ? mult : 1);
    if (this.mode === 'play') this.score += pts;
    this.kills++;
    this.popup(x, 1.7 + (big ? 0.4 : 0), gy, `+${pts}${mult > 1 ? ` ×${mult}` : ''}${onBeat ? ' ♪' : ''}`, onBeat ? '#27e6ff' : col, 0.95);
    this.audio.fx('kill', this.combo.count);
    if (onBeat) {
      this.bloomKick = Math.max(this.bloomKick, 0.9);
      this.ring(x, gy, 4.5, 0.4, hdr('#27e6ff', 2.4));
    }
    const m = multFor(this.combo.count);
    if (m > this.lastMult) {
      if (this.mode === 'play') {
        this.opts.cb.onToast({ text: `×${m} MULTIPLIER`, tone: 'good' });
        this.audio.fx('combo', m);
        if ((m === 3 || m === 5 || m === 8) && this.bombs < 3) {
          this.bombs++;
          this.opts.cb.onToast({ text: 'PURGE CHARGED', tone: 'good' });
        }
      }
      this.bloomKick = Math.max(this.bloomKick, 1.2);
      this.ring(this.pl.x, P_GY, 12, 0.6, hdr('#ffb800', 2));
    }
    this.lastMult = m;
    return this.mode === 'play' ? pts : 0;
  }

  private killInv(v: Inv, byBomb = false) {
    v.alive = false;
    const col = v.ghost ? v.col.clone().multiplyScalar(0.6) : v.col;
    const big = v.maxHp >= 3 || v.kind === 'token';
    this.explode(v.x, v.gy, col, v.size, big);
    const net = this.net;
    let claimed = false;
    if (net && !v.priv) {
      const prior = this.claims.get(v.id);
      if (prior && prior.by !== net.me) return; // another pilot's claim got here first: theirs
      if (!prior) {
        const t = Date.now();
        this.claims.set(v.id, { by: net.me, t });
        this.trimClaims();
        net.sendKill(v.id, t);
      }
      claimed = true;
    }
    const pts = this.award(v.pts * (v.maxHp >= 3 ? 2 : 1), v.x, v.gy, `#${v.col.getHexString()}`, big);
    if (claimed) this.myClaim.set(v.id, pts);
    if (net?.versus && !v.priv && this.mode === 'play') this.vsSend(big);
    if (big) {
      this.audio.fx('bigkill');
      this.freeze = Math.max(this.freeze, byBomb ? 0 : 0.045);
    }
    if (v.loot) {
      const cell = this.sprites.alloc();
      if (cell >= 0) {
        const loot = v.loot;
        this.drawCoin(cell, loot);
        this.coins.push({ x: v.x, gy: v.gy, loot, cell, t: 0 });
      }
    }
    const dropChance = v.kind === 'blast' ? 1 : v.maxHp >= 3 ? 0.3 : 0.065;
    if (this.mode === 'play' && Math.random() < dropChance) this.dropPod(v.x, v.gy);
  }

  private drawCoin(cell: number, loot: Loot) {
    this.sprites.draw(cell, (g, w, h) => {
      const m = tokenMeta(loot.id);
      const r = w * 0.42;
      g.fillStyle = '#2a1a04';
      g.strokeStyle = '#ffd36a';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const img = m?.icon;
      let drawn = false;
      if (img?.complete && img.naturalWidth) {
        try {
          g.save();
          g.beginPath();
          g.arc(w / 2, h / 2, r - 3, 0, Math.PI * 2);
          g.clip();
          g.drawImage(img, w / 2 - r + 3, h / 2 - r + 3, (r - 3) * 2, (r - 3) * 2);
          g.restore();
          drawn = true;
        } catch {
          /* glyph fallback */
        }
      }
      if (!drawn) {
        g.fillStyle = '#ffd36a';
        g.font = `900 ${Math.round(w * 0.3)}px ${'Impact, sans-serif'}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText((m?.sym ?? loot.sym).slice(0, 3).toUpperCase(), w / 2, h / 2 + 2);
      }
    });
  }

  private dropPod(x: number, gy: number, kind?: Power) {
    const k = kind ?? rollPower(Math.random());
    const cell = this.sprites.alloc();
    if (cell < 0) return;
    this.sprites.draw(cell, (g, w, h) => drawPowerIcon(g, w, h, k, POWER_META[k].colour));
    this.pods.push({ x, gy, kind: k, cell, t: 0 });
  }

  private damageInv(v: Inv, dmg: number, x: number, gy: number): boolean {
    v.hp -= dmg;
    v.flash = 1;
    this.parts.burst(x, SHIP_Y, -gy, 5, 5, 0.3, 0.35, 2, 2, 2);
    if (v.hp <= 0) {
      this.killInv(v);
      return true;
    }
    if (this.net && !v.priv) this.net.sendHit(v.id, dmg);
    this.audio.fx('bossHit');
    return false;
  }

  private damageBoss(dmg: number, x: number, gy: number, remote = false) {
    const b = this.boss;
    if (!b || b.dead) return;
    if (this.net && !remote) this.net.sendBossHit(dmg);
    b.hp -= dmg;
    b.flash = 1;
    this.parts.burst(x, SHIP_Y + 0.5, -gy, 4, 6, 0.3, 0.4, 3, 1.2, 0.6);
    this.audio.fx('bossHit');
    this.trauma = Math.min(1, this.trauma + 0.03);
    this.bloomKick = Math.max(this.bloomKick, 0.35);
    if (b.phase === 1 && b.hp < b.maxHp * 0.5) {
      b.phase = 2;
      this.opts.cb.onToast({ text: 'BOSS ENRAGED', tone: 'bad' });
      this.audio.fx('warn');
      this.ring(b.x, b.gy, 16, 0.8, hdr('#ff3b2e', 2.4));
    }
    if (b.hp <= 0) {
      b.dead = true;
      b.dieT = 1.4;
      this.bossKills++;
      this.audio.fx('bossDown');
      this.slow = 0.2;
      this.slowT = 1.4;
      this.freeze = 0.25;
      if (!remote) {
        const pts = this.award(1500, b.x, b.gy, '#ffb800', true);
        if (this.net) {
          const t = Date.now();
          this.bossClaim = { t, pts };
          this.net.sendBossKill(t);
        }
      }
      for (const e of this.ebolts) e.alive = false;
    }
  }

  // ───────────── Step ─────────────

  private botInput(): { mx: number; fire: boolean } {
    // Attract mode autopilot: chase the nearest threat's column, step out of the way of bolts, never stop shooting.
    let tx = 0;
    let best = 99;
    for (const v of this.invs) if (v.alive && v.gy < best && v.gy > 2) { best = v.gy; tx = v.x; }
    if (this.boss && !this.boss.dead) tx = this.boss.x;
    let dodge = 0;
    for (const b of this.ebolts) if (b.alive && b.gy < 9 && b.gy > 0 && Math.abs(b.x - this.pl.x) < 1.3) dodge = b.x > this.pl.x ? -1 : 1;
    const dx = tx - this.pl.x;
    const mx = dodge || clamp(dx * 0.7, -1, 1);
    return { mx: Math.sin(this.time * 0.7) * 0.25 + mx, fire: true };
  }

  private step(dt: number) {
    this.time += dt;
    const play = this.mode === 'play';
    if (play) this.runSecs += dt;
    // player
    let mx = 0;
    let wantFire = false;
    let wantBomb = false;
    if (this.mode === 'attract') {
      const b = this.botInput();
      mx = b.mx;
      wantFire = b.fire;
      if (Math.random() < 0.002 && this.bombs > 0) wantBomb = true;
    } else if (this.phase === 'playing') {
      const pad = this.padNow;
      mx = (this.key('ArrowRight', 'KeyD') ? 1 : 0) - (this.key('ArrowLeft', 'KeyA') ? 1 : 0) + pad.mx;
      mx = clamp(mx, -1, 1);
      wantFire = this.key('Space', 'KeyZ', 'KeyJ', 'ArrowUp', 'KeyW', 'Enter') || pad.fire || this.ptr.active;
      wantBomb = this.edge('KeyX', 'ShiftLeft', 'ShiftRight', 'KeyB', 'ArrowDown', 'KeyS') || pad.bomb || this.touch.bomb;
      this.touch.bomb = false;
    }
    const pl = this.pl;
    if (this.ptr.active && this.mode === 'play') {
      const target = clamp(this.ptr.x, -HW + 0.9, HW - 0.9);
      pl.vx = clamp((target - pl.x) * 12, -30, 30);
    } else pl.vx += (mx * 15.5 - pl.vx) * Math.min(1, dt * 13);
    pl.x = clamp(pl.x + pl.vx * dt, -HW + 0.9, HW - 0.9);
    pl.bank += (clamp(-pl.vx * 0.045, -0.7, 0.7) - pl.bank) * Math.min(1, dt * 10);
    pl.recoil = Math.max(0, pl.recoil - dt * 9);
    pl.invuln = Math.max(0, pl.invuln - dt);
    pl.cool -= dt;
    for (const k of ['spread', 'rail', 'overdrive'] as const) this.powerT[k] = Math.max(0, this.powerT[k] - dt);
    this.firing = wantFire && (this.lives > 0 || this.mode === 'attract');
    if (wantFire && pl.cool <= 0 && (this.lives > 0 || this.mode === 'attract')) {
      pl.cool = this.fire() ? fireDelay(this.powerT.overdrive > 0, this.powerT.spread > 0, this.powerT.rail > 0) : 0.3;
    }
    if (wantBomb) this.bomb();
    if (play && comboTick(this.combo, dt)) {
      this.lastMult = 1;
      if (this.kills > 6) this.opts.cb.onToast({ text: 'COMBO DROPPED', tone: 'bad' });
    }
    if (!play) comboTick(this.combo, dt);

    if (this.net && this.mode === 'play') this.stepNet(dt);
    this.stepWave(dt);
    this.stepBolts(dt);
    this.stepPickups(dt);
    this.stepBomb(dt);
    this.stepBoss(dt);

    // engine exhaust
    if (this.lives > 0 || this.mode === 'attract') {
      const t = this.time;
      for (const s of [-0.34, 0.34]) this.parts.emit(pl.x + s, SHIP_Y, -P_GY + 0.9, rnd(-0.3, 0.3) - pl.vx * 0.05, 0.1, rnd(3, 6), 0.35, 0.34, 0.2, 1.5 + Math.sin(t * 30) * 0.2, 2.6, 2.5);
    }
  }

  private liveInvs() {
    let n = 0;
    for (const v of this.invs) if (v.alive) n++;
    return n;
  }

  private stepWave(dt: number) {
    const f = this.form;
    const spec = f.spec;
    this.waveT += dt;
    f.intro = Math.min(1, this.waveT / 2.2);
    const intro = 1 - (1 - f.intro) * (1 - f.intro);
    const form = this.invs.filter((v) => v.alive && v.mode === 'form');
    const frac = f.total ? form.length / f.total : 0;
    // march
    let minX = Infinity;
    let maxX = -Infinity;
    for (const v of form) {
      minX = Math.min(minX, v.slot!.x - v.size * 0.7);
      maxX = Math.max(maxX, v.slot!.x + v.size * 0.7);
    }
    if (form.length && this.waveState !== 'clear') {
      const spd = f.speed * (1 + (1 - frac) * 1.5) * (1 + this.press * 0.25) * (this.waveT > 2.2 ? 1 : 0.2);
      f.x += f.dir * spd * dt;
      if ((f.dir > 0 && f.x + maxX > HW - 0.5) || (f.dir < 0 && f.x + minX < -HW + 0.5)) {
        f.dir *= -1;
        f.gy -= 0.85;
        f.x = clamp(f.x, -HW + 0.5 - minX, HW - 0.5 - maxX);
        this.parts.burst(f.x, 0.2, -f.gy, 6, 5, 0.3, 0.3, 1.2, 0.5, 0.5, true);
      }
      if (this.waveT > 2.2) f.gy -= f.descent * (1 + (1 - frac) * 1.2) * dt;
    }
    const beat = this.audio.env;
    for (const v of this.invs) {
      if (!v.alive) continue;
      v.t += dt;
      v.flash = Math.max(0, v.flash - dt * 6);
      if (v.mode === 'form') {
        const sl = v.slot!;
        const ent = clamp((this.waveT - v.delay) / 0.9, 0, 1);
        const rise = (1 - intro) * 22 + (1 - ent) * 6;
        v.x = f.x + sl.x + Math.sin(this.time * 1.7 + v.seed) * 0.12;
        v.gy = f.gy + sl.z + rise + Math.sin(this.time * 2.1 + v.seed) * 0.1 + beat * 0.1;
        v.vx = f.dir * f.speed;
        if (v.gy < 1.7 && ent >= 1 && this.waveState !== 'clear') {
          v.alive = false;
          this.explode(v.x, Math.max(v.gy, 0.5), v.col, v.size, true);
          this.audio.fx('breach');
          if (this.mode === 'play') {
            this.opts.cb.onToast({ text: 'BREACH', tone: 'bad' });
            this.damagePlayer();
          }
          f.gy += 3.5;
        }
      } else if (v.mode === 'dive') {
        const sp = 3.6 + this.wave * 0.28 + this.press * 1.2;
        v.gy -= sp * dt;
        v.x = clamp(v.baseX + Math.sin(v.t * 1.5 + v.seed) * 2.3, -HW + 0.8, HW - 0.8);
        v.vx = Math.cos(v.t * 1.5 + v.seed) * 3;
        if (!v.shot && v.gy < 15 && v.gy > 6) {
          v.shot = true;
          this.enemyBolt(v.x, v.gy, this.pl.x, true);
        }
        if (v.gy < P_GY + 1.1 && Math.abs(v.x - this.pl.x) < 0.7 + v.size * 0.7 && v.gy > -1) {
          v.alive = false;
          this.explode(v.x, v.gy, v.col, v.size, true);
          if (this.mode === 'play') this.damagePlayer();
        } else if (v.gy < -3) {
          v.alive = false;
          if (this.combo.count > 0 && this.mode === 'play') {
            this.combo.timer = Math.min(this.combo.timer, 0.5);
            this.opts.cb.onToast({ text: 'ONE GOT AWAY', tone: 'bad' });
          }
        }
      } else {
        // saucer
        v.x += v.vx * dt;
        v.gy = 24 + Math.sin(this.time * 2) * 0.3;
        if (Math.abs(v.x) > HW + 6) v.alive = false;
      }
      // fire telegraph
      if (v.fireIn > 0) {
        v.fireIn -= dt;
        v.charge = clamp(1 - v.fireIn / 0.35, 0, 1);
        if (v.fireIn <= 0) {
          v.charge = 0;
          if (this.waveState !== 'clear') this.enemyBolt(v.x, v.gy, this.pl.x, this.wave >= 3 && Math.random() < 0.4);
        }
      }
    }
    // formation shots
    if (this.waveState === 'fight' && form.length) {
      f.fireT -= dt;
      if (f.fireT <= 0) {
        f.fireT = spec.fireEvery * rnd(0.6, 1.3) * (0.5 + frac * 0.5) + 0.12;
        const fronts = new Map<number, Inv>();
        for (const v of form) {
          const key = Math.round(v.slot!.x * 4);
          const cur = fronts.get(key);
          if (!cur || v.gy < cur.gy) fronts.set(key, v);
        }
        const arr = [...fronts.values()].filter((v) => v.gy < 36 && v.fireIn <= 0);
        const v = arr[Math.floor(Math.random() * arr.length)];
        if (v && !this.guest) v.fireIn = 0.35;
      }
    }
    // state machine
    if (this.waveState === 'intro' && this.waveT > 2.4) this.waveState = 'fight';
    if (this.waveState === 'fight') {
      {
        f.diveT -= dt;
        if (f.diveT <= 0) {
          f.diveT = spec.diverEvery * rnd(0.7, 1.2) * (1.15 - this.press * 0.4);
          if (!this.guest && this.liveInvs() < MAX_INV - 4) {
            const tx = this.opts.take((x) => x.kind !== 'blast' && x.kind !== 'token');
            if (tx || Math.random() < 0.4) {
              const d = this.makeInv(tx);
              d.mode = 'dive';
              d.baseX = rnd(-HW + 1.6, HW - 1.6);
              d.x = d.baseX;
              d.gy = 33;
              d.showLabel = true;
              d.size = Math.max(d.size, 0.95);
              this.invs.push(d);
              this.labelFor(d);
              this.announce(d, 'd');
            }
          }
        }
        f.saucerT -= dt;
        if (f.saucerT <= 0) {
          f.saucerT = rnd(14, 24);
          const tx = this.opts.take((x) => x.kind === 'blast');
          if (!this.guest && tx && !this.invs.some((v) => v.alive && v.mode === 'saucer')) {
            const s = this.makeInv(tx);
            s.mode = 'saucer';
            s.size = 1.1;
            const dir = Math.random() < 0.5 ? 1 : -1;
            s.x = -dir * (HW + 5);
            s.vx = dir * 6.5;
            s.gy = 24;
            s.showLabel = true;
            s.hp = s.maxHp = 1;
            this.invs.push(s);
            this.labelFor(s);
            this.announce(s, 's');
          }
        }
      }
      const left = this.invs.some((v) => v.alive && (v.mode === 'form' || v.mode === 'dive')) || (this.boss && !this.boss.dead);
      if (!left) {
        this.waveState = 'clear';
        this.clearT = 2.4;
        if (this.mode === 'play') {
          const bonus = 250 * Math.min(4, 1 + Math.floor(this.wave / 3));
          this.score += bonus;
          this.opts.cb.onBanner({ title: 'WAVE CLEAR', sub: `+${bonus} · ${this.combo.count} COMBO`, tone: 'clear' });
          sfx('level', 0.8);
        }
        this.ring(this.pl.x, P_GY, 30, 1, hdr('#c8ff1a', 1.8));
      }
    } else if (this.waveState === 'clear') {
      this.clearT -= dt;
      if (this.clearT <= 0 && !this.guest) this.startWave(this.wave + 1); // guests wait for the leader's manifest
    }
    // labels: front-of-column (every other column) and tokens
    if ((this.frameN & 15) === 0) this.refreshLabels(form);
    // sweep dead
    if (this.invs.some((v) => !v.alive)) {
      for (const v of this.invs) if (!v.alive) this.labels.release(v.label);
      this.invs = this.invs.filter((v) => v.alive);
    }
  }

  private refreshLabels(form: Inv[]) {
    const fronts = new Map<number, Inv>();
    for (const v of form) {
      const key = Math.round(v.slot!.x * 4);
      const cur = fronts.get(key);
      if (!cur || v.gy < cur.gy) fronts.set(key, v);
    }
    let i = 0;
    const want = new Set<Inv>();
    for (const [, v] of [...fronts.entries()].sort((a, b) => a[0] - b[0])) {
      if (i++ % 2 === 0) want.add(v);
    }
    for (const v of form) {
      const w = want.has(v) || !!v.loot;
      if (w && !v.showLabel) {
        v.showLabel = true;
        this.labelFor(v);
      } else if (!w && v.showLabel && v.mode === 'form') {
        v.showLabel = false;
        this.labels.release(v.label);
        v.label = -1;
      }
      // token logos/names arrive late: redraw until the lookup lands
      if (v.loot && v.showLabel && (this.frameN & 63) === 0 && !tokenMeta(v.loot.id)?.icon?.complete) this.labelFor(v);
    }
  }

  /** Leader only in multiplayer: decide a bolt, spawn it and queue it for the others. Guests just receive them ('eb'). */
  private enemyBolt(x: number, gy: number, aimX: number, aimed: boolean, big = false, angle?: number) {
    if (this.guest) return;
    const speed = Math.min(15, 7 + this.wave * 0.38) * (big ? 0.85 : 1);
    let ang = angle ?? 0;
    if (angle === undefined && aimed) ang = Math.atan2(this.aimAt(x, aimX) - x, Math.max(2, gy - P_GY)) * 0.9;
    const vx = Math.sin(ang) * speed;
    const vy = -Math.cos(ang) * speed;
    this.spawnEBolt(x, gy - 0.8, vx, vy, big);
    this.net?.queueBolt([+x.toFixed(2), +(gy - 0.8).toFixed(2), +vx.toFixed(2), +vy.toFixed(2), big ? 1 : 0]);
  }

  private spawnEBolt(x: number, gy: number, vx: number, vy: number, big: boolean) {
    const b = this.ebolts.find((q) => !q.alive) ?? (this.ebolts.length < 140 ? this.ebolts[this.ebolts.push({ alive: false, x: 0, gy: 0, vx: 0, vy: 0, big: false }) - 1] : null);
    if (!b) return;
    b.alive = true;
    b.x = x;
    b.gy = gy;
    b.big = big;
    b.vx = vx;
    b.vy = vy;
  }

  /** Where an aimed shot goes: my ship, or (multiplayer) whichever living ship is nearest the shooter. */
  private aimAt(x: number, mine: number) {
    const o = this.net?.nearestOther(x);
    if (o === null || o === undefined) return mine;
    if (this.lives <= 0) return o;
    return Math.abs(o - x) < Math.abs(mine - x) ? o : mine;
  }

  private stepBolts(dt: number) {
    // player bolts
    for (const b of this.bolts) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.gy += b.vy * dt;
      if (b.gy > 46 || Math.abs(b.x) > HW + 3) {
        b.alive = false;
        continue;
      }
      if (b.remote) continue; // another pilot's shot: cosmetic only
      let used = false;
      for (const v of this.invs) {
        if (!v.alive || v.gy < 1.5 || b.hit.includes(v)) continue;
        const r = v.size * 0.95 + 0.2;
        if (Math.abs(b.x - v.x) < r && Math.abs(b.gy - v.gy) < r + 0.5) {
          b.hit.push(v);
          this.damageInv(v, b.dmg, v.x, v.gy);
          if (b.pierce > 0) b.pierce--;
          else used = true;
          if (used) break;
        }
      }
      const bo = this.boss;
      if (!used && bo && !bo.dead && Math.abs(b.x - bo.x) < 2.3 && Math.abs(b.gy - bo.gy) < 2.2 && !b.boss) {
        this.damageBoss(b.dmg, b.x, b.gy);
        b.boss = true;
        if (b.pierce > 0) b.pierce--;
        else used = true;
      }
      if (used) {
        b.alive = false;
        this.parts.burst(b.x, SHIP_Y, -b.gy, 3, 4, 0.2, 0.3, 0.6, 1.4, 2.2);
      }
    }
    // enemy bolts
    for (const e of this.ebolts) {
      if (!e.alive) continue;
      e.x += e.vx * dt;
      e.gy += e.vy * dt;
      if (e.gy < -3 || Math.abs(e.x) > HW + 4) {
        e.alive = false;
        continue;
      }
      if (this.mode === 'play' && this.lives > 0 && e.gy < P_GY + 1 && e.gy > P_GY - 1 && Math.abs(e.x - this.pl.x) < (this.shield ? 1.5 : 0.78)) {
        e.alive = false;
        this.damagePlayer();
      }
    }
  }

  private stepPickups(dt: number) {
    const near = (x: number, gy: number, r: number) => Math.abs(x - this.pl.x) < r && Math.abs(gy - P_GY) < r;
    for (const p of this.pods) {
      p.t += dt;
      p.gy -= 2.7 * dt;
      p.x += Math.sin(p.t * 2.2) * 0.6 * dt;
      if (near(p.x, p.gy, 1.5)) {
        this.applyPower(p.kind);
        p.t = 999;
      }
      if (p.gy < -3) p.t = 999;
    }
    for (const c of this.coins) {
      c.t += dt;
      c.gy -= 3.4 * dt;
      if (this.frameN % 3 === 0) this.parts.emit(c.x + rnd(-0.3, 0.3), 1.1, -c.gy, 0, 0.8, 0, 0.5, 0.3, 2.2, 1.6, 0.2, 2);
      if (near(c.x, c.gy, 1.45) && (this.lives > 0 || this.mode === 'attract')) {
        const loot = refreshLoot(c.loot);
        if (this.mode === 'play') {
          this.opts.cb.onLoot(loot);
          this.tokensCaught++;
          this.score += 100;
          this.popup(c.x, 2.0, c.gy, `+1 ${loot.sym}`, '#ffd36a', 1.2);
        }
        this.audio.fx('token');
        this.parts.burst(c.x, 1.0, -c.gy, 22, 8, 0.6, 0.5, 2.6, 1.9, 0.3);
        this.ring(c.x, c.gy, 4, 0.5, hdr('#ffb800', 2.4));
        c.t = 999;
      }
      if (c.gy < -3) c.t = 999;
    }
    const gone = (a: { t: number; cell: number }[]) => a.filter((x) => (x.t < 900 ? true : (this.sprites.release(x.cell), false)));
    this.pods = gone(this.pods) as Pod[];
    this.coins = gone(this.coins) as Coin[];
    for (const p of this.pops) p.t -= dt;
    if (this.pops.some((p) => p.t <= 0)) {
      for (const p of this.pops) if (p.t <= 0) this.labels.release(p.cell);
      this.pops = this.pops.filter((p) => p.t > 0);
    }
    if (this.shieldFlash > 0) this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
  }

  private applyPower(k: Power) {
    const meta = POWER_META[k];
    if (this.mode === 'play') this.opts.payFor(['power', k]); // LIVE: using a power-up is a tx too (the reward applies either way)
    this.audio.fx('power');
    this.bloomKick = Math.max(this.bloomKick, 0.8);
    this.opts.cb.onFlash('power');
    this.ring(this.pl.x, P_GY, 7, 0.5, hdr(meta.colour, 2.2));
    this.parts.burst(this.pl.x, SHIP_Y, -P_GY, 24, 8, 0.6, 0.5, ...(new THREE.Color(meta.colour).multiplyScalar(2.4).toArray() as [number, number, number]));
    if (this.mode === 'play') this.opts.cb.onToast({ text: `${meta.label} · ${meta.blurb.toUpperCase()}`, tone: 'good' });
    if (k === 'shield') {
      this.shield = true;
      this.audio.fx('shield');
    } else if (k === 'bomb') this.bombs = Math.min(3, this.bombs + 1);
    else this.powerT[k] = meta.secs;
  }

  private stepBomb(dt: number) {
    if (this.bombR < 0) return;
    this.bombR += dt * 46;
    const r = this.bombR;
    for (const v of this.invs) {
      if (!v.alive) continue;
      if (Math.hypot(v.x - this.pl.x, v.gy - P_GY) < r) {
        if (v.mode === 'saucer') continue;
        v.alive = false;
        this.killInv(v, true);
      }
    }
    for (const e of this.ebolts) if (e.alive && Math.hypot(e.x - this.pl.x, e.gy - P_GY) < r) {
      e.alive = false;
      this.parts.burst(e.x, SHIP_Y, -e.gy, 3, 4, 0.3, 0.3, 2, 1.5, 0.3);
    }
    if (this.boss && !this.boss.dead && !this.bombHit && Math.hypot(this.boss.x - this.pl.x, this.boss.gy - P_GY) < r) {
      this.bombHit = true;
      this.damageBoss(Math.max(14, this.boss.maxHp * 0.14), this.boss.x, this.boss.gy);
    }
    if (r > 70) this.bombR = -1;
  }

  private stepBoss(dt: number) {
    const b = this.boss;
    if (!b) return;
    b.t += dt;
    b.flash = Math.max(0, b.flash - dt * 6);
    if (b.dead) {
      b.dieT -= dt;
      if (Math.random() < 0.5) {
        this.explode(b.x + rnd(-2.2, 2.2), b.gy + rnd(-2, 2), new THREE.Color(Math.random() < 0.5 ? '#ffb800' : '#ff3b2e'), 1.5, true);
        this.trauma = Math.min(1, this.trauma + 0.1);
      }
      if (b.dieT <= 0) {
        this.explode(b.x, b.gy, new THREE.Color('#ffffff'), 3, true);
        this.ring(b.x, b.gy, 40, 1.2, hdr('#ffffff', 2.4));
        this.bloomKick = 2;
        const toks = [this.opts.take((f) => f.kind === 'token'), this.opts.take((f) => f.kind === 'token'), this.opts.take((f) => f.kind === 'token')];
        toks.forEach((tx, i) => {
          const loot = tx ? lootFrom(tx) : null;
          if (loot) {
            const cell = this.sprites.alloc();
            if (cell >= 0) {
              this.drawCoin(cell, loot);
              this.coins.push({ x: b.x + (i - 1) * 2.2, gy: b.gy, loot, cell, t: 0 });
            }
          }
        });
        this.dropPod(b.x - 1.5, b.gy, 'shield');
        this.dropPod(b.x + 1.5, b.gy, Math.random() < 0.5 ? 'spread' : 'rail');
        if (this.lives < 3 && this.mode === 'play') {
          this.lives++;
          this.opts.cb.onToast({ text: 'HULL REPAIRED', tone: 'good' });
        }
        this.boss = null;
      }
      return;
    }
    const intro = Math.min(1, b.t / 3);
    const hover = 19 - Math.min(2, this.wave * 0.12);
    b.gy += (hover - b.gy) * Math.min(1, dt * 0.9) * (b.t < 6 ? 1 : 0.3);
    b.x = Math.sin(b.t * (b.phase === 2 ? 0.8 : 0.5)) * (HW - 2.6) * intro;
    if (b.t < 2.5) return;
    b.atk -= dt;
    if (b.atk <= 0) {
      const p2 = b.phase === 2;
      b.atk = p2 ? 1.25 : 2.1;
      const kind = Math.floor(b.t / (p2 ? 1.25 : 2.1)) % 3;
      if (kind === 0) {
        const n = p2 ? 9 : 7;
        for (let i = 0; i < n; i++) this.enemyBolt(b.x, b.gy - 1, 0, false, true, (i - (n - 1) / 2) * 0.17);
      } else if (kind === 1) {
        for (let i = 0; i < 3; i++) setTimeout(() => this.boss && !this.boss.dead && this.enemyBolt(this.boss.x, this.boss.gy - 1, this.pl.x, true, true), i * 160);
      } else {
        for (let i = 0; i < 12; i++) this.enemyBolt(b.x, b.gy - 1, 0, false, false, (i / 12) * Math.PI * 0.9 - Math.PI * 0.45 + Math.sin(b.t) * 0.2);
      }
      this.audio.fx('bossHit');
    }
    b.sum -= dt;
    if (b.sum <= 0) {
      b.sum = b.phase === 2 ? 4.5 : 7;
      for (let i = 0; !this.guest && i < 2; i++) {
        const tx = this.opts.take((x) => x.kind !== 'blast' && x.kind !== 'token');
        const d = this.makeInv(tx);
        d.mode = 'dive';
        d.baseX = clamp(b.x + (i ? 2.4 : -2.4), -HW + 1, HW - 1);
        d.x = d.baseX;
        d.gy = b.gy - 1;
        d.showLabel = true;
        this.invs.push(d);
        this.labelFor(d);
        this.announce(d, 'd');
      }
    }
  }

  // ───────────── Multiplayer ─────────────

  /** I am in a room but not the leader: the leader spawns waves, divers and enemy bolts; I mirror them. */
  private get guest() {
    return !!this.net && !this.net.isLeader();
  }

  private stopNet() {
    this.net?.dispose();
    this.net = null;
    this.claims.clear();
    this.myClaim.clear();
    this.bossClaim = null;
    this.boardKey = '';
    this.vsKills = 0;
    for (const t of this.tags.values()) disposeAvatarTag(t.sprite);
    this.tags.clear();
    if (this.remoteMesh) this.remoteMesh.count = 0;
  }

  private trimClaims() {
    if (this.claims.size < 700) return;
    let n = this.claims.size - 500;
    for (const k of this.claims.keys()) {
      if (n-- <= 0) break;
      this.claims.delete(k);
      this.myClaim.delete(k);
    }
  }

  /** Other pilots' shots: simulated from their pose flags at their fire cadence (cosmetic; their kills arrive as claims). */
  private stepRemoteFire(net: InvadersNet, dt: number) {
    const now = performance.now();
    for (const p of net.others(now)) {
      p.cool -= dt;
      if (!(p.fb & 1) || p.down || p.cool > 0 || p.buf.size === 0) continue;
      const spread = (p.fb & 2) !== 0;
      const rail = (p.fb & 4) !== 0;
      const x = p.buf.sample(now);
      for (const sp of fireSpecs(spread, rail)) if (!this.spawnBolt(x, sp, true)) break;
      p.cool = fireDelay((p.fb & 8) !== 0, spread, rail);
    }
  }

  private teamScore() {
    let t = this.score;
    if (this.net) for (const p of this.net.others()) t += p.score;
    return t;
  }

  private buildBoard(): BoardRow[] {
    const net = this.net;
    if (!net) return [];
    const now = performance.now();
    const rows: BoardRow[] = [];
    for (const p of net.peers.values()) {
      const me = p.id === net.me;
      if (!me && !net.present(p.id, now)) continue;
      rows.push({ id: p.id, handle: p.handle ?? (me ? this.opts.me?.handle ?? null : null), name: me ? this.opts.me?.name || p.name : p.name, verified: p.verified, colour: p.colour, score: me ? this.score : p.score, kills: me ? this.kills : p.kills, lives: me ? Math.max(0, this.lives) : Math.max(0, p.lives), down: me ? this.lives <= 0 : p.down, me });
    }
    return rows.sort((a, b) => b.score - a.score);
  }

  private stepNet(dt: number) {
    const net = this.net!;
    net.wave = this.wave;
    const pw = this.powerT;
    if (net.poseTick(dt)) net.sendPose({ x: this.pl.x, vx: this.pl.vx, lives: Math.max(0, this.lives), score: this.score, kills: this.kills, down: this.lives <= 0, shield: this.shield, fb: (this.firing ? 1 : 0) | (pw.spread > 0 ? 2 : 0) | (pw.rail > 0 ? 4 : 0) | (pw.overdrive > 0 ? 8 : 0), wave: this.wave });
    this.stepRemoteFire(net, dt);
    net.tick(dt, () => (this.waveState === 'clear' && !this.invs.length ? null : { x: this.form.x, gy: this.form.gy, dir: this.form.dir, wt: this.waveT, bt: this.boss && !this.boss.dead ? this.boss.t : null }));
    // Everyone down at once: the run is over for the whole room.
    if (this.lives <= 0 && this.phase === 'playing' && !net.anyOtherUp()) this.gameOver();
    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = 0.25;
      const rows = this.buildBoard();
      const key = rows.map((r) => `${r.id}${r.score}${r.kills}${r.lives}${r.down ? 1 : 0}${r.verified ? 1 : 0}`).join('|');
      if (key !== this.boardKey) {
        this.boardKey = key;
        this.opts.cb.onBoard?.(rows, net.cfg.mode, rows.reduce((a, r) => a + r.score, 0));
      }
    }
  }

  /** Leader: tell the others about a ship I just spawned (diver, saucer, boss summon). */
  private announce(v: Inv, m: 'd' | 's') {
    if (this.net?.isLeader()) this.net.sendSpawn({ m, r: this.rowOf(v), x: +v.x.toFixed(2), bx: +v.baseX.toFixed(2), vx: +v.vx.toFixed(2), gy: +v.gy.toFixed(2) });
  }

  /** Versus: my big kills (and every third kill) send extra divers down another pilot's lane. */
  private vsSend(big: boolean) {
    const net = this.net;
    if (!net) return;
    this.vsKills++;
    if (!big && this.vsKills % 3 !== 0) return;
    const targets = net.others().filter((p) => !p.down);
    if (!targets.length) return;
    const to = targets[Math.floor(Math.random() * targets.length)];
    net.sendVs(to.id, big ? 2 : 1);
  }

  private killRemote(v: Inv) {
    v.alive = false;
    this.explode(v.x, v.gy, v.ghost ? v.col.clone().multiplyScalar(0.6) : v.col, v.size, v.maxHp >= 3 || v.kind === 'token');
  }

  private applyRemoteKill(id: string, claim: Claim) {
    const net = this.net;
    if (!net) return;
    const mine = this.claims.get(id);
    if (!mine) {
      this.claims.set(id, claim);
      this.trimClaims();
      const v = this.invs.find((q) => q.alive && q.id === id && !q.priv);
      if (v) this.killRemote(v);
      return;
    }
    if (mine.by === claim.by) return; // the same claim again
    if (!claimBeats(claim, mine)) return; // mine (or an earlier one) stands
    this.claims.set(id, claim);
    if (mine.by === net.me) {
      const pts = this.myClaim.get(id) ?? 0;
      this.myClaim.delete(id);
      this.score = Math.max(0, this.score - pts);
      this.kills = Math.max(0, this.kills - 1);
      const w = net.peers.get(claim.by);
      this.opts.cb.onToast({ text: `KILL LOST TO ${w?.handle ? `@${w.handle}` : (w?.name ?? 'A PILOT')}`, tone: 'bad' });
    }
  }

  private handlers(): NetHandlers {
    return {
      onWave: (m) => {
        if (this.guest && m.n >= this.wave) this.startWave(m.n, m);
      },
      onSpawn: (m: SpawnMsg) => {
        const v = this.invFromRow(m.r);
        if (this.claims.has(v.id) || this.invs.some((q) => q.id === v.id)) return;
        v.mode = m.m === 's' ? 'saucer' : 'dive';
        v.baseX = m.bx;
        v.x = m.x;
        v.vx = m.vx;
        v.gy = m.gy;
        v.showLabel = true;
        if (v.mode === 'saucer') {
          v.size = 1.1;
          v.hp = v.maxHp = 1;
        } else v.size = Math.max(v.size, 0.95);
        this.invs.push(v);
        this.labelFor(v);
      },
      onBolts: (rows: BoltRow[]) => {
        if (!this.guest) return;
        for (const r of rows) this.spawnEBolt(r[0], r[1], r[2], r[3], r[4] === 1);
      },
      onHit: (id, d) => {
        const v = this.invs.find((q) => q.alive && q.id === id && !q.priv);
        if (!v) return;
        v.hp = Math.max(1, v.hp - d); // only a claim can finish it
        v.flash = 1;
        this.parts.burst(v.x, SHIP_Y, -v.gy, 4, 5, 0.3, 0.35, 2, 2, 2);
      },
      onKill: (id, claim) => this.applyRemoteKill(id, claim),
      onBossHit: (d) => {
        const b = this.boss;
        if (b && !b.dead) this.damageBoss(d, b.x, b.gy, true);
      },
      onBossKill: (claim) => {
        const b = this.boss;
        const net = this.net;
        if (!b || !net) return;
        if (!b.dead) {
          b.hp = 0;
          this.damageBoss(0, b.x, b.gy, true);
          return;
        }
        const mine = this.bossClaim;
        if (mine && claimBeats(claim, { by: net.me, t: mine.t })) {
          this.score = Math.max(0, this.score - mine.pts);
          this.bossClaim = null;
          this.opts.cb.onToast({ text: 'BOSS KILL LOST', tone: 'bad' });
        }
      },
      onForm: (f) => {
        if (!this.guest) return;
        const fm = this.form;
        fm.dir = f.dir;
        fm.x += (f.x - fm.x) * 0.4;
        fm.gy += (f.gy - fm.gy) * 0.4;
        this.waveT = Math.abs(this.waveT - f.wt) > 0.25 ? f.wt : this.waveT + (f.wt - this.waveT) * 0.4;
        const b = this.boss;
        if (f.bt !== null && b && !b.dead) b.t = Math.abs(b.t - f.bt) > 0.3 ? f.bt : b.t + (f.bt - b.t) * 0.4;
      },
      onVs: (n: number, from: Peer) => {
        if (this.lives <= 0 || this.phase !== 'playing') return;
        for (let i = 0; i < n; i++) {
          const v = this.makeInv(this.ghostTx(), false);
          v.mode = 'dive';
          v.priv = true;
          v.baseX = clamp(this.pl.x + rnd(-2.4, 2.4), -HW + 1.6, HW - 1.6);
          v.x = v.baseX;
          v.gy = 33 + i * 3;
          v.showLabel = true;
          v.size = Math.max(v.size, 0.95);
          this.invs.push(v);
          this.labelFor(v);
        }
        this.opts.cb.onToast({ text: `${n} INVADER${n > 1 ? 'S' : ''} FROM ${from.handle ? `@${from.handle}` : from.name}`, tone: 'bad' });
      },
      onPeers: () => undefined,
    };
  }

  /** Remote ships (interpolated from the snapshot buffer) and the avatar billboards over every ship, mine included. */
  private writeRemotes(t: number) {
    const rm = this.remoteMesh;
    const net = this.net;
    let n = 0;
    const seen = new Set<string>();
    if (net && this.mode === 'play') {
      const now = performance.now();
      const arr = rm.instanceColor!.array as Float32Array;
      for (const p of net.peers.values()) {
        const me = p.id === net.me;
        const here = me || (net.present(p.id, now) && p.buf.size > 0);
        const down = me ? this.lives <= 0 : p.down;
        if (!here || down) continue;
        const x = me ? this.pl.x : p.buf.sample(now);
        if (!me) {
          const i = n++;
          TMP.v.set(x, SHIP_Y + 0.05 + Math.sin(t * 3 + i) * 0.05, 0);
          TMP.e.set(0.02, 0, clamp(-(x - p.buf.sample(now - 60)) * 3, -0.7, 0.7));
          TMP.q.setFromEuler(TMP.e);
          TMP.s.setScalar(0.85);
          TMP.m.compose(TMP.v, TMP.q, TMP.s);
          rm.setMatrixAt(i, TMP.m);
          TMP.c.set(p.colour);
          arr[i * 3] = TMP.c.r * 1.9;
          arr[i * 3 + 1] = TMP.c.g * 1.9;
          arr[i * 3 + 2] = TMP.c.b * 1.9;
          rm.state.setXYZW(i, 0, 0, 1, 0);
        }
        // Avatar billboard (sprites: any AO pass must hide them; this game has none, only bloom).
        const o = { handle: p.handle, name: p.name, ring: p.colour, verified: p.verified };
        const key = tagKey(o);
        let tag = this.tags.get(p.id);
        if (!tag || tag.key !== key) {
          if (tag) disposeAvatarTag(tag.sprite);
          tag = { sprite: makeAvatarTag(o, me ? 0.95 : 1.15), key };
          this.scene.add(tag.sprite);
          this.tags.set(p.id, tag);
        }
        tag.sprite.position.set(x, SHIP_Y + 0.85, 0);
        fitAvatarTag(tag.sprite, this.camera, 0.04, 3.2);
        seen.add(p.id);
      }
    }
    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        disposeAvatarTag(tag.sprite);
        this.tags.delete(id);
      }
    }
    rm.count = n;
    rm.instanceMatrix.needsUpdate = true;
    rm.instanceColor!.needsUpdate = true;
    rm.state.needsUpdate = true;
  }

  // ───────────── Per-frame ─────────────

  private loop() {
    if (this.disposed) return;
    const real = Math.min(0.05, this.clock.getDelta());
    this.frameN++;
    this.perf(real);
    const nowMs = performance.now();
    const beat = this.audio.update(real, nowMs);
    if (beat) this.onBeat();
    // time scales
    let simDt = real * this.slow;
    if (this.freeze > 0) {
      this.freeze -= real;
      simDt = 0;
    }
    if (this.slowT > 0) {
      this.slowT -= real;
      if (this.slowT <= 0) this.slow = 1;
    }
    const fxDt = real * (this.freeze > 0 ? 0.15 : this.slow);
    this.padNow = this.pad.read();
    if (this.phase === 'playing' || this.phase === 'menu' || this.phase === 'over') {
      if (this.phase === 'playing' && (this.edge('KeyP', 'Escape') || this.padNow.pause)) this.pause(true);
      if (simDt > 0) this.step(simDt);
      if (this.phase === 'over') {
        this.overT -= real;
        if (this.overT <= 0 && this.mode === 'play') this.startAttract();
      }
    } else if (this.phase === 'paused') {
      if (this.edge('KeyP', 'Escape', 'Enter')) this.pause(false);
    }
    if (simDt > 0 || this.phase !== 'playing') this.pressed.clear();
    this.updatePressure(real);
    this.updateFx(fxDt, real);
    this.render(real);
    this.pushHud();
  }

  private onBeat() {
    this.bloomKick = Math.max(this.bloomKick, 0.55);
    this.pulse = 1;
    this.pulseR = 0;
  }

  private updatePressure(real: number) {
    this.rateT += real;
    if (this.rateT >= 1) {
      const w = this.opts.waiting();
      const rate = Math.max(0, w - this.lastWaiting + this.taken) / this.rateT;
      this.lastWaiting = w;
      this.taken = 0;
      this.rateT = 0;
      this.txRate += (rate - this.txRate) * 0.4;
    }
    const target = this.opts.status() === 'live' ? pressureFrom(this.txRate) : 0.15 + 0.1 * Math.sin(this.time * 0.2);
    this.press += (target - this.press) * Math.min(1, real * 0.8);
  }

  private perf(dt: number) {
    this.fpsMs += (dt * 1000 - this.fpsMs) * 0.05;
    if (this.phase === 'loading') return;
    this.perfCool -= dt;
    this.perfT += dt;
    if (this.perfCool <= 0) {
      if (this.fpsMs > 24) this.lowFrames++;
      else this.lowFrames = Math.max(0, this.lowFrames - 1);
      if (this.lowFrames > 70) {
        this.lowFrames = 0;
        this.perfCool = 3;
        this.degrade();
      }
    }
    if (this.perfT > 2) {
      this.perfT = 0;
      this.opts.cb.onPerf?.({ fps: Math.round(1000 / Math.max(1, this.fpsMs)), level: this.fxLevel });
    }
  }
  private degrade() {
    if (this.dpr > 1.05) {
      this.dpr = Math.max(1, this.dpr - 0.35);
      this.resize();
    } else if (this.fxLevel >= 2) {
      this.fxLevel = 1;
      this.buildComposer();
    } else if (this.dpr > 0.75) {
      this.dpr = Math.max(0.75, this.dpr - 0.15);
      this.resize();
    }
  }

  private updateFx(dt: number, real: number) {
    this.parts.update(dt);
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(0.3 + (r.max - 0.3) * (1 - (1 - k) * (1 - k)));
      r.mat.opacity = (1 - k) * (1 - k);
    }
    this.trauma = Math.max(0, this.trauma - real * 1.5);
    this.hitFlash = Math.max(0, this.hitFlash - real * 2.4);
    this.bloomKick = Math.max(0, this.bloomKick - real * 3.2);
    this.pulseR += real * 70;
    this.pulse = Math.max(0, this.pulse - real * 1.6);
    this.scroll += real * (7 + this.press * 12) * (this.mode === 'play' ? 1 : 0.7);
  }

  private writeScene(real: number) {
    const t = this.time;
    const beat = this.audio.env;
    const pulse = 1 + beat * 0.1;
    for (const k of KIND_ORDER) this.hulls[k].count = 0;
    for (const v of this.invs) {
      if (!v.alive) continue;
      const mesh = this.hulls[v.kind];
      const i = mesh.count++;
      if (i >= MAX_INV) {
        mesh.count--;
        continue;
      }
      const ent = v.mode === 'form' ? clamp((this.waveT - v.delay) / 0.9, 0, 1) : clamp(v.t / 0.5, 0, 1);
      const spawn = 1 - (1 - ent) * (1 - ent);
      TMP.v.set(v.x, SHIP_Y + Math.sin(t * 2 + v.seed) * 0.12 + beat * 0.12, -v.gy);
      TMP.e.set(Math.sin(t * 1.3 + v.seed) * 0.06, v.kind === 'blast' ? t * 0.8 : Math.sin(t * 0.9 + v.seed) * 0.25, clamp(-v.vx * 0.05, -0.5, 0.5) + (v.mode === 'dive' ? Math.sin(t * 3 + v.seed) * 0.2 : 0));
      TMP.q.setFromEuler(TMP.e);
      const sc = v.size * 1.3 * (0.2 + 0.8 * spawn) * pulse * (1 + v.flash * 0.18 + v.charge * 0.1);
      TMP.s.setScalar(sc);
      TMP.m.compose(TMP.v, TMP.q, TMP.s);
      mesh.setMatrixAt(i, TMP.m);
      const dim = v.ghost ? 0.55 : 1;
      const arr = mesh.instanceColor!.array as Float32Array;
      arr[i * 3] = v.col.r * dim;
      arr[i * 3 + 1] = v.col.g * dim;
      arr[i * 3 + 2] = v.col.b * dim;
      mesh.state.setXYZW(i, v.flash, v.charge, spawn, 0);
    }
    for (const k of KIND_ORDER) {
      const m = this.hulls[k];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
      m.state.needsUpdate = true;
    }
    // player
    const pm = this.playerMesh;
    const alive = this.lives > 0 || this.mode === 'attract';
    pm.count = alive ? 1 : 0;
    if (alive) {
      const blink = this.pl.invuln > 0 && this.pl.invuln < 100 && Math.floor(t * 18) % 2 === 0;
      TMP.v.set(this.pl.x, SHIP_Y + 0.05 + Math.sin(t * 3) * 0.05, -P_GY + this.pl.recoil * 0.18);
      TMP.e.set(0.02 - this.pl.recoil * 0.05, 0, this.pl.bank);
      TMP.q.setFromEuler(TMP.e);
      TMP.s.setScalar(0.85 * (1 + beat * 0.03));
      TMP.m.compose(TMP.v, TMP.q, TMP.s);
      pm.setMatrixAt(0, TMP.m);
      const arr = pm.instanceColor!.array as Float32Array;
      const mine = this.net ? TMP.c.set(this.net.peers.get(this.net.me)?.colour ?? '#e8261d') : null;
      const hot = this.powerT.overdrive > 0 ? [0.8, 1.6, 0.1] : this.powerT.rail > 0 ? [0.1, 1.2, 1.8] : this.powerT.spread > 0 ? [1.8, 0.2, 0.9] : mine ? [mine.r * 1.9, mine.g * 1.9, mine.b * 1.9] : [1.9, 0.18, 0.12];
      arr[0] = hot[0];
      arr[1] = hot[1];
      arr[2] = hot[2];
      pm.state.setXYZW(0, 0, 0, blink ? 0.15 : 1, 0);
      pm.instanceMatrix.needsUpdate = true;
      pm.instanceColor!.needsUpdate = true;
      pm.state.needsUpdate = true;
    }
    this.writeRemotes(t);
    // shield
    this.shieldMesh.visible = this.shield || this.shieldFlash > 0;
    if (this.shieldMesh.visible) {
      this.shieldMesh.position.set(this.pl.x, SHIP_Y, -P_GY);
      this.shieldMesh.rotation.y = t * 0.8;
      this.shieldMesh.rotation.x = t * 0.5;
      this.shieldMesh.scale.setScalar(1 + this.shieldFlash * 0.5 + Math.sin(t * 6) * 0.03);
      (this.shieldMesh.material as THREE.MeshBasicMaterial).opacity = this.shield ? 0.45 + beat * 0.2 : this.shieldFlash * 0.8;
    }
    // boss
    const bo = this.boss;
    this.bossMesh.count = bo ? 1 : 0;
    if (bo) {
      const dying = bo.dead ? Math.sin(t * 60) * 0.12 : 0;
      TMP.v.set(bo.x + dying, SHIP_Y + 1.2 + Math.sin(t * 1.4) * 0.3, -bo.gy);
      TMP.e.set(t * 0.31, t * 0.5, t * 0.17);
      TMP.q.setFromEuler(TMP.e);
      TMP.s.setScalar(1.55 * Math.min(1, bo.t / 2.5 + 0.1) * (1 + beat * 0.05 + bo.flash * 0.06));
      TMP.m.compose(TMP.v, TMP.q, TMP.s);
      this.bossMesh.setMatrixAt(0, TMP.m);
      const arr = this.bossMesh.instanceColor!.array as Float32Array;
      const p2 = bo.phase === 2;
      arr[0] = p2 ? 2.2 : 1.8;
      arr[1] = p2 ? 0.25 : 1.0;
      arr[2] = p2 ? 0.2 : 0.1;
      this.bossMesh.state.setXYZW(0, bo.flash * 0.3, 0, 1, 0);
      this.bossMesh.instanceMatrix.needsUpdate = true;
      this.bossMesh.instanceColor!.needsUpdate = true;
      this.bossMesh.state.needsUpdate = true;
    }
    // bolts
    let n = 0;
    const bc = this.boltMesh.instanceColor!.array as Float32Array;
    for (const b of this.bolts) {
      if (!b.alive) continue;
      TMP.v.set(b.x, SHIP_Y, -b.gy);
      TMP.e.set(0, Math.atan2(b.vx, -b.vy), 0);
      TMP.q.setFromEuler(TMP.e);
      TMP.s.set(b.rail ? 0.1 : 0.12, 0.12, b.rail ? 1.9 : 1.05);
      TMP.m.compose(TMP.v, TMP.q, TMP.s);
      this.boltMesh.setMatrixAt(n, TMP.m);
      if (b.rail) { bc[n * 3] = 2.6; bc[n * 3 + 1] = 3.0; bc[n * 3 + 2] = 3.4; } else { bc[n * 3] = 0.35; bc[n * 3 + 1] = 1.9; bc[n * 3 + 2] = 2.6; }
      n++;
    }
    this.boltMesh.count = n;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    this.boltMesh.instanceColor!.needsUpdate = true;
    n = 0;
    const ec = this.ebMesh.instanceColor!.array as Float32Array;
    for (const e of this.ebolts) {
      if (!e.alive) continue;
      TMP.v.set(e.x, SHIP_Y, -e.gy);
      TMP.e.set(0, Math.atan2(e.vx, -e.vy), 0);
      TMP.q.setFromEuler(TMP.e);
      const s = e.big ? 0.34 : 0.2;
      TMP.s.set(s, s, s * 2.6);
      TMP.m.compose(TMP.v, TMP.q, TMP.s);
      this.ebMesh.setMatrixAt(n, TMP.m);
      const flick = 0.8 + 0.4 * Math.sin(t * 40 + n);
      ec[n * 3] = 2.8 * flick;
      ec[n * 3 + 1] = e.big ? 0.9 : 0.25;
      ec[n * 3 + 2] = e.big ? 0.2 : 0.9;
      n++;
    }
    this.ebMesh.count = n;
    this.ebMesh.instanceMatrix.needsUpdate = true;
    this.ebMesh.instanceColor!.needsUpdate = true;
    // shards
    n = 0;
    const sc = this.shardMesh.instanceColor!.array as Float32Array;
    for (const s of this.shards) {
      if (!s.alive) continue;
      s.t -= real;
      if (s.t <= 0) {
        s.alive = false;
        continue;
      }
      s.v.y -= 16 * real;
      s.p.addScaledVector(s.v, real);
      if (s.p.y < 0.1) {
        s.p.y = 0.1;
        s.v.y *= -0.35;
        s.v.x *= 0.7;
        s.v.z *= 0.7;
      }
      s.ang += s.spin * real;
      TMP.q.setFromAxisAngle(s.ax, s.ang);
      TMP.s.setScalar(s.s * Math.min(1, s.t / (s.max * 0.4)));
      TMP.m.compose(s.p, TMP.q, TMP.s);
      this.shardMesh.setMatrixAt(n, TMP.m);
      sc[n * 3] = s.c.r;
      sc[n * 3 + 1] = s.c.g;
      sc[n * 3 + 2] = s.c.b;
      n++;
    }
    this.shardMesh.count = n;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    this.shardMesh.instanceColor!.needsUpdate = true;
    // billboards: labels (+ popups), then sprites (coins, pods)
    const lr: [number, number, number, number] = [0, 0, 0, 0];
    this.labelBB.begin();
    for (const v of this.invs) {
      if (!v.alive || !v.showLabel || v.label < 0) continue;
      const ent = v.mode === 'form' ? clamp((this.waveT - v.delay - 0.5) / 0.6, 0, 1) : clamp(v.t / 0.6, 0, 1);
      if (ent <= 0) continue;
      const far = clamp(1 - (v.gy - 26) / 12, 0, 1);
      const stag = v.mode === 'form' ? (Math.round(v.slot!.x * 4 / 7) % 2 ? 0.55 : 0) : 0;
      this.labels.rect(v.label, lr);
      this.labelBB.add(v.x, SHIP_Y + 1.15 + v.size * 0.75 + stag, -v.gy - 0.2, 3.1, 0.78, lr, 1, 1, 1, 0.95 * ent * far);
    }
    if (bo) {
      const bi = this.bossLabel(bo);
      if (bi >= 0) {
        this.labels.rect(bi, lr);
        this.labelBB.add(bo.x, 5.2, -bo.gy, 6.4, 1.6, lr, 1, 1, 1, 1);
      }
    }
    for (const p of this.pops) {
      const k = 1 - p.t / p.max;
      this.labels.rect(p.cell, lr);
      this.labelBB.add(p.x, p.y + k * 1.8, -p.gy, 2.4, 0.6, lr, 1, 1, 1, Math.min(1, p.t * 3.5));
    }
    this.labelBB.end();
    this.labels.flush();
    this.spriteBB.begin();
    const sr: [number, number, number, number] = [0, 0, 0, 0];
    for (const c of this.coins) {
      this.sprites.rect(c.cell, sr);
      const pulse2 = 1 + Math.sin(c.t * 8) * 0.08;
      this.spriteBB.add(c.x, 1.05 + Math.sin(c.t * 4) * 0.15, -c.gy, 1.45 * pulse2, 1.45 * pulse2, sr, 1.6, 1.5, 1.2, 1);
    }
    for (const p of this.pods) {
      this.sprites.rect(p.cell, sr);
      const pm2 = POWER_META[p.kind];
      const cc = new THREE.Color(pm2.colour);
      this.spriteBB.add(p.x, 1.1 + Math.sin(p.t * 4) * 0.12, -p.gy, 1.6, 1.6, sr, 1.0 + cc.r * 0.6, 1.0 + cc.g * 0.6, 1.0 + cc.b * 0.6, 1);
    }
    this.spriteBB.end();
    this.sprites.flush();
  }

  private bossLabelCell = -1;
  private bossLabelText = '';
  private bossLabel(bo: Boss) {
    const text = bo.name;
    if (this.bossLabelCell < 0) this.bossLabelCell = this.labels.alloc();
    if (this.bossLabelCell >= 0 && this.bossLabelText !== text) {
      this.bossLabelText = text;
      this.labels.draw(this.bossLabelCell, (g, w, h) => {
        g.fillStyle = 'rgba(6,6,10,0.85)';
        g.fillRect(2, 2, w - 4, h - 4);
        g.fillStyle = '#ffb800';
        g.fillRect(2, 2, w - 4, 3);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#ffb800';
        g.font = `900 ${Math.round(h * 0.62)}px ${'Impact, "Arial Black", sans-serif'}`;
        g.fillText(text, w / 2, h / 2 + 3);
      });
    }
    return this.bossLabelCell;
  }

  private render(real: number) {
    const t = this.time;
    const beat = this.audio.env;
    this.writeScene(real);
    const fu = this.floor.uniforms;
    fu.uTime.value = t;
    fu.uScroll.value = this.scroll;
    fu.uBeat.value = beat;
    fu.uPX.value = this.pl.x;
    fu.uPress.value = this.press;
    fu.uPulseR.value = this.pulseR;
    fu.uPulse.value = this.pulse;
    this.sky.uniforms.uTime.value = t;
    this.sky.uniforms.uPress.value = this.press;
    this.sky.uniforms.uBeat.value = beat;
    this.sky.uniforms.uPX.value = this.pl.x;
    this.sky.mesh.position.copy(this.camera.position);
    this.stars.uniforms.uScroll.value = this.scroll * 0.4;
    this.stars.uniforms.uBeat.value = beat;
    for (const l of this.stars.layers) l.pts.position.x = -this.pl.x * l.k * 1.4;
    this.rails.uniforms.uScroll.value = this.scroll;
    this.rails.uniforms.uBeat.value = beat;
    for (const b of this.blocks.items) {
      b.m.rotation.x += b.spin * real;
      b.m.rotation.y += b.spin * 0.7 * real;
      // Drift toward the camera like everything else (the ship flies forward); wrap far away, fading at both ends.
      b.m.position.z += real * (4 + this.press * 6);
      if (b.m.position.z > -90) b.m.position.z -= 260;
      (b.m.material as THREE.LineBasicMaterial).opacity = 0.55 * THREE.MathUtils.clamp((-b.m.position.z - 90) / 70, 0, 1) * THREE.MathUtils.clamp((-b.m.position.z < 330 ? 1 : (350 - -b.m.position.z) / 20), 0, 1);
    }
    for (const m of this.hullMats) {
      m.uniforms.uBeat.value = beat;
      m.uniforms.uTime.value = t;
    }
    // camera: follows the ship a little, shakes, kicks on the beat
    const sh = this.trauma * this.trauma;
    const sx = (Math.sin(t * 61) + Math.sin(t * 37 + 1)) * 0.5 * sh * 0.55;
    const sy = (Math.sin(t * 53 + 2) + Math.sin(t * 29)) * 0.5 * sh * 0.4;
    this.camera.position.set(this.camBase.x + this.pl.x * 0.2 + sx, this.camBase.y + sy - beat * 0.08, this.camBase.z - beat * 0.15);
    this.camera.lookAt(this.camLook.x + this.pl.x * 0.12, this.camLook.y, this.camLook.z);
    this.camera.rotation.z += sx * 0.012;
    const bombFov = this.bombR >= 0 ? Math.max(0, 1 - this.bombR / 40) * 5 : 0;
    const baseFov = this.camera.aspect < 1 ? 58 : 56;
    const fov = baseFov + bombFov - beat * 0.4;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // post
    if (this.bloom) this.bloom.strength = 0.34 + this.bloomKick * 0.3 + this.press * 0.1;
    const u = this.grade?.uniforms;
    if (u) {
      u.uTime.value = t;
      u.uHit.value = this.hitFlash;
      u.uBeat.value = beat;
      u.uAb.value = 0.0008 + sh * 0.005 + this.bloomKick * 0.0006 + (this.slow < 1 ? 0.002 : 0);
      u.uWarp.value.set(this.bombR >= 0 ? Math.max(0, 1 - this.bombR / 70) : 0, this.bombR >= 0 ? this.bombR / 28 : 0, 0);
      (u.uFlash.value as THREE.Vector4).set(this.hitFlash > 0.5 ? 0.5 : 0, 0.05, 0.02, this.hitFlash * 0.12);
    }
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private pushHud() {
    const h = this.hudOut;
    const play = this.mode === 'play';
    h.score = play ? (this.net && !this.net.versus ? this.teamScore() : this.score) : 0;
    h.hi = Math.max(this.hi, this.score);
    h.lives = Math.max(0, this.lives);
    h.wave = this.wave;
    h.combo = this.combo.count;
    h.mult = multFor(this.combo.count);
    h.comboT = this.combo.count > 0 ? clamp(this.combo.timer / COMBO_WINDOW, 0, 1) : 0;
    h.nextAt = nextMultAt(this.combo.count);
    h.bombs = this.bombs;
    h.shield = this.shield;
    h.powers.length = 0;
    for (const k of ['spread', 'rail', 'overdrive'] as const) if (this.powerT[k] > 0) h.powers.push({ key: k, t: this.powerT[k] / POWER_META[k].secs });
    h.boss = this.boss && !this.boss.dead ? { name: this.boss.name, hp: clamp(this.boss.hp / this.boss.maxHp, 0, 1) } : null;
    h.pressure = this.press;
    h.txs = this.txRate;
    h.left = this.liveInvs();
    h.kills = this.kills;
    h.beat = this.audio.env;
    h.fps = Math.round(1000 / Math.max(1, this.fpsMs));
    this.opts.cb.onHud(h);
  }

  // ───────────── Debug (dev only) ─────────────

  debug = {
    boss: () => {
      this.blockPending = { height: this.blockSeen || 900000, txCount: 4000 };
      this.clearField();
      this.startWave(Math.max(2, this.wave));
    },
    wave: (n: number) => {
      this.clearField();
      this.startWave(n);
    },
    power: (k: Power) => this.applyPower(k),
    die: () => {
      this.lives = 1;
      this.pl.invuln = 0;
      this.damagePlayer();
    },
    god: () => {
      this.pl.invuln = 9999;
    },
    combo: (n: number) => {
      this.combo.count = n;
      this.combo.timer = COMBO_WINDOW;
    },
    ndc: (x: number, gy: number) => { const v = new THREE.Vector3(x, SHIP_Y, -gy).project(this.camera); return [v.x, v.y]; },
    drop: (kind: Power) => this.dropPod(this.pl.x, 9, kind),
    mp: () => ({ on: !!this.net, sent: this.net?.sent ?? 0, got: this.net?.got ?? 0, leader: this.net?.leaderId() ?? null, me: this.net?.me ?? null, wave: this.wave, waveState: this.waveState, alive: this.invs.filter((v) => v.alive && !v.priv).map((v) => v.id.slice(0, 8)).sort(), form: this.invs.filter((v) => v.alive && v.mode === 'form').length, claims: this.claims.size, score: this.score, kills: this.kills, lives: this.lives, boss: this.boss ? Math.round(this.boss.hp) : null, tags: [...this.tags.keys()], peers: this.net ? [...this.net.peers.values()].map((p) => ({ id: p.id, h: p.handle, v: p.verified, x: +p.buf.sample(performance.now()).toFixed(1), score: p.score, down: p.down })) : [], fx: +this.form.x.toFixed(2), fgy: +this.form.gy.toFixed(2) }),
    state: () => ({ phase: this.phase, mode: this.mode, score: this.score, lives: this.lives, wave: this.wave, invs: this.invs.length, alive: this.liveInvs(), boss: this.boss?.hp ?? null, draw: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, fps: Math.round(1000 / this.fpsMs), parts: this.parts.count }),
  };

  // ───────────── Teardown ─────────────

  dispose() {
    this.disposed = true;
    this.stopNet();
    if (this.blockTimer) clearInterval(this.blockTimer);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.visHandler);
    this.ro?.disconnect();
    if (!this.renderer) return;
    this.renderer.setAnimationLoop(null);
    const c = this.renderer.domElement;
    c.removeEventListener('pointerdown', this.onPtrDown);
    c.removeEventListener('pointermove', this.onPtrMove);
    c.removeEventListener('pointerup', this.onPtrUp);
    c.removeEventListener('pointercancel', this.onPtrUp);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const g of this.geos) g.dispose();
    this.labels?.dispose();
    this.sprites?.dispose();
    this.labelBB?.dispose();
    this.spriteBB?.dispose();
    this.parts?.dispose();
    this.blocks?.dispose();
    this.rails?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    c.remove();
  }
}
