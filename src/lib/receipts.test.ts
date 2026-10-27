/** $TERRORNODE receipts: pricing sums, settlement parsing, payment checks, and the server flow on a mock chain. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, PrivateKey, Script, Transaction } from '@bsv/sdk';
import {
  LEGACY_RECEIPT_CREATOR, RECEIPT_GAS, RECEIPT_SUPPLY, TERRORNODE_ID, GRADUATE_AT, RECEIPT_TOP_SATS, affordableReceipts, checkPayment, priceSats, rangeSats, readSettlement, settlementAsm, shotsFor, soldOut, tradeRefusal, tradingOf,
} from './launch/receipts';
import { testQuote } from './splitFixture';
import { splitOutputs } from './launch/split';
import { settleReceipts, type Deps, type PoolRow, type ReceiptRow } from './launch/receiptsFlow';
import { coinExtras } from './launch/coinMeta';
import { tokenOut } from './launch/shape';

const PENNY = RECEIPT_TOP_SATS; // 200 sats, fixed
const N = RECEIPT_SUPPLY;

test('price: 1 sat for #1, 200 sats for #1e9, linear between, default = the fixed curve', () => {
  assert.equal(priceSats(1, PENNY), BigInt(1));
  assert.equal(priceSats(N, PENNY), PENNY);
  const mid = priceSats((N + BigInt(1)) / BigInt(2), PENNY);
  assert.ok(mid >= PENNY / BigInt(2) - BigInt(1) && mid <= PENNY / BigInt(2) + BigInt(1));
  assert.equal(PENNY, BigInt(200));
  assert.equal(priceSats(1), BigInt(1));
  assert.equal(priceSats(N), BigInt(200));
  assert.equal(priceSats(10_000_000), BigInt(3)); // 1 + 199 × 9,999,999 / 999,999,999 = 2.99…, rounded up
  assert.throws(() => priceSats(0, PENNY));
  assert.throws(() => priceSats(N + BigInt(1), PENNY));
});

test('rangeSats: closed form equals the exact brute-force sum (rounded up once)', () => {
  const brute = (a: bigint, c: number, p: bigint) => {
    let num = BigInt(0);
    const den = N - BigInt(1);
    for (let i = 0; i < c; i++) num += den + (p - BigInt(1)) * (a + BigInt(i) - BigInt(1));
    return (num + den - BigInt(1)) / den;
  };
  for (const [a, c] of [[1, 1], [1, 1000], [12345, 777], [500_000_000, 50], [999_999_000, 1000]] as [number, number][]) {
    assert.equal(rangeSats(a, c, PENNY), brute(BigInt(a), c, PENNY), `range ${a}+${c}`);
  }
  assert.equal(rangeSats(1, N, PENNY), (N * (PENNY + BigInt(1)) + BigInt(1)) / BigInt(2)); // whole supply: N(1+P)/2
  assert.equal(rangeSats(5, 0, PENNY), BigInt(0));
  assert.throws(() => rangeSats(N, 2, PENNY));
});

test('shotsFor on the fixed curve', () => {
  const n = shotsFor(10_000, 9, 0);
  const cost = (k: number) => BigInt(9 * k) + rangeSats(1, k);
  assert.ok(cost(n) <= BigInt(10_000) && cost(n + 1) > BigInt(10_000));
  assert.equal(shotsFor(0, 9, 0), 0);
});

test('client == server: the gun pays exactly what the ledger checks, for any range', () => {
  // the server's check (checkPayment, same closed form as db/022 with p_penny = 200) accepts exactly rangeSats, refuses 1 sat less
  for (const [issued, c] of [[0, 1], [0, 1_000_000], [9_999_000, 5000], [123_456_789, 77_777], [999_000_000, 1_000_000]] as [number, number][]) {
    const pay = rangeSats(issued + 1, c);
    assert.ok(checkPayment({ count: c, paid: pay, gas: BigInt(RECEIPT_GAS) }, issued, 0).ok, `${issued}+${c}`);
    assert.equal(checkPayment({ count: c, paid: pay - BigInt(1), gas: BigInt(RECEIPT_GAS) }, issued, 0).ok, false);
    // split ranges never cost less than one range (rounded up once per range)
    const h = Math.floor(c / 2);
    if (h > 0) assert.ok(rangeSats(issued + 1, h) + rangeSats(issued + 1 + h, c - h) >= pay);
  }
  // a 1M-shot session from #1: 1,000,000 + 199 × Σ(0..999,999) / 999,999,999, rounded up
  assert.equal(rangeSats(1, 1_000_000), BigInt(1_099_500));
  // the whole supply: N(1 + 200)/2
  assert.equal(rangeSats(1, N), BigInt(100_500_000_000));
});

test('graduation: TERRORNODE trades from 10,000,000 receipts issued, refused before', () => {
  assert.equal(GRADUATE_AT, 10_000_000);
  assert.equal(tradingOf(TERRORNODE_ID, null), false);
  assert.equal(tradingOf(TERRORNODE_ID, 9_999_999), false);
  assert.equal(tradingOf(TERRORNODE_ID, 10_000_000), true);
  assert.match(tradeRefusal(TERRORNODE_ID, 9_999_999) ?? '', /cannot be bought or sold.*9,999,999 so far/);
  assert.match(tradeRefusal(TERRORNODE_ID, null) ?? '', /cannot be bought or sold/);
  assert.equal(tradeRefusal(TERRORNODE_ID, 10_000_000), null);
  assert.equal(tradeRefusal('79d84d2f194ef324837b6dc69e39afc404d1a1dc3cbadb0215d5fa06c2269a0f_1', null), null);
  const before = coinExtras({ token_id: TERRORNODE_ID, sold: 0 }, 9_999_999) as Record<string, unknown>;
  assert.equal(before.trading, false);
  assert.equal(before.category, 'reward');
  assert.equal(before.price_sats, null);
  const after = coinExtras({ token_id: TERRORNODE_ID, sold: 0 }, 10_000_000) as Record<string, unknown>;
  assert.equal(after.trading, true);
  assert.equal(after.category, undefined);
  assert.equal(typeof after.price_sats, 'number');
  assert.equal(after.earn_url, 'https://www.tokenblaster.lol/arcade/terrornode', 'earning continues after graduation');
  assert.equal(after.receipts_issued, 10_000_000);
});

test('sell-out: all 1B issued stops receipts gracefully', () => {
  assert.equal(soldOut(N - BigInt(1)), false);
  assert.equal(soldOut(N), true);
  assert.equal(shotsFor(1_000_000, 9, N), 0);
  assert.equal(affordableReceipts(N + BigInt(1), 10, 1_000_000), 0);
  assert.equal(affordableReceipts(N, 10, 1_000_000), 1, 'only the last receipt is left');
  assert.throws(() => rangeSats(N, 2));
});

test('trading flag: TERRORNODE is play-to-earn, other coins trade', () => {
  assert.equal(tradingOf(TERRORNODE_ID), false);
  assert.equal(tradingOf('79d84d2f194ef324837b6dc69e39afc404d1a1dc3cbadb0215d5fa06c2269a0f_1'), true);
  const x = coinExtras({ token_id: TERRORNODE_ID, sold: 0 });
  assert.equal(x.trading, false);
  assert.equal((x as { earn_url?: string }).earn_url, 'https://www.tokenblaster.lol/arcade/terrornode');
  assert.equal((x as { category?: string }).category, 'reward');
  assert.equal(coinExtras({ token_id: 'x', sold: 0 }).trading, true);
});

// ── mock chain + ledger ────────────────────────────────────────

const poolKey = PrivateKey.fromRandom();
const POOL = poolKey.toAddress();
const player = PrivateKey.fromRandom().toAddress();
const gunKey = PrivateKey.fromRandom();

function fundingTx(sats: number, to: string) {
  const t = new Transaction();
  t.addOutput({ lockingScript: new P2PKH().lock(to), satoshis: sats });
  return t;
}
const QUOTE = testQuote();
async function settlementTx(count: number, paid: number, gas = RECEIPT_GAS, recipient = player, legacy = false) {
  const src = fundingTx(1_000_000, gunKey.toAddress());
  const t = new Transaction();
  t.addInput({ sourceTransaction: src, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(gunKey) });
  const asm = settlementAsm({ count, recipient, session: 'abc123', handle: 'neo@bwalletx.com' }, QUOTE);
  // legacy: a pre-split settlement (tag without the split, money to the old creator address)
  t.addOutput({ lockingScript: Script.fromASM(legacy ? asm.split(' ').slice(0, 9).join(' ') : asm), satoshis: 0 });
  if (legacy) t.addOutput({ lockingScript: new P2PKH().lock(LEGACY_RECEIPT_CREATOR), satoshis: paid });
  else for (const o of splitOutputs(QUOTE, paid)) t.addOutput({ lockingScript: new P2PKH().lock(o.address), satoshis: o.sats });
  t.addOutput({ lockingScript: new P2PKH().lock(POOL), satoshis: gas });
  t.addOutput({ lockingScript: new P2PKH().lock(gunKey.toAddress()), change: true });
  await t.fee(50);
  await t.sign();
  return t;
}

function world() {
  const chain = new Map<string, Transaction>();
  const poolSrc = new Transaction();
  poolSrc.addOutput({ lockingScript: Script.fromHex(tokenOut(TERRORNODE_ID, RECEIPT_SUPPLY, POOL)), satoshis: 1 });
  chain.set(poolSrc.id('hex'), poolSrc);
  const spent = new Map<string, string>();
  const pool: PoolRow & { lease: string | null } = { slot: 's', token_address: POOL, token_utxo: `${poolSrc.id('hex')}_0`, token_amt: Number(RECEIPT_SUPPLY), beef: 'beef', lease: null };
  const rows = new Map<string, ReceiptRow>();
  let issued = 0;
  const broadcasts: Transaction[] = [];
  const notified: string[] = [];
  const d: Deps = {
    legacyOk: false,
    notify: async (hex) => (notified.push(Transaction.fromHex(hex).id('hex')), { ok: true }),
    toleranceBps: 0,
    txHex: async (id) => chain.get(id)?.toHex() ?? null,
    get: async (id) => rows.get(id) ?? null,
    reserve: async (a) => {
      const had = rows.get(a.txid);
      if (had) return had;
      const chk = checkPayment({ count: a.count, paid: a.paid, gas: BigInt(RECEIPT_GAS) }, issued, a.tol, a.penny);
      if (!chk.ok) throw new Error(`underpaid: ${chk.why}`);
      const r: ReceiptRow = { session_txid: a.txid, recipient: a.recipient, first_n: issued + 1, count: a.count, status: 'reserved', transfer_txid: null };
      issued += a.count;
      rows.set(a.txid, r);
      return r;
    },
    lease: async (l) => (pool.lease ? null : ((pool.lease = l), { ...pool })),
    release: async (l) => void (pool.lease === l && (pool.lease = null)),
    sending: async (id, tr) => void Object.assign(rows.get(id)!, { status: 'sending', transfer_txid: tr }),
    sent: async (a) => {
      if (pool.lease !== a.lease) throw new Error('lease lost');
      Object.assign(pool, { token_utxo: a.tokenUtxo, token_amt: Number(a.tokenAmt), lease: null });
      Object.assign(rows.get(a.txid)!, { status: 'sent', transfer_txid: a.transfer });
    },
    spentBy: async (op) => spent.get(op) ?? null,
    broadcast: async (tx) => {
      for (const i of tx.inputs) spent.set(`${i.sourceTXID ?? i.sourceTransaction!.id('hex')}_${i.sourceOutputIndex}`, tx.id('hex'));
      chain.set(tx.id('hex'), tx);
      broadcasts.push(tx);
      return tx.id('hex');
    },
    poolKey: () => poolKey,
    poolSource: (_b, id) => chain.get(id) ?? null,
    mergeBeef: (b) => b,
    newLease: () => Math.random().toString(36),
  };
  return { d, chain, pool, rows, broadcasts, notified, issued: () => issued };
}

test('flow: verifies payment on chain, reserves the range, ONE transfer to the recipient', async () => {
  const w = world();
  const owed = Number(rangeSats(1, 100, PENNY));
  const st = await settlementTx(100, owed);
  w.chain.set(st.id('hex'), st);
  const r = await settleReceipts(st.id('hex'), POOL, w.d);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.ok && r.count, 100);
  assert.equal(r.ok && r.first, 1);
  assert.equal(w.broadcasts.length, 1);
  const out = w.broadcasts[0].outputs[0].lockingScript.toHex();
  assert.equal(out, tokenOut(TERRORNODE_ID, BigInt(100), player));
  assert.equal(w.pool.token_amt, Number(RECEIPT_SUPPLY) - 100);
  assert.equal(readSettlement(st, POOL)?.recipient, player);
});

test('flow: idempotent per settlement txid (no second transfer, same range)', async () => {
  const w = world();
  const st = await settlementTx(10, Number(rangeSats(1, 10, PENNY)));
  w.chain.set(st.id('hex'), st);
  const a = await settleReceipts(st.id('hex'), POOL, w.d);
  const b = await settleReceipts(st.id('hex'), POOL, w.d);
  assert.deepEqual(a, b);
  assert.equal(w.broadcasts.length, 1);
  assert.equal(w.issued(), 10);
});

test('flow: two sessions get disjoint, consecutive ranges; a busy pool is retried, not double-spent', async () => {
  const w = world();
  const s1 = await settlementTx(5, Number(rangeSats(1, 5, PENNY)));
  const s2 = await settlementTx(7, Number(rangeSats(6, 7, PENNY)));
  w.chain.set(s1.id('hex'), s1);
  w.chain.set(s2.id('hex'), s2);
  const [r1, r2] = await Promise.all([settleReceipts(s1.id('hex'), POOL, w.d), settleReceipts(s2.id('hex'), POOL, w.d)]);
  const firsts = [w.rows.get(s1.id('hex'))!, w.rows.get(s2.id('hex'))!].map((r) => [Number(r.first_n), Number(r.count)]).sort((x, y) => x[0] - y[0]);
  assert.equal(firsts[0][0] + firsts[0][1], firsts[1][0]); // no overlap, no gap
  const later = [r1, r2].find((r) => !r.ok);
  if (later) {
    assert.equal(!later.ok && later.status, 409);
    const again = await settleReceipts((r1.ok ? s2 : s1).id('hex'), POOL, w.d);
    assert.ok(again.ok);
  }
  assert.equal(w.pool.token_amt, Number(RECEIPT_SUPPLY) - 12);
});

test('flow: underpaid, short gas, and non-settlement txs are refused; nothing moves', async () => {
  const w = world();
  const low = await settlementTx(1000, Number(rangeSats(1, 1000, PENNY)) - 50);
  const noGas = await settlementTx(10, Number(rangeSats(1, 10, PENNY)), 10);
  const plain = fundingTx(1000, LEGACY_RECEIPT_CREATOR);
  for (const t of [low, noGas, plain]) w.chain.set(t.id('hex'), t);
  assert.equal((await settleReceipts(low.id('hex'), POOL, w.d)) .ok, false);
  assert.equal((await settleReceipts(noGas.id('hex'), POOL, w.d)).ok, false);
  assert.equal((await settleReceipts(plain.id('hex'), POOL, w.d)).ok, false);
  const missing = await settleReceipts('f'.repeat(64), POOL, w.d);
  assert.equal(!missing.ok && missing.status, 202);
  assert.equal(w.broadcasts.length, 0);
  assert.equal(w.issued(), 0);
});

test('flow: a transfer that went out but was not booked is booked on retry, not resent', async () => {
  const w = world();
  const st = await settlementTx(3, Number(rangeSats(1, 3, PENNY)));
  w.chain.set(st.id('hex'), st);
  const realSent = w.d.sent;
  let fail = true;
  w.d.sent = async (a) => {
    if (fail) {
      fail = false;
      w.pool.lease = null; // the lease expired before the retry
      throw new Error('ledger down');
    }
    return realSent(a);
  };
  const first = await settleReceipts(st.id('hex'), POOL, w.d);
  assert.equal(first.ok, false);
  assert.equal(w.broadcasts.length, 1);
  const again = await settleReceipts(st.id('hex'), POOL, w.d);
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(w.broadcasts.length, 1);
  assert.equal(w.rows.get(st.id('hex'))!.status, 'sent');
});

test('a settlement only takes what one coin can afford; the rest is carried forward', async () => {
  const first = 1_000_000;
  const budget = Number(rangeSats(first, 500, PENNY));
  assert.equal(affordableReceipts(first, 10_000, budget), 500);
  assert.equal(affordableReceipts(first, 10_000, budget - 1), 499);
  assert.equal(affordableReceipts(first, 200, budget), 200, 'never more than owed');
  assert.equal(affordableReceipts(first, 200, 0), 0);
  assert.equal(affordableReceipts(first, 200, -50), 0);
});

test('flow (split): pays 50/50 to NPG Ltd and bCorp, notifies once, a refused notify moves nothing', async () => {
  const w = world();
  const st = await settlementTx(10, Number(rangeSats(1, 10, PENNY)));
  w.chain.set(st.id('hex'), st);
  assert.ok((await settleReceipts(st.id('hex'), POOL, w.d)).ok);
  assert.ok((await settleReceipts(st.id('hex'), POOL, w.d)).ok); // idempotent: the ledger row answers, no re-notify
  assert.deepEqual(w.notified, [st.id('hex')]);
  assert.equal(w.broadcasts.length, 1);

  const w2 = world();
  w2.d.notify = async () => ({ ok: false, why: 'unknown-reference', retry: false });
  const st2 = await settlementTx(10, Number(rangeSats(1, 10, PENNY)));
  w2.chain.set(st2.id('hex'), st2);
  const r = await settleReceipts(st2.id('hex'), POOL, w2.d);
  assert.equal(!r.ok && r.status, 402);
  assert.equal(w2.issued(), 0);
  w2.d.notify = async () => ({ ok: false, why: 'down', retry: true });
  const r3 = await settleReceipts(st2.id('hex'), POOL, w2.d);
  assert.equal(!r3.ok && r3.status, 202);
});

test('flow (split): a pre-split settlement to the old creator is refused once the grace ends', async () => {
  const w = world();
  const st = await settlementTx(5, Number(rangeSats(1, 5, PENNY)), RECEIPT_GAS, player, true);
  w.chain.set(st.id('hex'), st);
  const r = await settleReceipts(st.id('hex'), POOL, w.d);
  assert.equal(!r.ok && r.status, 402);
  w.d.legacyOk = true; // grace: already-paid queued deliveries still arrive
  assert.ok((await settleReceipts(st.id('hex'), POOL, w.d)).ok);
});
