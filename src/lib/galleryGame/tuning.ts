/**
 * Every combat number for ASSAULT ON TERRORNODE, in one place (owner, 24 Oct 2026: "HARD and dangerous"),
 * including ALL the stage tuning (`stages`, `stageFlow`): kill goals, the core jam, the Erobot lanes, the boss.
 *
 * Shape of the difficulty: STAGE 1 is survivable for a new player who keeps the trigger down and sweeps the
 * gun across the threats; after that it escalates hard. Per-level growth is `1 + perLevel * (level - 1)` (see
 * `ramp`), so a value in waveRamp of 0.2 means +20% on level 2, +40% on level 3, and so on. A stage's `level`
 * is the number its Erobots (and the Liquid Unit's `bossLevel`) are scaled by.
 *
 * Units: seconds, metres, metres per second, hit points. The player stands at the origin and looks down -Z, so a
 * smaller |z| is closer. One accepted round is 1 damage with the stock guns, and the minigun streams up to
 * 1500 rounds a second, so enemy HP is small and the real limit is how fast the player can put the gun on them.
 *
 * Nothing in here touches the money side: it never changes how many rounds are fired, only what they do.
 */

export const TUNING = {
  /**
   * COIN-OP CONTINUE (owner, 24 Oct 2026): the death screen counts down like a classic arcade cabinet. Putting
   * coins in (one wallet approval) resets the count to `continueSecs`, resets health and ADDS the new ammo to
   * whatever is still loaded; the count also holds while the wallet approval is pending. At 0 it is GAME OVER
   * and the results screen opens (leftover ammo stays in the gun as credit).
   */
  continueSecs: 9,

  player: {
    hp: 100,
    /** Seconds without a hit before health trickles back. */
    regenDelay: 5,
    regenPerSec: 3,
    /** After a hit nothing else lands for this long, so one burst is not three hits (s). */
    hitCooldown: 0.12,
    /** Health from a kill (erobot) and from melting the boss (fraction of max). */
    healOnKill: 2,
    healOnBossMelt: 0.4,
    /** Invulnerable for this long after Continue (s). */
    reviveGrace: 3,
    /** Under this fraction the screen edge pulses red. */
    lowFraction: 0.3,
    /** Wave 1 only: enemies hold their fire this long at the start (s). */
    openingGrace: 3.5,
    /** STRAFE (A/D, arrows, the touch pad): metres a second, and how far across the set (fraction of its wall half-width). */
    strafeSpeed: 5.5,
    strafeRange: 0.55,
    /** Camera kick on a hit: radians at damage 10, scaled by damage. */
    kickPer10: 0.045,
  },

  /** Per-wave growth (see `ramp`). Wave 1 is the baseline. */
  waveRamp: {
    erobotDamage: 0.2,
    erobotRate: 0.2,
    erobotSpeed: 0.05,
    erobotHp: 0.06,
    bossDamage: 0.22,
    bossSpeed: 0.1,
    bossPush: -0.16,
  },

  erobots: {
    /** Standing HP. Low on purpose: they die fast and noisily (owner, 24 Oct: "too hard, Erobots must die more easily"). */
    hp: 10,
    /** Hit spheres are this much bigger than the body, so near-misses count. */
    hitScale: 1.8,
    headMultiplier: 2.5,
    /** Extra Erobots allowed alive per second the trigger has been held (up to 14 s). */
    holdBonusPerSec: 0.45,
    /** How many are alive at once is per stage: `stages[].lane.liveBase` / `liveCap`, plus a bonus while the trigger is held. */
    /** Seconds between spawns (wave 1), and the floor. */
    spawnEvery: 1.05,
    spawnMin: 0.28,
    runSpeed: [7.5, 10.5] as [number, number],
    /** Share of each role at wave 1 and at wave 6+ (shooters hang back and fire, rushers close for melee, flankers swing wide). */
    roles: {
      wave1: { shooter: 0.56, rusher: 0.24, flanker: 0.2 },
      late: { shooter: 0.28, rusher: 0.4, flanker: 0.32 },
    },
    creepSpeed: 0.9,
    strafeSpeed: 3.2,
    bolt: {
      speed: 34,
      damage: 4,
      /** Seconds between shots per shooter (wave 1), random in range. */
      every: [1.0, 2.0] as [number, number],
      /** Chance a bolt is aimed wide and misses (wave 1), falling by missPerWave to missMin. */
      miss: 0.34,
      missPerWave: 0.05,
      missMin: 0.08,
      /** Bolts are small: a round that passes this close shoots one down. */
      shootRadius: 0.5,
      hitRadius: 0.55,
    },
    melee: {
      range: 2.7,
      damage: 7,
      windup: 0.32,
      every: 0.95,
      /** The z a rusher plants itself at. */
      stopZ: -2.1,
    },
  },

  /**
   * THE FOUR STAGES (the same 3D engine, one set each). A stage ends on its `goal`:
   *  - `kills`: that many Erobots stopped (a kill of the nearest wins the floor; racks and glass only add points);
   *  - `jam`: sustained fire on the core. Each round on the core adds 1/`rounds` to the jam; after `holdSecs`
   *    without a hit it drains `drainPerSec` rounds a second, so only a steady stream gets it over the line;
   *  - `boss`: the Liquid Unit melts (once; he does not get back up), then the RESCUED beat.
   * `lane` is where the Erobots come from and how they move in that set: `spawnZ`/`halfW` the line they teleport in
   * on, `stopZ` where shooters plant, `flankX` the width flankers swing, `strafeX` the most a shooter sidesteps,
   * `snipeX` how far off-axis a flanker fires, and the live caps. A cap of 0 turns the Erobots off.
   */
  stages: [
    {
      id: 'street',
      level: 1,
      goal: { kind: 'kills', n: 12 },
      lane: { spawnZ: -63.5, halfW: 12, stopZ: [-22, -11], flankX: [11, 16], strafeX: 14, snipeX: 5, liveBase: 3, liveCap: 5, wallX: 17 },
    },
    {
      id: 'floors',
      level: 2,
      goal: { kind: 'kills', n: 16 },
      lane: { spawnZ: -44, halfW: 3.6, stopZ: [-21, -10], flankX: [3.6, 5.2], strafeX: 5.2, snipeX: 2.2, liveBase: 3, liveCap: 6, wallX: 6.3 },
    },
    {
      id: 'core',
      level: 3,
      goal: { kind: 'jam', rounds: 6000, holdSecs: 0.35, drainPerSec: 400 },
      lane: { spawnZ: -34, halfW: 7, stopZ: [-17, -9], flankX: [6, 9], strafeX: 9, snipeX: 3, liveBase: 2, liveCap: 4, wallX: 12 },
    },
    {
      id: 'roof',
      level: 4,
      goal: { kind: 'boss' },
      /** The Liquid Unit's level (health x1.5 and damage x1.22 per level above 1), once, on this stage. */
      bossLevel: 2,
      lane: { spawnZ: -40, halfW: 8, stopZ: [-20, -12], flankX: [8, 11], strafeX: 10, snipeX: 4, liveBase: 0, liveCap: 0, wallX: 11 },
    },
  ],

  /** The lift between stages and the RESCUED beat (milliseconds unless noted). */
  stageFlow: {
    /** The doors close: how long the screen takes to go black, then the stage swaps while black. */
    leaveMs: 950,
    /** Black hold in the lift after the swap, then the doors open on the new stage. */
    holdMs: 1300,
    /** Nothing can hurt you for this long after a stage opens (s), and the Erobots hold their fire. */
    openGraceSecs: 3,
    /** After the Liquid Unit is down: seconds after the unit pools until Kweg is up and walking, and how long the RESCUED cutscene runs before the results screen. */
    downToFreeSecs: 0.8,
    cutsceneSecs: 8,
    /** Health returned between stages (fraction of max). */
    healBetween: 0.5,
  },

  boss: {
    /** Walking in (m/s) and the fast advance when nobody is firing at it. */
    stalkSpeed: 3.0,
    catchupSpeed: 6.2,
    /** The furthest the fire can shove him (|z|): he braces there instead of vanishing down the street. */
    maxBack: 34,
    /** He never gets closer than this (|z|). */
    minDist: 4.2,
    /** Its attacks land inside this distance. Beyond it, only shards. */
    reach: 8.6,
    /**
     * PUSHBACK: the smoothed damage per second (rounds a second: one round is one damage) drives how hard he is
     * shoved back. At `pushFullDps` or more he is shoved at `pushMax` m/s (his advance is 3.0, so a few seconds of
     * minigun fire on wave 1 sends him backwards). Ease off and he catches up fast. Absolute, so it does not depend
     * on how much the player paid (which scales his health).
     */
    pushMax: 5.6,
    pushFullDps: 1100,
    pushMinScale: 0.3,
    /** Seconds the damage rate is smoothed over. */
    pushSmooth: 0.35,
    /** STAGGER: fire above `staggerDps` for `staggerSustain` seconds and he reels. */
    staggerDps: 850,
    staggerSustain: 0.8,
    staggerFor: 1.5,
    staggerCooldown: 3.4,
    staggerKick: 5,
    swipe: { windup: 0.55, damage: 20, every: 1.7 },
    lunge: { every: [4.5, 7.5] as [number, number], windup: 0.5, speed: 15, time: 0.42, damage: 30, fromDist: 24 },
    slam: { every: [8, 12] as [number, number], windup: 0.8, damage: 16 },
    shards: { every: [3.2, 4.6] as [number, number], count: 3, damage: 4, speed: 30, fromDist: 11 },
    /** Melt and re-form, in seconds: collapse, lie pooled, rise. */
    melt: { collapse: 2.6, pooled: 1.4, rise: 2.6, glide: 0.9 },
  },
} as const;

/** `1 + perWave * (wave - 1)`, never below `min`. */
export function ramp(perWave: number, wave: number, min = 0.25): number {
  return Math.max(min, 1 + perWave * (Math.max(1, wave) - 1));
}

/** Role weights blend from wave 1 to the late mix by wave 6. */
export function roleWeights(wave: number): { shooter: number; rusher: number; flanker: number } {
  const k = Math.min(1, (Math.max(1, wave) - 1) / 5);
  const a = TUNING.erobots.roles.wave1;
  const b = TUNING.erobots.roles.late;
  return { shooter: a.shooter + (b.shooter - a.shooter) * k, rusher: a.rusher + (b.rusher - a.rusher) * k, flanker: a.flanker + (b.flanker - a.flanker) * k };
}
