/**
 * Arcade rally car physics: a bicycle model with a tyre curve, traction circle, weight transfer,
 * handbrake that locks the rear, countersteer assist, nitro, simple ballistic jumps and spring-damper
 * body motion. Plain numbers: the renderer just reads the state.
 */
import { clamp, lerp, smooth } from './noise';
import type { CarSpec } from './stages';

export type CarInput = { throttle: number; brake: number; steer: number; hand: boolean; nitro: boolean };

export type CarWorld = {
  height(x: number, z: number): number;
  /** Distance from the road centreline. */
  dist(x: number, z: number): number;
  /** Push a circle out of any obstacle; returns the contact if it hit. */
  hit(x: number, z: number, r: number, out: { nx: number; nz: number; pen: number }): boolean;
  /** Road grip multiplier. */
  grip: number;
  offGrip: number;
};

export type CarState = {
  x: number;
  y: number;
  z: number;
  vy: number;
  yaw: number;
  vx: number;
  vz: number;
  yawRate: number;
  /** Body attitude (visual): pitch + roll with spring dynamics. */
  pitch: number;
  roll: number;
  bodyY: number;
  pitchV: number;
  rollV: number;
  bodyYV: number;
  steerIn: number;
  steerAngle: number;
  air: number;
  nitro: number;
  nitroOn: boolean;
  // Telemetry
  speed: number;
  fwd: number;
  lat: number;
  slip: number;
  rpm: number;
  gear: number;
  surf: number;
  /** Rear wheel slip intensity 0..1 (skids, dust). */
  skid: number;
  front: number;
  driftPts: number;
  drifting: boolean;
  wheelSpin: number;
  wheelH: [number, number, number, number];
  impact: number;
  bump: number;
  ax: number;
  ay: number;
};

export const newCar = (): CarState => ({
  x: 0, y: 0, z: 0, vy: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, pitch: 0, roll: 0, bodyY: 0, pitchV: 0, rollV: 0, bodyYV: 0,
  steerIn: 0, steerAngle: 0, air: 0, nitro: 0.3, nitroOn: false, speed: 0, fwd: 0, lat: 0, slip: 0, rpm: 0.15, gear: 1, surf: 0,
  skid: 0, front: 0, driftPts: 0, drifting: false, wheelSpin: 0, wheelH: [0, 0, 0, 0], impact: 0, bump: 0, ax: 0, ay: 0,
});

export const G = 9.81;
// Body geometry in metres (Kenney car scaled ~1.55).
const L = 2.55;
const TRACK = 1.5;
const A = 1.18; // CG to front axle
const B = L - A;
const HCG = 0.55;
const WHEEL_R = 0.46;

const hit = { nx: 0, nz: 0, pen: 0 };

const GEARS = [0, 11, 21, 31, 40, 49, 60];

export function stepCar(c: CarState, spec: CarSpec, inp: CarInput, w: CarWorld, dt: number, onImpact?: (v: number) => void) {
  const mass = 1100 * spec.mass;
  const iz = mass * A * B * 1.15;
  const sy = Math.sin(c.yaw);
  const cy = Math.cos(c.yaw);
  // Body axes: forward f = (sy, cy), left l = (cy, -sy).
  let u = c.vx * sy + c.vz * cy;
  let vl = c.vx * cy - c.vz * sy;
  const speed = Math.hypot(c.vx, c.vz);
  const surfD = w.dist(c.x, c.z);
  c.surf = surfD < 3.7 ? 0 : surfD < 5.3 ? 1 : 2;
  const surfMul = c.surf === 0 ? w.grip : c.surf === 1 ? lerp(w.grip, w.offGrip, 0.35) : w.offGrip;
  const mu = surfMul * spec.grip * 1.05;

  // Steering: input smoothing, speed-sensitive lock, countersteer assist.
  const target = clamp(inp.steer, -1, 1);
  const rate = Math.abs(target) > Math.abs(c.steerIn) || Math.sign(target) !== Math.sign(c.steerIn) ? 7.5 : 5.5;
  c.steerIn += clamp(target - c.steerIn, -rate * dt, rate * dt);
  const lock = lerp(0.52, 0.1, smooth(2, 48, Math.abs(u))) * spec.steer;
  const beta = Math.atan2(vl, Math.max(Math.abs(u), 2));
  const assist = u > 4 ? clamp(beta * 0.7, -0.3, 0.3) * smooth(4, 12, u) : 0;
  const grounded = c.air <= 0;
  let delta = c.steerIn * lock + (grounded ? assist : 0);
  delta = clamp(delta, -0.62, 0.62);
  c.steerAngle = delta;

  // Loads with longitudinal weight transfer (from last step's acceleration).
  const wgt = mass * G;
  const nf = clamp(wgt * (B / L) - (mass * c.ax * HCG) / L, wgt * 0.2, wgt * 0.8);
  const nr = wgt - nf;

  // Drive / brake forces.
  const nitro = inp.nitro && c.nitro > 0.02 && u > 2;
  c.nitroOn = nitro;
  if (nitro) c.nitro = Math.max(0, c.nitro - 0.26 * dt);
  const pw = 112000 * spec.power * (nitro ? 1.85 : 1);
  let drive = 0;
  let brakeF = 0;
  if (grounded) {
    if (inp.throttle > 0.01) drive = Math.min((pw * inp.throttle) / Math.max(u, 5.5), 7200 * spec.power * (nitro ? 1.5 : 1));
    if (inp.brake > 0.01) {
      if (u > 1) brakeF = inp.brake * 11000;
      else if (inp.throttle < 0.05) {
        // reverse
        drive = -inp.brake * 3800;
        if (u < -11) drive = 0;
      }
    }
    if (inp.throttle < 0.02 && inp.brake < 0.02) brakeF = 600 + Math.abs(u) * 18; // engine braking
  }
  const dirU = u > 0.3 ? 1 : u < -0.3 ? -1 : 0;
  // Axle split: rear bias drives the rear more; brakes front-biased; handbrake is rear only.
  const driveR = drive * spec.rearBias;
  const driveF = drive - driveR;
  let fxR = driveR - dirU * brakeF * 0.35;
  let fxF = driveF - dirU * brakeF * 0.65;
  const hand = inp.hand && grounded;
  let rearMu = mu;
  if (hand) {
    rearMu = mu * 0.34;
    fxR -= dirU * Math.min(Math.abs(u) * 2200, 7000);
  }
  // Traction circle: asking an axle for more force than grip leaves less for cornering.
  const capF = mu * nf;
  const capR = rearMu * nr;
  const ratioF = clamp(Math.abs(fxF) / Math.max(capF, 1), 0, 1);
  const ratioR = clamp(Math.abs(fxR) / Math.max(capR, 1), 0, 1);
  fxF = clamp(fxF, -capF, capF);
  fxR = clamp(fxR, -capR, capR);
  const latCapF = capF * Math.sqrt(1 - ratioF * ratioF * 0.5);
  const latCapR = capR * Math.sqrt(1 - ratioR * ratioR * 0.5);

  // Slip angles and tyre curves.
  // Slip angle = lateral axle velocity over (at least) a walking pace. In reverse only the steering flips sign.
  const uu = Math.max(Math.abs(u), 1.8);
  const alphaF = Math.atan2(vl + A * c.yawRate, uu) - delta * (u < -0.5 ? -1 : 1);
  const alphaR = Math.atan2(vl - B * c.yawRate, uu);
  const curve = (a: number, cap: number) => -cap * Math.sin(1.45 * Math.atan(9.5 * a));
  const flat = grounded ? curve(alphaF, latCapF) : 0; // front lateral in wheel frame
  const frat = grounded ? curve(alphaR, latCapR) : 0;
  const cd = Math.cos(delta);
  const sd = Math.sin(delta);
  const fbx = fxF * cd - flat * sd; // front force in body axes
  const fby = fxF * sd + flat * cd;
  const drag = 0.9 / (spec.top * spec.top);
  const roll = (c.surf === 0 ? 0.016 : c.surf === 1 ? 0.03 : 0.07) * wgt * (grounded ? 1 : 0);
  const resist = -Math.sign(u) * (drag * u * u + roll * Math.min(1, Math.abs(u) / 2));
  const Fx = fbx + fxR + resist;
  const Fy = fby + frat;
  const Mz = A * fby - B * frat;

  // Integrate in world space.
  const ax = Fx / mass;
  const ay = Fy / mass;
  c.vx += (ax * sy + ay * cy) * dt;
  c.vz += (ax * cy - ay * sy) * dt;
  c.ax = lerp(c.ax, ax, 1 - Math.exp(-dt * 9));
  c.ay = lerp(c.ay, ay, 1 - Math.exp(-dt * 9));
  c.yawRate += (Mz / iz) * dt;
  // Gentle yaw damping + low-speed kinematic blend so it never wobbles when crawling.
  c.yawRate *= Math.exp(-dt * (grounded ? 0.55 : 0.1));
  if (grounded) {
    const k = 1 - smooth(1.5, 6, Math.abs(u));
    const wk = (u * Math.tan(delta)) / L;
    c.yawRate = lerp(c.yawRate, wk, k * Math.min(1, dt * 10));
  }
  c.yaw += c.yawRate * dt;

  // Stand-still: stop creeping once nearly stopped with no input.
  if (grounded && inp.throttle < 0.02 && speed < 0.6) {
    c.vx *= 1 - Math.min(1, dt * 6);
    c.vz *= 1 - Math.min(1, dt * 6);
  }
  c.x += c.vx * dt;
  c.z += c.vz * dt;

  // Re-project telemetry on the new heading.
  const sy2 = Math.sin(c.yaw);
  const cy2 = Math.cos(c.yaw);
  u = c.vx * sy2 + c.vz * cy2;
  vl = c.vx * cy2 - c.vz * sy2;
  c.fwd = u;
  c.lat = vl;
  c.speed = Math.hypot(c.vx, c.vz);
  c.slip = Math.atan2(vl, Math.max(Math.abs(u), 1));
  const rearSlip = Math.abs(alphaR);
  c.skid = grounded ? clamp((rearSlip - 0.1) * 4 + (hand ? 0.6 * smooth(4, 14, Math.abs(u)) : 0) + Math.max(0, ratioR - 0.9) * 2, 0, 1) * smooth(2, 7, c.speed) : 0;
  c.front = grounded ? clamp((Math.abs(alphaF) - 0.14) * 3.5, 0, 1) * smooth(4, 12, c.speed) : 0;
  c.wheelSpin += (c.fwd / WHEEL_R) * dt;
  // Drift points: sideways at speed.
  c.drifting = grounded && Math.abs(c.slip) > 0.22 && c.speed > 9;
  if (c.drifting) {
    c.driftPts += Math.abs(c.slip) * c.speed * 3.2 * dt;
    c.nitro = Math.min(1, c.nitro + 0.045 * dt);
  }
  // Gears for display / sound.
  let g = 1;
  const ab = Math.abs(c.fwd) * 1.05;
  while (g < 6 && ab > GEARS[g + 1] * spec.top * 0.9) g++;
  c.gear = c.fwd < -1 ? 0 : g;
  const lo = GEARS[g] * spec.top * 0.9;
  const hi = GEARS[g + 1] * spec.top * 0.9;
  const base = g === 1 ? 0.18 : 0.42;
  const driven = Math.max(ab, inp.throttle > 0.3 && grounded ? ab + 3 * inp.throttle * (1 - smooth(0, 14, ab)) : 0);
  c.rpm = clamp(lerp(c.rpm, base + (1 - base) * clamp((driven - lo) / Math.max(1, hi - lo), 0, 1) * 0.95 + 0.04 * inp.throttle, 1 - Math.exp(-dt * 14)), 0.12, 1);

  // ── Vertical: ground following, crest jumps, landing ──
  const wl = (fx: number, fz: number): [number, number] => [c.x + sy2 * fz + cy2 * fx, c.z + cy2 * fz - sy2 * fx];
  const pts: [number, number][] = [wl(TRACK / 2, L / 2), wl(-TRACK / 2, L / 2), wl(TRACK / 2, -L / 2), wl(-TRACK / 2, -L / 2)];
  for (let i = 0; i < 4; i++) c.wheelH[i] = w.height(pts[i][0], pts[i][1]);
  const gAvg = (c.wheelH[0] + c.wheelH[1] + c.wheelH[2] + c.wheelH[3]) / 4;
  const prevY = c.y;
  const yFree = c.y + c.vy * dt - 0.5 * G * dt * dt;
  if (c.air > 0 || yFree > gAvg + 0.05) {
    if (c.air <= 0) c.air = 0.0001;
    c.vy -= G * dt;
    c.y += c.vy * dt;
    c.air += dt;
    if (c.y <= gAvg) {
      const impact = Math.max(0, -c.vy);
      c.y = gAvg;
      if (impact > 2.5) {
        c.bodyYV -= impact * 0.5;
        c.pitchV += impact * 0.05;
        c.impact = Math.max(c.impact, clamp(impact / 12, 0, 1));
        onImpact?.(impact);
        // Some of the landing is lost to the ground.
        const keep = 1 - clamp(impact / 70, 0, 0.2);
        c.vx *= keep;
        c.vz *= keep;
      }
      c.air = 0;
      c.vy = 0;
    }
  } else {
    c.y = gAvg;
    c.vy = clamp((gAvg - prevY) / dt, -12, 12);
  }

  // Body springs: ride height, pitch and roll chase their targets with bounce.
  const front = (c.wheelH[0] + c.wheelH[1]) / 2;
  const back = (c.wheelH[2] + c.wheelH[3]) / 2;
  const left = (c.wheelH[0] + c.wheelH[2]) / 2;
  const right = (c.wheelH[1] + c.wheelH[3]) / 2;
  const slopePitch = Math.atan2(back - front, L); // nose up when ground rises ahead -> positive pitch up is negative x rot
  const slopeRoll = Math.atan2(left - right, TRACK);
  let pitchT = slopePitch - c.ax * 0.011 + (c.air > 0 ? clamp(Math.atan2(c.vy, Math.max(c.speed, 4)) * 0.5, -0.4, 0.4) : 0);
  let rollT = slopeRoll + c.ay * 0.016;
  // Rough ground jitters the body a little, faster = more.
  const rough = c.surf === 0 ? 0.35 : c.surf === 1 ? 0.7 : 1.4;
  const jit = (Math.sin(c.wheelSpin * 3.1) + Math.sin(c.wheelSpin * 7.7 + 1)) * 0.0035 * rough * smooth(3, 25, c.speed);
  pitchT += jit;
  rollT += jit * 0.7;
  const sp = (x: number, v: number, t: number, k: number, d: number) => {
    const a = k * (t - x) - d * v;
    return a;
  };
  c.pitchV += sp(c.pitch, c.pitchV, pitchT, 90, 9.5) * dt;
  c.pitch += c.pitchV * dt;
  c.rollV += sp(c.roll, c.rollV, rollT, 90, 9.5) * dt;
  c.roll += c.rollV * dt;
  c.bodyYV += sp(c.bodyY, c.bodyYV, 0 + (c.ax < -3 ? -0.01 : 0), 150, 11) * dt;
  c.bodyY += c.bodyYV * dt;
  c.bump = lerp(c.bump, Math.abs(c.vy) + Math.abs(c.pitchV) * 0.5, 1 - Math.exp(-dt * 10));
  c.impact *= Math.exp(-dt * 5);

  // ── Obstacles: two circles along the body ──
  for (const off of [1.15, -1.05]) {
    const px = c.x + sy2 * off;
    const pz = c.z + cy2 * off;
    if (c.y > gAvg + 0.7) continue;
    if (w.hit(px, pz, 0.95, hit)) {
      // Resolve: push out, bounce, scrub.
      c.x += hit.nx * hit.pen;
      c.z += hit.nz * hit.pen;
      const vn = c.vx * hit.nx + c.vz * hit.nz;
      if (vn < 0) {
        const e = 0.22;
        c.vx -= (1 + e) * vn * hit.nx;
        c.vz -= (1 + e) * vn * hit.nz;
        c.vx *= 0.93;
        c.vz *= 0.93;
        // Off-centre hits spin the car: torque = lever arm x sideways part of the impulse.
        const jl = -vn * (1 + e) * (hit.nx * cy2 - hit.nz * sy2);
        c.yawRate += clamp((off * jl) / (A * B * 1.15), -3, 3) * 0.5;
        const impactV = -vn;
        if (impactV > 2.2) {
          c.impact = Math.max(c.impact, clamp(impactV / 14, 0, 1));
          c.bodyYV += impactV * 0.12;
          c.rollV += (Math.random() - 0.5) * impactV * 0.15;
          onImpact?.(impactV + 100); // >100 flags a collision rather than a landing
        }
      }
    }
  }
}

/** Per-wheel positions in car space for the renderer (x right+? left+) matching the model's wheel nodes. */
export const WHEELS = { track: TRACK, base: L, radius: WHEEL_R, a: A, b: B };
