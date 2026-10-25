/**
 * Every combat number for ASSAULT ON TERRORNODE, in one place, including ALL the stage tuning (`run`, `stages`,
 * `horde`, `stageFlow`): the ten-minute block, the auto-walk, the Erobot lanes, the monster swarm, the boss.
 *
 * Shape of the difficulty (owner, 24 Oct 2026, for the BSV stress test): a constant swarm the minigun can hold
 * the trigger on for ten minutes, light damage, fast regen and a knockdown instead of death, so nothing ends a
 * run before the block lands. The swarm thickens stage by stage. Per-level growth is `1 + perLevel * (level - 1)` (see
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
   * THE BLOCK (owner, 24 Oct 2026, for the BSV stress test): one continuous ten-minute run, the length of a
   * block. The player is walked forward automatically down ONE connected route (street, through the lobby
   * doorway into the HQ floors, out of the corridor's open end into the server core shaft, out of the shaft onto
   * the roof and the server room) with no lift, no loading, no cut and no stage card that stops play. Each stage
   * starts at its `at` second; the Liquid Unit walks in at `bossAt` and the run ends at `secs` (if he is still
   * standing then, the block lands on him).
   */
  run: {
    secs: 600,
    bossAt: 520,
    /**
     * The route, in metres down -Z. `base`: where each set's origin sits (street, floors, core, roof), `lift` a
     * hair of height so seams never z-fight, `enter`: how far along the route each stage's set begins (the
     * seams: the street's lobby, the corridor's open end, the shaft's far opening), `end`: where the walk stops
     * in the server room. `doorZ`: the street's lobby doorway plane (the tower is carved behind it). Pieces are
     * drawn from `ahead` metres before they begin to `behind` metres after they end. `blend`: metres either side
     * of a seam over which the fog and sky blend. `coreBend`: the walk swings this far round the core pedestal.
     */
    route: {
      base: [0, -71.5, -140.5, -196.5],
      lift: [0, 0.02, 0, 0],
      enter: [0, 66.5, 136.5, 188.5],
      end: 214.5,
      doorZ: -69.3,
      ahead: 40,
      behind: 12,
      blend: 8,
      coreBend: 9,
    },
    /** Point-light slots the route's lights share (High / Low), and the exposure-kick cap while the trigger is held. */
    lightSlots: 8,
    lightSlotsLow: 4,
    fireKickCap: 0.05,
    /** Near a seam the player is kept to the middle (metres either side) so the walk threads the doorway. */
    seamLane: 2.2,
    /** Head bob while walked forward: metres up/down and steps a second. */
    bobY: 0.035,
    stepHz: 1.7,
  },

  player: {
    hp: 100,
    /** Seconds without a hit before health comes back (fast: a stress test run must not end early). */
    regenDelay: 1.2,
    regenPerSec: 14,
    /** After a hit nothing else lands for this long, so one burst is not three hits (s). */
    hitCooldown: 0.12,
    /** Health from a kill (erobot) and from melting the boss (fraction of max). */
    healOnKill: 2,
    healOnBossMelt: 0.4,
    /** Invulnerable for this long after a knockdown (s). */
    reviveGrace: 3,
    /**
     * KNOCKDOWN instead of death (owner, 24 Oct: "death must not end a stress-test run early"): at zero health
     * the player is shielded for `reviveGrace` seconds, back on `knockdownHp` of max, and keeps firing.
     */
    knockdownHp: 0.6,
    /** Under this fraction the screen edge pulses red. */
    lowFraction: 0.3,
    /** Wave 1 only: enemies hold their fire this long at the start (s). */
    openingGrace: 3.5,
    /** STRAFE (A/D, arrows, the touch pad): metres a second, and how far across the set (fraction of its wall half-width). */
    strafeSpeed: 5.5,
    strafeRange: 0.55,
    /**
     * FREE MOVE (owner, 25 Oct: "full movement like the Arena, plus slow automatic forward travel"): how far you
     * can walk ahead of (-) or drop behind (+) the auto-walk's spot (m), the arrow-key turn rate (rad/s) and how
     * far the view can turn from straight down the route (rad).
     */
    freeZ: [-5, 3] as [number, number],
    turnSpeed: 2.2,
    lookYaw: 2.4,
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
    holdBonusPerSec: 0.8,
    /** Bodies built once (High / Low): the most that can ever be on the floor. */
    poolHigh: 16,
    poolLow: 9,
    /** Body scale per spawn: most in `range`, a few hulking `heavy` ones (health grows with size squared). */
    sizes: { range: [0.8, 1.3] as [number, number], heavy: 1.9, heavyChance: 0.12 },
    /** How many are alive at once is per stage: `stages[].lane.liveBase` / `liveCap`, plus a bonus while the trigger is held. */
    /** Seconds between spawns (wave 1), and the floor. */
    spawnEvery: 0.5,
    spawnMin: 0.16,
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
      damage: 1.0,
      /** Seconds between shots per shooter (wave 1), random in range. */
      every: [1.9, 3.4] as [number, number],
      /** Chance a bolt is aimed wide and misses (wave 1), falling by missPerWave to missMin. */
      miss: 0.4,
      missPerWave: 0.05,
      missMin: 0.08,
      /** Bolts are small: a round that passes this close shoots one down. */
      shootRadius: 0.5,
      hitRadius: 0.55,
    },
    melee: {
      range: 5.2,
      damage: 2,
      windup: 0.32,
      every: 0.95,
      /** The z (in front of the player) a rusher plants itself at: never inside point-blank range. */
      stopZ: -4.2,
    },
  },

  /**
   * THE FOUR STAGES, one seamless walk (see `run.route`). Each starts at its `at` second of the block; there
   * are no goals to clear any more, the clock moves you on. `lane` is where the Erobots and the horde come from: `spawnZ`/`halfW` the line
   * they arrive on, `stopZ` where shooters plant, `flankX` the width flankers swing, `strafeX` the most a shooter
   * sidesteps, `snipeX` how far off-axis a flanker fires, and the Erobot live caps. `horde` is how many Arena
   * monsters are alive at once (High; Low takes `TUNING.horde.lowLive` of it), ramping across the stage to `hordeEnd`.
   * The core's jam is a score bonus now: jam it and it blows, then re-arms.
   */
  stages: [
    {
      id: 'street',
      level: 1,
      at: 0,
      horde: 7,
      hordeEnd: 12,
      lane: { spawnZ: -63.5, halfW: 12, stopZ: [-22, -11], flankX: [11, 16], strafeX: 14, snipeX: 5, liveBase: 4, liveCap: 8, wallX: 17 },
    },
    {
      id: 'floors',
      level: 2,
      at: 150,
      horde: 10,
      hordeEnd: 15,
      lane: { spawnZ: -44, halfW: 3.6, stopZ: [-21, -10], flankX: [3.6, 5.2], strafeX: 5.2, snipeX: 2.2, liveBase: 4, liveCap: 8, wallX: 6.3 },
    },
    {
      id: 'core',
      level: 3,
      at: 300,
      horde: 12,
      hordeEnd: 17,
      jam: { rounds: 6000, holdSecs: 0.35, drainPerSec: 400 },
      lane: { spawnZ: -34, halfW: 7, stopZ: [-17, -9], flankX: [6, 9], strafeX: 9, snipeX: 3, liveBase: 4, liveCap: 8, wallX: 12 },
    },
    {
      id: 'roof',
      level: 4,
      at: 430,
      horde: 13,
      hordeEnd: 9,
      /** The Liquid Unit's level (health x1.5 and damage x1.22 per level above 1), once, on this stage. */
      bossLevel: 2,
      lane: { spawnZ: -40, halfW: 8, stopZ: [-20, -12], flankX: [8, 11], strafeX: 10, snipeX: 4, liveBase: 4, liveCap: 8, wallX: 11 },
    },
  ],

  /** The Arena's monsters in the run (src/lib/galleryGame/horde.ts): pool per kind (High), sizes, speeds, light bites. */
  horde: {
    kinds: [
      // small and fast
      { id: 'raptor', pool: 6, weight: 3, size: [0.7, 0.95] as [number, number], speed: [7, 10] as [number, number], hp: 8, damage: 1.5, score: 120 },
      { id: 'minion', pool: 8, weight: 4, size: [0.75, 0.95] as [number, number], speed: [4.5, 6.5] as [number, number], hp: 5, damage: 1, score: 80 },
      // medium
      { id: 'zombie', pool: 6, weight: 3, size: [1.0, 1.3] as [number, number], speed: [2.6, 3.6] as [number, number], hp: 12, damage: 2, score: 150 },
      { id: 'zombiewarrior', pool: 4, weight: 2, size: [1.0, 1.35] as [number, number], speed: [4, 5.5] as [number, number], hp: 14, damage: 2, score: 180 },
      { id: 'hazmat', pool: 3, weight: 1.5, size: [1.2, 1.6] as [number, number], speed: [2.4, 3.2] as [number, number], hp: 20, damage: 2.5, score: 220 },
      { id: 'eyebeast', pool: 3, weight: 1.5, size: [1.1, 1.8] as [number, number], speed: [3, 4.5] as [number, number], hp: 10, damage: 1.5, score: 200 },
      // huge
      { id: 'helldemon', pool: 2, weight: 0.7, size: [2.4, 3.2] as [number, number], speed: [1.8, 2.4] as [number, number], hp: 60, damage: 4, score: 2500 },
    ],
    /** Low quality builds this share of each pool and keeps this share of the live count. */
    lowPool: 0.5,
    lowLive: 0.55,
    spawnEvery: 0.35,
    burst: 3,
    biteEvery: 2.0,
    hitScale: 1.15,
    /**
     * FAIRER CLOSE RANGE (owner, 25 Oct): a monster plants at least `minDist` + its size x `sizeDist` metres in
     * front of you, at most `maxClose` bite at once (the rest hold back `holdBack` metres further, still in the
     * line of fire), bodies push apart, and a bite only lands within `biteReach` (+ size) metres sideways.
     */
    minDist: 3.6,
    sizeDist: 1.2,
    maxClose: 3,
    holdBack: 6,
    biteReach: 3,
  },

  /** The seamless stage flow and the RESCUED beat (milliseconds unless noted). */
  stageFlow: {
    /** After the Liquid Unit is down: seconds after the unit pools until Kweg is up and walking, and how long the RESCUED cutscene runs before the results screen. */
    downToFreeSecs: 0.8,
    cutsceneSecs: 8,
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
    swipe: { windup: 0.55, damage: 6, every: 1.7 },
    lunge: { every: [4.5, 7.5] as [number, number], windup: 0.5, speed: 15, time: 0.42, damage: 9, fromDist: 24 },
    slam: { every: [8, 12] as [number, number], windup: 0.8, damage: 6 },
    shards: { every: [3.2, 4.6] as [number, number], count: 3, damage: 1.5, speed: 30, fromDist: 11 },
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
