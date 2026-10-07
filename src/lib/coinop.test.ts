import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coinSats, MAX_COIN_SATS, MIN_COIN_SATS, penceToSats, streakAllPaid } from './coinop';

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

test('a win streak is paid only when every match in it was a credit match', () => {
  const run = (matches: { paid: boolean; won: boolean }[]) => {
    let allPaid = false;
    let streak = 0;
    const out: boolean[] = [];
    for (const m of matches) {
      allPaid = streakAllPaid(allPaid, streak, m.paid);
      streak = m.won ? streak + 1 : 0;
      out.push(m.paid && allPaid);
    }
    return out;
  };
  assert.deepEqual(run([{ paid: true, won: true }, { paid: true, won: true }]), [true, true]);
  // practice win then paid win: the streak is practice
  assert.deepEqual(run([{ paid: false, won: true }, { paid: true, won: true }]), [false, false]);
  // paid, practice, paid: tainted for the rest of the streak
  assert.deepEqual(run([{ paid: true, won: true }, { paid: false, won: true }, { paid: true, won: true }]), [true, false, false]);
  // a loss ends the streak; the next paid streak is clean again
  assert.deepEqual(run([{ paid: false, won: true }, { paid: true, won: false }, { paid: true, won: true }]), [false, false, true]);
});
