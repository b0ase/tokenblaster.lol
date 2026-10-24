/**
 * Every combat number for the Shooting Gallery, in one place (owner, 24 Oct 2026: "HARD and dangerous").
 *
 * Shape of the difficulty: WAVE 1 is survivable for a new player who keeps the trigger down and sweeps the
 * gun across the threats; after that it escalates hard. Per-wave growth is `1 + perWave * (wave - 1)` (see
 * `ramp`), so a value in WAVE_RAMP of 0.2 means +20% on wave 2, +40% on wave 3, and so on.
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
    /** Camera kick on a hit: radians at damage 10, scaled by damage. */
    kickPer10: 0.045,
  },

  /** Per-wave growth (see `ramp`). Wave 1 is the baseline. */
  waveRamp: {
    erobotDamage: 0.2,
    erobotRate: 0.2,
    erobotSpeed: 0.05,
    erobotLive: 0.85,
    erobotHp: 0.12,
    bossDamage: 0.22,
    bossSpeed: 0.1,
    bossPush: -0.16,
  },

  erobots: {
    /** Standing HP. Low on purpose: they die fast and noisily. */
    hp: 34,
    headMultiplier: 2.5,
    /** Alive at once: base, plus per wave, plus extra while the trigger is held. Capped by the pool. */
    liveBase: 3,
    holdBonusPerSec: 0.45,
    /** Most alive at once on wave 1, and how many more each wave allows (the pool caps it). */
    liveCap: 5,
    liveCapPerWave: 1.5,
    /** Seconds between spawns (wave 1), and the floor. */
    spawnEvery: 1.05,
    spawnMin: 0.28,
    runSpeed: [7.5, 10.5] as [number, number],
    /** Share of each role at wave 1 and at wave 6+ (shooters hang back and fire, rushers close for melee, flankers swing wide). */
    roles: {
      wave1: { shooter: 0.56, rusher: 0.24, flanker: 0.2 },
      late: { shooter: 0.28, rusher: 0.4, flanker: 0.32 },
    },
    /** Shooters stop here (z) and then keep creeping closer. */
    stopZ: [-22, -11] as [number, number],
    creepSpeed: 0.9,
    strafeSpeed: 3.2,
    /** Flankers run an arc out to this |x| before turning in. */
    flankX: [11, 16] as [number, number],
    bolt: {
      speed: 34,
      damage: 5,
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
      damage: 9,
      windup: 0.32,
      every: 0.95,
      /** The z a rusher plants itself at. */
      stopZ: -2.1,
    },
  },

  boss: {
    /** Walking in (m/s) and the fast advance when nobody is firing at it. */
    stalkSpeed: 3.0,
    catchupSpeed: 6.2,
    /** It never gets closer than this (|z|). */
    minDist: 4.2,
    /** Its attacks land inside this distance. Beyond it, only shards. */
    reach: 8.6,
    /**
     * PUSHBACK: smoothed damage per second as a fraction of its max HP drives how hard it is shoved back.
     * At `pushFullFrac` or more it is shoved at `pushMax` m/s (its advance is 3.0, so sustained minigun fire
     * on wave 1 sends it backwards). Ease off and it catches up fast.
     */
    pushMax: 5.6,
    pushFullFrac: 0.05,
    pushMinScale: 0.3,
    /** Seconds the damage rate is smoothed over. */
    pushSmooth: 0.35,
    /** STAGGER: fire above `staggerFrac` for `staggerSustain` seconds and it reels. */
    staggerFrac: 0.04,
    staggerSustain: 0.8,
    staggerFor: 1.5,
    staggerCooldown: 3.4,
    staggerKick: 5,
    swipe: { windup: 0.55, damage: 20, every: 1.7 },
    lunge: { every: [4.5, 7.5] as [number, number], windup: 0.5, speed: 15, time: 0.42, damage: 30, fromDist: 24 },
    slam: { every: [8, 12] as [number, number], windup: 0.8, damage: 16 },
    shards: { every: [3.0, 4.4] as [number, number], count: 3, damage: 6, speed: 30, fromDist: 11 },
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
