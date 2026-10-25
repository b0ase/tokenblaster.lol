/**
 * THE EROBOT CAST: Dr Kweg Wong's named Erobots as enemy types in ASSAULT ON TERRORNODE, plus the generic
 * Tripo bots that fill the ranks. Pure data (no three.js), so it is unit-tested on its own.
 *
 * Canon sources:
 * - Names and team: src/lib/npgGirls.ts (team 'Erobot': Phi-Phi, Hikaru, Joy, Yamarashii, Miyuki, Payne, Peggy,
 *   Scarlet, Matoko).
 * - Weapons, hair and parts: src/lib/npgcards/catalog.ts (Yamarashii BOXING GLOVE, Hikaru THRASHER, Phi-Phi RED
 *   AXE, Miyuki PADDLE, Joy BIG KNIFE, Scarlet BLACK AX; hair Miyuki RED STRIPE + BLACK BOUFFANT, Joy PINK BOB,
 *   Scarlet BLACK FRINGE; Peggy WINGS, Phi-Phi HORN, Yamarashii YAMA MASK).
 * - Models: ninja-punk-girls-com `feat/arena-tripo-models` public/arena/models/v1/{hi,lo} (Matoko optimised
 *   here from public/npg/cards/matoko-rigged.glb). Joy has no rigged model yet, so she is not in the swarm.
 *
 * Where canon gives no weapon (Payne, Peggy, Matoko) the pick fits the character's parts: Peggy's WINGS carry
 * rocket pods, Payne runs twin blasters, Matoko a rail rifle. The named Tripo models carry their own modelled hair.
 * PG-13: "sexy" is style (gloss, colour), never anything explicit.
 */

export type WeaponKind = 'palm' | 'axe' | 'flail' | 'glove' | 'paddle' | 'blaster' | 'rockets' | 'rail';

export type CastMember = {
  id: string;
  name: string;
  named: boolean;
  weapon: WeaponKind;
  /** Bolt / projectile colour for this character's shots. */
  shot: string;
  /** Spawn weight among the free bodies (named Erobots show up more than one generic bot each). */
  weight: number;
};

export const CAST: readonly CastMember[] = [
  { id: 'miyuki', name: 'Miyuki', named: true, weapon: 'paddle', shot: '#ff3a5a', weight: 1.3 },
  { id: 'peggy', name: 'Peggy', named: true, weapon: 'rockets', shot: '#ff5ab8', weight: 1.3 },
  { id: 'phi-phi', name: 'Phi-Phi', named: true, weapon: 'axe', shot: '#ff4a30', weight: 1.3 },
  { id: 'hikaru', name: 'Hikaru', named: true, weapon: 'flail', shot: '#7cf9ff', weight: 1.3 },
  { id: 'yamarashii', name: 'Yamarashii', named: true, weapon: 'glove', shot: '#ff7a50', weight: 1.3 },
  { id: 'payne', name: 'Payne', named: true, weapon: 'blaster', shot: '#b06bff', weight: 1.3 },
  { id: 'scarlet', name: 'Scarlet', named: true, weapon: 'axe', shot: '#ff2a3a', weight: 1.3 },
  { id: 'matoko', name: 'Matoko', named: true, weapon: 'rail', shot: '#5affe8', weight: 1.3 },
  // the generic ranks (still bald: no modelled hair fits them yet, see the PR notes)
  { id: 'bot', name: 'Erobot', named: false, weapon: 'palm', shot: '#ff4a30', weight: 1 },
  { id: 'tech', name: 'Tech', named: false, weapon: 'palm', shot: '#ff4a30', weight: 1 },
  { id: 'frog-bot', name: 'Frog-Bot', named: false, weapon: 'palm', shot: '#ff4a30', weight: 1 },
  { id: 'stripey-bot', name: 'Stripey-Bot', named: false, weapon: 'palm', shot: '#ff4a30', weight: 1 },
  { id: 'graf-bot', name: 'Graf-Bot', named: false, weapon: 'palm', shot: '#ff4a30', weight: 1 },
];

export const castById = (id: string) => CAST.find((c) => c.id === id);

export type WeaponSpec = {
  /** Fights up close (rusher / flanker) or hangs back and shoots. */
  ranged: boolean;
  /** Shots per trigger pull, and seconds between them. */
  burst: number;
  burstGap: number;
  /** Telegraph (glow) before the first shot, seconds. */
  charge: number;
  /** Multipliers on TUNING.erobots.bolt speed / damage. */
  speed: number;
  damage: number;
  /** Projectile look: 'bolt' (energy capsule) or 'shard' (thrown blade / rocket). */
  kind: 'bolt' | 'shard';
  /** Melee weapons may also throw from range (flankers on the way in). */
  throws: boolean;
  /** Melee damage multiplier (on TUNING.erobots.melee.damage). */
  melee: number;
};

/**
 * Attack table. FAIRNESS (PR #46): damage stays low (no shot above 1.3x the stock bolt, bursts split the damage),
 * every ranged attack is telegraphed, and the close-range caps live in CLOSE below.
 */
export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  palm: { ranged: true, burst: 1, burstGap: 0, charge: 0.28, speed: 1, damage: 1, kind: 'bolt', throws: false, melee: 1 },
  blaster: { ranged: true, burst: 3, burstGap: 0.12, charge: 0.3, speed: 1.15, damage: 0.4, kind: 'bolt', throws: false, melee: 1 },
  rockets: { ranged: true, burst: 2, burstGap: 0.35, charge: 0.45, speed: 0.55, damage: 0.65, kind: 'shard', throws: false, melee: 1 },
  rail: { ranged: true, burst: 1, burstGap: 0, charge: 0.6, speed: 1.7, damage: 1.2, kind: 'bolt', throws: false, melee: 1 },
  axe: { ranged: false, burst: 1, burstGap: 0, charge: 0.3, speed: 0.6, damage: 0.8, kind: 'shard', throws: true, melee: 1.1 },
  flail: { ranged: false, burst: 3, burstGap: 0.08, charge: 0.3, speed: 0.8, damage: 0.35, kind: 'shard', throws: true, melee: 1 },
  glove: { ranged: false, burst: 1, burstGap: 0, charge: 0, speed: 1, damage: 0, kind: 'bolt', throws: false, melee: 1.15 },
  paddle: { ranged: false, burst: 1, burstGap: 0, charge: 0, speed: 1, damage: 0, kind: 'bolt', throws: false, melee: 1 },
};

/**
 * Close range (owner, 25 Oct: "the monsters can't reach me, I realised I couldn't die"): the old >= 6 m stand-off
 * and 3-attacker cap are gone. Bodies now get right up to contact (`minDist`, just outside the camera) and up to
 * `maxClose` swing at once. What keeps it fair is the PROXIMITY SLOWDOWN below: they wade in slower and slower.
 */
export const CLOSE = { minDist: 1.8, maxClose: 6 } as const;

/** PROXIMITY SLOWDOWN: full speed beyond `from` metres, easing down to `min` of it at contact. */
export const PROXIMITY = { from: 8, min: 0.35 } as const;

/** Speed factor for a body `dist` metres from the player whose contact distance is `contact`. */
export function approachK(dist: number, contact: number): number {
  const u = Math.min(1, Math.max(0, (dist - contact) / Math.max(0.01, PROXIMITY.from - contact)));
  const s = u * u * (3 - 2 * u);
  return PROXIMITY.min + (1 - PROXIMITY.min) * s;
}

/** Weighted pick of a cast index from those `free` (indices into CAST); `r` in [0,1). Returns -1 if none. */
export function pickCast(free: readonly number[], r: number): number {
  let total = 0;
  for (const i of free) total += CAST[i].weight;
  if (!free.length || total <= 0) return -1;
  let x = r * total;
  for (const i of free) {
    x -= CAST[i].weight;
    if (x < 0) return i;
  }
  return free[free.length - 1];
}

/** Contact distance for a body of scale `size`: CLOSE.minDist plus room for its bulk (so it never fills the camera). */
export const standOff = (size: number) => CLOSE.minDist + Math.max(0, size - 1) * 0.6;

/**
 * Hold a body at least `min` metres (on the ground plane) from the player at (cx, cz), and never beside or
 * behind them: anything inside is pushed straight out, away from the player, into the space in front (-z).
 * Writes into `out` ([x, z]) and returns true if it moved. No allocation.
 */
export function holdOut(x: number, z: number, cx: number, cz: number, min: number, out: [number, number]): boolean {
  let dx = x - cx;
  let dz = z - cz;
  // keep them in front: nothing level with or behind the camera
  if (dz > -min * 0.5) dz = -min * 0.5;
  const d = Math.hypot(dx, dz);
  if (d >= min && dz === z - cz) {
    out[0] = x;
    out[1] = z;
    return false;
  }
  if (d < 1e-4) {
    dx = 0;
    dz = -1;
  }
  const k = Math.max(min, d) / Math.max(1e-4, Math.hypot(dx, dz));
  out[0] = cx + dx * k;
  out[1] = cz + dz * k;
  return true;
}
