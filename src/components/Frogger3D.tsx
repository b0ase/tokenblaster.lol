'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
import { tokenMeta } from '@/lib/tokenMeta';
import { useChainFeed } from '@/lib/useChainFeed';
import { useBlaster } from '@/lib/useBlaster';
import { TOKEN_FEE } from '@/lib/gun';
import { GAME_COINS, houseHeld } from '@/lib/gameCoins';
import { WalletChooser } from './WalletChooser';
import { BuyHouse, HouseBadge } from './HouseAmmo';
import { HighScores, useRunClock } from './HighScores';

/** Where paid moves go: 1 sat per hop / shot to TokenBlaster. The player's gun pays the network fee too. */
const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU' // bCorp's receiving address (public, not a key);
const PER_ACTION = 1;
const EST_FEE = 26; // sats: ~260-byte tx at 100 sat/kB (GorillaPool ARC minimum)
const LOADS = [1_000, 10_000, 100_000];
/** Or pay in the game's own coin: 1 $FROGGER per hop / shot to the house, through the token gun. */
const FROG = GAME_COINS.frogger;
const FROG_LOADS = [10, 100, 1_000];
import { buildGun, GUNS } from '@/lib/arenaHD';
import { GameAudio } from './SoundToggle';
import { sfx, sharedAudio } from '@/lib/sfx';

const CHARS = [
  { id: 'chibi', name: 'NPG Chibi', url: '/arena/models/npg/stack/chibi_base.glb', height: 1.6 },
  { id: 'miyuki', name: 'Miyuki (NPG)', url: '/arena/models/npg/miyuki.glb', height: 1.75 },
  { id: 'minion', name: 'Skeleton', url: '/arena/models/skeleton_minion.glb', height: 1.7, walk: 'Walking_D_Skeletons', idle: 'Idle' },
  { id: 'frog', name: 'Frog (classic)', url: '', height: 0.8 },
] as const;
type CharId = (typeof CHARS)[number]['id'];
const AMMO_PER_CROSSING = 3;

/**
 * Chain Frogger, in 3D: cross a city avenue where every vehicle is a real BSV transaction from
 * mainnet, live. Lane = what it carries; payments are sports cars, inscriptions trucks (bigger tx,
 * bigger truck), token transfers box trucks wearing the token's logo. Glass towers, day and night.
 */
const LANE_W = 3.4;
// One way, like value: every vehicle runs sender → receiver. null = the safe median halfway across.
const LANES: (TxKind | null)[] = ['payment', 'data', 'social', 'inscription', null, 'token', 'payment', 'data', 'social'];
const ROAD_HALF = 70; // vehicles live in x ∈ [-ROAD_HALF, ROAD_HALF]
const START_Z = (LANES.length / 2) * LANE_W + 3; // south sidewalk
const GOAL_Z = -START_Z; // north sidewalk
const DAY_S = 150; // seconds for a full day
const BEST = 'tokenblaster:frogger-best';

const laneZ = (i: number) => (i - (LANES.length - 1) / 2) * LANE_W;
const laneDir = (i: number) => (i >= 0 ? 1 : 1); // every lane: sender (west) → receiver (east)
const ASSETS = '/arcade/frogger';
type ModelKey = 'sports' | 'sedan' | 'cruiser' | 'taxi' | 'van' | 'boxtruck' | 'bus' | 'supercar';
/** Real vehicle models (CC-BY, see public/arena/CREDITS.md). rotY turns the model's nose to +x; paint: recolour the body per vehicle. */
const MODELS: Record<ModelKey, { rotY: number; paint: boolean }> = {
  sports: { rotY: 0, paint: true },
  sedan: { rotY: 0, paint: true },
  cruiser: { rotY: 0, paint: true },
  taxi: { rotY: 0, paint: false },
  van: { rotY: 0, paint: true },
  boxtruck: { rotY: 0, paint: true },
  bus: { rotY: 0, paint: false },
  supercar: { rotY: Math.PI / 2, paint: true },
};
const DECAL_Z = 0.214; // boxtruck cargo-box side, in the 1 m template's units
const NEON = ['BSV', 'MEMPOOL', '24/7', 'HOTEL', 'TOKENS', 'LIQUOR', 'BLOCK 21', "SATOSHI'S", 'PAWN', 'NOODLES', 'CASH', 'SATS'];
const NEON_COLS = ['#ff2d6f', '#28e7ff', '#ffd23f', '#9b5cff', '#3bff8a', '#ff7a1a'];
const PAINTS = ['#d81b2a', '#f2f2f2', '#111216', '#1e5bd8', '#f5b700', '#2bb673', '#8a2be2', '#ff6a00', '#9aa3ad'];

export function Frogger3D() {
  const mount = useRef<HTMLDivElement>(null);
  const feed = useChainFeed();
  const b = useBlaster();
  const [paid, setPaid] = useState(false);
  const [onChain, setOnChain] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [needSats, setNeedSats] = useState(false);
  // Pay per action in sats (default) or in $FROGGER, chosen by the player.
  const [payWith, setPayWith] = useState<'sats' | 'frog'>('sats');
  const frogTok = b.tokens.find((t) => t.id === FROG.id);
  const frogHeld = houseHeld(b.tokens, FROG);
  const payFrog = payWith === 'frog' && b.token?.id === FROG.id && b.mode === 'tokens';
  const chooseFrog = () => {
    if (!frogTok) return;
    b.setToken(frogTok);
    b.setMode('tokens');
    setPayWith('frog');
  };
  const chooseSats = () => {
    b.setMode('sats');
    setPayWith('sats');
  };
  // What the game loop needs to know about paying, without re-running the 3D effect.
  const payRef = useRef({ paid: false, sats: 0, queued: 0, frog: false, tokens: 0 });
  useEffect(() => {
    payRef.current.paid = paid && Boolean(HOUSE);
    payRef.current.sats = b.ammo;
    payRef.current.frog = payFrog;
    payRef.current.tokens = b.tokenAmmo;
  }, [paid, b.ammo, payFrog, b.tokenAmmo]);
  const queue = useRef<string[][]>([]);
  const draining = useRef(false);
  const counter = useRef(0);
  const fireBatchRef = useRef(b.fireBatch);
  const fireTokensRef = useRef(b.fireTokens);
  useEffect(() => {
    fireBatchRef.current = b.fireBatch;
    fireTokensRef.current = b.fireTokens;
  }, [b.fireBatch, b.fireTokens]);
  /** One real transaction per action: tag + 1 sat (or 1 $FROGGER) to the house + the network fee, chained in batches. */
  const drain = useRef(async () => {
    if (draining.current) return;
    draining.current = true;
    while (queue.current.length) {
      const frog = payRef.current.frog;
      const batch = queue.current.slice(0, frog ? 25 : 40);
      try {
        const txids = frog ? await fireTokensRef.current(counter.current + 1, batch, HOUSE) : await fireBatchRef.current(counter.current + 1, batch, { address: HOUSE, sats: PER_ACTION });
        counter.current += txids.length;
        queue.current.splice(0, txids.length);
        payRef.current.queued = queue.current.length;
        setOnChain((n) => n + txids.length);
        if (txids.length) setLastTx(txids[txids.length - 1]);
        setPayErr(null);
        if (!txids.length) throw new Error(frog ? `Out of $${FROG.sym} or fuel: load more to keep moving.` : 'Out of sats: load more to keep moving.');
      } catch (e) {
        setPayErr(e instanceof Error ? e.message : String(e));
        queue.current.length = 0;
        payRef.current.queued = 0;
        break;
      }
    }
    draining.current = false;
  });
  /** Ask to pay for an action; false = can't (empty gun), so the game refuses the move. */
  const payFor = useRef((action: string[]) => {
    const pr = payRef.current;
    if (!pr.paid) return true; // practice mode: free
    const n = pr.queued + 1;
    if (pr.frog ? pr.tokens < n || pr.sats < n * TOKEN_FEE : pr.sats - n * (PER_ACTION + EST_FEE) < 0) {
      setNeedSats(true);
      return false;
    }
    setNeedSats(false);
    queue.current.push(['frogger', ...action]);
    pr.queued = queue.current.length;
    void drain.current();
    return true;
  });
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  });
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [best, setBest] = useState(0);
  const [killer, setKiller] = useState<FeedTx | null>(null);
  const [wasted, setWasted] = useState(false);
  const [partyOn, setParty] = useState<null | { n: number; level: number }>(null);
  const [over, setOver] = useState(false);
  const [started, setStarted] = useState(false);
  const runSecs = useRunClock(started && !over);
  const [clock, setClock] = useState('');
  const control = useRef<{ move: (dx: number, dz: number) => void; restart: () => void; skip: () => void; fire: () => void; setChar: (id: CharId) => void; setWeapon: (i: number) => void } | null>(null);
  const [ammoLeft, setAmmoLeft] = useState(AMMO_PER_CROSSING);
  const [sampledN, setSampled] = useState(0);
  const [char, setCharState] = useState<CharId>('chibi');
  const [weapon, setWeaponState] = useState(0);

  useEffect(() => {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(BEST) ?? 0);
    } catch {
      /* storage blocked */
    }
    void Promise.resolve().then(() => setBest(saved));
  }, []);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // until the HDRI arrives
    scene.environment = roomEnv;
    // Real sky: a Poly Haven city HDRI lights everything (and is the sky by day).
    let hdrSky: THREE.DataTexture | null = null;
    let hdrEnv: THREE.Texture | null = null;
    new HDRLoader().load(`${ASSETS}/tex/potsdamer_platz.hdr`, (t) => {
      if (disposed) return t.dispose();
      t.mapping = THREE.EquirectangularReflectionMapping;
      hdrSky = t;
      hdrEnv = pmrem.fromEquirectangular(t).texture;
      scene.environment = hdrEnv;
      // Own envMap so these can be pushed past the scene level (wet road, mirror glass).
      for (const m of [asphalt, ...towerMats.slice(0, 6)]) {
        m.envMap = hdrEnv;
        m.needsUpdate = true;
      }
    });
    scene.fog = new THREE.Fog('#9fb4c8', 110, 320);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    camera.position.set(0, 7.5, START_Z + 11);
    camera.lookAt(0, 1.2, START_Z - 6);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Ambient occlusion: contact shadows under cars, in corners and kerbs.
    const gtao = new GTAOPass(scene, camera, 512, 512);
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.5, 0.95); // only real lights bloom
    composer.addPass(bloom);
    const deathGrade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, time: { value: 0 }, night: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float amount; uniform float time; uniform float night; varying vec2 vUv;
        float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + time) * 43758.5453); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          // Always-on GTA grade: a touch more saturation, teal shadows / warm highlights, soft vignette.
          vec3 base = mix(vec3(g), c.rgb, 1.12);
          float sh = 1.0 - smoothstep(0.0, 0.35, g);
          base *= mix(vec3(1.0), mix(vec3(0.93, 1.0, 1.06), vec3(0.9, 0.97, 1.12), night), sh);
          base *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.5, 1.5, g) * (1.0 - night));
          base *= mix(1.0, smoothstep(1.05, 0.35, distance(vUv, vec2(0.5))), 0.35);
          g = dot(base, vec3(0.299, 0.587, 0.114));
          vec3 mono = vec3(g) * vec3(1.05, 0.93, 0.9);            // drained, faintly warm-red
          vec3 col = mix(base, mono, amount);
          col = mix(col, (col - 0.5) * 1.25 + 0.45, amount * 0.6); // harsher contrast
          float d = distance(vUv, vec2(0.5));
          col *= mix(1.0, smoothstep(0.85, 0.25, d), amount);       // heavy vignette
          col += (rnd(vUv * 900.0) - 0.5) * 0.07 * amount;          // film grain
          gl_FragColor = vec4(col, c.a);
        }`,
    });
    composer.addPass(deathGrade);
    composer.addPass(new OutputPass());

    // ── Light: sun + sky, driven by the day cycle ──
    const hemi = new THREE.HemisphereLight('#cfe4ff', '#3a2a22', 1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff1dc', 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Tight frustum that follows the player (the sun is re-aimed at them every frame): crisp shadows.
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 260 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    // ── Ground: avenue, sidewalks, crosswalk, lane markings ──
    // Poly Haven CC0 PBR sets: asphalt for the avenue, concrete pavers for the sidewalks.
    const texLoader = new THREE.TextureLoader();
    const pbr = (name: string, rx: number, ry: number) => {
      const load = (suffix: string, srgb: boolean) => {
        const t = texLoader.load(`${ASSETS}/tex/${name}_${suffix}.webp`);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      return { map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false) };
    };
    const roadW = LANES.length * LANE_W;
    const asphalt = new THREE.MeshStandardMaterial({ ...pbr('asphalt_02', (ROAD_HALF * 2 + 60) / 6, roadW / 6), color: '#8a8a8e', roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8) });
    // City ground under everything (plazas, the far side of the blocks).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(800, 800),
      new THREE.MeshStandardMaterial({ ...pbr('concrete_pavement', 160, 160), color: '#77736e', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2 + 60, roadW), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    scene.add(road);
    const walkMat = new THREE.MeshStandardMaterial({ ...pbr('concrete_pavement', (ROAD_HALF * 2 + 60) / 3, 8 / 3), color: '#b8b3ad', roughness: 1 });
    for (const z of [START_Z + 3, GOAL_Z - 3]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 60, 0.25, 6 + 2), walkMat);
      walk.position.set(0, 0.125, z + Math.sign(z) * 1);
      walk.receiveShadow = true;
      scene.add(walk);
    }
    const paint = new THREE.MeshStandardMaterial({ color: '#cfccc2', roughness: 0.7 });
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.6 });
    // Median: a raised planted strip — the one safe place halfway across.
    {
      const mz = laneZ(LANES.indexOf(null));
      const curb = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 60, 0.3, LANE_W - 0.4), new THREE.MeshStandardMaterial({ color: '#7d7a75', roughness: 0.9 }));
      curb.position.set(0, 0.15, mz);
      curb.receiveShadow = true;
      const grass = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 60, 0.32, LANE_W - 1.2), new THREE.MeshStandardMaterial({ color: '#2f5a2a', roughness: 1 }));
      grass.position.set(0, 0.17, mz);
      scene.add(curb, grass);
      // Street trees: trunk + clumped leafy crowns, geometry and materials shared.
      const trunkGeo = new THREE.CylinderGeometry(0.1, 0.16, 2.2, 7);
      const crownGeo = new THREE.IcosahedronGeometry(1, 1);
      const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 });
      const leafMats = ['#2f6a2f', '#3b7a35', '#28592b'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
      for (let x = -ROAD_HALF; x <= ROAD_HALF; x += 9) {
        const tx = x + 4.5;
        if (Math.abs(tx) <= 3) continue;
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(tx, 1.4, mz);
        trunk.castShadow = true;
        scene.add(trunk);
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(crownGeo, leafMats[(k + Math.abs(Math.round(x))) % 3]);
          c.scale.setScalar(0.75 + ((k * 37 + x) % 3) * 0.12);
          c.position.set(tx + (k - 1) * 0.45, 2.9 + (k % 2) * 0.5, mz + (k === 1 ? 0.3 : -0.2));
          c.castShadow = true;
          scene.add(c);
        }
      }
    }
    // Direction of travel: chevrons on every lane, and the two ends named.
    const chevMat = new THREE.MeshStandardMaterial({ color: '#cfccc2', roughness: 0.7 });
    LANES.forEach((k, i) => {
      if (!k) return;
      for (let x = -ROAD_HALF + 10; x < ROAD_HALF; x += 24) {
        const a = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.25), chevMat);
        a.rotation.set(-Math.PI / 2, 0, -Math.PI / 4); // arms meet at the east end: ">" (traffic flows east)
        a.position.set(x, 0.022, laneZ(i) - 0.35);
        const b2 = a.clone();
        b2.rotation.z = Math.PI / 4;
        b2.position.z = laneZ(i) + 0.35;
        scene.add(a, b2);
      }
    });
    const sign = (text: string, x: number) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0f5132';
      g.fillRect(0, 0, 512, 128);
      g.strokeStyle = '#fff';
      g.lineWidth = 6;
      g.strokeRect(6, 6, 500, 116);
      g.fillStyle = '#fff';
      g.font = 'bold 60px sans-serif';
      g.textAlign = 'center';
      g.fillText(text, 256, 84);
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
      sp.position.set(x, 7.5, 0);
      sp.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      scene.add(sp);
    };
    sign('← SENDER', -ROAD_HALF + 4);
    sign('RECEIVER →', ROAD_HALF - 4);
    for (let i = 1; i < LANES.length; i++) {
      if (LANES[i] === null || LANES[i - 1] === null) continue;
      const centre = false;
      for (let x = -ROAD_HALF - 20; x < ROAD_HALF + 20; x += centre ? 200 : 6) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(centre ? 300 : 3, 0.18), centre ? yellow : paint);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, 0.02, (i - LANES.length / 2) * LANE_W);
        scene.add(m);
      }
    }
    // Zebra crossing where you cross: bars along the walking direction, spaced along the road.
    for (let x = -3.6; x <= 3.6; x += 1.2) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.6, roadW - 0.6), paint);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 0.025, 0);
      scene.add(stripe);
    }

    // ── Glass towers with lit windows (shiny by day, glowing at night) ──
    const windowTex = (seed: number) => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const x = c.getContext('2d')!;
      x.fillStyle = '#000';
      x.fillRect(0, 0, 128, 256);
      let r = seed;
      const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
      for (let yy = 4; yy < 256; yy += 10)
        for (let xx = 4; xx < 128; xx += 9) {
          const on = rnd() < 0.42;
          x.fillStyle = on ? (rnd() < 0.5 ? '#ffd9a0' : '#d8ecff') : '#050608';
          x.fillRect(xx, yy, 6, 7);
        }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    };
    // Facades: glass curtain walls plus concrete, brick-red and pale stone blocks, all with lit windows at night.
    const towerMats: THREE.MeshStandardMaterial[] = [];
    const glassTints = ['#5b7a99', '#3d5466', '#7a8fa3', '#2f4a5e', '#8aa0b0', '#4a6070'];
    for (let i = 0; i < 6; i++) {
      towerMats.push(
        new THREE.MeshPhysicalMaterial({
          color: glassTints[i],
          metalness: 0.85,
          roughness: 0.08,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          envMapIntensity: 1.6,
          emissive: '#ffffff',
          emissiveMap: windowTex(i * 977 + 13),
          emissiveIntensity: 0,
        }),
      );
    }
    const solidTints = ['#8d8478', '#6e4a3a', '#b7ad9c', '#56575c', '#9c8f7e'];
    // Same window grid as windowTex, so lit windows line up with the dark panes of the facade.
    const facadeTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const x = c.getContext('2d')!;
      x.fillStyle = '#e4e0d8';
      x.fillRect(0, 0, 128, 256);
      for (let yy = 4; yy < 256; yy += 10) {
        x.fillStyle = '#cfcac0';
        x.fillRect(0, yy + 7, 128, 2);
        for (let xx = 4; xx < 128; xx += 9) {
          x.fillStyle = '#23272e';
          x.fillRect(xx, yy, 6, 7);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    solidTints.forEach((c, i) => {
      towerMats.push(
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.05, map: facadeTex, emissive: '#ffffff', emissiveMap: windowTex(i * 541 + 101), emissiveIntensity: 0 }),
      );
    });
    // Storefront band: shop windows, signs and awnings along the ground floor of the front blocks.
    const shopTex = (() => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 64;
      const x = c.getContext('2d')!;
      x.fillStyle = '#16181c';
      x.fillRect(0, 0, 512, 64);
      const awn = ['#9c1c24', '#1d4f8a', '#2c6b3c', '#c47a12', '#5a2a7a'];
      for (let k = 0; k < 8; k++) {
        const x0 = k * 64 + 4;
        x.fillStyle = k % 3 === 0 ? '#ffe2b0' : k % 3 === 1 ? '#cfe8ff' : '#ffd0e0';
        x.fillRect(x0, 22, 56, 38);
        x.fillStyle = 'rgba(0,0,0,0.35)';
        x.fillRect(x0 + 27, 22, 3, 38);
        x.fillStyle = awn[k % awn.length];
        x.fillRect(x0 - 2, 6, 60, 12);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      return t;
    })();
    const shopMat = new THREE.MeshStandardMaterial({ map: shopTex, emissive: '#ffffff', emissiveMap: shopTex, emissiveIntensity: 0.15, roughness: 0.35, metalness: 0.2 });
    const podiumMat = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.3 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#5d5f63', roughness: 0.8, metalness: 0.4 });
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2020').multiplyScalar(3), toneMapped: false });
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const neonMats: THREE.MeshStandardMaterial[] = [];
    const neonSign = (text: string, col: string) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const x = c.getContext('2d')!;
      x.fillStyle = '#050507';
      x.fillRect(0, 0, 512, 128);
      x.font = 'bold 84px "Arial Black", Impact, sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.shadowColor = col;
      x.shadowBlur = 18;
      x.strokeStyle = col;
      x.lineWidth = 6;
      x.strokeText(text, 256, 68, 480);
      x.fillStyle = '#ffffff';
      x.fillText(text, 256, 68, 480);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.3, roughness: 0.5 });
      neonMats.push(m);
      return m;
    };
    const towers: { m: THREE.Mesh }[] = [];
    const beacons: THREE.Mesh[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let neonI = 0;
    for (const side of [1, -1]) {
      for (let row = 0; row < 3; row++) {
        for (let x = -ROAD_HALF - 30; x < ROAD_HALF + 30; ) {
          const w = 8 + rnd() * 10;
          const d = 8 + rnd() * 10;
          const h = 18 + rnd() * (row === 0 ? 40 : 90);
          const mat = towerMats[Math.floor(rnd() * towerMats.length)];
          const geo = new THREE.BoxGeometry(w, h, d);
          const m = new THREE.Mesh(geo, mat);
          // Window texture repeats with tower size.
          const uv = geo.attributes.uv as THREE.BufferAttribute;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 8), uv.getY(k) * (h / 16));
          // Behind you (south) the blocks start beyond the chase camera so they never fill the view.
          const cx = x + w / 2;
          const cz = side * (START_Z + (side > 0 ? 24 : 12) + row * 22 + rnd() * 6);
          m.position.set(cx, h / 2, cz);
          m.castShadow = row === 0;
          m.receiveShadow = true;
          scene.add(m);
          towers.push({ m });
          const face = cz - side * (d / 2); // the side facing the avenue
          if (row === 0) {
            // Podium with a lit storefront band on the street side.
            const pod = new THREE.Mesh(unitBox, podiumMat);
            pod.scale.set(w + 0.8, 5, d + 0.8);
            pod.position.set(cx, 2.5, cz);
            pod.castShadow = pod.receiveShadow = true;
            const shop = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.2), shopMat);
            shop.geometry.attributes.uv.array.forEach((_, k, arr) => {
              if (k % 2 === 0) (arr as Float32Array)[k] *= w / 10;
            });
            shop.position.set(cx, 1.9, face - side * 0.42);
            shop.rotation.y = side > 0 ? Math.PI : 0;
            scene.add(pod, shop);
            // Every few blocks a neon sign hangs over the street.
            if (rnd() < 0.55) {
              const txt = NEON[neonI % NEON.length];
              const sm = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w - 1, 7), 1.75), neonSign(txt, NEON_COLS[neonI % NEON_COLS.length]));
              sm.position.set(cx, 6.4 + rnd() * 3, face - side * 0.5);
              sm.rotation.y = side > 0 ? Math.PI : 0;
              scene.add(sm);
              neonI++;
            }
          }
          // Rooftop: plant room, AC units, and on the tall ones a mast with a blinking beacon.
          const pr = new THREE.Mesh(unitBox, roofMat);
          pr.scale.set(w * 0.4, 2.2, d * 0.35);
          pr.position.set(cx + (rnd() - 0.5) * w * 0.3, h + 1.1, cz + (rnd() - 0.5) * d * 0.3);
          scene.add(pr);
          for (let k = 0; k < 3; k++) {
            const ac = new THREE.Mesh(unitBox, roofMat);
            ac.scale.set(1.2, 0.9, 1.2);
            ac.position.set(cx + (rnd() - 0.5) * (w - 2), h + 0.45, cz + (rnd() - 0.5) * (d - 2));
            scene.add(ac);
          }
          if (h > 60) {
            const mast = new THREE.Mesh(unitBox, roofMat);
            mast.scale.set(0.25, 9, 0.25);
            mast.position.set(cx, h + 4.5, cz);
            const bc = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), beaconMat);
            bc.position.set(cx, h + 9.1, cz);
            scene.add(mast, bc);
            beacons.push(bc);
          }
          x += w + 2 + rnd() * 4;
        }
      }
    }

    // ── Street lamps (glow at night; light pools faked with emissive heads + bloom) ──
    const lampHeads: THREE.MeshStandardMaterial[] = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2e33', metalness: 0.7, roughness: 0.4 });
    const headMat = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffcf80', emissiveIntensity: 0 });
    lampHeads.push(headMat);
    for (const z of [START_Z + 1.2, GOAL_Z - 1.2]) {
      for (let x = -ROAD_HALF; x <= ROAD_HALF; x += 18) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.5), poleMat);
        pole.position.set(x, 3.25, z);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.6), poleMat);
        arm.position.set(x, 6.4, z - Math.sign(z) * 0.8);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.8), headMat);
        head.position.set(x, 6.3, z - Math.sign(z) * 1.5);
        scene.add(pole, arm, head);
      }
    }
    // A few real lights for night pools near the crossing.
    const nightLights: THREE.PointLight[] = [];
    for (const z of [START_Z - 1, GOAL_Z + 1])
      for (const x of [-12, 12]) {
        const l = new THREE.PointLight('#ffcf80', 0, 24, 1.6);
        l.position.set(x, 6, z);
        scene.add(l);
        nightLights.push(l);
      }

    // ── Vehicles ──
    const glassMat = new THREE.MeshPhysicalMaterial({ color: '#0b0f14', metalness: 0.2, roughness: 0.05, clearcoat: 1 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 1, roughness: 0.25 });
    const headlight = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 0.4 });
    const taillight = new THREE.MeshStandardMaterial({ color: '#550000', emissive: '#ff1a1a', emissiveIntensity: 0.4 });
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 18).rotateX(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.32, 10).rotateX(Math.PI / 2);
    const paintMat = (hex: string) =>
      new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.4 });
    const logoTex = (f: FeedTx) => {
      const meta = f.token ? tokenMeta(f.token) : null;
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 192;
      const x = c.getContext('2d')!;
      x.fillStyle = '#f4f1e8';
      x.fillRect(0, 0, 512, 192);
      x.fillStyle = '#d81b2a';
      x.fillRect(0, 160, 512, 32);
      if (meta?.icon?.complete && meta.icon.naturalWidth) x.drawImage(meta.icon, 16, 16, 128, 128);
      x.fillStyle = '#111';
      x.font = 'bold 54px sans-serif';
      x.fillText(meta ? `$${meta.sym}`.slice(0, 12) : 'BSV-21', 160, 100);
      x.font = '24px monospace';
      x.fillText(f.id.slice(0, 16), 160, 142);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const wheels = (g: THREE.Group, len: number, width: number, axles: number[]) => {
      for (const ax of axles)
        for (const s of [1, -1]) {
          const w = new THREE.Mesh(wheelGeo, tyreMat);
          w.position.set(ax * len, 0.42, (s * width) / 2);
          const r = new THREE.Mesh(rimGeo, rimMat);
          r.position.copy(w.position);
          g.add(w, r);
        }
    };
    // ── Real vehicle models: loaded once, normalised to a 1 m long template (nose +x, wheels on y=0) ──
    type Tpl = { obj: THREE.Group; w: number; h: number };
    const tpls: Partial<Record<ModelKey, Tpl>> = {};
    let modelsReady = false;
    const modelLightMats = new Set<THREE.MeshStandardMaterial>();
    const paintCache = new Map<string, THREE.Material>();
    const vLoader = new GLTFLoader();
    vLoader.setMeshoptDecoder(MeshoptDecoder);
    const prepTemplate = (k: ModelKey, src: THREE.Object3D): Tpl => {
      src.rotation.y = MODELS[k].rotY;
      const root = new THREE.Group();
      root.add(src);
      root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(root, true);
      const len = b.max.x - b.min.x;
      src.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      root.scale.setScalar(1 / len);
      const obj = new THREE.Group();
      obj.add(root);
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (/bodymat/i.test(mat.name) || (k === 'supercar' && /_bod_/.test(m.name))) m.userData.paint = true;
        // The lamp atlas (head and tail lights) glows with its own colours after dark.
        if (mat.name === 'UCB_Lights_and_Glass' && mat.map) {
          mat.emissive = new THREE.Color('#ffffff');
          mat.emissiveMap = mat.map;
          modelLightMats.add(mat);
        }
        if (k === 'supercar' && /_emit_/.test(m.name)) m.material = headlight;
        if (k === 'supercar' && /_remit_/.test(m.name)) m.material = taillight;
      });
      return { obj, w: (b.max.z - b.min.z) / len, h: (b.max.y - b.min.y) / len };
    };
    void Promise.all(
      (Object.keys(MODELS) as ModelKey[]).map((k) =>
        vLoader
          .loadAsync(`${ASSETS}/vehicles/${k}.glb`)
          .then((gl) => {
            if (!disposed) tpls[k] = prepTemplate(k, gl.scene);
          })
          .catch(() => {
            /* that body falls back to the procedural one */
          }),
      ),
    ).then(() => (modelsReady = true));
    const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
    const truckLen = (f: FeedTx) => Math.min(13, 7 + Math.log2(Math.max(2, f.bytes)) * 0.45);
    const pickModel = (f: FeedTx): { k: ModelKey; len: number } => {
      if (f.kind === 'blast') return { k: 'supercar', len: 4.7 };
      if (f.kind === 'token') return { k: 'boxtruck', len: Math.min(9, truckLen(f)) };
      if (f.kind === 'inscription' || (f.kind === 'data' && f.bytes > 2000)) {
        const len = truckLen(f);
        return len > 9.5 ? { k: 'bus', len } : { k: 'boxtruck', len };
      }
      if (f.kind === 'payment') return { k: pick(['sports', 'sports', 'sedan', 'cruiser'] as const), len: 4.5 };
      if (f.kind === 'data') return { k: 'van', len: 5.4 };
      return { k: pick(['sedan', 'cruiser', 'taxi'] as const), len: 4.7 };
    };
    const lampGeo = new THREE.PlaneGeometry(1, 1);
    /** Dress g with a real model for this transaction; false if that model isn't available. */
    const buildModel = (g: THREE.Group, f: FeedTx) => {
      const { k, len } = pickModel(f);
      const tpl = tpls[k];
      if (!tpl) return false;
      const v = tpl.obj.clone(true);
      v.scale.setScalar(len);
      const hex = f.kind === 'blast' ? '#f4f4f4' : f.kind === 'inscription' ? pick(['#c8c2b8', '#e9e6df', '#9aa3ad']) : pick(PAINTS);
      if (MODELS[k].paint)
        v.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.userData.paint) return;
          const key = `${k}|${hex}`;
          let pm = paintCache.get(key);
          if (!pm) {
            const c = (m.material as THREE.MeshStandardMaterial).clone();
            c.color.set(hex);
            if (k === 'supercar') {
              c.map = null;
              c.metalness = 0.55;
              c.roughness = 0.22;
            }
            pm = c;
            paintCache.set(key, pm);
          }
          m.material = pm;
        });
      // Lamps for bodies without a lamp atlas (bus): small emissive quads front and rear.
      if (k === 'bus') {
        for (const s of [1, -1]) {
          const hl = new THREE.Mesh(lampGeo, headlight);
          hl.scale.set(0.035, 0.018, 1);
          hl.rotation.y = Math.PI / 2;
          hl.position.set(0.502, tpl.h * 0.14, s * tpl.w * 0.36);
          const tl = new THREE.Mesh(lampGeo, taillight);
          tl.scale.set(0.02, 0.03, 1);
          tl.rotation.y = -Math.PI / 2;
          tl.position.set(-0.502, tpl.h * 0.2, s * tpl.w * 0.4);
          v.add(hl, tl);
        }
      }
      // Token box trucks wear the token's logo on both sides of the cargo box.
      if (f.kind === 'token') {
        const dm = new THREE.MeshStandardMaterial({ map: logoTex(f), roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2 });
        for (const s of [1, -1]) {
          const d = new THREE.Mesh(lampGeo, dm);
          d.scale.set(0.6, 0.24, 1);
          d.position.set(-0.14, 0.32, s * DECAL_Z);
          d.rotation.y = s > 0 ? 0 : Math.PI;
          v.add(d);
        }
        g.userData.decal = dm;
      }
      g.add(v);
      g.userData.len = len;
      return true;
    };
    /** A vehicle for a transaction: kind picks the body, size picks the length. */
    const makeVehicle = (f: FeedTx, lane: number) => {
      const g = new THREE.Group();
      const kind: TxKind = f.kind;
      const truck = kind === 'inscription' || kind === 'token' || (kind === 'data' && f.bytes > 2000);
      const blast = kind === 'blast';
      if (buildModel(g, f)) {
        // a real model (falls through to the procedural bodies below if it failed to load)
      } else if (truck) {
        const len = Math.min(13, 7 + Math.log2(Math.max(2, f.bytes)) * 0.45);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.3), paintMat(PAINTS[Math.floor(Math.random() * PAINTS.length)]));
        cab.position.set(len / 2 - 1.1, 1.7, 0);
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(len - 2.6, 3, 2.4),
          kind === 'token'
            ? [new THREE.MeshStandardMaterial({ color: '#eee' }), new THREE.MeshStandardMaterial({ color: '#eee' }), new THREE.MeshStandardMaterial({ color: '#ddd' }), new THREE.MeshStandardMaterial({ color: '#ddd' }), new THREE.MeshStandardMaterial({ map: logoTex(f), roughness: 0.4 }), new THREE.MeshStandardMaterial({ map: logoTex(f), roughness: 0.4 })]
            : new THREE.MeshStandardMaterial({ color: kind === 'inscription' ? '#c8c2b8' : '#9aa3ad', roughness: 0.5, metalness: 0.3 }),
        );
        // Box truck: logo panels face the sides (±z after the group turns along x).
        box.rotation.y = kind === 'token' ? Math.PI / 2 : 0;
        if (kind === 'token') box.geometry = new THREE.BoxGeometry(2.4, 3, len - 2.6);
        box.position.set(-1.2, 2, 0);
        const ws = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 2), glassMat);
        ws.position.set(len / 2 - 0.02, 2.2, 0);
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.5), headlight);
        hl.position.set(len / 2, 1, 0.75);
        const hr = hl.clone();
        hr.position.z = -0.75;
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, 0.4), taillight);
        tl.position.set(-len / 2 + 0.05, 1, 0.9);
        const tr = tl.clone();
        tr.position.z = -0.9;
        g.add(cab, box, ws, hl, hr, tl, tr);
        wheels(g, len / 2, 2.2, [0.75, -0.55, -0.75]);
        g.userData.len = len;
      } else {
        // Sports car / hatch / van silhouette.
        const len = kind === 'payment' || blast ? 4.6 : kind === 'data' ? 5.2 : 4.2;
        const low = kind === 'payment' || blast;
        const body = new THREE.Mesh(new THREE.BoxGeometry(len, low ? 0.75 : 1.1, 2), paintMat(blast ? '#ffffff' : PAINTS[Math.floor(Math.random() * PAINTS.length)]));
        body.position.y = low ? 0.62 : 0.8;
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(len * (low ? 0.45 : kind === 'data' ? 0.7 : 0.55), low ? 0.55 : 0.85, 1.75), glassMat);
        cabin.position.set(low ? -0.3 : -0.2, low ? 1.25 : 1.75, 0);
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.5), headlight);
        hl.position.set(len / 2, body.position.y, 0.6);
        const hr = hl.clone();
        hr.position.z = -0.6;
        const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 1.6), taillight);
        tl.position.set(-len / 2, body.position.y + 0.1, 0);
        g.add(body, cabin, hl, hr, tl);
        if (low) {
          const wing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 1.9), body.material);
          wing.position.set(-len / 2 + 0.2, 1.15, 0);
          g.add(wing);
        }
        wheels(g, len / 2, 1.9, [0.65, -0.65]);
        g.userData.len = len;
      }
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const dir = laneDir(lane);
      g.rotation.y = dir > 0 ? 0 : Math.PI;
      g.position.set(dir > 0 ? -ROAD_HALF : ROAD_HALF, 0, laneZ(lane));
      scene.add(g);
      return g;
    };
    type Veh = { g: THREE.Group; f: FeedTx; lane: number; speed: number; len: number; stalled?: number };
    const vehicles: Veh[] = [];
    let level = 1;
    const laneSpeed = (i: number) => (8 + (i % 3) * 3.5 + (i % 2) * 1.5) * (1 + (level - 1) * 0.1);
    const nextAt = LANES.map(() => 0); // per-lane spawn cooldown
    let sampled = 0;

    // ── Player: pick a character (NPG chibi, Miyuki, skeleton, classic frog) and a weapon ──
    const player = new THREE.Group();
    scene.add(player);
    let mixer: THREE.AnimationMixer | null = null;
    let walkAct: THREE.AnimationAction | null = null;
    let idleAct: THREE.AnimationAction | null = null;
    let body: THREE.Object3D | null = null;
    let gunObj: THREE.Object3D | null = null;
    let gunMuzzle = new THREE.Vector3(0, 1, 0.8);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const fitTo = (model: THREE.Object3D, height: number) => {
      model.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(model, true);
      const s = height / Math.max(0.01, b.max.y - b.min.y);
      model.scale.multiplyScalar(s);
      model.position.y = -b.min.y * s;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
        }
      });
    };
    const frogModel = () => {
      const g = new THREE.Group();
      const skin = new THREE.MeshPhysicalMaterial({ color: '#3fbf3f', roughness: 0.35, clearcoat: 0.8 });
      const bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), skin);
      bodyM.scale.set(1, 0.7, 1.2);
      bodyM.position.y = 0.32;
      const eyeW = new THREE.MeshStandardMaterial({ color: '#fff' });
      const eyeB = new THREE.MeshStandardMaterial({ color: '#111' });
      for (const sx of [-0.18, 0.18]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), eyeW);
        e.position.set(sx, 0.62, 0.22);
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), eyeB);
        p.position.set(sx, 0.64, 0.32);
        g.add(e, p);
      }
      for (const sx of [-0.35, 0.35]) {
        const leg = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skin);
        leg.scale.set(1, 0.5, 1.6);
        leg.position.set(sx, 0.12, -0.1);
        g.add(leg);
      }
      g.add(bodyM);
      g.traverse((o) => (o as THREE.Mesh).isMesh && (o.castShadow = true));
      return g;
    };
    let charId: CharId = 'chibi';
    let weaponIdx = 0; // index into GUNS; -1 = unarmed
    const attachGun = () => {
      if (gunObj) gunObj.parent?.remove(gunObj);
      gunObj = null;
      if (weaponIdx < 0 || !body) return;
      const def = GUNS[weaponIdx];
      loader.load(def.url, (gl) => {
        if (disposed || !body) return;
        const held = buildGun(def, gl); // barrel down −Z, ~1 m long
        const g = held.group;
        g.scale.multiplyScalar(charId === 'frog' ? 0.55 : 0.7);
        g.rotation.y = Math.PI; // the characters face +Z
        g.position.set(charId === 'frog' ? 0 : 0.32, charId === 'frog' ? 0.55 : 0.85, charId === 'frog' ? 0.35 : 0.25);
        player.add(g);
        gunObj = g;
        gunMuzzle = new THREE.Vector3(g.position.x, g.position.y + 0.05, g.position.z + 0.75);
      });
    };
    const loadChar = (id: CharId) => {
      charId = id;
      if (body) player.remove(body);
      body = null;
      mixer = null;
      walkAct = idleAct = null;
      const def = CHARS.find((c) => c.id === id)!;
      if (!def.url) {
        body = frogModel();
        player.add(body);
        attachGun();
        return;
      }
      loader.load(def.url, (gl) => {
        if (disposed || charId !== id) return;
        const clips = id === 'chibi' ? chibiClips(gl.scene) : gl.animations;
        const model = cloneSkinned(gl.scene);
        fitTo(model, def.height);
        player.add(model);
        body = model;
        mixer = new THREE.AnimationMixer(model);
        const walkName = 'walk' in def ? def.walk : 'walk';
        const idleName = 'idle' in def ? def.idle : 'idle';
        const w = clips.find((c) => c.name === walkName);
        const i = clips.find((c) => c.name === idleName);
        walkAct = w ? mixer.clipAction(w) : null;
        idleAct = i ? mixer.clipAction(i) : null;
        idleAct?.play();
        attachGun();
      });
    };
    loadChar('chibi');

    // ── Game state ──
    const STEP = LANE_W;
    let pos = new THREE.Vector3(0, 0, START_Z);
    let target = pos.clone();
    let heading = Math.PI; // facing north (−z)
    let pts = 0;
    let lifeLeft = 3;
    let dead = 0;
    let fling: { v: THREE.Vector3; spin: number } | null = null;
    let dayT = 0.32; // start mid-morning
    let ammo = AMMO_PER_CROSSING;
    let party = 0; // time the crossing party started (0 = none)
    const confettiN = 420;
    const confGeo = new THREE.PlaneGeometry(0.16, 0.08);
    const confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    const confetti = new THREE.InstancedMesh(confGeo, confMat, confettiN);
    confetti.visible = false;
    confetti.frustumCulled = false;
    const confState = Array.from({ length: confettiN }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
    const PARTY_COLS = ['#ff3b5c', '#ffd23f', '#3bceac', '#4d7cff', '#ff8a00', '#c64dff', '#ffffff'].map((c) => new THREE.Color(c).multiplyScalar(1.6));
    for (let i = 0; i < confettiN; i++) confetti.setColorAt(i, PARTY_COLS[i % PARTY_COLS.length]);
    scene.add(confetti);
    const sparkGeo = new THREE.SphereGeometry(0.09, 6, 4);
    type Spark = { m: THREE.Mesh; v: THREE.Vector3; born: number; life: number };
    const sparks: Spark[] = [];
    const rockets: { m: THREE.Mesh; v: THREE.Vector3; at: number; col: THREE.Color }[] = [];
    const fanfare = () => {
      try {
        const sa = sharedAudio(); // shared context + sfx bus: global mute / volume
        if (!sa) return;
        const audio = sa.ctx;
        const t0 = audio.currentTime;
        [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => {
          const o = audio!.createOscillator();
          const g = audio!.createGain();
          o.type = i < 4 ? 'square' : 'triangle';
          o.frequency.value = f;
          const t = t0 + i * 0.11 + (i > 3 ? 0.08 : 0);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 5 ? 0.6 : 0.16));
          o.connect(g).connect(sa.out);
          o.start(t);
          o.stop(t + 0.7);
        });
      } catch {
        /* no audio */
      }
    };
    const startParty = (at: THREE.Vector3) => {
      party = performance.now();
      confetti.visible = true;
      confState.forEach((c) => {
        c.p.set(at.x + (Math.random() - 0.5) * 6, 7 + Math.random() * 5, at.z + (Math.random() - 0.5) * 6);
        c.v.set((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4);
        c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        c.w.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      });
      for (let k = 0; k < 5; k++) {
        const col = PARTY_COLS[k % PARTY_COLS.length].clone();
        const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
        m.position.set(at.x + (k - 2) * 7 + (Math.random() - 0.5) * 3, 0.5, at.z - 6 - Math.random() * 8);
        scene.add(m);
        rockets.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 2, 18 + Math.random() * 6, 0), at: performance.now() + k * 260, col });
      }
      fanfare();
    };
    // Mouse look: move over the scene to look around the street; wheel to zoom.
    const look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, dist: 11, tDist: 11 };
    const onLook = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = renderer.domElement.getBoundingClientRect();
      look.tYaw = ((e.clientX - r.left) / r.width - 0.5) * 2.4; // up to ±70°
      look.tPitch = ((e.clientY - r.top) / r.height - 0.5) * 0.9;
    };
    const onLeave = () => {
      look.tYaw = 0;
      look.tPitch = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      look.tDist = Math.max(5, Math.min(26, look.tDist + e.deltaY * 0.01));
    };
    renderer.domElement.addEventListener('pointermove', onLook);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    const zaps: { line: THREE.Line; spark: THREE.Mesh; born: number }[] = [];
    const zapMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#7ad7ff').multiplyScalar(4), toneMapped: false });
    const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fe4ff').multiplyScalar(3), toneMapped: false, transparent: true });
    const fire = () => {
      if (dead || lifeLeft <= 0 || weaponIdx < 0 || ammo <= 0) return;
      if (!payFor.current(['zap', GUNS[weaponIdx]?.id ?? 'gun'])) return; // 1 sat per shot
      // The vehicle bearing down on the next lane you step into (or the one you're in).
      const ahead = vehicles
        .filter((v) => !v.stalled && v.g.position.z < pos.z + 0.5 && v.g.position.z > pos.z - LANE_W * 1.6 && v.g.position.x < pos.x + v.len)
        .sort((a, b) => b.g.position.x - a.g.position.x)[0];
      ammo--;
      setAmmoLeft(ammo);
      const from = player.localToWorld(gunMuzzle.clone());
      const to = ahead ? ahead.g.position.clone().setY(1.2) : from.clone().add(new THREE.Vector3(0, 0, -20).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y + Math.PI));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), zapMat);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(ahead ? 1.4 : 0.3, 12, 10), sparkMat);
      spark.position.copy(to);
      scene.add(line, spark);
      zaps.push({ line, spark, born: performance.now() });
      sfx('laser');
      if (ahead) sfx('hit');
      if (ahead) ahead.stalled = performance.now(); // shorted out: it stops dead for a few seconds
    };
    const setChar = (id: CharId) => loadChar(id);
    const setWeapon = (i: number) => {
      weaponIdx = i;
      attachGun();
    };
    const move = (dx: number, dz: number) => {
      if (lifeLeft <= 0 || dead || party) return;
      if (!payFor.current(['hop', dz < 0 ? 'n' : dz > 0 ? 's' : dx < 0 ? 'w' : 'e'])) return; // 1 sat per hop
      setStarted(true);
      target = new THREE.Vector3(Math.max(-ROAD_HALF + 6, Math.min(ROAD_HALF - 6, target.x + dx * STEP)), 0, Math.max(GOAL_Z, Math.min(START_Z, target.z + dz * STEP)));
      heading = Math.atan2(dx, dz);
      sfx('jump', 0.6);
    };
    const restart = () => {
      pts = 0;
      lifeLeft = 3;
      level = 1;
      pos = new THREE.Vector3(0, 0, START_Z);
      target = pos.clone();
      setScore(0);
      setLives(3);
      setOver(false);
      setKiller(null);
    };
    const skip = () => (dayT = (dayT + 0.5) % 1);
    control.current = { move, restart, skip, fire, setChar, setWeapon };
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      const d = k === 'ArrowUp' || k === 'w' ? [0, -1] : k === 'ArrowDown' || k === 's' ? [0, 1] : k === 'ArrowLeft' || k === 'a' ? [-1, 0] : k === 'ArrowRight' || k === 'd' ? [1, 0] : null;
      if (k === ' ' || k === 'f' || k === 'Enter') {
        e.preventDefault();
        return fire();
      }
      if (!d) return;
      e.preventDefault();
      move(d[0], d[1]);
    };
    window.addEventListener('keydown', key);

    // Night rain: streaks around the camera (cheap line segments), part of the wet-street look.
    const RAIN_N = 1400;
    const rainPos = new Float32Array(RAIN_N * 6);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    const rainMat = new THREE.LineBasicMaterial({ color: '#aac4dd', transparent: true, opacity: 0, depthWrite: false });
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    rain.visible = false;
    scene.add(rain);
    const rainSeed = Array.from({ length: RAIN_N }, () => [Math.random() * 60 - 30, Math.random() * 30, Math.random() * 60 - 30]);
    const sky = new THREE.Color();
    const DAY = new THREE.Color('#8fb8e8');
    const DUSK = new THREE.Color('#e8845a');
    const NIGHT = new THREE.Color('#05070f');
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const realDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Slow motion while you're down: the world crawls, the camera and the grade don't.
      const dt = dead ? realDt * 0.28 : realDt;
      const want = dead ? 1 : 0;
      deathGrade.uniforms.amount.value += (want - deathGrade.uniforms.amount.value) * Math.min(1, realDt * (dead ? 5 : 3));
      deathGrade.uniforms.time.value = now / 1000;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const sz = renderer.getSize(new THREE.Vector2());
      if (sz.x !== w || sz.y !== h) {
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }

      // Day cycle: sun arc, sky colour, windows and lamps by night.
      dayT = (dayT + dt / DAY_S) % 1;
      const ang = dayT * Math.PI * 2 - Math.PI / 2; // 0.25 = noon
      const elev = Math.sin(ang);
      sun.position.set(pos.x + Math.cos(ang) * 120, Math.max(5, elev * 140), pos.z + 60);
      sun.target.position.set(pos.x, 0, pos.z);
      const night = THREE.MathUtils.clamp(-elev * 3 + 0.2, 0, 1);
      const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1);
      sky.copy(DAY).lerp(DUSK, dusk * 0.8).lerp(NIGHT, night);
      // By day the HDRI is the sky; once the light goes the old graded sky colour takes over.
      if (hdrSky && night < 0.55) {
        scene.background = hdrSky;
        scene.backgroundIntensity = Math.max(0.08, 1 - night * 1.6) * (1 - dusk * 0.35);
      } else scene.background = sky;
      (scene.fog as THREE.Fog).color.copy(sky);
      scene.environmentIntensity = 0.12 + 0.88 * (1 - night);
      deathGrade.uniforms.night.value = night;
      // Wet asphalt after dark: glossier, more reflective, a shade darker.
      asphalt.roughness = 1 - night * 0.62;
      asphalt.envMapIntensity = 0.9 - night * 0.45;
      asphalt.color.setScalar(0.26 - night * 0.1);
      rain.visible = night > 0.45;
      if (rain.visible) {
        rainMat.opacity = (night - 0.45) * 0.45;
        const fall = (now / 1000) * 22;
        for (let i = 0; i < RAIN_N; i++) {
          const r = rainSeed[i];
          const y = 30 - ((r[1] + fall) % 30);
          const x = camera.position.x + r[0];
          const z = camera.position.z + r[2];
          rainPos.set([x, y, z, x + 0.06, y - 0.7, z], i * 6);
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
      for (const m of modelLightMats) m.emissiveIntensity = 0.15 + night * 1.6;
      for (const m of neonMats) m.emissiveIntensity = 0.3 + night * 1.3;
      shopMat.emissiveIntensity = 0.2 + night * 0.45;
      const blink = night > 0.3 && Math.floor(now / 700) % 2 === 0;
      for (const b of beacons) b.visible = blink;
      sun.intensity = 3.2 * (1 - night);
      sun.color.set(dusk > 0.4 ? '#ffb27a' : '#fff1dc');
      hemi.intensity = 0.12 + 0.6 * (1 - night);
      renderer.toneMappingExposure = 0.8 - night * 0.15;
      for (const m of towerMats) {
        m.emissiveIntensity = night * 0.55;
        m.envMapIntensity = 0.15 + 1.45 * (1 - night);
      }
      headMat.emissiveIntensity = night * 3;
      headlight.emissiveIntensity = 0.3 + night * 2.5;
      taillight.emissiveIntensity = 0.3 + night * 2;
      for (const l of nightLights) l.intensity = night * 14;
      bloom.strength = 0.05 + night * 0.4;
      const hrs = (dayT * 24 + 6) % 24;
      if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) setClock(`${String(Math.floor(hrs)).padStart(2, '0')}:${String(Math.floor((hrs % 1) * 60)).padStart(2, '0')}`);

      // Spawn: each lane takes the next live transaction of its kind when its entry is clear.
      LANES.forEach((kind, i) => {
        if (!kind || !modelsReady || now < nextAt[i]) return;
        const dir = laneDir(i);
        const entry = vehicles.filter((v) => v.lane === i).reduce((m, v) => Math.min(m, dir > 0 ? v.g.position.x + ROAD_HALF - v.len / 2 : ROAD_HALF - v.g.position.x - v.len / 2), Infinity);
        const minGap = Math.max(9, 26 - level * 2); // room to cross; tightens as you level up
        if (entry < minGap) return;
        // This lane's kind if one is waiting; after a dry spell, any live tx keeps the road moving.
        const f = feedRef.current.take((t) => t.kind === kind || (kind === 'payment' && t.kind === 'blast')) ?? (now - nextAt[i] > 6000 ? feedRef.current.take() : null);
        if (!f) return;
        sampled++;
        nextAt[i] = now + (1200 + Math.random() * 2600) / (1 + (level - 1) * 0.15);
        const g = makeVehicle(f, i);
        vehicles.push({ g, f, lane: i, speed: laneSpeed(i) * (0.85 + Math.random() * 0.3), len: g.userData.len });
      });
      for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i];
        // Keep a gap to the vehicle ahead (no clipping through each other).
        const dir = laneDir(v.lane);
        const ahead = vehicles.filter((o) => o !== v && o.lane === v.lane && (o.g.position.x - v.g.position.x) * dir > 0);
        const gap = ahead.reduce((m, o) => Math.min(m, Math.abs(o.g.position.x - v.g.position.x) - (o.len + v.len) / 2), Infinity);
        const stalled = v.stalled && now - v.stalled < 3500;
        const sp = stalled ? 0 : gap < 3 ? Math.min(v.speed, (ahead.find((o) => Math.abs(o.g.position.x - v.g.position.x) - (o.len + v.len) / 2 === gap)?.speed ?? v.speed)) : v.speed;
        v.g.position.x += dir * sp * dt;
        if (Math.abs(v.g.position.x) > ROAD_HALF + 20) {
          scene.remove(v.g);
          const dm = v.g.userData.decal as THREE.MeshStandardMaterial | undefined;
          dm?.map?.dispose();
          dm?.dispose();
          vehicles.splice(i, 1);
        }
      }

      // Player: glide to the target cell, walk while moving.
      if (!dead) {
        const toGo = target.clone().sub(pos);
        const moving = toGo.length() > 0.05;
        pos.addScaledVector(toGo, Math.min(1, dt * 9));
        if (walkAct && idleAct) {
          if (moving && !walkAct.isRunning()) {
            walkAct.reset().play();
            idleAct.crossFadeTo(walkAct, 0.12, false);
          } else if (!moving && walkAct.isRunning() && walkAct.getEffectiveWeight() > 0.5) {
            idleAct.reset().play();
            walkAct.crossFadeTo(idleAct, 0.2, false);
            setTimeout(() => walkAct?.stop(), 220);
          }
        }
        player.position.copy(pos);
        if (charId === 'frog' && body) body.position.y = moving ? Math.abs(Math.sin(now / 90)) * 0.35 : 0;
        player.rotation.set(0, THREE.MathUtils.lerp(player.rotation.y, heading, Math.min(1, dt * 12)), 0);
        // Crossed?
        if (!party && target.z <= GOAL_Z + 0.01 && pos.z <= GOAL_Z + 0.2) {
          pts++;
          level = 1 + Math.floor(pts / 3);
          setScore(pts);
          try {
            if (pts > Number(localStorage.getItem(BEST) ?? 0)) {
              localStorage.setItem(BEST, String(pts));
              setBest(pts);
            }
          } catch {
            /* storage blocked */
          }
          ammo = AMMO_PER_CROSSING;
          setAmmoLeft(ammo);
          setParty({ n: pts, level });
          startParty(pos.clone());
          target = pos.clone().setZ(GOAL_Z - 0.01); // hold on the far curb while the party runs
        }
        // Hit?
        const hit = !party && vehicles.find((v) => Math.abs(v.g.position.z - pos.z) < LANE_W * 0.45 && Math.abs(v.g.position.x - pos.x) < v.len / 2 + 0.35);
        if (hit) {
          dead = now;
          lifeLeft--;
          sfx('rekt');
          setLives(lifeLeft);
          setKiller(hit.f);
          setWasted(true);
          fling = { v: new THREE.Vector3(laneDir(hit.lane) * hit.speed * 0.6, 9, (Math.random() - 0.5) * 4), spin: 12 };
        }
      } else if (fling) {
        fling.v.y -= 22 * dt;
        player.position.addScaledVector(fling.v, dt);
        player.rotation.x += fling.spin * dt;
        player.rotation.z += fling.spin * 0.6 * dt;
        if (player.position.y < 0) {
          player.position.y = 0;
          fling.v.multiplyScalar(0.3);
          fling.v.y = Math.abs(fling.v.y) * 0.3;
        }
        if (now - dead > 3400) {
          dead = 0;
          fling = null;
          setWasted(false);
          if (lifeLeft <= 0) {
            setOver(true);
            sfx('gameover');
          }
          pos = new THREE.Vector3(0, 0, START_Z);
          target = pos.clone();
          player.rotation.set(0, Math.PI, 0);
        }
      }
      mixer?.update(dt);
      if (party) {
        const t = (now - party) / 1000;
        // Victory dance: hop and spin.
        player.position.y = Math.abs(Math.sin(t * 9)) * 0.5;
        player.rotation.y += realDt * 9;
        const tmp = new THREE.Object3D();
        confState.forEach((c, i) => {
          c.v.y -= 3.2 * realDt;
          c.v.multiplyScalar(0.985);
          c.p.addScaledVector(c.v, realDt);
          c.r.x += c.w.x * realDt;
          c.r.y += c.w.y * realDt;
          tmp.position.copy(c.p);
          tmp.rotation.copy(c.r);
          tmp.updateMatrix();
          confetti.setMatrixAt(i, tmp.matrix);
        });
        confetti.instanceMatrix.needsUpdate = true;
        if (t > 2.8) {
          party = 0;
          confetti.visible = false;
          setParty(null);
          player.position.y = 0;
          pos = new THREE.Vector3(pos.x, 0, START_Z);
          target = pos.clone();
          player.rotation.set(0, Math.PI, 0);
        }
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        if (now < r.at) continue;
        r.v.y -= 14 * realDt;
        r.m.position.addScaledVector(r.v, realDt);
        if (r.v.y < 2) {
          // Burst.
          for (let k = 0; k < 46; k++) {
            const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: r.col, toneMapped: false, transparent: true }));
            m.position.copy(r.m.position);
            const d = new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 4);
            scene.add(m);
            sparks.push({ m, v: d, born: now, life: 1100 + Math.random() * 500 });
          }
          scene.remove(r.m);
          rockets.splice(i, 1);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        const age = now - sp.born;
        sp.v.y -= 6 * realDt;
        sp.v.multiplyScalar(0.97);
        sp.m.position.addScaledVector(sp.v, realDt);
        (sp.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - age / sp.life);
        if (age > sp.life) {
          scene.remove(sp.m);
          (sp.m.material as THREE.Material).dispose();
          sparks.splice(i, 1);
        }
      }
      for (let i = zaps.length - 1; i >= 0; i--) {
        const z = zaps[i];
        const age = now - z.born;
        sparkMat.opacity = Math.max(0, 1 - age / 400);
        z.spark.scale.setScalar(1 + age / 300);
        if (age > 400) {
          scene.remove(z.line, z.spark);
          zaps.splice(i, 1);
        }
      }
      for (const v of vehicles) if (v.stalled) v.g.position.y = now - v.stalled < 3500 ? Math.sin(now / 30) * 0.03 : 0;
      if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) setSampled(sampled);

      // GTA-style chase camera: behind and above, looking across the avenue.
      if (dead) {
        const t = (now - dead) / 1000;
        const a = 0.6 + t * 0.35; // slow orbit
        const camGoal = new THREE.Vector3(player.position.x + Math.sin(a) * 7, 3.2 + t * 0.4, player.position.z + Math.cos(a) * 7);
        camera.position.lerp(camGoal, Math.min(1, realDt * 2));
        camera.lookAt(player.position.x, 0.8, player.position.z);
      } else {
        look.yaw += (look.tYaw - look.yaw) * Math.min(1, realDt * 5);
        look.pitch += (look.tPitch - look.pitch) * Math.min(1, realDt * 5);
        look.dist += (look.tDist - look.dist) * Math.min(1, realDt * 6);
        // Orbit behind the player by the mouse: yaw swings round the street, pitch raises/lowers.
        const yaw = look.yaw + (party ? Math.PI * 0.85 : 0);
        const camGoal = new THREE.Vector3(
          player.position.x + Math.sin(yaw) * look.dist,
          Math.max(1.6, 7.5 * (look.dist / 11) - look.pitch * 6),
          player.position.z + Math.cos(yaw) * look.dist,
        );
        camera.position.lerp(camGoal, Math.min(1, realDt * 3));
        const ahead = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(party ? 0 : 6);
        camera.lookAt(player.position.x + ahead.x, 1.2 + look.pitch * 3, player.position.z + ahead.z);
      }

      composer.render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let touch: { x: number; y: number } | null = null;
    const ts = (e: TouchEvent) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY });
    const te = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x;
      const dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) move(0, -1);
      else if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx), 0);
      else move(0, Math.sign(dy));
      touch = null;
    };
    renderer.domElement.addEventListener('touchstart', ts, { passive: true });
    renderer.domElement.addEventListener('touchend', te);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('touchstart', ts);
      renderer.domElement.removeEventListener('pointermove', onLook);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('touchend', te);
      composer.dispose();
      gtao.dispose();
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
      for (const tpl of Object.values(tpls))
        tpl?.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry.dispose();
          for (const v of Object.values(m.material as THREE.Material)) if (v instanceof THREE.Texture) textures.add(v);
          (m.material as THREE.Material).dispose();
        });
      for (const t of textures) t.dispose();
      hdrSky?.dispose();
      hdrEnv?.dispose();
      roomEnv.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const meta = killer?.token ? tokenMeta(killer.token) : null;
  const killerMeta = meta;
  return (
    <section className="panel game-root">
      <GameAudio track="frogger" />
      <div className="panel-header">
        <span className="panel-title">Chain Frogger</span>
        <span className="text-accent">
          {feed.status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE MAINNET TRAFFIC
            </>
          ) : feed.status === 'off' ? (
            'no feed configured'
          ) : (
            'connecting to the chain…'
          )}
        </span>
      </div>
      <div className="game-stage relative">
        <div ref={mount} className="game-fill inset h-[72vh] min-h-96 w-full touch-none overflow-hidden" />
        <div className="pointer-events-none absolute right-3 top-3 text-right font-bold text-hot drop-shadow">
          <div className="text-2xl">{clock}</div>
          <div className="text-sm">{'♥'.repeat(Math.max(0, lives))}</div>
          {weapon >= 0 && <div className="text-sm">⚡ {'▮'.repeat(ammoLeft)}{'▯'.repeat(Math.max(0, AMMO_PER_CROSSING - ammoLeft))}</div>}
        </div>
        <button onClick={() => control.current?.skip()} className="btn absolute left-3 top-3 text-xs">
          ☀/☾ skip
        </button>
        {partyOn && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <style>{`
              @keyframes tbPop { 0% { transform: scale(0.2) rotate(-12deg); opacity: 0 } 60% { transform: scale(1.15) rotate(3deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
              @keyframes tbHue { from { filter: hue-rotate(0deg) } to { filter: hue-rotate(360deg) } }
            `}</style>
            <span
              className="font-black uppercase"
              style={{
                fontFamily: '"Impact", "Arial Black", sans-serif',
                fontSize: 'clamp(54px, 10vw, 120px)',
                color: '#ffd23f',
                WebkitTextStroke: '3px #000',
                textShadow: '0 0 30px rgba(255,210,63,0.7), 0 6px 0 #000',
                animation: 'tbPop 0.55s cubic-bezier(.2,1.5,.4,1) both, tbHue 1.2s linear infinite',
              }}
            >
              Crossed!
            </span>
            <span className="mt-2 bg-black/70 px-3 py-1 text-lg font-bold text-hot" style={{ animation: 'tbPop 0.5s ease-out 0.25s both' }}>
              crossing #{partyOn.n} · level {partyOn.level}
              {partyOn.n > 1 && partyOn.n === best ? ' · NEW BEST!' : ''}
            </span>
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
                className="relative select-none font-black uppercase"
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
            {killer && (
              <div className="mt-2 bg-black/70 px-3 py-1 text-sm text-fg" style={{ animation: 'tbSub 0.4s ease-out 1.2s both' }}>
                flattened by {killerMeta ? `a $${killerMeta.sym} box truck` : `a ${KINDS.find((k) => k.id === killer.kind)?.label.toLowerCase()}`} · tx {killer.id.slice(0, 10)}…
              </div>
            )}
          </div>
        )}
        {!started && !over && (
          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 text-center">
            <p className="bg-black/70 px-3 py-1 text-2xl font-bold text-hot">CHAIN FROGGER</p>
            <p className="max-w-lg bg-black/70 px-3 py-1 text-sm text-fg">
              Every vehicle is a real BSV transaction, live, running one way: sender → receiver. Cross the avenue; rest on the median. Arrows / WASD to move, Space / F to zap
              the vehicle ahead ({AMMO_PER_CROSSING} shots per crossing).
            </p>
            <div className="flex flex-wrap justify-center gap-1 bg-black/70 px-2 py-1 text-xs">
              <span className="self-center text-dim">PLAY AS:</span>
              {CHARS.map((c) => (
                <button key={c.id} onClick={() => (setCharState(c.id), control.current?.setChar(c.id))} className={`btn ${char === c.id ? 'btn-on' : ''}`}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-1 bg-black/70 px-2 py-1 text-xs">
              <span className="self-center text-dim">WEAPON:</span>
              {[{ name: 'None' }, ...GUNS].map((g, i) => (
                <button key={g.name} onClick={() => (setWeaponState(i - 1), control.current?.setWeapon(i - 1))} className={`btn ${weapon === i - 1 ? 'btn-on' : ''}`}>
                  {g.name}
                </button>
              ))}
            </div>
            <p className="bg-black/70 px-2 text-xs text-dim">press an arrow key to start</p>
          </div>
        )}
        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
            <p className="text-3xl font-bold text-hot">GAME OVER</p>
            <p className="text-sm text-fg">
              You crossed {score} times. Best: {best}.
            </p>
            <HighScores game="frogger" score={score} secs={runSecs} live={paid} txid={lastTx} label="CROSSINGS" />
            <button onClick={() => control.current?.restart()} className="btn-fire">
              AGAIN
            </button>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Traffic is a live sample of mainnet: {sampledN.toLocaleString()} real transactions have driven past so far (the chain runs far more than a road could hold).
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="inset px-2 py-1">
          <span className="text-dim">Crossings: </span>
          <span className="text-hot">{score}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Lives: </span>
          <span className="text-hot">{Math.max(0, lives)}</span>
        </div>
        <div className="inset px-2 py-1">
          <span className="text-dim">Best: </span>
          <span className="text-hot">{best}</span>
        </div>
      </div>
      {/* Mode picker: big and plain, so nobody wonders whether a hop costs money (owner, 6 Oct 2026). */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          onClick={() => setPaid(false)}
          aria-pressed={!paid}
          className={`btn flex flex-col items-start gap-1 px-4 py-4 text-left ${!paid ? 'btn-on' : ''}`}
        >
          <span className="text-xl font-bold">{!paid ? '● ' : '○ '}PRACTICE · FREE</span>
          <span className="text-sm opacity-80">Nothing is paid. Hops and shots stay off-chain.</span>
        </button>
        <button
          onClick={() => setPaid(true)}
          aria-pressed={paid}
          disabled={!HOUSE}
          title={HOUSE ? undefined : 'Paid play is not switched on yet'}
          className={`btn flex flex-col items-start gap-1 px-4 py-4 text-left disabled:opacity-40 ${paid ? 'btn-on' : ''}`}
        >
          <span className="text-xl font-bold">{paid ? '● ' : '○ '}PAID · ON-CHAIN</span>
          <span className="text-sm opacity-80">Every hop and shot is a real transaction: 1 sat or 1 ${FROG.sym}.</span>
        </button>
      </div>
      <p className="mt-2 text-center text-base font-bold">
        {paid ? <span className="text-hot">You are playing PAID: each hop costs money.</span> : <span className="text-dim">You are playing FREE: nothing is paid.</span>}
      </p>
      <div className={`inset mt-2 flex-wrap items-center gap-2 px-3 py-2 text-sm ${paid ? 'flex' : 'hidden'}`}>
        {paid && b.wallet && (
          <>
            <span className="text-dim">PAY:</span>
            <button onClick={chooseSats} disabled={!!b.busy} className={`btn ${!payFrog ? 'btn-on' : ''}`}>
              SATS
            </button>
            <button onClick={chooseFrog} disabled={!!b.busy || !frogTok} title={frogTok ? `1 $${FROG.sym} per hop / shot` : `Your wallet has no $${FROG.sym}`} className={`btn flex items-center gap-1 ${payFrog ? 'btn-on' : ''} disabled:opacity-40`}>
              ${FROG.sym} <HouseBadge label="HOUSE" />
            </button>
            {!frogHeld && <BuyHouse coin={FROG} />}
          </>
        )}
        {paid && (
          <>
            {payFrog ? (
              <span className="text-dim">
                1 ${FROG.sym} to TokenBlaster + ~{TOKEN_FEE} sats network fee per action ·{' '}
                <span className="text-hot">{Math.min(Math.floor(b.tokenAmmo), Math.floor(b.ammo / TOKEN_FEE)).toLocaleString()} actions</span> loaded ({Math.floor(b.tokenAmmo).toLocaleString()} ${FROG.sym} ·{' '}
                {b.ammo.toLocaleString()} sats fuel)
              </span>
            ) : (
              <span className="text-dim">
                {PER_ACTION} sat to TokenBlaster + ~{EST_FEE} sats network fee per action ·{' '}
                <span className="text-hot">{Math.floor(b.ammo / (PER_ACTION + EST_FEE)).toLocaleString()} actions</span> loaded ({b.ammo.toLocaleString()} sats)
              </span>
            )}
            {!b.wallet ? (
              <button onClick={b.connectWallet} disabled={!!b.busy} className="btn btn-on">
                {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
              </button>
            ) : payFrog ? (
              FROG_LOADS.filter((n) => n <= frogHeld).map((n) => (
                <button key={n} onClick={() => void b.loadTokenAmmo(n)} disabled={!!b.busy} className="btn">
                  {b.busy === 'loading-tokens' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} $${FROG.sym}`}
                </button>
              ))
            ) : (
              LOADS.map((n) => (
                <button key={n} onClick={() => b.load(n, `Chain Frogger: ${n.toLocaleString()} sats of moves`)} disabled={!!b.busy} className="btn">
                  {b.busy === 'loading' ? 'APPROVE…' : `LOAD ${n.toLocaleString()} sats`}
                </button>
              ))
            )}
            {b.wallet && (b.ammo > 0 || b.gunTokens.length > 0) && (
              <button onClick={b.unload} disabled={!!b.busy} className="btn">
                UNLOAD
              </button>
            )}
            <span className="text-dim">
              on chain: <span className="text-hot">{onChain.toLocaleString()}</span>
              {lastTx && (
                <>
                  {' · '}
                  <a href={`https://whatsonchain.com/tx/${lastTx}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                    last tx ↗
                  </a>
                </>
              )}
            </span>
          </>
        )}
      </div>
      {paid && payFrog && b.tokenAmmo < 1 && (
        <p className="mt-2 text-center text-lg font-bold text-hot">No ${FROG.sym} loaded yet: press LOAD … ${FROG.sym} above, approve it, then you can move.</p>
      )}
      {paid && needSats && <p className="mt-1 text-sm text-hot">{payFrog ? `Out of $${FROG.sym} or fuel: load more to keep moving.` : 'Out of sats: load more to keep moving.'}</p>}
      {(payErr || b.error) && <p className="mt-1 text-sm text-hot">⚠ {payErr ?? b.error}</p>}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
      {killer && (
        <p className="mt-2 text-sm text-dim">
          Run over by a {KINDS.find((k) => k.id === killer.kind)?.label.toLowerCase()}
          {meta ? ` moving $${meta.sym}` : ''} ({killer.bytes.toLocaleString()} bytes, {killer.mined ? 'mined' : 'in mempool'}):{' '}
          <a href={`https://whatsonchain.com/tx/${killer.id}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            {killer.id.slice(0, 16)}… ↗
          </a>
        </p>
      )}
      <div className="mt-2 flex justify-center gap-2 sm:hidden">
        {(
          [
            ['←', -1, 0],
            ['↑', 0, -1],
            ['↓', 0, 1],
            ['→', 1, 0],
          ] as const
        ).map(([l, dx, dz]) => (
          <button key={l} onClick={() => control.current?.move(dx, dz)} className="btn px-5 py-3 text-xl">
            {l}
          </button>
        ))}
        {weapon >= 0 && (
          <button onClick={() => control.current?.fire()} className="btn btn-on px-4 py-3 text-xl">
            ⚡
          </button>
        )}
      </div>
    </section>
  );
}
