'use client';

/**
 * Art for 1Sat Ordnance weapons without hand-made images: one offscreen renderer draws the
 * weapon's tinted glTF on its own poster backdrop. Used for store cards and as the inscription file.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildGun } from './arenaHD';
import { RARITY_COLOR, type Ordnance } from './ordnance';
import { brandGun, tintAmount, tintGun } from './ordnanceGun';
import { gunDefFor, loadGunModel } from './ordnanceModels';
import { installAudio, sfx, unlockAudio } from './sfx';

let renderer: THREE.WebGLRenderer | null = null;
const envs = new WeakMap<THREE.WebGLRenderer, THREE.Texture>(); // a PMREM texture belongs to one GL context
const urls = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();


function setup(r: THREE.WebGLRenderer) {
  // Neutral keeps the models' own colours (ACES washed the reds, greens and blues out).
  r.toneMapping = THREE.NeutralToneMapping;
  r.toneMappingExposure = 1.15;
  r.outputColorSpace = THREE.SRGBColorSpace;
}

const RARITY_WORD: Record<Ordnance['rarity'], string> = { common: 'STANDARD ISSUE', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };

/**
 * The card's backdrop: a recruitment-poster look per weapon. Diagonal hazard stripes in the
 * rarity colour, the weapon's name huge and faded behind the gun, a stamp and a tagline.
 */
function poster(o: Ordnance): HTMLCanvasElement {
  const N = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const rc = RARITY_COLOR[o.rarity];
  const bg = g.createRadialGradient(N / 2, N * 0.48, 40, N / 2, N / 2, N * 0.75);
  bg.addColorStop(0, '#2c2410');
  bg.addColorStop(1, '#070708');
  g.fillStyle = bg;
  g.fillRect(0, 0, N, N);
  // Hazard stripes: a band across the top and the bottom.
  const stripes = (y: number, h: number) => {
    g.save();
    g.beginPath();
    g.rect(0, y, N, h);
    g.clip();
    g.fillStyle = '#0b0b0d';
    g.fillRect(0, y, N, h);
    g.fillStyle = rc;
    g.globalAlpha = 0.85;
    for (let x = -h * 2; x < N + h; x += 56) {
      g.beginPath();
      g.moveTo(x, y + h);
      g.lineTo(x + 28, y + h);
      g.lineTo(x + 28 + h, y);
      g.lineTo(x + h, y);
      g.fill();
    }
    g.restore();
  };
  stripes(0, 64);
  stripes(N - 64, 64);
  // Sunburst rays behind the gun.
  g.save();
  g.translate(N / 2, N * 0.5);
  g.globalAlpha = 0.07;
  g.fillStyle = rc;
  for (let i = 0; i < 24; i++) {
    g.rotate((Math.PI * 2) / 24);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(N, -40);
    g.lineTo(N, 40);
    g.fill();
  }
  g.restore();
  // Halftone dots in the corners.
  g.fillStyle = rc;
  for (let y = 80; y < N - 80; y += 22)
    for (let x = 0; x < N; x += 22) {
      const d = Math.min(x, N - x) / N;
      const r = Math.max(0, 5 - d * 28);
      if (r > 0.4) {
        g.globalAlpha = 0.18;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  g.globalAlpha = 1;
  // The name, huge and faded, behind everything.
  const name = o.name.toUpperCase();
  g.font = '900 220px "Arial Black", Impact, "Helvetica Neue", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const words = name.split(/\s+/);
  const lines = words.length > 1 && name.length > 9 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name];
  for (const [i, line] of lines.entries()) {
    const fit = Math.min(220, (220 * (N - 60)) / Math.max(1, g.measureText(line).width));
    g.font = `900 ${fit}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillText(line, N / 2, N * 0.5 + (i - (lines.length - 1) / 2) * fit * 0.95);
  }
  // Stamp and tagline.
  g.font = 'bold 34px "Menlo", "Courier New", monospace';
  g.textAlign = 'left';
  g.fillStyle = '#f5b800';
  g.fillText('1SAT ORDNANCE', 48, 120);
  g.textAlign = 'right';
  g.fillStyle = rc;
  g.strokeStyle = rc;
  g.lineWidth = 4;
  const word = RARITY_WORD[o.rarity];
  const w = g.measureText(word).width + 28;
  g.strokeRect(N - 48 - w, 92, w, 52);
  g.fillText(word, N - 62, 120);
  g.textAlign = 'center';
  g.font = 'bold 40px "Menlo", "Courier New", monospace';
  g.fillStyle = '#fff1dc';
  g.fillText(o.tagline.toUpperCase().slice(0, 40), N / 2, N - 120);
  return c;
}

const ART_FIX: Record<string, { yaw?: number; pitch?: number }> = {
  quadplasma: { yaw: Math.PI }, // otherwise its barrels point left on the card
  sawedoff: { pitch: -0.3 }, // held tilted up; level it for the card
};

/** A weapon's scene: backdrop, lights, the tinted (and branded) model on a pivot, and a camera. */
async function buildScene(o: Ordnance, r: THREE.WebGLRenderer) {
  let env = envs.get(r);
  if (!env) {
    env = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    envs.set(r, env);
  }
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 1.35;
  const bg = new THREE.CanvasTexture(poster(o));
  bg.colorSpace = THREE.SRGBColorSpace;
  scene.background = bg;
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x101114, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(RARITY_COLOR[o.rarity]), 3);
  rim.position.set(-4, 2, -4);
  scene.add(rim);

  // Same builder as the games: barrel down -Z, centred, the weapon's own flip/roll fixes applied.
  const def = gunDefFor(o);
  const held = buildGun(def, await loadGunModel(def.url));
  const holder = held.group;
  tintGun(holder, o.tint, tintAmount(o));
  await brandGun(holder, o.id);
  // Card-only fixes for stock models whose in-hand pose doesn't read side-on (games are unaffected).
  const fix = o.model ? undefined : ART_FIX[o.base];
  const posed = new THREE.Group();
  posed.add(holder);
  if (fix) posed.rotation.set(fix.pitch ?? 0, fix.yaw ?? 0, 0);
  posed.updateMatrixWorld(true);
  // Frame on what you can see: skip hidden helpers (muzzle flash etc.) that would throw the centre off.
  const box = new THREE.Box3();
  posed.traverseVisible((n) => {
    const m = n as THREE.Mesh;
    if (m.isMesh && !(m.material as THREE.Material).transparent) box.expandByObject(m, true);
  });
  if (box.isEmpty()) box.setFromObject(posed, true);
  const dim = box.getSize(new THREE.Vector3());
  posed.position.sub(box.getCenter(new THREE.Vector3()));
  const pivot = new THREE.Group();
  pivot.add(posed);
  // Side-on, muzzle to the right, turned a little toward the camera.
  const baseY = -Math.PI / 2 + 0.45;
  pivot.rotation.set(0.18, baseY, 0);
  scene.add(pivot);

  const rad = Math.max(dim.x, dim.y, dim.z);
  const cam = new THREE.PerspectiveCamera(30, 1, rad / 100, rad * 100);
  cam.position.set(0, rad * 0.12, rad * 2.0);
  cam.lookAt(0, 0, 0);
  return { scene, pivot, cam, baseY, held, holder, dispose: () => bg.dispose() };
}

async function draw(o: Ordnance, size: number): Promise<HTMLCanvasElement> {
  renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  setup(renderer);
  const s = await buildScene(o, renderer);
  renderer.render(s.scene, s.cam);
  s.dispose();
  return renderer.domElement;
}

/** A live card: stop it, or hold the trigger for a demo burst (no token, nothing on chain). */
export type LiveGun = { stop: () => void; trigger: (down: boolean) => void };

/**
 * Live, swivelling model in `canvas` (card hover): follows the pointer, drifts when it is still.
 * `trigger(true)` fires a demo burst at the weapon's own rate, pellets, spread and bolt colour
 * (muzzle flash, recoil, bolts, sound) until `trigger(false)`. Nothing is sent anywhere.
 */
export function spinGun(o: Ordnance, canvas: HTMLCanvasElement, pointer: { x: number; y: number }): LiveGun {
  let stopped = false;
  let raf = 0;
  let firing = false;
  let pendingShot = false;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.setSize(canvas.clientWidth, canvas.clientHeight, false);
  setup(r);
  void buildScene(o, r).then((s) => {
    if (stopped) return s.dispose();
    const t0 = performance.now();
    let yaw = s.baseY;
    let pitch = 0.18;
    let last = t0;
    let nextShot = 0;
    let kick = 0;
    let slide = 0;
    const camZ = s.cam.position.z;
    const len = s.held.def.length;
    const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.stats.bolt).multiplyScalar(2.2), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const boltGeo = new THREE.CapsuleGeometry(len * 0.022, len * 0.28, 4, 8).rotateX(Math.PI / 2);
    const bolts: { m: THREE.Mesh; v: THREE.Vector3; age: number }[] = [];
    const flash = new THREE.Mesh(new THREE.SphereGeometry(len * 0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(3), toneMapped: false, transparent: true }));
    flash.position.copy(s.held.muzzle);
    flash.visible = false;
    s.holder.add(flash);
    const light = new THREE.PointLight(o.stats.bolt, 0, len * 3);
    light.position.copy(s.held.muzzle);
    s.holder.add(light);
    const shoot = (now: number) => {
      for (let i = 0; i < o.stats.pellets; i++) {
        const m = new THREE.Mesh(boltGeo, boltMat);
        m.position.copy(s.held.muzzle).add(new THREE.Vector3(0, 0, -len * 0.1));
        const sp = o.stats.spread * 2;
        const v = new THREE.Vector3((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, -1).normalize().multiplyScalar(len * 2.6);
        m.lookAt(m.position.clone().add(v));
        s.holder.add(m);
        bolts.push({ m, v, age: 0 });
      }
      flash.visible = true;
      flash.scale.setScalar(0.7 + Math.random() * 0.8);
      light.intensity = 6;
      kick = Math.min(len * 0.08, kick + len * 0.02 * (0.5 + o.stats.kick));
      sfx(o.stats.pellets > 3 ? 'explosion' : o.base === 'plasmarifle' || o.base === 'quadplasma' ? 'laser' : 'shot', 0.5);
      if (s.held.spin) s.held.spin.timeScale = 1;
      nextShot = now + Math.max(45, o.stats.fireMs);
    };
    const tick = (now: number) => {
      if (stopped) {
        boltGeo.dispose();
        boltMat.dispose();
        return s.dispose();
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      if ((firing || pendingShot) && now >= nextShot) {
        pendingShot = false;
        shoot(now);
      }
      if (now > nextShot - Math.max(45, o.stats.fireMs) + 40) {
        flash.visible = false;
        light.intensity *= 0.6;
      }
      if (!firing && s.held.spin) s.held.spin.timeScale *= 0.95;
      s.held.mixer?.update(dt * 3);
      kick *= 0.85;
      s.holder.position.z = kick;
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        b.age += dt;
        b.m.position.addScaledVector(b.v, dt);
        b.m.scale.setScalar(Math.max(0.2, 1 - b.age * 0.8));
        if (b.age > 0.6) {
          s.holder.remove(b.m);
          bolts.splice(i, 1);
        }
      }
      // Pointer -1..1 across the card swings the gun ~45° either way, with a slow drift on top.
      // While firing it holds steady, side-on, so you can see the shots leave the muzzle.
      const wantYaw = s.baseY + (firing ? 0 : pointer.x * 0.75 + Math.sin(t * 0.8) * 0.2);
      const wantPitch = 0.18 + (firing ? 0 : pointer.y * 0.35);
      yaw += (wantYaw - yaw) * 0.12;
      pitch += (wantPitch - pitch) * 0.12;
      s.pivot.rotation.set(pitch, yaw, firing ? 0 : Math.sin(t * 1.3) * 0.04);
      // Firing: slide the gun left and pull back so the shots have room to fly across the card.
      const aim = firing || bolts.length ? 1 : 0;
      slide += (aim - slide) * 0.1;
      s.pivot.position.x = -camZ * 0.16 * slide;
      s.cam.position.z = camZ * (1 + 0.5 * slide);
      r.render(s.scene, s.cam);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      r.dispose();
      r.forceContextLoss();
    },
    trigger: (down: boolean) => {
      if (down) {
        installAudio();
        unlockAudio();
        pendingShot = true;
      }
      firing = down;
    },
  };
}

/** Inscription file for a weapon: its hand-made art, else a 768² webp render. */
export async function gunArtFile(o: Ordnance): Promise<{ contentType: string; data: number[] }> {
  if (o.image) {
    const r = await fetch(o.image);
    if (!r.ok) throw new Error(`Could not load ${o.image}`);
    return { contentType: r.headers.get('content-type') ?? 'image/webp', data: Array.from(new Uint8Array(await r.arrayBuffer())) };
  }
  const job = queue.then(async () => {
    const cv = await draw(o, 768);
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/webp', 0.85));
    if (!blob) throw new Error('Could not render the weapon');
    return { contentType: blob.type || 'image/webp', data: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  });
  queue = job.catch(() => undefined);
  return job;
}

/** Image URL for a card: hand-made art, else a cached 384² render. */
export function gunArtUrl(o: Ordnance): Promise<string> {
  if (o.image) return Promise.resolve(o.image);
  let p = urls.get(o.id);
  if (!p) {
    p = queue.then(async () => (await draw(o, 384)).toDataURL('image/webp', 0.85));
    queue = p.catch(() => undefined);
    urls.set(o.id, p);
  }
  return p;
}
