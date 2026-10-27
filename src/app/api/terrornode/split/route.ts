/**
 * Escape from TERRORNODE revenue destinations (src/lib/launch/split.ts, payees.ts): 50/50 NPG Ltd · bCorp.
 *   GET ?check=1   → { ok, split } : the paymail capabilities answer and both identity keys match the pinned ones
 *                    (no destination is used up). The cabinet asks before a paid session; not ok → no paid play.
 *   GET            → { ok, quote: { npg, bcorp } } : fresh one-time destinations, each re-derived from its pinned key.
 *   POST { txid, quote } → for a payment made outside the receipts settlement (the platform fee on rounds): checks
 *                    the tx on chain pays exactly 50/50 to the pinned quote, then credits each company's wallet.
 *                    Idempotent: the paymail server answers "already received" for the same txid.
 * 503 { ok: false, error: 'payments temporarily unavailable' } whenever a destination can't be resolved and pinned.
 */
import { NextResponse } from 'next/server';
import { Transaction } from '@bsv/sdk';
import { checkPayees, notifySplit, resolveSplit } from '@/lib/launch/payees';
import { SPLIT_LINE, readSplit } from '@/lib/launch/split';

export const dynamic = 'force-dynamic';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const NO_STORE = { 'Cache-Control': 'no-store' };
const unavailable = (why: string) => {
  console.warn('[terrornode-split] unavailable:', why);
  return NextResponse.json({ ok: false, error: 'Payments temporarily unavailable.', why }, { status: 503, headers: NO_STORE });
};

export async function GET(req: Request) {
  const check = new URL(req.url).searchParams.get('check') === '1';
  try {
    if (check) {
      await checkPayees();
      return NextResponse.json({ ok: true, split: SPLIT_LINE }, { headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, split: SPLIT_LINE, quote: await resolveSplit() }, { headers: NO_STORE });
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e));
  }
}

export async function POST(req: Request) {
  let body: { txid?: unknown; quote?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request.' }, { status: 400 });
  }
  const txid = String(body.txid ?? '');
  if (!/^[0-9a-f]{64}$/.test(txid)) return NextResponse.json({ ok: false, error: 'Bad txid.' }, { status: 400 });
  const hex = await fetch(`${WOC}/tx/${txid}/hex`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (!hex) return NextResponse.json({ ok: false, error: 'The transaction is not on the network yet.' }, { status: 202 });
  let tx: Transaction;
  try {
    tx = Transaction.fromHex(hex.trim());
  } catch {
    return NextResponse.json({ ok: false, error: 'Unreadable transaction.' }, { status: 502 });
  }
  if (tx.id('hex') !== txid) return NextResponse.json({ ok: false, error: 'The chain returned a different transaction.' }, { status: 502 });
  const r = readSplit(tx, body.quote);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.why }, { status: 402 });
  const n = await notifySplit(hex.trim(), body.quote as Parameters<typeof notifySplit>[1], Number(r.paid));
  if (!n.ok) return NextResponse.json({ ok: false, error: n.why }, { status: n.retry ? 202 : 402 });
  return NextResponse.json({ ok: true, txid, npg: r.npg, bcorp: r.bcorp });
}
