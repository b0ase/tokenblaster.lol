/**
 * bRacer content registry: every track and ship pack under content/bracer/, bundled at build time through the
 * generated static-import index (src/content/bracer.generated.ts, `pnpm content:index`). Invalid packs are skipped
 * here with a console warning; `pnpm content:check` (and the tests) fail on them before they can merge.
 */
import { SHIP_PACKS, TRACK_PACKS } from '@/content/bracer.generated';
import { validateShipPack, validateTrackPack } from '@/lib/content/schema';
import { shipSpecFromPack, trackDefFromPack } from './packs';
import type { ShipSpec } from './sim';
import type { TrackDef } from './track';

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

export const TRACK_LIST: TrackDef[] = TRACK_PACKS.flatMap(({ slug, json }) => {
  const r = validateTrackPack(json, `content/bracer/tracks/${slug}/track.json`);
  if (!r.ok) {
    console.warn('[bracer] skipping track pack', slug, r.errors);
    return [];
  }
  return [trackDefFromPack(slug, r.value)];
}).sort(byOrder);

export const TRACKS: Record<string, TrackDef> = Object.fromEntries(TRACK_LIST.map((t) => [t.id, t]));

/** Ships in menu order. The first three (Needle, Wedge, Manta) are the core hulls rivals fly. */
export const SHIPS: ShipSpec[] = SHIP_PACKS.flatMap(({ slug, json }) => {
  const r = validateShipPack(json, `content/bracer/ships/${slug}/ship.json`);
  if (!r.ok) {
    console.warn('[bracer] skipping ship pack', slug, r.errors);
    return [];
  }
  return [shipSpecFromPack(slug, r.value)];
}).sort(byOrder);

const CORE_SHIP_IDS = ['needle', 'wedge', 'manta'];
export const CORE_SHIPS: ShipSpec[] = CORE_SHIP_IDS.map((id) => SHIPS.find((s) => s.id === id)).filter((s): s is ShipSpec => Boolean(s));

export const DEFAULT_TRACK = TRACKS.canyon ? 'canyon' : (TRACK_LIST[0]?.id ?? 'canyon');
export const DEFAULT_SHIP = 'wedge';
export const isTrackId = (x: unknown): x is string => typeof x === 'string' && Object.prototype.hasOwnProperty.call(TRACKS, x);
export const isShipId = (x: unknown): x is string => typeof x === 'string' && SHIPS.some((s) => s.id === x);

/** High-score board ids derive from the track slug: bracer-<slug> and bracer-<slug>-hc. */
export const bracerScoreGame = (track: string, hardcore: boolean) => `bracer-${track}${hardcore ? '-hc' : ''}` as const;
