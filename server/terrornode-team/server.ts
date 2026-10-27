/**
 * TERRORNODE TEAM MODE game server: one process, many matches, 20 Hz authoritative ticks.
 * Designed for Hetzner under pm2 (see ecosystem.config.cjs and docs/terrornode-team.md). Nothing here holds keys
 * or moves money: players' shots are real BSV transactions fired by their own browser gun.
 *
 * HTTP
 *   GET  /health                 → { ok, matches, players, conns, spectators, tick: {hz, ms, maxMs}, cpu, rssMb }
 *   POST /matches {mode, level?, tournamentId?}  → { code, id, level, inviteUrl }   (the bChatX room or the lobby creates one)
 *   GET  /matches                → public state of every open match (newest first)
 *   GET  /matches/:code          → public state (players, teams, score, stream slots) for the bChatX room
 * WS  /ws
 *   → {t:'join', match, name, identityKey?, side?, resume?} | {t:'watch', match} (read-only spectator) | {t:'side', side} | {t:'start'}
 *     {t:'in', x, z, yaw} | {t:'shot', yaw} | {t:'tx', n} (shots ARC accepted) | {t:'live', slot} | {t:'ping'}
 *   → {t:'chat', ch:'team'|'all'|'dm', to?, text} (text chat, relayed, never stored)
 *   ← {t:'chat', ch, from, name, team, to?, text, at} | {t:'chatErr', error}
 *   ← {t:'welcome', you, resume, features, state} | {t:'watching', state} | {t:'state', state} | {t:'snap', …} | {t:'err', error} | {t:'pong', now, id?}
 *
 * Load (26 Oct, for 16-player sessions; `pnpm team:load`): each match keeps its own socket set (no scan of every
 * connection per match per tick), a snapshot or state is serialised ONCE and the same string goes to every socket,
 * full state goes out at most STATE_HZ a second (kills no longer push it every tick), lobbies and finished matches
 * get snapshots at 5 Hz, and the 20 Hz loop corrects its own drift. /health reports the measured tick rate,
 * tick cost and process CPU.
 * Big matches (26 Oct, launch 1 Nov): 64 a room (co-op) or 32 v 32. Past 16 players every socket gets its own
 * interest-managed snapshot (match.ts snapParts/snapFor: nearby players and Erobots, the boss, room counters
 * including ROOM TX/SEC), built from pieces serialised once a tick; spectators get the whole match.
 * Env: PORT (8787), PUBLIC_SITE (https://tokenblaster.lol, for invite links), ALLOW_ORIGINS (comma list; empty = any).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  TICK_HZ,
  confirmTx,
  createMatch,
  join,
  leave,
  makeCode,
  move,
  pickSide,
  publicState,
  setStream,
  shoot,
  snapFor,
  snapParts,
  start,
  txPerSec,
  INTEREST,
  MAX_PLAYERS,
  MAX_PER_SIDE,
  tick,
  validCode,
  type Match,
  type Mode,
  type Team,
} from '../../src/lib/teammode/match';
import { performance } from 'node:perf_hooks';
import { CHAT_FEATURE, allowChat, routeChat } from '../../src/lib/teammode/chat';

/** Capabilities in /health and the welcome / watching reply (the site shows chat only when 'chat' is listed). */
const FEATURES = [CHAT_FEATURE];

const PORT = Number(process.env.PORT || 8787);
const SITE = process.env.PUBLIC_SITE || 'https://tokenblaster.lol';
const ORIGINS = (process.env.ALLOW_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_MATCHES = 200;
const IDLE_MS = 15 * 60_000;
/** Spectators per match (the livestream overlay, OBS, the bChatX Space). */
const MAX_WATCHERS = 64;
/** Full public state at most this often per match (snapshots stay at TICK_HZ). */
const STATE_HZ = 4;
/** A crowd's full state is big (64 players), so past 16 it goes at 1 Hz; the snapshots carry the live counters. */
const BIG_STATE_HZ = 1;
const stateHz = (m: Match) => (m.players.size > INTEREST.fullBelow ? BIG_STATE_HZ : STATE_HZ);

const rand = () => randomInt(0, 1 << 30) / (1 << 30);
const matches = new Map<string, Match>();
type Conn = { ws: WebSocket; match: Match | null; player: string | null; team: Team | null; watch: boolean; msgs: number; window: number; chatAt: number[] };
const conns = new Set<Conn>();
/** Each match's sockets (players and spectators). */
const rooms = new Map<Match, Set<Conn>>();
const roomOf = (m: Match) => {
  let r = rooms.get(m);
  if (!r) rooms.set(m, (r = new Set()));
  return r;
};
const enter = (c: Conn, m: Match) => {
  if (c.match && c.match !== m) rooms.get(c.match)?.delete(c);
  c.match = m;
  roomOf(m).add(c);
};
const exit = (c: Conn) => {
  if (c.match) rooms.get(c.match)?.delete(c);
  c.match = null;
  c.player = null;
  c.team = null;
};

export function newMatch(mode: Mode, tournamentId: string | null, now = Date.now(), level?: unknown): Match {
  let code = makeCode(rand);
  while (matches.has(code)) code = makeCode(rand);
  const m = createMatch({ code, mode, level, tournamentId, now, rand });
  matches.set(code, m);
  return m;
}

// ── measured load (for /health and the 16-player load script) ──
const perf = { split: { logic: 0, snap: 0 }, logicMs: 0, partsMs: 0, ticks: 0, since: Date.now(), hz: 0, ms: 0, maxMs: 0, sumMs: 0, cpu: 0, lastCpu: process.cpuUsage(), lastAt: Date.now() };
setInterval(() => {
  const now = Date.now();
  const secs = (now - perf.since) / 1000;
  perf.hz = perf.ticks / Math.max(0.001, secs);
  perf.ms = perf.ticks ? perf.sumMs / perf.ticks : 0;
  perf.split = { logic: perf.ticks ? perf.logicMs / perf.ticks : 0, snap: perf.ticks ? perf.partsMs / perf.ticks : 0 };
  perf.logicMs = perf.partsMs = 0;
  const u = process.cpuUsage(perf.lastCpu);
  perf.cpu = ((u.user + u.system) / 1000 / Math.max(1, now - perf.lastAt)) * 100;
  perf.lastCpu = process.cpuUsage();
  perf.lastAt = now;
  perf.since = now;
  perf.ticks = 0;
  perf.sumMs = 0;
  perf.maxMs = 0;
}, 2000).unref();

function cors(req: IncomingMessage, res: ServerResponse) {
  const o = req.headers.origin;
  if (!ORIGINS.length) res.setHeader('access-control-allow-origin', '*');
  else if (o && ORIGINS.includes(o)) res.setHeader('access-control-allow-origin', o);
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}
const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 4096) break;
  }
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

const http = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url || '/', 'http://x');
  const now = Date.now();
  if (url.pathname === '/health') {
    let spectators = 0;
    for (const c of conns) if (c.watch) spectators++;
    let tps = 0;
    for (const m of matches.values()) tps += txPerSec(m, now);
    return json(res, 200, {
      ok: true,
      features: FEATURES,
      limits: { players: MAX_PLAYERS, perSide: MAX_PER_SIDE },
      txPerSec: Math.round(tps * 10) / 10,
      matches: matches.size,
      players: [...matches.values()].reduce((s, m) => s + m.players.size, 0),
      conns: conns.size,
      spectators,
      tick: { target: TICK_HZ, hz: Math.round(perf.hz * 10) / 10, ms: Math.round(perf.ms * 1000) / 1000, maxMs: Math.round(perf.maxMs * 1000) / 1000, logicMs: Math.round(perf.split.logic * 1000) / 1000, snapMs: Math.round(perf.split.snap * 1000) / 1000 },
      cpu: Math.round(perf.cpu * 10) / 10,
      rssMb: Math.round(process.memoryUsage().rss / 1e6),
    });
  }
  if (url.pathname === '/matches' && req.method === 'POST') {
    if (matches.size >= MAX_MATCHES) return json(res, 503, { error: 'Too many matches running. Try again soon.' });
    const b = await body(req);
    const mode: Mode = b.mode === 'pvp' ? 'pvp' : 'coop';
    const m = newMatch(mode, typeof b.tournamentId === 'string' ? b.tournamentId : null, now, b.level);
    return json(res, 201, { code: m.code, id: m.id, mode, level: m.level, inviteUrl: publicState(m, now, { inviteBase: SITE }).inviteUrl });
  }
  if (url.pathname === '/matches' && req.method === 'GET') {
    const t = url.searchParams.get('tournament');
    const list = [...matches.values()].filter((m) => !t || m.tournamentId === t).sort((a, b) => b.createdAt - a.createdAt).map((m) => publicState(m, now, { inviteBase: SITE }));
    return json(res, 200, { matches: list });
  }
  const mm = url.pathname.match(/^\/matches\/([A-Za-z0-9]{5})$/);
  if (mm && req.method === 'GET') {
    const m = matches.get(mm[1].toUpperCase());
    return m ? json(res, 200, publicState(m, now, { inviteBase: SITE })) : json(res, 404, { error: 'No such match.' });
  }
  json(res, 404, { error: 'Not found.' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
http.on('upgrade', (req, sock, head) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname !== '/ws' || (ORIGINS.length && !ORIGINS.includes(String(req.headers.origin)))) return sock.destroy();
  wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req));
});

const send = (ws: WebSocket, msg: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
/** One string to every socket in the room. */
const fanout = (m: Match, s: string) => {
  const r = rooms.get(m);
  if (r) for (const c of r) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
};
const lastState = new Map<Match, number>();
const dirty = new Set<Match>();
/** Full state now (joins, sides, start, phase changes). */
const broadcastState = (m: Match) => {
  dirty.delete(m);
  lastState.set(m, Date.now());
  fanout(m, JSON.stringify({ t: 'state', state: publicState(m, Date.now(), { inviteBase: SITE }) }));
};
/** Full state soon: coalesced to STATE_HZ (kills, waves, tx counts). */
const markState = (m: Match) => dirty.add(m);
/** Joins and drops: a small room hears at once; a crowd's state is coalesced (64 joins = 64 full states otherwise). */
const roster = (m: Match) => (m.players.size > INTEREST.fullBelow ? markState(m) : broadcastState(m));

wss.on('connection', (ws) => {
  const c: Conn = { ws, match: null, player: null, team: null, watch: false, msgs: 0, window: Date.now(), chatAt: [] };
  conns.add(c);
  let alive = true;
  ws.on('pong', () => (alive = true));
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);
  ws.on('message', (raw) => {
    const now = Date.now();
    // flood guard: 80 messages a second is plenty for 20 Hz input + full-auto fire
    if (now - c.window > 1000) [c.window, c.msgs] = [now, 0];
    if (++c.msgs > 80) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const m = c.match;
    switch (msg.t) {
      case 'ping':
        return send(ws, { t: 'pong', now, id: typeof msg.id === 'number' ? msg.id : undefined });
      case 'join': {
        if (c.match) return;
        const code = String(msg.match || '').toUpperCase();
        const target = validCode(code) ? matches.get(code) : undefined;
        if (!target) return send(ws, { t: 'err', error: 'No match with that code. Ask for a new invite.' });
        const side = msg.side === 'npg' || msg.side === 'erobotz' ? (msg.side as Team) : null;
        const r = join(target, {
          name: String(msg.name || ''),
          identityKey: typeof msg.identityKey === 'string' ? msg.identityKey : null,
          side,
          resume: typeof msg.resume === 'string' ? msg.resume : null,
          now,
          id: randomBytes(4).toString('hex'),
          resumeToken: randomBytes(16).toString('hex'),
        });
        if (!r.ok) return send(ws, { t: 'err', error: r.error });
        // a resumed player's old socket (if still open) is dropped
        for (const o of [...(rooms.get(target) ?? [])]) if (o !== c && o.player === r.player.id) exit(o);
        enter(c, target);
        c.player = r.player.id;
        send(ws, { t: 'welcome', you: r.player.id, resume: r.player.resume, resumed: r.resumed, features: FEATURES, state: publicState(target, now, { inviteBase: SITE }) });
        return roster(target);
      }
    }
    if (msg.t === 'watch') {
      // SPECTATOR: read-only, no slot, no wallet. Gets the same snapshots and state as the players.
      if (c.match) return;
      const code = String(msg.match || '').toUpperCase();
      const target = validCode(code) ? matches.get(code) : undefined;
      if (!target) return send(ws, { t: 'err', error: 'No match with that code.' });
      let w = 0;
      for (const o of rooms.get(target) ?? []) if (o.watch) w++;
      if (w >= MAX_WATCHERS) return send(ws, { t: 'err', error: 'Too many spectators on this match.' });
      c.watch = true;
      enter(c, target);
      return send(ws, { t: 'watching', features: FEATURES, state: publicState(target, now, { inviteBase: SITE }) });
    }
    if (msg.t === 'chat') {
      // TEXT CHAT: relayed, never stored. Team = own side's sockets only; dm = target + sender; all = whole room.
      if (!m) return;
      c.team = c.player ? (m.players.get(c.player)?.team ?? null) : null;
      if (c.player && !allowChat(c.chatAt, now)) return send(ws, { t: 'chatErr', error: 'Slow down: 5 messages every 5 seconds.' });
      const room = [...(rooms.get(m) ?? [])];
      for (const o of room) o.team = o.player ? (m.players.get(o.player)?.team ?? null) : null;
      const r = routeChat(c, room, msg);
      if (!r.ok) return send(ws, { t: 'chatErr', error: r.error });
      const p = m.players.get(c.player!);
      const out = JSON.stringify({ t: 'chat', ch: r.ch, from: c.player, name: p?.name ?? 'player', team: c.team, to: r.to, text: r.text, at: now });
      for (const o of r.recipients) if (o.ws.readyState === WebSocket.OPEN) o.ws.send(out);
      return;
    }
    if (!m || !c.player) return;
    switch (msg.t) {
      case 'side': {
        const r = pickSide(m, c.player, msg.side === 'erobotz' ? 'erobotz' : 'npg');
        if (!r.ok) send(ws, { t: 'err', error: r.error });
        return broadcastState(m);
      }
      case 'start': {
        const r = start(m, c.player, now);
        if (!r.ok) send(ws, { t: 'err', error: r.error });
        return broadcastState(m);
      }
      case 'in':
        return move(m, c.player, msg.x, msg.z, msg.yaw, now);
      case 'shot':
        shoot(m, c.player, msg.yaw, msg.txid, now);
        return;
      case 'tx':
        confirmTx(m, c.player, msg.n, now);
        return markState(m);
      case 'live':
        setStream(m, c.player, msg.slot);
        return broadcastState(m);
    }
  });
  ws.on('close', () => {
    clearInterval(hb);
    conns.delete(c);
    const [m, p] = [c.match, c.player];
    exit(c);
    if (m && p) {
      leave(m, p, Date.now());
      roster(m);
    }
  });
});

// ── 20 Hz tick (drift-corrected: each step is scheduled against the ideal clock, not the last wake-up) ──
const lastPhase = new Map<string, string>();
const STEP = 1000 / TICK_HZ;
let nextAt = Date.now() + STEP;
function step() {
  const t0 = performance.now();
  const now = Date.now();
  for (const [code, m] of matches) {
    const tt = performance.now();
    const ev = tick(m, now);
    perf.logicMs += performance.now() - tt;
    const room = rooms.get(m);
    const live = m.phase === 'live';
    // lobbies and finished matches: 5 Hz is plenty; nobody watching: nothing to serialise
    if (room?.size && (live || m.tick % 4 === 0)) {
      const tp = performance.now();
      const parts = snapParts(m, ev, now);
      perf.partsMs += performance.now() - tp;
      if (m.players.size <= INTEREST.fullBelow) fanout(m, parts.full);
      else
        for (const c of room) {
          if (c.ws.readyState !== WebSocket.OPEN) continue;
          // a socket already this far behind skips a frame rather than queueing more (the next one supersedes it)
          if (c.ws.bufferedAmount > 256 * 1024) continue;
          c.ws.send(c.watch || !c.player ? parts.spectator : snapFor(parts, c.player));
        }
    }
    const phaseChanged = lastPhase.get(code) !== m.phase;
    if (phaseChanged) broadcastState(m);
    else if (ev.some((e) => e.k === 'kill' || e.k === 'wave' || e.k === 'spawn')) markState(m);
    if (dirty.has(m) && now - (lastState.get(m) ?? 0) >= 1000 / stateHz(m)) broadcastState(m);
    lastPhase.set(code, m.phase);
    const idle = m.players.size === 0 && now - (m.endedAt ?? m.createdAt) > IDLE_MS;
    const stale = m.phase === 'over' && now - (m.endedAt ?? now) > IDLE_MS;
    if (idle || stale) {
      matches.delete(code);
      lastPhase.delete(code);
      lastState.delete(m);
      dirty.delete(m);
      for (const c of rooms.get(m) ?? []) exit(c);
      rooms.delete(m);
    }
  }
  const ms = performance.now() - t0;
  perf.ticks++;
  perf.sumMs += ms;
  perf.maxMs = Math.max(perf.maxMs, ms);
  nextAt += STEP;
  const wait = nextAt - Date.now();
  if (wait < -STEP * 5) nextAt = Date.now() + STEP; // a long stall (GC, suspend): resync, don't burst
  setTimeout(step, Math.max(0, nextAt - Date.now()));
}
setTimeout(step, STEP);

http.listen(PORT, () => console.log(`[terrornode-team] listening on :${PORT} (${TICK_HZ} Hz)`));
