/**
 * bRacer engine: anti-gravity racing on 3D splines. Rivals are live chain transactions; the shell
 * (menus, HUD, results) is src/components/BRacer.tsx. Physics lives in sim.ts, the world in world.ts.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { FeedTx } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';
import { pickRivals, type RivalSpec } from '@/lib/rally/rivals';
import { rng } from '@/lib/rally/noise';
import { HyperAudio } from './audio';
import { Input, type Touch } from './input';
import { newShip, noInput, SHIPS, stepShip, WEAPONS, type ShipSpec, type SimInput, type Weapon } from './sim';
import { buildShip, Trail, type Rig } from './ships';
import { FONTS } from './signs';
import { teamOfKind, TEAMS, type Team } from './teams';
import { buildTrack, frameAt, HALF_W, newFrame, STEP, surfaceH, TRACKS, type Frame, type Track, type TrackId } from './track';
import { buildWorld, Particles, SpeedLines, type Quality, type World } from './world';

export type Phase = 'loading' | 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';
export type Mode = 'race' | 'trial';
export type Hud = {
  kmh: number;
  speed01: number;
  lap: number;
  laps: number;
  pos: number;
  total: number;
  lapTime: number;
  time: number;
  energy: number;
  boosting: boolean;
  weapon: Weapon | null;
  shield: boolean;
  progress: number;
  air: boolean;
  wrongWay: boolean;
  best: number | null;
};
export type Toast = { text: string; tone: 'good' | 'bad' | 'info' };
export type BoardRow = { name: string; sub: string; time: number; me: boolean; tx: string | null; color: string; logo: string | null };
export type Result = {
  track: TrackId;
  ship: string;
  mode: Mode;
  pos: number;
  total_cars: number;
  total: number;
  laps: number[];
  bestLap: number;
  hits: number;
  cells: number;
  rivalHits: number;
  parts: { time: number; place: number; cells: number; clean: number; combat: number };
  score: number;
  board: BoardRow[];
};
export type MapData = { px: number; pz: number; rivals: { x: number; z: number; c: string }[]; yaw: number };
export type LiveRow = { name: string; color: string; me: boolean; logo: string | null };

export type Callbacks = {
  onPhase(p: Phase): void;
  onCount(n: number | null): void;
  onHud(h: Hud): void;
  onToast(t: Toast): void;
  onLoading(msg: string, pct: number): void;
  onFinish(r: Result): void;
  onMap(m: MapData): void;
  onBoard(rows: LiveRow[]): void;
  onStartRequest?(): void;
  onPerf?(info: { fps: number; level: number }): void;
  onFlash?(kind: 'pad' | 'hit' | 'boost' | 'quake'): void;
};

export type Options = {
  track: TrackId;
  ship: string;
  team: string;
  mode: Mode;
  quality: Quality;
  take: (pred?: (f: FeedTx) => boolean) => FeedTx | null;
  cb: Callbacks;
  touchDevice: boolean;
};

const BEST_KEY = 'tokenblaster:bracer-laps';
const COUNT = 7;
const RIVAL_SCALE = 1.1;
const GRID_S = (k: number) => -9 - k * 12;
const POINTS = [3000, 2200, 1600, 1200, 800, 500, 300, 100];

type RivalRun = {
  spec: RivalSpec;
  team: Team;
  rig: Rig;
  trail: Trail | null;
  label: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTex: THREE.CanvasTexture;
  labelKey: string;
  tt: Float32Array;
  s0: number;
  tc: number;
  idx: number;
  S: number;
  lat: number;
  lane: number;
  phase: number;
  stun: number;
  spin: number;
  finish: number;
  weaponT: number;
  done: boolean;
  v: number;
};
type Shot = { owner: 'me' | number; S: number; lat: number; v: number; life: number; mesh: THREE.Mesh };
type Mine = { owner: 'me' | number; S: number; lat: number; t: number; mesh: THREE.Mesh };
type Ring = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; dur: number; max: number; active: boolean };

const GRADE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uHit: { value: 0 },
    uPulse: { value: 1 },
    uTime: { value: 0 },
    uAspect: { value: 1.6 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed; uniform float uBoost; uniform float uHit; uniform float uPulse; uniform float uTime; uniform float uAspect; uniform vec3 uTint;
    varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r = length(d);
      // Boost-pad shockwave: a ring of distortion expanding from the centre.
      float ring = uPulse * 0.9;
      float w = exp(-abs(r - ring) * 11.0) * (1.0 - uPulse) * step(uPulse, 0.999);
      d += normalize(d + 1e-5) * sin((r - ring) * 40.0) * w * 0.03;
      float blur = (uSpeed * 0.035 + uBoost * 0.04) * smoothstep(0.25, 0.85, r);
      float ca = (uSpeed * 0.003 + uBoost * 0.006 + uHit * 0.01 + w * 0.02) * (0.3 + r);
      vec3 col = vec3(0.0); float ws = 0.0;
      vec2 nd = normalize(d + 1e-5);
      for (int i = 0; i < 10; i++) {
        float k = float(i) / 9.0;
        vec2 o = d * (1.0 - blur * k);
        float wt = 1.0 - k * 0.55;
        col += vec3(texture2D(tDiffuse, o + 0.5 + nd * ca * (0.4 + k)).r, texture2D(tDiffuse, o + 0.5).g, texture2D(tDiffuse, o + 0.5 - nd * ca * (0.4 + k)).b) * wt;
        ws += wt;
      }
      col /= ws;
      float vig = smoothstep(1.1, 0.25, r * (1.0 + uSpeed * 0.3));
      col *= mix(1.0, vig, 0.5 + uSpeed * 0.2);
      col = mix(col, col * vec3(1.5, 0.5, 0.45), uHit * smoothstep(0.15, 0.8, r));
      col *= uTint;
      col += uBoost * vec3(0.02, 0.04, 0.06) * smoothstep(0.3, 0.9, r);
      float scan = 0.97 + 0.03 * sin(vUv.y * 900.0);
      col *= scan;
      col += (rnd(vUv * 800.0) - 0.5) * 0.014;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class HyperEngine {
  opts: Options;
  el: HTMLElement;
  phase: Phase = 'loading';
  tr!: Track;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1.6, 0.3, 5200);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private world!: World;
  private pmrem!: THREE.PMREMGenerator;
  private envTex: THREE.Texture | null = null;
  private input = new Input();
  private audio = new HyperAudio();
  private disposed = false;
  private fxLevel = 3;
  private dpr = 1;
  private maxDpr = 1.5;
  private ro: ResizeObserver | null = null;
  private clock = new THREE.Clock(false);
  private frameMs = 16;
  private lowFrames = 0;
  private perfCool = 4;
  private perfT = 0;
  private time = 0;
  private spec: ShipSpec;
  private team: Team;
  private me = newShip(0);
  private trailL: Trail | null = null;
  private trailR: Trail | null = null;
  private rivals: RivalRun[] = [];
  private rng = rng(Date.now() & 0xffff);
  private frame = newFrame();
  private frame2 = newFrame();
  private qCam = new THREE.Quaternion();
  private qTmp = new THREE.Quaternion();
  private qTmp2 = new THREE.Quaternion();
  private mTmp = new THREE.Matrix4();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private shipPos = new THREE.Vector3();
  private camLat = 0;
  private camH = 1;
  private camMode = 0;
  private fov = 75;
  private shake = 0;
  private hitFlash = 0;
  private pulse = 1;
  private boostFx = 0;
  private lines!: SpeedLines;
  private parts!: Particles;
  private rings: Ring[] = [];
  private moon!: THREE.DirectionalLight;
  private under!: THREE.PointLight;
  private shots: Shot[] = [];
  private mines: Mine[] = [];
  private shotGeo = new THREE.ConeGeometry(0.5, 3.2, 8);
  private shotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb23a').multiplyScalar(3.5) });
  private mineGeo = new THREE.IcosahedronGeometry(1.1, 0);
  private mineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3b3b').multiplyScalar(3) });
  private cellTaken: number[] = [];
  private weaponCool: number[] = [];
  private raceT = 0;
  private lapT = 0;
  private lapTimes: number[] = [];
  private lastLap = 0;
  private sectorAt = [0, 0, 0];
  private lapSplits: number[] = [];
  private bestSplits: number[] = [];
  private bestLap: number | null = null;
  private sectorShown = -1;
  private countT = 0;
  private lastCount = -1;
  private laps = 3;
  private finishedMe = false;
  private rivalHits = 0;
  private lastHud = 0;
  private lastMap = 0;
  private lastBoard = 0;
  private lastPos = 8;
  private menuAng = 0;
  private liveRivals = 0;
  private wrong = 0;
  private showSpeed = 0;
  private scrapeAcc = 0;
  private autoWeapon: Weapon | null = null;
  private visHandler = () => {
    if (document.hidden && this.phase === 'racing') this.pause(true);
  };

  constructor(el: HTMLElement, opts: Options) {
    this.el = el;
    this.opts = opts;
    this.spec = SHIPS.find((s) => s.id === opts.ship) ?? SHIPS[1];
    this.team = TEAMS.find((t) => t.id === opts.team) ?? TEAMS[0];
    this.laps = 3;
    this.maxDpr = opts.quality === 'ultra' ? 2 : opts.quality === 'high' ? 1.6 : 1.05;
  }

  get touch(): Touch {
    return this.input.touch;
  }
  get padActive() {
    return this.input.padActive;
  }
  get totalCars() {
    return this.rivals.length + 1;
  }
  rivalList() {
    return this.rivals.map((r) => ({ name: this.labelText(r).main, detail: r.spec.detail, color: r.team.base, live: r.spec.live, tx: r.spec.tx, team: r.team.name, kind: r.spec.kind, skill: r.spec.skill }));
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.input.capture = p === 'countdown' || p === 'racing' || p === 'paused';
    this.opts.cb.onPhase(p);
  }

  // ───────────── Loading ─────────────

  async init() {
    const { cb } = this.opts;
    const q = this.opts.quality;
    const def = TRACKS[this.opts.track];
    cb.onLoading('Setting up renderer', 0.03);
    const hi = q !== 'low';
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    renderer.setPixelRatio(this.dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    this.el.appendChild(renderer.domElement);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.fxLevel = q === 'ultra' ? 3 : hi ? 2 : 1;
    // Fonts used by canvas art (best effort).
    try {
      await Promise.race([document.fonts.load(`900 40px ${FONTS.display}`), new Promise((r) => setTimeout(r, 1200))]);
    } catch {
      /* fine */
    }
    cb.onLoading('Laying out the circuit', 0.1);
    await new Promise((r) => setTimeout(r, 0));
    this.tr = buildTrack(def);
    const tr = this.tr;
    cb.onLoading('Building the megastructure', 0.3);
    await new Promise((r) => setTimeout(r, 0));
    if (this.disposed) return;
    this.world = buildWorld(tr, q, renderer);
    const sky = this.world.sky;
    // Image-based light from the sky dome.
    const envScene = new THREE.Scene();
    const skyClone = sky.clone();
    envScene.add(skyClone);
    this.envTex = this.pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.5;
    this.scene.add(sky);
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(def.palette.fog), def.palette.fogDensity);
    this.scene.add(new THREE.HemisphereLight('#aab4ff', def.palette.fog, 1.1));
    this.moon = new THREE.DirectionalLight(def.palette.sun, 2.4);
    this.moon.position.set(-0.5, 0.7, 0.8).multiplyScalar(100);
    this.scene.add(this.moon);
    this.under = new THREE.PointLight(def.palette.a1, 30, 38, 1.4);
    this.scene.add(this.under);
    this.scene.add(this.camera);
    this.lines = new SpeedLines(q === 'low' ? 320 : q === 'high' ? 640 : 900, def.palette.a1);
    this.camera.add(this.lines.mesh);
    this.parts = new Particles(q === 'low' ? 500 : 1400);
    this.scene.add(this.parts.points);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, t: 0, dur: 1, max: 10, active: false });
    }
    cb.onLoading('Painting the livery', 0.6);
    await new Promise((r) => setTimeout(r, 0));
    this.input.attach();
    document.addEventListener('visibilitychange', this.visHandler);
    this.me = newShip(0);
    this.buildPlayer();
    this.world.strobe(0);
    cb.onLoading('Reading the mempool', 0.8);
    await this.makeRivals();
    if (this.disposed) return;
    this.buildComposer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.resize();
    this.resetRace();
    this.readBest();
    this.clock.start();
    renderer.setAnimationLoop(() => this.loop());
    this.audio.start();
    this.setPhase('menu');
    cb.onLoading('Ready', 1);
  }

  private readBest() {
    try {
      const j = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, { lap: number; splits: number[] }>;
      const b = j[this.opts.track];
      this.bestLap = b?.lap ?? null;
      this.bestSplits = b?.splits ?? [];
    } catch {
      this.bestLap = null;
    }
  }
  private writeBest(lap: number, splits: number[]) {
    try {
      const j = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, { lap: number; splits: number[] }>;
      j[this.opts.track] = { lap, splits };
      localStorage.setItem(BEST_KEY, JSON.stringify(j));
    } catch {
      /* storage blocked */
    }
  }

  private buildPlayer() {
    const accent = this.team.accent === '#ffffff' || this.team.accent === '#f4efe2' || this.team.accent === '#f2f2ee' ? TRACKS[this.opts.track].palette.a1 : this.team.accent;
    const rig = buildShip(this.spec, { base: this.team.base, accent: this.team.accent, trim: this.team.trim, ticker: 'YOU', number: '01', team: this.team.name, logo: null }, accent);
    this.playerRig = rig;
    this.scene.add(rig.root);
    const col = new THREE.Color(this.TRAIL_COL(accent)).multiplyScalar(0.45);
    this.trailL = new Trail(this.opts.quality === 'low' ? 12 : 22, col, 0.15);
    this.trailR = new Trail(this.opts.quality === 'low' ? 12 : 22, col, 0.15);
    this.scene.add(this.trailL.mesh, this.trailR.mesh);
  }
  private playerRig!: Rig;
  private TRAIL_COL(c: string) {
    return new THREE.Color(c).multiplyScalar(2.2).getHex();
  }

  private labelText(r: RivalRun) {
    const sp = r.spec;
    if (sp.token) {
      const m = tokenMeta(sp.token);
      return { main: m ? `$${m.sym}` : `$${sp.token.slice(0, 5)}`, meta: m };
    }
    return { main: sp.live ? `TX ${sp.tx!.slice(0, 5)}` : 'IDLE TX', meta: null };
  }

  private async makeRivals() {
    this.rivals = [];
    if (this.opts.mode === 'trial') return;
    const tr = this.tr;
    const { rivals, live } = pickRivals(this.opts.take, COUNT, TRACKS[this.opts.track].seed * 31 + (Date.now() % 1000));
    this.liveRivals = live;
    rivals.sort((a, b) => b.skill - a.skill);
    const mySlot = 5;
    let slot = 0;
    const total = this.laps * tr.len;
    for (const spec of rivals) {
      if (slot === mySlot) slot++;
      spec.slot = slot++;
      const team = teamOfKind(spec.kind);
      const hull = SHIPS[(spec.slot + 1) % 3];
      const meta = spec.token ? tokenMeta(spec.token) : null;
      const rig = buildShip(hull, { base: team.base, accent: team.accent, trim: team.trim, ticker: (spec.token ? `$${meta?.sym ?? spec.token.slice(0, 4)}` : 'TX').slice(0, 8), number: String(((spec.slot * 13 + 5) % 97) + 2), team: team.name, logo: meta?.icon ?? null }, team.accent === '#ffffff' ? team.base : team.accent);
      this.scene.add(rig.root);
      const label = this.makeLabel();
      rig.root.add(label.sprite);
      const s0 = GRID_S(spec.slot);
      const n = Math.ceil((total - s0) / STEP) + 2;
      const tt = new Float32Array(n);
      let t = 0;
      let vPrev = 0.5;
      for (let i = 1; i < n; i++) {
        const si = (((s0 + i * STEP) % tr.len) + tr.len) % tr.len;
        const lim = Math.min(210, tr.vlim[Math.floor(si / STEP) % tr.n] * spec.skill * RIVAL_SCALE);
        const v = Math.max(1, Math.min(lim, Math.sqrt(vPrev * vPrev + 2 * 42 * STEP)));
        t += STEP / ((v + vPrev) / 2);
        tt[i] = t;
        vPrev = v;
      }
      const run: RivalRun = {
        spec, team, rig, trail: this.opts.quality === 'low' ? null : new Trail(14, new THREE.Color(team.accent === '#ffffff' ? team.base : team.accent).multiplyScalar(2), 0.28),
        label: label.sprite, labelCanvas: label.canvas, labelTex: label.tex, labelKey: '',
        tt, s0, tc: 0, idx: 0, S: s0, lat: (spec.slot % 2 ? 1 : -1) * 6, lane: (spec.slot % 2 ? 1 : -1) * (4 + this.rng() * 5), phase: this.rng() * 6.28, stun: 0, spin: 0, finish: 0,
        weaponT: 10 + this.rng() * 18, done: false, v: 0,
      };
      if (run.trail) this.scene.add(run.trail.mesh);
      run.finish = tt[n - 1];
      this.drawLabel(run, true);
      this.rivals.push(run);
    }
  }

  private makeLabel() {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 112;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(0, 3.4, 0);
    sprite.scale.set(15, 4.4, 1);
    sprite.renderOrder = 5;
    return { sprite, tex, canvas };
  }

  private drawLabel(r: RivalRun, force = false) {
    const { main, meta } = this.labelText(r);
    const key = main + (meta?.icon?.complete ? '+i' : '');
    if (!force && key === r.labelKey) return;
    if (!force) r.rig.setLivery({ base: r.team.base, accent: r.team.accent, trim: r.team.trim, ticker: main.slice(0, 8), number: String(((r.spec.slot * 13 + 5) % 97) + 2), team: r.team.name, logo: meta?.icon ?? null });
    r.labelKey = key;
    const c = r.labelCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = r.team.base;
    g.fillRect(4, 4, c.width - 8, c.height - 8);
    // Chevron strip.
    g.fillStyle = r.team.accent;
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.moveTo(8 + i * 54, 8);
      g.lineTo(34 + i * 54, 8);
      g.lineTo(60 + i * 54, 24);
      g.lineTo(34 + i * 54, 40);
      g.lineTo(8 + i * 54, 40);
      g.lineTo(34 + i * 54, 24);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = '#000';
    g.lineWidth = 6;
    g.strokeRect(3, 3, c.width - 6, c.height - 6);
    let x = 18;
    const ic = meta?.icon;
    if (ic && ic.complete && ic.naturalWidth) {
      try {
        g.save();
        g.beginPath();
        g.arc(x + 26, 74, 26, 0, Math.PI * 2);
        g.clip();
        g.drawImage(ic, x, 48, 52, 52);
        g.restore();
        x += 62;
      } catch {
        /* tainted */
      }
    }
    g.fillStyle = r.team.trim === '#111111' || r.team.trim === '#101010' ? '#fff' : '#000';
    g.font = `900 52px ${FONTS.display}`;
    g.textBaseline = 'alphabetic';
    g.fillText(main.slice(0, 9), x, 90, c.width - x - 14);
    r.labelTex.needsUpdate = true;
  }

  // ───────────── Post ─────────────

  private buildComposer() {
    const r = this.renderer;
    this.composer?.dispose();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.fxLevel >= 2 ? 4 : 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    const bs = this.fxLevel >= 3 ? 1 : this.fxLevel === 2 ? 0.75 : 0.5;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bs, size.y * bs), this.fxLevel >= 3 ? 0.5 : 0.42, 0.6, 1.5);
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(w, h);
    if (this.grade) this.grade.uniforms.uAspect.value = w / h;
  }

  // ───────────── Control ─────────────

  private resetRace() {
    const sh = newShip(this.opts.mode === 'trial' ? GRID_S(0) : GRID_S(5));
    sh.lat = this.opts.mode === 'trial' ? 0 : 6;
    this.me = sh;
    this.raceT = 0;
    this.lapT = 0;
    this.lapTimes = [];
    this.lastLap = 0;
    this.lapSplits = [];
    this.sectorShown = -1;
    this.finishedMe = false;
    this.rivalHits = 0;
    this.cellTaken = [];
    this.weaponCool = this.tr.weapons.map(() => 0);
    this.shake = 0;
    this.pulse = 1;
    this.camLat = sh.lat;
    this.camH = 1;
    for (let i = 0; i < this.world.cells.count; i++) this.world.cells.setActive(i, true);
    for (let i = 0; i < this.tr.weapons.length; i++) this.world.weapons.setActive(i, true);
    for (const s of this.shots) this.scene.remove(s.mesh);
    for (const m of this.mines) this.scene.remove(m.mesh);
    this.shots = [];
    this.mines = [];
    for (const r of this.rivals) {
      r.tc = 0;
      r.idx = 0;
      r.S = r.s0;
      r.stun = 0;
      r.spin = 0;
      r.done = false;
      r.weaponT = 10 + this.rng() * 18;
    }
    frameAt(this.tr, sh.S, this.frame);
    this.qCam.setFromRotationMatrix(this.mTmp.makeBasis(this.v1.set(this.frame.rx, this.frame.ry, this.frame.rz), this.v2.set(this.frame.ux, this.frame.uy, this.frame.uz), this.v3.set(-this.frame.tx, -this.frame.ty, -this.frame.tz)));
    this.placeAll(0, true);
  }

  begin() {
    if (this.phase === 'loading') return;
    this.resetRace();
    this.countT = 0;
    this.lastCount = -1;
    this.setPhase('countdown');
  }
  pause(on: boolean) {
    if (on && this.phase === 'racing') {
      this.setPhase('paused');
      this.clock.stop();
    } else if (!on && this.phase === 'paused') {
      this.clock.start();
      this.setPhase('racing');
    }
  }
  async toMenu() {
    this.opts.cb.onCount(null);
    await this.refreshRivals();
    this.resetRace();
    this.setPhase('menu');
  }
  private async refreshRivals() {
    for (const r of this.rivals) this.removeRival(r);
    this.rivals = [];
    await this.makeRivals();
  }
  private removeRival(r: RivalRun) {
    this.scene.remove(r.rig.root);
    r.rig.dispose();
    r.labelTex.dispose();
    (r.label.material as THREE.Material).dispose();
    if (r.trail) {
      this.scene.remove(r.trail.mesh);
      r.trail.dispose();
    }
  }

  // ───────────── Main loop ─────────────

  private loop() {
    if (this.disposed) return;
    let dt = Math.min(0.05, this.clock.running ? this.clock.getDelta() : 0);
    if (!this.clock.running && this.phase === 'paused') dt = 0;
    this.perf(dt);
    this.time += dt;
    const { inp, edges } = this.input.read(this.opts.touchDevice);
    if (edges.start && this.phase === 'menu') this.opts.cb.onStartRequest?.();
    if (edges.pause && (this.phase === 'racing' || this.phase === 'paused')) this.pause(this.phase === 'racing');
    if (edges.cam) this.camMode = (this.camMode + 1) % 2;
    if (this.phase === 'countdown') {
      this.countT += dt;
      const n = 3 - Math.floor(this.countT / 0.9);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.opts.cb.onCount(Math.max(0, n));
        this.audio.fx(n > 0 ? 'beep' : 'go');
      }
      if (this.countT >= 2.7) {
        this.setPhase('racing');
        this.me.vs = 40;
        this.me.boostT = 1.2 + (inp.throttle > 0 ? 0.6 : 0);
        setTimeout(() => this.opts.cb.onCount(null), 700);
      }
    }
    const racing = this.phase === 'racing' || this.phase === 'finished';
    if (racing && this.phase !== 'paused') this.stepRace(dt, inp, edges.fire);
    else if (this.phase === 'menu' || this.phase === 'countdown') this.idleBob(dt);
    this.placeAll(dt, false);
    this.updateCamera(dt);
    this.updateFx(dt);
    this.world.update(dt, this.time, this.camera.position);
    if (Math.floor(this.time * 20) !== Math.floor((this.time - dt) * 20)) this.world.strobe(this.time);
    // Post uniforms.
    if (this.grade) {
      const u = this.grade.uniforms;
      const sp = Math.min(1, this.me.vs / (this.spec.vmax * 1.3));
      this.showSpeed += (sp - this.showSpeed) * Math.min(1, 6 * dt);
      u.uSpeed.value = Math.max(0, this.showSpeed - 0.35) * 1.3;
      this.boostFx += ((this.me.boostT > 0 ? 1 : 0) - this.boostFx) * Math.min(1, 5 * dt);
      u.uBoost.value = this.boostFx;
      this.hitFlash = Math.max(0, this.hitFlash - dt * 2.4);
      u.uHit.value = this.hitFlash;
      this.pulse = Math.min(1, this.pulse + dt * 1.6);
      u.uPulse.value = this.pulse;
      u.uTime.value = this.time % 100;
    }
    if (this.bloom) this.bloom.strength = (this.fxLevel >= 3 ? 0.42 : 0.36) + this.boostFx * 0.2;
    this.audio.update(this.showSpeed, this.me.boostT > 0, this.me.scrape > 0, racing || this.phase === 'countdown');
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    const now = performance.now();
    if ((this.phase === 'racing' || this.phase === 'countdown') && now - this.lastHud > 33) {
      this.lastHud = now;
      this.emitHud();
    }
    if (now - this.lastMap > 90) {
      this.lastMap = now;
      this.emitMap();
    }
    if (now - this.lastBoard > 280) {
      this.lastBoard = now;
      this.emitBoard();
      for (const r of this.rivals) if (r.spec.token) this.drawLabel(r);
    }
  }

  private idleBob(dt: number) {
    this.me.h = 1.3 + Math.sin(this.time * 2) * 0.12;
    this.menuAng += dt * 0.35;
  }

  private progressOf(sh: { S: number }) {
    return sh.S;
  }

  private stepRace(dt: number, inpRaw: SimInput, fire: boolean) {
    const tr = this.tr;
    const me = this.me;
    const total = this.laps * tr.len;
    const finished = this.finishedMe;
    let inp = inpRaw;
    if (this.autopilot && !finished) {
      inp = { ...noInput(), throttle: 1, steer: Math.max(-1, Math.min(1, -me.lat * 0.25 - me.vl * 0.12)) };
    }
    if (finished) {
      // Cool-down autopilot behind the results.
      inp = noInput();
      inp.throttle = 0.55;
      inp.steer = Math.max(-1, Math.min(1, -me.lat * 0.2 - me.vl * 0.1));
    }
    const wasBoost = me.boostT > 0;
    if (inp.boost && !finished && me.energy >= 0.2 && me.boostT < 0.5) {
      me.boostT = 1 + me.energy * 4;
      me.energy = 0;
      this.audio.fx('turbo');
      this.boostBurst(true);
    }
    stepShip(me, inp, this.spec, tr, dt, this.frame);
    const ev = me.ev;
    if (ev.pad) {
      this.pulse = 0;
      this.audio.fx('pad');
      this.boostBurst(false);
      this.opts.cb.onFlash?.('pad');
    }
    if (me.boostT > 0 && !wasBoost && !ev.pad) this.boostBurst(false);
    if (ev.wall > 0) {
      this.shake = Math.max(this.shake, Math.min(1, ev.wall * 0.06));
      this.audio.fx('wall');
    }
    if (ev.jump) this.audio.fx('jump');
    if (ev.land > 4) {
      this.shake = Math.max(this.shake, 0.4);
      this.audio.fx('land');
    }
    if (ev.roll) this.audio.fx('roll');
    if (ev.rollBoost) {
      this.toast('BARREL ROLL BOOST', 'good');
      this.boostBurst(false);
    }
    // Race clocks.
    if (!finished) {
      this.raceT += dt;
      if (me.S >= 0) this.lapT += dt;
      if (me.S >= 0) this.lapLogic(total);
    }
    // Pickups.
    this.pickups(fire && !finished);
    // Rivals.
    this.stepRivals(dt);
    this.stepWeapons(dt);
    // Wrong way: only if heading backwards (can't happen in track space), keep hook for HUD.
    this.wrong = 0;
  }

  private lapLogic(total: number) {
    const me = this.me;
    const tr = this.tr;
    const lapNo = Math.floor(me.S / tr.len);
    const inLap = me.S - lapNo * tr.len;
    // Sector splits: 3 per lap.
    const sec = Math.floor((inLap / tr.len) * 3);
    if (sec > 0 && sec !== this.sectorShown && lapNo < this.laps) {
      this.sectorShown = sec;
      this.lapSplits[sec - 1] = this.lapT;
      const best = this.bestSplits[sec - 1];
      if (best) {
        const d = this.lapT - best;
        this.toast(`SECTOR ${sec}  ${d <= 0 ? '' : '+'}${d.toFixed(2)}`, d <= 0 ? 'good' : 'bad');
      } else this.toast(`SECTOR ${sec}  ${fmt(this.lapT)}`, 'info');
    }
    if (lapNo > this.lapTimes.length) {
      const lt = this.lapT;
      this.lapTimes.push(lt);
      this.lapSplits[2] = lt;
      this.lapT = 0;
      this.sectorShown = 0;
      this.audio.fx('lap');
      const isBest = this.bestLap === null || lt < this.bestLap;
      if (isBest) {
        this.bestLap = lt;
        this.bestSplits = [...this.lapSplits.slice(0, 2), lt];
        this.writeBest(lt, this.bestSplits);
      }
      this.lapSplits = [];
      this.toast(`LAP ${lapNo}  ${fmt(lt)}${isBest ? '  BEST' : ''}`, isBest ? 'good' : 'info');
      if (lapNo < this.laps) this.toast(lapNo === this.laps - 1 ? 'FINAL LAP' : `LAP ${lapNo + 1}`, 'info');
    }
    if (me.S >= total && !this.finishedMe) this.finish();
  }

  private pickups(fire: boolean) {
    const tr = this.tr;
    const me = this.me;
    const len = tr.len;
    const s = ((me.S % len) + len) % len;
    // Energy cells.
    for (let i = 0; i < tr.cells.length; i++) {
      if (this.cellTaken.includes(i)) continue;
      const c = tr.cells[i];
      let d = s - c.s;
      if (d > len / 2) d -= len;
      if (d < -len / 2) d += len;
      if (Math.abs(d) < 4 && Math.abs(me.lat - c.lat) < 3.6 && me.h < 6) {
        this.cellTaken.push(i);
        this.world.cells.setActive(i, false);
        me.energy = Math.min(1, me.energy + 0.06);
        me.cells++;
        this.audio.fx('cell');
        setTimeout(() => {
          this.cellTaken = this.cellTaken.filter((x) => x !== i);
          if (!this.disposed) this.world.cells.setActive(i, true);
        }, 30000);
      }
    }
    // Weapon pads.
    for (let i = 0; i < tr.weapons.length; i++) {
      if (this.weaponCool[i] > this.time) continue;
      const w = tr.weapons[i];
      let d = s - w.s;
      if (d > len / 2) d -= len;
      if (d < -len / 2) d += len;
      if (Math.abs(d) < 4.5 && Math.abs(me.lat - w.lat) < 4 && me.h < 6 && !me.weapon) {
        this.weaponCool[i] = this.time + 7;
        this.world.weapons.setActive(i, false);
        setTimeout(() => !this.disposed && this.world.weapons.setActive(i, true), 7000);
        const bag: Weapon[] = ['rocket', 'rocket', 'rocket', 'mine', 'mine', 'shield', 'turbo', 'turbo', 'quake'];
        me.weapon = bag[Math.floor(this.rng() * bag.length)] ?? WEAPONS[0];
        me.ev.weapon = true;
        this.audio.fx('weapon');
        this.toast(`PICKUP: ${me.weapon.toUpperCase()}`, 'good');
      }
    }
    if (fire && me.weapon) this.fireWeapon(me.weapon);
  }

  private fireWeapon(w: Weapon) {
    const me = this.me;
    me.weapon = null;
    if (w === 'rocket') this.spawnShot('me', me.S + 5, me.lat, Math.max(me.vs, 100) + 150);
    else if (w === 'mine') this.spawnMine('me', me.S - 8, me.lat);
    else if (w === 'shield') {
      me.shieldT = 8;
      this.audio.fx('shield');
    } else if (w === 'turbo') {
      me.boostT = Math.max(me.boostT, 3.4);
      this.audio.fx('turbo');
      this.boostBurst(true);
      this.opts.cb.onFlash?.('boost');
    } else if (w === 'quake') {
      this.audio.fx('quake');
      this.shake = 1;
      this.opts.cb.onFlash?.('quake');
      frameAt(this.tr, me.S, this.frame2);
      this.spawnRing(this.v1.set(this.frame2.px, this.frame2.py, this.frame2.pz), this.frame2, '#ff7a2a', 120, 1.2);
      for (const r of this.rivals) {
        if (Math.abs(r.S - me.S) < 650) this.stunRival(r, 1.8, true);
      }
    }
  }

  private spawnShot(owner: 'me' | number, S: number, lat: number, v: number) {
    const mesh = new THREE.Mesh(this.shotGeo, this.shotMat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.shots.push({ owner, S, lat, v, life: 4, mesh });
    this.audio.fx('rocket');
  }
  private spawnMine(owner: 'me' | number, S: number, lat: number) {
    const mesh = new THREE.Mesh(this.mineGeo, this.mineMat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.mines.push({ owner, S, lat, t: 25, mesh });
    this.audio.fx('mine');
  }

  private stunRival(r: RivalRun, secs: number, quiet = false) {
    r.stun = Math.max(r.stun, secs);
    r.spin = 0;
    this.rivalHits++;
    this.explodeAt(r.S, r.lat, quiet ? 0.6 : 1);
    if (!quiet) this.toast(`HIT ${this.labelText(r).main}`, 'good');
  }

  private explodeAt(S: number, lat: number, k = 1) {
    frameAt(this.tr, S, this.frame2);
    const f = this.frame2;
    const hs = surfaceH(this.tr.pipe[f.i], lat);
    this.v4.set(f.px + f.rx * lat + f.ux * (hs + 1.4), f.py + f.ry * lat + f.uy * (hs + 1.4), f.pz + f.rz * lat + f.uz * (hs + 1.4));
    const col = new THREE.Color('#ffb040').multiplyScalar(2.5);
    for (let i = 0; i < 40 * k; i++) {
      this.v2.set(this.rng() - 0.5, this.rng() - 0.2, this.rng() - 0.5).normalize().multiplyScalar(10 + this.rng() * 30);
      this.v2.addScaledVector(this.v3.set(f.tx, f.ty, f.tz), 20);
      this.parts.emit(this.v4, this.v2, col, 0.5 + this.rng() * 0.6, 4);
    }
    this.spawnRing(this.v4, f, '#ffcf80', 14 * k, 0.5);
    this.audio.fx('boom');
  }

  private stepRivals(dt: number) {
    const me = this.me;
    const tr = this.tr;
    for (const r of this.rivals) {
      if (r.done) continue;
      r.stun = Math.max(0, r.stun - dt);
      // Gentle rubber band so the pack stays in the race.
      const gap = r.S - me.S;
      let rate = r.stun > 0 ? 0.18 : 1;
      if (r.stun <= 0) rate *= gap > 350 ? 0.975 : gap < -350 ? 1.04 : 1;
      r.tc += dt * rate;
      while (r.idx + 1 < r.tt.length && r.tt[r.idx + 1] <= r.tc) r.idx++;
      const f0 = r.tt[r.idx];
      const f1 = r.tt[Math.min(r.idx + 1, r.tt.length - 1)];
      const fr = f1 > f0 ? (r.tc - f0) / (f1 - f0) : 0;
      const nS = r.s0 + (r.idx + fr) * STEP;
      r.v = (nS - r.S) / Math.max(dt, 1e-4);
      r.S = nS;
      if (r.idx >= r.tt.length - 2) r.done = true;
      const bob = Math.sin(this.time * 0.9 + r.phase) * 3.2;
      const target = Math.max(-HALF_W + 3, Math.min(HALF_W - 3, r.lane + bob));
      r.lat += (target - r.lat) * Math.min(1, 2.2 * dt);
      if (r.stun > 0) r.spin += dt * 14;
      else r.spin *= 0.9;
      // Rival weapons (only in a live race).
      if (this.phase === 'racing' && r.stun <= 0) {
        r.weaponT -= dt;
        if (r.weaponT <= 0) {
          r.weaponT = 16 + this.rng() * 18;
          const idx = this.rivals.indexOf(r);
          const gapMe = me.S - r.S;
          if (gapMe > 12 && gapMe < 320 && Math.abs(me.lat - r.lat) < 18) this.spawnShot(idx, r.S + 6, r.lat, Math.max(r.v, 100) + 110);
          else if (gapMe < 0) this.spawnMine(idx, r.S - 10, r.lat);
        }
      }
    }
    void tr;
  }

  private stepWeapons(dt: number) {
    const me = this.me;
    // Shots.
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      const dir = 1;
      const spd = s.v;
      s.S += dir * spd * dt;
      // Home laterally.
      let tgt: { S: number; lat: number } | null = null;
      if (s.owner === 'me') {
        let best = 800;
        for (const r of this.rivals) {
          const d = r.S - s.S;
          if (d > -2 && d < best) {
            best = d;
            tgt = r;
          }
        }
      } else {
        const d = me.S - s.S;
        if (Math.abs(d) < 500) tgt = { S: me.S, lat: me.lat };
      }
      if (tgt) s.lat += Math.max(-24 * dt, Math.min(24 * dt, tgt.lat - s.lat));
      let hit = false;
      if (s.owner === 'me') {
        for (const r of this.rivals) {
          if (Math.abs(r.S - s.S) < 6 && Math.abs(r.lat - s.lat) < 4.5) {
            this.stunRival(r, 2.2);
            hit = true;
            break;
          }
        }
      } else if (Math.abs(me.S - s.S) < 6 && Math.abs(me.lat - s.lat) < 4.5 && me.h < 8) {
        this.hitPlayer();
        this.explodeAt(s.S, s.lat);
        hit = true;
      }
      if (hit || s.life <= 0) {
        this.scene.remove(s.mesh);
        this.shots.splice(i, 1);
        continue;
      }
      this.placeOnTrack(s.mesh, s.S, s.lat, 1.6, dir);
      s.mesh.rotateX(Math.PI / 2 * -dir);
      if (this.rng() < 0.7) {
        this.v1.copy(s.mesh.position);
        this.v2.set(0, 0, 0);
        this.parts.emit(this.v1, this.v2, this.tmpCol.set('#ffa030').multiplyScalar(2), 0.35, 0);
      }
    }
    // Mines.
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.t -= dt;
      let boom = false;
      if (m.t <= 0) boom = true;
      for (const r of this.rivals) {
        if (m.owner !== this.rivals.indexOf(r) && Math.abs(r.S - m.S) < 4 && Math.abs(r.lat - m.lat) < 3.6) {
          this.stunRival(r, 1.8);
          boom = true;
        }
      }
      if (m.owner !== 'me' && Math.abs(me.S - m.S) < 3.5 && Math.abs(me.lat - m.lat) < 3.4 && me.h < 4) {
        this.hitPlayer();
        boom = true;
      }
      if (boom) {
        this.explodeAt(m.S, m.lat);
        this.scene.remove(m.mesh);
        this.mines.splice(i, 1);
        continue;
      }
      this.placeOnTrack(m.mesh, m.S, m.lat, 1.3, 1);
      m.mesh.rotation.y = this.time * 2;
      const pulse = 1 + Math.sin(this.time * 8) * 0.15;
      m.mesh.scale.setScalar(pulse);
    }
  }
  private tmpCol = new THREE.Color();
  /** Dev/test hook: steer to the centre line. */
  autopilot = false;

  private hitPlayer() {
    const me = this.me;
    if (me.shieldT > 0) {
      me.shieldT = 0;
      this.toast('SHIELD ABSORBED', 'good');
      this.audio.fx('shield');
      return;
    }
    me.stunT = 1.1;
    me.hits++;
    me.vs *= 0.55;
    this.shake = 1;
    this.hitFlash = 1;
    this.audio.fx('hit');
    this.opts.cb.onFlash?.('hit');
    this.toast('HIT!', 'bad');
  }

  private placeOnTrack(m: THREE.Object3D, S: number, lat: number, h: number, dir: number) {
    const f = frameAt(this.tr, S, this.frame2);
    const hs = surfaceH(this.tr.pipe[f.i], lat) + h;
    m.position.set(f.px + f.rx * lat + f.ux * hs, f.py + f.ry * lat + f.uy * hs, f.pz + f.rz * lat + f.uz * hs);
    this.mTmp.makeBasis(this.v1.set(-f.rx, -f.ry, -f.rz), this.v2.set(f.ux, f.uy, f.uz), this.v3.set(f.tx * dir, f.ty * dir, f.tz * dir));
    m.quaternion.setFromRotationMatrix(this.mTmp);
  }

  private finish() {
    this.finishedMe = true;
    const me = this.me;
    const total = this.raceT;
    const trial = this.opts.mode === 'trial';
    const board: BoardRow[] = this.rivals.map((r) => {
      const left = Math.max(0, r.tt[r.tt.length - 1] - r.tc);
      const t = (r.done ? this.raceT : this.raceT + left) - 0;
      return { name: this.labelText(r).main, sub: r.spec.detail, time: r.done ? Math.min(t, this.raceT + 0.01) : t, me: false, tx: r.spec.tx, color: r.team.base, logo: tokenMeta(r.spec.token ?? '')?.iconSrc ?? null };
    });
    board.push({ name: 'YOU', sub: this.team.name, time: total, me: true, tx: null, color: this.team.base, logo: null });
    board.sort((a, b) => a.time - b.time);
    const pos = trial ? 1 : board.findIndex((b) => b.me) + 1;
    const par = this.tr.tIdeal[this.tr.n - 1] * this.laps * 1.06;
    const timePts = Math.max(0, Math.min(3000, Math.round(3000 - (total - par) * 40))) * (trial ? 2 : 1);
    const place = trial ? 0 : POINTS[Math.min(7, pos - 1)] ?? 0;
    const cells = Math.min(40, me.cells) * 50;
    const clean = Math.max(0, 500 - me.hits * 50);
    const combat = Math.min(1000, this.rivalHits * 150);
    const score = timePts + place + cells + clean + combat;
    const r: Result = { track: this.opts.track, ship: this.spec.id, mode: this.opts.mode, pos, total_cars: trial ? 1 : board.length, total, laps: this.lapTimes.slice(), bestLap: Math.min(...this.lapTimes, 9999), hits: me.hits, cells: me.cells, rivalHits: this.rivalHits, parts: { time: timePts, place, cells, clean, combat }, score, board };
    this.audio.fx('win');
    this.setPhase('finished');
    this.opts.cb.onFinish(r);
    this.opts.cb.onHud({ kmh: 0, speed01: 0, lap: this.laps, laps: this.laps, pos, total: board.length, lapTime: 0, time: total, energy: 0, boosting: false, weapon: null, shield: false, progress: 1, air: false, wrongWay: false, best: this.bestLap });
  }

  // ───────────── Placement and camera ─────────────

  private placeShip(rig: Rig, S: number, lat: number, h: number, yaw: number, pitch: number, roll: number, out: THREE.Vector3) {
    const f = frameAt(this.tr, S, this.frame2);
    const hs = surfaceH(this.tr.pipe[f.i], lat);
    out.set(f.px + f.rx * lat + f.ux * (hs + h), f.py + f.ry * lat + f.uy * (hs + h), f.pz + f.rz * lat + f.uz * (hs + h));
    rig.root.position.copy(out);
    this.mTmp.makeBasis(this.v1.set(-f.rx, -f.ry, -f.rz), this.v2.set(f.ux, f.uy, f.uz), this.v3.set(f.tx, f.ty, f.tz));
    rig.root.quaternion.setFromRotationMatrix(this.mTmp);
    this.qTmp.setFromAxisAngle(this.v1.set(0, 1, 0), -yaw);
    this.qTmp2.setFromAxisAngle(this.v1.set(1, 0, 0), -pitch);
    this.qTmp.multiply(this.qTmp2);
    this.qTmp2.setFromAxisAngle(this.v1.set(0, 0, 1), -roll);
    this.qTmp.multiply(this.qTmp2);
    rig.tilt.quaternion.copy(this.qTmp);
  }

  private placeAll(dt: number, snap: boolean) {
    const me = this.me;
    const tr = this.tr;
    const pr = this.playerRig;
    this.placeShip(pr, me.S, me.lat, me.h, me.yaw, me.pitch, me.rollVis, this.shipPos);
    const thrust = this.phase === 'menu' ? 0.3 : Math.min(1, me.vs / this.spec.vmax);
    const boosting = me.boostT > 0;
    pr.flame.scale.set(1, 1, 0.3 + thrust * 0.6 + (boosting ? 0.9 : 0) + Math.random() * 0.1);
    pr.flameMat.opacity = 0.55 + thrust * 0.4;
    pr.shield.visible = me.shieldT > 0;
    this.under.position.copy(this.shipPos).addScaledVector(this.v2.set(this.frame2.ux, this.frame2.uy, this.frame2.uz), -1.2);
    this.under.intensity = 14 + thrust * 12 + (boosting ? 16 : 0);
    // Trails from both engines.
    if (this.trailL && this.trailR) {
      const e = pr.engine;
      this.v3.copy(e[0]).applyQuaternion(pr.tilt.quaternion).applyQuaternion(pr.root.quaternion).add(pr.root.position);
      this.v4.set(this.frame2.rx, this.frame2.ry, this.frame2.rz);
      if (snap) this.trailL.reset(this.v3);
      this.trailL.push(this.v3, this.v4, this.phase === 'racing' || this.phase === 'finished' ? 0.25 + thrust * 0.45 + (boosting ? 0.6 : 0) : 0.1);
      this.v3.copy(e[1]).applyQuaternion(pr.tilt.quaternion).applyQuaternion(pr.root.quaternion).add(pr.root.position);
      if (snap) this.trailR.reset(this.v3);
      this.trailR.push(this.v3, this.v4, this.phase === 'racing' || this.phase === 'finished' ? 0.25 + thrust * 0.45 + (boosting ? 0.6 : 0) : 0.1);
    }
    // Rivals.
    for (const r of this.rivals) {
      const rl = (r.lane - r.lat) * 0.06 + Math.sin(this.time * 0.9 + r.phase) * 0.12;
      this.placeShip(r.rig, r.S, r.lat, 1.3 + Math.sin(this.time * 2.3 + r.phase) * 0.12 + (r.stun > 0 ? Math.sin(this.time * 20) * 0.3 : 0), -rl * 0.6, 0, rl + r.spin, this.v3);
      const th = r.v > 0 ? Math.min(1, r.v / 190) : 0.3;
      r.rig.flame.scale.set(1, 1, 0.3 + th * 0.6 + Math.random() * 0.1);
      if (r.trail) {
        const e = r.rig.engine;
        this.v3.copy(e[0]).add(this.v4.copy(e[1])).multiplyScalar(0.5).applyQuaternion(r.rig.tilt.quaternion).applyQuaternion(r.rig.root.quaternion).add(r.rig.root.position);
        this.v4.set(this.frame2.rx, this.frame2.ry, this.frame2.rz);
        if (snap) r.trail.reset(this.v3);
        r.trail.push(this.v3, this.v4, this.phase === 'racing' ? 0.5 + th : 0.1);
      }
      // Label fade with distance.
      const d = r.rig.root.position.distanceTo(this.camera.position);
      const lw = Math.max(4.5, Math.min(24, d * 0.05));
      r.label.scale.set(lw, lw * 0.293, 1);
      r.label.position.y = 2.6 + lw * 0.12;
      (r.label.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, (520 - d) / 200)) * (r.S > me.S - 5 || d < 160 ? 1 : 0.85);
      r.label.visible = d < 520 && d > 6;
    }
    void dt;
    void tr;
  }

  private updateCamera(dt: number) {
    const me = this.me;
    const tr = this.tr;
    const f = frameAt(tr, me.S, this.frame);
    const cam = this.camera;
    const sp = Math.min(1, me.vs / (this.spec.vmax * 1.3));
    const boosting = me.boostT > 0;
    // Smoothed track basis.
    this.mTmp.makeBasis(this.v1.set(f.rx, f.ry, f.rz), this.v2.set(f.ux, f.uy, f.uz), this.v3.set(-f.tx, -f.ty, -f.tz));
    this.qTmp.setFromRotationMatrix(this.mTmp);
    const k = 1 - Math.exp(-8 * dt);
    this.qCam.slerp(this.qTmp, dt === 0 ? 0 : k);
    const hs = surfaceH(tr.pipe[f.i], me.lat);
    this.camLat += (me.lat - this.camLat) * Math.min(1, 6 * dt);
    this.camH += (me.h - this.camH) * Math.min(1, 5 * dt);
    const hsC = surfaceH(tr.pipe[f.i], this.camLat);
    this.v4.set(f.px + f.rx * this.camLat + f.ux * (hsC + this.camH), f.py + f.ry * this.camLat + f.uy * (hsC + this.camH), f.pz + f.rz * this.camLat + f.uz * (hsC + this.camH));
    void hs;
    if (this.phase === 'menu') {
      // Showcase orbit around the grid ship.
      const a = this.menuAng;
      this.v1.set(f.rx, f.ry, f.rz);
      this.v2.set(f.ux, f.uy, f.uz);
      this.v3.set(f.tx, f.ty, f.tz);
      cam.position.copy(this.shipPos).addScaledVector(this.v3, -Math.cos(a) * 11 - 2).addScaledVector(this.v1, Math.sin(a) * 11).addScaledVector(this.v2, 3.2 + Math.sin(a * 0.7) * 1.2);
      cam.up.copy(this.v2);
      cam.lookAt(this.v4.copy(this.shipPos).addScaledVector(this.v3, 3));
      this.fov += (52 - this.fov) * Math.min(1, 4 * dt);
    } else {
      const dist = this.camMode === 0 ? 7.6 : 12;
      const height = this.camMode === 0 ? 3.0 : 4.8;
      this.v1.set(0, height, dist).applyQuaternion(this.qCam);
      cam.position.copy(this.v4).add(this.v1);
      this.qTmp2.setFromAxisAngle(this.v2.set(1, 0, 0), -0.17 - (this.camMode ? 0.05 : 0));
      cam.quaternion.copy(this.qCam).multiply(this.qTmp2);
      const asp = cam.aspect;
      const base = asp < 1 ? 92 : 74;
      const want = base + sp * 14 + (boosting ? 12 : 0) + Math.max(0, sp - 0.85) * 20;
      this.fov += (want - this.fov) * Math.min(1, 5 * dt);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * 0.5;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    const tremor = (boosting ? 0.06 : 0) + Math.max(0, sp - 0.7) * 0.08;
    if (tremor > 0 && this.phase === 'racing') {
      cam.position.x += (Math.random() - 0.5) * tremor;
      cam.position.y += (Math.random() - 0.5) * tremor;
    }
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    // Move the light with the player.
    this.moon.position.copy(this.shipPos).add(this.v2.set(-50, 70, 80));
    this.moon.target.position.copy(this.shipPos);
    this.moon.target.updateMatrixWorld();
    this.lines.update(this.distAcc(me.vs * dt), sp);
  }
  private distAcc(d: number) {
    this.travelled += d;
    return this.travelled;
  }
  private travelled = 0;

  // ───────────── FX ─────────────

  private spawnRing(pos: THREE.Vector3, f: Frame, color: string, max: number, dur: number) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.max = max;
    r.mat.color.set(color).multiplyScalar(2.2);
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    this.mTmp.makeBasis(this.v1.set(f.rx, f.ry, f.rz), this.v2.set(f.ux, f.uy, f.uz), this.v3.set(f.tx, f.ty, f.tz));
    r.mesh.quaternion.setFromRotationMatrix(this.mTmp);
    r.mesh.scale.setScalar(0.1);
  }

  private boostBurst(big: boolean) {
    const f = frameAt(this.tr, this.me.S, this.frame2);
    this.v4.copy(this.shipPos).addScaledVector(this.v1.set(f.tx, f.ty, f.tz), 6);
    // Sonic-boom ring facing the direction of travel.
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.t = 0;
    r.dur = big ? 0.8 : 0.55;
    r.max = big ? 46 : 32;
    r.mat.color.set(this.tr.def.palette.a1).lerp(new THREE.Color('#ffffff'), 0.4).multiplyScalar(2.6);
    r.mesh.visible = true;
    r.mesh.position.copy(this.v4);
    this.mTmp.makeBasis(this.v1.set(f.rx, f.ry, f.rz), this.v2.set(f.ux, f.uy, f.uz), this.v3.set(f.tx, f.ty, f.tz));
    // Ring normal (local +Z) along the travel direction.
    r.mesh.quaternion.setFromRotationMatrix(this.mTmp);
    r.mesh.scale.setScalar(0.1);
    this.boostFx = 1;
    this.shake = Math.max(this.shake, big ? 0.7 : 0.35);
    for (let i = 0; i < 26; i++) {
      this.v2.set(this.rng() - 0.5, this.rng() - 0.5, -0.5 - this.rng()).normalize().multiplyScalar(30 + this.rng() * 40);
      this.v1.set(f.rx, f.ry, f.rz);
      this.v3.set(f.tx, f.ty, f.tz);
      this.v2.set(this.v1.x * (this.rng() - 0.5) * 30 + this.v3.x * -40, this.v1.y * (this.rng() - 0.5) * 30 + this.v3.y * -40 + (this.rng() - 0.5) * 20, this.v1.z * (this.rng() - 0.5) * 30 + this.v3.z * -40);
      this.parts.emit(this.shipPos, this.v2, this.tmpCol.set(this.tr.def.palette.a1).multiplyScalar(2.4), 0.5, 0);
    }
  }

  private updateFx(dt: number) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(0.1 + (r.max - 0.1) * (1 - Math.pow(1 - k, 2.5)));
      r.mat.opacity = (1 - k) * 0.9;
    }
    // Sparks when scraping, exhaust sparkle at speed.
    const me = this.me;
    if (me.scrape > 0 && this.phase === 'racing') {
      this.scrapeAcc += dt * 60;
      while (this.scrapeAcc > 1) {
        this.scrapeAcc--;
        const f = this.frame2;
        this.v2.set(f.rx * (this.rng() - 0.5) * 8 + f.ux * this.rng() * 10, f.ry * (this.rng() - 0.5) * 8 + f.uy * this.rng() * 10, f.rz * (this.rng() - 0.5) * 8 + f.uz * this.rng() * 10);
        this.v2.addScaledVector(this.v3.set(f.tx, f.ty, f.tz), -me.vs * 0.4);
        this.parts.emit(this.shipPos, this.v2, this.tmpCol.set('#ffd070').multiplyScalar(2.2), 0.4, 20);
      }
    }
    this.parts.update(dt);
  }

  // ───────────── HUD ─────────────

  private position() {
    let ahead = 0;
    for (const r of this.rivals) if (r.S > this.me.S + 0.5) ahead++;
    return 1 + ahead;
  }
  private emitHud() {
    const me = this.me;
    const tr = this.tr;
    const pos = this.position();
    this.lastPos = pos;
    const lapNo = Math.max(0, Math.min(this.laps, Math.floor(me.S / tr.len) + 1));
    this.opts.cb.onHud({
      kmh: me.vs * 3.6 * 1.1,
      speed01: Math.min(1, me.vs / (this.spec.vmax * 1.3)),
      lap: Math.max(1, lapNo),
      laps: this.laps,
      pos,
      total: this.rivals.length + 1,
      lapTime: this.lapT,
      time: this.raceT,
      energy: me.energy,
      boosting: me.boostT > 0,
      weapon: me.weapon,
      shield: me.shieldT > 0,
      progress: Math.max(0, Math.min(1, me.S / (this.laps * tr.len))),
      air: me.air,
      wrongWay: false,
      best: this.bestLap,
    });
  }
  private emitMap() {
    const me = this.me;
    const f = frameAt(this.tr, me.S, this.frame2);
    this.opts.cb.onMap({
      px: f.px + f.rx * me.lat,
      pz: f.pz + f.rz * me.lat,
      yaw: Math.atan2(f.tx, f.tz),
      rivals: this.rivals.map((r) => {
        const g = frameAt(this.tr, r.S, this.frame2);
        return { x: g.px + g.rx * r.lat, z: g.pz + g.rz * r.lat, c: r.team.base === '#101015' ? r.team.accent : r.team.base };
      }),
    });
  }
  private emitBoard() {
    const rows: { S: number; row: LiveRow }[] = this.rivals.map((r) => ({ S: r.S, row: { name: this.labelText(r).main, color: r.team.base, me: false, logo: tokenMeta(r.spec.token ?? '')?.iconSrc ?? null } }));
    rows.push({ S: this.me.S, row: { name: 'YOU', color: this.team.base, me: true, logo: null } });
    rows.sort((a, b) => b.S - a.S);
    this.opts.cb.onBoard(rows.map((x) => x.row));
  }

  private toast(text: string, tone: Toast['tone']) {
    this.opts.cb.onToast({ text, tone });
  }

  // ───────────── Adaptive quality ─────────────

  private perf(dt: number) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (this.phase === 'loading') return;
    this.perfCool -= dt;
    this.perfT += dt;
    if (this.perfCool <= 0) {
      if (this.frameMs > 24) this.lowFrames++;
      else this.lowFrames = Math.max(0, this.lowFrames - 1);
      if (this.lowFrames > 70) {
        this.lowFrames = 0;
        this.perfCool = 3;
        this.degrade();
      }
    }
    if (this.perfT > 2) {
      this.perfT = 0;
      this.opts.cb.onPerf?.({ fps: Math.round(1000 / Math.max(1, this.frameMs)), level: this.fxLevel });
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

  // ───────────── Teardown ─────────────

  dispose() {
    this.disposed = true;
    this.input.detach();
    this.audio.stop();
    document.removeEventListener('visibilitychange', this.visHandler);
    this.ro?.disconnect();
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.composer?.dispose();
      for (const r of this.rivals) this.removeRival(r);
      this.playerRig?.dispose();
      this.trailL?.dispose();
      this.trailR?.dispose();
      this.lines?.dispose();
      this.parts?.dispose();
      this.world?.dispose();
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose?.();
      });
      this.envTex?.dispose();
      this.pmrem?.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
    }
  }
}

export const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
export { SHIPS, TRACKS, TEAMS };
