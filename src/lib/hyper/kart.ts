/**
 * NPG Racing kart physics, in the same track space as sim.ts (distance along the lap, lateral offset, height).
 * A ground vehicle, not a hover ship: wheels on the deck, weighty suspension, slower top speed, and power-slide
 * drifting as the core skill. Hold DRIFT while steering to slide; the longer the slide, the bigger the mini-boost
 * on release (three charge levels). Items are the engine's business; this file only moves the kart.
 * Deterministic: only dt and the input touch the state, so multiplayer snapshots replay the same on every client.
 * bRacer's sim.ts is untouched; its SimShip shape is reused (plus the drift fields) so the engine, HUD and
 * multiplayer channels work for both.
 */
import { frameAt, HALF_W, newFrame, surfaceSlope, type Frame, type Track } from './track';
import { newShip, type ShipSpec, type SimInput, type SimShip } from './sim';

export type KartShip = SimShip & {
  /** Drift direction (-1 left, +1 right), 0 when not sliding. */
  drift: number;
  /** Seconds in the current slide (the charge). */
  driftT: number;
  /** Charge level reached by the last released drift (for the boost toast / sparks): 0..3. */
  driftLvl: number;
  /** Small hop at the start of a drift (visual + a short air moment). */
  hopT: number;
  /** Visual suspension compression, -1..1 (left/right lean), set by the sim, read by the renderer. */
  lean: number;
};

export const newKart = (S = 0, h = 0.35): KartShip => ({ ...newShip(S), h, drift: 0, driftT: 0, driftLvl: 0, hopT: 0, lean: 0 });

/** Top speed vs the hover ships: karts are slower, so corners matter. */
export const KART_SPEED = 0.5;
/** Drift charge thresholds (seconds) for levels 1, 2, 3 and the mini-boost each one releases. */
export const DRIFT_LEVELS = [0.7, 1.6, 2.7] as const;
export const DRIFT_BOOST = [0.7, 1.2, 1.9] as const;
export const driftLevel = (t: number) => (t >= DRIFT_LEVELS[2] ? 3 : t >= DRIFT_LEVELS[1] ? 2 : t >= DRIFT_LEVELS[0] ? 1 : 0);

const G = 26;
export const KART_H = 0.35;
const F = newFrame();

export function stepKart(sh: KartShip, inp: SimInput, spec: ShipSpec, tr: Track, dt: number, f: Frame = F) {
  const ev = sh.ev;
  ev.pad = false; ev.wall = 0; ev.wallAng = 0; ev.pit = false; ev.jump = false; ev.roll = false; ev.rollBoost = false; ev.land = 0; ev.cell = false; ev.weapon = false;
  const len = tr.len;
  const s = ((sh.S % len) + len) % len;
  frameAt(tr, s, f);
  const i = f.i;
  const kr = tr.kr[i] * (1 - f.f) + tr.kr[(i + 1) % tr.n] * f.f;
  const kn = tr.kn[i] * (1 - f.f) + tr.kn[(i + 1) % tr.n] * f.f;
  const gl = tr.gl[i];
  const pipe = tr.pipe[i];
  sh.boostT = Math.max(0, sh.boostT - dt);
  sh.stunT = Math.max(0, sh.stunT - dt);
  sh.shieldT = Math.max(0, sh.shieldT - dt);
  sh.scrape = Math.max(0, sh.scrape - dt);
  sh.hopT = Math.max(0, sh.hopT - dt);
  const stun = sh.stunT > 0;
  const boosting = sh.boostT > 0;
  const onGround = sh.h < KART_H + 0.6;
  const vmax = spec.vmax * KART_SPEED;
  const vcap = vmax * (boosting ? 1.28 : 1);
  const thr = stun ? 0 : inp.throttle;
  // ── Drift: hop in with the drift key while steering, hold to slide, release for the boost. ──
  const want = (inp.boost || inp.airL || inp.airR) && !stun;
  if (sh.drift === 0 && want && Math.abs(inp.steer) > 0.25 && sh.vs > vmax * 0.3 && onGround) {
    sh.drift = inp.steer > 0 ? 1 : -1;
    sh.driftT = 0;
    sh.hopT = 0.22;
    sh.vh = Math.max(sh.vh, 6);
    ev.roll = true; // the engine plays the hop sound on this
  } else if (sh.drift !== 0 && (!want || sh.vs < vmax * 0.18 || stun)) {
    // Release: mini-boost by charge level.
    const lvl = driftLevel(sh.driftT);
    sh.driftLvl = lvl;
    if (lvl > 0 && !stun) {
      sh.boostT = Math.max(sh.boostT, DRIFT_BOOST[lvl - 1]);
      ev.rollBoost = true;
    }
    sh.drift = 0;
    sh.driftT = 0;
  }
  const drifting = sh.drift !== 0;
  if (drifting) {
    // Counter-steer loosens the slide, steering into it tightens; charge grows faster when tight.
    const into = Math.max(0, inp.steer * sh.drift);
    sh.driftT += dt * (0.7 + into * 0.6);
  }
  // ── Longitudinal: engine, drag, brake, slope. ──
  const target = vcap * thr;
  const accel = spec.accel * 0.75 * (boosting ? 1.9 : 1);
  if (sh.vs < target) sh.vs += accel * dt * (1 - 0.4 * (sh.vs / vcap));
  else sh.vs -= (thr > 0 && !stun ? 10 : 16) * dt + Math.max(0, sh.vs - vcap) * 1.6 * dt;
  if (inp.brake > 0) sh.vs -= 70 * inp.brake * dt;
  if (stun) sh.vs -= sh.vs * 1.8 * dt;
  if (drifting) sh.vs -= sh.vs * 0.09 * dt; // scrubbing speed in the slide
  sh.vs -= G * 0.45 * f.ty * dt;
  if (!onGround) sh.vs -= 2 * dt;
  sh.vs = Math.max(0, sh.vs);
  // ── Lateral: a kart steers with its wheels: strong grip, the slide only when drifting. ──
  let steer = stun ? inp.steer * 0.2 : inp.steer;
  steer = Math.max(-1, Math.min(1, steer));
  const auth = Math.min(1, sh.vs / 18) * (0.7 + 0.3 * Math.min(1, 60 / Math.max(30, sh.vs)));
  if (drifting) {
    // The kart points into the corner and slides out: turn authority up, grip down, outward push.
    const tight = 0.55 + 0.45 * Math.max(0, steer * sh.drift);
    sh.vl += sh.drift * spec.turn * 1.25 * tight * auth * dt;
    sh.vl -= sh.drift * 9 * dt; // outward slip (lateral velocity reads as the slide)
  } else {
    sh.vl += steer * spec.turn * 0.95 * auth * dt;
  }
  sh.vl += (-kr * sh.vs * sh.vs * 0.14 + 22 * gl - G * 0.6 * surfaceSlope(pipe, sh.lat) * 0.5) * dt;
  const grip = onGround ? (drifting ? spec.grip * 0.55 : spec.grip * 1.9) : spec.grip * 0.4;
  sh.vl -= sh.vl * Math.min(0.97, grip * dt);
  sh.lat += sh.vl * dt;
  // Walls: a bump, not a crash.
  const limit = HALF_W - 1.6;
  if (Math.abs(sh.lat) > limit) {
    const out = Math.sign(sh.lat);
    sh.lat = out * limit;
    if (sh.vl * out > 0) {
      const imp = Math.abs(sh.vl);
      sh.vl = -sh.vl * 0.45;
      sh.vs *= 1 - Math.min(0.35, 0.03 + Math.max(0, imp - 6) * 0.012);
      if (imp > 4) {
        sh.scrape = 0.3;
        sh.hits += 1;
        ev.wall = imp;
        ev.wallAng = imp / Math.max(30, sh.vs);
      }
    }
  }
  // Distance along the lap (inside lanes are shorter).
  sh.S += (sh.vs * dt) / Math.max(0.5, 1 - kr * sh.lat);
  // ── Vertical: wheels on the deck with a stiff suspension; ramps throw the kart. ──
  const sNow = ((sh.S % len) + len) % len;
  for (const j of tr.jumps) {
    const d = sNow - j;
    if (d >= 0 && d < 14 && sh.jumpDone !== j && sh.h < 2) {
      sh.vh = 11 + Math.min(6, sh.vs * 0.07);
      sh.jumpDone = j;
      ev.jump = true;
    }
    if (d > 60 && sh.jumpDone === j) sh.jumpDone = -1;
  }
  const wasAir = sh.air;
  const pull = -kn * sh.vs * sh.vs * (tr.inLoop[i] ? 0.55 : 0.85);
  let ah = pull - G * f.uy;
  if (sh.h < KART_H * 2.5 && sh.vh <= 0.5) ah += 240 * (KART_H - sh.h) - 22 * sh.vh;
  // Loops and half-pipes: the slower kart needs a magnet to stay on the deck (its own gravity would drop it).
  if ((tr.inLoop[i] || pipe > 0.02) && sh.h < 5) ah -= 60;
  else if (sh.h > 1 && sh.h < 5 && sh.vh < 0) ah -= 12;
  if (sh.h > 6) ah -= (sh.h - 6) * 3;
  sh.vh += ah * dt;
  sh.h += sh.vh * dt;
  if (sh.h < 0.12) {
    if (sh.vh < -6) ev.land = -sh.vh;
    sh.h = 0.12;
    sh.vh = Math.max(0, sh.vh);
  }
  sh.air = sh.h > 1.4;
  if (wasAir && !sh.air && ev.land === 0) ev.land = 2;
  // Boost pads.
  for (let p = 0; p < tr.pads.length; p++) {
    const pd = tr.pads[p];
    let d = sNow - pd.s;
    if (d > len / 2) d -= len;
    if (d < -len / 2) d += len;
    if (d > -4 && d < 10 && Math.abs(sh.lat - pd.lat) < 7.5 && sh.h < 3 && sh.lastPad !== p) {
      sh.boostT = Math.max(sh.boostT, 1.6);
      sh.lastPad = p;
      ev.pad = true;
    } else if (sh.lastPad === p && (d > 40 || d < -40)) sh.lastPad = -1;
  }
  // Karts never break: shield energy stays full (the pit lane is just a slow lane here).
  sh.hp = 1;
  // ── Visuals: the drift is the yaw, suspension lean follows lateral g. ──
  const spd = Math.max(12, sh.vs);
  sh.steerVis += (steer - sh.steerVis) * Math.min(1, 9 * dt);
  const slide = Math.atan2(sh.vl, spd);
  const wantYaw = drifting ? sh.drift * (0.55 + 0.25 * Math.max(0, steer * sh.drift)) + slide * 0.3 : slide * 0.9 + sh.steerVis * 0.12;
  sh.yaw += (wantYaw - sh.yaw) * Math.min(1, (drifting ? 7 : 10) * dt);
  const wantPitch = sh.air ? Math.atan2(sh.vh, spd) * 0.7 : Math.max(-0.1, Math.min(0.1, -kn * 40)) + (sh.hopT > 0 ? -0.12 : 0);
  sh.pitch += (wantPitch - sh.pitch) * Math.min(1, 8 * dt);
  const slope = Math.atan(surfaceSlope(pipe, sh.lat));
  const latG = sh.vl * 0.012 + steer * Math.min(1, sh.vs / 40) * 0.12;
  sh.lean += (Math.max(-1, Math.min(1, latG)) - sh.lean) * Math.min(1, 6 * dt);
  const roll = -sh.lean * 0.16 - slope * 0.9;
  sh.rollVis += (roll - sh.rollVis) * Math.min(1, 8 * dt);
}

/** Bump-and-shove between two karts in track space: both get pushed apart, the faster one loses a little speed. */
export function bumpKarts(a: { lat: number; vl: number; vs: number }, b: { lat: number; vl: number; vs: number }, push = 14) {
  const dir = a.lat >= b.lat ? 1 : -1;
  a.vl += dir * push;
  b.vl -= dir * push * 0.6;
  a.vs *= 0.94;
  b.vs *= 0.97;
}
