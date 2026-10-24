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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Monster, MONSTERS } from '../arenaHD';
import type { Fx } from '../bsvgun/fx';
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
};
export type HordeHit = { mob: Mob; point: THREE.Vector3; dist: number };

const rand = (r: readonly [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Horde {
  ready: Promise<void>;
  private mobs: Mob[] = [];
  private group = new THREE.Group();
  private spawnT = 1;
  private disposed = false;
  private frameOdd = false;
  /** Live cap right now (the engine sets it from the stage and the run clock). */
  want = 0;
  spawning = true;
  /** Seconds of grace left: nobody bites. */
  grace = 0;
  /** Lane the horde comes down (shared with the Erobots). */
  lane: { spawnZ: number; halfW: number; wallX: number } = TUNING.stages[0].lane;
  impulse = 0;

  constructor(
    private scene: THREE.Scene,
    private fx: Fx,
    private opts: { high: boolean; flash?: (at: THREE.Vector3, color: string, intensity: number, ms: number) => void; melee: (from: THREE.Vector3, dmg: number) => void },
  ) {
    this.group.name = 'horde';
    scene.add(this.group);
    this.ready = this.load().catch(() => undefined);
  }

  get live() {
    let n = 0;
    for (const m of this.mobs) if (m.state === 'walk' || m.state === 'attack') n++;
    return n;
  }

  private async load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const H = TUNING.horde;
    const defs = H.kinds.map((k) => MONSTERS.find((d) => d.id === k.id)).filter((d): d is (typeof MONSTERS)[number] => !!d);
    const gl = await Promise.all(defs.map((d) => loader.loadAsync(d.url).catch(() => null)));
    if (this.disposed) return;
    H.kinds.forEach((k) => {
      const i = defs.findIndex((d) => d.id === k.id);
      const g = i >= 0 ? gl[i] : null;
      if (!g) return;
      const n = this.opts.high ? k.pool : Math.max(1, Math.ceil(k.pool * H.lowPool));
      for (let j = 0; j < n; j++) {
        const m = new Monster(defs[i], g);
        const tint = { value: 0 };
        m.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || mesh === m.hitbox) return;
          mesh.castShadow = false; // a swarm of shadow casters would eat the frame
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const out = mats.map((mt) => {
            const c = (mt as THREE.MeshStandardMaterial).clone();
            if ('emissive' in c) {
              c.onBeforeCompile = (sh) => {
                sh.uniforms.uHit = tint;
                sh.fragmentShader = sh.fragmentShader
                  .replace('#include <common>', '#include <common>\nuniform float uHit;')
                  .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.42, 0.12) * uHit * 1.6;');
              };
            }
            return c;
          });
          mesh.material = Array.isArray(mesh.material) ? out : out[0];
        });
        m.root.visible = false;
        this.group.add(m.root);
        this.mobs.push({ m, kind: k, state: 'off', t: 0, hp: 0, size: 1, speed: 1, stopZ: -3, aimX: 0, swing: 0, odd: j % 2 === 0, acc: 0, tint });
      }
    });
  }

  /** Pick a kind by weight among the ones with a free body. */
  private pick(): Mob | null {
    let total = 0;
    for (const k of TUNING.horde.kinds) total += k.weight;
    for (let tries = 0; tries < 4; tries++) {
      let r = Math.random() * total;
      let kind: Kind = TUNING.horde.kinds[0];
      for (const k of TUNING.horde.kinds) {
        r -= k.weight;
        if (r <= 0) {
          kind = k;
          break;
        }
      }
      const free = this.mobs.find((m) => m.state === 'off' && m.kind.id === kind.id);
      if (free) return free;
    }
    return this.mobs.find((m) => m.state === 'off') ?? null;
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
    mob.stopZ = -2.4 - mob.size * 0.9;
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
    if (this.spawning && this.spawnT <= 0) {
      const missing = this.want - this.live;
      for (let i = 0; i < Math.min(missing, H.burst); i++) {
        const mob = this.pick();
        if (!mob) break;
        this.spawn(mob);
      }
      this.spawnT = H.spawnEvery;
    }
    const cx = camera.position.x;
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
        p.z += mob.speed * dt;
        const u = THREE.MathUtils.clamp(1 - (mob.stopZ - p.z) / 30, 0, 1);
        p.x += (mob.aimX - p.x) * Math.min(1, dt * (0.3 + u * 1.4));
        p.x += Math.sin(mob.t * 2.2 + mob.aimX) * dt * 0.6;
        r.rotation.y = Math.atan2(cx - p.x, 0 - p.z);
        if (p.z >= mob.stopZ) {
          p.z = mob.stopZ;
          mob.state = 'attack';
          mob.t = 0;
          mob.m.play(mob.m.has('attack') ? 'attack' : 'idle', { fade: 0.15 });
        }
      } else if (mob.state === 'attack') {
        r.rotation.y = Math.atan2(cx - p.x, 0 - p.z);
        mob.swing -= dt;
        if (!mob.m.has('attack')) mob.m.body.position.z = Math.max(0, Math.sin(mob.t * 5)) * 0.35; // lunges if it has no clip
        if (mob.swing <= 0) {
          mob.swing = H.biteEvery * (0.8 + Math.random() * 0.5);
          if (alive && this.grace <= 0) this.opts.melee(tmp.copy(p).setY(1.2 * mob.size), mob.kind.damage);
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
      if (tc < 0) continue;
      const d2 = tmp2.lengthSq() - tc * tc;
      if (d2 > rr * rr) continue;
      const th = tc - Math.sqrt(rr * rr - d2);
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
