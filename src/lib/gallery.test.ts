import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBoard, chainHandle, galleryPushes, quote, shotSats, shotsPerBsv } from './gallery';

test('shot cost: 26 sat anonymous, 29 sat with a handle', () => {
  assert.equal(shotSats(false), 26);
  assert.equal(shotSats(true), 29);
  assert.equal(shotsPerBsv(false), 3_846_153);
});

test('1M-shot pack ≈ 26M sats at cost, + 5% fee', () => {
  const q = quote(1_000_000, false);
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
    { name: 'a', score: 300, meta: { x: 'alice', sid: 's1' } },
    { name: 'a', score: 50, meta: { x: 'alice', sid: 's2' } },
    { name: 'b', score: 200, meta: { x: 'bob', sid: 's3' } },
    { name: 'anon!', score: 999, meta: {} },
  ]);
  assert.deepEqual(b, [
    { handle: 'alice', shots: 350, sessions: 2 },
    { handle: 'bob', shots: 200, sessions: 1 },
  ]);
});
