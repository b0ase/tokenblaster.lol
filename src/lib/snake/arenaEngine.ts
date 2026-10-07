/**
 * Token Snake ARENA engine: the slither-style multiplayer mode. Rules + maths live in arenaSim.ts, the room in
 * arenaNet.ts (React wiring in SnakeArena.tsx). This file owns the 3D scene, the local snake (this client is
 * authoritative for it), the remote snakes (interpolated along their sent head path; the victim's client decides
 * collisions against those bodies), seeded shared food, corpse orbs, kill feed, avatar billboards and the solo bots.
 *
 * Avatar billboards are THREE.Sprites in `tags`. This scene has NO ambient-occlusion pass, but any AO pass added
 * later must call `setSpritesVisible(false)` around it (GTAOPass redraws with an opaque override material).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { disposeAvatarTag, fitAvatarTag, makeAvatarTag, tagKey } from '../avatarTag';
import { readWire, type IdWire } from '../identity';
import type { Loot } from '../loot';
import { sfx } from '../sfx';
import { floorMaterial, glowTexture, neonEnvironment, skyMaterial, wallMaterial } from './art';
import { Rings, Sparks } from './fx';
import {
  ARENA_GROW,
  ARENA_POINTS,
  BOOST_COST,
  Body,
  colourIndex,
  corpseSpots,
  cssOf,
  FOOD_SLOTS,
  FoodField,
  HALF,
  hashStr,
  hitsBody,
  MASS0,
  MAX_MASS,
  MIN_BOOST_MASS,
  outOfBounds,
  PoseBuffer,
  radiusOf,
  readCorpses,
  SEND_HZ,
  SHIELD_SECS,
  SIDE,
  SNAKE_COLOURS,
  speedOf,
  steer,
  wrapAngle,
  TURN_RATE,
} from './arenaSim';
import type { ArenaPlayer } from './arenaNet';
import type { FoodKind, FoodSpec } from './sim';

export type Quality = 'low' | 'high';
export type Toast = { text: string; tone: 'good' | 'bad' | 'gold' | 'info' };
export type ArenaWho = { id: string; name: string; x?: string; col: string; verified: boolean };
export type BoardEntry = ArenaWho & { mass: number; kills: number; me: boolean };
export type ArenaHud = { mass: number; kills: number; score: number; rank: number; total: number; alive: boolean; boosting: boolean; shield: number; respawnIn: number; online: number };
export type FeedEntry = { killer: ArenaWho | null; victim: ArenaWho; cause: string; mine: 'killer' | 'victim' | null };
export type ArenaCbs = {
  onHud(h: ArenaHud): void;
  onBoard(rows: BoardEntry[]): void;
  onFeed(e: FeedEntry): void;
  onToast(t: Toast): void;
  onDeath(d: { by: ArenaWho | null; cause: string; mass: number; kills: number; score: number }): void;
  onRespawn(): void;
  onPickup(l: Loot): void;
  onNeedAmmo(): void;
  onPerf?(i: { fps: number }): void;
};
export type ArenaOpts = {
  quality: Quality;
  touchDevice: boolean;
  /** Everyone with the same key derives the same food (the room topic); solo uses a random one. */
  seedKey: string;
  me: { id: string; name: string; x?: string; xk?: string; xs?: number[] };
  send(ev: 'p' | 'd' | 'f' | 'g', p: Record<string, unknown>): void;
  /** Practice vs bots when there is no room. */
  solo: boolean;
  /** A real chain transaction of this kind to show / loot when the seeded food is eaten (or null). */
  takeTx(kind: FoodKind): FoodSpec | null;
  /** LIVE: one paid action per bite (the shell queues the real transaction). Unchanged from the grid game. */
  pay?(a: string[]): void;
  canPay?(): boolean;
  live: boolean;
  mini?: HTMLCanvasElement | null;
  cb: ArenaCbs;
};

type Remote = {
  id: string;
  name: string;
  wire: IdWire;
  verified: boolean;
  col: number;
  buf: PoseBuffer;
  body: Body;
  mass: number;
  r: number;
  a: number;
  hx: number;
  hz: number;
  boost: boolean;
  shield: boolean;
  kills: number;
  alive: boolean;
  /** No poses for a while (stalled tab / lost packets): hidden, not dead; the next pose brings it back. */
  quiet: boolean;
  seen: boolean;
  life: number;
  here: boolean;
  tag: THREE.Sprite | null;
  tagK: string;
  bot: boolean;
  respawnAt: number;
  think: number;
  want: number;
};

type View = { id: string; hx: number; hz: number; a: number; r: number; col: number; pts: { x: number; z: number }[]; boost: boolean; shield: boolean; me: boolean; mass: number; r0: Remote | null };
const WHITE = new THREE.Color(1, 1, 1);
const tmpD = new THREE.Color();

const KIND_COLOR: Record<FoodKind, number> = { blast: 0xffcf4a, token: 0xe8b53a, inscription: 0xff4d3a, social: 0xff8f7a, data: 0xd23a2e, payment: 0xffe0d2, quiet: 0x7a2a4a };
const MAXB = 280; // beads per snake
const SNAKES = 12;
const CORPSE_MAX = 700;
const CORPSE_LIFE = 40;
const BOT_NAMES = ['ByteBot', 'node-7', 'mempool', 'orphan', 'utxo', 'hashling'];

const tmpC = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const nowS = () => performance.now() / 1000;

export class ArenaEngine {
  readonly el: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(56, 1.6, 0.3, 500);
  private tags = new THREE.Group();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private floorMat!: THREE.ShaderMaterial;
  private wallMat!: THREE.ShaderMaterial;
  private skyMat!: THREE.ShaderMaterial;
  private beads!: THREE.InstancedMesh;
  private heads!: THREE.InstancedMesh;
  private eyesW!: THREE.InstancedMesh;
  private eyesP!: THREE.InstancedMesh;
  private orbs!: THREE.InstancedMesh;
  private halos: THREE.Sprite[] = [];
  private sparks!: Sparks;
  private rings!: Rings;
  private glow!: THREE.CanvasTexture;
  private env: THREE.Texture | null = null;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private last = 0;
  private fpsN = 0;
  private fpsT = 0;
  private hudT = 0;
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private gensT = 0;
  private mapT = 0;
  private focus = new THREE.Vector3();
  private camH = 20;

  readonly field: FoodField;
  readonly remotes = new Map<string, Remote>();
  private born: number[] = new Array(FOOD_SLOTS).fill(-9);
  private seenGen: number[] = new Array(FOOD_SLOTS).fill(0);
  private seenDeaths = new Set<string>();

  // ── me ──
  readonly myId: string;
  private name: string;
  private wire: IdWire;
  private colI: number;
  private body = new Body();
  private x = 0;
  private z = 0;
  private a = 0;
  mass = MASS0;
  kills = 0;
  score = 0;
  private boosting = false;
  alive = false;
  private shield = 0;
  private life = 0;
  private deadAt = 0;
  private respawnAt = 0;
  private aim: number | null = null; // dev / touch: forced target heading
  private wantBoost = false;
  private ptr = { x: 0, y: 0, in: false };
  private keys = { l: false, r: false };
  private stick: { id: number; ax: number; ay: number } | null = null;
  private live: boolean;
  private lastBy: ArenaWho | null = null;
  private soloBots: boolean;
  private roster: ArenaPlayer[] = [];
  private verified: Record<string, boolean> = {};
  private suspectClaims = 0;
  private recv: Record<string, number> = {};
  private tagsOn = true;

  constructor(el: HTMLElement, private o: ArenaOpts) {
    this.el = el;
    this.myId = o.me.id;
    this.name = o.me.name;
    this.wire = readWire({ x: o.me.x, xk: o.me.xk, xs: o.me.xs });
    this.colI = colourIndex(o.me.id);
    this.live = o.live;
    this.soloBots = o.solo;
    this.field = new FoodField(hashStr(o.seedKey));
  }

  // ───────────── Setup ─────────────

  async init() {
    const hi = this.o.quality === 'high';
    const renderer = new THREE.WebGLRenderer({ antialias: hi, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.dpr = Math.min(window.devicePixelRatio || 1, hi ? 1.75 : 1);
    renderer.setPixelRatio(this.dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
    this.el.appendChild(renderer.domElement);
    this.scene.background = new THREE.Color(0x07070b);
    this.scene.fog = new THREE.FogExp2(0x07070b, 0.0075);
    this.env = neonEnvironment(renderer);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.85;
    this.glow = glowTexture();
    this.sparks = new Sparks(hi ? 900 : 380);
    this.rings = new Rings(8);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), (this.skyMat = skyMaterial()));
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.floorMat = floorMaterial(SIDE);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.wallMat = wallMaterial();
    this.wallMat.uniforms.uLen.value = SIDE;
    const wallGeo = new THREE.PlaneGeometry(SIDE, 2.6);
    for (const [x, z, ry] of [
      [0, -HALF, 0],
      [0, HALF, Math.PI],
      [-HALF, 0, Math.PI / 2],
      [HALF, 0, -Math.PI / 2],
    ] as const) {
      const m = new THREE.Mesh(wallGeo, this.wallMat);
      m.position.set(x, 1.3, z);
      m.rotation.y = ry;
      m.renderOrder = 4;
      this.scene.add(m);
    }

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.28, emissive: 0x1a1a1a });
    const seg = hi ? [14, 10] : [9, 6];
    const sph = new THREE.SphereGeometry(1, seg[0], seg[1]);
    this.beads = new THREE.InstancedMesh(sph, bodyMat, SNAKES * MAXB);
    this.heads = new THREE.InstancedMesh(sph, bodyMat, SNAKES);
    this.eyesW = new THREE.InstancedMesh(sph, new THREE.MeshBasicMaterial({ color: 0xffffff }), SNAKES * 2);
    this.eyesP = new THREE.InstancedMesh(sph, new THREE.MeshBasicMaterial({ color: 0x050508 }), SNAKES * 2);
    for (const m of [this.beads, this.heads, this.eyesW, this.eyesP]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
    }
    this.beads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SNAKES * MAXB * 3), 3);
    this.heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SNAKES * 3), 3);
    this.orbs = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), FOOD_SLOTS + CORPSE_MAX);
    this.orbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((FOOD_SLOTS + CORPSE_MAX) * 3), 3);
    this.orbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbs.frustumCulled = false;
    this.scene.add(this.orbs);
    // A soft halo under each head (additive).
    for (let i = 0; i < SNAKES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      s.visible = false;
      this.halos.push(s);
      this.scene.add(s);
    }
    this.scene.add(this.sparks.points, this.rings.group, this.tags);
    this.scene.add(new THREE.HemisphereLight(0x6f9bff, 0x2a0a3a, 0.5));

    this.buildComposer();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.attachInput();
    this.last = performance.now();
    renderer.setAnimationLoop(this.frame);
    // Poses go out on a timer, not per frame: a slow frame rate must not starve everyone else's view of this snake.
    this.sendTimer = setInterval(() => this.alive && this.sendPose(), 1000 / SEND_HZ);
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __tbArena?: unknown }).__tbArena = this;
  }

  private buildComposer() {
    const r = this.renderer;
    this.composer?.dispose();
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    const comp = new EffectComposer(r, rt);
    comp.addPass(new RenderPass(this.scene, this.camera));
    const bs = this.o.quality === 'high' ? 0.8 : 0.5;
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(size.x * bs, size.y * bs), this.o.quality === 'high' ? 0.45 : 0.34, 0.55, 0.96));
    comp.addPass(new OutputPass());
    comp.setPixelRatio(this.dpr);
    comp.setSize(this.el.clientWidth || 1, this.el.clientHeight || 1);
    this.composer = comp;
  }

  resize() {
    if (!this.renderer) return;
    this.w = this.el.clientWidth || 1;
    this.h = this.el.clientHeight || 1;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(this.w, this.h);
    this.sparks.mat.uniforms.uPx.value = (this.h * this.dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  // ───────────── Input ─────────────

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.l = true;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.r = true;
    else if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ArrowUp' || e.code === 'KeyW') this.wantBoost = true;
    else return;
    if (this.alive) e.preventDefault();
    this.aim = null;
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.l = false;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.r = false;
    else if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ArrowUp' || e.code === 'KeyW') this.wantBoost = false;
  };
  private onPtrMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const r = this.el.getBoundingClientRect();
    this.ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ptr.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    this.ptr.in = true;
    this.aim = null;
  };
  private onPtrDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || (e.target as HTMLElement | null)?.closest('button,a,input,textarea,select')) return;
    this.wantBoost = true;
  };
  private onPtrUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') this.wantBoost = false;
  };
  private onTouchStart = (e: TouchEvent) => {
    if ((e.target as HTMLElement | null)?.closest('button,a,input,textarea,select') || this.stick) return;
    const t = e.changedTouches[0];
    this.stick = { id: t.identifier, ax: t.clientX, ay: t.clientY };
  };
  private onTouchMove = (e: TouchEvent) => {
    const s = this.stick;
    if (!s) return;
    const t = Array.from(e.changedTouches).find((x) => x.identifier === s.id);
    if (!t) return;
    e.preventDefault();
    const dx = t.clientX - s.ax;
    const dy = t.clientY - s.ay;
    const len = Math.hypot(dx, dy);
    if (len > 14) this.aim = Math.atan2(dy, dx); // screen up = world -z: the camera looks "north"
    if (len > 60) {
      s.ax += (dx / len) * (len - 60);
      s.ay += (dy / len) * (len - 60);
    }
  };
  private onTouchEnd = (e: TouchEvent) => {
    if (this.stick && Array.from(e.changedTouches).some((x) => x.identifier === this.stick!.id)) this.stick = null;
  };
  private onBlur = () => {
    this.keys.l = this.keys.r = false;
    this.wantBoost = false;
    this.stick = null;
  };
  private attachInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.el.addEventListener('pointermove', this.onPtrMove);
    this.el.addEventListener('pointerdown', this.onPtrDown);
    window.addEventListener('pointerup', this.onPtrUp);
    this.el.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.el.addEventListener('touchend', this.onTouchEnd);
    this.el.addEventListener('touchcancel', this.onTouchEnd);
  }
  private detachInput() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('pointermove', this.onPtrMove);
    this.el.removeEventListener('pointerdown', this.onPtrDown);
    window.removeEventListener('pointerup', this.onPtrUp);
    this.el.removeEventListener('touchstart', this.onTouchStart);
    this.el.removeEventListener('touchmove', this.onTouchMove);
    this.el.removeEventListener('touchend', this.onTouchEnd);
    this.el.removeEventListener('touchcancel', this.onTouchEnd);
  }
  /** On-screen BOOST button (touch). */
  setBoost(on: boolean) {
    this.wantBoost = on;
  }
  /** Dev / test hook: steer to an absolute heading (radians) or null to hand control back to the pointer / keys. */
  debugAim(a: number | null) {
    this.aim = a;
  }

  // ───────────── Public control ─────────────

  setLive(live: boolean) {
    this.live = live;
  }
  setSpritesVisible(v: boolean) {
    this.tags.visible = v;
  }
  setIdentity(p: { name: string; x?: string; xk?: string; xs?: number[] }, verified: boolean) {
    this.name = p.name;
    this.wire = readWire({ x: p.x, xk: p.xk, xs: p.xs });
    this.verified = { ...this.verified, [this.myId]: verified };
  }
  setRoster(players: ArenaPlayer[], verified: Record<string, boolean>) {
    this.roster = players;
    this.verified = { ...this.verified, ...verified };
    const ids = new Set<string>();
    for (const p of players) {
      if (p.id === this.myId) continue;
      ids.add(p.id);
      const r = this.remotes.get(p.id) ?? this.addRemote(p.id, false);
      r.here = true;
      r.name = p.name;
      r.wire = readWire(p);
      r.verified = Boolean(verified[p.id]);
    }
    for (const r of this.remotes.values()) {
      if (r.bot) continue;
      if (!ids.has(r.id)) {
        r.here = false;
        r.quiet = true; // gone from the room: hidden now, forgotten soon (see the prune in updateRemote)
      }
    }
    // Someone new: tell them where the food stands.
    if (!this.soloBots) this.gensT = 99;
  }
  private addRemote(id: string, bot: boolean): Remote {
    const r: Remote = { id, name: bot ? BOT_NAMES[Math.abs(hashStr(id)) % BOT_NAMES.length] : 'snake', wire: {}, verified: false, col: SNAKE_COLOURS[colourIndex(id)], buf: new PoseBuffer(), body: new Body(), mass: MASS0, r: radiusOf(MASS0), a: 0, hx: 0, hz: 0, boost: false, shield: false, kills: 0, alive: false, quiet: false, seen: false, life: 0, here: !bot ? false : true, tag: null, tagK: '', bot, respawnAt: 0, think: 0, want: 0 };
    this.remotes.set(id, r);
    return r;
  }

  /** Join the arena (or respawn). */
  start() {
    if (this.soloBots && ![...this.remotes.values()].some((r) => r.bot)) for (let i = 0; i < 6; i++) this.spawnBot(`bot${i + 1}`);
    this.mass = MASS0;
    this.kills = 0;
    this.score = 0;
    this.life++;
    this.spawnMe();
  }
  private spawnMe() {
    // The spot farthest from every visible head out of a handful of random tries.
    let best = { x: 0, z: 0, d: -1 };
    for (let i = 0; i < 24; i++) {
      const x = (Math.random() * 2 - 1) * (HALF - 10);
      const z = (Math.random() * 2 - 1) * (HALF - 10);
      let d = Infinity;
      for (const r of this.remotes.values()) if (r.alive && r.seen && !r.quiet) d = Math.min(d, Math.hypot(r.hx - x, r.hz - z));
      if (d > best.d) best = { x, z, d };
    }
    this.x = best.x;
    this.z = best.z;
    this.a = Math.atan2(-best.z, -best.x) + (Math.random() - 0.5) * 0.6; // face the middle
    this.body.reset(this.x, this.z, this.a, this.mass);
    this.alive = true;
    this.shield = SHIELD_SECS;
    this.boosting = false;
    this.focus.set(this.x, 0, this.z);
    this.sendPose();
  }
  /** After a death: back in with fresh mass (kills and score are kept for the session). */
  respawn() {
    if (this.alive) return;
    this.mass = MASS0;
    this.life++;
    this.spawnMe();
    this.o.cb.onRespawn();
  }
  get respawnReady() {
    return !this.alive && nowS() >= this.respawnAt;
  }

  // ───────────── Messages in ─────────────

  onMessage(ev: string, p: Record<string, unknown>, from: string | null) {
    if (from === this.myId) return;
    this.recv[ev] = (this.recv[ev] ?? 0) + 1;
    const now = nowS();
    if (ev === 'p' && from) {
      const r = this.remotes.get(from) ?? this.addRemote(from, false);
      const life = typeof p.l === 'number' && Number.isInteger(p.l) && p.l >= 0 && p.l < 1e6 ? p.l : 0;
      if (life < r.life) return;
      if (life > r.life || !r.seen) {
        r.life = life;
        r.buf.reset();
        r.body = new Body();
        r.alive = true;
      }
      if (!r.alive) return; // dead until its next life
      if (r.buf.push(p, now)) {
        if (r.quiet) {
          // Back after a stall: the old path no longer joins up with where it is now.
          r.quiet = false;
          r.body = new Body();
        }
        r.seen = true;
        r.here = true;
      }
    } else if (ev === 'd' && from) {
      this.remoteDeath(from, p);
    } else if (ev === 'f' && from) {
      this.remoteClaim(from, p);
    } else if (ev === 'g') {
      const g = p.g;
      if (Array.isArray(g)) this.field.merge(g as number[]);
    }
  }

  private whoOf(id: string | null): ArenaWho | null {
    if (!id) return null;
    if (id === this.myId) return { id, name: this.name, x: this.wire.x, col: cssOf(SNAKE_COLOURS[this.colI]), verified: Boolean(this.verified[id]) };
    const r = this.remotes.get(id);
    return r ? { id, name: r.name, x: r.wire.x, col: cssOf(r.col), verified: r.verified } : { id, name: 'snake', col: cssOf(SNAKE_COLOURS[colourIndex(id)]), verified: false };
  }

  private remoteDeath(id: string, p: Record<string, unknown>) {
    const r = this.remotes.get(id);
    const did = typeof p.did === 'string' ? p.did.slice(0, 24) : '';
    if (!r || !did || this.seenDeaths.has(did)) return;
    const life = typeof p.l === 'number' ? p.l : r.life;
    if (life < r.life) return;
    this.seenDeaths.add(did);
    if (this.seenDeaths.size > 400) this.seenDeaths.clear();
    const by = typeof p.by === 'string' && (p.by === this.myId || this.remotes.has(p.by)) && p.by !== id ? p.by : null;
    const cause = p.cause === 'wall' ? 'wall' : by ? 'cut' : 'self';
    this.killRemote(r, by, cause, typeof p.m === 'number' ? p.m : r.mass, p.pts, did, life);
  }

  /** A remote snake died (its own client said so, or it is a bot): burst, corpse orbs, feed, credit. */
  private killRemote(r: Remote, by: string | null, cause: string, mass: number, pts: unknown, did: string, life: number) {
    const now = nowS();
    r.alive = false;
    r.life = Math.max(r.life, life);
    r.respawnAt = now + 3;
    for (const c of readCorpses(did, pts, mass, r.col, now)) if (this.field.corpses.size < CORPSE_MAX) this.field.corpses.set(c.id, c);
    this.burst(r.hx, r.hz, r.col, 26, r.r);
    this.o.cb.onFeed({ killer: this.whoOf(by), victim: this.whoOf(r.id)!, cause, mine: by === this.myId ? 'killer' : null });
    if (by === this.myId) {
      this.kills++;
      this.score += 100;
      this.mass = Math.min(MAX_MASS, this.mass + Math.min(30, mass * 0.12));
      this.o.cb.onToast({ text: `YOU CUT OFF ${r.wire.x ? '@' + r.wire.x : r.name.toUpperCase()}`, tone: 'gold' });
      sfx('pickup');
    }
    if (by && by !== this.myId) {
      const k = this.remotes.get(by);
      if (k && k.bot) k.kills++;
    }
  }

  private remoteClaim(from: string, p: Record<string, unknown>) {
    const r = this.remotes.get(from);
    if (!r || !r.seen) return;
    const near = (x: number, z: number) => Math.hypot(r.hx - x, r.hz - z) < 10; // generous: render lag + extrapolation
    if (typeof p.c === 'string') {
      const c = this.field.corpses.get(p.c);
      if (c && near(c.x, c.z)) this.field.corpses.delete(p.c);
      else if (c) this.suspectClaims++;
      return;
    }
    const s = p.s;
    const g = p.g;
    if (typeof s !== 'number' || typeof g !== 'number' || !Number.isInteger(s) || !Number.isInteger(g) || s < 0 || s >= FOOD_SLOTS) return;
    const f = this.field.slots[s];
    if (g < f.gen || g > f.gen + 3) return; // stale, or from a table far ahead of mine (the next 'g' sync resolves it)
    if (!near(f.x, f.z)) {
      this.suspectClaims++;
      return;
    }
    this.field.claim(s, g);
  }

  // ───────────── Bots (solo practice) ─────────────

  private spawnBot(id: string) {
    const r = this.remotes.get(id) ?? this.addRemote(id, true);
    const x = (Math.random() * 2 - 1) * (HALF - 10);
    const z = (Math.random() * 2 - 1) * (HALF - 10);
    r.mass = MASS0 + Math.random() * 10;
    r.r = radiusOf(r.mass);
    r.a = Math.random() * Math.PI * 2;
    r.hx = x;
    r.hz = z;
    r.body.reset(x, z, r.a, r.mass);
    r.alive = true;
    r.seen = true;
    r.here = true;
    r.life++;
    r.shield = true;
    r.respawnAt = nowS() + SHIELD_SECS;
    r.think = 0;
    r.want = r.a;
  }

  private stepBot(r: Remote, dt: number) {
    const now = nowS();
    if (!r.alive) {
      if (now >= r.respawnAt) this.spawnBot(r.id);
      return;
    }
    if (r.shield && now >= r.respawnAt) r.shield = false;
    r.think -= dt;
    if (r.think <= 0) {
      r.think = 0.18 + Math.random() * 0.2;
      // Nearest orb, unless a wall or another body is close ahead.
      let bx = 0;
      let bz = 0;
      let bd = 1e9;
      for (const f of this.field.slots) {
        const d = Math.hypot(f.x - r.hx, f.z - r.hz);
        if (d < bd) {
          bd = d;
          bx = f.x;
          bz = f.z;
        }
      }
      for (const c of this.field.corpses.values()) {
        const d = Math.hypot(c.x - r.hx, c.z - r.hz) * 0.7;
        if (d < bd) {
          bd = d;
          bx = c.x;
          bz = c.z;
        }
      }
      let want = Math.atan2(bz - r.hz, bx - r.hx);
      const lx = r.hx + Math.cos(r.a) * 5;
      const lz = r.hz + Math.sin(r.a) * 5;
      if (Math.abs(lx) > HALF - 4 || Math.abs(lz) > HALF - 4) want = Math.atan2(-r.hz, -r.hx);
      else {
        for (const o of this.others(r.id)) {
          if (!o.alive) continue;
          if (hitsBody(lx, lz, r.r, o.body, o.r, o.r * 2, 0, 1.6)) {
            want = r.a + (Math.random() < 0.5 ? 1.5 : -1.5);
            break;
          }
        }
      }
      r.want = want;
    }
    r.a = steer(r.a, r.want, dt * 0.85);
    const sp = speedOf(false) * 0.92;
    r.hx += Math.cos(r.a) * sp * dt;
    r.hz += Math.sin(r.a) * sp * dt;
    r.r = radiusOf(r.mass);
    r.body.moveTo(r.hx, r.hz, r.mass);
    // Eat.
    for (let s = 0; s < FOOD_SLOTS; s++) {
      const f = this.field.slots[s];
      if (Math.abs(f.x - r.hx) < r.r + 0.7 && Math.abs(f.z - r.hz) < r.r + 0.7) {
        this.field.claim(s, f.gen);
        r.mass = Math.min(MAX_MASS, r.mass + ARENA_GROW[f.kind]);
      }
    }
    for (const [id, c] of this.field.corpses) {
      if (Math.abs(c.x - r.hx) < r.r + 0.7 && Math.abs(c.z - r.hz) < r.r + 0.7) {
        this.field.corpses.delete(id);
        r.mass = Math.min(MAX_MASS, r.mass + c.v);
      }
    }
    if (r.shield) return;
    // Die: wall, or into someone's body.
    let by: string | null = null;
    let cause = 'cut';
    if (outOfBounds(r.hx, r.hz, r.r)) cause = 'wall';
    else {
      for (const o of this.others(r.id)) {
        if (o.alive && !o.shield && hitsBody(r.hx, r.hz, r.r, o.body, o.r, o.r * 2.4, 0.4)) {
          by = o.id;
          break;
        }
      }
      if (!by && this.alive && this.shield <= 0 && hitsBody(r.hx, r.hz, r.r, this.body, radiusOf(this.mass), radiusOf(this.mass) * 2.4, 0.4)) by = this.myId;
    }
    if (cause === 'wall' || by) this.killRemote(r, by, cause === 'wall' ? 'wall' : 'cut', r.mass, corpseSpots(r.body.pts), `${r.id}.${r.life}`, r.life);
  }

  private *others(except: string) {
    for (const o of this.remotes.values()) if (o.id !== except) yield o;
  }

  // ───────────── Per-frame ─────────────

  private frame = () => {
    if (this.disposed) return;
    const t = performance.now();
    const real = Math.min(0.3, Math.max(0.001, (t - this.last) / 1000));
    this.last = t;
    const now = t / 1000;
    const dt = real;
    this.fpsN++;
    this.fpsT += real;
    if (this.fpsT >= 1) {
      this.o.cb.onPerf?.({ fps: Math.round(this.fpsN / this.fpsT) });
      this.fpsN = 0;
      this.fpsT = 0;
    }

    // Slow frames still advance real time: step the simulation in <= 50 ms slices (no slow motion, no tunnelling).
    for (let left = real, k = 0; left > 1e-4 && k < 8; k++) {
      const step = Math.min(0.05, left);
      left -= step;
      this.updateMe(step, now - left);
      for (const r of this.remotes.values()) {
        if (r.bot) this.stepBot(r, step);
        else this.updateRemote(r, now - left);
      }
    }
    // Expire corpse orbs.
    for (const [id, c] of this.field.corpses) if (now - c.born > CORPSE_LIFE) this.field.corpses.delete(id);

    // Network out.
    this.gensT += dt;
    if (this.gensT >= 4 && !this.soloBots) {
      this.gensT = 0;
      this.o.send('g', { i: this.myId, g: this.field.gens() });
    }

    this.render(dt, now);
    this.hudT += dt;
    if (this.hudT >= 0.25) {
      this.hudT = 0;
      this.pushHud(now);
    }
  };

  private groundAim(): number | null {
    if (!this.ptr.in) return null;
    this.ndc.set(this.ptr.x, this.ptr.y);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
    const dx = this.hit.x - this.x;
    const dz = this.hit.z - this.z;
    return Math.hypot(dx, dz) < 1.2 ? null : Math.atan2(dz, dx);
  }

  private updateMe(dt: number, now: number) {
    if (!this.alive) return;
    if (this.shield > 0) this.shield = Math.max(0, this.shield - dt);
    // Steering: keys turn, otherwise head for the pointer / touch aim.
    const key = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0);
    if (key) this.a = wrapAngle(this.a + key * TURN_RATE * dt);
    else {
      const want = this.aim ?? this.groundAim();
      if (want !== null) this.a = steer(this.a, want, dt * (this.boosting ? 0.8 : 1));
    }
    this.boosting = this.wantBoost && this.mass > MIN_BOOST_MASS;
    if (this.boosting) {
      this.mass = Math.max(MIN_BOOST_MASS - 1, this.mass - BOOST_COST * dt);
      if (Math.random() < dt * 30) {
        tmpC.setHex(SNAKE_COLOURS[this.colI]);
        this.sparks.emit(this.x - Math.cos(this.a) * 0.6, 0.4, this.z - Math.sin(this.a) * 0.6, (Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1.5, tmpC, 0.5, 0.22, 2);
      }
    }
    const r = radiusOf(this.mass);
    const sp = speedOf(this.boosting);
    this.x += Math.cos(this.a) * sp * dt;
    this.z += Math.sin(this.a) * sp * dt;
    this.body.moveTo(this.x, this.z, this.mass);

    // LIVE out of ammo: keep playing for free instead (a multiplayer arena cannot pause).
    if (this.live && this.o.canPay && !this.o.canPay()) {
      this.live = false;
      this.o.cb.onNeedAmmo();
    }

    // Eat orbs.
    const pr = r + 0.75;
    for (let s = 0; s < FOOD_SLOTS; s++) {
      const f = this.field.slots[s];
      if (Math.abs(f.x - this.x) < pr && Math.abs(f.z - this.z) < pr && Math.hypot(f.x - this.x, f.z - this.z) < pr) this.eatSlot(s);
    }
    for (const [id, c] of this.field.corpses) {
      if (Math.abs(c.x - this.x) < pr + 0.3 && Math.abs(c.z - this.z) < pr + 0.3 && Math.hypot(c.x - this.x, c.z - this.z) < pr + 0.3) {
        this.field.corpses.delete(id);
        this.o.send('f', { c: id, i: this.myId });
        this.mass = Math.min(MAX_MASS, this.mass + c.v);
        this.score += Math.round(c.v * 5);
        tmpC.setHex(c.col);
        this.sparks.burst(c.x, 0.5, c.z, 5, 3, tmpC, 0.5, 0.2, 5);
        sfx('coin', 0.5);
      }
    }
    if (this.shield > 0) return;

    // Die: wall.
    if (outOfBounds(this.x, this.z, r)) return this.die(null, 'wall');
    // Die: head into another snake's body (their path, interpolated; lenient). Head-on: the smaller one loses.
    for (const o of this.remotes.values()) {
      if (!o.alive || o.shield) continue;
      if (!o.bot && (!o.seen || o.quiet || now - o.buf.lastRecv > 4)) continue;
      if (hitsBody(this.x, this.z, r, o.body, o.r, o.r * 2.4, o.bot ? 0.4 : 1.7)) return this.die(o.id, 'cut');
      const hd = Math.hypot(o.hx - this.x, o.hz - this.z);
      if (hd < (r + o.r) * 0.7 && (this.mass < o.mass || (this.mass === o.mass && this.myId < o.id))) return this.die(o.id, 'cut');
    }
  }

  private eatSlot(s: number) {
    const f = this.field.slots[s];
    const g = f.gen;
    const kind = f.kind;
    const x = f.x;
    const z = f.z;
    this.field.claim(s, g);
    this.o.send('f', { s, g, i: this.myId });
    // A real chain transaction of this kind (if one is waiting) is what you ate: loot for token transfers.
    const spec = kind === 'quiet' ? null : this.o.takeTx(kind);
    if (spec?.loot) this.o.cb.onPickup(spec.loot);
    this.mass = Math.min(MAX_MASS, this.mass + ARENA_GROW[kind]);
    this.score += ARENA_POINTS[kind];
    if (this.live && this.o.pay) this.o.pay(['snake', 'bite', kind]);
    tmpC.setHex(KIND_COLOR[kind]);
    this.sparks.burst(x, 0.5, z, kind === 'quiet' ? 4 : 12, kind === 'quiet' ? 2.5 : 5, tmpC, 0.5, 0.22, 5);
    if (kind !== 'quiet') {
      this.rings.fire(x, 0.06, z, tmpC, 0.4, kind === 'blast' ? 4 : 2.4, 0.6, 0.8);
      this.o.cb.onToast({ text: `${kind.toUpperCase()} +${ARENA_POINTS[kind]}`, tone: kind === 'blast' || kind === 'token' ? 'gold' : 'good' });
    }
    sfx(kind === 'token' || kind === 'blast' ? 'token' : 'coin', 0.55);
  }

  private die(by: string | null, cause: string) {
    if (!this.alive) return;
    this.alive = false;
    this.boosting = false;
    this.deadAt = nowS();
    this.respawnAt = this.deadAt + 2;
    const did = `${this.myId}.${this.life}`;
    const pts = corpseSpots(this.body.pts);
    const msg = { i: this.myId, did, l: this.life, by, cause, m: Math.round(this.mass * 10) / 10, pts };
    this.o.send('d', msg);
    // Broadcast is best effort: say it again so nobody keeps a ghost of me (receivers dedupe by `did`).
    for (const ms of [450, 1300]) setTimeout(() => !this.disposed && this.o.send('d', msg), ms);
    // My own corpse orbs and feed line come from the same path everyone else uses.
    const now = nowS();
    for (const c of readCorpses(did, pts, this.mass, SNAKE_COLOURS[this.colI], now)) if (this.field.corpses.size < CORPSE_MAX) this.field.corpses.set(c.id, c);
    this.seenDeaths.add(did);
    this.burst(this.x, this.z, SNAKE_COLOURS[this.colI], 34, radiusOf(this.mass));
    this.o.cb.onFeed({ killer: this.whoOf(by), victim: this.whoOf(this.myId)!, cause, mine: 'victim' });
    this.lastBy = this.whoOf(by);
    if (by) {
      const k = this.remotes.get(by);
      if (k?.bot) k.kills++;
    }
    sfx('rekt');
    this.o.cb.onDeath({ by: this.lastBy, cause, mass: this.mass, kills: this.kills, score: this.score });
  }

  private burst(x: number, z: number, col: number, n: number, r: number) {
    tmpC.setHex(col);
    this.sparks.burst(x, 0.6, z, n, 8 + r * 3, tmpC, 1.1, 0.3, 4);
    this.rings.fire(x, 0.06, z, tmpC, 0.6, 4 + r * 3, 0.9, 1);
  }

  private updateRemote(r: Remote, now: number) {
    if (!r.here && r.quiet && now - r.buf.lastRecv > 30) {
      this.remotes.delete(r.id);
      return;
    }
    if (!r.alive || !r.seen) return;
    if (now - r.buf.lastRecv > 6) {
      r.quiet = true; // went quiet (stalled or closed tab): hide it; a pose or the roster decides what happens next
      return;
    }
    if (r.quiet) return;
    const p = r.buf.sample(now);
    if (!p) return;
    r.a = p.a;
    r.mass = p.m;
    r.boost = p.b;
    r.shield = p.s;
    r.kills = p.k;
    r.r = radiusOf(p.m);
    if (!r.body.pts.length) {
      r.hx = p.x;
      r.hz = p.z;
      r.body.reset(p.x, p.z, p.a, p.m);
    } else {
      r.hx = p.x;
      r.hz = p.z;
      r.body.moveTo(p.x, p.z, p.m);
    }
  }

  private sendPose() {
    this.o.send('p', {
      i: this.myId,
      ts: Math.round(nowS() * 1000) / 1000,
      x: Math.round(this.x * 100) / 100,
      z: Math.round(this.z * 100) / 100,
      a: Math.round(this.a * 1000) / 1000,
      m: Math.round(this.mass * 10) / 10,
      b: this.boosting ? 1 : 0,
      s: this.shield > 0 ? 1 : 0,
      l: this.life,
      k: this.kills,
    });
  }

  // ───────────── Render ─────────────

  private view(): View[] {
    const out: View[] = [];
    if (this.alive) out.push({ id: this.myId, hx: this.x, hz: this.z, a: this.a, r: radiusOf(this.mass), col: SNAKE_COLOURS[this.colI], pts: this.body.pts, boost: this.boosting, shield: this.shield > 0, me: true, mass: this.mass, r0: null });
    for (const r of this.remotes.values()) if (r.alive && r.seen && !r.quiet && r.body.pts.length) out.push({ id: r.id, hx: r.hx, hz: r.hz, a: r.a, r: r.r, col: r.col, pts: r.body.pts, boost: r.boost, shield: r.shield, me: false, mass: r.mass, r0: r });
    return out.slice(0, SNAKES);
  }

  private render(dt: number, now: number) {
    const snakes = this.view();
    let nb = 0;
    let ns = 0;
    const camFocus = snakes.find((s) => s.me) ?? snakes.slice().sort((a, b) => b.mass - a.mass)[0];
    const flick = (Math.sin(now * 28) > 0 ? 1 : 0.35) as number;
    for (const s of snakes) {
      const last = s.pts.length - 1;
      let k = Math.max(1, Math.round(Math.max(s.r * 0.8, 0.26) / 0.22));
      while (Math.floor(last / k) + 1 > MAXB - 1) k++;
      const n = Math.floor(last / k);
      tmpC.setHex(s.col);
      const br = s.boost ? 0.35 : 0;
      for (let j = 0; j <= n; j++) {
        const p = j === 0 ? { x: s.hx, z: s.hz } : s.pts[last - j * k];
        if (!p) break;
        const t = j / Math.max(1, n);
        const sc = s.r * (1 - 0.5 * Math.max(0, (t - 0.65) / 0.35));
        tmpP.set(p.x, sc * 0.95, p.z);
        tmpS.setScalar(j === 0 ? sc * 1.18 : sc);
        tmpM.compose(tmpP, tmpQ.identity(), tmpS);
        if (j === 0) {
          this.heads.setMatrixAt(ns, tmpM);
          tmpD.copy(tmpC).lerp(WHITE, 0.2 + br);
          this.heads.setColorAt(ns, s.shield ? tmpD.multiplyScalar(flick) : tmpD);
        } else {
          this.beads.setMatrixAt(nb, tmpM);
          const f = (j % 2 ? 0.74 : 1) * (s.shield ? flick : 1);
          this.beads.setColorAt(nb, tmpD.copy(tmpC).multiplyScalar(f).lerp(WHITE, br));
          nb++;
        }
      }
      // Eyes: either side of the heading.
      const cx = Math.cos(s.a);
      const cz = Math.sin(s.a);
      for (let e = 0; e < 2; e++) {
        const sd = e ? 1 : -1;
        const ex = s.hx + cx * s.r * 0.62 - cz * sd * s.r * 0.58;
        const ez = s.hz + cz * s.r * 0.62 + cx * sd * s.r * 0.58;
        tmpP.set(ex, s.r * 1.38, ez);
        tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(s.r * 0.42));
        this.eyesW.setMatrixAt(ns * 2 + e, tmpM);
        tmpP.set(ex + cx * s.r * 0.2, s.r * 1.42, ez + cz * s.r * 0.2);
        tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(s.r * 0.22));
        this.eyesP.setMatrixAt(ns * 2 + e, tmpM);
      }
      // Halo + avatar billboard.
      const halo = this.halos[ns];
      halo.visible = true;
      halo.position.set(s.hx, 0.4, s.hz);
      halo.scale.setScalar(s.r * 7 + (s.boost ? 3 : 0));
      (halo.material as THREE.SpriteMaterial).color.setHex(s.col);
      this.placeTag(s.id, s.me, s.hx, s.hz, s.r, s.col, s.r0);
      ns++;
    }
    for (let i = ns; i < SNAKES; i++) this.halos[i].visible = false;
    this.beads.count = nb;
    this.heads.count = ns;
    this.eyesW.count = ns * 2;
    this.eyesP.count = ns * 2;
    for (const m of [this.beads, this.heads, this.eyesW, this.eyesP]) m.instanceMatrix.needsUpdate = true;
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    this.pruneTags(new Set(snakes.map((s) => s.id)));

    // Orbs: seeded food slots + corpse orbs.
    let no = 0;
    for (let s = 0; s < FOOD_SLOTS; s++) {
      const f = this.field.slots[s];
      if (this.seenGen[s] !== f.gen) {
        this.seenGen[s] = f.gen;
        this.born[s] = now;
      }
      const big = f.kind === 'blast' ? 1.2 : f.kind === 'token' ? 1 : f.kind === 'quiet' ? 0.45 : 0.7;
      const grow = Math.min(1, (now - this.born[s]) * 3);
      tmpP.set(f.x, 0.55 + Math.sin(now * 2 + s) * 0.12, f.z);
      tmpQ.setFromAxisAngle(UP, now * 1.4 + s);
      tmpM.compose(tmpP, tmpQ, tmpS.setScalar(big * grow * (1 + Math.sin(now * 3 + s) * 0.06)));
      this.orbs.setMatrixAt(no, tmpM);
      this.orbs.setColorAt(no, tmpC.setHex(KIND_COLOR[f.kind]).multiplyScalar(f.kind === 'quiet' ? 1.6 : 2.2));
      no++;
    }
    for (const c of this.field.corpses.values()) {
      const age = now - c.born;
      const fade = Math.min(1, (CORPSE_LIFE - age) / 4, age * 3);
      tmpP.set(c.x, 0.5 + Math.sin(now * 3 + c.x) * 0.1, c.z);
      tmpQ.setFromAxisAngle(UP, now + c.z);
      tmpM.compose(tmpP, tmpQ, tmpS.setScalar(Math.max(0.01, (0.4 + c.v * 0.08) * fade)));
      this.orbs.setMatrixAt(no, tmpM);
      this.orbs.setColorAt(no, tmpC.setHex(c.col).multiplyScalar(2.4));
      no++;
    }
    this.orbs.count = no;
    this.orbs.instanceMatrix.needsUpdate = true;
    if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true;

    // Camera: north-up, angled, pulled back as the snake grows.
    if (camFocus) this.focus.lerp(tmpP.set(camFocus.hx, 0, camFocus.hz), damp(6, dt));
    const wantH = 17 + (camFocus?.r ?? 0.5) * 8;
    this.camH += (wantH - this.camH) * damp(2, dt);
    this.camera.position.set(this.focus.x, this.camH, this.focus.z + this.camH * 0.62);
    this.camera.lookAt(this.focus.x, 0, this.focus.z - 0.5);
    this.floorMat.uniforms.uTime.value = now;
    this.floorMat.uniforms.uHead.value.set(this.focus.x, this.focus.z);
    this.wallMat.uniforms.uTime.value = now;
    this.wallMat.uniforms.uHead.value.set(this.focus.x, this.focus.z);
    this.skyMat.uniforms.uTime.value = now;
    this.sparks.update(dt);
    this.rings.update(dt);
    this.composer?.render(dt);
    this.drawMini(snakes, dt);
  }

  private placeTag(id: string, me: boolean, hx: number, hz: number, r: number, col: number, rem: Remote | null) {
    const wire = me ? this.wire : (rem?.wire ?? {});
    const name = me ? this.name : (rem?.name ?? 'snake');
    const verified = me ? Boolean(this.verified[this.myId]) : Boolean(rem?.verified);
    const o = { handle: wire.x ?? null, name, ring: cssOf(col), verified };
    const key = tagKey(o);
    let s = this.tagMap.get(id);
    if (!s || s.userData.avatarTag?.key !== key) {
      if (s) disposeAvatarTag(s);
      s = makeAvatarTag(o, 2.4);
      this.tags.add(s);
      this.tagMap.set(id, s);
    }
    s.position.set(hx, r * 2.2 + 0.25, hz);
    fitAvatarTag(s, this.camera, 0.075, 5);
  }
  private tagMap = new Map<string, THREE.Sprite>();
  private pruneTags(live: Set<string>) {
    for (const [id, s] of this.tagMap) {
      if (!live.has(id)) {
        disposeAvatarTag(s);
        this.tagMap.delete(id);
      }
    }
  }

  private drawMini(snakes: View[], dt: number) {
    this.mapT += dt;
    const c = this.o.mini;
    if (!c || this.mapT < 0.1) return;
    this.mapT = 0;
    const g = c.getContext('2d');
    if (!g) return;
    const W = c.width;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(5,5,10,0.7)';
    g.fillRect(0, 0, W, W);
    const m = (v: number) => ((v + HALF) / SIDE) * W;
    for (const s of snakes) {
      g.fillStyle = cssOf(s.col);
      g.beginPath();
      g.arc(m(s.hx), m(s.hz), s.me ? 4 : 2.6, 0, Math.PI * 2);
      g.fill();
      if (s.me) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
  }

  private pushHud(now: number) {
    const rows: BoardEntry[] = [];
    if (this.alive || this.mass > 0) rows.push({ ...this.whoOf(this.myId)!, mass: this.alive ? this.mass : 0, kills: this.kills, me: true });
    for (const r of this.remotes.values()) if (r.alive && !r.quiet && (r.seen || r.bot)) rows.push({ ...this.whoOf(r.id)!, mass: r.mass, kills: r.kills, me: false });
    rows.sort((a, b) => b.mass - a.mass || (a.id < b.id ? -1 : 1));
    this.o.cb.onBoard(rows.slice(0, 10));
    const rank = rows.findIndex((x) => x.me) + 1;
    this.o.cb.onHud({ mass: this.mass, kills: this.kills, score: this.score, rank: this.alive ? rank : 0, total: rows.filter((x) => x.mass > 0).length, alive: this.alive, boosting: this.boosting, shield: this.shield, respawnIn: this.alive ? 0 : Math.max(0, this.respawnAt - now), online: this.roster.length || 1 });
  }

  /** Dev / test hook: what this client believes (used by the 3-client headless test). */
  debugState() {
    return {
      id: this.myId,
      handle: this.wire.x ?? null,
      me: { x: this.x, z: this.z, a: this.a, mass: this.mass, alive: this.alive, kills: this.kills, life: this.life, score: this.score },
      remotes: [...this.remotes.values()].map((r) => ({ a: r.a, body: r.body.pts.filter((_, i) => i % 6 === 0).map((q) => [q.x, q.z]), id: r.id, handle: r.wire.x ?? null, alive: r.alive && !r.quiet, seen: r.seen, mass: r.mass, x: r.hx, z: r.hz, suspect: r.buf.suspect, life: r.life, bot: r.bot, verified: r.verified })),
      tags: [...this.tagMap.values()].map((s) => String(s.userData.avatarTag?.key ?? '')),
      roster: this.roster.map((q) => `${q.x ?? q.name}=${q.id}`),
      recv: this.recv,
      gens: this.field.gens(),
      food: this.field.slots.map((f, i) => ({ i, x: f.x, z: f.z, g: f.gen })).sort((p, q) => Math.hypot(p.x - this.x, p.z - this.z) - Math.hypot(q.x - this.x, q.z - this.z))[0],
      corpses: this.field.corpses.size,
      deaths: this.seenDeaths.size,
      suspectClaims: this.suspectClaims,
    };
  }

  dispose() {
    this.disposed = true;
    if (this.sendTimer) clearInterval(this.sendTimer);
    this.renderer?.setAnimationLoop(null);
    this.detachInput();
    this.ro?.disconnect();
    for (const s of this.tagMap.values()) disposeAvatarTag(s);
    this.tagMap.clear();
    this.sparks?.dispose();
    this.rings?.dispose();
    this.composer?.dispose();
    this.glow?.dispose();
    this.env?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    if (process.env.NODE_ENV !== 'production') delete (window as unknown as { __tbArena?: unknown }).__tbArena;
  }
}

