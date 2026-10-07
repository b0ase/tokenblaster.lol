/**
 * Satoshi City: the map. A 5×5 grid of two-way roads (4×4 city blocks) on an island, with
 * traffic-light intersections, a harbour wall round the edge, and the buildings' footprints for
 * collision. Pure data and geometry helpers: no Three.js here.
 */

export const P = 70; // road grid pitch (m)
export const N = 5; // roads per axis
export const HALF_ROAD = 5; // carriageway half-width
export const LANE = 2.5; // lane centre offset from the road centre line (drive on the right)
export const INT = 8; // stop line distance from an intersection centre
export const SIDEWALK = 3.5;
export const CURB_H = 0.2;
export const EDGE = ((N - 1) / 2) * P + HALF_ROAD; // outer edge of the ring road
export const BOUND = EDGE + 10; // harbour wall
export const nodeCoord = (i: number) => (i - (N - 1) / 2) * P;

export type Box = { x0: number; x1: number; z0: number; z1: number; h: number };
export type LotKind = 'glass' | 'solid' | 'shop';
export type Lot = Box & { kind: LotKind; mat: number; seed: number };
export type Block = { i: number; j: number; x0: number; x1: number; z0: number; z1: number; type: 'city' | 'square' | 'parking'; lots: Lot[] };

/** Seeded PRNG so the city is the same every visit. */
export function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const SQUARE = { i: 1, j: 2 }; // Satoshi Square: plaza + fountain
export const PARKING = { i: 2, j: 1 }; // a car park full of things to steal

export function makeBlocks(): Block[] {
  const r = rng(2009);
  const blocks: Block[] = [];
  for (let i = 0; i < N - 1; i++)
    for (let j = 0; j < N - 1; j++) {
      const x0 = nodeCoord(i) + HALF_ROAD;
      const x1 = nodeCoord(i + 1) - HALF_ROAD;
      const z0 = nodeCoord(j) + HALF_ROAD;
      const z1 = nodeCoord(j + 1) - HALF_ROAD;
      const type = i === SQUARE.i && j === SQUARE.j ? 'square' : i === PARKING.i && j === PARKING.j ? 'parking' : 'city';
      const b: Block = { i, j, x0, x1, z0, z1, type, lots: [] };
      if (type === 'city') {
        const ix0 = x0 + SIDEWALK;
        const ix1 = x1 - SIDEWALK;
        const iz0 = z0 + SIDEWALK;
        const iz1 = z1 - SIDEWALK;
        const centre = 1 - Math.max(Math.abs(i - 1.5), Math.abs(j - 1.5)) / 1.5; // 1 downtown, 0 at the edge
        const split = r();
        const cells: [number, number, number, number][] = [];
        const ALLEY = 3.5;
        if (split < 0.25) cells.push([ix0, ix1, iz0, iz1]);
        else if (split < 0.65) {
          if (r() < 0.5) {
            const m = ix0 + (ix1 - ix0) * (0.4 + r() * 0.2);
            cells.push([ix0, m - ALLEY / 2, iz0, iz1], [m + ALLEY / 2, ix1, iz0, iz1]);
          } else {
            const m = iz0 + (iz1 - iz0) * (0.4 + r() * 0.2);
            cells.push([ix0, ix1, iz0, m - ALLEY / 2], [ix0, ix1, m + ALLEY / 2, iz1]);
          }
        } else {
          const mx = ix0 + (ix1 - ix0) * (0.4 + r() * 0.2);
          const mz = iz0 + (iz1 - iz0) * (0.4 + r() * 0.2);
          cells.push(
            [ix0, mx - ALLEY / 2, iz0, mz - ALLEY / 2],
            [mx + ALLEY / 2, ix1, iz0, mz - ALLEY / 2],
            [ix0, mx - ALLEY / 2, mz + ALLEY / 2, iz1],
            [mx + ALLEY / 2, ix1, mz + ALLEY / 2, iz1],
          );
        }
        for (const [a, bb, c, d] of cells) {
          const inset = r() * 1.2;
          const shop = r() < 0.18;
          const h = shop ? 7 + r() * 6 : 12 + r() * (18 + 75 * centre) + (cells.length === 1 ? 20 * centre : 0);
          const kind: LotKind = shop ? 'shop' : h > 38 && r() < 0.6 ? 'glass' : 'solid';
          b.lots.push({ x0: a + inset, x1: bb - inset, z0: c + inset, z1: d - inset, h, kind, mat: Math.floor(r() * 6), seed: Math.floor(r() * 1e6) });
        }
      }
      blocks.push(b);
    }
  return blocks;
}

/** Fountain in Satoshi Square (solid for collision). */
export function squareCentre(): [number, number] {
  return [(nodeCoord(SQUARE.i) + nodeCoord(SQUARE.i + 1)) / 2, (nodeCoord(SQUARE.j) + nodeCoord(SQUARE.j + 1)) / 2];
}

/** Everything solid: building footprints, the fountain, the harbour wall. */
export function solidBoxes(blocks: Block[]): Box[] {
  const out: Box[] = [];
  for (const b of blocks) for (const l of b.lots) out.push(l);
  const [fx, fz] = squareCentre();
  out.push({ x0: fx - 6.6, x1: fx + 6.6, z0: fz - 6.6, z1: fz + 6.6, h: 1 });
  // the four raised planters round the monument
  for (const qx of [-1, 1]) for (const qz of [-1, 1]) out.push({ x0: fx + qx * 18 - 6, x1: fx + qx * 18 + 6, z0: fz + qz * 18 - 6, z1: fz + qz * 18 + 6, h: 0.8 });
  const W = 2;
  out.push(
    { x0: -BOUND - W, x1: BOUND + W, z0: -BOUND - W, z1: -BOUND, h: 1.2 },
    { x0: -BOUND - W, x1: BOUND + W, z0: BOUND, z1: BOUND + W, h: 1.2 },
    { x0: -BOUND - W, x1: -BOUND, z0: -BOUND, z1: BOUND, h: 1.2 },
    { x0: BOUND, x1: BOUND + W, z0: -BOUND, z1: BOUND, h: 1.2 },
  );
  return out;
}

/** Height of the walkable surface: kerbs lift blocks and the promenade above the road. */
export function groundY(x: number, z: number): number {
  if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return CURB_H;
  const fx = (((x - nodeCoord(0)) % P) + P) % P;
  const fz = (((z - nodeCoord(0)) % P) + P) % P;
  return fx > HALF_ROAD && fx < P - HALF_ROAD && fz > HALF_ROAD && fz < P - HALF_ROAD ? CURB_H : 0;
}

/** Push a circle out of a box. Returns the push normal and depth, or null. */
export function circleBox(x: number, z: number, r: number, b: Box): { nx: number; nz: number; d: number } | null {
  const cx = Math.max(b.x0, Math.min(b.x1, x));
  const cz = Math.max(b.z0, Math.min(b.z1, z));
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, d: r - d };
  }
  // Centre inside: leave by the nearest face.
  const opts = [
    { nx: -1, nz: 0, d: x - b.x0 + r },
    { nx: 1, nz: 0, d: b.x1 - x + r },
    { nx: 0, nz: -1, d: z - b.z0 + r },
    { nx: 0, nz: 1, d: b.z1 - z + r },
  ];
  return opts.reduce((m, o) => (o.d < m.d ? o : m));
}

/** First hit (0..1) of segment a→b against the boxes (2D), padded by pad; 1 if clear. */
export function segmentHit(ax: number, az: number, bx: number, bz: number, boxes: Box[], pad = 0.3): number {
  let best = 1;
  const dx = bx - ax;
  const dz = bz - az;
  for (const b of boxes) {
    let t0 = 0;
    let t1 = best;
    const slab = (o: number, d: number, lo: number, hi: number) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      return t0 <= t1;
    };
    if (slab(ax, dx, b.x0 - pad, b.x1 + pad) && slab(az, dz, b.z0 - pad, b.z1 + pad) && t0 < best) best = t0;
  }
  return best;
}

// ── Road graph for traffic ──
export type Edge = { id: number; a: number; b: number; dx: number; dz: number; axis: 'x' | 'z' };
export const nodeXZ = (n: number): [number, number] => [nodeCoord(Math.floor(n / N)), nodeCoord(n % N)];
export function makeEdges(): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const a = i * N + j;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        edges.push({ id: edges.length, a, b: ni * N + nj, dx: di, dz: dj, axis: di ? 'x' : 'z' });
      }
    }
  return edges;
}
/** Point on an edge at distance s from its start node, in its right-hand lane. */
export function edgePoint(e: Edge, s: number): [number, number] {
  const [ax, az] = nodeXZ(e.a);
  // Right of travel direction d is (-dz, dx).
  return [ax + e.dx * s - e.dz * LANE, az + e.dz * s + e.dx * LANE];
}

/** Traffic light state for traffic travelling along `axis` at node (i, j). */
export const LIGHT_CYCLE = 22;
export function lightState(node: number, axis: 'x' | 'z', t: number): 'g' | 'a' | 'r' {
  const i = Math.floor(node / N);
  const j = node % N;
  const ph = (((t + i * 7 + j * 3) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  if (axis === 'x') return ph < 9 ? 'g' : ph < 11 ? 'a' : 'r';
  return ph >= 11 && ph < 20 ? 'g' : ph >= 20 ? 'a' : 'r';
}

/** A random spot on a sidewalk (for mission pickups and drop-offs). */
export function sidewalkSpot(blocks: Block[], r: () => number): [number, number] {
  const b = blocks[Math.floor(r() * blocks.length)];
  const side = Math.floor(r() * 4);
  const t = 0.15 + r() * 0.7;
  const m = SIDEWALK / 2;
  if (side === 0) return [b.x0 + (b.x1 - b.x0) * t, b.z0 + m];
  if (side === 1) return [b.x0 + (b.x1 - b.x0) * t, b.z1 - m];
  if (side === 2) return [b.x0 + m, b.z0 + (b.z1 - b.z0) * t];
  return [b.x1 - m, b.z0 + (b.z1 - b.z0) * t];
}
