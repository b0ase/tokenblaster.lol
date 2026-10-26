/**
 * LOAD TEST for the TERRORNODE team server (16 players on 26 Oct; 64 a match and several matches at once for the
 * 1 Nov MELEE launch): N WebSocket bots (not browsers) join one match (or --matches K matches at once), the host
 * starts it, every bot moves at 20 Hz and fires at the server's max rate (~13/s), pings every 500 ms, one bot per
 * match drops and resumes mid-match, and S spectators watch each match. Measures what each client actually gets:
 *
 *   tick rate   snapshots a second per bot (the server's 20 Hz as seen on the wire), and the gap p50/p95/max
 *   latency     ping -> pong round trip p50/p95/max (ms)
 *   bandwidth   kB/s down per bot (mean and max), snapshot bytes, and the most players / Erobots one snapshot held
 *               (interest management past 16 players: nearby only)
 *   server      tick rate, tick cost, process CPU % and RSS as the server measures them (/health), every 2 s, and
 *               its ROOM TX/SEC (0 here: bots send no txids)
 *
 *   pnpm team:server &                                     # local, :8787
 *   pnpm team:load -- --n 16 --mode coop --level heart --secs 30
 *   pnpm team:load -- --n 64 --level melee --secs 30                    # one 64-player MELEE
 *   pnpm team:load -- --n 64 --level melee --matches 4 --secs 30        # 4 x 64 at once: the server's ceiling
 *   pnpm team:load -- --url https://team.tokenblaster.lol --n 64 --level melee --secs 30 --json
 *
 * Nothing here touches a wallet: bot shots carry no txid. Exit code 1 when a session does not hold (fewer than N
 * joined, the tick rate under --minHz, or a reconnect lost its slot). With --matches the summary is the worst match.
 */
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('url', 'http://localhost:8787').replace(/\/$/, '');
const N = Number(arg('n', '16'));
const MODE = arg('mode', 'coop');
const LEVEL = arg('level', 'assault');
const SECS = Number(arg('secs', '20'));
const WATCHERS = Number(arg('watchers', '2'));
const MIN_HZ = Number(arg('minHz', '18'));
const MATCHES = Math.max(1, Number(arg('matches', '1')));
const JSON_OUT = process.argv.includes('--json');
/** A local server's pid: also sample its CPU with ps (works for servers that predate /health's cpu field). */
const PID = arg('pid', '');
const psCpu: number[] = [];
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

type Bot = { ws: WebSocket; i: number; id?: string; resume?: string; x: number; z: number; snaps: number; gaps: number[]; lastSnap: number; firstSnap: number; rtt: number[]; pings: Map<number, number>; bytes: number; snapBytes: number; snapN: number; seenP: number; seenE: number; errs: string[] };
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function wire(b: Bot, onWelcome: (b: Bot) => void) {
  b.ws.on('message', (raw: Buffer) => {
    b.bytes += raw.length;
    const m = JSON.parse(String(raw));
    if (m.t === 'welcome' || m.t === 'watching') {
      [b.id, b.resume] = [m.you, m.resume];
      onWelcome(b);
    } else if (m.t === 'snap') {
      const t = performance.now();
      b.snapBytes += raw.length;
      b.snapN++;
      b.seenP = Math.max(b.seenP, m.p.length);
      b.seenE = Math.max(b.seenE, m.e.length);
      if (b.lastSnap && m.phase === 'live') b.gaps.push(t - b.lastSnap);
      b.lastSnap = t;
      if (m.phase === 'live') {
        if (!b.snaps) b.firstSnap = t;
        b.snaps++;
      }
      const me = m.p.find((p: unknown[]) => p[0] === b.id);
      if (me) [b.x, b.z] = [me[1], me[2]];
    } else if (m.t === 'pong' && typeof m.id === 'number') {
      const at = b.pings.get(m.id);
      if (at != null) b.rtt.push(performance.now() - at);
      b.pings.delete(m.id);
    } else if (m.t === 'err') b.errs.push(m.error);
  });
}

function connect(code: string, i: number, o: { resume?: string; watch?: boolean } = {}): Promise<Bot> {
  return new Promise((res, rej) => {
    const b: Bot = { ws: new WebSocket(WS_URL, { headers: { origin: 'https://tokenblaster.lol' } }), i, x: 0, z: 0, snaps: 0, gaps: [], lastSnap: 0, firstSnap: 0, rtt: [], pings: new Map(), bytes: 0, snapBytes: 0, snapN: 0, seenP: 0, seenE: 0, errs: [] };
    const t = setTimeout(() => rej(new Error(`bot ${i} timed out joining`)), 20_000);
    wire(b, (x) => (clearTimeout(t), res(x)));
    b.ws.on('open', () => b.ws.send(JSON.stringify(o.watch ? { t: 'watch', match: code } : { t: 'join', match: code, name: `bot${i}`, side: i % 2 ? 'erobotz' : 'npg', resume: o.resume })));
    b.ws.on('error', (e) => (clearTimeout(t), rej(e)));
  });
}

type Health = { tick?: { hz: number; ms: number; maxMs: number }; cpu?: number; rssMb?: number; conns?: number; spectators?: number; txPerSec?: number; players?: number };
const health = async (): Promise<Health | null> => {
  try {
    return (await (await fetch(`${BASE}/health`)).json()) as Health;
  } catch {
    return null;
  }
};

type Run = { code: string; level: string | null; bots: Bot[]; watchers: Bot[]; joinMs: number; reconnect: 'kept' | 'lost' | 'skipped' };

/** One match: make it, fill it (the host first, the rest at once, like a lobby filling from a bChatX invite). */
async function fill(k: number): Promise<Run> {
  const r = await fetch(`${BASE}/matches`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://tokenblaster.lol' }, body: JSON.stringify({ mode: MODE, level: LEVEL, tournamentId: 'load-test' }) });
  const made = (await r.json()) as { code: string; level?: string; error?: string };
  if (!made.code) throw new Error(`could not make match ${k}: ${made.error ?? r.status}`);
  const t0 = performance.now();
  const host = await connect(made.code, 0);
  const bots = [host, ...(await Promise.all(Array.from({ length: N - 1 }, (_, i) => connect(made.code, i + 1))))];
  const joinMs = performance.now() - t0;
  const watchers = await Promise.all(Array.from({ length: WATCHERS }, (_, i) => connect(made.code, 100 + i, { watch: true })));
  return { code: made.code, level: made.level ?? null, bots, watchers, joinMs, reconnect: 'skipped' };
}

const runs: Run[] = [];
for (let k = 0; k < MATCHES; k++) runs.push(await fill(k));
if (!JSON_OUT) console.log(`${MATCHES} match(es) ${runs.map((r) => r.code).join(', ')} (${MODE}, level ${runs[0].level ?? 'n/a'}, ${N} bots each) at ${BASE}`);
for (const r of runs) r.bots[0].ws.send(JSON.stringify({ t: 'start' }));
const t0 = Date.now();
let pingId = 0;
const allBots = () => runs.flatMap((r) => r.bots);
// spread the aim round the compass (a plaza crowd fires every way, not all down one street)
const yawOf = (b: Bot, t: number) => Math.sin(t * 0.7 + b.i) * 1.2 + (b.i % 2 && MODE === 'pvp' ? Math.PI : 0) + (LEVEL === 'melee' ? (b.i % 8) * 0.785 : 0);
const moveLoop = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  for (const b of allBots()) {
    if (b.ws.readyState !== WebSocket.OPEN) continue;
    b.ws.send(JSON.stringify({ t: 'in', x: b.x + Math.sin(t + b.i) * 0.3, z: b.z + Math.cos(t * 0.5 + b.i) * 0.3, yaw: yawOf(b, t) }));
  }
}, 50);
const fireLoop = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  for (const b of allBots()) if (b.ws.readyState === WebSocket.OPEN) b.ws.send(JSON.stringify({ t: 'shot', yaw: yawOf(b, t) }));
}, 75);
const pingLoop = setInterval(() => {
  for (const b of [...allBots(), ...runs.flatMap((r) => r.watchers)]) {
    if (b.ws.readyState !== WebSocket.OPEN) continue;
    const id = ++pingId;
    b.pings.set(id, performance.now());
    b.ws.send(JSON.stringify({ t: 'ping', id }));
  }
}, 500);
const server: Health[] = [];
const healthLoop = setInterval(async () => {
  const h = await health();
  if (h) server.push(h);
  if (PID)
    try {
      psCpu.push(Number(execFileSync('ps', ['-o', '%cpu=', '-p', PID]).toString().trim()));
    } catch {
      /* gone */
    }
}, 2000);
// drop one bot per match mid-match and bring it back with its resume token
setTimeout(() => {
  for (const run of runs)
    void (async () => {
      const b = run.bots[1];
      if (!b) return;
      const before = b.id;
      b.ws.close();
      await new Promise((r) => setTimeout(r, 400));
      const again = await connect(run.code, 1, { resume: b.resume });
      run.reconnect = again.id === before ? 'kept' : 'lost';
      run.bots[1] = again;
    })();
}, (SECS * 1000) / 2);
await new Promise((r) => setTimeout(r, SECS * 1000));
[moveLoop, fireLoop, pingLoop, healthLoop].forEach(clearInterval);
const h = await health();
if (h) server.push(h);

// each client's rate over its own live window (the resumed bot only saw the second half)
const rate = (b: Bot) => (b.snaps > 1 ? (b.snaps - 1) / ((b.lastSnap - b.firstSnap) / 1000) : 0);
type MatchState = { phase: string; wave: number | null; players: { shots: number }[]; txPerSec?: number };
const perMatch = await Promise.all(
  runs.map(async (run) => {
    const s = (await (await fetch(`${BASE}/matches/${run.code}`)).json()) as MatchState;
    const live = run.bots.map(rate);
    const gaps = run.bots.flatMap((b) => b.gaps);
    const rtt = [...run.bots, ...run.watchers].flatMap((b) => b.rtt);
    const kbps = run.bots.map((b) => b.bytes / SECS / 1024);
    return {
      match: run.code,
      players: s.players.length,
      joinedMs: Math.round(run.joinMs),
      spectators: run.watchers.length,
      spectatorSnapsPerSec: run.watchers.length ? r1(Math.min(...run.watchers.map(rate))) : null,
      tickHz: { min: r1(Math.min(...live)), mean: r1(mean(live)) },
      snapGapMs: { p50: r1(pct(gaps, 50)), p95: r1(pct(gaps, 95)), max: r1(Math.max(0, ...gaps)) },
      rttMs: { p50: r1(pct(rtt, 50)), p95: r1(pct(rtt, 95)), max: r1(Math.max(0, ...rtt)) },
      downKBps: r1(mean(kbps)),
      downKBpsMax: r1(Math.max(...kbps)),
      spectatorKBps: run.watchers.length ? r1(mean(run.watchers.map((b) => b.bytes / SECS / 1024))) : null,
      snapBytes: { player: Math.round(mean(run.bots.map((b) => b.snapBytes / Math.max(1, b.snapN)))), spectator: run.watchers.length ? Math.round(mean(run.watchers.map((b) => b.snapBytes / Math.max(1, b.snapN)))) : null },
      seen: { players: Math.max(...run.bots.map((b) => b.seenP)), enemies: Math.max(...run.bots.map((b) => b.seenE)) },
      shots: s.players.reduce((a, p) => a + p.shots, 0),
      roomTxPerSec: s.txPerSec ?? null,
      phase: s.phase,
      wave: s.wave,
      reconnect: run.reconnect,
      errors: [...new Set([...run.bots, ...run.watchers].flatMap((b) => b.errs))],
    };
  }),
);
const ticks = server.map((x) => x.tick?.hz ?? 0).filter((x) => x > 0);
const cpu = server.map((x) => x.cpu ?? 0);
const worst = [...perMatch].sort((a, b) => a.tickHz.min - b.tickHz.min)[0];
const result = {
  url: BASE,
  mode: MODE,
  level: runs[0].level,
  secs: SECS,
  matches: MATCHES,
  botsPerMatch: N,
  ...worst,
  server: {
    tickHz: ticks.length ? r1(Math.min(...ticks)) : null,
    tickMs: server.length ? Math.max(...server.map((x) => x.tick?.ms ?? 0)) : null,
    tickMaxMs: server.length ? Math.max(...server.map((x) => x.tick?.maxMs ?? 0)) : null,
    cpuPct: cpu.length ? { mean: r1(mean(cpu)), max: r1(Math.max(...cpu)) } : null,
    rssMb: server.length ? Math.max(...server.map((x) => x.rssMb ?? 0)) : null,
    psCpuPct: psCpu.length ? { mean: r1(mean(psCpu)), max: r1(Math.max(...psCpu)) } : null,
    txPerSec: h?.txPerSec ?? null,
  },
  perMatch: MATCHES > 1 ? perMatch : undefined,
};
const ok = perMatch.every((m) => m.players >= N && m.tickHz.min >= MIN_HZ && m.reconnect !== 'lost' && (!WATCHERS || (m.spectatorSnapsPerSec ?? 0) >= MIN_HZ));
if (JSON_OUT) console.log(JSON.stringify({ ok, ...result }));
else {
  for (const m of perMatch) {
    console.log(`── ${m.match}: players ${m.players}/${N} joined in ${m.joinedMs} ms, ${m.spectators} spectators (${m.spectatorSnapsPerSec} snaps/s)`);
    console.log(`   tick on the wire: min ${m.tickHz.min} Hz, mean ${m.tickHz.mean} Hz; snapshot gap p50 ${m.snapGapMs.p50} / p95 ${m.snapGapMs.p95} / max ${m.snapGapMs.max} ms`);
    console.log(`   round trip: p50 ${m.rttMs.p50} / p95 ${m.rttMs.p95} / max ${m.rttMs.max} ms; down ${m.downKBps} kB/s per player (max ${m.downKBpsMax}), spectator ${m.spectatorKBps} kB/s`);
    console.log(`   snapshot ${m.snapBytes.player} B per player (${m.seen.players} players / ${m.seen.enemies} Erobots max in view), ${m.snapBytes.spectator} B per spectator`);
    console.log(`   shots ${m.shots}, room tx/s ${m.roomTxPerSec}, phase ${m.phase}, wave ${m.wave}, reconnect ${m.reconnect}${m.errors.length ? `, errors ${m.errors.join('; ')}` : ''}`);
  }
  const S = result.server;
  console.log(`server: ${S.tickHz} Hz min, tick ${S.tickMs} ms avg (max ${S.tickMaxMs} ms), CPU ${JSON.stringify(S.cpuPct)} %${PID ? ` (ps ${JSON.stringify(S.psCpuPct)} %)` : ''}, ${S.rssMb} MB, tx/s ${S.txPerSec}`);
  console.log(ok ? 'PASS' : 'FAIL');
}
for (const r of runs) [...r.bots, ...r.watchers].forEach((b) => b.ws.close());
process.exit(ok ? 0 : 1);
