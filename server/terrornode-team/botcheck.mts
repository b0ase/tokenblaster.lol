/**
 * Headless 2-client check of the AI NPG girls (src/lib/teammode/bots.ts) against a running team server:
 * one human makes a co-op match and starts it, the bots must appear, move and shoot; a second human joins and must
 * take a bot's seat. Exits non-zero on failure. No wallet, no browser.
 *   pnpm team:server  (another shell)   then   pnpm team:botcheck [-- --url http://localhost:8787]
 */
import WebSocket from 'ws';

const i = process.argv.indexOf('--url');
const BASE = i > 0 ? process.argv[i + 1] : 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws') + '/ws';
type State = { players: { id: string; name: string; bot: boolean; team: string; identityKey: string | null; txShots: number }[] };
type Snap = { p: [string, number, number][]; ev: { k: string; by?: string }[] };

function client(code: string, name: string) {
  const ws = new WebSocket(WS);
  const c = { ws, you: '', state: null as State | null, snaps: [] as Snap[] };
  const ready = new Promise<void>((res, rej) => {
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', match: code, name, side: 'npg' })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome') {
        [c.you, c.state] = [m.you, m.state];
        res();
      } else if (m.t === 'state') c.state = m.state;
      else if (m.t === 'snap') c.snaps.push(m);
      else if (m.t === 'err') rej(new Error(m.error));
    });
    ws.on('error', rej);
  });
  return { c, ready };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fail = (s: string) => {
  console.error('FAIL', s);
  process.exit(1);
};

const r = await fetch(`${BASE}/matches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'coop' }) });
const { code } = (await r.json()) as { code: string };
const A = client(code, 'alice');
await A.ready;
await wait(300);
const bots = () => A.c.state!.players.filter((p) => p.bot);
console.log(`match ${code}: alice + ${bots().length} bots: ${bots().map((b) => b.name).join(', ')}`);
if (bots().length !== 4) fail('expected 4 bots with one human');
if (bots().some((b) => b.identityKey || b.team !== 'npg')) fail('bot with an identity key or off NPG');
A.c.ws.send(JSON.stringify({ t: 'start' }));
await wait(500);
const ids = new Set(bots().map((b) => b.id));
const first = new Map(A.c.snaps.at(-1)!.p.filter((p) => ids.has(p[0])).map((p) => [p[0], [p[1], p[2]]]));
// alice walks forward so the girls have someone to follow; the horde arrives
for (let t = 0; t < 60; t++) {
  const me = A.c.snaps.at(-1)!.p.find((p) => p[0] === A.c.you)!;
  A.c.ws.send(JSON.stringify({ t: 'in', x: me[1], z: me[2] - 0.3, yaw: 0 }));
  await wait(100);
}
const last = A.c.snaps.at(-1)!;
const moved = [...ids].filter((id) => {
  const p = last.p.find((q) => q[0] === id);
  const f = first.get(id);
  return p && f && Math.hypot(p[1] - f[0], p[2] - f[1]) > 0.5;
}).length;
const botShots = A.c.snaps.reduce((s, sn) => s + sn.ev.filter((e) => e.k === 'shot' && e.by && ids.has(e.by)).length, 0);
console.log(`after 6 s: ${moved}/4 bots moved, ${botShots} bot shots, bot txShots ${bots().reduce((s, b) => s + b.txShots, 0)}`);
if (moved < 1) fail('bots did not move');
if (botShots < 1) fail('bots did not shoot');
if (bots().some((b) => b.txShots)) fail('a bot counted a tx');
const B = client(code, 'bob');
await B.ready;
await wait(1500);
const after = A.c.state!.players;
console.log(`bob joined: ${after.filter((p) => !p.bot).length} humans + ${after.filter((p) => p.bot).length} bots`);
if (after.filter((p) => p.bot).length !== 3) fail('bob did not take a bot seat');
B.c.ws.close();
await wait(1500);
console.log(`bob left: ${A.c.state!.players.filter((p) => p.bot).length} bots (bob keeps his seat for the 60 s reconnect grace)`);
A.c.ws.close();
console.log('PASS');
process.exit(0);
