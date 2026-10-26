/**
 * TERRORNODE levels as TEAM MODE plays them: the co-op wave numbers, enemy kinds and boss per level, and the name
 * for the lobby. Kept apart from src/lib/terrornode/levels.ts (palettes, solo windows, copy, progress) so the team
 * page and the game server only carry these few numbers; the full table is lazy-loaded where it is drawn.
 */
export type LevelId = 'assault' | 'market' | 'rails' | 'datacore' | 'heart';

export type TeamLevel = {
  name: string;
  waves: number;
  /** Enemies in wave n: base + perWave * n. */
  base: number;
  perWave: number;
  /** Speed (m/s) at wave 1 and per wave, HP multiplier. */
  speed: number;
  speedPerWave: number;
  hpK: number;
  /** Enemy kinds (index into the scene's horde skins) and their weights. */
  kinds: number[];
  /** The last wave brings a boss: one huge Erobot with this much HP. */
  bossHp?: number;
};

export const TEAM_LEVELS: Record<LevelId, TeamLevel> = {
  // the original team mode, unchanged: 10 waves of 4 + 3n
  assault: { name: 'ASSAULT ON TERRORNODE', waves: 10, base: 4, perWave: 3, speed: 2.4, speedPerWave: 0.25, hpK: 1, kinds: [0, 1, 2, 3, 4] },
  market: { name: 'NEON MARKET', waves: 5, base: 6, perWave: 3, speed: 3.0, speedPerWave: 0.3, hpK: 0.8, kinds: [0, 1, 1, 3] },
  rails: { name: 'ROOFTOP RAILS', waves: 6, base: 5, perWave: 3, speed: 3.4, speedPerWave: 0.3, hpK: 0.9, kinds: [2, 3, 4] },
  datacore: { name: 'DATA CORE', waves: 7, base: 6, perWave: 4, speed: 2.6, speedPerWave: 0.22, hpK: 1.2, kinds: [4, 2, 0] },
  heart: { name: 'TERRORNODE HEART', waves: 8, base: 6, perWave: 4, speed: 2.8, speedPerWave: 0.28, hpK: 1.3, kinds: [0, 1, 2, 3, 4], bossHp: 4000 },
};

export const isLevelId = (s: unknown): s is LevelId => typeof s === 'string' && Object.prototype.hasOwnProperty.call(TEAM_LEVELS, s);
export const teamLevelOf = (id: unknown): TeamLevel => (isLevelId(id) ? TEAM_LEVELS[id] : TEAM_LEVELS.assault);
/** Enemies in team-mode wave `n` (1-based) for a level. */
export const teamWaveSize = (l: TeamLevel, n: number) => Math.round(l.base + l.perWave * n);
