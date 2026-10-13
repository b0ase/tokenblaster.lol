'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { rigClips, holdHeadUp, findHead } from '@/lib/npgRigMocap';
import { LIVE_CARDS, liveCardBase } from '@/lib/npgLiveCards';
import { makeStage, type Stage, type StageKind } from '@/lib/npgArena/stage';
import { makeFighter, makeSim, rematch, step, NO_INPUT, type Fighter, type Input, type Sim, type Stats } from '@/lib/npgArena/sim';
import { cpuInput, makeBrain, type Brain, type Difficulty } from '@/lib/npgArena/ai';
import { sharedAudio } from '@/lib/sfx';
import { GameAudio } from '@/components/SoundToggle';
import { useCoinOp } from '@/components/InsertCoin';

/** The three girls with working mocap rigs. */
// the rigged NPG girls (<slug>-rigged.glb); Joy has no rig, and the owner keeps Doctor, Matoko and the Erobots out
const OUT = new Set(['joy', 'doctor', 'matoko', 'bot', 'tech', 'graf-bot', 'frog-bot', 'stripey-bot']);
const ROSTER = LIVE_CARDS.filter((c) => c.rig && !OUT.has(c.slug)).map((c) => {
  return { slug: c.slug, name: c.name, stats: c.stats as Stats };
});
/**
 * Penny Battles: 1p coins are energy. Practice is one bar each; every coin you put in before the fight is one more
 * bar for the match (your opponent gets the same, so it's a bigger fight, not a bought win), and mid-fight a coin
 * tops YOU up by a bar. Coins go to the house pot (prizes from the pot come later; no payouts yet).
 */
const COIN_P = 1;
const MAX_BARS = 5;
const PALETTE = ['#ff2bd6', '#18e8ff', '#ffe100', '#7dff3a', '#ff6a1a', '#b46bff'];
const COLORS: Record<string, string> = Object.fromEntries(ROSTER.map((r, i) => [r.slug, PALETTE[i % PALETTE.length]]));
Object.assign(COLORS, { miyuki: '#ff2bd6', kimiko: '#18e8ff', nao: '#ffe100' });
const HEIGHT = 1.55;
const FULL_BODY = new Set(['Death01', 'Roll', 'Hit_Knockback']);
const STEP = 1 / 60;

type Loaded = { gltf: GLTF; clips: THREE.AnimationClip[]; scale: number; offset: THREE.Vector3 };
type Mode = 'cpu' | '2p';
type Screen = 'loading' | 'select' | 'fight';

// ── keyboard maps ──
type Binds = { up: string[]; down: string[]; left: string[]; right: string[]; jump: string[]; roll: string[]; light: string[]; heavy: string[]; block: string[] };
const P1_SOLO: Binds = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space', 'KeyI'], roll: ['ShiftLeft', 'ShiftRight', 'KeyU'], light: ['KeyJ', 'KeyC'], heavy: ['KeyK', 'KeyV'], block: ['KeyL', 'KeyB'],
};
const P1_DUO: Binds = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'], roll: ['ShiftLeft'], light: ['KeyC'], heavy: ['KeyV'], block: ['KeyB'] };
const P2_DUO: Binds = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['KeyI'], roll: ['KeyU'], light: ['KeyJ'], heavy: ['KeyK'], block: ['KeyL'] };
const GAME_KEYS = new Set([...Object.values(P1_SOLO).flat(), ...Object.values(P2_DUO).flat()]);

/** Raw stick + buttons for one human, before mapping to world space. */
type Pad = { mx: number; my: number; jump: boolean; roll: boolean; light: boolean; heavy: boolean; block: boolean };

function readKeys(keys: Set<string>, b: Binds): Pad {
  const any = (l: string[]) => l.some((k) => keys.has(k));
  return {
    mx: (any(b.right) ? 1 : 0) - (any(b.left) ? 1 : 0),
    my: (any(b.up) ? 1 : 0) - (any(b.down) ? 1 : 0),
    jump: any(b.jump), roll: any(b.roll), light: any(b.light), heavy: any(b.heavy), block: any(b.block),
  };
}
function readPad(i: number): Pad | null {
  const gp = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads()[i] : null;
  if (!gp || !gp.connected) return null;
  const ax = (k: number) => (Math.abs(gp.axes[k] ?? 0) > 0.22 ? gp.axes[k] : 0);
  const bt = (k: number) => Boolean(gp.buttons[k]?.pressed);
  return {
    mx: ax(0) + (bt(15) ? 1 : 0) - (bt(14) ? 1 : 0),
    my: -ax(1) + (bt(12) ? 1 : 0) - (bt(13) ? 1 : 0),
    jump: bt(0), roll: bt(1) || bt(6), light: bt(2), heavy: bt(3), block: bt(4) || bt(5) || bt(7),
  };
}
const merge = (a: Pad, b: Pad | null): Pad =>
  b ? { mx: a.mx + b.mx, my: a.my + b.my, jump: a.jump || b.jump, roll: a.roll || b.roll, light: a.light || b.light, heavy: a.heavy || b.heavy, block: a.block || b.block } : a;

// ── tiny synth on the shared sfx bus (global mute / volume) ──
function makeFightSfx() {
  const sh = sharedAudio();
  if (!sh) return null;
  const ac = sh.ctx;
  const out = ac.createGain();
  out.gain.value = 0.7;
  out.connect(sh.out);
  const nb = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
  const d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = (dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1) => {
    const t = ac.currentTime;
    const s = ac.createBufferSource();
    s.buffer = nb;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur + 0.05);
  };
  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) => {
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  return {
    swing: (heavy: boolean) => noise(heavy ? 0.32 : 0.16, heavy ? 0.35 : 0.22, 'bandpass', heavy ? 600 : 1400, heavy ? 2600 : 4200, 1.4),
    hit: (heavy: boolean) => {
      tone('sine', heavy ? 160 : 220, 40, heavy ? 0.3 : 0.16, heavy ? 0.9 : 0.6);
      noise(heavy ? 0.22 : 0.1, heavy ? 0.7 : 0.45, 'lowpass', heavy ? 2400 : 3600, 300);
      if (heavy) tone('square', 90, 30, 0.25, 0.25);
    },
    block: () => {
      tone('square', 1900, 1300, 0.09, 0.15);
      tone('triangle', 2900, 2400, 0.18, 0.12);
      noise(0.06, 0.25, 'highpass', 3000);
    },
    jump: () => noise(0.12, 0.12, 'bandpass', 500, 1500, 2),
    land: () => tone('sine', 120, 50, 0.12, 0.35),
    roll: () => noise(0.3, 0.16, 'lowpass', 900, 300),
    ko: () => {
      tone('sawtooth', 220, 30, 1.1, 0.4);
      tone('sine', 80, 25, 1.2, 0.9);
      noise(0.9, 0.5, 'lowpass', 2000, 80);
    },
    callout: (big: boolean) => {
      tone('square', big ? 330 : 440, big ? 660 : 880, 0.12, 0.18);
      tone('square', big ? 495 : 660, big ? 990 : 1320, 0.2, 0.14, 0.1);
    },
    tick: () => tone('square', 1500, 1100, 0.04, 0.1),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, 0.22, i * 0.11)),
    resume: () => ac.state !== 'running' && void ac.resume(),
  };
}

/** One girl in the scene: her model, mixer and clip actions, following a sim Fighter. */
class FighterView {
  root = new THREE.Group();
  mixer: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>();
  cur: THREE.AnimationAction | null = null;
  key = -1;
  hold: number | undefined;
  shadow: THREE.Mesh;
  model: THREE.Object3D;
  head: THREE.Object3D | null;
  /** skinned vertices sampled every frame to keep her on the floor (all of the feet + a spread over the body) */
  samples: { mesh: THREE.SkinnedMesh; idx: Int32Array }[] = [];
  /** body radius (m) for the sim's collision capsule, measured from her mesh */
  rad = 0.5;
  /** current lift that keeps her lowest point at floor level (smoothed) */
  lift = 0;
  sole = 0;
  constructor(scene: THREE.Scene, l: Loaded) {
    const model = cloneSkinned(l.gltf.scene);
    model.scale.setScalar(l.scale);
    model.position.copy(l.offset);
    model.traverse((o) => {
      if (o.name.startsWith('Icosphere')) o.visible = false;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    this.root.add(model);
    this.model = model;
    this.head = findHead(model);
    this.measure();
    // soft contact shadow so she never floats
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 32),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    this.shadow = blob;
    scene.add(blob);
    scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of l.clips) this.actions.set(c.name, this.mixer.clipAction(c));
  }
  /** Pick the vertices to ground on and measure her body radius, in the rest pose. */
  private measure() {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const meshes: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && sm.visible) meshes.push(sm);
    });
    const total = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
    const stride = Math.max(1, Math.floor(total / 700));
    const radii: number[] = [];
    for (const m of meshes) {
      const n = m.geometry.attributes.position.count;
      const pick: number[] = [];
      let feet = 0;
      for (let i = 0; i < n; i++) {
        m.getVertexPosition(i, v);
        m.localToWorld(v);
        const low = v.y < HEIGHT * 0.09;
        // feet: every 2nd vertex (soles + toes decide the floor contact in most clips)
        if ((low && (feet++ & 1) === 0) || i % stride === 0) pick.push(i);
        // body radius: torso band only (arms out in the rest pose would make her too fat)
        if (v.y > HEIGHT * 0.3 && v.y < HEIGHT * 0.62 && i % 3 === 0) radii.push(Math.hypot(v.x, v.z));
        if (v.y > HEIGHT * 0.62 && i % 3 === 0) radii.push(Math.hypot(v.x, v.z)); // big chibi heads count too
      }
      this.samples.push({ mesh: m, idx: Int32Array.from(pick) });
    }
    radii.sort((a, b) => a - b);
    const p90 = radii.length ? radii[Math.floor(radii.length * 0.9)] : 0.45;
    this.rad = THREE.MathUtils.clamp(p90, 0.46, 0.62);
  }

  /** Lowest point of her posed (skinned) mesh in world Y, with the root at its sim position. */
  private lowest() {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let min = Infinity;
    for (const { mesh, idx } of this.samples) {
      for (let k = 0; k < idx.length; k++) {
        mesh.getVertexPosition(idx[k], v);
        mesh.localToWorld(v);
        if (v.y < min) min = v.y;
      }
    }
    return min;
  }

  sync(f: Fighter, dt: number) {
    if (f.anim.key !== this.key) {
      this.key = f.anim.key;
      const a = this.actions.get(f.anim.clip);
      if (a) {
        const prev = this.cur;
        a.reset();
        a.paused = false;
        a.enabled = true;
        a.setEffectiveWeight(1);
        a.setLoop(f.anim.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        a.clampWhenFinished = !f.anim.loop;
        a.timeScale = f.anim.speed;
        if (f.anim.speed < 0) a.time = a.getClip().duration;
        a.play();
        if (prev && prev !== a) prev.crossFadeTo(a, f.anim.fade, false);
        else if (!prev) a.fadeIn(f.anim.fade);
        this.cur = a;
        this.hold = f.anim.hold;
      }
    }
    if (this.cur && this.hold !== undefined && this.cur.time >= this.hold * this.cur.getClip().duration) this.cur.paused = true;
    this.mixer.update(dt);
    this.root.position.set(f.x, f.y, f.z);
    this.root.rotation.y = f.face;
    holdHeadUp(this.model, this.head);
    // ground her: nothing of the posed mesh may go below the floor (falls, rolls, crouches, landings). Lift up fast,
    // settle back down a little slower, so it never jitters; never pull her down (jumps keep their height).
    const want = Math.max(0, -this.lowest());
    const k = want > this.lift ? Math.min(1, dt * 40) : Math.min(1, dt * 14);
    this.lift += (want - this.lift) * k;
    if (want > this.lift) this.lift = Math.max(this.lift, want - 0.01);
    this.root.position.y = f.y + this.lift;
    this.sole = this.lift - want; // where her lowest point ended up (≥ -1cm)
    this.shadow.position.set(f.x, 0.012, f.z);
    const sk = Math.max(0.3, 1 - f.y * 0.5);
    this.shadow.scale.setScalar(sk);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * sk;
  }
  dispose(scene: THREE.Scene) {
    this.mixer.stopAllAction();
    scene.remove(this.root, this.shadow);
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}

/** Render a girl's upper body to an image with the shared renderer (portraits for the select screen + HUD). */
function portrait(renderer: THREE.WebGLRenderer, l: Loaded, color: string): string {
  const W = 320, H = 400;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#302040', 1.6));
  const k = new THREE.DirectionalLight('#ffffff', 2.4);
  k.position.set(1.5, 2, 3);
  const r = new THREE.DirectionalLight(color, 3);
  r.position.set(-2, 1.5, -1.5);
  scene.add(k, r);
  const model = cloneSkinned(l.gltf.scene);
  model.scale.setScalar(l.scale);
  model.position.copy(l.offset);
  model.traverse((o) => o.name.startsWith('Icosphere') && (o.visible = false));
  const g = new THREE.Group();
  g.add(model);
  g.rotation.y = 0.35;
  scene.add(g);
  const idle = l.clips.find((c) => c.name === 'Sword_Idle');
  if (idle) {
    const m = new THREE.AnimationMixer(model);
    m.clipAction(idle).play();
    m.update(0.4);
    holdHeadUp(model, findHead(model));
  }
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 20);
  cam.position.set(0, HEIGHT * 0.62, 3.1);
  cam.lookAt(0, HEIGHT * 0.55, 0);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  rt.dispose();
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const img = c.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  c.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

type HudState = { phase: Sim['phase']; timer: number; wins: [number, number]; round: number; winner: number | null };
type Callout = { text: string; big: boolean; id: number };

export function NpgArena() {
  const mount = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const loaded = useRef(new Map<string, Loaded>());
  const loadRef = useRef<(slug: string) => Promise<void>>(() => Promise.resolve());
  const [waiting, setWaiting] = useState(false);
  const co = useCoinOp('NPG Arena', 'npg-arena', COIN_P);
  const [energy, setEnergy] = useState<[number, number]>([1, 1]);
  const [pot, setPot] = useState(0);
  const baseHp = useRef<[number, number]>([0, 0]);
  const [screen, setScreen] = useState<Screen>('loading');
  const [progress, setProgress] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const [p1, setP1] = useState('miyuki');
  const [p2, setP2] = useState<string | null>('kimiko');
  const [mode, setMode] = useState<Mode>('cpu');
  const [diff, setDiff] = useState<Difficulty>('normal');
  const startRef = useRef<() => void>(() => {});
  const startKind = useRef<StageKind | null>(null);
  const [arena, setArena] = useState<StageKind | 'random'>(() => {
    if (typeof window === 'undefined') return 'rooftop';
    const q = new URLSearchParams(window.location.search).get('stage');
    return q === 'dojo' || q === 'random' ? q : 'rooftop';
  });
  const [hud, setHud] = useState<HudState>({ phase: 'intro', timer: 60, wins: [0, 0], round: 1, winner: null });
  const [callout, setCallout] = useState<Callout | null>(null);
  const [fighters, setFighters] = useState<[string, string]>(['miyuki', 'kimiko']);
  const bars = useRef<(HTMLDivElement | null)[]>([]);
  const trails = useRef<(HTMLDivElement | null)[]>([]);
  const game = useRef<{ sim: Sim; views: [FighterView, FighterView]; brain: Brain | null; mode: Mode; demo: Brain | null } | null>(null);
  const keys = useRef(new Set<string>());
  const prevPads = useRef<[Pad, Pad]>([{ mx: 0, my: 0, jump: false, roll: false, light: false, heavy: false, block: false }, { mx: 0, my: 0, jump: false, roll: false, light: false, heavy: false, block: false }]);
  const sfxRef = useRef<ReturnType<typeof makeFightSfx>>(null);

  // ── stage + loading ──
  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
    const stage = makeStage(el, phone);
    stageRef.current = stage;
    let disposed = false;
    const loader = new GLTFLoader();
    const pending = new Map<string, Promise<void>>();
    // ~6-10MB each: the two picked fighters load first, the rest stream in behind the select screen
    const load = (slug: string, onBytes?: (got: number, total: number) => void) => {
      let p = pending.get(slug);
      if (p) return p;
      p = loader
        .loadAsync(`${liveCardBase(slug)}-rigged.glb`, (e) => onBytes?.(e.loaded, e.total || 9e6))
        .then(async (gltf) => {
          const model = gltf.scene;
          model.updateMatrixWorld(true);
          model.traverse((o) => {
            const sm = o as THREE.SkinnedMesh;
            if (sm.isSkinnedMesh) {
              sm.skeleton.update();
              sm.computeBoundingBox();
            }
          });
          const box = new THREE.Box3().setFromObject(model);
          const h = box.max.y - box.min.y;
          const scale = HEIGHT / h;
          const offset = new THREE.Vector3(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
          // full-body moves (falls, rolls, knockbacks) keep the mocap hips so she actually goes down
          const [calm, free] = await Promise.all([rigClips(model, slug), rigClips(model, slug, { hipsDamp: 0, spineDamp: 0.3 })]);
          const clips = calm.map((c) => (FULL_BODY.has(c.name) ? free.find((k) => k.name === c.name) ?? c : c));
          const l = { gltf, clips, scale, offset };
          loaded.current.set(slug, l);
          if (!disposed) {
            const url = portrait(stage.renderer, l, COLORS[slug]);
            setPortraits((ps) => ({ ...ps, [slug]: url }));
          }
        });
      p.catch(() => pending.delete(slug));
      pending.set(slug, p);
      return p;
    };
    loadRef.current = load;
    const first = ['miyuki', 'kimiko'];
    const bytes = first.map(() => ({ got: 0, total: 9e6 }));
    Promise.all(
      first.map((slug, i) =>
        load(slug, (got, total) => {
          bytes[i] = { got, total };
          setProgress(bytes.reduce((a, b) => a + b.got, 0) / bytes.reduce((a, b) => a + b.total, 0));
        }),
      ),
    )
      .then(async () => {
        if (disposed) return;
        setProgress(1);
        setScreen('select');
        // background: two at a time so a picked fighter can still jump the queue
        const rest = ROSTER.map((r) => r.slug).filter((s) => !first.includes(s));
        const worker = async () => {
          for (let s = rest.shift(); s && !disposed; s = rest.shift()) await load(s).catch(() => {});
        };
        await Promise.all([worker(), worker()]);
      })
      .catch((e) => !disposed && setLoadErr(String(e?.message ?? e)));

    // render loop: attract-mode orbit when not fighting
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let orbit = 0;
    let lastTimer = -1;
    const camPos = new THREE.Vector3(0, 2, 7);
    const camLook = new THREE.Vector3(0, 0.9, 0);
    let side = 1;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = game.current;
      const cam = stage.camera;
      if (!g) {
        orbit += dt * 0.12;
        cam.position.set(Math.sin(orbit) * 7.5, 2.4, Math.cos(orbit) * 7.5);
        cam.lookAt(0, 0.8, 0);
        stage.render(dt);
        return;
      }
      const { sim, views } = g;
      // inputs
      const pads: [Pad, Pad] = g.mode === '2p'
        ? [merge(readKeys(keys.current, P1_DUO), readPad(0)), merge(readKeys(keys.current, P2_DUO), readPad(1))]
        : [merge(readKeys(keys.current, P1_SOLO), readPad(0)), prevPads.current[1]];
      // camera-space -> world-space movement
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      const fwd = new THREE.Vector3(right.z, 0, -right.x); // into the screen
      const toInput = (p: Pad, prev: Pad): Input => {
        let x = right.x * p.mx + fwd.x * p.my;
        let z = right.z * p.mx + fwd.z * p.my;
        const l = Math.hypot(x, z);
        if (l > 1) {
          x /= l;
          z /= l;
        }
        return { x, z, jump: p.jump && !prev.jump, roll: p.roll && !prev.roll, light: p.light && !prev.light, heavy: p.heavy && !prev.heavy, block: p.block };
      };
      const humanIn: [Input, Input] = [toInput(pads[0], prevPads.current[0]), g.mode === '2p' ? toInput(pads[1], prevPads.current[1]) : NO_INPUT];
      prevPads.current = pads;
      acc += dt;
      let animDt = 0;
      let first = true;
      while (acc >= STEP) {
        acc -= STEP;
        const ins: [Input, Input] = [first ? humanIn[0] : { ...humanIn[0], jump: false, roll: false, light: false, heavy: false }, first ? humanIn[1] : { ...humanIn[1], jump: false, roll: false, light: false, heavy: false }];
        if (g.brain) ins[1] = cpuInput(sim, 1, g.brain, STEP);
        if (g.demo) ins[0] = cpuInput(sim, 0, g.demo, STEP);
        first = false;
        animDt += step(sim, ins, STEP);
      }
      // events
      const sx = sfxRef.current;
      for (const e of sim.events.splice(0)) {
        if (e.type === 'hit') {
          const att = sim.f[1 - e.to];
          stage.hit(new THREE.Vector3(e.x, e.y * (HEIGHT / 1.55) * 0.82, e.z), { blocked: e.blocked, heavy: e.heavy, color: COLORS[att.slug] ?? '#ff2bd6' });
          if (e.blocked) sx?.block();
          else sx?.hit(e.heavy);
        } else if (e.type === 'swing') sx?.swing(e.heavy);
        else if (e.type === 'jump') sx?.jump();
        else if (e.type === 'land') {
          sx?.land();
          const f = sim.f[e.who];
          stage.dust(new THREE.Vector3(f.x, 0.05, f.z));
        } else if (e.type === 'roll') sx?.roll();
        else if (e.type === 'ko') {
          sx?.ko();
          stage.ko();
        } else if (e.type === 'callout') {
          sx?.callout(Boolean(e.big));
          setCallout({ text: e.text, big: Boolean(e.big), id: Math.random() });
        } else if (e.type === 'match') sx?.win();
      }
      views[0].sync(sim.f[0], animDt);
      views[1].sync(sim.f[1], animDt);
      // fighting-game camera: side-on to the line between them, pulled back to fit both
      const [a, b] = sim.f;
      const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      const ax = b.x - a.x, az = b.z - a.z;
      const sep = Math.hypot(ax, az) || 1;
      let nx = -az / sep, nz = ax / sep;
      // stay on the side we were on, so P1 stays on the left
      const cur = new THREE.Vector3(camPos.x - mid.x, 0, camPos.z - mid.z);
      if (nx * cur.x + nz * cur.z < 0 && cur.lengthSq() > 0.01) side = -1;
      else side = 1;
      if (side < 0) {
        nx = -nx;
        nz = -nz;
      }
      const end = sim.phase === 'roundEnd' || sim.phase === 'matchEnd';
      const dist = Math.max(3.5, sep * 1.0 + 2.3);
      const focus = end ? sim.f.find((f) => f.state === 'win') ?? null : null;
      const fx = focus ? focus.x : mid.x, fz = focus ? focus.z : mid.z;
      // victory: swing round in front of the winner, the loser off to one side
      const va = focus ? focus.face + 0.75 * side : 0;
      const want = focus
        ? new THREE.Vector3(fx + Math.sin(va) * 3.4, 1.1, fz + Math.cos(va) * 3.4)
        : new THREE.Vector3(fx + nx * dist, 1.0 + dist * 0.07, fz + nz * dist);
      const k = 1 - Math.exp(-(end ? 2 : 5) * dt);
      camPos.lerp(want, k);
      camLook.lerp(new THREE.Vector3(fx, end ? 0.75 : 0.8, fz), k);
      cam.position.copy(camPos);
      cam.lookAt(camLook);
      stage.render(dt);
      // HUD: bars direct, the rest through state when it changes
      for (let i = 0; i < 2; i++) {
        const f = sim.f[i];
        const pct = Math.max(0, f.hp / f.maxHp);
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleX(${pct})`;
        if (sim !== trailSim || sim.round !== trailRound || f.hp === f.maxHp) trail[i] = 1;
        trail[i] = trail[i] > pct ? Math.max(pct, trail[i] - dt * 0.35) : pct;
        const tr = trails.current[i];
        if (tr) tr.style.transform = `scaleX(${trail[i]})`;
      }
      trailSim = sim;
      trailRound = sim.round;
      const t = Math.ceil(sim.timer);
      if (t !== lastTimer || sim.phase !== hudPhase || sim.f[0].wins + sim.f[1].wins !== hudWins) {
        if (t !== lastTimer && t <= 10 && sim.phase === 'fight') sx?.tick();
        lastTimer = t;
        hudPhase = sim.phase;
        hudWins = sim.f[0].wins + sim.f[1].wins;
        const winner = sim.phase === 'matchEnd' ? sim.f.findIndex((f) => f.wins >= sim.roundsToWin) : null;
        setHud({ phase: sim.phase, timer: t, wins: [sim.f[0].wins, sim.f[1].wins], round: sim.round, winner });
      }
    };
    const trail = [1, 1];
    let trailSim: Sim | null = null;
    let trailRound = 0;
    let hudPhase: Sim['phase'] | null = null;
    let hudWins = -1;
    raf = requestAnimationFrame(frame);

    const down = (e: KeyboardEvent) => {
      if (!game.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    // dev/test hook (read-only peek at the fight)
    (window as unknown as { __npgArena?: () => Sim | null }).__npgArena = () => game.current?.sim ?? null;
    (window as unknown as { __npgArenaBodies?: () => unknown }).__npgArenaBodies = () => game.current?.views.map((v) => ({ rad: v.rad, lift: v.lift, sole: v.sole }));
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      if (game.current) {
        game.current.views.forEach((v) => v.dispose(stage.scene));
        game.current = null;
      }
      stage.dispose();
      stageRef.current = null;
    };
  }, []);

  const startFight = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    sfxRef.current ??= makeFightSfx();
    sfxRef.current?.resume();
    const kind: StageKind = startKind.current ?? (arena === 'random' ? (Math.random() < 0.5 ? 'rooftop' : 'dojo') : arena);
    startKind.current = null;
    if (stage.kind !== kind) {
      // the dojo streams in on first pick (~3.5MB); start once it's showing
      startKind.current = kind;
      void stage.setStage(kind).then(() => startRef.current(), () => setLoadErr('dojo failed to load'));
      return;
    }
    const opp = p2 ?? ROSTER[Math.floor(Math.random() * ROSTER.length)].slug;
    const ra = ROSTER.find((r) => r.slug === p1)!;
    const rb = ROSTER.find((r) => r.slug === opp)!;
    if (!loaded.current.has(ra.slug) || !loaded.current.has(rb.slug)) {
      // still streaming: fetch both now, then start this same matchup
      setWaiting(true);
      void Promise.all([loadRef.current(ra.slug), loadRef.current(rb.slug)]).then(
        () => {
          setWaiting(false);
          if (p2 === null) setP2(rb.slug);
          startRef.current();
        },
        (e) => {
          setWaiting(false);
          setLoadErr(String(e?.message ?? e));
        },
      );
      return;
    }
    if (game.current) game.current.views.forEach((v) => v.dispose(stage.scene));
    const sim = makeSim(makeFighter(ra.slug, ra.name, ra.stats, -1), makeFighter(rb.slug, rb.name, rb.stats, 1));
    // energy: 1 bar free, +1 per coin in the slot (both fighters get the same number of bars)
    let paid = 0;
    while (paid < MAX_BARS - 1 && co.consume()) paid++;
    const n = 1 + paid;
    baseHp.current = [sim.f[0].maxHp, sim.f[1].maxHp];
    for (const f of sim.f) f.hp = f.maxHp = f.maxHp * n;
    setEnergy([n, n]);
    setPot(paid);
    const views: [FighterView, FighterView] = [new FighterView(stage.scene, loaded.current.get(ra.slug)!), new FighterView(stage.scene, loaded.current.get(rb.slug)!)];
    // solid bodies: the sim's collision capsules come from each girl's measured mesh
    sim.f[0].rad = views[0].rad;
    sim.f[1].rad = views[1].rad;
    const demo = new URLSearchParams(window.location.search).has('demo') || Boolean((window as unknown as { __npgDemo?: boolean }).__npgDemo);
    game.current = { sim, views, brain: mode === 'cpu' ? makeBrain(diff) : null, mode, demo: demo ? makeBrain('hard') : null };
    keys.current.clear();
    setFighters([ra.slug, rb.slug]);
    setScreen('fight');
  }, [p1, p2, mode, diff, arena, co]);
  // re-entry after a stage load (startKind keeps a RANDOM roll from re-rolling)
  useEffect(() => {
    startRef.current = startFight;
  }, [startFight]);

  const again = useCallback(() => {
    const g = game.current;
    if (!g) return;
    rematch(g.sim);
  }, []);

  const toSelect = useCallback(() => {
    const stage = stageRef.current;
    if (game.current && stage) game.current.views.forEach((v) => v.dispose(stage.scene));
    game.current = null;
    setCallout(null);
    setScreen('select');
  }, []);

  // ?demo: CPU vs CPU attract mode, straight into the fight
  useEffect(() => {
    if (screen === 'select' && new URLSearchParams(window.location.search).has('demo')) startFight();
  }, [screen, startFight]);

  // Enter = rematch at the end, Esc = back to select
  useEffect(() => {
    if (screen !== 'fight') return;
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Escape') toSelect();
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && game.current?.sim.phase === 'matchEnd') again();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [screen, again, toSelect]);

  // mid-fight: the coin lands (or a spare credit is used) and P1 gets one more bar, straight away
  const topUp = useCallback(() => {
    co.playPaid(() => {
      const g = game.current;
      if (!g || !co.consume()) return;
      const f = g.sim.f[0];
      f.maxHp += baseHp.current[0];
      f.hp += baseHp.current[0];
      setEnergy(([x, y]) => [x + 1, y]);
      setPot((v) => v + 1);
    });
  }, [co]);

  const nameOf = (slug: string) => ROSTER.find((r) => r.slug === slug)?.name ?? slug;

  return (
    <section className="panel game-root">
      <style>{CSS}</style>
      {co.chooserEl}
      <div className="game-stage relative w-full overflow-hidden bg-black" style={{ height: 'min(78vh, 760px)', minHeight: 420 }}>
        <div ref={mount} className="absolute inset-0" />

        {screen === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-black/70">
            <div className="w-[min(520px,86%)] text-center">
              <div className="npga-title text-5xl text-white sm:text-7xl">NPG ARENA</div>
              <div className="mt-1 font-jp text-sm tracking-[0.4em] text-[#18e8ff]">忍者パンクガールズ 闘技場</div>
              <div className="npga-skew mt-8 h-3 w-full border border-white/30 bg-black/60">
                <div className="h-full bg-gradient-to-r from-[#ff2bd6] via-[#ff7ad9] to-[#ffe100] transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-white/70">
                <span>{loadErr ? `LOAD FAILED: ${loadErr}` : 'LOADING FIGHTERS + MOCAP'}</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
            </div>
          </div>
        )}

        {screen === 'select' && (
          <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-black/80 via-black/50 to-black/85 p-3 sm:p-6">
            <div className="text-center">
              <div className="npga-title text-4xl text-white sm:text-6xl">CHOOSE YOUR FIGHTER</div>
              <div className="mt-1 text-xs tracking-[0.3em] text-white/60">CLICK = YOU · SHIFT-CLICK OR RIGHT-CLICK = OPPONENT</div>
            </div>
            <div className="mx-auto mt-4 grid max-w-[1100px] grid-cols-4 gap-1.5 sm:grid-cols-6 sm:gap-3">
              {ROSTER.map((r) => {
                const you = p1 === r.slug, them = p2 === r.slug;
                return (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={(e) => (e.shiftKey ? setP2(r.slug) : setP1(r.slug))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setP2(r.slug);
                    }}
                    className={`npga-card group relative aspect-[961/1441] w-full overflow-hidden text-left transition-transform hover:-translate-y-1 ${you ? 'npga-you' : ''} ${them ? 'npga-them' : ''}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${liveCardBase(r.slug)}-card-bg.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    {portraits[r.slug] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={portraits[r.slug]} alt={r.name} className="absolute left-[8%] top-[17%] h-[66%] w-[84%] object-cover object-top" />
                    ) : (
                      <div className="npga-name absolute inset-x-0 top-[42%] text-center text-[10px] text-white/70 sm:text-sm">{r.name.toUpperCase()}<div className="mt-1 animate-pulse text-[8px] tracking-widest text-white/40">LOADING</div></div>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${liveCardBase(r.slug)}-card-frame.webp`} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
                    {(you || them) && (
                      <div className={`npga-tag absolute left-1/2 top-[76%] -translate-x-1/2 px-3 py-1 text-sm sm:text-xl ${you ? 'bg-[#ff2bd6] text-white' : 'bg-[#18e8ff] text-black'}`}>
                        {you && them ? 'MIRROR' : you ? 'P1' : mode === 'cpu' ? 'CPU' : 'P2'}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mx-auto mt-4 flex max-w-[880px] flex-wrap items-center justify-center gap-2 text-sm">
              <Seg label="OPPONENT" value={p2 === null ? 'random' : 'picked'} options={[['picked', p2 ? nameOf(p2).toUpperCase() : 'PICK'], ['random', 'RANDOM']]} onChange={(v) => setP2(v === 'random' ? null : p2 ?? 'kimiko')} />
              <Seg label="MODE" value={mode} options={[['cpu', 'VS CPU'], ['2p', '2P LOCAL']]} onChange={(v) => setMode(v as Mode)} />
 <Seg label="STAGE" value={arena} options={[['rooftop', 'ROOFTOP'], ['dojo', 'DOJO'], ['random', 'RANDOM']]} onChange={(v) => setArena(v as StageKind | 'random')} />
              {mode === 'cpu' && <Seg label="CPU" value={diff} options={[['easy', 'EASY'], ['normal', 'NORMAL'], ['hard', 'HARD']]} onChange={(v) => setDiff(v as Difficulty)} />}
            </div>
            <div className="npga-energy mx-auto mt-4 max-w-[880px] p-3 text-center">
              <div className="npga-name text-lg text-white sm:text-2xl">
                PENNY BATTLE · ENERGY {'▮'.repeat(Math.min(MAX_BARS, 1 + co.credits))}
                <span className="text-white/25">{'▮'.repeat(Math.max(0, MAX_BARS - 1 - co.credits))}</span>
              </div>
              <div className="mt-1 text-[11px] text-white/70">
                One bar free. Each {COIN_P}p coin is one more energy bar for the match (up to {MAX_BARS}); your opponent fights with the same. Mid-fight, a coin tops you up. Coins go to the house pot, plus the network fee. No payouts yet.
              </div>
              {co.enabled ? (
                <button type="button" onClick={() => void co.insert()} disabled={co.paying || !co.sats || co.credits >= MAX_BARS - 1} className="npga-seg mt-2 px-4 py-1 text-sm">
                  {co.paying ? 'WAITING FOR WALLET…' : co.sats ? `🪙 +1 BAR · ${COIN_P}p (${co.sats.toLocaleString('en-GB')} sats)` : 'PRICE LOADING…'}
                </button>
              ) : (
                <div className="mt-2 text-[11px] text-white/50">Paid energy is off here (no house address set). Practice is free.</div>
              )}
              {co.msg && <div className={`mt-1 text-[11px] ${co.msg.ok ? 'text-[#7dff3a]' : 'text-[#ff6a1a]'}`}>{co.msg.text}</div>}
            </div>
            <div className="mt-4 text-center">
              <button type="button" onClick={startFight} disabled={waiting} className="npga-go px-10 py-3 text-2xl sm:text-3xl">
                {waiting ? 'LOADING…' : 'FIGHT'}
              </button>
            </div>
            <Controls mode={mode} />
          </div>
        )}

        {screen === 'fight' && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-2 sm:gap-4 sm:p-4">
              {[0, 1].map((i) => {
                const slug = fighters[i];
                const flip = i === 1;
                return (
                  <div key={i} className={`flex min-w-0 flex-1 items-start gap-2 ${flip ? 'order-3 flex-row-reverse' : 'order-1'}`}>
                    <div className="npga-port relative h-14 w-14 shrink-0 overflow-hidden sm:h-20 sm:w-20" style={{ borderColor: COLORS[slug] }}>
                      {portraits[slug] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={portraits[slug]} alt="" className="absolute inset-0 h-full w-full object-cover object-top" style={{ transform: `scale(1.7) ${flip ? 'scaleX(-1)' : ''}`, transformOrigin: '50% 8%' }} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`npga-bar relative h-4 w-full sm:h-6 ${flip ? 'npga-bar-r' : ''}`}>
                        <div ref={(e) => void (trails.current[i] = e)} className="absolute inset-0 bg-white/80" style={{ transformOrigin: flip ? 'right' : 'left' }} />
                        <div ref={(e) => void (bars.current[i] = e)} className="absolute inset-0" style={{ transformOrigin: flip ? 'right' : 'left', background: `linear-gradient(${flip ? 270 : 90}deg, #ffe100, ${COLORS[slug]})` }} />
                      </div>
                      <div className={`mt-1 flex items-center gap-2 ${flip ? 'flex-row-reverse' : ''}`}>
                        <span className="npga-name text-base text-white sm:text-2xl">{nameOf(slug).toUpperCase()}</span>
                        <span className="text-[10px] tracking-widest text-white/60">{i === 0 ? 'P1' : mode === 'cpu' ? `CPU · ${diff.toUpperCase()}` : 'P2'}</span>
                        {energy[i] > 1 && <span className="npga-name text-xs text-[#ffe100] sm:text-base">×{energy[i]}</span>}
                        {i === 0 && co.enabled && hud.phase === 'fight' && (
                          <button type="button" onClick={topUp} disabled={co.paying || !co.sats || energy[0] >= MAX_BARS + 2} className="npga-seg pointer-events-auto px-2 text-[10px] sm:text-xs">
                            {co.paying ? '…' : `+${COIN_P}p`}
                          </button>
                        )}
                        <span className={`flex gap-1 ${flip ? 'mr-auto flex-row-reverse' : 'ml-auto'}`}>
                          {[0, 1].map((k) => (
                            <span key={k} className={`npga-pip ${hud.wins[i] > k ? 'npga-pip-on' : ''}`} />
                          ))}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="order-2 flex shrink-0 flex-col items-center">
                <div className={`npga-timer text-3xl sm:text-5xl ${hud.timer <= 10 && hud.phase === 'fight' ? 'text-[#ff2bd6]' : 'text-white'}`}>{hud.timer}</div>
                <div className="text-[10px] tracking-[0.3em] text-white/60">ROUND {hud.round}</div>
                {pot > 0 && <div className="text-[10px] tracking-[0.2em] text-[#ffe100]">POT {pot}p</div>}
              </div>
            </div>

            {callout && (
              <div key={callout.id} className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className={`npga-callout ${callout.big ? 'npga-callout-big' : ''}`}>{callout.text}</div>
              </div>
            )}

            {hud.phase === 'matchEnd' && hud.winner !== null && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/85 to-transparent p-6 pt-16">
                <div className="text-xs tracking-[0.4em] text-white/70">
                  {mode === 'cpu' ? (hud.winner === 0 ? 'YOU WIN' : 'CPU WINS') : `P${hud.winner + 1} WINS`} · {hud.wins[0]} – {hud.wins[1]}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={again} className="npga-go px-6 py-2 text-xl">
                    REMATCH
                  </button>
                  <button type="button" onClick={toSelect} className="npga-ghost px-6 py-2 text-xl">
                    CHARACTER SELECT
                  </button>
                </div>
                <div className="text-[10px] tracking-widest text-white/50">ENTER = REMATCH · ESC = SELECT</div>
              </div>
            )}

            {hud.phase !== 'matchEnd' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden justify-center p-2 sm:flex">
                <ControlsStrip mode={mode} />
              </div>
            )}
            <button type="button" onClick={toSelect} className="npga-ghost absolute bottom-2 left-2 px-2 py-1 text-xs">
              ESC · SELECT
            </button>
          </>
        )}
      </div>
      <GameAudio track="arena" />
    </section>
  );
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-[10px] tracking-[0.25em] text-white/60">{label}</span>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`npga-seg px-2 py-1 text-xs ${value === v ? 'npga-seg-on' : ''}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

const keyRows = (mode: Mode): [string, string, string][] =>
  mode === 'cpu'
    ? [
        ['MOVE', 'WASD / ARROWS', 'L-STICK'],
        ['LIGHT (×4 COMBO)', 'J', 'X / □'],
        ['HEAVY', 'K', 'Y / △'],
        ['BLOCK (HOLD)', 'L', 'LB / RB'],
        ['JUMP', 'SPACE', 'A / ✕'],
        ['ROLL', 'SHIFT', 'B / ○'],
      ]
    : [
        ['MOVE', 'P1 WASD · P2 ARROWS', 'L-STICK'],
        ['LIGHT', 'P1 C · P2 J', 'X / □'],
        ['HEAVY', 'P1 V · P2 K', 'Y / △'],
        ['BLOCK', 'P1 B · P2 L', 'LB / RB'],
        ['JUMP', 'P1 SPACE · P2 I', 'A / ✕'],
        ['ROLL', 'P1 SHIFT · P2 U', 'B / ○'],
      ];

function Controls({ mode }: { mode: Mode }) {
  return (
    <div className="mx-auto mt-5 grid max-w-[640px] grid-cols-3 gap-x-4 gap-y-1 border-t border-white/15 pt-3 text-[11px] text-white/70">
      <span className="text-white/40">ACTION</span>
      <span className="text-white/40">KEYBOARD</span>
      <span className="text-white/40">GAMEPAD</span>
      {keyRows(mode).map(([a, k, p]) => (
        <span key={a} className="contents">
          <span className="text-white">{a}</span>
          <span>{k}</span>
          <span>{p}</span>
        </span>
      ))}
      <span className="col-span-3 mt-1 text-white/50">Tap light in rhythm for jab → cross → slash → hook. Jump clears light attacks, roll goes through anything.</span>
    </div>
  );
}

function ControlsStrip({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 bg-black/45 px-3 py-1 text-[10px] tracking-wider text-white/75">
      {keyRows(mode).map(([a, k]) => (
        <span key={a}>
          <span className="text-[#ffe100]">{k}</span> {a}
        </span>
      ))}
    </div>
  );
}

const CSS = `
.npga-title { font-family: var(--font-display); font-weight: 900; font-style: italic; letter-spacing: -0.02em; text-shadow: 3px 3px 0 #ff2bd6, -2px -2px 0 #18e8ff; }
.npga-skew { transform: skewX(-18deg); }
.npga-card { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); outline: 3px solid transparent; outline-offset: -3px; }
.npga-you { outline-color: #ff2bd6; box-shadow: 0 0 0 3px #ff2bd6, 0 0 28px #ff2bd6aa; }
.npga-them { outline-color: #18e8ff; box-shadow: 0 0 0 3px #18e8ff, 0 0 28px #18e8ffaa; }
.npga-you.npga-them { box-shadow: 0 0 0 3px #ff2bd6, 0 0 0 6px #18e8ff, 0 0 28px #ff2bd6aa; }
.npga-tag { font-family: var(--font-display); font-weight: 900; font-style: italic; transform: translateX(-50%) skewX(-12deg); }
.npga-go { font-family: var(--font-display); font-weight: 900; font-style: italic; color: #000; background: #ffe100; transform: skewX(-14deg); box-shadow: 5px 5px 0 #ff2bd6; transition: transform .1s, box-shadow .1s; }
.npga-go:hover { transform: skewX(-14deg) translate(-2px,-2px); box-shadow: 7px 7px 0 #ff2bd6; }
.npga-ghost { font-family: var(--font-display); font-weight: 900; font-style: italic; color: #fff; border: 2px solid #ffffffaa; background: #0008; transform: skewX(-14deg); }
.npga-ghost:hover { border-color: #18e8ff; color: #18e8ff; }
.npga-seg { font-family: var(--font-display); font-style: italic; font-weight: 900; color: #fffc; border: 1px solid #fff4; background: #0007; transform: skewX(-12deg); }
.npga-seg-on { background: #ff2bd6; color: #fff; border-color: #ff2bd6; }
.npga-port { border: 3px solid; background: radial-gradient(circle at 50% 30%, #3a1840, #08040c); transform: skewX(-8deg); }
.npga-bar { background: #000a; border: 2px solid #fff; transform: skewX(-24deg); box-shadow: 0 0 0 2px #000, 0 0 14px #ff2bd655; overflow: hidden; }
.npga-bar-r { transform: skewX(24deg); }
.npga-energy { border: 1px solid #ffe10066; background: linear-gradient(90deg, #ff2bd61a, #0009, #18e8ff1a); transform: skewX(-6deg); }
.npga-name { font-family: var(--font-display); font-weight: 900; font-style: italic; text-shadow: 2px 2px 0 #000; }
.npga-pip { width: 12px; height: 12px; border: 2px solid #fff; transform: rotate(45deg); background: #0008; display: inline-block; }
.npga-pip-on { background: #ffe100; box-shadow: 0 0 10px #ffe100; }
.npga-timer { font-family: var(--font-display); font-weight: 900; font-style: italic; line-height: 1; text-shadow: 3px 3px 0 #000, 0 0 18px #ff2bd688; }
.npga-callout { font-family: var(--font-display); font-weight: 900; font-style: italic; color: #fff; font-size: clamp(44px, 9vw, 120px); line-height: .9; letter-spacing: -0.02em;
  text-shadow: 5px 5px 0 #ff2bd6, -3px -3px 0 #18e8ff, 0 0 40px #ff2bd6; animation: npga-in 1.25s cubic-bezier(.2,1.4,.4,1) forwards; white-space: nowrap; }
.npga-callout-big { color: #ffe100; font-size: clamp(64px, 14vw, 190px); }
@keyframes npga-in {
  0% { transform: scale(2.4) skewX(-14deg); opacity: 0; filter: blur(8px); }
  14% { transform: scale(1) skewX(-14deg); opacity: 1; filter: blur(0); }
  78% { transform: scale(1.06) skewX(-14deg); opacity: 1; }
  100% { transform: scale(1.12) skewX(-14deg); opacity: 0; }
}
`;
