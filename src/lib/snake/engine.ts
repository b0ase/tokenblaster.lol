/**
 * Token Snake 3D engine: a glossy segmented snake gliding through a neon arena. The rules live in sim.ts (whole-cell
 * steps); this file turns them into smooth motion (the body is a rounded polyline sampled into beads), builds the
 * world (floor, walls, towers, sky), the food / power-up / block views, particles, camera, post and quality.
 * The React shell is src/components/TokenSnake.tsx.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { FeedTx } from '../feed';
import { lootFrom, type Loot } from '../loot';
import { sfx } from '../sfx';
import { tokenMeta } from '../tokenMeta';
import { blockLabel, coinFace, DEFAULT_FONTS, floorMaterial, glowTexture, neonEnvironment, PAL, posterTexture, skyMaterial, tagTexture, towerMaterial, wallMaterial, type Fonts } from './art';
import { drawPopups, Rings, Sparks, type Popup } from './fx';
import { SnakeInput } from './input';
import { DX, DY, LIVES, N, POWER_SECS, SnakeSim, turnLeft, turnRight, type Block, type Dir, type Food, type FoodKind, type FoodSpec, type Power, type PowerType, type SimEvent, type Supply } from './sim';

export type Quality = 'low' | 'high';
export type CamMode = 'angle' | 'chase' | 'top';
export type Phase = 'ready' | 'play' | 'paused' | 'over';
export type Toast = { text: string; tone: 'good' | 'bad' | 'gold' | 'info' };
export type Hud = {
  score: number;
  length: number;
  combo: number;
  mult: number;
  comboFrac: number;
  lives: number;
  bites: number;
  speed: number;
  fx: Record<PowerType | 'shield', number>;
  fxMax: Record<PowerType, number>;
  camMode: CamMode;
};
export type RunResult = { score: number; length: number; bites: number; chainBites: number; maxCombo: number; cause: string };
export type Cb = {
  onHud(h: Hud): void;
  onPhase(p: Phase): void;
  onToast(t: Toast): void;
  onPickup(l: Loot): void;
  onOver(r: RunResult): void;
  onPerf?(i: { fps: number; level: number }): void;
  onNeedAmmo?(): void;
};
export type Options = { quality: Quality; supply: Supply; cb: Cb; fonts?: Fonts; mini?: HTMLCanvasElement | null; touchDevice?: boolean; camMode?: CamMode;
  /** LIVE mode: called for every paid action (a bite or a power-up); the shell queues one real tx for it. */
  pay?: (action: string[]) => void;
  /** LIVE mode: false when the loaded ammo cannot cover the next actions (the game pauses until it can). */
  canPay?: () => boolean };

/** The chain's tx -> a food spec for the sim. */
export function foodFromTx(f: FeedTx): FoodSpec {
  return { kind: f.kind, bytes: f.bytes, sats: f.sats, id: f.id, loot: lootFrom(f) };
}

const KIND_COLOR: Record<FoodKind, number> = { blast: 0xffcf4a, token: 0xe8b53a, inscription: 0xff4d3a, social: 0xff8f7a, data: 0xd23a2e, payment: 0xffe0d2, quiet: 0x6a1c1c };
export const KIND_CSS: Record<FoodKind, string> = { blast: '#ffcf4a', token: '#e8b53a', inscription: '#ff4d3a', social: '#ff8f7a', data: '#d23a2e', payment: '#ffe0d2', quiet: '#6a1c1c' };
const POWER_COLOR: Record<PowerType, number> = { overdrive: PAL.amber, ghost: PAL.magenta, magnet: 0x6f9bff };
export const POWER_NAME: Record<PowerType, string> = { overdrive: 'OVERDRIVE', ghost: 'PHASE', magnet: 'MAGNET' };

const wx = (cx: number) => cx - N / 2 + 0.5;
const wz = (cy: number) => cy - N / 2 + 0.5;
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const MAXB = 1700;
const MAXC = 420;

const GRADE = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uHit: { value: 0 },
    uFlash: { value: 0 },
    uBoost: { value: 0 },
    uGhost: { value: 0 },
    uAspect: { value: 1.6 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uHit; uniform float uFlash; uniform float uBoost; uniform float uGhost; uniform float uAspect;
    varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      d.x *= uAspect * 0.62;
      float r = length(d);
      vec2 n = normalize(vUv - 0.5 + 1e-5);
      float ca = (0.0012 + uBoost * 0.004 + uHit * 0.012 + uFlash * 0.006) * (0.25 + r * 1.6);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + n * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - n * ca).b;
      float vig = smoothstep(0.95, 0.2, r);
      col *= mix(0.62, 1.0, vig);
      col = mix(col, col * vec3(1.6, 0.35, 0.3), uHit * smoothstep(0.1, 0.7, r));
      col += uFlash * vec3(1.0, 0.78, 0.3) * (0.18 + 0.5 * smoothstep(0.7, 0.0, r));
      col = mix(col, col * vec3(1.15, 0.55, 1.3) + vec3(0.03, 0.0, 0.05), uGhost * 0.55);
      col += uBoost * vec3(0.03, 0.02, 0.0) * smoothstep(0.25, 0.7, r);
      col += (rnd(vUv * 1000.0) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

type FoodView = {
  uid: number;
  kind: FoodKind;
  g: THREE.Group;
  core: THREE.Object3D;
  halo: THREE.Sprite;
  ring: THREE.Mesh;
  beam: THREE.Mesh | null;
  pos: THREE.Vector3;
  born: number;
  r: number;
  spin: number;
  tex: THREE.CanvasTexture | null;
  loot: Loot | null;
  own: (THREE.Material | THREE.Texture)[];
  leaving: number;
};
type PowerView = { uid: number; type: PowerType; g: THREE.Group; ring: THREE.Mesh; core: THREE.Mesh; born: number; own: THREE.Material[] };
type BlockView = { uid: number; g: THREE.Group; born: number; h: number; gone: number; own: (THREE.Material | THREE.Texture)[]; label: string };

function chaikin(src: Float32Array, n: number, dst: Float32Array): number {
  let m = 1;
  dst[0] = src[0];
  dst[1] = src[1];
  for (let i = 0; i < n - 1; i++) {
    const ax = src[2 * i];
    const ay = src[2 * i + 1];
    const bx = src[2 * i + 2];
    const by = src[2 * i + 3];
    if (i > 0) {
      dst[2 * m] = 0.75 * ax + 0.25 * bx;
      dst[2 * m + 1] = 0.75 * ay + 0.25 * by;
      m++;
    }
    if (i < n - 2) {
      dst[2 * m] = 0.25 * ax + 0.75 * bx;
      dst[2 * m + 1] = 0.25 * ay + 0.75 * by;
      m++;
    }
  }
  dst[2 * m] = src[2 * (n - 1)];
  dst[2 * m + 1] = src[2 * (n - 1) + 1];
  return m + 1;
}

export class SnakeEngine {
  readonly el: HTMLElement;
  private opts: Options;
  private fonts: Fonts;
  readonly input = new SnakeInput();
  sim: SnakeSim;
  private demo = true;
  private live = false;
  phase: Phase = 'ready';
  camMode: CamMode;
  private disposed = false;

  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private grade!: ShaderPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(52, 1.6, 0.1, 500);
  private overlay!: HTMLCanvasElement;
  private octx!: CanvasRenderingContext2D;
  private ro?: ResizeObserver;
  private quality: Quality;
  private fxLevel = 2;
  private dpr = 1;
  private maxDpr = 1.5;
  private w = 1;
  private h = 1;

  // world
  private floorMat!: THREE.ShaderMaterial;
  private wallMat!: THREE.ShaderMaterial;
  private skyMat!: THREE.ShaderMaterial;
  private towerMat!: THREE.ShaderMaterial;
  private sparks!: Sparks;
  private rings!: Rings;
  private glowTex!: THREE.CanvasTexture;
  private envTex: THREE.Texture | null = null;
  private headLight!: THREE.PointLight;
  private fogCol = new THREE.Color(0x07070b);

  // snake
  private beads!: THREE.InstancedMesh;
  private spine!: THREE.InstancedMesh;
  private under!: THREE.InstancedMesh;
  private headG!: THREE.Group;
  private tongue!: THREE.Group;
  private headMats: THREE.Material[] = [];
  private beadMat!: THREE.MeshPhysicalMaterial;
  private shieldMesh!: THREE.Mesh;
  private rawA = new Float32Array(2 * (MAXC + 8));
  private rawB = new Float32Array(2 * (MAXC * 4 + 16));
  private rawC = new Float32Array(2 * (MAXC * 4 + 16));
  private rawBrk = new Uint8Array(MAXC + 8);
  private cum = new Float32Array(MAXC * 4 + 16);
  private bx = new Float32Array(MAXB);
  private bz = new Float32Array(MAXB);
  private bd = new Float32Array(MAXB);
  private nb = 0;
  private bodyLen = 0;
  private bulges: { d: number; a: number }[] = [];
  private headPos = new THREE.Vector3();
  private headDir = new THREE.Vector2(1, 0);
  private headYaw = 0;
  private prevYaw = 0;
  private turnVel = 0;
  private dummy = new THREE.Object3D();
  private tmpC = new THREE.Color();
  private bead = 0.3;

  // views
  private foodViews = new Map<number, FoodView>();
  private powerViews = new Map<number, PowerView>();
  private blockViews = new Map<number, BlockView>();
  private leaving: FoodView[] = [];
  private shared!: {
    ico: THREE.BufferGeometry;
    octa: THREE.BufferGeometry;
    dodeca: THREE.BufferGeometry;
    box: THREE.BufferGeometry;
    sphere: THREE.BufferGeometry;
    coin: THREE.BufferGeometry;
    rim: THREE.BufferGeometry;
    beam: THREE.BufferGeometry;
    ringFlat: THREE.BufferGeometry;
    torus: THREE.BufferGeometry;
    mono: THREE.BufferGeometry;
    beamTex: THREE.CanvasTexture;
    tags: Record<PowerType, THREE.CanvasTexture>;
    gold: THREE.MeshStandardMaterial;
  };

  // camera + feel
  private focus = new THREE.Vector3();
  private camYaw = 0;
  private roll = 0;
  private shake = 0;
  private fovPunch = 0;
  private timeScale = 1;
  private slowT = 0;
  private flash = 0;
  private hit = 0;
  private beat = 0;
  private time = 0;
  private lastSpark = 0;
  private popups: Popup[] = [];
  private ripSlots = 0;
  private ripAge = new Float32Array(6).fill(-1);
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();

  // loop bookkeeping
  private last = 0;
  private hudT = 0;
  private miniT = 0;
  private frameMs = 16;
  private lowFrames = 0;
  private perfCool = 4;
  private perfT = 0;
  private maxCombo = 0;
  private lastLives = LIVES;
  private paused = false;
  private visHandler = () => {
    if (document.hidden && this.phase === 'play') this.pause(true);
  };
  private tokenIcons = new Set<number>();
  private blockLog: { height: number; txCount: number }[] = [];
  private lastBlockAt = 0;

  constructor(el: HTMLElement, opts: Options) {
    this.el = el;
    this.opts = opts;
    this.fonts = opts.fonts ?? DEFAULT_FONTS;
    this.quality = opts.quality;
    this.camMode = opts.camMode ?? 'angle';
    this.maxDpr = opts.quality === 'high' ? 1.75 : 1;
    this.sim = new SnakeSim(opts.supply);
  }

  // ───────────── Setup ─────────────

  async init() {
    const q = this.quality;
    const hi = q === 'high';
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    renderer.setPixelRatio(this.dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
    this.el.appendChild(renderer.domElement);
    const ov = document.createElement('canvas');
    ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    this.el.appendChild(ov);
    this.overlay = ov;
    this.octx = ov.getContext('2d')!;
    this.fxLevel = hi ? 2 : 1;
    try {
      await Promise.race([document.fonts.load(`900 40px ${this.fonts.display}`), new Promise((r) => setTimeout(r, 1200))]);
    } catch {
      /* fonts are best effort */
    }
    if (this.disposed) return;

    this.scene.background = this.fogCol;
    this.scene.fog = new THREE.FogExp2(0x07070b, 0.0085);
    this.envTex = neonEnvironment(renderer);
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.85;
    this.glowTex = glowTexture();
    this.sparks = new Sparks(hi ? 1100 : 420);
    this.rings = new Rings(10);
    this.buildShared();
    this.buildWorld();
    this.buildSnake();

    this.camera.position.set(0, 14, 12);
    this.focus.set(wx(this.sim.head.x), 0, wz(this.sim.head.y));
    this.scene.add(this.sparks.points, this.rings.group);
    this.buildComposer();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    document.addEventListener('visibilitychange', this.visHandler);
    this.input.attach(this.el);
    this.input.onDir = (d) => this.dirInput(d);
    this.input.onPause = () => {
      if (this.phase === 'play') this.pause(true);
      else if (this.phase === 'paused') this.pause(false);
    };
    this.input.onCam = () => this.cycleCam();
    this.last = performance.now();
    renderer.setAnimationLoop(this.frame);
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __tbSnake?: unknown }).__tbSnake = this;
  }

  private buildShared() {
    const bt = (() => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, '#000');
      gr.addColorStop(0.5, '#555');
      gr.addColorStop(1, '#fff');
      g.fillStyle = gr;
      g.fillRect(0, 0, 4, 64);
      return new THREE.CanvasTexture(c);
    })();
    const coin = new THREE.CylinderGeometry(1, 1, 0.16, 40);
    coin.rotateX(Math.PI / 2);
    const rim = new THREE.TorusGeometry(1, 0.075, 10, 48);
    this.shared = {
      ico: new THREE.IcosahedronGeometry(1, 0),
      octa: new THREE.OctahedronGeometry(1, 0),
      dodeca: new THREE.DodecahedronGeometry(1, 0),
      box: new THREE.BoxGeometry(1.5, 1.5, 1.5),
      sphere: new THREE.SphereGeometry(1, this.quality === 'high' ? 24 : 14, this.quality === 'high' ? 16 : 10),
      coin,
      rim,
      beam: new THREE.CylinderGeometry(0.05, 0.16, 1, 14, 1, true),
      ringFlat: new THREE.RingGeometry(0.82, 1, 40),
      torus: new THREE.TorusGeometry(1, 0.1, 8, 36),
      mono: new THREE.BoxGeometry(1, 1, 1),
      beamTex: bt,
      tags: {
        overdrive: tagTexture('OVERDRIVE', '#ffb800', this.fonts),
        ghost: tagTexture('PHASE', '#ff2f92', this.fonts),
        magnet: tagTexture('MAGNET', '#6f9bff', this.fonts),
      },
      gold: new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 1, roughness: 0.22, emissive: 0x5a3600, emissiveIntensity: 0.6 }),
    };
  }

  private buildWorld() {
    const hi = this.quality === 'high';
    // Sky + stars.
    this.skyMat = skyMaterial();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), this.skyMat);
    sky.renderOrder = -10;
    this.scene.add(sky);
    // Floor.
    this.floorMat = floorMaterial(N);
    this.floorMat.uniforms.uFog.value.copy(this.fogCol);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    // Walls.
    this.wallMat = wallMaterial();
    const wallH = 1.9;
    const wallGeo = new THREE.PlaneGeometry(N, wallH);
    const mk = (x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(wallGeo, this.wallMat);
      m.position.set(x, wallH / 2, z);
      m.rotation.y = ry;
      m.renderOrder = 4;
      this.scene.add(m);
    };
    mk(0, -N / 2, 0);
    mk(0, N / 2, Math.PI);
    mk(-N / 2, 0, Math.PI / 2);
    mk(N / 2, 0, -Math.PI / 2);
    // Corner pylons.
    const pyl = new THREE.MeshStandardMaterial({ color: 0x10101a, metalness: 0.8, roughness: 0.3, emissive: PAL.amber, emissiveIntensity: 0.25 });
    const cap = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.amber).multiplyScalar(1.4), toneMapped: false });
    const beamMat = new THREE.MeshBasicMaterial({ color: PAL.magenta, transparent: true, opacity: 0.35, alphaMap: this.shared.beamTex, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const g = new THREE.Group();
      g.position.set((x * N) / 2, 0, (z * N) / 2);
      const p = new THREE.Mesh(this.shared.mono, pyl);
      p.scale.set(0.55, 2.4, 0.55);
      p.position.y = 1.2;
      const c = new THREE.Mesh(this.shared.mono, cap);
      c.scale.set(0.62, 0.14, 0.62);
      c.position.y = 2.45;
      const b = new THREE.Mesh(this.shared.beam, beamMat);
      b.scale.set(2.2, 40, 2.2);
      b.position.y = 20;
      g.add(p, c, b);
      this.scene.add(g);
    }
    // Towers.
    this.towerMat = towerMaterial();
    this.towerMat.uniforms.uFog.value.copy(this.fogCol);
    const nT = hi ? 90 : 40;
    const towers = new THREE.InstancedMesh(this.shared.mono, this.towerMat, nT);
    const tints = [PAL.cyan, PAL.magenta, PAL.amber, PAL.blue, PAL.acid];
    const d = new THREE.Object3D();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < nT; i++) {
      const a = (i / nT) * Math.PI * 2 + rnd() * 0.05;
      const rad = 36 + rnd() * 70;
      const w = 4 + rnd() * 10;
      const hgt = 12 + Math.pow(rnd(), 1.6) * 90;
      d.position.set(Math.cos(a) * rad, hgt / 2 - 1, Math.sin(a) * rad);
      d.scale.set(w, hgt, 4 + rnd() * 8);
      d.rotation.y = rnd() * 3;
      d.updateMatrix();
      towers.setMatrixAt(i, d.matrix);
      towers.setColorAt(i, this.tmpC.setHex(tints[Math.floor(rnd() * tints.length)]));
    }
    this.scene.add(towers);
    // The far poster.
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(60, 22.5), new THREE.MeshBasicMaterial({ map: posterTexture(this.fonts), transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0.95 }));
    poster.position.set(0, 20, -62);
    this.scene.add(poster);
    // Lights.
    this.scene.add(new THREE.HemisphereLight(0x7fa0ff, 0x120818, 0.55));
    const key = new THREE.DirectionalLight(0xbfd8ff, 1.1);
    key.position.set(-10, 24, 8);
    this.scene.add(key);
    this.headLight = new THREE.PointLight(0x27e6ff, 6, 9, 1.8);
    this.headLight.position.set(0, 2.2, 0);
    this.scene.add(this.headLight);
    // Drifting dust.
    const dust = new THREE.BufferGeometry();
    const dn = hi ? 260 : 100;
    const dp = new Float32Array(dn * 3);
    for (let i = 0; i < dn; i++) {
      dp[i * 3] = (rnd() - 0.5) * 70;
      dp[i * 3 + 1] = 0.5 + rnd() * 9;
      dp[i * 3 + 2] = (rnd() - 0.5) * 70;
    }
    dust.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    const dustPts = new THREE.Points(dust, new THREE.PointsMaterial({ size: 0.12, color: 0x7fd8ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    dustPts.name = 'dust';
    this.scene.add(dustPts);
  }

  private buildSnake() {
    const hi = this.quality === 'high';
    this.bead = hi ? 0.27 : 0.36;
    const seg = hi ? 14 : 9;
    const geo = new THREE.SphereGeometry(1, seg + 4, seg);
    this.beadMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x021418, emissiveIntensity: 0.35, envMapIntensity: 0.6 });
    this.beads = new THREE.InstancedMesh(geo, this.beadMat, MAXB);
    this.beads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    this.beads.frustumCulled = false;
    this.beads.count = 0;
    this.scene.add(this.beads);
    this.spine = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshBasicMaterial({ toneMapped: false }), MAXB);
    this.spine.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    this.spine.frustumCulled = false;
    this.spine.count = 0;
    this.scene.add(this.spine);
    const ug = new THREE.PlaneGeometry(1, 1);
    ug.rotateX(-Math.PI / 2);
    this.under = new THREE.InstancedMesh(ug, new THREE.MeshBasicMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), MAXB);
    this.under.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    this.under.frustumCulled = false;
    this.under.count = 0;
    this.under.renderOrder = 2;
    this.scene.add(this.under);

    // Head: glossy skull, snout, visor, eyes, crest, tongue.
    const g = new THREE.Group();
    const skin = new THREE.MeshPhysicalMaterial({ color: 0x7fb59f, metalness: 0.35, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, emissive: 0x021a1a, emissiveIntensity: 0.25, envMapIntensity: 0.6 });
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x07090f, metalness: 0.9, roughness: 0.12, clearcoat: 1, envMapIntensity: 1.8 });
    const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.magenta).multiplyScalar(3.2), toneMapped: false });
    const crest = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.acid).multiplyScalar(2.6), toneMapped: false });
    this.headMats.push(skin, dark, eye, crest);
    const s = this.shared.sphere;
    const skull = new THREE.Mesh(s, skin);
    skull.scale.set(0.62, 0.46, 0.54);
    const snout = new THREE.Mesh(s, skin);
    snout.scale.set(0.44, 0.3, 0.36);
    snout.position.set(0.5, -0.04, 0);
    const visor = new THREE.Mesh(s, dark);
    visor.scale.set(0.5, 0.24, 0.56);
    visor.position.set(0.14, 0.12, 0);
    const eyeL = new THREE.Mesh(s, eye);
    eyeL.scale.set(0.16, 0.06, 0.1);
    eyeL.position.set(0.36, 0.2, 0.25);
    eyeL.rotation.y = -0.5;
    const eyeR = eyeL.clone();
    eyeR.position.z = -0.25;
    eyeR.rotation.y = 0.5;
    const fin = new THREE.Mesh(this.shared.mono, crest);
    fin.scale.set(0.7, 0.05, 0.06);
    fin.position.set(-0.12, 0.44, 0);
    const fin2 = fin.clone();
    fin2.scale.set(0.45, 0.04, 0.05);
    fin2.position.set(-0.42, 0.34, 0);
    g.add(skull, snout, visor, eyeL, eyeR, fin, fin2);
    const tg = new THREE.Group();
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.magenta).multiplyScalar(2), toneMapped: false });
    this.headMats.push(tm);
    const t1 = new THREE.Mesh(this.shared.mono, tm);
    t1.scale.set(0.5, 0.03, 0.04);
    t1.position.set(0.25, 0, 0);
    const t2 = new THREE.Mesh(this.shared.mono, tm);
    t2.scale.set(0.2, 0.03, 0.04);
    t2.position.set(0.55, 0, 0.07);
    t2.rotation.y = 0.6;
    const t3 = t2.clone();
    t3.position.z = -0.07;
    t3.rotation.y = -0.6;
    tg.add(t1, t2, t3);
    tg.position.set(0.9, -0.08, 0);
    g.add(tg);
    this.tongue = tg;
    this.headG = g;
    this.scene.add(g);
    // Shield / phase shell.
    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.magenta).multiplyScalar(1.6), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, wireframe: true }));
    this.shieldMesh.visible = false;
    this.scene.add(this.shieldMesh);
  }

  private buildComposer() {
    const r = this.renderer;
    this.composer?.dispose();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    const bs = this.fxLevel >= 2 ? 0.8 : 0.5;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bs, size.y * bs), this.fxLevel >= 2 ? 0.4 : 0.32, 0.55, 0.98);
    comp.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    comp.addPass(this.grade);
    comp.addPass(new OutputPass());
    if (this.fxLevel >= 2) comp.addPass(new SMAAPass());
    comp.setPixelRatio(this.dpr);
    comp.setSize(this.el.clientWidth || 1, this.el.clientHeight || 1);
    this.composer = comp;
  }

  resize() {
    if (!this.renderer) return;
    this.w = this.el.clientWidth || 1;
    this.h = this.el.clientHeight || 1;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(this.w, this.h);
    this.grade.uniforms.uAspect.value = this.w / this.h;
    this.overlay.width = Math.round(this.w * Math.min(this.dpr, 1.5));
    this.overlay.height = Math.round(this.h * Math.min(this.dpr, 1.5));
    this.sparks.mat.uniforms.uPx.value = (this.h * this.dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  // ───────────── Control ─────────────

  /** Start a game: a fresh sim fed by the live chain. */
  start(live = false) {
    this.live = live;
    this.demo = false;
    this.sim = new SnakeSim(this.opts.supply);
    this.seedBlocks();
    this.popups = [];
    this.maxCombo = 0;
    this.lastLives = LIVES;
    this.clearViews();
    this.input.capture = true;
    this.paused = false;
    this.hit = 0;
    this.flash = 0;
    this.timeScale = 1;
    this.setPhase('play');
    this.opts.cb.onToast({ text: 'GO', tone: 'good' });
    sfx('start');
    this.hudT = 0;
    this.pushHud();
  }
  /** Back to the title: the snake plays itself. */
  attract() {
    this.demo = true;
    this.sim = new SnakeSim(this.opts.supply);
    this.seedBlocks();
    this.clearViews();
    this.input.capture = false;
    this.setPhase('ready');
  }
  pause(on: boolean) {
    if (this.phase !== 'play' && this.phase !== 'paused') return;
    this.paused = on;
    this.input.capture = !on;
    this.setPhase(on ? 'paused' : 'play');
  }
  private setPhase(p: Phase) {
    this.phase = p;
    this.opts.cb.onPhase(p);
  }
  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.maxDpr = q === 'high' ? 1.75 : 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.fxLevel = q === 'high' ? 2 : 1;
    this.bead = q === 'high' ? 0.27 : 0.36;
    this.buildComposer();
    this.resize();
  }
  cycleCam() {
    const order: CamMode[] = ['angle', 'chase', 'top'];
    this.setCam(order[(order.indexOf(this.camMode) + 1) % 3]);
  }
  setCam(m: CamMode) {
    this.camMode = m;
    this.opts.cb.onToast({ text: m === 'angle' ? 'CAMERA · ANGLE' : m === 'chase' ? 'CAMERA · CHASE (turn left / right)' : 'CAMERA · TOP', tone: 'info' });
    this.pushHud();
  }
  /** A direction pressed on screen. In the chase camera left / right turn relative to the snake. */
  private dirInput(d: Dir) {
    if (this.phase !== 'play' || this.demo || this.sim.state !== 'play') return;
    if (this.camMode === 'chase') {
      if (d === 2) this.sim.turnRel(-1);
      else if (d === 0) this.sim.turnRel(1);
      return;
    }
    this.sim.turn(d);
  }
  private clearViews() {
    for (const v of this.foodViews.values()) this.dropFood(v);
    this.foodViews.clear();
    for (const v of this.leaving) this.dropFood(v);
    this.leaving = [];
    for (const v of this.powerViews.values()) this.dropPower(v);
    this.powerViews.clear();
    for (const v of this.blockViews.values()) this.dropBlock(v);
    this.blockViews.clear();
    this.bulges = [];
  }

  /** Add a landed block (a real chain block) as a monolith; the newest few are replayed into each new arena. */
  addBlock(height: number, txCount: number, replay = false) {
    if (!replay) {
      this.blockLog = this.blockLog.filter((b) => b.height !== height).concat({ height, txCount }).slice(-4);
      this.lastBlockAt = this.time;
    }
    const b = this.sim.addBlock(height, txCount, `#${height.toLocaleString('en-GB')}`);
    if (b && !this.demo && !replay) this.opts.cb.onToast({ text: `BLOCK ${height.toLocaleString('en-GB')} LANDED`, tone: 'info' });
  }
  private seedBlocks() {
    for (const b of this.blockLog.slice(-3)) this.sim.addBlock(b.height, b.txCount, `#${b.height.toLocaleString('en-GB')}`);
    this.sim.drain();
  }

  // ───────────── Views ─────────────

  private makeFood(f: Food): FoodView {
    const sh = this.shared;
    const col = new THREE.Color(KIND_COLOR[f.kind]);
    const g = new THREE.Group();
    const own: (THREE.Material | THREE.Texture)[] = [];
    const big = f.kind === 'token' || f.kind === 'blast';
    const r = f.kind === 'blast' ? 0.62 : f.kind === 'token' ? 0.5 : f.kind === 'quiet' ? 0.13 : 0.2 + 0.17 * Math.min(1, Math.log10(Math.max(100, f.bytes) / 100) / 2.6);
    let core: THREE.Object3D;
    let tex: THREE.CanvasTexture | null = null;
    if (f.kind === 'token') {
      const grp = new THREE.Group();
      const face = f.loot ? tokenMeta(f.loot.id) : null;
      tex = coinFace(face?.icon ?? null, f.loot?.sym ?? 'TKN', this.fonts);
      const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
      own.push(faceMat, tex);
      const disc = new THREE.Mesh(sh.coin, [sh.gold, faceMat, faceMat]);
      disc.scale.set(r, r, r);
      const rim = new THREE.Mesh(sh.rim, sh.gold);
      rim.scale.set(r * 1.02, r * 1.02, r * 1.6);
      grp.add(disc, rim);
      core = grp;
    } else if (f.kind === 'blast') {
      const grp = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color: 0xfff0b0, emissive: 0xffc533, emissiveIntensity: 2.4, metalness: 0.6, roughness: 0.2 });
      own.push(m);
      const a = new THREE.Mesh(sh.octa, m);
      a.scale.set(r * 0.8, r * 1.5, r * 0.8);
      const b = new THREE.Mesh(sh.octa, m);
      b.scale.set(r * 1.5, r * 0.8, r * 0.8);
      b.rotation.y = Math.PI / 4;
      const c = new THREE.Mesh(sh.octa, m);
      c.scale.set(r * 0.8, r * 0.8, r * 1.5);
      grp.add(a, b, c);
      core = grp;
    } else {
      const m = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.5), emissive: col, emissiveIntensity: f.kind === 'quiet' ? 0.5 : 1.25, metalness: 0.5, roughness: 0.28, flatShading: true });
      own.push(m);
      const geo = f.kind === 'data' ? sh.octa : f.kind === 'social' ? sh.dodeca : f.kind === 'inscription' ? sh.box : sh.ico;
      const mesh = new THREE.Mesh(geo, m);
      mesh.scale.setScalar(f.kind === 'inscription' ? r * 0.75 : r);
      core = mesh;
    }
    const hm = new THREE.SpriteMaterial({ map: this.glowTex, color: col.clone().multiplyScalar(big ? 1.8 : 1.15), transparent: true, opacity: big ? 0.85 : 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    own.push(hm);
    const halo = new THREE.Sprite(hm);
    const hs = f.kind === 'blast' ? 4.4 : f.kind === 'token' ? 2.7 : f.kind === 'quiet' ? 0.8 : 1.5 + r * 2;
    halo.scale.set(hs, hs, 1);
    const rm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    own.push(rm);
    const ring = new THREE.Mesh(sh.ringFlat, rm);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const rs = big ? 0.85 : 0.5;
    ring.scale.set(rs, rs, 1);
    let beam: THREE.Mesh | null = null;
    if (f.kind !== 'quiet') {
      const bm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), transparent: true, opacity: big ? 0.55 : 0.28, alphaMap: sh.beamTex, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      own.push(bm);
      beam = new THREE.Mesh(sh.beam, bm);
      const bh = big ? 14 : 4;
      beam.scale.set(big ? 1.5 : 0.9, bh, big ? 1.5 : 0.9);
      beam.position.y = bh / 2;
      g.add(beam);
    }
    const y = f.kind === 'quiet' ? 0.25 : 0.55 + r * 0.6;
    core.position.y = y;
    halo.position.y = y;
    g.add(core, halo, ring);
    g.position.set(wx(f.x), 0, wz(f.y));
    g.scale.setScalar(0.001);
    this.scene.add(g);
    return { uid: f.uid, kind: f.kind, g, core, halo, ring, beam, pos: g.position.clone(), born: this.time, r, spin: Math.random() * 6, tex, loot: f.loot, own, leaving: 0 };
  }
  private dropFood(v: FoodView) {
    this.scene.remove(v.g);
    for (const o of v.own) o.dispose();
  }

  private makePower(p: Power): PowerView {
    const sh = this.shared;
    const col = new THREE.Color(POWER_COLOR[p.type]);
    const g = new THREE.Group();
    const own: THREE.Material[] = [];
    const m = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.4), emissive: col, emissiveIntensity: 2.2, metalness: 0.7, roughness: 0.2, flatShading: true });
    const geo = p.type === 'overdrive' ? sh.octa : p.type === 'ghost' ? sh.ico : sh.dodeca;
    const core = new THREE.Mesh(geo, m);
    core.scale.setScalar(0.42);
    core.position.y = 0.95;
    const rm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.2), toneMapped: false });
    const ring = new THREE.Mesh(sh.torus, rm);
    ring.scale.setScalar(0.78);
    ring.position.y = 0.95;
    const hm = new THREE.SpriteMaterial({ map: this.glowTex, color: col.clone().multiplyScalar(1.6), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const halo = new THREE.Sprite(hm);
    halo.scale.set(3, 3, 1);
    halo.position.y = 0.95;
    const tm = new THREE.SpriteMaterial({ map: sh.tags[p.type], transparent: true, depthWrite: false, fog: false, toneMapped: false });
    const tag = new THREE.Sprite(tm);
    tag.scale.set(2.2, 0.55, 1);
    tag.position.y = 2.1;
    const bm = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), transparent: true, opacity: 0.4, alphaMap: sh.beamTex, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const beam = new THREE.Mesh(sh.beam, bm);
    beam.scale.set(1.1, 8, 1.1);
    beam.position.y = 4;
    own.push(m, rm, hm, tm, bm);
    g.add(core, ring, halo, tag, beam);
    g.position.set(wx(p.x), 0, wz(p.y));
    g.scale.setScalar(0.001);
    this.scene.add(g);
    return { uid: p.uid, type: p.type, g, ring, core, born: this.time, own };
  }
  private dropPower(v: PowerView) {
    this.scene.remove(v.g);
    for (const o of v.own) o.dispose();
  }

  private makeBlock(b: Block): BlockView {
    const sh = this.shared;
    const own: (THREE.Material | THREE.Texture)[] = [];
    const g = new THREE.Group();
    const label = blockLabel(b.label, b.txCount ? `${b.txCount.toLocaleString('en-GB')} TX` : b.label === 'PENDING' ? 'NEXT BLOCK' : 'BLOCK', this.fonts);
    const front = new THREE.MeshStandardMaterial({ map: label, emissiveMap: label, emissive: 0xffffff, emissiveIntensity: 0.3, metalness: 0.3, roughness: 0.4 });
    const side = new THREE.MeshPhysicalMaterial({ color: 0x0d0e16, metalness: 0.85, roughness: 0.18, clearcoat: 1, envMapIntensity: 1.6 });
    const top = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.amber).multiplyScalar(1.1), toneMapped: false });
    own.push(front, side, top, label);
    const mono = new THREE.Mesh(sh.mono, [side, side, top, side, front, side]);
    const w = b.w * 0.9;
    const d = b.h * 0.9;
    mono.scale.set(w, b.height, d);
    mono.position.y = b.height / 2;
    const em = new THREE.LineSegments(new THREE.EdgesGeometry(sh.mono), new THREE.LineBasicMaterial({ color: new THREE.Color(PAL.amber).multiplyScalar(2), toneMapped: false }));
    em.scale.copy(mono.scale);
    em.position.copy(mono.position);
    own.push(em.material as THREE.Material);
    g.add(mono, em);
    g.position.set(wx(b.x) + (b.w - 1) / 2, -b.height - 0.2, wz(b.y) + (b.h - 1) / 2);
    this.scene.add(g);
    // The edges geometry is per-block (cheap); dispose with the rest.
    own.push({ dispose: () => em.geometry.dispose() } as unknown as THREE.Material);
    return { uid: b.uid, g, born: this.time, h: b.height, gone: 0, own, label: b.label };
  }
  private dropBlock(v: BlockView) {
    this.scene.remove(v.g);
    for (const o of v.own) o.dispose();
  }

  private syncViews() {
    const sim = this.sim;
    const live = new Set<number>();
    for (const f of sim.foods) {
      live.add(f.uid);
      let v = this.foodViews.get(f.uid);
      if (!v) {
        v = this.makeFood(f);
        this.foodViews.set(f.uid, v);
        const c = this.tmpC.setHex(KIND_COLOR[f.kind]);
        if (f.kind !== 'quiet') {
          this.rings.fire(v.pos.x, 0.05, v.pos.z, c, 0.2, f.kind === 'blast' ? 3.2 : f.kind === 'token' ? 2 : 1.2, 0.5, 0.55);
          this.ripple(v.pos.x, v.pos.z, c, f.kind === 'blast' ? 0.9 : f.kind === 'token' ? 0.6 : 0.3);
        }
        if (f.kind === 'blast' && !this.demo) {
          this.opts.cb.onToast({ text: 'TOKENBLASTER BLAST ON THE BOARD', tone: 'gold' });
          sfx('sonar');
        } else if (f.kind === 'token' && !this.demo) sfx('click', 0.5);
      }
      v.pos.set(wx(f.x), 0, wz(f.y));
      if (f.loot && !this.tokenIcons.has(f.uid) && v.tex) {
        const m = tokenMeta(f.loot.id);
        if (m?.icon?.complete && m.icon.naturalWidth) {
          coinFace(m.icon, m.sym, this.fonts, v.tex);
          this.tokenIcons.add(f.uid);
        } else if (m && !m.icon) {
          coinFace(null, m.sym, this.fonts, v.tex);
          this.tokenIcons.add(f.uid);
        }
      }
    }
    for (const [uid, v] of this.foodViews) {
      if (!live.has(uid)) {
        this.foodViews.delete(uid);
        v.leaving = 0.0001;
        this.leaving.push(v);
      }
    }
    const lp = new Set<number>();
    for (const p of sim.powers) {
      lp.add(p.uid);
      if (!this.powerViews.has(p.uid)) {
        this.powerViews.set(p.uid, this.makePower(p));
        const c = this.tmpC.setHex(POWER_COLOR[p.type]);
        this.rings.fire(wx(p.x), 0.05, wz(p.y), c, 0.2, 3, 0.7, 0.9);
        if (!this.demo) sfx('sonar', 0.7);
      }
    }
    for (const [uid, v] of this.powerViews) {
      if (!lp.has(uid)) {
        this.dropPower(v);
        this.powerViews.delete(uid);
      }
    }
    const lb = new Set<number>();
    for (const b of sim.blocks) {
      lb.add(b.uid);
      if (!this.blockViews.has(b.uid)) {
        this.blockViews.set(b.uid, this.makeBlock(b));
      }
    }
    for (const [uid, v] of this.blockViews) {
      if (!lb.has(uid) && !v.gone) v.gone = 0.0001;
    }
  }

  private animateViews(dt: number) {
    const t = this.time;
    for (const v of this.foodViews.values()) {
      const age = t - v.born;
      const k = Math.min(1, age / 0.5);
      const s = easeOutBack(k);
      v.g.scale.setScalar(Math.max(0.001, s));
      v.g.position.x += (v.pos.x - v.g.position.x) * damp(14, dt);
      v.g.position.z += (v.pos.z - v.g.position.z) * damp(14, dt);
      this.animFood(v, t, dt);
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const v = this.leaving[i];
      v.leaving += dt;
      const k = v.leaving / 0.22;
      if (k >= 1) {
        this.dropFood(v);
        this.leaving.splice(i, 1);
        continue;
      }
      v.g.scale.setScalar(Math.max(0.001, 1 + k * 0.6));
      v.halo.material.opacity *= 0.7;
      if (v.beam) (v.beam.material as THREE.MeshBasicMaterial).opacity *= 0.75;
      this.animFood(v, t, dt);
    }
    for (const v of this.powerViews.values()) {
      const age = t - v.born;
      const p = this.sim.powers.find((x) => x.uid === v.uid);
      const blink = p && this.sim.time - p.bornT > 11 ? (Math.floor(t * 8) % 2 ? 0.3 : 1) : 1;
      v.g.scale.setScalar(Math.max(0.001, easeOutBack(Math.min(1, age / 0.5))) * blink);
      v.core.rotation.y += dt * 2.2;
      v.core.rotation.x += dt * 1.1;
      v.core.position.y = 0.95 + Math.sin(t * 2.4 + v.uid) * 0.14;
      v.ring.rotation.x = Math.PI / 2 + Math.sin(t * 1.5) * 0.5;
      v.ring.rotation.z += dt * 2.4;
      v.ring.position.y = v.core.position.y;
    }
    for (const [uid, v] of this.blockViews) {
      if (v.gone) {
        v.gone += dt;
        v.g.position.y -= dt * 4.5;
        if (v.gone > 0.8) {
          this.dropBlock(v);
          this.blockViews.delete(uid);
        }
        continue;
      }
      const age = t - v.born;
      if (age < 0.7) {
        const k = age / 0.7;
        const e = k * k * k;
        v.g.position.y = (-v.h - 0.2) * (1 - e);
        if (age + dt >= 0.7) this.blockLanded(v);
      } else v.g.position.y = 0;
    }
  }
  private blockLanded(v: BlockView) {
    const c = this.tmpC.setHex(PAL.amber);
    this.rings.fire(v.g.position.x, 0.05, v.g.position.z, c, 0.3, 6, 0.7, 1);
    this.ripple(v.g.position.x, v.g.position.z, c, 1.4);
    this.sparks.burst(v.g.position.x, 0.2, v.g.position.z, 26, 6, c, 0.7, 0.25, 8);
    this.shake = Math.max(this.shake, 0.18);
    if (!this.demo) sfx('stamp', 0.8);
  }
  private animFood(v: FoodView, t: number, dt: number) {
    v.spin += dt;
    const bob = Math.sin(t * 2.2 + v.born * 3) * 0.08;
    const baseY = v.kind === 'quiet' ? 0.25 : 0.55 + v.r * 0.6;
    v.core.position.y = baseY + bob;
    v.halo.position.y = v.core.position.y;
    const pulse = 0.85 + 0.15 * Math.sin(t * 5 + v.born);
    if (v.kind === 'token') {
      v.core.rotation.y = Math.sin(t * 1.7 + v.born) * 1.05;
      v.core.rotation.x = Math.sin(t * 1.1) * 0.12;
    } else if (v.kind === 'blast') {
      v.core.rotation.y += dt * 2.4;
      v.core.rotation.z += dt * 0.9;
      v.core.scale.setScalar(1 + 0.12 * Math.sin(t * 7));
    } else {
      v.core.rotation.y += dt * 1.6;
      v.core.rotation.x += dt * 0.7;
    }
    v.halo.scale.setScalar((v.kind === 'blast' ? 4.4 : v.kind === 'token' ? 2.7 : v.kind === 'quiet' ? 0.8 : 1.5 + v.r * 2) * pulse);
    const rs = (v.kind === 'blast' || v.kind === 'token' ? 0.85 : 0.5) * (0.9 + 0.2 * Math.sin(t * 3 + v.born));
    v.ring.scale.set(rs, rs, 1);
  }

  // ───────────── Effects ─────────────

  private ripple(x: number, z: number, c: THREE.Color, strength: number) {
    const i = this.ripSlots++ % 6;
    const u = this.floorMat.uniforms;
    (u.uRip.value as THREE.Vector4[])[i].set(x, z, 0, strength);
    (u.uRipCol.value as THREE.Color[])[i].copy(c);
    this.ripAge[i] = 0;
  }
  private popup(x: number, z: number, text: string, color: string, size = 26, y = 1.5, dur = 1.1, rise = 1.4) {
    if (this.popups.length > 14) this.popups.shift();
    this.popups.push({ x, y, z, t: 0, dur, text, color, size, rise });
  }
  private addShake(a: number) {
    this.shake = Math.min(1, Math.max(this.shake, a));
  }

  private handle(e: SimEvent) {
    const cb = this.opts.cb;
    const play = !this.demo;
    switch (e.t) {
      case 'eat': {
        const f = e.food;
        const x = wx(e.x);
        const z = wz(e.y);
        const col = this.tmpC.setHex(KIND_COLOR[f.kind]).clone();
        this.bulges.push({ d: 0, a: f.kind === 'blast' || f.kind === 'token' ? 1.4 : 1 });
        this.beat = 1;
        if (f.kind === 'blast') {
          // The big moment: hit-stop, shockwave, gold shower, flash, banner.
          this.slowT = 0.5;
          this.timeScale = 0.18;
          this.flash = 1;
          this.addShake(0.7);
          this.fovPunch = 14;
          this.rings.fire(x, 0.06, z, col, 0.3, 11, 1.0, 0.9);
          this.rings.fire(x, 0.9, z, col, 0.2, 6, 0.8, 0.6);
          this.ripple(x, z, col, 2.2);
          this.sparks.burst(x, 0.8, z, this.quality === 'high' ? 260 : 110, 14, col, 1.3, 0.45, 5);
          this.sparks.burst(x, 0.8, z, 60, 6, new THREE.Color(1, 1, 1), 0.9, 0.3, 3);
          this.popup(x, z, `BLAST +${e.pts.toLocaleString('en-GB')}`, '#ffe9a0', 44, 2.2, 1.6, 2.2);
          if (play) {
            cb.onToast({ text: `BLAST +${e.pts.toLocaleString('en-GB')}`, tone: 'gold' });
            sfx('pickup');
            sfx('level', 0.8);
          }
        } else if (f.kind === 'token') {
          this.addShake(0.2);
          this.flash = Math.max(this.flash, 0.18);
          this.rings.fire(x, 0.06, z, col, 0.3, 6, 0.7, 1);
          this.ripple(x, z, col, 1.3);
          this.sparks.burst(x, 0.8, z, this.quality === 'high' ? 70 : 34, 8, col, 1, 0.34, 9);
          this.popup(x, z, `+${e.pts.toLocaleString('en-GB')}${f.loot ? ' ' + (tokenMeta(f.loot.id)?.sym ?? f.loot.sym) : ''}`, '#ffd36a', 32, 1.8, 1.3, 1.8);
          if (play) {
            if (f.loot) cb.onPickup(f.loot);
            sfx('token');
          }
        } else {
          this.addShake(0.05);
          this.rings.fire(x, 0.06, z, col, 0.2, 2.6, 0.45, 0.8);
          this.ripple(x, z, col, 0.5);
          this.sparks.burst(x, 0.6, z, this.quality === 'high' ? 22 : 12, 5, col, 0.6, 0.22, 8);
          this.popup(x, z, `+${e.pts}`, e.mult > 1 ? '#c8ff1a' : '#ffffff', e.mult > 1 ? 24 : 20);
          if (play) sfx('coin', 0.7 + Math.min(0.3, e.combo * 0.02));
        }
        if (play && this.live) this.opts.pay?.(['snake', 'bite', f.kind]);
        if (e.combo > this.maxCombo) this.maxCombo = e.combo;
        if (play && e.combo > 1 && e.combo % 4 === 0) {
          const m = Math.min(8, 1 + Math.floor(e.combo / 4));
          cb.onToast({ text: `COMBO x${m}`, tone: 'good' });
          sfx('level', 0.6);
          this.popup(x, z, `x${m}`, '#27e6ff', 38, 2.6, 1.2, 1.2);
        }
        break;
      }
      case 'power': {
        const p = e.power;
        const c = this.tmpC.setHex(POWER_COLOR[p.type]).clone();
        const x = wx(p.x);
        const z = wz(p.y);
        this.rings.fire(x, 0.06, z, c, 0.3, 10, 0.9, 1);
        this.sparks.burst(x, 1, z, 60, 9, c, 1, 0.34, 4);
        this.flash = Math.max(this.flash, 0.3);
        this.addShake(0.25);
        this.popup(x, z, POWER_NAME[p.type], '#ffffff', 34, 2.4, 1.4, 1.6);
        if (play && this.live) this.opts.pay?.(['snake', 'power', p.type]);
        if (play) {
          cb.onToast({ text: `${POWER_NAME[p.type]} · ${POWER_SECS[p.type]}s`, tone: 'good' });
          sfx('pickup');
        }
        break;
      }
      case 'powerEnd':
        if (play) cb.onToast({ text: `${POWER_NAME[e.type]} OVER`, tone: 'info' });
        break;
      case 'block':
        break;
      case 'blockGone':
        break;
      case 'comboLost':
        if (play && e.combo >= 4) {
          cb.onToast({ text: 'COMBO LOST', tone: 'bad' });
        }
        break;
      case 'turn':
        break;
      case 'wrap': {
        const c = this.tmpC.setHex(PAL.magenta);
        this.rings.fire(this.headPos.x, 0.5, this.headPos.z, c, 0.3, 5, 0.5, 1);
        this.focus.copy(this.headPos);
        break;
      }
      case 'die': {
        this.addShake(0.9);
        this.hit = 1;
        this.timeScale = 0.35;
        this.slowT = 0.6;
        this.fovPunch = -8;
        const c = this.tmpC.setHex(PAL.acid);
        // The body bursts into beads.
        for (let i = 0; i < this.nb; i += this.quality === 'high' ? 3 : 5) {
          const t = i / Math.max(1, this.nb);
          c.setHSL(0.22 - t * 0.0 + (1 - t) * 0, 1, 0.55);
          this.sparks.emit(this.bx[i], 0.4, this.bz[i], (Math.random() - 0.5) * 9, 2 + Math.random() * 7, (Math.random() - 0.5) * 9, c.setRGB(0.4 + Math.random() * 0.6, 1, 0.3 + t * 0.7), 1.2 + Math.random() * 0.8, 0.5, 9);
        }
        this.sparks.burst(this.headPos.x, 0.7, this.headPos.z, 60, 11, new THREE.Color(1, 0.3, 0.2), 1.1, 0.5, 8);
        this.rings.fire(this.headPos.x, 0.06, this.headPos.z, new THREE.Color(PAL.signal), 0.3, 6, 0.8, 0.8);
        this.ripple(this.headPos.x, this.headPos.z, new THREE.Color(PAL.signal), 2);
        if (play) {
          sfx('rekt');
          const what = e.cause === 'wall' ? 'WALL' : e.cause === 'self' ? 'SELF' : 'BLOCK';
          cb.onToast({ text: e.livesLeft > 0 ? `${what} HIT · ${e.livesLeft} ${e.livesLeft === 1 ? 'LIFE' : 'LIVES'} LEFT` : `${what} HIT`, tone: 'bad' });
        }
        this.lastLives = e.livesLeft;
        break;
      }
      case 'respawn':
        this.hit = 0;
        this.focus.set(wx(this.sim.head.x), 0, wz(this.sim.head.y));
        if (play) {
          sfx('start', 0.7);
          cb.onToast({ text: 'RESPAWN · SHIELD UP', tone: 'good' });
        }
        break;
      case 'over':
        if (play) {
          sfx('gameover');
          this.input.capture = false;
          this.setPhase('over');
          cb.onOver({ score: this.sim.score, length: this.sim.cells.length, bites: this.sim.bites, chainBites: this.sim.chainBites, maxCombo: this.maxCombo, cause: this.sim.deathCause });
        }
        break;
    }
  }

  // ───────────── Snake body ─────────────

  private buildBody() {
    const sim = this.sim;
    const cells = sim.cells;
    const L = Math.min(cells.length, MAXC);
    const a = sim.alpha;
    const raw = this.rawA;
    const brk = this.rawBrk;
    let n = 0;
    const c0 = cells[0];
    const c1 = cells[1] ?? c0;
    const wrapped = Math.abs(c0.x - c1.x) > N / 2 || Math.abs(c0.y - c1.y) > N / 2;
    brk.fill(0, 0, L + 3);
    if (this.sim.state !== 'play' && this.sim.state !== 'dying') return;
    const moving = sim.state === 'play';
    const al = moving ? a : 1;
    if (wrapped || !moving) {
      raw[0] = wx(c0.x);
      raw[1] = wz(c0.y);
    } else {
      raw[0] = wx(c1.x + (c0.x - c1.x) * al);
      raw[1] = wz(c1.y + (c0.y - c1.y) * al);
    }
    n = 1;
    for (let i = 1; i < L; i++) {
      const c = cells[i];
      const p = cells[i - 1];
      if (Math.abs(c.x - p.x) > N / 2 || Math.abs(c.y - p.y) > N / 2) brk[n] = 1;
      raw[2 * n] = wx(c.x);
      raw[2 * n + 1] = wz(c.y);
      n++;
    }
    const pop = sim.lastPopped;
    if (pop && moving && L > 1) {
      const t = cells[L - 1];
      if (Math.abs(pop.x - t.x) <= 1 && Math.abs(pop.y - t.y) <= 1) {
        raw[2 * n] = wx(pop.x + (t.x - pop.x) * al);
        raw[2 * n + 1] = wz(pop.y + (t.y - pop.y) * al);
        n++;
      }
    }
    // Pieces (split at wall wraps): round the corners, then lay beads along arc length.
    const sp = this.bead;
    let start = 0;
    let dist = 0;
    let nb = 0;
    const a1 = this.rawB;
    const a2 = this.rawC;
    for (let i = 1; i <= n; i++) {
      if (i < n && !brk[i]) continue;
      const m = i - start;
      // copy piece to rawB, smooth twice.
      for (let k = 0; k < m; k++) {
        a1[2 * k] = raw[2 * (start + k)];
        a1[2 * k + 1] = raw[2 * (start + k) + 1];
      }
      let cnt = m;
      let src = a1;
      let dst = a2;
      if (m > 2) {
        for (let it = 0; it < 2; it++) {
          cnt = chaikin(src, cnt, dst);
          const tmp = src;
          src = dst;
          dst = tmp;
        }
      }
      // arc length
      this.cum[0] = 0;
      for (let k = 1; k < cnt; k++) this.cum[k] = this.cum[k - 1] + Math.hypot(src[2 * k] - src[2 * k - 2], src[2 * k + 1] - src[2 * k - 1]);
      const plen = this.cum[cnt - 1];
      let seg = 0;
      let d = Math.ceil(dist / sp) * sp;
      while (d <= dist + plen + 1e-4 && nb < MAXB) {
        const local = d - dist;
        while (seg < cnt - 2 && this.cum[seg + 1] < local) seg++;
        const sl = this.cum[seg + 1] - this.cum[seg];
        const f = sl > 1e-6 ? Math.min(1, Math.max(0, (local - this.cum[seg]) / sl)) : 0;
        this.bx[nb] = src[2 * seg] + (src[2 * seg + 2] - src[2 * seg]) * f;
        this.bz[nb] = src[2 * seg + 1] + (src[2 * seg + 3] - src[2 * seg + 1]) * f;
        this.bd[nb] = d;
        nb++;
        d += sp;
      }
      dist += plen;
      start = i;
    }
    this.nb = nb;
    this.bodyLen = dist;
  }

  private updateSnake(dt: number) {
    const sim = this.sim;
    const t = this.time;
    this.buildBody();
    const nb = this.nb;
    const dyingOrOver = sim.state !== 'play' || nb < 3;
    this.beads.count = dyingOrOver ? 0 : nb;
    this.spine.count = this.beads.count;
    this.under.count = this.beads.count;
    this.headG.visible = !dyingOrOver;
    if (dyingOrOver) {
      this.shieldMesh.visible = false;
      return;
    }
    // Head frame from the first beads.
    const k = Math.min(nb - 1, Math.max(2, Math.round(0.75 / this.bead)));
    const hx = this.bx[0] - this.bx[k];
    const hz = this.bz[0] - this.bz[k];
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-4) {
      this.headDir.set(hx / hl, hz / hl);
    }
    this.prevYaw = this.headYaw;
    const targetYaw = Math.atan2(-this.headDir.y, this.headDir.x);
    const dy = angDiff(targetYaw, this.headYaw);
    this.headYaw += dy * damp(22, dt);
    this.turnVel += (angDiff(this.headYaw, this.prevYaw) / Math.max(dt, 1e-3) - this.turnVel) * damp(8, dt);
    this.headPos.set(this.bx[0], 0, this.bz[0]);

    const ghost = sim.ghosting;
    const od = sim.fx.overdrive > 0;
    const blink = sim.fx.shield > 0 && sim.fx.ghost <= 0 ? (Math.floor(t * 12) % 2 ? 0.35 : 1) : 1;
    // Bulges travel down the body.
    for (let i = this.bulges.length - 1; i >= 0; i--) {
      this.bulges[i].d += dt * 9;
      if (this.bulges[i].d > this.bodyLen + 1) this.bulges.splice(i, 1);
    }
    const base = this.bead === 0.27 ? 0.46 : 0.48;
    const total = this.bodyLen;
    const d4 = this.dummy;
    const colr = this.tmpC;
    const inst = this.beads.instanceColor!.array as Float32Array;
    const sp = this.spine.instanceColor!.array as Float32Array;
    const un = this.under.instanceColor!.array as Float32Array;
    const pulseSpeed = od ? 14 : 7;
    for (let i = 0; i < nb; i++) {
      const d = this.bd[i];
      const tt = total > 0 ? d / total : 0;
      let r = base * (0.92 + 0.08 * Math.sin(d * 2.6));
      const rem = total - d;
      r *= rem < 3.4 ? 0.2 + 0.8 * Math.pow(Math.max(0, rem) / 3.4, 0.7) : 1;
      if (d < 0.7) r *= 0.9;
      for (let b = 0; b < this.bulges.length; b++) {
        const dd = d - this.bulges[b].d;
        r *= 1 + 0.42 * this.bulges[b].a * Math.exp(-dd * dd * 2.2);
      }
      // Orientation from neighbours.
      const ip = Math.max(0, i - 1);
      const inx = Math.min(nb - 1, i + 1);
      const tx = this.bx[ip] - this.bx[inx];
      const tz = this.bz[ip] - this.bz[inx];
      const yaw = Math.atan2(-tz, tx);
      // Slither: a sine ripple sideways, damped at the head and tail.
      const amp = 0.07 * Math.min(1, d / 3) * Math.min(1, rem / 2.5);
      const wv = Math.sin(d * 1.5 - t * (od ? 11 : 6)) * amp;
      const tl = Math.hypot(tx, tz) || 1;
      const px = this.bx[i] + (-tz / tl) * wv;
      const pz = this.bz[i] + (tx / tl) * wv;
      d4.position.set(px, r * 0.98 + 0.02, pz);
      d4.rotation.set(0, yaw, 0);
      d4.scale.set(r * 0.86, r * 0.94, r);
      d4.updateMatrix();
      this.beads.setMatrixAt(i, d4.matrix);
      // Colour: ice-white head -> acid -> cyan tail, with a travelling pulse.
      const pulse = Math.pow(Math.max(0, Math.sin(d * 0.7 - t * pulseSpeed)), 6);
      if (ghost) colr.setRGB(0.8 + pulse * 0.2, 0.2 + tt * 0.15, 0.9);
      else if (od) colr.setRGB(1, 0.62 - tt * 0.3, 0.12 + tt * 0.1);
      else colr.setRGB(0.42 - tt * 0.36, 0.95 - tt * 0.1, 0.04 + tt * 0.85);
      const plate = i % 2 ? 0.8 : 1;
      colr.multiplyScalar(plate * (0.72 + pulse * 0.45) * blink);
      inst[3 * i] = colr.r;
      inst[3 * i + 1] = colr.g;
      inst[3 * i + 2] = colr.b;
      // Spine glints on every second bead.
      if (i % 2 === 0) {
        d4.position.set(px, r * 1.78, pz);
        d4.rotation.set(0, 0, 0);
        d4.scale.setScalar(r * 0.3);
      } else {
        d4.position.set(px, -5, pz);
        d4.scale.setScalar(0.0001);
      }
      d4.updateMatrix();
      this.spine.setMatrixAt(i, d4.matrix);
      const gl = (ghost ? 0.9 : 1) * (0.9 + pulse * 1.8) * blink;
      if (ghost) colr.setRGB(1.0, 0.25, 0.9).multiplyScalar(gl);
      else if (od) colr.setRGB(1, 0.7, 0.2).multiplyScalar(gl);
      else colr.setRGB(0.4 - tt * 0.2, 1, 0.9).multiplyScalar(gl);
      sp[3 * i] = colr.r;
      sp[3 * i + 1] = colr.g;
      sp[3 * i + 2] = colr.b;
      // Light on the floor under the body.
      d4.position.set(px, 0.025, pz);
      d4.rotation.set(0, 0, 0);
      d4.scale.setScalar(Math.max(0.2, r * 5.2));
      d4.updateMatrix();
      this.under.setMatrixAt(i, d4.matrix);
      if (ghost) colr.setRGB(0.9, 0.15, 0.7);
      else if (od) colr.setRGB(1, 0.55, 0.05);
      else colr.setRGB(0.1, 0.7 - tt * 0.1, 1);
      colr.multiplyScalar(0.55 * (0.6 + pulse * 0.5) * (1 - tt * 0.5));
      un[3 * i] = colr.r;
      un[3 * i + 1] = colr.g;
      un[3 * i + 2] = colr.b;
    }
    this.beads.instanceMatrix.needsUpdate = true;
    this.beads.instanceColor!.needsUpdate = true;
    this.spine.instanceMatrix.needsUpdate = true;
    this.spine.instanceColor!.needsUpdate = true;
    this.under.instanceMatrix.needsUpdate = true;
    this.under.instanceColor!.needsUpdate = true;

    // Head mesh.
    const hg = this.headG;
    hg.position.set(this.headPos.x, 0.5 + Math.sin(t * 9) * 0.015, this.headPos.z);
    hg.rotation.set(0, this.headYaw, Math.max(-0.35, Math.min(0.35, -this.turnVel * 0.05)));
    hg.scale.setScalar((blink > 0.5 ? 1 : 0.92) * 1.18);
    const tong = Math.max(0, Math.sin(t * 2.1)) ** 6;
    this.tongue.scale.x = 0.15 + tong * 1.2;
    (this.headMats[0] as THREE.MeshPhysicalMaterial).color.setRGB(ghost ? 1 : 0.5, ghost ? 0.7 : 0.8, ghost ? 1 : 0.66);
    (this.headMats[2] as THREE.MeshBasicMaterial).color.setRGB(od ? 4 : 2.6, od ? 2.2 : 0.3, od ? 0.3 : 1.2);
    this.shieldMesh.visible = ghost;
    if (ghost) {
      this.shieldMesh.position.set(this.headPos.x, 0.5, this.headPos.z);
      this.shieldMesh.scale.setScalar(0.95 + Math.sin(t * 10) * 0.06);
      this.shieldMesh.rotation.y += dt * 2;
    }
    this.headLight.position.set(this.headPos.x, 3.4, this.headPos.z);
    this.headLight.color.set(ghost ? PAL.magenta : od ? PAL.amber : PAL.cyan);
    // Head trail sparks.
    if (t - this.lastSpark > (od ? 0.02 : 0.055) && this.sim.state === 'play') {
      this.lastSpark = t;
      const c = colr.setHex(ghost ? PAL.magenta : od ? PAL.amber : PAL.cyan);
      const tail = nb - 1;
      this.sparks.emit(this.bx[tail], 0.25, this.bz[tail], (Math.random() - 0.5) * 0.8, 0.5 + Math.random(), (Math.random() - 0.5) * 0.8, c, 0.7, 0.2, 1, 1.2);
      if (od) this.sparks.emit(this.headPos.x - this.headDir.x * 0.6, 0.45, this.headPos.z - this.headDir.y * 0.6, -this.headDir.x * 3 + (Math.random() - 0.5), 0.5 + Math.random(), -this.headDir.y * 3 + (Math.random() - 0.5), c, 0.5, 0.3, 0, 1.5);
    }
  }

  // ───────────── Camera ─────────────

  private updateCamera(dt: number) {
    const cam = this.camera;
    const hp = this.headPos;
    const sim = this.sim;
    const speed01 = Math.min(1, (0.16 - sim.interval) / 0.09);
    if (this.sim.state === 'play' || this.demo) this.focus.lerp(hp, damp(this.camMode === 'chase' ? 9 : 5.5, dt));
    const f = this.focus;
    const hd = this.headDir;
    // Camera yaw for chase mode (shortest-angle smoothing).
    const wantYaw = Math.atan2(hd.y, hd.x);
    this.camYaw += angDiff(wantYaw, this.camYaw) * damp(4.5, dt);
    let fov = 52;
    const v = this.v3;
    const look = this.v3b;
    if (this.camMode === 'angle') {
      const portrait = this.w / this.h < 1;
      const lean = 1.6;
      v.set(f.x * 0.9 + hd.x * lean, portrait ? 19 : 12.4, f.z * 0.9 + hd.y * lean + (portrait ? 12.5 : 9.4));
      look.set(f.x * 0.92 + hd.x * 2.2, 0, f.z * 0.92 + hd.y * 2.2 - 1.2);
      fov = portrait ? 56 : 52;
    } else if (this.camMode === 'top') {
      v.set(f.x * 0.55, 31, f.z * 0.55 + 5);
      look.set(f.x * 0.55, 0, f.z * 0.55);
      fov = 46;
    } else {
      const cy = this.camYaw;
      const fx = Math.cos(cy);
      const fz = Math.sin(cy);
      v.set(f.x - fx * 6.4, 5.4, f.z - fz * 6.4);
      look.set(f.x + fx * 5.5, 0.4, f.z + fz * 5.5);
      fov = 72;
    }
    cam.position.copy(v);
    this.shake *= Math.exp(-dt * 6);
    if (this.shake > 0.003) {
      const s = this.shake * 0.55;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s * 0.6;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(look);
    const rollT = Math.max(-0.14, Math.min(0.14, -this.turnVel * 0.028)) * (this.camMode === 'chase' ? 1.6 : 0.9);
    this.roll += (rollT - this.roll) * damp(6, dt);
    cam.rotateZ(this.roll + (Math.random() - 0.5) * this.shake * 0.04);
    this.fovPunch *= Math.exp(-dt * 5);
    const od = sim.fx.overdrive > 0 ? 7 : 0;
    const targetFov = fov + speed01 * 4 + od + this.fovPunch;
    if (Math.abs(cam.fov - targetFov) > 0.02) {
      cam.fov += (targetFov - cam.fov) * damp(8, dt);
      cam.updateProjectionMatrix();
      this.sparks.mat.uniforms.uPx.value = (this.h * this.dpr) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    }
  }

  // ───────────── Autopilot (attract mode) ─────────────

  private autopilot() {
    const sim = this.sim;
    if (sim.state !== 'play' || sim.turns.length) return;
    const h = sim.head;
    const safe = (d: Dir, depth = 3) => {
      let x = h.x;
      let y = h.y;
      for (let i = 1; i <= depth; i++) {
        x += DX[d];
        y += DY[d];
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) return false;
        if (sim.blockAt(x, y)) return false;
        if (sim.cells.some((c, k) => k < sim.cells.length - 1 && c.x === x && c.y === y)) return false;
      }
      return true;
    };
    // Prefer toward the nearest prize.
    let best: { x: number; y: number } | null = null;
    let bd = 1e9;
    for (const f of sim.foods) {
      const dd = Math.abs(f.x - h.x) + Math.abs(f.y - h.y) - (f.kind === 'blast' ? 6 : f.kind === 'token' ? 3 : 0);
      if (dd < bd) {
        bd = dd;
        best = f;
      }
    }
    const cands: Dir[] = [sim.dir, turnLeft(sim.dir), turnRight(sim.dir)];
    let pick: Dir = sim.dir;
    let score = -1e9;
    for (const d of cands) {
      if (!safe(d, 2)) continue;
      let s = d === sim.dir ? 0.5 : 0;
      if (best) s -= Math.abs(best.x - (h.x + DX[d])) + Math.abs(best.y - (h.y + DY[d]));
      if (safe(d, 5)) s += 3;
      if (s > score) {
        score = s;
        pick = d;
      }
    }
    if (pick !== sim.dir) sim.turn(pick);
  }

  // ───────────── Frame ─────────────

  private frame = (now: number) => {
    if (this.disposed) return;
    const raw = Math.min(0.05, Math.max(0.0005, (now - this.last) / 1000));
    this.last = now;
    this.input.poll();
    // Hit-stop.
    if (this.slowT > 0) {
      this.slowT -= raw;
      if (this.slowT <= 0) this.timeScale = 1;
    } else this.timeScale += (1 - this.timeScale) * damp(8, raw);
    const dt = raw * (this.paused ? 0 : this.timeScale);
    this.time += dt;
    this.perf(raw);

    if (this.demo) this.autopilot();
    else if (this.live && this.phase === 'play' && this.opts.canPay && !this.opts.canPay()) {
      this.pause(true);
      this.opts.cb.onNeedAmmo?.();
    }
    if (!this.paused) {
      this.sim.update(dt);
      for (const e of this.sim.drain()) this.handle(e);
      if (this.demo && this.sim.state === 'over') {
        this.sim = new SnakeSim(this.opts.supply);
        this.seedBlocks();
        this.clearViews();
      }
      // No block has landed for a while (or the block feed is down): the arena still evolves, honestly labelled.
      if (this.time - this.lastBlockAt > 55 && this.sim.state === 'play') {
        this.lastBlockAt = this.time;
        this.sim.addBlock(0, 0, 'PENDING');
      }
    }
    this.syncViews();
    this.animateViews(dt);
    this.updateSnake(dt);
    this.updateCamera(raw);
    this.updateWorld(dt, raw);
    this.sparks.update(dt);
    this.rings.update(dt);
    this.composer.render(raw);
    this.drawOverlay(raw);
    this.hudT += raw;
    if (this.hudT > 0.09) {
      this.hudT = 0;
      this.pushHud();
    }
    this.miniT += raw;
    if (this.miniT > 0.08 && this.opts.mini) {
      this.miniT = 0;
      this.drawMini();
    }
  };

  private updateWorld(dt: number, raw: number) {
    const sim = this.sim;
    const t = this.time;
    this.floorMat.uniforms.uTime.value = t;
    this.floorMat.uniforms.uHead.value.set(this.headPos.x, this.headPos.z);
    this.beat *= Math.exp(-raw * 5);
    this.floorMat.uniforms.uBeat.value = this.beat;
    const tint = this.floorMat.uniforms.uTint.value as THREE.Color;
    if (sim.ghosting) tint.setRGB(1.4, 0.45, 1.5);
    else if (sim.fx.overdrive > 0) tint.setRGB(1.6, 1.0, 0.35);
    else tint.setRGB(1, 1, 1);
    for (let i = 0; i < 6; i++) {
      if (this.ripAge[i] >= 0) {
        this.ripAge[i] += dt;
        const v4 = (this.floorMat.uniforms.uRip.value as THREE.Vector4[])[i];
        if (this.ripAge[i] > 1.7) {
          this.ripAge[i] = -1;
          v4.z = -1;
        } else v4.z = this.ripAge[i];
      }
    }
    this.wallMat.uniforms.uTime.value = t;
    this.wallMat.uniforms.uHead.value.set(this.headPos.x, this.headPos.z);
    (this.wallMat.uniforms.uCol.value as THREE.Color).setHex(sim.ghosting ? PAL.cyan : sim.fx.overdrive > 0 ? PAL.amber : PAL.magenta);
    this.skyMat.uniforms.uTime.value = t;
    this.towerMat.uniforms.uTime.value = t;
    const dust = this.scene.getObjectByName('dust');
    if (dust) dust.rotation.y += raw * 0.01;
    // Post.
    const g = this.grade.uniforms;
    this.hit *= Math.exp(-raw * (sim.state === 'dying' ? 0.8 : 3));
    this.flash *= Math.exp(-raw * 4.5);
    g.uTime.value = t;
    g.uHit.value = this.hit;
    g.uFlash.value = this.flash;
    g.uBoost.value = sim.fx.overdrive > 0 ? 1 : 0;
    g.uGhost.value += ((sim.ghosting ? 1 : 0) - g.uGhost.value) * damp(8, raw);
    this.bloom.strength = (this.fxLevel >= 2 ? 0.4 : 0.32) + this.flash * 0.6 + this.beat * 0.08;
  }

  private drawOverlay(dt: number) {
    const ctx = this.octx;
    const ow = this.overlay.width;
    const oh = this.overlay.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ow, oh);
    const sx = ow / this.w;
    ctx.setTransform(sx, 0, 0, sx, 0, 0);
    if (!this.paused) drawPopups(ctx, this.popups, this.camera, this.w, this.h, dt, this.fonts.display, this.v3);
    // Off-screen arrows for gold prizes.
    if (!this.demo && this.sim.state === 'play') {
      for (const f of this.sim.foods) {
        if (f.kind !== 'blast' && f.kind !== 'token') continue;
        this.v3.set(wx(f.x), 0.6, wz(f.y)).project(this.camera);
        const inView = this.v3.z < 1 && Math.abs(this.v3.x) < 0.94 && Math.abs(this.v3.y) < 0.9;
        if (inView) continue;
        let x = this.v3.x;
        let y = this.v3.y;
        if (this.v3.z > 1) {
          x = -x;
          y = -y;
        }
        const m = Math.max(Math.abs(x) / 0.93, Math.abs(y) / 0.88, 1e-3);
        const px = ((x / m) * 0.5 + 0.5) * this.w;
        const py = (-(y / m) * 0.5 + 0.5) * this.h;
        const ang = Math.atan2(-(y / m), x / m);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(this.time * 8);
        ctx.fillStyle = f.kind === 'blast' ? '#ffe9a0' : '#e8b53a';
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -9);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-8, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    // Touch stick.
    const st = this.input.stick;
    if (st.active && this.phase === 'play') {
      const r = this.el.getBoundingClientRect();
      const ax = st.ax - r.left;
      const ay = st.ay - r.top;
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#27e6ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ax, ay, 44, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#27e6ff';
      ctx.beginPath();
      ctx.arc(Math.max(ax - 44, Math.min(ax + 44, st.x - r.left)), Math.max(ay - 44, Math.min(ay + 44, st.y - r.top)), 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private pushHud() {
    const s = this.sim;
    this.opts.cb.onHud({
      score: s.score,
      length: s.cells.length,
      combo: s.combo,
      mult: s.mult,
      comboFrac: s.combo > 0 ? Math.max(0, s.comboT / 3.4) : 0,
      lives: s.lives,
      bites: s.bites,
      speed: Math.round((0.16 / s.interval) * 10) / 10,
      fx: { overdrive: Math.max(0, s.fx.overdrive), ghost: Math.max(0, s.fx.ghost), magnet: Math.max(0, s.fx.magnet), shield: Math.max(0, s.fx.shield) },
      fxMax: POWER_SECS,
      camMode: this.camMode,
    });
  }

  private drawMini() {
    const c = this.opts.mini;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const S = c.width;
    const k = S / N;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(7,7,11,0.82)';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(42,91,255,0.35)';
    g.lineWidth = 1;
    for (let i = 4; i < N; i += 4) {
      g.beginPath();
      g.moveTo(i * k, 0);
      g.lineTo(i * k, S);
      g.moveTo(0, i * k);
      g.lineTo(S, i * k);
      g.stroke();
    }
    g.fillStyle = '#ffb800';
    for (const b of this.sim.blocks) g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k);
    for (const p of this.sim.powers) {
      g.fillStyle = '#' + POWER_COLOR[p.type].toString(16).padStart(6, '0');
      g.fillRect(p.x * k - 1, p.y * k - 1, k + 2, k + 2);
    }
    for (const f of this.sim.foods) {
      g.fillStyle = KIND_CSS[f.kind];
      const big = f.kind === 'blast' || f.kind === 'token';
      g.beginPath();
      g.arc((f.x + 0.5) * k, (f.y + 0.5) * k, big ? k * 0.9 : k * 0.4, 0, Math.PI * 2);
      g.fill();
      if (big) {
        g.strokeStyle = '#fff';
        g.stroke();
      }
    }
    g.fillStyle = '#c8ff1a';
    for (let i = this.sim.cells.length - 1; i >= 1; i--) g.fillRect(this.sim.cells[i].x * k + 0.5, this.sim.cells[i].y * k + 0.5, k - 1, k - 1);
    g.fillStyle = '#fff';
    const h = this.sim.head;
    g.fillRect(h.x * k - 1, h.y * k - 1, k + 2, k + 2);
    g.strokeStyle = '#ffb800';
    g.lineWidth = 2;
    g.strokeRect(1, 1, S - 2, S - 2);
  }

  // ───────────── Adaptive quality ─────────────

  private perf(dt: number) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    this.perfCool -= dt;
    this.perfT += dt;
    if (this.perfCool <= 0) {
      if (this.frameMs > 25) this.lowFrames++;
      else this.lowFrames = Math.max(0, this.lowFrames - 1);
      if (this.lowFrames > 80) {
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
    document.removeEventListener('visibilitychange', this.visHandler);
    this.ro?.disconnect();
    if (!this.renderer) return;
    this.renderer.setAnimationLoop(null);
    this.clearViews();
    this.composer?.dispose();
    this.sparks?.dispose();
    this.rings?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose?.());
      }
    });
    const sh = this.shared;
    if (sh) {
      for (const k of ['ico', 'octa', 'dodeca', 'box', 'sphere', 'coin', 'rim', 'beam', 'ringFlat', 'torus', 'mono'] as const) sh[k].dispose();
      sh.beamTex.dispose();
      Object.values(sh.tags).forEach((t) => t.dispose());
      sh.gold.dispose();
    }
    this.glowTex?.dispose();
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.overlay?.remove();
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __tbSnake?: unknown }).__tbSnake = undefined;
  }
}
