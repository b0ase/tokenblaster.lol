'use client';

/**
 * Art for 1Sat Ordnance weapons without hand-made images: one offscreen renderer draws the
 * weapon's tinted glTF on its own poster backdrop. Used for store cards and as the inscription file.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildGun } from './arenaHD';
import { RARITY_COLOR, ammoOf, type Ordnance } from './ordnance';
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
  // Dev check (?firetest): an arrow from the muzzle along the firing direction.
  if (typeof location !== 'undefined' && location.search.includes('firetest')) {
    const L = held.def.length;
    holder.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), held.muzzle, L * 0.6, 0xff0000, L * 0.15, L * 0.08));
  }
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
    const ammo = ammoOf(o);
    const glowMat = (c: string, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    // Per ammo: projectile look, speed (gun lengths/s), life (s), gravity, and whether it bursts at the end.
    const kinds = {
      bullet: { geo: new THREE.CapsuleGeometry(len * 0.008, len * 0.16, 3, 6), mat: glowMat('#ffe9a0', 2.5), speed: 5, life: 0.35, g: 0, burst: false },
      pellet: { geo: new THREE.SphereGeometry(len * 0.01, 6, 4), mat: glowMat('#ffd27a', 2.5), speed: 4, life: 0.25, g: 0, burst: false },
      laser: { geo: new THREE.CylinderGeometry(len * 0.008, len * 0.008, len * 3, 6).translate(0, len * 1.5, 0), mat: glowMat(o.stats.bolt, 3), speed: 0, life: 0.09, g: 0, burst: false },
      plasma: { geo: new THREE.CapsuleGeometry(len * 0.022, len * 0.28, 4, 8), mat: glowMat(o.stats.bolt, 2.2), speed: 2.6, life: 0.6, g: 0, burst: false },
      rocket: { geo: new THREE.CapsuleGeometry(len * 0.035, len * 0.18, 4, 8), mat: new THREE.MeshStandardMaterial({ color: '#3d4a2a', metalness: 0.4, roughness: 0.5 }), speed: 1.4, life: 0.9, g: 0, burst: true },
      grenade: { geo: new THREE.SphereGeometry(len * 0.045, 10, 8), mat: new THREE.MeshStandardMaterial({ color: '#40d070', metalness: 0.3, roughness: 0.5, emissive: '#103018' }), speed: 1.6, life: 0.85, g: 2.2, burst: true },
    } as const;
    const k = kinds[ammo];
    if (ammo !== 'laser') k.geo.rotateX(Math.PI / 2);
    else k.geo.rotateX(-Math.PI / 2); // beam lies along -Z from the muzzle
    const smokeMat = new THREE.MeshBasicMaterial({ color: '#c8c2b8', transparent: true, opacity: 0.5, depthWrite: false });
    const smokeGeo = new THREE.SphereGeometry(len * 0.03, 8, 6);
    const boomMat = glowMat('#ffb070', 3);
    const boomGeo = new THREE.SphereGeometry(len * 0.08, 14, 10);
    type Fx = { m: THREE.Mesh; v: THREE.Vector3; age: number; life: number; kind: 'shot' | 'smoke' | 'boom' };
    const bolts: Fx[] = [];
    const spawn = (geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3, v: THREE.Vector3, life: number, kind: Fx['kind']) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(at);
      if (v.lengthSq()) m.lookAt(m.position.clone().add(v));
      s.holder.add(m);
      bolts.push({ m, v, age: 0, life, kind });
    };
    const flash = new THREE.Mesh(new THREE.SphereGeometry(len * 0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(3), toneMapped: false, transparent: true }));
    flash.position.copy(s.held.muzzle);
    flash.visible = false;
    s.holder.add(flash);
    const light = new THREE.PointLight(o.stats.bolt, 0, len * 3);
    light.position.copy(s.held.muzzle);
    s.holder.add(light);
    const shoot = (now: number) => {
      const at = s.held.muzzle.clone();
      for (let i = 0; i < o.stats.pellets; i++) {
        const sp = o.stats.spread * 2;
        const dir = new THREE.Vector3((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, -1).normalize();
        if (ammo === 'laser') {
          const m = new THREE.Mesh(k.geo, k.mat);
          m.position.copy(at);
          s.holder.add(m);
          bolts.push({ m, v: new THREE.Vector3(), age: 0, life: k.life, kind: 'shot' });
        } else spawn(k.geo, k.mat, at.clone().addScaledVector(dir, len * 0.05), dir.multiplyScalar(len * k.speed).add(new THREE.Vector3(0, ammo === 'grenade' ? len * 0.9 : 0, 0)), k.life, 'shot');
      }
      flash.visible = true;
      flash.scale.setScalar(0.7 + Math.random() * 0.8);
      light.intensity = 6;
      kick = Math.min(len * 0.08, kick + len * 0.02 * (0.5 + o.stats.kick));
      sfx(ammo === 'laser' || ammo === 'plasma' ? 'laser' : ammo === 'pellet' ? 'explosion' : ammo === 'rocket' || ammo === 'grenade' ? 'stomp' : 'shot', ammo === 'pellet' ? 0.35 : 0.5);
      if (s.held.spin) s.held.spin.timeScale = 1;
      nextShot = now + Math.max(45, o.stats.fireMs);
    };
    const tick = (now: number) => {
      if (stopped) {
        for (const x of Object.values(kinds)) {
          x.geo.dispose();
          x.mat.dispose();
        }
        smokeGeo.dispose();
        smokeMat.dispose();
        boomGeo.dispose();
        boomMat.dispose();
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
        const f = b.age / b.life;
        if (b.kind === 'shot') {
          if (ammo === 'grenade') b.v.y -= len * k.g * dt;
          b.m.position.addScaledVector(b.v, dt);
          if (ammo === 'plasma') b.m.scale.setScalar(Math.max(0.2, 1 - f * 0.6));
          if (ammo === 'laser') (b.m.material as THREE.MeshBasicMaterial).opacity = 1 - f;
          if (ammo === 'rocket' && Math.random() < 0.7) spawn(smokeGeo, smokeMat, b.m.position.clone(), new THREE.Vector3(0, len * 0.15, 0), 0.5, 'smoke');
        } else if (b.kind === 'smoke') {
          b.m.position.addScaledVector(b.v, dt);
          b.m.scale.setScalar(1 + f * 2.5);
        } else {
          b.m.scale.setScalar(0.4 + f * 2.6);
        }
        if (b.age > b.life) {
          if (b.kind === 'shot' && k.burst) {
            spawn(boomGeo, boomMat, b.m.position.clone(), new THREE.Vector3(), 0.3, 'boom');
            light.position.copy(b.m.position);
            light.intensity = 10;
            sfx('explosion', 0.45);
          }
          s.holder.remove(b.m);
          bolts.splice(i, 1);
        }
      }
      if (!bolts.some((b) => b.kind === 'boom')) light.position.copy(s.held.muzzle);
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

/**
 * Share image for a weapon's page: its poster render on the left, name, tagline, rarity, price and
 * the store URL on the right (1200×630 jpg data URL). Used by /1satordnance/render.
 */
export async function gunOgDataUrl(o: Ordnance, priceLabel: string, slug: string): Promise<string> {
  const art = await new Promise<HTMLCanvasElement>((res, rej) => {
    queue = queue.then(async () => {
      try {
        const src = await draw(o, 630);
        const c = document.createElement('canvas');
        c.width = c.height = 630;
        c.getContext('2d')!.drawImage(src, 0, 0);
        res(c);
      } catch (e) {
        rej(e);
      }
    });
  });
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 630;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0b0d';
  g.fillRect(0, 0, 1200, 630);
  g.drawImage(art, 570, 0);
  const fade = g.createLinearGradient(560, 0, 680, 0);
  fade.addColorStop(0, '#0b0b0d');
  fade.addColorStop(1, 'rgba(11,11,13,0)');
  g.fillStyle = fade;
  g.fillRect(560, 0, 120, 630);
  const rc = RARITY_COLOR[o.rarity];
  g.fillStyle = '#ffd24d';
  g.font = 'bold 26px Menlo, "Courier New", monospace';
  g.fillText('1SAT ORDNANCE', 56, 78);
  g.fillStyle = '#f5b800';
  let size = 92;
  g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  while (g.measureText(o.name.toUpperCase()).width > 520 && size > 40) g.font = `900 ${(size -= 4)}px "Arial Black", Impact, sans-serif`;
  g.fillText(o.name.toUpperCase(), 52, 190);
  g.fillStyle = '#fff1dc';
  g.font = 'bold 30px Menlo, "Courier New", monospace';
  const words = o.tagline.split(' ');
  let line = '';
  let y = 262;
  for (const w of words) {
    if (g.measureText(line + w).width > 500) {
      g.fillText(line.trim(), 56, y);
      y += 40;
      line = '';
    }
    line += w + ' ';
  }
  g.fillText(line.trim(), 56, y);
  g.strokeStyle = rc;
  g.fillStyle = rc;
  g.lineWidth = 4;
  g.font = 'bold 28px Menlo, "Courier New", monospace';
  const tag = `${o.rarity.toUpperCase()} · ${priceLabel}`;
  const tw = g.measureText(tag).width + 32;
  g.strokeRect(56, 420, tw, 52);
  g.fillText(tag, 72, 456);
  g.fillStyle = '#fff1dc';
  g.font = 'bold 24px Menlo, "Courier New", monospace';
  g.fillText('TOKENBLASTER.LOL/1SATORDNANCE/STORE/', 56, 540);
  g.fillStyle = '#f5b800';
  g.fillText(slug.toUpperCase(), 56, 574);
  g.strokeStyle = '#7a5c00';
  g.lineWidth = 2;
  g.strokeRect(16, 16, 1168, 598);
  return c.toDataURL('image/jpeg', 0.88);
}

/** Card image data URL at a given size (for pre-rendering). */
export function gunCardDataUrl(o: Ordnance, size = 768): Promise<string> {
  const job = queue.then(async () => (await draw(o, size)).toDataURL('image/webp', 0.86));
  queue = job.catch(() => undefined);
  return job;
}
