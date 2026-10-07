/**
 * Token Rally multiplayer glue (rooms: src/lib/racemp). The track is generated from the stage seed, so every client
 * drives the same road: a room is "which stage". A pilot's car is a profile (name, car, colour). Wire format for 's':
 *   p = best distance along the stage (monotone), v = speed, f = flags, a = [x, y, z, cos(yaw), sin(yaw), pitch, roll].
 * Nothing here moves money: fuel, nitro, drift and checkpoint txs stay per player (src/lib/rally/spend.ts).
 */
import type { StageId } from './stages';

export type RallyCfg = { stage: StageId };
export const RALLY_STAGES: StageId[] = ['forest', 'desert', 'snow'];
export const validateRallyCfg = (c: unknown): RallyCfg | null => {
  const s = (c as { stage?: string } | null)?.stage;
  return s && (RALLY_STAGES as string[]).includes(s) ? { stage: s as StageId } : null;
};

/** Driver paints: [id, name, base, accent, trim]. */
export const DRIVER_COLOURS: { id: string; name: string; base: string; accent: string; trim: string }[] = [
  { id: 'red', name: 'RED', base: '#d81b2a', accent: '#ffffff', trim: '#101010' },
  { id: 'blue', name: 'BLUE', base: '#1e5bd8', accent: '#ffd23f', trim: '#ffffff' },
  { id: 'yellow', name: 'YELLOW', base: '#f5b700', accent: '#101010', trim: '#101010' },
  { id: 'green', name: 'GREEN', base: '#1f9a4a', accent: '#ffffff', trim: '#101010' },
  { id: 'orange', name: 'ORANGE', base: '#ff6a00', accent: '#101010', trim: '#ffffff' },
  { id: 'purple', name: 'PURPLE', base: '#7a2be2', accent: '#7ae7ff', trim: '#ffffff' },
  { id: 'white', name: 'WHITE', base: '#f2f2ee', accent: '#d81b2a', trim: '#101010' },
  { id: 'black', name: 'BLACK', base: '#16161b', accent: '#d4a843', trim: '#ffffff' },
];
export const driverColour = (id: string) => DRIVER_COLOURS.find((c) => c.id === id) ?? DRIVER_COLOURS[0];

/** Snapshot channel clamps: x, y, z, cos, sin, pitch, roll. */
export const RALLY_CHANNELS: [number, number][] = [
  [-30000, 30000],
  [-500, 3000],
  [-30000, 30000],
  [-1, 1],
  [-1, 1],
  [-1.6, 1.6],
  [-1.6, 1.6],
];
/** Fastest a rally car can possibly go (m/s), for the snapshot sanity clamp. */
export const RALLY_VCAP = 110;
/** Flag bits. */
export const FL_NITRO = 1;
export const FL_DRY = 2;
export const FL_DONE = 32;
