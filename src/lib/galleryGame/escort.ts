/**
 * ACT 2 ESCORT (owner, 27 Oct 2026): Dr Kweg S Wong is NOT carried out. He runs out with the NPG girls, keeps
 * running the wrong way, and you protect him.
 *
 * `EscortAI` is the pure state machine (no three.js, unit-tested in kweg.test.ts). It works in the enemies' frame:
 * the player stands near the origin, the way out is -Z (where the Erobotz come from) and +Z is back into the core.
 *   follow  trots after the player, inside FOLLOW_R
 *   panic   every few seconds: bolts towards the nearest threat or back into the core; the player reaching him
 *           (GRAB_R) or calling him ends it
 *   called  CALL KWEG (tap him, the C key, the phone button): sprints back to the player
 *   dead    HP hit zero: DR KWEG WONG IS LOST
 *   safe    the mission is won; he stops taking damage
 * Erobotz and the horde target him too: every live one inside HIT_R hurts him (`threats`), and bolts are added
 * by the engine via `hurt()`.
 *
 * `KwegBody` (kweg.ts) is the look: the Tripo model of the kwegwong.com cartoon (public/terrornode/kweg/{hi,lo}.glb,
 * Mixamo skeleton at identity rest, so the shared Quaternius clip library drives it), an HP bar over his head.
 * Low tier loads lo.glb and steps the mixer at half rate. No extra WebGL context: it lives in the engine's scene.
 */
export const ESCORT = {
  hp: 100,
  /** Trot speed, panic speed and the CALL sprint (m/s). */
  walk: 3.2,
  panicSpeed: 3.8,
  callSpeed: 6.5,
  /** He follows inside this radius (m) and stands a little ahead and to the left of the player (clear of the gun). */
  followR: 2.2,
  spot: { x: -1.6, z: -5.5 },
  /** The player inside this radius of a panicking Kweg grabs him back on track. */
  grabR: 1.6,
  /** Seconds between panics, and how long one lasts. */
  panicEvery: [4.5, 8] as [number, number],
  panicFor: [2.2, 3.4] as [number, number],
  /** Share of panics that run at the Erobotz (the rest run back into the core). */
  towardThreat: 0.6,
  /** A CALL lasts at most this long, and he arrives inside arriveR. */
  callFor: 3,
  arriveR: 1.4,
  /** Threat damage: each live Erobot / horde mob inside hitR deals dps. */
  hitR: 2,
  dps: 6,
  /** The playable box he is clamped to (enemies' frame). */
  box: { x: 7.5, zMin: -34, zMax: 14 },
} as const;

export type EscortState = 'follow' | 'panic' | 'called' | 'dead' | 'safe';
export type Pt = { x: number; z: number };
export type EscortEvent = 'panic' | 'lost' | null;

const lerpR = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

export class EscortAI {
  state: EscortState = 'follow';
  x = 0;
  z = -3;
  hp: number = ESCORT.hp;
  /** Heading (radians, 0 = -Z) and current speed, for the body's animation. */
  heading = 0;
  speed = 0;
  private panicIn: number = ESCORT.panicEvery[1];
  private stateT = 0;
  private dir: Pt = { x: 0, z: 1 };

  constructor(private rng: () => number = Math.random) {}

  reset(at: Pt = { x: ESCORT.spot.x, z: ESCORT.spot.z }) {
    this.state = 'follow';
    this.x = at.x;
    this.z = at.z;
    this.hp = ESCORT.hp;
    this.speed = 0;
    this.stateT = 0;
    this.panicIn = lerpR(ESCORT.panicEvery, this.rng());
  }

  get hpMaxValue() {
    return ESCORT.hp;
  }

  get alive() {
    return this.state !== 'dead';
  }

  /** CALL KWEG: he sprints back to the player. Ignored once he is lost or safe. */
  call() {
    if (this.state === 'dead' || this.state === 'safe') return false;
    this.state = 'called';
    this.stateT = 0;
    return true;
  }

  /** The mission is won: no more damage, he just follows. */
  safe() {
    if (this.state !== 'dead') this.state = 'safe';
  }

  /** Direct damage (an Erobot bolt that hit him). Returns 'lost' when it kills him. */
  hurt(dmg: number): EscortEvent {
    if (this.state === 'dead' || this.state === 'safe') return null;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) {
      this.state = 'dead';
      this.speed = 0;
      return 'lost';
    }
    return null;
  }

  update(dt: number, player: Pt, threats: readonly Pt[]): EscortEvent {
    if (this.state === 'dead') return null;
    this.stateT += dt;
    const E = ESCORT;
    const dp = Math.hypot(player.x - this.x, player.z - this.z);
    let tx = player.x + E.spot.x;
    let tz = player.z + E.spot.z;
    let sp = 0;
    let ev: EscortEvent = null;
    if (this.state === 'follow' || this.state === 'safe') {
      if (this.state === 'follow') {
        this.panicIn -= dt;
        if (this.panicIn <= 0) {
          this.state = 'panic';
          this.stateT = 0;
          this.panicIn = lerpR(E.panicFor, this.rng());
          const near = this.nearest(threats);
          if (near && this.rng() < E.towardThreat) {
            const d = Math.hypot(near.x - this.x, near.z - this.z) || 1;
            this.dir = { x: (near.x - this.x) / d, z: (near.z - this.z) / d };
          } else this.dir = { x: (this.rng() - 0.5) * 0.8, z: 1 }; // back into the core
          ev = 'panic';
        }
      }
      if (this.state !== 'panic') {
        const d = Math.hypot(tx - this.x, tz - this.z);
        sp = d > E.followR ? E.walk * 1.4 : d > 0.3 ? E.walk * Math.min(1, d / E.followR) : 0;
      }
    }
    if (this.state === 'panic') {
      if (dp < E.grabR && this.stateT > 0.4) this.toFollow();
      else if (this.stateT >= this.panicIn) this.toFollow();
      else {
        tx = this.x + this.dir.x * 10;
        tz = this.z + this.dir.z * 10;
        sp = E.panicSpeed;
      }
    }
    if (this.state === 'called') {
      tx = player.x;
      tz = player.z - 0.8;
      sp = E.callSpeed;
      if (dp < E.arriveR || this.stateT > E.callFor) {
        this.toFollow();
        sp = 0;
      }
    }
    // move
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dl = Math.hypot(dx, dz);
    if (sp > 0 && dl > 1e-3) {
      const step = Math.min(dl, sp * dt);
      this.x += (dx / dl) * step;
      this.z += (dz / dl) * step;
      this.heading = Math.atan2(-dx, -dz);
    } else if (dp > 0.5) this.heading = Math.atan2(-(player.x - this.x), -(player.z - this.z)); // standing: face the player
    this.speed = sp;
    this.x = Math.max(-E.box.x, Math.min(E.box.x, this.x));
    this.z = Math.max(E.box.zMin, Math.min(E.box.zMax, this.z));
    // the Erobotz go for him too
    if (this.state !== 'safe') {
      let n = 0;
      for (const t of threats) if (Math.hypot(t.x - this.x, t.z - this.z) < E.hitR) n++;
      if (n > 0 && this.hurt(n * E.dps * dt) === 'lost') return 'lost';
    }
    return ev;
  }

  private toFollow() {
    this.state = 'follow';
    this.stateT = 0;
    this.panicIn = lerpR(ESCORT.panicEvery, this.rng());
  }

  private nearest(threats: readonly Pt[]): Pt | null {
    let best: Pt | null = null;
    let bd = 1e9;
    for (const t of threats) {
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
}
