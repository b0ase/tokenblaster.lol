/**
 * Mempool Invaders: the pure rules (no three.js, no DOM) so they can be unit-tested: how a live tx becomes
 * a ship, formation layouts, wave sizing from mempool volume, combo and score, weapons and power-ups, and
 * the beat detector that turns the music's bass into beats.
 *
 * Coordinates: x is left/right across the field (-HW..HW); `gy` is distance from the player's line toward
 * the invaders (the engine maps gy to -z).
 */
import type { TxKind } from '../feed';

export const HW = 9; // half field width
export const FIELD_DEPTH = 30;

// ───────────── Tx -> ship ─────────────

export const KIND_POINTS: Record<TxKind, number> = { payment: 10, data: 15, social: 20, inscription: 30, token: 50, blast: 300 };
/** Hull colours by tx kind (house palette: cyan, blue, magenta, signal red, amber, white). */
export const KIND_HEX: Record<TxKind, string> = { payment: '#27e6ff', data: '#4a7bff', social: '#ff2f92', inscription: '#ff4a2e', token: '#ffb800', blast: '#ffffff' };
export const KIND_NAME: Record<TxKind, string> = { payment: 'PAYMENT', data: 'DATA', social: 'SOCIAL', inscription: 'INSCRIPTION', token: 'TOKEN', blast: 'BLAST' };
export const KIND_ORDER: TxKind[] = ['payment', 'data', 'social', 'inscription', 'token', 'blast'];

/** Ship scale from tx size in bytes: a plain payment is small, a fat inscription is a bruiser. */
export function sizeFor(bytes: number): number {
  const b = Math.max(100, bytes || 250);
  return Math.min(1.9, Math.max(0.78, 0.78 + (Math.log10(b) - 2.2) * 0.34));
}

/** Hits to destroy. Tokens always take two; big txs take more. */
export function hpFor(kind: TxKind, bytes: number): number {
  if (kind === 'blast') return 1;
  const base = bytes > 60_000 ? 3 : bytes > 4_000 ? 2 : 1;
  return kind === 'token' ? Math.max(2, base) : base;
}

// ───────────── Combo and score ─────────────

export const COMBO_WINDOW = 2.4;
const STEPS = [0, 5, 10, 18, 28, 40, 56, 76];
/** Score multiplier x1..x8 from the current combo count. */
export function multFor(combo: number): number {
  let m = 1;
  for (let i = 1; i < STEPS.length; i++) if (combo >= STEPS[i]) m = i + 1;
  return m;
}
/** Combo count at which the next multiplier starts (null at the top). */
export function nextMultAt(combo: number): number | null {
  const m = multFor(combo);
  return m >= STEPS.length ? null : STEPS[m];
}

export type Combo = { count: number; timer: number; best: number };
export const newCombo = (): Combo => ({ count: 0, timer: 0, best: 0 });
/** A kill: returns the multiplier to score it at. A kill on the beat counts double toward the combo. */
export function comboKill(c: Combo, onBeat: boolean): number {
  const mult = multFor(c.count);
  c.count += onBeat ? 2 : 1;
  c.timer = COMBO_WINDOW;
  c.best = Math.max(c.best, c.count);
  return mult;
}
export function comboTick(c: Combo, dt: number): boolean {
  if (c.count === 0) return false;
  c.timer -= dt;
  if (c.timer <= 0) {
    c.count = 0;
    c.timer = 0;
    return true; // broke
  }
  return false;
}

// ───────────── Formations ─────────────

export type Pattern = 'block' | 'chevron' | 'diamond' | 'twin';
export const PATTERNS: Pattern[] = ['block', 'chevron', 'diamond', 'twin'];
export type Slot = { x: number; z: number };
const SX = 2.0;
const SZ = 2.15;

/** `n` formation slots (x centred on 0, z = rows away from the front, 0 = front). Never more than 8 across. */
export function formationSlots(n: number, pattern: Pattern): Slot[] {
  const out: Slot[] = [];
  if (n <= 0) return out;
  const cols = Math.min(7, Math.max(3, Math.round(Math.sqrt(n * 1.7))));
  if (pattern === 'block' || pattern === 'chevron') {
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const inRow = Math.min(cols, n - r * cols);
      const c = i % cols;
      const x = (c - (inRow - 1) / 2) * SX;
      const mid = (inRow - 1) / 2;
      const z = r * SZ + (pattern === 'chevron' ? Math.abs(c - mid) * SZ * 0.55 : 0);
      out.push({ x, z });
    }
  } else if (pattern === 'diamond') {
    const maxW = cols % 2 === 1 ? cols : cols - 1;
    let w = 1;
    let grow = true;
    let r = 0;
    while (out.length < n && r < 40) {
      for (let c = 0; c < w && out.length < n; c++) out.push({ x: (c - (w - 1) / 2) * SX, z: r * SZ });
      r++;
      if (grow) {
        w += 2;
        if (w >= maxW) {
          w = maxW;
          grow = false;
        }
      } else {
        w = Math.max(1, w - 2);
        if (w === 1) grow = true;
      }
    }
  } else {
    // twin: two blocks with a lane between them
    const half = Math.max(2, Math.floor(cols / 2));
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const r = Math.floor(k / half);
      const c = k % half;
      out.push({ x: side * (2.4 + c * SX), z: r * SZ });
    }
  }
  return out;
}

export type WaveSpec = { wave: number; count: number; pattern: Pattern; speed: number; descent: number; fireEvery: number; diverEvery: number; boss: boolean; tokens: number };

/**
 * A wave from the wave number and the mempool backlog (txs waiting in the feed queue): a busy mempool means a
 * bigger formation and faster divers. Every 5th wave, or when a block has just landed, is a boss.
 */
export function waveSpec(wave: number, backlog: number, bossDue: boolean): WaveSpec {
  const boss = bossDue || (wave > 0 && wave % 5 === 0);
  const busy = Math.min(12, Math.floor(backlog / 12));
  const count = Math.min(44, 14 + wave * 2 + busy);
  return {
    wave,
    count: boss ? Math.max(8, Math.floor(count * 0.45)) : count,
    pattern: PATTERNS[(wave - 1) % PATTERNS.length],
    speed: 1.7 + wave * 0.16,
    descent: 0.3 + wave * 0.028,
    fireEvery: Math.max(0.38, 1.35 - wave * 0.075),
    diverEvery: Math.max(2.2, 7.5 - wave * 0.42 - busy * 0.18),
    boss,
    tokens: Math.min(8, 2 + Math.floor(wave / 2) + (busy > 6 ? 1 : 0)),
  };
}

/** Mempool pressure 0..1 from tx/s arriving: drives how loud the scene is. */
export const pressureFrom = (txPerSec: number) => Math.max(0, Math.min(1, txPerSec / 30));

// ───────────── Weapons and power-ups ─────────────

export type Power = 'spread' | 'rail' | 'overdrive' | 'shield' | 'bomb';
export const POWER_META: Record<Power, { label: string; colour: string; secs: number; blurb: string }> = {
  spread: { label: 'SPREAD', colour: '#ff2f92', secs: 18, blurb: 'Three-way cannon' },
  rail: { label: 'RAIL', colour: '#27e6ff', secs: 16, blurb: 'Piercing slugs' },
  overdrive: { label: 'OVERDRIVE', colour: '#c8ff1a', secs: 14, blurb: 'Rapid fire' },
  shield: { label: 'SHIELD', colour: '#4a7bff', secs: 0, blurb: 'Absorbs one hit' },
  bomb: { label: 'PURGE', colour: '#ffb800', secs: 0, blurb: 'Clears the mempool' },
};
export const POWERS: Power[] = ['spread', 'rail', 'overdrive', 'shield', 'bomb'];
/** Weighted pick: r in 0..1. Shields and bombs are rarer. */
export function rollPower(r: number): Power {
  const w: [Power, number][] = [['spread', 3], ['rail', 3], ['overdrive', 3], ['shield', 2], ['bomb', 1.4]];
  const total = w.reduce((s, x) => s + x[1], 0);
  let t = r * total;
  for (const [p, k] of w) {
    if (t < k) return p;
    t -= k;
  }
  return 'spread';
}

export type ShotSpec = { ang: number; dmg: number; pierce: number; speed: number; rail: boolean };
export function fireSpecs(spread: boolean, rail: boolean): ShotSpec[] {
  const mk = (ang: number): ShotSpec => ({ ang, dmg: rail ? 2 : 1, pierce: rail ? 3 : 0, speed: rail ? 40 : 30, rail });
  return spread ? [mk(-0.24), mk(0), mk(0.24)] : [mk(0)];
}
export function fireDelay(overdrive: boolean, spread: boolean, rail: boolean): number {
  let d = 0.16;
  if (spread) d *= 1.15;
  if (rail) d *= 1.25;
  if (overdrive) d *= 0.55;
  return d;
}

// ───────────── Beat detection ─────────────

/**
 * Turns a stream of bass-energy readings into beats: an onset is a clear jump over the running average, at
 * least 0.26 s after the last. With no usable signal it falls back to a metronome at the learned (or default)
 * tempo, so the game always has a pulse.
 */
export class BeatDetector {
  private avg = 0;
  private prev = 0;
  private last = -10;
  private interval = 0.5;
  private signal = false;
  /** Seconds of the most recent beat (performance clock). */
  lastBeat = 0;
  /** True when the last beat came from the music rather than the metronome. */
  fromMusic = false;
  feed(energy: number, t: number): boolean {
    const dt = t - this.last;
    const rising = energy > this.prev;
    const onset = energy > 0.12 && energy > this.avg * 1.3 + 0.02 && rising && dt > 0.26;
    this.avg += (energy - this.avg) * 0.06;
    this.prev = energy;
    this.signal = this.avg > 0.06;
    if (onset) {
      if (dt < 1.2) this.interval += (Math.max(0.3, Math.min(0.75, dt)) - this.interval) * 0.25;
      this.last = t;
      this.lastBeat = t;
      this.fromMusic = true;
      return true;
    }
    // Metronome: nothing heard for a beat and a half.
    if (dt > this.interval * (this.signal ? 1.6 : 1.0)) {
      this.last = this.last < 0 ? t : this.last + this.interval * Math.max(1, Math.floor(dt / this.interval));
      this.lastBeat = t;
      this.fromMusic = false;
      return true;
    }
    return false;
  }
  get beatLength() {
    return this.interval;
  }
}
