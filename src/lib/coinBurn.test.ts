/** Coin ammo burns (25 Oct 2026): the fast BSV-21 burn builder and the multi-lane storm in burn mode. Mock ARC only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LockingScript, P2PKH, PrivateKey, Spend, Transaction, UnlockingScript } from '@bsv/sdk';
import { bsv21Lock, fromHex, makeBlaster, opReturn, toHex, txidHex } from './fastBlast';
import { BURN_ADDRESS, bsv21 } from './gun';
import { runLanes, tagPushes, type Out } from './stormCore';

const key = PrivateKey.fromRandom(); // throwaway: never funded, nothing leaves this process
const priv = Uint8Array.from(key.toArray('be', 32));
const ID = `${'ab'.repeat(32)}_0`;
const burnLock = fromHex(new P2PKH().lock(BURN_ADDRESS).toHex());

test('bsv21Lock is byte-identical to the SDK-built transfer inscription', () => {
  const b = makeBlaster(priv);
  for (const amt of [BigInt(1), BigInt(999), BigInt(123_456_789)]) assert.equal(toHex(bsv21Lock(ID, amt, b.lock)), bsv21(ID, amt, key.toAddress()).toHex());
});

test('a fast burn is valid (SDK interpreter, both inputs), burns 1 to the eater, keeps the rest, pays >= 100 sat/kB', () => {
  const b = makeBlaster(priv);
  let tok = { txidLE: fromHex('11'.repeat(32)), vout: 0, amt: BigInt(3), lock: bsv21Lock(ID, BigInt(3), b.lock) };
  let fee = { txidLE: fromHex('22'.repeat(32)), vout: 5, value: 10_000 };
  for (let n = 1; n <= 3; n++) {
    const data = opReturn(tagPushes(ID, n, 'gallery', ['b0asex@bwalletx.com']));
    const t = b.burn(tok, fee, ID, BigInt(1), burnLock, data, 100)!;
    const tx = Transaction.fromHex(toHex(t.raw));
    assert.equal(tx.id('hex'), txidHex(t.txidLE));
    assert.equal(tx.outputs[0].lockingScript.toHex(), bsv21(ID, BigInt(1), BURN_ADDRESS).toHex());
    const last = n === 3;
    if (!last) assert.equal(tx.outputs[1].lockingScript.toHex(), bsv21(ID, tok.amt - BigInt(1), key.toAddress()).toHex());
    assert.equal(t.changeVout, tx.outputs.length - 1);
    assert.ok(((fee.value - t.change) * 1000) / t.raw.length >= 100);
    const ef = Transaction.fromHexEF(toHex(t.ef));
    assert.equal(ef.id('hex'), tx.id('hex'));
    const ins = [
      { txid: txidHex(tok.txidLE), vout: tok.vout, sats: 1, lock: tok.lock },
      { txid: txidHex(fee.txidLE), vout: fee.vout, sats: fee.value, lock: b.lock },
    ];
    ins.forEach((inp, i) => {
      const other = ins.filter((_, k) => k !== i).map((o) => ({ sourceTXID: o.txid, sourceOutputIndex: o.vout, sequence: 0xffffffff }));
      const spend = new Spend({
        sourceTXID: inp.txid,
        sourceOutputIndex: inp.vout,
        sourceSatoshis: inp.sats,
        lockingScript: LockingScript.fromHex(toHex(inp.lock)),
        transactionVersion: 1,
        otherInputs: other,
        outputs: tx.outputs,
        inputIndex: i,
        unlockingScript: UnlockingScript.fromHex(tx.inputs[i].unlockingScript!.toHex()),
        inputSequence: 0xffffffff,
        lockTime: 0,
      });
      assert.equal(spend.validate(), true, `input ${i}`);
    });
    if (t.restLock) tok = { txidLE: t.txidLE, vout: 1, amt: t.rest, lock: t.restLock };
    fee = { txidLE: t.txidLE, vout: t.changeVout, value: t.change };
  }
});

test('burn returns null when the fee coin cannot pay', () => {
  const b = makeBlaster(priv);
  const t = b.burn({ txidLE: fromHex('11'.repeat(32)), vout: 0, amt: BigInt(5), lock: bsv21Lock(ID, BigInt(5), b.lock) }, { txidLE: fromHex('22'.repeat(32)), vout: 0, value: 20 }, ID, BigInt(1), burnLock, opReturn(['x']), 100);
  assert.equal(t, null);
});

function mockArc(status: (i: number) => string) {
  const txs: Transaction[] = [];
  const f = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { rawTx: string }[];
    const out = body.map((x) => {
      const tx = Transaction.fromHexEF(x.rawTx);
      txs.push(tx);
      return { txid: tx.id('hex'), txStatus: status(txs.length - 1) };
    });
    return { status: 200, json: async () => out } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, txs };
}

async function burnRun(lanes: number, perLane: number, status: (i: number) => string) {
  const arc = mockArc(status);
  const outs: Out[] = [];
  // base tx: token lanes 0..K-1 (1 sat), fee lanes K..2K-1
  const baseValues = [...Array.from({ length: lanes }, () => 1), ...Array.from({ length: lanes }, () => perLane * 90 + 50)];
  await runLanes(
    {
      priv,
      baseTxid: 'cd'.repeat(32),
      baseValues,
      lanes: Array.from({ length: lanes }, (_, i) => ({ vout: lanes + i, count: perLane, n: i * perLane + 1, tok: { vout: i, amt: String(perLane) } })),
      step: 100,
      game: 'gallery',
      extra: ['b0asex@bwalletx.com'],
      arcs: ['http://mock-arc.invalid'],
      burn: { id: ID, per: '1', toLockHex: toHex(burnLock) },
    },
    { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: arc.f },
  );
  return { arc, outs };
}

test('burn storm: every lane chains its burns, all tagged with the token id + paymail, every token burned', async () => {
  const { arc, outs } = await burnRun(4, 30, () => 'SEEN_ON_NETWORK');
  assert.equal(arc.txs.length, 120);
  const sent = outs.filter((o) => o.type === 'sent').reduce((n, o) => n + (o.type === 'sent' ? o.n : 0), 0);
  assert.equal(sent, 120);
  const seen = new Set<number>();
  for (const tx of arc.txs) {
    assert.equal(tx.outputs[0].lockingScript.toHex(), bsv21(ID, BigInt(1), BURN_ADDRESS).toHex());
    const ret = tx.outputs.find((o) => o.satoshis === 0)!.lockingScript.toHex();
    assert.ok(ret.includes(Buffer.from('tokenblaster.lol').toString('hex')) && ret.includes(Buffer.from(ID).toString('hex')) && ret.includes(Buffer.from('b0asex@bwalletx.com').toString('hex')));
    const pushes = Buffer.from(ret, 'hex').toString('latin1');
    const n = Number(pushes.match(/(\d+)\x07gallery/)?.[1]);
    seen.add(n);
  }
  assert.equal(seen.size, 120); // round numbers are unique across lanes
});

test('burn storm: a rejected burn stops its lane for good (no double spend), other lanes carry on', async () => {
  let rejected: string | null = null;
  const { arc } = await burnRun(3, 20, (i) => {
    if (i === 5 && !rejected) {
      rejected = 'x';
      return 'REJECTED';
    }
    return 'SEEN_ON_NETWORK';
  });
  // the lane that had the reject posted no more after it; total < 60
  assert.ok(arc.txs.length < 60);
  const spentOutpoints = new Set<string>();
  for (const tx of arc.txs) for (const i of tx.inputs) {
    const op = `${i.sourceTXID}_${i.sourceOutputIndex}`;
    assert.equal(spentOutpoints.has(op), false, 'an outpoint was spent twice');
    spentOutpoints.add(op);
  }
});
