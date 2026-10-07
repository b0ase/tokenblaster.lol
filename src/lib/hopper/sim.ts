/**
 * Block Hopper hero controller: pure, fixed-step, no rendering. Units are metres and seconds.
 * Tight on purpose: coyote time, jump buffering, variable jump height with a floaty apex, snappy fall,
 * wall slide + wall jump, a ground/air dash (one per air time), ledge forgiveness, springs and stomp bounces.
 */
export const P = {
  HW: 0.32, // half width
  H: 1.5, // height
  RUN: 10.5,
  ACC: 78,
  DEC: 96,
  AIR_ACC: 52,
  JUMP_V: 15.4,
  G_UP: 38,
  G_DOWN: 64,
  APEX_V: 2.4,
  APEX_G: 0.55,
  FALL_MAX: 29,
  CUT: 0.42,
  COYOTE: 0.1,
  BUFFER: 0.13,
  WALL_SLIDE: 4.2,
  WALL_KICK_X: 9.6,
  WALL_KICK_Y: 14.6,
  WALL_LOCK: 0.15,
  WALL_COYOTE: 0.09,
  DASH_V: 27,
  DASH_T: 0.17,
  DASH_CD: 0.32,
  SPRING_V: 22,
  STOMP_V: 12.5,
  STOMP_HELD_V: 16.2,
  LEDGE: 0.55,
} as const;

export type Plat = {
  id: number;
  x0: number;
  x1: number;
  top: number;
  bot: number;
  oneWay: boolean;
  solid: boolean;
  kind: string;
  label: string;
  sub: string;
  txid: string;
  bytes: number;
  color: string;
  /** Crumbling data platform: 0 idle, 1 shaking, 2 falling. */
  crumble: { state: 0 | 1 | 2; t: number } | null;
  /** Block checkpoints. */
  gate: { height: number; txCount: number; miner: string; taken: boolean } | null;
  view?: unknown;
};

export type World = { near: (x0: number, x1: number) => Plat[] };
export type SimInput = { x: number; jump: boolean; dash: boolean };
export type SimEvent = { t: 'jump' | 'land' | 'walljump' | 'dash' | 'slide' | 'bump'; v: number };

export class Hero {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  face = 1;
  ground: Plat | null = null;
  coyote = 0;
  buffer = 0;
  jumping = false;
  wall = 0;
  wallT = 0;
  lock = 0;
  dashT = 0;
  dashCd = 0;
  dashAvail = true;
  dashDir = 1;
  /** Seconds since the hero last stood on something (0 while grounded). */
  air = 0;
  private jumpWas = false;
  private dashWas = false;
  ev: SimEvent[] = [];

  place(x: number, y: number, plat: Plat | null = null) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.ground = plat;
    this.coyote = 0;
    this.buffer = 0;
    this.jumping = false;
    this.wall = 0;
    this.wallT = 0;
    this.lock = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.dashAvail = true;
    this.air = 0;
  }

  /** Launch (spring, stomp bounce): not a jump, so no variable-height cut. */
  launch(vy: number, vx?: number) {
    this.vy = vy;
    if (vx !== undefined) this.vx = vx;
    this.ground = null;
    this.jumping = false;
    this.coyote = 0;
    this.dashAvail = true;
  }

  step(dt: number, inp: SimInput, world: World): SimEvent[] {
    const ev = this.ev;
    ev.length = 0;
    const jp = inp.jump && !this.jumpWas;
    this.jumpWas = inp.jump;
    const dp = inp.dash && !this.dashWas;
    this.dashWas = inp.dash;
    this.buffer = jp ? P.BUFFER : Math.max(0, this.buffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.wallT = Math.max(0, this.wallT - dt);
    this.lock = Math.max(0, this.lock - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    const ax = this.lock > 0 ? 0 : inp.x;
    if (ax !== 0 && this.dashT <= 0) this.face = ax > 0 ? 1 : -1;

    // Dash.
    if (dp && this.dashCd <= 0 && this.dashT <= 0 && (this.ground || this.dashAvail)) {
      this.dashT = P.DASH_T;
      this.dashCd = P.DASH_CD;
      this.dashDir = ax !== 0 ? (ax > 0 ? 1 : -1) : this.face;
      this.face = this.dashDir;
      if (!this.ground) {
        this.dashAvail = false;
        this.vy = Math.min(this.vy, 9) * 0.35;
      }
      ev.push({ t: 'dash', v: this.dashDir });
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashDir * P.DASH_V;
      if (this.ground) this.vy = 0;
      if (this.dashT <= 0) this.vx = this.dashDir * P.RUN * 1.15;
    } else {
      // Horizontal.
      const target = ax * P.RUN;
      if (this.ground) {
        if (ax === 0) this.vx = approach(this.vx, 0, P.DEC * dt);
        else if (this.vx * ax < 0) this.vx = approach(this.vx, target, P.DEC * dt);
        else if (Math.abs(this.vx) > P.RUN) this.vx = approach(this.vx, target, 22 * dt);
        else this.vx = approach(this.vx, target, P.ACC * dt);
      } else if (ax !== 0) {
        if (this.vx * ax < 0 || Math.abs(this.vx) < P.RUN) this.vx = approach(this.vx, target, P.AIR_ACC * dt);
        else this.vx = approach(this.vx, target, 6 * dt);
      } else this.vx = approach(this.vx, 0, 7 * dt);

      // Gravity with a floaty apex while the button is held.
      let g = this.vy > 0 ? P.G_UP : P.G_DOWN;
      if (Math.abs(this.vy) < P.APEX_V && inp.jump && this.jumping) g *= P.APEX_G;
      this.vy = Math.max(-P.FALL_MAX, this.vy - g * dt);
      if (this.jumping && !inp.jump && this.vy > 4) {
        this.vy *= P.CUT;
        this.jumping = false;
      }
      if (this.vy <= 0) this.jumping = false;
      // Wall slide: falling, pushing into a wall.
      if (!this.ground && this.vy < 0 && this.wall !== 0 && inp.x * this.wall > 0 && this.wallT > 0) {
        if (this.vy < -P.WALL_SLIDE) this.vy = -P.WALL_SLIDE;
        ev.push({ t: 'slide', v: -this.vy });
      }
    }

    // Jumps.
    if (this.buffer > 0) {
      if (this.ground || this.coyote > 0) {
        this.vy = P.JUMP_V;
        this.jumping = true;
        this.ground = null;
        this.coyote = 0;
        this.buffer = 0;
        ev.push({ t: 'jump', v: Math.abs(this.vx) });
      } else if (this.wallT > 0 && this.wall !== 0) {
        this.vx = -this.wall * P.WALL_KICK_X;
        this.vy = P.WALL_KICK_Y;
        this.face = -this.wall;
        this.lock = P.WALL_LOCK;
        this.jumping = true;
        this.buffer = 0;
        this.dashAvail = true;
        ev.push({ t: 'walljump', v: -this.wall });
        this.wall = 0;
        this.wallT = 0;
      }
    }

    // ── Move X ──
    const wasGround = this.ground;
    if (this.wallT <= 0) this.wall = 0;
    let nx = this.x + this.vx * dt;
    const near = world.near(Math.min(this.x, nx) - P.HW - 0.5, Math.max(this.x, nx) + P.HW + 0.5);
    if (this.vx !== 0) {
      const dir = this.vx > 0 ? 1 : -1;
      for (const p of near) {
        if (!p.solid || p.oneWay) continue;
        if (this.y >= p.top - 0.001 || this.y + P.H <= p.bot) continue; // above or below it
        const edgeNow = dir > 0 ? this.x + P.HW : this.x - P.HW;
        const edgeNew = dir > 0 ? nx + P.HW : nx - P.HW;
        const wallX = dir > 0 ? p.x0 : p.x1;
        const crossing = dir > 0 ? edgeNow <= wallX + 0.001 && edgeNew > wallX : edgeNow >= wallX - 0.001 && edgeNew < wallX;
        if (!crossing) continue;
        if (p.top - this.y <= P.LEDGE && (this.vy <= 0 || this.ground)) {
          // Ledge forgiveness: pop up and over a low lip instead of stopping dead.
          this.y = p.top;
          if (this.vy < 0) this.vy = 0;
          continue;
        }
        nx = wallX - dir * P.HW;
        if (Math.abs(this.vx) > 5) ev.push({ t: 'bump', v: Math.abs(this.vx) });
        if (this.dashT > 0) this.dashT = 0;
        this.vx = 0;
        if (!this.ground) {
          this.wall = dir;
          this.wallT = P.WALL_COYOTE;
        }
      }
    }
    this.x = nx;

    // ── Move Y ──
    const ny = this.y + this.vy * dt;
    let landed: Plat | null = null;
    if (this.vy <= 0) {
      let best = -Infinity;
      for (const p of near) {
        if (!p.solid) continue;
        if (this.x + P.HW <= p.x0 + 0.02 || this.x - P.HW >= p.x1 - 0.02) continue;
        if (this.y >= p.top - 0.02 && ny <= p.top && p.top > best) {
          best = p.top;
          landed = p;
        }
      }
    } else {
      for (const p of near) {
        if (!p.solid || p.oneWay) continue;
        if (this.x + P.HW <= p.x0 || this.x - P.HW >= p.x1) continue;
        if (this.y + P.H <= p.bot + 0.02 && ny + P.H > p.bot) {
          this.y = p.bot - P.H;
          this.vy = 0;
          this.jumping = false;
          ev.push({ t: 'bump', v: 1 });
        }
      }
    }
    if (landed) {
      const impact = -this.vy;
      this.y = landed.top;
      this.vy = 0;
      this.ground = landed;
      this.jumping = false;
      this.dashAvail = true;
      this.wall = 0;
      this.wallT = 0;
      this.air = 0;
      if (!wasGround) ev.push({ t: 'land', v: impact });
    } else {
      this.y = ny;
      if (wasGround && !this.jumping) this.coyote = P.COYOTE;
      this.ground = null;
      this.air += dt;
    }
    return ev;
  }
}

function approach(v: number, target: number, d: number) {
  return v < target ? Math.min(target, v + d) : Math.max(target, v - d);
}
