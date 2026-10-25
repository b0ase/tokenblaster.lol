import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COINS_USD, addCoin, canStart, cleanName, playerNameFrom, fmtCredit, hasCredit, playPriceUsd, typingName, usdToSats } from './credit';

test('coins stack in whole cents: 10 × $1 = $10.00, 0.1 + 0.2 = 0.3', () => {
  let t = 0;
  for (let i = 0; i < 10; i++) t = addCoin(t, 1);
  assert.equal(t, 10);
  assert.equal(addCoin(0.1, 0.2), 0.3);
  assert.equal(addCoin(addCoin(0.01, 0.01), 0.5), 0.52);
  assert.deepEqual([...COINS_USD], [0.01, 0.1, 0.2, 0.5, 1]);
});

test('dollars to sats round up', () => {
  assert.equal(usdToSats(0.1, 20), 500_000);
  assert.equal(usdToSats(0.1, 30), 333_334);
  assert.equal(usdToSats(1, 0), null);
});

test('credit counter floors', () => {
  assert.equal(fmtCredit(0.0999), '$0.09');
  assert.equal(fmtCredit(10), '$10.00');
});

test('name needs credit; start needs credit + name', () => {
  assert.equal(hasCredit(0.09), false);
  assert.equal(hasCredit(0.1), true);
  assert.equal(canStart(0.1, 0.1), true);
  assert.equal(canStart(0.05, 0.1), false);
  assert.equal(cleanName('@Neo_1'), 'neo_1');
  assert.equal(cleanName('a b'), null);
  assert.equal(typingName('Hello World!!'), 'helloworld');
  assert.equal(playPriceUsd('unknown'), 0.1);
});

test('the player name is the wallet paymail, else the identity key short form, never typed', () => {
  assert.deepEqual(playerNameFrom({ paymail: 'B0aseX@bwalletx.com', publicKey: '03abcdef0123456789' }), { name: 'b0asex@bwalletx.com', hasPaymail: true });
  assert.deepEqual(playerNameFrom({ paymail: null, publicKey: '03ABCDEF0123456789ff' }), { name: 'key_03abcdef01', hasPaymail: false });
  assert.equal(cleanName(playerNameFrom({ publicKey: '03abcdef0123456789' }).name), 'key_03abcdef01');
  assert.deepEqual(playerNameFrom(null), { name: '', hasPaymail: false });
});
