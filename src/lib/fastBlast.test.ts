import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockingScript, P2PKH, PrivateKey, Spend, Transaction, UnlockingScript } from '@bsv/sdk';
import { fromHex, makeBlaster, opReturn, toHex, txidHex } from './fastBlast';
import { shotSats } from './gallery';

const key = PrivateKey.fromRandom(); // throwaway: never funded
const priv = Uint8Array.from(key.toArray('be', 32));

test('fast blasts are valid BSV transactions (SDK interpreter), chain correctly and pay >= 100 sat/kB', () => {
  const b = makeBlaster(priv);
  assert.equal(toHex(b.lock), new P2PKH().lock(key.toAddress()).toHex());
  let prev = fromHex('11'.repeat(32));
  let vout = 3;
  let value = 10_000;
  for (let n = 1; n <= 5; n++) {
    const data = opReturn(['tokenblaster.lol', 'sats', String(n), 'gallery', 'kweg']);
    const fee = b.feeFor(data, 100);
    const t = b.blast(prev, vout, value, data, fee);
    // fee rate on the real size, never under 100 sat/kB
    assert.ok((fee * 1000) / t.raw.length >= 100, `fee ${fee} for ${t.raw.length} B`);
    const tx = Transaction.fromHex(toHex(t.raw));
    assert.equal(tx.id('hex'), txidHex(t.txidLE));
    assert.equal(tx.inputs[0].sourceTXID, txidHex(prev));
    assert.equal(tx.inputs[0].sourceOutputIndex, vout);
    assert.equal(tx.outputs[1].satoshis, value - fee);
    // EF parses to the same tx and carries the parent output
    const ef = Transaction.fromHexEF(toHex(t.ef));
    assert.equal(ef.id('hex'), tx.id('hex'));
    assert.equal(ef.inputs[0].sourceTransaction?.outputs[vout].satoshis, value);
    const spendArgs = () => ({
      sourceTXID: txidHex(prev),
      sourceOutputIndex: vout,
      sourceSatoshis: value,
      lockingScript: LockingScript.fromHex(toHex(b.lock)),
      transactionVersion: 1,
      otherInputs: [],
      outputs: tx.outputs,
      inputIndex: 0,
      unlockingScript: UnlockingScript.fromHex(tx.inputs[0].unlockingScript!.toHex()),
      inputSequence: 0xffffffff,
      lockTime: 0,
    });
    const spend = new Spend(spendArgs());
    assert.equal(spend.validate(), true);
    // and the interpreter really checks: a wrong parent value breaks the signature
    assert.throws(() => new Spend({ ...spendArgs(), sourceSatoshis: value + 1 }).validate());
    prev = t.txidLE;
    vout = 1;
    value = t.change;
  }
});

test('a 4-char tag blast is ~260 B and costs no more than the 26 sat the gallery charges', () => {
  const b = makeBlaster(priv);
  const data = opReturn(['tokenblaster.lol', 'sats', '9999999', 'gallery']);
  const fee = b.feeFor(data, 100);
  const t = b.blast(fromHex('22'.repeat(32)), 0, 1000, data, fee);
  assert.ok(t.raw.length <= 260, `${t.raw.length} B`);
  assert.ok(fee <= 26, `${fee} sat`);
});

test('the worker fee never exceeds what the gallery charges per shot (lanes are funded at shotSats + 2)', () => {
  const b = makeBlaster(priv);
  for (const L of [1, 4, 20, 40])
    for (const H of [0, 4, 20, 40]) {
      const data = opReturn(['tokenblaster.lol', 'x'.repeat(L), '99999999', 'gallery', ...(H ? ['h'.repeat(H)] : [])]);
      const fee = b.feeFor(data, 100);
      assert.ok(fee <= shotSats(H, L) + 2, `ammo ${L} handle ${H}: fee ${fee} > ${shotSats(H, L)} + 2`);
      const t = b.blast(fromHex('33'.repeat(32)), 0, 10_000, data, fee);
      assert.ok((fee * 1000) / t.raw.length >= 100, `ammo ${L} handle ${H}: under 100 sat/kB`);
    }
});
