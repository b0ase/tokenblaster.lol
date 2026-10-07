/** Hover-ship physics in track space (distance along the lap, lateral offset, height above the surface). */
import { frameAt, HALF_W, newFrame, STEP, surfaceSlope, type Frame, type Track } from './track';

export type ShipSpec = {
  id: string;
  name: string;
  blurb: string;
  vmax: number;
  accel: number;
  turn: number;
  grip: number;
  /** Hull shape parameters. */
  span: number;
  length: number;
  sweep: number;
  /** Pack metadata. */
  author?: string;
  licence?: string;
  order: number;
  /** Optional fixed livery for the player's ship (overrides the team colours it sets). */
  livery?: { base?: string; accent?: string; trim?: string; ticker?: string; number?: number };
};

/** Ships come from content packs (content/bracer/ships/<slug>/ship.json); see ./content.ts. */
export { SHIPS } from './content';

export type Weapon = 'rocket' | 'mine' | 'shield' | 'turbo' | 'quake';
export const WEAPONS: Weapon[] = ['rocket', 'mine', 'shield', 'turbo', 'quake'];

export type SimInput = {
  throttle: number;
  brake: number;
  steer: number; // + = right
  airL: boolean;
  airR: boolean;
  boost: boolean;
  rollL: boolean;
  rollR: boolean;
};
export const noInput = (): SimInput => ({ throttle: 0, brake: 0, steer: 0, airL: false, airR: false, boost: false, rollL: false, rollR: false });

export type Ev = { pad: boolean; wall: number; wallAng: number; pit: boolean; jump: boolean; roll: boolean; rollBoost: boolean; land: number; cell: boolean; weapon: boolean };

export type SimShip = {
  S: number;
  lat: number;
  h: number;
  vs: number;
  vl: number;
  vh: number;
  boostT: number;
  energy: number;
  stunT: number;
  shieldT: number;
  rollT: number;
  rollDir: number;
  rollAir: boolean;
  scrape: number;
  weapon: Weapon | null;
  hits: number;
  /** Shield energy 0..1 (0 = destroyed). */
  hp: number;
  cells: number;
  air: boolean;
  /** Visual state. */
  yaw: number;
  pitch: number;
  rollVis: number;
  steerVis: number;
  jumpDone: number;
  lastPad: number;
  ev: Ev;
};

export const newShip = (S = 0): SimShip => ({
  S, lat: 0, h: 1, vs: 0, vl: 0, vh: 0, boostT: 0, energy: 0, stunT: 0, shieldT: 0, rollT: 0, rollDir: 1, rollAir: false, scrape: 0, weapon: null, hits: 0, hp: 1, cells: 0, air: false,
  yaw: 0, pitch: 0, rollVis: 0, steerVis: 0, jumpDone: -1, lastPad: -1,
  ev: { pad: false, wall: 0, wallAng: 0, pit: false, jump: false, roll: false, rollBoost: false, land: 0, cell: false, weapon: false },
});

const G = 18;
export const HOVER = 1.3;
const F = newFrame();

export function stepShip(sh: SimShip, inp: SimInput, spec: ShipSpec, tr: Track, dt: number, f: Frame = F, pitLane = true) {
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
  const stun = sh.stunT > 0;
  const boosting = sh.boostT > 0;
  const vcap = spec.vmax * (boosting ? 1.3 : 1);
  const thr = stun ? 0 : inp.throttle;
  // Longitudinal.
  const target = vcap * thr;
  if (sh.vs < target) sh.vs += spec.accel * (boosting ? 2.2 : 1) * dt * (1 - 0.45 * (sh.vs / vcap));
  else sh.vs -= (inp.throttle > 0 && !stun ? 14 : 8) * dt + Math.max(0, sh.vs - vcap) * 0.9 * dt;
  if (inp.brake > 0) sh.vs -= 85 * inp.brake * dt;
  if (stun) sh.vs -= sh.vs * 1.4 * dt;
  const airbrake = (inp.airL ? 1 : 0) + (inp.airR ? 1 : 0);
  sh.vs -= 26 * airbrake * dt;
  sh.vs -= G * 0.55 * f.ty * dt;
  sh.vs = Math.max(0, sh.vs);
  // Lateral: steering, airbrake pivots, centrifugal assist, banked gravity, half-pipe walls.
  let steer = stun ? inp.steer * 0.3 : inp.steer;
  steer += (inp.airR ? 0.9 : 0) - (inp.airL ? 0.9 : 0);
  steer = Math.max(-1.6, Math.min(1.6, steer));
  const auth = Math.min(1, sh.vs / 55) * (0.55 + 0.45 * Math.min(1, 140 / Math.max(60, sh.vs)));
  sh.vl += steer * spec.turn * auth * dt;
  sh.vl += (-kr * sh.vs * sh.vs * 0.2 + 30 * gl - G * 0.8 * surfaceSlope(pipe, sh.lat) * 0.5) * dt;
  const grip = spec.grip + airbrake * 2.4;
  sh.vl -= sh.vl * Math.min(0.95, grip * dt);
  // Barrel roll: side dash, and a boost if done in the air.
  if (sh.rollT <= 0 && (inp.rollL || inp.rollR) && !stun) {
    sh.rollT = 0.6;
    sh.rollDir = inp.rollR ? 1 : -1;
    sh.rollAir = sh.air;
    sh.vl += sh.rollDir * 26;
    ev.roll = true;
  }
  if (sh.rollT > 0) {
    sh.rollT -= dt;
    if (sh.rollT <= 0 && sh.rollAir) {
      sh.energy = Math.min(1, sh.energy + 0.2);
      sh.boostT = Math.max(sh.boostT, 1.4);
      ev.rollBoost = true;
    }
  }
  sh.lat += sh.vl * dt;
  const limit = HALF_W - 1.4;
  if (Math.abs(sh.lat) > limit) {
    const out = Math.sign(sh.lat);
    sh.lat = out * limit;
    if (sh.vl * out > 0) {
      const imp = Math.abs(sh.vl);
      sh.vl = -sh.vl * 0.35;
      sh.vs *= 1 - Math.min(0.45, 0.02 + Math.max(0, imp - 6) * 0.014);
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
  // Vertical: hover spring near the surface, gravity and magnet beyond, jumps off ramps.
  const sNow = ((sh.S % len) + len) % len;
  for (const j of tr.jumps) {
    const d = sNow - j;
    if (d >= 0 && d < 14 && sh.jumpDone !== j && sh.h < 3) {
      sh.vh = 22 + Math.min(10, sh.vs * 0.05);
      sh.jumpDone = j;
      ev.jump = true;
    }
    if (d > 60 && sh.jumpDone === j) sh.jumpDone = -1;
  }
  const wasAir = sh.air;
  const pull = -kn * sh.vs * sh.vs * (tr.inLoop[i] ? 0.55 : 0.85);
  let ah = pull - G * f.uy;
  if (sh.h < HOVER * 2.2) ah += 110 * (HOVER - sh.h) - 16 * sh.vh;
  else if (sh.h < 7 && !(sh.vh > 6)) ah -= 26;
  if (sh.h > 9) ah -= (sh.h - 9) * 4 + 10;
  sh.vh += ah * dt;
  sh.h += sh.vh * dt;
  if (sh.h < 0.2) {
    if (sh.vh < -8) ev.land = -sh.vh;
    sh.h = 0.2;
    sh.vh = Math.max(0, sh.vh);
    if (sh.vh === 0 && sh.vs > 60 && !tr.inLoop[i]) sh.scrape = Math.max(sh.scrape, 0.05);
  }
  sh.air = sh.h > 2.6;
  if (wasAir && !sh.air && ev.land === 0) ev.land = 2;
  // Boost pad / pickups.
  for (let p = 0; p < tr.pads.length; p++) {
    const pd = tr.pads[p];
    let d = sNow - pd.s;
    if (d > len / 2) d -= len;
    if (d < -len / 2) d += len;
    if (d > -4 && d < 10 && Math.abs(sh.lat - pd.lat) < 7.5 && sh.h < 5 && sh.lastPad !== p) {
      sh.boostT = Math.max(sh.boostT, 2.1);
      sh.lastPad = p;
      ev.pad = true;
    } else if (sh.lastPad === p && (d > 40 || d < -40)) sh.lastPad = -1;
  }
  // Pit lane: slow, recharge the shield.
  if (pitLane) {
    const [p0, p1] = tr.def.pit;
    const fr = sNow / len;
    if (fr >= p0 && fr <= p1 && sh.lat < -9 && sh.h < 4) {
      ev.pit = true;
      sh.hp = Math.min(1, sh.hp + 0.2 * dt);
      if (sh.vs > 105) sh.vs -= Math.min(sh.vs - 105, 70 * dt);
    }
  }
  // Visuals.
  const spd = Math.max(20, sh.vs);
  sh.steerVis += (steer - sh.steerVis) * Math.min(1, 9 * dt);
  const slide = Math.atan2(sh.vl, spd);
  sh.yaw += ((slide * 0.8 + sh.steerVis * 0.2 - sh.yaw) * Math.min(1, 10 * dt));
  const wantPitch = sh.air ? Math.atan2(sh.vh, spd) * 0.9 : Math.max(-0.12, Math.min(0.12, -kn * 40));
  sh.pitch += (wantPitch - sh.pitch) * Math.min(1, 7 * dt);
  const slope = Math.atan(surfaceSlope(pipe, sh.lat));
  const roll = -sh.steerVis * 0.4 - slide * 0.6 + (sh.rollT > 0 ? sh.rollDir * (1 - sh.rollT / 0.6) * Math.PI * 2 * -1 : 0) - slope * 0.9;
  sh.rollVis += (roll - sh.rollVis) * (sh.rollT > 0 ? 1 : Math.min(1, 10 * dt));
  if (sh.rollT <= 0 && Math.abs(sh.rollVis) > 3.2) sh.rollVis = sh.rollVis % (Math.PI * 2);
}

/** Total race time estimate helper for bots/tests. */
export const lapFraction = (tr: Track, S: number) => (((S % tr.len) + tr.len) % tr.len) / tr.len;
export { STEP };
