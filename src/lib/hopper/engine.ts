/**
 * Block Hopper engine: a 2.5D Three.js platformer on the live chain. Gameplay is on the z = 0 plane (sim.ts);
 * the look is a perspective camera over PBR slabs, a parallax skyline, bloom and a DR-style grade.
 * The React shell (src/components/BlockHopper.tsx) owns the menus, the HUD text and the coin-op.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FeedTx } from '@/lib/feed';
import { refreshLoot } from '@/lib/lootCanvas';
import type { Loot } from '@/lib/loot';
import { sfx } from '@/lib/sfx';
import { drawTokenCoin, gateTexture, glowTexture, labelTexture, setFonts, tokenCoinTexture } from './art';
import { hop } from './audio';
import { KIND_STYLE, type BlockInfo } from './brand';
import { Particles, Scarf, Streaks, makeWall } from './fx';
import { Input } from './input';
import { Level, type Drop, type Enemy, type Fresh } from './level';
import { HeroRig } from './rig';
import { Hero, P, type Plat, type SimInput } from './sim';

export { setFonts };
export type Quality = 'low' | 'high';
export type Phase = 'loading' | 'title' | 'playing' | 'paused' | 'over';
export type Hud = { score: number; lives: number; dist: number; coins: number; tokens: number; combo: number; kmh: number; gap: number; dash: number; blocks: number; built: number };
export type Result = { score: number; dist: number; coins: number; tokens: number; blocks: number; stomps: number; secs: number; built: number };
export type Toast = { text: string; tone: 'good' | 'bad' | 'info' | 'big' };
export type Banner = { title: string; sub: string; color: string };
export type Callbacks = {
  onPhase: (p: Phase) => void;
  onHud: (h: Hud) => void;
  onToast: (t: Toast) => void;
  onBanner: (b: Banner) => void;
  onLoading: (msg: string, pct: number) => void;
  onOver: (r: Result) => void;
  onPickup?: (loot: Loot) => void;
  onPerf?: (p: { fps: number; level: number }) => void;
};
export type Options = {
  quality: Quality;
  touchDevice: boolean;
  take: (pred?: (f: FeedTx) => boolean) => FeedTx | null;
  lootOf: (f: FeedTx) => Loot | null;
  takeBlock: () => BlockInfo | null;
  /** LIVE token-blasting mode: every jump / wall jump / dash is a tiny real transaction, queued by the shell. */
  pay: { live: () => boolean; can: () => boolean; spend: (action: string[]) => void };
  cb: Callbacks;
};

const DEPTH = 4.5;
const BASE_FOV = 32;
const BASE_DIST = 18;
const STEP = 1 / 120;
const LIVES = 3;
const MAX_LIVES = 5;
const ACCENT = { red: '#e8261d', cyan: '#27e6ff', amber: '#ffb800', magenta: '#ff2f92', acid: '#c8ff1a', paper: '#f2efe6' };
const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uFlash: { value: new THREE.Color(1, 1, 1) }, uFlashA: { value: 0 }, uWarn: { value: 0 }, uCA: { value: 0 }, uAspect: { value: 1.7 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uFlash; uniform float uFlashA, uWarn, uCA, uAspect, uTime; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c = vUv-.5; float r = length(c*vec2(uAspect,1.));
      vec2 off = c*uCA*(.35+r*2.2);
      vec3 col = vec3(texture2D(tDiffuse,vUv+off).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-off).b);
      col *= mix(.5,1.,smoothstep(1.0,.28,r));
      col += uFlash*uFlashA;
      float edge = smoothstep(.3,.9,r);
      col = mix(col, col*vec3(1.,.5,.45), uWarn*edge);
      col += vec3(.9,.08,.04)*uWarn*.35*edge*(.65+.35*sin(uTime*14.));
      col += (h(vUv*vec2(1920.,1080.)+fract(uTime))-.5)*.022;
      gl_FragColor = vec4(col,1.);
    }`,
};

type PlatView = { g: THREE.Group; body: THREE.Mesh; rim: THREE.Mesh; label: THREE.Mesh | null; tex: THREE.Texture | null; gate: THREE.Group | null; fall: number; shake: number };
type EnemyView = { g: THREE.Group; face: THREE.Mesh; coin: { tex: THREE.Texture; canvas: HTMLCanvasElement; ok: boolean }; tries: number; loot: Loot | null; bar: THREE.Mesh };
type DropView = { m: THREE.Mesh; halo: THREE.Mesh; coin: { tex: THREE.Texture; canvas: HTMLCanvasElement; ok: boolean }; tries: number; loot: Loot };
type SpringView = { g: THREE.Group; coil: THREE.Mesh[]; pad: THREE.Mesh };
type Pop = { el: HTMLElement; x: number; y: number; life: number };

export class HopperEngine {
  private el: HTMLElement;
  private opts: Options;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 700);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private input = new Input();
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private dpr = 1;
  private maxDpr = 1.5;
  private fxLevel = 2;
  private clock = new THREE.Clock(false);
  private acc = 0;
  private time = 0;
  private pmrem: THREE.PMREMGenerator | null = null;

  // World.
  private level: Level;
  private hero = new Hero();
  private rig = new HeroRig();
  private root = new THREE.Group();
  private parts!: Particles;
  private scarf!: Scarf;
  private streaks!: Streaks;
  private wall!: ReturnType<typeof makeWall>;
  private key!: THREE.DirectionalLight;
  private heroLight!: THREE.PointLight;
  private sky!: THREE.Mesh;
  private sea!: THREE.Mesh;
  private skyline: { mesh: THREE.InstancedMesh; base: Float32Array; z: number; span: number; w: Float32Array; h: Float32Array }[] = [];
  private beams!: THREE.InstancedMesh;
  private debris!: THREE.InstancedMesh;
  private coinMesh!: THREE.InstancedMesh;
  private platViews = new Map<number, PlatView>();
  private enemyViews = new Map<number, EnemyView>();
  private dropViews = new Map<number, DropView>();
  private springViews = new Map<number, SpringView>();
  private landRing!: THREE.Mesh;
  private blob!: THREE.Mesh;
  private shockwave!: THREE.Mesh;
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private rimCache = new Map<string, THREE.MeshBasicMaterial>();
  private shared = { uTime: { value: 0 }, uHero: { value: new THREE.Vector3() } };
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private unitPlane = new THREE.PlaneGeometry(1, 1);
  private haloTex!: THREE.Texture;
  private pops: Pop[] = [];
  private popLayer: HTMLElement;

  // Game state.
  phase: Phase = 'loading';
  private live = false; // a scored run is in progress
  private lives = LIVES;
  private bonus = 0;
  private maxX = 0;
  private coinsGot = 0;
  private tokensGot = 0;
  private blocksHit = 0;
  private stomps = 0;
  private combo = 0;
  private comboT = 0;
  private runT = 0;
  private inv = 0;
  private hurtT = 0;
  private freeze = 0;
  private slow = 1;
  private overT = 0;
  private waveX = -30;
  private waveGrace = 0;
  private safe: { plat: Plat; x: number } | null = null;
  private safeT = 0;
  private sinceBlock = 0;
  private cam = { x: 0, y: 6, lookX: 0, fov: BASE_FOV, dist: BASE_DIST, shake: 0 };
  private sq = 0;
  private sqV = 0;
  private flash = 0;
  private flashCol = new THREE.Color(1, 1, 1);
  private ca = 0;
  private dustT = 0;
  private streakT = 0;
  private frameMs = 16;
  private lowFrames = 0;
  private perfCool = 5;
  private perfT = 0;
  private hudT = 0;
  private lastGroundY = 4;
  /** Test hook: let the demo bot drive a real run (used by the headless checks). */
  autoplay = false;
  private noAmmoAt = -9;
  private botJump = 0;
  private botDashT = 0;
  private warnT = 0;
  private fanfareT = 0;
  private heroVisible = true;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private mat4 = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private eul = new THREE.Euler();
  private scl = new THREE.Vector3();
  private visHandler = () => {
    if (document.hidden && this.phase === 'playing') this.pause(true);
  };

  constructor(el: HTMLElement, opts: Options) {
    this.el = el;
    this.opts = opts;
    this.level = new Level(1, opts.lootOf);
    this.maxDpr = opts.quality === 'high' ? 1.75 : 1.1;
    this.popLayer = document.createElement('div');
    this.popLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  }

  get touch() {
    return this.input.touch;
  }
  get padActive() {
    return this.input.padActive;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.input.capture = p === 'playing' || p === 'paused';
    this.opts.cb.onPhase(p);
  }

  // ───────────── Setup ─────────────

  async init() {
    const { cb } = this.opts;
    const hi = this.opts.quality === 'high';
    cb.onLoading('Setting up renderer', 0.05);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    renderer.setPixelRatio(this.dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = hi;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    this.el.appendChild(renderer.domElement);
    this.el.appendChild(this.popLayer);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.fxLevel = hi ? 2 : 1;
    try {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    } catch {
      /* fine */
    }
    cb.onLoading('Building the skyline', 0.2);
    await new Promise((r) => setTimeout(r, 0));
    this.haloTex = glowTexture('#ffffff');
    this.buildLighting();
    this.buildBackdrop();
    this.buildProps();
    cb.onLoading('Loading the runner', 0.45);
    await this.rig.load().catch(() => undefined);
    if (this.disposed) return;
    this.root.add(this.rig.root);
    this.scene.add(this.root);
    this.scarf = new Scarf(C(ACCENT.red));
    this.scene.add(this.scarf.mesh);
    cb.onLoading('Laying the first block', 0.8);
    this.buildComposer();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    document.addEventListener('visibilitychange', this.visHandler);
    this.input.attach();
    this.resetWorld(true);
    this.setPhase('title');
    this.clock.start();
    renderer.setAnimationLoop(() => this.frame());
    cb.onLoading('Ready', 1);
  }

  private buildLighting() {
    const s = this.scene;
    s.background = new THREE.Color('#07070c');
    s.fog = new THREE.Fog('#1a0a1e', 50, 210);
    s.add(new THREE.HemisphereLight('#7f8cff', '#4a1230', 0.55));
    const key = new THREE.DirectionalLight('#ffd9a8', 2.4);
    key.position.set(-8, 16, 14);
    key.castShadow = this.opts.quality === 'high';
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 60;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    s.add(key, key.target);
    this.key = key;
    const rim = new THREE.DirectionalLight('#27e6ff', 1.3);
    rim.position.set(14, 6, -10);
    s.add(rim);
    const hl = new THREE.PointLight('#ff5a48', 14, 11, 1.6);
    s.add(hl);
    this.heroLight = hl;
  }

  private buildBackdrop() {
    const hi = this.opts.quality === 'high';
    // Sky dome with a striped red sun.
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: this.shared.uTime },
      vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        uniform float uTime; varying vec3 vD;
        float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vD);
          float y = d.y;
          vec3 top = vec3(.012,.014,.04), mid = vec3(.12,.05,.2), hor = vec3(.85,.14,.1);
          vec3 c = mix(hor, mid, smoothstep(-.02,.28,y));
          c = mix(c, top, smoothstep(.2,.8,y));
          c = mix(vec3(.02,.01,.04), c, smoothstep(-.35,-.02,y));
          // sun
          vec3 sd = normalize(vec3(.5,.14,-.85));
          float s = dot(d, sd);
          float disc = smoothstep(.9935,.9955,s);
          float stripes = step(.0, sin((d.y-.02)*260.)+ (d.y-.14)*18.+.25);
          vec3 sunC = mix(vec3(1.,.72,.2), vec3(1.,.15,.08), smoothstep(.04,.2,-(d.y-.2)*3.+.0));
          c += disc*stripes*sunC*2.2;
          c += pow(max(s,0.),60.)*vec3(1.,.3,.15)*.6 + pow(max(s,0.),8.)*vec3(.5,.1,.15)*.25;
          // stars
          vec2 sp = floor(vec2(atan(d.x,-d.z)*60., d.y*80.));
          float st = step(.9965, h(sp)) * smoothstep(.15,.5,y);
          c += st*vec3(.9,.95,1.)*(.5+.5*sin(uTime*2.+h(sp)*40.));
          gl_FragColor = vec4(c,1.);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // The chain sea far below: glowing grid streaming right.
    const seaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: this.shared.uTime, uCam: { value: new THREE.Vector3() } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uCam; varying vec3 vW;
        void main(){
          vec2 p = vW.xz*vec2(1.,1.) ; p.x -= uTime*3.;
          vec2 g = abs(fract(p/6.)-.5);
          float l = smoothstep(.47,.5,max(g.x,g.y));
          float d = length(vW.xz-uCam.xz);
          float fade = exp(-d*.012);
          vec3 c = mix(vec3(.9,.1,.1), vec3(.15,.9,1.), smoothstep(-80.,80.,vW.x-uCam.x));
          gl_FragColor = vec4(c*l*1.4*fade, l*fade*.9 + .05*fade);
        }`,
    });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 500).rotateX(-Math.PI / 2), seaMat);
    this.sea.position.y = -28;
    this.sea.frustumCulled = false;
    this.sea.renderOrder = -5;
    this.scene.add(this.sea);

    // Skyline: three instanced layers wrapping around the camera for endless parallax.
    const bMat = (density: number) =>
      new THREE.ShaderMaterial({
        fog: false,
        uniforms: { uFog: { value: new THREE.Color('#23102c') }, uCam: { value: new THREE.Vector3() }, uTime: this.shared.uTime, uDensity: { value: density } },
        vertexShader: `
          varying vec3 vW; varying vec3 vN; varying vec3 vCol;
          void main(){
            mat4 m = modelMatrix*instanceMatrix; vec4 w = m*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(m)*normal);
            #ifdef USE_INSTANCING_COLOR
              vCol = instanceColor;
            #else
              vCol = vec3(.5);
            #endif
            gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `
          uniform vec3 uFog; uniform vec3 uCam; uniform float uTime; uniform float uDensity; varying vec3 vW; varying vec3 vN; varying vec3 vCol;
          float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
          void main(){
            vec3 n = normalize(vN);
            vec2 uv = abs(n.z)>.5 ? vW.xy : vW.zy;
            vec2 sz = vec2(1.15,1.8);
            vec2 cell = floor(uv/sz); vec2 f = fract(uv/sz);
            float seed = floor(vCol.r*97.)+floor(vCol.g*31.);
            float lit = step(.8, h(cell+seed)) * step(.18,f.x)*step(f.x,.82)*step(.22,f.y)*step(f.y,.78) * (1.-step(.5,abs(n.y)));
            float k = h(cell+seed+3.);
            vec3 wc = k<.55 ? vec3(1.,.7,.28) : (k<.8 ? vec3(.2,.9,1.) : vec3(1.,.22,.6));
            float flick = .8+.2*sin(uTime*2.5+h(cell)*40.);
            vec3 base = vCol*.1*(.45+.55*(n.y*.5+.5)) + vec3(.02,.01,.04);
            vec3 c = base + wc*lit*flick*1.05;
            float ed = smoothstep(.97,1.,max(abs(fract(vW.y/9.)-.5)*2.,0.))*.0;
            c += ed;
            float dist = length(vW-uCam); float fog = 1.-exp(-dist*uDensity);
            c = mix(c, uFog, clamp(fog,0.,1.));
            gl_FragColor = vec4(c,1.);
          }`,
      });
    const layers = hi ? [{ z: -62, n: 46, span: 420, hMin: 36, hMax: 85, w: [8, 16], d: 0.0040 }, { z: -105, n: 52, span: 540, hMin: 60, hMax: 140, w: [12, 24], d: 0.0048 }, { z: -170, n: 50, span: 800, hMin: 80, hMax: 190, w: [18, 34], d: 0.0055 }] : [{ z: -70, n: 30, span: 420, hMin: 36, hMax: 85, w: [8, 16], d: 0.0040 }, { z: -130, n: 32, span: 640, hMin: 70, hMax: 160, w: [14, 28], d: 0.0050 }];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const L of layers) {
      const im = new THREE.InstancedMesh(this.unitBox, bMat(L.d), L.n);
      im.frustumCulled = false;
      const base = new Float32Array(L.n);
      const w = new Float32Array(L.n);
      const hh = new Float32Array(L.n);
      for (let i = 0; i < L.n; i++) {
        base[i] = (i / L.n) * L.span + (rnd() - 0.5) * (L.span / L.n) * 0.8;
        w[i] = L.w[0] + rnd() * (L.w[1] - L.w[0]);
        hh[i] = L.hMin + rnd() * (L.hMax - L.hMin);
        const col = new THREE.Color().setRGB(rnd(), rnd(), rnd());
        im.setColorAt(i, col);
      }
      this.skyline.push({ mesh: im, base, z: L.z, span: L.span, w, h: hh });
      this.scene.add(im);
    }

    // Data beams: tall glowing columns far back, pulsing with traffic.
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.beams = new THREE.InstancedMesh(this.unitBox, beamMat, 18);
    this.beams.frustumCulled = false;
    const kinds = ['payment', 'blast', 'token', 'inscription', 'social', 'data'] as const;
    for (let i = 0; i < 18; i++) this.beams.setColorAt(i, C(KIND_STYLE[kinds[i % 6]].color, 1.6));
    this.scene.add(this.beams);

    // Floating mempool cubes near the action for depth.
    const dMat = new THREE.MeshStandardMaterial({ color: '#14151a', metalness: 0.9, roughness: 0.25, emissive: '#e8261d', emissiveIntensity: 0.08 });
    this.debris = new THREE.InstancedMesh(this.unitBox, dMat, hi ? 26 : 12);
    this.debris.frustumCulled = false;
    this.scene.add(this.debris);
    void bMat;
  }

  private buildProps() {
    const hi = this.opts.quality === 'high';
    this.parts = new Particles(hi ? 900 : 380);
    this.scene.add(this.parts.mesh);
    this.streaks = new Streaks(12);
    this.scene.add(this.streaks.group);
    this.wall = makeWall();
    this.wall.mesh.position.set(0, 14, 3.6);
    this.scene.add(this.wall.mesh);
    const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 22).rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshStandardMaterial({ color: '#ffb800', emissive: '#ff9a00', emissiveIntensity: 0.9, metalness: 0.85, roughness: 0.25 });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, 220);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    this.scene.add(this.coinMesh);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.blob.renderOrder = 2;
    this.scene.add(this.blob);
    this.landRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C(ACCENT.cyan, 2.2), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    this.landRing.renderOrder = 3;
    this.scene.add(this.landRing);
    this.shockwave = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), new THREE.MeshBasicMaterial({ color: C(ACCENT.paper, 2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.shockwave.visible = false;
    this.scene.add(this.shockwave);
  }

  private buildComposer() {
    const r = this.renderer;
    this.composer?.dispose();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.fxLevel >= 2 ? 4 : 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    const bs = this.fxLevel >= 2 ? 0.7 : 0.45;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bs, size.y * bs), this.fxLevel >= 2 ? 0.5 : 0.42, 0.5, 1.05);
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
    // Portrait phones: widen the view so the runner has room.
    this.cam.dist = w / h < 1 ? BASE_DIST / Math.max(0.55, w / h) ** 0.75 : BASE_DIST;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(w, h);
    if (this.grade) this.grade.uniforms.uAspect.value = w / h;
    this.parts?.setScale(h * this.dpr, this.camera.fov);
  }

  // ───────────── Control ─────────────

  /** Fresh level and hero; `attract` keeps the demo bot running behind the title. */
  private resetWorld(attract: boolean) {
    for (const v of this.platViews.values()) this.dropPlat(v);
    for (const v of this.enemyViews.values()) this.dropEnemy(v);
    for (const v of this.dropViews.values()) this.dropDrop(v);
    for (const v of this.springViews.values()) this.root.remove(v.g);
    this.platViews.clear();
    this.enemyViews.clear();
    this.dropViews.clear();
    this.springViews.clear();
    this.level.reset((Date.now() & 0xffffff) + 1);
    this.syncViews();
    this.hero.place(0, this.level.last.top, this.level.last);
    this.hero.face = 1;
    this.lives = LIVES;
    this.bonus = 0;
    this.maxX = 0;
    this.coinsGot = 0;
    this.tokensGot = 0;
    this.blocksHit = 0;
    this.stomps = 0;
    this.combo = 0;
    this.comboT = 0;
    this.runT = 0;
    this.inv = 0;
    this.hurtT = 0;
    this.freeze = 0;
    this.slow = 1;
    this.overT = 0;
    this.waveX = -34;
    this.waveGrace = 3.5;
    this.sinceBlock = 0;
    this.safe = { plat: this.level.last, x: 2 };
    this.safeT = 0;
    this.heroVisible = true;
    this.rig.root.visible = true;
    this.cam.x = 3;
    this.cam.y = this.hero.y + 3;
    this.cam.lookX = 0;
    this.parts.clear();
    this.scarf?.reset();
    this.lastGroundY = this.hero.y;
    void attract;
    this.buildAhead();
    this.syncViews();
  }

  /** Start a scored run. */
  begin() {
    if (this.phase === 'loading') return;
    this.resetWorld(false);
    this.live = true;
    this.setPhase('playing');
    sfx('start');
    this.pushHud();
  }

  toTitle() {
    this.live = false;
    this.resetWorld(true);
    this.setPhase('title');
  }

  pause(on: boolean) {
    if (on && this.phase === 'playing') this.setPhase('paused');
    else if (!on && this.phase === 'paused') {
      this.clock.getDelta();
      this.setPhase('playing');
    }
  }

  // ───────────── Level building ─────────────

  private buildAhead() {
    const need = this.hero.x + 95;
    let n = 0;
    while (this.level.last.x1 < need && n++ < 40) {
      const diff = Math.min(1, Math.max(0, this.maxX) / 1800);
      let block: BlockInfo | null = null;
      if (this.sinceBlock >= 9) {
        block = this.opts.takeBlock();
        if (block) this.sinceBlock = 0;
      }
      const tx = block ? null : this.opts.take();
      this.level.extend({ tx, block }, diff);
      this.sinceBlock++;
    }
    this.level.cull(this.hero.x);
  }

  // ───────────── Views ─────────────

  private platMat(color: string): THREE.MeshStandardMaterial {
    let m = this.matCache.get(color);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: '#15161c', metalness: 0.75, roughness: 0.38 });
    const glow = C(color, 1);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.shared.uTime;
      sh.uniforms.uHero = this.shared.uHero;
      sh.uniforms.uGlow = { value: glow };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uTime; uniform vec3 uHero; uniform vec3 uGlow;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          { vec3 an=abs(normalize(vWN)); vec2 uv = an.y>.6 ? vWP.xz : (an.z>.6 ? vWP.xy : vWP.zy);
            vec2 f=abs(fract(uv)-.5); float l=smoothstep(.45,.5,max(f.x,f.y));
            float near=exp(-length(vWP.xy-uHero.xy)*.14);
            float flow=.5+.5*sin(vWP.x*.5-uTime*2.6);
            float top = smoothstep(.6,.9,an.y);
            totalEmissiveRadiance += uGlow*l*(.10+.55*near+.10*flow) + uGlow*top*.03; }`,
        );
    };
    m.customProgramCacheKey = () => 'hopper-plat';
    this.matCache.set(color, m);
    return m;
  }
  private rimMat(color: string): THREE.MeshBasicMaterial {
    let m = this.rimCache.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: C(color, 1.5), toneMapped: false });
      this.rimCache.set(color, m);
    }
    return m;
  }

  private makePlat(p: Plat): PlatView {
    const len = p.x1 - p.x0;
    const g = new THREE.Group();
    g.position.set((p.x0 + p.x1) / 2, 0, 0);
    const h = p.top - p.bot;
    const body = new THREE.Mesh(this.unitBox, this.platMat(p.color));
    body.scale.set(len, h, DEPTH);
    body.position.y = p.top - h / 2;
    body.receiveShadow = true;
    const rim = new THREE.Mesh(this.unitBox, this.rimMat(p.kind === 'quiet' ? '#6b6b74' : p.color));
    rim.scale.set(len + 0.08, 0.13, DEPTH + 0.08);
    rim.position.y = p.top - 0.065;
    g.add(body, rim);
    const under = new THREE.Mesh(this.unitBox, this.rimMat(p.color));
    under.scale.set(len * 0.96, 0.08, DEPTH * 0.96);
    under.position.y = p.bot;
    g.add(under);
    let label: THREE.Mesh | null = null;
    let tex: THREE.Texture | null = null;
    if (p.label && !p.oneWay) {
      const w = Math.min(len - 0.7, 9);
      tex = labelTexture(KIND_STYLE[p.kind as keyof typeof KIND_STYLE]?.tag ?? 'TX', p.label, p.sub, p.color, w);
      const img = (tex as THREE.CanvasTexture).image as HTMLCanvasElement;
      label = new THREE.Mesh(this.unitPlane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
      (label.material as THREE.Material).userData.own = true;
      label.scale.set(w, (w * img.height) / img.width, 1);
      label.position.set(-len / 2 + w / 2 + 0.45, p.top - 0.38 - label.scale.y / 2, DEPTH / 2 + 0.02);
      g.add(label);
    } else if (p.oneWay) {
      body.scale.y = h;
    }
    let gate: THREE.Group | null = null;
    if (p.gate) {
      gate = new THREE.Group();
      const pm = new THREE.MeshStandardMaterial({ color: '#0e0f13', metalness: 0.8, roughness: 0.3, emissive: '#f2efe6', emissiveIntensity: 0.2 });
      pm.userData.own = true;
      for (const dx of [-5.2, 5.2]) {
        const pylon = new THREE.Mesh(this.unitBox, pm);
        pylon.scale.set(0.9, 10, 0.9);
        pylon.position.set(dx, p.top + 5, -1.6);
        const strip = new THREE.Mesh(this.unitBox, this.rimMat('#f2efe6'));
        strip.scale.set(0.12, 10, 0.12);
        strip.position.set(dx, p.top + 5, -1.6 + 0.5);
        gate.add(pylon, strip);
      }
      const sign = gateTexture(`#${p.gate.height.toLocaleString('en-GB')}`, `${p.gate.txCount.toLocaleString('en-GB')} TXS · ${p.gate.miner || 'UNKNOWN'}`.toUpperCase(), '#27e6ff');
      const sm = new THREE.Mesh(this.unitPlane, new THREE.MeshBasicMaterial({ map: sign, toneMapped: false, transparent: true }));
      sm.scale.set(11.2, 2.8, 1);
      (sm.material as THREE.Material).userData.own = true;
      sm.position.set(0, p.top + 8.6, -1.5);
      gate.add(sm);
      const beam = new THREE.Mesh(this.unitBox, new THREE.MeshBasicMaterial({ color: C(ACCENT.cyan, 1.4), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      beam.scale.set(10.4, 14, 0.05);
      (beam.material as THREE.Material).userData.own = true;
      beam.position.set(0, p.top + 7, -1.55);
      gate.add(beam);
      gate.position.x = -len / 2 + 11;
      g.add(gate);
      tex = tex ?? sign;
    }
    this.root.add(g);
    return { g, body, rim, label, tex, gate, fall: 0, shake: 0 };
  }

  private dropPlat(v: PlatView) {
    this.root.remove(v.g);
    v.g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).userData?.own) {
        const mt = m.material as THREE.MeshBasicMaterial;
        mt.map?.dispose();
        mt.dispose();
      }
    });
  }

  private makeEnemy(e: Enemy): EnemyView {
    const g = new THREE.Group();
    const lime = ACCENT.acid;
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.62, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#101015', metalness: 0.85, roughness: 0.28 }));
    hex.castShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(hex.geometry), new THREE.LineBasicMaterial({ color: C(lime, 2.2), toneMapped: false }));
    const coin = tokenCoinTexture(e.loot ?? { id: e.tokenId, sym: e.sym, icon: null }, lime);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.46, 24), new THREE.MeshBasicMaterial({ map: coin.tex, toneMapped: false, transparent: true }));
    face.position.z = 0.33;
    const bar = new THREE.Mesh(this.unitBox, new THREE.MeshBasicMaterial({ color: C('#ff2a1a', 2.6), toneMapped: false }));
    bar.scale.set(0.95, 0.07, 0.07);
    bar.position.set(0, -0.5, 0.34);
    const thr = new THREE.Mesh(this.unitPlane, new THREE.MeshBasicMaterial({ map: this.haloTex, color: C(lime, 1.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    thr.scale.set(1.8, 1.2, 1);
    thr.position.set(0, -0.62, 0.1);
    g.add(hex, edges, face, bar, thr);
    this.root.add(g);
    return { g, face, coin, tries: 0, loot: e.loot, bar };
  }
  private dropEnemy(v: EnemyView) {
    this.root.remove(v.g);
    v.coin.tex.dispose();
    v.g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.LineSegments).isLineSegments) {
        if (m.geometry !== this.unitBox && m.geometry !== this.unitPlane) m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }

  private makeDrop(d: Drop): DropView {
    const coin = tokenCoinTexture(d.loot);
    const m = new THREE.Mesh(this.unitPlane, new THREE.MeshBasicMaterial({ map: coin.tex, transparent: true, toneMapped: false }));
    m.scale.set(1.05, 1.05, 1);
    const halo = new THREE.Mesh(this.unitPlane, new THREE.MeshBasicMaterial({ map: this.haloTex, color: C('#ffb800', 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.scale.set(2.6, 2.6, 1);
    halo.position.z = -0.05;
    this.root.add(m, halo);
    return { m, halo, coin, tries: 0, loot: d.loot };
  }
  private dropDrop(v: DropView) {
    this.root.remove(v.m, v.halo);
    v.coin.tex.dispose();
    (v.m.material as THREE.Material).dispose();
    (v.halo.material as THREE.Material).dispose();
  }

  private makeSpring(): SpringView {
    const g = new THREE.Group();
    const col = ACCENT.magenta;
    const baseM = new THREE.MeshStandardMaterial({ color: '#101015', metalness: 0.8, roughness: 0.3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.2, 18), baseM);
    base.position.y = 0.1;
    const coilM = new THREE.MeshBasicMaterial({ color: C(col, 2), toneMapped: false });
    const coil: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 18).rotateX(Math.PI / 2), coilM);
      g.add(c);
      coil.push(c);
    }
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.14, 20), new THREE.MeshBasicMaterial({ color: C(ACCENT.paper, 1.6), toneMapped: false }));
    g.add(base, pad);
    this.root.add(g);
    return { g, coil, pad };
  }

  private syncViews() {
    const L = this.level;
    for (const f of L.fresh) this.addView(f);
    L.fresh.length = 0;
    for (const f of L.gone) this.removeView(f);
    L.gone.length = 0;
  }
  private addView(f: Fresh) {
    if (f.k === 'plat') {
      const v = this.makePlat(f.o);
      f.o.view = v;
      this.platViews.set(f.o.id, v);
    } else if (f.k === 'enemy') {
      const v = this.makeEnemy(f.o);
      f.o.view = v;
      this.enemyViews.set(f.o.id, v);
    } else if (f.k === 'drop') {
      const v = this.makeDrop(f.o);
      f.o.view = v;
      this.dropViews.set(f.o.id, v);
    } else if (f.k === 'spring') {
      const v = this.makeSpring();
      f.o.view = v;
      this.springViews.set(f.o.id, v);
    }
  }
  private removeView(f: Fresh) {
    if (f.k === 'plat') {
      const v = this.platViews.get(f.o.id);
      if (v) this.dropPlat(v);
      this.platViews.delete(f.o.id);
    } else if (f.k === 'enemy') {
      const v = this.enemyViews.get(f.o.id);
      if (v) this.dropEnemy(v);
      this.enemyViews.delete(f.o.id);
    } else if (f.k === 'drop') {
      const v = this.dropViews.get(f.o.id);
      if (v) this.dropDrop(v);
      this.dropViews.delete(f.o.id);
    } else if (f.k === 'spring') {
      const v = this.springViews.get(f.o.id);
      if (v) this.root.remove(v.g);
      this.springViews.delete(f.o.id);
    }
  }

  // ───────────── Juice helpers ─────────────

  private popup(text: string, x: number, y: number, color = ACCENT.paper, big = false) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font:900 italic ${big ? 26 : 17}px var(--dr-display),Impact,sans-serif;letter-spacing:.02em;color:${color};text-shadow:0 2px 0 #000,0 0 14px ${color}88;will-change:transform,opacity`;
    this.popLayer.appendChild(el);
    this.pops.push({ el, x, y, life: big ? 1.3 : 0.9 });
    if (this.pops.length > 14) {
      const o = this.pops.shift();
      o?.el.remove();
    }
  }

  private shake(a: number) {
    this.cam.shake = Math.min(1, this.cam.shake + a);
  }
  private doFlash(c: string, a: number) {
    this.flashCol.set(c);
    this.flash = Math.max(this.flash, a);
  }

  private addScore(n: number) {
    this.bonus += n;
  }

  // ───────────── Simulation ─────────────

  private botInput(): SimInput {
    const h = this.hero;
    const look = h.x + 0.5 + Math.abs(h.vx) * 0.16;
    let jump = this.botJump > 0;
    this.botJump = Math.max(0, this.botJump - STEP);
    let dash = false;
    if (h.ground) {
      const near = this.level.near(look - 0.1, look + 0.1);
      const floorAhead = near.some((p) => p.solid && !p.oneWay && p.x0 <= look && p.x1 >= look && p.top <= h.y + 0.2 && p.top >= h.y - 4.5);
      const wallAhead = near.some((p) => p.solid && !p.oneWay && p.x0 <= look + 0.3 && p.x1 >= look && p.top > h.y + 0.2);
      if (!floorAhead || wallAhead) {
        this.botJump = wallAhead ? 0.4 : 0.33;
        jump = true;
      }
    } else if (h.vy < 0 && h.dashAvail) {
      // Falling short of the next platform: dash across.
      const next = this.level.plats.find((p) => p.solid && !p.oneWay && p.x1 > h.x && p.x0 > h.x + 0.5 && p.top <= h.y + 1.2);
      this.botDashT -= STEP;
      if (next && next.x0 - h.x > 2.4 && h.y - next.top < 2.5 && this.botDashT <= 0) {
        dash = true;
        this.botDashT = 0.5;
      }
    }
    return { x: 1, jump, dash };
  }

  private enemyBox(e: Enemy) {
    return { x0: e.x - 0.62, x1: e.x + 0.62, y0: e.y, y1: e.y + 1.25 };
  }

  private step(dt: number, scored: boolean, inp: SimInput) {
    const h = this.hero;
    const lvl = this.level;
    if (this.inv > 0) this.inv -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    let use = scored && this.overT > 0 ? { x: 0, jump: false, dash: false } : inp;
    const live = scored && this.opts.pay.live();
    if (live && ((use.jump && !h.jumping) || (use.dash && h.dashT <= 0)) && !this.opts.pay.can()) {
      use = { x: use.x, jump: use.jump && h.jumping, dash: false };
      if (this.time - this.noAmmoAt > 2.5) {
        this.noAmmoAt = this.time;
        this.opts.cb.onToast({ text: 'OUT OF AMMO · LOAD MORE', tone: 'bad' });
      }
    }
    const ev = h.step(dt, use, lvl);
    if (live) for (const e of ev) if (e.t === 'jump' || e.t === 'walljump' || e.t === 'dash') this.opts.pay.spend([e.t]);
    for (const e of ev) {
      if (e.t === 'jump') {
        this.sqV += 7;
        sfx('jump', 0.9);
        this.parts.burst(h.x, h.y + 0.1, 0.3, 5, 3.5, 0.35, 0.5, C('#b9b2a4', 0.7), 4);
      } else if (e.t === 'walljump') {
        this.sqV += 6;
        hop('walljump');
        this.parts.burst(h.x - e.v * -0.3, h.y + 0.8, 0.3, 9, 5, 0.4, 0.5, C(ACCENT.paper, 1.5), 6);
        this.popup('WALL JUMP', h.x, h.y + 2.2, ACCENT.cyan);
        if (scored) this.addScore(15);
      } else if (e.t === 'dash') {
        hop('dash');
        this.ca = 1;
        this.cam.fov = BASE_FOV + 7;
        this.parts.burst(h.x, h.y + 0.8, 0.3, 10, 7, 0.35, 0.6, C(ACCENT.cyan, 2), 0);
      } else if (e.t === 'land') {
        const k = Math.min(1, e.v / 22);
        this.sq = -0.28 * k;
        this.sqV = 0;
        hop('land', k);
        if (e.v > 7) {
          for (let i = 0; i < 6 + k * 8; i++) {
            const s = i % 2 ? 1 : -1;
            this.parts.emit(h.x + s * 0.2, h.y + 0.05, 0.3, s * (2 + Math.random() * 4.5 * (0.5 + k)), 0.8 + Math.random() * 1.8, (Math.random() - 0.5) * 1.5, 0.45, 0.8 + k * 0.5, 0.75, 0.7, 0.62, 0, 2.5);
          }
        }
        if (e.v > 20) this.shake(0.12);
      } else if (e.t === 'bump') {
        if (e.v > 8) this.shake(0.06);
      } else if (e.t === 'slide') {
        hop('slide');
        if (Math.random() < 0.5) this.parts.emit(h.x + h.wall * 0.3, h.y + 0.3 + Math.random(), 0.3, 0, 1.2, 0, 0.3, 0.45, 1.4, 1.3, 1.1, 0, 0);
      }
    }
    if (h.ground) {
      this.lastGroundY = h.y;
      this.comboT += dt;
      if (this.comboT > 0.25) this.combo = 0;
      // The last safe footing: somewhere stable on a platform that isn't crumbling.
      if (h.ground.solid && !h.ground.crumble && !h.ground.oneWay && h.x > h.ground.x0 + 1.2 && h.x < h.ground.x1 - 1.2) {
        this.safeT += dt;
        if (this.safeT > 0.3) this.safe = { plat: h.ground, x: h.x };
      }
      // Crumbling data platform.
      const c = h.ground.crumble;
      if (c && c.state === 0) {
        c.state = 1;
        c.t = 0;
        sfx('hit', 0.4);
      }
    } else this.comboT = 0;
    if (h.ground) {
      if (h.ground.gate && !h.ground.gate.taken && scored) this.checkpoint(h.ground);
      else if (h.ground.gate && !h.ground.gate.taken) h.ground.gate.taken = true;
    }

    // Crumble timers and falling platforms.
    for (const p of lvl.plats) {
      const c = p.crumble;
      if (!c || c.state === 0) continue;
      c.t += dt;
      if (c.state === 1 && c.t > 0.55) {
        c.state = 2;
        p.solid = false;
        sfx('rekt', 0.35);
        const v = p.view as PlatView | undefined;
        if (v) for (let i = 0; i < 18; i++) this.parts.emit(p.x0 + Math.random() * (p.x1 - p.x0), p.top, 0.5, (Math.random() - 0.5) * 3, Math.random() * 2, 0, 0.6, 0.7, 0.2, 0.4, 1.6, 8, 0.5);
      }
    }

    // Springs.
    for (const s of lvl.springs) {
      if (s.t > 0) s.t = Math.max(0, s.t - dt * 3.2);
      if (Math.abs(h.x - s.x) < 0.75 && h.y >= s.plat.top - 0.1 && h.y < s.plat.top + 0.55 && h.vy <= 1 && s.plat.solid) {
        h.launch(P.SPRING_V, h.vx * 0.6);
        s.t = 1;
        this.sq = 0.3;
        this.sqV = 8;
        sfx('spring');
        this.parts.burst(s.x, s.plat.top + 0.3, 0.4, 14, 6, 0.5, 0.7, C(ACCENT.magenta, 2), 5, 3);
        this.popup('SPRING', s.x, s.plat.top + 2, ACCENT.magenta);
      }
    }

    // Coins.
    for (const c of lvl.coins) {
      if (c.got) continue;
      if (Math.abs(c.x - h.x) < 0.8 && c.y > h.y - 0.35 && c.y < h.y + P.H + 0.4) {
        c.got = true;
        this.coinsGot++;
        if (scored) this.addScore(c.value);
        sfx('coin');
        this.parts.burst(c.x, c.y, 0.3, 6, 4, 0.35, 0.55, C('#ffcf40', 2), 4);
      }
    }

    // Token loot.
    for (const d of lvl.drops) {
      if (d.got) continue;
      if (d.plat || d.vy !== 0) {
        d.vy -= 24 * dt;
        d.y += d.vy * dt;
        const floorY = (d.plat?.top ?? 0) + 1.2;
        if (d.plat && d.y < floorY && d.vy < 0) {
          d.y = floorY;
          d.vy = 0;
          d.plat = null;
        }
      }
      if (Math.abs(d.x - h.x) < 0.95 && d.y > h.y - 0.5 && d.y < h.y + P.H + 0.5) {
        d.got = true;
        d.loot = refreshLoot(d.loot);
        this.tokensGot++;
        if (scored) {
          this.addScore(250);
          this.opts.cb.onPickup?.(d.loot);
        }
        sfx('token');
        this.parts.burst(d.x, d.y, 0.3, 14, 6, 0.55, 0.8, C('#ffd36a', 2), 3);
        this.popup(`+1 ${d.loot.sym}`, d.x, d.y + 1, '#ffd36a');
      }
    }

    // Enemies.
    for (const e of lvl.enemies) {
      if (e.dead > 0) {
        e.dead -= dt;
        continue;
      }
      e.x += e.dir * e.speed * dt;
      if (e.x < e.plat.x0 + 1 || e.x > e.plat.x1 - 1) {
        e.dir *= -1;
        e.x = Math.max(e.plat.x0 + 1, Math.min(e.plat.x1 - 1, e.x));
      }
      e.y = e.plat.top;
      const b = this.enemyBox(e);
      if (h.x + P.HW > b.x0 && h.x - P.HW < b.x1 && h.y < b.y1 && h.y + P.H > b.y0) {
        if (h.dashT > 0) this.killEnemy(e, scored, true);
        else if (h.vy < 0 && h.y > e.y + 0.55) this.killEnemy(e, scored, false);
        else if (this.inv <= 0 && scored) this.hurt('enemy', e.x);
        else if (!scored) h.launch(8);
      }
    }

    // The wall.
    if (scored) {
      if (this.waveGrace > 0) this.waveGrace -= dt;
      else {
        const diff = Math.min(1, this.maxX / 1800);
        let spd = 3.7 + diff * 5.2;
        const gap = h.x - this.waveX;
        if (gap > 34) spd *= 0.15;
        this.waveX += spd * dt;
      }
      if (h.x - this.waveX > 58) this.waveX = h.x - 58;
      if (h.x - P.HW < this.waveX + 0.3 && this.overT <= 0) this.hurt('wall', 0);
      if (h.y < -9 && this.overT <= 0) this.hurt('pit', 0);
    } else if (h.y < -9 || h.x - this.cam.x < -30) {
      // Demo bot fell off: put it back on the chain.
      const p = lvl.platAt(this.cam.x + 4) ?? lvl.last;
      h.place(Math.max(p.x0 + 1.5, this.cam.x + 4), p.top, p);
    }

    this.maxX = Math.max(this.maxX, h.x);
    if (scored) this.runT += dt;
    this.buildAhead();
  }

  private killEnemy(e: Enemy, scored: boolean, dash: boolean) {
    const h = this.hero;
    e.dead = 0.35;
    this.stomps++;
    this.combo++;
    const mult = Math.min(5, 1 + this.combo - 1);
    if (!dash) {
      h.launch(this.input.read().inp.jump ? P.STOMP_HELD_V : P.STOMP_V);
      this.sq = -0.2;
    } else h.dashAvail = true;
    this.freeze = 0.06;
    this.shake(0.22);
    sfx('stomp');
    if (this.combo > 1) hop('combo', this.combo);
    if (scored) this.addScore(100 * mult);
    this.parts.burst(e.x, e.y + 0.7, 0.4, 22, 8, 0.6, 0.9, C(ACCENT.acid, 2.2), 8);
    this.popup(`${dash ? 'DASH ' : ''}+${100 * mult}${this.combo > 1 ? `  x${this.combo}` : ''}`, e.x, e.y + 2, ACCENT.acid, this.combo > 2);
    if (e.loot) this.level.addDrop(e.x, e.y + 1.2, e.loot, 9);
  }

  private checkpoint(p: Plat) {
    if (!p.gate) return;
    p.gate.taken = true;
    this.blocksHit++;
    this.addScore(1000);
    if (this.lives < MAX_LIVES) {
      this.lives++;
      hop('life');
    }
    this.safe = { plat: p, x: Math.max(p.x0 + 2, this.hero.x) };
    this.waveX = Math.min(this.waveX, this.hero.x - 42);
    this.waveGrace = Math.max(this.waveGrace, 2.5);
    this.freeze = 0.14;
    this.shake(0.45);
    this.doFlash('#ffffff', 0.28);
    this.fanfareT = 1.2;
    hop('checkpoint');
    const v = p.view as PlatView | undefined;
    const cx = v?.gate ? v.g.position.x + v.gate.position.x : this.hero.x;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 6 + Math.random() * 12;
      const cols = [ACCENT.cyan, ACCENT.amber, ACCENT.magenta, ACCENT.paper, ACCENT.acid];
      const c = C(cols[i % cols.length], 2);
      this.parts.emit(cx, p.top + 4, 0.5, Math.cos(a) * s, Math.sin(a) * s * 0.8 + 4, (Math.random() - 0.5) * 4, 1.4 + Math.random() * 0.8, 1.1, c.r, c.g, c.b, 7, 0.8);
    }
    this.shockwave.position.set(cx, p.top + 1.5, 0.2);
    this.shockwave.userData.t = 0;
    this.shockwave.visible = true;
    this.opts.cb.onBanner({ title: `BLOCK #${p.gate.height.toLocaleString('en-GB')}`, sub: `${p.gate.txCount.toLocaleString('en-GB')} TXS · ${(p.gate.miner || 'UNKNOWN').toUpperCase()} · +1000 · +1 LIFE`, color: ACCENT.cyan });
  }

  private hurt(why: 'enemy' | 'wall' | 'pit', fromX: number) {
    if (this.inv > 0 && why === 'enemy') return;
    const h = this.hero;
    this.lives--;
    this.combo = 0;
    this.hurtT = 0.5;
    this.freeze = 0.1;
    this.shake(0.55);
    this.doFlash('#ff2a1a', 0.5);
    this.ca = 1.2;
    sfx('hurt');
    this.parts.burst(h.x, h.y + 0.8, 0.4, 28, 9, 0.7, 0.9, C(ACCENT.red, 2.2), 8);
    if (this.lives <= 0) {
      this.overT = 0.001;
      this.slow = 0.3;
      this.heroVisible = false;
      this.rig.root.visible = false;
      this.scarf.mesh.visible = false;
      sfx('gameover');
      this.opts.cb.onToast({ text: why === 'wall' ? 'REORGED' : why === 'pit' ? 'FELL OFF THE CHAIN' : 'DESTROYED', tone: 'bad' });
      return;
    }
    this.opts.cb.onToast({ text: why === 'wall' ? 'REORGED · lost a life' : why === 'pit' ? 'FELL · lost a life' : 'HIT · lost a life', tone: 'bad' });
    if (why === 'enemy') {
      h.launch(9, -Math.sign(fromX - h.x || 1) * 7.5);
      h.lock = 0.25;
      this.inv = 1.8;
    } else {
      // Back onto the chain: the last safe footing, or a bit past the wall.
      let p: Plat | null = null;
      let x = 0;
      if (why === 'pit' && this.safe && this.safe.plat.solid && this.level.plats.includes(this.safe.plat)) {
        p = this.safe.plat;
        x = this.safe.x;
      } else {
        p = this.level.platAt(Math.max(this.waveX + 26, h.x));
        x = p ? Math.max(p.x0 + 2, this.waveX + 26) : 0;
        if (p) x = Math.min(p.x1 - 1.5, x);
      }
      if (p) {
        h.place(x, p.top, p);
        this.waveX = Math.min(this.waveX, x - 26);
        this.waveGrace = 1.5;
      }
      this.inv = 2.2;
      this.safeT = 0;
      this.scarf.reset();
    }
  }

  private gameOver() {
    this.live = false;
    this.setPhase('over');
    const dist = Math.floor(this.maxX);
    this.opts.cb.onOver({ score: this.score(), dist, coins: this.coinsGot, tokens: this.tokensGot, blocks: this.blocksHit, stomps: this.stomps, secs: this.runT, built: this.level.built });
  }

  private score() {
    return this.bonus + Math.floor(Math.max(0, this.maxX) * 10);
  }

  private pushHud() {
    const h = this.hero;
    this.opts.cb.onHud({
      score: this.score(),
      lives: this.lives,
      dist: Math.floor(Math.max(0, this.maxX)),
      coins: this.coinsGot,
      tokens: this.tokensGot,
      combo: this.combo,
      kmh: Math.round(Math.abs(h.vx) * 3.6),
      gap: Math.max(0, Math.round(h.x - this.waveX)),
      dash: h.dashCd > 0 ? 1 - h.dashCd / P.DASH_CD : h.ground || h.dashAvail ? 1 : 0,
      blocks: this.blocksHit,
      built: this.level.built,
    });
  }

  // ───────────── Frame ─────────────

  private frame() {
    if (this.disposed) return;
    let dt = Math.min(0.05, this.clock.getDelta());
    this.perf(dt);
    this.time += dt;
    this.shared.uTime.value = this.time;
    const { inp, edges } = this.input.read();
    if (edges.pause && (this.phase === 'playing' || this.phase === 'paused')) this.pause(this.phase === 'playing');
    const playing = this.phase === 'playing';
    const attract = this.phase === 'title' || this.phase === 'over';
    if (this.phase !== 'paused') {
      if (this.freeze > 0) {
        this.freeze -= dt;
        dt = 0;
      }
      const sdt = dt * (this.overT > 0 ? this.slow : 1);
      this.acc += sdt;
      let n = 0;
      while (this.acc >= STEP && n++ < 12) {
        this.acc -= STEP;
        if (playing) this.step(STEP, true, this.autoplay ? this.botInput() : inp);
        else if (this.phase === 'title' || (this.phase === 'over' && this.heroVisible)) this.step(STEP, false, this.botInput());
      }
      if (this.acc > STEP * 12) this.acc = 0;
      if (this.overT > 0) {
        this.overT += dt;
        if (this.overT > 1.5 && this.phase === 'playing') this.gameOver();
      }
    }
    void attract;
    this.updateVisuals(dt);
    this.hudT += dt;
    if (this.hudT > 0.066 && playing) {
      this.hudT = 0;
      this.pushHud();
    }
    this.camera.updateMatrixWorld();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private updateVisuals(dt: number) {
    const h = this.hero;
    const t = this.time;
    this.syncViews();
    this.shared.uHero.value.set(h.x, h.y + 1, 0);

    // Squash and stretch spring.
    const k = 220;
    const c = 17;
    this.sqV += (-k * this.sq - c * this.sqV) * dt;
    this.sq += this.sqV * dt;
    const airStretch = h.ground ? 0 : THREE.MathUtils.clamp(Math.abs(h.vy) * 0.008, 0, 0.16);
    const squashY = Math.max(0.6, 1 + this.sq + airStretch);

    // Hero.
    this.rig.root.position.set(h.x, h.y, 0);
    const spd = Math.abs(h.vx) / P.RUN;
    this.rig.update(dt, { speed: h.ground ? spd : 0, grounded: !!h.ground, vy: h.vy, wall: h.wall !== 0 && h.wallT > 0 && !h.ground ? h.wall : 0, dashing: h.dashT > 0, hurt: this.hurtT > 0, face: h.face, time: t }, squashY);
    const blink = this.inv > 0 && Math.floor(t * 18) % 2 === 0;
    this.rig.root.visible = this.heroVisible && !blink;
    this.rig.root.updateMatrixWorld(true);
    const neck = this.rig.neckWorld(this.tmpV);
    this.scarf.mesh.visible = this.heroVisible;
    this.scarf.update(dt, neck, h.vx, h.vy, h.face);
    this.heroLight.position.set(h.x + h.face * 0.6, h.y + 1.6, 3);
    this.heroLight.color.set(h.dashT > 0 ? ACCENT.cyan : this.hurtT > 0 ? '#ff2a1a' : '#ff6a50');

    // Dust and dash trails.
    if (h.ground && Math.abs(h.vx) > 6 && this.phase !== 'paused') {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.06;
        this.parts.emit(h.x - h.face * 0.35, h.y + 0.08, 0.2, -h.face * (0.8 + Math.random()), 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6, 0.4, 0.6, 0.7, 0.66, 0.6, 0, 2.5);
      }
    }
    if (h.dashT > 0) {
      this.streakT -= dt;
      if (this.streakT <= 0) {
        this.streakT = 0.025;
        this.streaks.add(h.x - h.face * 0.5, h.y + 0.8, 1.4, 1.3, C(ACCENT.cyan));
        this.parts.emit(h.x, h.y + 0.5 + Math.random() * 0.7, 0.3, -h.face * 3, 0, 0, 0.3, 0.7, 0.3, 1.6, 2.2, 0, 3);
      }
    }
    this.streaks.update(dt);

    // Contact shadow / landing marker.
    const below = this.level.near(h.x - 0.3, h.x + 0.3);
    let fy = -Infinity;
    for (const p of below) if (p.solid && h.x + P.HW > p.x0 && h.x - P.HW < p.x1 && p.top <= h.y + 0.05 && p.top > fy) fy = p.top;
    const show = fy > -Infinity && this.heroVisible;
    this.blob.visible = show;
    this.landRing.visible = show && !h.ground && h.y - fy > 0.8 && h.y - fy < 10;
    if (show) {
      const hgt = Math.max(0, h.y - fy);
      const s = Math.max(0.35, 1 - hgt * 0.08);
      this.blob.position.set(h.x, fy + 0.03, 0);
      this.blob.scale.set(s, 1, s);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.45 * s;
      this.landRing.position.set(h.x, fy + 0.05, 0);
      const rs = 1 + Math.sin(t * 9) * 0.06 + hgt * 0.02;
      this.landRing.scale.set(rs, 1, rs);
    }

    // Platform views: crumble shake/fall.
    for (const p of this.level.plats) {
      const v = p.view as PlatView | undefined;
      if (!v) continue;
      const cr = p.crumble;
      if (cr && cr.state === 1) {
        v.g.position.x = (p.x0 + p.x1) / 2 + Math.sin(t * 90) * 0.06;
        v.g.position.y = Math.sin(t * 70) * 0.03;
      } else if (cr && cr.state === 2) {
        v.fall += dt * 14;
        v.g.position.y -= v.fall * dt;
        v.g.rotation.z += dt * 0.25 * (p.id % 2 ? 1 : -1);
        if (v.g.position.y < -45) v.g.visible = false;
      }
      if (p.gate && v.gate) {
        v.gate.children.forEach((c, i) => {
          if (i === 4 || i === 5) {
            const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
            if (p.gate!.taken) m.opacity = THREE.MathUtils.lerp(m.opacity, i === 5 ? 0.5 : 1, 0.1);
          }
        });
      }
    }

    // Enemies.
    for (const e of this.level.enemies) {
      const v = e.view as EnemyView | undefined;
      if (!v) continue;
      const dying = e.dead > 0;
      v.g.position.set(e.x, e.y + 0.72 + Math.sin(t * 3 + e.id) * 0.06, 0);
      v.g.rotation.y = e.dir > 0 ? 0.35 : -0.35;
      if (dying) {
        const u = 1 - e.dead / 0.35;
        v.g.scale.set(1 + u * 0.8, Math.max(0.05, 1 - u), 1 + u * 0.8);
        v.g.visible = u < 0.95;
      } else v.g.scale.set(1, 1, 1);
      (v.bar.material as THREE.MeshBasicMaterial).color.setScalar(1).multiply(C('#ff2a1a', 1.4 + Math.sin(t * 8 + e.id) * 1.2));
      if (!v.coin.ok && ++v.tries % 40 === 0 && v.tries < 600) {
        v.coin.ok = drawTokenCoin(v.coin.canvas, v.loot ?? { id: e.tokenId, sym: e.sym, icon: null }, ACCENT.acid);
        v.coin.tex.needsUpdate = true;
      }
    }
    for (const d of this.level.drops) {
      const v = d.view as DropView | undefined;
      if (!v) continue;
      v.m.visible = v.halo.visible = !d.got;
      const bob = d.plat ? 0 : Math.sin(t * 3.2 + d.id) * 0.18;
      v.m.position.set(d.x, d.y + bob, 0.1);
      v.halo.position.set(d.x, d.y + bob, 0.05);
      v.m.rotation.y = Math.sin(t * 2 + d.id) * 0.35;
      v.halo.scale.setScalar(2.4 + Math.sin(t * 5 + d.id) * 0.25);
      if (!v.coin.ok && ++v.tries % 40 === 0 && v.tries < 600) {
        v.coin.ok = drawTokenCoin(v.coin.canvas, v.loot);
        v.coin.tex.needsUpdate = true;
      }
    }
    for (const s of this.level.springs) {
      const v = s.view as SpringView | undefined;
      if (!v) continue;
      const comp = 1 - s.t * 0.55 + (s.t > 0.5 ? 0 : 0);
      v.g.position.set(s.x, s.plat.top, 0);
      v.coil.forEach((c, i) => (c.position.y = 0.22 + (i + 0.5) * 0.17 * (s.t > 0 ? 1 + (1 - s.t) * 0.6 : comp)));
      v.pad.position.y = 0.22 + 4 * 0.17 * (s.t > 0 ? 1 + (1 - s.t) * 0.6 : comp) + 0.1;
    }

    // Coins (instanced).
    let n = 0;
    for (const c of this.level.coins) {
      if (c.got || c.x < this.cam.x - 24 || c.x > this.cam.x + 40 || n >= 220) continue;
      this.eul.set(0, t * 3 + c.id * 0.7, 0);
      this.quat.setFromEuler(this.eul);
      this.scl.setScalar(1);
      this.mat4.compose(this.tmpV2.set(c.x, c.y + Math.sin(t * 3 + c.id) * 0.1, 0), this.quat, this.scl);
      this.coinMesh.setMatrixAt(n++, this.mat4);
    }
    this.coinMesh.count = n;
    this.coinMesh.instanceMatrix.needsUpdate = true;

    // Wall of static.
    this.wall.mesh.position.x = this.waveX - 40;
    this.wall.mat.uniforms.uEdge.value = this.waveX;
    this.wall.mat.uniforms.uTime.value = t;
    this.wall.mesh.position.y = this.cam.y + 6;
    const gap = h.x - this.waveX;
    const near = this.live ? Math.max(0, 1 - gap / 18) : 0;
    this.wall.mat.uniforms.uPower.value = this.live ? 1 : 0;
    this.wall.mesh.visible = this.live;
    if (near > 0.5 && this.phase === 'playing') {
      this.warnT -= dt;
      if (this.warnT <= 0) {
        this.warnT = 0.7;
        hop('warn');
      }
    }
    if (this.live && this.phase === 'playing' && Math.random() < dt * 40) {
      this.parts.emit(this.waveX + 0.2, this.cam.y - 8 + Math.random() * 22, 3.2, 1 + Math.random() * 3, (Math.random() - 0.3) * 2, 0, 0.6, 1.2, 2, 0.35, 0.18, 0, 1);
    }

    // Shockwave.
    if (this.shockwave.visible) {
      const u = (this.shockwave.userData.t = (this.shockwave.userData.t as number) + dt);
      this.shockwave.scale.setScalar(1 + u * 28);
      (this.shockwave.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - u * 1.2);
      if (u > 0.8) this.shockwave.visible = false;
    }

    // Camera.
    const attractMode = this.phase === 'title' || (this.phase === 'over' && this.overT <= 0);
    const lead = THREE.MathUtils.clamp(h.vx * 0.42, -5, 7.5);
    const wantX = h.x + lead + (attractMode ? 3 : 0);
    this.cam.x += (wantX - this.cam.x) * (1 - Math.exp(-5.5 * dt));
    let wantY = (h.ground ? h.y : this.lastGroundY * 0.55 + h.y * 0.45) + 2.6;
    if (h.y < -2) wantY = Math.max(wantY, -3);
    const dy = wantY - this.cam.y;
    this.cam.y += dy * (1 - Math.exp(-(Math.abs(dy) > 3 ? 7 : 3.2) * dt));
    const wantFov = BASE_FOV + Math.min(6, Math.abs(h.vx) * 0.22 + (h.dashT > 0 ? 6 : 0)) + (this.fanfareT > 0 ? 6 : 0) + (attractMode ? 2 : 0);
    this.cam.fov += (wantFov - this.cam.fov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(this.camera.fov - this.cam.fov) > 0.01) {
      this.camera.fov = this.cam.fov;
      this.camera.updateProjectionMatrix();
      this.parts.setScale(this.renderer.domElement.height, this.camera.fov);
    }
    this.fanfareT = Math.max(0, this.fanfareT - dt);
    this.cam.shake = Math.max(0, this.cam.shake - dt * 1.9);
    const sh = this.cam.shake * this.cam.shake;
    const sx = (Math.sin(t * 61) + Math.sin(t * 37.3)) * 0.5 * sh * 1.1;
    const sy = (Math.sin(t * 53.7) + Math.cos(t * 41.1)) * 0.5 * sh * 0.9;
    const dist = this.cam.dist + (attractMode ? 3 : 0);
    this.camera.position.set(this.cam.x - 3.2 + sx, this.cam.y + 0.3 + sy, dist);
    this.camera.lookAt(this.cam.x + 1.2 + sx * 0.5, this.cam.y - 1.6 + sy * 0.5, 0);
    this.camera.rotation.z += sx * 0.012;
    this.key.position.set(this.cam.x - 8, 16, 14);
    this.key.target.position.set(this.cam.x + 2, this.cam.y - 2, 0);
    this.key.target.updateMatrixWorld();

    // Backdrop follows the camera.
    this.sky.position.copy(this.camera.position);
    this.sea.position.x = this.camera.position.x;
    (this.sea.material as THREE.ShaderMaterial).uniforms.uCam.value.copy(this.camera.position);
    for (const L of this.skyline) {
      const im = L.mesh;
      const u = im.material as THREE.ShaderMaterial;
      u.uniforms.uCam.value.copy(this.camera.position);
      for (let i = 0; i < L.base.length; i++) {
        const x = L.base[i] + L.span * Math.floor((this.camera.position.x - L.base[i]) / L.span + 0.5);
        this.scl.set(L.w[i], L.h[i], L.w[i] * 0.9);
        this.mat4.compose(this.tmpV2.set(x, -26 + L.h[i] / 2 + (L.z < -100 ? 8 : 0), L.z + (i % 3) * 2), this.quat.identity(), this.scl);
        im.setMatrixAt(i, this.mat4);
      }
      im.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < 18; i++) {
      const bx = Math.floor((this.camera.position.x - i * 17.3) / 320 + 0.5) * 320 + i * 17.3 + 40 * Math.sin(i * 12.9);
      const bh = 70 + 40 * Math.sin(t * 0.8 + i * 3.1);
      this.mat4.compose(this.tmpV2.set(bx, -26 + bh / 2, -52 - (i % 4) * 18), this.quat.identity(), this.scl.set(0.9, bh, 0.9));
      this.beams.setMatrixAt(i, this.mat4);
    }
    this.beams.instanceMatrix.needsUpdate = true;
    const nd = this.debris.count;
    for (let i = 0; i < nd; i++) {
      const sx2 = 22 + (i % 7) * 9.5;
      const bx = Math.floor((this.camera.position.x - i * 11.7) / (nd * 9)) * (nd * 9) + i * 11.7 + nd * 9 * 0.5;
      const by = this.cam.y + 5 + Math.sin(i * 7.1) * 11 + Math.sin(t * 0.6 + i) * 0.8;
      this.eul.set(t * 0.3 + i, t * 0.4 + i * 2, 0);
      this.quat.setFromEuler(this.eul);
      const s = 0.5 + (i % 4) * 0.35;
      this.mat4.compose(this.tmpV2.set(bx + (sx2 - 40) * 0.2, by, -6 - (i % 5) * 4), this.quat, this.scl.set(s, s, s));
      this.debris.setMatrixAt(i, this.mat4);
    }
    this.debris.instanceMatrix.needsUpdate = true;
    this.quat.identity();

    // Particles, popups and the grade.
    this.parts.update(dt);
    this.projectPops(dt);
    if (this.grade) {
      const u = this.grade.uniforms;
      this.flash = Math.max(0, this.flash - dt * 2.6);
      this.ca = Math.max(0, this.ca - dt * 3);
      u.uFlashA.value = this.flash;
      u.uFlash.value.copy(this.flashCol);
      u.uCA.value = 0.0006 + this.ca * 0.012 + Math.min(0.004, Math.abs(h.vx) * 0.0001);
      u.uWarn.value = this.live ? Math.max(near * 0.9, this.hurtT > 0 ? 0.6 : 0) : 0;
      u.uTime.value = t;
    }
    if (this.bloom) this.bloom.strength = (this.fxLevel >= 2 ? 0.5 : 0.42) + (this.fanfareT > 0 ? 0.25 : 0);
  }

  private projectPops(dt: number) {
    if (!this.pops.length) return;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      p.y += dt * 1.8;
      this.tmpV.set(p.x, p.y, 0.5).project(this.camera);
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      p.el.style.transform = `translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px) translate(-50%,-50%)`;
      p.el.style.opacity = String(Math.min(1, p.life * 2.5));
    }
  }

  // ───────────── Adaptive quality ─────────────

  private perf(dt: number) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (this.phase === 'loading' || this.phase === 'paused') return;
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
      this.renderer.shadowMap.enabled = false;
      this.key.castShadow = false;
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
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.composer?.dispose();
      for (const v of this.platViews.values()) this.dropPlat(v);
      for (const v of this.enemyViews.values()) this.dropEnemy(v);
      for (const v of this.dropViews.values()) this.dropDrop(v);
      this.rig.dispose();
      this.parts?.dispose();
      this.scarf?.dispose();
      this.streaks?.dispose();
      for (const m of this.matCache.values()) m.dispose();
      for (const m of this.rimCache.values()) m.dispose();
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.Points).isPoints) {
          m.geometry?.dispose();
          const mt = m.material as THREE.Material | THREE.Material[] | undefined;
          if (mt) for (const x of Array.isArray(mt) ? mt : [mt]) x.dispose();
        }
      });
      this.haloTex?.dispose();
      (this.scene.environment as THREE.Texture | null)?.dispose();
      this.pmrem?.dispose();
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.popLayer.remove();
  }
}

