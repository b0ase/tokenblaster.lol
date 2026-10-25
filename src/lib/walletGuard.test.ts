import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WalletInterface } from '@bsv/sdk';
import { WALLET_HELD, holdWalletForPlay, serialised } from './wallet';

test('play guard refuses every wallet call while a round is live, then lets them through', async () => {
  let calls = 0;
  const w = serialised({ getPublicKey: async () => (calls++, { publicKey: '02ab' }) } as unknown as WalletInterface);
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    holdWalletForPlay(true);
    await assert.rejects(w.getPublicKey({ identityKey: true }), new RegExp(WALLET_HELD));
    assert.equal(calls, 0);
    holdWalletForPlay(false);
    assert.deepEqual(await w.getPublicKey({ identityKey: true }), { publicKey: '02ab' });
    assert.equal(calls, 1);
  } finally {
    console.warn = warn;
    holdWalletForPlay(false);
  }
});
