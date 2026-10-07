/**
 * Token Snake rules, with no rendering: a snake on an N x N grid that moves in whole-cell steps (the 3D
 * engine interpolates between steps so it looks continuous). Food is supplied by a callback (the live chain),
 * block monoliths evolve the arena, power-ups, combo multiplier, lives. Pure and deterministic given its
 * `rand`, so it is unit-tested (src/lib/snake.test.ts).
 */
import type { TxKind } from '../feed';
import type { Loot } from '../loot';

export const N = 28;
export const LIVES = 3;
export type Dir = 0 | 1 | 2 | 3; // right, down, left, up (screen space: x right, y down = world +z)
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;
export const turnLeft = (d: Dir): Dir => ((d + 3) % 4) as Dir;
export const turnRight = (d: Dir): Dir => ((d + 1) % 4) as Dir;

export type Cell = { x: number; y: number };
export type FoodKind = TxKind | 'quiet';
export type FoodSpec = { kind: FoodKind; bytes: number; sats: number; id: string; loot: Loot | null };
export type Food = FoodSpec & { uid: number; x: number; y: number; bornT: number };
export type PowerType = 'overdrive' | 'ghost' | 'magnet';
export type Power = { uid: number; type: PowerType; x: number; y: number; bornT: number };
export type Block = { uid: number; x: number; y: number; w: number; h: number; height: number; txCount: number; bornT: number; label: string };
export type DeathCause = 'wall' | 'self' | 'block';

/** Base points per bite; the combo multiplier (x1..x8) and OVERDRIVE (x2) multiply it. */
export const POINTS: Record<FoodKind, number> = { quiet: 5, payment: 10, data: 10, social: 15, inscription: 20, token: 50, blast: 100 };
export const GROW: Record<FoodKind, number> = { quiet: 1, payment: 1, data: 1, social: 1, inscription: 2, token: 3, blast: 4 };
export const POWER_SECS: Record<PowerType, number> = { overdrive: 8, ghost: 6, magnet: 10 };
export const COMBO_WINDOW = 3.4; // seconds to take the next bite before the combo drops
export const MAX_MULT = 8;
export const MAX_BLOCKS = 10;
export const FOOD_TARGET = 5;

export type SimEvent =
  | { t: 'eat'; food: Food; pts: number; mult: number; combo: number; x: number; y: number }
  | { t: 'power'; power: Power }
  | { t: 'powerEnd'; type: PowerType }
  | { t: 'die'; cause: DeathCause; livesLeft: number }
  | { t: 'respawn' }
  | { t: 'over' }
  | { t: 'block'; block: Block }
  | { t: 'blockGone'; block: Block }
  | { t: 'comboLost'; combo: number }
  | { t: 'turn'; dir: Dir }
  | { t: 'wrap' };

export type Supply = { take: () => FoodSpec | null; waiting: () => number };

export const multFor = (combo: number) => Math.min(MAX_MULT, 1 + Math.floor(combo / 4));

/** Seconds per cell: 0.16 at the start, down to 0.075 as the snake grows; OVERDRIVE is 40% faster. */
export const stepSecs = (bites: number, overdrive: boolean) => Math.max(0.075, 0.16 - bites * 0.0024) * (overdrive ? 0.62 : 1);

export class SnakeSim {
  cells: Cell[] = [];
  /** The cell the tail just left (for smooth rendering), or null when the snake grew this step. */
  lastPopped: Cell | null = null;
  dir: Dir = 0;
  turns: Dir[] = [];
  grow = 0;
  foods: Food[] = [];
  powers: Power[] = [];
  blocks: Block[] = [];
  score = 0;
  bites = 0;
  chainBites = 0;
  lives = LIVES;
  state: 'play' | 'dying' | 'over' = 'play';
  time = 0;
  acc = 0;
  /** Seconds of each effect left. `shield` is the invulnerability after a respawn. */
  fx = { overdrive: 0, ghost: 0, magnet: 0, shield: 0 };
  combo = 0;
  comboT = 0;
  dyingT = 0;
  events: SimEvent[] = [];
  steps = 0;
  private uid = 1;
  private powerT = 9;
  deathCause: DeathCause = 'wall';

  constructor(private supply: Supply, private rand: () => number = Math.random) {
    this.resetSnake();
    for (let i = 0; i < FOOD_TARGET; i++) this.addFood();
  }

  get head(): Cell {
    return this.cells[0];
  }
  get mult() {
    return multFor(this.combo) * (this.fx.overdrive > 0 ? 2 : 1);
  }
  get interval() {
    return stepSecs(this.bites, this.fx.overdrive > 0);
  }
  /** Interpolation factor 0..1 between the previous step and the next. */
  get alpha() {
    return Math.min(1, this.acc / this.interval);
  }
  get ghosting() {
    return this.fx.ghost > 0 || this.fx.shield > 0;
  }

  resetSnake() {
    const y = Math.floor(N / 2);
    this.cells = [0, 1, 2, 3, 4].map((i) => ({ x: 8 - i, y }));
    this.dir = 0;
    this.turns = [];
    this.grow = 0;
    this.lastPopped = null;
    this.acc = 0;
    this.combo = 0;
    this.comboT = 0;
    this.fx.overdrive = this.fx.ghost = this.fx.magnet = 0;
    // Nothing the player must dodge may sit in the spawn lane.
    this.blocks = this.blocks.filter((b) => !(b.y <= y + 1 && b.y + b.h > y - 1 && b.x < 16));
  }

  /** Queue a turn to an absolute direction (ignores reversing and repeats; at most 2 queued). */
  turn(d: Dir) {
    const last = this.turns.length ? this.turns[this.turns.length - 1] : this.dir;
    if (d === last || d === opposite(last) || this.turns.length >= 2) return false;
    this.turns.push(d);
    return true;
  }
  /** Relative turn (chase camera): -1 left, +1 right of the heading at the end of the queue. */
  turnRel(r: -1 | 1) {
    const last = this.turns.length ? this.turns[this.turns.length - 1] : this.dir;
    return this.turn(r < 0 ? turnLeft(last) : turnRight(last));
  }

  blockAt(x: number, y: number) {
    return this.blocks.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }
  private bodyAt(x: number, y: number, skipTail: boolean) {
    const n = skipTail ? this.cells.length - 1 : this.cells.length;
    for (let i = 0; i < n; i++) if (this.cells[i].x === x && this.cells[i].y === y) return true;
    return false;
  }
  private stuck() {
    const h = this.cells[0];
    return !!this.blockAt(h.x, h.y) || this.cells.some((c, i) => i > 0 && c.x === h.x && c.y === h.y);
  }
  private empty(x: number, y: number) {
    return !this.bodyAt(x, y, false) && !this.blockAt(x, y) && !this.foods.some((f) => f.x === x && f.y === y) && !this.powers.some((p) => p.x === x && p.y === y);
  }
  private spot(margin = 1, away = 0) {
    for (let i = 0; i < 300; i++) {
      const x = margin + Math.floor(this.rand() * (N - margin * 2));
      const y = margin + Math.floor(this.rand() * (N - margin * 2));
      if (!this.empty(x, y)) continue;
      if (away && Math.abs(x - this.head.x) + Math.abs(y - this.head.y) < away) continue;
      return { x, y };
    }
    return null;
  }

  addFood() {
    const at = this.spot(1);
    if (!at) return;
    const spec = this.supply.take() ?? { kind: 'quiet' as const, bytes: 0, sats: 0, id: 'mempool quiet', loot: null };
    this.foods.push({ ...spec, uid: this.uid++, x: at.x, y: at.y, bornT: this.time });
  }

  /** A block landed: raise a monolith (taller for fuller blocks); the oldest sinks once there are too many. */
  addBlock(height: number, txCount: number, label = `BLOCK ${height}`) {
    const big = txCount > 40_000 || (txCount === 0 && this.rand() < 0.25);
    const w = big ? 2 : 1;
    const h = big && this.rand() < 0.5 ? 2 : 1;
    for (let i = 0; i < 80; i++) {
      const at = this.spot(2, 7);
      if (!at) return null;
      // Keep the lane straight ahead of the head clear so a block never lands on top of a reaction.
      const ahead = this.dir === 0 ? at.x > this.head.x && Math.abs(at.y - this.head.y) < 2 : this.dir === 2 ? at.x < this.head.x && Math.abs(at.y - this.head.y) < 2 : this.dir === 1 ? at.y > this.head.y && Math.abs(at.x - this.head.x) < 2 : at.y < this.head.y && Math.abs(at.x - this.head.x) < 2;
      if (ahead && Math.abs(at.x - this.head.x) + Math.abs(at.y - this.head.y) < 14) continue;
      let ok = true;
      for (let dx = 0; dx < w && ok; dx++) for (let dy = 0; dy < h && ok; dy++) if (at.x + dx >= N - 1 || at.y + dy >= N - 1 || !this.empty(at.x + dx, at.y + dy)) ok = false;
      if (!ok) continue;
      const tall = 0.9 + Math.min(1.8, txCount / 60_000);
      const b: Block = { uid: this.uid++, x: at.x, y: at.y, w, h, height: tall, txCount, bornT: this.time, label };
      this.blocks.push(b);
      this.events.push({ t: 'block', block: b });
      while (this.blocks.length > MAX_BLOCKS) this.events.push({ t: 'blockGone', block: this.blocks.shift()! });
      return b;
    }
    return null;
  }

  private die(cause: DeathCause) {
    this.lives--;
    this.deathCause = cause;
    this.state = 'dying';
    this.dyingT = 1.25;
    this.events.push({ t: 'die', cause, livesLeft: this.lives });
  }

  /** One whole-cell step. */
  step() {
    this.steps++;
    if (this.turns.length) {
      this.dir = this.turns.shift()!;
      this.events.push({ t: 'turn', dir: this.dir });
    }
    let nx = this.head.x + DX[this.dir];
    let ny = this.head.y + DY[this.dir];
    const ghost = this.ghosting;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
      if (!ghost) return this.die('wall');
      nx = (nx + N) % N;
      ny = (ny + N) % N;
      this.events.push({ t: 'wrap' });
    }
    const willGrow = this.grow > 0;
    if (!ghost) {
      if (this.blockAt(nx, ny)) return this.die('block');
      if (this.bodyAt(nx, ny, !willGrow)) return this.die('self');
    }
    this.cells.unshift({ x: nx, y: ny });
    if (willGrow) {
      this.grow--;
      this.lastPopped = null;
    } else this.lastPopped = this.cells.pop()!;

    const fi = this.foods.findIndex((f) => f.x === nx && f.y === ny);
    if (fi >= 0) {
      const f = this.foods.splice(fi, 1)[0];
      this.combo++;
      this.comboT = COMBO_WINDOW;
      const mult = this.mult;
      const pts = POINTS[f.kind] * mult;
      this.score += pts;
      this.grow += GROW[f.kind];
      this.bites++;
      if (f.kind !== 'quiet') this.chainBites++;
      this.events.push({ t: 'eat', food: f, pts, mult, combo: this.combo, x: nx, y: ny });
      this.addFood();
    }
    const pi = this.powers.findIndex((p) => p.x === nx && p.y === ny);
    if (pi >= 0) {
      const p = this.powers.splice(pi, 1)[0];
      this.fx[p.type] = POWER_SECS[p.type];
      this.events.push({ t: 'power', power: p });
    }
    // Magnet: food within 6 cells slides one cell toward the head each step.
    if (this.fx.magnet > 0) {
      for (const f of this.foods) {
        const dx = this.head.x - f.x;
        const dy = this.head.y - f.y;
        if (Math.abs(dx) + Math.abs(dy) > 7 || (!dx && !dy)) continue;
        const sx = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
        const sy = sx ? 0 : Math.sign(dy);
        const tx = f.x + sx;
        const ty = f.y + sy;
        if (!this.blockAt(tx, ty) && !this.foods.some((o) => o !== f && o.x === tx && o.y === ty) && !this.bodyAt(tx, ty, false)) {
          f.x = tx;
          f.y = ty;
        }
      }
    }
    // Swap quiet filler for live transactions as they arrive.
    const qi = this.foods.findIndex((f) => f.kind === 'quiet' && this.time - f.bornT > 4);
    if (qi >= 0 && this.supply.waiting() > 0) {
      this.foods.splice(qi, 1);
      this.addFood();
    }
  }

  /** Advance the clock by dt seconds (steps as many whole cells as fit). */
  update(dt: number) {
    if (this.state === 'over') return;
    this.time += dt;
    if (this.state === 'dying') {
      this.dyingT -= dt;
      if (this.dyingT <= 0) {
        if (this.lives > 0) {
          this.resetSnake();
          const under = this.foods.filter((f) => this.bodyAt(f.x, f.y, false));
          this.foods = this.foods.filter((f) => !under.includes(f));
          for (let i = 0; i < under.length; i++) this.addFood();
          this.fx.shield = 2.2;
          this.state = 'play';
          this.events.push({ t: 'respawn' });
        } else {
          this.state = 'over';
          this.events.push({ t: 'over' });
        }
      }
      return;
    }
    // Effects and combo.
    for (const k of ['overdrive', 'ghost', 'magnet', 'shield'] as const) {
      if (this.fx[k] > 0) {
        this.fx[k] -= dt;
        if (this.fx[k] <= 0) {
          if ((k === 'ghost' || k === 'shield') && this.stuck()) this.fx[k] = 0.05; // stay phased until clear
          else {
            this.fx[k] = 0;
            if (k !== 'shield') this.events.push({ t: 'powerEnd', type: k });
          }
        }
      }
    }
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.events.push({ t: 'comboLost', combo: this.combo });
        this.combo = 0;
      }
    }
    // Power-up spawns and expiry.
    this.powers = this.powers.filter((p) => this.time - p.bornT < 14);
    this.powerT -= dt;
    if (this.powerT <= 0 && this.powers.length === 0) {
      const at = this.spot(2, 6);
      if (at) {
        const types: PowerType[] = ['overdrive', 'ghost', 'magnet'];
        this.powers.push({ uid: this.uid++, type: types[Math.floor(this.rand() * 3)], x: at.x, y: at.y, bornT: this.time });
      }
      this.powerT = 13 + this.rand() * 8;
    }
    this.acc += dt;
    let guard = 0;
    while (this.acc >= this.interval && this.state === 'play' && guard++ < 6) {
      this.acc -= this.interval;
      this.step();
    }
    if (this.state !== 'play') this.acc = 0;
    if (guard >= 6) this.acc = 0;
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
