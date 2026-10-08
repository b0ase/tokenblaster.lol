import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALLET_BAR, chipState, getBarWallet, setBarWallet, subBarWallet } from './walletBar';

test('bar stack = bWalletX AccountStrip 28 + TopNav 56', () => {
  assert.equal(WALLET_BAR.stripH + WALLET_BAR.rowH, 84);
  assert.equal(WALLET_BAR.button, 36);
  assert.equal(WALLET_BAR.ring, '#2A2A2C');
  assert.equal(WALLET_BAR.accent, '#F5B800');
});

test('chip: disconnected, wallet name, handle, verified only with a handle', () => {
  assert.deepEqual(chipState(null, 'bob', true), { kind: 'disconnected', label: 'Connect wallet' });
  assert.deepEqual(chipState('bWalletX', null, true), { kind: 'connected', label: 'bWalletX', verified: false });
  assert.deepEqual(chipState('bWalletX', 'b0ase', true), { kind: 'connected', label: '@b0ase', verified: true });
  assert.deepEqual(chipState('bWalletX', 'b0ase', false), { kind: 'connected', label: '@b0ase', verified: false });
});

test('bar wallet store notifies on change only', () => {
  let n = 0;
  const off = subBarWallet(() => n++);
  setBarWallet({ id: 'x', name: 'bWalletX' });
  setBarWallet({ id: 'x', name: 'bWalletX' });
  assert.equal(n, 1);
  assert.equal(getBarWallet()?.name, 'bWalletX');
  setBarWallet(null);
  assert.equal(n, 2);
  off();
});
