/**
 * Shooting Gallery scene: an early-90s action-movie night shoot on canvas 2D. Original characters only:
 * THE GUNNER (leather jacket, shades, a bike behind him) on a minigun, the OMNICORE DYNAMICS tower
 * (red-eye logo), its windows, the server floor, drones, and the LIQUID UNIT, a chrome robot that
 * keeps reforming. All art is drawn here; no images.
 *
 * The scene never decides how many bullets fly. The page feeds it `hits(n)`: the number of newly
 * ACCEPTED transactions (or simulated ones in practice), and every one is one round of damage.
 */

type Win = { x: number; y: number; w: number; h: number; hp: number; max: number; lit: number; broke: number };
type Rack = { x: number; y: number; w: number; h: number; hp: number; max: number; broke: number };
type Drone = { x: number; y: number; vx: number; t: number; hp: number; max: number; dead: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; c: string };
type Tracer = { x0: number; y0: number; x1: number; y1: number; life: number };
type Shell = { x: number; y: number; vx: number; vy: number; r: number; life: number };
type Drip = { a: number; r: number; life: number };

export type SceneStats = { score: number; bossHp: number; bossMax: number; wave: number; windows: number; windowsLeft: number; drones: number };

const W = 1600;
const H = 900;
const TOWER = { x: 640, y: 120, w: 420, h: 520 };

export class GalleryScene {
  private ctx: CanvasRenderingContext2D;
  private cw = 0;
  private ch = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  aim = { x: W * 0.62, y: H * 0.45 };
  trigger = false; // the barrel spins while held
  autoAim = false; // demo: track the boss
  flowing = false; // rounds are actually going out (txs accepted)
  private spin = 0;
  private spinV = 0;
  private wins: Win[] = [];
  private racks: Rack[] = [];
  private drones: Drone[] = [];
  private sparks: Spark[] = [];
  private tracers: Tracer[] = [];
  private shells: Shell[] = [];
  private drips: Drip[] = [];
  private stars: { x: number; y: number; s: number }[] = [];
  private skyline: { x: number; w: number; h: number; seed: number }[] = [];
  private boss = { x: W * 0.62, z: 0, hp: 6000, max: 6000, wave: 1, melt: 0, lastHit: 0, step: 0 };
  private pending = 0;
  private tracerDebt = 0;
  private shake = 0;
  private flash = 0;
  private t = 0;
  score = 0;
  private bossBase: number;

  constructor(private canvas: HTMLCanvasElement, bossBase = 6000) {
    this.ctx = canvas.getContext('2d')!;
    this.bossBase = bossBase;
    this.boss.hp = this.boss.max = bossBase;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) this.stars.push({ x: rnd() * W, y: rnd() * H * 0.55, s: rnd() });
    for (let x = -20; x < W + 40; ) {
      const w = 60 + rnd() * 120;
      this.skyline.push({ x, w, h: 160 + rnd() * 260, seed: Math.floor(rnd() * 1e6) });
      x += w + 6;
    }
    this.buildTower();
  }

  setBossBase(n: number) {
    this.bossBase = n;
    this.boss.hp = this.boss.max = n * Math.pow(1.5, this.boss.wave - 1);
  }

  private buildTower() {
    this.wins = [];
    const cols = 8;
    const rows = 11;
    const gw = (TOWER.w - 40) / cols;
    const gh = (TOWER.h - 170) / rows;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        this.wins.push({ x: TOWER.x + 20 + c * gw + 4, y: TOWER.y + 70 + r * gh + 4, w: gw - 8, h: gh - 8, hp: 40, max: 40, lit: Math.random(), broke: 0 });
    this.racks = [];
    for (let i = 0; i < 6; i++) this.racks.push({ x: TOWER.x + 24 + i * 63, y: TOWER.y + TOWER.h - 92, w: 52, h: 80, hp: 220, max: 220, broke: 0 });
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = Math.min(2, dpr);
    this.cw = cssW;
    this.ch = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    // Landscape: cover the stage. Portrait: fit the action (gunner → boss, x ~440..1140) to the width, pinned to the bottom.
    if (cssW / cssH >= 1) {
      this.scale = Math.max(cssW / W, cssH / H);
      this.ox = (cssW - W * this.scale) / 2;
      this.oy = (cssH - H * this.scale) / 2;
    } else {
      this.scale = Math.min(cssH / H, cssW / 700);
      this.ox = cssW / 2 - 790 * this.scale;
      this.oy = cssH - H * this.scale;
    }
  }

  /** Screen (CSS px) → world. */
  toWorld(px: number, py: number) {
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  /** The muzzle, in world space (the gun sits bottom-left). */
  private muzzle() {
    const base = { x: this.cw / this.ch < 1 ? 560 : 300, y: 790 };
    const a = Math.atan2(this.aim.y - base.y, this.aim.x - base.x);
    return { x: base.x + Math.cos(a) * 190, y: base.y + Math.sin(a) * 190, a, base };
  }

  /** `n` newly accepted shots: every one is a round of damage at the crosshair. */
  hits(n: number) {
    if (n <= 0) return;
    this.pending += n;
    this.tracerDebt += Math.min(n, 6);
  }

  stats(): SceneStats {
    return {
      score: this.score,
      bossHp: Math.max(0, Math.ceil(this.boss.hp)),
      bossMax: Math.ceil(this.boss.max),
      wave: this.boss.wave,
      windows: this.wins.length,
      windowsLeft: this.wins.filter((w) => !w.broke).length,
      drones: this.drones.filter((d) => !d.dead).length,
    };
  }

  private bossBox() {
    const s = 0.55 + this.boss.z * 0.6;
    const h = 330 * s;
    const w = 130 * s;
    const feet = 640 + this.boss.z * 210;
    return { x: this.boss.x - w / 2, y: feet - h, w, h, s, feet };
  }

  private targetAt(x: number, y: number): { kind: 'boss' | 'drone' | 'win' | 'rack' | 'wall'; ref?: Drone | Win | Rack } {
    const b = this.bossBox();
    if (!this.boss.melt && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return { kind: 'boss' };
    for (const d of this.drones) if (!d.dead && Math.hypot(d.x - x, d.y - y) < 46) return { kind: 'drone', ref: d };
    for (const r of this.racks) if (!r.broke && x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return { kind: 'rack', ref: r };
    for (const w of this.wins) if (!w.broke && x > w.x - 3 && x < w.x + w.w + 3 && y > w.y - 3 && y < w.y + w.h + 3) return { kind: 'win', ref: w };
    return { kind: 'wall' };
  }

  private burst(x: number, y: number, n: number, c: string, sp = 6) {
    for (let i = 0; i < n && this.sparks.length < 700; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = Math.random() * sp;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 0.4 + Math.random() * 0.6, c });
    }
  }

  step(dt: number) {
    this.t += dt;
    if (this.autoAim && !this.boss.melt) {
      const bb = this.bossBox();
      this.aim = { x: this.boss.x, y: bb.y + bb.h * 0.35 };
    }
    const spinning = this.trigger || this.flowing;
    this.spinV += ((spinning ? 38 : 0) - this.spinV) * Math.min(1, dt * (spinning ? 3 : 1.2));
    this.spin += this.spinV * dt;

    // Rounds landing this frame: apply all pending damage at the crosshair, in chunks.
    let dmg = this.pending;
    this.pending = 0;
    let guard = 0;
    while (dmg > 0 && guard++ < 50) {
      const jx = this.aim.x + (Math.random() - 0.5) * 26;
      const jy = this.aim.y + (Math.random() - 0.5) * 26;
      const tgt = this.targetAt(jx, jy);
      const chunk = tgt.kind === 'boss' ? dmg : Math.min(dmg, 25);
      dmg -= chunk;
      if (tgt.kind === 'boss') {
        this.boss.hp -= chunk;
        this.boss.lastHit = this.t;
        this.score += chunk;
        if (this.drips.length < 60) this.drips.push({ a: Math.random() * Math.PI * 2, r: Math.random(), life: 1 });
        this.burst(jx, jy, 2, '#dfe8f2', 5);
        if (this.boss.hp <= 0) {
          this.boss.melt = 1;
          this.score += 5000 * this.boss.wave;
          this.burst(this.boss.x, this.bossBox().y + 120, 120, '#cfd8e3', 12);
          this.shake = 1;
        }
      } else if (tgt.kind === 'drone') {
        const d = tgt.ref as Drone;
        d.hp -= chunk;
        this.burst(jx, jy, 3, '#ffb347');
        if (d.hp <= 0) {
          d.dead = 1;
          this.score += 250;
          this.burst(d.x, d.y, 60, '#ff6a2a', 10);
          this.shake = Math.max(this.shake, 0.5);
        }
      } else if (tgt.kind === 'rack') {
        const r = tgt.ref as Rack;
        r.hp -= chunk;
        this.burst(jx, jy, 3, '#7cf9ff');
        if (r.hp <= 0) {
          r.broke = 1;
          this.score += 500;
          this.burst(r.x + r.w / 2, r.y + r.h / 2, 80, '#7cf9ff', 9);
          this.shake = Math.max(this.shake, 0.6);
        }
      } else if (tgt.kind === 'win') {
        const w = tgt.ref as Win;
        w.hp -= chunk;
        this.burst(jx, jy, 2, '#bfe6ff', 4);
        if (w.hp <= 0) {
          w.broke = 1;
          this.score += 50;
          this.burst(w.x + w.w / 2, w.y + w.h / 2, 26, '#d6f1ff', 7);
        }
      } else {
        this.score += 0;
        this.burst(jx, jy, 1, '#ffd27a', 3);
        dmg = 0;
      }
    }

    // Tracers + casings: a capped visual stream (the counter, not the tracers, is the truth).
    if (this.flowing) this.tracerDebt += dt * 28;
    const m = this.muzzle();
    while (this.tracerDebt >= 1) {
      this.tracerDebt -= 1;
      if (this.tracers.length < 40)
        this.tracers.push({ x0: m.x, y0: m.y, x1: this.aim.x + (Math.random() - 0.5) * 30, y1: this.aim.y + (Math.random() - 0.5) * 30, life: 0.09 });
      if (this.shells.length < 120)
        this.shells.push({ x: m.base.x + 40, y: m.base.y - 10, vx: -2 - Math.random() * 3, vy: -6 - Math.random() * 3, r: Math.random() * 6, life: 1.2 });
      this.flash = 1;
      this.shake = Math.max(this.shake, 0.18);
    }
    if (this.tracerDebt > 30) this.tracerDebt = 30;

    // Boss: walks in, reforms when you let up, re-forms stronger after a melt. Relentless.
    const b = this.boss;
    if (b.melt) {
      b.melt += dt * 0.5;
      if (b.melt > 2.2) {
        b.melt = 0;
        b.wave++;
        b.z = 0;
        b.x = 760 + Math.random() * 320;
        b.max = this.bossBase * Math.pow(1.5, b.wave - 1);
        b.hp = b.max;
      }
    } else {
      b.z = Math.min(1, b.z + dt * 0.012);
      b.step += dt * 2.2;
      b.x = Math.min(1100, Math.max(720, b.x + Math.sin(this.t * 0.35) * dt * 40));
      if (this.t - b.lastHit > 0.45) b.hp = Math.min(b.max, b.hp + b.max * 0.06 * dt);
    }
    for (const d of this.drips) d.life -= dt * 0.8;
    this.drips = this.drips.filter((d) => d.life > 0);

    // Drones.
    if (this.drones.filter((d) => !d.dead).length < 4 && Math.random() < dt * 0.5) {
      const left = Math.random() < 0.5;
      this.drones.push({ x: left ? -60 : W + 60, y: 120 + Math.random() * 260, vx: (left ? 1 : -1) * (60 + Math.random() * 80), t: Math.random() * 10, hp: 60, max: 60, dead: 0 });
    }
    for (const d of this.drones) {
      d.t += dt;
      if (d.dead) {
        d.dead += dt;
        d.y += dt * 300;
      } else {
        d.x += d.vx * dt;
        d.y += Math.sin(d.t * 2) * dt * 30;
      }
    }
    this.drones = this.drones.filter((d) => d.x > -100 && d.x < W + 100 && d.dead < 1.5);

    // Rebuild the tower when it's all glass on the floor (OmniCore has deep pockets).
    if (this.wins.every((w) => w.broke) && this.racks.every((r) => r.broke)) this.buildTower();

    for (const s of this.sparks) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.25;
      s.life -= dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const s of this.shells) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.6;
      s.r += 0.3;
      s.life -= dt;
    }
    this.shells = this.shells.filter((s) => s.life > 0 && s.y < H + 20);
    for (const tr of this.tracers) tr.life -= dt;
    this.tracers = this.tracers.filter((tr) => tr.life > 0);
    this.shake *= Math.pow(0.02, dt);
    this.flash *= Math.pow(0.0005, dt);
  }

  draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#05060c';
    c.fillRect(0, 0, this.cw, this.ch);
    const sx = (Math.random() - 0.5) * 14 * this.shake;
    const sy = (Math.random() - 0.5) * 14 * this.shake;
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * (this.ox + sx), this.dpr * (this.oy + sy));
    this.drawSky(c);
    this.drawTower(c);
    this.drawDrones(c);
    this.drawBoss(c);
    this.drawGround(c);
    this.drawFx(c);
    this.drawGunner(c);
    this.drawCrosshair(c);
    // Film grade: teal-orange, scanlines, vignette.
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const v = c.createRadialGradient(this.cw / 2, this.ch / 2, Math.min(this.cw, this.ch) * 0.3, this.cw / 2, this.ch / 2, Math.max(this.cw, this.ch) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.65)');
    c.fillStyle = v;
    c.fillRect(0, 0, this.cw, this.ch);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < this.ch; y += 3) c.fillRect(0, y, this.cw, 1);
    if (this.flash > 0.05) {
      c.fillStyle = `rgba(255,190,90,${0.08 * this.flash})`;
      c.fillRect(0, 0, this.cw, this.ch);
    }
  }

  private drawSky(c: CanvasRenderingContext2D) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#060b1a');
    g.addColorStop(0.55, '#10264a');
    g.addColorStop(0.8, '#3a2440');
    g.addColorStop(1, '#120a12');
    c.fillStyle = g;
    c.fillRect(-400, -2000, W + 800, H + 2200);
    for (const s of this.stars) {
      c.fillStyle = `rgba(200,220,255,${0.25 + 0.5 * Math.abs(Math.sin(this.t * (0.5 + s.s) + s.x))})`;
      c.fillRect(s.x, s.y, 2, 2);
    }
    // Searchlights sweeping from the tower.
    for (let i = 0; i < 2; i++) {
      const a = -Math.PI / 2 + Math.sin(this.t * 0.4 + i * 2) * 0.6;
      const ox = TOWER.x + TOWER.w * (0.3 + i * 0.4);
      const oy = TOWER.y;
      const beam = c.createLinearGradient(ox, oy, ox + Math.cos(a) * 900, oy + Math.sin(a) * 900);
      beam.addColorStop(0, 'rgba(160,210,255,0.22)');
      beam.addColorStop(1, 'rgba(160,210,255,0)');
      c.fillStyle = beam;
      c.beginPath();
      c.moveTo(ox, oy);
      c.lineTo(ox + Math.cos(a - 0.06) * 1000, oy + Math.sin(a - 0.06) * 1000);
      c.lineTo(ox + Math.cos(a + 0.06) * 1000, oy + Math.sin(a + 0.06) * 1000);
      c.fill();
    }
    // Far skyline.
    for (const b of this.skyline) {
      c.fillStyle = '#0a1226';
      c.fillRect(b.x, 650 - b.h, b.w, b.h);
      let s = b.seed;
      for (let y = 650 - b.h + 10; y < 640; y += 16)
        for (let x = b.x + 6; x < b.x + b.w - 8; x += 12) {
          s = (s * 16807) % 2147483647;
          if (s % 7 === 0) {
            c.fillStyle = s % 3 ? 'rgba(255,190,110,0.5)' : 'rgba(120,200,255,0.45)';
            c.fillRect(x, y, 5, 7);
          }
        }
    }
  }

  private drawTower(c: CanvasRenderingContext2D) {
    const T = TOWER;
    const g = c.createLinearGradient(T.x, 0, T.x + T.w, 0);
    g.addColorStop(0, '#0d1424');
    g.addColorStop(0.5, '#1b2740');
    g.addColorStop(1, '#0a101d');
    c.fillStyle = g;
    c.fillRect(T.x, T.y, T.w, T.h);
    // Crown + antenna.
    c.fillStyle = '#121b30';
    c.beginPath();
    c.moveTo(T.x - 10, T.y);
    c.lineTo(T.x + T.w / 2, T.y - 60);
    c.lineTo(T.x + T.w + 10, T.y);
    c.fill();
    c.fillStyle = '#ff2a2a';
    if (Math.sin(this.t * 3) > 0) c.fillRect(T.x + T.w / 2 - 3, T.y - 110, 6, 6);
    c.fillStyle = '#30405e';
    c.fillRect(T.x + T.w / 2 - 1, T.y - 104, 2, 46);
    // Logo: OMNICORE red eye.
    const ex = T.x + T.w / 2;
    const ey = T.y + 32;
    c.save();
    c.shadowColor = '#ff2020';
    c.shadowBlur = 24;
    c.fillStyle = '#1a0306';
    c.beginPath();
    c.ellipse(ex - 120, ey, 26, 14, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ff3030';
    c.lineWidth = 3;
    c.stroke();
    const pupil = c.createRadialGradient(ex - 120, ey, 1, ex - 120, ey, 10);
    pupil.addColorStop(0, '#fff2c0');
    pupil.addColorStop(0.3, '#ff3a2a');
    pupil.addColorStop(1, '#5a0000');
    c.fillStyle = pupil;
    c.beginPath();
    c.arc(ex - 120 + Math.sin(this.t) * 6, ey, 9, 0, Math.PI * 2);
    c.fill();
    c.font = '700 26px "Arial Black", Impact, sans-serif';
    c.fillStyle = '#e8edf6';
    c.textBaseline = 'middle';
    c.fillText('OMNICORE', ex - 84, ey - 7);
    c.font = '600 11px Arial, sans-serif';
    c.fillStyle = '#ff5a4a';
    c.fillText('D Y N A M I C S', ex - 82, ey + 14);
    c.restore();
    for (const w of this.wins) {
      if (w.broke) {
        c.fillStyle = '#04060b';
        c.fillRect(w.x, w.y, w.w, w.h);
        c.strokeStyle = 'rgba(190,230,255,0.35)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(w.x, w.y);
        c.lineTo(w.x + w.w * 0.3, w.y + w.h * 0.4);
        c.moveTo(w.x + w.w, w.y + 2);
        c.lineTo(w.x + w.w * 0.7, w.y + w.h * 0.5);
        c.stroke();
        if (Math.sin(this.t * 9 + w.x) > 0.6) {
          c.fillStyle = 'rgba(255,120,40,0.35)';
          c.fillRect(w.x + 2, w.y + w.h - 6, w.w - 4, 5);
        }
        continue;
      }
      const lit = w.lit > 0.45;
      c.fillStyle = lit ? (w.lit > 0.8 ? '#ffd7a0' : '#9fd2ff') : '#1d2b48';
      c.globalAlpha = lit ? 0.75 : 1;
      c.fillRect(w.x, w.y, w.w, w.h);
      c.globalAlpha = 1;
      if (w.hp < w.max) {
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.lineWidth = 1;
        const cx = w.x + w.w / 2;
        const cy = w.y + w.h / 2;
        for (let k = 0; k < Math.ceil((1 - w.hp / w.max) * 5); k++) {
          c.beginPath();
          c.moveTo(cx, cy);
          c.lineTo(cx + Math.cos(k * 1.7) * w.w * 0.6, cy + Math.sin(k * 1.7) * w.h * 0.6);
          c.stroke();
        }
      }
    }
    // Server floor (lobby glass).
    c.fillStyle = '#060a14';
    c.fillRect(T.x + 14, T.y + T.h - 100, T.w - 28, 96);
    for (const r of this.racks) {
      c.fillStyle = r.broke ? '#0b0d12' : '#111a2c';
      c.fillRect(r.x, r.y, r.w, r.h);
      if (!r.broke)
        for (let k = 0; k < 7; k++) {
          c.fillStyle = (Math.floor(this.t * 6 + k + r.x) % 3) ? '#38f2ff' : '#0f5d6a';
          c.fillRect(r.x + 6, r.y + 8 + k * 10, r.w - 12, 3);
          c.fillStyle = Math.sin(this.t * 13 + k * 3 + r.x) > 0.3 ? '#ff3b3b' : '#3a0b0b';
          c.fillRect(r.x + r.w - 10, r.y + 8 + k * 10, 3, 3);
        }
      else if (Math.random() < 0.3) this.burst(r.x + r.w / 2, r.y + 10, 1, '#7cf9ff', 2);
    }
  }

  private drawDrones(c: CanvasRenderingContext2D) {
    for (const d of this.drones) {
      c.save();
      c.translate(d.x, d.y);
      c.rotate(d.dead ? d.dead * 5 : Math.sin(d.t * 2) * 0.08);
      c.fillStyle = '#1b2232';
      c.fillRect(-34, -6, 68, 12);
      c.fillStyle = '#2b3550';
      c.beginPath();
      c.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = d.dead ? '#331' : '#ff2a2a';
      c.shadowColor = '#ff2a2a';
      c.shadowBlur = d.dead ? 0 : 14;
      c.beginPath();
      c.arc(0, 2, 5, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = 'rgba(200,220,255,0.5)';
      c.lineWidth = 2;
      for (const px of [-34, 34]) {
        c.beginPath();
        c.ellipse(px, -10, 18, 3, Math.sin(d.t * 40) * 0.2, 0, Math.PI * 2);
        c.stroke();
      }
      // A thin red scan line, sweeping.
      if (!d.dead) {
        c.strokeStyle = 'rgba(255,40,40,0.25)';
        c.beginPath();
        c.moveTo(0, 6);
        c.lineTo(Math.sin(d.t * 1.3) * 140, 260);
        c.stroke();
      }
      c.restore();
    }
  }

  private drawBoss(c: CanvasRenderingContext2D) {
    const b = this.bossBox();
    const melt = this.boss.melt;
    c.save();
    c.translate(this.boss.x, b.feet);
    const s = b.s;
    c.scale(s, s);
    const chrome = c.createLinearGradient(-70, -330, 70, 0);
    chrome.addColorStop(0, '#f4f8ff');
    chrome.addColorStop(0.25, '#8a96a8');
    chrome.addColorStop(0.5, '#e6edf6');
    chrome.addColorStop(0.75, '#5d6878');
    chrome.addColorStop(1, '#c9d3e0');
    c.fillStyle = chrome;
    c.shadowColor = 'rgba(160,200,255,0.6)';
    c.shadowBlur = 18;
    if (melt) {
      // A spreading mercury puddle that pulls back together.
      const k = Math.min(1, melt);
      const back = Math.max(0, melt - 1.2);
      c.beginPath();
      c.ellipse(0, -6, 60 + 120 * k - back * 100, 14 + 10 * k, 0, 0, Math.PI * 2);
      c.fill();
      if (back > 0) {
        c.beginPath();
        c.ellipse(0, -40 * back * 3, 30, 40 * back * 3, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
      return;
    }
    const swing = Math.sin(this.boss.step) * 14;
    const wob = (k: number) => Math.sin(this.t * 6 + k) * 1.5;
    // Legs.
    c.beginPath();
    c.moveTo(-26, -150);
    c.lineTo(-30 - swing * 0.5, -4);
    c.lineTo(-12 - swing * 0.5, -4);
    c.lineTo(-4, -150);
    c.moveTo(4, -150);
    c.lineTo(12 + swing * 0.5, -4);
    c.lineTo(30 + swing * 0.5, -4);
    c.lineTo(26, -150);
    c.fill();
    // Torso, shoulders.
    c.beginPath();
    c.moveTo(-34, -150);
    c.quadraticCurveTo(-52 + wob(1), -230, -46, -262);
    c.lineTo(46, -262);
    c.quadraticCurveTo(52 + wob(2), -230, 34, -150);
    c.closePath();
    c.fill();
    // Arms: one ends in a blade.
    c.beginPath();
    c.moveTo(-46, -258);
    c.lineTo(-60 + swing * 0.3, -170);
    c.lineTo(-48 + swing * 0.3, -168);
    c.lineTo(-36, -240);
    c.fill();
    c.beginPath();
    c.moveTo(46, -258);
    c.lineTo(62 - swing * 0.3, -180);
    c.lineTo(58 - swing * 0.3, -110);
    c.lineTo(50 - swing * 0.3, -178);
    c.lineTo(36, -240);
    c.fill();
    // Head: smooth, featureless chrome, two slits.
    c.beginPath();
    c.ellipse(0, -292, 22, 28, 0, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(40,50,70,0.8)';
    c.fillRect(-12, -298, 9, 3);
    c.fillRect(3, -298, 9, 3);
    // Highlights.
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-30, -250);
    c.quadraticCurveTo(-38, -210, -26, -160);
    c.stroke();
    // Bullet holes that heal over (splash crowns).
    for (const d of this.drips) {
      const x = Math.cos(d.a) * 30 * d.r;
      const y = -150 - 110 * ((d.a / (Math.PI * 2)) % 1);
      c.fillStyle = `rgba(30,38,52,${0.8 * d.life})`;
      c.beginPath();
      c.arc(x, y, 5 + (1 - d.life) * 3, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = `rgba(240,248,255,${d.life})`;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(x, y, 7 + (1 - d.life) * 6, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  }

  private drawGround(c: CanvasRenderingContext2D) {
    const g = c.createLinearGradient(0, 640, 0, H);
    g.addColorStop(0, '#16131c');
    g.addColorStop(1, '#07060a');
    c.fillStyle = g;
    c.fillRect(-200, 640, W + 400, H);
    // Wet street reflections.
    c.globalAlpha = 0.18;
    c.fillStyle = '#ff3a3a';
    c.fillRect(TOWER.x + TOWER.w / 2 - 40, 660, 80, 3);
    c.fillStyle = '#7fd0ff';
    for (let i = 0; i < 12; i++) c.fillRect(TOWER.x + 30 + i * 32, 670 + (i % 3) * 18, 14, 2);
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,210,120,0.25)';
    c.lineWidth = 3;
    for (let i = 0; i < 10; i++) {
      c.beginPath();
      c.moveTo(W / 2 + (i - 5) * 30, 660);
      c.lineTo(W / 2 + (i - 5) * 220, H);
      c.stroke();
    }
  }

  private drawFx(c: CanvasRenderingContext2D) {
    c.lineCap = 'round';
    for (const tr of this.tracers) {
      c.strokeStyle = `rgba(255,220,140,${Math.min(1, tr.life * 12)})`;
      c.lineWidth = 3;
      c.beginPath();
      const k = 0.55 + Math.random() * 0.4;
      c.moveTo(tr.x0 + (tr.x1 - tr.x0) * (k - 0.2), tr.y0 + (tr.y1 - tr.y0) * (k - 0.2));
      c.lineTo(tr.x0 + (tr.x1 - tr.x0) * k, tr.y0 + (tr.y1 - tr.y0) * k);
      c.stroke();
    }
    for (const s of this.sparks) {
      c.fillStyle = s.c;
      c.globalAlpha = Math.min(1, s.life * 2);
      c.fillRect(s.x, s.y, 3, 3);
    }
    c.globalAlpha = 1;
  }

  private drawGunner(c: CanvasRenderingContext2D) {
    const m = this.muzzle();
    const { base } = m;
    // The bike behind him: generic cruiser silhouette.
    c.save();
    c.translate(base.x - 230, base.y + 40);
    c.fillStyle = '#0b0b10';
    c.strokeStyle = '#2a2f3d';
    c.lineWidth = 10;
    for (const wx of [0, 190]) {
      c.beginPath();
      c.arc(wx, 40, 46, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(0, 40);
    c.lineTo(60, -10);
    c.lineTo(150, -16);
    c.lineTo(190, 40);
    c.lineTo(120, 30);
    c.closePath();
    c.fill();
    c.fillStyle = '#3a4255';
    c.fillRect(140, -40, 6, 30);
    c.fillStyle = 'rgba(255,240,200,0.8)';
    c.beginPath();
    c.arc(205, -6, 7, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // The Gunner: back three-quarter view, leather jacket, close crop, shades catching the light.
    c.save();
    c.translate(base.x - 10, base.y);
    const jacket = c.createLinearGradient(-90, -200, 90, 120);
    jacket.addColorStop(0, '#2a2420');
    jacket.addColorStop(0.5, '#120f0e');
    jacket.addColorStop(1, '#050404');
    c.fillStyle = jacket;
    c.beginPath();
    c.moveTo(-110, 140);
    c.quadraticCurveTo(-120, -60, -60, -120);
    c.lineTo(50, -125);
    c.quadraticCurveTo(110, -70, 100, 140);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,170,90,0.25)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-58, -118);
    c.quadraticCurveTo(-100, -50, -104, 120);
    c.stroke();
    // Head.
    c.fillStyle = '#1a1310';
    c.beginPath();
    c.ellipse(-4, -160, 34, 40, 0.1, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#0b0807';
    c.fillRect(-36, -200, 66, 22);
    // Shades glint.
    c.fillStyle = '#05070c';
    c.fillRect(14, -168, 26, 9);
    c.fillStyle = `rgba(255,120,80,${0.6 + 0.4 * Math.sin(this.t * 2)})`;
    c.fillRect(30, -167, 8, 2);
    c.restore();

    // The minigun, pointing at the crosshair.
    c.save();
    c.translate(base.x, base.y);
    c.rotate(m.a);
    c.fillStyle = '#20232b';
    c.fillRect(-40, -22, 90, 44);
    c.fillStyle = '#3b404c';
    c.fillRect(-60, -10, 30, 34);
    // Ammo belt dropping off.
    c.strokeStyle = '#b38b3a';
    c.lineWidth = 8;
    c.setLineDash([5, 3]);
    c.beginPath();
    c.moveTo(-20, 20);
    c.quadraticCurveTo(-30, 90, -90, 140);
    c.stroke();
    c.setLineDash([]);
    // Six spinning barrels.
    for (let k = 0; k < 6; k++) {
      const ang = this.spin + (k * Math.PI) / 3;
      const y = Math.sin(ang) * 12;
      const shade = 0.5 + 0.5 * Math.cos(ang);
      c.fillStyle = `rgb(${60 + shade * 90},${64 + shade * 92},${74 + shade * 96})`;
      c.fillRect(50, y - 3, 140, 6);
    }
    c.fillStyle = '#2b2f39';
    c.fillRect(50, -16, 12, 32);
    c.fillRect(150, -15, 10, 30);
    c.restore();
    if (this.flash > 0.1 && this.flowing) {
      c.save();
      c.translate(m.x, m.y);
      c.rotate(m.a);
      c.globalCompositeOperation = 'lighter';
      const f = c.createRadialGradient(10, 0, 0, 10, 0, 60);
      f.addColorStop(0, 'rgba(255,250,220,0.95)');
      f.addColorStop(0.35, 'rgba(255,170,60,0.7)');
      f.addColorStop(1, 'rgba(255,90,20,0)');
      c.fillStyle = f;
      c.beginPath();
      c.ellipse(20, 0, 60 * (0.7 + Math.random() * 0.5), 26, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    for (const s of this.shells) {
      c.save();
      c.translate(s.x, s.y);
      c.rotate(s.r);
      c.fillStyle = '#d9a640';
      c.fillRect(-5, -2, 10, 4);
      c.restore();
    }
  }

  private drawCrosshair(c: CanvasRenderingContext2D) {
    const { x, y } = this.aim;
    const tgt = this.targetAt(x, y);
    const col = tgt.kind === 'boss' ? '#ff3b3b' : tgt.kind === 'wall' ? '#ffd27a' : '#7cf9ff';
    c.strokeStyle = col;
    c.lineWidth = 2.5;
    const r = 22 + (this.flowing ? Math.random() * 6 : 0);
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      c.beginPath();
      c.moveTo(x + dx * (r - 8), y + dy * (r - 8));
      c.lineTo(x + dx * (r + 12), y + dy * (r + 12));
      c.stroke();
    }
  }
}
