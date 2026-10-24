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

test('paymail lookup: parse, 404 and fallbacks', async () => {
  const { parseLookup, idLabel, shortKey } = await import('./walletBar');
  const { ammoFromPaymail } = await import('./gallery');
  const body = { paymail: 'b0asex@bwalletx.com', alias: 'b0asex', names: [{ name: 'b0asex', paymail: 'b0asex@bwalletx.com', kind: 'plain' }, { name: 'b0ase.x', kind: 'x' }] };
  assert.deepEqual(parseLookup(200, body), { paymail: 'b0asex@bwalletx.com', alias: 'b0asex' });
  assert.equal(parseLookup(404, null), null);
  assert.equal(parseLookup(200, { names: [] }), null);
  assert.deepEqual(parseLookup(200, { names: [{ paymail: 'neo@bwallet.space', kind: 'plain' }] }), { paymail: 'neo@bwallet.space', alias: 'neo' });
  const key = '03ab' + '0'.repeat(60) + '9f';
  assert.equal(shortKey(key), '03ab…9f');
  assert.equal(idLabel({ id: 'w', name: 'bWalletX', publicKey: key, paymail: 'b0asex@bwalletx.com', alias: 'b0asex' }), 'b0asex@bwalletx.com');
  assert.equal(idLabel({ id: 'w', name: 'bWalletX', publicKey: key }), '03ab…9f');
  // Rounds: the paymail; too long → the alias; nothing → null (DEFAULT_AMMO).
  assert.equal(ammoFromPaymail({ paymail: 'b0asex@bwalletx.com', alias: 'b0asex' }), 'b0asex@bwalletx.com');
  assert.equal(ammoFromPaymail({ paymail: `${'a'.repeat(40)}@bwallet.space`, alias: 'short' }), 'short');
  assert.equal(ammoFromPaymail(null), null);
});
