import assert from 'node:assert/strict';
import test from 'node:test';
import { Body, board, corpseSpots, FOOD_SLOTS, FoodField, foodAt, HALF, hashStr, hitsBody, MAX_MASS, PoseBuffer, radiusOf, readCorpses, SPACING, steer, TURN_RATE } from './snake/arenaSim';

test('seeded food: same room + slot + generation is the same place for everyone', () => {
  const a = foodAt(hashStr('room-A'), 7, 3);
  const b = foodAt(hashStr('room-A'), 7, 3);
  assert.deepEqual(a, b);
  assert.notDeepEqual(foodAt(hashStr('room-A'), 7, 4), a);
  assert.notDeepEqual(foodAt(hashStr('room-B'), 7, 3), a);
  for (let s = 0; s < FOOD_SLOTS; s++) {
    const f = foodAt(1234, s, 0);
    assert.ok(Math.abs(f.x) < HALF && Math.abs(f.z) < HALF);
  }
});

test('food claims: first claim wins, stale ones are ignored, tables merge to the max', () => {
  const x = new FoodField(99);
  const y = new FoodField(99);
  assert.equal(x.claim(5, 0), true);
  assert.equal(x.claim(5, 0), false); // already gone
  y.claim(5, 0);
  assert.deepEqual({ x: x.slots[5].x, z: x.slots[5].z }, { x: y.slots[5].x, z: y.slots[5].z });
  const late = new FoodField(99);
  late.merge(x.gens());
  assert.deepEqual(late.gens(), x.gens());
  assert.equal(late.merge([0, 0, 0]).length, 0);
});

test('body path follows the head and is trimmed to the length for its mass', () => {
  const b = new Body();
  b.reset(0, 0, 0, 12);
  for (let i = 1; i <= 200; i++) b.moveTo(i * 0.1, 0, 12);
  const n = b.pts.length;
  assert.ok(n < 60 && n > 20, `trimmed path ${n}`);
  const head = b.pts[n - 1];
  assert.ok(Math.abs(head.x - 20) < SPACING * 1.01);
  b.moveTo(500, 500, 12); // a jump resets instead of streaking
  assert.equal(b.pts.length, 1);
});

test('collision: head into a body kills; the neck and the far tail do not', () => {
  const other = new Body();
  other.reset(0, 0, 0, 40); // lies along x from about -19 to 0, head at x=0
  const r = radiusOf(12);
  assert.equal(hitsBody(-8, 0.1, r, other, r, 1.2), true, 'mid body');
  assert.equal(hitsBody(-8, 4, r, other, r, 1.2), false, 'well clear');
  assert.equal(hitsBody(-0.2, 0.1, r, other, r, 1.2), false, 'neck is skipped (head-on is decided by mass)');
  const tailX = other.pts[0].x;
  assert.equal(hitsBody(tailX + 0.05, 0, r, other, r, 1.2, 1.7), false, 'tail end ignored for latency');
});

test('pose buffer: interpolates between samples, extrapolates briefly, clamps teleports', () => {
  const pb = new PoseBuffer();
  const now = 100;
  const msg = (ts: number, x: number) => ({ ts, x, z: 0, a: 0, m: 12, b: 0, s: 0, l: 1, k: 0 });
  assert.equal(pb.push(msg(10, 0), now), true);
  assert.equal(pb.push(msg(10.1, 0.6), now + 0.1), true);
  assert.equal(pb.push(msg(10.1, 0.6), now + 0.1), false, 'duplicate / old timestamps rejected');
  const mid = pb.sample(now + 0.16 + 0.05)!; // halfway between the two samples (render lag 0.16 s)
  assert.ok(mid.x > 0.2 && mid.x < 0.4, `interp ${mid.x}`);
  assert.equal(pb.push({ ts: 10.2, x: NaN, z: 0, a: 0, m: 12 }, now + 0.2), false);
  pb.push(msg(10.3, 40), now + 0.3); // 40 m in 0.2 s is not a snake
  assert.ok(pb.last!.x < 5 && pb.suspect === 1, `clamped to ${pb.last!.x}`);
});

test('death messages: validated corpse orbs (bounded, in the arena, small values)', () => {
  const path = Array.from({ length: 100 }, (_, i) => ({ x: i * 0.2 - 10, z: 3 }));
  const pts = corpseSpots(path, 36);
  assert.equal(pts.length, 72);
  const orbs = readCorpses('d1', pts, 100, 0xff00ff, 0);
  assert.equal(orbs.length, 36);
  assert.ok(orbs.every((o) => o.v > 0 && o.v <= 8 && o.id.startsWith('d1.')));
  assert.equal(readCorpses('d2', [0, 0, 1], 50, 0, 0).length, 0, 'odd length rejected');
  assert.equal(readCorpses('d3', new Array(200).fill(0), 50, 0, 0).length, 0, 'too many rejected');
  assert.equal(readCorpses('d4', [9999, 0], 50, 0, 0).length, 0, 'outside the arena rejected');
  assert.ok(readCorpses('d5', [0, 0], 1e9, 0, 0)[0].v <= 8 && MAX_MASS > 0);
});

test('leaderboard orders by length, ties by id, same on every client', () => {
  const rows = [
    { id: 'b', mass: 30, kills: 0 },
    { id: 'a', mass: 30, kills: 2 },
    { id: 'c', mass: 55, kills: 1 },
  ];
  assert.deepEqual(board(rows).map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(board(rows.slice().reverse()).map((r) => r.id), ['c', 'a', 'b']);
});

test('headings stay bounded however long you turn', () => {
  let a = 0;
  for (let i = 0; i < 5000; i++) a = steer(a, a + 1, 0.1);
  assert.ok(Math.abs(a) <= Math.PI + 1e-9);
});

test('steering is rate limited', () => {
  const a = steer(0, Math.PI, 0.1);
  assert.ok(Math.abs(a - TURN_RATE * 0.1) < 1e-9);
  assert.ok(Math.abs(steer(0, 0.01, 0.1) - 0.01) < 1e-9);
});
