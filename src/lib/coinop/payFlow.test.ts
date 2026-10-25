import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectAttemptOver } from './payFlow';

test('pay-after-connect survives while the connect is still running', () => {
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: true, busy: false, waiting: false }), false);
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: false, busy: true, waiting: false }), false);
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: false, busy: false, waiting: true }), false);
});

test('a connected wallet is not "over": the cabinet pays', () => {
  assert.equal(connectAttemptOver({ hasWallet: true, chooserOpen: false, busy: false, waiting: false }), false);
});

test('chooser closed, cancelled or failed with no wallet: the pay intent is dropped', () => {
  assert.equal(connectAttemptOver({ hasWallet: false, chooserOpen: false, busy: false, waiting: false }), true);
});
