import assert from 'node:assert/strict';
import { test } from 'node:test';
import { P2PKH, PrivateKey, Spend, Transaction, Utils } from '@bsv/sdk';
import { Guard, RateLimiter, blastFee, checkPlan, costOf, plan, quota } from './stress/plan';
import { makeSigner, opReturnFor } from './signer.mjs';

test('fee per blast at 100 sat/kB is 26 sats; 1M txs ≈ 0.26 BSV', () => {
  assert.equal(blastFee(100), 26);
  assert.equal(blastFee(1), 1);
  const c = costOf(1_000_000, 100, 17.4);
  assert.equal(c.sats, 26_000_000);
  assert.ok(Math.abs(c.usd - 4.524) < 0.01);
});

test('plan splits count over chains and respects max depth', () => {
  const p = plan({ count: 10_000, chains: 5, feeRate: 100, maxDepth: 1000 });
  assert.equal(p.chains, 10);
  assert.equal(p.depth, 1000);
  let sum = 0; for (let c = 0; c < p.chains; c++) sum += quota(p.count, p.chains, c);
  assert.equal(sum, 10_000);
  assert.ok(p.totalSats >= 10_000 * 24);
});

test('checkPlan refuses over-budget plans', () => {
  const p = plan({ count: 100_000, chains: 100, feeRate: 100 });
  assert.match(checkPlan(p, { maxTxs: 10_000, maxSats: 1e9, maxRejectRatio: 0.2, minWindow: 1 })!, /cap/);
  assert.match(checkPlan(p, { maxTxs: 1e6, maxSats: 1000, maxRejectRatio: 0.2, minWindow: 1 })!, /sats/);
  assert.equal(checkPlan(p, { maxTxs: 1e6, maxSats: 1e9, maxRejectRatio: 0.2, minWindow: 1 }), null);
});

test('guard stops on caps and reject ratio', () => {
  const g = new Guard({ maxTxs: 1000, maxSats: 10_000, maxRejectRatio: 0.2, minWindow: 100 }, 24);
  assert.equal(g.record(100, 0), null);
  assert.match(g.allows(1000)!, /max txs/);
  assert.match(g.allows(400)!, /max sats/);       // 100*24 + 400*24 > 10k
  assert.match(g.record(0, 100)!, /reject ratio/);
});

test('rate limiter paces to rate', async () => {
  let now = 0;
  const rl = new RateLimiter(100, 100, () => now, async (ms) => { now += ms; });
  await rl.take(100);           // burst
  await rl.take(50);            // needs 0.5 s
  assert.ok(now >= 499 && now <= 501, `now=${now}`);
  assert.equal(new RateLimiter(0).waitMs(1e9), 0);
});

test('fast signer makes valid chained blasts (verified by @bsv/sdk)', async () => {
  const key = PrivateKey.fromRandom();
  const pub = key.toPublicKey().encode(false) as number[];
  const b = (a: number[]) => Buffer.from(a).toString('base64url');
  const s = makeSigner({ d: b(key.toArray('be', 32)), x: b(pub.slice(1, 33)), y: b(pub.slice(33)) });
  // a fake funding parent paying our key
  const parent = new Transaction();
  parent.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, unlockingScript: new P2PKH().lock(key.toAddress()) });
  parent.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 1000 });
  let prev = parent, txidLE = Buffer.from(parent.id('hex'), 'hex').reverse(), vout = 0, value = 1000;
  for (let i = 1; i <= 3; i++) {
    const t = s.blast(txidLE, vout, value, opReturnFor('stress', `0:${i}`, 'stress'), 24);
    const tx = Transaction.fromHex(t.raw.toString('hex'));
    const src = prev.outputs[vout];
    const spend = new Spend({
      sourceTXID: prev.id('hex'), sourceOutputIndex: vout, sourceSatoshis: src.satoshis!, lockingScript: src.lockingScript,
      transactionVersion: tx.version, otherInputs: [], outputs: tx.outputs, inputIndex: 0,
      unlockingScript: tx.inputs[0].unlockingScript!, inputSequence: tx.inputs[0].sequence!, lockTime: tx.lockTime,
    });
    assert.equal(spend.validate(), true);
    assert.equal(tx.outputs[1].satoshis, value - 24);
    const tag = tx.outputs[0].lockingScript.toHex();
    assert.ok(tag.startsWith('006a10' + Utils.toHex(Utils.toArray('tokenblaster.lol', 'utf8'))), tag);
    assert.ok(t.raw.length <= 240, `size ${t.raw.length}`);
    prev = tx; txidLE = t.txidLE; vout = 1; value = t.change;
  }
});
