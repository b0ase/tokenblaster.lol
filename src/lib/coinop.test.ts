import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinSats, MAX_COIN_SATS, MIN_COIN_SATS, penceToSats } from './coinop';

test('10p at £30/BSV is 333,334 sats (rounded up)', () => {
  assert.equal(coinSats(30), 333_334); // 333,333.33… → up
});

test('exact amounts are not bumped by float fuzz', () => {
  assert.equal(penceToSats(10, 25), 400_000);
  assert.equal(penceToSats(10, 100), 100_000);
  assert.equal(penceToSats(7, 0.7), MAX_COIN_SATS); // 10,000,000 → ceiling
});

test('always a whole sat', () => {
  for (const r of [13.37, 29.99, 41.123456, 52.5]) {
    const s = coinSats(r)!;
    assert.ok(Number.isInteger(s));
    assert.ok(s >= (10 * 1e6) / r);
    assert.ok(s - (10 * 1e6) / r < 1);
  }
});

test('floor and ceiling', () => {
  assert.equal(coinSats(1e9), MIN_COIN_SATS); // BSV absurdly expensive
  assert.equal(coinSats(0.0001), MAX_COIN_SATS); // BSV absurdly cheap
});

test('missing or bad rate gives null', () => {
  for (const r of [0, -5, NaN, Infinity, null, undefined]) assert.equal(coinSats(r), null);
  assert.equal(penceToSats(0, 30), null);
  assert.equal(penceToSats(-10, 30), null);
});
