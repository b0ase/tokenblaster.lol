'use client';

import { useEffect, useRef, useState } from 'react';
import { CutscenePlayer } from '@/components/city/CutscenePlayer';
import { CUTSCENES } from '@/lib/city/story/cutscenes';
import { loadProgress, markSeen } from '@/lib/city/story/progress';
import type { Cutscene, Shot } from '@/lib/city/story/types';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPeds } from '@/lib/city/peds';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { KINDS, type FeedTx, type TxKind } from '@/lib/feed';
import { chibiClips } from '@/lib/chibiAnims';
import { GIRL_KEY, NPG_GIRLS, girlUrl } from '@/lib/npgGirls';
import { tokenMeta } from '@/lib/tokenMeta';
import { useChainFeed } from '@/lib/useChainFeed';
import {
  BOUND,
  CURB_H,
  EDGE,
  INT,
  N,
  P,
  circleBox,
  edgePoint,
  groundY,
  lightState,
  makeBlocks,
  nodeCoord,
  nodeXZ,
  segmentHit,
  sidewalkSpot,
  solidBoxes,
  squareCentre,
  type Edge,
} from '@/lib/city/layout';
import { buildWorld } from '@/lib/city/world';
import { createVehicleKit, PAINTS, type Built, type ModelKey } from '@/lib/city/vehicles';
import { GameAudio } from './SoundToggle';
import { CoinOpButtons, useCoinOp } from './InsertCoin';
import { ActionAmmo, ActionHud, AmmoAlerts } from './ActionAmmo';
import { useActionPay } from '@/lib/useActionPay';
import { HighScores } from './HighScores';
import { buildCityDetail } from '@/lib/visuals/cityDetail';
import { buildPlaza, buildStreetSigns, cityUniforms, createStreetLight } from '@/lib/city/art';
import { QUALITY_PRESETS, autoCityQuality, saveCityQuality, type CityQuality } from '@/lib/visuals/cityQuality';
import { getNowPlaying, setStation, sharedAudio, subscribeAudio, type Track } from '@/lib/sfx';
import { CRIME, buildHeli, buildLightBar, copVmax, copsFor, createSiren, loseAfter } from '@/lib/city/police';
import { useGameFullscreen } from '@/lib/useGameFullscreen';

/**
 * Satoshi City: an open-world island city where the traffic is the BSV mainnet, live. Every car
 * driving the grid is a real transaction (payments are cars, data vans and taxis, inscriptions box
 * trucks and buses, token transfers box trucks wearing the token's logo, TokenBlaster blasts
 * supercars). Walk, steal any car, drive, deliver the next block before the timer runs out.
 *
 * Entry: PLAY · 10p (coin-op, src/lib/coinop.ts) or PRACTICE (free). LIVE blasting (optional, paid entry only):
 * each car stolen / carjacked, each block delivered and each mempool-rush checkpoint is one tiny real tx
 * (src/lib/useActionPay.ts). Out of ammo: you can't take a car until you load more.
 */
const DAY_S = 240;
const AI_CAP: Record<CityQuality, number> = { high: 40, low: 30 };
const BODY_CAP = 26;
const BEST = 'tokenblaster:city-best';
const KIND_COL = Object.fromEntries(KINDS.map((k) => [k.id, k.color])) as Record<TxKind, string>;

type Hud = {
  score: number;
  best: number;
  driving: boolean;
  speed: number;
  health: number;
  mission: null | { title: string; sub: string; time: number };
  prompt: string;
  clock: string;
  drift: number;
  locked: boolean;
  carLabel: string;
  feedNote: string;
  stars: number;
  heatLost: boolean;
  cine: boolean;
};
const HUD0: Hud = { score: 0, best: 0, driving: false, speed: 0, health: 100, mission: null, prompt: '', clock: '', drift: 0, locked: false, carLabel: '', feedNote: '', stars: 0, heatLost: false, cine: false };

/** In-car radio (R to retune). Each station rides one of the site's licensed playlists (public/music/CREDITS.md). */
const RADIO: { id: Track; name: string; tag: string; col: string; album?: boolean }[] = [
  { id: 'city', name: 'BLOCK FM', tag: 'news read off the live chain', col: '#ffd23f' },
  { id: 'doubleo', name: 'VEXVOID FM', tag: 'Echoes in the Abyss · VexVoid', col: '#28e7ff', album: true },
  { id: 'arena', name: 'COURT TV RADIO', tag: 'day 4,012: the Professor v. everyone', col: '#ff3b5c' },
  { id: 'hopper', name: 'SIGNAL 1MB', tag: 'pirate broadcast · run a full node', col: '#3bff8a' },
  { id: 'kweg', name: 'SILK RADIO', tag: 'five stars · trusted vendor · do not ask', col: '#c77dff' },
];
const BMUSIC = 'https://bitcoin-music.vercel.app/bmusic/streams/first-12/';
type Control = { setGirl: (slug: string) => void; cine: (s: Shot | null) => void; setQuality: (q: CityQuality) => void; key: (k: keyof Input, down: boolean) => void; action: (a: 'f' | 'horn' | 'skip' | 'tx') => void; start: () => void };
type Input = { up: boolean; down: boolean; left: boolean; right: boolean; sprint: boolean; jump: boolean };

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const kindLabel = (k: TxKind) => KINDS.find((x) => x.id === k)?.label ?? k;

export function SatoshiCity() {
  const mount = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const feed = useChainFeed();
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const [hud, setHud] = useState<Hud>(HUD0);
  const [toast, setToast] = useState<null | { text: string; sub: string; n: number; col: string }>(null);
  const [wasted, setWasted] = useState<null | { by: string; id: string; sim: boolean }>(null);
  const [busted, setBusted] = useState<null | { stars: number }>(null);
  const [radio, setRadio] = useState<null | { i: number; n: number; sub: string }>(null);
  const [song, setSong] = useState('');
  const [album, setAlbum] = useState<string[]>([]);
  useEffect(() => subscribeAudio(() => setSong(getNowPlaying()?.title ?? '')), []);
  // VexVoid FM: the album's track list comes from the live bMusic manifest (the audio itself is paid per second there).
  const wantAlbum = radio !== null && !!RADIO[radio.i].album;
  useEffect(() => {
    if (!wantAlbum || album.length) return;
    fetch(`${BMUSIC}manifest.json`)
      .then((r) => r.json())
      .then((m: { tracks?: { title: string }[] }) => setAlbum((m.tracks ?? []).map((t) => t.title)))
      .catch(() => {});
  }, [wantAlbum, album.length]);
  const [started, setStarted] = useState(false);
  const [cine, setCine] = useState<Cutscene | null>(null);
  const onShot = (s: Shot) => control.current?.cine(s);
  const endCine = () => {
    if (cine) markSeen(cine.id);
    control.current?.cine(null);
    setCine(null);
  };
  // Hall of fame: post this visit's score (snapshot taken when the player asks, not on every frame).
  const runStart = useRef(0);
  const [post, setPost] = useState<{ score: number; secs: number; live: boolean } | null>(null);
  const co = useCoinOp('Satoshi City', 'city');
  const ap = useActionPay('city', 'Satoshi City');
  const pay = ap.pay;
  const [quality, setQualityState] = useState<CityQuality>('high');
  const control = useRef<Control | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  // Open world: no run end, so fullscreen is purely the player's toggle (button, G anywhere, F on the title screen).
  const gfs = useGameFullscreen(stage, { playing: false });
  const toggleFs = gfs.toggle;
  const startedRef = useRef(started);
  useEffect(() => {
    startedRef.current = started;
  });
  useEffect(() => {
    const onK = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // F is carjack / get in once you're in the city, so in-game the fullscreen key is G.
      if (e.code === 'KeyG' || (e.code === 'KeyF' && !startedRef.current)) {
        e.preventDefault();
        toggleFs();
      }
    };
    window.addEventListener('keydown', onK);
    return () => window.removeEventListener('keydown', onK);
  }, [toggleFs]);

  useEffect(() => {
    const el = mount.current;
    const mapCanvas = mapRef.current;
    if (!el || !mapCanvas) return;
    let disposed = false;
    // MSAA lives on the composer's render target (the canvas itself is only the final blit).
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    let quality: CityQuality = autoCityQuality();
    setQualityState(quality);
    // Adaptive resolution: dprScale walks down on slow frames (before the watchdog drops the whole tier) and back up.
    let dprScale = 1;
    const pixelRatioFor = (q: CityQuality) => Math.max(0.6, Math.min(devicePixelRatio, QUALITY_PRESETS[q].pixelRatio) * dprScale);
    renderer.setPixelRatio(pixelRatioFor(quality));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = roomEnv;
    scene.fog = new THREE.Fog('#9fb4c8', 140, 520);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);

    const blocks = makeBlocks();
    const boxes = solidBoxes(blocks);
    const camBoxes = boxes.filter((b) => b.h > 2.5);
    const world = buildWorld(scene, blocks);
    const detail = buildCityDetail(scene, blocks, quality);
    const street = createStreetLight(scene, world.lightSources, quality);
    const plaza = buildPlaza(scene, ...squareCentre(), 60);
    buildStreetSigns(scene);
    const peds = createPeds(scene, blocks, quality === 'high' ? 56 : 40); // sidewalk walkers (real rigged models)
    const edges = world.edges;
    const edgesFrom: Edge[][] = Array.from({ length: N * N }, () => []);
    for (const e of edges) edgesFrom[e.a].push(e);

    let hdrSky: THREE.DataTexture | null = null;
    let hdrEnv: THREE.Texture | null = null;
    new HDRLoader().load('/arcade/frogger/tex/potsdamer_platz.hdr', (t) => {
      if (disposed) return t.dispose();
      t.mapping = THREE.EquirectangularReflectionMapping;
      hdrSky = t;
      hdrEnv = pmrem.fromEquirectangular(t).texture;
      scene.environment = hdrEnv;
      world.setEnv(hdrEnv);
    });

    // ── Post: AO, bloom on real lights, the city grade (and the WASTED grade) ──
    const composerRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 2 });
    const composer = new EffectComposer(renderer, composerRT);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 512, 512);
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 8, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    gtao.blendIntensity = 0.8;
    gtao.enabled = QUALITY_PRESETS[quality].ao;
    // GTAOPass draws with an override material and only hides Points/Lines: sprites (the moon, glows) would become
    // opaque AO-darkened quads. Hide them for its passes (same fix as DoubleO / rally).
    {
      const sprites: THREE.Object3D[] = [];
      const aoRender = gtao.render.bind(gtao) as (...a: unknown[]) => void;
      gtao.render = ((...a: unknown[]) => {
        sprites.length = 0;
        scene.traverseVisible((o) => {
          if ((o as THREE.Sprite).isSprite) sprites.push(o);
        });
        for (const o of sprites) o.visible = false;
        aoRender(...a);
        for (const o of sprites) o.visible = true;
      }) as typeof gtao.render;
    }
    composer.addPass(gtao);
    // Clamp HDR before bloom: a hard specular glint (point light on wet glass) can overflow half-float to Inf,
    // and the bloom blur would smear that over the whole frame.
    composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 v = c.rgb; if (any(isnan(v)) || any(isinf(v))) v = vec3(0.0); gl_FragColor = vec4(min(v, vec3(40.0)), c.a); }`,
      }),
    );
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.5, 0.95);
    composer.addPass(bloom);
    const grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, time: { value: 0 }, night: { value: 0 }, haze: { value: new THREE.Color() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float amount; uniform float time; uniform float night; uniform vec3 haze; varying vec2 vUv;
        float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + time) * 43758.5453); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          vec3 base = mix(vec3(g), c.rgb, 1.14);
          float sh = 1.0 - smoothstep(0.0, 0.35, g);
          base *= mix(vec3(1.0), mix(vec3(0.93, 1.0, 1.06), vec3(0.9, 0.97, 1.12), night), sh);
          base *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), smoothstep(0.5, 1.5, g) * (1.0 - night));
          // DR grade: violet-teal shadows, warm-magenta highlights at night; a low haze band over the horizon.
          float lg = dot(base, vec3(0.299, 0.587, 0.114));
          base = mix(base, base * vec3(0.86, 0.9, 1.18) + vec3(0.012, 0.004, 0.03), (1.0 - smoothstep(0.0, 0.4, lg)) * night);
          base = mix(base, base * vec3(1.08, 0.97, 1.02), smoothstep(0.45, 1.2, lg) * night);
          float hy = (vUv.y - 0.5) * 3.2; base += haze * exp(-hy * hy) * (0.05 + 0.07 * night);
          // Day look: a filmic S-curve, teal shadows and warm highlights, so daylight has the arena's weight.
          float dl = dot(base, vec3(0.299, 0.587, 0.114));
          vec3 sc = base * base * (3.0 - 2.0 * min(base, vec3(1.0)));
          base = mix(base, mix(base, sc, 0.35), 1.0 - night);
          base = mix(base, base * vec3(0.9, 1.0, 1.08), (1.0 - smoothstep(0.0, 0.3, dl)) * (1.0 - night) * 0.8);
          base = mix(base, base * vec3(1.07, 1.0, 0.9), smoothstep(0.4, 1.0, dl) * (1.0 - night) * 0.7);
          base *= mix(1.0, smoothstep(1.05, 0.3, distance(vUv, vec2(0.5))), 0.5);
          g = dot(base, vec3(0.299, 0.587, 0.114));
          vec3 mono = vec3(g) * vec3(1.05, 0.93, 0.9);
          vec3 col = mix(base, mono, amount);
          col = mix(col, (col - 0.5) * 1.25 + 0.45, amount * 0.6);
          col *= mix(1.0, smoothstep(0.85, 0.25, distance(vUv, vec2(0.5))), amount);
          col += (rnd(vUv * 900.0) - 0.5) * 0.07 * amount;
          gl_FragColor = vec4(col, c.a);
        }`,
    });
    composer.addPass(grade);
    composer.addPass(new OutputPass());

    // ── Light ──
    const SUN_LOW = new THREE.Color('#ff9a5a');
    const hemi = new THREE.HemisphereLight('#cfe4ff', '#3a2a22', 1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff1dc', 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(QUALITY_PRESETS[quality].shadowMap, QUALITY_PRESETS[quality].shadowMap);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    const headLamp = new THREE.SpotLight('#fff4dc', 0, 70, 0.55, 0.45, 1.2);
    const headTarget = new THREE.Object3D();
    // Light-bar spill: two point lights that ride the nearest patrol car (always in the scene so no shader recompiles).
    const copLights = [new THREE.PointLight('#ff1030', 0, 26, 1.4), new THREE.PointLight('#1060ff', 0, 26, 1.4)];
    for (const l of copLights) scene.add(l);
    const heli = buildHeli(scene);
    headLamp.target = headTarget;

    // ── Vehicles ──
    const kit = createVehicleKit();
    let kitReady = false;

    // ── Player (NPG chibi, code-made idle/walk/run) ──
    const player = new THREE.Group();
    scene.add(player);
    let mixer: THREE.AnimationMixer | null = null;
    const acts: { idle?: THREE.AnimationAction; walk?: THREE.AnimationAction; run?: THREE.AnimationAction } = {};
    const weights = { idle: 1, walk: 0, run: 0 };
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    // The player character: the chibi doll or any NPG girl on its rig (picked on the title screen, remembered).
    let loadSeq = 0;
    const loadCharacter = (slug: string) => {
      const seq = ++loadSeq;
      loader.load(girlUrl(slug), (gl) => {
        if (disposed || seq !== loadSeq) return;
        const clips = chibiClips(gl.scene, { armsDown: slug === 'doll' });
        const model = slug === 'doll' ? cloneSkinned(gl.scene) : gl.scene;
        model.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(model, true);
        const s = 1.6 / Math.max(0.01, b.max.y - b.min.y);
        model.scale.multiplyScalar(s);
        model.position.y = -b.min.y * s;
        model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.frustumCulled = false;
          }
        });
        mixer?.stopAllAction();
        player.clear();
        player.add(model);
        mixer = new THREE.AnimationMixer(model);
        for (const name of ['idle', 'walk', 'run'] as const) {
          const c = clips.find((x) => x.name === name);
          if (!c) continue;
          const a = mixer.clipAction(c);
          a.play();
          a.setEffectiveWeight(name === 'idle' ? 1 : 0);
          acts[name] = a;
        }
      });
    };
    let initialGirl = 'doll';
    try {
      initialGirl = localStorage.getItem(GIRL_KEY) ?? 'doll';
    } catch {
      /* storage blocked */
    }
    if (!NPG_GIRLS.some((g) => g.slug === initialGirl)) initialGirl = 'doll';
    loadCharacter(initialGirl);

    // ── Game state ──
    const [sqx, sqz] = squareCentre();
    const SPAWN = { x: sqx, z: sqz + 12 };
    const ped = { x: SPAWN.x, z: SPAWN.z, y: CURB_H, vy: 0, heading: Math.PI, onGround: true, speed: 0 };
    type Body = { b: Built; x: number; z: number; th: number; vx: number; vz: number; w: number; f: FeedTx | null; health: number; awake: boolean; parked: boolean };
    type Turn = { to: Edge; ax: number; az: number; cx: number; cz: number; bx: number; bz: number; len: number; t: number };
    type Ai = { b: Built; f: FeedTx; edge: Edge; next: Edge; s: number; turn: Turn | null; v: number; vmax: number; born: number; stun: number; x: number; z: number; th: number; honk: number };
    const bodies: Body[] = [];
    const ai: Ai[] = [];
    // The Miners: patrol cars chasing you (own array: they drive), roadblocks (parked bodies), the 5-star helicopter.
    type Cop = { bd: Body; bar: ReturnType<typeof buildLightBar>; phase: number; stuck: number; rev: number; wp: number; born: number };
    const cops: Cop[] = [];
    type Roadblock = { cars: { bd: Body; bar: ReturnType<typeof buildLightBar> }[]; born: number };
    const roadblocks: Roadblock[] = [];
    let car: Body | null = null;
    let score = 0;
    let best = 0;
    try {
      best = Number(localStorage.getItem(BEST) ?? 0) || 0;
    } catch {
      /* storage blocked */
    }
    let dead = 0;
    let fling: { vx: number; vy: number; vz: number; spin: number } | null = null;
    let dayT = 0.69; // open on golden hour: long shadows, warm light, the neon coming on soon after
    let freezeDay = false;
    let tSec = 0; // game seconds (traffic lights)
    let drift = 0;
    let driftIdle = 0;
    let shake = 0;
    let isStarted = false;
    let heat = 0; // stars = ceil(heat)
    let lostFor = 0; // seconds out of every cop's sight
    let reportUntil = 0; // a crime was just witnessed: the Miners know where you are
    let bustT = 0;
    let busted = 0;
    let crimeCd = 0;
    let slowmoUntil = 0;
    let camMode: 'chase' | 'cine' = 'chase';
    const cinePt = new THREE.Vector3();
    let cineHas = false;
    let radioIdx = 0;
    let copSpawnAt = 0;
    let rbAt = 0;
    let bfsAt = 0;
    const inp: Input = { up: false, down: false, left: false, right: false, sprint: false, jump: false };
    const simIds = new Set<string>();
    const t0 = performance.now();
    let chainHeight = 0;
    fetch('/api/chain')
      .then((r) => r.json())
      .then((s: { height?: number }) => (chainHeight = s.height ?? 0))
      .catch(() => {});

    const toastN = { n: 0 };
    const say = (text: string, sub = '', col = '#ffd23f') => setToast({ text, sub, n: ++toastN.n, col });
    const starsOf = () => Math.min(5, Math.ceil(heat - 1e-6));
    const addHeat = (n: number) => {
      if (busted || dead) return;
      const before = starsOf();
      heat = Math.min(5, heat + n);
      lostFor = 0;
      reportUntil = performance.now() + 3500;
      if (starsOf() > before) beep([660, 990], 'square', 0.07, 0.05, 0.12);
    };
    const addScore = (n: number) => {
      score += n;
      if (score > best) {
        best = score;
        try {
          localStorage.setItem(BEST, String(best));
        } catch {
          /* storage blocked */
        }
      }
    };

    // ── Audio: engine hum, horn, chimes (Web Audio, created on the first click) ──
    let audio: AudioContext | null = null;
    let audioOut: AudioNode | null = null; // shared sfx bus (src/lib/sfx.ts): global mute / volume
    let engOsc: OscillatorNode | null = null;
    let engGain: GainNode | null = null;
    let engFilter: BiquadFilterNode | null = null;
    let siren: ReturnType<typeof createSiren> | null = null;
    const initAudio = () => {
      if (audio) return;
      try {
        const sa = sharedAudio();
        if (!sa) return;
        audio = sa.ctx;
        audioOut = sa.out;
        engOsc = audio.createOscillator();
        engOsc.type = 'sawtooth';
        engFilter = audio.createBiquadFilter();
        engFilter.type = 'lowpass';
        engFilter.frequency.value = 400;
        engGain = audio.createGain();
        engGain.gain.value = 0;
        engOsc.connect(engFilter).connect(engGain).connect(audioOut);
        engOsc.start();
        siren = createSiren(audio, audioOut);
      } catch {
        audio = null;
      }
    };
    const beep = (freqs: number[], type: OscillatorType = 'square', step = 0.11, vol = 0.1, hold = 0.16) => {
      if (!audio) return;
      const t = audio.currentTime;
      freqs.forEach((f, i) => {
        const o = audio!.createOscillator();
        const g = audio!.createGain();
        o.type = type;
        o.frequency.value = f;
        const at = t + i * step;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + hold);
        o.connect(g).connect(audioOut ?? audio!.destination);
        o.start(at);
        o.stop(at + hold + 0.05);
      });
    };
    const horn = () => beep([392, 494], 'square', 0, 0.06, 0.35);
    /** Your horn: same sound, and it scatters the sidewalk. */
    const playerHorn = () => {
      horn();
      if (car) peds.scare(car.x, car.z, 20);
      else peds.scare(ped.x, ped.z, 12);
    };
    /** R: retune the car radio (DR-style station card; VexVoid FM shows the album). */
    const tune = (step: number) => {
      radioIdx = (radioIdx + step + RADIO.length) % RADIO.length;
      const st = RADIO[radioIdx];
      setStation(st.id);
      const sub = st.id === 'city' && chainHeight ? `block ${chainHeight.toLocaleString()} just landed · none of its transactions are yours` : st.tag;
      setRadio({ i: radioIdx, n: ++toastN.n, sub });
      beep([1500, 1900], 'square', 0.03, 0.025, 0.05);
    };

    // ── Car helpers ──
    const fwdOf = (th: number): [number, number] => [Math.cos(th), -Math.sin(th)];
    /** Collision circles along a car's length. */
    const circlesOf = (x: number, z: number, th: number, len: number, w: number) => {
      const n = Math.max(2, Math.round(len / w));
      const [fx, fz] = fwdOf(th);
      const half = len / 2 - w / 2;
      const out: [number, number][] = [];
      for (let k = 0; k < n; k++) {
        const o = -half + (2 * half * k) / (n - 1);
        out.push([x + fx * o, z + fz * o]);
      }
      return out;
    };
    const massOf = (b: Built) => b.len * b.w * 0.25;
    const placeBody = (bd: Body) => {
      const gy = groundY(bd.x, bd.z);
      bd.b.g.position.set(bd.x, THREE.MathUtils.lerp(bd.b.g.position.y, gy, 0.3), bd.z);
      bd.b.g.rotation.y = bd.th;
    };
    const addBody = (b: Built, x: number, z: number, th: number, f: FeedTx | null, parked: boolean): Body => {
      const bd: Body = { b, x, z, th, vx: 0, vz: 0, w: 0, f, health: 100, awake: false, parked };
      b.g.position.set(x, groundY(x, z), z);
      b.g.rotation.y = th;
      scene.add(b.g);
      bodies.push(bd);
      return bd;
    };
    const removeBuilt = (b: Built) => {
      scene.remove(b.g);
      kit.release(b);
    };
    const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

    const simTx = (): FeedTx => {
      const r = Math.random();
      const kind: TxKind = r < 0.45 ? 'payment' : r < 0.6 ? 'data' : r < 0.72 ? 'social' : r < 0.86 ? 'inscription' : r < 0.985 ? 'token' : 'blast';
      const id = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      simIds.add(id);
      return { id, kind, bytes: Math.floor(kind === 'inscription' ? 300 + Math.random() * 40000 : 200 + Math.random() * 800), sats: Math.floor(Math.random() * 1e6), mined: false };
    };
    const nextTx = (now: number): FeedTx | null => {
      const fd = feedRef.current;
      const f = fd.take();
      if (f) return f;
      if (fd.status !== 'live' && now - t0 > 5000) return simTx();
      return null;
    };

    // ── AI traffic on the road graph ──
    const pickNext = (e: Edge) => {
      const opts = edgesFrom[e.b].filter((o) => o.b !== e.a);
      const w = opts.map((o) => (o.dx === e.dx && o.dz === e.dz ? 2 : 1));
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let k = 0; k < opts.length; k++) if ((r -= w[k]) <= 0) return opts[k];
      return opts[opts.length - 1];
    };
    const makeTurn = (from: Edge, to: Edge): Turn => {
      const [ax, az] = edgePoint(from, P - INT);
      const [bx, bz] = edgePoint(to, INT);
      let cx: number;
      let cz: number;
      if (from.dx === to.dx && from.dz === to.dz) {
        cx = (ax + bx) / 2;
        cz = (az + bz) / 2;
      } else {
        // corner: along `from` until level with the exit point
        const k = (bx - ax) * from.dx + (bz - az) * from.dz;
        cx = ax + from.dx * k;
        cz = az + from.dz * k;
      }
      const len = Math.hypot(cx - ax, cz - az) + Math.hypot(bx - cx, bz - cz);
      return { to, ax, az, cx, cz, bx, bz, len: from.dx === to.dx && from.dz === to.dz ? len : len * 0.82, t: 0 };
    };
    const spawnAi = (now: number, near = false) => {
      const f = nextTx(now);
      if (!f) return false;
      const pos = car ? { x: car.x, z: car.z } : ped;
      for (let tries = 0; tries < 12; tries++) {
        const e = pick(edges);
        const s = INT + 6 + Math.random() * (P - INT * 2 - 14);
        const [x, z] = edgePoint(e, s);
        const d = Math.hypot(x - pos.x, z - pos.z);
        if (d < (near ? 25 : 45) || d > 230) continue;
        if (ai.some((a) => !a.turn && a.edge === e && Math.abs(a.s - s) < 14)) continue;
        const b = kit.forTx(f);
        b.g.position.set(x, 0, z);
        scene.add(b.g);
        const vmax = (f.kind === 'blast' ? 17 : b.len > 7 ? 10 : 12.5) * (0.85 + Math.random() * 0.3);
        ai.push({ b, f, edge: e, next: pickNext(e), s, turn: null, v: vmax * 0.6, vmax, born: now, stun: 0, x, z, th: Math.atan2(-e.dz, e.dx), honk: 0 });
        return true;
      }
      if (simIds.has(f.id)) simIds.delete(f.id);
      return false;
    };

    void kit.ready.then(() => {
      if (disposed) return;
      kitReady = true;
      // Car park: rows of parked cars (unspent outputs) waiting to be taken.
      const pb = blocks.find((b) => b.type === 'parking')!;
      const rows = [pb.z0 + 3.5 + 6, pb.z0 + 3.5 + 20, pb.z1 - 3.5 - 20, pb.z1 - 3.5 - 6];
      const keys: ModelKey[] = ['sports', 'sedan', 'cruiser', 'taxi', 'van', 'supercar', 'sports', 'sedan'];
      for (const z of rows)
        for (let x = pb.x0 + 3.5 + 3 + 1.6; x < pb.x1 - 3.5 - 3; x += 3.2) {
          if (Math.random() > 0.42) continue;
          const k = pick(keys);
          const b = kit.build(k, k === 'van' ? 5.2 : 4.6, pick(PAINTS));
          addBody(b, x, z + (Math.random() - 0.5) * 0.3, Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2, null, true);
        }
      // A couple on the square's edge so there's always a ride near the spawn.
      for (const [x, z, th] of [
        [sqx - 8, sqz + 26.2, 0],
        [sqx + 9, sqz + 26.2, Math.PI],
      ] as const)
        addBody(kit.build(pick(['sports', 'supercar', 'sedan'] as const), 4.6, pick(PAINTS)), x, z, th, null, true);
    });

    // ── Missions: deliver the block, mempool rush ──
    type Mission =
      | { kind: 'deliver'; x: number; z: number; deadline: number; total: number; height: number }
      | { kind: 'rush'; cps: [number, number][]; idx: number; deadline: number; total: number };
    let mission: Mission | null = null;
    const offer = { deliver: [0, 0] as [number, number], rush: [0, 0] as [number, number] };
    const rand = Math.random;
    const placeOffers = () => {
      const pos = car ? { x: car.x, z: car.z } : ped;
      for (let k = 0; k < 20; k++) {
        offer.deliver = sidewalkSpot(blocks, rand);
        const d = Math.hypot(offer.deliver[0] - pos.x, offer.deliver[1] - pos.z);
        if (d > 25 && d < 110) break;
      }
      for (let k = 0; k < 20; k++) {
        const i = Math.floor(rand() * N);
        const j = Math.floor(rand() * N);
        offer.rush = [nodeCoord(i), nodeCoord(j)];
        const d = Math.hypot(offer.rush[0] - pos.x, offer.rush[1] - pos.z);
        if (d > 30 && d < 130 && Math.hypot(offer.rush[0] - offer.deliver[0], offer.rush[1] - offer.deliver[1]) > 40) break;
      }
    };
    placeOffers();
    // Markers: beams of light, a spinning gold block, an arrow above you.
    const beamGeo = new THREE.CylinderGeometry(1.4, 1.4, 70, 24, 1, true);
    const ringGeo = new THREE.RingGeometry(2.6, 3.2, 40).rotateX(-Math.PI / 2);
    const makeBeam = (col: string) => {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.4), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.y = 35;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2), transparent: true, opacity: 0.85, toneMapped: false }));
      ring.position.y = 0.08;
      g.add(beam, ring);
      scene.add(g);
      return g;
    };
    const blockTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d')!;
      const gr = x.createLinearGradient(0, 0, 128, 128);
      gr.addColorStop(0, '#ffe08a');
      gr.addColorStop(1, '#c68a12');
      x.fillStyle = gr;
      x.fillRect(0, 0, 128, 128);
      x.strokeStyle = '#7a4d00';
      x.lineWidth = 8;
      x.strokeRect(4, 4, 120, 120);
      x.fillStyle = '#5a3500';
      x.font = 'bold 64px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('₿', 64, 68);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const blockMat = new THREE.MeshStandardMaterial({ map: blockTex, emissive: '#ffb020', emissiveMap: blockTex, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 });
    const parcelGeo = new THREE.BoxGeometry(1, 1, 1);
    const deliverBeam = makeBeam('#ffc83d');
    const deliverBlock = new THREE.Mesh(parcelGeo, blockMat);
    deliverBlock.castShadow = true;
    deliverBeam.add(deliverBlock);
    const rushBeam = makeBeam('#28e7ff');
    const targetBeam = makeBeam('#ff3b5c');
    const carried = new THREE.Mesh(parcelGeo, blockMat);
    carried.scale.setScalar(0.6);
    scene.add(carried);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23f').multiplyScalar(1.6), toneMapped: false }));
    scene.add(arrow);

    const startDeliver = (now: number) => {
      const [ox, oz] = offer.deliver;
      let tgt: [number, number] = [0, 0];
      for (let k = 0; k < 30; k++) {
        tgt = sidewalkSpot(blocks, rand);
        if (Math.hypot(tgt[0] - ox, tgt[1] - oz) > 150) break;
      }
      const dist = Math.abs(tgt[0] - ox) + Math.abs(tgt[1] - oz); // grid distance
      const total = Math.round(18 + dist / 9.5);
      const height = chainHeight ? chainHeight + 1 : 0;
      mission = { kind: 'deliver', x: tgt[0], z: tgt[1], deadline: now + total * 1000, total, height };
      say(height ? `BLOCK #${height.toLocaleString()}` : 'NEW BLOCK', `Deliver it to the red beam · ${total}s`, '#ffd23f');
      beep([660, 880], 'triangle', 0.09, 0.08);
    };
    const startRush = (now: number) => {
      const [rx, rz] = offer.rush;
      let i = Math.round(rx / P + (N - 1) / 2);
      let j = Math.round(rz / P + (N - 1) / 2);
      const cps: [number, number][] = [];
      let last = -1;
      for (let k = 0; k < 6; k++) {
        const steps = 1 + Math.floor(rand() * 2);
        for (let s = 0; s < steps; s++) {
          const opts = edgesFrom[i * N + j].filter((e) => e.b !== last);
          const e = pick(opts);
          last = i * N + j;
          i = Math.floor(e.b / N);
          j = e.b % N;
        }
        cps.push(nodeXZ(i * N + j));
      }
      const total = 22;
      mission = { kind: 'rush', cps, idx: 0, deadline: now + total * 1000, total };
      say('MEMPOOL RUSH', 'Hit 6 checkpoints before the block is mined', '#28e7ff');
      beep([523, 784, 1046], 'square', 0.08, 0.08);
    };
    const failMission = (why: string) => {
      mission = null;
      say(why, 'mission failed', '#ff3b5c');
      beep([330, 220], 'sawtooth', 0.18, 0.07, 0.3);
      placeOffers();
    };

    // ── Input ──
    const look = { yaw: 0, pitch: 0.32, dist: 6, lookYaw: 0, lookPitch: 0, lastMouse: 0 };
    let locked = false;
    const onMouse = (dx: number, dy: number) => {
      look.lastMouse = performance.now();
      if (car) {
        look.lookYaw -= dx * 0.0028;
        look.lookPitch = THREE.MathUtils.clamp(look.lookPitch + dy * 0.002, -0.15, 0.6);
      } else {
        look.yaw -= dx * 0.0028;
        look.pitch = THREE.MathUtils.clamp(look.pitch + dy * 0.0025, -0.2, 1.2);
      }
    };
    const onMove = (e: MouseEvent) => {
      if (locked) onMouse(e.movementX, e.movementY);
    };
    let drag: { x: number; y: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (!isStarted) return;
      if (e.pointerType === 'mouse' && !locked) {
        try {
          const p = renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
          p?.catch?.(() => {});
        } catch {
          /* no pointer lock: drag to look instead */
        }
      }
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const onDragMove = (e: PointerEvent) => {
      if (!drag || locked || e.pointerId !== drag.id) return;
      onMouse((e.clientX - drag.x) * 1.4, (e.clientY - drag.y) * 1.4);
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const onUp = () => (drag = null);
    const onLock = () => (locked = document.pointerLockElement === renderer.domElement);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      look.dist = THREE.MathUtils.clamp(look.dist + e.deltaY * 0.01, 3, 14);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onUp);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLock);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    type Target = { kind: 'ai' | 'body'; f: FeedTx; obj: THREE.Object3D; h: number };
    let target: Target | null = null;
    const openTx = () => {
      if (target && !simIds.has(target.f.id)) window.open(`https://whatsonchain.com/tx/${target.f.id}`, '_blank', 'noopener');
    };
    const carSay = (f: FeedTx | null) => {
      if (!f) return 'parked car · unspent output';
      const meta = f.token ? tokenMeta(f.token) : null;
      return `${kindLabel(f.kind)}${meta ? ` · $${meta.sym}` : ''} · ${f.bytes.toLocaleString()} B`;
    };
    /** F: steal the nearest car, or get out of this one. */
    const action = () => {
      if (dead) return;
      if (car) {
        const [fx, fz] = fwdOf(car.th);
        const lx = fz; // left of travel
        const lz = -fx;
        const off = car.b.w / 2 + 0.9;
        let px = car.x + lx * off;
        let pz = car.z + lz * off;
        if (boxes.some((b) => circleBox(px, pz, 0.45, b))) {
          px = car.x - lx * off;
          pz = car.z - lz * off;
        }
        ped.x = px;
        ped.z = pz;
        ped.y = groundY(px, pz);
        ped.vy = 0;
        ped.heading = Math.atan2(px - car.x, pz - car.z);
        car.awake = true;
        bodies.push(car);
        car.b.g.remove(headLamp, headTarget);
        car = null;
        player.visible = true;
        setStation(null);
        setRadio(null);
        look.yaw = look.yaw + look.lookYaw;
        return;
      }
      // nearest enterable vehicle
      let bestD = 3.4;
      let pickB: Body | null = null;
      let pickA: Ai | null = null;
      const near = (x: number, z: number, th: number, len: number, w: number) => {
        const [fx, fz] = fwdOf(th);
        const rx = ped.x - x;
        const rz = ped.z - z;
        const a = Math.max(0, Math.abs(rx * fx + rz * fz) - len / 2);
        const l = Math.max(0, Math.abs(rx * -fz + rz * fx) - w / 2);
        return Math.hypot(a, l);
      };
      for (const b of bodies) {
        const d = near(b.x, b.z, b.th, b.b.len, b.b.w);
        if (d < bestD) {
          bestD = d;
          pickB = b;
          pickA = null;
        }
      }
      for (const a of ai) {
        const d = near(a.x, a.z, a.th, a.b.len, a.b.w);
        if (d < bestD) {
          bestD = d;
          pickA = a;
          pickB = null;
        }
      }
      if (!pickA && !pickB) return;
      if (!pay.current([pickA ? 'carjack' : 'steal'])) {
        say('OUT OF AMMO', 'load more to take a car', '#ff3b5c');
        return;
      }
      if (pickA) addHeat(CRIME.carjack);
      else if (cops.some((c) => Math.hypot(c.bd.x - ped.x, c.bd.z - ped.z) < 50) || heat > 0) addHeat(CRIME.steal); // stolen in front of a Miner
      if (pickA) {
        const a = pickA;
        ai.splice(ai.indexOf(a), 1);
        const [fx, fz] = fwdOf(a.th);
        pickB = { b: a.b, x: a.x, z: a.z, th: a.th, vx: fx * a.v * 0.3, vz: fz * a.v * 0.3, w: 0, f: a.f, health: 100, awake: true, parked: false };
        say('CARJACKED', `${carSay(a.f)} · driver ejected`, '#ff9a3d');
        beep([200, 150], 'sawtooth', 0.08, 0.06);
      } else if (pickB) bodies.splice(bodies.indexOf(pickB), 1);
      if (!pickB) return;
      car = pickB;
      car.parked = false;
      player.visible = false;
      car.b.g.add(headLamp, headTarget);
      headLamp.position.set(car.b.len / 2, 0.9, 0);
      headTarget.position.set(car.b.len / 2 + 20, -1.5, 0);
      look.lookYaw = angDiff(Math.atan2(-Math.cos(car.th), Math.sin(car.th)), look.yaw);
      look.lookPitch = 0;
      cineHas = false;
      tune(0);
    };
    const skip = () => (dayT = (dayT + 0.5) % 1);
    const start = () => {
      isStarted = true;
      initAudio();
      void audio?.resume();
      try {
        const p = renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
      } catch {
        /* drag to look */
      }
    };
    let needsResize = false;
    const applyQuality = (q: CityQuality) => {
      quality = q;
      const pr = QUALITY_PRESETS[q];
      renderer.setPixelRatio(pixelRatioFor(q));
      composer.setPixelRatio(pixelRatioFor(q));
      gtao.enabled = pr.ao;
      if (sun.shadow.mapSize.x !== pr.shadowMap) {
        sun.shadow.mapSize.set(pr.shadowMap, pr.shadowMap);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      detail.setQuality(q);
      street.setQuality(q);
      needsResize = true;
      setQualityState(q);
    };
    // Dev only: a headless check walks the player up to the nearest parked car.
    if (process.env.NODE_ENV !== 'production')
      (window as unknown as { __tbCity?: unknown }).__tbCity = {
        toCar: () => {
          const b = bodies.find((x) => x !== car);
          if (!b) return false;
          ped.x = b.x + b.b.w / 2 + 1.2;
          ped.z = b.z;
          return true;
        },
        action: () => action(),
        heat: (n = 1) => addHeat(n),
        // Aim the car you're in at the nearest visible pedestrian at speed v (run-over test).
        ram: (v = 20) => {
          const w = peds.walkers.filter((p) => p.root.visible && p.knocked <= 0).sort((p, q) => Math.hypot(p.root.position.x - ped.x, p.root.position.z - ped.z) - Math.hypot(q.root.position.x - ped.x, q.root.position.z - ped.z))[0];
          if (!car || !w) return false;
          const th = car.th;
          car.x = w.root.position.x - Math.cos(th) * 12;
          car.z = w.root.position.z + Math.sin(th) * 12;
          car.vx = Math.cos(th) * v;
          car.vz = -Math.sin(th) * v;
          return true;
        },
        knocked: () => peds.walkers.filter((p) => p.knocked > 0).map((p) => +p.root.position.y.toFixed(2)),
        state: () => ({ heat, stars: starsOf(), cops: cops.length, copD: cops.map((c) => Math.round(Math.hypot(c.bd.x - (car ? car.x : ped.x), c.bd.z - (car ? car.z : ped.z)))), copV: cops.map((c) => Math.round(Math.hypot(c.bd.vx, c.bd.vz))), bustT, roadblocks: roadblocks.length, heli: heli.active, lostFor, busted: !!busted, car: !!car }),
        hidePlayer: (hidden = true) => (player.visible = !hidden),
        where: () => [ped.x, ped.z, ...squareCentre()],
        // Screenshot rig: freeze the clock at dayT, put the player at (x, z) and aim the camera.
        // `extra` can set the in-car look offset (lookYaw/lookPitch; lastMouse in the future stops it easing back).
        pose: (d: number, x: number, z: number, yaw: number, pitch = 0.32, dist = 6, extra: Partial<typeof look> = {}) => {
          dayT = d;
          freezeDay = true;
          slowFor = -1e9;
          ped.x = x;
          ped.z = z;
          Object.assign(look, { yaw, pitch, dist }, extra);
        },
      };
    control.current = {
      setGirl: (slug) => {
        try {
          localStorage.setItem(GIRL_KEY, slug);
        } catch {
          /* storage blocked */
        }
        loadCharacter(slug);
      },
      // Cutscene camera: freeze the clock and frame a shot around Genesis Square; null hands control back.
      cine: (s) => {
        if (!s) {
          freezeDay = false;
          ped.x = SPAWN.x;
          ped.z = SPAWN.z;
          Object.assign(look, { yaw: 0, pitch: 0.32, dist: 6 });
          return;
        }
        const [cx, cz] = squareCentre();
        dayT = s.dayT;
        freezeDay = true;
        slowFor = -1e9;
        ped.x = cx + s.x;
        ped.z = cz + s.z;
        Object.assign(look, { yaw: s.yaw, pitch: s.pitch ?? 0.32, dist: s.dist ?? 6 });
      },
      setQuality: (q) => {
        saveCityQuality(q);
        slowFor = -1e9; // a player's choice beats the watchdog
        applyQuality(q);
      },
      key: (k, down) => (inp[k] = down),
      action: (a) => (a === 'f' ? action() : a === 'horn' ? playerHorn() : a === 'skip' ? skip() : openTx()),
      start,
    };
    const KEYMAP: Record<string, keyof Input> = {
      KeyW: 'up',
      ArrowUp: 'up',
      KeyS: 'down',
      ArrowDown: 'down',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
      ShiftLeft: 'sprint',
      ShiftRight: 'sprint',
      Space: 'jump',
    };
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = KEYMAP[e.code];
      if (k) {
        inp[k] = down;
        if (isStarted) e.preventDefault();
      }
      if (!down || e.repeat || !isStarted) return;
      if (e.code === 'KeyF' || e.code === 'KeyE') action();
      else if (e.code === 'KeyH') playerHorn();
      else if (e.code === 'KeyR' && car) tune(1);
      else if (e.code === 'KeyV') {
        camMode = camMode === 'chase' ? 'cine' : 'chase';
        cineHas = false;
        say(camMode === 'cine' ? 'CINEMATIC CAM' : 'CHASE CAM', camMode === 'cine' ? 'V to go back' : '', '#28e7ff');
      }
      else if (e.code === 'KeyT') openTx();
      else if (e.code === 'KeyN') skip();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => Object.keys(inp).forEach((k) => (inp[k as keyof Input] = false));
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);

    // ── Minimap: the island pre-drawn once, live dots on top ──
    const MM = 200;
    const R = BOUND + 6;
    const mm = (v: number) => ((v + R) / (2 * R)) * MM;
    const mapBg = document.createElement('canvas');
    mapBg.width = mapBg.height = MM;
    {
      const x = mapBg.getContext('2d')!;
      x.fillStyle = '#0b1d27';
      x.fillRect(0, 0, MM, MM);
      x.fillStyle = '#3a3c40';
      x.fillRect(mm(-BOUND), mm(-BOUND), mm(BOUND) - mm(-BOUND), mm(BOUND) - mm(-BOUND));
      x.fillStyle = '#6b6a66';
      x.fillRect(mm(-BOUND), mm(-BOUND), mm(BOUND) - mm(-BOUND), mm(BOUND) - mm(-BOUND));
      x.fillStyle = '#2a2b2e';
      x.fillRect(mm(-EDGE), mm(-EDGE), mm(EDGE) - mm(-EDGE), mm(EDGE) - mm(-EDGE));
      for (const b of blocks) {
        x.fillStyle = b.type === 'square' ? '#3f6a3a' : b.type === 'parking' ? '#45474b' : '#77746e';
        x.fillRect(mm(b.x0), mm(b.z0), mm(b.x1) - mm(b.x0), mm(b.z1) - mm(b.z0));
        x.fillStyle = '#9b968c';
        for (const l of b.lots) x.fillRect(mm(l.x0), mm(l.z0), mm(l.x1) - mm(l.x0), mm(l.z1) - mm(l.z0));
      }
    }
    const mctx = mapCanvas.getContext('2d')!;
    const drawMap = (now: number, px: number, pz: number, heading: number) => {
      mctx.drawImage(mapBg, 0, 0);
      for (const a of ai) {
        mctx.fillStyle = KIND_COL[a.f.kind];
        mctx.fillRect(mm(a.x) - 1.5, mm(a.z) - 1.5, 3, 3);
      }
      mctx.fillStyle = '#bbb';
      for (const b of bodies) mctx.fillRect(mm(b.x) - 1, mm(b.z) - 1, 2, 2);
      const flash = Math.floor(now / 180) % 2;
      for (const c of cops) {
        mctx.fillStyle = flash ? '#ff1030' : '#2a6bff';
        mctx.fillRect(mm(c.bd.x) - 3, mm(c.bd.z) - 3, 6, 6);
      }
      if (heli.active) {
        mctx.strokeStyle = flash ? '#ff1030' : '#2a6bff';
        mctx.lineWidth = 2;
        mctx.beginPath();
        mctx.arc(mm(heli.aim.x), mm(heli.aim.z), 7, 0, Math.PI * 2);
        mctx.stroke();
      }
      const dot = (x: number, z: number, col: string, r: number) => {
        mctx.beginPath();
        mctx.arc(mm(x), mm(z), r, 0, Math.PI * 2);
        mctx.fillStyle = col;
        mctx.fill();
        mctx.strokeStyle = '#000';
        mctx.lineWidth = 1.5;
        mctx.stroke();
      };
      const pulse = 4 + Math.sin(now / 160) * 1.5;
      if (!mission) {
        dot(offer.deliver[0], offer.deliver[1], '#ffc83d', 5);
        dot(offer.rush[0], offer.rush[1], '#28e7ff', 5);
      } else if (mission.kind === 'deliver') dot(mission.x, mission.z, '#ff3b5c', pulse + 1);
      else {
        for (let k = mission.idx + 1; k < mission.cps.length; k++) dot(mission.cps[k][0], mission.cps[k][1], 'rgba(40,231,255,0.45)', 3);
        dot(mission.cps[mission.idx][0], mission.cps[mission.idx][1], '#28e7ff', pulse + 1);
      }
      // player arrow
      mctx.save();
      mctx.translate(mm(px), mm(pz));
      mctx.rotate(-heading);
      mctx.beginPath();
      mctx.moveTo(0, -7);
      mctx.lineTo(5, 5);
      mctx.lineTo(0, 2.5);
      mctx.lineTo(-5, 5);
      mctx.closePath();
      mctx.fillStyle = '#fff';
      mctx.fill();
      mctx.strokeStyle = '#d81b2a';
      mctx.lineWidth = 1.5;
      mctx.stroke();
      mctx.restore();
    };

    // ── Air: dust motes in the sun by day, drifting neon specks at night (one draw call, all motion in the shader) ──
    const MOTE_N = quality === 'high' ? 1400 : 500;
    const moteGeo = new THREE.BufferGeometry();
    {
      const p = new Float32Array(MOTE_N * 3);
      const k = new Float32Array(MOTE_N);
      for (let i = 0; i < MOTE_N; i++) {
        p[i * 3] = Math.random() * 44;
        p[i * 3 + 1] = Math.random() * 14;
        p[i * 3 + 2] = Math.random() * 44;
        k[i] = Math.random();
      }
      moteGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      moteGeo.setAttribute('seed', new THREE.BufferAttribute(k, 1));
    }
    const moteMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uDay: { value: new THREE.Color('#ffd9a8') }, uNight: { value: 0 }, uPx: { value: 1 } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uPx; attribute float seed; varying float vSeed; varying float vFade;
        void main(){
          vec3 drift = vec3(sin(uTime * 0.21 + seed * 40.0) * 0.6 + uTime * 0.25, sin(uTime * 0.37 + seed * 17.0) * 0.5 + uTime * (0.05 + seed * 0.1), cos(uTime * 0.17 + seed * 23.0) * 0.6);
          vec3 box = vec3(44.0, 14.0, 44.0);
          vec3 p = mod(position + drift - uCam + box * 0.5, box) - box * 0.5 + uCam;
          p.y = max(p.y, uCam.y - 6.0) ;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          vFade = smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(14.0, 22.0, d));
          vSeed = seed;
          gl_PointSize = uPx * (1.2 + seed * 2.2) * 14.0 / max(d, 0.5);
        }`,
      fragmentShader: `uniform vec3 uDay; uniform float uNight; uniform float uTime; varying float vSeed; varying float vFade;
        void main(){
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r);
          vec3 neon = mix(vec3(1.0, 0.2, 0.75), vec3(0.2, 0.9, 1.0), step(0.5, fract(vSeed * 7.0)));
          vec3 col = mix(uDay, neon, uNight);
          float tw = 0.6 + 0.4 * sin(uTime * (1.0 + vSeed * 3.0) + vSeed * 60.0);
          gl_FragColor = vec4(col * (1.0 + uNight * 1.5), a * vFade * tw * mix(0.35, 0.55, uNight));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const motes = new THREE.Points(moteGeo, moteMat);
    motes.frustumCulled = false;
    scene.add(motes);

    // ── Night rain ──
    const RAIN_N = 1600;
    const rainPos = new Float32Array(RAIN_N * 6);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.LineBasicMaterial({ color: '#aac4dd', transparent: true, opacity: 0, depthWrite: false });
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    rain.visible = false;
    scene.add(rain);
    const rainSeed = Array.from({ length: RAIN_N }, () => [Math.random() * 70 - 35, Math.random() * 30, Math.random() * 70 - 35]);
    const sky = new THREE.Color();
    const DAY = new THREE.Color('#8fb8e8');
    const DUSK = new THREE.Color('#e8845a');
    const NIGHT = new THREE.Color('#0a0820');

    // ── Sky dome (DR dusk/night: deep indigo zenith, hot magenta/orange horizon band) ──
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { night: { value: 0 }, dusk: { value: 0 }, top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
        fragmentShader: `
          uniform vec3 top; uniform vec3 horizon; uniform float night; uniform float dusk; varying vec3 vDir;
          void main(){
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 c = mix(horizon, top, smoothstep(0.0, 0.55, h));
            float band = exp(-abs(h - 0.02) * 18.0);
            c += vec3(1.0, 0.16, 0.5) * band * (0.18 * night + 0.35 * dusk);
            c += vec3(1.0, 0.55, 0.1) * exp(-abs(h) * 40.0) * 0.25 * dusk;
            c = mix(c, horizon * 0.6, smoothstep(0.0, -0.2, h));
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    skyDome.frustumCulled = false;
    skyDome.renderOrder = -1;
    scene.add(skyDome);
    const skyMat = skyDome.material as THREE.ShaderMaterial;
    const TOP_DAY = new THREE.Color('#3f78c8');
    const TOP_NIGHT = new THREE.Color('#05041a');
    const HOR_NIGHT = new THREE.Color('#2a1240');
    const HEMI_NIGHT_SKY = new THREE.Color('#6a5cff');
    const HEMI_NIGHT_GND = new THREE.Color('#ff2d7a');
    const HAZE_NIGHT = new THREE.Color('#3a1a5a');

    // ── Sparks (crashes) + exhaust puffs: one pooled additive Points cloud ──
    const SPK = 240;
    const spkPos = new Float32Array(SPK * 3);
    const spkCol = new Float32Array(SPK * 3);
    const spkVel = new Float32Array(SPK * 3);
    const spkLife = new Float32Array(SPK);
    const spkGeo = new THREE.BufferGeometry();
    spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3));
    spkGeo.setAttribute('color', new THREE.BufferAttribute(spkCol, 3));
    const spkMat = new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const sparks = new THREE.Points(spkGeo, spkMat);
    sparks.frustumCulled = false;
    scene.add(sparks);
    let spkNext = 0;
    const emit = (x: number, y: number, z: number, n: number, speed: number, r: number, g: number, b: number, up = 3) => {
      for (let i = 0; i < n; i++) {
        const k = spkNext++ % SPK;
        const o = k * 3;
        spkPos[o] = x;
        spkPos[o + 1] = y;
        spkPos[o + 2] = z;
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.8);
        spkVel[o] = Math.cos(a) * v;
        spkVel[o + 1] = up * (0.5 + Math.random());
        spkVel[o + 2] = Math.sin(a) * v;
        spkCol[o] = r;
        spkCol[o + 1] = g;
        spkCol[o + 2] = b;
        spkLife[k] = 0.35 + Math.random() * 0.5;
      }
    };
    const stepSparks = (dt: number) => {
      for (let k = 0; k < SPK; k++) {
        if (spkLife[k] <= 0) continue;
        const o = k * 3;
        spkLife[k] -= dt;
        const f = spkLife[k] <= 0 ? 0 : Math.min(1, spkLife[k] * 2.5);
        spkVel[o + 1] -= 14 * dt;
        spkPos[o] += spkVel[o] * dt;
        spkPos[o + 1] = Math.max(0.05, spkPos[o + 1] + spkVel[o + 1] * dt);
        spkPos[o + 2] += spkVel[o + 2] * dt;
        spkCol[o] *= f < 1 ? 0.9 : 1;
        spkCol[o + 1] *= f < 1 ? 0.88 : 1;
        spkCol[o + 2] *= f < 1 ? 0.88 : 1;
        if (f === 0) spkPos[o + 1] = -50;
      }
      spkGeo.attributes.position.needsUpdate = true;
      spkGeo.attributes.color.needsUpdate = true;
    };
    let exhaustAt = 0;

    // ── The loop ──
    const camPos = new THREE.Vector3(SPAWN.x, 6, SPAWN.z + 8);
    camera.position.copy(camPos);
    const camLook = new THREE.Vector3(SPAWN.x, 1.4, SPAWN.z);
    const tmpV = new THREE.Vector3();
    const size2 = new THREE.Vector2();
    let last = performance.now();
    const started0 = (now: number) => now - t0 > 6000; // ignore the shader-compile hitches at boot
    let raf = 0;
    let hudAt = 0;
    let lastHud = '';
    let spawnAt = 0;
    let lastTagId = '';

    const collideCircleBoxes = (x: number, z: number, r: number) => {
      let nx = 0;
      let nz = 0;
      let hit = false;
      for (const b of boxes) {
        if (x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue;
        const c = circleBox(x, z, r, b);
        if (!c) continue;
        x += c.nx * c.d;
        z += c.nz * c.d;
        nx += c.nx;
        nz += c.nz;
        hit = true;
      }
      return { x, z, hit, nx, nz };
    };

    /** Dynamic car (player's or a free body) against buildings: push out, bounce. Returns impact speed. */
    const bodyVsWorld = (bd: Body, rest: number) => {
      let impact = 0;
      for (let pass = 0; pass < 2; pass++)
        for (const [cx, cz] of circlesOf(bd.x, bd.z, bd.th, bd.b.len, bd.b.w)) {
          const c = collideCircleBoxes(cx, cz, bd.b.w / 2);
          if (!c.hit) continue;
          bd.x += c.x - cx;
          bd.z += c.z - cz;
          const l = Math.hypot(c.nx, c.nz) || 1;
          const nx = c.nx / l;
          const nz = c.nz / l;
          const vn = bd.vx * nx + bd.vz * nz;
          if (vn < 0) {
            bd.vx -= (1 + rest) * vn * nx;
            bd.vz -= (1 + rest) * vn * nz;
            impact = Math.max(impact, -vn);
            // spin from an off-centre hit
            const rx = cx - bd.x;
            const rz = cz - bd.z;
            bd.w += (rz * nx - rx * nz) * -vn * 0.04;
          }
        }
      return impact;
    };
    /** Two dynamic cars: separate and exchange momentum. */
    const bodyVsBody = (A: Body, B: Body) => {
      if (Math.abs(A.x - B.x) > 14 || Math.abs(A.z - B.z) > 14) return 0;
      let impact = 0;
      const ma = massOf(A.b);
      const mb = massOf(B.b);
      const ra = A.b.w / 2;
      const rb = B.b.w / 2;
      for (const [ax, az] of circlesOf(A.x, A.z, A.th, A.b.len, A.b.w))
        for (const [bx, bz] of circlesOf(B.x, B.z, B.th, B.b.len, B.b.w)) {
          const dx = ax - bx;
          const dz = az - bz;
          const d = Math.hypot(dx, dz);
          if (d >= ra + rb || d < 1e-6) continue;
          const nx = dx / d;
          const nz = dz / d;
          const pen = ra + rb - d;
          A.x += nx * pen * (mb / (ma + mb));
          A.z += nz * pen * (mb / (ma + mb));
          B.x -= nx * pen * (ma / (ma + mb));
          B.z -= nz * pen * (ma / (ma + mb));
          const vn = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
          if (vn >= 0) continue;
          const j = (-(1 + 0.3) * vn) / (1 / ma + 1 / mb);
          A.vx += (j * nx) / ma;
          A.vz += (j * nz) / ma;
          B.vx -= (j * nx) / mb;
          B.vz -= (j * nz) / mb;
          const rx = bx - B.x;
          const rz = bz - B.z;
          B.w += ((rz * -nx - rx * -nz) * j) / (mb * B.b.len * 0.6);
          A.awake = B.awake = true;
          impact = Math.max(impact, -vn);
        }
      return impact;
    };
    /** AI car shoves a dynamic car out of its way (AI is kinematic). Returns impact speed. */
    const aiVsBody = (a: Ai, B: Body) => {
      if (Math.abs(a.x - B.x) > 14 || Math.abs(a.z - B.z) > 14) return 0;
      const [fx, fz] = fwdOf(a.th);
      const avx = fx * a.v;
      const avz = fz * a.v;
      let impact = 0;
      const ra = a.b.w / 2;
      const rb = B.b.w / 2;
      for (const [ax, az] of circlesOf(a.x, a.z, a.th, a.b.len, a.b.w))
        for (const [bx, bz] of circlesOf(B.x, B.z, B.th, B.b.len, B.b.w)) {
          const dx = bx - ax;
          const dz = bz - az;
          const d = Math.hypot(dx, dz);
          if (d >= ra + rb || d < 1e-6) continue;
          const nx = dx / d;
          const nz = dz / d;
          B.x += nx * (ra + rb - d);
          B.z += nz * (ra + rb - d);
          const vn = (B.vx - avx) * nx + (B.vz - avz) * nz;
          if (vn < 0) {
            B.vx -= 1.3 * vn * nx;
            B.vz -= 1.3 * vn * nz;
            impact = Math.max(impact, -vn);
          }
          B.awake = true;
        }
      return impact;
    };

    // ── The Miners: spawning, road-graph pathing (BFS over intersections), roadblocks ──
    const bfsD = new Int32Array(N * N);
    const nodeOf = (x: number, z: number) => {
      const i = THREE.MathUtils.clamp(Math.round(x / P + (N - 1) / 2), 0, N - 1);
      const j = THREE.MathUtils.clamp(Math.round(z / P + (N - 1) / 2), 0, N - 1);
      return i * N + j;
    };
    const bfs = (src: number) => {
      bfsD.fill(1e9);
      bfsD[src] = 0;
      const q = [src];
      for (let h = 0; h < q.length; h++) {
        const u = q[h];
        for (const e of edgesFrom[u])
          if (bfsD[e.b] > bfsD[u] + 1) {
            bfsD[e.b] = bfsD[u] + 1;
            q.push(e.b);
          }
      }
    };
    const copCar = (x: number, z: number, th: number, parked: boolean) => {
      const b = kit.build('sedan', 4.8, '#0d0f14');
      b.g.rotation.set(0, 0, 0);
      const box = new THREE.Box3().setFromObject(b.g);
      const bar = buildLightBar(b.len);
      bar.g.position.y = box.max.y - b.g.position.y + 0.02;
      b.g.add(bar.g);
      const bd: Body = { b, x, z, th, vx: 0, vz: 0, w: 0, f: null, health: 100, awake: !parked, parked };
      b.g.position.set(x, groundY(x, z), z);
      b.g.rotation.y = th;
      scene.add(b.g);
      return { bd, bar };
    };
    const dropBar = (b: Built, bar: ReturnType<typeof buildLightBar>) => {
      b.g.remove(bar.g);
      bar.dispose();
    };
    const spawnCop = (tx: number, tz: number, now: number) => {
      for (let tries = 0; tries < 16; tries++) {
        const e = pick(edges);
        const s = INT + 6 + Math.random() * (P - INT * 2 - 12);
        const [x, z] = edgePoint(e, s);
        const d = Math.hypot(x - tx, z - tz);
        if (d < 55 || d > 125) continue;
        if (ai.some((a) => Math.hypot(a.x - x, a.z - z) < 7)) continue;
        const { bd, bar } = copCar(x, z, Math.atan2(-e.dz, e.dx), false);
        cops.push({ bd, bar, phase: Math.random(), stuck: 0, rev: 0, wp: -1, born: now });
        return;
      }
    };
    const removeCop = (c: Cop) => {
      dropBar(c.bd.b, c.bar);
      removeBuilt(c.bd.b);
      cops.splice(cops.indexOf(c), 1);
    };
    const clearRoadblock = (r: Roadblock) => {
      for (const { bd, bar } of r.cars) {
        dropBar(bd.b, bar);
        const k = bodies.indexOf(bd);
        if (k >= 0) bodies.splice(k, 1);
        removeBuilt(bd.b);
      }
      roadblocks.splice(roadblocks.indexOf(r), 1);
    };
    /** Two patrol cars parked across the road ~70 m ahead of you, facing your way in. */
    const placeRoadblock = (c: Body, now: number) => {
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < 8) return;
      const n = nodeOf(c.x + (c.vx / sp) * 75, c.z + (c.vz / sp) * 75);
      const [nx, nz] = nodeXZ(n);
      let best: Edge | null = null;
      let bestDot = 0.3;
      for (const e of edgesFrom[n]) {
        const dx = c.x - nx;
        const dz = c.z - nz;
        const dl = Math.hypot(dx, dz) || 1;
        const dot = (e.dx * dx + e.dz * dz) / dl;
        if (dot > bestDot) {
          bestDot = dot;
          best = e;
        }
      }
      if (!best) return;
      const cx = nx + best.dx * (INT + 12);
      const cz = nz + best.dz * (INT + 12);
      if (Math.hypot(cx - c.x, cz - c.z) < 35) return;
      const th = Math.atan2(-best.dz, best.dx) + Math.PI / 2;
      const cars = [-2.7, 2.7].map((o) => {
        const k = copCar(cx - best.dz * o, cz + best.dx * o, th + (o > 0 ? 0.25 : -0.25), true);
        bodies.push(k.bd);
        return k;
      });
      roadblocks.push({ cars, born: now });
    };
    const bust = (now: number) => {
      busted = now;
      bustT = 0;
      if (car) action();
      setBusted({ stars: starsOf() });
      beep([523, 392, 262], 'square', 0.16, 0.09, 0.3);
      mission = null;
    };
    const coolDown = () => {
      heat = 0;
      lostFor = 0;
      heli.despawn();
    };

    // Frame-time watchdog: 3 s of > 30 ms frames on 'high' drops to 'low' (not saved, so a faster device can retry).
    let slowFor = 0;
    let dprSlow = 0;
    let dprFast = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const realDt = Math.min(0.05, (now - last) / 1000);
      if (started0(now) && !document.hidden) {
        if (realDt > 0.022) {
          dprSlow += realDt;
          dprFast = 0;
        } else if (realDt < 0.0145) {
          dprFast += realDt;
          dprSlow = Math.max(0, dprSlow - realDt);
        }
        if (dprSlow > 1.5 && dprScale > 0.6) {
          dprSlow = 0;
          dprScale = Math.max(0.6, dprScale - 0.15);
          renderer.setPixelRatio(pixelRatioFor(quality));
          composer.setPixelRatio(pixelRatioFor(quality));
          needsResize = true;
        } else if (dprFast > 5 && dprScale < 1) {
          dprFast = 0;
          dprScale = Math.min(1, dprScale + 0.1);
          renderer.setPixelRatio(pixelRatioFor(quality));
          composer.setPixelRatio(pixelRatioFor(quality));
          needsResize = true;
        }
      }
      if (quality === 'high' && started0(now) && dprScale <= 0.75) {
        slowFor = realDt > 0.03 ? slowFor + realDt : Math.max(0, slowFor - realDt * 2);
        if (slowFor > 3) {
          slowFor = 0;
          applyQuality('low');
        }
      }
      last = now;
      const dt = dead || busted ? realDt * 0.28 : now < slowmoUntil ? realDt * 0.3 : realDt;
      tSec += dt;
      grade.uniforms.amount.value += ((dead ? 1 : 0) - grade.uniforms.amount.value) * Math.min(1, realDt * (dead ? 5 : 3));
      grade.uniforms.time.value = now / 1000;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const sz = renderer.getSize(size2);
      if (needsResize || sz.x !== w || sz.y !== h) {
        needsResize = false;
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const focusX = car ? car.x : ped.x;
      const focusZ = car ? car.z : ped.z;

      // ── Day cycle ──
      if (!freezeDay) dayT = (dayT + dt / DAY_S) % 1;
      const ang = dayT * Math.PI * 2 - Math.PI / 2;
      const elev = Math.sin(ang);
      sun.position.set(focusX + Math.cos(ang) * 150, Math.max(8, elev * 170), focusZ + 70);
      sun.target.position.set(focusX, 0, focusZ);
      const night = THREE.MathUtils.clamp(-elev * 3 + 0.2, 0, 1);
      const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1);
      sky.copy(DAY).lerp(DUSK, dusk * 0.8).lerp(NIGHT, night);
      skyMat.uniforms.night.value = night;
      skyMat.uniforms.dusk.value = dusk;
      (skyMat.uniforms.top.value as THREE.Color).copy(TOP_DAY).lerp(TOP_NIGHT, Math.min(1, night + dusk * 0.4));
      (skyMat.uniforms.horizon.value as THREE.Color).copy(sky).lerp(HOR_NIGHT, night * 0.85);
      skyDome.position.copy(camera.position);
      if (hdrSky && night < 0.35 && dusk < 0.5) {
        skyDome.visible = false;
        scene.background = hdrSky;
        scene.backgroundIntensity = Math.max(0.08, 1 - night * 1.6) * (1 - dusk * 0.35);
      } else {
        skyDome.visible = true;
        scene.background = sky;
      }
      (scene.fog as THREE.Fog).color.copy(sky).lerp(HAZE_NIGHT, night * 0.6);
      (grade.uniforms.haze.value as THREE.Color).copy((scene.fog as THREE.Fog).color);
      scene.environmentIntensity = 0.12 + 0.88 * (1 - night);
      grade.uniforms.night.value = night;
      cityUniforms.uNight.value = night;
      cityUniforms.uTime.value = now / 1000;
      world.setNight(night, now, tSec);
      street.setNight(night);
      street.update(now, focusX, focusZ);
      plaza.update(now, night);
      {
        const fog = scene.fog as THREE.Fog;
        fog.near = 70 - night * 30; // aerial perspective by day too, so the skyline layers into depth
        fog.far = 400 - night * 80;
      }
      bloom.threshold = 0.95 - night * 0.3;
      bloom.radius = 0.5 + night * 0.25;
      kit.setNight(night);
      detail.setNight(night);
      detail.update(camera.position);
      sun.intensity = 3.8 * (1 - night);
      sun.color.set('#fff1dc').lerp(SUN_LOW, Math.min(1, dusk * 1.4));
      hemi.intensity = 0.22 + 0.3 * (1 - night); // less flat fill: shadows keep their depth
      // Night fill in the DR palette: cold violet sky light, hot magenta neon bounce off the street.
      hemi.color.set('#cfe4ff').lerp(HEMI_NIGHT_SKY, night);
      hemi.groundColor.set('#3a2a22').lerp(HEMI_NIGHT_GND, night);
      renderer.toneMappingExposure = 0.74 - night * 0.06;
      bloom.strength = (0.06 + night * 0.42) * QUALITY_PRESETS[quality].bloomScale;
      headLamp.intensity = night * 60;
      rain.visible = night > 0.45;
      moteMat.uniforms.uTime.value = now / 1000;
      (moteMat.uniforms.uCam.value as THREE.Vector3).copy(camera.position);
      moteMat.uniforms.uNight.value = night;
      moteMat.uniforms.uPx.value = renderer.getPixelRatio();
      (moteMat.uniforms.uDay.value as THREE.Color).set('#ffe2b8').lerp(SUN_LOW, dusk * 0.6);
      if (rain.visible) {
        rainMat.opacity = (night - 0.45) * 0.45;
        const fall = (now / 1000) * 22;
        for (let i = 0; i < RAIN_N; i++) {
          const r = rainSeed[i];
          const y = 30 - ((r[1] + fall) % 30);
          const x = camera.position.x + r[0];
          const z = camera.position.z + r[2];
          const o = i * 6;
          rainPos[o] = x;
          rainPos[o + 1] = y;
          rainPos[o + 2] = z;
          rainPos[o + 3] = x + 0.06;
          rainPos[o + 4] = y - 0.7;
          rainPos[o + 5] = z;
        }
        rainGeo.attributes.position.needsUpdate = true;
      }

      // ── Traffic: spawn, despawn, drive ──
      if (kitReady && now > spawnAt) {
        spawnAt = now + (ai.length < AI_CAP[quality] * 0.6 ? 60 : 300);
        if (ai.length < AI_CAP[quality]) spawnAi(now, ai.length < 8);
        // Keep the sample fresh: retire old cars far from you.
        const old = ai.find((a) => now - a.born > 70000 && Math.hypot(a.x - focusX, a.z - focusZ) > 110);
        if (old) {
          removeBuilt(old.b);
          ai.splice(ai.indexOf(old), 1);
        }
      }
      // Occupancy per edge (turning cars count on the edge they're turning into).
      const occ = new Map<number, { s: number; len: number; v: number }[]>();
      for (const a of ai) {
        const id = a.turn ? a.turn.to.id : a.edge.id;
        const s = a.turn ? INT - (1 - a.turn.t) * a.turn.len : a.s;
        if (!occ.has(id)) occ.set(id, []);
        occ.get(id)!.push({ s, len: a.b.len, v: a.v });
      }
      const obstacles: { x: number; z: number; r: number }[] = [];
      if (car) for (const [cx, cz] of circlesOf(car.x, car.z, car.th, car.b.len, car.b.w)) obstacles.push({ x: cx, z: cz, r: car.b.w / 2 });
      else if (!dead) obstacles.push({ x: ped.x, z: ped.z, r: 0.5 });
      for (const c of cops) obstacles.push({ x: c.bd.x, z: c.bd.z, r: c.bd.b.w / 2 });
      const knocked = peds.update(dt, focusX, focusZ, car || dead ? null : { x: ped.x, z: ped.z }, [
        ...(car ? [{ x: car.x, z: car.z, speed: Math.hypot(car.vx, car.vz), th: car.th, len: car.b.len, w: car.b.w, vx: car.vx, vz: car.vz }] : []),
        ...cops.map((c) => ({ x: c.bd.x, z: c.bd.z, speed: Math.hypot(c.bd.vx, c.bd.vz), th: c.bd.th, len: c.bd.b.len, w: c.bd.b.w, vx: c.bd.vx, vz: c.bd.vz })),
        ...ai.map((a) => ({ x: a.x, z: a.z, speed: a.v, th: a.th, len: a.b.len, w: a.b.w })),
      ]);
      if (car && knocked) {
        addHeat(CRIME.runOver * knocked);
        shake = Math.max(shake, 0.35);
        const slow = Math.pow(0.9, knocked); // a body on the bonnet costs some speed
        car.vx *= slow;
        car.vz *= slow;
        beep([110, 70], 'sawtooth', 0.05, 0.08, 0.15);
      }
      for (const a of ai) {
        let vt = a.vmax;
        if (now < a.stun) vt = 0;
        const myS = a.turn ? INT - (1 - a.turn.t) * a.turn.len : a.s;
        const myEdge = a.turn ? a.turn.to : a.edge;
        // car ahead in my lane
        let lead: { s: number; len: number; v: number } | null = null;
        for (const o of occ.get(myEdge.id) ?? []) if (o.s > myS + 0.01 && (!lead || o.s < lead.s)) lead = o;
        if (lead) {
          const gap = lead.s - myS - (lead.len + a.b.len) / 2 - 2.2;
          vt = Math.min(vt, gap <= 0 ? 0 : lead.v + Math.sqrt(2 * 6 * gap));
        }
        if (!a.turn) {
          // the light, and room on the far side
          const stopS = P - INT - a.b.len / 2 - 0.3;
          const remain = stopS - a.s;
          if (remain > -0.4) {
            const st = lightState(a.edge.b, a.edge.axis, tSec);
            let stop = st === 'r' || (st === 'a' && remain > 5);
            if (!stop) {
              let tail = Infinity;
              for (const o of occ.get(a.next.id) ?? []) tail = Math.min(tail, o.s - o.len / 2);
              if (tail - INT < a.b.len + 2.5) stop = true;
            }
            if (stop) vt = Math.min(vt, remain <= 0.2 ? 0 : Math.sqrt(2 * 7 * remain));
          }
        }
        // you (or your car) in the way
        const [fx, fz] = fwdOf(a.th);
        for (const o of obstacles) {
          const rx = o.x - a.x;
          const rz = o.z - a.z;
          const ahead = rx * fx + rz * fz;
          const lat = Math.abs(rx * -fz + rz * fx);
          if (ahead > 0 && ahead < 20 && lat < a.b.w / 2 + o.r + 0.3) {
            const dist = ahead - a.b.len / 2 - o.r - 0.8;
            vt = Math.min(vt, dist <= 0 ? 0 : Math.sqrt(2 * 8 * dist));
            if (car && dist < 4 && now > a.honk && a.v < 1) {
              a.honk = now + 4000 + Math.random() * 3000;
              if (Math.hypot(a.x - focusX, a.z - focusZ) < 30) horn();
            }
          }
        }
        a.v = vt < a.v ? Math.max(vt, a.v - 14 * dt) : Math.min(vt, a.v + 4.5 * dt);
        if (!a.turn) {
          a.s += a.v * dt;
          if (a.s >= P - INT) {
            a.turn = makeTurn(a.edge, a.next);
            a.turn.t = (a.s - (P - INT)) / a.turn.len;
          }
        } else {
          a.turn.t += (a.v * dt) / a.turn.len;
          if (a.turn.t >= 1) {
            const over = (a.turn.t - 1) * a.turn.len;
            a.edge = a.turn.to;
            a.s = INT + over;
            a.turn = null;
            a.next = pickNext(a.edge);
          }
        }
        if (!a.turn) {
          [a.x, a.z] = edgePoint(a.edge, a.s);
          a.th = Math.atan2(-a.edge.dz, a.edge.dx);
        } else {
          const { ax, az, cx, cz, bx, bz } = a.turn;
          const t = Math.min(1, a.turn.t);
          const u = 1 - t;
          a.x = u * u * ax + 2 * u * t * cx + t * t * bx;
          a.z = u * u * az + 2 * u * t * cz + t * t * bz;
          const dx = 2 * u * (cx - ax) + 2 * t * (bx - cx);
          const dz = 2 * u * (cz - az) + 2 * t * (bz - cz);
          a.th = Math.atan2(-dz, dx);
        }
        a.b.g.position.set(a.x, now < a.stun ? Math.sin(now / 40) * 0.02 : 0, a.z);
        a.b.g.rotation.y = a.th;
      }

      // ── Player's car: arcade physics ──
      if (car) {
        const c = car;
        const [fx, fz] = fwdOf(c.th);
        const rx = -fz;
        const rz = fx;
        let vf = c.vx * fx + c.vz * fz;
        let vl = c.vx * rx + c.vz * rz;
        const dead_ = c.health <= 0;
        const VMAX = dead_ ? 7 : 44;
        const hb = inp.jump;
        if (!dead) {
          if (inp.up) vf += vf < -0.5 ? 30 * dt : 15 * Math.max(0.08, 1 - vf / VMAX) * dt;
          if (inp.down) vf -= vf > 0.5 ? 30 * dt : vf > -11 ? 9 * dt : 0;
        }
        if (!inp.up && !inp.down) vf -= vf * 0.45 * dt + Math.sign(vf) * Math.min(Math.abs(vf), 0.6 * dt);
        if (hb) vf -= vf * 1.1 * dt;
        const steerIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
        const sp = Math.abs(vf);
        const yawRate = steerIn * 2.3 * Math.min(1, sp / 5) * (1 / (1 + sp / 30)) * Math.sign(vf || 1) * (hb ? 1.55 : 1);
        c.th += yawRate * dt + c.w * dt;
        c.w *= Math.exp(-6 * dt);
        vl *= Math.exp(-(hb ? 1.4 : sp > 30 ? 6 : 9) * dt);
        const [nfx, nfz] = fwdOf(c.th);
        c.vx = nfx * vf + -nfz * vl;
        c.vz = nfz * vf + nfx * vl;
        c.x += c.vx * dt;
        c.z += c.vz * dt;
        let impact = bodyVsWorld(c, 0.35);
        for (const b of bodies) impact = Math.max(impact, bodyVsBody(c, b));
        let crashed = 0;
        for (const a of ai) {
          const hit = aiVsBody(a, c);
          if (hit > 1) {
            a.stun = now + 1800;
            impact = Math.max(impact, hit);
            crashed = Math.max(crashed, hit);
          }
        }
        for (const cp of cops) {
          const hit = bodyVsBody(c, cp.bd);
          if (hit > 3) {
            impact = Math.max(impact, hit);
            cp.bd.health -= hit * 4;
            if (now > crimeCd) {
              crimeCd = now + 1500;
              addHeat(CRIME.hitCop);
            }
          }
        }
        if (crashed > 9 && now > crimeCd) {
          crimeCd = now + 1500;
          addHeat(CRIME.crash);
        }
        if (impact > 16 && now > slowmoUntil + 2500) slowmoUntil = now + 650; // a big one: a beat of slow motion
        if (impact > 3) {
          shake = Math.min(1, impact / 18);
          {
            const [fx, fz] = fwdOf(c.th);
            emit(c.x + fx * c.b.len * 0.5, 0.6, c.z + fz * c.b.len * 0.5, Math.min(40, 6 + impact * 2), 3 + impact * 0.35, 1.6, 0.9, 0.35);
          }
          if (impact > 5) c.health = Math.max(0, c.health - (impact - 5) * 2.2);
          beep([90 + Math.random() * 40], 'sawtooth', 0, Math.min(0.15, impact / 80), 0.18);
        }
        placeBody(c);
        // drift points
        if (Math.abs(vl) > 3.2 && sp > 9) {
          drift += Math.abs(vl) * dt * 12;
          driftIdle = 0;
        } else if (drift > 0) {
          driftIdle += dt;
          if (driftIdle > 0.9) {
            if (drift > 25) {
              const n = Math.round(drift);
              addScore(n);
              say(`+${n} DRIFT`, '', '#3bff8a');
            }
            drift = 0;
          }
        }
        if (impact > 6 && drift > 0) drift = 0; // crash loses the drift
        if (engOsc && engGain && engFilter && audio) {
          engOsc.frequency.setTargetAtTime(38 + sp * 3.2 + (inp.up ? 14 : 0), audio.currentTime, 0.08);
          engFilter.frequency.setTargetAtTime(280 + sp * 22, audio.currentTime, 0.1);
          engGain.gain.setTargetAtTime(dead_ ? 0.01 : 0.035, audio.currentTime, 0.2);
        }
      } else if (engGain && audio) engGain.gain.setTargetAtTime(0, audio.currentTime, 0.15);

      // ── Free bodies (parked cars, wrecks, cars you left) ──
      for (const b of bodies) {
        if (!b.awake) continue;
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.th += b.w * dt;
        const damp = Math.exp(-1.6 * dt);
        b.vx *= damp;
        b.vz *= damp;
        b.w *= Math.exp(-2.5 * dt);
        bodyVsWorld(b, 0.25);
        if (Math.hypot(b.vx, b.vz) < 0.05 && Math.abs(b.w) < 0.02) {
          b.vx = b.vz = b.w = 0;
          b.awake = false;
        }
      }
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) if (bodies[i].awake || bodies[j].awake) bodyVsBody(bodies[i], bodies[j]);
      for (const a of ai) for (const b of bodies) aiVsBody(a, b);
      for (const b of bodies) placeBody(b);
      if (bodies.length > BODY_CAP) {
        const far = bodies
          .filter((b) => !b.parked)
          .sort((p, q) => Math.hypot(q.x - focusX, q.z - focusZ) - Math.hypot(p.x - focusX, p.z - focusZ))[0];
        if (far && Math.hypot(far.x - focusX, far.z - focusZ) > 60) {
          removeBuilt(far.b);
          bodies.splice(bodies.indexOf(far), 1);
        }
      }

      // ── The Miners: chase, pathing, busts, roadblocks, helicopter ──
      {
        const stars = starsOf();
        const chasing = stars > 0 && !busted && !dead;
        const tx = car ? car.x : ped.x;
        const tz = car ? car.z : ped.z;
        const tvx = car ? car.vx : 0;
        const tvz = car ? car.vz : 0;
        if (kitReady && chasing && cops.length < copsFor(stars) && now > copSpawnAt) {
          copSpawnAt = now + 1600;
          spawnCop(tx, tz, now);
        }
        if (now > bfsAt) {
          bfsAt = now + 400;
          bfs(nodeOf(tx, tz));
        }
        let seen = now < reportUntil;
        let nearest = Infinity;
        let near = false;
        for (const cp of [...cops]) {
          const bd = cp.bd;
          const dx = tx - bd.x;
          const dz = tz - bd.z;
          const d = Math.hypot(dx, dz);
          nearest = Math.min(nearest, d);
          const los = d < 80 && segmentHit(bd.x, bd.z, tx, tz, camBoxes, 0.4) >= 1;
          if (chasing && (los || d < 30)) seen = true;
          // where to drive: straight at you with a lead when in sight, else down the road graph toward you
          let gx: number;
          let gz: number;
          if (chasing && (los || d < 14)) {
            cp.wp = -1;
            const lead = Math.min(1.1, d / 30);
            gx = tx + tvx * lead;
            gz = tz + tvz * lead;
          } else {
            // head for an intersection first, then hop along the shortest road path toward you
            if (cp.wp < 0) cp.wp = nodeOf(bd.x, bd.z);
            const [wx, wz] = nodeXZ(cp.wp);
            if (Math.hypot(wx - bd.x, wz - bd.z) < 9) {
              const at = cp.wp;
              let best = at;
              const opts = edgesFrom[at];
              if (chasing) {
                for (const e of opts) if (bfsD[e.b] < bfsD[best]) best = e.b;
              } else best = pick(opts).b; // off duty: cruise
              cp.wp = best;
            }
            const [gx2, gz2] = nodeXZ(cp.wp);
            // already at your intersection with no sight line: go straight at you anyway
            const atYours = chasing && cp.wp === nodeOf(tx, tz) && Math.hypot(gx2 - bd.x, gz2 - bd.z) < 9;
            [gx, gz] = atYours ? [tx, tz] : [gx2, gz2];
          }
          // drive (the same arcade model as yours, tuned a little calmer)
          const [fx, fz] = fwdOf(bd.th);
          let vf = bd.vx * fx + bd.vz * fz;
          let vl = bd.vx * -fz + bd.vz * fx;
          let err = angDiff(bd.th, Math.atan2(-(gz - bd.z), gx - bd.x));
          let vt = chasing ? copVmax(stars) + (d > 90 ? 10 : 0) : 12;
          vt *= Math.abs(err) > 1.2 ? 0.4 : Math.abs(err) > 0.5 ? 0.72 : 1;
          if (chasing && !car && d < 10) vt = Math.max(0, (d - 3.8) * 1.6); // pull up beside a suspect on foot
          else if (chasing && car && d < 16 && Math.hypot(car.vx, car.vz) < 6) vt = Math.min(vt, Math.max(1.5, (d - 5) * 1.4)); // box in a slow suspect
          if (cp.rev > 0) {
            cp.rev -= dt;
            err = -err;
            vf = Math.max(-8, vf - 20 * dt);
          } else if (vf < vt) vf += 17 * dt * Math.max(0.15, 1 - vf / Math.max(1, vt));
          else vf -= Math.min(vf - vt, 26 * dt);
          const sp = Math.abs(vf);
          const steer = THREE.MathUtils.clamp(err * 2.2, -1, 1);
          bd.th += (steer * 2.4 * Math.min(1, sp / 4) * Math.sign(vf || 1)) / (1 + sp / 40) * dt + bd.w * dt;
          bd.w *= Math.exp(-6 * dt);
          vl *= Math.exp(-7 * dt);
          const [nfx, nfz] = fwdOf(bd.th);
          bd.vx = nfx * vf - nfz * vl;
          bd.vz = nfz * vf + nfx * vl;
          bd.x += bd.vx * dt;
          bd.z += bd.vz * dt;
          const imp = bodyVsWorld(bd, 0.3);
          if (imp > 10) bd.health -= (imp - 10) * 3;
          for (const b of bodies) bodyVsBody(bd, b);
          for (const o of cops) if (o !== cp) bodyVsBody(bd, o.bd);
          for (const a of ai) if (aiVsBody(a, bd) > 1) a.stun = now + 1500;
          if (cp.rev <= 0 && vt > 3 && Math.abs(vf) < 1.5) cp.stuck += dt;
          else cp.stuck = 0;
          if (cp.stuck > 1.1) {
            cp.stuck = 0;
            cp.rev = 1.1;
          }
          placeBody(bd);
          if (chasing && d < (car ? 7.5 : 4.8) && Math.abs(vf) < 6) near = true;
          // takedown: a wrecked patrol car becomes scrap you can push around (or steal)
          if (bd.health <= 0) {
            dropBar(bd.b, cp.bar);
            cops.splice(cops.indexOf(cp), 1);
            bd.awake = true;
            bodies.push(bd);
            addScore(250);
            addHeat(CRIME.takedown);
            say('TAKEDOWN', '+250 · one Miner fewer', '#ff3b5c');
            slowmoUntil = now + 900;
            shake = 1;
            emit(bd.x, 1, bd.z, 40, 7, 1.8, 0.7, 0.2, 5);
            beep([140, 90], 'sawtooth', 0.12, 0.12, 0.4);
            continue;
          }
          if (!chasing && (d > 90 || now - cp.born > 40000)) removeCop(cp);
        }
        // busted: boxed in while stopped, or caught on foot
        if (chasing && near && (!car || Math.hypot(car.vx, car.vz) < 3)) bustT += dt;
        else bustT = Math.max(0, bustT - dt * 2);
        if (chasing && bustT > (car ? 2 : 0.9)) bust(now);
        // the helicopter at 5 stars; its searchlight counts as eyes
        if (chasing && stars >= 5 && !heli.active) {
          heli.spawn(tx, tz);
          say('AIR SUPPORT', 'the Miners sent the chopper', '#ff3b5c');
        }
        if (heli.active && !chasing) heli.despawn();
        heli.update(dt, now, tx, tz, night, seen);
        if (heli.active && Math.hypot(heli.aim.x - tx, heli.aim.z - tz) < 9) seen = true;
        // lose them: stay out of sight
        if (chasing) {
          if (seen) lostFor = 0;
          else lostFor += dt;
          if (lostFor > loseAfter(stars)) {
            coolDown();
            addScore(stars * 50);
            say('LOST THEM', `+${stars * 50} · the Miners gave up`, '#3bff8a');
            beep([523.25, 783.99, 1046.5], 'triangle', 0.09, 0.08);
          }
        }
        // roadblocks from 3 stars
        if (chasing && stars >= 3 && car && now > rbAt && roadblocks.length < 2) {
          rbAt = now + 15000;
          placeRoadblock(car, now);
        }
        for (const r of [...roadblocks]) {
          const d = Math.min(...r.cars.map((c) => Math.hypot(c.bd.x - tx, c.bd.z - tz)));
          if ((now - r.born > 45000 || !chasing) && d > 50) clearRoadblock(r);
        }
        // strobes + street spill from the nearest car's bar, siren level from the nearest cop
        let nb: { x: number; z: number; s: number; d: number } | null = null;
        for (const cp of cops) {
          const st = cp.bar.update(now, cp.phase);
          const d = Math.hypot(cp.bd.x - tx, cp.bd.z - tz);
          if (!nb || d < nb.d) nb = { x: cp.bd.x, z: cp.bd.z, s: st, d };
        }
        for (const r of roadblocks)
          for (const c of r.cars) {
            const st = c.bar.update(now, 0.5);
            const d = Math.hypot(c.bd.x - tx, c.bd.z - tz);
            if (!nb || d < nb.d) nb = { x: c.bd.x, z: c.bd.z, s: st, d };
          }
        const li = (60 + night * 160) * (chasing ? 1 : 0);
        copLights[0].intensity = nb && nb.s === 1 ? li : 0;
        copLights[1].intensity = nb && nb.s === 2 ? li : 0;
        if (nb) for (const l of copLights) l.position.set(nb.x, 2.2, nb.z);
        siren?.set(chasing && cops.length ? THREE.MathUtils.clamp(1 - nearest / 110, 0, 1) : 0, nearest < 25);
        if (!chasing && !busted) for (const cp of [...cops]) if (Math.hypot(cp.bd.x - tx, cp.bd.z - tz) > 60) removeCop(cp);
      }

      // ── On foot ──
      if (!car && !dead && !busted) {
        const mfwd = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
        const mright = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        let mx = -Math.sin(look.yaw) * mfwd + Math.cos(look.yaw) * mright;
        let mz = -Math.cos(look.yaw) * mfwd - Math.sin(look.yaw) * mright;
        const ml = Math.hypot(mx, mz);
        const spd = ml > 0 ? (inp.sprint ? 8.5 : 4.2) : 0;
        if (ml > 0) {
          mx /= ml;
          mz /= ml;
          ped.heading = ped.heading + angDiff(ped.heading, Math.atan2(mx, mz)) * Math.min(1, dt * 12);
        }
        ped.speed += (spd - ped.speed) * Math.min(1, dt * 10);
        ped.x += mx * ped.speed * dt;
        ped.z += mz * ped.speed * dt;
        const c = collideCircleBoxes(ped.x, ped.z, 0.4);
        ped.x = c.x;
        ped.z = c.z;
        // shoulder past cars
        const pushOut = (x: number, z: number, r: number) => {
          const dx = ped.x - x;
          const dz = ped.z - z;
          const d = Math.hypot(dx, dz);
          if (d < r + 0.4 && d > 1e-6) {
            ped.x = x + (dx / d) * (r + 0.4);
            ped.z = z + (dz / d) * (r + 0.4);
          }
        };
        for (const b of bodies) if (Math.abs(b.x - ped.x) < 8 && Math.abs(b.z - ped.z) < 8) for (const [cx, cz] of circlesOf(b.x, b.z, b.th, b.b.len, b.b.w)) pushOut(cx, cz, b.b.w / 2);
        for (const a of ai) if (Math.abs(a.x - ped.x) < 8 && Math.abs(a.z - ped.z) < 8) for (const [cx, cz] of circlesOf(a.x, a.z, a.th, a.b.len, a.b.w)) pushOut(cx, cz, a.b.w / 2);
        for (const w of peds.walkers) if (w.root.visible && w.knocked <= 0) pushOut(w.root.position.x, w.root.position.z, 0.35); // other people are solid too
        // jump
        const gy = groundY(ped.x, ped.z);
        if (inp.jump && ped.onGround) {
          ped.vy = 6.2;
          ped.onGround = false;
        }
        ped.vy -= 20 * dt;
        ped.y += ped.vy * dt;
        if (ped.y <= gy) {
          ped.y = ped.onGround ? THREE.MathUtils.lerp(ped.y, gy, 0.5) : gy;
          if (ped.y < gy) ped.y = gy;
          ped.vy = 0;
          ped.onGround = true;
        } else if (ped.onGround && ped.y - gy < 0.25) ped.y = gy; // step down a kerb
        else ped.onGround = false;
        player.position.set(ped.x, ped.y, ped.z);
        player.rotation.set(0, ped.heading, 0);
        // run over?
        for (const a of ai) {
          if (a.v < 4) continue;
          const [fx, fz] = fwdOf(a.th);
          const rx = ped.x - a.x;
          const rz = ped.z - a.z;
          if (Math.abs(rx * fx + rz * fz) < a.b.len / 2 + 0.3 && Math.abs(rx * -fz + rz * fx) < a.b.w / 2 + 0.3 && ped.y - groundY(ped.x, ped.z) < 1.2) {
            dead = now;
            fling = { vx: fx * a.v * 0.7, vy: 8 + a.v * 0.2, vz: fz * a.v * 0.7, spin: 11 };
            const meta = a.f.token ? tokenMeta(a.f.token) : null;
            setWasted({ by: meta ? `a $${meta.sym} box truck` : `a ${kindLabel(a.f.kind).toLowerCase()}`, id: a.f.id, sim: simIds.has(a.f.id) });
            a.stun = now + 2500;
            beep([180, 120, 80], 'sawtooth', 0.2, 0.1, 0.5);
            if (mission) mission = null;
            break;
          }
        }
        // animation blend
        const tw = ped.speed < 0.3 ? { idle: 1, walk: 0, run: 0 } : ped.speed < 6 ? { idle: 0, walk: 1, run: 0 } : { idle: 0, walk: 0, run: 1 };
        for (const k of ['idle', 'walk', 'run'] as const) {
          weights[k] += (tw[k] - weights[k]) * Math.min(1, dt * 8);
          acts[k]?.setEffectiveWeight(weights[k]);
        }
        if (acts.walk) acts.walk.timeScale = Math.max(0.6, ped.speed / 3.2);
      } else if (busted && !dead) {
        if (now - busted > 3600) {
          busted = 0;
          setBusted(null);
          coolDown();
          for (const c of [...cops]) removeCop(c);
          for (const r of [...roadblocks]) clearRoadblock(r);
          ped.x = SPAWN.x;
          ped.z = SPAWN.z;
          ped.y = CURB_H;
          ped.vy = 0;
          ped.speed = 0;
          player.position.set(ped.x, ped.y, ped.z);
          player.rotation.set(0, Math.PI, 0);
          look.yaw = 0;
          placeOffers();
        }
      } else if (dead && fling) {
        fling.vy -= 22 * dt;
        player.position.x += fling.vx * dt;
        player.position.y += fling.vy * dt;
        player.position.z += fling.vz * dt;
        player.rotation.x += fling.spin * dt;
        player.rotation.z += fling.spin * 0.6 * dt;
        const gy = groundY(player.position.x, player.position.z);
        if (player.position.y < gy) {
          player.position.y = gy;
          fling.vx *= 0.4;
          fling.vz *= 0.4;
          fling.vy = Math.abs(fling.vy) * 0.3;
          fling.spin *= 0.5;
        }
        if (now - dead > 3600) {
          dead = 0;
          coolDown();
          for (const r of [...roadblocks]) clearRoadblock(r);
          fling = null;
          setWasted(null);
          ped.x = SPAWN.x;
          ped.z = SPAWN.z;
          ped.y = CURB_H;
          ped.vy = 0;
          ped.speed = 0;
          player.rotation.set(0, Math.PI, 0);
          look.yaw = 0;
          placeOffers();
        }
      }
      mixer?.update(dt);

      // ── Missions ──
      const px = car ? car.x : ped.x;
      const pz = car ? car.z : ped.z;
      const reach = car ? 5.5 : 3.2;
      const bob = Math.sin(now / 300) * 0.25;
      deliverBeam.visible = !mission && !dead;
      rushBeam.visible = !mission && !dead;
      targetBeam.visible = !!mission;
      carried.visible = mission?.kind === 'deliver';
      arrow.visible = !!mission && !dead;
      deliverBeam.position.set(offer.deliver[0], groundY(offer.deliver[0], offer.deliver[1]), offer.deliver[1]);
      deliverBlock.position.set(0, 1.4 + bob, 0);
      deliverBlock.rotation.y = now / 600;
      rushBeam.position.set(offer.rush[0], 0, offer.rush[1]);
      if (!dead && !mission) {
        if (Math.hypot(px - offer.deliver[0], pz - offer.deliver[1]) < reach) startDeliver(now);
        else if (Math.hypot(px - offer.rush[0], pz - offer.rush[1]) < reach + 2) startRush(now);
      }
      let tx = 0;
      let tz = 0;
      if (mission) {
        if (mission.kind === 'deliver') {
          tx = mission.x;
          tz = mission.z;
          if (Math.hypot(px - tx, pz - tz) < reach + 0.5) {
            const left = Math.max(0, (mission.deadline - now) / 1000);
            const pts = 100 + Math.round(left) * 10;
            addScore(pts);
            pay.current(['deliver']); // LIVE: 1 tx per block delivered (never blocks the score)
            say(mission.height ? `BLOCK #${mission.height.toLocaleString()} MINED` : 'BLOCK DELIVERED', `+${pts} pts · ${left.toFixed(1)}s to spare`, '#ffd23f');
            beep([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], 'square', 0.11, 0.1);
            mission = null;
            placeOffers();
          }
        } else {
          [tx, tz] = mission.cps[mission.idx];
          if (Math.hypot(px - tx, pz - tz) < 8) {
            mission.idx++;
            addScore(50);
            pay.current(['checkpoint']); // LIVE: 1 tx per rush checkpoint
            if (mission.idx >= mission.cps.length) {
              const left = Math.max(0, (mission.deadline - now) / 1000);
              const pts = 250 + Math.round(left) * 10;
              addScore(pts);
              say('MEMPOOL CLEARED', `+${pts + 50} pts · ${left.toFixed(1)}s to spare`, '#28e7ff');
              beep([523.25, 659.25, 783.99, 1046.5, 1318.5], 'square', 0.09, 0.1);
              mission = null;
              placeOffers();
            } else {
              mission.deadline += 9000;
              mission.total += 9;
              beep([880, 1175], 'triangle', 0.06, 0.08);
              say(`CHECKPOINT ${mission.idx}/${mission.cps.length}`, '+50 · +9s', '#28e7ff');
              [tx, tz] = mission.cps[mission.idx];
            }
          }
        }
        if (mission && now > mission.deadline) failMission(mission.kind === 'deliver' ? 'ORPHANED' : 'BLOCK MINED WITHOUT YOU');
        if (mission) {
          targetBeam.position.set(tx, groundY(tx, tz), tz);
          const ay = (car ? car.b.g.position.y + 4.6 : ped.y + 2.6) + bob * 0.3;
          arrow.scale.setScalar(car ? 0.8 : 0.6);
          arrow.position.set(px, ay, pz);
          arrow.lookAt(tx, ay, tz);
          carried.position.set(px, (car ? 2.6 : ped.y + 2.0) + bob * 0.5, pz);
          carried.rotation.y = now / 500;
        }
      }

      // ── Camera ──
      if (dead || busted) {
        const t = (now - (dead || busted)) / 1000;
        const a = 0.6 + t * 0.35;
        tmpV.set(player.position.x + Math.sin(a) * 7, 3.4 + t * 0.4, player.position.z + Math.cos(a) * 7);
        camPos.lerp(tmpV, Math.min(1, realDt * 2));
        camLook.lerp(tmpV.set(player.position.x, player.position.y + 0.6, player.position.z), Math.min(1, realDt * 6));
      } else {
        let ty = 0;
        let cx = 0;
        let cz = 0;
        let yaw = 0;
        let pitch = 0;
        let dist = 0;
        let rate = 0;
        let ahead = 0;
        if (car && camMode === 'cine') {
          // Cinematic cam: hard cuts between low roadside spots ahead of the car, the camera panning as it passes.
          const sp = Math.hypot(car.vx, car.vz);
          look.yaw = Math.atan2(-Math.cos(car.th), Math.sin(car.th));
          look.lookYaw = look.lookPitch = 0;
          if (!cineHas || Math.hypot(cinePt.x - car.x, cinePt.z - car.z) > 42 || segmentHit(cinePt.x, cinePt.z, car.x, car.z, camBoxes, 0.2) < 1) {
            const ux = sp > 2 ? car.vx / sp : Math.cos(car.th);
            const uz = sp > 2 ? car.vz / sp : -Math.sin(car.th);
            const side = Math.random() < 0.5 ? 1 : -1;
            const fwdD = 16 + Math.min(16, sp * 0.55);
            const c = collideCircleBoxes(car.x + ux * fwdD - uz * side * 7, car.z + uz * fwdD + ux * side * 7, 1);
            cinePt.set(c.x, groundY(c.x, c.z) + 0.8 + Math.random() * 2.4, c.z);
            cineHas = true;
            camLook.set(car.x, car.b.g.position.y + 1, car.z);
          }
          camPos.copy(cinePt);
          camLook.lerp(tmpV.set(car.x, car.b.g.position.y + 1, car.z), Math.min(1, realDt * 9));
        }
        if (car && camMode === 'cine') {
          /* the cinematic cam placed itself above */
        } else if (car) {
          if (now - look.lastMouse > 1500) {
            look.lookYaw *= Math.exp(-2.5 * realDt);
            look.lookPitch *= Math.exp(-2.5 * realDt);
          }
          const behind = Math.atan2(-Math.cos(car.th), Math.sin(car.th));
          look.yaw = look.yaw + angDiff(look.yaw, behind) * Math.min(1, realDt * 3.2);
          const sp = Math.hypot(car.vx, car.vz);
          yaw = look.yaw + look.lookYaw;
          pitch = 0.2 + look.lookPitch - Math.min(0.06, sp * 0.0015);
          dist = 5 + car.b.len * 0.7 + sp * 0.09 + (look.dist - 6) * 0.5;
          cx = car.x;
          cz = car.z;
          ty = car.b.g.position.y + 1.7;
          rate = 8 - Math.min(3.5, sp * 0.09); // lag grows with speed: the car pulls away, then the camera catches up
          ahead = 3;
        } else {
          yaw = look.yaw;
          pitch = look.pitch;
          dist = look.dist;
          cx = ped.x;
          cz = ped.z;
          ty = ped.y + 1.45;
          rate = 14;
        }
        if (!(car && camMode === 'cine')) {
          const ox = Math.sin(yaw) * Math.cos(pitch) * dist;
          const oz = Math.cos(yaw) * Math.cos(pitch) * dist;
          const hit = segmentHit(cx, cz, cx + ox, cz + oz, camBoxes, 0.4);
          const k = Math.max(0.12, hit - 0.04);
          tmpV.set(cx + ox * k, Math.max(ty + Math.sin(pitch) * dist * k, groundY(cx + ox * k, cz + oz * k) + 0.4), cz + oz * k);
          camPos.lerp(tmpV, Math.min(1, realDt * rate));
          if (hit < 1) camPos.lerp(tmpV, 0.6); // snap in front of walls rather than clip through
          tmpV.set(cx - Math.sin(yaw) * ahead, ty, cz - Math.cos(yaw) * ahead);
          camLook.lerp(tmpV, Math.min(1, realDt * rate * 1.5));
        }
      }
      {
        const sp = car ? Math.hypot(car.vx, car.vz) : 0;
        const fovT = camMode === 'cine' && car ? 42 : 60 + Math.min(22, Math.max(0, sp - 8) * 0.55) + (inp.sprint && !car ? 3 : 0) + (now < slowmoUntil ? -6 : 0);
        if (car && sp > 32) shake = Math.max(shake, (sp - 32) * 0.006); // road rumble at the top end
        if (Math.abs(camera.fov - fovT) > 0.05) {
          camera.fov += (fovT - camera.fov) * Math.min(1, realDt * 3);
          camera.updateProjectionMatrix();
        }
        if (car && now > exhaustAt && (inp.up || sp > 3)) {
          exhaustAt = now + 45;
          const [fx, fz] = fwdOf(car.th);
          const g = 0.08 + night * 0.04;
          emit(car.x - fx * car.b.len * 0.5, 0.35, car.z - fz * car.b.len * 0.5, 1, 0.4, g, g, g * 1.2, 0.6);
        }
        stepSparks(realDt);
      }
      camera.position.copy(camPos);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.5;
        camera.position.y += (Math.random() - 0.5) * shake * 0.5;
        shake = Math.max(0, shake - realDt * 2.5);
      }
      camera.lookAt(camLook);

      // ── Target tag: the transaction you're looking at ──
      let tgt = null as Target | null;
      {
        const camDir = camera.getWorldDirection(new THREE.Vector3());
        let bestScore = car ? 0.965 : 0.975;
        const consider = (f: FeedTx | null, obj: THREE.Object3D, x: number, z: number, hgt: number, kind: 'ai' | 'body') => {
          if (!f) return;
          const dx = x - camera.position.x;
          const dy = hgt * 0.6 - camera.position.y;
          const dz = z - camera.position.z;
          const d = Math.hypot(dx, dy, dz);
          if (d > 55 || d < 2) return;
          const c = (dx * camDir.x + dy * camDir.y + dz * camDir.z) / d;
          const s = c + 0.25 / d; // nearer cars win a close call
          if (s > bestScore) {
            bestScore = s;
            tgt = { kind, f, obj, h: hgt };
          }
        };
        for (const a of ai) consider(a.f, a.b.g, a.x, a.z, a.b.len > 6 ? 3.2 : 1.6, 'ai');
        for (const b of bodies) consider(b.f, b.b.g, b.x, b.z, 1.6, 'body');
      }
      target = tgt;
      const tag = tagRef.current;
      if (tag) {
        const t = target as Target | null;
        if (t && !dead) {
          tmpV.copy(t.obj.position).setY(t.obj.position.y + t.h + 1.1).project(camera);
          if (tmpV.z < 1) {
            tag.style.display = 'block';
            tag.style.transform = `translate(-50%, -100%) translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px)`;
            if (t.f.id !== lastTagId) {
              lastTagId = t.f.id;
              const meta = t.f.token ? tokenMeta(t.f.token) : null;
              const sim = simIds.has(t.f.id);
              tag.innerHTML = '';
              const head = document.createElement('div');
              head.style.color = KIND_COL[t.f.kind];
              head.style.fontWeight = 'bold';
              head.textContent = `${kindLabel(t.f.kind)}${meta ? ` · $${meta.sym}` : ''}`;
              const body = document.createElement('div');
              body.textContent = `${t.f.bytes.toLocaleString()} B · ${t.f.mined ? 'mined' : 'mempool'} · tx ${t.f.id.slice(0, 10)}…`;
              const foot = document.createElement('div');
              foot.style.opacity = '0.7';
              foot.textContent = sim ? 'simulated (feed offline)' : 'T: open on WhatsOnChain';
              tag.append(head, body, foot);
            }
          } else tag.style.display = 'none';
        } else {
          tag.style.display = 'none';
          lastTagId = '';
        }
      }

      composer.render();
      drawMap(now, px, pz, car ? car.th - Math.PI / 2 : ped.heading + Math.PI);

      // ── HUD (10 Hz) ──
      if (now > hudAt) {
        hudAt = now + 100;
        let prompt = '';
        if (!car && !dead) {
          const nearCar = [...bodies.map((b) => ({ x: b.x, z: b.z, r: b.b.len / 2 + 2.2, f: b.f })), ...ai.map((a) => ({ x: a.x, z: a.z, r: a.b.len / 2 + 2.2, f: a.f as FeedTx | null }))].find((c) => Math.hypot(c.x - ped.x, c.z - ped.z) < c.r);
          if (nearCar) prompt = `F · ${nearCar.f ? 'carjack' : 'steal'} ${carSay(nearCar.f)}`;
        }
        const hrs = dayT * 24;
        const fd = feedRef.current;
        // Rooftop billboards: the newest transactions on the road (redrawn only when they change).
        detail.setTicker(
          ai
            .slice(-4)
            .reverse()
            .map((a) => ({ text: `${kindLabel(a.f.kind).toUpperCase()}  ${a.f.id.slice(0, 8)}…  ${a.f.sats.toLocaleString()} sats`, color: KIND_COL[a.f.kind] })),
        );
        const nSim = ai.filter((a) => simIds.has(a.f.id)).length;
        const next: Hud = {
          score,
          best,
          driving: !!car,
          speed: car ? Math.round(Math.abs(car.vx * Math.cos(car.th) - car.vz * Math.sin(car.th)) * 3.6) : 0,
          health: car ? Math.round(car.health) : 100,
          mission: mission
            ? mission.kind === 'deliver'
              ? { title: mission.height ? `Deliver block #${mission.height.toLocaleString()}` : 'Deliver the block', sub: `${Math.round(Math.hypot(px - mission.x, pz - mission.z))} m · red beam`, time: Math.max(0, (mission.deadline - now) / 1000) }
              : { title: `Mempool rush ${mission.idx}/${mission.cps.length}`, sub: `${Math.round(Math.hypot(px - mission.cps[mission.idx][0], pz - mission.cps[mission.idx][1]))} m · cyan beam`, time: Math.max(0, (mission.deadline - now) / 1000) }
            : null,
          prompt,
          clock: `${String(Math.floor(hrs)).padStart(2, '0')}:${String(Math.floor((hrs % 1) * 60)).padStart(2, '0')}`,
          drift: Math.round(drift),
          locked,
          carLabel: car ? carSay(car.f) : '',
          feedNote: fd.status === 'live' ? `${ai.length - nSim} live txs on the road` : nSim ? 'feed offline · simulated traffic' : 'connecting…',
          stars: starsOf(),
          heatLost: starsOf() > 0 && lostFor > 0.6,
          cine: camMode === 'cine' && !!car,
        };
        const key = JSON.stringify(next);
        if (key !== lastHud) {
          lastHud = key;
          setHud(next);
        }
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLock);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('wheel', onWheel);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      siren?.stop();
      setStation(null);
      for (const c of cops) c.bar.dispose();
      heli.dispose();
      try {
        engOsc?.stop();
      } catch {
        /* already stopped */
      }
      for (const a of ai) kit.release(a.b);
      for (const b of bodies) kit.release(b.b);
      if (car) kit.release(car.b);
      composer.dispose();
      composerRT.dispose();
      gtao.dispose();
      detail.dispose();
      const textures = new Set<THREE.Texture>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) textures.add(v);
          mat.dispose();
        }
      });
      kit.dispose();
      peds.dispose();
      for (const t of textures) t.dispose();
      hdrSky?.dispose();
      hdrEnv?.dispose();
      roomEnv.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [pay]);

  const padDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    control.current?.key(e.currentTarget.dataset.k as keyof Input, true);
  };
  const padUp = (e: React.PointerEvent<HTMLButtonElement>) => control.current?.key(e.currentTarget.dataset.k as keyof Input, false);
  const padProps = { onPointerDown: padDown, onPointerUp: padUp, onPointerLeave: padUp, onPointerCancel: padUp };
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  return (
    <section className="panel game-root">
      <GameAudio track="city" />
      <div className="panel-header">
        <span className="panel-title">Satoshi City</span>
        <button
          onClick={() => control.current?.setQuality(quality === 'high' ? 'low' : 'high')}
          className="btn ml-3 px-2 py-0 text-xs"
          title="Graphics quality: High adds ambient occlusion, sharper shadows, glow and puddles. Low is for phones and older laptops."
        >
          GFX {quality === 'high' ? 'HIGH' : 'LOW'}
        </button>

        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE MAINNET TRAFFIC
            </>
          ) : feed.status === 'off' || feed.status === 'error' ? (
            'feed offline · simulated traffic'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div ref={stage} className={`game-stage relative select-none ${gfs.fs ? 'h-screen w-screen bg-black text-[1.15em]' : ''}`}>
        <div ref={mount} className={`game-fill w-full touch-none overflow-hidden ${gfs.fs ? 'h-full' : 'inset h-[calc(100vh-220px)] min-h-[420px]'}`} />
        <button
          onClick={gfs.toggle}
          className="btn btn-on absolute right-[190px] top-3 z-20 px-3 py-1.5 text-xs font-black tracking-widest max-sm:right-[140px]"
          title="Fullscreen (G, or F on the title screen) · Esc leaves"
        >
          {gfs.fs ? '✕ EXIT FULLSCREEN' : '⛶ FULLSCREEN'}
        </button>
        <ActionHud ap={ap} className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 max-sm:bottom-44" />

        {/* Score + mission */}
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[55%] flex-col gap-1 font-bold drop-shadow">
          <div className="text-3xl text-hot" style={{ fontFamily: '"Impact", "Arial Black", sans-serif', WebkitTextStroke: '1px #000' }}>
            {hud.score.toLocaleString()} <span className="text-sm text-fg">PTS</span>
          </div>
          <div className="text-xs text-dim">best {hud.best.toLocaleString()}</div>
          {hud.mission && (
            <div className="mt-1 bg-black/70 px-2 py-1">
              <div className="text-sm text-fg">{hud.mission.title}</div>
              <div className="text-xs text-dim">{hud.mission.sub}</div>
              <div className={`text-2xl ${hud.mission.time < 10 ? 'blink text-hot' : 'text-accent'}`}>{mmss(hud.mission.time)}</div>
            </div>
          )}
          {!hud.mission && <div className="bg-black/60 px-2 py-0.5 text-xs text-fg">Gold beam: deliver a block · Cyan beam: mempool rush</div>}
          {hud.drift > 0 && <div className="text-xl text-[#3bff8a]">DRIFT {hud.drift}</div>}
        </div>

        {/* Minimap + clock */}
        <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1">
          <canvas ref={mapRef} width={200} height={200} className="h-[120px] w-[120px] rounded-full border-2 border-black/80 shadow-lg sm:h-[170px] sm:w-[170px]" />
          {hud.stars > 0 && (
            <div className={`flex gap-0.5 text-2xl leading-none sm:text-3xl ${hud.heatLost ? 'blink' : ''}`} title={hud.heatLost ? 'out of sight: keep hiding' : 'wanted by the Miners'}>
              {[5, 4, 3, 2, 1].map((i) => (
                <span key={i} style={{ color: 6 - i <= hud.stars ? '#ffffff' : 'rgba(255,255,255,0.16)', WebkitTextStroke: '1.5px #000', textShadow: 6 - i <= hud.stars ? '0 0 10px rgba(255,255,255,0.5)' : 'none' }}>
                  ★
                </span>
              ))}
            </div>
          )}
          <div className="bg-black/60 px-2 text-lg font-bold text-hot">{hud.clock}</div>
          <div className="bg-black/60 px-2 text-[10px] text-dim">{hud.feedNote}</div>
        </div>

        {/* Speedometer */}
        {hud.driving && (
          <div className="pointer-events-none absolute bottom-4 right-4 text-right drop-shadow max-sm:bottom-28">
            <div className="text-5xl font-black text-fg" style={{ fontFamily: '"Impact", "Arial Black", sans-serif', WebkitTextStroke: '1px #000' }}>
              {hud.speed}
              <span className="ml-1 text-base text-dim">km/h</span>
            </div>
            <div className="ml-auto mt-1 h-2 w-36 bg-black/70">
              <div className="h-full" style={{ width: `${hud.health}%`, background: hud.health > 50 ? '#3bff8a' : hud.health > 20 ? '#ffd23f' : '#ff3b3b' }} />
            </div>
            <div className="mt-0.5 max-w-60 text-[11px] text-dim">{hud.health <= 0 ? 'ENGINE WRECKED · find another ride' : hud.carLabel}</div>
          </div>
        )}

        {/* Target tag (positioned by the game loop) */}
        <div ref={tagRef} className="pointer-events-none absolute left-0 top-0 hidden whitespace-nowrap border border-[var(--border-dim)] bg-black/80 px-2 py-1 text-[11px] leading-tight text-fg" />

        {hud.prompt && !wasted && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center max-sm:bottom-40">
            <span className="bg-black/75 px-3 py-1 text-sm font-bold text-hot">{hud.prompt}</span>
          </div>
        )}

        {started && !hud.locked && !wasted && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 hidden justify-center sm:flex">
            <span className="bg-black/60 px-2 py-0.5 text-xs text-dim">click the city to mouse-look (Esc releases) · or drag to look</span>
          </div>
        )}

        {toast && (
          <div key={toast.n} className="pointer-events-none absolute inset-x-0 top-[22%] flex flex-col items-center" style={{ animation: 'scFade 2.6s ease-out both' }}>
            <style>{`
              @keyframes scFade { 0% { opacity: 0; transform: scale(1.6) } 10% { opacity: 1; transform: scale(1) } 80% { opacity: 1 } 100% { opacity: 0 } }
            `}</style>
            <span
              className="font-black uppercase"
              style={{ fontFamily: '"Impact", "Arial Black", sans-serif', fontSize: 'clamp(32px, 6vw, 72px)', color: toast.col, WebkitTextStroke: '2px #000', textShadow: '0 4px 0 #000, 0 0 24px rgba(0,0,0,0.6)' }}
            >
              {toast.text}
            </span>
            {toast.sub && <span className="mt-1 bg-black/70 px-3 py-0.5 text-sm font-bold text-fg">{toast.sub}</span>}
          </div>
        )}

        {hud.cine && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[9%] bg-black" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[9%] bg-black" />
          </>
        )}

        {/* Radio: a Designers Republic station card on every retune, then a slim now-playing strip */}
        {hud.driving && radio && (
          <div className="pointer-events-none absolute left-3 top-[34%] z-10 max-w-[78%] sm:top-[30%]">
            <style>{`
              @keyframes tbRadioIn { 0% { transform: translateX(-40px) skewX(-12deg); opacity: 0 } 12% { transform: none; opacity: 1 } 85% { opacity: 1 } 100% { opacity: 0.0 } }
              @keyframes tbScroll { from { transform: translateX(0) } to { transform: translateX(-50%) } }
            `}</style>
            <div key={radio.n} style={{ animation: 'tbRadioIn 4.2s cubic-bezier(.2,.9,.2,1) both' }}>
              <div className="flex items-stretch">
                <div className="flex w-10 flex-col items-center justify-center text-black" style={{ background: RADIO[radio.i].col, fontFamily: '"Arial Black", Impact, sans-serif' }}>
                  <span className="text-[9px] leading-none">FM</span>
                  <span className="text-xl leading-none">{String(radio.i + 1).padStart(2, '0')}</span>
                </div>
                <div className="bg-black/85 px-3 py-1.5" style={{ borderTop: `2px solid ${RADIO[radio.i].col}` }}>
                  <div className="text-[9px] tracking-[0.35em] text-dim">SATOSHI CITY RADIO ▶▶ {RADIO.length} STATIONS</div>
                  <div className="text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl" style={{ fontFamily: '"Arial Black", Impact, sans-serif', color: RADIO[radio.i].col, letterSpacing: '-0.02em' }}>
                    {RADIO[radio.i].name}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-fg">{radio.sub}</div>
                </div>
              </div>
            </div>
          </div>
        )}
        {hud.driving && radio && (
          <div className="pointer-events-none absolute bottom-4 left-3 z-10 flex max-w-[60%] items-end gap-2 max-sm:bottom-48">
            {RADIO[radio.i].album && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${BMUSIC}cover.jpg`} alt="Echoes in the Abyss cover" className="h-16 w-16 border border-black/80 object-cover shadow-lg sm:h-20 sm:w-20" />
            )}
            <div className="overflow-hidden bg-black/75 px-2 py-1 text-[11px] leading-tight">
              <div className="font-black tracking-widest" style={{ color: RADIO[radio.i].col }}>
                ♪ {RADIO[radio.i].name} <span className="font-normal text-dim">· R to retune</span>
              </div>
              <div className="text-fg">{song || '…'}</div>
              {RADIO[radio.i].album && (
                <>
                  <div className="text-dim">
                    album: <span className="text-fg">Echoes in the Abyss</span> · VexVoid · streams on bMusic, 1 sat per second
                  </div>
                  {album.length > 0 && (
                    <div className="max-w-72 overflow-hidden whitespace-nowrap text-[10px] text-dim">
                      <div className="inline-block" style={{ animation: 'tbScroll 40s linear infinite' }}>
                        {[...album, ...album].map((t, i) => `${(i % album.length) + 1}. ${t}`).join('   ·   ')}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {busted && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <style>{`
              @keyframes tbBand { from { transform: scaleX(0); opacity: 0 } 40% { opacity: 1 } to { transform: scaleX(1); opacity: 1 } }
              @keyframes tbPunch { 0% { transform: scale(2.6); opacity: 0; filter: blur(8px) } 55% { transform: scale(0.94); opacity: 1; filter: blur(0) } 75% { transform: scale(1.03) } 100% { transform: scale(1) } }
              @keyframes tbSub { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
            `}</style>
            <div className="relative flex w-full items-center justify-center py-5" style={{ animation: 'tbBand 0.45s ease-out 0.35s both' }}>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/80 to-transparent" />
              <span
                className="relative font-black uppercase"
                style={{
                  fontFamily: '"Pricedown", "Impact", "Haettenschweiler", "Arial Black", serif',
                  fontSize: 'clamp(56px, 11vw, 132px)',
                  letterSpacing: '0.06em',
                  color: '#2f6dff',
                  WebkitTextStroke: '3px #000',
                  textShadow: '0 0 24px rgba(47,109,255,0.55), 0 6px 0 #000, 0 10px 24px rgba(0,0,0,0.9)',
                  animation: 'tbPunch 0.7s cubic-bezier(.2,1.4,.4,1) 0.55s both',
                }}
              >
                Busted
              </span>
            </div>
            <div className="mt-2 bg-black/70 px-3 py-1 text-sm text-fg" style={{ animation: 'tbSub 0.4s ease-out 1.2s both' }}>
              the Miners took you in at {busted.stars} star{busted.stars === 1 ? '' : 's'} · heat cleared
            </div>
          </div>
        )}

        {wasted && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <style>{`
              @keyframes tbBand { from { transform: scaleX(0); opacity: 0 } 40% { opacity: 1 } to { transform: scaleX(1); opacity: 1 } }
              @keyframes tbPunch { 0% { transform: scale(2.6); opacity: 0; filter: blur(8px) } 55% { transform: scale(0.94); opacity: 1; filter: blur(0) } 75% { transform: scale(1.03) } 100% { transform: scale(1) } }
              @keyframes tbSub { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
            `}</style>
            <div className="relative flex w-full items-center justify-center py-5" style={{ animation: 'tbBand 0.45s ease-out 0.35s both' }}>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/80 to-transparent" />
              <span
                className="relative font-black uppercase"
                style={{
                  fontFamily: '"Pricedown", "Impact", "Haettenschweiler", "Arial Black", serif',
                  fontSize: 'clamp(56px, 11vw, 132px)',
                  letterSpacing: '0.06em',
                  color: '#b4141e',
                  WebkitTextStroke: '3px #000',
                  textShadow: '0 0 24px rgba(180,20,30,0.55), 0 6px 0 #000, 0 10px 24px rgba(0,0,0,0.9)',
                  animation: 'tbPunch 0.7s cubic-bezier(.2,1.4,.4,1) 0.55s both',
                }}
              >
                Wasted
              </span>
            </div>
            <div className="mt-2 bg-black/70 px-3 py-1 text-sm text-fg" style={{ animation: 'tbSub 0.4s ease-out 1.2s both' }}>
              flattened by {wasted.by} · tx {wasted.id.slice(0, 10)}…{wasted.sim ? ' (simulated)' : ''}
            </div>
          </div>
        )}

        {!started && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/55 p-4 text-center">
            <p className="text-4xl font-black text-hot sm:text-6xl" style={{ fontFamily: '"Impact", "Arial Black", sans-serif', WebkitTextStroke: '2px #000', letterSpacing: '0.04em' }}>
              SATOSHI CITY
            </p>
            <p className="max-w-xl bg-black/70 px-3 py-1 text-sm text-fg">
              An island city where every car on the road is a real BSV transaction, live from mainnet. Steal one. Deliver the next block before it&apos;s orphaned.
            </p>
            <div className="grid max-w-xl grid-cols-2 gap-x-4 gap-y-0.5 bg-black/70 px-3 py-2 text-left text-xs text-dim">
              <span className="text-fg">WASD / arrows</span>
              <span>walk · drive</span>
              <span className="text-fg">Mouse</span>
              <span>look (click to lock, Esc to release)</span>
              <span className="text-fg">Shift</span>
              <span>sprint</span>
              <span className="text-fg">Space</span>
              <span>jump · handbrake drift</span>
              <span className="text-fg">F / E</span>
              <span>carjack · get in / out</span>
              <span className="text-fg">T</span>
              <span>open the tx you&apos;re looking at</span>
              <span className="text-fg">H · N</span>
              <span>horn (scatters the sidewalk) · skip to day/night</span>
              <span className="text-fg">R · V</span>
              <span>retune the car radio · cinematic camera</span>
              <span className="text-fg">★ heat</span>
              <span>crimes bring the Miners; break line of sight to lose them</span>
              <span className="text-fg">G</span>
              <span>fullscreen (Esc leaves)</span>
            </div>
            <label className="flex items-center gap-2 bg-black/70 px-3 py-1.5 text-sm text-fg">
              <span className="text-dim">Play as</span>
              <select
                defaultValue={(() => {
                  try {
                    return localStorage.getItem(GIRL_KEY) ?? 'doll';
                  } catch {
                    return 'doll';
                  }
                })()}
                onChange={(e) => control.current?.setGirl(e.target.value)}
                className="bg-black px-2 py-1 text-fg outline outline-1 outline-white/30 focus-visible:outline-2 focus-visible:outline-hot"
              >
                {NPG_GIRLS.map((g) => (
                  <option key={g.slug} value={g.slug}>
                    {g.name}
                    {g.slug === 'doll' ? '' : ` · ${g.team}`}
                  </option>
                ))}
              </select>
            </label>
            <CoinOpButtons
              co={co}
              playLabel="ENTER THE CITY"
              perCredit="1 coin = 1 visit to the city."
              start={(paid) => {
                if (paid && !co.consume()) return;
                ap.setRun(paid);
                runStart.current = Date.now();
                setPost(null);
                setStarted(true);
                control.current?.start();
                if (!loadProgress().seen.includes('prologue')) setCine(CUTSCENES.prologue);
              }}
            />
            <ActionAmmo ap={ap} actions="car stolen, block delivered and rush checkpoint" />
          </div>
        )}

        {cine && <CutscenePlayer scene={cine} onShot={onShot} onDone={endCine} />}

        {/* Touch controls */}
        {started && (
          <>
            <div className="absolute bottom-3 left-3 grid grid-cols-3 gap-1 sm:hidden">
              <span />
              <button className="btn px-4 py-3 text-lg" data-k="up" {...padProps}>
                ▲
              </button>
              <span />
              <button className="btn px-4 py-3 text-lg" data-k="left" {...padProps}>
                ◀
              </button>
              <button className="btn px-4 py-3 text-lg" data-k="down" {...padProps}>
                ▼
              </button>
              <button className="btn px-4 py-3 text-lg" data-k="right" {...padProps}>
                ▶
              </button>
            </div>
            <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1 sm:hidden">
              <button className="btn btn-on px-4 py-3 text-sm font-bold" onPointerDown={() => control.current?.action('f')}>
                F
              </button>
              <div className="flex gap-1">
                <button className="btn px-3 py-3 text-xs" data-k="sprint" {...padProps}>
                  RUN
                </button>
                <button className="btn px-3 py-3 text-xs" data-k="jump" {...padProps}>
                  {hud.driving ? 'DRIFT' : 'JUMP'}
                </button>
              </div>
            </div>
          </>
        )}
        <button onClick={() => control.current?.action('skip')} className="btn absolute bottom-3 left-3 hidden text-xs sm:block">
          ☀/☾ skip
        </button>
      </div>
      <div className="mt-2 flex flex-col items-center">
        <AmmoAlerts ap={ap} />
      </div>
      {started && hud.score > 0 && (
        <div className="mt-2 flex flex-col items-center gap-2">
          {post ? (
            <HighScores game="city" score={post.score} secs={post.secs} live={post.live} txid={ap.lastTx} label="SCORE" />
          ) : (
            <button className="btn text-xs" onClick={() => setPost({ score: hud.score, secs: Math.round((Date.now() - runStart.current) / 100) / 10, live: ap.live })}>
              POST {hud.score.toLocaleString()} PTS TO THE HALL OF FAME
            </button>
          )}
        </div>
      )}
      {co.chooserEl}
      <p className="mt-2 text-xs text-muted">
        Traffic is a live sample of mainnet: each car is one real transaction, kind and size deciding the vehicle (payments are cars, data vans and taxis, inscriptions trucks and
        buses, token transfers box trucks wearing the token&apos;s logo). Look at a car to see its transaction; press T to open it on WhatsOnChain. Parked cars in the car park
        are unspent outputs, free to take.
      </p>
    </section>
  );
}
