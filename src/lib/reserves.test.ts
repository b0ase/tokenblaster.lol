import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedReserves, ledgerCheck } from './launch/reserves';

const SUPPLY = 1_000_000_000;

test('receipts paid to players are counted: the live $TERRORNODE numbers match', () => {
  const expected = expectedReserves(SUPPLY, 0, 0, 397_600);
  assert.deepEqual(expected, { bsv: 0, tokens: 999_602_400 });
  assert.deepEqual(ledgerCheck({ expected, ledger: { bsv: 0, tokens: 999_602_400 } }), { ok: true });
});

test('without the receipts the same ledger is a mismatch (the old false alarm)', () => {
  const r = ledgerCheck({ expected: expectedReserves(SUPPLY, 0, 0), ledger: { bsv: 0, tokens: 999_602_400 } });
  assert.equal(r.ok, false);
});

test('a real mismatch still alarms', () => {
  const expected = expectedReserves(SUPPLY, 1000, 500, 397_600);
  assert.equal(ledgerCheck({ expected, ledger: { bsv: 500, tokens: expected.tokens - 1 } }).ok, false);
  assert.equal(ledgerCheck({ expected, ledger: { bsv: 499, tokens: expected.tokens } }).ok, false);
  assert.equal(ledgerCheck({ expected, ledger: { bsv: 500, tokens: expected.tokens } }).ok, true);
});
