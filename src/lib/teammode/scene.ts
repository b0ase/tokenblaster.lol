/**
 * TERRORNODE TEAM MODE renderer. The Shooting Gallery's rain-wet Neo-Tokyo street (galleryGame/city.ts, PBR look,
 * planar reflections on High, bloom + night grade) replaces the Arena's pixel maze, so team mode gets the modern
 * treatment. Players are rigged cast models in their side's colours (NPG cyan, Erobotz red); the PvE horde is the
 * Erobot ranks. Movement is client-predicted and corrected by the server's 20 Hz snapshots; remote bodies are
 * interpolated toward the latest snapshot.
 *
 * MELEE (26 Oct): the TERRORNODE plaza (./meleeScene.ts, lazy) replaces the street for the 64-player arena. Bodies
 * stand on the terraces (arena.ts heightAt), local movement collides with the same cover as the server, bodies that
 * leave a player's interest set fade out (they did not die), far bodies animate at a quarter rate without name
 * tags, and past a budget extra Erobots draw as one instanced crowd (the spectator's 64 players + the full horde).
 * `globalThis.__tnStats` carries fps / bodies / draw calls for the headless FPS check.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildCity, EYE, type City } from '../galleryGame/city';
import { loadLook, makeGradePass, type Look } from '../visuals/look';
import { loadLibrary, retarget } from '../galleryGame/enemies';
import { buildWeapon, weaponMaterial } from '../galleryGame/castModels';
import { BOSS_KIND, dirOf, type Snapshot, type Team } from './match';
import { STREET, arenaById, heightAt, resolve, type Arena } from './arena';
import { teamLevelOf } from './levels';
import type { MeleeScene } from './meleeScene';
import { levelOf, type LevelId } from '../terrornode/levels';
import type { Dressing } from '../terrornode/dressing';

export const TEAM_COLOUR: Record<Team, string> = { npg: '#2ec8e0', erobotz: '#ff2a46' };
const SKINS: Record<Team, string[]> = { npg: ['hikaru', 'matoko', 'phi-phi', 'yamarashii'], erobotz: ['bot', 'graf-bot', 'stripey-bot', 'tech'] };
const HORDE = ['bot', 'frog-bot', 'graf-bot', 'stripey-bot', 'tech'];
const SPEED = 6.5;

type Body = {
  g: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  run: THREE.AnimationAction | null;
  idle: THREE.AnimationAction | null;
  die: THREE.AnimationAction | null;
  tx: number;
  tz: number;
  tyaw: number;
  lx: number;
  lz: number;
  alive: boolean;
  seen: number;
  tag: THREE.Sprite | null;
  far: number;
};
/** Full skinned bodies past this many Erobots draw as the instanced crowd instead. */
const ENEMY_BUDGET = { player: 56, spectator: 72 };
const FAR = 45;
type Model = { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip>; scale: number };

export class TeamScene {
  renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 1, 0.05, 400);
  private composer!: EffectComposer;
  private grade!: ReturnType<typeof makeGradePass>;
  private city!: City;
  private look!: Look;
  private models = new Map<string, Model>();
  private bodies = new Map<string, Body>();
  private tracers: { line: THREE.Line; t: number }[] = [];
  private sparks: { s: THREE.Sprite; t: number }[] = [];
  private gun = new THREE.Group();
  private flash!: THREE.PointLight;
  private clock = new THREE.Clock();
  private t = 0;
  private raf = 0;
  private disposed = false;
  private keys = new Set<string>();
  private kick = 0;
  /** Local player (predicted). */
  me = { id: '', x: 0, z: 8, yaw: 0, pitch: 0, alive: true, team: 'npg' as Team };
  trigger = false;
  onFire: (yaw: number) => void = () => undefined;
  onMove: (x: number, z: number, yaw: number) => void = () => undefined;
  private lastFire = 0;
  private lastSend = 0;
  readonly high: boolean;
  /** SPECTATOR (the livestream view): no gun, no input, a slow broadcast camera over the whole arena. */
  readonly spectate: boolean;
  private ready = false;
  private hemi!: THREE.HemisphereLight;
  private bloom!: UnrealBloomPass;
  private level: LevelId = 'assault';
  private dressing: Dressing | null = null;
  private dressReq = 0;
  private camAt = new THREE.Vector3(0, 0, -20);
  private arena: Arena = STREET;
  private placed = false;
  private melee: MeleeScene | null = null;
  private crowd: THREE.InstancedMesh | null = null;
  private proxies = new Map<string, { x: number; z: number; tx: number; tz: number; seen: number }>();
  private frames = 0;
  private fpsAt = 0;
  fps = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { high: boolean; spectate?: boolean },
  ) {
    this.high = opts.high;
    this.spectate = Boolean(opts.spectate);
  }

  /**
   * The match's level (src/lib/terrornode/levels.ts): its palette on the street (fog, sky, light, bloom) and its
   * dressing, fetched with a dynamic import only for the levels that have one.
   */
  async setLevel(id: LevelId) {
    if (!this.city || id === this.level) return;
    this.level = id;
    const L = levelOf(id);
    this.arena = arenaById(teamLevelOf(id).arena);
    const P = L.palette;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(P.fog);
    fog.density = P.density;
    (this.scene.background as THREE.Color).set(P.bg);
    this.hemi.color.set(id === 'assault' ? '#3a6aff' : P.key);
    this.renderer.toneMappingExposure = 1 + P.exposure;
    this.bloom.strength = (this.high ? 0.32 : 0.26) + P.bloom;
    const req = ++this.dressReq;
    this.dressing?.dispose();
    this.dressing = null;
    this.melee?.dispose();
    this.melee = null;
    this.city.group.visible = this.arena.id === 'street';
    if (this.arena.id === 'melee') {
      const { buildMelee } = await import('./meleeScene');
      if (req !== this.dressReq || this.disposed) return;
      this.melee = buildMelee({ high: this.high, key: P.key, rim: P.rim });
      this.scene.add(this.melee.group);
      this.camAt.set(0, 0, 30);
      return;
    }
    if (id === 'assault') return;
    const { buildDressing } = await import('../terrornode/dressing');
    if (req !== this.dressReq || this.disposed) return;
    const halfW = id === 'datacore' ? 16 : 14;
    const d = buildDressing(id, { high: this.high, palette: P, halfW, z0: STREET.z1, z1: STREET.z0 });
    if (!d) return;
    this.scene.add(d.group);
    this.dressing = d;
  }

  async init(onProgress: (p: number) => void) {
    const high = this.high;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !high, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 1.5 : 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = high;
    r.info.autoReset = false; // one frame's draw calls across every composer pass (the FPS check reads them)
    this.look = await loadLook(r, high ? 'high' : 'low', (p) => onProgress(p * 0.5));
    if (this.disposed) return;
    this.city = buildCity({ renderer: r, scene: this.scene, high, look: this.look });
    this.scene.add(this.camera);
    this.camera.layers.enable(1);
    // first-person gun: the Arena's Genesis Blaster model, fitted to ~0.6 m (a stand-in box if it can't load)
    void new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync('/arena/models/guns/genesis-blaster.glb')
      .then((g) => {
        const m = g.scene;
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3());
        const long = Math.max(size.x, size.z);
        m.scale.setScalar(0.6 / Math.max(1e-3, long));
        if (size.x > size.z) m.rotation.y = Math.PI / 2; // barrel down -Z
        const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
        m.position.sub(c);
        m.traverse((o) => o.layers.set(1));
        this.gun.add(m);
      })
      .catch(() => {
        const w = buildWeapon('blaster', high);
        if (!w.geo) return;
        const m = new THREE.Mesh(w.geo, weaponMaterial());
        m.scale.setScalar(0.5);
        m.layers.set(1);
        this.gun.add(m);
      });
    this.gun.position.set(0.26, -0.28, -0.62);
    this.camera.add(this.gun);
    this.flash = new THREE.PointLight('#ffb870', 0, 18, 1.6);
    this.camera.add(this.flash);
    this.flash.position.set(0.2, -0.1, -1);
    this.hemi = new THREE.HemisphereLight('#3a6aff', '#120814', 0.5);
    this.scene.add(this.hemi);
    if (this.spectate) this.gun.visible = false;
    // post
    const size = r.getSize(new THREE.Vector2());
    const comp = new EffectComposer(r);
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), high ? 0.32 : 0.26, 0.4, high ? 1.7 : 1.6);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.grade = makeGradePass();
    this.grade.apply({ shadow: [0.76, 1.0, 1.14], high: [1.08, 1.0, 0.9], sat: 0.95, contrast: 1.2, vignette: 0.72 });
    comp.addPass(this.grade.pass);
    this.composer = comp;
    onProgress(0.6);
    await this.loadModels((p) => onProgress(0.6 + p * 0.4));
    this.ready = true;
    if (!this.spectate) this.bindInput();
    this.resize();
    this.loop();
  }

  private async loadModels(onProgress: (p: number) => void) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    // the spectator's camera is 90 m up: the light bodies look the same from there at a sixth of the triangles
    const dir = this.high && !this.spectate ? 'hi' : 'lo';
    const ids = [...new Set([...SKINS.npg, ...SKINS.erobotz, ...HORDE])];
    const lib = await loadLibrary();
    let done = 0;
    await Promise.all(
      ids.map(async (id) => {
        const g = await loader.loadAsync(`/gallery/erobots/${dir}/${id}.glb`).catch(() => null);
        onProgress(++done / ids.length);
        if (!g) return;
        const box = new THREE.Box3().setFromObject(g.scene);
        const h = Math.max(0.1, box.max.y - box.min.y);
        this.models.set(id, { scene: g.scene, clips: lib.length ? retarget(lib, g.scene) : new Map(), scale: 1.9 / h });
      }),
    );
  }

  private makeBody(skin: string, colour: string, label: string | null): Body {
    const g = new THREE.Group();
    const m = this.models.get(skin) ?? [...this.models.values()][0];
    let mixer: THREE.AnimationMixer | null = null;
    let run: THREE.AnimationAction | null = null;
    let idle: THREE.AnimationAction | null = null;
    let die: THREE.AnimationAction | null = null;
    if (m) {
      const model = cloneSkinned(m.scene);
      model.scale.setScalar(m.scale);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = this.high && !(this.spectate && this.arena.id === 'melee');
          mesh.frustumCulled = false;
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
          if ('emissive' in mat) {
            mat.emissive = new THREE.Color(colour);
            mat.emissiveIntensity = 0.12;
          }
          mesh.material = mat;
        }
      });
      g.add(model);
      mixer = new THREE.AnimationMixer(model);
      const clip = (n: string) => (m.clips.get(n) ? mixer!.clipAction(m.clips.get(n)!) : null);
      run = clip('Sprint_Loop') ?? clip('Walk_Loop');
      idle = clip('Idle_Loop');
      die = clip('Death01');
      if (die) {
        die.setLoop(THREE.LoopOnce, 1);
        die.clampWhenFinished = true;
      }
      idle?.play();
    } else {
      const fallback = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 6, 12), new THREE.MeshStandardMaterial({ color: '#1a1d26', metalness: 0.7, roughness: 0.3, emissive: colour, emissiveIntensity: 0.2 }));
      fallback.position.y = 0.95;
      g.add(fallback);
    }
    // team ring + visor glow light under the feet
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    const tag = label ? nameTag(label, colour) : null;
    if (tag) g.add(tag);
    this.scene.add(g);
    return { g, mixer, run, idle, die, tx: 0, tz: 0, tyaw: 0, lx: 0, lz: 0, alive: true, seen: 0, tag, far: 0 };
  }

  /** Apply a server snapshot: correct the local player, move everyone else, draw shots and hits. */
  apply(s: Snapshot, names: Map<string, string>) {
    if (!this.ready) return; // bodies are built from the loaded models, never from stand-ins
    const now = this.t;
    for (const [id, x, z, yaw, , alive, team] of s.p) {
      if (id === this.me.id) {
        this.me.team = team;
        const wasAlive = this.me.alive;
        this.me.alive = Boolean(alive);
        // respawn or a big correction: snap; small drift: ease toward the server
        // (the first snapshot too: face the way the spawn point faces, on the plaza the tower)
        if ((!wasAlive && alive) || !this.placed) [this.me.x, this.me.z, this.me.yaw, this.placed] = [x, z, yaw, true];
        else if (Math.hypot(x - this.me.x, z - this.me.z) > 2.5) [this.me.x, this.me.z] = [x, z];
        continue;
      }
      let b = this.bodies.get(id);
      if (!b) {
        const skin = SKINS[team][hash(id) % SKINS[team].length];
        b = this.makeBody(skin, TEAM_COLOUR[team], names.get(id) ?? 'Player');
        b.g.position.set(x, heightAt(this.arena, x, z), z);
        this.bodies.set(id, b);
      }
      this.retarget(b, x, z, yaw, Boolean(alive), now);
    }
    let full = 0;
    for (const b of this.bodies.keys()) if (b[0] === 'e') full++;
    const budget = this.spectate ? ENEMY_BUDGET.spectator : ENEMY_BUDGET.player;
    let boss = false;
    for (const [id, x, z, yaw, , kind] of s.e) {
      const key = `e${id}`;
      let b = this.bodies.get(key);
      if (kind === BOSS_KIND) boss = true;
      if (!b && kind !== BOSS_KIND && full >= budget) {
        // over the budget: one instance in the crowd (no skeleton, no mixer)
        const px = this.proxies.get(key);
        if (px) [px.tx, px.tz, px.seen] = [x, z, now];
        else this.proxies.set(key, { x, z, tx: x, tz: z, seen: now });
        continue;
      }
      if (!b) {
        full++;
        this.proxies.delete(key);
        b = this.makeBody(HORDE[kind % HORDE.length], TEAM_COLOUR.erobotz, kind === BOSS_KIND ? (teamLevelOf(this.level).bossName ?? 'TERRORNODE HEART') : null);
        if (kind === BOSS_KIND) b.g.scale.setScalar(this.arena.id === 'melee' ? 3.6 : 2.8);
        b.g.position.set(x, heightAt(this.arena, x, z), z);
        this.bodies.set(key, b);
      }
      this.retarget(b, x, z, yaw, true, now);
    }
    this.melee?.setBoss(boss);
    for (const [k, p] of this.proxies) if (p.seen !== now) this.proxies.delete(k);
    // bodies not in this snapshot: enemies are dead (play the fall, then remove), players left. In a player's
    // interest set (s.ip) a body can also just be out of range: only a kill event means it died.
    const killed = new Set<string>();
    for (const e of s.ev) if (e.k === 'kill') killed.add(e.on);
    for (const [k, b] of this.bodies) {
      if (b.seen === now) continue;
      if (s.ip && !killed.has(k)) {
        this.drop(k, true);
        continue;
      }
      if (b.alive) {
        b.alive = false;
        if (b.die && b.mixer) {
          b.run?.stop();
          b.idle?.stop();
          b.die.reset().play();
        }
        setTimeout(() => this.drop(k), 1600);
      }
    }
    for (const e of s.ev) {
      if (e.k === 'shot' && e.by !== this.me.id) this.tracer(e.x, e.z, e.yaw, Math.min(e.len, 70), s.p.find((p) => p[0] === e.by)?.[6] ?? 'npg');
      if (e.k === 'hit') this.spark(e.x, e.z, e.on === this.me.id ? '#ff2a46' : '#ffd27a');
    }
  }

  private retarget(b: Body, x: number, z: number, yaw: number, alive: boolean, now: number) {
    b.seen = now;
    [b.tx, b.tz, b.tyaw] = [x, z, yaw];
    if (alive !== b.alive) {
      b.alive = alive;
      if (!alive && b.die) {
        b.run?.stop();
        b.idle?.stop();
        b.die.reset().play();
      } else if (alive) {
        b.die?.stop();
        b.idle?.play();
        b.g.position.set(x, heightAt(this.arena, x, z), z);
      }
    }
  }

  private drop(k: string, force = false) {
    const b = this.bodies.get(k);
    if (!b || (b.alive && !force)) return;
    this.scene.remove(b.g);
    this.bodies.delete(k);
  }

  private tracer(x: number, z: number, yaw: number, len: number, team: Team) {
    // 16 players fire ~200 rounds a second: cap the lines on screen (the spectator's wide shot sees them all)
    if (this.tracers.length >= (this.spectate ? 36 : 90)) return;
    const { dx, dz } = dirOf(yaw);
    const y = heightAt(this.arena, x, z) + 1.35;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z), new THREE.Vector3(x + dx * len, heightAt(this.arena, x + dx * len, z + dz * len) + 1.35, z + dz * len)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(TEAM_COLOUR[team]).multiplyScalar(3), toneMapped: false, transparent: true }));
    this.scene.add(line);
    this.tracers.push({ line, t: 0 });
  }

  private spark(x: number, z: number, c: string) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color(c).multiplyScalar(3), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, heightAt(this.arena, x, z) + 1.3, z);
    s.scale.setScalar(0.7);
    this.scene.add(s);
    this.sparks.push({ s, t: 0 });
  }

  private bindInput() {
    const c = this.canvas;
    const kd = (e: KeyboardEvent) => this.keys.add(e.code);
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const mm = (e: MouseEvent) => {
      if (document.pointerLockElement !== c) return;
      this.me.yaw -= e.movementX * 0.0022;
      this.me.pitch = Math.max(-0.6, Math.min(0.6, this.me.pitch - e.movementY * 0.0018));
    };
    const md = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement !== c) c.requestPointerLock?.();
      this.trigger = true;
    };
    const mu = () => (this.trigger = false);
    // touch: left half moves, right half looks + fires
    const touches = new Map<number, { x: number; y: number; side: 'move' | 'look' }>();
    const ts = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const side = t.clientX < window.innerWidth / 2 ? 'move' : 'look';
        touches.set(t.identifier, { x: t.clientX, y: t.clientY, side });
        if (side === 'look') this.trigger = true;
      }
    };
    const tm = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        const s = touches.get(t.identifier);
        if (!s) continue;
        if (s.side === 'look') {
          this.me.yaw -= (t.clientX - s.x) * 0.006;
          [s.x, s.y] = [t.clientX, t.clientY];
        } else this.touchMove = { x: (t.clientX - s.x) / 60, y: (t.clientY - s.y) / 60 };
      }
    };
    const te = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const s = touches.get(t.identifier);
        if (s?.side === 'look') this.trigger = false;
        if (s?.side === 'move') this.touchMove = null;
        touches.delete(t.identifier);
      }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousemove', mm);
    c.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    c.addEventListener('touchstart', ts, { passive: true });
    c.addEventListener('touchmove', tm, { passive: false });
    c.addEventListener('touchend', te);
    const rs = () => this.resize();
    window.addEventListener('resize', rs);
    this.unbind = () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('mousemove', mm);
      c.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      c.removeEventListener('touchstart', ts);
      c.removeEventListener('touchmove', tm);
      c.removeEventListener('touchend', te);
      window.removeEventListener('resize', rs);
    };
  }
  private touchMove: { x: number; y: number } | null = null;
  private unbind = () => undefined;

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.city?.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;
    const me = this.me;
    // movement (predicted)
    if (me.alive && !this.spectate) {
      let f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      let s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      if (this.keys.has('ArrowLeft')) me.yaw += 2.2 * dt;
      if (this.keys.has('ArrowRight')) me.yaw -= 2.2 * dt;
      if (this.touchMove) [s, f] = [Math.max(-1, Math.min(1, this.touchMove.x)), Math.max(-1, Math.min(1, -this.touchMove.y))];
      const { dx, dz } = dirOf(me.yaw);
      const n = Math.hypot(f, s) || 1;
      const go = f || s ? SPEED * dt : 0;
      const c = resolve(this.arena, me.x + ((dx * f - dz * s) / n) * go, me.z + ((dz * f + dx * s) / n) * go);
      [me.x, me.z] = [c.x, c.z];
      if (this.t - this.lastSend > 0.05) {
        this.lastSend = this.t;
        this.onMove(me.x, me.z, me.yaw);
      }
      if (this.trigger && this.t - this.lastFire > 0.085) {
        this.lastFire = this.t;
        this.kick = 1;
        this.flash.intensity = 6;
        this.tracer(me.x, me.z, me.yaw, 60, me.team);
        this.onFire(me.yaw);
      }
    }
    if (this.spectate) this.broadcastCam(dt);
    else {
      this.camera.position.set(me.x, heightAt(this.arena, me.x, me.z) + (me.alive ? EYE : 0.5), me.z);
      this.camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
    }
    this.dressing?.update(dt, this.t);
    this.melee?.update(dt, this.t);
    this.kick *= Math.pow(0.001, dt);
    this.gun.position.z = -0.62 + this.kick * 0.06;
    this.gun.rotation.x = this.kick * 0.08;
    this.flash.intensity *= Math.pow(0.0005, dt);
    // remote bodies: ease toward the server's positions; far ones animate at a quarter rate, no name tag
    const cam = this.camera.position;
    const k = 1 - Math.pow(0.0001, dt);
    for (const b of this.bodies.values()) {
      b.g.position.x += (b.tx - b.g.position.x) * k;
      b.g.position.z += (b.tz - b.g.position.z) * k;
      b.g.position.y = heightAt(this.arena, b.g.position.x, b.g.position.z);
      const far = Math.hypot(b.g.position.x - cam.x, b.g.position.z - cam.z) > (this.spectate ? FAR * 2 : FAR);
      if (b.tag) b.tag.visible = !far;
      let dy = b.tyaw + Math.PI - b.g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.g.rotation.y += dy * k;
      const v = Math.hypot(b.g.position.x - b.lx, b.g.position.z - b.lz) / Math.max(dt, 1e-3);
      [b.lx, b.lz] = [b.g.position.x, b.g.position.z];
      if (b.alive && b.run && b.idle) {
        const moving = v > 0.6;
        if (moving && !b.run.isRunning()) {
          b.run.reset().fadeIn(0.15).play();
          b.idle.fadeOut(0.15);
        }
        if (!moving && b.run.isRunning() && !b.idle.isRunning()) {
          b.idle.reset().fadeIn(0.2).play();
          b.run.fadeOut(0.2);
        }
      }
      if (!far) b.mixer?.update(dt);
      else if ((b.far += dt) > 0.066) {
        b.mixer?.update(b.far);
        b.far = 0;
      }
    }
    this.drawCrowd(k);
    for (const tr of this.tracers) {
      tr.t += dt;
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - tr.t / 0.12);
    }
    for (const tr of this.tracers.filter((x) => x.t > 0.12)) {
      this.scene.remove(tr.line);
      tr.line.geometry.dispose();
      (tr.line.material as THREE.Material).dispose();
    }
    this.tracers = this.tracers.filter((x) => x.t <= 0.12);
    for (const sp of this.sparks) {
      sp.t += dt;
      sp.s.material.opacity = Math.max(0, 1 - sp.t / 0.25);
      sp.s.scale.setScalar(0.7 + sp.t * 3);
    }
    for (const sp of this.sparks.filter((x) => x.t > 0.25)) {
      this.scene.remove(sp.s);
      sp.s.material.dispose();
    }
    this.sparks = this.sparks.filter((x) => x.t <= 0.25);
    if (!this.melee) this.city.update(dt, this.t, this.camera);
    this.grade.tick(this.t, me.alive ? 0 : 0.6);
    // the street's planar reflection pass is the city's; the plaza is lit by the environment map alone
    if (!this.melee) this.city.beforeRender(this.renderer, this.scene, this.camera);
    this.renderer.info.reset();
    this.composer.render();
    // frame rate on the wall clock (the game clock is capped at 50 ms a frame)
    this.frames++;
    const wall = performance.now() / 1000;
    if (!this.fpsAt) this.fpsAt = wall;
    if (wall - this.fpsAt >= 1) {
      this.fps = Math.round((this.frames / (wall - this.fpsAt)) * 10) / 10;
      [this.frames, this.fpsAt] = [0, wall];
      (globalThis as { __tnStats?: unknown }).__tnStats = { fps: this.fps, bodies: this.bodies.size, crowd: this.proxies.size, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, arena: this.arena.id, melee: this.melee?.stats() ?? null };
    }
  };

  /** Erobots over the body budget: one InstancedMesh (a dark armoured capsule with a red visor glow). */
  private drawCrowd(k: number) {
    if (!this.proxies.size && !this.crowd) return;
    if (!this.crowd) {
      const geo = new THREE.CapsuleGeometry(0.42, 1.05, 4, 10);
      geo.translate(0, 0.95, 0);
      const mat = new THREE.MeshStandardMaterial({ color: '#1a1c24', metalness: 0.8, roughness: 0.3, emissive: TEAM_COLOUR.erobotz, emissiveIntensity: 0.35 });
      this.crowd = new THREE.InstancedMesh(geo, mat, 256);
      this.crowd.frustumCulled = false;
      this.scene.add(this.crowd);
    }
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (const p of this.proxies.values()) {
      if (i >= 256) break;
      p.x += (p.tx - p.x) * k;
      p.z += (p.tz - p.z) * k;
      m4.makeTranslation(p.x, heightAt(this.arena, p.x, p.z), p.z);
      this.crowd.setMatrixAt(i++, m4);
    }
    this.crowd.count = i;
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  /** The spectator's camera: high and wide behind the NPG line, easing toward the middle of the action, slow sway. */
  private broadcastCam(dt: number) {
    if (this.arena.id === 'melee') return this.plazaCam(dt);
    let n = 0;
    const c = new THREE.Vector3();
    for (const b of this.bodies.values())
      if (b.alive) {
        c.add(b.g.position);
        n++;
      }
    if (n) c.divideScalar(n);
    else c.set(0, 0, -20);
    this.camAt.lerp(c, 1 - Math.pow(0.2, dt));
    const sway = Math.sin(this.t * 0.07) * 10;
    this.camera.position.set(this.camAt.x * 0.5 + sway, 15, Math.min(STREET.z1 + 16, this.camAt.z + 26));
    this.camera.lookAt(this.camAt.x, 1, this.camAt.z - 6);
  }

  /** The plaza's broadcast camera: a slow orbit high over the rim, looking at the middle of the fight and the tower. */
  private plazaCam(dt: number) {
    let n = 0;
    const c = new THREE.Vector3();
    for (const b of this.bodies.values())
      if (b.alive) {
        c.add(b.g.position);
        n++;
      }
    if (n) c.divideScalar(n);
    else c.set(0, 0, 0);
    this.camAt.lerp(c, 1 - Math.pow(0.3, dt));
    const a = this.t * 0.045;
    this.camera.position.set(Math.sin(a) * 70, 32 + Math.sin(this.t * 0.11) * 5, Math.cos(a) * 70);
    this.camera.lookAt(this.camAt.x * 0.6, 8, this.camAt.z * 0.6);
  }

  dispose() {
    this.melee?.dispose();
    this.dressing?.dispose();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.city?.dispose();
    this.look?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
  }
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function nameTag(text: string, colour: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(5,6,15,0.7)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 12);
  g.fill();
  g.strokeStyle = colour;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = '600 28px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 16), 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.4, 0.35, 1);
  s.position.y = 2.35;
  s.renderOrder = 10;
  return s;
}
