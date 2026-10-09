/**
 * Content packs: data-only tracks and ships that contributors add under `content/<game>/...` without touching engine
 * code. This file is the single source of truth for the pack format and its limits. It is pure (no fs, no three.js) so
 * the game, the `pnpm content:check` script and the tests all use the same rules.
 */

export const PACK_FORMAT = 1;

/** Licences a contributed pack may use (NOTICE.md). CC-BY-4.0 needs a `credit` line. */
export const LICENCES = ['own-work-CC0', 'CC0', 'CC-BY-4.0', 'MIT'] as const;
export type Licence = (typeof LICENCES)[number];

/** Soundtracks a track may pick (existing in-site stations, see src/lib/sfx.ts). */
export const MUSIC = ['bracer', 'city', 'arena', 'doubleo', 'gun', 'hopper', 'invaders', 'snake', 'frogger'] as const;
export type Music = (typeof MUSIC)[number];
/** Backdrop family for a track's environment art (optional; default megacity). */
export const SCENERY = ['megacity', 'canyon', 'orbital'] as const;
export type Scenery = (typeof SCENERY)[number];

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** Every number limit in one place (CONTRIBUTING.md quotes these). */
export const LIMITS = {
  jsonBytes: 64 * 1024,
  glbBytes: 1.5 * 1024 * 1024,
  imageBytes: 300 * 1024,
  creditsBytes: 8 * 1024,
  name: 32,
  description: 240,
  author: 48,
  credit: 160,
  kana: 12,
  code: 10,
  /** Control-point layout. */
  points: [8, 200] as const,
  coord: 2500,
  height: [0, 600] as const,
  bankDeg: 60,
  /** Ring layout. */
  radius: [500, 1400] as const,
  oval: [0.5, 1] as const,
  harmonics: 8,
  heightWaves: 8,
  drops: 4,
  /** Features. */
  loops: 3,
  loopRadius: [40, 90] as const,
  loopShift: [0, 40] as const,
  corkscrews: 4,
  corkscrewTurns: 2,
  tunnels: 6,
  halfPipes: 4,
  jumps: 8,
  boostPads: 16,
  pickups: 10,
  lane: 12,
  pitLen: [0.03, 0.12] as const,
  signs: 4,
  signText: 20,
  /** Built lap length, metres. */
  lapLen: [4000, 12000] as const,
  /** Ship stats. */
  vmax: [160, 182] as const,
  accel: [40, 54] as const,
  turn: [62, 90] as const,
  grip: [2.3, 3.1] as const,
  /** Sum of the four stats normalised to 0..1 each; no ship may max everything. */
  statBudget: 3.3,
  span: [3, 6] as const,
  length: [4.5, 7.5] as const,
  sweep: [0, 1] as const,
  ticker: 8,
};

/** Files a pack folder may contain besides its json. Anything else fails the check. */
export const TRACK_FILES = ['track.json', 'CREDITS.md', 'README.md', 'preview.png', 'preview.jpg'];
export const SHIP_FILES = ['ship.json', 'model.glb', 'CREDITS.md', 'README.md', 'preview.png', 'preview.jpg'];

export type Palette = { zenith: string; horizon: string; glow: string; fog: string; a1: string; a2: string; sun: string; fogDensity: number };

export type TrackPack = {
  format: 1;
  name: string;
  author: string;
  licence: Licence;
  credit?: string;
  description: string;
  kana?: string;
  code?: string;
  /** Menu order (lower first). */
  order?: number;
  seed: number;
  layout:
    | { type: 'ring'; radius: number; oval: number; harmonics: [number, number, number][]; base: number; heightWaves: [number, number, number][]; drops: [number, number, number][] }
    | { type: 'points'; points: { x: number; y: number; z: number; bank?: number }[] };
  features: {
    loops?: { at: number; radius: number; shift: number }[];
    corkscrews?: { from: number; to: number; turns: number }[];
    tunnels?: [number, number][];
    halfPipes?: [number, number][];
    jumps?: number[];
    boostPads?: { at: number; lane: number }[];
    pickups?: number[];
    pit: [number, number];
  };
  theme: { palette: Palette; signs?: string[]; music?: Music; scenery?: Scenery };
  par?: { lapSeconds?: number; raceSeconds?: number };
};

export type ShipPack = {
  format: 1;
  name: string;
  author: string;
  licence: Licence;
  credit?: string;
  description: string;
  order?: number;
  stats: { vmax: number; accel: number; turn: number; grip: number };
  hull: { span: number; length: number; sweep: number };
  livery?: { base?: string; accent?: string; trim?: string; ticker?: string; number?: number };
  model?: 'model.glb';
};

export type Result<T> = { ok: true; value: T; errors: [] } | { ok: false; value: null; errors: string[] };

// ── tiny validator ──

class V {
  errors: string[] = [];
  constructor(private file: string) {}
  err(path: string, msg: string) {
    this.errors.push(`${this.file}: ${path || '(root)'} ${msg}`);
  }
  obj(x: unknown, path: string, keys: string[]): Record<string, unknown> | null {
    if (!x || typeof x !== 'object' || Array.isArray(x)) {
      this.err(path, 'must be an object');
      return null;
    }
    for (const k of Object.keys(x)) if (!keys.includes(k)) this.err(path ? `${path}.${k}` : k, `is not a known field (allowed: ${keys.join(', ')})`);
    return x as Record<string, unknown>;
  }
  str(x: unknown, path: string, max: number, opt = false, re?: RegExp, reMsg?: string): string | undefined {
    if (x === undefined && opt) return undefined;
    if (typeof x !== 'string' || !x.trim()) return void this.err(path, 'must be a non-empty string');
    if (x.length > max) this.err(path, `must be at most ${max} characters (got ${x.length})`);
    if (re && !re.test(x)) this.err(path, reMsg ?? `has an invalid format`);
    return x;
  }
  num(x: unknown, path: string, lo: number, hi: number, opt = false): number | undefined {
    if (x === undefined && opt) return undefined;
    if (typeof x !== 'number' || !Number.isFinite(x)) return void this.err(path, 'must be a number');
    if (x < lo || x > hi) this.err(path, `must be between ${lo} and ${hi} (got ${x})`);
    return x;
  }
  int(x: unknown, path: string, lo: number, hi: number, opt = false) {
    const n = this.num(x, path, lo, hi, opt);
    if (n !== undefined && !Number.isInteger(n)) this.err(path, 'must be a whole number');
    return n;
  }
  arr(x: unknown, path: string, max: number, min = 0, opt = true): unknown[] {
    if (x === undefined && opt) return [];
    if (!Array.isArray(x)) return this.err(path, 'must be a list'), [];
    if (x.length > max) this.err(path, `may have at most ${max} entries (got ${x.length})`);
    if (x.length < min) this.err(path, `needs at least ${min} entries (got ${x.length})`);
    return x;
  }
  colour(x: unknown, path: string, opt = false) {
    return this.str(x, path, 7, opt, /^#[0-9a-fA-F]{6}$/, 'must be a hex colour like "#27e6ff"');
  }
  range(x: unknown, path: string, minLen = 0.01): [number, number] | undefined {
    const a = this.arr(x, path, 2, 2, false);
    if (a.length !== 2) return undefined;
    const lo = this.num(a[0], `${path}[0]`, 0, 1);
    const hi = this.num(a[1], `${path}[1]`, 0, 1);
    if (lo === undefined || hi === undefined) return undefined;
    if (hi - lo < minLen) this.err(path, `must run forward and span at least ${minLen} of the lap ([start, end] as fractions 0..1)`);
    return [lo, hi];
  }
  triple(x: unknown, path: string, lims: [number, number][]): [number, number, number] {
    const a = this.arr(x, path, 3, 3, false);
    return [0, 1, 2].map((i) => this.num(a[i], `${path}[${i}]`, lims[i][0], lims[i][1]) ?? 0) as [number, number, number];
  }
}

/** Strings must not point anywhere off-site: packs are data only. */
const URL_RE = /(https?:|ftp:|data:|javascript:|\/\/|www\.)/i;
function scanUrls(x: unknown, path: string, v: V) {
  if (typeof x === 'string') {
    if (URL_RE.test(x)) v.err(path, 'must not contain a URL or external link (packs are data only)');
  } else if (Array.isArray(x)) x.forEach((y, i) => scanUrls(y, `${path}[${i}]`, v));
  else if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) scanUrls(y, path ? `${path}.${k}` : k, v);
}

function common(v: V, o: Record<string, unknown>) {
  if (o.format !== PACK_FORMAT) v.err('format', `must be ${PACK_FORMAT}`);
  v.str(o.name, 'name', LIMITS.name);
  v.str(o.author, 'author', LIMITS.author);
  v.str(o.description, 'description', LIMITS.description);
  if (!LICENCES.includes(o.licence as Licence)) v.err('licence', `must be one of ${LICENCES.join(', ')} (got ${JSON.stringify(o.licence)})`);
  v.str(o.credit, 'credit', LIMITS.credit, o.licence !== 'CC-BY-4.0');
  v.int(o.order, 'order', 0, 9999, true);
  scanUrls(o, '', v);
}

const TRACK_KEYS = ['format', 'name', 'author', 'licence', 'credit', 'description', 'kana', 'code', 'order', 'seed', 'layout', 'features', 'theme', 'par'];

export function validateTrackPack(json: unknown, file = 'track.json'): Result<TrackPack> {
  const v = new V(file);
  const o = v.obj(json, '', TRACK_KEYS);
  if (!o) return { ok: false, value: null, errors: v.errors };
  common(v, o);
  v.str(o.kana, 'kana', LIMITS.kana, true);
  v.str(o.code, 'code', LIMITS.code, true, /^[A-Z0-9-]+$/, 'must be capitals, digits and dashes');
  v.int(o.seed, 'seed', 0, 1_000_000);
  // Layout.
  const L = v.obj(o.layout, 'layout', ['type', 'radius', 'oval', 'harmonics', 'base', 'heightWaves', 'drops', 'points']);
  let ctrlCount = 64;
  if (L) {
    if (L.type === 'ring') {
      for (const k of ['points']) if (k in L) v.err(`layout.${k}`, 'is only for "points" layouts');
      v.num(L.radius, 'layout.radius', ...LIMITS.radius);
      v.num(L.oval, 'layout.oval', ...LIMITS.oval);
      v.num(L.base, 'layout.base', 60, 400);
      v.arr(L.harmonics, 'layout.harmonics', LIMITS.harmonics, 1, false).forEach((h, i) => v.triple(h, `layout.harmonics[${i}]`, [[1, 12], [0, 0.3], [-7, 7]]));
      v.arr(L.heightWaves, 'layout.heightWaves', LIMITS.heightWaves, 0, false).forEach((h, i) => v.triple(h, `layout.heightWaves[${i}]`, [[1, 12], [0, 40], [-7, 7]]));
      v.arr(L.drops, 'layout.drops', LIMITS.drops, 0, false).forEach((h, i) => v.triple(h, `layout.drops[${i}]`, [[0, 6.3], [0, 90], [0.05, 0.4]]));
    } else if (L.type === 'points') {
      for (const k of ['radius', 'oval', 'harmonics', 'base', 'heightWaves', 'drops']) if (k in L) v.err(`layout.${k}`, 'is only for "ring" layouts');
      const pts = v.arr(L.points, 'layout.points', LIMITS.points[1], LIMITS.points[0], false);
      ctrlCount = pts.length;
      pts.forEach((p, i) => {
        const q = v.obj(p, `layout.points[${i}]`, ['x', 'y', 'z', 'bank']);
        if (!q) return;
        v.num(q.x, `layout.points[${i}].x`, -LIMITS.coord, LIMITS.coord);
        v.num(q.z, `layout.points[${i}].z`, -LIMITS.coord, LIMITS.coord);
        v.num(q.y, `layout.points[${i}].y`, ...LIMITS.height);
        v.num(q.bank, `layout.points[${i}].bank`, -LIMITS.bankDeg, LIMITS.bankDeg, true);
      });
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i] as { x?: number; z?: number; y?: number };
        const b = pts[(i + 1) % pts.length] as { x?: number; z?: number; y?: number };
        if (typeof a?.x !== 'number' || typeof b?.x !== 'number') continue;
        const d = Math.hypot((b.x ?? 0) - a.x, (b.y ?? 0) - (a.y ?? 0), (b.z ?? 0) - (a.z ?? 0));
        if (d < 30) v.err(`layout.points[${i}]`, `is only ${d.toFixed(1)} m from the next point (keep points at least 30 m apart)`);
        if (d > 900) v.err(`layout.points[${i}]`, `is ${d.toFixed(0)} m from the next point (keep points at most 900 m apart)`);
      }
    } else v.err('layout.type', 'must be "ring" or "points"');
  }
  // Features.
  const F = v.obj(o.features, 'features', ['loops', 'corkscrews', 'tunnels', 'halfPipes', 'jumps', 'boostPads', 'pickups', 'pit']);
  if (F) {
    const atSeen = new Set<number>();
    v.arr(F.loops, 'features.loops', LIMITS.loops).forEach((l, i) => {
      const p = `features.loops[${i}]`;
      const q = v.obj(l, p, ['at', 'radius', 'shift']);
      if (!q) return;
      const at = v.int(q.at, `${p}.at`, 1, ctrlCount - 2);
      if (at !== undefined && [...atSeen].some((s) => Math.abs(s - at) < 4)) v.err(`${p}.at`, 'is too close to another loop (4+ control points apart)');
      if (at !== undefined) atSeen.add(at);
      v.num(q.radius, `${p}.radius`, ...LIMITS.loopRadius);
      v.num(q.shift, `${p}.shift`, ...LIMITS.loopShift);
    });
    v.arr(F.corkscrews, 'features.corkscrews', LIMITS.corkscrews).forEach((c, i) => {
      const p = `features.corkscrews[${i}]`;
      const q = v.obj(c, p, ['from', 'to', 'turns']);
      if (!q) return;
      const a = v.num(q.from, `${p}.from`, 0, 1);
      const b = v.num(q.to, `${p}.to`, 0, 1);
      if (a !== undefined && b !== undefined && (b - a < 0.05 || b - a > 0.2)) v.err(p, 'must span 0.05 to 0.2 of the lap (from < to)');
      const t = v.int(q.turns, `${p}.turns`, -LIMITS.corkscrewTurns, LIMITS.corkscrewTurns);
      if (t === 0) v.err(`${p}.turns`, 'must not be 0');
    });
    v.arr(F.tunnels, 'features.tunnels', LIMITS.tunnels).forEach((r, i) => v.range(r, `features.tunnels[${i}]`));
    v.arr(F.halfPipes, 'features.halfPipes', LIMITS.halfPipes).forEach((r, i) => v.range(r, `features.halfPipes[${i}]`, 0.03));
    v.arr(F.jumps, 'features.jumps', LIMITS.jumps).forEach((j, i) => v.num(j, `features.jumps[${i}]`, 0, 1));
    v.arr(F.pickups, 'features.pickups', LIMITS.pickups).forEach((j, i) => v.num(j, `features.pickups[${i}]`, 0, 1));
    v.arr(F.boostPads, 'features.boostPads', LIMITS.boostPads).forEach((b, i) => {
      const q = v.obj(b, `features.boostPads[${i}]`, ['at', 'lane']);
      if (!q) return;
      v.num(q.at, `features.boostPads[${i}].at`, 0, 1);
      v.num(q.lane, `features.boostPads[${i}].lane`, -LIMITS.lane, LIMITS.lane);
    });
    const pit = v.range(F.pit, 'features.pit', LIMITS.pitLen[0]);
    if (pit && pit[1] - pit[0] > LIMITS.pitLen[1]) v.err('features.pit', `may span at most ${LIMITS.pitLen[1]} of the lap`);
  }
  // Theme.
  const T = v.obj(o.theme, 'theme', ['palette', 'signs', 'music', 'scenery']);
  if (T) {
    const P = v.obj(T.palette, 'theme.palette', ['zenith', 'horizon', 'glow', 'fog', 'a1', 'a2', 'sun', 'fogDensity']);
    if (P) {
      for (const k of ['zenith', 'horizon', 'glow', 'fog', 'a1', 'a2', 'sun']) v.colour(P[k], `theme.palette.${k}`);
      v.num(P.fogDensity, 'theme.palette.fogDensity', 0.0005, 0.002);
    }
    v.arr(T.signs, 'theme.signs', LIMITS.signs).forEach((s, i) => v.str(s, `theme.signs[${i}]`, LIMITS.signText, false, /^[A-Za-z0-9 $!?.,:/&#'-]+$/, 'may use letters, digits, spaces and $!?.,:/&#\'- only'));
    if (T.music !== undefined && !MUSIC.includes(T.music as Music)) v.err('theme.music', `must be one of ${MUSIC.join(', ')}`);
    if (T.scenery !== undefined && !SCENERY.includes(T.scenery as Scenery)) v.err('theme.scenery', `must be one of ${SCENERY.join(', ')}`);
  }
  if (o.par !== undefined) {
    const P = v.obj(o.par, 'par', ['lapSeconds', 'raceSeconds']);
    if (P) {
      v.num(P.lapSeconds, 'par.lapSeconds', 15, 300, true);
      v.num(P.raceSeconds, 'par.raceSeconds', 45, 900, true);
    }
  }
  return v.errors.length ? { ok: false, value: null, errors: v.errors } : { ok: true, value: o as TrackPack, errors: [] };
}

const SHIP_KEYS = ['format', 'name', 'author', 'licence', 'credit', 'description', 'order', 'stats', 'hull', 'livery', 'model'];

export const statScore = (s: { vmax: number; accel: number; turn: number; grip: number }) => {
  const n = (x: number, [lo, hi]: readonly [number, number]) => (x - lo) / (hi - lo);
  return n(s.vmax, LIMITS.vmax) + n(s.accel, LIMITS.accel) + n(s.turn, LIMITS.turn) + n(s.grip, LIMITS.grip);
};

export function validateShipPack(json: unknown, file = 'ship.json'): Result<ShipPack> {
  const v = new V(file);
  const o = v.obj(json, '', SHIP_KEYS);
  if (!o) return { ok: false, value: null, errors: v.errors };
  common(v, o);
  const S = v.obj(o.stats, 'stats', ['vmax', 'accel', 'turn', 'grip']);
  if (S) {
    const vm = v.num(S.vmax, 'stats.vmax', ...LIMITS.vmax);
    const ac = v.num(S.accel, 'stats.accel', ...LIMITS.accel);
    const tu = v.num(S.turn, 'stats.turn', ...LIMITS.turn);
    const gr = v.num(S.grip, 'stats.grip', ...LIMITS.grip);
    if (vm !== undefined && ac !== undefined && tu !== undefined && gr !== undefined) {
      const sc = statScore({ vmax: vm, accel: ac, turn: tu, grip: gr });
      if (sc > LIMITS.statBudget + 1e-9) v.err('stats', `are over budget: ${sc.toFixed(2)} of ${LIMITS.statBudget} (each stat scores 0 at its minimum and 1 at its maximum; trade one off against another)`);
    }
  }
  const H = v.obj(o.hull, 'hull', ['span', 'length', 'sweep']);
  if (H) {
    v.num(H.span, 'hull.span', ...LIMITS.span);
    v.num(H.length, 'hull.length', ...LIMITS.length);
    v.num(H.sweep, 'hull.sweep', ...LIMITS.sweep);
  }
  if (o.livery !== undefined) {
    const Lv = v.obj(o.livery, 'livery', ['base', 'accent', 'trim', 'ticker', 'number']);
    if (Lv) {
      for (const k of ['base', 'accent', 'trim']) v.colour(Lv[k], `livery.${k}`, true);
      v.str(Lv.ticker, 'livery.ticker', LIMITS.ticker, true, /^[A-Z0-9$]+$/, 'must be capitals, digits or $');
      v.int(Lv.number, 'livery.number', 1, 99, true);
    }
  }
  if (o.model !== undefined && o.model !== 'model.glb') v.err('model', 'must be "model.glb" (the file next to ship.json) or left out');
  return v.errors.length ? { ok: false, value: null, errors: v.errors } : { ok: true, value: o as ShipPack, errors: [] };
}

/** Checks a pack folder's file list (name -> bytes) and the first bytes of model.glb if any. */
export function checkPackFiles(kind: 'track' | 'ship', slug: string, files: Record<string, number>, glbHead?: Uint8Array): string[] {
  const out: string[] = [];
  const where = `content/bracer/${kind}s/${slug}`;
  if (!SLUG_RE.test(slug)) out.push(`${where}: folder name must be 3-32 lowercase letters, digits or dashes (it becomes the track/ship id)`);
  const allowed = kind === 'track' ? TRACK_FILES : SHIP_FILES;
  const main = `${kind}.json`;
  if (!(main in files)) out.push(`${where}: missing ${main}`);
  for (const [f, bytes] of Object.entries(files)) {
    if (!allowed.includes(f)) {
      out.push(`${where}/${f}: unexpected file (allowed: ${allowed.join(', ')})`);
      continue;
    }
    const max = f.endsWith('.json') ? LIMITS.jsonBytes : f === 'model.glb' ? LIMITS.glbBytes : f.endsWith('.md') ? LIMITS.creditsBytes : LIMITS.imageBytes;
    if (bytes > max) out.push(`${where}/${f}: ${(bytes / 1024).toFixed(0)} KB is over the ${(max / 1024).toFixed(0)} KB limit`);
  }
  if ('model.glb' in files) {
    const magic = glbHead && glbHead.length >= 4 ? String.fromCharCode(...glbHead.slice(0, 4)) : '';
    if (magic !== 'glTF') out.push(`${where}/model.glb: is not a binary glTF (.glb) file`);
  }
  return out;
}
