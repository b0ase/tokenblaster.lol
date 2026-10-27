import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOutpoint, normTicker, pickByTicker } from './launch/ticker';

const A = 'a'.repeat(64) + '_1';
const B = 'b'.repeat(64) + '_1';
const C = 'c'.repeat(64) + '_1';

test('normTicker: case, $ and url-encoding', () => {
  assert.equal(normTicker('terrornode'), 'TERRORNODE');
  assert.equal(normTicker('$TerrorNode'), 'TERRORNODE');
  assert.equal(normTicker('%24tbtest'), 'TBTEST');
  assert.equal(normTicker(''), null);
  assert.equal(normTicker('bad ticker!'), null);
});

test('isOutpoint', () => {
  assert.ok(isOutpoint(A));
  assert.ok(!isOutpoint('TERRORNODE'));
});

test('pickByTicker: finds the coin, any case', () => {
  const rows = [{ token_id: A, sym: 'TERRORNODE' }, { token_id: B, sym: 'TBTEST' }];
  assert.equal(pickByTicker(rows, 'terrornode')?.token_id, A);
  assert.equal(pickByTicker(rows, '$tbtest')?.token_id, B);
  assert.equal(pickByTicker(rows, 'NOPE'), null);
});

test('pickByTicker: shared ticker prefers live, then most recent', () => {
  const rows = [
    { token_id: A, sym: 'DUP', status: 'live', created_at: '2026-10-01T00:00:00Z' },
    { token_id: B, sym: 'DUP', status: 'pending', created_at: '2026-10-20T00:00:00Z' },
    { token_id: C, sym: 'DUP', status: 'live', created_at: '2026-10-10T00:00:00Z' },
  ];
  assert.equal(pickByTicker(rows, 'dup')?.token_id, C);
  assert.equal(pickByTicker(rows.filter((r) => r.status !== 'live'), 'dup')?.token_id, B);
});

test('pickByTicker: skips rows without a deploy outpoint', () => {
  assert.equal(pickByTicker([{ token_id: null, sym: 'X' }], 'x'), null);
});
