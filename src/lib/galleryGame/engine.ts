/**
 * ESCAPE FROM TERRORNODE 3D engine. First person behind the BSVGun weapons (same GLB models, buildGun, aim
 * follow, recoil, spin-up, muzzle flash and minigun audio as src/lib/bsvgun/engine.ts), in a night city
 * (./city.ts) rendered the Arena way: ACES filmic, soft shadows, GTAO on desktop, bloom, colour grade.
 *
 * FOUR STAGES in one engine (tuning in ./tuning.ts `stages`, sets in ./city.ts and ./stages.ts):
 *   1 STREET (Erobots only) -> 2 HQ FLOORS (Erobots) -> 3 SERVER CORE (jam it with sustained fire) -> 4 ROOFTOP
 *   (the LIQUID UNIT, once, then the RESCUED beat). A stage ends on its goal; a lift transition swaps the set.
 *   Death and CONTINUE stay on the stage. Nothing here decides how many rounds are fired.
 *
 * Transactions drive damage. The engine never decides how many bullets land: the page calls
 * `accept(n)` with newly accepted (or, in practice, simulated) transactions, and each one is one round of
 * the held weapon's damage along the aim ray (with its spread). The trigger itself only drives the look:
 * barrel spin, muzzle flash, tracers and brass, and `hooks.pull()` for burst weapons (one batch per pull).
 */
import * as THREE from 'three';
import { LITE_DPR, LITE_TEX } from '@/lib/mobileLite';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { buildGun, type HeldGun } from '../arenaHD';
import { loadGunModel } from '../ordnanceModels';
import { brandGun, tintAmount, tintGun } from '../ordnanceGun';
import { loadLook, makeGradePass, type Look } from '../visuals/look';
import { AMMO_SFX, minigun, sfx, unlockAudio } from '../sfx';
import { Fx } from '../bsvgun/fx';
import { glowTexture, halo } from '../bsvgun/targets';
import type { RangeWeapon } from '../bsvgun/weapons';
import { buildCity, EYE, TOWER, type City, type Rack, type Window } from './city';
import { buildCore, buildFloors, buildRoof, type StageSet, type World } from './stages';
import { LiquidUnit } from './boss';
import { KWEG } from '../gallery/story';
import { ErobotWave } from './enemies';
import { Horde } from './horde';
import { Bolts, type HurtKind } from './combat';
import { TUNING } from './tuning';
import type { Level, LevelId, WavePattern } from '../terrornode/levels';
import type { Dressing } from '../terrornode/dressing';

export type Quality = 'low' | 'high';
export type Stats = {
  score: number;
  bossHp: number;
  bossMax: number;
  /** The stage, 1 to 4 (kept as `wave` too for the results). */
  wave: number;
  stage: number;
  /** The stage goal: the block clock (seconds left of the ten minutes), or the boss once he is in. */
  goal: { kind: 'block' | 'boss'; label: string; now: number; max: number };
  /** Seconds into the ten-minute block, and its length. */
  runSecs: number;
  runMax: number;
  /** The core's jam 0..1 (stage 3). */
  jam: number;
  windowsLeft: number;
  windows: number;
  racksLeft: number;
  racks: number;
  drones: number;
  kills: number;
  hover: string;
  hp: number;
  hpMax: number;
  bossPush: number;
  bossDist: number;
  /** The Liquid Unit is in play (stage 4). */
  bossOn: boolean;
};
/** Stage flow events for the page: the lift closes (`leave`), a stage opens (`enter`), the boss is down, the hostage is free. */
export type StageEvent = { kind: 'enter'; stage: number; line: string } | { kind: 'boss' } | { kind: 'down' } | { kind: 'rescued' } | { kind: 'clear'; level: LevelId; score: number; rounds: number };
/** The player was hurt. `angle`: where it came from relative to the view (0 ahead, + right, +-PI behind). */
export type Hurt = { angle: number; dmg: number; kind: HurtKind; hp: number; hpMax: number };
export type Hooks = {
  /** A burst weapon's trigger pull: return false to refuse (no ammo / pack spent / one in flight). */
  pull: (w: RangeWeapon) => boolean;
  /** Is the stream flowing? (Stream weapons only show fire while transactions are being accepted.) */
  flowing: () => boolean;
  stats: (s: Stats) => void;
  trigger: (down: boolean) => void;
  /** The player took damage (HUD: vignette, direction marker). */
  hurt: (h: Hurt) => void;
  /** Health hit zero: the player is down (FLATLINED, the CONTINUE? countdown). */
  died: () => void;
  /** Stage flow: the lift, a new stage, the final boss down, the rescue. */
  stage: (e: StageEvent) => void;
  /** The browser dropped the WebGL context (iOS under memory pressure): the page offers a reload. */
  lost?: () => void;
};

type Drone = { g: THREE.Group; rotors: THREE.Mesh[]; hp: number; dead: number; t: number; v: THREE.Vector3; base: THREE.Vector3; body: THREE.Mesh };

const v3 = () => new THREE.Vector3();
/**
 * A streamable piece of the world: what draws, and its lights. Hiding a piece hides its drawables and zeroes its
 * lights but leaves the lights in the scene, so the scene's light count never changes and no shader recompiles.
 */
type Kit = { draw: { o: THREE.Object3D; v: boolean }[]; lights: { l: THREE.Light; i: number }[]; on: boolean };
const kitOf = (root: THREE.Object3D): Kit => {
  const k: Kit = { draw: [], lights: [], on: true };
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) k.lights.push({ l: o as THREE.Light, i: (o as THREE.Light).intensity });
    else if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) k.draw.push({ o, v: o.visible });
  });
  return k;
};
const showKit = (k: Kit, on: boolean) => {
  if (k.on === on) return;
  k.on = on;
  // hiding remembers each piece's own visibility (a smashed pane, a cut rope) and showing puts it back
  for (const d of k.draw) {
    if (on) d.o.visible = d.v;
    else {
      d.v = d.o.visible;
      d.o.visible = false;
    }
  }
  for (const x of k.lights) {
    if (on) {
      if (x.l.intensity === 0) x.l.intensity = x.i;
    } else if (x.l.intensity !== 0) {
      x.i = x.l.intensity;
      x.l.intensity = 0;
    }
  }
};
/** Tell the page a new stage has opened (with Dr Wong's line for the stage just cleared). */
const skipLine = (hooks: Hooks, to: number) => hooks.stage({ kind: 'enter', stage: to + 1, line: KWEG.clear[Math.max(0, to - 1)] ?? '' });
const BASE_FOV = 60;
/** The ten-minute block as a level (the default until a level is picked; the full table is lazy-loaded). */
const BLOCK = {
  id: 'assault',
  n: 0,
  name: 'ESCAPE FROM TERRORNODE',
  blurb: '',
  kweg: '',
  boss: true,
  palette: { fog: '#071420', density: 0.0066, bg: '#05060f', exposure: 0, bloom: 0, key: '#27e6ff', rim: '#ff2bd6' },
  solo: { from: 0, to: 600, roles: { shooter: 0.42, rusher: 0.32, flanker: 0.26 }, horde: {}, wave: { kind: 'steady', k: 1 }, levelUp: 0 },
  team: { name: 'ESCAPE FROM TERRORNODE', waves: 10, base: 4, perWave: 3, speed: 2.4, speedPerWave: 0.25, hpK: 1, kinds: [0, 1, 2, 3, 4] },
} satisfies Level;

export class GalleryEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 900);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private ao: GTAOPass | null = null;
  private grade: ReturnType<typeof makeGradePass> | null = null;
  private shafts: ShaderPass | null = null;
  private shaftP = new THREE.Vector3();
  private look!: Look;
  private city!: City;
  /** The set being played in: the street (`city`) or a stage set from ./stages.ts. */
  private world!: World;
  private sets: Partial<Record<'floors' | 'core' | 'roof', StageSet>> = {};
  private setMood = { fog: '#071420', density: 0.0066, bg: '#05060f' };
  /** 0..3 = street, floors, core, roof. */
  stageIdx = 0;
  /** The level being played (src/lib/terrornode/levels.ts): a window of the block with its own palette, mix and dressing. */
  level: Level = BLOCK;
  /** The level module's wave-pattern function, once it has loaded (the block's own swarm until then). */
  private waveK: (w: WavePattern, t: number, len: number) => number = () => 1;
  private dressing: Dressing | null = null;
  private dressReq = 0;
  /** A non-boss level reached its end: the swarm is dismissed and the page shows LEVEL CLEAR. */
  private cleared = false;
  /** This run's rounds landed and the score when it began (per-level score and round count). */
  private runRounds = 0;
  private scoreAt = 0;
  private jamRounds = 0;
  /** Seconds into the ten-minute block (runs while in combat, until the rescue). */
  runT = 0;
  /** Metres walked along the route (see TUNING.run.route). */
  private routeD = 0;
  private walkStep = 0;
  private frameN = 0;
  private holdT = 0;
  /** The Erobots' hit/wreck light: neutral, world space, rides the light slots in every stage. */
  private erHit = new THREE.PointLight('#ff7a30', 0, 26, 1.6);
  /** Point-light slots: the route's lights are templates; the nearest/brightest few drive these (constant count). */
  private slots: THREE.PointLight[] = [];
  private tpl: { l: THREE.PointLight; home: THREE.Object3D; set: number; world: boolean; score: number }[] = [];
  /** Per set (street, floors, core, roof): its drawables and lights, for streaming without changing the light count. */
  private kits: Kit[] = [];
  private kitOn: boolean[] = [];
  private bossKit!: Kit;
  /** The lobby doorway carved through the tower (street materials, world-space planes moved with the walk). */
  private door = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6), new THREE.Plane(new THREE.Vector3(0, 1, 0), -4.6), new THREE.Plane(new THREE.Vector3(1, 0, 0), -13.5), new THREE.Plane(new THREE.Vector3(-1, 0, 0), -13.5)];
  private moodC = { fog: new THREE.Color(), bg: new THREE.Color(), a: new THREE.Color(), b: new THREE.Color() };
  private horde!: Horde;
  private coreHitAcc = 0;
  private coreHit = 0;
  private sinceCoreHit = 99;
  private rescue: { t: number; freed: boolean; sent: boolean } | null = null;
  private bossOn = false;
  private boss!: LiquidUnit;
  private erobots!: ErobotWave;
  private fx!: Fx;
  private bolts!: Bolts;
  private raf = 0;
  private last = 0;
  private t = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private cleanup: (() => void)[] = [];

  // input
  private ndc = new THREE.Vector2(0, 0.1);
  trigger = false;
  autoAim = false;
  /** Dev only: with `autoAim`, shoot the nearest Erobot first (a sweeping player), else the boss. */
  autoThreats = false;
  /** Dev only: the boss counts as the nearest threat inside this many metres. */
  autoBossRange = 0;
  private threatT = 0;
  /** Strafe input: held keys and the touch pad (-1 left .. 1 right). */
  private keyL = false;
  private keyR = false;
  /** FREE MOVE (owner, 25 Oct: move like the Arena): W/S or Up/Down, Left/Right arrows turn, mouse-look (pointer lock). */
  private keyF = false;
  private keyB = false;
  private keyTL = false;
  private keyTR = false;
  padMove = 0;
  /** Touch virtual stick (-1..1 each axis; y +1 is back, like a screen drag). */
  padX = 0;
  padY = 0;
  private px = 0;
  /** Metres ahead (-) / behind (+) of the auto-walk's spot, inside TUNING.player.freeZ. */
  private pz = 0;
  /** Free-look: on once the mouse is pointer-locked or a touch has dragged the view; the crosshair sits mid-screen. */
  private freeLook = false;
  private lookYaw = 0;
  private lookPitch = 0.08;
  /** The on-screen stick (positioned by the touch handler). */
  stickEl: HTMLElement | null = null;
  knobEl: HTMLElement | null = null;

  // gun
  weapon: RangeWeapon | null = null;
  private mount = new THREE.Group();
  private kickG = new THREE.Group();
  private guns = new Map<string, HeldGun>();
  private held: HeldGun | null = null;
  private gunReq = 0;
  private muzzleSprite!: THREE.Sprite;
  private flashLight!: THREE.PointLight;
  // dynamic light: a fixed pool of point lights (constant count, so no shader recompiles), exposure kick, Low-tier ground decal
  private pool: { l: THREE.PointLight; t: number; dur: number; peak: number }[] = [];
  private kick = 0;
  private decal: THREE.Mesh | null = null;
  private decalA = 0;
  private flashK = 0;
  private flashT = 0;
  private recoil = 0;
  private nextShot = 0;
  private mgOn = false;
  private shake = 0;
  private yaw = 0;
  private pitch = 0.16;

  // brass
  private brass!: THREE.InstancedMesh;
  private bp = new Float32Array(160 * 3);
  private bv = new Float32Array(160 * 3);
  private br = new Float32Array(160 * 3);
  private bl = new Float32Array(160);
  private bCursor = 0;

  // world
  private drones: Drone[] = [];
  private droneGeo: THREE.BufferGeometry[] = [];
  private droneMat: THREE.Material[] = [];
  private score = 0;
  private kills = 0;
  private statsT = 0;
  private hover = '';

  // the player's body
  hp: number = TUNING.player.hp;
  private sinceHurt = 99;
  private hitCd = 0;
  private invuln = 0;
  /** Health hit zero: the world crawls and nothing fires until Continue (`revive`) or the run ends. */
  dead = false;
  private hitKick = { p: 0, y: 0, r: 0 };

  // temps
  private ray = new THREE.Raycaster();
  private tA = v3();
  private tB = v3();
  private tC = v3();
  private tD = v3();
  private tQ = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();

  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: { current: Hooks },
    private opts: { quality: Quality; weapons: RangeWeapon[]; bossBase: number; lite?: boolean },
  ) {}

  get high() {
    return !this.opts.lite && this.opts.quality === 'high';
  }

  /** Mobile-lite tier (src/lib/mobileLite.ts): Low, minus the HDR env, post-processing and the heaviest models. */
  get lite() {
    return !!this.opts.lite;
  }

  private draw() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  async init(onProgress: (p: number) => void) {
    const high = this.high;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !high, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lite ? LITE_DPR : high ? 1.5 : 1));
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      this.hooks.current.lost?.();
    };
    this.canvas.addEventListener('webglcontextlost', onLost);
    this.cleanup.push(() => this.canvas.removeEventListener('webglcontextlost', onLost));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = high;
    r.shadowMap.type = THREE.PCFShadowMap;
    onProgress(0.05);
    this.look = await loadLook(r, high ? 'high' : 'low', (p) => onProgress(0.05 + p * 0.45), { env: !this.lite });
    if (this.disposed) return;
    this.city = buildCity({ renderer: r, scene: this.scene, high, look: this.look });
    this.world = this.city;
    // lite: no HDR environment, so a cheap sky/ground fill keeps the PBR materials readable
    if (this.lite) this.scene.add(new THREE.HemisphereLight('#8fb2e6', '#1c1420', 1.1), new THREE.AmbientLight('#ffffff', 0.35));
    const fg = this.scene.fog as THREE.FogExp2;
    this.setMood = { fog: '#' + fg.color.getHexString(), density: fg.density, bg: '#05060f' };
    this.boss = new LiquidUnit(this.opts.bossBase, high);
    this.boss.final = true;
    this.boss.onDown = () => this.bossDown();
    this.boss.setEnv(r, this.look.env);
    this.scene.add(this.boss.group);
    await this.boss.ready; // the rigged model (a fallback figure stands in if it can't load)
    if (this.disposed) return;
    this.bossKit = kitOf(this.boss.group);
    showKit(this.bossKit, false);
    this.fx = new Fx(this.scene, high);
    this.bolts = new Bolts(this.scene);
    this.erobots = new ErobotWave(this.scene, this.fx, {
      high,
      canvas: this.canvas,
      reticle: () => this.reticle(),
      light: this.erHit, // a neutral, world-space hit light of its own (not the street's)
      flash: (at, c, i, ms) => this.flash(at, c, i, ms),
      bolts: this.bolts,
      melee: (from, dmg) => this.hurt(from, dmg, 'melee'),
    });
    this.horde = new Horde(this.scene, this.fx, { high, lite: this.lite, flash: (at, c, i, ms) => this.flash(at, c, i, ms), melee: (from, dmg) => this.hurt(from, dmg, 'melee') });
    this.boss.onEvent = (k, at) => this.bossEvent(k, at);
    this.boss.onAttack = (a) => this.bossAttack(a);
    this.scene.add(this.camera);
    this.camera.layers.enable(1); // layer 1: rain, ripples and the held gun (hidden from the street reflection)
    this.camera.position.set(0, EYE, 0);
    this.camera.add(this.mount);
    this.mount.add(this.kickG);
    this.muzzleSprite = halo('#ffd9a0', 1.2, 0);
    this.muzzleSprite.material.opacity = 0;
    this.scene.add(this.muzzleSprite);
    this.flashLight = new THREE.PointLight('#ffb870', 0, 30, 1.6);
    this.scene.add(this.flashLight);
    for (let i = 0; i < (high ? 6 : 1); i++) {
      const l = new THREE.PointLight('#ffffff', 0, 26, 1.7);
      this.scene.add(l);
      this.pool.push({ l, t: 0, dur: 0, peak: 0 });
    }
    this.buildRoute();
    this.applyStage(0);
    if (!high) {
      // Low: no lights to spare, so the muzzle throws an emissive glow on the wet street instead
      const dg = new THREE.PlaneGeometry(1, 1);
      dg.rotateX(-Math.PI / 2);
      this.decal = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffb060', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      this.decal.scale.set(16, 1, 34);
      this.decal.position.set(0, 0.06, -9);
      this.decal.renderOrder = 5;
      this.scene.add(this.decal);
    }
    // brass casings
    const bg = new THREE.CylinderGeometry(0.008, 0.008, 0.045, 8);
    bg.rotateZ(Math.PI / 2);
    this.brass = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: '#c99a3e', metalness: 1, roughness: 0.25 }), 160);
    this.brass.frustumCulled = false;
    this.brass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 160; i++) this.brass.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    this.scene.add(this.brass);
    for (let i = 0; i < 2; i++) this.spawnDrone(i);
    this.droneGroupVisible(true);
    onProgress(0.65);

    // Arena-grade post: render, GTAO (desktop High), bloom, grade, output. Lite renders straight to the canvas.
    if (!this.lite) this.buildPost(r);

    // PRE-WARM: every set, the boss, the swarm and the effects compile now, off the frame loop, against the
    // final light set-up (it never changes during the run), so nothing compiles mid-run
    onProgress(0.7);
    await r.compileAsync(this.scene, this.camera).catch(() => undefined);
    this.warmTextures();
    this.warmFrame();
    void Promise.all([this.erobots.ready, this.horde.ready]).then(async () => {
      if (this.disposed) return;
      await r.compileAsync(this.scene, this.camera).catch(() => undefined);
      if (this.disposed) return;
      this.warmTextures();
      this.warmFrame();
    });
    if (this.disposed) return;
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    this.resize();
    onProgress(0.8);
    const first = this.opts.weapons[0];
    if (first) await this.setWeapon(first.id);
    if (this.disposed) return;
    onProgress(1);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private buildPost(r: THREE.WebGLRenderer) {
    const high = this.high;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    if (high) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 8 });
      const aoRender = ao.render.bind(ao);
      const hid: THREE.Object3D[] = [];
      ao.render = (...args: Parameters<GTAOPass['render']>) => {
        this.scene.traverse((o) => {
          if (((o as THREE.Sprite).isSprite || (o as THREE.LineSegments).isLineSegments || (o as THREE.Points).isPoints || o.userData.noAO) && o.visible) {
            o.visible = false;
            hid.push(o);
          }
        });
        aoRender(...args);
        for (const o of hid.splice(0)) o.visible = true;
      };
      comp.addPass(ao);
      this.ao = ao;
    }
    if (high) {
      // light shafts: a radial blur of the tower's eye, so the red glow bleeds through the rain and the neon haze
      this.shafts = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uPos: { value: new THREE.Vector2(0.5, 0.7) }, uK: { value: 0.5 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse; uniform vec2 uPos; uniform float uK; varying vec2 vUv;
          void main(){
            vec3 base = texture2D(tDiffuse, vUv).rgb;
            vec2 d = (uPos - vUv) * (1.0 / 28.0) * 0.95;
            vec2 uv = vUv; float w = 1.0; vec3 acc = vec3(0.0);
            for (int i = 0; i < 28; i++) {
              uv += d;
              vec3 s = texture2D(tDiffuse, uv).rgb;
              float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
              acc += s * smoothstep(1.0, 3.5, l) * smoothstep(0.42, 0.0, length(uv - uPos)) * w;
              w *= 0.955;
            }
            gl_FragColor = vec4(base + acc * uK * (1.0 / 28.0) * 3.0, 1.0);
          }`,
      });
      comp.addPass(this.shafts);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), high ? 0.3 : 0.26, 0.4, high ? 1.7 : 1.6);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.grade = makeGradePass();
    // night-shift grade: teal shadows, sodium highlights, crushed blacks
    this.grade.apply({ shadow: [0.76, 1.0, 1.14], high: [1.08, 1.0, 0.9], sat: 0.92, contrast: 1.22, vignette: 0.74 });
    comp.addPass(this.grade.pass);
    this.composer = comp;
  }

  resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(2, el.clientWidth);
    const h = Math.max(2, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    // Portrait phones: widen the view so the tower and the boss both fit.
    this.camera.fov = w / h >= 1.3 ? BASE_FOV : THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * (1.3 / (w / h)))), BASE_FOV, 96);
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.ao?.setSize(w, h);
    const bs = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.city?.resize(bs.x, bs.y);
  }

  setBossBase(n: number) {
    this.boss?.setBase(n);
  }

  async setWeapon(id: string) {
    const w = this.opts.weapons.find((x) => x.id === id);
    if (!w || w === this.weapon) return;
    this.weapon = w;
    const req = ++this.gunReq;
    let h = this.guns.get(id);
    if (!h) {
      const gltf = await loadGunModel(w.def.url).catch(() => null);
      if (!gltf || this.disposed) return;
      h = buildGun(w.def, gltf);
      if (w.ordnance) {
        tintGun(h.group, w.ordnance.tint, tintAmount(w.ordnance));
        void brandGun(h.group, w.ordnance.id);
      }
      h.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
          for (const mt of mats) if (mt && 'envMapIntensity' in mt) mt.envMapIntensity = 1.8;
        }
      });
      h.group.traverse((o) => o.layers.set(1));
      this.guns.set(id, h);
    }
    if (req !== this.gunReq) return;
    if (this.held) this.kickG.remove(this.held.group);
    this.held = h;
    this.mount.position.set(...w.def.pos);
    this.mount.position.x += 0.04;
    this.kickG.add(h.group);
    if (this.mgOn) {
      minigun(false);
      this.mgOn = false;
    }
  }

  // ── Input ──
  private bindInput() {
    const c = this.canvas;
    const setNdc = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    // touch: the left half is a virtual stick (move), the right half drags the view and holds the trigger
    const touch = { move: null as null | { id: number; x: number; y: number }, look: null as null | { id: number; x: number; y: number } };
    const down = (e: PointerEvent) => {
      unlockAudio();
      if (e.pointerType === 'touch') {
        c.setPointerCapture(e.pointerId);
        const r = c.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.42 && !touch.move) {
          touch.move = { id: e.pointerId, x: e.clientX, y: e.clientY };
          if (this.stickEl) {
            this.stickEl.style.display = 'block';
            this.stickEl.style.left = `${e.clientX - r.left - 52}px`;
            this.stickEl.style.top = `${e.clientY - r.top - 52}px`;
          }
          if (this.knobEl) this.knobEl.style.transform = 'translate(0,0)';
          return;
        }
        touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
        this.freeLook = true;
        this.ndc.set(0, 0);
        this.setTrigger(true);
        return;
      }
      if (e.pointerType === 'mouse' && document.pointerLockElement !== c && c.requestPointerLock) {
        try {
          const pr = c.requestPointerLock() as unknown as Promise<void> | undefined;
          pr?.catch?.(() => undefined);
        } catch {
          /* not allowed here (an iframe, a test): the cursor aims instead */
        }
      }
      if (!this.freeLook) setNdc(e);
      this.setTrigger(true);
    };
    const up = (e: PointerEvent) => {
      if (touch.move && e.pointerId === touch.move.id) {
        touch.move = null;
        this.padX = this.padY = 0;
        if (this.stickEl) this.stickEl.style.display = 'none';
        return;
      }
      if (touch.look && e.pointerId === touch.look.id) touch.look = null;
      this.setTrigger(false);
    };
    const move = (e: PointerEvent) => {
      if (touch.move && e.pointerId === touch.move.id) {
        this.padX = THREE.MathUtils.clamp((e.clientX - touch.move.x) / 50, -1, 1);
        this.padY = THREE.MathUtils.clamp((e.clientY - touch.move.y) / 50, -1, 1);
        if (this.knobEl) this.knobEl.style.transform = `translate(${this.padX * 40}px,${this.padY * 40}px)`;
        return;
      }
      if (touch.look && e.pointerId === touch.look.id) {
        this.turnView((e.clientX - touch.look.x) * 0.006, (e.clientY - touch.look.y) * 0.006);
        touch.look.x = e.clientX;
        touch.look.y = e.clientY;
        return;
      }
      if (document.pointerLockElement === c) this.turnView(e.movementX * 0.0022, e.movementY * 0.0022);
      else if (!this.freeLook || e.pointerType === 'mouse') setNdc(e);
    };
    const lockChange = () => {
      const locked = document.pointerLockElement === c;
      if (locked) {
        // pick up the view where the cursor had it, so locking never snaps the aim
        this.lookYaw = this.yaw;
        this.lookPitch = this.pitch;
        this.ndc.set(0, 0);
      } else if (this.freeLook) {
        // ESC freed the mouse: let go of the trigger so nothing keeps firing (or reads as jammed) behind the menus
        this.setTrigger(false);
      }
      this.freeLook = locked;
    };
    const key = (e: KeyboardEvent, d: boolean) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.setTrigger(d);
      }
      // MOVE like the Arena: W/S or Up/Down forward and back, A/D strafe, Left/Right arrows turn
      if (e.code === 'KeyA') this.keyL = d;
      else if (e.code === 'KeyD') this.keyR = d;
      else if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keyF = d;
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keyB = d;
      else if (e.code === 'ArrowLeft') this.keyTL = d;
      else if (e.code === 'ArrowRight') this.keyTR = d;
      else return;
      e.preventDefault();
    };
    const kd = (e: KeyboardEvent) => key(e, true);
    const ku = (e: KeyboardEvent) => key(e, false);
    c.addEventListener('pointermove', move);
    document.addEventListener('pointerlockchange', lockChange);
    c.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    const blur = () => (this.keyL = this.keyR = this.keyF = this.keyB = this.keyTL = this.keyTR = false);
    window.addEventListener('blur', blur);
    this.cleanup.push(
      () => window.removeEventListener('blur', blur),
      () => c.removeEventListener('pointermove', move),
      () => document.removeEventListener('pointerlockchange', lockChange),
      () => document.pointerLockElement === c && document.exitPointerLock?.(),
      () => c.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
    );
  }

  /** Turn the free view by `dx` / `dy` radians (mouse-look, touch drag). */
  private turnView(dx: number, dy: number) {
    if (!this.freeLook) {
      this.lookYaw = this.yaw;
      this.lookPitch = this.pitch;
      this.freeLook = true;
    }
    this.ndc.set(0, 0);
    const P = TUNING.player;
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx, -P.lookYaw, P.lookYaw);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy, -0.7, 0.9);
  }

  setTrigger(down: boolean) {
    if (down === this.trigger) return;
    this.trigger = down;
    this.hooks.current.trigger(down);
    if (down && this.weapon && !this.weapon.auto) this.tryPull();
    if (!down && this.mgOn) {
      minigun(false);
      this.mgOn = false;
    }
  }

  private tryPull() {
    const w = this.weapon;
    if (!w) return;
    const now = performance.now();
    if (now < this.nextShot) return;
    this.nextShot = now + w.fireMs;
    if (!this.hooks.current.pull(w)) {
      sfx('click', 0.7);
      return;
    }
    this.muzzleFx(w, Math.max(1, w.pellets));
  }

  // ── Transactions land ──
  /** `n` newly accepted transactions: each one is a round of the held weapon's damage at the crosshair. */
  accept(n: number) {
    const w = this.weapon;
    if (!w || n <= 0 || !this.city) return;
    if (this.combat) this.runRounds += n;
    const org = this.tA;
    const dir = this.tB;
    this.aimRay(org, dir);
    // Rays to trace this frame: cheap enough at 40; the rest of the rounds land on what the centre ray hits.
    const rays = Math.min(n, 40);
    const per = n / rays;
    const mz = this.muzzleWorld(this.tD).clone();
    const u = new THREE.Vector3().crossVectors(dir, this.tC.set(0, 1, 0)).normalize();
    const vv = new THREE.Vector3().crossVectors(u, dir);
    const jd = new THREE.Vector3();
    let tracers = 0;
    for (let i = 0; i < rays; i++) {
      jd.copy(dir);
      const spread = Math.max(0.006, w.spread);
      const a = Math.random() * Math.PI * 2;
      const rr = spread * Math.sqrt(Math.random());
      jd.addScaledVector(u, Math.cos(a) * rr).addScaledVector(vv, Math.sin(a) * rr).normalize();
      const end = this.landRound(org, jd, per * w.damage, w, per);
      if (tracers === 0) this.flash(this.tC.copy(mz).lerp(end, 0.35), w.bolt, 10, 90); // the round lights the wet street as it passes
      if (tracers++ < (w.auto ? 3 : 9)) this.fx.tracer(mz, end, w.bolt, w.ammo === 'laser' ? 0.09 : w.ammo === 'pellet' ? 0.035 : 0.05, w.ammo === 'laser' ? 0.15 : 0.08);
    }
  }

  private hittables: THREE.Object3D[] = [];
  private landRound(org: THREE.Vector3, dir: THREE.Vector3, dmg: number, w: RangeWeapon, rounds: number): THREE.Vector3 {
    const c = this.world;
    this.ray.set(org, dir);
    this.ray.far = 400;
    const list = this.hittables;
    list.length = 0;
    if (this.bossOn && this.boss.alive) list.push(...this.boss.parts);
    for (const d of this.drones) if (!d.dead && d.g.visible) list.push(d.body);
    for (const rk of c.racks) if (!rk.broke) list.push(rk.mesh);
    const core = this.setNow()?.core;
    if (core) list.push(core.mesh);
    list.push(c.windows, ...c.solids, c.ground);
    const hit = this.ray.intersectObjects(list, false)[0];
    // a red bolt in the way is shot out of the air (a small target: it takes aim)
    const bolt = this.bolts.shoot(org, dir, hit ? hit.distance : 400);
    const er = this.erobots.raycast(org, dir, bolt ? bolt.dist : hit ? hit.distance : 400);
    const mob = this.horde.raycast(org, dir, er ? er.dist : bolt ? bolt.dist : hit ? hit.distance : 400);
    if (mob) {
      const r = this.horde.hit(mob, dmg);
      this.score += r.score;
      if (r.killed) {
        this.kills++;
        this.heal(TUNING.player.healOnKill);
        if (r.big || Math.random() < 0.3) sfx('explosion', r.big ? 0.8 : 0.35);
      }
      this.erobots.mark(r.killed);
      return mob.point;
    }
    if (bolt && !er) {
      this.fx.sparks(bolt.point, '#ffd0a0', 14, 9);
      this.fx.ring(bolt.point, '#ff6a40', 1.4, 0.25);
      this.flash(bolt.point, '#ff7a50', 45, 120);
      this.score += 40;
      return bolt.point;
    }
    if (er) {
      const r = this.erobots.hit(er, dmg, dir);
      this.score += r.score;
      if (r.killed) {
        this.kills++;
        this.heal(TUNING.player.healOnKill);
        sfx('explosion', 0.5);
      }
      if (r.heavy) this.shake = Math.max(this.shake, r.killed ? 0.5 : 0.3);
      return er.point;
    }
    const end = hit ? hit.point.clone() : org.clone().addScaledVector(dir, 300);
    if (!hit) return end;
    const o = hit.object;
    if (core && o === core.mesh) {
      // the core: sustained fire jams it (the stage goal)
      this.coreHitAcc += rounds;
      this.sinceCoreHit = 0;
      this.jamRounds = Math.min(this.jamGoal(), this.jamRounds + rounds);
      this.score += Math.round(dmg * 0.2);
      if (Math.random() < 0.5) this.fx.sparks(end, '#7cf9ff', 2, 7);
      if (Math.random() < 0.3) this.flash(end, '#7cf9ff', 40, 90);
      return end;
    }
    if (w.splash > 0) {
      this.fx.ring(end, w.bolt, w.splash, 0.4);
      this.fx.sparks(end, w.bolt, 10, 10);
    }
    if (this.boss.parts.includes(o as THREE.Mesh)) {
      this.erobots.mark(false);
      if (this.boss.hit(dmg, end)) {
        this.score += 5000 * this.boss.wave + 20_000;
        this.kills++;
        if (this.boss.final) this.bossMelted(); // before the last seconds of the block he melts and re-forms
        this.fx.shatter(end, '#e8eef6', 36, 9, 1.0);
        this.flash(end, '#cfe4ff', 150, 600); // he melts: a big flash, then a cold glow as he pools
        this.flash(this.tA.set(end.x, 0.8, end.z), '#27c8e0', 60, 2200);
        this.shake = 1;
        this.heal(TUNING.player.healOnBossMelt * TUNING.player.hp);
        sfx('explosion', 0.8);
      } else this.score += Math.round(dmg);
      if (Math.random() < 0.3) this.fx.sparks(end, '#eef4ff', 1, 4);
      if (Math.random() < 0.35) this.flash(end, '#bcd8ff', 35, 70);
      return end;
    }
    const drone = this.drones.find((d) => d.body === o);
    if (drone) {
      drone.hp -= dmg;
      this.fx.sparks(end, '#ffb347', 3, 6);
      if (drone.hp <= 0) {
        drone.dead = 0.001;
        this.score += 250;
        this.kills++;
        this.fx.ring(end, '#ff6a2a', 3.2, 0.4);
        this.fx.shatter(end, '#2b3550', 24, 8, 0.8);
        this.fx.sparks(end, '#ff6a2a', 40, 12);
        this.flash(end, '#ff7a30', 130, 500);
        this.flash(this.tA.copy(end), '#ff5a20', 40, 1600);
        c.hitLight.position.copy(end); // hit lights are world-space templates (see assignLights)
        c.hitLight.color.set('#ff7a30');
        c.hitLight.intensity = 140;
        sfx('explosion', 0.6);
      }
      return end;
    }
    const rack = c.racks.find((r) => r.mesh === o);
    if (rack) {
      this.hurtRack(rack, dmg, end);
      return end;
    }
    if (o === c.windows && c.windows.visible && hit.instanceId != null) {
      const win = c.wins[hit.instanceId];
      if (win && !win.broke) this.hurtWindow(win, dmg, end);
      else this.fx.sparks(end, '#ffd27a', 1, 3);
      return end;
    }
    this.fx.sparks(end, o === c.ground ? '#ffd27a' : '#9fc6ff', 1, 4);
    if (o === c.ground && Math.random() < 0.3) this.flash(end, '#ffd27a', 14, 60);
    return end;
  }

  private hurtWindow(win: Window, dmg: number, at: THREE.Vector3) {
    win.hp -= dmg;
    if (win.hp <= 0) {
      this.world.breakWindow(win);
      this.score += 50;
      this.fx.shatter(at, '#cfeaff', 16, 7, 0.6, true);
      this.flash(at, '#cfeaff', 55, 140);
      if (Math.random() < 0.3) sfx('hit', 0.3);
      if (this.world.wins.length > 1 && this.world.wins.every((w) => w.broke) && this.world.racks.every((r) => r.broke)) {
        this.score += 10_000;
        this.world.rebuild(); // TERRORNODE has deep pockets (and a patent on them)
      }
    } else this.fx.sparks(at, '#cfeaff', 1, 3);
  }

  private hurtRack(rk: Rack, dmg: number, at: THREE.Vector3) {
    rk.hp -= dmg;
    this.fx.sparks(at, '#7cf9ff', 3, 6);
    if (Math.random() < 0.5) this.flash(at, '#7cf9ff', 35, 80);
    if (rk.hp <= 0) {
      this.world.breakRack(rk);
      this.score += 500;
      this.kills++;
      this.fx.sparks(at, '#7cf9ff', 60, 11);
      this.fx.ring(at, '#27e6ff', 4, 0.5);
      this.flash(at, '#7cf9ff', 150, 600);
      this.flash(this.tA.copy(at), '#ff6a2a', 45, 1800); // the rack burns on
      this.world.hitLight.position.copy(at);
      this.world.hitLight.color.set('#27e6ff');
      this.world.hitLight.intensity = 160;
      this.shake = Math.max(this.shake, 0.5);
      sfx('explosion', 0.5);
    }
  }

  // ── Look ──
  private muzzleWorld(out: THREE.Vector3) {
    if (this.held) {
      this.held.group.updateWorldMatrix(true, false);
      return out.copy(this.held.muzzle).applyMatrix4(this.held.group.matrixWorld);
    }
    return out.set(0.3, EYE - 0.3, -0.8);
  }

  private aimRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, this.camera);
    origin.copy(this.ray.ray.origin);
    dir.copy(this.ray.ray.direction);
  }

  private muzzleFx(w: RangeWeapon, rounds = 1) {
    const mz = this.muzzleWorld(this.tD);
    this.recoil = Math.min(1.6, this.recoil + 0.5 + w.kick * 0.25);
    this.shake = Math.min(1, this.shake + 0.06 + w.kick * 0.05);
    this.flashT = 0.06;
    this.muzzleSprite.position.copy(mz);
    this.muzzleSprite.scale.setScalar(0.18 + Math.random() * 0.14 + (rounds > 3 ? 0.1 : 0));
    this.muzzleSprite.material.color.set(w.bolt);
    this.muzzleSprite.material.opacity = this.trigger ? 0.65 : 1;
    this.flashLight.position.copy(mz);
    this.flashLight.color.set(w.bolt);
    this.flashLight.intensity = (this.high ? 60 : 36) * (0.6 + Math.random() * 0.7) * (rounds > 3 ? 1.3 : 1);
    this.kick = Math.min(0.12, this.kick + 0.012 + w.kick * 0.004);
    this.decalA = Math.min(1, this.decalA + 0.5);
    this.flash(this.tA.copy(this.camera.position).add(this.tB.set(0, 0.6, -9)), w.bolt, 10, 80); // glow pulsing down the street (kept low: held fire must not white out the view)
    if (w.def.id === 'minigun' || w.ordnance?.id === 'minigun-of-the-mempool') {
      if (!this.mgOn) {
        this.mgOn = true;
        minigun(true);
      }
    } else sfx(AMMO_SFX[w.ammo], w.auto ? 0.55 : 0.9);
    if (w.ammo === 'bullet' || w.ammo === 'pellet') this.ejectBrass(rounds > 3 ? 3 : 1);
  }

  private ejectBrass(n: number) {
    if (!this.held) return;
    const at = this.muzzleWorld(this.tC);
    const right = this.tA.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const back = this.tB.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
    for (let k = 0; k < n; k++) {
      const i = this.bCursor++ % 160;
      const j = i * 3;
      const p = at.clone().addScaledVector(back, 0.35).addScaledVector(right, 0.05);
      this.bp.set([p.x, p.y, p.z], j);
      this.bv.set([right.x * (1.6 + Math.random()) + (Math.random() - 0.5) * 0.4, 2 + Math.random() * 1.4, right.z * (1.6 + Math.random()) + back.z * 0.4], j);
      this.br.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], j);
      this.bl[i] = 1.6;
    }
  }

  private spawnDrone(i: number) {
    const g = new THREE.Group();
    const hull = new THREE.MeshPhysicalMaterial({ color: '#1c2232', metalness: 0.9, roughness: 0.28, clearcoat: 0.6 });
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a').multiplyScalar(4), toneMapped: false });
    const rotorM = new THREE.MeshBasicMaterial({ color: '#9fb4d0', transparent: true, opacity: 0.25, depthWrite: false });
    this.droneMat.push(hull, red, rotorM);
    const bodyG = new THREE.CapsuleGeometry(0.45, 0.6, 6, 16);
    bodyG.rotateZ(Math.PI / 2);
    const armG = new THREE.BoxGeometry(2.6, 0.08, 0.12);
    const rotorG = new THREE.CylinderGeometry(0.55, 0.55, 0.02, 20);
    const eyeG = new THREE.SphereGeometry(0.16, 16, 10);
    this.droneGeo.push(bodyG, armG, rotorG, eyeG);
    const body = new THREE.Mesh(bodyG, hull);
    body.castShadow = true;
    g.add(body);
    const rotors: THREE.Mesh[] = [];
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(armG, hull);
      arm.rotation.y = rot;
      g.add(arm);
      for (const s of [-1, 1]) {
        const rm = new THREE.Mesh(rotorG, rotorM);
        rm.position.set(Math.cos(rot) * 1.3 * s, 0.12, -Math.sin(rot) * 1.3 * s);
        g.add(rm);
        rotors.push(rm);
      }
    }
    const eye = new THREE.Mesh(eyeG, red);
    eye.position.set(0, -0.15, 0.42);
    g.add(eye);
    const glow = halo('#ff2a1a', 1.6, 0.8);
    glow.position.copy(eye.position);
    g.add(glow);
    const base = new THREE.Vector3((Math.random() - 0.5) * 30, 10 + Math.random() * 18, -26 - Math.random() * 30 - i * 4);
    g.position.copy(base);
    this.scene.add(g);
    this.drones.push({ g, rotors, hp: 40, dead: 0, t: Math.random() * 10, v: new THREE.Vector3(), base, body });
  }

  // ── Frame ──
  /** PAUSE (owner, 25 Oct 2026): the world freezes (time stands still), the scene keeps drawing. */
  paused = false;
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.paused ? 0 : Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    if (this.paused) this.trigger = false;
    this.last = now;
    this.t += dt;
    const w = this.weapon;
    // stream weapons show fire while held AND the chain is flowing
    if (w && this.trigger && !this.dead && w.auto && this.hooks.current.flowing() && now >= this.nextShot) {
      this.nextShot = now + w.fireMs;
      this.muzzleFx(w);
    }
    if (this.autoAim && this.autoThreats) {
      this.threatT -= dt;
      if (this.threatT <= 0) {
        this.threatT = 0.4; // human reaction time
        const hd = this.horde.nearest(this.tB);
        const ok = this.erobots.nearest(this.tA);
        if (hd < 1e9 && (!ok || hd < this.tA.lengthSq())) this.tA.copy(this.tB);
        if ((!(this.bossOn && this.boss.alive) || this.boss.dist > this.autoBossRange) && (ok || hd < 1e9)) {
          this.tA.project(this.camera);
          this.ndc.set(THREE.MathUtils.clamp(this.tA.x, -0.9, 0.9), THREE.MathUtils.clamp(this.tA.y, -0.9, 0.9));
        } else this.autoTarget();
      }
    } else if (this.autoAim) this.autoTarget();
    if (this.rescue?.freed) this.lookAtHostage(dt);
    // the world slows to a crawl while the player is down
    const sd = this.dead ? dt * 0.18 : dt;
    this.sinceHurt += dt;
    this.hitCd -= dt;
    this.invuln -= dt;
    if (!this.dead && this.sinceHurt > TUNING.player.regenDelay && this.hp < TUNING.player.hp) this.hp = Math.min(TUNING.player.hp, this.hp + TUNING.player.regenPerSec * dt);
    if (this.bossOn) this.boss.update(sd);
    // LOADING YOUR AMMO (owner, 25 Oct): until real rounds are live nothing spawns and nothing attacks; the
    // opening grace starts again at GO
    const hold = !this.combat && !this.rescue;
    this.erobots.paused = this.horde.paused = hold;
    if (hold) this.erobots.grace = this.horde.grace = TUNING.player.openingGrace;
    if (!this.dead) this.stageTick(dt);
    this.erobots.playerAlive = !this.dead;
    this.erobots.update(sd, this.camera, this.trigger);
    this.horde.update(sd, this.camera, !this.dead);
    this.shake = Math.min(1, this.shake + this.horde.impulse);
    this.horde.impulse = 0;
    this.bolts.update(sd, this.camera.position, (from, dmg, kind) => this.hurt(from, dmg, kind));
    this.shake = Math.min(1, this.shake + (this.bossOn ? this.boss.takeImpulse() : 0) + this.erobots.impulse);
    this.erobots.impulse = 0;
    if (this.stageIdx === 0) this.updateDrones(dt);
    this.updateBrass(dt);
    const pieces = [this.city, this.sets.floors, this.sets.core, this.sets.roof];
    for (let i = 0; i < pieces.length; i++) if (this.kitOn[i]) pieces[i]?.update(dt, this.t, this.camera);
    this.setNow()?.core?.set(this.jamRounds / this.jamGoal(), this.coreHit, this.t);
    this.dressing?.update(dt, this.t);
    this.walk(dt);
    this.fx.update(sd, this.camera);
    this.updateCamera(dt);
    this.flashT -= dt;
    if (this.flashT <= 0) {
      this.muzzleSprite.material.opacity *= 0.5;
      this.flashLight.intensity *= 0.4;
    }
    this.recoil *= Math.pow(0.0008, dt);
    this.shake *= Math.pow(0.02, dt);
    this.updateFlash(dt);
    this.grade?.tick(this.t, 0);
    // GTAO is the costliest pass after the mirror; under sustained fire the screen is all muzzle, tracers and
    // swarm, so it rests while the trigger has been held a moment and comes back when you let go (keeps >=45 fps)
    this.holdT = this.trigger ? this.holdT + dt : 0;
    if (this.ao) this.ao.enabled = this.holdT < 0.6;
    // the street's mirror pass is the most expensive pass: refresh it every other frame (the walk is slow)
    if (this.kitOn[0] && (this.frameN++ & 1) === 0) this.city.beforeRender(this.renderer, this.scene, this.camera);
    if (this.shafts) {
      const p = this.shaftP.copy(this.city.lightWorld).add(this.city.group.position).project(this.camera);
      const u = this.shafts.uniforms as { uPos: { value: THREE.Vector2 }; uK: { value: number } };
      u.uPos.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      u.uK.value = p.z < 1 && this.stageIdx === 0 ? 0.1 : 0;
    }
    this.draw();
    this.statsT -= dt;
    if (this.statsT <= 0) {
      this.statsT = 0.12;
      this.hooks.current.stats(this.stats());
    }
  };

  stats(): Stats {
    const w = this.world;
    const R = TUNING.run;
    const goal: Stats['goal'] = this.bossOn
      ? { kind: 'boss', label: 'THE LIQUID UNIT', now: Math.ceil(this.boss.hp), max: Math.ceil(this.boss.max) }
      : { kind: 'block', label: 'BLOCK', now: Math.max(0, Math.ceil(R.secs - this.runT)), max: R.secs };
    return {
      score: this.score,
      bossHp: Math.ceil(this.boss.hp),
      bossMax: Math.ceil(this.boss.max),
      wave: this.stageIdx + 1,
      stage: this.stageIdx + 1,
      goal,
      runSecs: this.runT,
      runMax: TUNING.run.secs,
      jam: this.jamRounds / this.jamGoal(),
      windows: w.wins.length,
      windowsLeft: w.wins.filter((x) => !x.broke).length,
      racksLeft: w.racks.filter((r) => !r.broke).length,
      racks: w.racks.length,
      drones: this.drones.filter((d) => !d.dead && d.g.visible).length + this.erobots.live + this.horde.live,
      kills: this.kills,
      hover: this.hover,
      hp: Math.ceil(this.hp),
      hpMax: TUNING.player.hp,
      bossPush: this.bossOn ? this.boss.pushNorm : 0,
      bossDist: this.bossOn && this.boss.alive ? this.boss.dist : 99,
      bossOn: this.bossOn,
    };
  }

  // ── Stages ──

  private setNow(): StageSet | null {
    return this.stageIdx === 0 ? null : (this.sets[(['street', 'floors', 'core', 'roof'] as const)[this.stageIdx] as 'floors' | 'core' | 'roof'] ?? null);
  }

  private jamGoal() {
    return TUNING.stages[2].jam.rounds;
  }

  private droneGroupVisible(v: boolean) {
    for (const d of this.drones) d.g.visible = v;
  }

  private autoTarget() {
    if (this.bossOn && this.boss.alive) this.boss.chest(this.tA).project(this.camera);
    else if (this.setNow()?.core) this.setNow()!.core!.mesh.getWorldPosition(this.tA).project(this.camera);
    else return;
    this.ndc.set(THREE.MathUtils.clamp(this.tA.x, -0.9, 0.9), THREE.MathUtils.clamp(this.tA.y, -0.9, 0.9));
  }

  private lookAtHostage(dt: number) {
    const h = this.sets.roof?.hostage;
    if (!h) return;
    h.head.getWorldPosition(this.tA);
    this.tA.project(this.camera);
    const k = Math.min(1, dt * 3);
    this.ndc.x += (THREE.MathUtils.clamp(this.tA.x, -0.8, 0.8) - this.ndc.x) * k;
    this.ndc.y += (THREE.MathUtils.clamp(this.tA.y, -0.6, 0.6) - this.ndc.y) * k;
  }

  /**
   * THE ROUTE (owner, 24 Oct: "a smooth walk all the way to the server room"): every set is built once, at load,
   * and laid end to end down -Z: the street runs up to TERRORNODE HQ, the lobby doorway is carved through the
   * tower (clip planes on the street) into the HQ floors, the corridor's open far end runs into the server core
   * shaft, and an opening in the shaft's far wall walks out onto the roof (the server room). Only the pieces near
   * the player are drawn (`TUNING.run.route.ahead` / `behind`); the rest are hidden, never rebuilt.
   */
  private buildRoute() {
    const ctx = { scene: this.scene, high: this.high, look: this.look };
    this.sets.floors = buildFloors(ctx);
    this.sets.core = buildCore(ctx);
    this.sets.roof = buildRoof(ctx);
    const R = TUNING.run.route;
    // seams: floor patches so the walk never crosses a hole between a straight floor and the round shaft
    const patch = (st: StageSet, z0: number, z1: number, w: number, y: number) => {
      const g = new THREE.PlaneGeometry(w, Math.abs(z1 - z0));
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, st.ground.material);
      m.position.set(0, y, (z0 + z1) / 2);
      m.receiveShadow = true;
      st.group.add(m);
    };
    patch(this.sets.floors, -62, -70, 27, -0.03);
    patch(this.sets.roof, 8, 26, 48, -0.02);
    // the street: carve the lobby doorway (only within the box, see `door`)
    this.renderer.localClippingEnabled = true;
    this.city.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
      for (const mt of mats) {
        if (!mt) continue;
        mt.clippingPlanes = this.door;
        mt.clipIntersection = true;
      }
    });
    const all = [this.city.group, this.sets.floors.group, this.sets.core.group, this.sets.roof.group];
    // LIGHTS: every point light on the route becomes a template; a fixed few slots in the scene take the values
    // of the nearest, brightest ones each frame. The scene's light count never changes (no recompiles) and stays
    // low however many sets are drawn. Hit lights are moved in world space by the game, the rest ride their set.
    const hits = new Set<THREE.Object3D>([this.city.hitLight, this.sets.floors.hitLight, this.sets.core.hitLight, this.sets.roof.hitLight]);
    all.forEach((g, i) => {
      const found: THREE.PointLight[] = [];
      g.traverse((o) => {
        if ((o as THREE.PointLight).isPointLight) found.push(o as THREE.PointLight);
      });
      for (const l of found) {
        const home = l.parent!;
        home.remove(l);
        this.tpl.push({ l, home, set: i, world: hits.has(l), score: 0 });
      }
    });
    this.tpl.push({ l: this.erHit, home: this.scene, set: -1, world: true, score: 0 });
    for (let k = 0; k < (this.high ? TUNING.run.lightSlots : TUNING.run.lightSlotsLow); k++) {
      const s = new THREE.PointLight('#ffffff', 0, 10, 1.6);
      this.slots.push(s);
      this.scene.add(s);
    }
    all.forEach((g, i) => {
      g.visible = true;
      g.position.set(0, R.lift[i], R.base[i]);
      // the inside sets draw on layer 2, so the street's mirror pass (layer 0 only) never renders them
      if (i > 0)
        g.traverse((o) => {
          if (!(o as THREE.Light).isLight) o.layers.set(2);
        });
      this.kits[i] = kitOf(g);
      this.kitOn[i] = true;
    });
    this.camera.layers.enable(2);
    this.ray.layers.enableAll();
  }

  /**
   * One hidden full render with EVERYTHING shown (every route piece, the boss, every pooled body), so the shadow
   * and depth variants compile now, behind the loading screen, and never on the frame something first appears.
   */
  private warmFrame() {
    const kits = [...this.kits, this.bossKit];
    const was = kits.map((k) => k.on);
    kits.forEach((k) => showKit(k, true));
    const bodies: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if ((o.name === 'erobots' || o.name === 'horde') && o.children.length) for (const c of o.children) if (!c.visible) bodies.push(c);
    });
    for (const b of bodies) b.visible = true;
    this.draw();
    for (const b of bodies) b.visible = false;
    kits.forEach((k, i) => showKit(k, was[i]));
  }

  /** Upload every texture in the scene now (a first-use upload mid-run is a visible hitch). */
  private warmTextures() {
    const seen = new Set<THREE.Texture>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mt of Array.isArray(m) ? m : [m]) {
        for (const v of Object.values(mt as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture && !seen.has(v)) seen.add(v);
        const u = (mt as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) if (x && x.value instanceof THREE.Texture && !seen.has(x.value)) seen.add(x.value);
      }
    });
    if (this.lite) for (const t of seen) capTexture(t, LITE_TEX);
    for (const t of seen) this.renderer.initTexture(t);
  }

  /** Metres along the route at `t` seconds into the block: each stage walks its leg in its share of the ten minutes. */
  private routeAt(t: number) {
    const S = TUNING.stages;
    const R = TUNING.run;
    const i = this.stageAt(t);
    const t0 = S[i].at;
    const t1 = i < S.length - 1 ? S[i + 1].at : R.secs;
    const d0 = R.route.enter[i];
    const d1 = i < S.length - 1 ? R.route.enter[i + 1] : R.route.end;
    return d0 + (d1 - d0) * THREE.MathUtils.clamp((t - t0) / Math.max(1, t1 - t0), 0, 1);
  }

  /** Switch the gameplay stage `i` (0..3): the lane, the hit targets, the Erobot level. The scenery is the route's. */
  private applyStage(i: number) {
    this.stageIdx = i;
    this.world = this.setNow() ?? this.city;
    this.droneGroupVisible(i === 0);
    if (this.decal) this.decal.visible = i === 0;
    if (i !== 3 && this.bossOn) {
      this.bossOn = false;
      showKit(this.bossKit, false);
    }
    this.jamRounds = i === 2 ? 0 : this.jamRounds;
    const T = TUNING.stages[i];
    this.erobots.setStage(T.lane, T.level + this.level.solo.levelUp);
    this.erobots.spawning = true;
    this.horde.lane = T.lane;
    this.horde.spawning = true;
  }

  /** The Liquid Unit walks in (the last minutes of the block, in the server room on the roof). */
  private bossIn() {
    if (this.bossOn) return;
    const T = TUNING.stages[3];
    this.bossOn = true;
    showKit(this.bossKit, true);
    this.boss.final = false;
    this.boss.setLevel(this.level.solo.bossLevel ?? T.bossLevel);
    this.boss.reset(-36);
    this.hooks.current.stage({ kind: 'boss' });
  }

  /** A fresh run: back to the street, everything reset, the hostage tied up again, the block clock at 0:00. */
  startRun() {
    this.rescue = null;
    this.cleared = false;
    this.runRounds = 0;
    this.scoreAt = this.score;
    this.runT = this.level.solo.from;
    this.routeD = 0;
    this.jamRounds = 0;
    this.sinceCoreHit = 99;
    this.coreHit = 0;
    this.city.rebuild();
    for (const k of ['floors', 'core', 'roof'] as const) this.sets[k]?.rebuild();
    this.sets.roof?.hostage?.reset();
    this.erobots.clearAll();
    this.horde.clearAll();
    this.bolts.clear();
    if (this.bossOn) {
      this.bossOn = false;
      showKit(this.bossKit, false);
    }
    this.applyStage(this.stageAt(this.runT));
    this.walk(0);
    this.px = 0;
    this.pz = 0;
    this.lookYaw = 0;
    this.lookPitch = 0.08;
    this.hp = TUNING.player.hp;
    this.dead = false;
    this.invuln = 0;
    this.erobots.grace = TUNING.player.openingGrace;
    this.horde.grace = TUNING.player.openingGrace;
  }

  /** Which stage the block clock says we are in. */
  private stageAt(t: number) {
    let i = 0;
    TUNING.stages.forEach((x, k) => {
      if (t >= x.at) i = k;
    });
    return i;
  }

  /** The route's sideways bend at `d` metres (around the core's pedestal), so the walk never goes through it. */
  private bendAt(d: number) {
    const R = TUNING.run.route;
    const u = (d - R.enter[2]) / (R.enter[3] - R.enter[2]);
    return u > 0 && u < 1 ? R.coreBend * Math.sin(Math.PI * u) : 0;
  }

  /**
   * THE AUTO-MOVE: the whole route slides past the player (a rail shooter's walk) at the pace that walks each leg
   * in its stage's time, the view bobs with the steps, the mood blends across each seam, and only nearby pieces
   * are drawn. Nothing in here touches the trigger, and nothing is built or compiled.
   */
  private walk(dt: number) {
    const R = TUNING.run;
    const RT = R.route;
    const moving = this.combat && !this.rescue;
    const d = (this.routeD = this.routeAt(this.runT));
    if (moving) this.walkStep += dt * R.stepHz * Math.PI * 2;
    const bx = -this.bendAt(d);
    const all = [this.city.group, this.sets.floors!.group, this.sets.core!.group, this.sets.roof!.group];
    for (let i = 0; i < all.length; i++) {
      all[i].position.set(bx, RT.lift[i], RT.base[i] + d);
      const from = RT.enter[i] - RT.ahead;
      const to = (i < 3 ? RT.enter[i + 1] : RT.end) + RT.behind;
      const on = d >= from && d <= to;
      if (on !== this.kitOn[i]) {
        this.kitOn[i] = on;
        showKit(this.kits[i], on);
      }
    }
    // the lobby doorway, carried with the street
    this.door[0].constant = -(RT.doorZ + d);
    this.door[2].constant = -(13.5 - bx);
    this.door[3].constant = -(13.5 + bx);
    // mood: blend across each seam
    const moods = [this.setMood, this.sets.floors!.mood, this.sets.core!.mood, this.sets.roof!.mood];
    let a = moods[0];
    let b = moods[0];
    let k = 0;
    for (let i = 1; i < 4; i++) {
      const u = (d - (RT.enter[i] - RT.blend)) / (RT.blend * 2);
      if (u >= 1) a = b = moods[i];
      else if (u > 0) {
        a = moods[i - 1];
        b = moods[i];
        k = u;
        break;
      }
    }
    const fg = this.scene.fog as THREE.FogExp2;
    const M = this.moodC;
    fg.color.copy(M.a.set(a.fog)).lerp(M.b.set(b.fog), k);
    fg.density = a.density + (b.density - a.density) * k;
    (this.scene.background as THREE.Color).copy(M.a.set(a.bg)).lerp(M.b.set(b.bg), k);
    // a level's palette rides over the route's mood
    if (this.level.id !== 'assault') {
      const P = this.level.palette;
      fg.color.lerp(M.a.set(P.fog), 0.8);
      fg.density += (P.density - fg.density) * 0.7;
      (this.scene.background as THREE.Color).lerp(M.a.set(P.bg), 0.8);
    }
    this.erHit.intensity *= Math.pow(0.002, dt);
    this.assignLights();
  }

  /** Fill the light slots from the brightest, nearest templates of the pieces being drawn. */
  private assignLights() {
    const cam = this.camera.position;
    const p = this.tC;
    for (const t of this.tpl) {
      if ((t.set >= 0 && !this.kitOn[t.set]) || t.l.intensity <= 0) {
        t.score = -1;
        continue;
      }
      if (t.world) p.copy(t.l.position);
      else p.copy(t.l.position).applyMatrix4(t.home.matrixWorld);
      t.l.userData.wp = (t.l.userData.wp ?? new THREE.Vector3()).copy(p);
      const r = Math.max(1, t.l.distance || 40);
      const d2 = p.distanceToSquared(cam);
      t.score = d2 > (r + 25) * (r + 25) ? -1 : t.l.intensity / (1 + d2 / (r * r));
    }
    this.tpl.sort((a, b) => b.score - a.score);
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[k];
      const t = this.tpl[k];
      if (!t || t.score <= 0) {
        s.intensity = 0;
        continue;
      }
      s.position.copy(t.l.userData.wp as THREE.Vector3);
      s.color.copy(t.l.color);
      s.intensity = t.l.intensity;
      s.distance = t.l.distance;
      s.decay = t.l.decay;
    }
  }

  private stageTick(dt: number) {
    const F = TUNING.stageFlow;
    const R = TUNING.run;
    // the rescue: the finale, the block is done
    if (this.rescue) {
      const r = this.rescue;
      r.t += dt;
      if (r.freed && !r.sent && r.t >= F.downToFreeSecs + 0.2) {
        r.sent = true;
        this.hooks.current.stage({ kind: 'rescued' });
      }
      return;
    }
    if (!this.combat || this.cleared) return;
    this.runT += dt;
    const L = this.level.solo;
    // a level without a boss clears when its window of the block is walked
    if (!this.level.boss && this.runT >= L.to) {
      this.clearLevel();
      return;
    }
    // the clock moves the player on: one seamless walk (the stage is just which leg of the route you are on)
    const want = this.stageAt(this.runT);
    if (want !== this.stageIdx) {
      this.applyStage(want);
      sfx('level', 0.6);
      skipLine(this.hooks.current, want);
    }
    // the horde thickens across each stage
    const S = TUNING.stages[this.stageIdx];
    const end = this.stageIdx < 3 ? TUNING.stages[this.stageIdx + 1].at : R.secs;
    const k = THREE.MathUtils.clamp((this.runT - S.at) / Math.max(1, end - S.at), 0, 1);
    const live = S.horde + (S.hordeEnd - S.horde) * k;
    const wk = this.waveK(L.wave, this.runT - L.from, L.to - L.from);
    this.horde.want = Math.round(live * wk * (this.high ? 1 : TUNING.horde.lowLive));
    // the boss: in at bossAt, final for the last seconds, and the block lands on him at 10:00
    if (this.stageIdx === 3 && this.level.boss && this.runT >= (L.bossAt ?? R.bossAt)) this.bossIn();
    if (this.bossOn && this.runT >= R.secs - 25) this.boss.final = true;
    if (this.bossOn && this.runT >= R.secs && this.boss.alive) {
      if (this.boss.hit(this.boss.hp + 1, this.boss.chest(this.tA))) this.bossMelted();
    }
    // the core: a jam is a bonus now (it blows and re-arms)
    if (this.stageIdx === 2) {
      const G = TUNING.stages[2].jam;
      this.sinceCoreHit += dt;
      const rate = this.coreHitAcc / Math.max(dt, 0.001);
      this.coreHitAcc = 0;
      this.coreHit += (THREE.MathUtils.clamp(rate / 1200, 0, 1) - this.coreHit) * Math.min(1, dt * 8);
      if (this.sinceCoreHit > G.holdSecs) this.jamRounds = Math.max(0, this.jamRounds - G.drainPerSec * dt);
      if (this.jamRounds >= G.rounds) {
        const cm = this.setNow()?.core?.mesh;
        const at = cm ? cm.getWorldPosition(this.tD) : null;
        if (at) {
          this.flash(at, '#7cf9ff', 160, 900);
          this.fx.ring(at, '#27e6ff', 8, 0.6);
        }
        this.score += 7500;
        this.shake = 1;
        sfx('explosion', 0.8);
        this.jamRounds = 0;
      }
    }
  }

  /** LEVEL CLEAR (a level without a boss): the swarm is called off, nothing more can hurt, the page moves on. */
  private clearLevel() {
    this.cleared = true;
    this.invuln = 999;
    this.erobots.clearAll();
    this.erobots.spawning = false;
    this.horde.dismiss();
    this.bolts.clear();
    sfx('level', 1);
    this.hooks.current.stage({ kind: 'clear', level: this.level.id, ...this.levelRun() });
  }

  /** This run's score and rounds landed (for the level's best). */
  levelRun() {
    return { score: Math.max(0, this.score - this.scoreAt), rounds: this.runRounds };
  }

  /**
   * Pick the level the next `startRun()` plays. Its mix applies at once; its dressing (new geometry) is fetched
   * with a dynamic import the first time, so the first load never carries it. Call `startRun()` after.
   */
  async setLevel(id: LevelId) {
    // the level table and its dressing are their own chunks: the first load never carries them
    const lv = await import('../terrornode/levels');
    if (this.disposed) return;
    this.waveK = lv.waveK;
    const L = (this.level = lv.levelOf(id));
    this.erobots.roleMix = L.id === 'assault' ? null : L.solo.roles;
    this.horde.weights = L.id === 'assault' ? null : L.solo.horde;
    const req = ++this.dressReq;
    this.dressing?.dispose();
    this.dressing = null;
    if (L.id === 'assault' || this.disposed) return;
    const { buildDressing } = await import('../terrornode/dressing');
    if (req !== this.dressReq || this.disposed) return;
    const host = L.id === 'market' ? this.city.group : L.id === 'datacore' ? this.sets.core?.group : this.sets.roof?.group;
    const at = L.id === 'market' ? { halfW: 12, z0: 0, z1: -62 } : L.id === 'datacore' ? { halfW: 11, z0: 4, z1: -40 } : { halfW: 8, z0: 8, z1: -40 };
    const d = buildDressing(L.id, { high: this.high, palette: L.palette, ...at });
    if (!d || !host) return;
    // the inside sets draw on layer 2 (see buildRoute); the street on layer 0
    if (host !== this.city.group) d.group.traverse((o) => o.layers.set(2));
    host.add(d.group);
    this.dressing = d;
    this.warmTextures();
  }

  /** The Liquid Unit has just gone down (its melt begins): the street is cleared, nothing more can hurt. */
  private bossMelted() {
    if (!this.bossOn || this.rescue) return;
    this.rescue = { t: 0, freed: false, sent: false };
    this.invuln = 999;
    this.erobots.clearAll();
    this.erobots.spawning = false;
    this.horde.dismiss();
    this.bolts.clear();
    this.hooks.current.stage({ kind: 'down' });
  }

  /** The Liquid Unit has pooled for good: free the hostage. */
  private bossDown() {
    const r = this.rescue;
    if (!r || r.freed) return;
    r.freed = true;
    r.t = 0;
    const h = this.sets.roof?.hostage;
    h?.free(-9 - (this.sets.roof?.group.position.z ?? 0));
    if (h) {
      h.group.getWorldPosition(this.tA);
      this.fx.ring(this.tA.setY(0.3), '#ffb21a', 5, 0.8);
    }
    sfx('level', 1);
  }

  /**
   * A short flash of light at a world position: a pooled point light (no allocation; High 6 slots, Low 1 plus
   * a muzzle ground decal), bloom catches it, and big flashes kick the exposure and the chromatic fringe.
   * Public so any module (enemies, boss) can call it.
   */
  flash(at: THREE.Vector3, color: string, intensity: number, durationMs: number) {
    if (!this.pool.length) {
      this.kick = Math.min(0.2, this.kick + intensity / 3000);
      return;
    }
    let slot = this.pool[0];
    let best = Infinity;
    for (const s of this.pool) {
      const rem = s.t <= 0 ? -1 : (s.t / (s.dur / 1000)) * s.peak;
      if (rem < best) {
        best = rem;
        slot = s;
      }
    }
    slot.l.position.copy(at);
    slot.l.color.set(color);
    slot.peak = intensity * (this.high ? 1 : 1.4);
    slot.dur = durationMs;
    slot.t = durationMs / 1000;
    if (intensity >= 120) {
      this.kick = Math.min(0.2, this.kick + intensity / 2600);
      this.flashK = Math.min(1, this.flashK + intensity / 600);
    }
  }

  private updateFlash(dt: number) {
    for (const s of this.pool) {
      if (s.t > 0) {
        s.t -= dt;
        const k = Math.max(0, s.t / (s.dur / 1000));
        s.l.intensity = s.peak * k * k * (0.8 + Math.random() * 0.4);
      } else if (s.l.intensity !== 0) s.l.intensity = 0;
    }
    if (this.decal) {
      this.decalA *= Math.pow(0.004, dt);
      (this.decal.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, this.decalA * 0.5);
    }
    // the resting scene stays dark: exposure and bloom only lift while something is bright, then settle
    this.kick *= Math.pow(0.01, dt);
    this.flashK *= Math.pow(0.003, dt);
    // sustained fire must never white the screen out (owner, 25 Oct): cap the exposure kick and the fringe
    if (this.trigger) {
      this.kick = Math.min(this.kick, TUNING.run.fireKickCap);
      this.flashK = Math.min(this.flashK, 0.25);
    }
    this.renderer.toneMappingExposure = 1.0 + this.level.palette.exposure + this.kick;
    if (this.bloom) this.bloom.strength = (this.high ? 0.3 : 0.26) + this.level.palette.bloom + this.kick * 0.7;
    if (this.grade) (this.grade.pass.uniforms as { uAberr: { value: number } }).uAberr.value = 0.0012 + this.flashK * 0.003;
  }

  private bossEvent(kind: 'roar' | 'stomp' | 'lunge' | 'stagger' | 'skid' | 'melt' | 'splash' | 'pooled' | 'rise', at: THREE.Vector3) {
    if (kind === 'roar') {
      this.fx.ring(at, '#ff3a22', 9, 0.8);
      this.fx.sparks(at, '#ff6a2a', 30, 10);
      this.flash(at, '#ff3a22', 160, 600); // the roar lights the street red
      this.kick = Math.min(0.2, this.kick + 0.06);
      sfx('explosion', 0.4);
    } else if (kind === 'lunge') this.fx.ring(at, '#27e6ff', 7, 0.5);
    else if (kind === 'stagger') {
      this.fx.sparks(at, '#eef4ff', 34, 11);
      this.fx.ring(at, '#eef4ff', 8, 0.5);
      this.flash(at, '#cfe4ff', 90, 300);
    } else if (kind === 'skid') this.fx.sparks(at, '#ffd27a', 5, 5);
    else if (kind === 'melt') {
      this.flash(at, '#cfe4ff', 150, 700);
      this.shake = 1;
      sfx('explosion', 0.8);
    } else if (kind === 'splash') {
      this.fx.sparks(at, '#dff0ff', 8, 6);
      if (Math.random() < 0.4) this.flash(at, '#9fe8ff', 40, 160);
    } else if (kind === 'pooled') {
      this.fx.ring(at, '#27e6ff', 7, 0.9);
      this.flash(at, '#27c8e0', 70, 1400);
    } else if (kind === 'rise') {
      this.fx.ring(at, '#cfe4ff', 8, 0.8);
      this.flash(at, '#cfe4ff', 80, 800);
      this.kick = Math.min(0.2, this.kick + 0.05);
    }
  }

  /** The boss's attacks: swipe / lunge / slam hurt the player if they landed; shards are real projectiles. */
  private bossAttack(a: { kind: 'swipe' | 'lunge' | 'slam' | 'shards'; dmg: number; from: THREE.Vector3; landed: boolean }) {
    if (a.kind === 'shards') {
      const B = TUNING.boss.shards;
      const n = B.count + Math.floor((this.boss.wave - 1) / 2);
      for (let i = 0; i < n; i++) {
        const from = new THREE.Vector3(a.from.x + (Math.random() - 0.5) * 4, a.from.y + (Math.random() - 0.5) * 1.5, a.from.z + 1);
        const hits = Math.random() > 0.2;
        const to = this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * (hits ? 0.6 : 5), (Math.random() - 0.5) * (hits ? 0.4 : 2), 0));
        this.bolts.fire(from, to, B.speed, a.dmg, '#bfe6ff', hits, 'shard');
      }
      this.flash(a.from, '#bfe6ff', 70, 200);
      return;
    }
    this.shake = Math.max(this.shake, a.kind === 'slam' ? 0.9 : 0.6);
    const at = this.tC.set(a.from.x, 0.4, a.from.z + 3);
    this.fx.ring(at, a.kind === 'slam' ? '#ff6a2a' : '#cfe4ff', a.kind === 'slam' ? 12 : 7, 0.5);
    this.fx.sparks(at, '#ffd27a', 18, 9);
    if (a.landed) this.hurt(a.from, a.dmg, a.kind);
  }

  // ── The player's body ──
  /** Damage from a world position. No effect while down or in the grace after Continue. */
  /** False while the player is on the loadout / cabinet / loading screens: nothing can hurt them. */
  combat = false;

  hurt(from: THREE.Vector3, dmg: number, kind: HurtKind) {
    if (!this.combat || this.dead || this.invuln > 0 || dmg <= 0) return;
    if (kind === 'bolt' && this.hitCd > 0) return;
    this.hitCd = TUNING.player.hitCooldown;
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHurt = 0;
    // where did it come from? local position relative to the view
    this.camera.updateMatrixWorld();
    const l = this.tA.copy(from);
    this.camera.worldToLocal(l);
    const angle = Math.atan2(l.x, -l.z);
    // camera kick: a jolt away from the blow, a roll, and a shake
    const k = (dmg / 10) * TUNING.player.kickPer10;
    this.hitKick.p += k * (0.6 + Math.random() * 0.5);
    this.hitKick.y += -Math.sin(angle) * k * 1.4;
    this.hitKick.r += -Math.sin(angle) * k * 2.2;
    this.shake = Math.min(1, this.shake + 0.25 + dmg / 60);
    this.kick = Math.min(0.2, this.kick + 0.04);
    this.flashK = Math.min(1, this.flashK + 0.4);
    sfx('hurt', 0.9);
    this.hooks.current.hurt({ angle, dmg, kind, hp: this.hp, hpMax: TUNING.player.hp });
    if (this.hp <= 0) this.die();
  }

  private heal(n: number) {
    if (!this.dead) this.hp = Math.min(TUNING.player.hp, this.hp + n);
  }

  /**
   * DEATH is back (owner, 25 Oct: "I realised I couldn't die"): at zero health the player is down, the world
   * crawls, the trigger lets go and the CONTINUE? countdown runs (INSERT $b, or GAME OVER).
   */
  private die() {
    this.dead = true;
    this.bolts.clear();
    this.setTrigger(false);
    this.shake = 1;
    this.kick = 0.2;
    this.flashK = 1;
    sfx('hurt', 1);
    this.hooks.current.died();
  }

  /** Continue: back on your feet with full health and a few seconds of grace; the close attackers are cleared. */
  revive() {
    this.dead = false;
    this.hp = TUNING.player.hp;
    this.invuln = TUNING.player.reviveGrace;
    this.hitCd = 0;
    this.sinceHurt = 99;
    this.bolts.clear();
    this.erobots.clearAll();
    this.horde.clearAll();
    this.erobots.grace = this.horde.grace = TUNING.player.reviveGrace + 0.5;
    this.flash(this.camera.position.clone().add(new THREE.Vector3(0, 0.5, -3)), '#7cf9ff', 100, 500);
    this.fx.ring(this.tA.set(this.px, 0.3, -2), '#7cf9ff', 6, 0.6);
    this.hooks.current.hurt({ angle: 0, dmg: 0, kind: 'bolt', hp: this.hp, hpMax: TUNING.player.hp });
  }

  /** Dev only (dry run): poke the combat from the console / screenshot scripts. */
  debug = {
    hurt: (n: number, angle = 0) => this.hurt(this.tD.set(Math.sin(angle) * 6, 1.6, -Math.cos(angle) * 6).clone(), n, 'bolt'),
    kill: () => this.hurt(this.tD.set(0, 1.6, -5).clone(), this.hp + 1, 'swipe'),
    meltBoss: () => {
      if (this.bossOn && this.boss.alive && this.boss.hit(this.boss.hp + 1, this.boss.chest(new THREE.Vector3()))) this.bossMelted();
    },
    stage: () => this.stageIdx + 1,
    /** Jump the block clock to `secs` (the stage follows it seamlessly). */
    setTime: (secs: number) => (this.runT = secs),
    setStage: (n: number) => {
      this.rescue = null;
      this.runT = TUNING.stages[Math.max(0, Math.min(3, n - 1))].at;
      this.applyStage(Math.max(0, Math.min(3, n - 1)));
      this.invuln = 0;
    },
    horde: () => this.horde.live,
    jam: (k: number) => (this.jamRounds = k * this.jamGoal()),
    cutscene: () => this.sets.roof?.hostage?.group.position.z,
    boss: () => ({ z: this.boss.dist, alive: this.boss.alive, phase: this.boss.phaseName, push: this.boss.pushNorm, melt: this.boss.melt }),
    setInvuln: (s: number) => (this.invuln = s),
    stats: () => this.stats(),
    bossAt: (z: number) => this.boss.placeAt(z),
    hostageAt: (z: number) => this.sets.roof?.hostage?.group.position.set(0, 0, z),
    hostageNear: () => (this.sets.roof?.hostage?.group.position.set(0, 0, -9), this.lookAtHostage(1)),
    noSpawn: () => this.erobots.setStage(TUNING.stages[this.stageIdx].lane, TUNING.stages[this.stageIdx].level),
    calm: (on: boolean) => (this.boss.calmed = on),
    look: (x: number, y: number) => this.ndc.set(x, y),
    clearEnemies: () => (this.erobots.clearAll(), this.bolts.clear()),
    spawning: (on: boolean) => (this.erobots.spawning = on),
    /** Where the free-moving player is: x, metres off the auto-walk spot, view yaw, route metres, free-look on. */
    player: () => ({ x: this.px, z: this.pz, yaw: this.yaw, route: this.routeD, free: this.freeLook, combat: this.combat }),
    /** Dev only: drop a monster `z` metres straight in front of the view (a point-blank test). */
    mobAt: (d: number) => this.horde.debugPlace(this.camera.position.x, this.camera.position.z, d),
    hordeHp: () => this.horde.debugHp(),
    /** Threat probe: dead?, health, and the nearest horde body's distance (m). */
    threat: () => ({ dead: this.dead, hp: Math.round(this.hp), near: Math.min(99, ...this.horde.debugHp().map((m) => Math.hypot(m.x - this.camera.position.x, m.z - this.camera.position.z))).toFixed(1), live: this.horde.live + this.erobots.live }),
    /** Dev only: point the free view (radians). */
    face: (yaw: number, pitch: number) => {
      this.freeLook = true;
      this.ndc.set(0, 0);
      this.lookYaw = yaw;
      this.lookPitch = pitch;
    },
  };

  private updateDrones(dt: number) {
    for (const d of this.drones) {
      d.t += dt;
      for (const r of d.rotors) r.rotation.y += dt * 60;
      if (d.dead) {
        d.dead += dt;
        d.v.y -= 18 * dt;
        d.g.position.addScaledVector(d.v, dt);
        d.g.rotation.x += dt * 6;
        d.g.rotation.z += dt * 4;
        if (d.g.position.y < 0.5 || d.dead > 3) {
          if (d.dead < 3) this.fx.sparks(d.g.position, '#ff6a2a', 20, 8);
          // a fresh one flies in from behind the tower
          d.dead = 0;
          d.hp = 40;
          d.v.set(0, 0, 0);
          d.g.rotation.set(0, 0, 0);
          d.base.set((Math.random() - 0.5) * 30, 10 + Math.random() * 18, -30 - Math.random() * 30);
          d.g.position.set(d.base.x, d.base.y + 20, TOWER.z - 10);
        }
        continue;
      }
      // patrol: figure-eights around their post, drifting in toward the street
      const target = this.tC.set(d.base.x + Math.sin(d.t * 0.6) * 8, d.base.y + Math.sin(d.t * 1.3) * 2, d.base.z + Math.sin(d.t * 0.3) * 6);
      d.g.position.lerp(target, Math.min(1, dt * 0.8));
      d.g.lookAt(this.camera.position);
      d.g.rotateX(Math.sin(d.t * 2) * 0.05);
    }
  }

  private updateBrass(dt: number) {
    const q = this.tQ;
    const e = new THREE.Euler();
    const s = this.tD;
    for (let i = 0; i < 160; i++) {
      if (this.bl[i] <= 0) continue;
      const j = i * 3;
      this.bl[i] -= dt;
      this.bv[j + 1] -= 9.8 * dt;
      this.bp[j] += this.bv[j] * dt;
      this.bp[j + 1] += this.bv[j + 1] * dt;
      this.bp[j + 2] += this.bv[j + 2] * dt;
      if (this.bp[j + 1] < 0.02) {
        this.bp[j + 1] = 0.02;
        this.bv[j + 1] *= -0.35;
        this.bv[j] *= 0.6;
        this.bv[j + 2] *= 0.6;
      }
      this.br[j] += dt * 14;
      this.br[j + 2] += dt * 9;
      e.set(this.br[j], this.br[j + 1], this.br[j + 2]);
      q.setFromEuler(e);
      s.setScalar(this.bl[i] > 0 ? 1 : 0);
      this.m4.compose(this.tA.set(this.bp[j], this.bp[j + 1], this.bp[j + 2]), q, s);
      this.brass.setMatrixAt(i, this.m4);
    }
    this.brass.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    const P = TUNING.player;
    const frozen = !!this.rescue;
    if (!frozen) this.lookYaw = THREE.MathUtils.clamp(this.lookYaw + ((this.keyTL ? 1 : 0) - (this.keyTR ? 1 : 0)) * P.turnSpeed * dt, -P.lookYaw, P.lookYaw);
    if (this.keyTL || this.keyTR) this.freeLook ||= (this.ndc.set(0, 0), true);
    if (this.freeLook && !this.autoAim) {
      this.yaw = this.lookYaw;
      this.pitch = this.lookPitch;
    } else {
      const ty = -this.ndc.x * 0.32;
      const tp = this.ndc.y * 0.24 + 0.2;
      this.yaw += (ty - this.yaw) * Math.min(1, dt * 8);
      this.pitch += (tp - this.pitch) * Math.min(1, dt * 8);
    }
    const s = this.shake * this.shake;
    const hk = this.hitKick;
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * s * 0.03 + this.recoil * 0.004 + hk.p, this.yaw + (Math.random() - 0.5) * s * 0.03 + hk.y, hk.r, 'YXZ');
    const kd = Math.exp(-dt * 9);
    hk.p *= kd;
    hk.y *= kd;
    hk.r *= kd;
    // FREE MOVE: walk and strafe relative to the view, inside the route corridor (the set's walls) and a band
    // around the auto-walk's spot, which keeps carrying you forward; the Erobots' bolts aim at where you are
    const sx = Math.abs(this.padX) < 0.15 ? 0 : this.padX;
    const sy = Math.abs(this.padY) < 0.15 ? 0 : this.padY;
    const st = THREE.MathUtils.clamp((this.keyR ? 1 : 0) - (this.keyL ? 1 : 0) + this.padMove + sx, -1, 1);
    const fw = THREE.MathUtils.clamp((this.keyF ? 1 : 0) - (this.keyB ? 1 : 0) - sy, -1, 1);
    const cy = Math.cos(this.yaw);
    const sn = Math.sin(this.yaw);
    let mx = st * cy - fw * sn;
    let mz = -st * sn - fw * cy;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    const RT = TUNING.run.route;
    const nearSeam = RT.enter.some((e, i) => i > 0 && this.routeD > e - 18 && this.routeD < e + 6) || Math.abs(this.routeD + RT.doorZ) < 18;
    const wide = TUNING.stages[this.stageIdx].lane.wallX * TUNING.player.strafeRange;
    // near a seam only the SIDEWAYS room narrows (so the walk threads the doorway); forward/back stays free
    // (owner, 25 Oct: "couldn't move back and forth" was this band shrinking to 1.5 m round every seam)
    const lim = nearSeam ? Math.min(TUNING.run.seamLane, wide) : wide;
    // soft edges: speed fades over the last metre of the box, and a box that narrows eases you in, never snaps
    const soft = (v: number, d: number, lo: number, hi: number) => {
      const room = d > 0 ? hi - v : v - lo;
      return d * THREE.MathUtils.clamp(room / P.edgeSoft, 0, 1);
    };
    if (!frozen) {
      this.px += soft(this.px, mx * P.strafeSpeed * dt, -lim, lim);
      this.pz += soft(this.pz, mz * P.strafeSpeed * dt, P.freeZ[0], P.freeZ[1]);
    }
    if (Math.abs(this.px) > lim) this.px += (Math.sign(this.px) * lim - this.px) * Math.min(1, dt * 6);
    this.pz = THREE.MathUtils.clamp(this.pz, P.freeZ[0], P.freeZ[1]);
    const bob = this.combat && !this.rescue ? TUNING.run.bobY : 0;
    cam.position.set(this.px + (Math.random() - 0.5) * s * 0.05 + Math.sin(this.walkStep * 0.5) * bob * 0.6, EYE + Math.sin(this.t * 1.1) * 0.006 + Math.abs(Math.sin(this.walkStep * 0.5)) * bob, this.pz);
    cam.updateMatrixWorld();
    if (this.held && this.weapon) {
      this.aimRay(this.tA, this.tC);
      const aimPt = this.tB.copy(this.tA).addScaledVector(this.tC, 40);
      cam.worldToLocal(aimPt);
      const to = aimPt.sub(this.mount.position).normalize();
      to.lerp(this.tD.set(0, 0.02, -1), 0.4).normalize();
      this.tQ.setFromUnitVectors(this.tD.set(0, 0, -1), to);
      this.mount.quaternion.slerp(this.tQ, Math.min(1, dt * 14));
      const k = this.weapon.kick;
      this.kickG.position.z = this.recoil * 0.06 * (0.4 + k * 0.5);
      this.kickG.rotation.x = this.recoil * 0.05 * (0.4 + k * 0.5);
      this.held.mixer?.update(dt);
      if (this.held.spin) this.held.spin.timeScale = this.trigger ? 14 : this.held.spin.timeScale * 0.92;
    }
  }

  /** The crosshair in CSS px, for the DOM reticle. */
  reticle(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((this.ndc.x + 1) / 2) * r.width, y: ((1 - this.ndc.y) / 2) * r.height };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.mgOn) minigun(false);
    this.cleanup.forEach((f) => f());
    this.ro?.disconnect();
    this.dressing?.dispose();
    this.city?.dispose();
    for (const k of ['floors', 'core', 'roof'] as const) this.sets[k]?.dispose();
    this.boss?.dispose();
    this.erobots?.dispose();
    this.horde?.dispose();
    this.bolts?.dispose();
    this.fx?.dispose();
    this.look?.dispose();
    this.droneGeo.forEach((g) => g.dispose());
    this.droneMat.forEach((m) => m.dispose());
    this.composer?.dispose();
    this.renderer?.dispose();
  }
}

/** Lite tier: redraw any texture image larger than `max` px into a smaller canvas before it reaches the GPU. */
function capTexture(t: THREE.Texture, max: number) {
  const img = t.image as { width?: number; height?: number } | null;
  if (!img || !img.width || !img.height || (t as THREE.DataTexture).isDataTexture || (t as THREE.CompressedTexture).isCompressedTexture) return;
  const k = max / Math.max(img.width, img.height);
  if (k >= 1 || typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  try {
    c.getContext('2d')?.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
  } catch {
    return;
  }
  t.image = c;
  t.needsUpdate = true;
}
