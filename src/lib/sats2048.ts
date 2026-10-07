/**
 * Sat Stack 2048: the sliding-tile merge puzzle (game design by Gabriele Cirulli's 2048, MIT) with
 * sat-denomination tiles. Pure game logic, no React: tiles carry stable ids so the UI can animate
 * slides and merges. See public/arcade/2048/CREDITS.md.
 */
export const SIZE = 4;
export type Dir = 'left' | 'right' | 'up' | 'down';
export type Tile = { id: number; r: number; c: number; v: number; fresh?: boolean; merged?: boolean; gone?: boolean };
export type MoveResult = { tiles: Tile[]; moved: boolean; gained: number; won: boolean };

/** Tier names, by tile value: the stack of sats grows into the whole coin. */
export const TIERS: Record<number, string> = {
  2: 'dust',
  4: 'sat',
  8: 'stack',
  16: 'coin',
  32: 'bag',
  64: 'chest',
  128: 'vault',
  256: 'whale',
  512: 'miner',
  1024: 'node',
  2048: '1 BSV',
  4096: 'teranode',
  8192: 'satoshi',
  16384: '21M',
};
export const GOAL = 2048;

export type Rng = () => number;

let nextId = 1;
export const freshId = () => nextId++;

export function emptyCells(tiles: Tile[]): [number, number][] {
  const used = new Set(tiles.filter((t) => !t.gone).map((t) => t.r * SIZE + t.c));
  const out: [number, number][] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!used.has(r * SIZE + c)) out.push([r, c]);
  return out;
}

/** Drop one new tile (90% 2, 10% 4) on a random empty cell. */
export function addRandom(tiles: Tile[], rng: Rng = Math.random): Tile[] {
  const cells = emptyCells(tiles);
  if (!cells.length) return tiles;
  const [r, c] = cells[Math.floor(rng() * cells.length)];
  return [...tiles, { id: freshId(), r, c, v: rng() < 0.9 ? 2 : 4, fresh: true }];
}

export function newGame(rng: Rng = Math.random): Tile[] {
  return addRandom(addRandom([], rng), rng);
}

/** Slide and merge in one direction. Absorbed tiles stay in the list as `gone` so the UI can slide them in. */
export function move(tiles: Tile[], dir: Dir, rng: Rng = Math.random): MoveResult {
  const live = tiles.filter((t) => !t.gone).map((t) => ({ ...t, fresh: false, merged: false }));
  const vertical = dir === 'up' || dir === 'down';
  const rev = dir === 'right' || dir === 'down';
  const out: Tile[] = [];
  let moved = false;
  let gained = 0;
  let won = false;
  for (let line = 0; line < SIZE; line++) {
    const row = live.filter((t) => (vertical ? t.c : t.r) === line).sort((a, b) => ((vertical ? a.r - b.r : a.c - b.c) * (rev ? -1 : 1)));
    let pos = 0;
    let last: Tile | null = null;
    for (const t of row) {
      const at = (p: number) => (rev ? SIZE - 1 - p : p);
      if (last && last.v === t.v && !last.merged) {
        // Merge into `last`: the mover slides onto it, then vanishes.
        const lr = last.r;
        const lc = last.c;
        last.v *= 2;
        last.merged = true;
        gained += last.v;
        if (last.v === GOAL) won = true;
        out.push({ ...t, r: lr, c: lc, gone: true });
        moved = true;
        continue;
      }
      const nr = vertical ? at(pos) : line;
      const nc = vertical ? line : at(pos);
      if (nr !== t.r || nc !== t.c) moved = true;
      t.r = nr;
      t.c = nc;
      pos++;
      last = t;
      out.push(t);
    }
  }
  if (!moved) return { tiles, moved: false, gained: 0, won: false };
  return { tiles: addRandom(out, rng), moved: true, gained, won };
}

export function canMove(tiles: Tile[]): boolean {
  const live = tiles.filter((t) => !t.gone);
  if (live.length < SIZE * SIZE) return true;
  const g = new Map(live.map((t) => [t.r * SIZE + t.c, t.v]));
  for (const t of live) {
    if (g.get(t.r * SIZE + t.c + 1) === t.v && t.c < SIZE - 1) return true;
    if (g.get((t.r + 1) * SIZE + t.c) === t.v) return true;
  }
  return false;
}

export const best = (tiles: Tile[]) => tiles.reduce((m, t) => (t.gone ? m : Math.max(m, t.v)), 0);
