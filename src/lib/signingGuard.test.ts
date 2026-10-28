/** Signing hardening (28 Oct 2026 audit): kill switch, caps, rate limits, broadcast double-spend, claim race, receipts. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PKH, PrivateKey, Script, Transaction } from '@bsv/sdk';
import { DailyCounter, LockBudget, RateLimiter, SigningOffError, arcAccepted, assertSigningOn, caps, envInt, safeEqual, signingOff, sumLastDay, underCap, LAUNCH_SIGNERS } from './launch/guard';
import { runClaim, type ClaimDeps, type OwedRow, type Utxo } from './launch/claimFlow';
import { settleReceipts, type Deps, type ReceiptRow } from './launch/receiptsFlow';
import { RECEIPT_GAS, RECEIPT_SUPPLY, TERRORNODE_ID, rangeSats, settlementAsm } from './launch/receipts';
import { splitOutputs } from './launch/split';
import { testQuote } from './splitFixture';
import { tokenOut } from './launch/shape';

// ── kill switch ────────────────────────────────────────────────

test('kill switch: off only when <NAME>_SIGNING_OFF is set; default signs', () => {
  assert.equal(signingOff(LAUNCH_SIGNERS, {}), false);
  assert.equal(signingOff(LAUNCH_SIGNERS, { LAUNCH_POOL_SIGNING_OFF: '1' }), true);
  assert.equal(signingOff(LAUNCH_SIGNERS, { LAUNCH_SIGNING_OFF: 'true' }), true);
  assert.equal(signingOff(LAUNCH_SIGNERS, { LAUNCH_POOL_SIGNING_OFF: '0' }), false);
  assert.throws(() => assertSigningOn(LAUNCH_SIGNERS, { LAUNCH_POOL_SIGNING_OFF: '1' }), SigningOffError);
  assert.doesNotThrow(() => assertSigningOn(LAUNCH_SIGNERS, {}));
});

// ── caps ───────────────────────────────────────────────────────

test('caps: documented defaults, env overrides, junk/zero falls back (never "no cap")', () => {
  assert.deepEqual(caps({}), { reserveSats: 500_000_000, vaultSats: 50_000_000, receiptTokens: 2_000_000, receiptInstantMax: 25_000 });
  assert.equal(caps({ LAUNCH_VAULT_DAILY_CAP_SATS: '1000' }).vaultSats, 1000);
  assert.equal(envInt('X', 7, { X: '0' }), 7);
  assert.equal(envInt('X', 7, { X: 'abc' }), 7);
  assert.equal(underCap(900, 100, 1000), true);
  assert.equal(underCap(900, 101, 1000), false);
});

test('caps: sumLastDay counts only the last 24 h', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const rows = [
    { created_at: '2026-10-28T11:00:00Z', sats: 10 },
    { created_at: '2026-10-27T12:30:00Z', sats: 20 },
    { created_at: '2026-10-27T11:59:00Z', sats: 400 },
  ];
  assert.equal(sumLastDay(rows, (r) => r.sats, now), 30);
  const c = new DailyCounter();
  c.add(5, now - 25 * 3600_000);
  c.add(7, now - 3600_000);
  assert.equal(c.total(now), 7);
});

// ── rate limits ────────────────────────────────────────────────

test('rate limiter: N per window per key, then refuses, then recovers', () => {
  const l = new RateLimiter();
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(l.allow('ip:a', 3, 60_000, t + i), true);
  assert.equal(l.allow('ip:a', 3, 60_000, t + 10), false);
  assert.equal(l.allow('ip:b', 3, 60_000, t + 10), true, 'other keys unaffected');
  assert.equal(l.allow('ip:a', 3, 60_000, t + 60_001), true, 'window slides');
});

test('lease budget: at most N live trade leases per requester; drop frees one', () => {
  const b = new LockBudget();
  const until = Date.now() + 90_000;
  assert.equal(b.canTake('ip:x', 2), true);
  b.take('ip:x', 'l1', until);
  b.take('ip:x', 'l2', until);
  assert.equal(b.canTake('ip:x', 2), false);
  b.drop('l1');
  assert.equal(b.canTake('ip:x', 2), true);
  b.take('ip:y', 'old', Date.now() - 1);
  assert.equal(b.canTake('ip:y', 1), true, 'expired leases do not count');
});

// ── secrets / broadcast ────────────────────────────────────────

test('safeEqual: constant-time compare, empty never matches', () => {
  assert.equal(safeEqual('s3cret', 's3cret'), true);
  assert.equal(safeEqual('s3cret', 's3creT'), false);
  assert.equal(safeEqual('s3cret', 's3cret-longer'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(null, 'x'), false);
});

test('broadcast: a double-spend reply is NOT success; the same tx already known is', () => {
  assert.equal(arcAccepted({ status: 'error', code: 409, description: 'invalid competing transaction identifiers' }), false);
  assert.equal(arcAccepted({ status: 'success', txStatus: 'DOUBLE_SPEND_ATTEMPTED' }), false);
  assert.equal(arcAccepted({ status: 'success', txStatus: 'REJECTED' }), false);
  assert.equal(arcAccepted({ status: 'success', txStatus: 'SEEN_ON_NETWORK' }), true);
  assert.equal(arcAccepted({ status: 'error', description: 'Transaction already known' }), true);
  assert.equal(arcAccepted({ status: 'error', description: 'ALREADY_IN_MEMPOOL' }), true);
  assert.equal(arcAccepted({ status: 'error', description: 'Fees are insufficient' }), false);
});

// ── claim: the double-payout race ──────────────────────────────

const vaultKey = PrivateKey.fromRandom();
const VAULT = vaultKey.toAddress();
const holder = PrivateKey.fromRandom().toAddress();
const payTo = PrivateKey.fromRandom().toAddress();

function claimWorld(opts: { owed?: number; cap?: number; failBroadcast?: string } = {}) {
  const fund = new Transaction();
  fund.addOutput({ lockingScript: new P2PKH().lock(VAULT), satoshis: 50_000 });
  fund.addOutput({ lockingScript: new P2PKH().lock(VAULT), satoshis: 50_000 });
  const rows: (OwedRow & { address: string; claim: string | null })[] = [{ id: 1, slot: 'slot-a', sats: opts.owed ?? 5_000, address: holder, claim: null }];
  let lease: string | null = null;
  const spent = new Map<string, string>();
  const broadcasts: Transaction[] = [];
  const payouts: { txid: string; detail: Record<string, unknown> }[] = [];
  let nextId = 2;
  const tick = () => new Promise((r) => setTimeout(r, 1));
  const d: ClaimDeps = {
    signatureUsed: async (a, ts) => payouts.some((p) => p.detail.to === a && p.detail.ts === ts),
    owedRows: async (a) => (await tick(), rows.filter((r) => r.address === a && !r.claim).map(({ id, slot, sats }) => ({ id, slot, sats }))),
    coin: async () => ({ token_id: 'tok_1', vault_address: VAULT }),
    lease: async (_t, l) => (await tick(), lease ? false : ((lease = l), true)),
    release: async (l) => void (lease === l && (lease = null)),
    // UTXO order differs per call: the case the audit warned would become a real double payout
    utxos: async () => {
      const u: Utxo[] = [0, 1].map((v) => ({ txid: fund.id('hex'), vout: v, sats: 50_000, tx: fund })).filter((x) => !spent.has(`${x.txid}_${x.vout}`));
      return Math.random() < 0.5 ? u : u.reverse();
    },
    vaultKey: () => vaultKey,
    markClaimed: async (_a, ids, txid) => {
      for (const r of rows) if (ids.includes(r.id) && !r.claim) r.claim = txid;
    },
    reowe: async (slot, address, sats) => void rows.push({ id: nextId++, slot, sats, address, claim: null }),
    broadcast: async (tx) => {
      await tick();
      if (opts.failBroadcast) throw new Error(opts.failBroadcast);
      for (const i of tx.inputs) {
        const op = `${i.sourceTXID ?? i.sourceTransaction!.id('hex')}_${i.sourceOutputIndex}`;
        if (spent.has(op)) throw new Error('double spend');
      }
      for (const i of tx.inputs) spent.set(`${i.sourceTXID ?? i.sourceTransaction!.id('hex')}_${i.sourceOutputIndex}`, tx.id('hex'));
      broadcasts.push(tx);
      return tx.id('hex');
    },
    spentBy: async (op) => spent.get(op) ?? null,
    txKnown: async (id) => broadcasts.some((t) => t.id('hex') === id),
    payout: async (txid, _s, _n, detail) => void payouts.push({ txid, detail }),
    vaultOutflowToday: async () => 0,
    vaultCap: opts.cap ?? 50_000_000,
    newLease: () => Math.random().toString(36),
  };
  return { d, rows, broadcasts, payouts };
}

test('claim race: 10 parallel claims with one signature pay out exactly once', async () => {
  const w = claimWorld();
  const rs = await Promise.all(Array.from({ length: 10 }, () => runClaim({ address: holder, payTo, ts: '123' }, w.d)));
  assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs.map((r) => (r.ok ? 'ok' : r.why))));
  assert.equal(w.broadcasts.length, 1);
  assert.equal(w.rows.filter((r) => r.claim).length, 1);
});

test('claim: the same signature cannot be used twice, even after new rewards accrue', async () => {
  const w = claimWorld();
  assert.ok((await runClaim({ address: holder, payTo, ts: '777' }, w.d)).ok);
  w.rows.push({ id: 99, slot: 'slot-a', sats: 3_000, address: holder, claim: null });
  const again = await runClaim({ address: holder, payTo, ts: '777' }, w.d);
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.status, 409);
  assert.ok((await runClaim({ address: holder, payTo, ts: '778' }, w.d)).ok, 'a fresh signature works');
});

test('claim: rows are marked before broadcast; a refused payout with nothing spent is re-credited', async () => {
  const w = claimWorld({ failBroadcast: 'Fees are insufficient' });
  const r = await runClaim({ address: holder, payTo, ts: '1' }, w.d);
  assert.equal(r.ok, false);
  assert.equal(w.rows[0].claim !== null, true, 'original row stays marked');
  const open = w.rows.filter((x) => !x.claim);
  assert.equal(open.length, 1);
  assert.equal(open[0].sats, 5_000, 're-credited the same amount');
});

test('claim: daily vault cap is checked before signing', async () => {
  const w = claimWorld({ cap: 4_000 });
  const r = await runClaim({ address: holder, payTo, ts: '1' }, w.d);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 503);
  assert.equal(w.broadcasts.length, 0);
  assert.equal(w.rows[0].claim, null, 'nothing marked');
});

test('claim: kill switch (vaultKey throws) signs nothing and marks nothing', async () => {
  const w = claimWorld();
  w.d.vaultKey = () => {
    throw new SigningOffError('LAUNCH_POOL');
  };
  const r = await runClaim({ address: holder, payTo, ts: '1' }, w.d);
  assert.equal(r.ok, false);
  assert.equal(w.broadcasts.length, 0);
  assert.equal(w.rows[0].claim, null);
});

// ── receipts: confirmation threshold + daily cap ───────────────

const poolKey = PrivateKey.fromRandom();
const POOL = poolKey.toAddress();
const gunKey = PrivateKey.fromRandom();
const player = PrivateKey.fromRandom().toAddress();

async function settlement(count: number) {
  const src = new Transaction();
  src.addOutput({ lockingScript: new P2PKH().lock(gunKey.toAddress()), satoshis: 10_000_000 });
  const t = new Transaction();
  t.addInput({ sourceTransaction: src, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(gunKey) });
  const q = testQuote();
  t.addOutput({ lockingScript: Script.fromASM(settlementAsm({ count, recipient: player, session: 's1', handle: 'x@bwalletx.com' }, q)), satoshis: 0 });
  for (const o of splitOutputs(q, Number(rangeSats(1, count)))) t.addOutput({ lockingScript: new P2PKH().lock(o.address), satoshis: o.sats });
  t.addOutput({ lockingScript: new P2PKH().lock(POOL), satoshis: RECEIPT_GAS });
  t.addOutput({ lockingScript: new P2PKH().lock(gunKey.toAddress()), change: true });
  await t.fee(50);
  await t.sign();
  return t;
}

function receiptWorld(extra: Partial<Deps>) {
  const chain = new Map<string, Transaction>();
  const poolSrc = new Transaction();
  poolSrc.addOutput({ lockingScript: Script.fromHex(tokenOut(TERRORNODE_ID, RECEIPT_SUPPLY, POOL)), satoshis: 1 });
  chain.set(poolSrc.id('hex'), poolSrc);
  const rows = new Map<string, ReceiptRow>();
  let lease: string | null = null;
  const pool = { slot: 's', token_address: POOL, token_utxo: `${poolSrc.id('hex')}_0`, token_amt: Number(RECEIPT_SUPPLY), beef: 'b' };
  const sends: Transaction[] = [];
  const d: Deps = {
    legacyOk: false,
    notify: async () => ({ ok: true }),
    toleranceBps: 0,
    txHex: async (id) => chain.get(id)?.toHex() ?? null,
    get: async (id) => rows.get(id) ?? null,
    reserve: async (a) => {
      const r: ReceiptRow = rows.get(a.txid) ?? { session_txid: a.txid, recipient: a.recipient, first_n: 1, count: a.count, status: 'reserved', transfer_txid: null };
      rows.set(a.txid, r);
      return r;
    },
    lease: async (l) => (lease ? null : ((lease = l), { ...pool })),
    release: async (l) => void (lease === l && (lease = null)),
    sending: async (id, tr) => void Object.assign(rows.get(id)!, { status: 'sending', transfer_txid: tr }),
    sent: async (a) => {
      lease = null;
      Object.assign(rows.get(a.txid)!, { status: 'sent', transfer_txid: a.transfer });
    },
    spentBy: async () => null,
    broadcast: async (tx) => (sends.push(tx), tx.id('hex')),
    poolKey: () => poolKey,
    poolSource: (_b, id) => chain.get(id) ?? null,
    mergeBeef: (b) => b,
    newLease: () => Math.random().toString(36),
    ...extra,
  };
  return { d, chain, rows, sends };
}

test('receipts: a large settlement waits for 1 confirmation; small ones stay instant', async () => {
  let conf = 0;
  const w = receiptWorld({ instantMax: 1_000, confirmations: async () => conf });
  const big = await settlement(5_000);
  w.chain.set(big.id('hex'), big);
  const r1 = await settleReceipts(big.id('hex'), POOL, w.d);
  assert.equal(r1.ok, false);
  assert.equal(!r1.ok && r1.status, 202, 'client retries 202');
  assert.equal(w.sends.length, 0);
  assert.equal(w.rows.get(big.id('hex'))?.status, 'reserved', 'range stays reserved');
  conf = 1;
  const r2 = await settleReceipts(big.id('hex'), POOL, w.d);
  assert.ok(r2.ok, JSON.stringify(r2));
  assert.equal(w.sends.length, 1);

  const w2 = receiptWorld({ instantMax: 1_000, confirmations: async () => 0 });
  const small = await settlement(500);
  w2.chain.set(small.id('hex'), small);
  assert.ok((await settleReceipts(small.id('hex'), POOL, w2.d)).ok, 'under the threshold: 0-conf ok');
});

test('receipts: daily token cap holds a settlement before signing', async () => {
  let sent = 1_999_900;
  const w = receiptWorld({ dailyCap: { sentToday: () => sent, cap: 2_000_000, add: (n) => void (sent += n) } });
  const st = await settlement(500);
  w.chain.set(st.id('hex'), st);
  const r = await settleReceipts(st.id('hex'), POOL, w.d);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 503);
  assert.equal(w.sends.length, 0);
  sent = 0;
  assert.ok((await settleReceipts(st.id('hex'), POOL, w.d)).ok);
  assert.equal(sent, 500, 'counted after broadcast');
});
