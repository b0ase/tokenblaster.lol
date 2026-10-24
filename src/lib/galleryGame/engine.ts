/**
 * Shooting Gallery 3D engine. First person behind the BSVGun weapons (same GLB models, buildGun, aim
 * follow, recoil, spin-up, muzzle flash and minigun audio as src/lib/bsvgun/engine.ts), in a night city
 * (./city.ts) rendered the Arena way: ACES filmic, soft shadows, GTAO on desktop, bloom, colour grade.
 *
 * Transactions drive damage. The engine never decides how many bullets land: the page calls
 * `accept(n)` with newly accepted (or, in practice, simulated) transactions, and each one is one round of
 * the held weapon's damage along the aim ray (with its spread). The trigger itself only drives the look:
 * barrel spin, muzzle flash, tracers and brass, and `hooks.pull()` for burst weapons (one batch per pull).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { buildGun, type HeldGun } from '../arenaHD';
import { loadGunModel } from '../ordnanceModels';
import { brandGun, tintAmount, tintGun } from '../ordnanceGun';
import { loadLook, makeGradePass, type Look } from '../visuals/look';
import { AMMO_SFX, minigun, sfx, unlockAudio } from '../sfx';
import { Fx } from '../bsvgun/fx';
import { glowTexture, halo } from '../bsvgun/targets';
import type { RangeWeapon } from '../bsvgun/weapons';
import { buildCity, EYE, TOWER, type City, type Rack, type Window } from './city';
import { LiquidUnit } from './boss';
import { ErobotWave } from './enemies';
import { Bolts, type HurtKind } from './combat';
import { TUNING } from './tuning';

export type Quality = 'low' | 'high';
export type Stats = { score: number; bossHp: number; bossMax: number; wave: number; windowsLeft: number; windows: number; racksLeft: number; drones: number; kills: number; hover: string; hp: number; hpMax: number; dead: boolean; bossPush: number; bossDist: number };
/** The player was hurt. `angle`: where it came from relative to the view (0 ahead, + right, +-PI behind). */
export type Hurt = { angle: number; dmg: number; kind: HurtKind; hp: number; hpMax: number };
export type Hooks = {
  /** A burst weapon's trigger pull: return false to refuse (no ammo / pack spent / one in flight). */
  pull: (w: RangeWeapon) => boolean;
  /** Is the stream flowing? (Stream weapons only show fire while transactions are being accepted.) */
  flowing: () => boolean;
  stats: (s: Stats) => void;
  trigger: (down: boolean) => void;
  /** The player took damage (HUD: vignette, direction marker). */
  hurt: (h: Hurt) => void;
  /** Health hit zero. */
  died: () => void;
};

type Drone = { g: THREE.Group; rotors: THREE.Mesh[]; hp: number; dead: number; t: number; v: THREE.Vector3; base: THREE.Vector3; body: THREE.Mesh };

const v3 = () => new THREE.Vector3();
const BASE_FOV = 60;

export class GalleryEngine {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 900);
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private ao: GTAOPass | null = null;
  private grade!: ReturnType<typeof makeGradePass>;
  private shafts: ShaderPass | null = null;
  private shaftP = new THREE.Vector3();
  private look!: Look;
  private city!: City;
  private boss!: LiquidUnit;
  private erobots!: ErobotWave;
  private fx!: Fx;
  private bolts!: Bolts;
  private raf = 0;
  private last = 0;
  private t = 0;
  private disposed = false;
  private ro: ResizeObserver | null = null;
  private cleanup: (() => void)[] = [];

  // input
  private ndc = new THREE.Vector2(0, 0.1);
  trigger = false;
  autoAim = false;
  /** Dev only: with `autoAim`, shoot the nearest Erobot first (a sweeping player), else the boss. */
  autoThreats = false;
  /** Dev only: the boss counts as the nearest threat inside this many metres. */
  autoBossRange = 0;
  private threatT = 0;

  // gun
  weapon: RangeWeapon | null = null;
  private mount = new THREE.Group();
  private kickG = new THREE.Group();
  private guns = new Map<string, HeldGun>();
  private held: HeldGun | null = null;
  private gunReq = 0;
  private muzzleSprite!: THREE.Sprite;
  private flashLight!: THREE.PointLight;
  // dynamic light: a fixed pool of point lights (constant count, so no shader recompiles), exposure kick, Low-tier ground decal
  private pool: { l: THREE.PointLight; t: number; dur: number; peak: number }[] = [];
  private kick = 0;
  private decal: THREE.Mesh | null = null;
  private decalA = 0;
  private flashK = 0;
  private flashT = 0;
  private recoil = 0;
  private nextShot = 0;
  private mgOn = false;
  private shake = 0;
  private yaw = 0;
  private pitch = 0.16;

  // brass
  private brass!: THREE.InstancedMesh;
  private bp = new Float32Array(160 * 3);
  private bv = new Float32Array(160 * 3);
  private br = new Float32Array(160 * 3);
  private bl = new Float32Array(160);
  private bCursor = 0;

  // world
  private drones: Drone[] = [];
  private droneGeo: THREE.BufferGeometry[] = [];
  private droneMat: THREE.Material[] = [];
  private score = 0;
  private kills = 0;
  private statsT = 0;
  private hover = '';

  // the player's body
  hp: number = TUNING.player.hp;
  dead = false;
  private sinceHurt = 99;
  private hitCd = 0;
  private invuln = 0;
  private hitKick = { p: 0, y: 0, r: 0 };
  private deadT = 0;

  // temps
  private ray = new THREE.Raycaster();
  private tA = v3();
  private tB = v3();
  private tC = v3();
  private tD = v3();
  private tQ = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();

  constructor(
    private canvas: HTMLCanvasElement,
    private hooks: { current: Hooks },
    private opts: { quality: Quality; weapons: RangeWeapon[]; bossBase: number },
  ) {}

  get high() {
    return this.opts.quality === 'high';
  }

  async init(onProgress: (p: number) => void) {
    const high = this.high;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !high, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 1.5 : 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = high;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    onProgress(0.05);
    this.look = await loadLook(r, high ? 'high' : 'low', (p) => onProgress(0.05 + p * 0.45));
    if (this.disposed) return;
    this.city = buildCity({ renderer: r, scene: this.scene, high, look: this.look });
    this.boss = new LiquidUnit(this.opts.bossBase, high);
    this.boss.setEnv(r, this.look.env);
    this.scene.add(this.boss.group);
    await this.boss.ready; // the rigged model (a fallback figure stands in if it can't load)
    if (this.disposed) return;
    this.fx = new Fx(this.scene, high);
    this.bolts = new Bolts(this.scene);
    this.erobots = new ErobotWave(this.scene, this.fx, {
      high,
      canvas: this.canvas,
      reticle: () => this.reticle(),
      light: this.city.hitLight,
      flash: (at, c, i, ms) => this.flash(at, c, i, ms),
      bolts: this.bolts,
      melee: (from, dmg) => this.hurt(from, dmg, 'melee'),
    });
    this.boss.onEvent = (k, at) => this.bossEvent(k, at);
    this.boss.onAttack = (a) => this.bossAttack(a);
    this.scene.add(this.camera);
    this.camera.layers.enable(1); // layer 1: rain, ripples and the held gun (hidden from the street reflection)
    this.camera.position.set(0, EYE, 0);
    this.camera.add(this.mount);
    this.mount.add(this.kickG);
    this.muzzleSprite = halo('#ffd9a0', 1.2, 0);
    this.muzzleSprite.material.opacity = 0;
    this.scene.add(this.muzzleSprite);
    this.flashLight = new THREE.PointLight('#ffb870', 0, 30, 1.6);
    this.scene.add(this.flashLight);
    for (let i = 0; i < (high ? 6 : 1); i++) {
      const l = new THREE.PointLight('#ffffff', 0, 26, 1.7);
      this.scene.add(l);
      this.pool.push({ l, t: 0, dur: 0, peak: 0 });
    }
    if (!high) {
      // Low: no lights to spare, so the muzzle throws an emissive glow on the wet street instead
      const dg = new THREE.PlaneGeometry(1, 1);
      dg.rotateX(-Math.PI / 2);
      this.decal = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ffb060', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      this.decal.scale.set(16, 1, 34);
      this.decal.position.set(0, 0.06, -9);
      this.decal.renderOrder = 5;
      this.scene.add(this.decal);
    }
    // brass casings
    const bg = new THREE.CylinderGeometry(0.008, 0.008, 0.045, 8);
    bg.rotateZ(Math.PI / 2);
    this.brass = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: '#c99a3e', metalness: 1, roughness: 0.25 }), 160);
    this.brass.frustumCulled = false;
    this.brass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 160; i++) this.brass.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    this.scene.add(this.brass);
    for (let i = 0; i < 2; i++) this.spawnDrone(i);
    onProgress(0.65);

    // Arena-grade post: render, GTAO (desktop High), bloom, grade, output.
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    if (high) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 12 });
      const aoRender = ao.render.bind(ao);
      const hid: THREE.Object3D[] = [];
      ao.render = (...args: Parameters<GTAOPass['render']>) => {
        this.scene.traverse((o) => {
          if (((o as THREE.Sprite).isSprite || (o as THREE.LineSegments).isLineSegments || (o as THREE.Points).isPoints || o.userData.noAO) && o.visible) {
            o.visible = false;
            hid.push(o);
          }
        });
        aoRender(...args);
        for (const o of hid.splice(0)) o.visible = true;
      };
      comp.addPass(ao);
      this.ao = ao;
    }
    if (high) {
      // light shafts: a radial blur of the tower's eye, so the red glow bleeds through the rain and the neon haze
      this.shafts = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uPos: { value: new THREE.Vector2(0.5, 0.7) }, uK: { value: 0.5 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse; uniform vec2 uPos; uniform float uK; varying vec2 vUv;
          void main(){
            vec3 base = texture2D(tDiffuse, vUv).rgb;
            vec2 d = (uPos - vUv) * (1.0 / 28.0) * 0.95;
            vec2 uv = vUv; float w = 1.0; vec3 acc = vec3(0.0);
            for (int i = 0; i < 28; i++) {
              uv += d;
              vec3 s = texture2D(tDiffuse, uv).rgb;
              float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
              acc += s * smoothstep(1.0, 3.5, l) * smoothstep(0.42, 0.0, length(uv - uPos)) * w;
              w *= 0.955;
            }
            gl_FragColor = vec4(base + acc * uK * (1.0 / 28.0) * 3.0, 1.0);
          }`,
      });
      comp.addPass(this.shafts);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), high ? 0.3 : 0.26, 0.4, high ? 1.7 : 1.6);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.grade = makeGradePass();
    // night-shift grade: teal shadows, sodium highlights, crushed blacks
    this.grade.apply({ shadow: [0.76, 1.0, 1.14], high: [1.08, 1.0, 0.9], sat: 0.92, contrast: 1.22, vignette: 0.74 });
    comp.addPass(this.grade.pass);
    this.composer = comp;

    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    this.resize();
    onProgress(0.8);
    const first = this.opts.weapons[0];
    if (first) await this.setWeapon(first.id);
    if (this.disposed) return;
    onProgress(1);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(2, el.clientWidth);
    const h = Math.max(2, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    // Portrait phones: widen the view so the tower and the boss both fit.
    this.camera.fov = w / h >= 1.3 ? BASE_FOV : THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * (1.3 / (w / h)))), BASE_FOV, 96);
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    this.ao?.setSize(w, h);
    const bs = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.city?.resize(bs.x, bs.y);
  }

  setBossBase(n: number) {
    this.boss?.setBase(n);
  }

  async setWeapon(id: string) {
    const w = this.opts.weapons.find((x) => x.id === id);
    if (!w || w === this.weapon) return;
    this.weapon = w;
    const req = ++this.gunReq;
    let h = this.guns.get(id);
    if (!h) {
      const gltf = await loadGunModel(w.def.url).catch(() => null);
      if (!gltf || this.disposed) return;
      h = buildGun(w.def, gltf);
      if (w.ordnance) {
        tintGun(h.group, w.ordnance.tint, tintAmount(w.ordnance));
        void brandGun(h.group, w.ordnance.id);
      }
      h.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
          for (const mt of mats) if (mt && 'envMapIntensity' in mt) mt.envMapIntensity = 1.8;
        }
      });
      h.group.traverse((o) => o.layers.set(1));
      this.guns.set(id, h);
    }
    if (req !== this.gunReq) return;
    if (this.held) this.kickG.remove(this.held.group);
    this.held = h;
    this.mount.position.set(...w.def.pos);
    this.mount.position.x += 0.04;
    this.kickG.add(h.group);
    if (this.mgOn) {
      minigun(false);
      this.mgOn = false;
    }
  }

  // ── Input ──
  private bindInput() {
    const c = this.canvas;
    const setNdc = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const down = (e: PointerEvent) => {
      unlockAudio();
      setNdc(e);
      if (e.pointerType === 'touch') c.setPointerCapture(e.pointerId);
      this.setTrigger(true);
    };
    const up = () => this.setTrigger(false);
    const key = (e: KeyboardEvent, d: boolean) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.setTrigger(d);
      }
    };
    const kd = (e: KeyboardEvent) => key(e, true);
    const ku = (e: KeyboardEvent) => key(e, false);
    c.addEventListener('pointermove', setNdc);
    c.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.cleanup.push(
      () => c.removeEventListener('pointermove', setNdc),
      () => c.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
    );
  }

  setTrigger(down: boolean) {
    if (this.dead) down = false;
    if (down === this.trigger) return;
    this.trigger = down;
    this.hooks.current.trigger(down);
    if (down && this.weapon && !this.weapon.auto) this.tryPull();
    if (!down && this.mgOn) {
      minigun(false);
      this.mgOn = false;
    }
  }

  private tryPull() {
    const w = this.weapon;
    if (!w) return;
    const now = performance.now();
    if (now < this.nextShot) return;
    this.nextShot = now + w.fireMs;
    if (!this.hooks.current.pull(w)) {
      sfx('click', 0.7);
      return;
    }
    this.muzzleFx(w, Math.max(1, w.pellets));
  }

  // ── Transactions land ──
  /** `n` newly accepted transactions: each one is a round of the held weapon's damage at the crosshair. */
  accept(n: number) {
    const w = this.weapon;
    if (!w || n <= 0 || !this.city || this.dead) return;
    const org = this.tA;
    const dir = this.tB;
    this.aimRay(org, dir);
    // Rays to trace this frame: cheap enough at 40; the rest of the rounds land on what the centre ray hits.
    const rays = Math.min(n, 40);
    const per = n / rays;
    const mz = this.muzzleWorld(this.tD).clone();
    const u = new THREE.Vector3().crossVectors(dir, this.tC.set(0, 1, 0)).normalize();
    const vv = new THREE.Vector3().crossVectors(u, dir);
    const jd = new THREE.Vector3();
    let tracers = 0;
    for (let i = 0; i < rays; i++) {
      jd.copy(dir);
      const spread = Math.max(0.006, w.spread);
      const a = Math.random() * Math.PI * 2;
      const rr = spread * Math.sqrt(Math.random());
      jd.addScaledVector(u, Math.cos(a) * rr).addScaledVector(vv, Math.sin(a) * rr).normalize();
      const end = this.landRound(org, jd, per * w.damage, w);
      if (tracers === 0) this.flash(this.tC.copy(mz).lerp(end, 0.35), w.bolt, 22, 90); // the round lights the wet street as it passes
      if (tracers++ < (w.auto ? 3 : 9)) this.fx.tracer(mz, end, w.bolt, w.ammo === 'laser' ? 0.09 : w.ammo === 'pellet' ? 0.035 : 0.05, w.ammo === 'laser' ? 0.15 : 0.08);
    }
  }

  private hittables: THREE.Object3D[] = [];
  private landRound(org: THREE.Vector3, dir: THREE.Vector3, dmg: number, w: RangeWeapon): THREE.Vector3 {
    const c = this.city;
    this.ray.set(org, dir);
    this.ray.far = 400;
    const list = this.hittables;
    list.length = 0;
    if (this.boss.alive) list.push(...this.boss.parts);
    for (const d of this.drones) if (!d.dead) list.push(d.body);
    for (const rk of c.racks) if (!rk.broke) list.push(rk.mesh);
    list.push(c.windows, c.towerBody, c.ground);
    const hit = this.ray.intersectObjects(list, false)[0];
    // a red bolt in the way is shot out of the air (a small target: it takes aim)
    const bolt = this.bolts.shoot(org, dir, hit ? hit.distance : 400);
    const er = this.erobots.raycast(org, dir, bolt ? bolt.dist : hit ? hit.distance : 400);
    if (bolt && !er) {
      this.fx.sparks(bolt.point, '#ffd0a0', 14, 9);
      this.fx.ring(bolt.point, '#ff6a40', 1.4, 0.25);
      this.flash(bolt.point, '#ff7a50', 45, 120);
      this.score += 40;
      return bolt.point;
    }
    if (er) {
      const r = this.erobots.hit(er, dmg, dir);
      this.score += r.score;
      if (r.killed) {
        this.kills++;
        this.heal(TUNING.player.healOnKill);
        sfx('explosion', 0.5);
      }
      if (r.heavy) this.shake = Math.max(this.shake, r.killed ? 0.5 : 0.3);
      return er.point;
    }
    const end = hit ? hit.point.clone() : org.clone().addScaledVector(dir, 300);
    if (!hit) return end;
    const o = hit.object;
    if (w.splash > 0) {
      this.fx.ring(end, w.bolt, w.splash, 0.4);
      this.fx.sparks(end, w.bolt, 10, 10);
    }
    if (this.boss.parts.includes(o as THREE.Mesh)) {
      this.erobots.mark(false);
      if (this.boss.hit(dmg, end)) {
        this.score += 5000 * this.boss.wave;
        this.kills++;
        this.fx.shatter(end, '#e8eef6', 36, 9, 1.0);
        this.flash(end, '#cfe4ff', 150, 600); // he melts: a big flash, then a cold glow as he pools
        this.flash(this.tA.set(end.x, 0.8, end.z), '#27c8e0', 60, 2200);
        this.shake = 1;
        this.heal(TUNING.player.healOnBossMelt * TUNING.player.hp);
        sfx('explosion', 0.8);
      } else this.score += Math.round(dmg);
      if (Math.random() < 0.3) this.fx.sparks(end, '#eef4ff', 1, 4);
      if (Math.random() < 0.35) this.flash(end, '#bcd8ff', 35, 70);
      return end;
    }
    const drone = this.drones.find((d) => d.body === o);
    if (drone) {
      drone.hp -= dmg;
      this.fx.sparks(end, '#ffb347', 3, 6);
      if (drone.hp <= 0) {
        drone.dead = 0.001;
        this.score += 250;
        this.kills++;
        this.fx.ring(end, '#ff6a2a', 3.2, 0.4);
        this.fx.shatter(end, '#2b3550', 24, 8, 0.8);
        this.fx.sparks(end, '#ff6a2a', 40, 12);
        this.flash(end, '#ff7a30', 130, 500);
        this.flash(this.tA.copy(end), '#ff5a20', 40, 1600);
        c.hitLight.position.copy(end);
        c.hitLight.color.set('#ff7a30');
        c.hitLight.intensity = 140;
        sfx('explosion', 0.6);
      }
      return end;
    }
    const rack = c.racks.find((r) => r.mesh === o);
    if (rack) {
      this.hurtRack(rack, dmg, end);
      return end;
    }
    if (o === c.windows && hit.instanceId != null) {
      const win = c.wins[hit.instanceId];
      if (win && !win.broke) this.hurtWindow(win, dmg, end);
      else this.fx.sparks(end, '#ffd27a', 1, 3);
      return end;
    }
    this.fx.sparks(end, o === c.ground ? '#ffd27a' : '#9fc6ff', 1, 4);
    if (o === c.ground && Math.random() < 0.3) this.flash(end, '#ffd27a', 14, 60);
    return end;
  }

  private hurtWindow(win: Window, dmg: number, at: THREE.Vector3) {
    win.hp -= dmg;
    if (win.hp <= 0) {
      this.city.breakWindow(win);
      this.score += 50;
      this.fx.shatter(at, '#cfeaff', 16, 7, 0.6, true);
      this.flash(at, '#cfeaff', 55, 140);
      if (Math.random() < 0.3) sfx('hit', 0.3);
      if (this.city.wins.every((w) => w.broke) && this.city.racks.every((r) => r.broke)) {
        this.score += 10_000;
        this.city.rebuild(); // nSLAVE has deep pockets (and a patent on them)
      }
    } else this.fx.sparks(at, '#cfeaff', 1, 3);
  }

  private hurtRack(rk: Rack, dmg: number, at: THREE.Vector3) {
    rk.hp -= dmg;
    this.fx.sparks(at, '#7cf9ff', 3, 6);
    if (Math.random() < 0.5) this.flash(at, '#7cf9ff', 35, 80);
    if (rk.hp <= 0) {
      this.city.breakRack(rk);
      this.score += 500;
      this.kills++;
      this.fx.sparks(at, '#7cf9ff', 60, 11);
      this.fx.ring(at, '#27e6ff', 4, 0.5);
      this.flash(at, '#7cf9ff', 150, 600);
      this.flash(this.tA.copy(at), '#ff6a2a', 45, 1800); // the rack burns on
      this.city.hitLight.position.copy(at);
      this.city.hitLight.color.set('#27e6ff');
      this.city.hitLight.intensity = 160;
      this.shake = Math.max(this.shake, 0.5);
      sfx('explosion', 0.5);
    }
  }

  // ── Look ──
  private muzzleWorld(out: THREE.Vector3) {
    if (this.held) {
      this.held.group.updateWorldMatrix(true, false);
      return out.copy(this.held.muzzle).applyMatrix4(this.held.group.matrixWorld);
    }
    return out.set(0.3, EYE - 0.3, -0.8);
  }

  private aimRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, this.camera);
    origin.copy(this.ray.ray.origin);
    dir.copy(this.ray.ray.direction);
  }

  private muzzleFx(w: RangeWeapon, rounds = 1) {
    const mz = this.muzzleWorld(this.tD);
    this.recoil = Math.min(1.6, this.recoil + 0.5 + w.kick * 0.25);
    this.shake = Math.min(1, this.shake + 0.06 + w.kick * 0.05);
    this.flashT = 0.06;
    this.muzzleSprite.position.copy(mz);
    this.muzzleSprite.scale.setScalar(0.22 + Math.random() * 0.2 + (rounds > 3 ? 0.2 : 0));
    this.muzzleSprite.material.color.set(w.bolt);
    this.muzzleSprite.material.opacity = 1;
    this.flashLight.position.copy(mz);
    this.flashLight.color.set(w.bolt);
    this.flashLight.intensity = (this.high ? 60 : 36) * (0.6 + Math.random() * 0.7) * (rounds > 3 ? 1.3 : 1);
    this.kick = Math.min(0.12, this.kick + 0.012 + w.kick * 0.004);
    this.decalA = Math.min(1, this.decalA + 0.5);
    this.flash(this.tA.copy(this.camera.position).add(this.tB.set(0, 0.6, -9)), w.bolt, 22, 80); // glow pulsing down the street
    if (w.def.id === 'minigun' || w.ordnance?.id === 'minigun-of-the-mempool') {
      if (!this.mgOn) {
        this.mgOn = true;
        minigun(true);
      }
    } else sfx(AMMO_SFX[w.ammo], w.auto ? 0.55 : 0.9);
    if (w.ammo === 'bullet' || w.ammo === 'pellet') this.ejectBrass(rounds > 3 ? 3 : 1);
  }

  private ejectBrass(n: number) {
    if (!this.held) return;
    const at = this.muzzleWorld(this.tC);
    const right = this.tA.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const back = this.tB.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
    for (let k = 0; k < n; k++) {
      const i = this.bCursor++ % 160;
      const j = i * 3;
      const p = at.clone().addScaledVector(back, 0.35).addScaledVector(right, 0.05);
      this.bp.set([p.x, p.y, p.z], j);
      this.bv.set([right.x * (1.6 + Math.random()) + (Math.random() - 0.5) * 0.4, 2 + Math.random() * 1.4, right.z * (1.6 + Math.random()) + back.z * 0.4], j);
      this.br.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], j);
      this.bl[i] = 1.6;
    }
  }

  private spawnDrone(i: number) {
    const g = new THREE.Group();
    const hull = new THREE.MeshPhysicalMaterial({ color: '#1c2232', metalness: 0.9, roughness: 0.28, clearcoat: 0.6 });
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a').multiplyScalar(4), toneMapped: false });
    const rotorM = new THREE.MeshBasicMaterial({ color: '#9fb4d0', transparent: true, opacity: 0.25, depthWrite: false });
    this.droneMat.push(hull, red, rotorM);
    const bodyG = new THREE.CapsuleGeometry(0.45, 0.6, 6, 16);
    bodyG.rotateZ(Math.PI / 2);
    const armG = new THREE.BoxGeometry(2.6, 0.08, 0.12);
    const rotorG = new THREE.CylinderGeometry(0.55, 0.55, 0.02, 20);
    const eyeG = new THREE.SphereGeometry(0.16, 16, 10);
    this.droneGeo.push(bodyG, armG, rotorG, eyeG);
    const body = new THREE.Mesh(bodyG, hull);
    body.castShadow = true;
    g.add(body);
    const rotors: THREE.Mesh[] = [];
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(armG, hull);
      arm.rotation.y = rot;
      g.add(arm);
      for (const s of [-1, 1]) {
        const rm = new THREE.Mesh(rotorG, rotorM);
        rm.position.set(Math.cos(rot) * 1.3 * s, 0.12, -Math.sin(rot) * 1.3 * s);
        g.add(rm);
        rotors.push(rm);
      }
    }
    const eye = new THREE.Mesh(eyeG, red);
    eye.position.set(0, -0.15, 0.42);
    g.add(eye);
    const glow = halo('#ff2a1a', 1.6, 0.8);
    glow.position.copy(eye.position);
    g.add(glow);
    const base = new THREE.Vector3((Math.random() - 0.5) * 30, 10 + Math.random() * 18, -26 - Math.random() * 30 - i * 4);
    g.position.copy(base);
    this.scene.add(g);
    this.drones.push({ g, rotors, hp: 40, dead: 0, t: Math.random() * 10, v: new THREE.Vector3(), base, body });
  }

  // ── Frame ──
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    const w = this.weapon;
    // stream weapons show fire while held AND the chain is flowing
    if (w && this.trigger && !this.dead && w.auto && this.hooks.current.flowing() && now >= this.nextShot) {
      this.nextShot = now + w.fireMs;
      this.muzzleFx(w);
    }
    if (this.autoAim && this.autoThreats) {
      this.threatT -= dt;
      if (this.threatT <= 0) {
        this.threatT = 0.4; // human reaction time
        if ((!this.boss.alive || this.boss.dist > this.autoBossRange) && this.erobots.nearest(this.tA)) {
          this.tA.project(this.camera);
          this.ndc.set(THREE.MathUtils.clamp(this.tA.x, -0.9, 0.9), THREE.MathUtils.clamp(this.tA.y, -0.9, 0.9));
        } else if (this.boss.alive) {
          this.boss.chest(this.tA).project(this.camera);
          this.ndc.set(THREE.MathUtils.clamp(this.tA.x, -0.9, 0.9), THREE.MathUtils.clamp(this.tA.y, -0.9, 0.9));
        }
      }
    } else if (this.autoAim && this.boss.alive) {
      this.boss.chest(this.tA).project(this.camera);
      this.ndc.set(THREE.MathUtils.clamp(this.tA.x, -0.9, 0.9), THREE.MathUtils.clamp(this.tA.y, -0.9, 0.9));
    }
    // the world slows to a crawl while the player is down
    const sd = this.dead ? dt * 0.18 : dt;
    this.sinceHurt += dt;
    this.hitCd -= dt;
    this.invuln -= dt;
    if (!this.dead && this.sinceHurt > TUNING.player.regenDelay && this.hp < TUNING.player.hp) this.hp = Math.min(TUNING.player.hp, this.hp + TUNING.player.regenPerSec * dt);
    if (this.dead) this.deadT += dt;
    this.boss.update(sd);
    this.erobots.wave = this.boss.wave;
    this.erobots.playerAlive = !this.dead;
    this.erobots.update(sd, this.camera, this.trigger);
    this.bolts.update(sd, this.camera.position, (from, dmg, kind) => this.hurt(from, dmg, kind));
    this.shake = Math.min(1, this.shake + this.boss.takeImpulse() + this.erobots.impulse);
    this.erobots.impulse = 0;
    this.updateDrones(dt);
    this.updateBrass(dt);
    this.city.update(dt, this.t, this.camera);
    this.fx.update(sd, this.camera);
    this.updateCamera(dt);
    this.flashT -= dt;
    if (this.flashT <= 0) {
      this.muzzleSprite.material.opacity *= 0.5;
      this.flashLight.intensity *= 0.4;
    }
    this.recoil *= Math.pow(0.0008, dt);
    this.shake *= Math.pow(0.02, dt);
    this.updateFlash(dt);
    this.grade.tick(this.t, 0);
    this.city.beforeRender(this.renderer, this.scene, this.camera);
    if (this.shafts) {
      const p = this.shaftP.copy(this.city.lightWorld).project(this.camera);
      const u = this.shafts.uniforms as { uPos: { value: THREE.Vector2 }; uK: { value: number } };
      u.uPos.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      u.uK.value = p.z < 1 ? 0.1 : 0;
    }
    this.composer.render();
    this.statsT -= dt;
    if (this.statsT <= 0) {
      this.statsT = 0.12;
      this.hooks.current.stats(this.stats());
    }
  };

  stats(): Stats {
    const c = this.city;
    return {
      score: this.score,
      bossHp: Math.ceil(this.boss.hp),
      bossMax: Math.ceil(this.boss.max),
      wave: this.boss.wave,
      windows: c.wins.length,
      windowsLeft: c.wins.filter((w) => !w.broke).length,
      racksLeft: c.racks.filter((r) => !r.broke).length,
      drones: this.drones.filter((d) => !d.dead).length + this.erobots.live,
      kills: this.kills,
      hover: this.hover,
      hp: Math.ceil(this.hp),
      hpMax: TUNING.player.hp,
      dead: this.dead,
      bossPush: this.boss.pushNorm,
      bossDist: this.boss.alive ? this.boss.dist : 99,
    };
  }

  /**
   * A short flash of light at a world position: a pooled point light (no allocation; High 6 slots, Low 1 plus
   * a muzzle ground decal), bloom catches it, and big flashes kick the exposure and the chromatic fringe.
   * Public so any module (enemies, boss) can call it.
   */
  flash(at: THREE.Vector3, color: string, intensity: number, durationMs: number) {
    if (!this.pool.length) {
      this.kick = Math.min(0.2, this.kick + intensity / 3000);
      return;
    }
    let slot = this.pool[0];
    let best = Infinity;
    for (const s of this.pool) {
      const rem = s.t <= 0 ? -1 : (s.t / (s.dur / 1000)) * s.peak;
      if (rem < best) {
        best = rem;
        slot = s;
      }
    }
    slot.l.position.copy(at);
    slot.l.color.set(color);
    slot.peak = intensity * (this.high ? 1 : 1.4);
    slot.dur = durationMs;
    slot.t = durationMs / 1000;
    if (intensity >= 120) {
      this.kick = Math.min(0.2, this.kick + intensity / 2600);
      this.flashK = Math.min(1, this.flashK + intensity / 600);
    }
  }

  private updateFlash(dt: number) {
    for (const s of this.pool) {
      if (s.t > 0) {
        s.t -= dt;
        const k = Math.max(0, s.t / (s.dur / 1000));
        s.l.intensity = s.peak * k * k * (0.8 + Math.random() * 0.4);
      } else if (s.l.intensity !== 0) s.l.intensity = 0;
    }
    if (this.decal) {
      this.decalA *= Math.pow(0.004, dt);
      (this.decal.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, this.decalA * 0.5);
    }
    // the resting scene stays dark: exposure and bloom only lift while something is bright, then settle
    this.kick *= Math.pow(0.01, dt);
    this.flashK *= Math.pow(0.003, dt);
    this.renderer.toneMappingExposure = 1.0 + this.kick;
    this.bloom.strength = (this.high ? 0.3 : 0.26) + this.kick * 0.7;
    const u = this.grade.pass.uniforms as { uAberr: { value: number } };
    u.uAberr.value = 0.0012 + this.flashK * 0.003;
  }

  private bossEvent(kind: 'roar' | 'stomp' | 'lunge' | 'stagger' | 'skid' | 'melt' | 'splash' | 'pooled' | 'rise', at: THREE.Vector3) {
    if (kind === 'roar') {
      this.fx.ring(at, '#ff3a22', 9, 0.8);
      this.fx.sparks(at, '#ff6a2a', 30, 10);
      this.flash(at, '#ff3a22', 160, 600); // the roar lights the street red
      this.kick = Math.min(0.2, this.kick + 0.06);
      sfx('explosion', 0.4);
    } else if (kind === 'lunge') this.fx.ring(at, '#27e6ff', 7, 0.5);
    else if (kind === 'stagger') {
      this.fx.sparks(at, '#eef4ff', 34, 11);
      this.fx.ring(at, '#eef4ff', 8, 0.5);
      this.flash(at, '#cfe4ff', 90, 300);
    } else if (kind === 'skid') this.fx.sparks(at, '#ffd27a', 5, 5);
    else if (kind === 'melt') {
      this.flash(at, '#cfe4ff', 150, 700);
      this.shake = 1;
      sfx('explosion', 0.8);
    } else if (kind === 'splash') {
      this.fx.sparks(at, '#dff0ff', 8, 6);
      if (Math.random() < 0.4) this.flash(at, '#9fe8ff', 40, 160);
    } else if (kind === 'pooled') {
      this.fx.ring(at, '#27e6ff', 7, 0.9);
      this.flash(at, '#27c8e0', 70, 1400);
    } else if (kind === 'rise') {
      this.fx.ring(at, '#cfe4ff', 8, 0.8);
      this.flash(at, '#cfe4ff', 80, 800);
      this.kick = Math.min(0.2, this.kick + 0.05);
    }
  }

  /** The boss's attacks: swipe / lunge / slam hurt the player if they landed; shards are real projectiles. */
  private bossAttack(a: { kind: 'swipe' | 'lunge' | 'slam' | 'shards'; dmg: number; from: THREE.Vector3; landed: boolean }) {
    if (a.kind === 'shards') {
      const B = TUNING.boss.shards;
      const n = B.count + Math.floor((this.boss.wave - 1) / 2);
      for (let i = 0; i < n; i++) {
        const from = new THREE.Vector3(a.from.x + (Math.random() - 0.5) * 4, a.from.y + (Math.random() - 0.5) * 1.5, a.from.z + 1);
        const hits = Math.random() > 0.2;
        const to = this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * (hits ? 0.6 : 5), (Math.random() - 0.5) * (hits ? 0.4 : 2), 0));
        this.bolts.fire(from, to, B.speed, a.dmg, '#bfe6ff', hits, 'shard');
      }
      this.flash(a.from, '#bfe6ff', 70, 200);
      return;
    }
    this.shake = Math.max(this.shake, a.kind === 'slam' ? 0.9 : 0.6);
    const at = this.tC.set(a.from.x, 0.4, a.from.z + 3);
    this.fx.ring(at, a.kind === 'slam' ? '#ff6a2a' : '#cfe4ff', a.kind === 'slam' ? 12 : 7, 0.5);
    this.fx.sparks(at, '#ffd27a', 18, 9);
    if (a.landed) this.hurt(a.from, a.dmg, a.kind);
  }

  // ── The player's body ──
  /** Damage from a world position. No effect while down or in the grace after Continue. */
  hurt(from: THREE.Vector3, dmg: number, kind: HurtKind) {
    if (this.dead || this.invuln > 0 || dmg <= 0) return;
    if (kind === 'bolt' && this.hitCd > 0) return;
    this.hitCd = TUNING.player.hitCooldown;
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHurt = 0;
    // where did it come from? local position relative to the view
    this.camera.updateMatrixWorld();
    const l = this.tA.copy(from);
    this.camera.worldToLocal(l);
    const angle = Math.atan2(l.x, -l.z);
    // camera kick: a jolt away from the blow, a roll, and a shake
    const k = (dmg / 10) * TUNING.player.kickPer10;
    this.hitKick.p += k * (0.6 + Math.random() * 0.5);
    this.hitKick.y += -Math.sin(angle) * k * 1.4;
    this.hitKick.r += -Math.sin(angle) * k * 2.2;
    this.shake = Math.min(1, this.shake + 0.25 + dmg / 60);
    this.kick = Math.min(0.2, this.kick + 0.04);
    this.flashK = Math.min(1, this.flashK + 0.4);
    sfx('hurt', 0.9);
    this.hooks.current.hurt({ angle, dmg, kind, hp: this.hp, hpMax: TUNING.player.hp });
    if (this.hp <= 0) this.die();
  }

  private heal(n: number) {
    if (!this.dead) this.hp = Math.min(TUNING.player.hp, this.hp + n);
  }

  private die() {
    this.dead = true;
    this.deadT = 0;
    this.bolts.clear();
    this.setTrigger(false);
    this.shake = 1;
    this.kick = 0.2;
    this.flashK = 1;
    sfx('gameover', 0.9);
    this.hooks.current.died();
  }

  /** Continue: back on your feet with full health and a few seconds of grace; the street is cleared of attackers. */
  revive() {
    this.dead = false;
    this.hp = TUNING.player.hp;
    this.invuln = TUNING.player.reviveGrace;
    this.hitCd = 0;
    this.sinceHurt = 99;
    this.bolts.clear();
    this.erobots.clearAll();
    this.erobots.grace = TUNING.player.reviveGrace + 0.5;
    this.boss.shove();
    this.flash(this.camera.position.clone().add(new THREE.Vector3(0, 0.5, -3)), '#7cf9ff', 100, 500);
    this.hooks.current.hurt({ angle: 0, dmg: 0, kind: 'bolt', hp: this.hp, hpMax: TUNING.player.hp });
  }

  /** Dev only (dry run): poke the combat from the console / screenshot scripts. */
  debug = {
    hurt: (n: number, angle = 0) => this.hurt(this.tD.set(Math.sin(angle) * 6, 1.6, -Math.cos(angle) * 6).clone(), n, 'bolt'),
    kill: () => this.hurt(this.tD.set(0, 1.6, -5).clone(), this.hp + 1, 'swipe'),
    meltBoss: () => {
      if (this.boss.alive) this.boss.hit(this.boss.hp + 1, this.boss.chest(new THREE.Vector3()));
    },
    boss: () => ({ z: this.boss.dist, alive: this.boss.alive, phase: this.boss.phaseName, push: this.boss.pushNorm, melt: this.boss.melt }),
    setInvuln: (s: number) => (this.invuln = s),
    stats: () => this.stats(),
    bossAt: (z: number) => this.boss.placeAt(z),
    calm: (on: boolean) => (this.boss.calmed = on),
    look: (x: number, y: number) => this.ndc.set(x, y),
    clearEnemies: () => (this.erobots.clearAll(), this.bolts.clear()),
    spawning: (on: boolean) => (this.erobots.spawning = on),
  };

  private updateDrones(dt: number) {
    for (const d of this.drones) {
      d.t += dt;
      for (const r of d.rotors) r.rotation.y += dt * 60;
      if (d.dead) {
        d.dead += dt;
        d.v.y -= 18 * dt;
        d.g.position.addScaledVector(d.v, dt);
        d.g.rotation.x += dt * 6;
        d.g.rotation.z += dt * 4;
        if (d.g.position.y < 0.5 || d.dead > 3) {
          if (d.dead < 3) this.fx.sparks(d.g.position, '#ff6a2a', 20, 8);
          // a fresh one flies in from behind the tower
          d.dead = 0;
          d.hp = 40;
          d.v.set(0, 0, 0);
          d.g.rotation.set(0, 0, 0);
          d.base.set((Math.random() - 0.5) * 30, 10 + Math.random() * 18, -30 - Math.random() * 30);
          d.g.position.set(d.base.x, d.base.y + 20, TOWER.z - 10);
        }
        continue;
      }
      // patrol: figure-eights around their post, drifting in toward the street
      const target = this.tC.set(d.base.x + Math.sin(d.t * 0.6) * 8, d.base.y + Math.sin(d.t * 1.3) * 2, d.base.z + Math.sin(d.t * 0.3) * 6);
      d.g.position.lerp(target, Math.min(1, dt * 0.8));
      d.g.lookAt(this.camera.position);
      d.g.rotateX(Math.sin(d.t * 2) * 0.05);
    }
  }

  private updateBrass(dt: number) {
    const q = this.tQ;
    const e = new THREE.Euler();
    const s = this.tD;
    for (let i = 0; i < 160; i++) {
      if (this.bl[i] <= 0) continue;
      const j = i * 3;
      this.bl[i] -= dt;
      this.bv[j + 1] -= 9.8 * dt;
      this.bp[j] += this.bv[j] * dt;
      this.bp[j + 1] += this.bv[j + 1] * dt;
      this.bp[j + 2] += this.bv[j + 2] * dt;
      if (this.bp[j + 1] < 0.02) {
        this.bp[j + 1] = 0.02;
        this.bv[j + 1] *= -0.35;
        this.bv[j] *= 0.6;
        this.bv[j + 2] *= 0.6;
      }
      this.br[j] += dt * 14;
      this.br[j + 2] += dt * 9;
      e.set(this.br[j], this.br[j + 1], this.br[j + 2]);
      q.setFromEuler(e);
      s.setScalar(this.bl[i] > 0 ? 1 : 0);
      this.m4.compose(this.tA.set(this.bp[j], this.bp[j + 1], this.bp[j + 2]), q, s);
      this.brass.setMatrixAt(i, this.m4);
    }
    this.brass.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    const ty = -this.ndc.x * 0.32;
    const tp = this.ndc.y * 0.24 + 0.2;
    this.yaw += (ty - this.yaw) * Math.min(1, dt * 8);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 8);
    const s = this.shake * this.shake;
    const hk = this.hitKick;
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * s * 0.03 + this.recoil * 0.004 + hk.p, this.yaw + (Math.random() - 0.5) * s * 0.03 + hk.y, hk.r, 'YXZ');
    const kd = Math.exp(-dt * 9);
    hk.p *= kd;
    hk.y *= kd;
    hk.r *= kd;
    cam.position.set((Math.random() - 0.5) * s * 0.05, EYE + Math.sin(this.t * 1.1) * 0.006, 0);
    cam.updateMatrixWorld();
    if (this.held && this.weapon) {
      this.aimRay(this.tA, this.tC);
      const aimPt = this.tB.copy(this.tA).addScaledVector(this.tC, 40);
      cam.worldToLocal(aimPt);
      const to = aimPt.sub(this.mount.position).normalize();
      to.lerp(this.tD.set(0, 0.02, -1), 0.4).normalize();
      this.tQ.setFromUnitVectors(this.tD.set(0, 0, -1), to);
      this.mount.quaternion.slerp(this.tQ, Math.min(1, dt * 14));
      const k = this.weapon.kick;
      this.kickG.position.z = this.recoil * 0.06 * (0.4 + k * 0.5);
      this.kickG.rotation.x = this.recoil * 0.05 * (0.4 + k * 0.5);
      this.held.mixer?.update(dt);
      if (this.held.spin) this.held.spin.timeScale = this.trigger ? 14 : this.held.spin.timeScale * 0.92;
    }
  }

  /** The crosshair in CSS px, for the DOM reticle. */
  reticle(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((this.ndc.x + 1) / 2) * r.width, y: ((1 - this.ndc.y) / 2) * r.height };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.mgOn) minigun(false);
    this.cleanup.forEach((f) => f());
    this.ro?.disconnect();
    this.city?.dispose();
    this.boss?.dispose();
    this.erobots?.dispose();
    this.bolts?.dispose();
    this.fx?.dispose();
    this.look?.dispose();
    this.droneGeo.forEach((g) => g.dispose());
    this.droneMat.forEach((m) => m.dispose());
    this.composer?.dispose();
    this.renderer?.dispose();
  }
}
