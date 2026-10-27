/**
 * TERRORNODE levels as TEAM MODE plays them: the co-op wave numbers, enemy kinds and boss per level, and the name
 * for the lobby. Kept apart from src/lib/terrornode/levels.ts (palettes, solo windows, copy, progress) so the team
 * page and the game server only carry these few numbers; the full table is lazy-loaded where it is drawn.
 */
import type { ArenaId } from './arena';

export type LevelId = 'assault' | 'market' | 'rails' | 'datacore' | 'heart' | 'melee';

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
  /** The last wave brings a boss: one huge Erobotz unit with this much HP. */
  bossHp?: number;
  /** Where it is fought: the street (default) or the TERRORNODE PLAZA (./arena.ts). */
  arena?: ArenaId;
  /** The boss's name on the HUD and the spectator view. */
  bossName?: string;
};

export const TEAM_LEVELS: Record<LevelId, TeamLevel> = {
  // the original team mode, unchanged: 10 waves of 4 + 3n
  assault: { name: 'WELCOME TO TERRORNODE', waves: 10, base: 4, perWave: 3, speed: 2.4, speedPerWave: 0.25, hpK: 1, kinds: [0, 1, 2, 3, 4] },
  market: { name: 'nSLAVE MARKET', waves: 5, base: 6, perWave: 3, speed: 3.0, speedPerWave: 0.3, hpK: 0.8, kinds: [0, 1, 1, 3] },
  rails: { name: 'THE WAY UP', waves: 6, base: 5, perWave: 3, speed: 3.4, speedPerWave: 0.3, hpK: 0.9, kinds: [2, 3, 4] },
  datacore: { name: 'THE CENTRE', waves: 7, base: 6, perWave: 4, speed: 2.6, speedPerWave: 0.22, hpK: 1.2, kinds: [4, 2, 0] },
  heart: { name: 'THE WAY OUT', waves: 8, base: 6, perWave: 4, speed: 2.8, speedPerWave: 0.28, hpK: 1.3, kinds: [0, 1, 2, 3, 4], bossHp: 4000, bossName: 'TERRORNODE HEART' },
  // the big one (owner, 26 Oct): the plaza round the tower, built for 64 players and a live stream. Waves scale with
  // the head count (teamWaveFor), then the TOWER CORE walks out of the tower door with HP to match the crowd.
  melee: { name: 'TERRORNODE MELEE', waves: 8, base: 8, perWave: 4, speed: 3.0, speedPerWave: 0.25, hpK: 1.1, kinds: [0, 1, 2, 3, 4], bossHp: 6000, arena: 'melee', bossName: 'TERRORNODE TOWER CORE' },
};

export const isLevelId = (s: unknown): s is LevelId => typeof s === 'string' && Object.prototype.hasOwnProperty.call(TEAM_LEVELS, s);
export const teamLevelOf = (id: unknown): TeamLevel => (isLevelId(id) ? TEAM_LEVELS[id] : TEAM_LEVELS.assault);
/** Enemies in team-mode wave `n` (1-based) for a level. */
export const teamWaveSize = (l: TeamLevel, n: number) => Math.round(l.base + l.perWave * n);

/**
 * Crowd scaling (big matches): how much bigger the horde, the live cap and the boss get for `n` players. One to four
 * players play the level as written; past that the waves grow a little under linearly (64 players: ~10.6x the
 * enemies of a 4-player squad) and the boss HP a little under linearly (64 players: ~34x).
 */
export const crowdK = (n: number) => Math.pow(Math.max(1, n) / 4, 0.85);
export const teamWaveFor = (l: TeamLevel, wave: number, players: number) => Math.round(teamWaveSize(l, wave) * Math.max(1, crowdK(players)));
export const bossHpFor = (l: TeamLevel, players: number) => (l.bossHp ? Math.round(l.bossHp * Math.pow(Math.max(1, players), 0.85)) : 0);
/** Live Erobots on the field at once: 40 for a squad, up to 160 for a full 64. */
export const enemyCapFor = (players: number) => Math.min(160, 40 + Math.max(0, players - 4) * 2);
