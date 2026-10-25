import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WalletInterface } from '@bsv/sdk';
import { WALLET_HELD, holdWalletForPlay, serialised, walletHeld } from './wallet';

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

test('a basket is read once per session and a refusal is remembered', async () => {
  const { readBasket, resetBasketSession, basketRefused } = await import('./basketSession');
  resetBasketSession();
  let reads = 0;
  const ok = { listOutputs: async () => (reads++, { totalOutputs: 0, outputs: [] }) } as unknown as WalletInterface;
  await readBasket(ok, { basket: 'ordinals' });
  await readBasket(ok, { basket: 'ordinals' });
  assert.equal(reads, 1);
  let asked = 0;
  const no = { listOutputs: async () => (asked++, Promise.reject(new Error('User denied basket access'))) } as unknown as WalletInterface;
  assert.equal(await readBasket(no, { basket: 'ordnance' }), null);
  assert.equal(await readBasket(no, { basket: 'ordnance' }), null);
  assert.equal(asked, 1);
  assert.ok(basketRefused('ordnance'));
});

test('storm and page holds stack: the wallet is free only when both let go', () => {
  holdWalletForPlay(true, 'play');
  holdWalletForPlay(true, 'storm');
  holdWalletForPlay(false, 'storm');
  assert.equal(walletHeld(), true);
  holdWalletForPlay(false, 'play');
  assert.equal(walletHeld(), false);
});

test('an explicit refresh re-reads, but a refused basket stays refused', async () => {
  const { readBasket, resetBasketSession, forgetBasketReads } = await import('./basketSession');
  resetBasketSession();
  let reads = 0;
  const ok = { listOutputs: async () => (reads++, { totalOutputs: 0, outputs: [] }) } as unknown as WalletInterface;
  await readBasket(ok, { basket: 'ordinals' });
  forgetBasketReads();
  await readBasket(ok, { basket: 'ordinals' });
  assert.equal(reads, 2);
  const no = { listOutputs: async () => Promise.reject(new Error('denied')) } as unknown as WalletInterface;
  await readBasket(no, { basket: 'ordnance' });
  forgetBasketReads();
  let asked = 0;
  const later = { listOutputs: async () => (asked++, { totalOutputs: 0, outputs: [] }) } as unknown as WalletInterface;
  assert.equal(await readBasket(later, { basket: 'ordnance' }), null);
  assert.equal(asked, 0);
});
