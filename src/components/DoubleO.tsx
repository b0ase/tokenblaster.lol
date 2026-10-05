'use client';

/**
 * Double-O Kweg: a GoldenEye-style first-person spy shooter. Special Agent Kweg Wong fires
 * PNEE (or any token from the wallet) at cartoon parody villains across three missions.
 * PRACTICE is free play, nothing on chain. LIVE: every bullet is one whole token in a real
 * transaction (tagged doubleo/<level>/shot), queued and sent in batches like the Arena.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { fireballTexture, makeSfx, type Sfx } from '@/lib/arenaArt';
import { buildGun, GUNS, loadArenaAssets, Monster, MONSTERS, type ArenaAssets, type HeldGun } from '@/lib/arenaHD';
import { TOKEN_FEE } from '@/lib/gun';
import { iconUrl } from '@/lib/tokens';
import { useBlaster } from '@/lib/useBlaster';
import { buildRig, CAST, nameTag, poseRig, signMesh, type CastDef, type Kind, type Rig } from '@/lib/doubleo/characters';
import { Grid } from '@/lib/doubleo/grid';
import { LEVELS, SIZE, type Level } from '@/lib/doubleo/levels';
import { AGENT } from '@/lib/doubleo/names';
import { WalletChooser } from './WalletChooser';

const WALL_H = 3.6;
const EYE = 1.6;
const MAX_HEAT = 200; // shots queued for the chain before the gun overheats
const BATCH = 25; // token shots per request
const FIRE_MS = 170;
const isPhone = () => typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent);

type Screen = 'menu' | 'play' | 'paused' | 'debrief' | 'failed';
type Hud = {
  health: number;
  armor: number;
  obj: string;
  objIdx: number;
  objTotal: number;
  progress: number | null;
  bosses: { name: string; hp: number; max: number }[];
  shots: number;
  hits: number;
  kills: number;
  onChain: number;
  heat: number;
  last: string | null;
  dist: number;
  arrow: number; // radians, 0 = straight ahead
};
type Debrief = { level: number; secs: number; shots: number; hits: number; kills: number; onChain: number; live: boolean; sym: string };
type Engine = { start: (i: number, live: boolean) => void; resume: () => void; abort: () => void };

const HUD0: Hud = { health: 100, armor: 0, obj: '', objIdx: 0, objTotal: 0, progress: null, bosses: [], shots: 0, hits: 0, kills: 0, onChain: 0, heat: 0, last: null, dist: 0, arrow: 0 };

const loadDone = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('doubleo:done') ?? '[]') as string[];
  } catch {
    return [];
  }
};
const saveDone = (ids: string[]) => {
  try {
    localStorage.setItem('doubleo:done', JSON.stringify(ids));
  } catch {
    /* private mode */
  }
};

export function DoubleO() {
  const b = useBlaster();
  const mount = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const input = useRef({ sx: 0, sy: 0, fire: false });
  const [screen, setScreen] = useState<Screen>('menu');
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState(false);
  const [hud, setHud] = useState<Hud>(HUD0);
  const [loading, setLoading] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hurt, setHurt] = useState(false);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [jam, setJam] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [touchUi, setTouchUi] = useState(false);
  const [tokenLoad, setTokenLoad] = useState(50);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setDone(loadDone());
      setTouchUi(isPhone() || window.matchMedia?.('(pointer: coarse)').matches);
    });
  }, []);
  useEffect(() => {
    if (!jam) return;
    const t = setTimeout(() => setJam(null), 4000);
    return () => clearTimeout(t);
  }, [jam]);

  // Ammo: always whole tokens. Pick PNEE automatically when the wallet has it.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!b.tokens.length) return;
    if (!autoPicked.current) {
      autoPicked.current = true;
      const pnee = b.tokens.find((t) => /pnee/i.test(t.sym));
      if (pnee) b.setToken(pnee);
    }
    if (b.mode !== 'tokens') b.setMode('tokens');
  }, [b.tokens, b.mode, b]);

  const sym = b.token?.sym ?? 'PNEE';
  const icon = iconUrl(b.token?.icon ?? null);
  const heldTok = b.tokens.find((t) => t.id === b.token?.id);
  const armed = Boolean(b.token) && b.tokenAmmo >= 1 && b.ammo >= TOKEN_FEE;
  const live_ = useRef({ armed, ammo: b.ammo, tokens: b.tokenAmmo, fireTokens: b.fireTokens, icon, sym });
  useEffect(() => {
    live_.current = { armed, ammo: b.ammo, tokens: b.tokenAmmo, fireTokens: b.fireTokens, icon, sym };
  }, [armed, b.ammo, b.tokenAmmo, b.fireTokens, icon, sym]);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const phone = isPhone();
    let disposed = false;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Full device resolution; the quality governor below steps down if frames get slow.
    const qualities = [
      { ratio: Math.min(window.devicePixelRatio, 2), shadows: true },
      { ratio: Math.min(window.devicePixelRatio, 1.5), shadows: true },
      { ratio: 1, shadows: false },
    ];
    let quality = phone ? 1 : 0;
    renderer.setPixelRatio(qualities[quality].ratio);
    renderer.shadowMap.enabled = qualities[quality].shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 140);
    scene.add(camera);
    // MSAA render target so the post-processing chain keeps antialiasing.
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 0.97);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const hemi = new THREE.HemisphereLight('#ffffff', '#202020', 0.6);
    scene.add(hemi);
    // Environment reflections (studio room, prefiltered).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.35;
    const torch = new THREE.PointLight('#fff0dc', 8, 16, 1.5);
    scene.add(torch);
    // Soft shadows from a ceiling spotlight that follows the agent.
    const key = new THREE.SpotLight('#fff4e0', 32, 26, 0.9, 0.6, 1.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 4;
    key.shadow.bias = -0.0004;
    key.shadow.camera.near = 0.3;
    key.shadow.camera.far = 26;
    scene.add(key);
    scene.add(key.target);
    const muzzleLight = new THREE.PointLight('#ffe08a', 0, 9, 2);
    scene.add(muzzleLight);

    // ── The gadget gun, held by Kweg's tux sleeve ──
    const gunHolder = new THREE.Group();
    camera.add(gunHolder);
    const gunDef = { ...(GUNS.find((g) => g.id === 'plasmarifle') ?? GUNS[0]), fireMs: FIRE_MS };
    let held: HeldGun | null = null;
    const gunRest = new THREE.Vector3(...gunDef.pos);
    {
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.42), new THREE.MeshStandardMaterial({ color: '#0d0d10', roughness: 0.7 }));
      sleeve.position.set(0.04, -0.13, 0.12);
      sleeve.rotation.x = 0.15;
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.05), new THREE.MeshStandardMaterial({ color: '#f4f4f4' }));
      cuff.position.set(0.04, -0.13, -0.1);
      for (const m of [sleeve, cuff]) {
        m.renderOrder = 10;
        gunHolder.add(m);
      }
    }
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireballTexture(), color: new THREE.Color(3, 2.6, 1.4), toneMapped: false, transparent: true, depthWrite: false, depthTest: false }));
    flash.scale.setScalar(0.25);
    flash.visible = false;
    flash.renderOrder = 11;
    gunHolder.add(flash);

    // ── PNEE coins: the token's icon on a gold coin (or "PNEE" stamped on it) ──
    const coinCanvas = document.createElement('canvas');
    coinCanvas.width = coinCanvas.height = 128;
    const coinTex = new THREE.CanvasTexture(coinCanvas);
    coinTex.colorSpace = THREE.SRGBColorSpace;
    const paintCoin = (img: HTMLImageElement | null, label: string) => {
      const c = coinCanvas.getContext('2d')!;
      c.clearRect(0, 0, 128, 128);
      const g = c.createRadialGradient(44, 40, 8, 64, 64, 64);
      g.addColorStop(0, '#fff3b0');
      g.addColorStop(0.6, '#e2a72e');
      g.addColorStop(1, '#8a5a12');
      c.fillStyle = g;
      c.beginPath();
      c.arc(64, 64, 62, 0, Math.PI * 2);
      c.fill();
      if (img) {
        c.save();
        c.beginPath();
        c.arc(64, 64, 52, 0, Math.PI * 2);
        c.clip();
        c.drawImage(img, 12, 12, 104, 104);
        c.restore();
      } else {
        c.strokeStyle = '#7a4c0c';
        c.lineWidth = 4;
        c.beginPath();
        c.arc(64, 64, 50, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = '#6a3e08';
        c.font = 'bold 30px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label.slice(0, 5), 64, 66);
      }
      coinTex.needsUpdate = true;
    };
    paintCoin(null, 'PNEE');
    let coinSrc: string | null = null;
    let coinSym = 'PNEE';
    const rimMat = new THREE.MeshStandardMaterial({ color: '#d9a332', metalness: 0.9, roughness: 0.3 });
    const faceMat = new THREE.MeshStandardMaterial({ map: coinTex, metalness: 0.5, roughness: 0.35, emissive: new THREE.Color('#3a2600'), emissiveMap: coinTex });
    const coinGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.025, 20);
    const coinMats = [rimMat, faceMat, faceMat];
    type Flyer = { m: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; target: Actor | null; point: THREE.Vector3 };
    const flyers: Flyer[] = [];
    type Loose = { m: THREE.Mesh; v: THREE.Vector3; spin: number; born: number };
    const loose: Loose[] = [];
    const burstCoins = (p: THREE.Vector3, n: number) => {
      for (let i = 0; i < n && loose.length < 120; i++) {
        const m = new THREE.Mesh(coinGeo, coinMats);
        m.position.copy(p);
        m.scale.setScalar(0.8);
        scene.add(m);
        loose.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4), spin: 8 + Math.random() * 10, born: performance.now() });
      }
    };

    // ── Popups: REKT!, quips, objective notices ──
    type Pop = { s: THREE.Sprite; born: number; life: number; rise: number };
    const pops: Pop[] = [];
    const popup = (text: string, at: THREE.Vector3, color = '#ffd84a', big = false) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 96;
      const x = c.getContext('2d')!;
      x.font = `bold ${big ? 64 : 44}px monospace`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.lineWidth = 8;
      x.strokeStyle = '#000';
      x.strokeText(text, 256, 50, 500);
      x.fillStyle = color;
      x.fillText(text, 256, 50, 500);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
      s.scale.set(big ? 3.6 : 2.8, big ? 0.68 : 0.52, 1);
      s.renderOrder = 20;
      s.position.copy(at);
      scene.add(s);
      pops.push({ s, born: performance.now(), life: big ? 1600 : 1300, rise: 0.9 });
    };

    // ── Enemy projectiles ──
    const shotMats = new Map<string, THREE.SpriteMaterial>();
    const fireTex = fireballTexture();
    const shotMat = (color: string) => {
      let m = shotMats.get(color);
      if (!m) {
        m = new THREE.SpriteMaterial({ map: fireTex, color: new THREE.Color(color).multiplyScalar(3), toneMapped: false, transparent: true, depthWrite: false });
        shotMats.set(color, m);
      }
      return m;
    };
    type Bolt = { s: THREE.Sprite; v: THREE.Vector3; dmg: number; born: number; from: Actor };
    const bolts: Bolt[] = [];

    // ── State ──
    let assets: ArenaAssets | null = null;
    let sfx: Sfx | null = null;
    let lvlGroup: THREE.Group | null = null;
    let grid: Grid | null = null;
    let L: Level = LEVELS[0];
    let lvlIdx = 0;
    let liveMode = false;
    let running = false;
    let health = 100;
    let armor = 0;
    let objIdx = 0;
    let progress = 0;
    let elapsed = 0;
    let stats = { shots: 0, hits: 0, kills: 0, onChain: 0 };
    let yaw = 0;
    let pitch = 0;
    let walkPhase = 0;
    let recoil = 0;
    let lastShot = 0;
    const walls: THREE.Object3D[] = []; // shot blockers
    type DoorMesh = { key: string; mesh: THREE.Mesh };
    const doorMeshes: DoorMesh[] = [];
    type Pickup = { mesh: THREE.Object3D; kind: '+' | 'a'; taken: boolean };
    const pickups: Pickup[] = [];
    let beacon: THREE.Group | null = null;

    type Actor = {
      cast: CastDef;
      kind: Kind | 'hazmat';
      rig: Rig | null;
      mon: Monster | null;
      root: THREE.Group;
      hitbox: THREE.Mesh;
      hp: number;
      max: number;
      state: 'patrol' | 'alert' | 'dying';
      seen: boolean;
      seenCheck: number;
      lastSeen: number;
      goal: [number, number] | null;
      wait: number;
      repath: number;
      step: [number, number] | null;
      nextShot: number;
      aimAt: number; // telegraph: fire when now passes this
      quipAt: number;
      dyingAt: number;
      wobble: number;
      buyAt: number; // MICHAEL keeps buying armour
      summoned: boolean;
      tag: THREE.Sprite | null;
    };
    const actors: Actor[] = [];

    const disposeGroup = (g: THREE.Object3D) => {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m.geometry !== coinGeo) m.geometry.dispose();
      });
    };

    const hazmatDef = MONSTERS.find((m) => m.id === 'hazmat');
    const spawnActor = (kind: Kind | 'hazmat', x: number, z: number) => {
      let rig: Rig | null = null;
      let mon: Monster | null = null;
      let root: THREE.Group;
      let hitbox: THREE.Mesh;
      const cast: CastDef = kind === 'hazmat' ? { ...CAST.bot, name: 'Hazmat Tech', hp: 4, speed: 2.4 } : CAST[kind];
      if (kind === 'hazmat' && assets && hazmatDef && assets.monsters.hazmat) {
        mon = new Monster(hazmatDef, assets.monsters.hazmat);
        mon.play('walk');
        root = mon.root;
        hitbox = mon.hitbox;
      } else {
        rig = buildRig(kind === 'hazmat' ? 'bot' : kind);
        root = rig.root;
        hitbox = rig.hitbox;
      }
      const c = grid!.centre(x, z);
      root.position.set(c.x, 0, c.z);
      root.rotation.y = Math.random() * Math.PI * 2;
      let tag: THREE.Sprite | null = null;
      if (cast.boss) {
        tag = nameTag(cast.name);
        tag.position.y = cast.height + 0.45;
        root.add(tag);
      }
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o !== hitbox) o.castShadow = true;
      });
      lvlGroup!.add(root);
      const now = performance.now();
      actors.push({ cast, kind, rig, mon, root, hitbox, hp: cast.hp, max: cast.hp, state: 'patrol', seen: false, seenCheck: 0, lastSeen: 0, goal: null, wait: now + Math.random() * 1500, repath: 0, step: null, nextShot: 0, aimAt: 0, quipAt: 0, dyingAt: 0, wobble: 0, buyAt: now + 6000, summoned: false, tag });
    };

    // ── Build a level ──
    const buildLevel = (i: number) => {
      if (!assets) return;
      if (lvlGroup) {
        scene.remove(lvlGroup);
        disposeGroup(lvlGroup);
      }
      for (const a of [...flyers.map((f) => f.m), ...loose.map((l) => l.m), ...pops.map((p) => p.s), ...bolts.map((x) => x.s)]) scene.remove(a);
      flyers.length = loose.length = pops.length = bolts.length = 0;
      actors.length = walls.length = doorMeshes.length = pickups.length = 0;
      lvlIdx = i;
      L = LEVELS[i];
      grid = new Grid(L);
      const g = new THREE.Group();
      lvlGroup = g;
      scene.add(g);
      const T = L.theme;
      scene.background = new THREE.Color(T.fog);
      scene.fog = new THREE.Fog(T.fog, 14, 46);
      hemi.intensity = T.ambient;
      const W = grid.w * SIZE;
      const H = grid.h * SIZE;

      // Floor + ceiling.
      let floorMat: THREE.MeshStandardMaterial;
      if (T.floor) floorMat = assets.material(T.floor, [grid.w, grid.h]);
      else {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const x = c.getContext('2d')!;
        x.fillStyle = T.carpet ?? '#400';
        x.fillRect(0, 0, 64, 64);
        x.strokeStyle = '#c9a227';
        x.lineWidth = 2;
        x.beginPath();
        x.moveTo(32, 4);
        x.lineTo(60, 32);
        x.lineTo(32, 60);
        x.lineTo(4, 32);
        x.closePath();
        x.stroke();
        x.fillStyle = '#2a060a';
        x.fillRect(28, 28, 8, 8);
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(grid.w, grid.h);
        t.colorSpace = THREE.SRGBColorSpace;
        floorMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
      }
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(W / 2, 0, H / 2);
      g.add(floor);
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: T.ceiling, roughness: 1 }));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(W / 2, WALL_H, H / 2);
      g.add(ceil);

      // Walls, instanced (two materials).
      const wallCells: [number, number][] = [];
      grid.rows.forEach((r, z) => [...r].forEach((c, x) => c === '#' && wallCells.push([x, z])));
      const wallGeo = new THREE.BoxGeometry(SIZE, WALL_H, SIZE);
      const mats = [assets.material(T.wall, [1, 0.9]), assets.material(T.trim, [1, 0.9])];
      const parts = [wallCells.filter(([x, z]) => (x * 7 + z * 3) % 5 !== 0), wallCells.filter(([x, z]) => (x * 7 + z * 3) % 5 === 0)];
      const mtx = new THREE.Matrix4();
      parts.forEach((cells, k) => {
        if (!cells.length) return;
        const im = new THREE.InstancedMesh(wallGeo, mats[k], cells.length);
        cells.forEach(([x, z], n) => {
          mtx.makeTranslation((x + 0.5) * SIZE, WALL_H / 2, (z + 0.5) * SIZE);
          im.setMatrixAt(n, mtx);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.computeBoundingBox();
        g.add(im);
        walls.push(im);
      });

      // Ceiling light panels every few cells (bloom does the glow).
      const panels: [number, number][] = [];
      grid.rows.forEach((r, z) => [...r].forEach((c, x) => c !== '#' && (x + z * 2) % 3 === 0 && panels.push([x, z])));
      const panelIm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.06, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.light).multiplyScalar(2.2), toneMapped: false }), panels.length);
      panels.forEach(([x, z], n) => {
        mtx.makeTranslation((x + 0.5) * SIZE, WALL_H - 0.04, (z + 0.5) * SIZE);
        panelIm.setMatrixAt(n, mtx);
      });
      g.add(panelIm);
      // A few real lights spread over the map.
      const lampCells = panels.filter((_, n) => n % Math.max(1, Math.floor(panels.length / 6)) === 0).slice(0, 6);
      for (const [x, z] of lampCells) {
        const pl = new THREE.PointLight(T.light, 14, 15, 1.4);
        pl.position.set((x + 0.5) * SIZE, WALL_H - 0.4, (z + 0.5) * SIZE);
        g.add(pl);
      }

      // Props.
      const crateMat = assets.material('corrugated_iron_02', [1, 1]);
      const felt = new THREE.MeshStandardMaterial({ color: '#0f5a2c', roughness: 0.9 });
      const gold = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.9, roughness: 0.3 });
      const wood = new THREE.MeshStandardMaterial({ color: '#5a3518', roughness: 0.7 });
      const ice = new THREE.MeshStandardMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.55, roughness: 0.1, emissive: new THREE.Color('#2a6a80') });
      const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, block = true) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        g.add(mesh);
        if (block) walls.push(mesh);
        return mesh;
      };
      grid.rows.forEach((r, z) =>
        [...r].forEach((c, x) => {
          const cx = (x + 0.5) * SIZE;
          const cz = (z + 0.5) * SIZE;
          if (c === 'C') {
            box(SIZE * 0.85, 1.6, SIZE * 0.85, crateMat, cx, 0.8, cz);
            if ((x + z) % 2 === 0) box(SIZE * 0.45, 1, SIZE * 0.45, crateMat, cx + 0.3, 2.1, cz - 0.2);
          } else if (c === 'T') {
            box(SIZE * 0.85, 0.95, SIZE * 0.6, felt, cx, 0.48, cz);
            box(SIZE * 0.9, 0.08, SIZE * 0.65, gold, cx, 0.98, cz, false);
            for (let k = 0; k < 5; k++) {
              const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04 + k * 0.03, 12), k % 2 ? gold : new THREE.MeshStandardMaterial({ color: '#b0141c' }));
              chip.position.set(cx - 0.8 + k * 0.35, 1.06, cz + 0.2);
              g.add(chip);
            }
          } else if (c === 'W') {
            box(SIZE * 0.95, 1.15, SIZE * 0.55, wood, cx, 0.58, cz);
            box(1.2, 0.9, 0.9, ice, cx, 1.6, cz, false);
            const s = signMesh('FROZEN', '#bff4ff', '#0a2a3a');
            s.scale.setScalar(0.45);
            s.position.set(cx, 2.35, cz + 0.2);
            g.add(s);
          } else if (c === '$') {
            box(1.6, 2.3, 1.2, new THREE.MeshStandardMaterial({ color: '#7a1010', metalness: 0.4, roughness: 0.4 }), cx, 1.15, cz);
            const s = signMesh('7 7 7', '#ffe070', '#200000');
            s.scale.setScalar(0.4);
            s.position.set(cx, 1.6, cz + 0.62);
            g.add(s);
          } else if (c === 'V') {
            const iou = signMesh('IOU', '#3a2600', '#e8c050');
            for (let k = 0; k < 6; k++) {
              const y = k < 3 ? 0.35 : k < 5 ? 1.05 : 1.75;
              const off = k < 3 ? (k - 1) * 1.1 : k < 5 ? (k - 3.5) * 1.1 : 0;
              box(1, 0.7, 1.6, gold, cx + off, y, cz, k === 0);
            }
            iou.scale.setScalar(0.4);
            iou.position.set(cx, 1.05, cz + 0.82);
            g.add(iou);
          } else if (c === '+' || c === 'a') {
            const p = new THREE.Group();
            const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.45), new THREE.MeshStandardMaterial({ color: c === '+' ? '#f4f4f4' : '#2a4a9a', metalness: c === 'a' ? 0.6 : 0 }));
            p.add(base);
            const mark = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(c === '+' ? '#ff2020' : '#60c0ff').multiplyScalar(3), toneMapped: false }));
            p.add(mark);
            if (c === '+') {
              const v = mark.clone();
              v.rotation.z = Math.PI / 2;
              v.scale.set(0.5, 1, 1);
              p.add(v);
            }
            p.position.set(cx, 0.6, cz);
            g.add(p);
            pickups.push({ mesh: p, kind: c, taken: false });
          } else if (c === 'X') {
            const pad = new THREE.Mesh(new THREE.BoxGeometry(SIZE * 0.8, 0.06, SIZE * 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#40ff80').multiplyScalar(1.6), toneMapped: false }));
            pad.position.set(cx, 0.03, cz);
            g.add(pad);
            const s = nameTag('EXIT', '#60ff90');
            s.position.set(cx, 2.6, cz);
            g.add(s);
          }
        }),
      );

      // Doors.
      const doorMat = assets.material('painted_metal_shutter', [1, 0.9]);
      const lockedMat = new THREE.MeshStandardMaterial({ color: '#7a1010', metalness: 0.6, roughness: 0.4 });
      for (const [key, d] of grid.doors) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(d.alongX ? SIZE : 0.3, WALL_H, d.alongX ? 0.3 : SIZE), d.locked ? lockedMat : doorMat);
        m.position.set((d.x + 0.5) * SIZE, WALL_H / 2, (d.z + 0.5) * SIZE);
        g.add(m);
        walls.push(m);
        doorMeshes.push({ key, mesh: m });
      }

      // Signs.
      for (const s of L.signs) {
        const m = signMesh(s.text, '#ffe8a0', '#140c06');
        const n = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s.face];
        m.position.set((s.at[0] + 0.5) * SIZE + n[0] * (SIZE / 2 + 0.03), 2.6, (s.at[1] + 0.5) * SIZE + n[1] * (SIZE / 2 + 0.03));
        m.rotation.y = { n: Math.PI, s: 0, e: Math.PI / 2, w: -Math.PI / 2 }[s.face];
        g.add(m);
      }

      // Sharpest texture filtering the GPU offers; walls and props cast and catch shadows.
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t && t.anisotropy !== maxAniso) {
          t.anisotropy = maxAniso;
          t.needsUpdate = true;
        }
        if (mat.isMeshStandardMaterial) {
          m.receiveShadow = true;
          m.castShadow = m !== floor && m !== ceil;
        }
      });

      // Objective beacon.
      beacon = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, WALL_H, 20, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('#40ff90').multiplyScalar(1.5), transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      beam.position.y = WALL_H / 2;
      beacon.add(beam);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#60ff90').multiplyScalar(3), toneMapped: false }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.1;
      beacon.add(ring);
      g.add(beacon);

      // Cast.
      const kinds: Record<string, Kind | 'hazmat'> = { g: 'bot', p: 'goon', h: 'hazmat', K: 'kingpin', U: 'custodian', L: 'hoarder' };
      grid.rows.forEach((r, z) => [...r].forEach((c, x) => kinds[c] && spawnActor(kinds[c], x, z)));

      // Player.
      const [sx, sz] = grid.find('S')[0];
      const s = grid.centre(sx, sz);
      camera.position.set(s.x, EYE, s.z);
      // Face the most open direction.
      const dirs: [number, number, number][] = [
        [1, 0, -Math.PI / 2],
        [0, 1, Math.PI],
        [-1, 0, Math.PI / 2],
        [0, -1, 0],
      ];
      yaw = (dirs.find(([dx, dz]) => grid!.passable(sx + dx, sz + dz)) ?? dirs[0])[2];
      pitch = 0;
      health = 100;
      armor = 0;
      objIdx = 0;
      progress = 0;
      elapsed = 0;
      stats = { shots: 0, hits: 0, kills: 0, onChain: 0 };
      queue.length = 0;
      heat = 0;
      pushHud();
    };

    const objTarget = (): THREE.Vector3 | null => {
      const o = L.objectives[objIdx];
      if (!o || !grid) return null;
      if (o.kind === 'boss') {
        const boss = actors.filter((a) => a.cast.boss && a.state !== 'dying').sort((a, b2) => a.root.position.distanceTo(camera.position) - b2.root.position.distanceTo(camera.position))[0];
        return boss ? boss.root.position.clone() : null;
      }
      const [x, z] = grid.find(o.at)[0] ?? [0, 0];
      const c = grid.centre(x, z);
      return new THREE.Vector3(c.x, 0, c.z);
    };

    const pushHud = () => {
      const tgt = objTarget();
      let dist = 0;
      let arrow = 0;
      if (tgt) {
        const dx = tgt.x - camera.position.x;
        const dz = tgt.z - camera.position.z;
        dist = Math.hypot(dx, dz);
        const ang = Math.atan2(-dx, -dz); // yaw that would face the target
        arrow = Math.atan2(Math.sin(ang - yaw), Math.cos(ang - yaw));
      }
      const o = L.objectives[objIdx];
      setHud((h) => ({
        ...h,
        health: Math.ceil(health),
        armor: Math.ceil(armor),
        obj: o?.text ?? 'Mission complete',
        objIdx,
        objTotal: L.objectives.length,
        progress: o?.kind === 'plant' && progress > 0 ? progress : null,
        bosses: actors.filter((a) => a.cast.boss && (a.hp > 0 || a.state !== 'dying')).map((a) => ({ name: a.cast.name, hp: Math.max(0, a.hp), max: a.max })),
        shots: stats.shots,
        hits: stats.hits,
        kills: stats.kills,
        onChain: stats.onChain,
        heat,
        dist,
        arrow,
      }));
    };

    const damagePlayer = (n: number) => {
      if (!running) return;
      const soak = Math.min(armor, n * 0.6);
      armor -= soak;
      health = Math.max(0, health - (n - soak));
      sfx?.hurt();
      setHurt(true);
      setTimeout(() => setHurt(false), 130);
      if (health <= 0) {
        running = false;
        sfx?.dead();
        input.current.fire = false;
        trigger = false;
        if (document.pointerLockElement) document.exitPointerLock();
        setScreen('failed');
      }
    };

    const completeObjective = () => {
      const o = L.objectives[objIdx];
      sfx?.pickup();
      const at = camera.position.clone().add(new THREE.Vector3(-Math.sin(yaw) * 3, 0.4, -Math.cos(yaw) * 3));
      popup(o.kind === 'plant' ? (L.id === 'tower' ? 'WITHDRAWALS UNFROZEN!' : L.id === 'vault' ? 'VAULT CRACKED!' : 'NODE PLANTED!') : 'OBJECTIVE COMPLETE', at, '#60ff90', true);
      if (o.kind === 'plant' && grid) {
        const [x, z] = grid.find(o.at)[0];
        const c = grid.centre(x, z);
        const node = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color('#40ff90').multiplyScalar(2), toneMapped: false }));
        node.position.set(c.x, 0.4, c.z);
        lvlGroup?.add(node);
      }
      objIdx++;
      progress = 0;
      // Locked doors open once everything before the boss fight is done.
      const next = L.objectives[objIdx];
      if (grid && next?.kind === 'boss') for (const d of grid.doors.values()) d.locked = false;
      if (objIdx >= L.objectives.length) {
        running = false;
        trigger = false;
        input.current.fire = false;
        if (document.pointerLockElement) document.exitPointerLock();
        const ids = Array.from(new Set([...loadDone(), L.id]));
        saveDone(ids);
        setDone(ids);
        setDebrief({ level: lvlIdx, secs: elapsed, shots: stats.shots, hits: stats.hits, kills: stats.kills, onChain: stats.onChain, live: liveMode, sym: live_.current.sym });
        setScreen('debrief');
      }
    };

    // ── Chain: queue of token shots, sent in batches (jam-free retry, like the Arena) ──
    type Shot = { extra: string[] };
    const queue: Shot[] = [];
    let heat = 0;
    let draining = false;
    let jammedUntil = 0;
    let fails = 0;
    let n = 0;
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (queue.length) {
        const batch = queue.slice(0, BATCH);
        try {
          const txids = await live_.current.fireTokens(n + 1, batch.map((q) => q.extra));
          n += txids.length;
          queue.splice(0, txids.length);
          stats.onChain += txids.length;
          setHud((h) => ({ ...h, onChain: stats.onChain, last: txids[txids.length - 1] ?? h.last }));
          setRecent((r) => [...[...txids].reverse(), ...r].slice(0, 5));
          setChainError(null);
          fails = 0;
          if (!txids.length) throw new Error('Out of ammo.');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const out = /out of|empty|no tokens|no sats|load/i.test(msg);
          if (!out && ++fails <= 3) {
            await new Promise((ok) => setTimeout(ok, 1000 * fails));
            continue;
          }
          fails = 0;
          setChainError(msg);
          queue.length = 0;
          jammedUntil = performance.now() + 4000;
          setJam(msg);
          break;
        }
        heat = queue.length;
        setHud((h) => ({ ...h, heat }));
      }
      heat = queue.length;
      setHud((h) => ({ ...h, heat }));
      draining = false;
    };

    // ── Shooting ──
    const raycaster = new THREE.Raycaster();
    const hitActor = (a: Actor, point: THREE.Vector3, now: number) => {
      if (a.state === 'dying') return;
      a.hp--;
      a.wobble = now;
      sfx?.hit();
      burstCoins(point, a.cast.boss ? 3 : 2);
      if (a.state === 'patrol') {
        a.state = 'alert';
        a.lastSeen = now;
      }
      if (a.rig?.button && a.rig.button.parent) {
        // The WITHDRAW button pops right off.
        const bt = a.rig.button;
        const wp = bt.getWorldPosition(new THREE.Vector3());
        bt.removeFromParent();
        bt.position.copy(wp);
        bt.scale.setScalar(a.cast.height / 1.9);
        scene.add(bt);
        bt.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3);
        bt.userData.born = now;
        popup('WITHDRAW BUTTON: GONE', wp.clone().setY(a.cast.height + 1.2), '#ff8080');
      }
      if (a.cast.boss && now > a.quipAt && a.hp > 0) {
        a.quipAt = now + 2200;
        popup(a.cast.quip[Math.floor(Math.random() * a.cast.quip.length)], a.root.position.clone().setY(a.cast.height + 0.9), '#ffffff');
      }
      if (a.kind === 'kingpin' && !a.summoned && a.hp < a.max / 2 && grid) {
        a.summoned = true;
        popup('SECURITY!!', a.root.position.clone().setY(a.cast.height + 1.4), '#ff6060', true);
        const [cx, cz] = grid.cell(a.root.position.x, a.root.position.z);
        for (const [dx, dz] of [
          [2, 0],
          [-2, 0],
        ])
          if (grid.passable(cx + dx, cz + dz)) {
            spawnActor('goon', cx + dx, cz + dz);
            const g = actors[actors.length - 1];
            g.state = 'alert';
            g.lastSeen = now;
          }
      }
      if (a.hp <= 0) {
        a.state = 'dying';
        a.dyingAt = now;
        stats.kills++;
        sfx?.die();
        burstCoins(point, a.cast.boss ? 24 : 8);
        popup('REKT!', a.root.position.clone().setY(a.cast.height + 0.6), '#ff4040', true);
        if (a.tag) a.tag.visible = false;
      }
    };

    const shoot = (now: number) => {
      if (!running || now - lastShot < FIRE_MS) return;
      if (now < jammedUntil) {
        if (now - lastShot > 300) {
          lastShot = now;
          sfx?.click();
        }
        return;
      }
      if (liveMode) {
        const Lv = live_.current;
        const canPay = Math.min(Math.floor(Lv.tokens), Math.floor(Lv.ammo / TOKEN_FEE)) - heat;
        if (!Lv.armed || canPay < 1) {
          if (now - lastShot > 300) {
            lastShot = now;
            sfx?.click();
            setEmpty(true);
          }
          return;
        }
        if (heat + 1 > MAX_HEAT) return;
      }
      setEmpty(false);
      lastShot = now;
      sfx?.shoot();
      stats.shots++;
      const from = held ? held.group.localToWorld(held.muzzle.clone()) : camera.position.clone();
      raycaster.setFromCamera(new THREE.Vector2((Math.random() - 0.5) * 0.01, (Math.random() - 0.5) * 0.01), camera);
      const alive = actors.filter((a) => a.state !== 'dying');
      const hit = raycaster.intersectObjects([...walls, ...alive.map((a) => a.hitbox)], false)[0];
      const end = hit ? hit.point.clone() : camera.position.clone().addScaledVector(raycaster.ray.direction, 45);
      const target = hit ? (alive.find((a) => a.hitbox === hit.object) ?? null) : null;
      if (target) stats.hits++;
      const m = new THREE.Mesh(coinGeo, coinMats);
      m.position.copy(from);
      scene.add(m);
      flyers.push({ m, from: from.clone(), to: end, t: 0, dur: Math.max(0.05, from.distanceTo(end) / 50), target, point: end.clone() });
      // Noise wakes up anyone nearby.
      for (const a of actors)
        if (a.state === 'patrol' && a.root.position.distanceTo(camera.position) < 14) {
          a.state = 'alert';
          a.lastSeen = now;
        }
      if (liveMode) {
        queue.push({ extra: ['doubleo', L.id, 'shot'] });
        heat = queue.length;
        void drain();
      }
      flash.visible = true;
      flash.material.rotation = Math.random() * Math.PI;
      muzzleLight.intensity = 14;
      recoil = 0.6;
      setHud((h) => ({ ...h, shots: stats.shots, hits: stats.hits, heat }));
    };

    // ── Input ──
    const keys = new Set<string>();
    let trigger = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keydown') keys.add(e.code);
      else keys.delete(e.code);
      if (e.code === 'Space') {
        trigger = e.type === 'keydown';
        if (running) e.preventDefault();
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      yaw -= e.movementX * 0.0022;
      pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0022));
    };
    const onDown = () => {
      trigger = true;
      if (running && document.pointerLockElement !== renderer.domElement && !phone) void Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(() => undefined);
    };
    const onUp = () => (trigger = false);
    let wasLocked = false;
    const onLock = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (wasLocked && !locked && running) {
        running = false;
        trigger = false;
        setScreen('paused');
      }
      wasLocked = locked;
    };
    let look: { id: number; x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) if (t.clientX - r.left > r.width * 0.35) look = { id: t.identifier, x: t.clientX, y: t.clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches))
        if (look?.id === t.identifier) {
          yaw -= (t.clientX - look.x) * 0.006;
          pitch = Math.max(-1.2, Math.min(1.2, pitch - (t.clientY - look.y) * 0.006));
          look.x = t.clientX;
          look.y = t.clientY;
        }
    };
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (look?.id === t.identifier) look = null;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('mousemove', onMouse);
    document.addEventListener('pointerlockchange', onLock);
    renderer.domElement.addEventListener('mousedown', onDown);
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);

    const lockPointer = () => {
      if (phone) return;
      try {
        void Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(() => undefined);
      } catch {
        /* refused: arrows still turn */
      }
    };
    engine.current = {
      start: (i, isLive) => {
        if (!assets) return;
        if (!sfx) sfx = makeSfx();
        sfx?.resume();
        liveMode = isLive;
        buildLevel(i);
        running = true;
        lastTick = performance.now();
        setScreen('play');
        setDebrief(null);
        setRecent([]);
        setHud((h) => ({ ...h, onChain: 0, last: null }));
        lockPointer();
      },
      resume: () => {
        if (!grid || health <= 0) return;
        sfx?.resume();
        running = true;
        lastTick = performance.now();
        setScreen('play');
        lockPointer();
      },
      abort: () => {
        running = false;
        setScreen('menu');
      },
    };

    // ── AI ──
    const moveActor = (a: Actor, dx: number, dz: number) => {
      if (!grid) return;
      const p = a.root.position;
      const pad = 0.45;
      const nx = p.x + dx;
      const nz = p.z + dz;
      if (!grid.solidAt(nx + Math.sign(dx) * pad, p.z)) p.x = nx;
      if (!grid.solidAt(p.x, nz + Math.sign(dz) * pad)) p.z = nz;
    };
    const fireVolley = (a: Actor, now: number) => {
      const from = a.rig ? a.rig.muzzle.getWorldPosition(new THREE.Vector3()) : a.root.position.clone().setY(1.3);
      const aim = camera.position.clone().setY(camera.position.y - 0.25).sub(from).normalize();
      const nShots = a.cast.boss && a.hp < a.max / 2 ? a.cast.volley + 1 : a.cast.volley;
      for (let i = 0; i < nShots; i++) {
        const spread = (i - (nShots - 1) / 2) * 0.13 + (Math.random() - 0.5) * 0.06;
        const dir = aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
        dir.y += (Math.random() - 0.5) * 0.03;
        const s = new THREE.Sprite(shotMat(a.cast.shotColor));
        s.scale.setScalar(a.kind === 'hoarder' ? 0.22 : 0.3);
        s.position.copy(from);
        scene.add(s);
        bolts.push({ s, v: dir.multiplyScalar(a.cast.shotSpeed), dmg: a.cast.damage, born: now, from: a });
      }
      if (a.kind === 'custodian' && now > a.quipAt) {
        a.quipAt = now + 5000;
        popup(a.cast.quip[0], a.root.position.clone().setY(a.cast.height + 0.9), '#ffffff');
      }
      sfx?.fireball();
    };
    const thinkActor = (a: Actor, dt: number, now: number) => {
      if (!grid) return;
      const p = a.root.position;
      if (a.state === 'dying') {
        const t = (now - a.dyingAt) / 1000;
        if (a.cast.boss) {
          // Comic exit: spin and float away.
          a.root.position.y = t * t * 2.2;
          a.root.rotation.y += dt * (4 + t * 6);
          if (t > 3) a.root.visible = false;
        } else {
          a.root.rotation.x = 0;
          const tipTo = -Math.PI / 2;
          const body = a.rig ? a.rig.body : a.mon!.body;
          body.rotation.x = Math.max(tipTo, body.rotation.x - dt * 5);
          if (t > 2.5) a.root.position.y -= dt * 0.8;
          if (t > 4) a.root.visible = false;
        }
        a.mon?.mixer.update(dt * 0.3);
        return;
      }
      const dx = camera.position.x - p.x;
      const dz = camera.position.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (now > a.seenCheck) {
        a.seenCheck = now + 180 + Math.random() * 80;
        const face = new THREE.Vector3(Math.sin(a.root.rotation.y), 0, Math.cos(a.root.rotation.y));
        const dot = (face.x * dx + face.z * dz) / Math.max(0.01, dist);
        const range = a.state === 'alert' ? 30 : 22;
        a.seen = dist < range && (dot > 0.25 || dist < 6 || a.state === 'alert') && grid.los(p.x, p.z, camera.position.x, camera.position.z);
        if (a.seen) {
          if (a.state === 'patrol') {
            a.state = 'alert';
            a.nextShot = now + 700;
            if (a.cast.boss) popup(a.cast.quip[0], p.clone().setY(a.cast.height + 0.9), '#ffffff');
          }
          a.lastSeen = now;
        }
      }
      let speed = 0;
      let aiming = false;
      if (a.state === 'patrol') {
        if (now > a.wait) {
          const here = grid.cell(p.x, p.z);
          if (!a.goal) a.goal = grid.wander(here, a.cast.boss ? 2 : 5);
          const c = grid.centre(a.goal[0], a.goal[1]);
          const gx = c.x - p.x;
          const gz = c.z - p.z;
          const gd = Math.hypot(gx, gz);
          if (gd < 0.3) {
            a.goal = null;
            a.wait = now + 1200 + Math.random() * 2000;
          } else {
            const step = grid.nextStep(here, a.goal);
            const t2 = step ? grid.centre(step[0], step[1]) : c;
            const sx = t2.x - p.x;
            const sz = t2.z - p.z;
            const sd = Math.max(0.01, Math.hypot(sx, sz));
            const v = a.cast.speed * 0.5 * dt;
            moveActor(a, (sx / sd) * v, (sz / sd) * v);
            a.root.rotation.y = Math.atan2(sx, sz);
            speed = 0.5;
          }
        }
      } else {
        if (now - a.lastSeen > 7000) {
          a.state = 'patrol';
          a.goal = null;
        }
        if (a.seen && dist < 20) {
          a.root.rotation.y = Math.atan2(dx, dz);
          aiming = true;
          // Bosses and bots keep a little distance and sidestep.
          if (dist < 4) moveActor(a, (-dx / dist) * a.cast.speed * 0.6 * dt, (-dz / dist) * a.cast.speed * 0.6 * dt);
          else if (a.cast.boss) {
            const side = Math.sin(now / 900 + a.max) > 0 ? 1 : -1;
            moveActor(a, (dz / dist) * side * a.cast.speed * 0.5 * dt, (-dx / dist) * side * a.cast.speed * 0.5 * dt);
            speed = 0.4;
          }
          if (!a.aimAt && now > a.nextShot) a.aimAt = now + (a.kind === 'hoarder' ? 600 : 350);
          if (a.aimAt && now > a.aimAt) {
            a.aimAt = 0;
            fireVolley(a, now);
            a.nextShot = now + a.cast.fireMs * (a.cast.boss && a.hp < a.max / 2 ? 0.7 : 1) * (0.8 + Math.random() * 0.4);
          }
        } else {
          a.aimAt = 0;
          // Chase where the player is (or was).
          if (now > a.repath) {
            a.repath = now + 400;
            a.step = grid.nextStep(grid.cell(p.x, p.z), grid.cell(camera.position.x, camera.position.z));
          }
          const t2 = a.step ? grid.centre(a.step[0], a.step[1]) : { x: camera.position.x, z: camera.position.z };
          const sx = t2.x - p.x;
          const sz = t2.z - p.z;
          const sd = Math.max(0.01, Math.hypot(sx, sz));
          if (sd < 0.25) a.repath = 0;
          const v = a.cast.speed * dt;
          moveActor(a, (sx / sd) * v, (sz / sd) * v);
          a.root.rotation.y = Math.atan2(sx, sz);
          speed = 1;
        }
      }
      // MICHAEL keeps buying more armour.
      if (a.kind === 'hoarder' && now > a.buyAt) {
        a.buyAt = now + 7000;
        if (a.hp < a.max) {
          a.hp = Math.min(a.max, a.hp + 4);
          popup("I'LL JUST BUY MORE! +ARMOR", p.clone().setY(a.cast.height + 0.9), '#ffb040');
        }
      }
      // Telegraph: eyes flare before a shot.
      if (a.rig) {
        const flare = a.aimAt ? 1 + Math.sin(now / 40) * 0.5 + 1 : 1;
        for (const e of a.rig.eyes) e.scale.setScalar(flare);
        for (const bm of a.rig.beams) {
          bm.visible = a.state === 'alert';
          bm.scale.set(1, a.aimAt ? 6 : 2.5, 1);
          bm.position.z = 0.19 + (a.aimAt ? 3 : 1.25);
        }
        poseRig(a.rig, dt, speed, aiming, now);
        // Wobble when hit.
        const w = (now - a.wobble) / 1000;
        a.rig.body.rotation.z = w < 0.5 ? Math.sin(w * 40) * 0.15 * (1 - w * 2) : 0;
      }
      if (a.mon) {
        a.mon.play(speed > 0.05 ? 'walk' : 'idle');
        a.mon.mixer.update(dt * (speed > 0.6 ? 1.6 : 1));
        const w = (now - a.wobble) / 1000;
        a.mon.body.rotation.z = w < 0.5 ? Math.sin(w * 40) * 0.15 * (1 - w * 2) : 0;
      }
    };

    // ── Main loop ──
    let lastTick = performance.now();
    let hudAt = 0;
    const step = (dt: number, now: number) => {
      if (!grid) return;
      elapsed += dt;
      // Doors: open when anyone walks up.
      const movers = [camera.position, ...actors.filter((a) => a.state !== 'dying').map((a) => a.root.position)];
      for (const dm of doorMeshes) {
        const d = grid.doors.get(dm.key)!;
        const c = grid.centre(d.x, d.z);
        const near = !d.locked && movers.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < SIZE * 0.95);
        d.open = Math.max(0, Math.min(1, d.open + (near ? dt * 2.5 : -dt * 1.5)));
        dm.mesh.position.y = WALL_H / 2 + d.open * (WALL_H - 0.15);
        if (!d.locked && (dm.mesh.material as THREE.MeshStandardMaterial).color?.getHex() === 0x7a1010) dm.mesh.material = assets!.material('painted_metal_shutter', [1, 0.9]);
      }
      // Player movement.
      const k = keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - input.current.sy;
      const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + input.current.sx;
      if (k.has('ArrowLeft')) yaw += 2.2 * dt;
      if (k.has('ArrowRight')) yaw -= 2.2 * dt;
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 8 : 5.5) * dt;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const mv = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
      if (mv.lengthSq() > 1) mv.normalize();
      mv.multiplyScalar(speed);
      const pad = 0.4;
      const nx = camera.position.x + mv.x;
      const nz = camera.position.z + mv.z;
      if (!grid.solidAt(nx + Math.sign(mv.x) * pad, camera.position.z)) camera.position.x = nx;
      if (!grid.solidAt(camera.position.x, nz + Math.sign(mv.z) * pad)) camera.position.z = nz;
      const moving = mv.lengthSq() > 0;
      walkPhase += moving ? dt * 10 : 0;
      camera.position.y = EYE + (moving ? Math.sin(walkPhase) * 0.035 : 0);

      if (trigger || input.current.fire) shoot(now);

      // Pickups.
      for (const p of pickups) {
        if (p.taken) continue;
        p.mesh.rotation.y += dt * 1.5;
        if (Math.hypot(p.mesh.position.x - camera.position.x, p.mesh.position.z - camera.position.z) < 1.3) {
          if (p.kind === '+' && health >= 100) continue;
          if (p.kind === 'a' && armor >= 100) continue;
          p.taken = true;
          p.mesh.visible = false;
          if (p.kind === '+') health = Math.min(100, health + 40);
          else armor = Math.min(100, armor + 60);
          sfx?.pickup();
          popup(p.kind === '+' ? '+40 HEALTH' : '+60 BODY ARMOUR', p.mesh.position.clone().setY(1.6), '#80ffb0');
        }
      }

      // Objective.
      const o = L.objectives[objIdx];
      if (o) {
        const tgt = objTarget();
        if (o.kind === 'boss') {
          if (!actors.some((a) => a.cast.boss && a.state !== 'dying')) completeObjective();
        } else if (tgt) {
          const d = Math.hypot(tgt.x - camera.position.x, tgt.z - camera.position.z);
          if (o.kind === 'goto' && d < 2.2) completeObjective();
          else if (o.kind === 'plant') {
            if (d < 2.4) {
              progress = Math.min(1, progress + dt / o.secs);
              if (progress >= 1) completeObjective();
            } else progress = Math.max(0, progress - dt * 0.5);
          }
        }
        if (beacon) {
          const t2 = objIdx < L.objectives.length ? objTarget() : null;
          const showB = Boolean(t2) && L.objectives[objIdx]?.kind !== 'boss';
          beacon.visible = showB;
          if (t2 && showB) beacon.position.set(t2.x, 0, t2.z);
          beacon.children[1].rotation.z += dt;
          (beacon.children[0] as THREE.Mesh).scale.setScalar(1 + Math.sin(now / 300) * 0.06);
        }
      }

      for (const a of actors) thinkActor(a, dt, now);

      // Enemy bolts.
      for (let i = bolts.length - 1; i >= 0; i--) {
        const bo = bolts[i];
        bo.s.position.addScaledVector(bo.v, dt);
        const p = bo.s.position;
        const hitMe = Math.hypot(p.x - camera.position.x, p.z - camera.position.z) < 0.5 && p.y > 0.2 && p.y < 2.1;
        if (hitMe) {
          damagePlayer(bo.dmg);
          const src = bo.from;
          if (src.cast.grab && src.state !== 'dying' && now > src.quipAt) {
            src.quipAt = now + 2500;
            popup(src.cast.grab, src.root.position.clone().setY(src.cast.height + 0.9), '#ffd84a');
          }
        }
        if (hitMe || grid.opaqueAt(p.x, p.z) || (grid.isLow(p.x, p.z) && p.y < 1.2) || p.y < 0 || p.y > WALL_H || now - bo.born > 5000) {
          scene.remove(bo.s);
          bolts.splice(i, 1);
        }
      }
    };

    const fx = (dt: number, now: number) => {
      // Gun bob/recoil.
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      torch.position.copy(camera.position).add(new THREE.Vector3(-Math.sin(yaw) * 2, 1.3, -Math.cos(yaw) * 2));
      muzzleLight.position.copy(torch.position);
      key.position.set(camera.position.x - Math.sin(yaw) * 1.5, WALL_H - 0.15, camera.position.z - Math.cos(yaw) * 1.5);
      key.target.position.set(camera.position.x - Math.sin(yaw) * 7, 0, camera.position.z - Math.cos(yaw) * 7);
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 200);
      if (muzzleLight.intensity < 4) flash.visible = false;
      recoil = Math.max(0, recoil - dt * 8);
      gunHolder.position.set(gunRest.x + Math.cos(walkPhase / 2) * 0.01, gunRest.y + Math.abs(Math.sin(walkPhase / 2)) * 0.01, gunRest.z + recoil * 0.06);
      gunHolder.rotation.x = recoil * 0.1;
      // Coins in flight: spin along the shot, land, then do damage.
      for (let i = flyers.length - 1; i >= 0; i--) {
        const fl = flyers[i];
        fl.t += dt / fl.dur;
        fl.m.position.lerpVectors(fl.from, fl.to, Math.min(1, fl.t));
        fl.m.rotation.x += dt * 25;
        fl.m.rotation.z += dt * 9;
        if (fl.t >= 1) {
          scene.remove(fl.m);
          flyers.splice(i, 1);
          if (fl.target) hitActor(fl.target, fl.point, now);
          else burstCoins(fl.point, 1);
        }
      }
      for (let i = loose.length - 1; i >= 0; i--) {
        const l = loose[i];
        l.v.y -= 12 * dt;
        l.m.position.addScaledVector(l.v, dt);
        if (l.m.position.y < 0.03) {
          l.m.position.y = 0.03;
          l.v.multiplyScalar(0.4);
          l.v.y = Math.abs(l.v.y) * 0.3;
        }
        l.m.rotation.x += l.spin * dt;
        if (now - l.born > 3500) {
          scene.remove(l.m);
          loose.splice(i, 1);
        }
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        const t = (now - p.born) / p.life;
        p.s.position.y += dt * p.rise;
        p.s.material.opacity = Math.min(1, (1 - t) * 3);
        if (t >= 1) {
          scene.remove(p.s);
          p.s.material.map?.dispose();
          p.s.material.dispose();
          pops.splice(i, 1);
        }
      }
      // Popped withdraw buttons.
      scene.children.forEach((o) => {
        const v = o.userData.v as THREE.Vector3 | undefined;
        if (!v) return;
        v.y -= 10 * dt;
        o.position.addScaledVector(v, dt);
        o.rotation.x += dt * 8;
        if (now - (o.userData.born as number) > 2500) {
          scene.remove(o);
          o.userData.v = undefined;
        }
      });
      // Token icon on the coins.
      const want = live_.current.icon;
      if (want !== coinSrc || live_.current.sym !== coinSym) {
        coinSrc = want;
        coinSym = live_.current.sym;
        if (want) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => paintCoin(img, coinSym);
          img.onerror = () => paintCoin(null, coinSym);
          img.src = want;
        } else paintCoin(null, coinSym);
      }
    };

    let raf = 0;
    let slowT = 16;
    let slowFor = 0;
    let prevFrame = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - lastTick) / 1000);
      lastTick = now;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x !== w || size.y !== h) {
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        bloom.resolution.set(w / 2, h / 2);
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
      }
      // Quality governor: if frames average over 20 ms for 2 s, step down a level.
      slowT = 0.97 * slowT + 0.03 * (now - prevFrame);
      prevFrame = now;
      if (running && slowT > 20 && quality < qualities.length - 1) {
        if ((slowFor += dt) > 2) {
          quality++;
          slowFor = 0;
          slowT = 16;
          renderer.setPixelRatio(qualities[quality].ratio);
          renderer.shadowMap.enabled = qualities[quality].shadows;
          key.castShadow = qualities[quality].shadows;
          composer.setPixelRatio(qualities[quality].ratio);
          renderer.setSize(0, 0, false); // forces the resize below
        }
      } else slowFor = 0;
      if (running) step(dt, performance.now());
      else if (!grid) yaw += dt * 0.15; // menu: slow look around
      fx(dt, performance.now());
      held?.mixer?.update(dt);
      if (running && now > hudAt) {
        hudAt = now + 120;
        pushHud();
      }
      composer.render();
    };

    // Dev-only hooks for automated play-testing (stripped from production builds).
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __doubleo: unknown }).__doubleo = {
        step: (frames = 60) => {
          for (let i = 0; i < frames; i++) {
            const now = performance.now() + i * 16;
            if (running) step(1 / 60, now);
            fx(1 / 60, now);
          }
          pushHud();
          composer.render();
        },
        state: () => ({ running, health, armor, objIdx, level: L.id, pos: [camera.position.x, camera.position.z], actors: actors.map((a) => ({ k: a.kind, hp: a.hp, st: a.state, p: [a.root.position.x, a.root.position.z] })), stats }),
        goTo: (c: string) => {
          const cell = grid?.find(c)[0];
          if (cell && grid) {
            const p = grid.centre(cell[0], cell[1]);
            camera.position.set(p.x, EYE, p.z);
          }
        },
        aimAt: (i: number) => {
          const a = actors[i];
          if (!a) return;
          const d = a.root.position.clone().setY(a.cast.height * 0.6).sub(camera.position);
          yaw = Math.atan2(-d.x, -d.z);
          pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
          camera.rotation.set(pitch, yaw, 0, 'YXZ');
          camera.updateMatrixWorld();
        },
        fire: () => {
          lastShot = 0;
          shoot(performance.now());
        },
        start: (i: number) => engine.current?.start(i, false),
        god: () => {
          health = 1e6;
        },
        place: (x: number, z: number) => camera.position.set(x, EYE, z),
      };
    }

    loadArenaAssets(renderer, (p) => !disposed && setLoading(Math.min(0.99, p)))
      .then((a) => {
        if (disposed) return;
        assets = a;
        held = buildGun(gunDef, a.guns[gunDef.id]);
        gunHolder.add(held.group);
        flash.position.copy(held.muzzle);
        // Menu backdrop: mission 1, nobody playing.
        buildLevel(0);
        running = false;
        setLoading(1);
      })
      .catch((e) => !disposed && setLoadError(e instanceof Error ? e.message : String(e)));
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      engine.current = null;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('pointerlockchange', onLock);
      if (lvlGroup) disposeGroup(lvlGroup);
      composer.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const playing = screen === 'play';
  const ready = loading >= 1;
  const start = (i: number) => {
    setLevel(i);
    setEmpty(false);
    engine.current?.start(i, live && armed);
  };
  const L = LEVELS[level];
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const tokensLeft = Math.max(0, Math.floor(b.tokenAmmo) - hud.heat);

  const ammoPanel = (
    <div className="inset flex w-full flex-col gap-2 bg-black/70 p-3 text-left text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-hot">AMMO · Q BRANCH</span>
        {b.wallet && (
          <button onClick={b.refreshWallet} disabled={b.refreshing} className="btn px-2 py-0.5 text-xs">
            {b.refreshing ? 'checking…' : '↻ refresh'}
          </button>
        )}
      </div>
      {!b.wallet ? (
        <button onClick={b.connectWallet} disabled={!!b.busy} className="btn-fire">
          {b.busy === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}
        </button>
      ) : (
        <>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
            {b.tokens.map((t) => {
              const on = t.id === b.token?.id;
              const ic = iconUrl(t.icon);
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    b.setToken(t);
                    b.setMode('tokens');
                  }}
                  className={`inset flex items-center gap-2 bg-black/60 px-2 py-1 text-left ${on ? 'border-fg text-hot' : 'text-dim hover:text-hot'}`}
                >
                  {ic ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ic} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded bg-input" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-bold">${t.sym}</span>
                  <span className="text-xs">{t.balance?.toLocaleString()}</span>
                </button>
              );
            })}
            {!b.tokens.length && <p className="text-xs text-dim">No tokens found in your wallet. Get some PNEE, or play in practice.</p>}
          </div>
          {b.token && (
            <>
              <div className="flex flex-wrap items-center gap-1">
                {[10, 50, 200, 1000]
                  .filter((n) => n <= Math.max(1, Math.floor(heldTok?.balance ?? 0)))
                  .map((n) => (
                    <button key={n} onClick={() => setTokenLoad(n)} className={`btn px-2 py-0.5 text-xs ${tokenLoad === n ? 'btn-on' : ''}`}>
                      {n}
                    </button>
                  ))}
                <input
                  type="number"
                  min={1}
                  value={tokenLoad}
                  onChange={(e) => setTokenLoad(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="inset w-20 bg-input px-2 py-0.5 text-right text-hot"
                  aria-label="Tokens to load"
                />
              </div>
              <p className="text-xs text-dim">
                One bullet = one ${b.token.sym} = one transaction. One approval loads the tokens plus {(tokenLoad * TOKEN_FEE).toLocaleString()} sats of network fees to fire them. Unfired
                fees come back on Unload.
              </p>
              <button onClick={() => b.loadTokenAmmo(tokenLoad)} disabled={!!b.busy} className="btn-fire">
                {b.busy === 'loading-tokens' ? 'APPROVE IN WALLET…' : `LOAD ${tokenLoad.toLocaleString()} $${b.token.sym}`}
              </button>
            </>
          )}
          <div className="text-xs text-dim">
            In the gun: <span className="text-hot">{Math.floor(b.tokenAmmo).toLocaleString()}</span> ${sym} · fuel {b.ammo.toLocaleString()} sats
          </div>
          {(b.ammo > 0 || b.gunTokens.length > 0) && (
            <button onClick={b.unload} disabled={!!b.busy} className="btn px-2 py-1 text-xs">
              {b.busy === 'unloading' ? 'UNLOADING… APPROVE IN WALLET' : 'UNLOAD EVERYTHING BACK TO MY WALLET'}
            </button>
          )}
        </>
      )}
      {b.receipt && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-hot">✓ {b.receipt.text}</span>
          <a href={`https://whatsonchain.com/tx/${b.receipt.txid}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            tx ↗
          </a>
        </div>
      )}
      {b.error && <p className="text-xs text-hot">⚠ {b.error}</p>}
    </div>
  );

  const modePick = (
    <div className="grid w-full grid-cols-2 gap-2">
      <button onClick={() => setLive(false)} className={`inset px-3 py-2 text-left ${!live ? 'border-fg text-hot' : 'text-dim hover:text-hot'}`}>
        <div className="font-bold">PRACTICE</div>
        <div className="text-xs">Free play. Nothing goes on chain.</div>
      </button>
      <button onClick={() => setLive(true)} className={`inset px-3 py-2 text-left ${live ? 'border-fg text-hot' : 'text-dim hover:text-hot'}`}>
        <div className="font-bold">LIVE · ${sym}</div>
        <div className="text-xs">{armed ? `Every bullet is 1 $${sym} in a real tx. ${Math.floor(b.tokenAmmo)} loaded.` : 'Load tokens first (below).'}</div>
      </button>
    </div>
  );

  return (
    <section className={playing ? 'fixed inset-0 z-40 flex flex-col bg-bg' : 'panel'}>
      <div className={playing ? 'relative min-h-0 flex-1' : 'relative'}>
        <div ref={mount} className={`touch-none select-none overflow-hidden ${playing ? 'h-full w-full' : 'inset h-[80vh] min-h-[36rem] w-full'}`} />

        {playing && (
          <>
            {/* Crosshair */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-hot/70">
              <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hot" />
            </div>
            {hurt && <div className="pointer-events-none absolute inset-0 bg-red-600/30" />}
            {/* Objective + compass */}
            <div className="pointer-events-none absolute left-2 top-2 flex max-w-[60%] flex-col gap-1">
              <div className="inset bg-black/75 px-2 py-1 text-xs sm:text-sm">
                <span className="text-dim">
                  {L.codename} · OBJECTIVE {Math.min(hud.objIdx + 1, hud.objTotal)}/{hud.objTotal}
                </span>
                <div className="font-bold text-hot">{hud.obj}</div>
                {hud.progress !== null && (
                  <div className="mt-1 h-1.5 w-40 bg-input">
                    <div className="h-full bg-[#40ff90]" style={{ width: `${Math.round(hud.progress * 100)}%` }} />
                  </div>
                )}
              </div>
              <div className="inset flex w-fit items-center gap-2 bg-black/75 px-2 py-1 text-xs text-dim">
                <span className="inline-block text-lg leading-none text-[#60ff90]" style={{ transform: `rotate(${-hud.arrow}rad)` }}>
                  ▲
                </span>
                {Math.round(hud.dist)} m
              </div>
            </div>
            {/* Boss bars */}
            {hud.bosses.length > 0 && (
              <div className="pointer-events-none absolute left-1/2 top-2 flex w-[min(28rem,60%)] -translate-x-1/2 flex-col gap-1">
                {hud.bosses.map((bo) => (
                  <div key={bo.name} className="inset bg-black/75 px-2 py-1">
                    <div className="text-xs font-bold text-hot">{bo.name}</div>
                    <div className="h-2 bg-input">
                      <div className="h-full bg-[#ff4040] transition-[width]" style={{ width: `${(bo.hp / bo.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Recent transactions */}
            {live && recent.length > 0 && (
              <div className="absolute right-2 top-2 hidden w-52 flex-col gap-1 text-xs sm:flex">
                {recent.map((t) => (
                  <a key={t} href={`https://whatsonchain.com/tx/${t}`} target="_blank" rel="noopener noreferrer" className="inset flex items-center gap-2 bg-black/75 px-2 py-1 hover:border-fg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {icon ? <img src={icon} alt="" className="h-4 w-4 rounded" /> : <span className="text-hot">●</span>}
                    <span className="text-hot">−1 ${sym}</span>
                    <span className="ml-auto text-dim">{t.slice(0, 8)}… ↗</span>
                  </a>
                ))}
              </div>
            )}
            {/* Health / armour / ammo */}
            <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-2 text-xs sm:text-sm">
              <div className="inset w-24 bg-black/75 px-2 py-1 sm:w-32">
                <div className="text-dim">HEALTH</div>
                <div className="h-2 bg-input">
                  <div className="h-full bg-[#ff5050]" style={{ width: `${hud.health}%` }} />
                </div>
              </div>
              <div className="inset w-24 bg-black/75 px-2 py-1 sm:w-32">
                <div className="text-dim">ARMOUR</div>
                <div className="h-2 bg-input">
                  <div className="h-full bg-[#60b0ff]" style={{ width: `${hud.armor}%` }} />
                </div>
              </div>
              <div className="inset bg-black/75 px-2 py-1 text-right">
                <div className="text-dim">{live ? `$${sym}` : 'PRACTICE'}</div>
                <div className="font-bold tabular-nums text-hot">{live ? `${tokensLeft} · ${hud.onChain} on chain` : `${hud.shots} fired`}</div>
              </div>
            </div>
            {empty && (
              <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 text-center">
                <div className="blink text-3xl font-bold text-hot">OUT OF AMMO</div>
                <div className="text-sm text-dim">Esc → load more ${sym}</div>
              </div>
            )}
            {jam && (
              <div className="pointer-events-none absolute left-1/2 top-[30%] max-w-lg -translate-x-1/2 text-center">
                <div className="blink text-3xl font-bold text-hot">JAMMED</div>
                <div className="mt-1 bg-black/70 px-3 py-1 text-sm text-hot">Shots did not reach the chain: {jam}</div>
              </div>
            )}
            {chainError && !jam && <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/70 px-2 text-xs text-hot">⚠ {chainError}</div>}
            {/* Touch controls */}
            {touchUi && (
              <>
                <Stick onMove={(x, y) => ((input.current.sx = x), (input.current.sy = y))} />
                <button
                  onPointerDown={() => (input.current.fire = true)}
                  onPointerUp={() => (input.current.fire = false)}
                  onPointerLeave={() => (input.current.fire = false)}
                  className="btn-fire absolute bottom-20 right-4 h-20 w-20 rounded-full !p-0"
                >
                  FIRE
                </button>
                <button onClick={() => (engine.current?.abort(), setScreen('paused'))} className="btn absolute right-2 top-2 px-2 py-1 text-xs sm:hidden">
                  II
                </button>
              </>
            )}
          </>
        )}

        {/* Menu / pause */}
        {(screen === 'menu' || screen === 'paused') && (
          <div className="absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto bg-black/80 px-4 py-5 text-center">
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/arcade/doubleo/kweg.webp" alt={AGENT} className="h-32 w-auto rounded border border-[var(--border-dim)]" />
              <div className="text-left">
                <p className="text-3xl font-bold tracking-widest text-hot sm:text-5xl">DOUBLE-O KWEG</p>
                <p className="text-sm text-accent">
                  {AGENT}. Licensed to blast. Also to practice Aeronautical Zoological Law.
                </p>
              </div>
            </div>
            {screen === 'paused' && (
              <div className="flex gap-2">
                <button onClick={() => engine.current?.resume()} className="btn-fire">
                  RESUME {L.name.toUpperCase()} ▶
                </button>
                <button onClick={() => setScreen('menu')} className="btn px-3 py-1">
                  ABORT MISSION
                </button>
              </div>
            )}
            {loadError ? (
              <p className="text-sm text-hot">⚠ Could not load the game: {loadError}</p>
            ) : !ready ? (
              <div className="w-64">
                <div className="h-2 bg-input">
                  <div className="h-full bg-fg transition-[width]" style={{ width: `${Math.round(loading * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-dim">briefing the agent {Math.round(loading * 100)}%</p>
              </div>
            ) : null}
            <div className="grid w-full max-w-5xl gap-3 md:grid-cols-[1fr_20rem]">
              <div className="flex flex-col gap-2">
                <p className="text-left text-base font-bold text-hot">PICK A MISSION</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {LEVELS.map((lv, i) => (
                    <button
                      key={lv.id}
                      disabled={!ready}
                      onClick={() => start(i)}
                      className="inset flex flex-col gap-1 bg-black/60 px-3 py-3 text-left hover:border-fg disabled:opacity-50"
                    >
                      <span className="text-xs text-dim">
                        {lv.codename} {done.includes(lv.id) && <span className="text-[#60ff90]">✓ complete</span>}
                      </span>
                      <span className="text-lg font-bold text-hot">{lv.name}</span>
                      <span className="text-xs text-dim">{lv.brief}</span>
                      <span className="mt-1 text-xs text-accent">▶ {live && armed ? `LIVE · $${sym}` : 'PRACTICE'}</span>
                    </button>
                  ))}
                </div>
                {modePick}
                <p className="text-left text-xs text-dim">
                  WASD move · Shift run · mouse aim · click / Space fire · Esc pause. Phone: left stick moves, drag right side to aim, FIRE button. Follow the green arrow to
                  the objective.
                </p>
              </div>
              {ammoPanel}
            </div>
          </div>
        )}

        {/* Debrief */}
        {screen === 'debrief' && debrief && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/85 px-4 py-5 text-center">
            <p className="text-xs tracking-widest text-dim">{LEVELS[debrief.level].codename} · MISSION DEBRIEF</p>
            <p className="text-3xl font-bold text-[#60ff90]">{LEVELS[debrief.level].name.toUpperCase()}: COMPLETE</p>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/arcade/doubleo/kweg.webp" alt="" className="h-24 w-auto rounded" />
              <p className="max-w-sm text-left text-sm text-accent">“Splendid work, {AGENT.replace('Special ', '')}. Your licence to blast has been renewed.” · M</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="TIME" value={fmtTime(debrief.secs)} />
              <Stat label="ACCURACY" value={`${debrief.shots ? Math.round((debrief.hits / debrief.shots) * 100) : 0}%`} />
              <Stat label="REKT" value={String(debrief.kills)} />
              <Stat label={`$${debrief.sym} FIRED`} value={String(debrief.live ? debrief.shots : 0)} sub={debrief.live ? undefined : 'practice'} />
              <Stat label="ON CHAIN" value={String(debrief.live ? hud.onChain : 0)} />
            </div>
            {debrief.live && hud.last && (
              <a href={`https://whatsonchain.com/tx/${hud.last}`} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline">
                last tx {hud.last.slice(0, 16)}… ↗
              </a>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {debrief.level + 1 < LEVELS.length && (
                <button onClick={() => start(debrief.level + 1)} className="btn-fire">
                  NEXT: {LEVELS[debrief.level + 1].name.toUpperCase()} ▶
                </button>
              )}
              <button onClick={() => start(debrief.level)} className="btn px-3 py-1">
                REPLAY
              </button>
              <button onClick={() => setScreen('menu')} className="btn px-3 py-1">
                MISSIONS
              </button>
            </div>
          </div>
        )}

        {/* Failed */}
        {screen === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/80 px-4 text-center">
            <p className="text-4xl font-bold text-hot">MISSION FAILED</p>
            <p className="text-sm text-dim">The agent got rekt. Even Aeronautical Zoological Law has its limits.</p>
            <div className="flex gap-2">
              <button onClick={() => start(level)} className="btn-fire">
                RETRY ▶
              </button>
              <button onClick={() => setScreen('menu')} className="btn px-3 py-1">
                MISSIONS
              </button>
            </div>
          </div>
        )}
      </div>
      {!playing && hud.last && (
        <p className="mt-2 truncate text-xs text-dim">
          last shot on chain:{' '}
          <a href={`https://whatsonchain.com/tx/${hud.last}`} target="_blank" rel="noreferrer" className="text-accent hover:text-hot">
            {hud.last}
          </a>
        </p>
      )}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset px-3 py-1">
      <div className="text-xs tracking-widest text-dim">{label}</div>
      <div className="text-xl font-bold tabular-nums text-hot">
        {value}
        {sub && <span className="text-xs text-dim"> {sub}</span>}
      </div>
    </div>
  );
}

/** On-screen move stick (phones). */
function Stick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const R = 48;
  return (
    <div
      className="absolute bottom-20 left-4 h-32 w-32 touch-none rounded-full border border-[var(--border-dim)] bg-black/40"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const o = origin.current;
        if (!o || o.id !== e.pointerId) return;
        let dx = e.clientX - o.x;
        let dy = e.clientY - o.y;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        setKnob({ x: dx, y: dy });
        onMove(dx / R, dy / R);
      }}
      onPointerUp={() => {
        origin.current = null;
        setKnob(null);
        onMove(0, 0);
      }}
      onPointerCancel={() => {
        origin.current = null;
        setKnob(null);
        onMove(0, 0);
      }}
    >
      <div className="absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-hot/40" style={{ transform: `translate(calc(-50% + ${knob?.x ?? 0}px), calc(-50% + ${knob?.y ?? 0}px))` }} />
    </div>
  );
}
