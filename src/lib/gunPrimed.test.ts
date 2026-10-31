import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUN_BUSY, primedCoinUsable } from './gun';
import { GUN_BUSY_RE } from './settleRetry';

const coin = (id: string, sats: number, vout = 0) => ({ tx: { id: () => id, outputs: [{ satoshis: sats }] }, vout });

test('31 Oct 11:40: prepareStorm reuses the coin gather settled on (no chain read, no merge)', () => {
  const c = coin('aa', 6_446_131);
  assert.equal(primedCoinUsable({ primed: 'aa_0', coin: c, spent: new Set(), extra: 0 }), true);
});

test('never reuses a coin that is spent, different, tiny, or with a paid coin still waiting to merge', () => {
  const c = coin('aa', 6_446_131);
  assert.equal(primedCoinUsable({ primed: null, coin: c, spent: new Set(), extra: 0 }), false);
  assert.equal(primedCoinUsable({ primed: 'bb_0', coin: c, spent: new Set(), extra: 0 }), false);
  assert.equal(primedCoinUsable({ primed: 'aa_0', coin: c, spent: new Set(['aa_0']), extra: 0 }), false);
  assert.equal(primedCoinUsable({ primed: 'aa_0', coin: c, spent: new Set(), extra: 1 }), false);
  assert.equal(primedCoinUsable({ primed: 'aa_0', coin: coin('aa', 500), spent: new Set(), extra: 0 }), false);
  assert.equal(primedCoinUsable({ primed: 'aa_0', coin: null, spent: new Set(), extra: 0 }), false);
});

test('the settlement retry recognises the gun lock error', () => {
  assert.ok(GUN_BUSY_RE.test(GUN_BUSY));
});
