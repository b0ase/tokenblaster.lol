/**
 * Integration: a real team server (server/terrornode-team/server.ts) on a spare port, a spectator joining a room
 * read-only, and the 16-bot load script (server/terrornode-team/load.mts) holding a 16-player session.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { roomFrom, txRate } from './terrornode/spectate';

const PORT = 18_000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const TSX = 'node_modules/.bin/tsx';
let srv: ChildProcess;

before(async () => {
  srv = spawn(TSX, ['server/terrornode-team/server.ts'], { env: { ...process.env, PORT: String(PORT), ALLOW_ORIGINS: '' }, stdio: 'pipe' });
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('team server did not start');
});
after(() => void srv?.kill());

test('watch URL room code and tx/s', () => {
  assert.equal(roomFrom(new URLSearchParams('room=ab2cd')), 'AB2CD');
  assert.equal(roomFrom(new URLSearchParams('match=XYZ23')), 'XYZ23');
  assert.equal(roomFrom(new URLSearchParams('room=O0O0O')), null);
  assert.equal(roomFrom(new URLSearchParams('')), null);
  assert.deepEqual(txRate([{ at: 0, tx: 0, shots: 0 }, { at: 2000, tx: 600, shots: 800 }]), { tx: 300, shots: 400 });
  assert.deepEqual(txRate([{ at: 0, tx: 5, shots: 5 }]), { tx: 0, shots: 0 });
  assert.deepEqual(txRate([{ at: 0, tx: 0, shots: 0 }, { at: 20, tx: 50, shots: 50 }]), { tx: 0, shots: 0 }, 'two states a few ms apart are not a rate');
});

const open = (msg: object) =>
  new Promise<{ ws: WebSocket; got: Record<string, unknown>[] }>((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const got: Record<string, unknown>[] = [];
    ws.on('message', (raw) => got.push(JSON.parse(String(raw))));
    ws.on('open', () => (ws.send(JSON.stringify(msg)), res({ ws, got })));
    ws.on('error', rej);
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a spectator joins a room read-only: state + snapshots, no slot, cannot act', async () => {
  const made = (await (await fetch(`${BASE}/matches`, { method: 'POST', body: JSON.stringify({ mode: 'coop', level: 'heart' }) })).json()) as { code: string; level: string };
  assert.equal(made.level, 'heart');
  const host = await open({ t: 'join', match: made.code, name: 'host' });
  await wait(150);
  const watcher = await open({ t: 'watch', match: made.code });
  await wait(150);
  const w0 = watcher.got.find((m) => m.t === 'watching') as { state: { players: unknown[]; level: string } } | undefined;
  assert.ok(w0, 'watching ack with the state');
  assert.equal(w0!.state.players.length, 1, 'the spectator takes no player slot');
  assert.equal(w0!.state.level, 'heart');
  // a spectator cannot start the match or join as a player on the same socket
  watcher.ws.send(JSON.stringify({ t: 'start' }));
  watcher.ws.send(JSON.stringify({ t: 'join', match: made.code, name: 'sneak' }));
  await wait(150);
  let s = (await (await fetch(`${BASE}/matches/${made.code}`)).json()) as { phase: string; players: unknown[] };
  assert.equal(s.phase, 'lobby');
  assert.equal(s.players.length, 1);
  host.ws.send(JSON.stringify({ t: 'start' }));
  await wait(600);
  s = (await (await fetch(`${BASE}/matches/${made.code}`)).json()) as { phase: string; players: unknown[] };
  assert.equal(s.phase, 'live');
  const snaps = watcher.got.filter((m) => m.t === 'snap' && m.phase === 'live');
  assert.ok(snaps.length >= 6, `spectator gets live snapshots (${snaps.length})`);
  const h = (await (await fetch(`${BASE}/health`)).json()) as { spectators: number; tick: { target: number } };
  assert.equal(h.spectators, 1);
  assert.equal(h.tick.target, 20);
  // a bad room is refused
  const bad = await open({ t: 'watch', match: 'ZZZZZ' });
  await wait(150);
  assert.ok(bad.got.some((m) => m.t === 'err'));
  [host, watcher, bad].forEach((x) => x.ws.close());
});

test('16-bot load script: a 16-player session holds 20 Hz with spectators', async () => {
  const { stdout } = await promisify(execFile)(TSX, ['server/terrornode-team/load.mts', '--url', BASE, '--n', '16', '--mode', 'coop', '--level', 'market', '--secs', '6', '--watchers', '2', '--json'], { timeout: 60_000 });
  const r = JSON.parse(stdout.trim().split('\n').at(-1)!) as { ok: boolean; players: number; tickHz: { min: number }; spectatorSnapsPerSec: number; reconnect: string; rttMs: { p95: number }; shots: number; level: string };
  console.log('load result', JSON.stringify(r));
  assert.equal(r.players, 16);
  assert.equal(r.level, 'market');
  assert.ok(r.tickHz.min >= 18, `tick ${r.tickHz.min} Hz`);
  assert.ok(r.spectatorSnapsPerSec >= 18);
  assert.equal(r.reconnect, 'kept');
  assert.ok(r.shots > 500);
  assert.ok(r.ok);
});

test('64-bot MELEE: one room of 64 joins, holds 20 Hz, interest-managed snapshots, reconnect keeps the slot', async () => {
  const { stdout } = await promisify(execFile)(TSX, ['server/terrornode-team/load.mts', '--url', BASE, '--n', '64', '--mode', 'coop', '--level', 'melee', '--secs', '6', '--watchers', '1', '--json'], { timeout: 90_000 });
  const r = JSON.parse(stdout.trim().split('\n').at(-1)!) as { ok: boolean; players: number; level: string; tickHz: { min: number }; reconnect: string; seen: { players: number; enemies: number }; snapBytes: { player: number; spectator: number }; roomTxPerSec: number; server: { txPerSec: number } };
  console.log('melee 64 result', JSON.stringify(r));
  assert.equal(r.players, 64);
  assert.equal(r.level, 'melee');
  assert.ok(r.tickHz.min >= 18, `tick ${r.tickHz.min} Hz`);
  assert.equal(r.reconnect, 'kept');
  assert.ok(r.seen.players <= 24, `a bot saw at most 24 players (${r.seen.players})`);
  assert.ok(r.snapBytes.player < r.snapBytes.spectator, 'players get the interest cut, spectators the whole room');
  assert.equal(r.roomTxPerSec, 0, 'bots send no txids: ROOM TX/SEC stays 0');
  assert.ok(r.ok);
});
