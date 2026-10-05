/** Grid world for a Double-O Kweg level: collision, doors, line of sight and BFS paths. */
import { DOORS, LOW, SIZE, SOLID, type Level } from './levels';

export type Door = { x: number; z: number; open: number; locked: boolean; alongX: boolean };

export class Grid {
  w: number;
  h: number;
  rows: string[];
  doors = new Map<string, Door>();

  constructor(public level: Level) {
    this.rows = level.map;
    this.w = this.rows[0].length;
    this.h = this.rows.length;
    this.rows.forEach((r, z) =>
      [...r].forEach((c, x) => {
        if (!DOORS.has(c)) return;
        const alongX = this.ch(x - 1, z) === '#' && this.ch(x + 1, z) === '#';
        this.doors.set(`${x},${z}`, { x, z, open: 0, locked: c === 'Q', alongX });
      }),
    );
  }

  ch(x: number, z: number) {
    return this.rows[z]?.[x] ?? '#';
  }
  cell(px: number, pz: number): [number, number] {
    return [Math.floor(px / SIZE), Math.floor(pz / SIZE)];
  }
  centre(x: number, z: number) {
    return { x: (x + 0.5) * SIZE, z: (z + 0.5) * SIZE };
  }
  find(c: string) {
    const out: [number, number][] = [];
    this.rows.forEach((r, z) => [...r].forEach((k, x) => k === c && out.push([x, z])));
    return out;
  }

  /** Blocks movement at world point. */
  solidAt(px: number, pz: number) {
    const [x, z] = this.cell(px, pz);
    const c = this.ch(x, z);
    if (SOLID.has(c)) return true;
    const d = DOORS.has(c) ? this.doors.get(`${x},${z}`) : undefined;
    return Boolean(d && d.open < 0.85);
  }
  /** Blocks sight / bullets (low furniture does not). */
  opaqueAt(px: number, pz: number) {
    const [x, z] = this.cell(px, pz);
    const c = this.ch(x, z);
    if (c === '#') return true;
    const d = DOORS.has(c) ? this.doors.get(`${x},${z}`) : undefined;
    return Boolean(d && d.open < 0.6);
  }
  isLow(px: number, pz: number) {
    const [x, z] = this.cell(px, pz);
    return LOW.has(this.ch(x, z));
  }

  los(ax: number, az: number, bx: number, bz: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const n = Math.ceil(Math.hypot(dx, dz) / 0.35);
    for (let i = 1; i < n; i++) if (this.opaqueAt(ax + (dx * i) / n, az + (dz * i) / n)) return false;
    return true;
  }

  passable(x: number, z: number) {
    const c = this.ch(x, z);
    if (SOLID.has(c)) return false;
    const d = this.doors.get(`${x},${z}`);
    return !(d && d.locked);
  }

  /** Next cell on the shortest path from a to b (4-way), or null. */
  nextStep(a: [number, number], b: [number, number], maxNodes = 600): [number, number] | null {
    if (a[0] === b[0] && a[1] === b[1]) return null;
    const key = (x: number, z: number) => z * this.w + x;
    const prev = new Map<number, number>();
    prev.set(key(a[0], a[1]), -1);
    const q: [number, number][] = [a];
    let seen = 0;
    while (q.length && seen++ < maxNodes) {
      const [x, z] = q.shift()!;
      if (x === b[0] && z === b[1]) {
        let k = key(x, z);
        let p = prev.get(k)!;
        while (p !== key(a[0], a[1]) && p !== -1) {
          k = p;
          p = prev.get(k)!;
        }
        return [k % this.w, Math.floor(k / this.w)];
      }
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const nz = z + dz;
        const k = key(nx, nz);
        if (prev.has(k) || !this.passable(nx, nz)) continue;
        prev.set(k, key(x, z));
        q.push([nx, nz]);
      }
    }
    return null;
  }

  /** A random walkable cell within `r` steps of `from`. */
  wander(from: [number, number], r: number): [number, number] {
    const out: [number, number][] = [];
    const seen = new Set([from.join()]);
    let frontier = [from];
    for (let d = 0; d < r; d++) {
      const next: [number, number][] = [];
      for (const [x, z] of frontier)
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const c: [number, number] = [x + dx, z + dz];
          if (seen.has(c.join()) || !this.passable(c[0], c[1]) || this.doors.has(c.join())) continue;
          seen.add(c.join());
          next.push(c);
          out.push(c);
        }
      frontier = next;
    }
    return out.length ? out[Math.floor(Math.random() * out.length)] : from;
  }
}
