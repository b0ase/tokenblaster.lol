import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CABINETS, boardsOf, overallRanking, playerOf, unclaimedBoards } from './hallOfFame';
import type { ScoreRow } from './scores';

const row = (name: string, score: number, meta: Record<string, unknown> = {}): ScoreRow => ({ id: score, name, score, secs: 10, mode: 'practice', verified: false, txid: null, meta, created_at: '2026-10-07T00:00:00Z' });

test('every score board belongs to a cabinet, so new games cannot miss the hall', () => {
  assert.deepEqual(unclaimedBoards(), []);
  assert.ok(boardsOf(CABINETS.find((c) => c.id === 'bracer')!).length >= 2);
});

test('overall ranking: F1 points, best board per cabinet counts once, ties break on wins', () => {
  const r = overallRanking({
    a: [[row('Ann', 9), row('Bob', 8)], [row('Bob', 50), row('Ann', 40)]],
    b: [[row('Bob', 5), row('Cy', 4)]],
  });
  assert.equal(r[0].player.name, 'Bob');
  assert.equal(r[0].points, 25 + 25);
  assert.equal(r[0].wins, 2);
  assert.equal(r.find((x) => x.player.name === 'Ann')!.points, 25);
  assert.equal(r.find((x) => x.player.name === 'Cy')!.points, 18);
});

test('overall ranking: one row per player per board, case-insensitive, top 10 only', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`p${i}`, 100 - i));
  const r = overallRanking({ g: [[row('ZED', 200), row('zed', 150), ...rows]] });
  assert.equal(r.find((x) => x.player.key === 'zed')!.points, 25);
  assert.equal(r.find((x) => x.player.key === 'p0')!.points, 18);
  assert.equal(r.find((x) => x.player.key === 'p9'), undefined);
});

test('a valid meta.x is an identity, anything else is just the name', () => {
  assert.deepEqual(playerOf(row('Ann', 1, { x: '@Alice_1' })), { key: 'alice_1', name: '@Alice_1', handle: 'Alice_1', verified: false });
  assert.equal(playerOf(row('Ann', 1, { x: 'Alice_1', xv: 1 })).verified, true);
  assert.equal(playerOf(row('Ann', 1, { xv: 1 })).verified, false); // a tick needs a handle
  assert.equal(playerOf(row('Ann', 1, { x: 'not a handle!' })).handle, null);
  assert.equal(playerOf(row('Ann', 1)).name, 'Ann');
});
