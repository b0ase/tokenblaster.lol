/**
 * The server's receipt settlement, with its chain and ledger injected (the route wires the real ones,
 * the tests a mock chain and an in-memory ledger). Order, each step safe to retry:
 *   1. fetch the settlement tx from the chain and read its tag + payments (receipts.ts readSettlement): the receipt
 *      money must be split exactly 50/50 to the pinned NPG Ltd / bCorp destinations its tag names (split.ts), and
 *      each company's paymail server must accept its half (notify: proof the destination was issued; idempotent)
 *   2. reserve the receipt range in the ledger, which checks the payment against the server's own price and
 *      is idempotent per txid (db/022 tokenblaster_receipts_reserve)
 *   3. lease the pool, build ONE transfer (pool tokens + the settlement's gas output → recipient, rest → pool),
 *      record its txid, broadcast, book the pool's new coin
 * A row already 'sent' returns at once; a row 'sending' whose transfer reached the chain is booked, not resent.
 */
import { P2PKH, SatoshisPerKilobyte, Script, Transaction, type PrivateKey } from '@bsv/sdk';
import { RECEIPT_GAS, RECEIPT_TOP_SATS, TERRORNODE_ID, readSettlement } from './receipts';
import type { SplitQuote } from './split';
import { tokenOut } from './shape';

export type ReceiptRow = { session_txid: string; recipient: string; first_n: number | string; count: number | string; status: 'reserved' | 'sending' | 'sent'; transfer_txid: string | null; owed_sats?: number | string };
export type PoolRow = { slot: string; token_address: string; token_utxo: string | null; token_amt: number | string; beef: string | null };

export type Deps = {
  txHex(txid: string): Promise<string | null>;
  toleranceBps: number;
  get(txid: string): Promise<ReceiptRow | null>;
  reserve(a: { txid: string; recipient: string; handle: string; count: number; paid: bigint; penny: bigint; tol: number }): Promise<ReceiptRow>;
  lease(lease: string): Promise<PoolRow | null>;
  release(lease: string): Promise<void>;
  sending(txid: string, transfer: string): Promise<void>;
  sent(a: { txid: string; lease: string; transfer: string; tokenUtxo: string | null; tokenAmt: bigint; beef: string }): Promise<void>;
  spentBy(outpoint: string): Promise<string | null>;
  broadcast(tx: Transaction): Promise<string>;
  poolKey(slot: string): PrivateKey;
  /** BEEF hex → the pool token coin's source tx. */
  poolSource(beefHex: string, txid: string): Transaction | null;
  mergeBeef(beefHex: string, tx: Transaction): string;
  newLease(): string;
  /** Credit the split to the companies' wallets (payees.ts notifySplit). */
  notify(txHex: string, q: SplitQuote, total: number): Promise<{ ok: true } | { ok: false; why: string; retry: boolean }>;
  /** Still honour settlements paid to the pre-split creator address (a short grace for queued deliveries). */
  legacyOk: boolean;
  /**
   * 0-conf guard (28 Oct audit): a settlement for more than `instantMax` receipts is only paid once it has
   * ≥1 confirmation (a double-spent settlement can no longer take a large batch). Omitted: no wait.
   */
  instantMax?: number;
  confirmations?(txid: string): Promise<number | null>;
  /** Daily token outflow cap: tokens sent in the last 24 h, and the cap. Omitted: no cap. */
  dailyCap?: { sentToday(): number; cap: number; add(n: number): void };
};

export type SettleResult = { ok: true; count: number; first: number; recipient: string; transfer: string } | { ok: false; why: string; status?: number };

export async function settleReceipts(txid: string, gasAddress: string, d: Deps): Promise<SettleResult> {
  if (!/^[0-9a-f]{64}$/.test(txid)) return { ok: false, why: 'Bad txid.', status: 400 };
  let row = await d.get(txid);
  let settleTx: Transaction | null = null;
  if (!row) {
    const hex = await d.txHex(txid);
    if (!hex) return { ok: false, why: 'The settlement transaction is not on the network yet. Try again shortly.', status: 202 };
    settleTx = Transaction.fromHex(hex.trim());
    if (settleTx.id('hex') !== txid) return { ok: false, why: 'The chain returned a different transaction.', status: 502 };
    const st = readSettlement(settleTx, gasAddress);
    if (!st) return { ok: false, why: 'That transaction is not a TERRORNODE receipt settlement.', status: 400 };
    if (st.splitError) return { ok: false, why: st.splitError, status: 402 };
    if (!st.split && !d.legacyOk) return { ok: false, why: 'Receipt money must be split between NPG Ltd and bCorp; this settlement is not.', status: 402 };
    if (st.split) {
      const n = await d.notify(hex.trim(), st.split, Number(st.paid));
      if (!n.ok) return { ok: false, why: n.why, status: n.retry ? 202 : 402 };
    }
    if (st.gas < BigInt(RECEIPT_GAS)) return { ok: false, why: `Underpaid: the transfer gas is ${st.gas} sats, it needs ${RECEIPT_GAS}.`, status: 402 };
    const penny = RECEIPT_TOP_SATS; // fixed in sats: db/022 prices with the same closed form (p_penny = top price)
    try {
      row = await d.reserve({ txid, recipient: st.recipient, handle: st.handle, count: st.count, paid: st.paid, penny, tol: d.toleranceBps });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return { ok: false, why: m, status: /underpaid/i.test(m) ? 402 : /sold out/.test(m) ? 410 : 500 };
    }
  }
  const done = (r: ReceiptRow, transfer: string): SettleResult => ({ ok: true, count: Number(r.count), first: Number(r.first_n), recipient: r.recipient, transfer });
  if (row.status === 'sent' && row.transfer_txid) return done(row, row.transfer_txid);

  const n = Number(row.count);
  const resend = row.status === 'sending' && !!row.transfer_txid; // may only need booking: never blocked
  if (!resend && d.instantMax != null && d.confirmations && n > d.instantMax) {
    const conf = await d.confirmations(txid).catch(() => null);
    if (!conf || conf < 1)
      return { ok: false, why: `${n.toLocaleString('en-US')} receipts are sent once the settlement has 1 confirmation (about 10 minutes). They are reserved for you.`, status: 202 };
  }
  if (!resend && d.dailyCap && d.dailyCap.sentToday() + n > d.dailyCap.cap)
    return { ok: false, why: 'TERRORNODE receipts have hit today’s limit. Yours are reserved and will be sent later; try again tomorrow.', status: 503 };

  const lease = d.newLease();
  const pool = await d.lease(lease);
  if (!pool) return { ok: false, why: 'The pool is busy. Try again in a moment.', status: 409 };
  let broadcasted = false;
  try {
    if (!pool.token_utxo || !pool.beef) throw new Error('The pool has no token coin.');
    // A previous attempt recorded a transfer: if it spent the pool coin, book it instead of sending again.
    if (row.status === 'sending' && row.transfer_txid) {
      const by = await d.spentBy(pool.token_utxo);
      if (by === row.transfer_txid) {
        const hex = await d.txHex(by);
        if (!hex) throw new Error('The transfer is on the network but could not be read yet.');
        const t = Transaction.fromHex(hex.trim());
        const rest = t.outputs.length > 2 ? BigInt(pool.token_amt) - BigInt(row.count) : BigInt(0);
        broadcasted = true;
        await d.sent({ txid, lease, transfer: by, tokenUtxo: rest > BigInt(0) ? `${by}_1` : null, tokenAmt: rest, beef: d.mergeBeef(pool.beef, t) });
        return done(row, by);
      }
    }
    const count = BigInt(row.count);
    const have = BigInt(pool.token_amt);
    if (have < count) throw new Error('The pool is out of TERRORNODE.');
    if (!settleTx) {
      const hex = await d.txHex(txid);
      if (!hex) throw new Error('The settlement transaction could not be read.');
      settleTx = Transaction.fromHex(hex.trim());
    }
    const gasLock = new P2PKH().lock(gasAddress).toHex();
    const gasVout = settleTx.outputs.findIndex((o) => o.lockingScript.toHex() === gasLock);
    if (gasVout < 0) throw new Error('The settlement has no gas output.');
    const [ptx, pvout] = pool.token_utxo.split('_');
    const src = d.poolSource(pool.beef, ptx);
    if (!src) throw new Error('The pool history is missing its token coin.');
    const key = d.poolKey(pool.slot);
    const tx = new Transaction();
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: Number(pvout), unlockingScriptTemplate: new P2PKH().unlock(key) });
    tx.addInput({ sourceTransaction: settleTx, sourceOutputIndex: gasVout, unlockingScriptTemplate: new P2PKH().unlock(key) });
    tx.addOutput({ lockingScript: Script.fromHex(tokenOut(TERRORNODE_ID, count, row.recipient)), satoshis: 1 });
    const rest = have - count;
    if (rest > BigInt(0)) tx.addOutput({ lockingScript: Script.fromHex(tokenOut(TERRORNODE_ID, rest, pool.token_address)), satoshis: 1 });
    tx.addOutput({ lockingScript: new P2PKH().lock(pool.token_address), change: true });
    // ⚠ FEE BY SIZE (25 Oct 2026): a flat 50 sats was under ARC's 100 sat/kB once the transfer passed ~500 bytes,
    // so the network refused it ('Fees are insufficient') and the receipt stuck at 'sending'. Still paid from the
    // 300-sat gas; the change stays at the pool address.
    await tx.fee(new SatoshisPerKilobyte(110));
    await tx.sign();
    const transfer = tx.id('hex');
    await d.sending(txid, transfer);
    await d.broadcast(tx);
    broadcasted = true;
    d.dailyCap?.add(n);
    await d.sent({ txid, lease, transfer, tokenUtxo: rest > BigInt(0) ? `${transfer}_1` : null, tokenAmt: rest, beef: d.mergeBeef(pool.beef, tx) });
    return done(row, transfer);
  } catch (e) {
    // Before a broadcast nothing moved: free the pool. After it, keep the lease so nothing builds on spent coins.
    if (!broadcasted) await d.release(lease).catch(() => undefined);
    return { ok: false, why: e instanceof Error ? e.message : String(e), status: 500 };
  }
}
