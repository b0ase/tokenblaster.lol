import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk';
import { cleanHandle, identiconSvg, proveHandle, readWire, verifyWire, xAlias } from './identity';

test('cleanHandle accepts X usernames only', () => {
  assert.equal(cleanHandle('@Alice_1'), 'Alice_1');
  assert.equal(cleanHandle(' https://x.com/bob?s=1 '), 'bob');
  assert.equal(cleanHandle('way_too_long_handle_x'), null);
  assert.equal(cleanHandle('<script>'), null);
  assert.equal(cleanHandle(''), null);
  assert.equal(cleanHandle(42), null);
});

test('readWire drops junk and keeps a well-formed proof', () => {
  assert.deepEqual(readWire({ x: 'no spaces!' }), {});
  assert.deepEqual(readWire({ x: 'ok', xk: 'nope', xs: [1] }), { x: 'ok' });
  const xk = '02' + 'a'.repeat(64);
  assert.deepEqual(readWire({ x: 'ok', xk, xs: [1, 2, 3] }), { x: 'ok', xk, xs: [1, 2, 3] });
  assert.deepEqual(readWire({ x: 'ok', xk, xs: [300] }), { x: 'ok' });
});

test('xAlias matches bWalletX naming', () => {
  assert.equal(xAlias('B0ase_X'), 'b0ase-x.x');
});

test('identicon is deterministic SVG', () => {
  assert.equal(identiconSvg('alice'), identiconSvg('ALICE'));
  assert.match(identiconSvg('alice'), /^<svg/);
});

test('prove + verify a handle against the paymail PKI', async () => {
  const key = PrivateKey.fromRandom();
  const wallet = new ProtoWallet(key) as unknown as WalletInterface;
  const pub = key.toPublicKey().toString();
  const orig = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    const ok = String(u).includes('alice.x@');
    return new Response(JSON.stringify(ok ? { pubkey: pub } : {}), { status: ok ? 200 : 404 });
  }) as typeof fetch;
  try {
    const w = await proveHandle(wallet, 'alice', 'sess1');
    assert.ok(w?.xs && w.xk === pub);
    assert.equal(await verifyWire(w!, 'sess1'), true);
    assert.equal(await verifyWire(w!, 'other-session'), false); // a copied proof is useless elsewhere
    assert.equal(await verifyWire({ ...w!, x: 'mallory' }, 'sess1'), false);
    assert.equal(await proveHandle(wallet, 'mallory', 'sess1'), null);
  } finally {
    globalThis.fetch = orig;
  }
});
