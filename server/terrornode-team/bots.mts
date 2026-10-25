/**
 * Headless load / smoke test: N bot clients join one match, the host starts it, everyone moves and fires at 20 Hz,
 * one bot drops and reconnects with its resume token. Prints the public match state at the end.
 *   pnpm team:server            (in one shell)
 *   pnpm team:bots -- --n 16 --mode pvp --secs 10
 * Nothing here touches a wallet: bot shots carry no txid.
 */
import WebSocket from 'ws';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const BASE = arg('url', 'http://localhost:8787');
const N = Number(arg('n', '16'));
const MODE = arg('mode', 'pvp');
const SECS = Number(arg('secs', '10'));
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

type Bot = { ws: WebSocket; id?: string; resume?: string; x: number; z: number; yaw: number; snaps: number; errs: string[] };

function connect(code: string, i: number, resume?: string): Promise<Bot> {
  return new Promise((res, rej) => {
    const b: Bot = { ws: new WebSocket(WS_URL), x: 0, z: 0, yaw: 0, snaps: 0, errs: [] };
    b.ws.on('open', () => b.ws.send(JSON.stringify({ t: 'join', match: code, name: `bot${i}`, side: i % 2 ? 'erobotz' : 'npg', resume })));
    b.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome') {
        [b.id, b.resume] = [m.you, m.resume];
        res(b);
      } else if (m.t === 'snap') {
        b.snaps++;
        const me = m.p.find((p: unknown[]) => p[0] === b.id);
        if (me) [b.x, b.z] = [me[1], me[2]];
      } else if (m.t === 'err') b.errs.push(m.error);
    });
    b.ws.on('error', rej);
  });
}

const r = await fetch(`${BASE}/matches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: MODE, tournamentId: 'local-test' }) });
const { code, inviteUrl } = (await r.json()) as { code: string; inviteUrl: string };
console.log(`match ${code} (${MODE}) invite ${inviteUrl}`);
const bots: Bot[] = [];
for (let i = 0; i < N; i++) bots.push(await connect(code, i));
bots[0].ws.send(JSON.stringify({ t: 'start' }));
const t0 = Date.now();
const loop = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  bots.forEach((b, i) => {
    if (b.ws.readyState !== WebSocket.OPEN) return;
    b.yaw = Math.sin(t * 0.7 + i) * 1.2 + (i % 2 ? Math.PI : 0);
    b.ws.send(JSON.stringify({ t: 'in', x: b.x + Math.sin(t + i) * 0.3, z: b.z + Math.cos(t * 0.5 + i) * 0.3, yaw: b.yaw }));
    b.ws.send(JSON.stringify({ t: 'shot', yaw: b.yaw }));
  });
}, 50);
// drop one bot mid-match and bring it back with its resume token
setTimeout(async () => {
  const b = bots[1];
  const before = b.id;
  b.ws.close();
  await new Promise((r) => setTimeout(r, 500));
  const again = await connect(code, 1, b.resume);
  console.log(`reconnect: ${again.id === before ? 'same player slot kept' : 'NEW SLOT (bad)'}`);
  bots[1] = again;
}, (SECS * 1000) / 2);
await new Promise((r) => setTimeout(r, SECS * 1000));
clearInterval(loop);
const s = (await (await fetch(`${BASE}/matches/${code}`)).json()) as { phase: string; teams: { name: string; size: number; frags: number; score: number }[]; players: { shots: number }[]; wave: number | null; enemiesLive: number | null };
const snaps = bots.map((b) => b.snaps);
console.log(`phase ${s.phase} wave ${s.wave} enemies ${s.enemiesLive}`);
for (const t of s.teams) console.log(`  ${t.name}: ${t.size} players, ${t.frags} frags, ${t.score} pts`);
console.log(`players ${s.players.length}, shots ${s.players.reduce((a, p) => a + p.shots, 0)}, snapshots/bot min ${Math.min(...snaps)} max ${Math.max(...snaps)} (~${(Math.min(...snaps) / SECS).toFixed(1)} Hz)`);
const errs = [...new Set(bots.flatMap((b) => b.errs))];
if (errs.length) console.log('errors:', errs);
bots.forEach((b) => b.ws.close());
process.exit(0);
