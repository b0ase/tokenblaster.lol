/** Every "buys N shots" figure (coin labels, TO PAY, receipt line, LOCK & LOAD) comes from shotsForUsd. Pinned numbers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pennySatsAt } from '../launch/receipts';
import { usdToSats } from './credit';
import { satsWord, shotsForSats, shotsForUsd } from './shots';

const BSV = 17.29;
const PENNY = Number(pennySatsAt(BSV)); // 57,837 sats
const FRESH = { issued: 0, pennySats: PENNY };

test('units: $0.30 at BSV $17.29 is 1,735,107 sats (not 17,350)', () => {
  assert.equal(PENNY, 57_837);
  assert.equal(usdToSats(0.3, BSV), 1_735_107);
});

test('receipts curve at #1: 30-sat round + ~1-sat receipt, pinned per coin', () => {
  const got = [0.01, 0.1, 0.2, 0.3, 0.5, 1].map((u) => shotsForUsd(u, BSV, 30, FRESH));
  assert.deepEqual(got, [1774, 18106, 35868, 53096, 86121, 161880]);
  // ~31-32 sats a shot all in, after overhead + settlement
  assert.ok(Math.abs(1_735_107 / 53_096 - 32.7) < 0.1);
});

test('receipts get dearer as they sell: at 5,000,000 issued (~290 sats a receipt) $0.30 buys far fewer', () => {
  assert.equal(shotsForUsd(0.3, BSV, 30, { issued: 5_000_000, pennySats: PENNY }), 5401);
});

test('no receipts: plain rounds after overhead', () => {
  assert.equal(shotsForUsd(0.3, BSV, 30, null), 57603);
});

test('TO PAY counts only the coins inserted, never credit + coins', () => {
  // $3.00 already in the gun + $0.30 inserted: the "$0.30 buys" figure is the $0.30 alone.
  assert.equal(shotsForUsd(0.3, BSV, 30, FRESH), 53096);
  assert.notEqual(shotsForUsd(3.3, BSV, 30, FRESH), shotsForUsd(0.3, BSV, 30, FRESH));
});

test('LOCK & LOAD uses the same count for the same sats', () => {
  const sats = usdToSats(0.3, BSV)!;
  assert.equal(shotsForSats(sats, 30, FRESH), shotsForUsd(0.3, BSV, 30, FRESH));
});

test('no price → null; nothing → 0', () => {
  assert.equal(shotsForUsd(0.3, null, 30, FRESH), null);
  assert.equal(shotsForUsd(0, BSV, 30, FRESH), 0);
  assert.equal(shotsForSats(500, 30, FRESH), 0);
});

test('1 sat, not 1 sats', () => {
  assert.equal(satsWord(1), '1 sat');
  assert.equal(satsWord(30), '30 sats');
  assert.equal(satsWord(1234), '1,234 sats');
});
