import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditUsd, leftoverNote, planLoad, roundsFrom, safeNote, spendableCoins, sumSats } from './ammo';

const c = (txid: string, vout: number, sats: number) => ({ txid, vout, sats });

test('credit is the real gun balance in dollars plus unpaid coins, not the total ever paid', () => {
  // 1,000,000 sats at $50/BSV = $0.50 in the gun; $0.20 inserted, not paid yet.
  assert.equal(creditUsd(1_000_000, 50, 0.2).toFixed(2), '0.70');
  assert.equal(creditUsd(0, 50), 0);
  assert.equal(creditUsd(-5, 50), 0);
  assert.equal(creditUsd(1_000_000, null), 0);
});

test('spendable coins: union of chain, wallet response and own change; spent ones never reused', () => {
  const chain = [c('a', 0, 500), c('b', 1, 300), c('old', 0, 9_000)]; // index lag: 'old' already spent by game 1
  const wallet = [c('pay2', 0, 2_000), c('b', 1, 300)];
  const own = [c('chg', 3, 100), c('dust', 0, 1)];
  const spent = new Set(['old_0']);
  const got = spendableCoins([chain, wallet, own], spent);
  assert.deepEqual(got.map((x) => `${x.txid}_${x.vout}`), ['pay2_0', 'a_0', 'b_1', 'chg_3']);
  assert.equal(sumSats(got), 2_900);
});

test('leftover ammo → LOCK & LOAD uses it, no new payment', () => {
  assert.deepEqual(planLoad({ gunSats: 50_000, pendingUsd: 0, roundSats: 100 }), { pay: false, useLeftover: true, short: false });
});

test('new coins inserted are the only thing billed', () => {
  assert.deepEqual(planLoad({ gunSats: 50_000, pendingUsd: 0.5, roundSats: 100 }), { pay: true, useLeftover: false, short: false });
});

test('empty gun and no coins: short, no payment', () => {
  assert.deepEqual(planLoad({ gunSats: 50, pendingUsd: 0, roundSats: 100 }), { pay: false, useLeftover: false, short: true });
});

test('rounds from the balance after overhead', () => {
  assert.equal(roundsFrom(10_000, 100, () => 500), 95);
  assert.equal(roundsFrom(0, 100, () => 0), 0);
  assert.equal(roundsFrom(100, 0, () => 0), 0);
});

test('notes', () => {
  assert.equal(leftoverNote('$1.00'), 'You have $1.00 of ammo loaded. Press LOCK & LOAD.');
  assert.equal(safeNote('$1.00'), 'Your ammo is safe in your gun ($1.00). Press LOCK & LOAD to try again.');
});
