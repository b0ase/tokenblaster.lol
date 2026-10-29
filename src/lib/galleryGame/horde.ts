/**
 * THE HORDE: the Arena's monsters (src/lib/arenaHD.ts MONSTERS: raptors, zombies, zombie warriors, hazmat
 * shamblers, eye-beasts, skeleton minions and the hell demon) let loose in TERRORNODE HQ alongside the Erobots,
 * at three sizes: small and fast, medium, and huge. They are the constant swarm that keeps the minigun fed for
 * the whole ten-minute block (owner, 24 Oct 2026).
 *
 * Performance: every body is built once into a fixed pool per kind (SkeletonUtils clones share geometry and
 * textures), recycled on death, and never allocated in the frame loop. How many are alive at once is capped per
 * stage (TUNING.horde.live). Far monsters animate at half rate (a cheap LOD), and shots are analytic
 * ray-vs-sphere tests, not mesh raycasts.
 */
import * as THREE from 'three';
import { LITE_SKIP_MONSTERS } from '@/lib/mobileLite';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Monster, MONSTERS } from '../arenaHD';
import type { Fx } from '../bsvgun/fx';
import { approachK } from './cast';
import { TUNING } from './tuning';

type Kind = (typeof TUNING.horde.kinds)[number];
type State = 'off' | 'walk' | 'attack' | 'dying';
type Mob = {
  m: Monster;
  kind: Kind;
  state: State;
  t: number;
  hp: number;
  size: number;
  speed: number;
  stopZ: number;
  aimX: number;
  swing: number;
  /** Half-rate animation for far mobs: frame parity. */
  odd: boolean;
  acc: number;
  tint: { value: number };
  /** EXPERIMENT (?fused=1): an Arena monster silhouette in Erobot skin (pink chrome, glossy, a hot rim). */
  fused: boolean;
};

/**
 * FUSED VARIANTS, behind `?fused=1`: the Arena monsters' silhouettes (raptor, zombie warrior) re-skinned as
 * Erobots: pink chrome, glossy, a magenta Fresnel rim and cyan seams. Built as extra bodies in the pool and
 * spawned at a low share (FUSED.chance), so the stock swarm is unchanged with the flag off.
 */
const FUSED = {
  on: typeof location !== 'undefined' && new URLSearchParams(location.search).get('fused') === '1',
  kinds: ['raptor', 'zombiewarrior'] as readonly string[],
  perKind: 2,
  chance: 0.12,
};
export type HordeHit = { mob: Mob; point: THREE.Vector3; dist: number };

const rand = (r: readonly [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Horde {
  /** Settles when the current background load queue has drained (see `prefetch`). */
  ready: Promise<void> = Promise.resolve();
  /** Compile and upload a freshly built kind (its bodies, still hidden) before it joins the pool. */
  onKind?: (bodies: THREE.Object3D) => Promise<unknown> | void;
  private loader: GLTFLoader | null = null;
  private queue: string[] = [];
  private pumping = false;
  private requested = new Set<string>();
  private loaded = new Set<string>();
  private mobs: Mob[] = [];
  private group = new THREE.Group();
  private spawnT = 1;
  private disposed = false;
  private frameOdd = false;
  /** Live cap right now (the engine sets it from the stage and the run clock). */
  want = 0;
  spawning = true;
  /** A level's weights by kind id (missing kinds keep their stock weight, 0 removes one), or null for stock. */
  weights: Partial<Record<string, number>> | null = null;
  /** True while the gun is still loading real rounds: no spawns (the engine sets it). */
  paused = false;
  /** Seconds of grace left: nobody bites. */
  grace = 0;
  /** Lane the horde comes down (shared with the Erobots). */
  lane: { spawnZ: number; halfW: number; wallX: number } = TUNING.stages[0].lane;
  impulse = 0;

  constructor(
    private scene: THREE.Scene,
    private fx: Fx,
    private opts: { high: boolean; lite?: boolean; flash?: (at: THREE.Vector3, color: string, intensity: number, ms: number) => void; melee: (from: THREE.Vector3, dmg: number) => void },
  ) {
    this.group.name = 'horde';
    scene.add(this.group);
  }

  /** Live mobs' ground positions (Act 2: they go for Dr Kweg too). */
  threats(out: { x: number; z: number }[]) {
    for (const m of this.mobs) if (m.state === 'walk' || m.state === 'attack') out.push({ x: m.m.root.position.x, z: m.m.root.position.z });
  }

  get live() {
    let n = 0;
    for (const m of this.mobs) if (m.state === 'walk' || m.state === 'attack') n++;
    return n;
  }

  /**
   * PROGRESSIVE LOAD (owner, 29 Oct: "loads far too slowly"): nothing is fetched while the page loads. The run's
   * first-wave kinds (heaviest level weight first) come down one at a time once the game starts, the rest follow
   * in the background. A kind joins the spawn pool only once its shaders are compiled (`onKind`), so a kind that
   * is still loading is simply not drawn: the weighted pick hands its spawn to a kind that is ready, and the
   * Erobots hold the street meanwhile. Never blocks GO.
   */
  prefetch(first: readonly string[] = []) {
    const H = TUNING.horde;
    const wt = (id: string) => this.weights?.[id] ?? H.kinds.find((k) => k.id === id)?.weight ?? 0;
    const want = H.kinds.map((k) => k.id).filter((id) => !this.requested.has(id) && !(this.opts.lite && LITE_SKIP_MONSTERS.includes(id)));
    // first-wave kinds first (in the order asked), then the rest by weight (a 0-weight kind last)
    want.sort((a, b) => (first.includes(b) ? 1 : 0) - (first.includes(a) ? 1 : 0) || wt(b) - wt(a));
    this.queue = want;
    if (!this.pumping) this.ready = this.pump();
    return this.ready;
  }

  /** Kinds whose bodies are in the pool. */
  get loadedKinds(): ReadonlySet<string> {
    return this.loaded;
  }

  private async pump() {
    this.pumping = true;
    try {
      while (this.queue.length && !this.disposed) {
        const id = this.queue.shift()!;
        if (this.requested.has(id)) continue;
        this.requested.add(id);
        await this.loadKind(id).catch(() => undefined);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async loadKind(id: string) {
    const H = TUNING.horde;
    const k = H.kinds.find((x) => x.id === id);
    const def = MONSTERS.find((d) => d.id === id);
    if (!k || !def) return;
    const g = await (this.loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)).loadAsync(def.url);
    if (this.disposed) return;
    const n = this.opts.high ? k.pool : Math.max(1, Math.ceil(k.pool * H.lowPool));
    const nf = FUSED.on && FUSED.kinds.includes(k.id) ? FUSED.perKind : 0;
    const fresh: Mob[] = [];
    const holder = new THREE.Group();
    for (let j = 0; j < n + nf; j++) {
      const fused = j >= n;
      const m = new Monster(def, g);
      const tint = { value: 0 };
      m.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh === m.hitbox) return;
        mesh.castShadow = false; // a swarm of shadow casters would eat the frame
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const out = mats.map((mt) => {
          const c = (mt as THREE.MeshStandardMaterial).clone();
          if (fused && 'emissive' in c) {
            // Erobot skin: keep the texture's light and dark as relief, push it pink and mirror-glossy
            c.color.set('#ff6fb8');
            c.metalness = 0.85;
            c.roughness = 0.22;
            c.envMapIntensity = 1.6;
          }
          if ('emissive' in c) {
            const rim = fused ? '\nfloat fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);\ntotalEmissiveRadiance += vec3(1.0, 0.18, 0.62) * fr * 1.4;' : '';
            c.onBeforeCompile = (sh) => {
              sh.uniforms.uHit = tint;
              sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform float uHit;')
                .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.42, 0.12) * uHit * 1.6;' + rim);
            };
            if (fused) c.customProgramCacheKey = () => 'erobot-fused';
          }
          return c;
        });
        mesh.material = Array.isArray(mesh.material) ? out : out[0];
      });
      m.root.visible = false;
      holder.add(m.root);
      fresh.push({ m, kind: k, state: 'off', t: 0, hp: 0, size: 1, speed: 1, stopZ: -3, aimX: 0, swing: 0, odd: j % 2 === 0, acc: 0, tint, fused });
    }
    // compile + upload off the frame (the engine's hook), THEN join the pool: a new kind never hitches its first frame
    await Promise.resolve(this.onKind?.(holder)).catch(() => undefined);
    if (this.disposed) return;
    for (const f of fresh) this.group.add(f.m.root);
    this.mobs.push(...fresh);
    this.loaded.add(id);
  }

  /** Pick a kind by weight among the ones with a free body. */
  private pick(): Mob | null {
    if (FUSED.on && Math.random() < FUSED.chance) {
      const f = this.mobs.find((m) => m.fused && m.state === 'off');
      if (f) return f;
    }
    let total = 0;
    const wt = (k: Kind) => this.weights?.[k.id] ?? k.weight;
    for (const k of TUNING.horde.kinds) total += wt(k);
    for (let tries = 0; tries < 4; tries++) {
      let r = Math.random() * total;
      let kind: Kind = TUNING.horde.kinds[0];
      for (const k of TUNING.horde.kinds) {
        r -= wt(k);
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      const free = this.mobs.find((m) => m.state === 'off' && !m.fused && m.kind.id === kind.id);
      if (free) return free;
    }
    return this.mobs.find((m) => m.state === 'off' && !m.fused && wt(m.kind) > 0) ?? null;
  }

  private spawn(mob: Mob) {
    const k = mob.kind;
    mob.size = rand(k.size);
    mob.hp = k.hp * mob.size * mob.size;
    mob.speed = rand(k.speed);
    mob.state = 'walk';
    mob.t = 0;
    mob.swing = 0.6 + Math.random() * 0.6;
    mob.acc = 0;
    mob.tint.value = 0;
    const L = this.lane;
    const x = (Math.random() - 0.5) * 2 * L.halfW;
    const z = L.spawnZ - Math.random() * 14 - (mob.size > 2 ? 10 : 0);
    mob.aimX = THREE.MathUtils.clamp((Math.random() - 0.5) * 5, -L.wallX, L.wallX);
    mob.stopZ = -TUNING.horde.minDist - mob.size * TUNING.horde.sizeDist;
    const r = mob.m.root;
    r.position.set(x, 0, z);
    r.rotation.set(0, 0, 0);
    r.scale.setScalar(mob.size);
    mob.m.body.rotation.set(0, 0, 0);
    mob.m.body.position.set(0, 0, 0);
    r.visible = true;
    mob.m.mixer.stopAllAction();
    mob.m.play(mob.speed > 4 && mob.m.has('run') ? 'run' : 'walk', { fade: 0.01, speed: THREE.MathUtils.clamp(mob.speed / 3, 0.7, 1.8) });
    tmp.set(x, 1, z);
    this.fx.ring(tmp, '#ff3a22', 2.4 * mob.size, 0.4);
  }

  /**
   * The block has landed: every live monster drops, staggered over a second or so (no burst of effects, no
   * allocation, no single-frame spike), then sinks away.
   */
  dismiss() {
    this.spawning = false;
    for (const mob of this.mobs) {
      if (mob.state !== 'walk' && mob.state !== 'attack') continue;
      mob.state = 'dying';
      mob.t = -Math.random() * 1.2;
    }
  }

  /** Clear the floor (a fresh run). */
  clearAll() {
    for (const m of this.mobs) {
      m.state = 'off';
      m.m.root.visible = false;
      m.m.mixer.stopAllAction();
    }
    this.spawnT = 1;
  }

  update(dt: number, camera: THREE.Camera, alive: boolean) {
    if (!this.mobs.length) return;
    this.grace = Math.max(0, this.grace - dt);
    this.frameOdd = !this.frameOdd;
    const H = TUNING.horde;
    this.spawnT -= dt;
    // spawn in bursts so the swarm refills fast after a sweep
    if (this.spawning && !this.paused && this.spawnT <= 0) {
      const missing = this.want - this.live;
      for (let i = 0; i < Math.min(missing, H.burst); i++) {
        const mob = this.pick();
        if (!mob) break;
        this.spawn(mob);
      }
      this.spawnT = H.spawnEvery;
    }
    const cx = camera.position.x;
    const cz = camera.position.z;
    // how many are biting right now (at most H.maxClose; the rest hold back, still in the line of fire)
    let close = 0;
    for (const mob of this.mobs) if (mob.state === 'attack') close++;
    this.separate(dt);
    for (const mob of this.mobs) {
      if (mob.state === 'off') continue;
      mob.t += dt;
      const r = mob.m.root;
      const p = r.position;
      // LOD: far mobs animate every other frame at double step
      mob.acc += dt;
      if (p.z > -32 || mob.odd === this.frameOdd) {
        mob.m.mixer.update(mob.acc);
        mob.acc = 0;
      }
      mob.tint.value = Math.max(0, mob.tint.value - dt * 6);
      if (mob.state === 'walk') {
        // PROXIMITY SLOWDOWN: they crawl the last metres, so a player who keeps firing holds the line
        p.z += mob.speed * approachK(cz - p.z, -mob.stopZ) * dt;
        const u = THREE.MathUtils.clamp(1 - (mob.stopZ - p.z) / 30, 0, 1);
        p.x += (mob.aimX - p.x) * Math.min(1, dt * (0.3 + u * 1.4));
        p.x += Math.sin(mob.t * 2.2 + mob.aimX) * dt * 0.6;
        r.rotation.y = Math.atan2(cx - p.x, cz - p.z);
        const full = close >= H.maxClose;
        const stop = cz + mob.stopZ - (full ? H.holdBack + mob.size : 0);
        if (p.z >= stop) {
          p.z = stop;
          if (full) {
            mob.m.body.position.z = 0;
            continue; // waits its turn, still a target
          }
          close++;
          mob.state = 'attack';
          mob.t = 0;
          mob.m.play(mob.m.has('attack') ? 'attack' : 'idle', { fade: 0.15 });
        }
      } else if (mob.state === 'attack') {
        r.rotation.y = Math.atan2(cx - p.x, cz - p.z);
        // never inside point-blank: when the player walks in it gives ground; when the player backs off it follows
        p.z = cz + mob.stopZ;
        mob.swing -= dt;
        if (!mob.m.has('attack')) mob.m.body.position.z = Math.max(0, Math.sin(mob.t * 5)) * 0.35; // lunges if it has no clip
        if (mob.swing <= 0) {
          mob.swing = H.biteEvery * (0.8 + Math.random() * 0.5);
          if (alive && this.grace <= 0 && Math.abs(p.x - cx) < H.biteReach + mob.size) this.opts.melee(tmp.copy(p).setY(1.2 * mob.size), mob.kind.damage);
        }
      } else if (mob.state === 'dying') {
        if (mob.t < 0) continue; // dismissed: waiting its turn to drop
        if (mob.t - dt < 0 && mob.m.has('death')) mob.m.play('death', { once: true, fade: 0.1 });
        if (!mob.m.has('death')) {
          const k = Math.min(1, mob.t / 0.45);
          mob.m.body.rotation.x = -k * Math.PI * 0.5;
        }
        if (mob.t > 1.1) p.y -= dt * 2.2 * mob.size;
        if (mob.t > 2.0) {
          mob.state = 'off';
          r.visible = false;
          mob.m.mixer.stopAllAction();
          p.y = 0;
        }
      }
    }
  }

  /** Bodies push apart sideways (and the rear one back) so the swarm never stacks into one blob in your face. */
  private separate(dt: number) {
    const M = this.mobs;
    for (let i = 0; i < M.length; i++) {
      const a = M[i];
      if (a.state !== 'walk' && a.state !== 'attack') continue;
      const pa = a.m.root.position;
      if (pa.z < -40) continue;
      for (let j = i + 1; j < M.length; j++) {
        const b = M[j];
        if (b.state !== 'walk' && b.state !== 'attack') continue;
        const pb = b.m.root.position;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const want = 0.75 * (a.size + b.size);
        const d2 = dx * dx + dz * dz;
        if (d2 >= want * want) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = Math.min(want - d, 3 * dt) * 0.5;
        const ux = d2 > 1e-4 ? dx / d : i % 2 ? 1 : -1;
        const w = this.lane.wallX;
        pa.x = THREE.MathUtils.clamp(pa.x - ux * push, -w, w);
        pb.x = THREE.MathUtils.clamp(pb.x + ux * push, -w, w);
        if (a.state !== 'attack' && pa.z > pb.z) pa.z -= push * 0.5;
        else if (b.state !== 'attack' && pb.z > pa.z) pb.z -= push * 0.5;
      }
    }
  }

  /** Dev only: put one monster `d` metres in front of (x, cz), standing there (false if the pool is empty). */
  debugPlace(x: number, cz: number, d: number) {
    const z = cz - d;
    const mob = this.pick();
    if (!mob) return false;
    this.spawn(mob);
    mob.m.root.position.set(x, 0, z);
    mob.state = 'attack';
    mob.stopZ = -d; // held at the given spot by the test, not pushed back
    mob.m.root.position.z = z;
    return true;
  }

  /** Dev only: the live monsters' health and distance from (0,0). */
  debugHp() {
    return this.mobs.filter((m) => m.state === 'walk' || m.state === 'attack').map((m) => ({ hp: +m.hp.toFixed(1), z: +m.m.root.position.z.toFixed(2), x: +m.m.root.position.x.toFixed(2) }));
  }

  /** Nearest live mob the ray strikes before `maxDist` (one sphere per body, sized to it). */
  raycast(org: THREE.Vector3, dir: THREE.Vector3, maxDist: number): HordeHit | null {
    let best: HordeHit | null = null;
    let bd = maxDist;
    for (const mob of this.mobs) {
      if (mob.state !== 'walk' && mob.state !== 'attack') continue;
      const d = mob.m.def;
      const h = d.height * mob.size;
      const c = tmp.copy(mob.m.root.position);
      c.y += (d.hover ?? 0) * mob.size + h * 0.55;
      const rr = Math.max(0.55, h * 0.42) * TUNING.horde.hitScale;
      tmp2.subVectors(c, org);
      const tc = tmp2.dot(dir);
      const l2 = tmp2.lengthSq();
      // POINT-BLANK: the ray starts inside the body's sphere: that is a hit (it used to be skipped as a miss)
      const inside = l2 < rr * rr;
      if (tc < 0 && !inside) continue;
      const d2 = l2 - tc * tc;
      if (d2 > rr * rr && !inside) continue;
      const th = inside ? 0.01 : tc - Math.sqrt(rr * rr - d2);
      if (th > 0 && th < bd) {
        bd = th;
        best ??= { mob, point: new THREE.Vector3(), dist: th };
        best.mob = mob;
        best.dist = th;
        best.point.copy(dir).multiplyScalar(th).add(org);
      }
    }
    return best;
  }

  /** Damage the struck mob. */
  hit(h: HordeHit, dmg: number): { killed: boolean; score: number; big: boolean } {
    const mob = h.mob;
    if (mob.state !== 'walk' && mob.state !== 'attack') return { killed: false, score: 0, big: false };
    mob.hp -= dmg;
    mob.tint.value = 1;
    if (Math.random() < 0.25) this.fx.sparks(h.point, '#ff6a2a', 2, 6);
    const big = mob.size > 2;
    if (mob.hp > 0) return { killed: false, score: Math.round(dmg * 2), big };
    mob.state = 'dying';
    mob.t = 0;
    if (mob.m.has('death')) mob.m.play('death', { once: true, fade: 0.1 });
    tmp.copy(mob.m.root.position).setY(mob.m.def.height * mob.size * 0.5);
    this.fx.sparks(tmp, '#ff6a2a', big ? 60 : 18, big ? 14 : 9);
    this.fx.ring(tmp, '#ff9a4a', (big ? 3 : 1.6) * mob.size, 0.4);
    if (big || Math.random() < 0.35) this.opts.flash?.(tmp, '#ff6a2a', big ? 160 : 60, big ? 900 : 300);
    if (big) this.impulse = Math.max(this.impulse, 0.6);
    return { killed: true, score: Math.round(mob.kind.score * mob.size), big };
  }

  /** Live mobs for the AI squad (squad.ts). */
  foes(out: { id: string; x: number; z: number; hit: (dmg: number, from: THREE.Vector3) => boolean }[]) {
    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      if (mob.state !== 'walk' && mob.state !== 'attack') continue;
      out.push({
        id: `h${i}`,
        x: mob.m.root.position.x,
        z: mob.m.root.position.z,
        hit: (dmg, from) => {
          const point = mob.m.root.position.clone();
          point.y += mob.m.def.height * mob.size * 0.55;
          return this.hit({ mob, point, dist: point.distanceTo(from) }, dmg).killed;
        },
      });
    }
  }

  /** Chest of the nearest live mob (dev auto-aim). */
  nearest(out: THREE.Vector3): number {
    let best = 1e9;
    for (const mob of this.mobs) {
      if (mob.state !== 'walk' && mob.state !== 'attack') continue;
      const d = mob.m.root.position.lengthSq();
      if (d < best) {
        best = d;
        out.copy(mob.m.root.position);
        out.y += ((mob.m.def.hover ?? 0) + mob.m.def.height * 0.55) * mob.size;
      }
    }
    return best;
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    for (const mob of this.mobs) mob.m.mixer.stopAllAction();
    this.mobs.length = 0;
  }
}
