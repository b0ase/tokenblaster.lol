/**
 * $TERRORNODE receipts (src/lib/launch/receipts.ts, receiptsFlow.ts, db/022_terrornode_receipts.sql).
 *   GET                 → { issued, topSats, pennySats (= topSats, kept for old clients), nextPriceSats, graduateAt,
 *                           graduated, soldOut, payees, split, gasAddress, gasSats, live }
 *                         (receipt money is split 50/50 NPG Ltd / bCorp: the gun gets destinations from /api/terrornode/split)
 *   POST { txid }       → verify the session's settlement tx on chain, reserve its receipt range (idempotent per
 *                         txid), send that many TERRORNODE from the pool to the recipient in ONE transfer.
 * Off until RECEIPTS_LIVE=1 and the launchpad is configured (LAUNCH_SECRET, LAUNCH_POOL_WIF, Supabase). The pool key
 * never leaves the server; the ledger functions are LAUNCH_SECRET-gated.
 */
import { NextResponse } from 'next/server';
import { Beef, Transaction } from '@bsv/sdk';
import { GRADUATE_AT, RECEIPT_GAS, RECEIPT_SUPPLY, RECEIPT_TOP_SATS, TERRORNODE_ID, priceSats, soldOut } from '@/lib/launch/receipts';
import { settleReceipts, type PoolRow, type ReceiptRow } from '@/lib/launch/receiptsFlow';
import { notifySplit } from '@/lib/launch/payees';
import { PAYEES, SPLIT_LINE } from '@/lib/launch/split';
import { broadcast, configured, poolKey, rpc, spentBy } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const LEASE_SECS = 90;
const live = () => configured() && process.env.RECEIPTS_LIVE === '1';
/** Settlements paid to the pre-split creator address are still delivered until then (already-paid, queued ones). */
const LEGACY_UNTIL = Date.parse('2026-11-03T00:00:00Z');
const TOL = Math.max(0, Math.min(1000, Number(process.env.RECEIPTS_TOLERANCE_BPS ?? 300) || 0));

async function pool() {
  const [row] = await rpc<(PoolRow & { token_id: string })[]>('tokenblaster_launch_coin', { p_token: TERRORNODE_ID }, false);
  return row ?? null;
}

export async function GET() {
  try {
    const [issued, p] = await Promise.all([
      rpc<number>('tokenblaster_receipts_issued', { p_token: TERRORNODE_ID }, false).catch(() => 0),
      pool().catch(() => null),
    ]);
    const n = BigInt(issued ?? 0);
    const out = soldOut(n);
    const top = Number(RECEIPT_TOP_SATS);
    return NextResponse.json(
      { live: live() && !!p && !out, issued: Number(n), supply: Number(RECEIPT_SUPPLY), topSats: top, pennySats: top, nextPriceSats: out ? null : Number(priceSats(n + BigInt(1))), graduateAt: GRADUATE_AT, graduated: Number(n) >= GRADUATE_AT, soldOut: out, payees: PAYEES.map((p) => ({ name: p.name, paymail: p.paymail, share: 0.5 })), split: SPLIT_LINE, gasAddress: p?.token_address ?? null, gasSats: RECEIPT_GAS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json({ live: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}

export async function POST(req: Request) {
  if (!live()) return NextResponse.json({ error: 'TERRORNODE receipts are not switched on yet.' }, { status: 503 });
  let txid = '';
  try {
    txid = String(((await req.json()) as { txid?: unknown }).txid ?? '');
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const p = await pool().catch(() => null);
  if (!p) return NextResponse.json({ error: 'The TERRORNODE pool is not on the ledger.' }, { status: 503 });
  const r = await settleReceipts(txid, p.token_address, {
    toleranceBps: TOL,
    txHex: (id) => fetch(`${WOC}/tx/${id}/hex`, { cache: 'no-store' }).then((x) => (x.ok ? x.text() : null)).catch(() => null),
    get: async (id) => (await rpc<ReceiptRow[]>('tokenblaster_receipts_get', { p_txid: id }))[0] ?? null,
    reserve: async (a) =>
      (await rpc<ReceiptRow[]>('tokenblaster_receipts_reserve', { p_txid: a.txid, p_token: TERRORNODE_ID, p_recipient: a.recipient, p_handle: a.handle, p_count: a.count, p_paid: Number(a.paid), p_penny: Number(a.penny), p_tol_bps: a.tol }))[0],
    lease: async (lease) => (await rpc<PoolRow[]>('tokenblaster_launch_lease', { p_token: TERRORNODE_ID, p_lease: lease, p_secs: LEASE_SECS }))[0] ?? null,
    release: (lease) => rpc('tokenblaster_launch_release', { p_lease: lease }),
    sending: (id, transfer) => rpc('tokenblaster_receipts_sending', { p_txid: id, p_transfer: transfer }),
    sent: (a) => rpc('tokenblaster_receipts_sent', { p_txid: a.txid, p_lease: a.lease, p_transfer: a.transfer, p_token_utxo: a.tokenUtxo, p_token_amt: Number(a.tokenAmt), p_beef: a.beef }),
    spentBy,
    broadcast,
    poolKey: (slot) => poolKey(slot, 'token'),
    poolSource: (beefHex, id) => Beef.fromString(beefHex, 'hex').findTxid(id)?.tx ?? null,
    mergeBeef: (beefHex, tx: Transaction) => {
      const b = Beef.fromString(beefHex, 'hex');
      b.mergeTransaction(tx);
      return b.toHex();
    },
    newLease: () => crypto.randomUUID(),
    notify: (hex, q, total) => notifySplit(hex, q, total),
    legacyOk: Date.now() < LEGACY_UNTIL,
  });
  if (!r.ok) return NextResponse.json({ error: r.why }, { status: r.status ?? 500 });
  return NextResponse.json(r);
}
