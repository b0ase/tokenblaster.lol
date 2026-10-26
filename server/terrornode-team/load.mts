/**
 * 16-PLAYER LOAD TEST for the TERRORNODE team server: N WebSocket bots (not browsers) join one match, the host
 * starts it, every bot moves at 20 Hz and fires at the server's max rate (~13/s), pings every 500 ms, one bot drops
 * and resumes mid-match, and S spectators watch. Measures what each client actually gets:
 *
 *   tick rate   snapshots a second per bot (the server's 20 Hz as seen on the wire), and the gap p50/p95/max
 *   latency     ping -> pong round trip p50/p95/max (ms)
 *   bandwidth   kB/s down per bot
 *   server      tick rate, tick cost and process CPU % as the server measures them (/health), polled every 2 s
 *
 *   pnpm team:server &                                     # local, :8787
 *   pnpm team:load -- --n 16 --mode coop --level heart --secs 30
 *   pnpm team:load -- --url https://team.tokenblaster.lol --n 16 --secs 30 --json
 *
 * Nothing here touches a wallet: bot shots carry no txid. Exit code 1 when the session does not hold (fewer than
 * N joined, the tick rate under --minHz, or the reconnect lost its slot).
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
const JSON_OUT = process.argv.includes('--json');
/** A local server's pid: also sample its CPU with ps (works for servers that predate /health's cpu field). */
const PID = arg('pid', '');
const psCpu: number[] = [];
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

type Bot = { ws: WebSocket; i: number; id?: string; resume?: string; x: number; z: number; snaps: number; gaps: number[]; lastSnap: number; firstSnap: number; rtt: number[]; pings: Map<number, number>; bytes: number; errs: string[] };
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (v: number) => Math.round(v * 10) / 10;

function wire(b: Bot, onWelcome: (b: Bot) => void) {
  b.ws.on('message', (raw: Buffer) => {
    b.bytes += raw.length;
    const m = JSON.parse(String(raw));
    if (m.t === 'welcome' || m.t === 'watching') {
      [b.id, b.resume] = [m.you, m.resume];
      onWelcome(b);
    } else if (m.t === 'snap') {
      const t = performance.now();
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
    const b: Bot = { ws: new WebSocket(WS_URL, { headers: { origin: 'https://tokenblaster.lol' } }), i, x: 0, z: 0, snaps: 0, gaps: [], lastSnap: 0, firstSnap: 0, rtt: [], pings: new Map(), bytes: 0, errs: [] };
    const t = setTimeout(() => rej(new Error(`bot ${i} timed out joining`)), 10_000);
    wire(b, (x) => (clearTimeout(t), res(x)));
    b.ws.on('open', () => b.ws.send(JSON.stringify(o.watch ? { t: 'watch', match: code } : { t: 'join', match: code, name: `bot${i}`, side: i % 2 ? 'erobotz' : 'npg', resume: o.resume })));
    b.ws.on('error', (e) => (clearTimeout(t), rej(e)));
  });
}

type Health = { tick?: { hz: number; ms: number; maxMs: number }; cpu?: number; rssMb?: number; conns?: number; spectators?: number };
const health = async (): Promise<Health | null> => {
  try {
    return (await (await fetch(`${BASE}/health`)).json()) as Health;
  } catch {
    return null;
  }
};

const r = await fetch(`${BASE}/matches`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://tokenblaster.lol' }, body: JSON.stringify({ mode: MODE, level: LEVEL, tournamentId: 'load-test' }) });
const made = (await r.json()) as { code: string; level?: string };
const code = made.code;
if (!JSON_OUT) console.log(`match ${code} (${MODE}, level ${made.level ?? 'n/a'}) at ${BASE}`);
const tJoin = performance.now();
// the first to join hosts (and starts); the other N-1 join at once, like a lobby filling from a bChatX invite
const host = await connect(code, 0);
const bots = [host, ...(await Promise.all(Array.from({ length: N - 1 }, (_, i) => connect(code, i + 1))))];
const joinMs = performance.now() - tJoin;
const watchers = await Promise.all(Array.from({ length: WATCHERS }, (_, i) => connect(code, 100 + i, { watch: true })));
bots[0].ws.send(JSON.stringify({ t: 'start' }));
const t0 = Date.now();
let pingId = 0;
const moveLoop = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  for (const b of bots) {
    if (b.ws.readyState !== WebSocket.OPEN) continue;
    const yaw = Math.sin(t * 0.7 + b.i) * 1.2 + (b.i % 2 && MODE === 'pvp' ? Math.PI : 0);
    b.ws.send(JSON.stringify({ t: 'in', x: b.x + Math.sin(t + b.i) * 0.3, z: b.z + Math.cos(t * 0.5 + b.i) * 0.3, yaw }));
  }
}, 50);
const fireLoop = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  for (const b of bots) if (b.ws.readyState === WebSocket.OPEN) b.ws.send(JSON.stringify({ t: 'shot', yaw: Math.sin(t * 0.7 + b.i) * 1.2 + (b.i % 2 && MODE === 'pvp' ? Math.PI : 0) }));
}, 75);
const pingLoop = setInterval(() => {
  for (const b of [...bots, ...watchers]) {
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
// drop one bot mid-match and bring it back with its resume token
let reconnect = 'skipped' as 'kept' | 'lost' | 'skipped';
setTimeout(async () => {
  const b = bots[1];
  if (!b) return;
  const before = b.id;
  b.ws.close();
  await new Promise((r) => setTimeout(r, 400));
  const again = await connect(code, 1, { resume: b.resume });
  reconnect = again.id === before ? 'kept' : 'lost';
  bots[1] = again;
}, (SECS * 1000) / 2);
await new Promise((r) => setTimeout(r, SECS * 1000));
[moveLoop, fireLoop, pingLoop, healthLoop].forEach(clearInterval);
const h = await health();
if (h) server.push(h);
const s = (await (await fetch(`${BASE}/matches/${code}`)).json()) as { phase: string; wave: number | null; players: { shots: number }[]; teams: { name: string; frags: number }[] };
// each client's rate over its own live window (the resumed bot only saw the second half)
const rate = (b: Bot) => (b.snaps > 1 ? (b.snaps - 1) / ((b.lastSnap - b.firstSnap) / 1000) : 0);
const live = bots.map(rate);
const gaps = bots.flatMap((b) => b.gaps);
const rtt = [...bots, ...watchers].flatMap((b) => b.rtt);
const ticks = server.map((x) => x.tick?.hz ?? 0).filter((x) => x > 0);
const cpu = server.map((x) => x.cpu ?? 0);
const result = {
  url: BASE,
  match: code,
  mode: MODE,
  level: made.level ?? null,
  secs: SECS,
  players: s.players.length,
  joinedMs: Math.round(joinMs),
  spectators: watchers.length,
  spectatorSnapsPerSec: watchers.length ? r1(Math.min(...watchers.map(rate))) : null,
  tickHz: { min: r1(Math.min(...live)), mean: r1(live.reduce((a, b) => a + b, 0) / live.length) },
  snapGapMs: { p50: r1(pct(gaps, 50)), p95: r1(pct(gaps, 95)), max: r1(Math.max(0, ...gaps)) },
  rttMs: { p50: r1(pct(rtt, 50)), p95: r1(pct(rtt, 95)), max: r1(Math.max(0, ...rtt)) },
  downKBps: r1(bots.reduce((a, b) => a + b.bytes, 0) / bots.length / SECS / 1024),
  server: {
    tickHz: ticks.length ? r1(Math.min(...ticks)) : null,
    tickMs: server.length ? Math.max(...server.map((x) => x.tick?.ms ?? 0)) : null,
    tickMaxMs: server.length ? Math.max(...server.map((x) => x.tick?.maxMs ?? 0)) : null,
    cpuPct: cpu.length ? { mean: r1(cpu.reduce((a, b) => a + b, 0) / cpu.length), max: r1(Math.max(...cpu)) } : null,
    rssMb: h?.rssMb ?? null,
    psCpuPct: psCpu.length ? { mean: r1(psCpu.reduce((a, b) => a + b, 0) / psCpu.length), max: r1(Math.max(...psCpu)) } : null,
  },
  shots: s.players.reduce((a, p) => a + p.shots, 0),
  phase: s.phase,
  wave: s.wave,
  reconnect,
  errors: [...new Set([...bots, ...watchers].flatMap((b) => b.errs))],
};
const ok = result.players >= N && result.tickHz.min >= MIN_HZ && reconnect !== 'lost' && (!WATCHERS || (result.spectatorSnapsPerSec ?? 0) >= MIN_HZ);
if (JSON_OUT) console.log(JSON.stringify({ ok, ...result }));
else {
  console.log(`players ${result.players}/${N} joined in ${result.joinedMs} ms, ${result.spectators} spectators (${result.spectatorSnapsPerSec} snaps/s)`);
  console.log(`tick on the wire: min ${result.tickHz.min} Hz, mean ${result.tickHz.mean} Hz; snapshot gap p50 ${result.snapGapMs.p50} / p95 ${result.snapGapMs.p95} / max ${result.snapGapMs.max} ms`);
  console.log(`round trip: p50 ${result.rttMs.p50} / p95 ${result.rttMs.p95} / max ${result.rttMs.max} ms; ${result.downKBps} kB/s down per player`);
  console.log(`server: ${result.server.tickHz} Hz, tick ${result.server.tickMs} ms avg (max ${result.server.tickMaxMs} ms), CPU ${JSON.stringify(result.server.cpuPct)} %${PID ? ` (ps ${JSON.stringify(result.server.psCpuPct)} %)` : ''}, ${result.server.rssMb} MB`);
  console.log(`shots ${result.shots}, phase ${result.phase}, wave ${result.wave}, reconnect ${reconnect}${result.errors.length ? `, errors ${result.errors.join('; ')}` : ''}`);
  console.log(ok ? 'PASS' : 'FAIL');
}
[...bots, ...watchers].forEach((b) => b.ws.close());
process.exit(ok ? 0 : 1);
