import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrivateKey, Transaction } from '@bsv/sdk';
import { runLanes, isSeen, type Out } from './stormCore';
import { HANDLE_BUDGET, galleryPushes, roundHandle, shotSats, needsPaymail } from './gallery';

const key = PrivateKey.fromRandom(); // throwaway: never funded, nothing leaves this process
const priv = Uint8Array.from(key.toArray('be', 32));
const PAYMAIL = 'b0asex@bwalletx.com';

/** Mock ARC: records every posted tx and answers each with `status(i)`. */
function mockArc(status: (i: number) => string) {
  const txs: Transaction[] = [];
  const headers: Record<string, string>[] = [];
  const f = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    headers.push(init.headers);
    const body = JSON.parse(init.body) as { rawTx: string }[];
    const out = body.map((b) => {
      const tx = Transaction.fromHexEF(b.rawTx);
      txs.push(tx);
      return { txid: tx.id('hex'), txStatus: status(txs.length - 1) };
    });
    return { status: 200, json: async () => out } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, txs, headers };
}

/** The OP_RETURN's pushes, read from the raw script bytes (OP_FALSE OP_RETURN <push>...). */
const pushesOf = (tx: Transaction) => {
  const b = Uint8Array.from(tx.outputs[0].lockingScript.toBinary());
  assert.deepEqual([b[0], b[1]], [0x00, 0x6a]);
  const out: string[] = [];
  for (let i = 2; i < b.length; ) {
    let len = b[i++];
    if (len === 0x4c) len = b[i++];
    out.push(new TextDecoder().decode(b.slice(i, i + len)));
    i += len;
  }
  return out;
};

async function run(lanes: number, perLane: number, perShot: number, status: (i: number) => string, waitFor?: string) {
  const arc = mockArc(status);
  const outs: Out[] = [];
  await runLanes(
    {
      priv,
      token: PAYMAIL,
      baseTxid: 'cd'.repeat(32),
      baseValues: Array.from({ length: lanes }, () => perLane * perShot),
      lanes: Array.from({ length: lanes }, (_, i) => ({ vout: i, count: perLane, n: i * perLane + 1 })),
      step: 100,
      game: 'gallery',
      extra: galleryPushes(roundHandle(PAYMAIL, 'key_0123456789')).slice(1),
      arcs: ['http://mock-arc.invalid'],
      waitFor,
    },
    { stopped: () => false, paused: () => false, emit: (o) => outs.push(o), fetch: arc.f },
  );
  return { arc, outs };
}

test('every storm round carries the player paymail in the OP_RETURN, within the per-shot budget', async () => {
  const perShot = shotSats(HANDLE_BUDGET, PAYMAIL.length);
  assert.ok(perShot <= 31, `per-shot ${perShot} sats`);
  const { arc, outs } = await run(3, 40, perShot, () => 'SEEN_ON_NETWORK');
  assert.equal(arc.txs.length, 120, 'every round of every lane is sent (the fee fits the budget)');
  for (const tx of arc.txs) {
    const p = pushesOf(tx);
    assert.deepEqual(p.slice(0, 2), ['tokenblaster.lol', PAYMAIL]);
    assert.equal(p[3], 'gallery');
    assert.equal(p[4], PAYMAIL, 'the handle push is the paymail');
    const fee = (tx.inputs[0].sourceTransaction?.outputs[tx.inputs[0].sourceOutputIndex].satoshis ?? 0) - (tx.outputs[1].satoshis ?? 0);
    assert.ok(fee <= perShot, `fee ${fee} <= budget ${perShot}`);
    assert.ok((fee * 1000) / tx.toBinary().length >= 100, 'pays >= 100 sat/kB');
  }
  const sent = outs.filter((o) => o.type === 'sent');
  assert.equal(sent.reduce((a, o) => a + (o.type === 'sent' ? o.n : 0), 0), 120);
  assert.equal(sent.reduce((a, o) => a + (o.type === 'sent' ? o.seen : 0), 0), 120);
  assert.equal(arc.headers[0]['X-WaitFor'], undefined, 'no X-WaitFor unless asked');
});

test('rounds post continuously (several ARC requests), and ARC-held statuses are not counted as seen', async () => {
  const { arc, outs } = await run(2, 300, 31, (i) => (i % 3 === 0 ? 'SEEN_ON_NETWORK' : i % 3 === 1 ? 'STORED' : 'SEEN_IN_ORPHAN_MEMPOOL'), 'SEEN_ON_NETWORK');
  assert.ok(arc.headers.length >= 3, `posted in ${arc.headers.length} requests`);
  assert.equal(arc.headers[0]['X-WaitFor'], 'SEEN_ON_NETWORK');
  const sent = outs.flatMap((o) => (o.type === 'sent' ? [o] : []));
  const n = sent.reduce((a, o) => a + o.n, 0);
  const seen = sent.reduce((a, o) => a + o.seen, 0);
  assert.equal(n, 600);
  assert.equal(seen, 200);
  assert.ok(sent.some((o) => (o.statuses.STORED ?? 0) > 0));
});

test('round handle: the wallet paymail wins, survives a not-answering wallet, key_ name only as a fallback', () => {
  assert.equal(roundHandle(PAYMAIL, ''), PAYMAIL);
  assert.equal(roundHandle(PAYMAIL, 'key_0123456789'), PAYMAIL);
  assert.equal(roundHandle(undefined, 'key_0123456789'), 'key_0123456789');
  assert.equal(roundHandle(null, null), null);
  assert.ok(needsPaymail('key_0123456789') && !needsPaymail(PAYMAIL));
  assert.ok(isSeen('SEEN_ON_NETWORK') && isSeen('MINED') && !isSeen('SEEN_IN_ORPHAN_MEMPOOL') && !isSeen('STORED'));
});
