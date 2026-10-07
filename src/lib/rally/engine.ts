/**
 * Token Rally engine: renderer, post, cars, rivals, race logic. React only drives the menu/HUD
 * overlays through callbacks; everything per-frame lives here (no setState in the loop).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { FeedTx } from '@/lib/feed';
import { KINDS } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';
import { sfx } from '@/lib/sfx';
import { RallyAudio } from './audio';
import { newCar, stepCar, WHEELS, type CarInput, type CarState, type CarWorld } from './car';
import { Input, type Touch } from './input';
import { clamp, lerp, rng, smooth } from './noise';
import { detailOf, pickRivals, type RivalSpec } from './rivals';
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
};

type RivalRun = {
  spec: RivalSpec;
  root: THREE.Group;
  wheels: THREE.Group[];
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
};

type Coin = { group: THREE.Group; beam: THREE.Mesh; mat: THREE.MeshStandardMaterial; active: boolean; s: number; lat: number; x: number; z: number; y: number; t: number; kind: string };

const TMP = new THREE.Vector3();
const COUNT = 7; // rivals
const START_S = 46;
/** Grid slots relative to the player (metres along the road): the fastest rivals start ahead, the rest behind. */
const GRID = [34, 22, 11, -9, -18, -27, -36];

const angDiff = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uSpeed: { value: 0 }, uNitro: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 }, uWarm: { value: 0.5 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed; uniform float uNitro; uniform float uHit; uniform float uTime; uniform float uWarm; varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r = length(d);
      float blur = (uSpeed * 0.035 + uNitro * 0.05) * smoothstep(0.12, 0.75, r);
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 7; i++) {
        float k = float(i) / 6.0;
        vec2 o = d * (1.0 - blur * k);
        float w = 1.0 - k * 0.5;
        // chromatic split grows with the blur and toward the edges
        float ca = (uSpeed * 0.0025 + uHit * 0.004 + uNitro * 0.003) * r * (0.4 + k);
        col += vec3(texture2D(tDiffuse, o + 0.5 + normalize(d + 1e-5) * ca).r, texture2D(tDiffuse, o + 0.5).g, texture2D(tDiffuse, o + 0.5 - normalize(d + 1e-5) * ca).b) * w;
        wsum += w;
      }
      col /= wsum;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // grade: gentle saturation, teal lift in shadows, warm highlights
      col = mix(vec3(l), col, 1.1);
      col *= mix(vec3(0.97, 1.0, 1.04), vec3(1.0), smoothstep(0.0, 0.35, l));
      col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.6, 2.0, l) * uWarm);
      float vig = smoothstep(1.05, 0.28, r * (1.0 + uSpeed * 0.35));
      col *= mix(1.0, vig, 0.42 + uSpeed * 0.2);
      col = mix(col, col * vec3(1.35, 0.55, 0.5), uHit * smoothstep(0.2, 0.8, r));
      col += (rnd(vUv * 900.0) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

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
  private sunDir = new THREE.Vector3(0.4, 0.7, 0.3).normalize();
  private pmrem!: THREE.PMREMGenerator;
  private disposables: { dispose(): void }[] = [];
  private input = new Input();
  private audio = new RallyAudio();
  private skids!: Skids;
  private parts!: Particles;
  private snow: Snow | null = null;
  private obstacles!: Obstacles;
  private carSpec: CarSpec;
  private cars = new Map<string, Promise<THREE.Group>>();
  private paintCache = new Map<THREE.Texture | null, THREE.Material>();
  private player!: { root: THREE.Group; wheels: THREE.Group[] };
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
  private visHandler = () => {
    if (document.hidden && this.phase === 'racing') this.pause(true);
  };

  constructor(el: HTMLElement, opts: Options) {
    this.el = el;
    this.opts = opts;
    this.quality = opts.quality;
    this.maxDpr = opts.maxDpr ?? (opts.quality === 'high' ? 1.75 : 1.1);
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
    const hi = this.quality === 'high';
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
    this.sun = new THREE.DirectionalLight(st.id === 'desert' ? '#ffd9a8' : st.id === 'snow' ? '#e8f0ff' : '#fff2dc', st.id === 'snow' ? 1.9 : st.id === 'desert' ? 2.8 : 2.3);
    this.sun.castShadow = true;
    const ss = hi ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ss, ss);
    const ext = hi ? 56 : 42;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 360 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.07;
    this.scene.add(this.sun, this.sun.target);
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
    this.disposables.push({ dispose: () => sc.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()) }, ...Object.values(mats));

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
    this.player = await this.makeCar(this.carSpec.model, this.carSpec.scale);
    if (this.disposed) return;
    this.scene.add(this.player.root);
    cb.onLoading('Reading the chain for rivals', 0.78);
    await this.makeRivals();
    if (this.disposed) return;

    this.buildComposer();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.input.attach();
    document.addEventListener('visibilitychange', this.visHandler);
    this.resetCars();
    cb.onLoading('Ready', 1);
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

  private loadCarGltf(model: string) {
    let p = this.cars.get(model);
    if (!p) {
      p = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/rally/cars/${model}.glb`).then((g) => g.scene);
      this.cars.set(model, p);
    }
    return p;
  }

  private paint(m: THREE.Material): THREE.Material {
    const map = (m as THREE.MeshStandardMaterial).map ?? null;
    let p = this.paintCache.get(map);
    if (!p) {
      p = new THREE.MeshPhysicalMaterial({ map, roughness: 0.58, metalness: 0.1, clearcoat: 0.2, clearcoatRoughness: 0.35, envMapIntensity: 0.75 });
      this.paintCache.set(map, p);
      this.disposables.push(p);
    }
    return p;
  }

  private async makeCar(model: string, scale: number) {
    const src = await this.loadCarGltf(model);
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const m = src.clone(true);
    m.scale.setScalar(scale);
    root.add(m);
    const wheels: THREE.Group[] = [];
    for (const n of ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right']) {
      const node = m.getObjectByName(n);
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      if (node) {
        pivot.position.copy(node.position);
        node.position.set(0, 0, 0);
        pivot.add(node);
      }
      m.add(pivot);
      wheels.push(pivot);
    }
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((x) => this.paint(x)) : this.paint(mesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return { root, wheels };
  }

  private async makeRivals() {
    const { rivals, live } = pickRivals(this.opts.take, COUNT, this.stage.seed * 31 + (Date.now() % 1000));
    this.liveRivals = live;
    const track = this.track;
    this.rivals = [];
    const models = [...new Set(rivals.map((r) => r.model))];
    await Promise.all(models.map((m) => this.loadCarGltf(m).catch(() => null)));
    // Fastest machines take the front of the grid.
    rivals.sort((a, b) => b.skill - a.skill);
    rivals.forEach((r, i) => (r.slot = i));
    for (const spec of rivals) {
      const c = await this.makeCar(spec.model, 1.55).catch(() => null);
      if (!c) continue;
      const label = this.makeLabel();
      c.root.add(label.sprite);
      this.scene.add(c.root);
      const s0 = Math.max(3, START_S + (GRID[spec.slot] ?? -40));
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
        wheels: c.wheels,
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
    sprite.position.set(0, 3.3, 0);
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
    if (this.fxLevel >= 3) {
      const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.5, scale: 1, samples: 10, distanceFallOff: 1 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
      gtao.blendIntensity = 0.75;
      comp.addPass(gtao);
      this.gtao = gtao;
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.fxLevel >= 2 ? 0.26 : 0.2, 0.55, 2.2);
    comp.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE_SHADER);
    this.grade.uniforms.uWarm.value = this.stage.id === 'snow' ? 0.1 : 0.6;
    comp.addPass(this.grade);
    comp.addPass(new OutputPass());
    comp.setPixelRatio(this.dpr);
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    comp.setSize(w, h);
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
  }

  // ───────────── Control ─────────────

  private placeOnGrid() {
    const track = this.track;
    const c = this.car;
    const p = { x: 0, y: 0, z: 0, yaw: 0 };
    pointAt(track, START_S, 0, p);
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
    this.driftShown = 0;
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
    this.skids.clear();
    this.syncCarMesh();
    this.nearUpdate();
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
    for (const r of this.rivals) {
      this.scene.remove(r.root);
      r.labelTex.dispose();
      (r.label.material as THREE.Material).dispose();
    }
    await this.makeRivals();
    this.resetCars();
    this.setPhase('menu');
  }

  pause(on: boolean) {
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
    return { car: this.car, near: this.near, roadYaw: Math.atan2(this.track.tx[this.near.i], this.track.tz[this.near.i]), hits: this.hits, riv: this.rivals.map((r) => [+r.x.toFixed(1), +r.z.toFixed(1), +r.s.toFixed(0), +r.lat.toFixed(1)]), raceT: this.raceT, phase: this.phase, fx: this.fxLevel, ms: this.frameMs, rivals: this.rivals.length, live: this.liveRivals, finish: this.result };
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
        setTimeout(() => this.opts.cb.onCount(null), 900);
      }
    }
    const live = this.phase === 'racing' || this.phase === 'finished' || this.phase === 'countdown' || this.phase === 'menu';
    if (!frozen && live) {
      let ci: CarInput = { throttle: 0, brake: 0, steer: 0, hand: false, nitro: false };
      if (racing) ci = this.debugInput ?? (this.autopilot ? this.drive() : inp);
      else if (this.phase === 'finished') ci = { throttle: 0, brake: 0.55, steer: 0, hand: false, nitro: false };
      else if (this.phase === 'countdown') ci = { throttle: inp.throttle * 0.0, brake: 0, steer: 0, hand: false, nitro: false };
      this.lastThrottle = ci.throttle;
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
      this.updateRacing(dt);
    }
    this.syncCarMesh();
    this.effects(dt);
    this.updateCamera(dt);
    this.updateLights();
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
      r.wheels.forEach((w, i) => {
        w.rotation.x = r.spin;
        if (i < 2) w.rotation.y = clamp(tr.kappa[clamp(Math.round(r.s / STEP), 0, tr.n - 1)] * 2.6, -0.4, 0.4);
      });
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
    sfx('level');
    this.setPhase('finished');
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
      w[i].rotation.x = c.wheelSpin;
      if (i < 2) w[i].rotation.y = c.steerAngle;
    }
  }

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
    const sun = this.sun;
    TMP.set(p.x, p.y, p.z);
    sun.target.position.copy(TMP);
    sun.position.copy(TMP).addScaledVector(this.sunDir, 150);
    sun.target.updateMatrixWorld();
    if (this.grade) {
      const u = this.grade.uniforms;
      u.uSpeed.value = lerp(u.uSpeed.value, clamp(p.speed / 50, 0, 1), 0.1);
      u.uNitro.value = lerp(u.uNitro.value, p.nitroOn ? 1 : 0, 0.15);
      u.uHit.value = Math.max(p.impact * 0.7, u.uHit.value * 0.9);
      u.uTime.value = this.time % 10;
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
      total: this.rivals.length + 1,
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
