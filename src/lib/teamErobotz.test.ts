/**
 * Playable EROBOTZ (team PvP only): side stats, server rules, the feature flag, and a real local team server with
 * 2 bots a side (NPG v EROBOTZ) plus a spectator.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { EROBOTZ_FEATURE, RULES, SIDE_STATS, TEAM_NAME, createMatch, join, move, publicState, serverHasErobotz, shoot, start, statsFor, tick, type Match, type SideStats } from './teammode/match';

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mk = (mode: 'coop' | 'pvp') => createMatch({ code: 'EROBO', mode, tournamentId: null, now: 0, rand });
let n = 0;
const add = (m: Match, side: 'npg' | 'erobotz') => {
  const r = join(m, { name: `p${++n}`, side, now: 0, id: `id${n}`, resumeToken: `r${n}` });
  assert.ok(r.ok);
  return r.player;
};
const aim = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

test('side names and stats: NPG base, EROBOTZ heavier, slower, harder-hitting, slower-firing', () => {
  assert.equal(TEAM_NAME.npg, 'NPG');
  assert.equal(TEAM_NAME.erobotz, 'EROBOTZ');
  const [g, e] = [SIDE_STATS.npg, SIDE_STATS.erobotz];
  assert.deepEqual(g, { hp: RULES.hp, speed: RULES.speed, shotDamage: RULES.shotDamage, shotGapMs: RULES.shotGapMs });
  assert.ok(e.hp > g.hp && e.speed < g.speed && e.shotDamage > g.shotDamage && e.shotGapMs > g.shotGapMs);
  // balanced, small: time to kill within 25% either way
  const ttk = (atk: SideStats, def: SideStats) => (Math.ceil(def.hp / atk.shotDamage) - 1) * atk.shotGapMs;
  const r = ttk(g, e) / ttk(e, g);
  assert.ok(r > 0.75 && r < 1.33, `ttk ratio ${r}`);
  // co-op: everyone plays NPG numbers (the Erobotz are the server's horde there)
  assert.deepEqual(statsFor('coop', 'erobotz'), g);
  assert.deepEqual(statsFor('pvp', 'erobotz'), e);
});

test('server rules: erobot HP on join/start/respawn, its damage, fire gap and speed cap', () => {
  const m = mk('pvp');
  const g = add(m, 'npg');
  const e = add(m, 'erobotz');
  assert.equal(e.hp, SIDE_STATS.erobotz.hp);
  assert.equal(g.hp, SIDE_STATS.npg.hp);
  assert.equal(start(m, g.id, 0).ok, true);
  assert.equal(e.hp, SIDE_STATS.erobotz.hp);
  [g.x, g.z, e.x, e.z] = [0, 0, 0, -10];
  // the erobot's cannon: refused inside its gap, 25 a hit, 4 hits to flatline a girl
  let t = 1000;
  assert.equal(shoot(m, e.id, aim(e, g), null, t).hit?.id, g.id);
  assert.equal(g.hp, 100 - SIDE_STATS.erobotz.shotDamage);
  assert.equal(shoot(m, e.id, aim(e, g), null, t + SIDE_STATS.erobotz.shotGapMs - 5).ok, false);
  for (let i = 0; i < 3; i++) shoot(m, e.id, aim(e, g), null, (t += 200));
  assert.equal(g.alive, false);
  assert.equal(m.frags.erobotz, 1);
  // respawn at full side HP
  e.hp = 1;
  e.alive = false;
  e.respawnAt = t;
  tick(m, t + 1);
  assert.equal(e.hp, SIDE_STATS.erobotz.hp);
  // speed cap: an erobot moves at most its own speed
  e.lastMove = 0;
  [e.x, e.z] = [0, 0];
  move(m, e.id, 0, -50, 0, 1000);
  assert.ok(Math.abs(e.z) <= SIDE_STATS.erobotz.speed + 0.26, `moved ${e.z}`);
});

test('co-op is unchanged: the squad is NPG with base HP', () => {
  const m = mk('coop');
  const p = add(m, 'erobotz');
  assert.equal(p.team, 'npg');
  assert.equal(p.hp, RULES.hp);
});

test('public state carries per-side stats (additive)', () => {
  const m = mk('pvp');
  add(m, 'npg');
  add(m, 'erobotz');
  const s = publicState(m, 0);
  assert.deepEqual(s.teams.map((t) => [t.name, t.stats.hp]), [['NPG', 100], ['EROBOTZ', SIDE_STATS.erobotz.hp]]);
});

test('client parse: the feature flag (older servers have none)', () => {
  assert.equal(serverHasErobotz({ features: ['chat', EROBOTZ_FEATURE] }), true);
  assert.equal(serverHasErobotz({ features: ['chat'] }), false);
  assert.equal(serverHasErobotz({}), false);
  assert.equal(serverHasErobotz(null), false);
});

// ── a real local team server: 2 NPG bots v 2 EROBOTZ bots + a spectator ──
let srv: ChildProcess | null = null;
const PORT = 22_500 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
before(async () => {
  srv = spawn('node_modules/.bin/tsx', ['server/terrornode-team/server.ts'], { env: { ...process.env, PORT: String(PORT), ALLOW_ORIGINS: '', TEAM_BOTS: '0' }, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('team server did not start');
});
after(() => void srv?.kill());

type Sock = { ws: WebSocket; got: Record<string, unknown>[] };
const open = (first: Record<string, unknown>) =>
  new Promise<Sock>((res, rej) => {
    const s: Sock = { ws: new WebSocket(`ws://127.0.0.1:${PORT}/ws`), got: [] };
    s.ws.on('message', (d) => s.got.push(JSON.parse(String(d))));
    s.ws.on('open', () => {
      s.ws.send(JSON.stringify(first));
      res(s);
    });
    s.ws.on('error', rej);
  });
const until = async (s: Sock, f: (m: Record<string, unknown>) => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = s.got.find(f);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timeout');
};

test('local server: health lists erobotz + chat; 2 v 2 bots; erobot HP in snapshots; chat still routes by side', async () => {
  const h = await (await fetch(`${BASE}/health`)).json();
  assert.ok(h.features.includes('erobotz') && h.features.includes('chat'));
  const { code } = await (await fetch(`${BASE}/matches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"mode":"pvp"}' })).json();
  const bots: Sock[] = [];
  for (const side of ['npg', 'erobotz', 'npg', 'erobotz']) {
    const s = await open({ t: 'join', match: code, name: `bot-${side}`, side });
    const w = await until(s, (m) => m.t === 'welcome');
    assert.equal(serverHasErobotz(w), true);
    bots.push(s);
  }
  const spec = await open({ t: 'watch', match: code });
  assert.equal(serverHasErobotz(await until(spec, (m) => m.t === 'watching')), true);
  bots[0].ws.send(JSON.stringify({ t: 'start' }));
  const st = (await until(bots[0], (m) => m.t === 'state' && (m.state as { phase: string }).phase === 'live')) as { state: { teams: { name: string; size: number; stats: { hp: number } }[] } };
  assert.deepEqual(st.state.teams.map((t) => [t.name, t.size, t.stats.hp]), [['NPG', 2, 100], ['EROBOTZ', 2, SIDE_STATS.erobotz.hp]]);
  const snap = (await until(spec, (m) => m.t === 'snap' && Array.isArray(m.p) && (m.p as unknown[]).length === 4)) as { p: [string, number, number, number, number, number, string][] };
  for (const p of snap.p) assert.equal(p[4], p[6] === 'erobotz' ? SIDE_STATS.erobotz.hp : 100);
  // everyone fires for a second
  for (let i = 0; i < 10; i++) {
    for (const b of bots) b.ws.send(JSON.stringify({ t: 'shot', yaw: Math.random() * 6.28 }));
    await new Promise((r) => setTimeout(r, 100));
  }
  // team chat from an erobot reaches only the erobotz
  bots[1].ws.send(JSON.stringify({ t: 'chat', ch: 'team', text: 'bolts up' }));
  await until(bots[3], (m) => m.t === 'chat' && m.text === 'bolts up');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(bots[0].got.some((m) => m.t === 'chat'), false);
  const pub = await (await fetch(`${BASE}/matches/${code}`)).json();
  assert.ok(pub.players.reduce((a: number, p: { shots: number }) => a + p.shots, 0) > 10);
  for (const s of [...bots, spec]) s.ws.close();
});
