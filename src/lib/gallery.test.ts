import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHOT_SATS, aggregateBoard, cleanAmmo, shotBytes, chainHandle, galleryPushes, platformFeeAt, quote, shotSats, shotsPerBsv, txPattern, ASSAULT_GUNS, liveCeiling, liveRate, roundsForFullRate } from './gallery';

test('shot cost: 26 sat anonymous, more for a handle/paymail and long ammo, 33 sat worst case', () => {
  assert.equal(shotSats(false), 26);
  assert.equal(shotSats(true), 30);
  assert.equal(shotBytes(40, 20), 309);
  assert.equal(shotBytes(40, 40), 329);
  assert.equal(MAX_SHOT_SATS, 33);
  assert.equal(shotsPerBsv(false), 3_846_153);
});

test('1M-shot pack ≈ 26M sats at cost, + 5% fee', () => {
  const q = quote(1_000_000, false, 0.05);
  assert.equal(q.network, 26_000_000 + 7_000);
  assert.equal(q.fee, Math.ceil(q.network * 0.05));
  assert.equal(quote(1_000_000, false, 0).fee, 0);
});

test('handles are sanitised for the chain', () => {
  assert.equal(chainHandle('@B0ase_X'), 'b0ase_x');
  assert.equal(chainHandle('has space'), null);
  assert.equal(chainHandle('x'.repeat(21)), null);
  assert.equal(chainHandle(''), null);
  assert.deepEqual(galleryPushes(null), ['gallery']);
  assert.deepEqual(galleryPushes('kweg'), ['gallery', 'kweg']);
});

test('board counts each session once at its highest report', () => {
  const b = aggregateBoard([
    { name: 'a', score: 100, meta: { x: 'alice', sid: 's1' } },
    { name: 'a', score: 300, meta: { x: 'alice', sid: 's1', w: 'minigun' } },
    { name: 'a', score: 50, meta: { x: 'alice', sid: 's2' } },
    { name: 'b', score: 200, meta: { x: 'bob', sid: 's3' } },
    { name: 'anon!', score: 999, meta: {} },
  ]);
  assert.deepEqual(b, [
    { handle: 'alice', shots: 350, sessions: 2, weapon: 'minigun' },
    { handle: 'bob', shots: 200, sessions: 1 },
  ]);
});

test('free for the stress test up to and including 31 Oct UTC, 5% from 1 Nov', () => {
  assert.equal(platformFeeAt(Date.parse('2026-10-31T23:59:59Z')), 0);
  assert.equal(platformFeeAt(Date.parse('2026-11-01T00:00:00Z')), 0.05);
  assert.equal(quote(10_000, false, platformFeeAt(Date.parse('2026-10-24T00:00:00Z'))).fee, 0);
});

test('weapons map to tx patterns: the minigun streams, a shotgun bursts its pellets', () => {
  assert.deepEqual(txPattern({ id: 'minigun', auto: true, fireMs: 70, pellets: 1 }), { kind: 'stream', rate: 2000 });
  assert.deepEqual(txPattern({ id: 'sawedoff', auto: false, fireMs: 720, pellets: 9 }), { kind: 'burst', n: 9 });
  assert.equal(txPattern({ id: 'plasmarifle', auto: true, fireMs: 115, pellets: 1 }).kind, 'stream');
});

test('ammo labels: lower case [a-z0-9.-], 1 to 40 chars, no control characters', () => {
  assert.equal(cleanAmmo(' TXBlaster.com '), 'txblaster.com');
  assert.equal(cleanAmmo('google.com'), 'google.com');
  assert.equal(cleanAmmo('a'.repeat(41)), null);
  assert.equal(cleanAmmo('bad\u0007bell'), null);
  assert.equal(cleanAmmo('spa ce'), null);
  assert.equal(cleanAmmo(''), null);
});

test('the name can be a handle or the full paymail', () => {
  assert.equal(chainHandle('b0asex@bwalletx.com'), 'b0asex@bwalletx.com');
  assert.equal(chainHandle('@Gunner_01'), 'gunner_01');
  assert.equal(chainHandle('not a name!'), null);
  assert.equal(chainHandle('a'.repeat(35) + '@x.com'), null);
});

test('assault rack: volume streams only, honest LIVE ceiling', async () => {
  const { buildWeapons } = await import('./bsvgun/weapons');
  const all = buildWeapons();
  for (const id of ASSAULT_GUNS) {
    const w = all.find((x) => x.id === id);
    assert.ok(w, id);
    const p = txPattern(w);
    assert.equal(p.kind, 'stream', `${id} streams`);
    assert.ok(p.kind === 'stream' && p.rate >= 2000, `${id} ~2000 tx/s`);
  }
  assert.equal(liveCeiling(10_000), 680); // 34 lanes x 20
  assert.equal(liveCeiling(1_000_000), 2000); // 100 lanes x 20
  assert.equal(liveRate({ kind: 'stream', rate: 2000 }, 30_000), 2000);
  assert.equal(roundsForFullRate(2000), 30_000);
});
