'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { fireballTexture, makeSfx, type Sfx } from '@/lib/arenaArt';
import { buildGun, GUNS, loadArenaAssets, Monster, MONSTERS, type HeldGun } from '@/lib/arenaHD';
import { formatCount, packSats } from '@/lib/pricing';
import { AmmoPicker } from './AmmoPicker';
import { iconUrl } from '@/lib/tokens';
import { TOKEN_FEE } from '@/lib/gun';
import { useBlaster } from '@/lib/useBlaster';
import { AmmoStrip } from './AmmoStrip';
import { WalletChooser } from './WalletChooser';
import { Room, realtimeConfigured } from '@/lib/realtime';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GameAudio } from '@/components/SoundToggle';
import Link from 'next/link';
import { ORDNANCE, type Ordnance } from '@/lib/ordnance';
import { GunArt } from './GunArt';
import type { GunDef } from '@/lib/arenaHD';
import { useOrdnance } from '@/lib/useOrdnance';
import { tintGun } from '@/lib/ordnanceGun';

/** Stock guns, then the 1Sat Ordnance guns (built on a stock model; locked unless the wallet holds the ordinal). */
const ALL_GUNS: (GunDef & { ordnance?: Ordnance })[] = [
  ...GUNS,
  ...ORDNANCE.map((o) => ({ ...(GUNS.find((g) => g.id === o.base) ?? GUNS[0]), ...o.stats, id: o.id, name: o.name, key: '', ordnance: o })),
];

/** 1 = wall. The player starts at S. Rows from HALL_Z down are the horde hall. */
const MAP = [
  '1111111111111111',
  '1S00000100000001',
  '1011110101111101',
  '1010000000000101',
  '1010111111110101',
  '1000100000010001',
  '1110101111010111',
  '1000001001000001',
  '1011101001011101',
  '1000100000010001',
  '1010111011110101',
  '1010000000000101',
  '1011110111111101',
  '1000000100000001',
  '1000000000000001',
  '1111111001111111',
  '1000000000000001',
  '1000000000000001',
  '1001100000011001',
  '1001100000011001',
  '1000000000000001',
  '1000000000000001',
  '1000000110000001',
  '1000000110000001',
  '1000000000000001',
  '1001100000011001',
  '1001100000011001',
  '1000000000000001',
  '1111111111111111',
];
const COLS = MAP[0].length;
const HALL_Z = 16;
const SIZE = 4; // world units per cell
const WALL_H = SIZE * 0.9;
const MAX_HEAT = 300; // shots queued for the chain before the gun overheats
const BATCH = 50; // blasts per ARC request
const FEE_PER_SHOT = 23; // sats: a ~224-byte blast at 100 sat/kB (src/lib/gun.ts)
const SLIME: [number, number][] = [
  [5, 3],
  [9, 9],
  [3, 13],
  [12, 13],
];
const LAMPS: [number, number][] = [
  [4, 1],
  [12, 7],
  [5, 14],
];
const MEDKITS: [number, number][] = [
  [14, 1],
  [7, 7],
  [1, 11],
  [14, 14],
  [2, 20],
  [13, 26],
];

const cellAt = (x: number, z: number) => MAP[Math.floor(z / SIZE)]?.[Math.floor(x / SIZE)];
const isWall = (x: number, z: number) => {
  const c = cellAt(x, z);
  return c !== '0' && c !== 'S';
};
const centre = ([x, z]: [number, number], y: number) => new THREE.Vector3((x + 0.5) * SIZE, y, (z + 0.5) * SIZE);
const freeCells = (pred: (x: number, z: number) => boolean = () => true) => {
  const out: [number, number][] = [];
  MAP.forEach((row, z) => [...row].forEach((c, x) => c === '0' && pred(x, z) && out.push([x, z])));
  return out;
};
const isPhone = () => typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent);

type Hud = { kills: number; shots: number; onChain: number; heat: number; health: number; last: string | null };

/**
 * The arena, in HD: PBR-textured maze, animated skeleton warriors, rogues and mages that hunt
 * you, a horde hall of minions, bloom and a 3D gun. Every trigger pull is a real blast for your
 * token (tagged `arena`), sent to ARC in batches so hold-to-fire can fire thousands.
 */
export function Arena() {
  const b = useBlaster();
  const { owned } = useOrdnance(b.wallet);
  const ownedRef = useRef(owned);
  useEffect(() => {
    ownedRef.current = owned;
  }, [owned]);
  const mount = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ kills: 0, shots: 0, onChain: 0, heat: 0, health: 100, last: null });
  const [recent, setRecent] = useState<{ txid: string; token: boolean }[]>([]);
  const [loading, setLoading] = useState(0); // 0..1, 1 = ready
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hurt, setHurt] = useState(false);
  const [dead, setDead] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  const [shots, setShots] = useState(1_000);
  const [bsvUsd, setBsvUsd] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/price')
      .then((r) => r.json())
      .then((d: { bsvUsd?: number }) => d.bsvUsd && setBsvUsd(d.bsvUsd))
      .catch(() => undefined);
  }, []);
  const [chainError, setChainError] = useState<string | null>(null);
  const [weapon, setWeapon] = useState(0);
  const [gunThumbs, setGunThumbs] = useState<string[]>([]);
  const [jam, setJam] = useState<string | null>(null);
  useEffect(() => {
    if (!jam) return;
    const t = setTimeout(() => setJam(null), 4000);
    return () => clearTimeout(t);
  }, [jam]);
  const [empty, setEmpty] = useState(false);
  const cycleRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onT = (e: KeyboardEvent) => e.code === 'KeyT' && cycleRef.current();
    window.addEventListener('keydown', onT);
    return () => window.removeEventListener('keydown', onT);
  }, []);

  // The game loop reads the latest blaster state through refs.
  const tokenMode = b.mode === 'tokens';
  const heldTok = b.tokens.find((t) => t.id === b.token?.id);
  const armed = tokenMode ? Boolean(b.token) && b.tokenAmmo >= 1 && b.ammo >= TOKEN_FEE : b.ammo > 30;
  const net = useRef({ name: 'player', gun: '', token: null as null | { id: string; sym: string; icon: string | null } });
  useEffect(() => {
    net.current = {
      name: b.wallet ? `${b.wallet.name.split(' ')[0]}·${b.wallet.address.slice(-4)}` : 'guest',
      gun: b.gunAddress,
      token: b.token ? { id: b.token.id, sym: b.token.sym, icon: b.token.icon } : null,
    };
  }, [b.wallet, b.gunAddress, b.token]);
  const [players, setPlayers] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; text: string; icon: string | null }[]>([]);
  const toast = useRef<(text: string, icon: string | null) => void>(() => undefined);
  useEffect(() => {
    toast.current = (text, icon) => {
      const id = Math.random();
      setToasts((t) => [{ id, text, icon }, ...t].slice(0, 5));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
  }, []);
  const live = useRef({ armed, ammo: b.ammo, tokens: b.tokenAmmo, tokenMode, fireBatch: b.fireBatch, fireTokens: b.fireTokens, icon: iconUrl(b.token?.icon ?? null) });
  useEffect(() => {
    live.current = { armed, ammo: b.ammo, tokens: b.tokenAmmo, tokenMode, fireBatch: b.fireBatch, fireTokens: b.fireTokens, icon: iconUrl(b.token?.icon ?? null) };
  }, [armed, b.ammo, b.tokenAmmo, tokenMode, b.fireBatch, b.fireTokens, b.token]);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const phone = isPhone();
    let disposed = false;

    // ── Renderer: full resolution, filmic tone mapping, bloom ──
    const renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, phone ? 1 : 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060303');
    scene.fog = new THREE.FogExp2('#060303', 0.035);
    const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 120);
    scene.add(camera);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), phone ? 0.5 : 0.8, 0.5, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // Lights that don't need assets.
    scene.add(new THREE.HemisphereLight('#ffd8c8', '#200808', 0.35));
    // The torch sits ahead of and above you, so the gun in your hands isn't blown out.
    const torch = new THREE.PointLight('#ffd2bc', 30, 18, 1.5);
    scene.add(torch);
    const muzzleLight = new THREE.PointLight('#fff0c0', 0, 10, 2);
    scene.add(muzzleLight);

    // ── Guns: real models (loaded below), held by the camera; 1-4 switches ──
    const gun = new THREE.Group(); // holder: bob and recoil move this
    camera.add(gun);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireballTexture(), color: new THREE.Color(3, 2.6, 1.6), toneMapped: false, transparent: true, depthWrite: false, depthTest: false }));
    flash.scale.set(0.3, 0.3, 0.3);
    flash.visible = false;
    flash.renderOrder = 11;
    gun.add(flash);
    const held: HeldGun[] = [];
    const startGun = Math.max(0, GUNS.findIndex((g) => g.key === new URLSearchParams(window.location.search).get('gun')));
    let gunIdx = startGun;
    const gunRest = new THREE.Vector3(...GUNS[gunIdx].pos);
    const unlocked = (i: number) => i < GUNS.length || ownedRef.current.has(ALL_GUNS[i]?.id);
    const nextGun = (step: number) => {
      for (let k = 1; k <= held.length; k++) {
        const i = (gunIdx + step * k + held.length * k) % held.length;
        if (unlocked(i)) return i;
      }
      return gunIdx;
    };
    const selectGun = (i: number) => {
      if (!held[i] || !unlocked(i)) return;
      gunIdx = i;
      held.forEach((h, k) => (h.group.visible = k === i));
      gunRest.set(...held[i].def.pos);
      flash.position.copy(held[i].muzzle);
      setWeapon(i);
    };
    const boltMats = new Map(ALL_GUNS.map((g) => [g.id, new THREE.LineBasicMaterial({ color: new THREE.Color(g.bolt).multiplyScalar(4), toneMapped: false })]));
    const bolts: { line: THREE.Line; born: number }[] = [];

    // ── Game state (filled in once assets load) ──
    const walls: THREE.Mesh[] = [];
    let start = centre([1, 1], 1.6);
    type Mob = { m: Monster; hp: number; state: 'chase' | 'wander' | 'attack' | 'hit' | 'dying' | 'dead'; since: number; next: number; dir: THREE.Vector3; horde: boolean };
    const mobs: Mob[] = [];
    // ── Multiplayer: everyone in /arena shares one room (Supabase Realtime broadcast + presence) ──
    const myId = Math.random().toString(36).slice(2, 10);
    let chibi: GLTF | null = null;
    const chibiDef = MONSTERS.find((d) => d.id === 'chibi');
    type Remote = { m: Monster; to: THREE.Vector3; yaw: number; seen: number; name: string; gun: string; label: THREE.Sprite };
    const remotes = new Map<string, Remote>();
    const nameTag = (text: string) => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 48;
      const x = c.getContext('2d')!;
      x.fillStyle = 'rgba(10,4,4,0.75)';
      x.fillRect(0, 0, 256, 48);
      x.font = 'bold 26px monospace';
      x.fillStyle = '#ffe58a';
      x.textAlign = 'center';
      x.fillText(text.slice(0, 16), 128, 33);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      sp.scale.set(1.2, 0.225, 1);
      return sp;
    };
    const remoteFor = (id: string, name: string) => {
      let r = remotes.get(id);
      if (!r && chibi && chibiDef) {
        const m = new Monster(chibiDef, chibi);
        m.play('idle');
        const label = nameTag(name);
        label.position.y = chibiDef.height + 0.35;
        m.root.add(label);
        scene.add(m.root);
        r = { m, to: new THREE.Vector3(), yaw: 0, seen: performance.now(), name, gun: '', label };
        remotes.set(id, r);
      }
      return r;
    };
    const room = realtimeConfigured()
      ? new Room('tokenblaster-arena', myId, {
          onBroadcast: (event, p) => {
            if (event === 'pose') {
              const d = p as { id: string; x: number; z: number; yaw: number; name: string; gun: string };
              const r = remoteFor(d.id, d.name);
              if (!r) return;
              r.to.set(d.x, 0, d.z);
              if (r.seen === 0 || r.m.root.position.lengthSq() === 0) r.m.root.position.copy(r.to);
              r.yaw = d.yaw;
              r.gun = d.gun;
              r.seen = performance.now();
            } else if (event === 'hit') {
              const d = p as { to: string; from: string; n: number; tokens: boolean; sym?: string; icon?: string | null };
              if (d.to !== myId) return;
              damage(2 * d.n, performance.now());
              toast.current(d.tokens ? `+${d.n} $${d.sym} from ${d.from} (in your gun)` : `${d.from} hit you ×${d.n}`, d.tokens ? iconUrl(d.icon ?? null) : null);
            }
          },
          onPresence: (state) => setPlayers(Object.keys(state).length),
        })
      : null;
    room?.track({ id: myId });
    let lastPose = 0;

    const fireballs: { s: THREE.Sprite; v: THREE.Vector3 }[] = [];
    const sparks: { p: THREE.Points; born: number }[] = [];
    const medkits: { mesh: THREE.Mesh; back: number }[] = [];
    let slimeTex: THREE.CanvasTexture | null = null;
    let health = 100;
    let deadUntil = 0;
    let sfx: Sfx | null = null;
    let ready = false;
    const fireTex = fireballTexture();

    // Token badge floating over each monster.
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = badgeCanvas.height = 64;
    const badgeTex = new THREE.CanvasTexture(badgeCanvas);
    badgeTex.colorSpace = THREE.SRGBColorSpace;
    const paintBadge = (img: HTMLImageElement | null) => {
      const c = badgeCanvas.getContext('2d')!;
      c.clearRect(0, 0, 64, 64);
      c.fillStyle = '#f5b800';
      c.beginPath();
      c.arc(32, 32, 30, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#0b0b0d';
      c.beginPath();
      c.arc(32, 32, 26, 0, Math.PI * 2);
      c.fill();
      if (img) c.drawImage(img, 12, 12, 40, 40);
      badgeTex.needsUpdate = true;
    };
    paintBadge(null);
    let badgeSrc: string | null = null;

    // Token coins: each shot flies the token's icon out of the muzzle and kicks a spent coin out of
    // the side of the gun, like a casing. Only while a token with an icon is picked.
    const coinCanvas = document.createElement('canvas');
    coinCanvas.width = coinCanvas.height = 128;
    const coinTex = new THREE.CanvasTexture(coinCanvas);
    coinTex.colorSpace = THREE.SRGBColorSpace;
    let coinReady = false;
    const paintCoin = (img: HTMLImageElement | null) => {
      const c = coinCanvas.getContext('2d')!;
      c.clearRect(0, 0, 128, 128);
      coinReady = Boolean(img);
      if (!img) return void (coinTex.needsUpdate = true);
      const g = c.createRadialGradient(44, 40, 8, 64, 64, 64);
      g.addColorStop(0, '#fff3b0');
      g.addColorStop(0.6, '#e2a72e');
      g.addColorStop(1, '#8a5a12');
      c.fillStyle = g;
      c.beginPath();
      c.arc(64, 64, 62, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.beginPath();
      c.arc(64, 64, 52, 0, Math.PI * 2);
      c.clip();
      c.drawImage(img, 12, 12, 104, 104);
      c.restore();
      coinTex.needsUpdate = true;
    };
    const coinGeo = new THREE.CircleGeometry(0.035, 20);
    const coinMat = new THREE.MeshStandardMaterial({ map: coinTex, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide, transparent: true });
    const flyMat = new THREE.SpriteMaterial({ map: coinTex, transparent: true, depthWrite: false });
    type Casing = { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; born: number; rest: boolean };
    const casings: Casing[] = [];
    const flyers: { s: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3; born: number }[] = [];
    const MAX_CASINGS = 160;

    const cellsMaze = freeCells((_, z) => z < HALL_Z);
    const cellsHall = freeCells((_, z) => z >= HALL_Z + 6);
    const spawn = (mob: Mob, now: number) => {
      const pool = mob.horde ? cellsHall : cellsMaze;
      let cell: [number, number];
      let tries = 0;
      do cell = pool[Math.floor(Math.random() * pool.length)];
      while (++tries < 50 && centre(cell, 0).distanceTo(new THREE.Vector3(camera.position.x, 0, camera.position.z)) < SIZE * 3.5);
      mob.m.root.position.copy(centre(cell, 0));
      mob.m.root.visible = true;
      mob.hp = mob.m.def.hp;
      mob.m.body.rotation.set(0, 0, 0);
      mob.m.body.position.set(0, 0, 0);
      mob.state = 'wander';
      mob.since = now;
      mob.next = now + 1500 + Math.random() * 1500;
      mob.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      mob.m.play('walk');
    };

    const damage = (n: number, now: number) => {
      if (deadUntil) return;
      health = Math.max(0, health - n);
      sfx?.hurt();
      setHurt(true);
      setTimeout(() => setHurt(false), 120);
      if (health <= 0) {
        deadUntil = now + 2000;
        sfx?.dead();
        setDead(true);
      }
      setHud((h) => ({ ...h, health }));
    };

    const sparkAt = (p: THREE.Vector3, color: string) => {
      const n = 14;
      const pos = new Float32Array(n * 3);
      const vel: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        pos.set([p.x, p.y, p.z], i * 3);
        vel.push(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(4));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.userData.vel = vel;
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(color).multiplyScalar(3), size: 0.07, toneMapped: false, transparent: true }));
      scene.add(pts);
      sparks.push({ p: pts, born: performance.now() });
    };

    // ── Load assets, then build the level ──
    loadArenaAssets(renderer, (p) => !disposed && setLoading(Math.min(0.99, p)))
      .then((a) => {
        if (disposed) return;
        const zoneMats = [a.material('castle_brick_07', [1, 0.9]), a.material('metal_plate', [1, 0.9]), a.material('rough_block_wall', [1, 0.9]), a.material('rusty_metal_02', [1, 0.9])];
        const trim = a.material('painted_metal_shutter', [1, 0.9]);
        const hallMat = a.material('corrugated_iron_02', [1, 0.9]);
        const wallGeo = new THREE.BoxGeometry(SIZE, WALL_H, SIZE);
        MAP.forEach((row, z) =>
          [...row].forEach((c, x) => {
            if (c === 'S') start = centre([x, z], 1.6);
            if (c !== '1') return;
            const mat = z >= HALL_Z ? hallMat : (x * 7 + z * 3) % 6 === 0 ? trim : zoneMats[(x < 8 ? 0 : 1) + (z < 8 ? 0 : 2)];
            const m = new THREE.Mesh(wallGeo, mat);
            m.position.copy(centre([x, z], WALL_H / 2));
            scene.add(m);
            walls.push(m);
          }),
        );
        const spanX = COLS * SIZE;
        const spanZ = MAP.length * SIZE;
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ), a.material('concrete_floor_worn_001', [COLS, MAP.length]));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(spanX / 2, 0, spanZ / 2);
        scene.add(floor);
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ), a.material('metal_grate_rusty', [COLS, MAP.length]));
        ceil.rotation.x = Math.PI / 2;
        ceil.position.set(spanX / 2, WALL_H, spanZ / 2);
        scene.add(ceil);

        // Glowing slime (burns), lamps, red hall lights.
        const sc = document.createElement('canvas');
        sc.width = sc.height = 128;
        const sx = sc.getContext('2d')!;
        sx.fillStyle = '#1e8a10';
        sx.fillRect(0, 0, 128, 128);
        for (let i = 0; i < 160; i++) {
          sx.fillStyle = ['#5adc2a', '#2aa012', '#9aff5a'][i % 3];
          sx.beginPath();
          sx.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 0, Math.PI * 2);
          sx.fill();
        }
        slimeTex = new THREE.CanvasTexture(sc);
        slimeTex.wrapS = slimeTex.wrapT = THREE.RepeatWrapping;
        slimeTex.colorSpace = THREE.SRGBColorSpace;
        const slimeMat = new THREE.MeshBasicMaterial({ map: slimeTex, color: new THREE.Color(1.6, 2.2, 1.2), toneMapped: false });
        for (const cell of SLIME) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 0.9, SIZE * 0.9), slimeMat);
          m.rotation.x = -Math.PI / 2;
          m.position.copy(centre(cell, 0.02));
          scene.add(m);
          const l = new THREE.PointLight('#5aff3a', 8, 6, 1.8);
          l.position.copy(centre(cell, 0.6));
          scene.add(l);
        }
        const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.2), toneMapped: false });
        for (const cell of LAMPS) {
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.5), lampMat);
          lamp.position.copy(centre(cell, WALL_H - 0.06));
          scene.add(lamp);
          const l = new THREE.PointLight('#ffd27a', 35, 16, 1.6);
          l.position.copy(centre(cell, WALL_H - 0.5));
          scene.add(l);
        }
        for (const cell of [
          [4, 19],
          [11, 19],
          [7, 25],
        ] as [number, number][]) {
          const l = new THREE.PointLight('#ff3a1a', 45, 22, 1.4);
          l.position.copy(centre(cell, WALL_H - 0.6));
          scene.add(l);
        }

        // Medkits: white boxes with a red cross.
        const mc = document.createElement('canvas');
        mc.width = mc.height = 64;
        const mx = mc.getContext('2d')!;
        mx.fillStyle = '#eeeeee';
        mx.fillRect(0, 0, 64, 64);
        mx.fillStyle = '#d01818';
        mx.fillRect(26, 10, 12, 44);
        mx.fillRect(10, 26, 44, 12);
        const medTex = new THREE.CanvasTexture(mc);
        medTex.colorSpace = THREE.SRGBColorSpace;
        const medMat = new THREE.MeshStandardMaterial({ map: medTex, roughness: 0.4 });
        for (const cell of MEDKITS) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.45), medMat);
          m.position.copy(centre(cell, 0.3));
          scene.add(m);
          medkits.push({ mesh: m, back: 0 });
        }

        chibi = a.monsters['chibi'] ?? null;
        // Monsters: warriors, rogues and mages in the maze; minions in the horde hall.
        const now = performance.now();
        const make = (def: (typeof MONSTERS)[number], horde: boolean) => {
          const m = new Monster(def, a.monsters[def.id]);
          const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTex, transparent: true }));
          badge.scale.set(0.45, 0.45, 0.45);
          badge.position.y = def.height + (def.hover ?? 0) + 0.35;
          m.root.add(badge);
          scene.add(m.root);
          const mob: Mob = { m, hp: 1, state: 'wander', since: now, next: 0, dir: new THREE.Vector3(), horde };
          if (horde) m.root.visible = false;
          else spawn(mob, now);
          mobs.push(mob);
        };
        const showcase = new URLSearchParams(window.location.search).has('showcase');
        for (const def of MONSTERS) {
          if (def.showcaseOnly && !showcase) continue;
          const inMaze = phone ? Math.ceil(def.maze / 2) : def.maze;
          for (let i = 0; i < inMaze; i++) make(def, false);
          const inHall = phone ? Math.floor((def.horde ?? 0) / 2) : (def.horde ?? 0);
          for (let i = 0; i < inHall; i++) make(def, true);
        }
        for (const def of ALL_GUNS) {
          const h = buildGun(def, a.guns[GUNS.find((g) => g.url === def.url)?.id ?? def.id]);
          tintGun(h.group, def.ordnance?.tint);
          h.group.visible = false;
          gun.add(h.group);
          held.push(h);
        }
        selectGun(gunIdx);
        // Pictures of each gun for the picker: render them once, side-on, off screen.
        try {
          const tr = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
          tr.setSize(240, 120);
          tr.outputColorSpace = THREE.SRGBColorSpace;
          tr.toneMapping = THREE.ACESFilmicToneMapping;
          const ts = new THREE.Scene();
          ts.environment = scene.environment;
          ts.add(new THREE.HemisphereLight('#fff4e8', '#3a1410', 3));
          const dl = new THREE.DirectionalLight('#ffffff', 5);
          tr.toneMappingExposure = 1.6;
          dl.position.set(2, 3, 2);
          ts.add(dl);
          const tc = new THREE.PerspectiveCamera(30, 2, 0.01, 50);
          const pics: string[] = [];
          for (const h of held) {
            const g = h.group.clone(true);
            g.visible = true;
            g.position.set(0, 0, 0);
            g.rotation.set(0, 0, 0);
            ts.add(g);
            g.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(g, true);
            const c = box.getCenter(new THREE.Vector3());
            const r = box.getSize(new THREE.Vector3()).length() / 2;
            tc.position.set(c.x + r * 2.1, c.y + r * 0.45, c.z + r * 0.35); // side-on, barrel left to right
            tc.lookAt(c);
            tr.render(ts, tc);
            pics.push(tr.domElement.toDataURL('image/png'));
            ts.remove(g);
          }
          tr.dispose();
          setGunThumbs(pics);
        } catch {
          /* pictures are a nicety */
        }

        camera.position.copy(start);
        // ?showcase: line up a warrior, rogue and mage in the first corridor, facing you (screenshots).
        if (new URLSearchParams(window.location.search).has('showcase')) {
          const seen = new Set<string>();
          mobs
            .filter((m) => !m.horde && !seen.has(m.m.def.id) && seen.add(m.m.def.id))
            .forEach((mob, i) => {
              const npg = mob.m.def.id === 'miyuki' || mob.m.def.id === 'chibi';
              const spot: [number, number, number][] = npg ? [[2, 1, mob.m.def.id === 'chibi' ? 0.7 : -0.5]] : [[6, 1, 0], [3, 1, -0.9], [4, 1, 0.9], [3, 1, 0.9], [5, 1, -1]];
              if (npg) i = 0;
              if (mob.m.def.id === 'miyuki') mob.m.root.userData.frozen = true; // hold the opening idle pose for a clean preview
              const [cx, cz, off] = spot[i] ?? [5, 1, 0];
              mob.m.root.position.copy(centre([cx, cz], 0)).add(new THREE.Vector3(0, 0, off));
              mob.m.root.rotation.y = -Math.PI / 2;
              if (mob.m.def.id === 'chibi') return; // she has real animations: let her roam from here
              mob.state = 'attack';
              mob.since = now + 1e9; // hold the pose
              mob.m.play('idle');
            });
        }
        ready = true;
        setLoading(1);
      })
      .catch((e) => !disposed && setLoadError(e instanceof Error ? e.message : String(e)));

    // ── Input ──
    const keys = new Set<string>();
    let yaw = -Math.PI / 2; // start looking along the first corridor (+x)
    let pitch = 0;
    let trigger = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.type === 'keydown') keys.add(e.code);
      else keys.delete(e.code);
      if (e.code === 'Space') trigger = e.type === 'keydown';
      if (e.type === 'keydown' && /^Digit[1-9]$/.test(e.code)) selectGun(GUNS.findIndex((g) => g.key === e.code.slice(5)));
    };
    const onMouse = (e: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      yaw -= e.movementX * 0.0022;
      pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0022));
    };
    const onDown = () => (trigger = true);
    const onUp = () => (trigger = false);
    let wasLocked = false;
    const onLock = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (wasLocked && !locked) {
        setPlaying(false); // Esc pauses
        trigger = false;
      }
      wasLocked = locked;
    };
    const touch = {
      move: null as null | { id: number; x: number; y: number; dx: number; dy: number },
      look: null as null | { id: number; x: number; y: number },
    };
    const onTouchStart = (e: TouchEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX - r.left < r.width / 2) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
        else touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (touch.move?.id === t.identifier) {
          touch.move.dx = Math.max(-1, Math.min(1, (t.clientX - touch.move.x) / 50));
          touch.move.dy = Math.max(-1, Math.min(1, (t.clientY - touch.move.y) / 50));
        }
        if (touch.look?.id === t.identifier) {
          yaw -= (t.clientX - touch.look.x) * 0.006;
          pitch = Math.max(-1.2, Math.min(1.2, pitch - (t.clientY - touch.look.y) * 0.006));
          touch.look.x = t.clientX;
          touch.look.y = t.clientY;
        }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (touch.move?.id === t.identifier) touch.move = null;
        if (touch.look?.id === t.identifier) touch.look = null;
      }
    };
    const onFireButton = (e: Event) => (trigger = (e as CustomEvent<boolean>).detail !== false);
    const onCycle = () => selectGun(nextGun(1));
    const onPickWeapon = (e: Event) => selectGun((e as CustomEvent<number>).detail);
    const onWheel = (e: WheelEvent) => {
      if (!held.length || Math.abs(e.deltaY) < 10) return;
      selectGun(nextGun(e.deltaY > 0 ? 1 : -1));
    };
    window.addEventListener('arena:cycle', onCycle);
    window.addEventListener('arena:weapon', onPickWeapon);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });
    const onEnter = () => {
      // Play even if the browser refuses pointer lock (arrows aim, click on the arena fires).
      setPlaying(true);
      if (!sfx) sfx = makeSfx();
      sfx?.resume();
      try {
        void Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(() => undefined);
      } catch {
        /* refused */
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('arena:fire', onFireButton);
    window.addEventListener('arena:enter', onEnter);
    document.addEventListener('mousemove', onMouse);
    document.addEventListener('pointerlockchange', onLock);
    renderer.domElement.addEventListener('mousedown', onDown);
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);

    // ── Shooting: instant on screen, real blasts in batches in the background ──
    const raycaster = new THREE.Raycaster();
    let n = 0;
    let heat = 0;
    let lastShot = 0;
    let recoil = 0;
    let walkPhase = 0;
    type Shot = { extra: string[]; to?: string; target?: string };
    const queue: Shot[] = [];
    let draining = false;
    let jammedUntil = 0;
    let fails = 0;
    const drain = async () => {
      if (draining) return;
      draining = true;
      while (queue.length) {
        // One destination per batch: a run of shots at the same player (or the burn address).
        let run = 1;
        while (run < queue.length && run < BATCH && queue[run].to === queue[0].to) run++;
        const batch = queue.slice(0, run);
        const to = batch[0].to;
        const target = batch[0].target;
        try {
          const extras = batch.map((q) => q.extra);
          const txids = await (live.current.tokenMode ? live.current.fireTokens(n + 1, extras.slice(0, 25), to) : live.current.fireBatch(n + 1, extras));
          // Tell the player we hit: their gun just received our tokens.
          if (target && txids.length && room) {
            const tk = net.current.token;
            room.broadcast('hit', { to: target, from: net.current.name, n: txids.length, tokens: live.current.tokenMode, sym: tk?.sym, icon: tk?.icon, txid: txids[txids.length - 1] });
          }
          n += txids.length;
          queue.splice(0, txids.length);
          setHud((h) => ({ ...h, onChain: h.onChain + txids.length, last: txids[txids.length - 1] ?? h.last }));
          const isTok = live.current.tokenMode;
          setRecent((r) => [...txids.map((t) => ({ txid: t, token: isTok })).reverse(), ...r].slice(0, 6));
          setChainError(null);
          fails = 0;
          if (!txids.length) throw new Error('Out of ammo.');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Empty gun = a real stop. Anything else (slow ARC, a stale coin) gets retried quietly first.
          const empty = /out of|empty|no tokens|no sats|load/i.test(msg);
          if (!empty && ++fails <= 3) {
            await new Promise((ok) => setTimeout(ok, 1000 * fails));
            continue;
          }
          fails = 0;
          setChainError(msg);
          queue.length = 0;
          jammedUntil = performance.now() + 4000; // shots that didn't reach the chain don't get to keep playing
          setJam(e instanceof Error ? e.message : String(e));
          break;
        }
        heat = queue.length;
        setHud((h) => ({ ...h, heat }));
      }
      heat = queue.length;
      setHud((h) => ({ ...h, heat }));
      draining = false;
    };
    /** Monsters with no attack animation lunge at you instead. */
    const lunge = (mob: Mob, now: number) => {
      mob.m.body.userData.lunge = now;
    };
    const shoot = (now: number) => {
      const g = held[gunIdx]?.def ?? GUNS[gunIdx];
      if (!ready || now - lastShot < g.fireMs || deadUntil) return;
      if (now < jammedUntil) {
        if (now - lastShot > 300) {
          lastShot = now;
          sfx?.click();
        }
        return;
      }
      // Only fire shots the gun can pay for, counting the ones already queued for the chain.
      const L = live.current;
      const canPay = L.tokenMode ? Math.min(Math.floor(L.tokens), Math.floor(L.ammo / TOKEN_FEE)) - heat : Math.floor(L.ammo / FEE_PER_SHOT) - heat;
      if (!live.current.armed || canPay < g.pellets) {
        if (now - lastShot > 300) {
          lastShot = now;
          sfx?.click();
          setEmpty(true);
        }
        return;
      }
      if (heat + g.pellets > MAX_HEAT) return;
      setEmpty(false);
      lastShot = now;
      sfx?.shoot();
      const from = held[gunIdx] ? held[gunIdx].group.localToWorld(held[gunIdx].muzzle.clone()) : camera.position.clone();
      const boxes = [...mobs.filter((m) => m.state !== 'dying' && m.state !== 'dead' && m.m.root.visible).map((m) => m.m.hitbox), ...[...remotes.values()].map((r) => r.m.hitbox)];
      let kills = 0;
      // Every pellet is its own raycast and its own on-chain blast.
      for (let k = 0; k < g.pellets; k++) {
        raycaster.setFromCamera(new THREE.Vector2((Math.random() - 0.5) * g.spread * 2, (Math.random() - 0.5) * g.spread * 2), camera);
        const first = raycaster.intersectObjects([...walls, ...boxes], false)[0];
        const end = first ? first.point : camera.position.clone().addScaledVector(raycaster.ray.direction, 40);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, end]), boltMats.get(g.id));
        scene.add(line);
        bolts.push({ line, born: now });
        if (coinReady && flyers.length < 60) {
          const s = new THREE.Sprite(flyMat);
          s.scale.setScalar(0.12);
          s.position.copy(from);
          scene.add(s);
          flyers.push({ s, from: from.clone(), to: end.clone(), born: now });
        }
        const mob = first && mobs.find((m) => m.m.hitbox === first.object && m.state !== 'dying' && m.state !== 'dead');
        let killed = false;
        if (first) sparkAt(first.point, mob ? '#c8ffd0' : g.bolt);
        if (mob) {
          mob.hp--;
          sfx?.hit();
          if (mob.hp <= 0) {
            killed = true;
            kills++;
            mob.state = 'dying';
            if (mob.m.has('death')) mob.m.play('death', { once: true, fade: 0.08 });
            sfx?.die();
          } else if (mob.m.has('hit')) {
            mob.state = 'hit';
            mob.m.play('hit', { once: true, fade: 0.05 });
          }
          mob.since = now;
        }
        const foe = first && [...remotes.entries()].find(([, r]) => r.m.hitbox === first.object);
        if (foe) {
          sparkAt(first!.point, '#ffd04a');
          sfx?.hit();
          queue.push({ extra: ['arena', 'player', foe[0]], to: foe[1].gun || undefined, target: foe[0] });
        } else queue.push({ extra: ['arena', mob ? (killed ? 'kill' : 'hit') : 'miss'] });
      }
      heat = queue.length;
      // Spent coin out of the ejection port (gun's right side), tumbling up and back.
      if (coinReady) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0);
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
        const m = new THREE.Mesh(coinGeo, coinMat);
        m.position.copy(from).addScaledVector(back, 0.35).addScaledVector(right, 0.06);
        m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
        scene.add(m);
        casings.push({
          m,
          v: right.multiplyScalar(1.6 + Math.random()).addScaledVector(up, 1.8 + Math.random()).addScaledVector(back, 0.4),
          spin: new THREE.Vector3(10 + Math.random() * 10, 6 + Math.random() * 8, 0),
          born: now,
          rest: false,
        });
        if (casings.length > MAX_CASINGS) scene.remove(casings.shift()!.m);
      }
      setHud((h) => ({ ...h, shots: h.shots + g.pellets, kills: h.kills + kills, heat }));
      flash.visible = true;
      flash.material.rotation = Math.random() * Math.PI;
      muzzleLight.intensity = 25 * g.kick;
      recoil = g.kick;
      void drain();
    };

    // ── Line of sight to the player (walls only) ──
    const sight = new THREE.Raycaster();
    const canSee = (from: THREE.Vector3, range: number) => {
      const eye = from.clone().setY(1.5);
      const to = camera.position.clone().sub(eye);
      const dist = to.length();
      if (dist > range) return false;
      sight.set(eye, to.normalize());
      sight.far = dist;
      return sight.intersectObjects(walls, false).length === 0;
    };

    // ── Loop ──
    const timer = new THREE.Timer();
    let raf = 0;
    const tick = (t?: number) => {
      timer.update(t);
      const dt = Math.min(0.05, timer.getDelta());
      const now = performance.now();
      const w = el.clientWidth;
      const h = el.clientHeight;
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x !== w || size.y !== h) {
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      if (live.current.icon !== badgeSrc) {
        badgeSrc = live.current.icon;
        if (badgeSrc) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            paintBadge(img);
            paintCoin(img);
          };
          img.src = badgeSrc;
        } else {
          paintBadge(null);
          paintCoin(null);
        }
      }
      if (deadUntil && now > deadUntil) {
        deadUntil = 0;
        health = 100;
        camera.position.copy(start);
        yaw = -Math.PI / 2;
        setDead(false);
        setHud((s) => ({ ...s, health }));
      }

      // Move with wall sliding.
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const f = deadUntil ? 0 : (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (touch.move?.dy ?? 0);
      const s = deadUntil ? 0 : (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (touch.move?.dx ?? 0);
      if (keys.has('ArrowLeft')) yaw += 2.2 * dt;
      if (keys.has('ArrowRight')) yaw -= 2.2 * dt;
      const speed = (keys.has('ShiftLeft') ? 9 : 6.5) * dt;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const step = fwd.multiplyScalar(f * speed).add(right.multiplyScalar(s * speed));
      const pad = 0.4;
      const nx = camera.position.x + step.x;
      const nz = camera.position.z + step.z;
      if (!isWall(nx + Math.sign(step.x) * pad, camera.position.z)) camera.position.x = nx;
      if (!isWall(camera.position.x, nz + Math.sign(step.z) * pad)) camera.position.z = nz;
      const moving = Boolean(f || s);
      walkPhase += moving ? dt * 10 : 0;
      camera.position.y = deadUntil ? 0.4 : 1.6 + (moving ? Math.sin(walkPhase) * 0.04 : 0);
      torch.position.copy(camera.position).add(new THREE.Vector3(-Math.sin(yaw) * 2.4, 1.5, -Math.cos(yaw) * 2.4));
      muzzleLight.position.copy(torch.position);
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 300);
      if (muzzleLight.intensity < 5) flash.visible = false;
      recoil = Math.max(0, recoil - dt * 9);
      gun.position.set(
        gunRest.x + (moving ? Math.cos(walkPhase / 2) * 0.012 : 0),
        gunRest.y + (moving ? Math.abs(Math.sin(walkPhase / 2)) * 0.012 : 0) - (deadUntil ? 1 : 0),
        gunRest.z + recoil * 0.06,
      );
      gun.rotation.x = recoil * 0.12;

      if (trigger) shoot(now);
      const hg = held[gunIdx];
      if (hg?.spin && hg.mixer) {
        hg.spin.timeScale += ((trigger ? 3 : 0) - hg.spin.timeScale) * Math.min(1, dt * 5);
        hg.mixer.update(dt);
      }
      // Flying token icons: zip along the shot (120 ms), spinning.
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i];
        const k = (now - f.born) / 120;
        if (k >= 1) {
          scene.remove(f.s);
          flyers.splice(i, 1);
          continue;
        }
        f.s.position.lerpVectors(f.from, f.to, k);
      }
      flyMat.rotation += dt * 14;
      // Casings: gravity, tumble, bounce on the floor, lie there, then go.
      for (let i = casings.length - 1; i >= 0; i--) {
        const c = casings[i];
        if (now - c.born > 6000) {
          scene.remove(c.m);
          casings.splice(i, 1);
          continue;
        }
        if (c.rest) continue;
        c.v.y -= 9.8 * dt;
        c.m.position.addScaledVector(c.v, dt);
        c.m.rotation.x += c.spin.x * dt;
        c.m.rotation.y += c.spin.y * dt;
        if (c.m.position.y < 0.01) {
          c.m.position.y = 0.01;
          if (Math.abs(c.v.y) < 1) {
            c.rest = true;
            c.m.rotation.set(-Math.PI / 2, 0, Math.random() * 6); // lies flat, icon up
          } else {
            c.v.y *= -0.35;
            c.v.x *= 0.5;
            c.v.z *= 0.5;
            c.spin.multiplyScalar(0.5);
          }
        }
      }
      for (let i = bolts.length - 1; i >= 0; i--) {
        if (now - bolts[i].born > 50) {
          scene.remove(bolts[i].line);
          bolts[i].line.geometry.dispose();
          bolts.splice(i, 1);
        }
      }

      if (ready) {
        // Slime burns.
        const here: [number, number] = [Math.floor(camera.position.x / SIZE), Math.floor(camera.position.z / SIZE)];
        if (SLIME.some(([x, z]) => x === here[0] && z === here[1]) && Math.random() < dt * 2) damage(5, now);
        if (slimeTex) slimeTex.offset.set((now / 6000) % 1, (now / 9000) % 1);
        // Medkits.
        for (const m of medkits) {
          if (m.back && now > m.back) {
            m.back = 0;
            m.mesh.visible = true;
          }
          m.mesh.rotation.y += dt;
          if (m.mesh.visible && health < 100 && m.mesh.position.distanceTo(new THREE.Vector3(camera.position.x, 0.3, camera.position.z)) < 1.2) {
            health = Math.min(100, health + 25);
            m.mesh.visible = false;
            m.back = now + 20000;
            sfx?.pickup();
            setHud((x) => ({ ...x, health }));
          }
        }

        // Other players: glide to their last pose, walk while moving, drop if silent for 5 s.
        if (room && now - lastPose > 100) {
          lastPose = now;
          room.broadcast('pose', { id: myId, x: camera.position.x, z: camera.position.z, yaw, name: net.current.name, gun: net.current.gun });
        }
        for (const [id, r] of remotes) {
          if (now - r.seen > 5000) {
            scene.remove(r.m.root);
            remotes.delete(id);
            continue;
          }
          const p = r.m.root.position;
          const gap = p.distanceTo(r.to);
          p.lerp(r.to, Math.min(1, dt * 8));
          r.m.root.rotation.y = r.yaw + Math.PI;
          r.m.play(gap > 0.05 ? 'walk' : 'idle');
          r.m.mixer.update(dt);
        }
        // Monsters.
        const inHall = camera.position.z / SIZE >= HALL_Z;
        for (const mob of mobs) {
          const { m } = mob;
          if (m.root.userData.frozen) m.mixer.setTime(2.2);
          else m.mixer.update(dt);
          if (!playingRef.current) continue; // monsters wait (animating in place) until you start the game
          const p = m.root.position;
          const lungeAt = m.body.userData.lunge as number | undefined;
          if (lungeAt && mob.state !== 'dying') m.body.position.z = now - lungeAt < 400 ? Math.sin(((now - lungeAt) / 400) * Math.PI) * 0.7 : 0;
          const st = m.def;
          const age = now - mob.since;
          if (mob.state === 'dead') {
            if (mob.horde ? inHall && Math.random() < dt * 1.2 : age > 6000) spawn(mob, now);
            continue;
          }
          if (mob.state === 'dying') {
            if (!m.has('death')) {
              const t = Math.min(1, age / 450);
              m.body.rotation.x = -t * Math.PI / 2; // topple over
              m.body.position.y = -t * 0.2;
            }
            if (age > 2500) {
              mob.state = 'dead';
              mob.since = now;
              m.root.visible = false;
            }
            continue;
          }
          if (mob.horde && !m.root.visible) {
            mob.state = 'dead';
            continue;
          }
          if (mob.state === 'hit' && age < 350) continue;
          if (mob.state === 'attack' && age < 900) continue;
          const dist = Math.hypot(camera.position.x - p.x, camera.position.z - p.z);
          const sees = !deadUntil && (mob.horde ? inHall : canSee(p, 20));
          if (sees) {
            mob.dir.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
            m.root.rotation.y = Math.atan2(mob.dir.x, mob.dir.z);
            const reach = Math.max(1.9, st.height * 0.75);
            const inRange = st.ranged ? dist < 16 : dist < reach;
            if (inRange && now > mob.next) {
              mob.state = 'attack';
              mob.since = now;
              mob.next = now + (st.ranged ? 2600 : 1300) + Math.random() * 600;
              if (m.has('attack')) m.play('attack', { once: true, fade: 0.08, speed: 1.3 });
              else lunge(mob, now);
              if (st.ranged) {
                setTimeout(() => {
                  if (mob.state === 'dying' || mob.state === 'dead' || disposed) return;
                  const fb = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, color: new THREE.Color(3, 1.4, 0.5), toneMapped: false, transparent: true, depthWrite: false }));
                  fb.scale.set(0.6, 0.6, 0.6);
                  fb.position.copy(p).add(new THREE.Vector3(0, (st.hover ?? 0) + st.height * 0.6, 0)).addScaledVector(mob.dir, 0.6);
                  scene.add(fb);
                  fireballs.push({ s: fb, v: camera.position.clone().sub(fb.position).normalize().multiplyScalar(10) });
                  sfx?.fireball();
                }, 450);
              } else
                setTimeout(() => {
                  if (mob.state !== 'attack' || disposed) return;
                  if (Math.hypot(camera.position.x - p.x, camera.position.z - p.z) < reach + 0.4) damage(st.damage, performance.now());
                }, 420);
              continue;
            }
            if (mob.state !== 'chase') {
              mob.state = 'chase';
              m.play('run');
            }
            if (!st.ranged || dist > 8) {
              const nxt = p.clone().addScaledVector(mob.dir, st.speed * dt);
              if (dist > 1.4 && !isWall(nxt.x + mob.dir.x * 0.5, nxt.z + mob.dir.z * 0.5)) p.copy(nxt);
            } else m.play('idle');
          } else {
            if (mob.state !== 'wander') {
              mob.state = 'wander';
              m.play('walk');
            }
            const nxt = p.clone().addScaledVector(mob.dir, 1.2 * dt);
            if (isWall(nxt.x + mob.dir.x * 0.8, nxt.z + mob.dir.z * 0.8)) mob.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
            else p.copy(nxt);
            m.root.rotation.y = Math.atan2(mob.dir.x, mob.dir.z);
          }
        }

        for (let i = fireballs.length - 1; i >= 0; i--) {
          const fb = fireballs[i];
          fb.s.position.addScaledVector(fb.v, dt);
          fb.s.material.rotation += dt * 8;
          const hitPlayer = fb.s.position.distanceTo(camera.position) < 0.8;
          if (hitPlayer) damage(12, now);
          if (hitPlayer || isWall(fb.s.position.x, fb.s.position.z) || fb.s.position.y < 0) {
            if (!hitPlayer) sparkAt(fb.s.position, '#ff8030');
            scene.remove(fb.s);
            fb.s.material.dispose();
            fireballs.splice(i, 1);
          }
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        const age = (now - sp.born) / 1000;
        const pos = sp.p.geometry.getAttribute('position') as THREE.BufferAttribute;
        const vel = sp.p.geometry.userData.vel as THREE.Vector3[];
        for (let k = 0; k < vel.length; k++) {
          vel[k].y -= 9 * dt;
          pos.setXYZ(k, pos.getX(k) + vel[k].x * dt, pos.getY(k) + vel[k].y * dt, pos.getZ(k) + vel[k].z * dt);
        }
        pos.needsUpdate = true;
        (sp.p.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age * 3);
        if (age > 0.35) {
          scene.remove(sp.p);
          sp.p.geometry.dispose();
          (sp.p.material as THREE.Material).dispose();
          sparks.splice(i, 1);
        }
      }
      composer.render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('arena:fire', onFireButton);
      window.removeEventListener('arena:cycle', onCycle);
      window.removeEventListener('arena:weapon', onPickWeapon);
      window.removeEventListener('arena:enter', onEnter);
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('pointerlockchange', onLock);
      room?.close();
      composer.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  const icon = iconUrl(b.token?.icon ?? null);
  // Drop the counter the moment you fire: queued shots will each burn about one blast fee.
  const ammoNow = Math.max(0, b.ammo - hud.heat * (tokenMode ? TOKEN_FEE : FEE_PER_SHOT));
  const shotsLeft = tokenMode ? Math.max(0, Math.floor(b.tokenAmmo) - hud.heat) : Math.floor(ammoNow / FEE_PER_SHOT);
  const isReady = loading >= 1;

  // Wallet → Gun → Fired: where your ammo is, always visible.
  const sym = b.token?.sym ?? '';
  const gunHeld = b.token ? b.gunTokens.find((t) => t.id === b.token!.id) : undefined;
  const inGun = gunHeld ? Number(gunHeld.amt) / 10 ** (b.token?.dec ?? 0) : b.tokenAmmo;
  const fuelShots = Math.floor(b.ammo / (tokenMode ? TOKEN_FEE : FEE_PER_SHOT));
  const flow = (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
      {tokenMode && b.token ? (
        <>
          <span className="inset bg-black/70 px-2 py-1">
            <span className="text-dim">WALLET </span>
            <span className="text-hot">{heldTok?.balance?.toLocaleString() ?? 0}</span> <span className="text-fg">${sym}</span>
          </span>
          <span className="text-hot">→</span>
          <span className="inset bg-black/70 px-2 py-1">
            <span className="text-dim">GUN </span>
            <span className="text-hot">{inGun.toLocaleString()}</span> <span className="text-fg">${sym}</span>
            <span className="text-dim"> · fuel for {fuelShots.toLocaleString()}</span>
          </span>
          <span className="text-hot">→</span>
          <span className="inset bg-black/70 px-2 py-1">
            <span className="text-dim">FIRED </span>
            <span className="text-hot">{hud.onChain.toLocaleString()}</span> <span className="text-dim">on chain</span>
          </span>
        </>
      ) : (
        <>
          <span className="inset bg-black/70 px-2 py-1">
            <span className="text-dim">GUN </span>
            <span className="text-hot">{fuelShots.toLocaleString()}</span> <span className="text-dim">sats shots</span>
          </span>
          <span className="text-hot">→</span>
          <span className="inset bg-black/70 px-2 py-1">
            <span className="text-dim">FIRED </span>
            <span className="text-hot">{hud.onChain.toLocaleString()}</span> <span className="text-dim">on chain</span>
          </span>
        </>
      )}
    </div>
  );

  const cycleToken = () => {
    const all = [...b.tokens];
    if (b.token && !all.some((t) => t.id === b.token!.id)) all.unshift(b.token);
    if (all.length < 2) return;
    const i = all.findIndex((t) => t.id === b.token?.id);
    b.setToken(all[(i + 1) % all.length]);
  };
  // T: cycle which token you fire, without leaving the game.
  useEffect(() => {
    cycleRef.current = cycleToken;
  });

  return (
    <section className={playing ? 'fixed inset-0 z-40 flex flex-col bg-bg' : 'panel'}>
      <GameAudio track="arena" />
      {!playing && (
        <div className="panel-header">
          <span className="panel-title">Arena</span>
          <span className="text-dim">
            {b.wallet ? (
              <>
                {b.wallet.name} <span className="text-hot">{b.wallet.address.slice(0, 6)}…</span>
              </>
            ) : (
              'not connected'
            )}
          </span>
        </div>
      )}

      <div className={playing ? 'relative min-h-0 flex-1' : 'relative'}>
        <div ref={mount} className={`touch-none select-none overflow-hidden ${playing ? 'h-full w-full' : 'inset h-[78vh] min-h-[34rem] w-full'}`} />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-hot/80" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-hot/80" />
        </div>
        {hurt && <div className="pointer-events-none absolute inset-0 bg-red-600/30" />}
        {dead && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-900/50">
            <span className="text-4xl font-bold text-hot">YOU DIED</span>
          </div>
        )}
        {playing && (
          <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-col items-start gap-1">
            {flow}
            {players > 1 && <span className="inset bg-black/70 px-2 py-1 text-sm text-hot">{players} players in the arena · shoot them to send your tokens</span>}
          </div>
        )}
        {toasts.length > 0 && (
          <div className="pointer-events-none absolute left-1/2 top-16 flex -translate-x-1/2 flex-col items-center gap-1">
            {toasts.map((t) => (
              <div key={t.id} className="inset flex items-center gap-2 border-fg bg-black/85 px-3 py-1 text-sm text-hot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.icon && <img src={t.icon} alt="" className="h-5 w-5 rounded" />}
                {t.text}
              </div>
            ))}
          </div>
        )}
        {playing && recent.length > 0 && (
          <div className="absolute right-2 top-2 flex w-56 flex-col gap-1 text-xs">
            {recent.map((r) => (
              <a
                key={r.txid}
                href={`https://whatsonchain.com/tx/${r.txid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inset flex items-center gap-2 bg-black/75 px-2 py-1 hover:border-fg"
              >
                {r.token && icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={icon} alt="" className="h-5 w-5 rounded" />
                ) : (
                  <span className="text-hot">●</span>
                )}
                <span className="text-hot">{r.token ? `−1 $${sym}` : 'sats shot'}</span>
                <span className="ml-auto text-dim">{r.txid.slice(0, 8)}… ↗</span>
              </a>
            ))}
          </div>
        )}
        {playing && empty && (
          <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 text-center">
            <div className="text-3xl font-bold text-hot blink">OUT OF AMMO</div>
            <div className="text-sm text-dim">Esc → LOAD more shots</div>
          </div>
        )}
        {jam && (
          <div className="pointer-events-none absolute left-1/2 top-[30%] max-w-lg -translate-x-1/2 text-center">
            <div className="text-3xl font-bold text-hot blink">JAMMED</div>
            <div className="mt-1 bg-black/70 px-3 py-1 text-sm text-hot">Shots did not reach the chain: {jam}</div>
          </div>
        )}
        {hud.heat >= MAX_HEAT && <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-2xl font-bold text-hot blink">OVERHEAT</div>}
        {playing && (
          <button
            onPointerDown={() => window.dispatchEvent(new CustomEvent('arena:fire', { detail: true }))}
            onPointerUp={() => window.dispatchEvent(new CustomEvent('arena:fire', { detail: false }))}
            onPointerLeave={() => window.dispatchEvent(new CustomEvent('arena:fire', { detail: false }))}
            className="btn-fire absolute bottom-4 right-4 sm:hidden"
            disabled={!armed}
          >
            FIRE
          </button>
        )}
        {playing && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1">
            {ALL_GUNS.map((g, i) =>
              i >= GUNS.length && !owned.has(g.id) ? null : (
                <button
                  key={g.id}
                  onClick={() => window.dispatchEvent(new CustomEvent('arena:weapon', { detail: i }))}
                  className={`btn px-2 py-1 text-xs ${i === weapon ? 'btn-on' : 'opacity-70'}`}
                >
                  {g.key && <span className="text-dim">{g.key}</span>} {g.name}
                </button>
              ),
            )}
          </div>
        )}
        {!playing && (
          <div
            className={`absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto bg-black/85 px-4 py-5 text-center text-sm ${isReady ? 'cursor-pointer' : ''}`}
            onClick={(e) => isReady && e.target === e.currentTarget && window.dispatchEvent(new Event('arena:enter'))}
          >
            <p className="text-3xl font-bold text-hot">ARENA</p>
            {players > 1 && <p className="text-sm text-hot">{players} players in the arena now · hitting a player sends them your token</p>}
            {b.wallet && flow}
            <p className="max-w-2xl text-sm text-dim">WASD move · Shift run · mouse aim · hold click to fire · 1–4 guns · T token · Esc pause. Every bullet is a real transaction.</p>
            {loadError ? (
              <p className="text-sm text-hot">⚠ Could not load the arena: {loadError}</p>
            ) : !isReady ? (
              <div className="w-64">
                <div className="h-2 bg-input">
                  <div className="h-full bg-fg transition-[width]" style={{ width: `${Math.round(loading * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-dim">loading arena {Math.round(loading * 100)}%</p>
              </div>
            ) : null}
            {/* gun */}
            <div className="w-full max-w-5xl">
              <p className="mb-2 text-left text-base font-bold text-hot">PICK A GUN</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ALL_GUNS.map((g, i) => {
                  const locked = i >= GUNS.length && !owned.has(g.id);
                  // Show a taste of the locked ordnance; the rest live in the store tile below.
                  if (locked && ALL_GUNS.slice(GUNS.length, i).filter((x) => !owned.has(x.id)).length >= 3) return null;
                  if (locked)
                    return (
                      <Link key={g.id} href="/1satordnance/store" className="inset relative flex flex-col items-center bg-black/60 px-2 py-2 text-sm text-dim opacity-60 hover:opacity-100" title="Locked: own this 1Sat ordinal to unlock it">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {g.ordnance && <GunArt o={g.ordnance} className="h-24 w-48 object-contain grayscale" />}
                        <div className="font-bold">🔒 {g.name}</div>
                        <div className="text-xs text-accent">1Sat Ordnance · get it ›</div>
                      </Link>
                    );
                  return (
                  <button
                    key={g.id}
                    onClick={() => window.dispatchEvent(new CustomEvent('arena:weapon', { detail: i }))}
                    className={`inset flex flex-col items-center bg-black/60 px-2 py-2 text-sm ${i === weapon ? 'border-fg text-hot' : 'text-dim opacity-80 hover:text-hot hover:opacity-100'}`}
                  >
                    {gunThumbs[i] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={gunThumbs[i]} alt="" className="h-24 w-48 object-contain" />
                    ) : (
                      <div className="h-24 w-48" />
                    )}
                    <div className="font-bold">
                      {g.key ? `${g.key} · ` : '★ '}
                      {g.name}
                    </div>
                    <div>
                      {Math.round(1000 / g.fireMs)}/s{g.pellets > 1 ? ` · ${g.pellets} pellets` : ''}
                    </div>
                  </button>
                  );
                })}
                <Link href="/1satordnance/store" className="inset flex flex-col items-center justify-center bg-black/60 px-2 py-2 text-sm text-hot hover:border-fg">
                  <div className="text-3xl">🛒</div>
                  <div className="font-bold">1Sat Ordnance store</div>
                  <div className="text-xs text-accent">{ALL_GUNS.length - GUNS.length} weapons you can own ›</div>
                </Link>
              </div>
              <p className="mt-1 text-left text-xs text-dim">
                🔒 guns are <Link href="/1satordnance" className="underline hover:text-hot">1Sat Ordnance</Link>: real ordinals. Hold one in your wallet and it unlocks here.
              </p>
            </div>

            <div className="w-full max-w-xl">
              <AmmoStrip
                b={b}
                armed={armed}
                title="AMMO"
                tokenPresets={[10, 100, 1_000, 10_000, 100_000]}
                initialTokenLoad={100}
                remember
                sats={{
                  picker: <AmmoPicker value={shots} onChange={setShots} bsvUsd={bsvUsd} />,
                  label: `${armed ? 'LOAD MORE' : 'LOAD'} ${formatCount(shots)} SATS BLASTS`,
                  onLoad: () => void b.load(packSats(shots), `TokenBlaster arena: ${formatCount(shots)} shots`),
                }}
                playLabel={tokenMode && b.token ? `▶ PLAY LIVE · $${b.token.sym}` : '▶ PLAY LIVE · SATS BLASTS'}
                onPlay={() => window.dispatchEvent(new Event('arena:enter'))}
                playReady={isReady}
                onPractice={() => window.dispatchEvent(new Event('arena:enter'))}
                practiceLabel={armed ? '▶ PLAY PRACTICE (walk around, no shots)' : '▶ PLAY PRACTICE (no ammo, no shots)'}
                details={
                  <details className="text-xs text-dim">
                    <summary className="cursor-pointer">gun details</summary>
                    <div className="mt-2 flex flex-col gap-2">
                      {b.stranded.map((t) => (
                        <div key={t.id} className="inset border-fg bg-black/70 px-3 py-2 text-hot">
                          <p>
                            {t.why === 'icon'
                              ? `Your wallet shows ${t.balance?.toLocaleString()} $${t.sym} with a broken icon: TokenBlaster saved them without the icon. Our bug.`
                              : `${t.balance?.toLocaleString()} $${t.sym} are in your wallet but it can't show them: TokenBlaster sent them back without the note your wallet reads. Our bug.`}
                          </p>
                          <button onClick={() => b.fixStranded(t)} disabled={!!b.busy} className="btn btn-on mt-2 text-xs">
                            {b.busy === 'loading-tokens' ? 'APPROVE IN WALLET…' : t.why === 'icon' ? `FIX THE $${t.sym} ICON` : `FIX: SHOW MY $${t.sym} IN MY WALLET`}
                          </button>
                        </div>
                      ))}
                      {b.wallet && (
                        <div className="break-all">
                          Wallet: <span className="text-fg">{b.wallet.name}</span> · {b.wallet.address}
                        </div>
                      )}
                      {b.gunAddress && (
                        <div title="Your gun's own address in this browser: loaded sats and tokens sit here">
                          Your gun: <span className="break-all text-hot">{b.gunAddress}</span>
                          <span className="ml-2 inline-flex gap-1 align-middle">
                            <button onClick={() => navigator.clipboard?.writeText(b.gunAddress)} className="btn px-2 py-0 text-xs">
                              copy
                            </button>
                            <a href={`https://whatsonchain.com/address/${b.gunAddress}`} target="_blank" rel="noopener noreferrer" className="btn px-2 py-0 text-xs">
                              chain
                            </a>
                            <button onClick={() => void b.refreshTokens()} className="btn px-2 py-0 text-xs" title="Sent tokens to your gun yourself? Re-read it.">
                              refresh
                            </button>
                          </span>
                        </div>
                      )}
                      {(b.gunTokens.length > 0 || b.ammo > 0) && (
                        <div>
                          In the gun now:{' '}
                          <span className="text-hot">
                            {[
                              ...b.gunTokens.map((t) => {
                                const m = b.tokens.find((x) => x.id === t.id);
                                return `${(Number(t.amt) / 10 ** (m?.dec ?? 0)).toLocaleString()} $${m?.sym ?? t.id.slice(0, 6)}`;
                              }),
                              b.ammo > 0 ? `${b.ammo.toLocaleString()} sats` : '',
                            ]
                              .filter(Boolean)
                              .join(' + ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </details>
                }
              />
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className={`grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6 ${playing ? 'p-2' : 'mt-2'}`}>
        <Cell label="HEALTH" value={`${hud.health}%`} />
        <Cell label={tokenMode ? 'TOKENS' : 'AMMO'} value={shotsLeft.toLocaleString()} sub={tokenMode ? `$${b.token?.sym ?? ''} · ${ammoNow.toLocaleString()} sats fuel` : `sats shots · tag only`} />
        <Cell label="ON CHAIN" value={`${hud.onChain.toLocaleString()} / ${hud.shots.toLocaleString()}`} />
        <Cell label="KILLS" value={hud.kills.toLocaleString()} />
        <Cell label={`${GUNS[weapon]?.key} ${GUNS[weapon]?.name.toUpperCase()}`} value={`${Math.round((hud.heat / MAX_HEAT) * 100)}%`} sub="heat" />
        <button onClick={cycleToken} title="Switch token (T)" className="inset flex items-center justify-center gap-2 px-2 py-1 hover:border-fg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {icon ? <img src={icon} alt="" className="h-8 w-8" /> : null}
          <span className="text-hot">
            {tokenMode ? '' : 'tag '}${b.token?.sym ?? '…'}
          </span>
          {b.tokens.length > 1 && <span className="text-xs text-dim">T ⟳</span>}
        </button>
      </div>

      {!playing && hud.last && (
        <p className="mt-2 truncate text-xs text-dim">
          last shot on chain:{' '}
          <a href={`https://whatsonchain.com/tx/${hud.last}`} target="_blank" rel="noreferrer" className="text-accent hover:text-hot">
            {hud.last}
          </a>
        </p>
      )}
      {(chainError || (playing && b.error)) && <p className={`text-sm text-hot ${playing ? 'px-2 pb-2' : 'mt-2'}`}>⚠ {chainError ?? b.error}</p>}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </section>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset px-2 py-1">
      <div className="text-xs tracking-widest text-dim">{label}</div>
      <div className="text-lg font-bold tabular-nums text-hot">
        {value}
        {sub && <span className="text-xs text-dim"> {sub}</span>}
      </div>
    </div>
  );
}
