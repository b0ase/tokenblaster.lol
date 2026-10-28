import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRANT_TO, grantDestination } from './terrornodeGrant';

test('the grant destination is the fixed airdrop wallet', () => {
  assert.equal(GRANT_TO, '1P9xhsoN9WqtBn3v3fUnDeXencHnaevv79');
});

test('a missing or empty to falls back to the airdrop wallet', () => {
  assert.equal(grantDestination(undefined), GRANT_TO);
  assert.equal(grantDestination(null), GRANT_TO);
  assert.equal(grantDestination(''), GRANT_TO);
});

test('to equal to the airdrop wallet is accepted', () => {
  assert.equal(grantDestination('1P9xhsoN9WqtBn3v3fUnDeXencHnaevv79'), GRANT_TO);
});

test('any other to is rejected', () => {
  assert.equal(grantDestination('1NbrP33mMxRmmFaNvo8ds7kMruqwZT1DVH'), null);
  assert.equal(grantDestination(' 1P9xhsoN9WqtBn3v3fUnDeXencHnaevv79'), null);
  assert.equal(grantDestination('1p9xhsoN9WqtBn3v3fUnDeXencHnaevv79'), null);
  assert.equal(grantDestination(123), null);
  assert.equal(grantDestination({ to: GRANT_TO }), null);
});
