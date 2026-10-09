/** Content pack -> engine definitions (pure). The registry that uses these is ./content.ts. */
import type { ShipPack, TrackPack } from '@/lib/content/schema';
import type { ShipSpec } from './sim';
import type { TrackDef } from './track';

const DEG = Math.PI / 180;
/** Packs shipped by the core team keep the launch circuits' menu codes and score boards. */
const CORE_AUTHOR = 'TokenBlaster.lol';

export function trackDefFromPack(slug: string, p: TrackPack): TrackDef {
  const L = p.layout;
  const F = p.features;
  const ring = L.type === 'ring' ? L : null;
  return {
    id: slug,
    name: p.name,
    kana: p.kana ?? '',
    code: p.code ?? 'CP',
    blurb: p.description,
    author: p.author,
    licence: p.licence,
    credit: p.credit,
    core: p.author === CORE_AUTHOR,
    order: p.order ?? 1000,
    seed: p.seed,
    R: ring?.radius ?? 0,
    oval: ring?.oval ?? 1,
    harm: ring?.harmonics ?? [],
    hy: ring?.heightWaves ?? [],
    base: ring?.base ?? 0,
    drops: ring?.drops ?? [],
    points: L.type === 'points' ? L.points.map((q) => ({ x: q.x, y: q.y, z: q.z, bank: (q.bank ?? 0) * DEG })) : undefined,
    loops: (F.loops ?? []).map((l) => ({ k: l.at, r: l.radius, w: l.shift })),
    twists: (F.corkscrews ?? []).map((c) => [c.from, c.to, c.turns]),
    tunnels: F.tunnels ?? [],
    pipes: F.halfPipes ?? [],
    jumps: F.jumps ?? [],
    pads: (F.boostPads ?? []).map((b) => [b.at, b.lane]),
    weapons: F.pickups ?? [],
    pit: F.pit,
    palette: p.theme.palette,
    signs: p.theme.signs ?? [],
    music: p.theme.music ?? 'bracer',
    scenery: p.theme.scenery ?? 'megacity',
    par: p.par,
  };
}

export function shipSpecFromPack(slug: string, p: ShipPack): ShipSpec {
  return {
    id: slug,
    name: p.name,
    blurb: p.description,
    author: p.author,
    licence: p.licence,
    order: p.order ?? 1000,
    vmax: p.stats.vmax,
    accel: p.stats.accel,
    turn: p.stats.turn,
    grip: p.stats.grip,
    span: p.hull.span,
    length: p.hull.length,
    sweep: p.hull.sweep,
    livery: p.livery,
  };
}
