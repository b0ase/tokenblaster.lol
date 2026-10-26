/**
 * TERRORNODE TEAM MODE: the authoritative match (pure logic, no I/O). The websocket server
 * (server/terrornode-team/server.ts) owns one `Match` per code and calls `tick()` at 20 Hz; the browser only
 * sends intents (move, shot) and draws the snapshots it gets back.
 *
 * Two match types:
 *  - 'coop' (PvE): up to 16 players in NPG squads against the Erobot horde, wave after wave.
 *  - 'pvp' (team vs team): NPG (Ninja Punk Girls) vs Erobotz, up to 8 a side, friendly fire off, first to the frag
 *    limit or the most frags when the clock runs out.
 *
 * Positions are client-predicted but clamped here (max speed, arena bounds); hits are decided here by a ray cast
 * from the shooter's server position. A shot only counts when the browser also sent it as a real BSV transaction
 * (the client fires the tx, the server just counts what it is told: `txid` is recorded for the board).
 */

import { isLevelId, teamLevelOf, teamWaveSize, type LevelId } from './levels';

export type Team = 'npg' | 'erobotz';
export type Mode = 'coop' | 'pvp';
export type Phase = 'lobby' | 'live' | 'over';

export const TICK_HZ = 20;
export const MAX_PLAYERS = 16;
export const MAX_PER_SIDE = 8;
export const ARENA = { x0: -22, x1: 22, z0: -62, z1: 12 };
export const SPAWN: Record<Team, { z: number; yaw: number }> = { npg: { z: 8, yaw: 0 }, erobotz: { z: -56, yaw: Math.PI } };
export const RULES = {
  speed: 7.5, // m/s, with slack for latency
  hp: 100,
  shotDamage: 20,
  headRange: 70,
  playerRadius: 0.55,
  enemyRadius: 0.8,
  shotGapMs: 70, // ~14 shots/s max
  respawnMs: 4000,
  enemyHp: 60,
  enemyDps: 14,
  enemyReach: 1.6,
  killScore: 100,
  fragScore: 100,
  fragLimit: 50,
  waves: 10,
  timeLimitMs: 10 * 60_000,
  graceMs: 60_000, // a dropped player keeps their slot this long (reconnect)
  enemyCap: 40,
} as const;

export const TEAM_NAME: Record<Team, string> = { npg: 'NPG', erobotz: 'Erobotz' };

export type Player = {
  id: string;
  name: string;
  identityKey: string | null;
  team: Team;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  kills: number;
  deaths: number;
  score: number;
  shots: number;
  txShots: number;
  lastShot: number;
  lastMove: number;
  connected: boolean;
  droppedAt: number;
  resume: string;
  streamSlot: string | null;
  host: boolean;
};

/** `kind` indexes the scene's horde skins; BOSS_KIND is the level's boss (one huge Erobot on the last wave). */
export type Enemy = { id: number; x: number; z: number; yaw: number; hp: number; kind: number };
export const BOSS_KIND = 9;
export const BOSS_RADIUS = 2.2;

export type GameEvent =
  | { k: 'hit'; by: string; on: string; dmg: number; x: number; z: number }
  | { k: 'kill'; by: string; on: string; x: number; z: number }
  | { k: 'shot'; by: string; x: number; z: number; yaw: number; len: number }
  | { k: 'wave'; n: number }
  | { k: 'spawn'; id: string };

export type Match = {
  id: string;
  code: string;
  tournamentId: string | null;
  mode: Mode;
  /** The TERRORNODE level (src/lib/terrornode/levels.ts): co-op waves, enemy mix and boss; the arena's palette and dressing. */
  level: LevelId;
  phase: Phase;
  createdAt: number;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  players: Map<string, Player>;
  enemies: Enemy[];
  nextEnemy: number;
  wave: number;
  waveLeft: number; // still to spawn this wave
  frags: Record<Team, number>;
  winner: Team | 'squad' | 'horde' | 'draw' | null;
  events: GameEvent[];
  tick: number;
  rand: () => number;
};

const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeCode(rand: () => number, n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ABC[Math.floor(rand() * CODE_ABC.length)];
  return s;
}
export const validCode = (c: string) => /^[A-HJ-NP-Z2-9]{5}$/.test(c);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fin = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const cleanName = (s: unknown) => String(s ?? '').replace(/[^\w .@$-]/g, '').trim().slice(0, 24) || 'Player';

export function createMatch(o: { code: string; mode: Mode; level?: unknown; tournamentId?: string | null; now: number; rand?: () => number }): Match {
  return {
    id: `TN-${o.code}`,
    code: o.code,
    tournamentId: o.tournamentId ? String(o.tournamentId).replace(/[^\w-]/g, '').slice(0, 48) || null : null,
    mode: o.mode,
    level: isLevelId(o.level) ? o.level : 'assault',
    phase: 'lobby',
    createdAt: o.now,
    startedAt: null,
    endsAt: null,
    endedAt: null,
    players: new Map(),
    enemies: [],
    nextEnemy: 1,
    wave: 0,
    waveLeft: 0,
    frags: { npg: 0, erobotz: 0 },
    winner: null,
    events: [],
    tick: 0,
    rand: o.rand ?? Math.random,
  };
}

export const sideCount = (m: Match, t: Team) => [...m.players.values()].filter((p) => p.team === t).length;

/** The side a new player lands on: co-op is all NPG squads; PvP fills the smaller side (ties: the wanted one). */
export function autoSide(m: Match, want?: Team | null): Team | null {
  if (m.mode === 'coop') return m.players.size < MAX_PLAYERS ? 'npg' : null;
  const n = sideCount(m, 'npg');
  const e = sideCount(m, 'erobotz');
  if (n >= MAX_PER_SIDE && e >= MAX_PER_SIDE) return null;
  if (want && sideCount(m, want) < MAX_PER_SIDE && sideCount(m, want) <= sideCount(m, want === 'npg' ? 'erobotz' : 'npg')) return want;
  if (n === e) return want && sideCount(m, want) < MAX_PER_SIDE ? want : 'npg';
  return n < e ? 'npg' : 'erobotz';
}

export type JoinResult = { ok: true; player: Player; resumed: boolean } | { ok: false; error: string };

export function join(m: Match, o: { name: string; identityKey?: string | null; side?: Team | null; resume?: string | null; now: number; id: string; resumeToken: string }): JoinResult {
  if (o.resume) {
    const p = [...m.players.values()].find((x) => x.resume === o.resume);
    if (p) {
      p.connected = true;
      p.droppedAt = 0;
      return { ok: true, player: p, resumed: true };
    }
  }
  if (m.phase === 'over') return { ok: false, error: 'This match is over.' };
  if (m.players.size >= MAX_PLAYERS) return { ok: false, error: 'The match is full (16 players).' };
  const team = autoSide(m, o.side ?? null);
  if (!team) return { ok: false, error: 'Both sides are full (8 v 8).' };
  const p: Player = {
    id: o.id,
    name: cleanName(o.name),
    identityKey: o.identityKey ? String(o.identityKey).slice(0, 80) : null,
    team,
    x: 0,
    z: 0,
    yaw: 0,
    hp: RULES.hp,
    alive: true,
    respawnAt: 0,
    kills: 0,
    deaths: 0,
    score: 0,
    shots: 0,
    txShots: 0,
    lastShot: 0,
    lastMove: o.now,
    connected: true,
    droppedAt: 0,
    resume: o.resumeToken,
    streamSlot: null,
    host: m.players.size === 0,
  };
  place(m, p);
  m.players.set(p.id, p);
  m.events.push({ k: 'spawn', id: p.id });
  return { ok: true, player: p, resumed: false };
}

/** Lobby only (PvP): switch sides if the other side has room and it does not stack it by more than one. */
export function pickSide(m: Match, id: string, side: Team): { ok: boolean; error?: string } {
  const p = m.players.get(id);
  if (!p) return { ok: false, error: 'Not in this match.' };
  if (m.mode !== 'pvp') return { ok: false, error: 'Co-op is all one squad.' };
  if (m.phase !== 'lobby') return { ok: false, error: 'Sides lock when the match starts.' };
  if (p.team === side) return { ok: true };
  const there = sideCount(m, side);
  const here = sideCount(m, p.team);
  if (there >= MAX_PER_SIDE) return { ok: false, error: `${TEAM_NAME[side]} is full (8).` };
  if (there + 1 - (here - 1) > 1) return { ok: false, error: `Teams must stay balanced: ${TEAM_NAME[side]} already has more players.` };
  p.team = side;
  place(m, p);
  return { ok: true };
}

function place(m: Match, p: Player) {
  const s = SPAWN[p.team];
  p.x = clamp((m.rand() - 0.5) * 24, ARENA.x0 + 1, ARENA.x1 - 1);
  p.z = s.z + (m.rand() - 0.5) * 4;
  p.yaw = s.yaw;
}

export function leave(m: Match, id: string, now: number) {
  const p = m.players.get(id);
  if (!p) return;
  p.connected = false;
  p.droppedAt = now;
  if (m.phase === 'lobby') removePlayer(m, id);
}

function removePlayer(m: Match, id: string) {
  const p = m.players.get(id);
  m.players.delete(id);
  if (p?.host) {
    const next = [...m.players.values()][0];
    if (next) next.host = true;
  }
}

export function start(m: Match, by: string, now: number): { ok: boolean; error?: string } {
  const p = m.players.get(by);
  if (!p?.host) return { ok: false, error: 'Only the host starts the match.' };
  if (m.phase !== 'lobby') return { ok: false, error: 'Already started.' };
  if (m.mode === 'pvp' && (sideCount(m, 'npg') < 1 || sideCount(m, 'erobotz') < 1)) return { ok: false, error: 'PvP needs at least one player on each side.' };
  m.phase = 'live';
  m.startedAt = now;
  m.endsAt = now + RULES.timeLimitMs;
  for (const q of m.players.values()) {
    place(m, q);
    q.hp = RULES.hp;
    q.alive = true;
  }
  if (m.mode === 'coop') nextWave(m);
  return { ok: true };
}

/** A client position: accepted up to the max speed since the last one (plus slack), inside the arena. */
export function move(m: Match, id: string, x: unknown, z: unknown, yaw: unknown, now: number) {
  const p = m.players.get(id);
  if (!p || !p.alive || m.phase !== 'live') return;
  const dt = Math.max(0.05, (now - p.lastMove) / 1000);
  const max = RULES.speed * dt + 0.25;
  let dx = fin(x, p.x) - p.x;
  let dz = fin(z, p.z) - p.z;
  const d = Math.hypot(dx, dz);
  if (d > max) {
    dx *= max / d;
    dz *= max / d;
  }
  p.x = clamp(p.x + dx, ARENA.x0, ARENA.x1);
  p.z = clamp(p.z + dz, ARENA.z0, ARENA.z1);
  p.yaw = fin(yaw, p.yaw);
  p.lastMove = now;
}

/** Distance along a ray (origin o, unit dir) to a circle, or Infinity. */
export function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number) {
  const fx = cx - ox;
  const fz = cz - oz;
  const t = fx * dx + fz * dz;
  if (t < 0) return Infinity;
  const px = fx - dx * t;
  const pz = fz - dz * t;
  return px * px + pz * pz <= r * r ? t : Infinity;
}

/** Facing: yaw 0 looks down -Z (the camera's default), increasing yaw turns left. */
export const dirOf = (yaw: number) => ({ dx: -Math.sin(yaw), dz: -Math.cos(yaw) });

export type ShotResult = { ok: boolean; hit?: { kind: 'player' | 'enemy'; id: string; killed: boolean } | null; error?: string };

export function shoot(m: Match, id: string, yaw: unknown, txid: unknown, now: number): ShotResult {
  const p = m.players.get(id);
  if (!p || m.phase !== 'live') return { ok: false, error: 'not live' };
  if (!p.alive) return { ok: false, error: 'dead' };
  if (now - p.lastShot < RULES.shotGapMs) return { ok: false, error: 'too fast' };
  p.lastShot = now;
  p.shots++;
  if (typeof txid === 'string' && /^[0-9a-f]{64}$/.test(txid)) p.txShots++;
  const a = fin(yaw, p.yaw);
  const { dx, dz } = dirOf(a);
  let best: number = RULES.headRange;
  let hit: { kind: 'player' | 'enemy'; ref: Player | Enemy } | null = null;
  if (m.mode === 'pvp') {
    for (const q of m.players.values()) {
      if (q === p || !q.alive || q.team === p.team) continue; // friendly fire off
      const t = rayCircle(p.x, p.z, dx, dz, q.x, q.z, RULES.playerRadius);
      if (t < best) [best, hit] = [t, { kind: 'player', ref: q }];
    }
  } else {
    for (const e of m.enemies) {
      const t = rayCircle(p.x, p.z, dx, dz, e.x, e.z, e.kind === BOSS_KIND ? BOSS_RADIUS : RULES.enemyRadius);
      if (t < best) [best, hit] = [t, { kind: 'enemy', ref: e }];
    }
  }
  m.events.push({ k: 'shot', by: p.id, x: p.x, z: p.z, yaw: a, len: best });
  if (!hit) return { ok: true, hit: null };
  if (hit.kind === 'player') {
    const q = hit.ref as Player;
    q.hp -= RULES.shotDamage;
    m.events.push({ k: 'hit', by: p.id, on: q.id, dmg: RULES.shotDamage, x: q.x, z: q.z });
    const killed = q.hp <= 0;
    if (killed) {
      kill(m, q, now);
      p.kills++;
      p.score += RULES.fragScore;
      m.frags[p.team]++;
      m.events.push({ k: 'kill', by: p.id, on: q.id, x: q.x, z: q.z });
      if (m.frags[p.team] >= RULES.fragLimit) end(m, now);
    }
    return { ok: true, hit: { kind: 'player', id: q.id, killed } };
  }
  const e = hit.ref as Enemy;
  e.hp -= RULES.shotDamage;
  const eid = `e${e.id}`;
  m.events.push({ k: 'hit', by: p.id, on: eid, dmg: RULES.shotDamage, x: e.x, z: e.z });
  const killed = e.hp <= 0;
  if (killed) {
    m.enemies = m.enemies.filter((x) => x !== e);
    p.kills++;
    p.score += RULES.killScore;
    m.frags.npg++;
    m.events.push({ k: 'kill', by: p.id, on: eid, x: e.x, z: e.z });
  }
  return { ok: true, hit: { kind: 'enemy', id: eid, killed } };
}

function kill(m: Match, p: Player, now: number) {
  p.hp = 0;
  p.alive = false;
  p.deaths++;
  p.respawnAt = now + RULES.respawnMs;
}

/** How many co-op waves this match's level runs. */
export const wavesOf = (m: Match) => teamLevelOf(m.level).waves;

function nextWave(m: Match) {
  m.wave++;
  const L = teamLevelOf(m.level);
  m.waveLeft = teamWaveSize(L, m.wave);
  m.events.push({ k: 'wave', n: m.wave });
  // the level's boss walks in with the last wave
  if (L.bossHp && m.wave === L.waves) {
    m.enemies.push({ id: m.nextEnemy++, x: 0, z: ARENA.z0 + 3, yaw: 0, hp: L.bossHp, kind: BOSS_KIND });
  }
}

function spawnEnemy(m: Match) {
  const L = teamLevelOf(m.level);
  const e: Enemy = {
    id: m.nextEnemy++,
    x: (m.rand() - 0.5) * 36,
    z: ARENA.z0 + 2 + m.rand() * 6,
    yaw: 0,
    hp: Math.round((RULES.enemyHp + m.wave * 4) * L.hpK),
    kind: L.kinds[Math.floor(m.rand() * L.kinds.length)] ?? 0,
  };
  m.enemies.push(e);
}

export function end(m: Match, now: number) {
  if (m.phase === 'over') return;
  m.phase = 'over';
  m.endedAt = now;
  if (m.mode === 'pvp') m.winner = m.frags.npg === m.frags.erobotz ? 'draw' : m.frags.npg > m.frags.erobotz ? 'npg' : 'erobotz';
  else m.winner = m.wave > wavesOf(m) || (m.wave === wavesOf(m) && m.waveLeft === 0 && m.enemies.length === 0) ? 'squad' : 'horde';
}

/** One server step. Returns the events since the last tick (and clears them). */
export function tick(m: Match, now: number, dt = 1 / TICK_HZ): GameEvent[] {
  m.tick++;
  // dropped players past the grace window leave for good
  for (const p of [...m.players.values()]) if (!p.connected && p.droppedAt && now - p.droppedAt > RULES.graceMs) removePlayer(m, p.id);
  if (m.phase === 'live') {
    for (const p of m.players.values()) {
      if (!p.alive && now >= p.respawnAt) {
        place(m, p);
        p.hp = RULES.hp;
        p.alive = true;
        m.events.push({ k: 'spawn', id: p.id });
      }
    }
    if (m.mode === 'coop') stepHorde(m, now, dt);
    if (m.endsAt && now >= m.endsAt) end(m, now);
    if (m.phase === 'live' && m.players.size === 0) end(m, now);
  }
  const ev = m.events;
  m.events = [];
  return ev;
}

function stepHorde(m: Match, now: number, dt: number) {
  // spawn a few per tick until the wave is out (capped live count)
  for (let i = 0; i < 2 && m.waveLeft > 0 && m.enemies.length < RULES.enemyCap; i++) {
    spawnEnemy(m);
    m.waveLeft--;
  }
  const alive = [...m.players.values()].filter((p) => p.alive && p.connected);
  const L = teamLevelOf(m.level);
  const speed = L.speed + m.wave * L.speedPerWave;
  for (const e of m.enemies) {
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of alive) {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd) [bd, best] = [d, p];
    }
    if (!best) continue;
    e.yaw = Math.atan2(-(best.x - e.x), -(best.z - e.z));
    const reach = e.kind === BOSS_KIND ? RULES.enemyReach + BOSS_RADIUS : RULES.enemyReach;
    if (bd > reach * 0.8) {
      const k = Math.min(speed * (e.kind === BOSS_KIND ? 0.7 : 1) * dt, bd - reach * 0.8) / bd;
      e.x += (best.x - e.x) * k;
      e.z += (best.z - e.z) * k;
    }
    if (bd <= reach) {
      best.hp -= RULES.enemyDps * (e.kind === BOSS_KIND ? 3 : 1) * dt;
      if (best.hp <= 0) {
        kill(m, best, now);
        m.events.push({ k: 'kill', by: `e${e.id}`, on: best.id, x: best.x, z: best.z });
      }
    }
  }
  // keep bodies apart a little
  for (let i = 0; i < m.enemies.length; i++)
    for (let j = i + 1; j < m.enemies.length; j++) {
      const a = m.enemies[i];
      const b = m.enemies[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 0 && d < 1.2) {
        const push = (1.2 - d) / 2 / d;
        a.x -= dx * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.z += dz * push;
      }
    }
  if (m.waveLeft === 0 && m.enemies.length === 0) {
    if (m.wave >= wavesOf(m)) {
      m.wave++;
      end(m, now);
    } else nextWave(m);
  }
}

// ── What goes out ────────────────────────────────────────────────────────────────

const r2 = (v: number) => Math.round(v * 100) / 100;

const roundEvent = (e: GameEvent): GameEvent => {
  if (e.k === 'shot') return { k: 'shot', by: e.by, x: r2(e.x), z: r2(e.z), yaw: Math.round(e.yaw * 1000) / 1000, len: r2(e.len) };
  if (e.k === 'hit') return { ...e, x: r2(e.x), z: r2(e.z) };
  if (e.k === 'kill') return { ...e, x: r2(e.x), z: r2(e.z) };
  return e;
};

/** 20 Hz snapshot for the players in the match (compact arrays). */
export function snapshot(m: Match, events: GameEvent[]) {
  return {
    t: 'snap' as const,
    tick: m.tick,
    phase: m.phase,
    wave: m.wave,
    frags: m.frags,
    endsAt: m.endsAt,
    p: [...m.players.values()].map((p) => [p.id, r2(p.x), r2(p.z), r2(p.yaw), Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0, p.team, p.connected ? 1 : 0] as const),
    e: m.enemies.map((e) => [e.id, r2(e.x), r2(e.z), r2(e.yaw), Math.round(e.hp), e.kind] as const),
    // positions to the centimetre: the same events at about half the bytes (16 players fire ~200 shots a second)
    ev: events.map(roundEvent),
  };
}
export type Snapshot = ReturnType<typeof snapshot>;

/**
 * The public match state the bChatX TERRORNODE room polls (GET /matches/:code on the game server, mirrored at
 * /api/terrornode/team/:code). No resume tokens or identity keys beyond the public one.
 */
export function publicState(m: Match, now: number, opts: { inviteBase?: string } = {}) {
  const players = [...m.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    identityKey: p.identityKey,
    team: p.team,
    host: p.host,
    score: p.score,
    kills: p.kills,
    deaths: p.deaths,
    shots: p.shots,
    txShots: p.txShots,
    alive: p.alive,
    connected: p.connected,
    streamSlot: p.streamSlot,
  }));
  const team = (t: Team) => ({
    id: t,
    name: TEAM_NAME[t],
    players: players.filter((p) => p.team === t).map((p) => p.id),
    size: players.filter((p) => p.team === t).length,
    max: m.mode === 'pvp' ? MAX_PER_SIDE : MAX_PLAYERS,
    frags: m.frags[t],
    score: players.filter((p) => p.team === t).reduce((s, p) => s + p.score, 0),
  });
  return {
    id: m.id,
    code: m.code,
    tournamentId: m.tournamentId,
    mode: m.mode,
    level: m.level,
    phase: m.phase,
    maxPlayers: MAX_PLAYERS,
    createdAt: m.createdAt,
    startedAt: m.startedAt,
    endsAt: m.endsAt,
    endedAt: m.endedAt,
    now,
    wave: m.mode === 'coop' ? m.wave : null,
    waves: m.mode === 'coop' ? wavesOf(m) : null,
    /** Every shot the players fired and the ones ARC accepted as real transactions (the spectator's tx/s). */
    shots: players.reduce((a, p) => a + p.shots, 0),
    txShots: players.reduce((a, p) => a + p.txShots, 0),
    enemiesLive: m.mode === 'coop' ? m.enemies.length : null,
    fragLimit: m.mode === 'pvp' ? RULES.fragLimit : null,
    winner: m.winner,
    // co-op: the horde is the 'erobotz' side, played by the server
    teams: m.mode === 'pvp' ? [team('npg'), team('erobotz')] : [team('npg'), { ...team('erobotz'), players: [], size: 0, max: 0, cpu: true }],
    players,
    streams: players.filter((p) => p.streamSlot).map((p) => ({ player: p.id, team: p.team, slot: p.streamSlot })),
    inviteUrl: opts.inviteBase ? `${opts.inviteBase.replace(/\/$/, '')}/arcade/terrornode/team?match=${m.code}` : null,
  };
}
export type PublicState = ReturnType<typeof publicState>;

/** The browser reports how many of its shots ARC accepted as real transactions (never more than it fired). */
export function confirmTx(m: Match, id: string, n: unknown) {
  const p = m.players.get(id);
  const k = Math.floor(fin(n));
  if (!p || k <= 0) return;
  p.txShots = Math.min(p.shots, p.txShots + Math.min(k, 1000));
}

export function setStream(m: Match, id: string, slot: unknown) {
  const p = m.players.get(id);
  if (!p) return false;
  p.streamSlot = typeof slot === 'string' && slot ? slot.replace(/[^\w@.:-]/g, '').slice(0, 80) || null : null;
  return true;
}

/** The on-chain shot tag for team mode: "tokenblaster.lol" <ammo> <n> "terrornode-team" <match id> <team>. */
export const teamShotPushes = (matchId: string, team: Team) => ['terrornode-team', matchId, team];
