/** Block Hopper encounter rules, pure so they can be tested without WebGL: enemy contact, the reorg wall, respawns. */
import type { Enemy, Level } from './level';
import { P, type Hero, type Plat } from './sim';

export type Contact = 'none' | 'stomp' | 'dash' | 'hurt';

export const enemyBox = (e: Pick<Enemy, 'x' | 'y'>) => ({ x0: e.x - 0.62, x1: e.x + 0.62, y0: e.y, y1: e.y + 1.25 });

/** What happens when the hero overlaps an enemy: a dash kills, a fall onto its top stomps, anything else hurts (unless invulnerable). */
export function classifyContact(h: Pick<Hero, 'x' | 'y' | 'vy' | 'dashT'>, e: Pick<Enemy, 'x' | 'y'>, inv: number): Contact {
  const b = enemyBox(e);
  if (!(h.x + P.HW > b.x0 && h.x - P.HW < b.x1 && h.y < b.y1 && h.y + P.H > b.y0)) return 'none';
  if (h.dashT > 0) return 'dash';
  if (h.vy < 0 && h.y > e.y + 0.55) return 'stomp';
  return inv > 0 ? 'none' : 'hurt';
}

/** The wall's next position: it creeps faster with distance, waits out its grace, and never trails more than 58 m. */
export function advanceWall(waveX: number, heroX: number, maxX: number, grace: number, dt: number) {
  let x = waveX;
  let g = grace;
  if (g > 0) g -= dt;
  else {
    const diff = Math.min(1, maxX / 1800);
    let spd = 3.7 + diff * 5.2;
    if (heroX - x > 34) spd *= 0.15;
    x += spd * dt;
  }
  if (heroX - x > 58) x = heroX - 58;
  return { waveX: x, grace: g };
}

export const caughtByWall = (heroX: number, waveX: number) => heroX - P.HW < waveX + 0.3;

/** Where a hero who lost a life to the wall or a pit goes back on the chain. */
export function respawnSpot(level: Level, why: 'wall' | 'pit', safe: { plat: Plat; x: number } | null, waveX: number, heroX: number): { plat: Plat; x: number } | null {
  if (why === 'pit' && safe && safe.plat.solid && level.plats.includes(safe.plat)) return safe;
  const p = level.platAt(Math.max(waveX + 26, heroX));
  if (!p) return null;
  return { plat: p, x: Math.min(p.x1 - 1.5, Math.max(p.x0 + 2, waveX + 26)) };
}
