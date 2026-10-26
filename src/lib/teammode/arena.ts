/**
 * TERRORNODE TEAM MODE arenas (pure data + geometry, no three.js): the bounds, spawn points, cover, the tower and the
 * ground height of each arena, shared by the game server (movement, hit rays, spawns) and the renderer (the same
 * cover is drawn where the server blocks shots).
 *
 *  - STREET: the Shooting Gallery's Neo-Tokyo street (every level before MELEE), a 44 x 74 m strip.
 *  - MELEE: the TERRORNODE PLAZA (owner, 26 Oct: "big multiplayer ESCAPE FROM TERRORNODE, lots of people on a live
 *    stream all blasting at once"). A round stadium plaza 156 m across around the TERRORNODE tower: the floor, then
 *    three terraces rising outward on ramps, pillars and barricades for cover, wide sightlines to the tower, 32 spawn
 *    points spread round the rim and 8 horde gates. Room for 64 players without crowding (~19,000 m² of floor, about
 *    300 m² a player).
 */

export type ArenaId = 'street' | 'melee';
export type Side = 'npg' | 'erobotz';
/** A round obstacle: blocks movement and shots (pillars, crates, the tower). `h` is its height for the renderer. */
export type Cover = { x: number; z: number; r: number; h: number; kind: 'pillar' | 'crate' | 'barrier' | 'tower' };
export type Spawn = { x: number; z: number; yaw: number };

export type Arena = {
  id: ArenaId;
  /** Axis-aligned bounds (and, for a round arena, the radius inside them). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  radius: number | null;
  cover: Cover[];
  /** Spawn points per side in PvP, and every point for a co-op squad. */
  spawns: Record<Side, Spawn[]>;
  coop: Spawn[];
  /** Where the horde walks in from. */
  gates: { x: number; z: number }[];
  /** Where the boss walks in (the tower door on MELEE). */
  bossAt: { x: number; z: number };
};

const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));

export const STREET: Arena = {
  id: 'street',
  x0: -22,
  x1: 22,
  z0: -62,
  z1: 12,
  radius: null,
  cover: [],
  spawns: {
    npg: Array.from({ length: 8 }, (_, i) => ({ x: -10.5 + i * 3, z: 8, yaw: 0 })),
    erobotz: Array.from({ length: 8 }, (_, i) => ({ x: -10.5 + i * 3, z: -56, yaw: Math.PI })),
  },
  coop: Array.from({ length: 8 }, (_, i) => ({ x: -10.5 + i * 3, z: 8, yaw: 0 })),
  gates: Array.from({ length: 5 }, (_, i) => ({ x: -16 + i * 8, z: -59 })),
  bossAt: { x: 0, z: -59 },
};

// ── MELEE: the TERRORNODE PLAZA ──
export const MELEE_R = 78;
export const TOWER_R = 9;
/** Terraces: [inner radius, outer radius, height]. Between them a ramp ring rises 1.6 m over 4 m. */
export const TIERS: readonly [number, number, number][] = [
  [0, 34, 0],
  [38, 52, 1.6],
  [56, 66, 3.2],
  [70, MELEE_R, 4.8],
];

function meleeCover(): Cover[] {
  const c: Cover[] = [{ x: 0, z: 0, r: TOWER_R, h: 140, kind: 'tower' }];
  const ring = (n: number, r: number, rad: number, h: number, kind: Cover['kind'], off = 0) => {
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      c.push({ x: Math.round(Math.sin(a) * r * 100) / 100, z: Math.round(Math.cos(a) * r * 100) / 100, r: rad, h, kind });
    }
  };
  ring(8, 16, 1.2, 9, 'pillar', Math.PI / 8); // the tower's inner colonnade
  ring(12, 26, 1.1, 1.3, 'crate'); // floor barricades
  ring(10, 44, 1.4, 7, 'pillar', Math.PI / 10); // terrace 1 columns
  ring(14, 47.5, 1, 1.2, 'barrier'); // terrace 1 waist-high cover
  ring(16, 61, 1.1, 1.3, 'crate', Math.PI / 16); // terrace 2 crates
  ring(8, 74, 1.6, 10, 'pillar'); // the rim's light masts
  return c;
}

function meleeSpawns(): Record<Side, Spawn[]> {
  // 32 points round the top terrace (r 74), staggered off the masts; PvP: NPG takes the south half, Erobotz the north
  const all = Array.from({ length: 32 }, (_, i) => {
    const a = ((i + 0.5) / 32) * Math.PI * 2;
    const x = Math.round(Math.sin(a) * 73 * 100) / 100;
    const z = Math.round(Math.cos(a) * 73 * 100) / 100;
    return { x, z, yaw: yawTo(x, z, 0, 0), a };
  });
  const south = all.filter((s) => Math.cos(s.a) > 0).map(({ x, z, yaw }) => ({ x, z, yaw }));
  const north = all.filter((s) => Math.cos(s.a) <= 0).map(({ x, z, yaw }) => ({ x, z, yaw }));
  return { npg: south, erobotz: north };
}
const MELEE_SPAWNS = meleeSpawns();

export const MELEE: Arena = {
  id: 'melee',
  x0: -MELEE_R,
  x1: MELEE_R,
  z0: -MELEE_R,
  z1: MELEE_R,
  radius: MELEE_R - 1,
  cover: meleeCover(),
  spawns: MELEE_SPAWNS,
  // co-op: all 32, alternating halves so the first players are spread round the whole rim
  coop: MELEE_SPAWNS.npg.flatMap((s, i) => [s, MELEE_SPAWNS.erobotz[i]]),
  // 8 horde gates: under the rim, between the spawn sectors, plus the 4 tower doors
  gates: [
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      return { x: Math.round(Math.sin(a) * 76 * 100) / 100, z: Math.round(Math.cos(a) * 76 * 100) / 100 };
    }),
    { x: 0, z: -(TOWER_R + 2) },
    { x: 0, z: TOWER_R + 2 },
    { x: TOWER_R + 2, z: 0 },
    { x: -(TOWER_R + 2), z: 0 },
  ],
  bossAt: { x: 0, z: -(TOWER_R + 3) },
};

export const ARENAS: Record<ArenaId, Arena> = { street: STREET, melee: MELEE };
export const arenaById = (id: ArenaId | null | undefined): Arena => (id && ARENAS[id]) || STREET;

/** Ground height at (x, z): the street is flat; the plaza's terraces rise outward on ramps. */
export function heightAt(a: Arena, x: number, z: number): number {
  if (a.id !== 'melee') return 0;
  const r = Math.hypot(x, z);
  for (let i = 0; i < TIERS.length; i++) {
    const [r0, r1, h] = TIERS[i];
    if (r <= r1 && r >= r0) return h;
    const next = TIERS[i + 1];
    if (next && r > r1 && r < next[0]) return h + ((r - r1) / (next[0] - r1)) * (next[2] - h);
  }
  return TIERS[TIERS.length - 1][2];
}

/** Keep a body of radius `br` inside the arena and outside every cover circle. Returns the corrected point. */
export function resolve(a: Arena, x: number, z: number, br = 0.55): { x: number; z: number } {
  x = Math.min(a.x1, Math.max(a.x0, x));
  z = Math.min(a.z1, Math.max(a.z0, z));
  if (a.radius != null) {
    const d = Math.hypot(x, z);
    if (d > a.radius) [x, z] = [(x / d) * a.radius, (z / d) * a.radius];
  }
  for (const c of a.cover) {
    const dx = x - c.x;
    const dz = z - c.z;
    const min = c.r + br;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1e-6;
    const k = min / d;
    [x, z] = d2 > 0 ? [c.x + dx * k, c.z + dz * k] : [c.x + min, c.z];
  }
  return { x, z };
}

/** Distance along a ray (unit dir) to the first cover it hits, or Infinity: cover stops bullets. */
export function coverHit(a: Arena, ox: number, oz: number, dx: number, dz: number, max = Infinity): number {
  let best = max;
  for (const c of a.cover) {
    const fx = c.x - ox;
    const fz = c.z - oz;
    const t = fx * dx + fz * dz;
    if (t < 0 || t - c.r > best) continue;
    const px = fx - dx * t;
    const pz = fz - dz * t;
    const d2 = px * px + pz * pz;
    if (d2 > c.r * c.r) continue;
    const hit = t - Math.sqrt(c.r * c.r - d2);
    if (hit >= 0 && hit < best) best = hit;
  }
  return best;
}
