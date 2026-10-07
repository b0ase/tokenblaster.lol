/**
 * Token Rally engine: renderer, post, cars, rivals, race logic. React only drives the menu/HUD
 * overlays through callbacks; everything per-frame lives here (no setState in the loop).
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { readWire, verifyWire } from '@/lib/identity';
import { disposeAvatarTag, fitAvatarTag, makeAvatarTag } from '@/lib/avatarTag';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { FeedTx } from '@/lib/feed';
import { KINDS } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';
import { sfx } from '@/lib/sfx';
import { RallyAudio } from './audio';
import { CarFactory, WHEEL_VIS_R, WHEEL_X, WHEEL_Z, type CarRig, type Livery } from './carBuild';
import { newCar, stepCar, WHEELS, type CarInput, type CarState, type CarWorld } from './car';
import { Input, type Touch } from './input';
import { SnapshotBuffer } from '@/lib/racemp/buffer';
import type { RaceLink } from '@/lib/racemp/session';
import { driverColour, FL_DONE, FL_DRY, FL_NITRO, RALLY_CHANNELS, RALLY_VCAP, type RallyCfg } from './mp';
import { clamp, lerp, rng, smooth } from './noise';
import { detailOf, pickRivals, RIVAL_PAINT, SPONSORS, type RivalSpec } from './rivals';
import { CARS, STAGES, type CarSpec, type StageId } from './stages';
import { buildTrack, groundY, nearest, pointAt, roadY, STEP, type Near, type Track } from './track';
import {
  buildScenery,
  buildTerrain,
  gate,
  loadTerrainTextures,
  Particles,
  sceneryMaterials,
  Skids,
  Snow,
  terrainMaterial,
  type Obstacles,
  type Quality,
} from './world';

import type { SpendKind } from './spend';
import { DRIFT_PTS, FUEL_M, NITRO_TICK_S } from './spend';

export type Phase = 'loading' | 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';
export type Hud = {
  kmh: number;
  gear: number;
  rpm: number;
  nitro: number;
  nitroOn: boolean;
  time: number;
  pos: number;
  total: number;
  progress: number;
  drift: number;
  penalty: number;
  delta: number | null;
  deltaName: string;
  air: boolean;
  drifting: boolean;
  wrongWay: boolean;
};
export type Toast = { text: string; tone: 'good' | 'bad' | 'info' };
export type BoardRow = { name: string; sub: string; time: number; me: boolean; tx: string | null; color: string };
export type Result = {
  stage: StageId;
  car: string;
  raw: number;
  penalty: number;
  total: number;
  splits: number[];
  pos: number;
  total_cars: number;
  board: BoardRow[];
  drift: number;
  score: number;
  parts: { time: number; beat: number; drift: number };
  par: number;
  hits: number;
  resets: number;
  live: number;
};
export type MapData = { px: number; pz: number; yaw: number; rivals: { x: number; z: number; c: string }[]; coins: { x: number; z: number }[] };

export type Callbacks = {
  onPhase(p: Phase): void;
  onCount(n: number | null): void;
  onHud(h: Hud): void;
  onToast(t: Toast): void;
  onLoading(msg: string, pct: number): void;
  onFinish(r: Result): void;
  onMap(m: MapData): void;
  onStartRequest?(): void;
  /** LIVE races only: something the car just burned (the shell turns it into one real transaction). */
  onSpend?(kind: SpendKind, tag: string): void;
  onPerf?(info: { fps: number; level: number; dpr: number }): void;
};

export type Options = {
  stage: StageId;
  car: string;
  quality: Quality;
  take: (pred?: (f: FeedTx) => boolean) => FeedTx | null;
  cb: Callbacks;
  /** Default render scale ceiling. */
  maxDpr?: number;
  /** Room link (src/lib/racemp), set by the shell while the pilot is in a room. */
  mp?: RaceLink<RallyCfg>;
};

/** Another human's car: played back ~130 ms in the past from a snapshot buffer (src/lib/racemp/buffer.ts). */
type RemoteRun = {
  id: string;
  name: string;
  colour: string;
  rig: CarRig;
  label: THREE.Sprite;
  labelTex: THREE.CanvasTexture;
  /** X avatar billboard when the driver set a handle (hidden from GTAO with the other sprites). */
  avatar: THREE.Sprite | null;
  buf: SnapshotBuffer;
  spot: number;
  s: number;
  v: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  spin: number;
  fl: number;
  gone: boolean;
  placed: boolean;
};

type RivalRun = {
  spec: RivalSpec;
  root: THREE.Group;
  rig: CarRig;
  label: THREE.Sprite;
  labelTex: THREE.CanvasTexture;
  labelCanvas: HTMLCanvasElement;
  labelKey: string;
  tt: Float32Array;
  s0: number;
  delay: number;
  lane: number;
  phase: number;
  s: number;
  v: number;
  spin: number;
  finish: number;
  lat: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  bump: number;
  dustAcc: number;
  vPrev: number;
};

type Coin = { group: THREE.Group; beam: THREE.Mesh; mat: THREE.MeshStandardMaterial; active: boolean; s: number; lat: number; x: number; z: number; y: number; t: number; kind: string };

const TMP = new THREE.Vector3();
const COUNT = 7; // rivals
const START_S = 46;
/** Grid slots relative to the player (metres along the road): the fastest rivals start ahead, the rest behind. */
const GRID = [34, 22, 11, -9, -18, -27, -36];

/** Human grid spots in a room: two lanes, rows 8 m apart behind the line. AI cars start ahead of them. */
const spotPos = (i: number) => ({ off: -Math.floor(i / 2) * 8, lat: i % 2 === 0 ? -2.4 : 2.4 });

const angDiff = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDirt: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uNitro: { value: 0 },
    uHit: { value: 0 },
    uTime: { value: 0 },
    uSunUv: { value: new THREE.Vector2(0.5, 0.8) },
    uSunOn: { value: 0 },
    uRays: { value: 1 },
    uShadow: { value: new THREE.Vector3(1, 1, 1) },
    uHigh: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1.1 },
    uCon: { value: 1.05 },
    uRayCol: { value: new THREE.Vector3(1, 0.85, 0.6) },
    uAspect: { value: 1.6 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDirt; uniform float uSpeed; uniform float uNitro; uniform float uHit; uniform float uTime;
    uniform vec2 uSunUv; uniform float uSunOn; uniform float uRays; uniform vec3 uShadow; uniform vec3 uHigh; uniform float uSat; uniform float uCon; uniform vec3 uRayCol; uniform float uAspect;
    varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main(){
      vec2 d = vUv - 0.5;
      float r = length(d);
      float blur = (uSpeed * 0.05 + uNitro * 0.06) * smoothstep(0.1, 0.7, r);
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 9; i++) {
        float k = float(i) / 8.0;
        vec2 o = d * (1.0 - blur * k);
        float w = 1.0 - k * 0.5;
        float ca = (uSpeed * 0.003 + uHit * 0.004 + uNitro * 0.003) * r * (0.4 + k);
        vec2 nd = normalize(d + 1e-5);
        col += vec3(texture2D(tDiffuse, o + 0.5 + nd * ca).r, texture2D(tDiffuse, o + 0.5).g, texture2D(tDiffuse, o + 0.5 - nd * ca).b) * w;
        wsum += w;
      }
      col /= wsum;
      // Sun: god rays through the trees, a warm bloom around it, ghosts and an anamorphic streak (dirty lens).
      float occ = smoothstep(2.0, 7.0, lum(texture2D(tDiffuse, clamp(uSunUv, 0.01, 0.99)).rgb)) * uSunOn;
      if (uSunOn > 0.0 && uRays > 0.0) {
        vec2 sd = (uSunUv - vUv);
        float rays = 0.0;
        for (int i = 0; i < 20; i++) {
          float k = float(i) / 20.0;
          vec3 sm = texture2D(tDiffuse, vUv + sd * k * 0.92).rgb;
          rays += smoothstep(1.6, 6.0, lum(sm)) * (1.0 - k);
        }
        rays /= 20.0;
        float sdist = length((vUv - uSunUv) * vec2(uAspect, 1.0));
        col += uRayCol * rays * 0.9 * uRays * uSunOn;
        col += uRayCol * exp(-sdist * 3.2) * 0.1 * uSunOn * uRays;
        float flare = 0.0;
        vec2 toC = vec2(0.5) - uSunUv;
        for (int g = 1; g <= 4; g++) {
          vec2 gp = uSunUv + toC * (float(g) * 0.5);
          float dd = length((vUv - gp) * vec2(uAspect, 1.0));
          float rad = 0.025 + 0.02 * float(g);
          flare += smoothstep(rad, rad * 0.55, dd) * (0.07 / float(g)) + smoothstep(rad * 1.25, rad, dd) * smoothstep(rad * 0.85, rad, dd) * 0.05;
        }
        float streak = exp(-abs(vUv.y - uSunUv.y) * 90.0) * exp(-abs(vUv.x - uSunUv.x) * 3.0) * 0.18;
        vec3 dirt = texture2D(tDirt, vUv * vec2(uAspect * 0.7, 1.0)).rgb;
        col += (vec3(1.0, 0.72, 0.45) * flare + vec3(0.5, 0.65, 1.0) * streak) * occ * uRays * (1.0 + dirt * 4.0);
        col += uRayCol * dirt * exp(-sdist * 2.2) * 0.12 * occ * uRays;
      }
      float l = lum(col);
      col = mix(vec3(l), col, uSat);
      col *= mix(uShadow, vec3(1.0), smoothstep(0.0, 0.4, l));
      col *= mix(vec3(1.0), uHigh, smoothstep(0.5, 2.0, l));
      col = (col - 0.18) * uCon + 0.18;
      float vig = smoothstep(1.05, 0.28, r * (1.0 + uSpeed * 0.35));
      col *= mix(1.0, vig, 0.42 + uSpeed * 0.2);
      col = mix(col, col * vec3(1.35, 0.55, 0.5), uHit * smoothstep(0.2, 0.8, r));
      col += (rnd(vUv * 900.0) - 0.5) * 0.012;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

function lensDirt() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 256);
  const R = rng(77);
  for (let i = 0; i < 70; i++) {
    const x = R() * 512;
    const y = R() * 256;
    const r = 3 + R() * R() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.1 + R() * 0.5;
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class RallyEngine {
  readonly opts: Options;
  readonly stage = STAGES.forest;
  track!: Track;
  phase: Phase = 'loading';
  quality: Quality;
  private disposed = false;
  private el: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.3, 700);
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private sun!: THREE.DirectionalLight;
  private csm: CSM | null = null;
  private csmDone = new WeakSet<THREE.Material>();
  private bokeh: BokehPass | null = null;
  private dirtTex: THREE.Texture | null = null;
  private sunDir = new THREE.Vector3(0.4, 0.7, 0.3).normalize();
  private pmrem!: THREE.PMREMGenerator;
  private disposables: { dispose(): void }[] = [];
  private input = new Input();
  private audio = new RallyAudio();
  private skids!: Skids;
  private parts!: Particles;
  private snow: Snow | null = null;
  private obstacles!: Obstacles;
  private sceneryUpdate: ((x: number, z: number, t: number) => void) | null = null;
  private carSpec: CarSpec;
  private factory!: CarFactory;
  private player!: CarRig;
  private car: CarState = newCar();
  private near: Near = { i: 0, s: 0, lat: 0, dist: 0 };
  private rivals: RivalRun[] = [];
  private liveRivals = 0;
  private coins: Coin[] = [];
  private coinGeo: THREE.BufferGeometry[] = [];
  private cps: { s: number; label: string; time: number | null; gateObj: THREE.Object3D }[] = [];
  private finishS = 0;
  private par = 100;
  private raceT = 0;
  private penalty = 0;
  private hits = 0;
  private resets = 0;
  private lastHitAt = -10;
  private lastCpS = 0;
  private lastCpSrc = START_S;
  private countT = 0;
  private lastCount = -1;
  private acc = 0;
  private frameMs = 16;
  private lowFrames = 0;
  private perfCool = 0;
  private fxLevel = 3;
  private dpr = 1;
  private maxDpr: number;
  private hudT = 0;
  private mapT = 0;
  private coinT = 0;
  private perfT = 0;
  private wrongT = 0;
  private autopilot = false;
  private camMode = 0;
  private camYaw = 0;
  private camY = 0;
  private camShake = 0;
  private fov = 62;
  private time = 0;
  private orbit = 2.6;
  private finishAt = 0;
  private result: Result | null = null;
  private ro: ResizeObserver | null = null;
  private lastThrottle = 0;
  private dustColor = new THREE.Color();
  private tmpC = new THREE.Color();
  private rng = rng(Date.now() & 0xffff);
  private hdrSky: THREE.Texture | null = null;
  private horizon = new THREE.Color('#aab8c6');
  private driftShown = 0;
  private remotes: RemoteRun[] = [];
  /** My grid spot while racing in a room (spots 0..7: two lanes, rows behind the line). */
  private mySpot = -1;
  private mpMaxS = 0;
  private lastSend = 0;
  private greenAtMs = 0;
  private mpSetup = false;
  /** LIVE race economy, driven by the shell: `live` turns spend events on, `dry` cuts the throttle and nitro (coasting). */
  econ = { live: false, dry: false };
  private fuelM = 0;
  private nitroT = 0;
  private nitroPrev = false;
  private driftPaid = 0;
  private visHandler = () => {
    if (document.hidden && this.phase === 'racing') this.pause(true);
  };

  constructor(el: HTMLElement, opts: Options) {
    this.el = el;
    this.opts = opts;
    this.quality = opts.quality;
    this.maxDpr = opts.maxDpr ?? (opts.quality === 'ultra' ? 2 : opts.quality === 'high' ? 1.75 : 1.1);
    this.carSpec = CARS.find((c) => c.id === opts.car) ?? CARS[0];
    this.stage = STAGES[opts.stage];
  }

  get touch(): Touch {
    return this.input.touch;
  }
  rivalList() {
    return this.rivals.map((r) => ({ name: this.labelText(r).main, detail: r.spec.detail, color: r.spec.color, live: r.spec.live, tx: r.spec.tx, skill: r.spec.skill, kind: r.spec.kind }));
  }
  get padActive() {
    return this.input.padActive;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.input.capture = p === 'countdown' || p === 'racing' || p === 'paused';
    this.opts.cb.onPhase(p);
  }

  // ───────────── Loading ─────────────

  async init() {
    const { cb } = this.opts;
    const st = this.stage;
    cb.onLoading('Setting up renderer', 0.02);
    const hi = this.quality !== 'low';
    const renderer = new THREE.WebGLRenderer({ antialias: !hi, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    renderer.setPixelRatio(this.dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = st.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    this.el.appendChild(renderer.domElement);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.fxLevel = hi ? 3 : 1;

    cb.onLoading('Laying out the stage', 0.08);
    await new Promise((r) => setTimeout(r, 0));
    this.track = buildTrack(st);
    const track = this.track;
    this.par = track.tIdeal[track.n - 1] * 1.12;
    this.finishS = track.len - 30;

    // Sky + light.
    cb.onLoading('Loading sky', 0.12);
    const hdr = await new HDRLoader().loadAsync(st.hdr).catch(() => null);
    if (this.disposed) return;
    if (hdr) {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.hdrSky = hdr;
      this.scene.background = hdr;
      this.scene.environment = this.pmrem.fromEquirectangular(hdr).texture;
      this.sampleSky(hdr);
    }
    this.scene.environmentIntensity = st.id === 'snow' ? 1.0 : 0.95;
    this.scene.backgroundIntensity = 1;
    this.scene.backgroundBlurriness = 0.02;
    const fogC = this.horizon.clone().lerp(new THREE.Color(st.fog), 0.7);
    this.scene.fog = new THREE.Fog(fogC, st.fogNear, st.fogFar);
    // Time of day: elevation per stage, azimuth from the sky's brightest spot.
    {
      const el = (st.sunElev * Math.PI) / 180;
      const hz = Math.hypot(this.sunDir.x, this.sunDir.z) || 1;
      this.sunDir.set((this.sunDir.x / hz) * Math.cos(el), Math.sin(el), (this.sunDir.z / hz) * Math.cos(el)).normalize();
    }
    const sunI = st.id === 'snow' ? 2.1 : st.id === 'desert' ? 3.0 : 2.5;
    this.sun = new THREE.DirectionalLight(st.sunCol, sunI);
    this.sun.castShadow = true;
    const ss = hi ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ss, ss);
    const ext = hi ? 56 : 42;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 360 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.07;
    if (this.quality !== 'low') {
      // Cascaded shadows: crisp near the car, long reach for the hillsides.
      try {
        this.csm = new CSM({
          maxFar: this.quality === 'ultra' ? 320 : 240,
          cascades: this.quality === 'ultra' ? 4 : 3,
          mode: 'practical',
          parent: this.scene,
          shadowMapSize: this.quality === 'ultra' ? 4096 : 2048,
          lightDirection: this.sunDir.clone().negate(),
          camera: this.camera,
          lightIntensity: sunI,
          lightNear: 1,
          lightFar: 700,
          shadowBias: -0.0003,
        });
        for (const l of this.csm.lights) {
          l.color.set(st.sunCol);
          l.shadow.normalBias = 0.12;
        }
      } catch {
        this.csm = null;
      }
    }
    if (!this.csm) this.scene.add(this.sun, this.sun.target);
    this.dustColor.set(st.dust);

    // Textures, terrain.
    cb.onLoading('Texturing the ground', 0.2);
    const tex = await loadTerrainTextures(st, renderer);
    if (this.disposed) return;
    for (const t of Object.values(tex)) this.disposables.push(t);
    const tmat = terrainMaterial(st, tex, this.quality);
    this.disposables.push(tmat);
    cb.onLoading('Building terrain', 0.32);
    await new Promise((r) => setTimeout(r, 0));
    const terrain = buildTerrain(track, tmat, this.quality);
    this.scene.add(terrain);
    this.disposables.push({ dispose: () => terrain.traverse((o) => (o as THREE.Mesh).geometry?.dispose()) });

    cb.onLoading('Planting trees and rocks', 0.42);
    await new Promise((r) => setTimeout(r, 0));
    const mats = sceneryMaterials(st, tex.rock);
    const sc = await buildScenery(track, mats, this.quality);
    if (this.disposed) return;
    this.scene.add(sc.group);
    this.obstacles = sc.obstacles;
    this.sceneryUpdate = sc.update;
    this.disposables.push({ dispose: () => sc.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()) }, mats.foliage, mats.bark, mats.rock, mats.cactus, mats.grass, mats.atlas, mats.barkMap, mats.barkBump);

    // Gates.
    this.cps = [];
    const marks: [number, string, string, string][] = [
      [0.25, 'CHECKPOINT 1', 'split', '#7ae7ff'],
      [0.5, 'CHECKPOINT 2', 'split', '#7ae7ff'],
      [0.75, 'CHECKPOINT 3', 'split', '#7ae7ff'],
    ];
    for (const [f, label, sub, col] of marks) {
      const s = Math.round((this.finishS * f) / STEP) * STEP;
      const g = gate(track, s, label, sub, col);
      this.scene.add(g);
      this.cps.push({ s, label, time: null, gateObj: g });
    }
    const fin = gate(track, this.finishS, 'FINISH', 'token rally', '#ffd23f');
    this.scene.add(fin);
    this.cps.push({ s: this.finishS, label: 'FINISH', time: null, gateObj: fin });
    this.scene.add(gate(track, START_S + 46, 'START', st.name.toUpperCase(), '#7dff9a'));

    // Effects.
    this.skids = new Skids(this.quality === 'high' ? 3000 : 1400);
    this.scene.add(this.skids.mesh);
    this.parts = new Particles(this.quality === 'high' ? 1100 : 500);
    this.scene.add(this.parts.points);
    if (st.snow) {
      this.snow = new Snow(this.quality === 'high' ? 1800 : 700);
      this.scene.add(this.snow.points);
    }
    this.buildCoins();

    // Cars.
    cb.onLoading('Loading cars', 0.6);
    this.factory = new CarFactory(this.quality);
    this.player = this.factory.build(this.carSpec.body, { base: this.carSpec.base, accent: this.carSpec.accent, trim: this.carSpec.trim, number: this.carSpec.number, sponsors: ['SATOSHI RACING', 'HASH·OIL', 'MEMPOOL ENERGY'], ticker: 'TOKEN RALLY', logo: null, seed: 3 });
    if (this.disposed) return;
    this.scene.add(this.player.root);
    cb.onLoading('Reading the chain for rivals', 0.78);
    await this.makeRivals();
    if (this.disposed) return;

    this.csmSetup();
    this.buildComposer();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.input.attach();
    document.addEventListener('visibilitychange', this.visHandler);
    this.resetCars();
    cb.onLoading('Ready', 1);
    this.perfCool = 8; // grace: shader compiles and asset decode spike the first frames
    this.setPhase('menu');
    renderer.setAnimationLoop(this.frame);
  }

  /** Brightest HDR pixel = sun direction; horizon band = fog colour. */
  private sampleSky(t: THREE.Texture) {
    const img = t.image as { data: ArrayLike<number>; width: number; height: number };
    if (!img?.data) return;
    const { data, width: w, height: h } = img;
    const half = data instanceof Uint16Array;
    const rd = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
    const flip = (t as THREE.DataTexture).flipY;
    let best = 0;
    let bu = 0;
    let bv = 0;
    for (let y = 0; y < h; y += 2) {
      const v = flip ? 1 - y / (h - 1) : y / (h - 1);
      if (v < 0.52) continue;
      for (let x = 0; x < w; x += 2) {
        const o = (y * w + x) * 4;
        const l = rd(o) * 0.2126 + rd(o + 1) * 0.7152 + rd(o + 2) * 0.0722;
        if (l > best) {
          best = l;
          bu = x / (w - 1);
          bv = v;
        }
      }
    }
    const az = (bu - 0.5) * Math.PI * 2;
    const el = (bv - 0.5) * Math.PI;
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    if (this.sunDir.y < 0.18) this.sunDir.y = 0.18;
    this.sunDir.normalize();
    // Horizon colour: average a thin band just above the horizon.
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const y0 = Math.floor((flip ? 1 - 0.535 : 0.535) * (h - 1));
    for (let dy = -2; dy <= 2; dy++)
      for (let x = 0; x < w; x += 4) {
        const o = (Math.max(0, Math.min(h - 1, y0 + dy)) * w + x) * 4;
        r += Math.min(rd(o), 3);
        g += Math.min(rd(o + 1), 3);
        b += Math.min(rd(o + 2), 3);
        n++;
      }
    // Linear -> display-ish: tone map by hand so the fog matches what the sky shows on screen.
    const tm = (v: number) => Math.pow(clamp((v / n) * this.stage.exposure, 0, 1) * 0.92, 1 / 2.2);
    this.horizon.setRGB(tm(r), tm(g), tm(b), THREE.SRGBColorSpace);
  }

  // ───────────── Cars ─────────────

  private liveryFor(spec: RivalSpec, run?: RivalRun): Livery {
    const [base, accent, trim] = RIVAL_PAINT[spec.kind];
    const meta = spec.token ? tokenMeta(spec.token) : null;
    const text = run ? this.labelText(run).main : spec.token ? '$' + spec.token.slice(0, 5) : 'TX';
    const sp = [...SPONSORS];
    const h = (spec.slot * 7 + spec.id.charCodeAt(spec.id.length - 1)) % sp.length;
    return { base, accent, trim, number: String(((spec.slot * 13 + 5) % 97) + 2), sponsors: [sp[h], sp[(h + 3) % sp.length], sp[(h + 6) % sp.length]], ticker: text.slice(0, 9), logo: meta?.icon ?? null, seed: spec.slot * 31 + 7 };
  }

  private async makeRivals(count = COUNT, gridOff: (slot: number) => number = (slot) => GRID[slot] ?? -40) {
    const { rivals, live } = pickRivals(this.opts.take, count, this.stage.seed * 31 + (Date.now() % 1000));
    this.liveRivals = live;
    const track = this.track;
    this.rivals = [];
    // Fastest machines take the front of the grid.
    rivals.sort((a, b) => b.skill - a.skill);
    rivals.forEach((r, i) => (r.slot = i));
    for (const spec of rivals) {
      const c = this.factory.build(spec.model, this.liveryFor(spec), this.quality !== 'low');
      const label = this.makeLabel();
      c.root.add(label.sprite);
      this.scene.add(c.root);
      const s0 = Math.max(3, START_S + gridOff(spec.slot));
      const i0 = Math.round(s0 / STEP);
      const tt = new Float32Array(track.n);
      let t = 0;
      let vPrev = 0;
      for (let i = i0 + 1; i < track.n; i++) {
        const lim = track.vlim[i] * spec.skill;
        const v = Math.max(1, Math.min(lim, Math.sqrt(2 * 5.2 * (i - i0) * STEP + 1)));
        t += STEP / ((v + Math.max(vPrev, 1)) / 2);
        tt[i] = t;
        vPrev = v;
      }
      const run: RivalRun = {
        spec,
        root: c.root,
        rig: c,
        label: label.sprite,
        labelTex: label.tex,
        labelCanvas: label.canvas,
        labelKey: '',
        tt,
        s0,
        delay: 0.35 + this.rng() * 0.35 + (spec.slot >= 3 ? 0.55 : 0),
        lane: spec.slot % 2 === 0 ? 1 : -1,
        phase: this.rng() * 6.28,
        s: s0,
        v: 0,
        spin: 0,
        finish: 0,
        lat: 0,
        x: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        bump: 0,
        dustAcc: 0,
        vPrev: 0,
      };
      run.finish = run.delay + tt[Math.round(this.finishS / STEP)];
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
    sprite.position.set(0, 2.7, 0);
    sprite.renderOrder = 5;
    this.disposables.push(tex, mat);
    return { sprite, tex, canvas };
  }

  private labelText(r: RivalRun) {
    const sp = r.spec;
    if (sp.token) {
      const m = tokenMeta(sp.token);
      return { main: m ? `$${m.sym}` : `$${sp.token.slice(0, 6)}`, meta: m };
    }
    return { main: sp.live ? `tx ${sp.tx!.slice(0, 6)}…` : 'idle tx', meta: null };
  }

  private drawLabel(r: RivalRun, force = false) {
    const { main, meta } = this.labelText(r);
    const key = main + (meta?.icon?.complete ? '+i' : '');
    if (!force && key === r.labelKey) return;
    if (!force) r.rig.setLivery(this.liveryFor(r.spec, r));
    r.labelKey = key;
    const c = r.labelCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(8,10,14,0.82)';
    g.strokeStyle = r.spec.color;
    g.lineWidth = 4;
    const w = c.width - 8;
    const h = c.height - 8;
    g.beginPath();
    g.roundRect(4, 4, w, h, 18);
    g.fill();
    g.stroke();
    let x = 22;
    const ic = meta?.icon;
    if (ic && ic.complete && ic.naturalWidth) {
      try {
        g.save();
        g.beginPath();
        g.arc(x + 32, 56, 32, 0, Math.PI * 2);
        g.clip();
        g.drawImage(ic, x, 24, 64, 64);
        g.restore();
        x += 78;
      } catch {
        /* tainted icon: skip the logo */
      }
    }
    g.fillStyle = '#ffffff';
    g.font = 'bold 44px ui-monospace, Menlo, monospace';
    g.textBaseline = 'alphabetic';
    g.fillText(main.slice(0, 11), x, 58);
    g.fillStyle = r.spec.color;
    g.font = '24px ui-monospace, Menlo, monospace';
    g.fillText(r.spec.detail.slice(0, 26), x, 92);
    r.labelTex.needsUpdate = true;
  }

  // ───────────── Coins (live tx pickups) ─────────────

  private buildCoins() {
    const disc = new THREE.CylinderGeometry(0.85, 0.85, 0.14, 28);
    disc.rotateX(Math.PI / 2);
    const beam = new THREE.CylinderGeometry(0.55, 0.55, 22, 14, 1, true);
    this.coinGeo.push(disc, beam);
    this.disposables.push(disc, beam);
    for (let i = 0; i < 6; i++) {
      const col = new THREE.Color('#ffd23f');
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, metalness: 0.8, roughness: 0.25 });
      const mesh = new THREE.Mesh(disc, mat);
      mesh.castShadow = true;
      const bm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const b = new THREE.Mesh(beam, bm);
      b.position.y = 10;
      const group = new THREE.Group();
      group.add(mesh, b);
      group.visible = false;
      this.scene.add(group);
      this.disposables.push(mat, bm);
      this.coins.push({ group, beam: b, mat, active: false, s: 0, lat: 0, x: 0, z: 0, y: 0, t: 0, kind: '' });
    }
  }

  private spawnCoin(f: FeedTx | null) {
    const c = this.coins.find((x) => !x.active) ?? this.coins.reduce((a, b) => (a.t < b.t ? a : b));
    const s = this.near.s + 80 + this.rng() * 90;
    if (s > this.finishS - 15) return;
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    const lat = (this.rng() - 0.5) * 4.6;
    pointAt(this.track, s, lat, p);
    c.active = true;
    c.s = s;
    c.lat = lat;
    c.x = p.x;
    c.z = p.z;
    c.y = p.y + 1.15;
    c.t = this.time;
    c.kind = f ? f.kind : 'idle';
    const col = f ? new THREE.Color(KINDS.find((k) => k.id === f.kind)?.color ?? '#ffd23f') : new THREE.Color('#8fa0b4');
    c.mat.color.copy(col);
    c.mat.emissive.copy(col);
    (c.beam.material as THREE.MeshBasicMaterial).color.copy(col);
    c.group.visible = true;
    c.group.position.set(c.x, c.y, c.z);
    return f ? detailOf(f) : 'idle tx';
  }

  // ───────────── Post ─────────────

  private buildComposer() {
    const r = this.renderer;
    this.composer?.dispose();
    this.composer = null;
    this.gtao = null;
    if (this.fxLevel <= 0) return;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.fxLevel >= 2 ? 4 : 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = null;
    if (this.fxLevel >= 2) {
      this.bokeh = new BokehPass(this.scene, this.camera, { focus: 8, aperture: 0.0006, maxblur: 0.012 });
      this.bokeh.enabled = false;
      comp.addPass(this.bokeh);
    }
    if (this.fxLevel >= 3) {
      const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1, samples: this.quality === 'ultra' ? 16 : 10, distanceFallOff: 1 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
      gtao.blendIntensity = 0.75;
      // GTAOPass redraws the scene with an override material and only hides Points/Lines, so Sprites (name labels,
      // glows) turn into opaque quads that AO darkens behind: dark squares. Hide sprites during its passes (as Double-O does).
      {
        const sprites: THREE.Object3D[] = [];
        const aoRender = gtao.render.bind(gtao) as (...a: unknown[]) => void;
        gtao.render = ((...a: unknown[]) => {
          sprites.length = 0;
          this.scene.traverseVisible((o) => {
            if ((o as THREE.Sprite).isSprite) sprites.push(o);
          });
          for (const o of sprites) o.visible = false;
          aoRender(...a);
          for (const o of sprites) o.visible = true;
        }) as typeof gtao.render;
      }
      comp.addPass(gtao);
      this.gtao = gtao;
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.fxLevel >= 2 ? 0.26 : 0.2, 0.55, 2.2);
    comp.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE_SHADER);
    const gu = this.grade.uniforms;
    const gr = this.stage.grade;
    gu.uShadow.value.set(gr[0], gr[1], gr[2]);
    gu.uHigh.value.set(gr[3], gr[4], gr[5]);
    gu.uSat.value = gr[6];
    gu.uCon.value = gr[7];
    gu.uRays.value = this.fxLevel >= 2 ? 1 : 0.6;
    const sc = new THREE.Color(this.stage.sunCol);
    gu.uRayCol.value.set(sc.r, sc.g, sc.b);
    this.dirtTex ??= lensDirt();
    gu.tDirt.value = this.dirtTex;
    comp.addPass(this.grade);
    comp.addPass(new OutputPass());
    comp.setPixelRatio(this.dpr);
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    comp.setSize(w, h);
    this.composer = comp;
  }

  /** Hook every lit material into the cascaded shadow maps (once each). */
  private csmSetup() {
    const csm = this.csm;
    if (!csm) return;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (this.csmDone.has(mat)) continue;
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        this.csmDone.add(mat);
        // CSM replaces onBeforeCompile; chain ours (splat / wind / dirt) in front of its hook.
        const mine = mat.onBeforeCompile;
        csm.setupMaterial(mat);
        const theirs = mat.onBeforeCompile;
        mat.onBeforeCompile = (sh, r) => {
          mine.call(mat, sh, r);
          theirs.call(mat, sh, r);
        };
      }
    });
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
    this.csm?.updateFrustums();
    if (this.grade) this.grade.uniforms.uAspect.value = w / h;
  }

  // ───────────── Control ─────────────

  private placeOnGrid() {
    const track = this.track;
    const c = this.car;
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    const sp = this.mySpot >= 0 ? spotPos(this.mySpot) : { off: 0, lat: 0 };
    pointAt(track, START_S + sp.off, sp.lat, p);
    Object.assign(c, newCar(), { x: p.x, z: p.z, y: groundY(track, p.x, p.z, true), yaw: p.yaw, nitro: 0.35 });
    this.camYaw = p.yaw;
    this.camY = c.y;
  }

  private resetCars() {
    this.placeOnGrid();
    this.raceT = 0;
    this.penalty = 0;
    this.hits = 0;
    this.resets = 0;
    this.lastCpS = 0;
    this.lastCpSrc = START_S;
    this.result = null;
    this.dirtLevel = 0;
    this.driftShown = 0;
    this.fuelM = 0;
    this.nitroT = 0;
    this.nitroPrev = false;
    this.driftPaid = 0;
    for (const c of this.cps) c.time = null;
    for (const r of this.rivals) {
      r.s = r.s0;
      r.v = 0;
      r.delay = 0.35 + this.rng() * 0.35 + (r.spec.slot >= 3 ? 0.55 : 0);
      r.finish = r.delay + r.tt[Math.round(this.finishS / STEP)];
      this.placeRival(r, 0);
    }
    for (const c of this.coins) {
      c.active = false;
      c.group.visible = false;
    }
    for (const r of this.remotes) this.resetRemote(r);
    this.mpMaxS = START_S;
    this.skids.clear();
    this.syncCarMesh();
    this.nearUpdate();
  }

  // ───────────── Multiplayer ─────────────

  /** Call with opts.mp set (race info present) while at the menu, then begin(). Other pilots become real cars; AI fills the rest. */
  async startMp(me: { name: string; colour: string }) {
    const mp = this.opts.mp;
    const race = mp?.race;
    if (!mp || !race || (this.phase !== 'menu' && this.phase !== 'finished')) return false;
    this.clearMp();
    mp.on = (ev, p) => this.onNet(ev, p);
    const ids = race.ids;
    this.mySpot = Math.max(0, ids.indexOf(mp.id));
    // Fresh live-chain rivals for the empty slots, lined up ahead of the human grid.
    for (const r of this.rivals) this.removeRival(r);
    this.rivals = [];
    await this.makeRivals(Math.max(0, 8 - ids.length), (slot) => 14 + slot * 9);
    if (this.disposed) return false;
    const pl = driverColour(me.colour);
    this.player.setLivery({ base: pl.base, accent: pl.accent, trim: pl.trim, number: this.carSpec.number, sponsors: ['SATOSHI RACING', 'HASH·OIL', 'MEMPOOL ENERGY'], ticker: me.name.slice(0, 9), logo: null, seed: 3 });
    ids.forEach((id, i) => {
      const info = race.players[id];
      if (id !== mp.id && info) this.addRemote(id, info, i);
    });
    this.mpSetup = true;
    this.csmSetup();
    return true;
  }

  private removeRival(r: RivalRun) {
    this.scene.remove(r.root);
    r.rig.dispose();
    r.labelTex.dispose();
    (r.label.material as THREE.Material).dispose();
  }

  private clearMp() {
    for (const r of this.remotes) {
      this.scene.remove(r.rig.root);
      r.rig.dispose();
      r.labelTex.dispose();
      (r.label.material as THREE.Material).dispose();
      if (r.avatar) disposeAvatarTag(r.avatar);
    }
    this.remotes = [];
    this.mySpot = -1;
    if (this.opts.mp) this.opts.mp.on = null;
    if (this.mpSetup) {
      this.mpSetup = false;
      this.player.setLivery({ base: this.carSpec.base, accent: this.carSpec.accent, trim: this.carSpec.trim, number: this.carSpec.number, sponsors: ['SATOSHI RACING', 'HASH·OIL', 'MEMPOOL ENERGY'], ticker: 'TOKEN RALLY', logo: null, seed: 3 });
    }
  }

  private addRemote(id: string, info: { name: string; vehicle: string; team: string }, spot: number) {
    const spec = CARS.find((c) => c.id === info.vehicle) ?? CARS[0];
    const col = driverColour(info.team);
    const xid = readWire(info);
    const name = xid.x ? `@${xid.x}` : String(info.name || 'PILOT').slice(0, 14);
    const rig = this.factory.build(spec.body, { base: col.base, accent: col.accent, trim: col.trim, number: String(((spot * 13 + 5) % 97) + 2), sponsors: ['SATOSHI RACING', 'HASH·OIL', 'MEMPOOL ENERGY'], ticker: name.slice(0, 9), logo: null, seed: spot * 17 + 3 }, this.quality !== 'low');
    this.scene.add(rig.root);
    const label = this.makeLabel();
    rig.root.add(label.sprite);
    const g = label.canvas.getContext('2d')!;
    const c = label.canvas;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(8,10,14,0.85)';
    g.strokeStyle = col.base;
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(4, 4, c.width - 8, c.height - 8, 18);
    g.fill();
    g.stroke();
    g.fillStyle = '#fff';
    g.font = '900 54px Impact, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    g.fillText(name.toUpperCase(), 24, c.height / 2 + 2, c.width - 48);
    label.tex.needsUpdate = true;
    const r: RemoteRun = {
      id, name, colour: col.base, rig, label: label.sprite, labelTex: label.tex,
      buf: new SnapshotBuffer({ maxSpeed: RALLY_VCAP, clamp: RALLY_CHANNELS, frozenBit: FL_DONE }),
      spot, s: START_S, v: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, spin: 0, fl: 0, gone: false, placed: false, avatar: null,
    };
    if (xid.x) {
      const put = (verified: boolean) => {
        if (r.avatar) disposeAvatarTag(r.avatar);
        r.avatar = makeAvatarTag({ handle: xid.x!, name, ring: col.base, verified }, 1.3);
        r.avatar.position.set(0, 3.3, 0);
        rig.root.add(r.avatar);
      };
      put(false);
      void verifyWire(xid, id).then((ok) => ok && this.remotes.includes(r) && put(true));
    }
    this.resetRemote(r);
    this.remotes.push(r);
  }

  private resetRemote(r: RemoteRun) {
    const sp = spotPos(r.spot);
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    pointAt(this.track, START_S + sp.off, sp.lat, p);
    r.s = START_S + sp.off;
    r.x = p.x;
    r.z = p.z;
    r.y = roadY(this.track, r.s);
    r.yaw = p.yaw;
    r.pitch = r.roll = r.v = 0;
    r.fl = 0;
    r.gone = false;
    r.placed = false;
    r.buf.reset();
    r.rig.root.visible = true;
    r.rig.root.position.set(r.x, r.y, r.z);
    r.rig.root.rotation.set(0, r.yaw, 0);
  }

  /** Gameplay messages from the room (the session already filtered by race). */
  private onNet(ev: string, raw: unknown) {
    const d = raw as Record<string, unknown> | null;
    if (ev !== 's' || !d || typeof d.i !== 'string') return;
    const r = this.remotes.find((x) => x.id === d.i);
    if (r) r.buf.push(d, performance.now());
  }

  /** My car, ~12-15 Hz. World position + yaw as cos/sin so interpolation never wraps. */
  private sendState(now: number, force = false) {
    const mp = this.opts.mp;
    if (!mp?.race) return;
    const n = mp.humans();
    if (!force && now - this.lastSend < (n <= 2 ? 66 : n <= 4 ? 80 : 110)) return;
    this.lastSend = now;
    const c = this.car;
    const q = (x: number) => Math.round(x * 100) / 100;
    this.mpMaxS = Math.max(this.mpMaxS, this.near.s);
    const fl = (c.nitroOn ? FL_NITRO : 0) | (this.econ.dry && this.econ.live ? FL_DRY : 0) | (this.phase === 'finished' ? FL_DONE : 0);
    mp.send('s', { i: mp.id, ts: Math.round(now), p: q(this.mpMaxS), v: q(Math.abs(c.fwd)), l: 0, f: fl, a: [q(c.x), q(c.y + c.bodyY), q(c.z), Math.round(Math.cos(c.yaw) * 1000) / 1000, Math.round(Math.sin(c.yaw) * 1000) / 1000, q(c.pitch), q(c.roll)] });
  }

  private updateRemotes(dt: number, now: number) {
    for (const r of this.remotes) {
      if (!r.gone && this.greenAtMs > 0 && this.phase !== 'menu') {
        const silent = r.buf.lastRecv > 0 ? now - r.buf.lastRecv > 4500 : now - this.greenAtMs > 9000;
        if (silent) {
          r.gone = true;
          this.opts.cb.onToast({ text: `${r.name} DISCONNECTED`, tone: 'bad' });
        }
      }
      r.rig.root.visible = !r.gone;
      const st = r.buf.sample(now);
      if (!st || r.gone) continue;
      const [x, y, z, cy, sy, pitch, roll] = st.a;
      // Soften corrections instead of popping; resets and teleports snap.
      const k = Math.min(1, 16 * dt);
      const far = (x - r.x) ** 2 + (z - r.z) ** 2 > 30 * 30;
      if (!r.placed || far || dt === 0) {
        r.x = x;
        r.y = y;
        r.z = z;
        r.placed = true;
      } else {
        r.x += (x - r.x) * k;
        r.y += (y - r.y) * k;
        r.z += (z - r.z) * k;
      }
      const yaw = Math.atan2(sy, cy);
      r.yaw += angDiff(r.yaw, yaw) * Math.min(1, 14 * dt);
      r.pitch = pitch;
      r.roll = roll;
      r.v = st.v;
      r.s = st.prog;
      r.fl = st.fl;
      r.spin += (r.v / WHEELS.radius) * dt;
      r.rig.root.position.set(r.x, r.y, r.z);
      r.rig.root.rotation.set(r.pitch, r.yaw, r.roll);
      r.rig.wheels.forEach((w) => {
        w.spin.rotation.x = r.spin * (WHEELS.radius / WHEEL_VIS_R);
      });
      r.rig.setLights(0, 0.4);
      if (r.avatar) {
        fitAvatarTag(r.avatar, this.camera, 0.04, 6);
        r.avatar.visible = r.rig.root.position.distanceTo(this.camera.position) < 300;
      }
    }
  }

  /** From the menu: go. */
  begin() {
    if (this.phase !== 'menu' && this.phase !== 'finished') return;
    this.resetCars();
    this.countT = 0;
    this.lastCount = -1;
    this.setPhase('countdown');
    this.audio.start();
    sfx('click');
  }

  /** Back to the menu orbit (new rivals from the feed). */
  async toMenu() {
    if (this.phase === 'loading') return;
    this.clearMp();
    for (const r of this.rivals) {
      this.scene.remove(r.root);
      r.rig.dispose();
      r.labelTex.dispose();
      (r.label.material as THREE.Material).dispose();
    }
    await this.makeRivals();
    this.csmSetup();
    this.resetCars();
    this.setPhase('menu');
  }

  pause(on: boolean) {
    if (this.opts.mp?.race) return; // the race goes on for the others
    if (on && this.phase === 'racing') this.setPhase('paused');
    else if (!on && this.phase === 'paused') this.setPhase('racing');
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
  }

  setCam(mode: number) {
    this.camMode = mode;
  }

  /** Dev/test: let the pure-pursuit driver steer. */
  setAutopilot(on: boolean) {
    this.autopilot = on;
  }
  debug() {
    return { car: this.car, near: this.near, roadYaw: Math.atan2(this.track.tx[this.near.i], this.track.tz[this.near.i]), hits: this.hits, riv: this.rivals.map((r) => [+r.x.toFixed(1), +r.z.toFixed(1), +r.s.toFixed(0), +r.lat.toFixed(1)]), raceT: this.raceT, phase: this.phase, fx: this.fxLevel, ms: this.frameMs, rivals: this.rivals.length, live: this.liveRivals, finish: this.result, rem: this.remotes.map((r) => [r.name, +r.x.toFixed(1), +r.z.toFixed(1), +r.s.toFixed(0), r.gone]) };
  }
  /** Dev: end the run now (results screen). */
  debugFinish() {
    if (this.phase === 'racing') this.finish();
  }
  /** Dev: override the player's controls (null = real input). */
  debugInput: CarInput | null = null;
  teleport(s: number, lat = 0, speed = 0, yawOff = 0) {
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    pointAt(this.track, s, lat, p);
    const c = this.car;
    c.x = p.x;
    c.z = p.z;
    c.y = groundY(this.track, p.x, p.z, true);
    c.yaw = p.yaw + yawOff;
    c.vx = Math.sin(p.yaw) * speed;
    c.vz = Math.cos(p.yaw) * speed;
    this.camYaw = p.yaw;
    this.camY = c.y;
  }

  private respawn() {
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    const s = Math.max(START_S, this.lastCpSrc);
    pointAt(this.track, s, 0, p);
    const c = this.car;
    Object.assign(c, newCar(), { x: p.x, z: p.z, y: groundY(this.track, p.x, p.z, true), yaw: p.yaw, nitro: this.car.nitro, driftPts: this.car.driftPts });
    this.camYaw = p.yaw;
    this.penalty += 5;
    this.resets++;
    this.opts.cb.onToast({ text: 'BACK ON THE ROAD +5.0s', tone: 'bad' });
    sfx('hurt');
  }

  // ───────────── Per-frame ─────────────

  private world: CarWorld = {
    height: (x, z) => groundY(this.track, x, z, true),
    dist: (x, z) => nearest(this.track, x, z, this.near).dist,
    hit: (x, z, r, out) => this.obstacles.hit(x, z, r, out),
    grip: 1,
    offGrip: 0.6,
  };

  private nearUpdate() {
    nearest(this.track, this.car.x, this.car.z, this.near);
  }

  private frame = (ms: number) => {
    if (this.disposed) return;
    const dtRaw = Math.min(0.05, (ms - (this.lastMs || ms)) / 1000);
    this.lastMs = ms;
    const dt = dtRaw;
    this.time += dt;
    this.perf(dt);
    this.world.grip = this.stage.grip;
    this.world.offGrip = this.stage.offGrip;
    const { car: inp, edges } = this.input.read();

    if (edges.cam) {
      this.camMode = (this.camMode + 1) % 2;
    }
    if (edges.pause) {
      if (this.phase === 'racing') this.pause(true);
      else if (this.phase === 'paused') this.pause(false);
    }
    if (this.phase === 'menu' && edges.start) this.opts.cb.onStartRequest?.();

    const racing = this.phase === 'racing';
    const frozen = this.phase === 'paused';
    if (this.phase === 'countdown') {
      this.countT += dt;
      const n = Math.ceil(3 - this.countT);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n > 0) {
          this.opts.cb.onCount(n);
          sfx('click', 1.2);
        }
      }
      if (this.countT >= 3) {
        this.opts.cb.onCount(0);
        sfx('start');
        this.setPhase('racing');
        this.raceT = 0;
        this.greenAtMs = performance.now();
        this.opts.mp?.green(this.par * 0.5);
        setTimeout(() => this.opts.cb.onCount(null), 900);
      }
    }
    const live = this.phase === 'racing' || this.phase === 'finished' || this.phase === 'countdown' || this.phase === 'menu';
    if (!frozen && live) {
      const c0 = this.car;
      let ci: CarInput = { throttle: 0, brake: 0, steer: 0, hand: false, nitro: false };
      if (racing) ci = this.debugInput ?? (this.autopilot ? this.drive() : inp);
      else if (this.phase === 'finished') ci = { throttle: 0, brake: 0.55, steer: 0, hand: false, nitro: false };
      else if (this.phase === 'countdown') ci = { throttle: inp.throttle * 0.0, brake: 0, steer: 0, hand: false, nitro: false };
      if (racing && this.econ.live && this.econ.dry) ci = { ...ci, throttle: 0, nitro: false }; // out of fuel: coast
      this.lastThrottle = ci.throttle;
      this.braking = ci.brake > 0.1 && c0.fwd > 0.5;
      if (racing && edges.reset) this.respawn();
      this.acc += dt;
      const H = 1 / 120;
      let n = 0;
      while (this.acc >= H && n < 8) {
        this.acc -= H;
        n++;
        this.step(H, ci, racing || this.phase === 'finished');
      }
      if (n >= 8) this.acc = 0;
      if (racing) this.raceT += dt;
      this.updateRivals(dt);
      if (this.remotes.length) this.updateRemotes(dt, performance.now());
      this.updateRacing(dt);
      if (racing && this.opts.mp?.race) this.sendState(performance.now());
    }
    this.syncCarMesh();
    this.effects(dt);
    this.updateCamera(dt);
    this.updateLights();
    this.sceneryUpdate?.(this.camera.position.x, this.camera.position.z, this.time);
    this.renderFrame();
    // HUD at ~12 Hz.
    this.hudT += dt;
    if (this.hudT > 0.08) {
      this.hudT = 0;
      this.emitHud();
    }
    this.mapT += dt;
    if (this.mapT > 0.12) {
      this.mapT = 0;
      this.emitMap();
    }
  };
  private lastMs = 0;

  private step(h: number, ci: CarInput, active: boolean) {
    if (!active) {
      // Parked: keep the body settled on the ground.
      const c = this.car;
      c.vx = c.vz = c.yawRate = 0;
      stepCar(c, this.carSpec, { throttle: 0, brake: 0, steer: 0, hand: true, nitro: false }, this.world, h);
      c.vx = c.vz = c.yawRate = 0; // parked: the brake must not creep the car backwards
    }
    stepCar(this.car, this.carSpec, ci, this.world, h, (v) => this.onImpact(v));
    // Keep the player on the world: a soft wall beyond the corridor.
    const c = this.car;
    const d = this.near.dist;
    if (d > 36) {
      const i = this.near.i;
      const k = clamp((d - 36) / 8, 0, 1);
      const side = Math.sign(this.near.lat) || 1;
      const ex = this.track.tz[i] * side;
      const ez = -this.track.tx[i] * side;
      c.vx -= ex * k * 30 * h;
      c.vz -= ez * k * 30 * h;
      c.vx *= 1 - k * 0.02;
      c.vz *= 1 - k * 0.02;
    }
  }

  private onImpact(v: number) {
    const collision = v > 100;
    const speed = collision ? v - 100 : v;
    if (collision) {
      sfx('hit', clamp(speed / 10, 0.3, 1));
      this.camShake = Math.max(this.camShake, clamp(speed / 12, 0.2, 1));
      if (speed > 5 && this.raceT - this.lastHitAt > 1.2 && this.phase === 'racing') {
        this.lastHitAt = this.raceT;
        this.hits++;
        this.penalty += 0.5;
        this.opts.cb.onToast({ text: 'HIT +0.5s', tone: 'bad' });
      }
      // Sparks and bark chips.
      for (let i = 0; i < 10; i++) {
        this.parts.emit(this.car.x, this.car.y + 0.8, this.car.z, (this.rng() - 0.5) * 8, 2 + this.rng() * 5, (this.rng() - 0.5) * 8, 0.7, 0.14, 0.1, 1, this.tmpC.set('#ffcf8a'), 1, 12);
      }
    } else {
      sfx('stomp', clamp(speed / 12, 0.3, 1));
      this.camShake = Math.max(this.camShake, clamp(speed / 14, 0.15, 0.8));
      for (let i = 0; i < 14; i++) {
        this.parts.emit(this.car.x + (this.rng() - 0.5) * 2, this.car.y + 0.2, this.car.z + (this.rng() - 0.5) * 2, (this.rng() - 0.5) * 6, 1 + this.rng() * 3, (this.rng() - 0.5) * 6, 1.4, 1.2, 4.5, 0.4, this.dustColor, 0, 0);
      }
    }
  }

  /** Pure-pursuit driver (dev autopilot). */
  private drive(): CarInput {
    const t = this.track;
    const c = this.car;
    const near = this.near;
    // Stuck against a tree or off in the scenery: reset like a player would.
    if (c.speed < 1.5 || near.dist > 14) this.stuckT += 1 / 60;
    else this.stuckT = 0;
    if (this.stuckT > 2.5) {
      this.stuckT = 0;
      this.respawn();
    }
    const look = Math.max(10, c.speed * 0.9);
    const tp = { x: 0, y: 0, z: 0, yaw: 0 };
    pointAt(t, Math.min(t.len, near.s + look), 0, tp);
    const err = angDiff(c.yaw, Math.atan2(tp.x - c.x, tp.z - c.z));
    const vt = t.vlim[Math.min(t.n - 1, Math.floor((near.s + look * 0.6) / STEP))] * 0.95;
    return { throttle: c.speed < vt ? 1 : 0, brake: c.speed > vt + 3 ? Math.min(1, (c.speed - vt) / 8) : 0, steer: clamp(err * 1.6, -1, 1), hand: Math.abs(err) > 0.55 && c.speed > 14, nitro: c.nitro > 0.6 && Math.abs(err) < 0.1 };
  }

  private rivalTimeAt(r: RivalRun, s: number) {
    const i = clamp(s / STEP, 0, this.track.n - 1.001);
    const k = Math.floor(i);
    return r.delay + lerp(r.tt[k], r.tt[k + 1], i - k);
  }

  private placeRival(r: RivalRun, t: number) {
    const tr = this.track;
    // Search the time table (monotonic) for the distance reached at race time t.
    const T = Math.max(0, t - r.delay);
    let s = r.s0;
    if (T > 0) {
      let lo = Math.round(r.s0 / STEP);
      let hi = tr.n - 1;
      if (r.tt[hi] <= T) s = tr.len;
      else {
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (r.tt[mid] <= T) lo = mid;
          else hi = mid;
        }
        const u = (T - r.tt[lo]) / Math.max(1e-4, r.tt[hi] - r.tt[lo]);
        s = (lo + u) * STEP;
      }
    }
    const prev = r.s;
    r.s = s;
    r.v = t > 0 ? clamp((s - prev) / Math.max(1e-3, this.lastRDt), 0, 70) : 0;
    const run = s - r.s0;
    const wave = Math.sin(t * 0.35 + r.phase) * 0.5 * smooth(60, 200, run);
    const lat = clamp(r.lane * (2.3 - smooth(80, 340, run) * 1.4) + wave, -2.8, 2.8);
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    pointAt(tr, s, lat, p);
    const dYaw = angDiff(r.yaw, p.yaw);
    r.yaw = t === 0 ? p.yaw : r.yaw + dYaw * 0.35;
    r.x = p.x;
    r.z = p.z;
    r.lat = lat;
    const i = clamp(Math.round(s / STEP), 0, tr.n - 1);
    const kap = tr.kappa[i];
    r.roll = lerp(r.roll, clamp(kap * r.v * r.v * 0.004, -0.07, 0.07), 0.15);
    const ground = roadY(tr, s) + 0.0;
    r.root.position.set(p.x, ground, p.z);
    r.root.rotation.set(r.pitch, r.yaw + kap * -0.0, r.roll);
  }

  private lastRDt = 1 / 60;
  private rivalClock = 0;
  private updateRivals(dt: number) {
    this.lastRDt = dt;
    // Rivals keep driving after the player crosses the line.
    if (this.phase === 'finished') this.rivalClock += dt;
    else if (this.phase === 'racing') this.rivalClock = this.raceT;
    else if (this.phase !== 'paused') this.rivalClock = 0;
    const t = this.rivalClock;
    const tr = this.track;
    const cam = this.camera.position;
    for (const r of this.rivals) {
      const before = r.v;
      this.placeRival(r, t);
      r.pitch = lerp(r.pitch, clamp(-(r.v - before) * 0.05, -0.05, 0.05), 0.2);
      r.spin += (r.v / WHEELS.radius) * dt;
      const steerA = clamp(tr.kappa[clamp(Math.round(r.s / STEP), 0, tr.n - 1)] * 2.6, -0.4, 0.4);
      r.rig.wheels.forEach((w, i) => {
        w.spin.rotation.x = r.spin * (WHEELS.radius / WHEEL_VIS_R);
        if (i < 2) w.steer.rotation.y = steerA;
      });
      r.rig.setLights(r.v < r.vPrev - 0.05 ? 1 : 0, 0.4);
      r.vPrev = r.v;
      r.rig.dirt.value = Math.min(0.55, (r.s / this.track.len) * 0.7);
      // Car-to-car contact with the player.
      if (this.phase === 'racing') {
        const dx = this.car.x - r.x;
        const dz = this.car.z - r.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.7 && Math.abs(this.car.y - r.root.position.y) < 2) {
          const nx = dx / (d || 1);
          const nz = dz / (d || 1);
          const pen = 2.7 - d;
          this.car.x += nx * pen * 0.6;
          this.car.z += nz * pen * 0.6;
          const rvx = Math.sin(r.yaw) * r.v;
          const rvz = Math.cos(r.yaw) * r.v;
          const vn = (this.car.vx - rvx) * nx + (this.car.vz - rvz) * nz;
          if (vn < 0) {
            this.car.vx -= 1.25 * vn * nx;
            this.car.vz -= 1.25 * vn * nz;
            r.delay += clamp(-vn * 0.012, 0, 0.12);
            if (-vn > 2) {
              sfx('hit', clamp(-vn / 10, 0.2, 0.7));
              this.camShake = Math.max(this.camShake, clamp(-vn / 14, 0.1, 0.5));
            }
          }
        }
      }
      // Label: stay readable at distance, hide far away.
      const dist = Math.hypot(r.x - cam.x, r.z - cam.z);
      r.label.visible = dist < 280 && dist > 2.5;
      r.root.visible = dist > 3.6 || this.camMode === 1 || this.phase === 'menu';
      const k = Math.max(0.5, dist / 30);
      r.label.scale.set(5.2 * k, (5.2 * 112) / 384 * k, 1);
      r.label.position.set(0, 3.2 + Math.min(4, dist * 0.02), 0);
      // Dust behind fast rivals near the camera.
      if (dist < 90 && r.v > 8 && t > r.delay) {
        r.dustAcc += dt * r.v * 0.55;
        while (r.dustAcc > 1) {
          r.dustAcc -= 1;
          const bx = r.x - Math.sin(r.yaw) * 1.7;
          const bz = r.z - Math.cos(r.yaw) * 1.7;
          this.parts.emit(bx + (this.rng() - 0.5), r.root.position.y + 0.2, bz + (this.rng() - 0.5), (this.rng() - 0.5) * 1.5, 0.6 + this.rng(), (this.rng() - 0.5) * 1.5, 1.2 + this.rng(), 1.2, 4.2, 0.2, this.dustColor, 0, 0);
        }
      }
    }
    // Refresh ticker labels whose token metadata has just arrived.
    if (Math.floor(this.time) !== this.lastLabelSec) {
      this.lastLabelSec = Math.floor(this.time);
      for (const r of this.rivals) if (r.spec.token) this.drawLabel(r);
    }
  }
  private lastLabelSec = -1;

  private updateRacing(dt: number) {
    const c = this.car;
    this.nearUpdate();
    if (this.phase !== 'racing') return;
    const near = this.near;
    // Checkpoints and finish.
    for (const cp of this.cps) {
      if (cp.time === null && near.s >= cp.s && this.car.air >= 0) {
        // Must pass through the road, not cut across the hills.
        if (near.dist < 14) {
          cp.time = this.raceT + this.penalty;
          if (this.econ.live) this.opts.cb.onSpend?.('split', cp.label);
          if (cp.label === 'FINISH') {
            this.finish();
            return;
          }
          this.lastCpSrc = cp.s;
          sfx('level');
          const leader = this.leaderTimeAt(cp.s);
          const d = leader ? cp.time - leader.t : null;
          this.opts.cb.onToast({ text: `${cp.label}  ${fmt(cp.time)}${d !== null ? `  ${d >= 0 ? '+' : '-'}${Math.abs(d).toFixed(2)} vs ${leader!.name}` : ''}`, tone: d !== null && d < 0 ? 'good' : 'info' });
        } else cp.time = -1;
      }
    }
    // Wrong way.
    const tfx = this.track.tx[near.i];
    const tfz = this.track.tz[near.i];
    const dot = Math.sin(c.yaw) * tfx + Math.cos(c.yaw) * tfz;
    if (dot < -0.3 && c.speed > 4) {
      this.wrongT += dt;
      if (this.wrongT > 1.5) {
        this.wrongT = 0;
        this.opts.cb.onToast({ text: 'WRONG WAY: turn around (R to reset)', tone: 'bad' });
      }
    } else this.wrongT = 0;
    if (near.dist > 30) {
      this.offT += dt;
      if (this.offT > 2.5) {
        this.offT = 0;
        this.opts.cb.onToast({ text: 'OFF COURSE: press R to get back on the road', tone: 'bad' });
      }
    }
    // LIVE economy: what the car burned this frame.
    if (this.econ.live && this.opts.cb.onSpend) {
      const sp = this.opts.cb.onSpend;
      if (this.lastThrottle > 0.05 && c.speed > 1) {
        this.fuelM += c.speed * dt;
        let k = 0;
        while (this.fuelM >= FUEL_M && k++ < 3) {
          this.fuelM -= FUEL_M;
          sp('fuel', String(Math.round(near.s)));
        }
        if (this.fuelM > FUEL_M * 3) this.fuelM = 0;
      }
      if (c.nitroOn) {
        if (!this.nitroPrev) {
          this.nitroT = 0;
          sp('nitro', 'burst');
        }
        this.nitroT += dt;
        if (this.nitroT >= NITRO_TICK_S) {
          this.nitroT -= NITRO_TICK_S;
          sp('nitro', 'burn');
        }
      }
      this.nitroPrev = c.nitroOn;
      if (c.driftPts - this.driftPaid >= DRIFT_PTS) {
        this.driftPaid = c.driftPts;
        sp('drift', String(Math.round(c.driftPts)));
      }
    }
    // Nitro / drift toasts.
    if (c.driftPts - this.driftShown > 600) {
      this.driftShown = c.driftPts;
      this.opts.cb.onToast({ text: `DRIFT ${Math.round(c.driftPts)}`, tone: 'good' });
    }
    // Coins: new chain txs land on the road ahead.
    this.coinT += dt;
    if (this.coinT > 1.4) {
      this.coinT = 0;
      const f = this.opts.take();
      if (f) {
        const d = this.spawnCoin(f);
        if (d) this.opts.cb.onToast({ text: `LIVE TX AHEAD · ${d}`, tone: 'info' });
      } else if (this.rng() < 0.22 && this.coins.filter((x) => x.active).length < 3) this.spawnCoin(null);
    }
    for (const k of this.coins) {
      if (!k.active) continue;
      k.group.rotation.y += dt * 2.4;
      k.group.position.y = k.y + Math.sin(this.time * 2 + k.s) * 0.12;
      const dx = k.x - c.x;
      const dz = k.z - c.z;
      if (dx * dx + dz * dz < 3.2 * 3.2) {
        k.active = false;
        k.group.visible = false;
        c.nitro = Math.min(1, c.nitro + 0.28);
        sfx('coin');
        this.opts.cb.onToast({ text: '+NITRO', tone: 'good' });
        for (let i = 0; i < 12; i++) this.parts.emit(k.x, k.y, k.z, (this.rng() - 0.5) * 6, this.rng() * 5, (this.rng() - 0.5) * 6, 0.7, 0.3, 0.05, 1, this.tmpC.copy(k.mat.color).multiplyScalar(2.2), 1, 6);
      } else if (k.s < near.s - 40) {
        k.active = false;
        k.group.visible = false;
      }
    }
  }
  private offT = 0;
  private stuckT = 0;

  private leaderTimeAt(s: number) {
    let best: { t: number; name: string } | null = null;
    for (const r of this.rivals) {
      const t = this.rivalTimeAt(r, s);
      if (!best || t < best.t) best = { t, name: this.labelText(r).main };
    }
    return best;
  }

  private finish() {
    const raw = this.raceT;
    const total = raw + this.penalty;
    this.finishAt = this.time;
    const rows: BoardRow[] = this.rivals.map((r) => ({ name: this.labelText(r).main, sub: r.spec.detail, time: r.finish, me: false, tx: r.spec.tx, color: r.spec.color }));
    rows.push({ name: 'YOU', sub: `${this.carSpec.name}${this.penalty ? ` · +${this.penalty.toFixed(1)}s penalty` : ''}`, time: total, me: true, tx: null, color: '#ffffff' });
    rows.sort((a, b) => a.time - b.time);
    const pos = rows.findIndex((r) => r.me) + 1;
    const beaten = rows.length - pos;
    const timePts = Math.round(clamp((this.par * 1.45 - total) / (this.par * 0.55), 0, 1.15) * 4000);
    const beatPts = beaten * 400;
    const driftPts = Math.min(1500, Math.round(this.car.driftPts / 2));
    const score = timePts + beatPts + driftPts;
    const splits = this.cps.map((c) => c.time ?? 0);
    this.result = { stage: this.stage.id, car: this.carSpec.id, raw, penalty: this.penalty, total, splits, pos, total_cars: rows.length, board: rows, drift: Math.round(this.car.driftPts), score, parts: { time: timePts, beat: beatPts, drift: driftPts }, par: this.par, hits: this.hits, resets: this.resets, live: this.liveRivals };
    this.opts.mp?.finish(total);
    sfx('level');
    this.setPhase('finished');
    this.sendState(performance.now(), true);
    this.opts.cb.onFinish(this.result);
  }

  // ───────────── Visual sync ─────────────

  private syncCarMesh() {
    const c = this.car;
    const root = this.player.root;
    root.position.set(c.x, c.y + c.bodyY, c.z);
    root.rotation.set(c.pitch, c.yaw, c.roll);
    const w = this.player.wheels;
    for (let i = 0; i < 4; i++) {
      w[i].spin.rotation.x = c.wheelSpin * (WHEELS.radius / WHEEL_VIS_R);
      if (i < 2) w[i].steer.rotation.y = c.steerAngle;
      // Suspension travel: the wheel follows the ground, the body follows its springs.
      const fx = i % 2 === 0 ? WHEEL_X : -WHEEL_X;
      const fz = i < 2 ? WHEEL_Z : -WHEEL_Z;
      const plane = c.y + c.bodyY - fz * c.pitch + fx * c.roll;
      const travel = clamp(c.wheelH[i] - plane, -0.16, 0.16);
      w[i].steer.position.y = WHEEL_VIS_R + (c.air > 0.05 ? -0.12 : travel);
    }
    this.player.dirt.value = this.dirtLevel;
    this.player.setLights(this.braking ? 1 : 0, 0.5);
  }
  private dirtLevel = 0;
  private braking = false;

  private wheelWorld(i: number, out: THREE.Vector3) {
    const c = this.car;
    const fx = i % 2 === 0 ? WHEELS.track / 2 : -WHEELS.track / 2;
    const fz = i < 2 ? WHEELS.base / 2 : -WHEELS.base / 2;
    const sy = Math.sin(c.yaw);
    const cy = Math.cos(c.yaw);
    return out.set(c.x + sy * fz + cy * fx, c.wheelH[i], c.z + cy * fz - sy * fx);
  }

  private effects(dt: number) {
    const c = this.car;
    const p = this.parts;
    const st = this.stage;
    const camP = this.camera.position;
    if (this.phase === 'racing' && c.air <= 0) this.dirtLevel = Math.min(1, this.dirtLevel + dt * c.speed * (c.surf === 2 ? 0.0028 : c.surf === 1 ? 0.0014 : 0.0006) * (st.id === 'snow' ? 0.5 : 1));
    // Tyre marks + dust + gravel.
    if (c.air <= 0 && (this.phase === 'racing' || this.phase === 'finished')) {
      for (let i = 0; i < 4; i++) {
        this.wheelWorld(i, TMP);
        const rear = i >= 2;
        const amt = rear ? c.skid : c.front * 0.8;
        const braking = this.car.fwd > 8 && this.car.ax < -6 ? 0.45 : 0;
        const mark = c.surf === 2 && st.id !== 'snow' ? amt * 0.5 : amt;
        this.skids.mark(i, TMP.x, TMP.y, TMP.z, Math.max(mark, braking * (rear ? 0.6 : 0.3)), 0.28);
        const loose = c.surf === 0 ? 1 : c.surf === 1 ? 1.3 : 1.7;
        const rate = (c.speed * 0.6 * loose * (rear ? 1 : 0.35) + amt * 40 + (c.nitroOn && rear ? 12 : 0)) * smooth(1.5, 7, c.speed);
        this.dust[i] += rate * dt * 0.5;
        while (this.dust[i] > 1) {
          this.dust[i] -= 1;
          const back = 0.12;
          p.emit(TMP.x + (this.rng() - 0.5) * 0.4, TMP.y + 0.15, TMP.z + (this.rng() - 0.5) * 0.4, -c.vx * back + (this.rng() - 0.5) * 1.6, 0.7 + this.rng() * 1.3 + amt, -c.vz * back + (this.rng() - 0.5) * 1.6, 0.9 + this.rng() * 1.1, 0.9, 3.6 + amt * 2, 0.16 + 0.22 * Math.min(1, loose / 1.2) + amt * 0.1, this.dustColor, 0, 0);
          if (rear && (amt > 0.25 || c.surf > 0) && this.rng() < 0.7) {
            p.emit(TMP.x, TMP.y + 0.1, TMP.z, -c.vx * 0.35 + (this.rng() - 0.5) * 3, 2 + this.rng() * 3.5, -c.vz * 0.35 + (this.rng() - 0.5) * 3, 0.9, 0.09, 0.07, 1, this.tmpC.set(st.id === 'snow' ? '#eef4fa' : st.id === 'desert' ? '#a56b45' : '#8a7a68'), 1, 13);
          }
        }
      }
    }
    // Nitro flames at the tailpipe.
    if (c.nitroOn && this.phase === 'racing') {
      const sy = Math.sin(c.yaw);
      const cy = Math.cos(c.yaw);
      for (let k = 0; k < 3; k++) {
        p.emit(c.x - sy * 2.2 + (this.rng() - 0.5) * 0.3, c.y + 0.55, c.z - cy * 2.2 + (this.rng() - 0.5) * 0.3, -sy * (6 + this.rng() * 5) + c.vx * 0.6, (this.rng() - 0.5) * 1.2, -cy * (6 + this.rng() * 5) + c.vz * 0.6, 0.22, 0.9, 0.12, 1, this.tmpC.setRGB(3.2, 1.35 + this.rng() * 0.5, 0.35), 0, 0);
      }
    }
    // Brake / tail lights glow when braking or reversing.
    const gy = (x: number, z: number) => groundY(this.track, x, z, false);
    p.update(dt, gy);
    this.skids.flush();
    // Particle size scale follows the camera lens.
    const hpx = this.renderer.domElement.height;
    p.uniforms.uScale.value = hpx / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    if (this.snow) {
      this.snow.uniforms.uTime.value = this.time;
      this.snow.uniforms.uCam.value.copy(camP);
      this.snow.uniforms.uScale.value = p.uniforms.uScale.value;
    }
  }
  private dust = [0, 0, 0, 0];

  private updateCamera(dt: number) {
    const cam = this.camera;
    const c = this.car;
    const track = this.track;
    const speed01 = clamp(c.speed / 45, 0, 1);
    this.camShake *= Math.exp(-dt * 4);
    const rough = c.surf === 0 ? 0.25 : c.surf === 1 ? 0.5 : 1;
    const shake = (0.012 + 0.03 * rough) * speed01 + this.camShake * 0.35 + (c.nitroOn ? 0.03 : 0);
    const t = this.time;
    const sx = (Math.sin(t * 31.3) + Math.sin(t * 17.1 + 1.3)) * 0.5 * shake;
    const sy = (Math.sin(t * 27.7 + 2.1) + Math.sin(t * 13.9)) * 0.5 * shake;
    let fovT = 62 + speed01 * 16 + (c.nitroOn ? 9 : 0);
    if (this.camMode === 1) fovT += 6;

    if (this.phase === 'menu' || this.phase === 'loading') {
      this.orbit += dt * 0.12;
      const a = c.yaw + 0.5 + Math.sin(this.orbit) * 0.22;
      const r = 7.6;
      cam.position.set(c.x + Math.sin(a) * r, c.y + 1.7, c.z + Math.cos(a) * r);
      cam.lookAt(c.x - Math.sin(c.yaw) * 3.5, c.y + 1.0, c.z - Math.cos(c.yaw) * 3.5);
      this.fov = lerp(this.fov, 48, 1 - Math.exp(-dt * 3));
      this.applyFov();
      return;
    }
    if (this.phase === 'finished' && this.time - this.finishAt > 0.4) {
      const a = c.yaw + Math.PI * 0.8 + (this.time - this.finishAt) * 0.35;
      const r = 8.5;
      const gy = groundY(track, c.x + Math.sin(a) * r, c.z + Math.cos(a) * r, false) + 1.4;
      cam.position.lerp(TMP.set(c.x + Math.sin(a) * r, Math.max(c.y + 2.0, gy), c.z + Math.cos(a) * r), 1 - Math.exp(-dt * 2.5));
      cam.lookAt(c.x, c.y + 1.0, c.z);
      this.fov = lerp(this.fov, 50, 1 - Math.exp(-dt * 3));
      this.applyFov();
      return;
    }
    // Chase: yaw eases toward a mix of the car's heading and its velocity so drifts show.
    const velYaw = c.speed > 3 ? Math.atan2(c.vx, c.vz) : c.yaw;
    const tgt = c.yaw + angDiff(c.yaw, velYaw) * 0.4 * smooth(3, 12, c.speed);
    this.camYaw += angDiff(this.camYaw, tgt) * (1 - Math.exp(-dt * (this.phase === 'countdown' ? 2 : 4.2)));
    this.camY = lerp(this.camY, c.y, 1 - Math.exp(-dt * 6));
    if (this.camMode === 1) {
      const sy2 = Math.sin(c.yaw);
      const cy2 = Math.cos(c.yaw);
      cam.position.set(c.x + sy2 * 0.55 + sx, c.y + c.bodyY + 1.28 + sy, c.z + cy2 * 0.55);
      const la = c.yaw + angDiff(c.yaw, velYaw) * 0.25;
      cam.up.set(0, 1, 0);
      cam.lookAt(c.x + Math.sin(la) * 30, c.y + 1.15 + c.pitch * -10, c.z + Math.cos(la) * 30);
      cam.rotateZ(c.roll * 0.4);
    } else {
      const dist = 7.4 + speed01 * 1.2 + (c.nitroOn ? 0.8 : 0);
      const h = 2.55 + speed01 * 0.25;
      let px = c.x - Math.sin(this.camYaw) * dist;
      const pz = c.z - Math.cos(this.camYaw) * dist;
      let py = this.camY + h;
      const g = groundY(track, px, pz, false) + 1.0;
      if (py < g) py = g;
      px += sx;
      py += sy;
      const target = TMP.set(c.x + Math.sin(this.camYaw) * 5.5, this.camY + 1.15, c.z + Math.cos(this.camYaw) * 5.5);
      // Countdown: swing from the menu orbit round to behind the car.
      if (this.phase === 'countdown') {
        const k = smooth(0, 2.7, this.countT);
        const a = c.yaw + 0.5 + Math.sin(this.orbit) * 0.22;
        const ox = c.x + Math.sin(a) * 7.6;
        const oz = c.z + Math.cos(a) * 7.6;
        const oy = c.y + 2.3;
        cam.position.set(lerp(ox, px, k), lerp(oy, py, k), lerp(oz, pz, k));
      } else cam.position.set(px, py, pz);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      cam.rotateZ(-c.steerIn * 0.012 * speed01 - clamp(c.lat * 0.004, -0.04, 0.04) + sx * 0.3);
    }
    this.fov = lerp(this.fov, fovT, 1 - Math.exp(-dt * 3.5));
    this.applyFov();
  }

  private applyFov() {
    // Portrait screens need a wider lens to keep the road in view.
    const a = this.camera.aspect;
    const k = a < 1.3 ? Math.min(1.45, Math.pow(1.3 / a, 0.45)) : 1;
    const f = this.fov * k;
    if (Math.abs(this.camera.fov - f) > 0.01) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateLights() {
    const p = this.car;
    if (this.csm) {
      this.csm.lightDirection.copy(this.sunDir).negate();
      this.csm.update();
    } else {
      const sun = this.sun;
      TMP.set(p.x, p.y, p.z);
      sun.target.position.copy(TMP);
      sun.position.copy(TMP).addScaledVector(this.sunDir, 150);
      sun.target.updateMatrixWorld();
    }
    if (this.grade) {
      const u = this.grade.uniforms;
      u.uSpeed.value = lerp(u.uSpeed.value, clamp(p.speed / 50, 0, 1), 0.1);
      u.uNitro.value = lerp(u.uNitro.value, p.nitroOn ? 1 : 0, 0.15);
      u.uHit.value = Math.max(p.impact * 0.7, u.uHit.value * 0.9);
      u.uTime.value = this.time % 10;
      // Sun position on screen (for rays and flare).
      TMP.copy(this.camera.position).addScaledVector(this.sunDir, 1000).project(this.camera);
      u.uSunUv.value.set(TMP.x * 0.5 + 0.5, TMP.y * 0.5 + 0.5);
      u.uSunOn.value = TMP.z < 1 && Math.abs(TMP.x) < 1.6 && Math.abs(TMP.y) < 1.6 ? 1 : 0;
    }
    if (this.bokeh) {
      const menu = this.phase === 'menu' || this.phase === 'loading';
      this.bokeh.enabled = menu;
      if (menu) {
        const u = (this.bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
        u.focus.value = this.camera.position.distanceTo(TMP.set(p.x, p.y + 1, p.z));
      }
    }
  }

  private renderFrame() {
    if (this.composer && this.fxLevel > 0) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.audioTick();
  }

  private audioTick() {
    const c = this.car;
    this.audio.update({
      rpm: c.rpm,
      throttle: this.phase === 'racing' ? this.lastThrottle : 0.1,
      speed: c.speed,
      surf: c.surf,
      skid: Math.max(c.skid, c.front),
      slide: Math.abs(c.slip),
      nitro: c.nitroOn,
      air: c.air > 0.15,
      on: this.phase === 'racing' || this.phase === 'countdown' || this.phase === 'finished',
    });
  }

  // ───────────── Adaptive quality ─────────────

  private perf(dt: number) {
    this.frameMs = lerp(this.frameMs, dt * 1000, 0.05);
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
      this.opts.cb.onPerf?.({ fps: Math.round(1000 / Math.max(1, this.frameMs)), level: this.fxLevel, dpr: this.dpr });
    }
  }

  /** Slow machine: drop SSAO, then resolution, then post. */
  private degrade() {
    if (this.fxLevel >= 3) {
      this.fxLevel = 2;
      this.buildComposer();
    } else if (this.dpr > 1.05) {
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

  // ───────────── HUD ─────────────

  private emitHud() {
    const c = this.car;
    const t = this.raceT + this.penalty;
    let ahead = 0;
    for (const r of this.rivals) if (r.s > this.near.s + 1) ahead++;
    for (const r of this.remotes) if (!r.gone && r.s > this.near.s + 1) ahead++;
    let delta: number | null = null;
    let deltaName = '';
    if (this.phase === 'racing') {
      const l = this.leaderTimeAt(clamp(this.near.s, START_S, this.finishS));
      if (l && this.near.s > START_S + 40) {
        delta = t - l.t;
        deltaName = l.name;
      }
    }
    const tfx = this.track.tx[this.near.i];
    const tfz = this.track.tz[this.near.i];
    this.opts.cb.onHud({
      kmh: Math.abs(c.fwd) * 3.6,
      gear: c.gear,
      rpm: c.rpm,
      nitro: c.nitro,
      nitroOn: c.nitroOn,
      time: t,
      pos: 1 + ahead,
      total: this.rivals.length + this.remotes.filter((r) => !r.gone).length + 1,
      progress: clamp((this.near.s - START_S) / (this.finishS - START_S), 0, 1),
      drift: c.driftPts,
      penalty: this.penalty,
      delta,
      deltaName,
      air: c.air > 0.2,
      drifting: c.drifting,
      wrongWay: Math.sin(c.yaw) * tfx + Math.cos(c.yaw) * tfz < -0.3 && c.speed > 4,
    });
  }

  private emitMap() {
    this.opts.cb.onMap({
      px: this.car.x,
      pz: this.car.z,
      yaw: this.car.yaw,
      rivals: this.rivals.map((r) => ({ x: r.x, z: r.z, c: r.spec.color })),
      coins: this.coins.filter((k) => k.active).map((k) => ({ x: k.x, z: k.z })),
    });
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
      this.skids?.dispose();
      this.parts?.dispose();
      this.snow?.dispose();
      for (const d of this.disposables) {
        try {
          d.dispose();
        } catch {
          /* already gone */
        }
      }
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry && !this.coinGeo.includes(m.geometry)) m.geometry.dispose?.();
      });
      this.csm?.dispose();
      this.dirtTex?.dispose();
      this.player?.dispose();
      for (const r of this.rivals) r.rig.dispose();
      for (const r of this.remotes) r.rig.dispose();
      this.factory?.dispose();
      this.hdrSky?.dispose();
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

export { STAGES, CARS };
