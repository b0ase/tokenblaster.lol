/**
 * Ninja Punk Girls platformer engine. Framework-free canvas game (no React), so the same file runs
 * on ninjapunkgirls.com and tokenblaster.lol; each site wraps it with its own UI.
 *
 * - Fixed 60 Hz simulation, logical 640x360 view, 24 px tiles, levels are data (levels.ts).
 * - Controls: acceleration-based run, variable jump height, coyote time, jump buffering, wall slide
 *   + wall jump, dash (one in the air, recharged on landing / walls, cuts through enemies),
 *   shuriken throw, drop through thin platforms.
 * - Enemies (walkers, drones, spiked walkers), a boss per level, checkpoints, coins, hearts.
 * - Hooks let the host gate jumps (paid play), play sounds, show HUD/menus and drop extra pickups.
 */
import { buildMap, LEVELS, ROWS, type LevelDef } from './levels';

export const W = 640;
export const H = 360;
export const T = 24;
const STEP = 1000 / 60;

// Player physics (px / frame at 60 fps).
const RUN = 4.3;
const ACC_G = 0.7;
const ACC_A = 0.45;
const FRIC_G = 0.65;
const FRIC_A = 0.12;
const GRAV = 0.6;
const FALL_MAX = 11;
const JUMP_V = 10.4;
const JUMP_CUT = 3.5;
const COYOTE = 7;
const BUFFER = 8;
const WALL_SLIDE = 2.2;
const WALL_JUMP_X = 5.4;
const WALL_JUMP_Y = 9.8;
const WALL_LOCK = 9;
const DASH_V = 9;
const DASH_T = 10;
const DASH_CD = 22;
const MAX_HEARTS = 5;

export const HEROES = [
  { id: 'miyuki', name: 'Miyuki' },
  { id: 'scarlet', name: 'Scarlet' },
  { id: 'hikaru', name: 'Hikaru' },
  { id: 'yamarashii', name: 'Yamarashii' },
  { id: 'ichika', name: 'Ichika' },
  { id: 'asuka', name: 'Asuka' },
] as const;
export const EROBOTS = ['raven', 'phoenix', 'storm', 'viper', 'shadow', 'blaze'] as const;

export type Key = 'left' | 'right' | 'up' | 'down' | 'jump' | 'dash' | 'attack';
export type Sfx =
  | 'start' | 'jump' | 'walljump' | 'dash' | 'throw' | 'coin' | 'heart' | 'stomp' | 'kill' | 'hurt'
  | 'checkpoint' | 'boss' | 'bosshit' | 'bossdown' | 'clear' | 'gameover' | 'win' | 'token';
export type Phase = 'play' | 'clear' | 'over' | 'win';
export type Stats = {
  score: number; coins: number; kills: number; hearts: number; level: number; levels: number;
  levelName: string; secs: number; boss: { name: string; hp: number; max: number } | null;
};
/** An extra pickup the host can drop into the level (tokenblaster: live token transfers). */
export type Drop = { label: string; draw: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, t: number) => void; onGet: () => void };
export type Hooks = {
  sfx?: (s: Sfx) => void;
  /** Called before every jump / wall jump; return false to refuse it (e.g. out of paid sats). */
  canJump?: () => boolean;
  /** Called before every shuriken; return false to refuse it. */
  canThrow?: () => boolean;
  onPhase?: (p: Phase, s: Stats) => void;
  onHud?: (s: Stats) => void;
  /** Polled about once a second while playing. */
  pollDrop?: () => Drop | null;
};
export type Assets = { chars: Record<string, HTMLImageElement>; bg: Record<string, HTMLImageElement[]> };

const BG_FILES: Record<string, string[]> = {
  industrial: ['bg.png', 'far-buildings.png', 'buildings.png', 'skill-foreground.png'],
  exclusion: ['1.png', '2.png', '3.png', '4.png', '5.png'],
};

/** Load sprites + parallax layers from `${base}/chars/*.png` and `${base}/bg/<set>/*`. Missing files fall back to shapes. */
export async function loadAssets(base: string): Promise<Assets> {
  const load = (src: string) =>
    new Promise<HTMLImageElement | null>((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
  const chars: Record<string, HTMLImageElement> = {};
  const bg: Record<string, HTMLImageElement[]> = {};
  await Promise.all([
    ...[...HEROES.map((h) => h.id), ...EROBOTS].map(async (id) => {
      const img = await load(`${base}/chars/${id}.png`);
      if (img) chars[id] = img;
    }),
    ...Object.entries(BG_FILES).map(async ([set, files]) => {
      const imgs = await Promise.all(files.map((f) => load(`${base}/bg/${set}/${f}`)));
      bg[set] = imgs.filter((x): x is HTMLImageElement => !!x);
    }),
  ]);
  return { chars, bg };
}

// Tiles.
const EMPTY = 0;
const SOLID = 1;
const THIN = 2;
const SPIKE_UP = 3;
const SPIKE_DOWN = 4;

type Box = { x: number; y: number; w: number; h: number };
type Enemy = Box & { kind: 'walker' | 'flyer' | 'spiky'; vx: number; vy: number; hp: number; char: string; t: number; x0: number; y0: number; face: number; flash: number };
type Boss = Box & { vx: number; vy: number; hp: number; max: number; char: string; name: string; speed: number; state: 'wait' | 'walk' | 'leap' | 'shoot' | 'dead'; timer: number; inv: number; face: number; ground: boolean; dead: number };
type Shot = { x: number; y: number; vx: number; vy: number; life: number; foe: boolean; spin: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Popup = { x: number; y: number; t: number; text: string; color: string };
type Pick = { x: number; y: number; kind: 'coin' | 'heart'; got: boolean };
type Sign = { x: number; y: number; text: string };
type Check = { x: number; y: number; on: boolean };
type DropItem = { x: number; y: number; drop: Drop; got: boolean; t: number };

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export class NpgGame {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private frame = 0;
  private hudTick = 0;
  private keys: Record<Key, boolean> = { left: false, right: false, up: false, down: false, jump: false, dash: false, attack: false };
  private prev: Record<Key, boolean> = { ...this.keys };
  private running = false;
  phase: Phase | 'idle' = 'idle';

  // Level state.
  private li = 0;
  private def: LevelDef = LEVELS[0];
  private cols = 0;
  private tiles = new Uint8Array(0);
  private picks: Pick[] = [];
  private checks: Check[] = [];
  private signs: Sign[] = [];
  private enemies: Enemy[] = [];
  private boss: Boss | null = null;
  private arenaX = Infinity;
  private goal: Box | null = null;
  private spawn = { x: 48, y: 200 };
  private shots: Shot[] = [];
  private parts: Particle[] = [];
  private pops: Popup[] = [];
  private drops: DropItem[] = [];
  private cam = { x: 0, min: 0, max: 0, look: 0 };
  private shake = 0;
  private banner = 0;
  private clearT = 0;
  private levelFrames = 0;
  private runFrames = 0;
  private bonus = 0;

  // Player.
  private p = {
    x: 0, y: 0, w: 14, h: 30, vx: 0, vy: 0, ground: false, coyote: 0, buffer: 0, jumping: false,
    wall: 0, wallLock: 0, dashT: 0, dashCd: 0, canDash: true, face: 1, inv: 0, atkCd: 0, anim: 0, drop: 0, land: 0,
  };
  private ghosts: { x: number; y: number; face: number; life: number }[] = [];

  // Run totals.
  private score = 0;
  private coins = 0;
  private kills = 0;
  private hearts = 3;

  constructor(
    private canvas: HTMLCanvasElement,
    private assets: Assets,
    private hooks: Hooks = {},
    public hero: string = HEROES[0].id,
    private levels: LevelDef[] = LEVELS,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    canvas.width = W;
    canvas.height = H;
    this.loadLevel(0);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.running = false;
  }

  setAssets(a: Assets) {
    this.assets = a;
  }

  setHooks(h: Hooks) {
    this.hooks = h;
  }

  key(k: Key, down: boolean) {
    this.keys[k] = down;
  }

  releaseAll() {
    for (const k of Object.keys(this.keys) as Key[]) this.keys[k] = false;
  }

  /** Start a fresh run at a level (0-based). */
  start(level = 0) {
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.hearts = 3;
    this.runFrames = 0;
    this.loadLevel(level);
    this.running = true;
    this.phase = 'play';
    this.sfx('start');
    this.hooks.onPhase?.('play', this.stats());
  }

  stats(): Stats {
    const b = this.boss && this.boss.state !== 'wait' ? { name: this.boss.name, hp: Math.max(0, this.boss.hp), max: this.boss.max } : null;
    return {
      score: this.score, coins: this.coins, kills: this.kills, hearts: this.hearts, level: this.li + 1, levels: this.levels.length,
      levelName: this.def.name, secs: Math.round(this.runFrames / 6) / 10, boss: b,
    };
  }

  /** Debug / testing: jump the player to a tile column. */
  warp(col: number) {
    const x = col * T;
    let y = 0;
    for (let r = 0; r < ROWS; r++) if (this.tileAt(col, r) === SOLID) { y = r * T - this.p.h; break; }
    Object.assign(this.p, { x, y, vx: 0, vy: 0 });
  }

  private sfx(s: Sfx) {
    try {
      this.hooks.sfx?.(s);
    } catch {
      /* sound is never fatal */
    }
  }

  // ── level loading ──
  private loadLevel(i: number) {
    this.li = i;
    this.def = this.levels[i];
    const rows = buildMap(this.def);
    this.cols = rows[0].length;
    this.tiles = new Uint8Array(this.cols * ROWS);
    this.picks = [];
    this.checks = [];
    this.signs = [];
    this.enemies = [];
    this.boss = null;
    this.arenaX = Infinity;
    this.goal = null;
    this.shots = [];
    this.parts = [];
    this.pops = [];
    this.drops = [];
    this.ghosts = [];
    let sign = 0;
    let ei = 0;
    const chars = this.def.enemyChars;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = rows[r][c];
        const x = c * T;
        const y = r * T;
        const set = (v: number) => (this.tiles[r * this.cols + c] = v);
        switch (ch) {
          case '#': set(SOLID); break;
          case '=': set(THIN); break;
          case '^': set(SPIKE_UP); break;
          case 'v': set(SPIKE_DOWN); break;
          case 'o': this.picks.push({ x: x + T / 2, y: y + T / 2, kind: 'coin', got: false }); break;
          case 'h': this.picks.push({ x: x + T / 2, y: y + T / 2, kind: 'heart', got: false }); break;
          case 'C': this.checks.push({ x: x + T / 2, y: y + T, on: false }); break;
          case 'P': this.spawn = { x: x + 5, y: y + T - 30 }; break;
          case 'G': this.goal = { x, y: 0, w: T, h: ROWS * T }; break;
          case 'A': this.arenaX = x; break;
          case 'i': this.signs.push({ x: x + T / 2, y: y + T, text: this.def.signs[sign++] ?? '' }); break;
          case 'B': {
            const b = this.def.boss;
            this.boss = { x: x - 12, y: y + T - 64, w: 36, h: 64, vx: 0, vy: 0, hp: b.hp, max: b.hp, char: b.char, name: b.name, speed: b.speed, state: 'wait', timer: 0, inv: 0, face: -1, ground: false, dead: 0 };
            break;
          }
          case 'w':
          case 'k':
          case 'f': {
            const kind = ch === 'w' ? 'walker' : ch === 'k' ? 'spiky' : 'flyer';
            const char = chars[ei++ % chars.length];
            const sp = 0.8 + i * 0.15;
            this.enemies.push({ kind, x: x + 3, y: y + T - 30, w: 18, h: 30, vx: kind === 'flyer' ? 0 : -sp, vy: 0, hp: kind === 'spiky' ? 2 : 1, char, t: c * 7, x0: x, y0: y, face: -1, flash: 0 });
            break;
          }
        }
      }
    }
    this.respawnAt(this.spawn.x, this.spawn.y);
    this.cam = { x: Math.max(0, this.p.x - W * 0.4), min: 0, max: this.cols * T - W, look: 0 };
    this.banner = 150;
    this.clearT = 0;
    this.levelFrames = 0;
  }

  private respawnAt(x: number, y: number) {
    Object.assign(this.p, { x, y, vx: 0, vy: 0, ground: false, coyote: 0, buffer: 0, jumping: false, wall: 0, wallLock: 0, dashT: 0, dashCd: 0, canDash: true, drop: 0 });
  }

  // ── tiles ──
  private tileAt(c: number, r: number) {
    if (r < 0 || r >= ROWS) return EMPTY;
    if (c < 0 || c >= this.cols) return SOLID;
    return this.tiles[r * this.cols + c];
  }

  private solidAt(c: number, r: number) {
    if (this.tileAt(c, r) === SOLID) return true;
    // A living boss seals the goal gate.
    if (this.goal && this.boss && this.boss.state !== 'dead' && c === Math.floor(this.goal.x / T)) return r >= 0 && r < ROWS;
    return false;
  }

  /** Move a box horizontally against solid tiles. Returns -1/1 when it hit a wall on that side. */
  private moveX(b: Box & { vx: number }) {
    b.x += b.vx;
    const r0 = Math.floor(b.y / T);
    const r1 = Math.floor((b.y + b.h - 1) / T);
    if (b.vx > 0) {
      const c = Math.floor((b.x + b.w - 1) / T);
      for (let r = r0; r <= r1; r++) if (this.solidAt(c, r)) {
        b.x = c * T - b.w;
        b.vx = 0;
        return 1;
      }
    } else if (b.vx < 0) {
      const c = Math.floor(b.x / T);
      for (let r = r0; r <= r1; r++) if (this.solidAt(c, r)) {
        b.x = (c + 1) * T;
        b.vx = 0;
        return -1;
      }
    }
    return 0;
  }

  /** Move vertically. Returns 1 when landed, -1 when bumped a ceiling. */
  private moveY(b: Box & { vy: number }, thin = true) {
    const prevBottom = b.y + b.h;
    b.y += b.vy;
    const c0 = Math.floor(b.x / T);
    const c1 = Math.floor((b.x + b.w - 1) / T);
    if (b.vy > 0) {
      const r = Math.floor((b.y + b.h - 1) / T);
      for (let c = c0; c <= c1; c++) {
        const t = this.tileAt(c, r);
        if (this.solidAt(c, r) || (thin && t === THIN && prevBottom <= r * T + 0.01)) {
          b.y = r * T - b.h;
          b.vy = 0;
          return 1;
        }
      }
    } else if (b.vy < 0) {
      const r = Math.floor(b.y / T);
      for (let c = c0; c <= c1; c++) if (this.solidAt(c, r)) {
        b.y = (r + 1) * T;
        b.vy = 0;
        return -1;
      }
    }
    return 0;
  }

  private groundBelow(x: number, y: number) {
    const c = Math.floor(x / T);
    const r = Math.floor((y + 1) / T);
    const t = this.tileAt(c, r);
    return this.solidAt(c, r) || t === THIN;
  }

  private wallAt(side: number) {
    const p = this.p;
    const c = side > 0 ? Math.floor((p.x + p.w + 1) / T) : Math.floor((p.x - 2) / T);
    for (let y = p.y + 4; y < p.y + p.h - 4; y += 8) if (this.solidAt(c, Math.floor(y / T))) return true;
    return false;
  }

  // ── effects ──
  private burst(x: number, y: number, color: string, n = 10, speed = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed;
      const life = 20 + Math.random() * 20;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life, max: life, color, size: 2 + Math.random() * 2 });
    }
  }

  private popup(x: number, y: number, text: string, color = '#fff') {
    this.pops.push({ x, y, t: 50, text, color });
  }

  private addScore(n: number, x?: number, y?: number) {
    this.score += n;
    if (x !== undefined && y !== undefined) this.popup(x, y, `+${n}`, '#fde68a');
  }

  // ── player ──
  private tryJump() {
    if (this.hooks.canJump && !this.hooks.canJump()) {
      this.p.buffer = 0;
      return false;
    }
    return true;
  }

  private hurt(fromX?: number) {
    const p = this.p;
    if (p.inv > 0 || p.dashT > 0 || this.phase !== 'play') return;
    this.hearts--;
    p.inv = 90;
    this.shake = 10;
    const dir = fromX === undefined ? -p.face : Math.sign(p.x + p.w / 2 - fromX) || -p.face;
    p.vx = dir * 4;
    p.vy = -6;
    p.ground = false;
    this.burst(p.x + p.w / 2, p.y + p.h / 2, '#ff3e9d', 14);
    this.sfx('hurt');
    if (this.hearts <= 0) this.gameOver();
  }

  private gameOver() {
    this.phase = 'over';
    this.running = false;
    this.sfx('gameover');
    this.hooks.onPhase?.('over', this.stats());
  }

  private fellInPit() {
    this.hearts--;
    this.shake = 8;
    this.sfx('hurt');
    if (this.hearts <= 0) {
      this.gameOver();
      return;
    }
    const cp = [...this.checks].reverse().find((c) => c.on);
    if (cp) this.respawnAt(cp.x - 7, cp.y - 30);
    else this.respawnAt(this.spawn.x, this.spawn.y);
    this.p.inv = 90;
  }

  private stepPlayer() {
    const p = this.p;
    const k = this.keys;
    const pressed = (key: Key) => k[key] && !this.prev[key];
    const dir = (k.right ? 1 : 0) - (k.left ? 1 : 0);

    if (pressed('jump')) p.buffer = BUFFER;
    else if (p.buffer > 0) p.buffer--;
    if (p.inv > 0) p.inv--;
    if (p.wallLock > 0) p.wallLock--;
    if (p.dashCd > 0) p.dashCd--;
    if (p.atkCd > 0) p.atkCd--;
    if (p.drop > 0) p.drop--;
    if (p.land > 0) p.land--;

    // Dash.
    if (pressed('dash') && p.dashCd === 0 && p.dashT === 0 && (p.ground || p.canDash)) {
      p.dashT = DASH_T;
      p.dashCd = DASH_CD;
      if (!p.ground) p.canDash = false;
      if (dir) p.face = dir;
      p.vx = p.face * DASH_V;
      p.vy = 0;
      this.sfx('dash');
    }

    // Shuriken.
    if (pressed('attack') && p.atkCd === 0 && this.shots.filter((s) => !s.foe).length < 3 && (this.hooks.canThrow?.() ?? true)) {
      p.atkCd = 14;
      this.shots.push({ x: p.x + p.w / 2 + p.face * 8, y: p.y + 12, vx: p.face * 8.5 + p.vx * 0.3, vy: 0, life: 50, foe: false, spin: 0 });
      this.sfx('throw');
    }

    if (p.dashT > 0) {
      p.dashT--;
      p.vy = 0;
      if (this.frame % 2 === 0) this.ghosts.push({ x: p.x, y: p.y, face: p.face, life: 14 });
      if (this.moveX(p)) p.dashT = 0;
      if (p.dashT === 0) p.vx = p.face * RUN;
    } else {
      // Run.
      if (p.wallLock === 0) {
        if (dir) {
          const acc = p.ground ? ACC_G : ACC_A;
          const target = dir * RUN;
          if (Math.abs(p.vx) > RUN && Math.sign(p.vx) === dir) p.vx -= Math.sign(p.vx) * FRIC_A; // ease out of dash speed
          else p.vx += Math.max(-acc, Math.min(acc, target - p.vx));
          p.face = dir;
        } else {
          const f = p.ground ? FRIC_G : FRIC_A;
          p.vx -= Math.sign(p.vx) * Math.min(Math.abs(p.vx), f);
        }
      }

      // Jumps (buffered, with coyote time and wall jumps).
      if (p.buffer > 0) {
        if (k.down && p.ground && this.onThin()) {
          p.buffer = 0;
          p.drop = 10;
          p.y += 2;
          p.ground = false;
        } else if (p.ground || p.coyote > 0) {
          if (this.tryJump()) {
            p.vy = -JUMP_V;
            p.ground = false;
            p.coyote = 0;
            p.buffer = 0;
            p.jumping = true;
            this.sfx('jump');
            this.burst(p.x + p.w / 2, p.y + p.h, 'rgba(255,255,255,0.6)', 5, 1.5);
          }
        } else if (p.wall !== 0) {
          if (this.tryJump()) {
            p.vx = -p.wall * WALL_JUMP_X;
            p.vy = -WALL_JUMP_Y;
            p.face = -p.wall;
            p.wallLock = WALL_LOCK;
            p.buffer = 0;
            p.jumping = true;
            p.canDash = true;
            this.sfx('walljump');
            this.burst(p.wall > 0 ? p.x + p.w : p.x, p.y + p.h / 2, 'rgba(255,255,255,0.7)', 6, 2);
          }
        }
      }

      // Variable height: let go early, fall early.
      if (p.jumping && !k.jump && p.vy < -JUMP_CUT) p.vy = -JUMP_CUT;
      p.vy = Math.min(FALL_MAX, p.vy + GRAV);
      // Wall slide while pushing into a wall.
      if (!p.ground && p.wall !== 0 && p.vy > WALL_SLIDE && dir === p.wall) {
        p.vy = WALL_SLIDE;
        if (this.frame % 5 === 0) this.burst(p.wall > 0 ? p.x + p.w : p.x, p.y + 6, 'rgba(255,255,255,0.4)', 1, 0.5);
      }
      this.moveX(p);
    }

    const wasGround = p.ground;
    const fallV = p.vy;
    const hitY = this.moveY(p, p.drop === 0);
    if (hitY === 1) {
      p.ground = true;
      p.jumping = false;
      p.coyote = COYOTE;
      p.canDash = true;
      if (!wasGround && fallV > 6) {
        p.land = 8;
        this.burst(p.x + p.w / 2, p.y + p.h, 'rgba(255,255,255,0.5)', 6, 1.5);
      }
    } else {
      if (p.ground) p.coyote = COYOTE; // walked off a ledge
      p.ground = false;
      if (p.coyote > 0 && p.dashT === 0) p.coyote--;
      if (hitY === -1) p.jumping = false;
    }
    // Stay grounded when standing still (moveY needs downward motion to detect the floor).
    if (!p.ground && p.vy === 0 && this.groundBelow(p.x + 1, p.y + p.h) && this.groundBelow(p.x + p.w - 1, p.y + p.h)) p.ground = true;

    p.wall = p.ground ? 0 : this.wallAt(1) ? 1 : this.wallAt(-1) ? -1 : 0;
    if (p.wall !== 0 && !p.ground) p.canDash = true;

    // Spikes.
    const c0 = Math.floor(p.x / T);
    const c1 = Math.floor((p.x + p.w - 1) / T);
    const r0 = Math.floor(p.y / T);
    const r1 = Math.floor((p.y + p.h - 1) / T);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const t = this.tileAt(c, r);
        if (t === SPIKE_UP && p.y + p.h > r * T + 10) {
          this.hurt();
          if (p.inv === 90) p.vy = -9;
        } else if (t === SPIKE_DOWN && p.y < (r + 1) * T - 10) {
          this.hurt();
          if (p.inv === 90) p.vy = 3;
        }
      }

    if (p.y > ROWS * T + 40) this.fellInPit();
    p.anim += p.ground ? Math.abs(p.vx) * 0.12 : 0.1;
  }

  private onThin() {
    const p = this.p;
    const r = Math.floor((p.y + p.h + 1) / T);
    return this.tileAt(Math.floor((p.x + p.w / 2) / T), r) === THIN;
  }

  // ── enemies & boss ──
  private kill(e: Enemy, how: string) {
    e.hp = 0;
    this.kills++;
    this.addScore(50, e.x + e.w / 2, e.y - 6);
    this.burst(e.x + e.w / 2, e.y + e.h / 2, '#a78bfa', 16, 3.5);
    this.sfx(how === 'stomp' ? 'stomp' : 'kill');
  }

  private stepEnemies() {
    const p = this.p;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (e.x > this.cam.x + W + 120 || e.x < this.cam.x - 200) continue; // asleep off-screen
      e.t++;
      if (e.flash > 0) e.flash--;
      if (e.kind === 'flyer') {
        const nx = e.x0 + Math.sin(e.t * 0.02) * 64;
        e.face = nx > e.x ? 1 : -1;
        e.x = nx;
        e.y = e.y0 + Math.sin(e.t * 0.05) * 18;
      } else {
        e.vy = Math.min(FALL_MAX, e.vy + GRAV);
        const side = this.moveX(e);
        if (side) e.vx = -side * (0.8 + this.li * 0.15);
        const landed = this.moveY(e) === 1 || this.groundBelow(e.x + e.w / 2, e.y + e.h);
        // Turn at ledges.
        if (landed) {
          const front = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
          if (!this.groundBelow(front, e.y + e.h)) e.vx = -e.vx;
        }
        if (e.vx === 0) e.vx = 0.8 + this.li * 0.15;
        e.face = Math.sign(e.vx);
        if (e.y > ROWS * T + 40) e.hp = 0;
      }
      if (e.hp > 0 && overlap(p, e) && this.phase === 'play') {
        if (p.dashT > 0) this.kill(e, 'dash');
        else if (e.kind !== 'spiky' && p.vy > 0 && p.y + p.h - p.vy <= e.y + 10) {
          this.kill(e, 'stomp');
          p.vy = this.keys.jump ? -JUMP_V : -7;
          p.jumping = this.keys.jump;
          p.canDash = true;
        } else this.hurt(e.x + e.w / 2);
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  private hitBoss(b: Boss, inv: number) {
    if (b.inv > 0 || b.state === 'dead' || b.state === 'wait') return false;
    b.hp--;
    b.inv = inv;
    this.shake = 6;
    this.burst(b.x + b.w / 2, b.y + b.h / 3, '#fde68a', 12, 3);
    this.addScore(25, b.x + b.w / 2, b.y - 8);
    this.sfx('bosshit');
    if (b.hp <= 0) {
      b.state = 'dead';
      b.dead = 90;
      b.vx = 0;
      this.addScore(1000, b.x + b.w / 2, b.y - 24);
      this.kills++;
      this.shake = 24;
      this.burst(b.x + b.w / 2, b.y + b.h / 2, '#ff3e9d', 50, 6);
      this.burst(b.x + b.w / 2, b.y + b.h / 2, '#fde68a', 30, 4);
      this.sfx('bossdown');
      this.cam.min = 0;
      this.cam.max = this.cols * T - W;
    }
    return true;
  }

  private stepBoss() {
    const b = this.boss;
    if (!b) return;
    const p = this.p;
    if (b.state === 'wait') {
      if (p.x > this.arenaX) {
        b.state = 'walk';
        b.timer = 60;
        this.cam.min = this.arenaX - T;
        this.cam.max = this.cols * T - W;
        this.sfx('boss');
        this.banner = 0;
        this.popup(b.x + b.w / 2, b.y - 20, b.name, '#ff3e9d');
      }
      return;
    }
    if (b.state === 'dead') {
      if (b.dead > 0) {
        b.dead--;
        if (b.dead % 6 === 0) this.burst(b.x + Math.random() * b.w, b.y + Math.random() * b.h, '#f97316', 6, 2);
      }
      return;
    }
    if (b.inv > 0) b.inv--;
    const rage = b.hp <= b.max / 2 ? 1.35 : 1;
    const toP = Math.sign(p.x + p.w / 2 - (b.x + b.w / 2)) || 1;
    b.timer--;
    switch (b.state) {
      case 'walk':
        b.face = toP;
        b.vx = toP * b.speed * rage;
        if (b.timer <= 0) {
          const roll = Math.random();
          b.state = roll < 0.5 ? 'leap' : 'shoot';
          b.timer = b.state === 'leap' ? 90 : 70;
          if (b.state === 'leap' && b.ground) {
            b.vy = -12.5;
            b.vx = toP * (2.6 + Math.random()) * rage;
            b.ground = false;
          }
        }
        break;
      case 'leap':
        if (b.ground && b.timer < 80) {
          this.shake = 8;
          this.burst(b.x + b.w / 2, b.y + b.h, '#f97316', 14, 3);
          // Shockwave orbs along the floor.
          for (const d of [-1, 1]) this.shots.push({ x: b.x + b.w / 2, y: b.y + b.h - 8, vx: d * 4 * rage, vy: 0, life: 90, foe: true, spin: 0 });
          b.state = 'walk';
          b.timer = 70 + Math.random() * 40;
        }
        break;
      case 'shoot':
        b.vx *= 0.85;
        b.face = toP;
        if ([55, 40, 25].includes(b.timer) || (rage > 1 && b.timer === 10)) {
          const sx = b.x + b.w / 2 + b.face * 14;
          const sy = b.y + 20;
          const dx = p.x + p.w / 2 - sx;
          const dy = p.y + p.h / 2 - sy;
          const d = Math.hypot(dx, dy) || 1;
          const sp = 4.2 * rage;
          this.shots.push({ x: sx, y: sy, vx: (dx / d) * sp, vy: (dy / d) * sp, life: 140, foe: true, spin: 0 });
          this.sfx('throw');
        }
        if (b.timer <= 0) {
          b.state = 'walk';
          b.timer = 80 + Math.random() * 40;
        }
        break;
    }
    b.vy = Math.min(FALL_MAX, b.vy + GRAV);
    this.moveX(b);
    const landed = this.moveY(b) === 1;
    b.ground = landed || (b.vy === 0 && this.groundBelow(b.x + b.w / 2, b.y + b.h));
    // Never leave the arena.
    if (b.x < this.arenaX) b.x = this.arenaX;

    if (overlap(p, b) && this.phase === 'play') {
      if (p.dashT > 0) {
        if (this.hitBoss(b, 40)) {
          p.dashT = 0;
          p.vx = -p.face * 5;
          p.vy = -6;
        }
      } else if (p.vy > 0 && p.y + p.h - p.vy <= b.y + 14) {
        this.hitBoss(b, 40);
        p.vy = this.keys.jump ? -JUMP_V : -8;
        p.jumping = this.keys.jump;
        p.canDash = true;
      } else this.hurt(b.x + b.w / 2);
    }
  }

  private stepShots() {
    const p = this.p;
    for (const s of this.shots) {
      s.x += s.vx;
      s.y += s.vy;
      s.life--;
      s.spin += 0.4;
      const c = Math.floor(s.x / T);
      const r = Math.floor(s.y / T);
      if (this.solidAt(c, r) && !(s.foe && s.vy === 0)) {
        s.life = 0;
        this.burst(s.x, s.y, s.foe ? '#ff3e9d' : '#e2e8f0', 4, 1.5);
        continue;
      }
      const box = { x: s.x - 6, y: s.y - 6, w: 12, h: 12 };
      if (s.foe) {
        if (overlap(p, box) && p.inv === 0 && p.dashT === 0) {
          s.life = 0;
          this.hurt(s.x);
        }
        continue;
      }
      for (const e of this.enemies) {
        if (e.hp > 0 && overlap(e, box)) {
          s.life = 0;
          e.hp--;
          e.flash = 8;
          if (e.hp <= 0) {
            e.hp = 1;
            this.kill(e, 'shot');
          } else this.sfx('stomp');
          break;
        }
      }
      if (s.life > 0 && this.boss && overlap(this.boss, box) && this.boss.state !== 'dead' && this.boss.state !== 'wait') {
        if (this.hitBoss(this.boss, 20)) s.life = 0;
      }
    }
    this.shots = this.shots.filter((s) => s.life > 0 && s.x > this.cam.x - 60 && s.x < this.cam.x + W + 60);
  }

  private stepPickups() {
    const p = this.p;
    const pc = { x: p.x - 4, y: p.y - 4, w: p.w + 8, h: p.h + 8 };
    for (const k of this.picks) {
      if (k.got) continue;
      if (overlap(pc, { x: k.x - 8, y: k.y - 8, w: 16, h: 16 })) {
        k.got = true;
        if (k.kind === 'coin') {
          this.coins++;
          this.addScore(10);
          this.burst(k.x, k.y, '#fbbf24', 6, 2);
          this.sfx('coin');
        } else {
          this.hearts = Math.min(MAX_HEARTS, this.hearts + 1);
          this.popup(k.x, k.y - 10, '+♥', '#ff3e9d');
          this.sfx('heart');
        }
      }
    }
    for (const c of this.checks) {
      if (!c.on && p.x + p.w / 2 >= c.x) {
        c.on = true;
        this.popup(c.x, c.y - 50, 'CHECKPOINT', '#38bdf8');
        this.burst(c.x, c.y - 36, '#38bdf8', 14, 2.5);
        this.sfx('checkpoint');
      }
    }
    for (const d of this.drops) {
      if (d.got) continue;
      d.t++;
      if (overlap(pc, { x: d.x - 11, y: d.y - 11, w: 22, h: 22 })) {
        d.got = true;
        this.addScore(100, d.x, d.y - 14);
        this.popup(d.x, d.y - 28, `+1 ${d.drop.label}`, '#a7f3d0');
        this.burst(d.x, d.y, '#34d399', 12, 2.5);
        this.sfx('token');
        try {
          d.drop.onGet();
        } catch {
          /* host side */
        }
      }
    }
    this.drops = this.drops.filter((d) => !d.got && d.x > this.cam.x - 100);
    // Ask the host for extra drops about once a second; place them just ahead, above the ground.
    if (this.hooks.pollDrop && this.frame % 60 === 0 && this.drops.length < 4) {
      const drop = this.hooks.pollDrop();
      if (drop) {
        const x = Math.min(this.cols * T - 2 * T, this.cam.x + W + 20 + Math.random() * 80);
        const c = Math.floor(x / T);
        let y = ROWS * T - 3 * T;
        for (let r = 1; r < ROWS; r++) if (this.solidAt(c, r) || this.tileAt(c, r) === THIN) { y = r * T - 40; break; }
        if (x > this.p.x + 100) this.drops.push({ x, y: Math.max(40, y), drop, got: false, t: 0 });
      }
    }
  }

  private stepGoal() {
    const g = this.goal;
    if (!g || this.phase !== 'play') return;
    if ((!this.boss || this.boss.state === 'dead') && this.p.x + this.p.w >= g.x + 4) {
      const secs = this.levelFrames / 60;
      this.bonus = 500 + Math.max(0, Math.round((180 - secs) * 5)) + this.hearts * 100;
      this.addScore(this.bonus);
      this.phase = 'clear';
      this.clearT = 170;
      this.p.vx = 0;
      const last = this.li >= this.levels.length - 1;
      this.sfx(last ? 'win' : 'clear');
      this.burst(g.x + T / 2, H / 2, '#fde68a', 40, 5);
      if (last) {
        this.phase = 'win';
        this.running = false;
        this.hooks.onPhase?.('win', this.stats());
      } else this.hooks.onPhase?.('clear', this.stats());
    }
  }

  private step() {
    this.frame++;
    if (this.phase === 'clear') {
      if (--this.clearT <= 0) {
        this.loadLevel(this.li + 1);
        this.hearts = Math.max(3, this.hearts);
        this.phase = 'play';
        this.hooks.onPhase?.('play', this.stats());
      }
      this.stepFx();
      return;
    }
    if (this.phase === 'play') {
      this.levelFrames++;
      this.runFrames++;
      this.stepPlayer();
      if (this.phase === 'play') {
        this.stepEnemies();
        this.stepBoss();
        this.stepShots();
        this.stepPickups();
        this.stepGoal();
      }
    }
    this.stepFx();
    this.prev = { ...this.keys };

    // Camera: lead in the facing direction, clamp to level / boss arena.
    const p = this.p;
    this.cam.look += (p.face * 60 - this.cam.look) * 0.04;
    const target = p.x + p.w / 2 - W * 0.42 + this.cam.look;
    this.cam.x += (target - this.cam.x) * 0.14;
    this.cam.x = Math.max(this.cam.min, Math.min(this.cam.max, this.cam.x));
    if (this.p.x < this.cam.min) this.p.x = this.cam.min; // walls of the boss arena
  }

  private stepFx() {
    for (const q of this.parts) {
      q.x += q.vx;
      q.y += q.vy;
      q.vy += 0.12;
      q.life--;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
    for (const g of this.ghosts) g.life--;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
    for (const q of this.pops) q.t--;
    this.pops = this.pops.filter((q) => q.t > 0);
    if (this.shake > 0) this.shake--;
    if (this.banner > 0) this.banner--;
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.last) this.last = now;
    this.acc += Math.min(100, now - this.last);
    this.last = now;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.phase === 'play' || this.phase === 'clear') this.step();
      else {
        this.frame++;
        this.stepFx();
        this.prev = { ...this.keys };
      }
    }
    this.draw(now);
    if (++this.hudTick % 6 === 0 && this.running) this.hooks.onHud?.(this.stats());
  };

  // ── drawing ──
  private drawSprite(id: string, cx: number, bottom: number, h: number, face: number, alpha = 1, tint?: string) {
    const ctx = this.ctx;
    const img = this.assets.chars[id];
    ctx.save();
    ctx.globalAlpha = alpha;
    if (img && img.naturalWidth) {
      const w = (h * img.naturalWidth) / img.naturalHeight;
      ctx.translate(Math.round(cx), Math.round(bottom));
      if (face < 0) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h, w, h);
      if (tint) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = tint;
        ctx.fillRect(-w / 2, -h, w, h);
      }
    } else {
      ctx.fillStyle = tint ?? '#ff3e9d';
      ctx.fillRect(cx - h * 0.2, bottom - h, h * 0.4, h);
    }
    ctx.restore();
  }

  private drawBg(t: number) {
    const ctx = this.ctx;
    const cx = this.cam.x;
    const tile = (img: HTMLImageElement, par: number, scale: number, y: number) => {
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      let x0 = -((cx * par) % w);
      if (x0 > 0) x0 -= w;
      for (let x = x0; x < W; x += w) ctx.drawImage(img, Math.floor(x), Math.floor(y), Math.ceil(w) + 1, h);
    };
    const set = this.def.bg;
    const imgs = this.assets.bg[set] ?? [];
    if (set === 'industrial' && imgs.length >= 3) {
      const s = H / imgs[0].naturalHeight;
      tile(imgs[0], 0.05, s, 0);
      tile(imgs[1], 0.18, s, H - imgs[1].naturalHeight * s);
      tile(imgs[2], 0.35, s, H - imgs[2].naturalHeight * s);
      ctx.fillStyle = 'rgba(30,10,50,0.35)';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    if (set === 'exclusion' && imgs.length >= 3) {
      const s = H / imgs[0].naturalHeight;
      imgs.forEach((img, i) => tile(img, 0.04 + i * 0.12, s, 0));
      ctx.fillStyle = 'rgba(10,15,40,0.3)';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    // Foundry (procedural): molten sky, smokestacks, neon windows.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (set === 'foundry') {
      g.addColorStop(0, '#12040a');
      g.addColorStop(0.6, '#3b0a12');
      g.addColorStop(1, '#7c2d12');
    } else {
      g.addColorStop(0, '#0b0620');
      g.addColorStop(1, '#2a0f45');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(251,146,60,0.18)';
    ctx.beginPath();
    ctx.arc(W * 0.75 - ((cx * 0.02) % W), 90, 48, 0, Math.PI * 2);
    ctx.fill();
    for (const [par, col, hMin, step] of [
      [0.15, '#1a0508', 120, 70],
      [0.35, '#240a0c', 70, 96],
    ] as const) {
      const off = (cx * par) % step;
      for (let i = -1; i < W / step + 2; i++) {
        const wx = i * step - off;
        const seed = Math.floor((cx * par) / step) + i;
        const bh = hMin + ((seed * 47) % 90 + 90) % 90;
        ctx.fillStyle = col;
        ctx.fillRect(wx, H - bh, step - 14, bh);
        if (par > 0.2 && seed % 3 === 0) {
          ctx.fillRect(wx + 10, H - bh - 50, 12, 50);
          ctx.fillStyle = `rgba(249,115,22,${0.25 + 0.15 * Math.sin(t / 300 + i)})`;
          ctx.fillRect(wx + 10, H - bh - 54, 12, 4);
        }
        ctx.fillStyle = 'rgba(253,186,116,0.25)';
        for (let y = H - bh + 10; y < H - 10; y += 18) if ((seed + y) % 3 === 0) ctx.fillRect(wx + 8, y, 6, 6);
      }
    }
  }

  private drawTiles(t: number) {
    const ctx = this.ctx;
    const pal = this.def.palette;
    const c0 = Math.max(0, Math.floor(this.cam.x / T) - 1);
    const c1 = Math.min(this.cols - 1, Math.ceil((this.cam.x + W) / T) + 1);
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const tt = this.tiles[r * this.cols + c];
        if (!tt) continue;
        const x = c * T - Math.round(this.cam.x);
        const y = r * T;
        if (tt === SOLID) {
          ctx.fillStyle = pal.tile;
          ctx.fillRect(x, y, T, T);
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(x + ((r % 2) * T) / 2, y + 2, 1, T - 4);
          ctx.fillRect(x, y + T - 1, T, 1);
          if (this.tileAt(c, r - 1) !== SOLID) {
            ctx.fillStyle = pal.glow;
            ctx.fillRect(x, y, T, 6);
            ctx.fillStyle = pal.edge;
            ctx.fillRect(x, y, T, 2);
          }
          if (this.tileAt(c - 1, r) !== SOLID && c > 0) {
            ctx.fillStyle = pal.glow;
            ctx.fillRect(x, y, 2, T);
          }
          if (this.tileAt(c + 1, r) !== SOLID && c < this.cols - 1) {
            ctx.fillStyle = pal.glow;
            ctx.fillRect(x + T - 2, y, 2, T);
          }
        } else if (tt === THIN) {
          ctx.fillStyle = pal.tile;
          ctx.fillRect(x, y, T, 7);
          ctx.fillStyle = pal.edge;
          ctx.fillRect(x, y, T, 2);
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(x + 4, y + 7, 2, 5);
          ctx.fillRect(x + T - 6, y + 7, 2, 5);
        } else if (tt === SPIKE_UP || tt === SPIKE_DOWN) {
          ctx.fillStyle = pal.spike;
          const up = tt === SPIKE_UP;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            const sx = x + i * 8;
            if (up) {
              ctx.moveTo(sx, y + T);
              ctx.lineTo(sx + 4, y + 8 + Math.sin(t / 400 + c) * 1);
              ctx.lineTo(sx + 8, y + T);
            } else {
              ctx.moveTo(sx, y);
              ctx.lineTo(sx + 4, y + T - 8);
              ctx.lineTo(sx + 8, y);
            }
            ctx.fill();
          }
          ctx.fillStyle = pal.glow;
          ctx.fillRect(x, up ? y + T - 3 : y, T, 3);
        }
      }
    }
  }

  private drawWorld(t: number) {
    const ctx = this.ctx;
    const cx = Math.round(this.cam.x);
    const vis = (x: number, m = 60) => x > cx - m && x < cx + W + m;

    // Signs.
    ctx.font = 'bold 10px monospace';
    for (const s of this.signs) {
      if (!vis(s.x)) continue;
      const x = s.x - cx;
      ctx.fillStyle = '#3f2a1d';
      ctx.fillRect(x - 2, s.y - 22, 4, 22);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 10, s.y - 34, 20, 14);
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.fillText('?', x, s.y - 23);
    }
    // Checkpoint lanterns.
    for (const c of this.checks) {
      if (!vis(c.x)) continue;
      const x = c.x - cx;
      ctx.fillStyle = '#334155';
      ctx.fillRect(x - 2, c.y - 44, 4, 44);
      ctx.fillStyle = c.on ? '#38bdf8' : '#64748b';
      if (c.on) {
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14;
      }
      ctx.fillRect(x - 7, c.y - 56, 14, 14);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x - 7, c.y - 50, 14, 2);
    }
    // Goal: a torii gate, sealed while the boss lives.
    if (this.goal && vis(this.goal.x, 120)) {
      const gx = this.goal.x - cx + T / 2;
      const floor = (() => {
        const c = Math.floor(this.goal.x / T);
        for (let r = 0; r < ROWS; r++) if (this.tileAt(c, r) === SOLID) return r * T;
        return H;
      })();
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(gx - 34, floor - 96, 8, 96);
      ctx.fillRect(gx + 26, floor - 96, 8, 96);
      ctx.fillRect(gx - 46, floor - 104, 92, 9);
      ctx.fillRect(gx - 38, floor - 84, 76, 6);
      ctx.fillStyle = '#111';
      ctx.fillRect(gx - 50, floor - 108, 100, 4);
      if (this.boss && this.boss.state !== 'dead') {
        ctx.fillStyle = `rgba(255,62,157,${0.25 + 0.15 * Math.sin(t / 120)})`;
        ctx.fillRect(gx - 26, floor - 84, 52, 84);
      } else {
        ctx.fillStyle = `rgba(253,230,138,${0.15 + 0.1 * Math.sin(t / 200)})`;
        ctx.fillRect(gx - 26, floor - 84, 52, 84);
      }
    }
    // Coins + hearts.
    for (const k of this.picks) {
      if (k.got || !vis(k.x)) continue;
      const x = k.x - cx;
      const y = k.y + Math.sin(t / 250 + k.x) * 2;
      if (k.kind === 'coin') {
        const sx = Math.abs(Math.cos(t / 220 + k.x * 0.05));
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(1.5, 7 * sx), 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(1, 5.5 * sx), 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#ff3e9d';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('♥', x, y + 6);
      }
    }
    // Host drops (tokens).
    for (const d of this.drops) {
      if (!vis(d.x)) continue;
      const y = d.y + Math.sin(t / 220 + d.x * 0.07) * 3;
      ctx.save();
      ctx.shadowColor = '#34d399';
      ctx.shadowBlur = 12;
      ctx.translate(-cx, 0);
      try {
        d.drop.draw(ctx, d.x, y, 20, t);
      } catch {
        ctx.fillStyle = '#34d399';
        ctx.fillRect(d.x - 8, y - 8, 16, 16);
      }
      ctx.restore();
    }
    // Enemies.
    for (const e of this.enemies) {
      if (!vis(e.x)) continue;
      const x = e.x + e.w / 2 - cx;
      const bottom = e.y + e.h;
      if (e.kind === 'flyer') {
        ctx.fillStyle = `rgba(56,189,248,${0.5 + 0.3 * Math.sin(t / 50)})`;
        ctx.beginPath();
        ctx.ellipse(x, bottom + 4, 8, 3 + Math.random() * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (e.kind === 'spiky') {
        ctx.fillStyle = '#ef4444';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 6 - 4, e.y + 4);
          ctx.lineTo(x + i * 6, e.y - 8);
          ctx.lineTo(x + i * 6 + 4, e.y + 4);
          ctx.fill();
        }
      }
      this.drawSprite(e.char, x, bottom + 2, 40, e.face, 1, e.flash > 0 ? 'rgba(255,255,255,0.8)' : e.kind === 'spiky' ? 'rgba(239,68,68,0.25)' : undefined);
    }
    // Boss.
    const b = this.boss;
    if (b && vis(b.x, 200) && !(b.state === 'dead' && b.dead <= 0)) {
      const x = b.x + b.w / 2 - cx;
      const alpha = b.state === 'dead' ? b.dead / 90 : 1;
      if (b.state !== 'wait') {
        ctx.fillStyle = 'rgba(255,62,157,0.25)';
        ctx.beginPath();
        ctx.ellipse(x, b.y + b.h, 30, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const flash = b.inv > 0 && Math.floor(t / 60) % 2 === 0;
      this.drawSprite(b.char, x, b.y + b.h + 4, 92, b.face, alpha, flash ? 'rgba(255,255,255,0.7)' : b.hp <= b.max / 2 && b.state !== 'dead' ? 'rgba(239,68,68,0.2)' : undefined);
    }
    // Shots.
    for (const s of this.shots) {
      const x = s.x - cx;
      if (s.foe) {
        ctx.fillStyle = '#ff3e9d';
        ctx.shadowColor = '#ff3e9d';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(x, s.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, s.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(x, s.y);
        ctx.rotate(s.spin);
        ctx.fillStyle = '#e2e8f0';
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(0, -2);
          ctx.lineTo(8, 0);
          ctx.lineTo(0, 2);
          ctx.fill();
        }
        ctx.fillStyle = '#334155';
        ctx.fillRect(-1.5, -1.5, 3, 3);
        ctx.restore();
      }
    }
    // Player.
    const p = this.p;
    for (const g of this.ghosts) this.drawSprite(this.hero, g.x + p.w / 2 - cx, g.y + p.h + 2, 54, g.face, g.life / 30, 'rgba(255,62,157,0.6)');
    if (this.phase !== 'over' && (p.inv === 0 || Math.floor(t / 70) % 2 === 0)) {
      const bob = p.ground && Math.abs(p.vx) > 0.5 ? Math.abs(Math.sin(p.anim)) * 2 : 0;
      const squash = p.land > 0 ? 1 - p.land * 0.02 : 1;
      this.drawSprite(this.hero, p.x + p.w / 2 - cx, p.y + p.h + 2 - bob, 54 * squash, p.face, 1, p.dashT > 0 ? 'rgba(255,62,157,0.35)' : undefined);
    }
    // Particles + popups.
    for (const q of this.parts) {
      ctx.globalAlpha = q.life / q.max;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - cx - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    for (const q of this.pops) {
      ctx.globalAlpha = Math.min(1, q.t / 20);
      ctx.fillStyle = '#000';
      ctx.fillText(q.text, q.x - cx + 1, q.y - (50 - q.t) * 0.6 + 1);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, q.x - cx, q.y - (50 - q.t) * 0.6);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud() {
    const ctx = this.ctx;
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px sans-serif';
    for (let i = 0; i < Math.max(this.hearts, 3); i++) {
      ctx.fillStyle = i < this.hearts ? '#ff3e9d' : 'rgba(255,255,255,0.2)';
      ctx.fillText('♥', 10 + i * 16, 22);
    }
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`SCORE ${this.score.toLocaleString()}`, 10, 40);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(`● ${this.coins}`, 10, 56);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`${this.li + 1}/${this.levels.length} ${this.def.name.toUpperCase()}`, W - 10, 20);
    // Nearby sign.
    const p = this.p;
    const s = this.signs.find((q) => Math.abs(q.x - (p.x + p.w / 2)) < 60 && Math.abs(q.y - (p.y + p.h)) < 80);
    if (s && s.text) {
      ctx.font = 'bold 12px monospace';
      const tw = ctx.measureText(s.text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(W / 2 - tw / 2 - 10, H - 40, tw + 20, 24);
      ctx.strokeStyle = '#facc15';
      ctx.strokeRect(W / 2 - tw / 2 - 10 + 0.5, H - 40 + 0.5, tw + 19, 23);
      ctx.fillStyle = '#facc15';
      ctx.textAlign = 'center';
      ctx.fillText(s.text, W / 2, H - 24);
    }
    // Boss bar.
    const b = this.boss;
    if (b && b.state !== 'wait' && b.state !== 'dead') {
      const bw = 220;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W / 2 - bw / 2 - 2, 30, bw + 4, 12);
      ctx.fillStyle = '#ff3e9d';
      ctx.fillRect(W / 2 - bw / 2, 32, (bw * Math.max(0, b.hp)) / b.max, 8);
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(b.name, W / 2, 26);
    }
    // Level banner.
    if (this.banner > 0 && this.phase === 'play') {
      const a = Math.min(1, this.banner / 30);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, H / 2 - 40, W, 64);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3e9d';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`STAGE ${this.li + 1}`, W / 2, H / 2 - 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(this.def.name.toUpperCase(), W / 2, H / 2 + 12);
      ctx.globalAlpha = 1;
    }
    if (this.phase === 'clear') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, H / 2 - 44, W, 76);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde68a';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('STAGE CLEAR', W / 2, H / 2 - 6);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`bonus +${this.bonus.toLocaleString()}`, W / 2, H / 2 + 18);
    }
  }

  private draw(t: number) {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake) ctx.translate((Math.random() * 2 - 1) * this.shake * 0.4, (Math.random() * 2 - 1) * this.shake * 0.3);
    ctx.imageSmoothingEnabled = true;
    this.drawBg(t);
    this.drawTiles(t);
    this.drawWorld(t);
    ctx.restore();
    if (this.phase !== 'idle') this.drawHud();
  }
}
