/**
 * TERRORNODE TEAM MODE game server: one process, many matches, 20 Hz authoritative ticks.
 * Designed for Hetzner under pm2 (see ecosystem.config.cjs and docs/terrornode-team.md). Nothing here holds keys
 * or moves money: players' shots are real BSV transactions fired by their own browser gun.
 *
 * HTTP
 *   GET  /health                 → { ok, matches }
 *   POST /matches {mode, tournamentId?}  → { code, id, inviteUrl }   (the bChatX room or the lobby creates one)
 *   GET  /matches                → public state of every open match (newest first)
 *   GET  /matches/:code          → public state (players, teams, score, stream slots) for the bChatX room
 * WS  /ws
 *   → {t:'join', match, name, identityKey?, side?, resume?} | {t:'side', side} | {t:'start'}
 *     {t:'in', x, z, yaw} | {t:'shot', yaw} | {t:'tx', n} (shots ARC accepted) | {t:'live', slot} | {t:'ping'}
 *   ← {t:'welcome', you, resume, state} | {t:'state', state} | {t:'snap', …} | {t:'err', error} | {t:'pong'}
 *
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
  snapshot,
  start,
  tick,
  validCode,
  type Match,
  type Mode,
  type Team,
} from '../../src/lib/teammode/match';

const PORT = Number(process.env.PORT || 8787);
const SITE = process.env.PUBLIC_SITE || 'https://tokenblaster.lol';
const ORIGINS = (process.env.ALLOW_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_MATCHES = 200;
const IDLE_MS = 15 * 60_000;

const rand = () => randomInt(0, 1 << 30) / (1 << 30);
const matches = new Map<string, Match>();
type Conn = { ws: WebSocket; match: Match | null; player: string | null; msgs: number; window: number };
const conns = new Set<Conn>();

export function newMatch(mode: Mode, tournamentId: string | null, now = Date.now()): Match {
  let code = makeCode(rand);
  while (matches.has(code)) code = makeCode(rand);
  const m = createMatch({ code, mode, tournamentId, now, rand });
  matches.set(code, m);
  return m;
}

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
  if (url.pathname === '/health') return json(res, 200, { ok: true, matches: matches.size, players: [...matches.values()].reduce((s, m) => s + m.players.size, 0) });
  if (url.pathname === '/matches' && req.method === 'POST') {
    if (matches.size >= MAX_MATCHES) return json(res, 503, { error: 'Too many matches running. Try again soon.' });
    const b = await body(req);
    const mode: Mode = b.mode === 'pvp' ? 'pvp' : 'coop';
    const m = newMatch(mode, typeof b.tournamentId === 'string' ? b.tournamentId : null, now);
    return json(res, 201, { code: m.code, id: m.id, mode, inviteUrl: publicState(m, now, { inviteBase: SITE }).inviteUrl });
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
const broadcastState = (m: Match) => {
  const s = publicState(m, Date.now(), { inviteBase: SITE });
  for (const c of conns) if (c.match === m) send(c.ws, { t: 'state', state: s });
};

wss.on('connection', (ws) => {
  const c: Conn = { ws, match: null, player: null, msgs: 0, window: Date.now() };
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
        return send(ws, { t: 'pong', now });
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
        for (const o of conns) if (o !== c && o.match === target && o.player === r.player.id) [o.player, o.match] = [null, null];
        c.match = target;
        c.player = r.player.id;
        send(ws, { t: 'welcome', you: r.player.id, resume: r.player.resume, resumed: r.resumed, state: publicState(target, now, { inviteBase: SITE }) });
        return broadcastState(target);
      }
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
        return confirmTx(m, c.player, msg.n);
      case 'live':
        setStream(m, c.player, msg.slot);
        return broadcastState(m);
    }
  });
  ws.on('close', () => {
    clearInterval(hb);
    conns.delete(c);
    if (c.match && c.player) {
      leave(c.match, c.player, Date.now());
      broadcastState(c.match);
    }
  });
});

// ── 20 Hz tick ──
const lastPhase = new Map<string, string>();
setInterval(() => {
  const now = Date.now();
  for (const [code, m] of matches) {
    const ev = tick(m, now);
    const snap = snapshot(m, ev);
    const s = JSON.stringify(snap);
    for (const c of conns) if (c.match === m && c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
    if (lastPhase.get(code) !== m.phase || ev.some((e) => e.k === 'kill' || e.k === 'wave')) broadcastState(m);
    lastPhase.set(code, m.phase);
    const idle = m.players.size === 0 && now - (m.endedAt ?? m.createdAt) > IDLE_MS;
    const stale = m.phase === 'over' && now - (m.endedAt ?? now) > IDLE_MS;
    if (idle || stale) {
      matches.delete(code);
      lastPhase.delete(code);
    }
  }
}, 1000 / TICK_HZ);

http.listen(PORT, () => console.log(`[terrornode-team] listening on :${PORT} (${TICK_HZ} Hz)`));
