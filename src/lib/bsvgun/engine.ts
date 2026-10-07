/**
 * BSVGun range engine (plain three.js): night range, live-chain targets, weapons, effects, scoring.
 * The React shell (src/components/BSVGunRange.tsx) owns menus, HUD and the wallet; this class owns
 * the canvas. LIVE firing is NOT here: a trigger pull asks `hooks.fire(weapon)` which the shell
 * wires to the existing useBlaster firing path (PRACTICE returns true and sends nothing).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildGun, type HeldGun } from '../arenaHD';
import { loadGunModel } from '../ordnanceModels';
import { brandGun, tintAmount, tintGun } from '../ordnanceGun';
import { makeGradePass } from '../visuals/look';
import { sfx, AMMO_SFX, minigun, unlockAudio } from '../sfx';
import type { FeedTx } from '../feed';
import { buildRange, RANGE, type Range } from './range';
import { Fx } from './fx';
import { buildTarget, halo, kindOf, labelOf, sizeOf, synthTx, TARGET_INFO, type Pattern, type TargetKind, type TargetRig } from './targets';
import type { RangeWeapon } from './weapons';

export type Quality = 'low' | 'high';
export type Phase = 'menu' | 'play' | 'over';

export type Hud = {
  score: number;
  timeLeft: number;
  streak: number;
  mult: number;
  shots: number;
  hits: number;
  weapon: string;
  zoomed: boolean;
  scoped: boolean;
  hover: string;
  banner: string;
  feedLive: boolean;
  targets: number;
};

export type Result = { score: number; shots: number; hits: number; acc: number; bestStreak: number; kills: Record<string, number>; secs: number; weapon: string; blocks: number };

export type Hooks = {
  /** A trigger pull. Return false when the shot can't be paid for (LIVE out of ammo): nothing fires. */
  fire: (w: RangeWeapon) => boolean;
  /** Next live feed tx (optionally matching), or null. */
  take: (pred?: (f: FeedTx) => boolean) => FeedTx | null;
  feedLive: () => boolean;
  /** Latest known chain tip height (0 if unknown). */
  height: () => number;
  hud: (h: Hud) => void;
  phase: (p: Phase) => void;
  over: (r: Result) => void;
  /** The shell wants the crosshair at this pixel (null = hide). */
  reticle?: (x: number, y: number, show: boolean) => void;
  /** Dry-fire / out of ammo. */
  dry?: () => void;
};

type T = {
  id: number;
  kind: TargetKind;
  pattern: Pattern;
  tx: FeedTx;
  rig: TargetRig;
  g: THREE.Group;
  v: THREE.Vector3;
  hp: number;
  r: number;
  hitR: number;
  age: number;
  life: number;
  label: string;
  pts: number;
  side: number;
  seed: number;
  hold: number;
  up: number;
  station: number;
  base: THREE.Vector3;
  flash: number;
  logoT: number;
  hittable: boolean;
  blockRail?: boolean;
  flock?: number;
  hanger?: THREE.Object3D;
  dead: boolean;
};

const ROUND = 75;
const G_CLAY = 11;
const fov2 = (base: number, z: number) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) / z));
const BASE_FOV = 58;

const v3 = () => new THREE.Vector3();

export class RangeEngine {
  phase: Phase = 'menu';
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 400);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ReturnType<typeof makeGradePass> | null = null;
  private range!: Range;
  private fx!: Fx;
  private raf = 0;
  private last = 0;
  private clock = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;

  // input
  private ndc = new THREE.Vector2(0, 0);
  private px = new THREE.Vector2(0, 0);
  private trigger = false;
  private scope = false;
  private pad = { active: false, fireWas: false, lb: false, rb: false };
  private cleanup: (() => void)[] = [];

  // gun
  private weapon: RangeWeapon | null = null;
  private mount = new THREE.Group();
  private kickG = new THREE.Group();
  private guns = new Map<string, HeldGun>();
  private held: HeldGun | null = null;
  private gunReq = 0;
  private flashSprite!: THREE.Sprite;
  private flashLight!: THREE.PointLight;
  private flashT = 0;
  private recoil = 0;
  private nextShot = 0;
  private mgOn = false;

  // run
  private live = false;
  private targets: T[] = [];
  private nextId = 1;
  private nextSpawn = 0.5;
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  private shots = 0;
  private hits = 0;
  private kills: Record<string, number> = {};
  private timeLeft = ROUND;
  private elapsed = 0;
  private blocks = 0;
  private banner = '';
  private bannerT = 0;
  private hover = '';
  private hudT = 0;
  private timeScale = 1;
  private slowT = 0;
  private shake = 0;
  private fovKick = 0;
  private pulse = 0;
  private lastHeight = 0;
  private blockDue = 30;
  private blastActive = false;
  private blastTps = 0;
  private demoT = 1;
  private paused = false;
  private rngState = 12345;
  private uptime = 0;
  private hitStop = 0;
  private fpsEma = 60;
  private slowFor = 0;
  /** The shell sets this when the player left quality on Auto: a struggling High drops to Low without a reload. */
  autoDegrade = false;
  degraded = false;

  // temps
  private ray = new THREE.Raycaster();
  private tA = v3();
  private tB = v3();
  private tC = v3();
  private tD = v3();
  private tE = v3();
  private tF = v3();
  private tQ = new THREE.Quaternion();
  private yaw = 0;
  private pitch = 0.05;

  constructor(
    private canvas: HTMLCanvasElement,
    private host: HTMLElement,
    private hooks: { current: Hooks },
    private opts: { quality: Quality; font: string; weapons: RangeWeapon[] },
  ) {}

  private rnd() {
    // mulberry32: cheap, and spawn variety does not need to be crypto
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  get high() {
    return this.opts.quality === 'high';
  }

  async init(onProgress: (p: number) => void) {
    const { canvas } = this;
    const high = this.high;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !high, powerPreference: 'high-performance', alpha: false, stencil: false });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    if (high) {
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    onProgress(0.1);
    this.range = await buildRange({ high, font: this.opts.font, renderer: r, scene: this.scene });
    if (this.disposed) {
      this.range.dispose();
      return;
    }
    onProgress(0.6);
    this.fx = new Fx(this.scene, high);
    this.scene.add(this.camera);
    this.camera.position.set(0, RANGE.eye, 0);
    this.camera.add(this.mount);
    this.mount.add(this.kickG);
    // Muzzle flash: a hot sprite + a light that flares for a few frames.
    this.flashSprite = halo('#ffd9a0', 1.2, 0);
    this.flashSprite.material.opacity = 0;
    this.scene.add(this.flashSprite);
    this.flashLight = new THREE.PointLight('#ffb870', 0, 14, 1.8);
    this.scene.add(this.flashLight);

    if (high) {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      const comp = new EffectComposer(r, rt);
      comp.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.7, 0.92);
      comp.addPass(this.bloom);
      comp.addPass(new OutputPass());
      this.grade = makeGradePass();
      this.grade.apply({ shadow: [0.9, 0.96, 1.16], high: [1.1, 1.0, 0.94], sat: 1.12, contrast: 1.1, vignette: 0.6 });
      comp.addPass(this.grade.pass);
      this.composer = comp;
    }
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    this.resize();
    onProgress(0.8);
    // Default weapon so the attract screen has a gun in hand.
    const first = this.opts.weapons[0];
    if (first) await this.setWeapon(first.id);
    if (this.disposed) return;
    onProgress(1);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    (window as unknown as { __bsvgun?: unknown }).__bsvgun = this.debugApi();
  }

  resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(2, el.clientWidth);
    const h = Math.max(2, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w, h);
  }

  // ── Input ──────────────────────────────────────────────────────────

  private bindInput() {
    const c = this.canvas;
    const setNdc = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      this.px.set(e.clientX - r.left, e.clientY - r.top);
      this.ndc.set((this.px.x / r.width) * 2 - 1, -(this.px.y / r.height) * 2 + 1);
    };
    const move = (e: PointerEvent) => {
      this.pad.active = false;
      setNdc(e);
    };
    const down = (e: PointerEvent) => {
      unlockAudio();
      setNdc(e);
      if (e.button === 2) {
        this.scope = true;
        return;
      }
      if (e.pointerType === 'touch') c.setPointerCapture(e.pointerId);
      this.trigger = true;
      if (this.phase === 'play' && !this.paused) this.tryShoot(true);
    };
    const up = (e: PointerEvent) => {
      if (e.button === 2) this.scope = false;
      else this.trigger = false;
    };
    const ctx = (e: Event) => e.preventDefault();
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    c.addEventListener('contextmenu', ctx);
    const key = (e: KeyboardEvent, isDown: boolean) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'shift' || k === 'z') this.scope = isDown;
      else if (k === ' ') {
        this.trigger = isDown;
        if (isDown && this.phase === 'play' && !this.paused) this.tryShoot(true);
        e.preventDefault();
      }
    };
    const kd = (e: KeyboardEvent) => key(e, true);
    const ku = (e: KeyboardEvent) => key(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.cleanup.push(
      () => c.removeEventListener('pointermove', move),
      () => c.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointerup', up),
      () => c.removeEventListener('contextmenu', ctx),
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
    );
  }

  private pollPad(dt: number) {
    const pads = navigator.getGamepads?.() ?? [];
    const p = pads.find((x) => x && x.connected);
    if (!p) return;
    const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : v);
    const ax = dz(p.axes[0] ?? 0) + dz(p.axes[2] ?? 0) * 0.7;
    const ay = dz(p.axes[1] ?? 0) + dz(p.axes[3] ?? 0) * 0.7;
    if (ax || ay) this.pad.active = true;
    if (this.pad.active) {
      this.ndc.x = THREE.MathUtils.clamp(this.ndc.x + ax * dt * 1.7, -1, 1);
      this.ndc.y = THREE.MathUtils.clamp(this.ndc.y - ay * dt * 1.7, -1, 1);
      const r = this.canvas.getBoundingClientRect();
      this.px.set(((this.ndc.x + 1) / 2) * r.width, ((1 - this.ndc.y) / 2) * r.height);
    }
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const fire = b(7) || b(0);
    if (fire !== this.pad.fireWas) {
      this.trigger = fire;
      this.pad.fireWas = fire;
      if (fire) this.pad.active = true;
      if (fire && this.phase === 'play' && !this.paused) this.tryShoot(true);
    }
    if (b(6) || b(2)) this.scope = true;
    else if (this.pad.active && !this.scope) this.scope = false;
    const lb = b(4);
    const rb = b(5);
    if (lb && !this.pad.lb) this.cycleWeapon(-1);
    if (rb && !this.pad.rb) this.cycleWeapon(1);
    this.pad.lb = lb;
    this.pad.rb = rb;
  }

  // ── Weapons ────────────────────────────────────────────────────────

  /** Weapons the player may use (the shell sets this from ownership). */
  unlocked = new Set<string>();
  private order(): RangeWeapon[] {
    return this.opts.weapons.filter((w) => this.unlocked.has(w.id));
  }
  cycleWeapon(d: number) {
    const o = this.order();
    if (o.length < 2) return;
    const i = Math.max(0, o.findIndex((w) => w.id === this.weapon?.id));
    void this.setWeapon(o[(i + d + o.length) % o.length].id);
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
          m.renderOrder = 0;
          m.castShadow = false;
          const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
          for (const mt of mats) if (mt && 'envMapIntensity' in mt) mt.envMapIntensity = 1.6;
        }
      });
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
    this.pushHud(true);
  }

  // ── Run control ────────────────────────────────────────────────────

  start(weaponId: string, live: boolean) {
    void this.setWeapon(weaponId);
    this.live = live;
    for (const t of [...this.targets]) this.removeTarget(t);
    this.score = this.streak = this.bestStreak = this.shots = this.hits = this.blocks = 0;
    this.kills = {};
    this.timeLeft = ROUND;
    this.elapsed = 0;
    this.nextSpawn = 0.3;
    this.blockDue = 30;
    this.lastHeight = this.hooks.current.height();
    this.banner = '';
    this.setPhase('play');
    this.announce('GO!', 1.0);
    sfx('start');
    this.pushHud(true);
  }

  toMenu() {
    for (const t of [...this.targets]) this.removeTarget(t);
    this.setPhase('menu');
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p && this.mgOn) {
      minigun(false);
      this.mgOn = false;
    }
  }

  setScope(v: boolean) {
    this.scope = v;
  }

  /** Blast Zone: show the storm as a barrage on the range. */
  setBlast(active: boolean, tps: number) {
    this.blastActive = active;
    this.blastTps = tps;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.hooks.current.phase(p);
  }

  private announce(text: string, secs = 1.4) {
    this.banner = text;
    this.bannerT = secs;
    this.pushHud(true);
  }

  private finish() {
    this.setPhase('over');
    if (this.mgOn) {
      minigun(false);
      this.mgOn = false;
    }
    this.trigger = false;
    sfx('gameover');
    const acc = this.shots ? this.hits / this.shots : 0;
    this.hooks.current.over({ score: Math.round(this.score), shots: this.shots, hits: this.hits, acc, bestStreak: this.bestStreak, kills: { ...this.kills }, secs: ROUND, weapon: this.weapon?.name ?? '', blocks: this.blocks });
    this.pushHud(true);
  }

  // ── Targets ────────────────────────────────────────────────────────

  private count(p: Pattern) {
    let n = 0;
    for (const t of this.targets) if (t.pattern === p) n++;
    return n;
  }

  private spawn(tx: FeedTx, forceKind?: TargetKind) {
    const kind = forceKind ?? kindOf(tx);
    const info = TARGET_INFO[kind];
    let pattern = info.pattern;
    // Tokens and ordinals ride a rail or are lobbed; variety keeps the sky busy.
    if ((kind === 'token' || kind === 'inscription') && (this.count('rail') >= 3 || this.rnd() < 0.3)) pattern = 'clay';
    if (kind === 'data' && this.count('popup') >= 4) pattern = 'clay';
    if (kind === 'social' && this.count('duck') >= 4) pattern = 'clay';
    if (kind === 'whale' && this.count('float') >= 1) return null;
    if (kind === 'block' && this.count('blockrail') >= 1) return null;
    if (this.targets.length >= 18) return null;

    const size = kind === 'block' ? 1 : sizeOf(tx);
    const rig = buildTarget(kind, tx, size);
    const g = rig.group;
    const r = info.radius * size;
    const t: T = {
      id: this.nextId++,
      kind,
      pattern,
      tx,
      rig,
      g,
      v: v3(),
      hp: info.hp,
      r,
      hitR: r * (pattern === 'duck' ? 1.45 : 1.3) + 0.1,
      age: 0,
      life: 9,
      label: kind === 'block' ? `BLOCK #${tx.op ?? ''}` : labelOf(tx, kind),
      pts: info.pts,
      side: this.rnd() < 0.5 ? 0 : 1,
      seed: this.rnd() * 10,
      hold: 0,
      up: 0,
      station: -1,
      base: v3(),
      flash: 0,
      logoT: 0,
      hittable: true,
      dead: false,
    };
    const sgn = t.side === 0 ? 1 : -1; // direction of travel: from the left trap goes right
    if (pattern === 'clay') {
      const trap = this.range.traps[t.side];
      g.position.set(trap.x + sgn * 1.1, 2.0, trap.z);
      const T = 2.5 + this.rnd() * 1.2;
      const dest = this.tA.set(sgn * (2 + this.rnd() * 13) * (kind === 'blast' ? 1.4 : 1), 6 + this.rnd() * 9, -(14 + this.rnd() * 26));
      t.v.set((dest.x - g.position.x) / T, (dest.y - g.position.y + 0.5 * G_CLAY * T * T) / T, (dest.z - g.position.z) / T);
      if (kind === 'blast') t.v.multiplyScalar(1.25);
      this.range.flashTrap(t.side as 0 | 1);
      sfx('click', 0.25);
      t.life = 8;
    } else if (pattern === 'duck') {
      const z = -(16 + this.rnd() * 22);
      g.position.set(-sgn * 36, 5 + this.rnd() * 8, z);
      t.v.set(sgn * (8 + this.rnd() * 6), 0, (this.rnd() - 0.5) * 2);
      t.life = 12;
      t.base.copy(g.position);
    } else if (pattern === 'popup') {
      const free = this.range.stations.map((s, i) => ({ s, i })).filter(({ i }) => !this.targets.some((o) => o.station === i));
      if (!free.length) {
        rig.dispose();
        return null;
      }
      const pick = free[Math.floor(this.rnd() * free.length)];
      t.station = pick.i;
      g.position.copy(pick.s);
      t.hold = 2.0 + this.rnd() * 1.4;
      t.hittable = false;
      g.visible = false;
      t.life = 8;
    } else if (pattern === 'rail') {
      const lower = this.rnd() < 0.4;
      const z = lower ? RANGE.rail2Z : RANGE.railZ;
      const topY = lower ? RANGE.rail2Y : RANGE.railY;
      const hang = 1.9 + r;
      g.position.set(-sgn * 29, topY - hang, z);
      t.v.set(sgn * (lower ? 8 + this.rnd() * 4 : 6 + this.rnd() * 4), 0, 0);
      t.life = 12;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, hang, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb800').multiplyScalar(1.5), toneMapped: false }));
      h.position.y = hang / 2;
      g.add(h);
      t.hanger = h;
      t.base.set(0, topY - hang, z);
    } else if (pattern === 'float') {
      g.position.set((this.rnd() - 0.5) * 26, 0.5, -(40 + this.rnd() * 14));
      t.base.copy(g.position);
      t.base.y = 8 + this.rnd() * 3.5;
      t.life = 10;
      this.announce('GOLDEN WHALE!', 1.6);
      sfx('pickup');
    } else {
      // block rail: a big slow cube sliding along the gantry
      g.position.set(-sgn * 34, 9, -30);
      t.v.set(sgn * 3.9, 0, 0);
      t.life = 20;
      t.blockRail = true;
      t.hanger = undefined;
    }
    t.g.userData.id = t.id;
    this.scene.add(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = this.high && pattern !== 'duck';
    });
    this.targets.push(t);
    return t;
  }

  private removeTarget(t: T) {
    t.dead = true;
    this.scene.remove(t.g);
    if (t.hanger) {
      const h = t.hanger as THREE.Mesh;
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
    }
    t.rig.dispose();
    const i = this.targets.indexOf(t);
    if (i >= 0) this.targets.splice(i, 1);
  }

  private director(dt: number) {
    const hooks = this.hooks.current;
    this.nextSpawn -= dt;
    if (this.nextSpawn > 0) return;
    const prog = this.phase === 'play' ? 1 - this.timeLeft / ROUND : 0.2;
    const busy = this.targets.length;
    let iv = (0.95 - prog * 0.4) * (1 + Math.max(0, busy - 8) * 0.15);
    if (this.blastActive) iv = Math.max(0.07, 0.9 / Math.max(2, this.blastTps / 5));
    this.nextSpawn = iv * (0.75 + this.rnd() * 0.5);
    // Rare high-value targets first.
    let tx: FeedTx | null = hooks.take((f) => kindOf(f) === 'whale');
    if (!tx) {
      const want = this.rnd();
      const kinds: FeedTx['kind'][] = want < 0.3 ? ['payment'] : want < 0.5 ? ['token'] : want < 0.65 ? ['social'] : want < 0.8 ? ['data'] : want < 0.9 ? ['inscription'] : ['blast'];
      tx = hooks.take((f) => kinds.includes(f.kind)) ?? hooks.take();
    }
    if (!tx) tx = synthTx(() => this.rnd());
    this.spawn(tx);
  }

  private blockWave(height: number, sim: boolean) {
    this.blocks++;
    this.announce(`NEW BLOCK${height ? ` #${height}` : ''}${sim ? '' : ''}`, 2.4);
    sfx('level');
    const tx: FeedTx = { id: `block${height}`, kind: 'data', bytes: 0, sats: 0, mined: true, op: height ? String(height) : '' };
    this.spawn(tx, 'block');
    // The flock: a burst of clay from both traps.
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        if (this.disposed || this.phase === 'over' || this.paused) return;
        const s = synthTx(() => this.rnd());
        const t = this.spawn({ ...s, kind: 'payment', sats: 1e5 }, 'payment');
        if (t) t.flock = 1;
      }, 150 + i * 130);
    }
  }

  // ── Shooting ───────────────────────────────────────────────────────

  private hitTest(origin: THREE.Vector3, dir: THREE.Vector3) {
    let best: T | null = null;
    let bestD = Infinity;
    let off = 0;
    for (const t of this.targets) {
      if (!t.hittable || t.dead) continue;
      const c = this.tE.copy(t.g.position);
      if (t.pattern === 'popup') c.y += t.r * 1.1;
      const oc = this.tB.subVectors(c, origin);
      const tca = oc.dot(dir);
      if (tca < 0.4) continue;
      const d2 = oc.lengthSq() - tca * tca;
      const hr = t.hitR;
      if (d2 > hr * hr) continue;
      const dist = tca - Math.sqrt(hr * hr - d2);
      if (dist < bestD) {
        bestD = dist;
        best = t;
        off = Math.sqrt(Math.max(0, d2)) / t.r;
      }
    }
    return best ? { t: best, dist: Math.max(0.4, bestD), off } : null;
  }

  private endPoint(origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3) {
    let tt = 140;
    if (dir.y < -1e-4) tt = Math.min(tt, -origin.y / dir.y);
    if (dir.z < -1e-4) tt = Math.min(tt, (RANGE.far + 2 - origin.z) / dir.z);
    return out.copy(origin).addScaledVector(dir, tt);
  }

  private muzzleWorld(out: THREE.Vector3) {
    if (this.held) {
      this.held.group.updateWorldMatrix(true, false);
      return out.copy(this.held.muzzle).applyMatrix4(this.held.group.matrixWorld);
    }
    return out.set(0.3, RANGE.eye - 0.3, -0.8);
  }

  private aimRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, this.camera);
    origin.copy(this.ray.ray.origin);
    dir.copy(this.ray.ray.direction);
  }

  private tryShoot(edge: boolean) {
    const w = this.weapon;
    if (!w || this.phase !== 'play') return;
    const now = performance.now();
    if (now < this.nextShot) return;
    if (!w.auto && !edge) return;
    if (!this.hooks.current.fire(w)) {
      this.nextShot = now + 220;
      this.hooks.current.dry?.();
      sfx('click', 0.7);
      this.announce('OUT OF AMMO: LOAD SATS', 1.2);
      return;
    }
    this.nextShot = now + w.fireMs;
    this.shoot(w);
  }

  private shoot(w: RangeWeapon) {
    const org = this.tA;
    const dir = this.tC;
    this.aimRay(org, dir);
    const mz = this.muzzleWorld(this.tD).clone();
    this.shots++;
    let hitAny = 0;
    let killsThisShot = 0;
    const end = new THREE.Vector3();
    const jd = new THREE.Vector3();
    // Splash weapons detonate at the first thing the centre ray meets.
    let splashAt: THREE.Vector3 | null = null;
    for (let p = 0; p < w.pellets; p++) {
      jd.copy(dir);
      if (w.spread > 0) {
        // Pellet patterns: a ring for a quad, a scatter for shotguns.
        const ang = w.pellets > 1 && w.pellets <= 5 ? (p / w.pellets) * Math.PI * 2 + 0.6 : this.rnd() * Math.PI * 2;
        const rad = w.pellets > 1 && w.pellets <= 5 ? w.spread : w.spread * Math.sqrt(this.rnd());
        const zoomTight = this.zoomed() ? 0.45 : 1;
        // Offset in the plane perpendicular to the aim ray.
        const u = this.tE.crossVectors(dir, this.tD.set(0, 1, 0)).normalize();
        const vv = this.tB.crossVectors(u, dir);
        jd.addScaledVector(u, Math.cos(ang) * rad * zoomTight).addScaledVector(vv, Math.sin(ang) * rad * zoomTight).normalize();
      }
      const hit = this.hitTest(org, jd);
      if (hit) {
        this.tB.copy(org).addScaledVector(jd, hit.dist);
        end.copy(this.tB);
        hitAny++;
        if (w.splash === 0) {
          const bull = w.pellets === 1 && hit.off < 0.33;
          if (this.damage(hit.t, w.damage, end, bull, hit.dist)) killsThisShot++;
        } else if (!splashAt) splashAt = end.clone();
      } else {
        this.endPoint(org, jd, end);
        if (w.splash > 0 && !splashAt && end.y < 0.2) splashAt = end.clone();
        if (end.y < 0.25) this.fx.sparks(end, w.bolt, w.pellets > 4 ? 2 : 5, 4);
      }
      const width = w.ammo === 'laser' ? 0.1 : w.ammo === 'plasma' ? 0.07 : w.ammo === 'rocket' ? 0.2 : w.ammo === 'grenade' ? 0.16 : w.ammo === 'pellet' ? 0.035 : 0.05;
      const life = w.ammo === 'laser' ? 0.17 : w.ammo === 'rocket' || w.ammo === 'grenade' ? 0.22 : 0.08;
      this.fx.tracer(mz, end, w.bolt, width, life);
    }
    if (splashAt && w.splash > 0) {
      this.fx.ring(splashAt, w.bolt, w.splash * 1.3, 0.5);
      this.fx.sparks(splashAt, w.bolt, 26, 12);
      this.range.hitLight.position.copy(splashAt);
      this.range.hitLight.color.set(w.bolt);
      this.range.hitLight.intensity = 90;
      this.shake = Math.max(this.shake, 0.5);
      sfx('explosion', 0.5);
      for (const t of [...this.targets]) {
        if (!t.hittable || t.dead) continue;
        if (t.g.position.distanceTo(splashAt) <= w.splash + t.r) {
          hitAny++;
          if (this.damage(t, w.damage, t.g.position, false, t.g.position.distanceTo(org))) killsThisShot++;
        }
      }
    }
    // Streak: any kill builds it, a complete miss breaks it.
    if (killsThisShot > 0) {
      this.hits++;
      this.streak += killsThisShot;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      if (killsThisShot >= 2) this.popupScreen(`${killsThisShot}x!`, '#27e6ff', 1.2);
    } else if (hitAny > 0) {
      this.hits++;
    } else {
      this.streak = 0;
    }
    // Feel: recoil, flash, noise.
    this.recoil = Math.min(1.6, this.recoil + 0.55 + w.kick * 0.25);
    this.shake = Math.min(1, this.shake + 0.08 + w.kick * 0.05);
    this.flashT = 0.06;
    this.flashSprite.position.copy(mz);
    this.flashSprite.scale.setScalar(0.34 + this.rnd() * 0.3 + (w.pellets > 3 ? 0.25 : 0));
    this.flashSprite.material.color.set(w.bolt);
    this.flashSprite.material.opacity = 1;
    this.flashLight.position.copy(mz);
    this.flashLight.color.set(w.bolt);
    this.flashLight.intensity = this.high ? 9 : 0;
    if (w.def.id === 'minigun' || w.ordnance?.id === 'minigun-of-the-mempool') {
      if (!this.mgOn) {
        this.mgOn = true;
        minigun(true);
      }
    } else sfx(AMMO_SFX[w.ammo], w.auto ? 0.55 : 0.9);
    this.pushHud(false);
  }

  private zoomed() {
    return this.scope && !!this.weapon && this.phase !== 'over';
  }

  /** Returns true if the target died. */
  private damage(t: T, dmg: number, at: THREE.Vector3, bullseye: boolean, dist: number) {
    t.hp -= dmg;
    t.flash = 1;
    if (t.hp > 0) {
      this.fx.sparks(at, TARGET_INFO[t.kind].glow, 14, 9);
      sfx('hit', 0.6);
      const chip = Math.round(t.pts * 0.08 * this.mult());
      this.score += chip;
      this.popupWorld(`+${chip}`, at, '#ffd24a', 0.9);
      this.pulse = Math.min(1, this.pulse + 0.4);
      return false;
    }
    const mult = this.mult();
    const dBonus = 1 + Math.min(1, dist / 90);
    let pts = Math.round(t.pts * dBonus * mult * (bullseye ? 1.5 : 1));
    if (t.flock) pts = Math.round(pts * 1.2);
    this.score += pts;
    this.kills[t.kind] = (this.kills[t.kind] ?? 0) + 1;
    const info = TARGET_INFO[t.kind];
    const pos = this.tF.copy(t.g.position);
    const big = t.kind === 'whale' || t.kind === 'block';
    this.fx.shatter(pos, info.color, big ? (this.high ? 90 : 36) : this.high ? 26 : 12, big ? 15 : 9, big ? 2.1 : 1, t.kind === 'social');
    if (t.kind === 'social') this.fx.shatter(pos, '#ffffff', this.high ? 16 : 6, 5, 0.9, true);
    if (t.kind === 'token') this.fx.shatter(pos, '#ffd24a', 10, 8, 0.8);
    this.fx.sparks(pos, info.glow, big ? 70 : 24, big ? 18 : 12);
    this.fx.ring(pos, info.glow, big ? 9 : 3.4, big ? 0.7 : 0.4);
    this.range.hitLight.position.copy(pos);
    this.range.hitLight.color.set(info.glow);
    this.range.hitLight.intensity = big ? 220 : 70;
    this.pulse = 1;
    sfx(big ? 'explosion' : t.kind === 'token' ? 'coin' : 'stamp', big ? 0.8 : 0.5);
    if (t.kind === 'block') sfx('level');
    const line = `${t.label}  +${pts.toLocaleString()}`;
    this.popupWorld(bullseye ? `BULLSEYE ${line}` : line, pos, info.glow, big ? 1.5 : 1);
    if (big) {
      // Slow-mo punch on the rare ones.
      this.slowT = t.kind === 'block' ? 1.1 : 0.8;
      this.fovKick = 1;
      this.shake = 1;
      this.announce(t.kind === 'block' ? 'BLOCK DOWN!' : 'WHALE DOWN!', 1.6);
    } else this.hitStop = 0.03;
    if (this.streak > 0 && (this.streak + 1) % 3 === 0 && this.mult() < 8) {
      this.announce(`COMBO x${Math.min(8, 1 + Math.floor((this.streak + 1) / 3))}`, 0.9);
    }
    this.removeTarget(t);
    return true;
  }

  private mult() {
    return Math.min(8, 1 + Math.floor(this.streak / 3));
  }

  private popupWorld(text: string, at: THREE.Vector3, color: string, scale = 1) {
    const p = this.tB.copy(at).project(this.camera);
    if (p.z > 1) return;
    const r = this.canvas.getBoundingClientRect();
    this.popup(text, ((p.x + 1) / 2) * r.width, ((1 - p.y) / 2) * r.height, color, scale);
  }
  private popupScreen(text: string, color: string, scale = 1) {
    this.popup(text, this.px.x, this.px.y - 36, color, scale);
  }
  private popup(text: string, x: number, y: number, color: string, scale: number) {
    const d = document.createElement('div');
    d.className = 'bg-pop';
    d.textContent = text;
    d.style.cssText = `left:${x}px;top:${y}px;color:${color};font-size:${Math.round(15 * scale)}px`;
    this.host.appendChild(d);
    setTimeout(() => d.remove(), 1000);
    while (this.host.childElementCount > 24) this.host.firstElementChild?.remove();
  }

  // ── Frame ──────────────────────────────────────────────────────────

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dtReal = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    this.watchFps(dtReal);
    this.pollPad(dtReal);
    if (this.hitStop > 0) {
      this.hitStop -= dtReal;
      dtReal *= 0.1;
    }
    if (this.slowT > 0) this.slowT -= dtReal;
    const targetScale = this.slowT > 0 ? 0.22 : 1;
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, dtReal * 9);
    const dt = this.paused ? 0 : dtReal * this.timeScale;
    this.uptime += dtReal;
    this.clock += dt;
    this.step(dt, dtReal);
    this.render();
  };

  /** Low frame rate for a few seconds on High (Auto only): turn off bloom, shadows and the extra pixels. */
  private watchFps(dt: number) {
    this.fpsEma += (1 / Math.max(dt, 1e-3) - this.fpsEma) * 0.05;
    if (!this.autoDegrade || this.degraded || !this.high || this.uptime < 5) return;
    this.slowFor = this.fpsEma < 28 ? this.slowFor + dt : 0;
    if (this.slowFor > 3) this.degrade();
  }

  degrade() {
    if (this.degraded) return;
    this.degraded = true;
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(1);
    this.resize();
    this.announce('QUALITY LOWERED', 1.6);
  }

  private step(dt: number, dtReal: number) {
    const play = this.phase === 'play';
    if (play && !this.paused) {
      this.timeLeft -= dtReal;
      this.elapsed += dtReal;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish();
      }
      // Auto fire while held.
      if (this.trigger && this.weapon?.auto) this.tryShoot(false);
      if (!this.trigger && this.mgOn) {
        this.mgOn = false;
        minigun(false);
      }
      // Blocks: a real new block (tip height changed) or the scheduled one.
      const h = this.hooks.current.height();
      if (h && this.lastHeight && h > this.lastHeight) {
        this.lastHeight = h;
        this.blockWave(h, false);
      } else if (this.elapsed > this.blockDue) {
        this.blockDue = Infinity;
        if (h) this.lastHeight = h;
        this.blockWave(h, true);
      }
    }
    if (this.phase !== 'over') this.director(dt);
    this.demo(dt);
    this.updateTargets(dt);
    this.fx.update(dt, this.camera);
    this.pulse = Math.max(0, this.pulse - dtReal * 2.2);
    this.range.update(this.uptime, dtReal, this.pulse);
    this.range.hitLight.intensity = Math.max(0, this.range.hitLight.intensity - dtReal * 700);
    if (this.flashT > 0) {
      this.flashT -= dtReal;
      this.flashSprite.material.opacity = Math.max(0, this.flashT / 0.06);
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dtReal * 700);
    } else {
      this.flashSprite.material.opacity = 0;
      this.flashLight.intensity = 0;
    }
    this.recoil = Math.max(0, this.recoil - dtReal * 7);
    this.shake = Math.max(0, this.shake - dtReal * 3.2);
    this.fovKick = Math.max(0, this.fovKick - dtReal * 2.2);
    if (this.bannerT > 0) {
      this.bannerT -= dtReal;
      if (this.bannerT <= 0) {
        this.banner = '';
        this.pushHud(true);
      }
    }
    this.updateCamera(dtReal);
    if (this.bloom) {
      this.bloom.strength = 0.55 + this.pulse * 0.45;
    }
    this.grade?.tick(this.uptime, 0);
    // Hover label and HUD tick.
    if (play) {
      this.aimRay(this.tA, this.tC);
      const h = this.hitTest(this.tA, this.tC);
      this.hover = h ? `${h.t.label}${h.t.tx.id.startsWith('sim') ? ' · sim' : ` · ${h.t.tx.id.slice(0, 8)}`}` : '';
    } else this.hover = '';
    this.hudT -= dtReal;
    if (this.hudT <= 0) this.pushHud(false);
    this.hooks.current.reticle?.(this.px.x, this.px.y, (play || this.pad.active) && !this.paused);
  }

  private demo(dt: number) {
    // Attract mode / Blast Zone: the gun swings at targets on its own.
    const active = this.phase !== 'play' && this.weapon;
    if (!active) return;
    const blast = this.blastActive;
    this.demoT -= dt;
    const rate = blast ? Math.min(0.06, 1 / Math.max(6, this.blastTps / 3)) : 1.1;
    if (this.demoT > 0) return;
    this.demoT = rate * (0.6 + this.rnd() * 0.8);
    const live = this.targets.filter((t) => t.hittable && !t.dead);
    if (!live.length) return;
    const t = live[Math.floor(this.rnd() * live.length)];
    // aim the cursor at it (so the gun swings), then resolve a hit
    const p = this.tB.copy(t.g.position).project(this.camera);
    if (p.z > 1) return;
    this.ndc.set(p.x, p.y);
    const r = this.canvas.getBoundingClientRect();
    this.px.set(((p.x + 1) / 2) * r.width, ((1 - p.y) / 2) * r.height);
    const w = this.weapon!;
    const mz = this.muzzleWorld(this.tD).clone();
    this.fx.tracer(mz, t.g.position, w.bolt, 0.07, 0.08);
    this.flashT = 0.05;
    this.flashSprite.position.copy(mz);
    this.flashSprite.scale.setScalar(0.4);
    this.flashSprite.material.opacity = 0.8;
    this.recoil = Math.min(1.2, this.recoil + 0.4);
    if (!blast || this.rnd() < 0.8) {
      t.hp = 0;
      const info = TARGET_INFO[t.kind];
      this.fx.shatter(t.g.position, info.color, this.high ? 18 : 8, 8, 1, t.kind === 'social');
      this.fx.sparks(t.g.position, info.glow, 14, 10);
      this.fx.ring(t.g.position, info.glow, 3, 0.35);
      this.pulse = Math.max(this.pulse, 0.7);
      this.removeTarget(t);
    }
  }

  private updateTargets(dt: number) {
    const time = this.clock;
    for (const t of [...this.targets]) {
      if (t.dead) continue;
      t.age += dt;
      t.rig.tick(time + t.seed, dt);
      if (t.rig.upgradeLogo && (t.logoT -= dt) <= 0) {
        t.logoT = 0.6;
        if (t.rig.upgradeLogo()) t.rig.upgradeLogo = undefined;
      }
      if (t.flash > 0) {
        t.flash = Math.max(0, t.flash - dt * 6);
        for (const m of t.rig.mats) m.emissiveIntensity = 0.55 + t.flash * 2.2;
      }
      const g = t.g;
      let gone = false;
      switch (t.pattern) {
        case 'clay': {
          t.v.y -= G_CLAY * dt;
          g.position.addScaledVector(t.v, dt);
          if ((g.position.y < 0.5 && t.v.y < 0) || t.age > t.life) gone = true;
          break;
        }
        case 'duck': {
          g.position.x += t.v.x * dt;
          g.position.z += t.v.z * dt;
          g.position.y = t.base.y + Math.sin(t.age * 2.6 + t.seed) * 1.4;
          g.rotation.y = Math.atan2(-t.v.x, -t.v.z + 1e-4);
          g.rotation.z = -Math.cos(t.age * 2.6 + t.seed) * 0.25 * Math.sign(t.v.x);
          if (Math.abs(g.position.x) > 40 || t.age > t.life) gone = true;
          break;
        }
        case 'popup': {
          if (t.age < 0.3) t.up = Math.min(1, t.age / 0.28);
          else if (t.age < 0.3 + t.hold) t.up = 1;
          else t.up = Math.max(0, 1 - (t.age - 0.3 - t.hold) / 0.22);
          if (t.age > 0.3 + t.hold + 0.25) gone = true;
          g.visible = t.up > 0.02;
          t.hittable = t.up > 0.7;
          // hinge at the base: the rig sits above the station
          const e = t.up < 1 ? 1 - Math.pow(1 - t.up, 3) : 1;
          g.rotation.x = -(Math.PI / 2) * (1 - e) + Math.sin(Math.min(1, t.age / 0.4) * Math.PI) * 0.18;
          for (const c of g.children) c.position.y = t.r * 1.1;
          break;
        }
        case 'rail': {
          g.position.x += t.v.x * dt;
          g.position.y = t.base.y + Math.sin(t.age * 3 + t.seed) * 0.12;
          if (Math.abs(g.position.x) > 34 || t.age > t.life) gone = true;
          break;
        }
        case 'float': {
          const k = Math.min(1, t.age / 2.2);
          g.position.y = THREE.MathUtils.lerp(0.5, t.base.y, 1 - Math.pow(1 - k, 3)) + Math.sin(t.age * 1.3) * 0.6;
          g.position.x = t.base.x + Math.sin(t.age * 0.6 + t.seed) * 14;
          if (t.age > t.life - 1.5) g.position.y += (t.age - (t.life - 1.5)) * 8; // escapes upward
          if (t.age > t.life) gone = true;
          break;
        }
        case 'static': {
          if (t.age > t.life) gone = true;
          break;
        }
        case 'blockrail': {
          g.position.x += t.v.x * dt;
          g.position.y = 9 + Math.sin(t.age * 0.8) * 0.5;
          if (Math.abs(g.position.x) > 40 || t.age > t.life) gone = true;
          break;
        }
      }
      if (gone) {
        // A miss: it just pops harmlessly (dull puff, no points).
        if (t.pattern === 'clay' && g.position.y < 1) this.fx.sparks(g.position, '#8a8a92', 5, 3);
        this.removeTarget(t);
      }
    }
  }

  private updateCamera(dtReal: number) {
    const cam = this.camera;
    const z = this.zoomed() ? this.weapon!.zoom : 1;
    // Wide screens: a 64 degree vertical view. Portrait phones get a wider one so the lane still fits.
    const bf = cam.aspect >= 1.6 ? BASE_FOV : THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * (1.6 / cam.aspect))), BASE_FOV, 98);
    const targetFov = fov2(bf, z) * (1 - this.fovKick * 0.18);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dtReal * 10);
    cam.updateProjectionMatrix();
    const sens = 1 / Math.sqrt(z);
    const ty = -this.ndc.x * 0.2 * sens;
    const tp = this.ndc.y * 0.12 * sens + 0.14;
    this.yaw += (ty - this.yaw) * Math.min(1, dtReal * 12);
    this.pitch += (tp - this.pitch) * Math.min(1, dtReal * 12);
    const idle = this.phase === 'menu' ? Math.sin(this.uptime * 0.25) * 0.04 : 0;
    const s = this.shake * this.shake;
    cam.rotation.set(this.pitch + (this.rnd() - 0.5) * s * 0.03 + this.recoil * 0.004, this.yaw + idle + (this.rnd() - 0.5) * s * 0.03, 0, 'YXZ');
    cam.position.set((this.rnd() - 0.5) * s * 0.04, RANGE.eye + Math.sin(this.uptime * 1.1) * 0.006 + (this.rnd() - 0.5) * s * 0.04, 0);
    cam.updateMatrixWorld();

    // Gun: swing the barrel at the point under the cursor, kick back on recoil, hide when scoped hard.
    if (this.held && this.weapon) {
      const aimPt = this.tB;
      this.aimRay(this.tA, this.tC);
      aimPt.copy(this.tA).addScaledVector(this.tC, 40);
      cam.worldToLocal(aimPt);
      // The barrel follows the cursor, but only part of the way, so the gun never points at the sky.
      const to = aimPt.sub(this.mount.position).normalize();
      to.lerp(this.tF.set(0, 0.02, -1), 0.4).normalize();
      this.tQ.setFromUnitVectors(this.tD.set(0, 0, -1), to);
      this.mount.quaternion.slerp(this.tQ, Math.min(1, dtReal * 14));
      const k = this.weapon.kick;
      this.kickG.position.z = this.recoil * 0.06 * (0.4 + k * 0.5);
      this.kickG.rotation.x = this.recoil * 0.05 * (0.4 + k * 0.5);
      this.held.group.visible = !(this.zoomed() && this.weapon.zoom >= 2.5);
      this.held.mixer?.update(dtReal);
      if (this.held.spin) this.held.spin.timeScale = this.trigger && this.phase === 'play' ? 14 : this.held.spin.timeScale * 0.92;
    }
  }

  private render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private pushHud(force: boolean) {
    this.hudT = 0.1;
    void force;
    const w = this.weapon;
    this.hooks.current.hud({
      score: Math.round(this.score),
      timeLeft: this.timeLeft,
      streak: this.streak,
      mult: this.mult(),
      shots: this.shots,
      hits: this.hits,
      weapon: w?.name ?? '',
      zoomed: this.zoomed(),
      scoped: this.zoomed() && !!w && w.zoom >= 2.5,
      hover: this.hover,
      banner: this.banner,
      feedLive: this.hooks.current.feedLive(),
      targets: this.targets.length,
    });
  }

  // ── Debug / test hook ──────────────────────────────────────────────

  private debugApi() {
    return {
      phase: () => this.phase,
      score: () => this.score,
      targets: () => {
        const r = this.canvas.getBoundingClientRect();
        return this.targets
          .filter((t) => t.hittable)
          .map((t) => {
            const p = this.tB.copy(t.g.position).project(this.camera);
            return { kind: t.kind, x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, z: p.z };
          })
          .filter((t) => t.z < 1);
      },
      info: () => ({ calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, targets: this.targets.length, shots: this.shots, hits: this.hits, streak: this.streak }),
      block: () => this.blockWave(this.hooks.current.height(), true),
      end: () => this.finish(),
      blast: (a: boolean, tps: number) => this.setBlast(a, tps),
      showcase: (token?: string, z = -12, step = 3.4, y = 4.2) => {
        const kinds: TargetKind[] = ['payment', 'blast', 'token', 'inscription', 'social', 'data'];
        kinds.forEach((k, i) => {
          const tx: FeedTx = { id: `simshow${i}`, kind: k === 'whale' ? 'payment' : (k as FeedTx['kind']), bytes: 400, sats: k === 'whale' ? 2e9 : 5000, mined: false, token: k === 'token' ? token : undefined };
          const t = this.spawn(tx, k);
          if (!t) return;
          t.pattern = 'static';
          t.hittable = true;
          t.g.visible = true;
          t.g.position.set((i - 2.5) * step, y + (i % 2) * 1.4, z);
          t.g.rotation.set(0, k === 'social' ? -1.2 : 0, 0);
          t.life = 1e9;
        });
      },
      nearest: () => this.targets.map((t) => ({ kind: t.kind, pattern: t.pattern, p: [t.g.position.x, t.g.position.y, t.g.position.z] })),
      whale: () => this.spawn({ id: 'simwhale', kind: 'payment', bytes: 300, sats: 2e9, mined: false }),
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    for (const c of this.cleanup) c();
    if (this.mgOn) minigun(false);
    for (const t of [...this.targets]) this.removeTarget(t);
    this.fx?.dispose();
    this.range?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    this.host.replaceChildren();
    delete (window as unknown as { __bsvgun?: unknown }).__bsvgun;
  }
}
