/** Swap on load (owner, 25 Oct 2026): ammo-coin config, quote split, discount input, plan checks. Mocks only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Beef, LockingScript, P2PKH, PrivateKey, Transaction, UnlockingScript, type WalletInterface } from '@bsv/sdk';
import { AMMO_COINS, MAX_COIN_ROUNDS, MAX_LANE_DEPTH, activeAmmoCoins, ammoCoinById, coinLanesFor, planSwapLoad, splitEven, type AmmoCoin } from './launch/ammoCoins';
import { MIN_BUY, quoteBuy } from './launch/curve';
import { p2pkh, tokenOut, type TradePlan } from './launch/shape';
import { checkSwapPlan, swapLoad } from './launch/swapLoad';

const ID = `${'ab'.repeat(32)}_0`;
const gun = PrivateKey.fromRandom().toAddress();
const house = PrivateKey.fromRandom().toAddress();
const coin: AmmoCoin = { key: 't', sym: 'TERRORNODE', tokenId: ID, burnPer: BigInt(1) };

test('TERRORNODE is configured but hidden while its token id is empty, no discount field', () => {
  const t = AMMO_COINS.find((c) => c.key === 'terrornode')!;
  assert.equal(t.tokenId, '');
  assert.equal('discountBps' in t, false);
  assert.equal(activeAmmoCoins().length, 0);
  assert.equal(ammoCoinById(ID), null);
  assert.equal(ammoCoinById(ID, [coin])?.sym, 'TERRORNODE');
});

test('planSwapLoad: minimum buy, the rest is gunpowder at BURN_FEE per round, within budget', () => {
  const q = planSwapLoad({ paySats: 1_000_000, sold: BigInt(0), coin, slippageBps: 300 })!;
  assert.equal(q.gross, BigInt(MIN_BUY));
  assert.equal(q.tokens, quoteBuy(BigInt(0), BigInt(MIN_BUY)).tokens);
  assert.ok(q.rounds > 10_000 && BigInt(q.rounds) <= q.minTokens);
  assert.ok(q.fuelSats >= q.rounds * 90);
  assert.equal(q.lanes, coinLanesFor(q.rounds));
  assert.equal(q.tokenSats, q.gross);
  assert.ok(q.totalSats <= 1_000_000);
  assert.equal(q.minTokens, (q.tokens * BigInt(9_700)) / BigInt(10_000));
  assert.equal(planSwapLoad({ paySats: 1_000, sold: BigInt(0), coin, slippageBps: 300 }), null);
});

test('planSwapLoad grows the buy when tokens, not gunpowder, are the limit', () => {
  const pricey: AmmoCoin = { ...coin, burnPer: BigInt(1_000) };
  const q = planSwapLoad({ paySats: 5_000_000, sold: BigInt(0), coin: pricey, slippageBps: 100 })!;
  assert.ok(q.gross > BigInt(MIN_BUY));
  assert.ok(q.minTokens / BigInt(1_000) >= BigInt(q.rounds));
  assert.ok(q.totalSats <= 5_000_000);
});

test('lanes: enough for speed, never deeper than MAX_LANE_DEPTH, rounds capped per load', () => {
  assert.equal(coinLanesFor(1), 1);
  assert.equal(coinLanesFor(2_500), 25);
  assert.equal(coinLanesFor(100_000), 100);
  for (const r of [1, 99, 5_000, 27_000, 100_000]) assert.ok(Math.ceil(r / coinLanesFor(r)) <= MAX_LANE_DEPTH);
  assert.equal(MAX_COIN_ROUNDS, 100_000); // per-shot burns only (PER_SHOT_BURN off)
  assert.deepEqual(splitEven(BigInt(10), 3), [BigInt(4), BigInt(3), BigInt(3)]);
});

// A buy plan as the route builds it: tokens to the gun, pool remainder, reserve, fees.
function buyPlan(to: string, gross = BigInt(MIN_BUY)): TradePlan {
  const q = quoteBuy(BigInt(0), gross);
  const pool = new Transaction();
  pool.addInput({ sourceTXID: 'cd'.repeat(32), sourceOutputIndex: 0, unlockingScript: new UnlockingScript() });
  pool.addOutput({ lockingScript: new P2PKH().lock(house), satoshis: 1 });
  const op = `${pool.id('hex')}_0`;
  return {
    lease: 'L',
    side: 'buy',
    tokenId: ID,
    sym: 'TERRORNODE',
    inputs: [{ outpoint: op, sats: 1, what: 'pool tokens' }],
    outputs: [
      { script: tokenOut(ID, q.tokens, to), sats: 1, what: 'to gun' },
      { script: tokenOut(ID, BigInt(1_000_000_000) - q.tokens, house), sats: 1, what: 'pool' },
      { script: p2pkh(house), sats: Number(q.curveSats), what: 'reserve' },
      { script: p2pkh(house), sats: Number(q.houseFee), what: 'fee' },
      { script: p2pkh(house), sats: Number(q.routeFee), what: 'route' },
      { script: p2pkh(house), sats: 1_000, what: 'index' },
    ],
    beef: (() => {
      const b = new Beef();
      b.mergeTransaction(pool);
      return b.toHex();
    })(),
    quote: { tokens: q.tokens.toString(), curveSats: q.curveSats.toString(), houseFee: q.houseFee.toString(), routeFee: q.routeFee.toString(), userSats: q.userSats.toString(), soldAfter: q.soldAfter.toString(), indexFee: 1_000 },
    expires: Date.now() + 90_000,
  };
}

test('checkSwapPlan: tokens must go to the gun, above the slippage floor, wallet share within the quote', () => {
  const plan = buyPlan(gun);
  const tokens = BigInt(plan.quote.tokens);
  const ok = { tokenId: ID, gun, minTokens: tokens, maxWalletSats: MIN_BUY + 1 + 5_000 };
  assert.equal(checkSwapPlan(plan, ok), null);
  assert.match(checkSwapPlan(buyPlan(house), ok)!, /not going to your gun/);
  assert.match(checkSwapPlan(plan, { ...ok, minTokens: tokens + BigInt(1) })!, /slippage/);
  assert.match(checkSwapPlan(plan, { ...ok, maxWalletSats: 100 })!, /more than/);
});

test('swapLoad: one createAction with the plan + gunpowder to the gun; busy coin is retried politely', async () => {
  const plan = buyPlan(gun);
  const q = planSwapLoad({ paySats: 1_000_000, sold: BigInt(0), coin, slippageBps: 300 })!;
  const calls: { step: string; body: Record<string, unknown> }[] = [];
  let busy = 2;
  const statuses: string[] = [];
  const post = async <T,>(_u: string, body: unknown): Promise<T> => {
    const b = body as Record<string, unknown>;
    calls.push({ step: String(b.step), body: b });
    if (b.step === 'prepare' && busy-- > 0) throw Object.assign(new Error('busy'), { status: 409 });
    if (b.step === 'prepare') return { plan } as T;
    if (b.step === 'sign') return { spends: { 0: '00' } } as T;
    if (b.step === 'commit') return { txid: 'f'.repeat(64) } as T;
    return {} as T;
  };
  let created: Parameters<WalletInterface['createAction']>[0] | null = null;
  const wallet = {
    createAction: async (a: Parameters<WalletInterface['createAction']>[0]) => {
      created = a;
      const src = Beef.fromString(plan.beef, 'hex').txs[0];
      const tx = new Transaction();
      const pool = Beef.fromString(plan.beef, 'hex').findTxid(plan.inputs[0].outpoint.split('_')[0])!.tx!;
      void src;
      tx.addInput({ sourceTransaction: pool, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() });
      for (const o of a.outputs!) tx.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
      return { signableTransaction: { tx: tx.toAtomicBEEF(), reference: 'ref' } };
    },
    signAction: async () => ({}),
    abortAction: async () => ({ aborted: true }),
  } as unknown as WalletInterface;
  const r = await swapLoad(wallet, gun, 'trader', coin, q, (s) => statuses.push(s), { post, sleep: async () => undefined });
  const prep = calls.filter((c) => c.step === 'prepare');
  assert.equal(prep.length, 3);
  assert.equal(prep[0].body.to, gun);
  assert.equal(prep[0].body.purpose, 'ammo');
  assert.equal(prep[0].body.amount, q.gross.toString());
  assert.ok(statuses.some((s) => /busy, retrying/.test(s)));
  assert.ok(statuses.some((s) => /one approval/i.test(s)));
  const outs = created!.outputs!;
  assert.equal(outs.length, plan.outputs.length + 1);
  assert.equal(outs.at(-1)!.lockingScript, new P2PKH().lock(gun).toHex());
  assert.equal(outs.at(-1)!.satoshis, q.fuelSats);
  assert.equal(r.fuelVout, plan.outputs.length);
  assert.equal(r.tokens, BigInt(plan.quote.tokens));
  assert.deepEqual(calls.map((c) => c.step).slice(-2), ['sign', 'commit']);
});
