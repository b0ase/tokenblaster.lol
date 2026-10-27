/**
 * TERRORNODE team chat: routing rules (unit) and a real local team server with 2 players a side + a spectator.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { CHAT_MAX, allowChat, cleanText, parseChat, routeChat, serverHasChat } from './teammode/chat';

test('cleanText strips control chars, collapses space, clamps length', () => {
  assert.equal(cleanText('  hi\u0000\u0007 there\n\n‮yo '), 'hi there yo');
  assert.equal(cleanText('x'.repeat(500)).length, CHAT_MAX);
  assert.equal(cleanText(42), '');
  assert.equal(cleanText('\u0001\u0002'), '');
});

test('allowChat: 5 per 5 s sliding window', () => {
  const t: number[] = [];
  for (let i = 0; i < 5; i++) assert.ok(allowChat(t, 1000 + i));
  assert.equal(allowChat(t, 2000), false);
  assert.ok(allowChat(t, 6001));
});

const peers = [
  { id: 'a1', player: 'a1', team: 'npg', watch: false },
  { id: 'a2', player: 'a2', team: 'npg', watch: false },
  { id: 'b1', player: 'b1', team: 'erobotz', watch: false },
  { id: 'b2', player: 'b2', team: 'erobotz', watch: false },
  { id: 'w', player: null, team: null, watch: true },
];
const ids = (r: ReturnType<typeof routeChat<(typeof peers)[number]>>) => (r.ok ? r.recipients.map((p) => p.id).sort() : r.error);

test('routeChat: team stays on its side, all reaches everyone, dm only target + sender', () => {
  assert.deepEqual(ids(routeChat(peers[0], peers, { ch: 'team', text: 'push B' })), ['a1', 'a2']);
  assert.deepEqual(ids(routeChat(peers[2], peers, { ch: 'team', text: 'x' })), ['b1', 'b2']);
  assert.deepEqual(ids(routeChat(peers[0], peers, { ch: 'all', text: 'gg' })), ['a1', 'a2', 'b1', 'b2', 'w']);
  assert.deepEqual(ids(routeChat(peers[0], peers, { ch: 'dm', to: 'b2', text: 'hey' })), ['a1', 'b2']);
  assert.equal(routeChat(peers[4], peers, { ch: 'all', text: 'hi' }).ok, false, 'spectators cannot send');
  assert.equal(routeChat(peers[0], peers, { ch: 'dm', to: 'w', text: 'hi' }).ok, false, 'no dm to spectators');
  assert.equal(routeChat(peers[0], peers, { ch: 'dm', to: 'zz', text: 'hi' }).ok, false);
  assert.equal(routeChat(peers[0], peers, { ch: 'shout', text: 'hi' }).ok, false);
  assert.equal(routeChat(peers[0], peers, { ch: 'all', text: '   ' }).ok, false);
});

test('parseChat validates server frames', () => {
  assert.equal(parseChat({ t: 'chat', ch: 'nope', from: 'a', text: 'x' }), null);
  assert.equal(parseChat({ t: 'chat', ch: 'all', from: 'a', text: '' }), null);
  assert.equal(parseChat('x'), null);
  const m = parseChat({ t: 'chat', ch: 'dm', from: 'a', name: '<b>x</b>\u0000', team: 'npg', to: 'b', text: ' hi ', at: 5 });
  assert.deepEqual(m, { t: 'chat', ch: 'dm', from: 'a', name: '<b>x</b>', team: 'npg', to: 'b', text: 'hi', at: 5 });
  assert.equal(serverHasChat({ features: ['chat'] }), true);
  assert.equal(serverHasChat({}), false, 'old servers: chat hidden');
});

// ── a real local server ──
const PORT = 20_000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let srv: ChildProcess;
before(async () => {
  srv = spawn('node_modules/.bin/tsx', ['server/terrornode-team/server.ts'], { env: { ...process.env, PORT: String(PORT), ALLOW_ORIGINS: '', TEAM_BOTS: '0' }, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('team server did not start');
});
after(() => void srv?.kill());

type Sock = { ws: WebSocket; got: Record<string, unknown>[]; you?: string; features?: unknown };
const connect = (first: Record<string, unknown>) =>
  new Promise<Sock>((res, rej) => {
    const s: Sock = { ws: new WebSocket(`ws://127.0.0.1:${PORT}/ws`), got: [] };
    s.ws.on('open', () => s.ws.send(JSON.stringify(first)));
    s.ws.on('error', rej);
    s.ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'welcome' || m.t === 'watching') {
        s.you = m.you;
        s.features = m.features;
        res(s);
      }
      if (m.t === 'chat' || m.t === 'chatErr') s.got.push(m);
    });
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('local server: team isolation, all, dm, spectator, rate limit, length', async () => {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  assert.ok(health.features.includes('chat'));
  const { code } = await fetch(`${BASE}/matches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'pvp' }) }).then((r) => r.json());
  // PvP balances sides, so join alternately
  const a1 = await connect({ t: 'join', match: code, name: 'alice', side: 'npg' });
  const b1 = await connect({ t: 'join', match: code, name: 'bob', side: 'erobotz' });
  const a2 = await connect({ t: 'join', match: code, name: 'amy', side: 'npg' });
  const b2 = await connect({ t: 'join', match: code, name: 'ben', side: 'erobotz' });
  const w = await connect({ t: 'watch', match: code });
  assert.ok(serverHasChat(a1) && serverHasChat(w));
  const all = [a1, a2, b1, b2, w];
  const say = (s: Sock, m: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: 'chat', ...m }));
  const texts = (s: Sock) => s.got.filter((m) => m.t === 'chat').map((m) => String(m.text)).sort();

  say(a1, { ch: 'team', text: 'npg secret' });
  say(b1, { ch: 'team', text: 'erobotz secret' });
  say(a2, { ch: 'all', text: 'gl hf' });
  say(b2, { ch: 'dm', to: a1.you, text: 'psst' });
  say(w, { ch: 'all', text: 'spectator says hi' });
  say(a1, { ch: 'all', text: 'y'.repeat(1000) });
  await wait(300);

  assert.deepEqual(texts(a1), ['gl hf', 'npg secret', 'psst', 'y'.repeat(CHAT_MAX)]);
  assert.deepEqual(texts(a2), ['gl hf', 'npg secret', 'y'.repeat(CHAT_MAX)]);
  assert.deepEqual(texts(b1), ['erobotz secret', 'gl hf', 'y'.repeat(CHAT_MAX)]);
  assert.deepEqual(texts(b2), ['erobotz secret', 'gl hf', 'psst', 'y'.repeat(CHAT_MAX)]);
  assert.deepEqual(texts(w), ['gl hf', 'y'.repeat(CHAT_MAX)]);
  assert.ok(w.got.some((m) => m.t === 'chatErr'), 'spectator send refused');
  const dm = b2.got.find((m) => m.text === 'psst')!;
  assert.equal(dm.name, 'ben');
  assert.equal(dm.ch, 'dm');

  // rate limit: a1 already sent 2; 3 more pass, the 6th inside 5 s is refused
  for (let i = 0; i < 4; i++) say(a1, { ch: 'team', text: `r${i}` });
  await wait(300);
  assert.deepEqual(texts(a2).filter((t) => String(t).startsWith('r')), ['r0', 'r1', 'r2']);
  assert.ok(a1.got.some((m) => m.t === 'chatErr' && String(m.error).includes('Slow down')));
  for (const s of all) s.ws.close();
});
