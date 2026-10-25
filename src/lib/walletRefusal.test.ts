import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WALLET_SENT_PENDING, isRefusal } from './wallet';

describe('isRefusal', () => {
  it('is a refusal only when the wallet declined', () => {
    assert.equal(isRefusal('User cancelled'), true);
    assert.equal(isRefusal('Permission denied'), true);
    assert.equal(isRefusal('The user rejected the request'), true);
  });
  it('never calls a failure or a sent payment a "no"', () => {
    assert.equal(isRefusal('Insufficient funds: this needs 582603 sats. Add funds to bWalletX and try again.'), false);
    assert.equal(isRefusal('bWallet returned no transaction.'), false);
    assert.equal(isRefusal('Undelayed createAction or signAction results require review.'), false);
    assert.equal(isRefusal('userAgent mismatch'), false);
    assert.equal(isRefusal(`${WALLET_SENT_PENDING}:abcd`), false);
  });
});
