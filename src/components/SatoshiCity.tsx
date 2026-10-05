'use client';

import { useEffect, useRef, useState } from 'react';
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
import { sharedAudio } from '@/lib/sfx';

/**
 * Satoshi City: an open-world island city where the traffic is the BSV mainnet, live. Every car
 * driving the grid is a real transaction (payments are cars, data vans and taxis, inscriptions box
 * trucks and buses, token transfers box trucks wearing the token's logo, TokenBlaster blasts
 * supercars). Walk, steal any car, drive, deliver the next block before the timer runs out.
 */
const DAY_S = 240;
const AI_CAP = 26;
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
};
const HUD0: Hud = { score: 0, best: 0, driving: false, speed: 0, health: 100, mission: null, prompt: '', clock: '', drift: 0, locked: false, carLabel: '', feedNote: '' };
type Control = { key: (k: keyof Input, down: boolean) => void; action: (a: 'f' | 'horn' | 'skip' | 'tx') => void; start: () => void };
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
  const [started, setStarted] = useState(false);
  const control = useRef<Control | null>(null);

  useEffect(() => {
    const el = mount.current;
    const mapCanvas = mapRef.current;
    if (!el || !mapCanvas) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 0.8;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const peds = createPeds(scene, blocks); // sidewalk walkers (real rigged models)
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
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 512, 512);
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 8, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    gtao.blendIntensity = 0.8;
    composer.addPass(gtao);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.25, 0.5, 0.95);
    composer.addPass(bloom);
    const grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, time: { value: 0 }, night: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float amount; uniform float time; uniform float night; varying vec2 vUv;
        float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + time) * 43758.5453); }
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          vec3 base = mix(vec3(g), c.rgb, 1.14);
          float sh = 1.0 - smoothstep(0.0, 0.35, g);
          base *= mix(vec3(1.0), mix(vec3(0.93, 1.0, 1.06), vec3(0.9, 0.97, 1.12), night), sh);
          base *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), smoothstep(0.5, 1.5, g) * (1.0 - night));
          base *= mix(1.0, smoothstep(1.05, 0.35, distance(vUv, vec2(0.5))), 0.35);
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
    const hemi = new THREE.HemisphereLight('#cfe4ff', '#3a2a22', 1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff1dc', 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    const headLamp = new THREE.SpotLight('#fff4dc', 0, 70, 0.55, 0.45, 1.2);
    const headTarget = new THREE.Object3D();
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
    loader.load('/arena/models/npg/stack/chibi_base.glb', (gl) => {
      if (disposed) return;
      const clips = chibiClips(gl.scene);
      const model = cloneSkinned(gl.scene);
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

    // ── Game state ──
    const [sqx, sqz] = squareCentre();
    const SPAWN = { x: sqx, z: sqz + 12 };
    const ped = { x: SPAWN.x, z: SPAWN.z, y: CURB_H, vy: 0, heading: Math.PI, onGround: true, speed: 0 };
    type Body = { b: Built; x: number; z: number; th: number; vx: number; vz: number; w: number; f: FeedTx | null; health: number; awake: boolean; parked: boolean };
    type Turn = { to: Edge; ax: number; az: number; cx: number; cz: number; bx: number; bz: number; len: number; t: number };
    type Ai = { b: Built; f: FeedTx; edge: Edge; next: Edge; s: number; turn: Turn | null; v: number; vmax: number; born: number; stun: number; x: number; z: number; th: number; honk: number };
    const bodies: Body[] = [];
    const ai: Ai[] = [];
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
    let dayT = 0.4;
    let tSec = 0; // game seconds (traffic lights)
    let drift = 0;
    let driftIdle = 0;
    let shake = 0;
    let isStarted = false;
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
    control.current = {
      key: (k, down) => (inp[k] = down),
      action: (a) => (a === 'f' ? action() : a === 'horn' ? horn() : a === 'skip' ? skip() : openTx()),
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
      else if (e.code === 'KeyH') horn();
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
    const NIGHT = new THREE.Color('#05070f');

    // ── The loop ──
    const camPos = new THREE.Vector3(SPAWN.x, 6, SPAWN.z + 8);
    camera.position.copy(camPos);
    const camLook = new THREE.Vector3(SPAWN.x, 1.4, SPAWN.z);
    const tmpV = new THREE.Vector3();
    const size2 = new THREE.Vector2();
    let last = performance.now();
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

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const realDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dt = dead ? realDt * 0.28 : realDt;
      tSec += dt;
      grade.uniforms.amount.value += ((dead ? 1 : 0) - grade.uniforms.amount.value) * Math.min(1, realDt * (dead ? 5 : 3));
      grade.uniforms.time.value = now / 1000;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const sz = renderer.getSize(size2);
      if (sz.x !== w || sz.y !== h) {
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const focusX = car ? car.x : ped.x;
      const focusZ = car ? car.z : ped.z;

      // ── Day cycle ──
      dayT = (dayT + dt / DAY_S) % 1;
      const ang = dayT * Math.PI * 2 - Math.PI / 2;
      const elev = Math.sin(ang);
      sun.position.set(focusX + Math.cos(ang) * 150, Math.max(8, elev * 170), focusZ + 70);
      sun.target.position.set(focusX, 0, focusZ);
      const night = THREE.MathUtils.clamp(-elev * 3 + 0.2, 0, 1);
      const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1);
      sky.copy(DAY).lerp(DUSK, dusk * 0.8).lerp(NIGHT, night);
      if (hdrSky && night < 0.55) {
        scene.background = hdrSky;
        scene.backgroundIntensity = Math.max(0.08, 1 - night * 1.6) * (1 - dusk * 0.35);
      } else scene.background = sky;
      (scene.fog as THREE.Fog).color.copy(sky);
      scene.environmentIntensity = 0.12 + 0.88 * (1 - night);
      grade.uniforms.night.value = night;
      world.setNight(night, now, tSec);
      kit.setNight(night);
      sun.intensity = 3.2 * (1 - night);
      sun.color.set(dusk > 0.4 ? '#ffb27a' : '#fff1dc');
      hemi.intensity = 0.14 + 0.6 * (1 - night);
      renderer.toneMappingExposure = 0.8 - night * 0.12;
      bloom.strength = 0.06 + night * 0.42;
      headLamp.intensity = night * 60;
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

      // ── Traffic: spawn, despawn, drive ──
      if (kitReady && now > spawnAt) {
        spawnAt = now + (ai.length < AI_CAP * 0.6 ? 60 : 400);
        if (ai.length < AI_CAP) spawnAi(now, ai.length < 8);
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
      peds.update(dt, focusX, focusZ, [...(car ? [{ x: car.x, z: car.z, speed: Math.hypot(car.vx, car.vz) }] : []), ...ai.map((a) => ({ x: a.x, z: a.z, speed: a.v }))]);
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
        for (const a of ai) {
          const hit = aiVsBody(a, c);
          if (hit > 1) {
            a.stun = now + 1800;
            impact = Math.max(impact, hit);
          }
        }
        if (impact > 3) {
          shake = Math.min(1, impact / 18);
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

      // ── On foot ──
      if (!car && !dead) {
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
      if (dead) {
        const t = (now - dead) / 1000;
        const a = 0.6 + t * 0.35;
        tmpV.set(player.position.x + Math.sin(a) * 7, 3.4 + t * 0.4, player.position.z + Math.cos(a) * 7);
        camPos.lerp(tmpV, Math.min(1, realDt * 2));
        camLook.lerp(tmpV.set(player.position.x, player.position.y + 0.6, player.position.z), Math.min(1, realDt * 6));
      } else {
        let ty: number;
        let cx: number;
        let cz: number;
        let yaw: number;
        let pitch: number;
        let dist: number;
        let rate: number;
        let ahead = 0;
        if (car) {
          if (now - look.lastMouse > 1500) {
            look.lookYaw *= Math.exp(-2.5 * realDt);
            look.lookPitch *= Math.exp(-2.5 * realDt);
          }
          const behind = Math.atan2(-Math.cos(car.th), Math.sin(car.th));
          look.yaw = look.yaw + angDiff(look.yaw, behind) * Math.min(1, realDt * 4);
          const sp = Math.hypot(car.vx, car.vz);
          yaw = look.yaw + look.lookYaw;
          pitch = 0.2 + look.lookPitch;
          dist = 5 + car.b.len * 0.7 + sp * 0.07 + (look.dist - 6) * 0.5;
          cx = car.x;
          cz = car.z;
          ty = car.b.g.position.y + 1.7;
          rate = 8;
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
      try {
        engOsc?.stop();
      } catch {
        /* already stopped */
      }
      for (const a of ai) kit.release(a.b);
      for (const b of bodies) kit.release(b.b);
      if (car) kit.release(car.b);
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
  }, []);

  const padDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    control.current?.key(e.currentTarget.dataset.k as keyof Input, true);
  };
  const padUp = (e: React.PointerEvent<HTMLButtonElement>) => control.current?.key(e.currentTarget.dataset.k as keyof Input, false);
  const padProps = { onPointerDown: padDown, onPointerUp: padUp, onPointerLeave: padUp, onPointerCancel: padUp };
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  return (
    <section className="panel">
      <GameAudio track="city" />
      <div className="panel-header">
        <span className="panel-title">Satoshi City</span>
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
      <div className="relative select-none">
        <div ref={mount} className="inset h-[74vh] min-h-96 w-full touch-none overflow-hidden" />

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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-4 text-center">
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
              <span>horn · skip to day/night</span>
            </div>
            <button
              className="btn-fire"
              onClick={() => {
                setStarted(true);
                control.current?.start();
              }}
            >
              ENTER THE CITY
            </button>
          </div>
        )}

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
      <p className="mt-2 text-xs text-muted">
        Traffic is a live sample of mainnet: each car is one real transaction, kind and size deciding the vehicle (payments are cars, data vans and taxis, inscriptions trucks and
        buses, token transfers box trucks wearing the token&apos;s logo). Look at a car to see its transaction; press T to open it on WhatsOnChain. Parked cars in the car park
        are unspent outputs, free to take.
      </p>
    </section>
  );
}
