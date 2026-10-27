/**
 * AI NPG GIRLS in team mode (27 Oct, owner approved): the server fills the empty NPG seats with bots, up to the team
 * size, so a lone player or a pair still fights as a five-girl squad (the solo squad's rule, now multiplayer).
 *
 *  - Bots are ordinary players in the match flagged `bot: true` (publicState), always on the NPG side, never host,
 *    never on the Erobotz side, with a girl's name and no identity key (no paymail ever shows).
 *  - A real player joining takes a bot's seat: `withSeatFor` parks every bot, lets the human join on the human-only
 *    balance, then re-seats bots only up to the team size (so one bot leaves).
 *  - Bots earn nothing: their shots carry no txid (match.ts `shoot` ignores one anyway), `confirmTx` ignores them,
 *    and their kills add to the side's frags but never to their own score.
 *  - Cheap: `stepBots` thinks at BOT_HZ (5 a second, not the 20 Hz tick) with simple steering: keep a formation slot
 *    beside the nearest human, face and shoot the nearest Erobot (or Erobotz player in PvP) in range.
 * Pure logic, no I/O: server/terrornode-team/server.ts calls it.
 */
import { MAX_PLAYERS, TICK_HZ, move, seatBot, shoot, type Match, type Player } from './match';

/** NPG seats bots fill up to (you + 4, like the solo squad). Env TEAM_BOTS on the server overrides; 0 = off. */
export const BOT_TEAM_SIZE = 5;
/** How often bots think (Hz). */
export const BOT_HZ = 5;
/** Erobots further than this (m) are left alone. */
export const BOT_RANGE = 32;
/** The Tripo NPG rigged girls in public/terrornode/squad (the solo squad's bodies). */
export const BOT_GIRLS = [
  { slug: 'aika', name: 'Aika' },
  { slug: 'ayumi', name: 'Ayumi' },
  { slug: 'kazuyo', name: 'Kazuyo' },
  { slug: 'kimiko', name: 'Kimiko' },
  { slug: 'nao', name: 'Nao' },
] as const;
/** The girl slug for a bot's name (the client picks her model by it). */
export const girlOf = (name: string) => BOT_GIRLS.find((g) => g.name === name)?.slug ?? null;

/** Formation slots round the leader, in her frame: x to the side, z ahead (+) or behind (-). */
const SLOTS: [number, number][] = [
  [-2.2, 0.8],
  [2.2, 0.8],
  [-4, -1],
  [4, -1],
  [0, 2.5],
  [-6, -2],
  [6, -2],
];

const isHuman = (p: Player) => !p.bot;
export const botsOf = (m: Match) => [...m.players.values()].filter((p) => p.bot);
/** NPG humans holding a seat (connected or inside the reconnect grace). */
const npgHumans = (m: Match) => [...m.players.values()].filter((p) => isHuman(p) && p.team === 'npg').length;
const anyoneHere = (m: Match) => [...m.players.values()].some((p) => isHuman(p) && p.connected);

let seq = 0;

/**
 * Top the NPG side up to `size` with bots (or trim it). No connected human, a finished match, or size 0: no bots at
 * all (so an empty match still idles out and ends). Returns true when the roster changed.
 */
export function fillBots(m: Match, size: number, now: number, parked: Player[] = []): boolean {
  const bots = botsOf(m);
  const want = m.phase === 'over' || !anyoneHere(m) || size <= 0 ? 0 : Math.max(0, Math.min(size, MAX_PLAYERS) - npgHumans(m));
  let changed = false;
  // trim: the newest bots leave first
  for (let i = bots.length - 1; i >= want; i--) {
    m.players.delete(bots[i].id);
    changed = true;
  }
  let have = Math.min(bots.length, want);
  while (have < want) {
    const used = new Set(botsOf(m).map((b) => b.name));
    const back = parked.shift();
    const girl = BOT_GIRLS.find((g) => !used.has(g.name)) ?? BOT_GIRLS[have % BOT_GIRLS.length];
    const b = seatBot(m, { id: `bot${++seq}`, name: back?.name ?? girl.name, now }, back);
    if (!b) break;
    have++;
    changed = true;
  }
  return changed;
}

/**
 * Run a human roster change (join, side pick) as if the bots were not there, then re-seat them up to `size`: the
 * human takes a bot's seat and balance is decided on humans only. Parked bots keep their place and kills.
 */
export function withSeatFor<T>(m: Match, size: number, now: number, f: () => T): T {
  const parked = botsOf(m);
  for (const b of parked) m.players.delete(b.id);
  try {
    return f();
  } finally {
    fillBots(m, size, now, parked);
  }
}

const near = (p: Player, x: number, z: number) => Math.hypot(p.x - x, p.z - z);
/** Yaw that looks from (x,z) at (tx,tz): yaw 0 faces -Z (match.ts dirOf). */
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** One think for every bot (call every tick; it runs at BOT_HZ). */
export function stepBots(m: Match, now: number) {
  if (m.phase !== 'live' || m.tick % Math.max(1, Math.round(TICK_HZ / BOT_HZ)) !== 0) return;
  const bots = botsOf(m);
  if (!bots.length) return;
  const humans = [...m.players.values()].filter((p) => isHuman(p) && p.alive && p.connected && p.team === 'npg');
  const foes = m.mode === 'pvp' ? [...m.players.values()].filter((p) => p.alive && p.team === 'erobotz') : m.enemies;
  bots.forEach((b, i) => {
    if (!b.alive) return;
    // cover the nearest human: hold a slot beside her
    let lead: Player | null = null;
    for (const h of humans) if (!lead || near(h, b.x, b.z) < near(lead, b.x, b.z)) lead = h;
    let [tx, tz] = [b.x, b.z];
    if (lead) {
      const [sx, sz] = SLOTS[i % SLOTS.length];
      const [c, s] = [Math.cos(lead.yaw), Math.sin(lead.yaw)];
      // her right is (cos, -sin), her forward is (-sin, -cos)
      tx = lead.x + sx * c - sz * s;
      tz = lead.z - sx * s - sz * c;
    }
    // the nearest foe in range
    let foe: { x: number; z: number } | null = null;
    let fd = BOT_RANGE;
    for (const e of foes) {
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (d < fd) [fd, foe] = [d, e];
    }
    const d = Math.hypot(tx - b.x, tz - b.z);
    const yaw = foe ? yawTo(b.x, b.z, foe.x, foe.z) + (m.rand() - 0.5) * 0.06 : d > 0.5 ? yawTo(b.x, b.z, tx, tz) : lead ? lead.yaw : b.yaw;
    if (d > 0.4) {
      const k = Math.min(1, (6 / BOT_HZ) / d); // 6 m/s, under the speed clamp
      move(m, b.id, b.x + (tx - b.x) * k, b.z + (tz - b.z) * k, yaw, now);
    } else move(m, b.id, b.x, b.z, yaw, now);
    if (foe) shoot(m, b.id, yaw, null, now);
  });
}
