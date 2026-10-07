/**
 * Highway 21M engine: a pseudo-3D (OutRun-style) road renderer. The projection, segment and car-steering
 * approach comes from Jake Gordon's javascript-racer (MIT, copyright (c) 2012-2016 Jake Gordon and
 * contributors; see public/arcade/highway21/LICENSE), re-written here in TypeScript with our own track,
 * game rules and code-drawn art. No upstream sprites, backgrounds or music are used.
 */
import { FOG_COLOR, type Layer, type Sprite } from './art';

export const STEP = 1 / 60;
const SEGMENT = 200;
const RUMBLE = 3;
const ROAD_W = 2000;
const LANES = 3;
const CAM_H = 1000;
const FOV = 100;
const DRAW = 260;
const FOG = 5;
const CENTRIFUGAL = 0.3;
export const MAX_SPEED = SEGMENT / STEP;
const ACCEL = MAX_SPEED / 5;
const BRAKE = -MAX_SPEED;
const DECEL = -MAX_SPEED / 5;
const OFF_DECEL = -MAX_SPEED / 2;
const OFF_LIMIT = MAX_SPEED / 4;
/** Sprite sizes are in pixels; this maps a pixel to road units (an 80px car is 0.3 of the half-road). */
const SCALE = 0.3 / 80;
const CAMERA_DEPTH = 1 / Math.tan(((FOV / 2) * Math.PI) / 180);
const PLAYER_Z = CAM_H * CAMERA_DEPTH;

type Color = { road: string; grass: string; rumble: string; lane?: string };
const LIGHT: Color = { road: '#53525e', grass: '#143f3a', rumble: '#ff5a48', lane: '#e8e0d0' };
const DARK: Color = { road: '#4a4955', grass: '#103632', rumble: '#e8e0d0' };
const START: Color = { road: '#ffffff', grass: '#143f3a', rumble: '#ffffff' };
const FINISH: Color = { road: '#000000', grass: '#143f3a', rumble: '#000000' };

type Pt = { world: { y: number; z: number }; camera: { x: number; y: number; z: number }; screen: { x: number; y: number; w: number; scale: number } };
export type Car = { offset: number; z: number; sprite: Sprite; speed: number; percent: number; semi: boolean; ahead: boolean };
type Prop = { source: Sprite; offset: number };
type Seg = { index: number; p1: Pt; p2: Pt; curve: number; props: Prop[]; cars: Car[]; color: Color; looped: boolean; fog: number; clip: number };

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const limit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (v: number, max: number) => {
  let r = v;
  while (r >= max) r -= max;
  while (r < 0) r += max;
  return r;
};
const interp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeIn = (a: number, b: number, p: number) => a + (b - a) * p * p;
const easeInOut = (a: number, b: number, p: number) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const overlap = (x1: number, w1: number, x2: number, w2: number, pct = 1) => {
  const half = pct / 2;
  return !(x1 + w1 * half < x2 - w2 * half || x1 - w1 * half > x2 + w2 * half);
};

export type Art = {
  player: { straight: Sprite; left: Sprite; right: Sprite };
  cars: Sprite[];
  trucks: Sprite[];
  billboards: Sprite[];
  pines: Sprite[];
  racks: Sprite[];
  columns: Sprite[];
  crystals: Sprite[];
  sky: Layer;
  hills: Layer;
  trees: Layer;
};

export type Inputs = { left: boolean; right: boolean; gas: boolean; brake: boolean };
export type GameEvent = 'overtake' | 'checkpoint' | 'crash' | 'timeup';

export class Highway {
  segments: Seg[] = [];
  cars: Car[] = [];
  trackLength = 0;
  position = 0;
  speed = 0;
  playerX = 0;
  dist = 0;
  /** Seconds left; checkpoints add more. */
  time = 0;
  score = 0;
  overtakes = 0;
  checkpoints = 0;
  /** Seconds the run has been driven. */
  clock = 0;
  mode: 'demo' | 'play' | 'over' = 'demo';
  /** Seconds of nitro left (a short burst past top speed). */
  nitro = 0;
  private skyO = 0;
  private hillO = 0;
  private treeO = 0;
  private cpLen = 0;
  private crashCool = 0;
  private demoT = 0;
  onEvent: (e: GameEvent) => void = () => {};

  constructor(
    private art: Art,
    private width: number,
    private height: number,
  ) {
    this.buildRoad();
    this.buildProps();
    this.buildCars();
  }

  // ---------------------------------------------------------------- track
  private lastY = () => (this.segments.length ? this.segments[this.segments.length - 1].p2.world.y : 0);
  private addSegment(curve: number, y: number) {
    const n = this.segments.length;
    this.segments.push({
      index: n,
      p1: { world: { y: this.lastY(), z: n * SEGMENT }, camera: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
      p2: { world: { y, z: (n + 1) * SEGMENT }, camera: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0, scale: 0 } },
      curve,
      props: [],
      cars: [],
      color: Math.floor(n / RUMBLE) % 2 ? DARK : LIGHT,
      looped: false,
      fog: 0,
      clip: 0,
    });
  }
  private addRoad(enter: number, hold: number, leave: number, curve: number, y: number) {
    const startY = this.lastY();
    const endY = startY + y * SEGMENT;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) this.addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  }
  private buildRoad() {
    const S = 25;
    const M = 50;
    const L = 100;
    const road = (num: number, curve: number, hill: number) => this.addRoad(num, num, num, curve, hill);
    const straight = (n = M) => road(n, 0, 0);
    const rolling = () => {
      this.addRoad(S, S, S, 0, 10);
      this.addRoad(S, S, S, 0, -20);
      this.addRoad(S, S, S, 2, 10);
      this.addRoad(S, S, S, 0, -10);
      this.addRoad(S, S, S, -2, 10);
      this.addRoad(S, S, S, 0, 0);
    };
    const esses = () => {
      this.addRoad(M, M, M, -2, 0);
      this.addRoad(M, M, M, 4, 40);
      this.addRoad(M, M, M, 2, -20);
      this.addRoad(M, M, M, -2, 40);
      this.addRoad(M, M, M, -4, -40);
    };
    const bumps = () => {
      for (const y of [5, -2, -5, 8, 5, -7, 5, -2]) this.addRoad(10, 10, 10, 0, y);
    };
    // Our own lap: a long launch straight, then the mixed mountain run.
    straight(S);
    rolling();
    esses();
    road(M, 4, 20);
    bumps();
    rolling();
    road(L * 2, 4, 40);
    straight();
    road(M, 0, 60);
    esses();
    road(L, -4, 0);
    road(L, 0, 60);
    road(L, 4, -20);
    bumps();
    road(L, 0, -40);
    straight();
    esses();
    this.addRoad(200, 200, 200, -2, -this.lastY() / SEGMENT);
    this.trackLength = this.segments.length * SEGMENT;
    this.cpLen = this.trackLength / 6; // a checkpoint every ~19 s at top speed
    this.segments[this.at(PLAYER_Z).index + 2].color = START;
    this.segments[this.at(PLAYER_Z).index + 3].color = START;
    for (let n = 0; n < RUMBLE; n++) this.segments[this.segments.length - 1 - n].color = FINISH;
  }
  private addProp(n: number, source: Sprite, offset: number) {
    if (n >= 0 && n < this.segments.length) this.segments[n].props.push({ source, offset });
  }
  private buildProps() {
    const a = this.art;
    const N = this.segments.length;
    let bb = 0;
    for (let n = 30; n < N - 30; n += 70) {
      const side = bb % 2 ? 1 : -1;
      this.addProp(n, a.billboards[bb % a.billboards.length], side * 1.15);
      bb++;
    }
    this.addProp(24, a.billboards[0], -1.15);
    for (let n = 8; n < N; n += 5) {
      this.addProp(n, pick(a.pines), -1.3 - Math.random() * 3);
      if (Math.random() > 0.35) this.addProp(n + 2, pick(a.pines), 1.3 + Math.random() * 3);
    }
    for (let n = 40; n < N; n += 29) this.addProp(n, pick(a.racks), (Math.random() > 0.5 ? 1 : -1) * (1.15 + Math.random() * 0.2));
    for (let n = 300; n < N; n += 55) this.addProp(n, pick(a.columns), 1.12);
    for (let n = 12; n < N; n += 4) this.addProp(n, pick(a.crystals), (Math.random() > 0.5 ? 1 : -1) * (1.7 + Math.random() * 5));
  }
  private buildCars() {
    this.cars = [];
    for (const s of this.segments) s.cars = [];
    const total = 150;
    for (let n = 0; n < total; n++) {
      const semi = Math.random() < 0.22;
      const sprite = semi ? pick(this.art.trucks) : pick(this.art.cars);
      const offset = Math.random() * pick([-0.8, 0.8]);
      const z = (Math.floor(rand(40, this.segments.length))) * SEGMENT; // never on the grid at the start
      const speed = MAX_SPEED / 4 + Math.random() * (MAX_SPEED / (semi ? 4 : 2));
      const car: Car = { offset, z, sprite, speed, percent: 0, semi, ahead: true };
      this.at(z).cars.push(car);
      this.cars.push(car);
    }
  }
  at(z: number): Seg {
    return this.segments[Math.floor(z / SEGMENT) % this.segments.length];
  }

  // ----------------------------------------------------------------- game
  start() {
    this.position = 0;
    this.speed = 0;
    this.playerX = 0;
    this.dist = 0;
    this.time = 30;
    this.score = 0;
    this.overtakes = 0;
    this.checkpoints = 0;
    this.clock = 0;
    this.crashCool = 0;
    this.nitro = 0;
    this.buildCars();
    this.mode = 'play';
  }

  get lap() {
    return Math.floor(this.dist / this.trackLength) + 1;
  }
  /** A nitro burst can fire (playing, none running). */
  get canNitro() {
    return this.mode === 'play' && this.nitro <= 0;
  }
  /** Fire a nitro burst: 1.5 s of extra push, up to 25% past top speed. */
  boost() {
    if (this.canNitro) this.nitro = 1.5;
  }
  get kmh() {
    return Math.round((this.speed / MAX_SPEED) * 300);
  }
  /** Seconds until a checkpoint bonus runs thin: later ones give a little less. */
  private bonus() {
    return Math.max(21, 27 - this.checkpoints * 0.5);
  }

  update(dt: number, k: Inputs) {
    const playerSeg = this.at(this.position + PLAYER_Z);
    const playerW = this.art.player.straight.w * SCALE;
    const start = this.position;
    const demo = this.mode === 'demo';
    const over = this.mode === 'over';
    const input: Inputs = over ? { left: false, right: false, gas: false, brake: true } : demo ? { left: false, right: false, gas: this.speed < MAX_SPEED * 0.5, brake: false } : k;
    const pct = this.speed / MAX_SPEED;
    const dx = dt * 2 * pct;
    // Traffic first (it steers around the player).
    this.updateCars(dt, playerSeg, playerW);
    this.position = wrap(this.position + dt * this.speed, this.trackLength);
    if (!over) this.dist += dt * this.speed;
    if (input.left) this.playerX -= dx;
    else if (input.right) this.playerX += dx;
    if (demo) {
      this.demoT += dt;
      this.playerX += (Math.sin(this.demoT * 0.7) * 0.35 - this.playerX) * dt * 2;
    } else this.playerX -= dx * pct * playerSeg.curve * CENTRIFUGAL;
    this.speed += (input.gas ? ACCEL : input.brake ? BRAKE : DECEL) * dt;
    if (this.nitro > 0) {
      this.nitro = Math.max(0, this.nitro - dt);
      this.speed += ACCEL * 2 * dt;
    }

    if (this.playerX < -1 || this.playerX > 1) {
      if (this.speed > OFF_LIMIT) this.speed += OFF_DECEL * dt;
      for (const p of playerSeg.props) {
        const w = p.source.w * SCALE;
        if (overlap(this.playerX, playerW, p.offset + (w / 2) * (p.offset > 0 ? 1 : -1), w)) {
          this.speed = MAX_SPEED / 5;
          this.position = wrap(playerSeg.p1.world.z - PLAYER_Z, this.trackLength);
          this.hit();
          break;
        }
      }
    }
    for (const car of playerSeg.cars) {
      const cw = car.sprite.w * SCALE;
      if (this.speed > car.speed && overlap(this.playerX, playerW, car.offset, cw, 0.8)) {
        this.speed = car.speed * (car.speed / this.speed);
        this.position = wrap(car.z - PLAYER_Z, this.trackLength);
        this.hit();
        break;
      }
    }
    this.playerX = limit(this.playerX, -3, 3);
    this.speed = limit(this.speed, 0, this.nitro > 0 ? MAX_SPEED * 1.25 : Math.max(MAX_SPEED, this.speed - 2 * ACCEL * dt));
    const moved = (this.position - start + this.trackLength) % this.trackLength;
    this.skyO = wrap(this.skyO + 0.001 * playerSeg.curve * (moved / SEGMENT), 1);
    this.hillO = wrap(this.hillO + 0.002 * playerSeg.curve * (moved / SEGMENT), 1);
    this.treeO = wrap(this.treeO + 0.003 * playerSeg.curve * (moved / SEGMENT), 1);
    if (this.crashCool > 0) this.crashCool -= dt;

    if (this.mode === 'play') {
      this.clock += dt;
      this.time -= dt;
      this.score += pct * dt * 100;
      // Overtakes: a car that was ahead is now behind us.
      const pz = this.position + PLAYER_Z;
      for (const c of this.cars) {
        let rel = c.z - pz;
        if (rel > this.trackLength / 2) rel -= this.trackLength;
        if (rel < -this.trackLength / 2) rel += this.trackLength;
        if (rel < 0 && c.ahead && rel > -SEGMENT * 3) {
          this.overtakes++;
          this.score += 100;
          this.onEvent('overtake');
        }
        c.ahead = rel >= 0;
      }
      const cp = Math.floor(this.dist / this.cpLen);
      if (cp > this.checkpoints) {
        this.checkpoints = cp;
        this.time += this.bonus();
        this.score += 500;
        this.onEvent('checkpoint');
      }
      if (this.time <= 0) {
        this.time = 0;
        this.mode = 'over';
        this.onEvent('timeup');
      }
    }
  }

  private hit() {
    if (this.crashCool <= 0 && this.mode === 'play') {
      this.crashCool = 0.6;
      this.onEvent('crash');
    }
  }

  private updateCars(dt: number, playerSeg: Seg, playerW: number) {
    for (const car of this.cars) {
      const old = this.at(car.z);
      car.offset += this.steer(car, old, playerSeg, playerW);
      car.z = wrap(car.z + dt * car.speed, this.trackLength);
      car.percent = (car.z % SEGMENT) / SEGMENT;
      const now = this.at(car.z);
      if (old !== now) {
        old.cars.splice(old.cars.indexOf(car), 1);
        now.cars.push(car);
      }
    }
  }
  private steer(car: Car, seg: Seg, playerSeg: Seg, playerW: number): number {
    const cw = car.sprite.w * SCALE;
    if (seg.index - playerSeg.index > DRAW) return 0;
    for (let i = 1; i < 20; i++) {
      const s = this.segments[(seg.index + i) % this.segments.length];
      if (s === playerSeg && car.speed > this.speed && overlap(this.playerX, playerW, car.offset, cw, 1.2)) {
        const dir = this.playerX > 0.5 ? -1 : this.playerX < -0.5 ? 1 : car.offset > this.playerX ? 1 : -1;
        return ((dir * 1) / i) * ((car.speed - this.speed) / MAX_SPEED);
      }
      for (const o of s.cars) {
        const ow = o.sprite.w * SCALE;
        if (car.speed > o.speed && overlap(car.offset, cw, o.offset, ow, 1.2)) {
          const dir = o.offset > 0.5 ? -1 : o.offset < -0.5 ? 1 : car.offset > o.offset ? 1 : -1;
          return ((dir * 1) / i) * ((car.speed - o.speed) / MAX_SPEED);
        }
      }
    }
    if (car.offset < -0.9) return 0.1;
    if (car.offset > 0.9) return -0.1;
    return 0;
  }

  // --------------------------------------------------------------- render
  render(ctx: CanvasRenderingContext2D, steer: number) {
    const { width, height } = this;
    const base = this.at(this.position);
    const basePct = (this.position % SEGMENT) / SEGMENT;
    const pSeg = this.at(this.position + PLAYER_Z);
    const pPct = ((this.position + PLAYER_Z) % SEGMENT) / SEGMENT;
    const playerY = interp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
    let maxy = height;
    let x = 0;
    let dx = -(base.curve * basePct);
    ctx.clearRect(0, 0, width, height);
    const res = height / 480;
    this.bg(ctx, this.art.sky, this.skyO, res * 0.001 * playerY);
    this.bg(ctx, this.art.hills, this.hillO, res * 0.002 * playerY);
    this.bg(ctx, this.art.trees, this.treeO, res * 0.003 * playerY);

    for (let n = 0; n < DRAW; n++) {
      const seg = this.segments[(base.index + n) % this.segments.length];
      seg.looped = seg.index < base.index;
      seg.fog = 1 / Math.exp(((n / DRAW) * (n / DRAW)) * FOG);
      seg.clip = maxy;
      const camZ = this.position - (seg.looped ? this.trackLength : 0);
      this.project(seg.p1, this.playerX * ROAD_W - x, playerY + CAM_H, camZ);
      this.project(seg.p2, this.playerX * ROAD_W - x - dx, playerY + CAM_H, camZ);
      x += dx;
      dx += seg.curve;
      if (seg.p1.camera.z <= CAMERA_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
      this.drawSegment(ctx, seg);
      maxy = seg.p1.screen.y;
    }
    for (let n = DRAW - 1; n > 0; n--) {
      const seg = this.segments[(base.index + n) % this.segments.length];
      for (const car of seg.cars) {
        const sc = interp(seg.p1.screen.scale, seg.p2.screen.scale, car.percent);
        const sx = interp(seg.p1.screen.x, seg.p2.screen.x, car.percent) + sc * car.offset * ROAD_W * (width / 2);
        const sy = interp(seg.p1.screen.y, seg.p2.screen.y, car.percent);
        this.sprite(ctx, car.sprite, sc, sx, sy, -0.5, -1, seg.clip);
      }
      for (const p of seg.props) {
        const sc = seg.p1.screen.scale;
        const sx = seg.p1.screen.x + sc * p.offset * ROAD_W * (width / 2);
        this.sprite(ctx, p.source, sc, sx, seg.p1.screen.y, p.offset < 0 ? -1 : 0, -1, seg.clip);
      }
      if (seg === pSeg) {
        const bounce = 1.5 * Math.random() * (this.speed / MAX_SPEED) * res * (Math.random() > 0.5 ? 1 : -1);
        const spr = steer < 0 ? this.art.player.left : steer > 0 ? this.art.player.right : this.art.player.straight;
        const py = height / 2 - ((CAMERA_DEPTH / PLAYER_Z) * interp(pSeg.p1.camera.y, pSeg.p2.camera.y, pPct) * height) / 2;
        this.sprite(ctx, spr, CAMERA_DEPTH / PLAYER_Z, width / 2, py + bounce, -0.5, -1);
      }
    }
  }

  private project(p: Pt, camX: number, camY: number, camZ: number) {
    p.camera.x = 0 - camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    p.screen.scale = CAMERA_DEPTH / p.camera.z;
    p.screen.x = Math.round(this.width / 2 + (p.screen.scale * p.camera.x * this.width) / 2);
    p.screen.y = Math.round(this.height / 2 - (p.screen.scale * p.camera.y * this.height) / 2);
    p.screen.w = Math.round((p.screen.scale * ROAD_W * this.width) / 2);
  }

  private bg(ctx: CanvasRenderingContext2D, l: Layer, rotation: number, offset: number) {
    const imgW = l.w / 2;
    const sx = Math.floor(l.w * rotation);
    const sw = Math.min(imgW, l.w - sx);
    const dw = Math.floor(this.width * (sw / imgW));
    ctx.drawImage(l.c, sx, 0, sw, l.h, 0, offset, dw, this.height);
    if (sw < imgW) ctx.drawImage(l.c, 0, 0, imgW - sw, l.h, dw - 1, offset, this.width - dw, this.height);
  }

  private poly(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, c: string) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  private drawSegment(ctx: CanvasRenderingContext2D, s: Seg) {
    const { x: x1, y: y1, w: w1 } = s.p1.screen;
    const { x: x2, y: y2, w: w2 } = s.p2.screen;
    const r1 = w1 / Math.max(6, 2 * LANES);
    const r2 = w2 / Math.max(6, 2 * LANES);
    const l1 = w1 / Math.max(32, 8 * LANES);
    const l2 = w2 / Math.max(32, 8 * LANES);
    const c = s.color;
    ctx.fillStyle = c.grass;
    ctx.fillRect(0, y2, this.width, y1 - y2);
    this.poly(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, c.rumble);
    this.poly(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, c.rumble);
    this.poly(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, c.road);
    if (c.lane) {
      const lw1 = (w1 * 2) / LANES;
      const lw2 = (w2 * 2) / LANES;
      let lx1 = x1 - w1 + lw1;
      let lx2 = x2 - w2 + lw2;
      for (let lane = 1; lane < LANES; lx1 += lw1, lx2 += lw2, lane++) this.poly(ctx, lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, c.lane);
    }
    if (s.fog < 1) {
      ctx.globalAlpha = 1 - s.fog;
      ctx.fillStyle = FOG_COLOR;
      ctx.fillRect(0, y2, this.width, y1 - y2);
      ctx.globalAlpha = 1;
    }
  }

  private sprite(ctx: CanvasRenderingContext2D, s: Sprite, scale: number, dx: number, dy: number, offX: number, offY: number, clipY?: number) {
    const dw = s.w * scale * (this.width / 2) * (SCALE * ROAD_W);
    const dh = s.h * scale * (this.width / 2) * (SCALE * ROAD_W);
    const x = dx + dw * offX;
    const y = dy + dh * offY;
    const clipH = clipY ? Math.max(0, y + dh - clipY) : 0;
    if (clipH < dh && dw > 0.5) ctx.drawImage(s.c, 0, 0, s.c.width, s.c.height - (s.c.height * clipH) / dh, x, y, dw, dh - clipH);
  }
}
