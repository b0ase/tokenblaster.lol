import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, PrivateKey, Transaction } from '@bsv/sdk';
import { hasPayRef, newPayRef, payRefScript } from './payRef';

test('payment id: carried in a 0-sat OP_RETURN, found again after a hex round trip, never confused', () => {
  const ref = newPayRef();
  assert.match(ref, /^[0-9a-f]{16}$/);
  assert.notEqual(newPayRef(), ref);
  const tx = new Transaction();
  tx.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toAddress()), satoshis: 1000 });
  tx.addOutput({ lockingScript: payRefScript(ref), satoshis: 0 });
  const back = Transaction.fromHex(tx.toHex());
  assert.equal(hasPayRef(back, ref), true);
  assert.equal(hasPayRef(back, newPayRef()), false);
  assert.ok(payRefScript(ref).toHex().startsWith('006a'));
});

test('fund() adds the payment id output only when given one', async () => {
  const { fund, serialised } = await import('./wallet');
  const seen: { outputs: { lockingScript: string; satoshis: number }[] }[] = [];
  const raw = { createAction: async (a: (typeof seen)[number]) => (seen.push(a), { txid: 'ab'.repeat(32) }) };
  const w = { client: serialised(raw as never), publicKey: '', address: '', id: 'x', name: 'x' };
  const addr = PrivateKey.fromRandom().toAddress();
  await assert.rejects(fund(w, addr, 1000, 'd'), /WALLET_SENT_PENDING/);
  await assert.rejects(fund(w, addr, 1000, 'd', undefined, 'aabbccddeeff0011'), /WALLET_SENT_PENDING/);
  assert.equal(seen[0].outputs.length, 1);
  assert.equal(seen[1].outputs.length, 2);
  assert.equal(seen[1].outputs[1].satoshis, 0);
  assert.equal(seen[1].outputs[1].lockingScript, payRefScript('aabbccddeeff0011').toHex());
});
