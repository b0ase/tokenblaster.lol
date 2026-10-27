/**
 * TERRORNODE LEVELS (owner, 26 Oct 2026: "more levels, each with its own layout, lighting, enemy mix and wave
 * pattern, a boss on the last one"). Pure data and progress logic: no three.js, no DOM, so the page, the engine,
 * the team server and the tests all share it without growing anyone's bundle.
 *
 * Story (owner, 27 Oct): the Ninja Punk Girls storm the centre of the nSLAVE corporation to free Dr Kweg Wong from his
 * own inventions, the Erobotz (Act 1, STORM THE NODE: street to core), then fight out with him, protecting him as he keeps running the wrong way (Act 2, ESCAPE FROM
 * TERRORNODE: the roof). Market and Centre are Act 1 windows, Way Up and Way Out are Act 2.
 *
 *   0 ASSAULT          the full ten-minute block (street -> floors -> core -> roof, the Liquid Unit). Always open.
 *   1 NEON MARKET      the street turned night market: stalls, lanterns, rusher swarms in pulses.
 *   2 ROOFTOP RAILS    the roof under the maglev line: rails, pylons, flankers riding in on the trains.
 *   3 DATA CORE        the server shaft drowned in green code: shooters hold the racks, jam the core.
 *   4 TERRORNODE HEART the reactor heart on the roof: everything at once, then the Liquid Unit at level 3.
 *
 * Solo levels are windows of the same seamless route the block walks (`from`..`to` seconds of the block clock), so
 * every set, enemy and boss is the engine's own; a level adds its palette, its dressing (lazy-loaded geometry,
 * ./dressing.ts), its enemy mix and its wave pattern. Team mode plays the same levels on its arena (`team`).
 */

import { TEAM_LEVELS, isLevelId, teamWaveSize, type LevelId, type TeamLevel } from '../teammode/levels';

export type { LevelId, TeamLevel };
export { isLevelId, teamWaveSize };

export type Palette = {
  /** Fog colour, density and the sky. */
  fog: string;
  density: number;
  bg: string;
  /** Tone-mapping exposure and bloom on top of the engine's own (added). */
  exposure: number;
  bloom: number;
  /** The key neon of the level (dressing, HUD accents, team-mode hemisphere light). */
  key: string;
  /** A second neon. */
  rim: string;
};

/** How the swarm arrives: `steady` holds the live count, `pulse` surges every `every` s for `len` s, `surge` ramps up across the level. */
export type WavePattern = { kind: 'steady' | 'pulse' | 'surge'; k: number; every?: number; len?: number; amp?: number };

export type SoloLevel = {
  /** Block clock window (seconds): the stage sets this level walks. */
  from: number;
  to: number;
  /** The Liquid Unit walks in at this second (Heart only); the level clears on the rescue. */
  bossAt?: number;
  bossLevel?: number;
  /** Erobot role mix (shooter / rusher / flanker, sums to 1). */
  roles: { shooter: number; rusher: number; flanker: number };
  /** Arena monster weights by kind id (TUNING.horde.kinds); a missing kind keeps its stock weight, 0 removes it. */
  horde: Partial<Record<'raptor' | 'minion' | 'zombie' | 'zombiewarrior' | 'hazmat' | 'eyebeast' | 'helldemon', number>>;
  wave: WavePattern;
  /** Erobot level offset on top of the stage's own. */
  levelUp: number;
};


export type Level = {
  id: LevelId;
  n: number;
  name: string;
  /** One line for the level select. */
  blurb: string;
  /** Dr Kweg Wong's line when the level clears. */
  kweg: string;
  palette: Palette;
  solo: SoloLevel;
  team: TeamLevel;
  /** The finale: a boss or set-piece. */
  boss: boolean;
};

export const LEVELS: readonly Level[] = [
  {
    id: 'assault',
    n: 0,
    name: 'WELCOME TO TERRORNODE',
    blurb: 'The full ten-minute block. Act 1: storm the node to the core. Act 2: protect him past the Liquid Unit (he runs the wrong way).',
    kweg: 'You walked the whole block. I am almost impressed.',
    palette: { fog: '#071420', density: 0.0066, bg: '#05060f', exposure: 0, bloom: 0, key: '#27e6ff', rim: '#ff2bd6' },
    solo: { from: 0, to: 600, roles: { shooter: 0.42, rusher: 0.32, flanker: 0.26 }, horde: {}, wave: { kind: 'steady', k: 1 }, levelUp: 0 },
    team: TEAM_LEVELS.assault,
    boss: true,
  },
  {
    id: 'market',
    n: 1,
    name: 'nSLAVE MARKET',
    blurb: 'Act 1. The night market outside the nSLAVE tower. Stalls, lanterns and rushers coming in waves.',
    kweg: 'You ruined a perfectly good night market. The dumplings were mine.',
    palette: { fog: '#2a0f1c', density: 0.011, bg: '#12040c', exposure: 0.08, bloom: 0.08, key: '#ff9a2b', rim: '#ff2b8a' },
    solo: {
      from: 0,
      to: 140,
      roles: { shooter: 0.25, rusher: 0.55, flanker: 0.2 },
      horde: { minion: 6, raptor: 4, zombie: 2, helldemon: 0, hazmat: 0.5 },
      wave: { kind: 'pulse', k: 1.05, every: 18, len: 6, amp: 0.7 },
      levelUp: 0,
    },
    team: TEAM_LEVELS.market,
    boss: false,
  },
  {
    id: 'rails',
    n: 2,
    name: 'THE WAY UP',
    blurb: 'Act 2. Get him up to the roof (he keeps running the wrong way), under the maglev line. Flankers ride in on the trains.',
    kweg: 'Those trains ran on time for forty years. Until you.',
    palette: { fog: '#140a2e', density: 0.0095, bg: '#07041a', exposure: 0.04, bloom: 0.06, key: '#9b5cff', rim: '#2be9ff' },
    solo: {
      from: 430,
      to: 515,
      roles: { shooter: 0.25, rusher: 0.2, flanker: 0.55 },
      horde: { raptor: 6, eyebeast: 3, minion: 2, zombie: 1, helldemon: 0 },
      wave: { kind: 'pulse', k: 1, every: 12, len: 4, amp: 0.9 },
      levelUp: 0,
    },
    team: TEAM_LEVELS.rails,
    boss: false,
  },
  {
    id: 'datacore',
    n: 3,
    name: 'THE CENTRE',
    blurb: 'Act 1. The core at the centre of nSLAVE, where he is chained. Shooters hold the racks.',
    kweg: 'Untied at last. Do you know what a petabyte of grudges weighs? Carry me anyway.',
    palette: { fog: '#03180f', density: 0.014, bg: '#010a06', exposure: 0.02, bloom: 0.1, key: '#2bff8a', rim: '#d4ff2b' },
    solo: {
      from: 300,
      to: 425,
      roles: { shooter: 0.62, rusher: 0.18, flanker: 0.2 },
      horde: { hazmat: 3, eyebeast: 3, zombiewarrior: 3, raptor: 1, minion: 1, helldemon: 0.3 },
      wave: { kind: 'surge', k: 0.9, amp: 0.6 },
      levelUp: 1,
    },
    team: TEAM_LEVELS.datacore,
    boss: false,
  },
  {
    id: 'heart',
    n: 4,
    name: 'THE WAY OUT',
    blurb: 'Act 2. The roof and the helipad. Everything at once, then the Liquid Unit at full strength.',
    kweg: 'We are out. Please put me down. Gently. I am peer-reviewed.',
    palette: { fog: '#2a0508', density: 0.0105, bg: '#120203', exposure: 0.06, bloom: 0.12, key: '#ff2a3a', rim: '#ffb21a' },
    solo: {
      from: 455,
      to: 600,
      bossAt: 485,
      bossLevel: 3,
      roles: { shooter: 0.38, rusher: 0.34, flanker: 0.28 },
      horde: { helldemon: 1.4, zombiewarrior: 3, hazmat: 2, raptor: 3 },
      wave: { kind: 'surge', k: 1.1, amp: 0.5 },
      levelUp: 1,
    },
    team: TEAM_LEVELS.heart,
    boss: true,
  },
  {
    // MELEE (26 Oct): the TERRORNODE PLAZA, team mode's 64-player arena round the tower (src/lib/teammode/arena.ts).
    // Always open; from the solo page it plays as a one-player co-op match on the plaza (team mode's engine).
    id: 'melee',
    n: 5,
    name: 'TERRORNODE MELEE',
    blurb: 'The plaza round the tower: three terraces, 64 players, a horde sized to the crowd, then the Tower Core.',
    kweg: 'Sixty-four of you. On my plaza. I am calling the council about this.',
    palette: { fog: '#0a1026', density: 0.0042, bg: '#04050f', exposure: 0.06, bloom: 0.1, key: '#27e6ff', rim: '#ff2a6a' },
    solo: { from: 455, to: 600, roles: { shooter: 0.38, rusher: 0.34, flanker: 0.28 }, horde: {}, wave: { kind: 'surge', k: 1.1, amp: 0.5 }, levelUp: 1 },
    team: TEAM_LEVELS.melee,
    boss: true,
  },
];

/** Team-mode arenas that are not windows of the solo block (MELEE): open to everyone, played by team mode's engine. */
export const isArenaLevel = (id: LevelId) => levelOf(id).team.arena === 'melee';
/** The solo route into an arena level: a one-player co-op match on it. */
export const soloArenaHref = (id: LevelId) => `/arcade/terrornode/team?level=${id}&solo=1`;

export const LEVEL_IDS = LEVELS.map((l) => l.id);
/** The campaign track (ASSAULT, the block, is open on its own and not part of it). */
export const CAMPAIGN: readonly LevelId[] = ['market', 'rails', 'datacore', 'heart'];

export const levelOf = (id: unknown): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[0];

/** The level after `id` in the campaign, or null at the end (and for ASSAULT, whose next is the first campaign level). */
export function nextLevel(id: LevelId): LevelId | null {
  if (id === 'assault') return CAMPAIGN[0];
  const i = CAMPAIGN.indexOf(id);
  return i >= 0 && i < CAMPAIGN.length - 1 ? CAMPAIGN[i + 1] : null;
}

/** The horde's live-count multiplier at `t` seconds into a level that lasts `len` seconds. */
export function waveK(w: WavePattern, t: number, len: number): number {
  if (w.kind === 'steady') return w.k;
  if (w.kind === 'surge') return w.k * (1 + (w.amp ?? 0.5) * Math.min(1, Math.max(0, t / Math.max(1, len))));
  const every = Math.max(1, w.every ?? 15);
  const inPulse = t % every < (w.len ?? 4);
  return w.k * (inPulse ? 1 + (w.amp ?? 0.6) : 1);
}


// ── Progress (stored locally) ────────────────────────────────────────────────────

export type LevelBest = { score: number; rounds: number; clears: number; at: number };
export type Progress = { v: 1; reached: LevelId[]; best: Partial<Record<LevelId, LevelBest>> };
export const PROGRESS_KEY = 'tn-levels:v1';

export const freshProgress = (): Progress => ({ v: 1, reached: ['assault', CAMPAIGN[0]], best: {} });

/** Parse whatever was stored; anything broken or tampered falls back to a fresh start (never throws). */
export function parseProgress(raw: string | null | undefined): Progress {
  const p = freshProgress();
  if (!raw) return p;
  try {
    const j = JSON.parse(raw) as Partial<Progress>;
    if (j && j.v === 1) {
      for (const id of Array.isArray(j.reached) ? j.reached : []) if (isLevelId(id) && !p.reached.includes(id)) p.reached.push(id);
      for (const [id, b] of Object.entries(j.best ?? {})) {
        if (!isLevelId(id) || !b) continue;
        const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
        p.best[id] = { score: n(b.score), rounds: n(b.rounds), clears: n(b.clears), at: n(b.at) };
      }
    }
  } catch {
    /* fresh */
  }
  // a reached level implies every campaign level before it
  const last = Math.max(...p.reached.map((id) => CAMPAIGN.indexOf(id)));
  for (let i = 0; i <= last; i++) if (!p.reached.includes(CAMPAIGN[i])) p.reached.push(CAMPAIGN[i]);
  p.reached.sort((a, b) => levelOf(a).n - levelOf(b).n);
  return p;
}

export const isReached = (p: Progress, id: LevelId) => p.reached.includes(id);

/** A level cleared with this score and round count: keep the best, open the next. Returns a new object. */
export function recordClear(p: Progress, id: LevelId, score: number, rounds: number, now = Date.now()): Progress {
  const q: Progress = { v: 1, reached: [...p.reached], best: { ...p.best } };
  const was = q.best[id];
  q.best[id] = {
    score: Math.max(was?.score ?? 0, Math.max(0, Math.floor(score))),
    rounds: Math.max(was?.rounds ?? 0, Math.max(0, Math.floor(rounds))),
    clears: (was?.clears ?? 0) + 1,
    at: now,
  };
  const nx = nextLevel(id);
  if (nx && !q.reached.includes(nx)) q.reached.push(nx);
  q.reached.sort((a, b) => levelOf(a).n - levelOf(b).n);
  return q;
}

type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
const store = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
export function loadProgress(s: Store | null = store()): Progress {
  try {
    return parseProgress(s?.getItem(PROGRESS_KEY));
  } catch {
    return freshProgress();
  }
}
export function saveProgress(p: Progress, s: Store | null = store()) {
  try {
    s?.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}
