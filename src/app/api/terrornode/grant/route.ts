/**
 * One owner-approved $TERRORNODE grant out of the receipt pool (db/026_terrornode_grant.sql).
 *   POST { gasTxid, to? }  (Authorization: Bearer <LAUNCH_SECRET>)
 * `to` is fixed to the airdrop wallet GRANT_TO (src/lib/terrornodeGrant.ts); a body `to` that differs is refused.
 * Only one purpose exists: the Twetch airdrop (27 Oct 2026), a fixed 1,286,000 TERRORNODE to GRANT_TO. The fees come from
 * `gasTxid`, a tx that paid the pool's gas address (the pool token address) at least GAS_MIN sats: it covers the
 * GorillaPool index fee (1,000 sats per token output) and the network fee; the change goes back to the gas address.
 * Idempotent: once the purpose is booked it returns the booked transfer and never sends again.
 * The pool key never leaves the server.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { Beef, P2PKH, SatoshisPerKilobyte, Script, Transaction } from '@bsv/sdk';
import { INDEX_FEE } from '@/lib/launch/curve';
import { TERRORNODE_ID, isAddress } from '@/lib/launch/receipts';
import { broadcast, configured, fundAddressOf, poolKey, rpc } from '@/lib/launch/server';
import { tokenOut } from '@/lib/launch/shape';
import { grantDestination } from '@/lib/terrornodeGrant';

export const dynamic = 'force-dynamic';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const PURPOSE = 'twetch-airdrop-2026-10-27';
const AMOUNT = BigInt(1_286_000);
const GAS_MIN = 2 * INDEX_FEE + 500;
const LEASE_SECS = 300;

type Pool = { slot: string; token_address: string; fund_address: string | null; token_utxo: string | null; token_amt: number | string; beef: string | null };
type Grant = { purpose: string; txid: string; to_address: string; amount: number | string };

function authorised(req: Request) {
  const want = process.env.LAUNCH_SECRET ?? '';
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: 'The launchpad is not configured.' }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  let to: string | null = null;
  let gasTxid = '';
  try {
    const b = (await req.json()) as { to?: unknown; gasTxid?: unknown };
    to = grantDestination(b.to);
    gasTxid = String(b.gasTxid ?? '');
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  if (!to || !isAddress(to)) return NextResponse.json({ error: 'The grant only pays the airdrop wallet.' }, { status: 400 });
  if (!/^[0-9a-f]{64}$/.test(gasTxid)) return NextResponse.json({ error: 'Bad gasTxid.' }, { status: 400 });

  const [booked] = await rpc<Grant[]>('tokenblaster_grant_get', { p_purpose: PURPOSE });
  if (booked) return NextResponse.json({ ok: true, already: true, purpose: PURPOSE, transfer: booked.txid, to: booked.to_address, amount: Number(booked.amount) });

  const gasHex = await fetch(`${WOC}/tx/${gasTxid}/hex`, { cache: 'no-store' }).then((x) => (x.ok ? x.text() : null)).catch(() => null);
  if (!gasHex) return NextResponse.json({ error: 'The gas transaction is not on the network yet.' }, { status: 202 });
  const gasTx = Transaction.fromHex(gasHex.trim());
  if (gasTx.id('hex') !== gasTxid) return NextResponse.json({ error: 'The chain returned a different transaction.' }, { status: 502 });

  const lease = crypto.randomUUID();
  const [pool] = await rpc<Pool[]>('tokenblaster_launch_lease', { p_token: TERRORNODE_ID, p_lease: lease, p_secs: LEASE_SECS });
  if (!pool) return NextResponse.json({ error: 'The pool is busy. Try again in a moment.' }, { status: 409 });
  let transfer = '';
  try {
    if (!pool.token_utxo || !pool.beef) throw new Error('The pool has no token coin.');
    const have = BigInt(pool.token_amt);
    if (have <= AMOUNT) throw new Error('The pool does not hold enough TERRORNODE.');
    const gasLock = new P2PKH().lock(pool.token_address).toHex();
    const gasVout = gasTx.outputs.findIndex((o) => o.lockingScript.toHex() === gasLock && (o.satoshis ?? 0) >= GAS_MIN);
    if (gasVout < 0) throw new Error(`The gas transaction must pay the pool gas address ${pool.token_address} at least ${GAS_MIN} sats.`);
    const fund = pool.fund_address ?? (await fundAddressOf(TERRORNODE_ID));
    if (!fund) throw new Error('The token index fund address is unknown.');
    const [ptx, pvout] = pool.token_utxo.split('_');
    const beef = Beef.fromString(pool.beef, 'hex');
    const src = beef.findTxid(ptx)?.tx;
    if (!src) throw new Error('The pool history is missing its token coin.');
    const key = poolKey(pool.slot, 'token');
    const tx = new Transaction();
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: Number(pvout), unlockingScriptTemplate: new P2PKH().unlock(key) });
    tx.addInput({ sourceTransaction: gasTx, sourceOutputIndex: gasVout, unlockingScriptTemplate: new P2PKH().unlock(key) });
    tx.addOutput({ lockingScript: Script.fromHex(tokenOut(TERRORNODE_ID, AMOUNT, to)), satoshis: 1 });
    tx.addOutput({ lockingScript: Script.fromHex(tokenOut(TERRORNODE_ID, have - AMOUNT, pool.token_address)), satoshis: 1 });
    tx.addOutput({ lockingScript: new P2PKH().lock(fund), satoshis: 2 * INDEX_FEE });
    tx.addOutput({ lockingScript: new P2PKH().lock(pool.token_address), change: true });
    await tx.fee(new SatoshisPerKilobyte(110));
    await tx.sign();
    transfer = tx.id('hex');
    await broadcast(tx);
    beef.mergeTransaction(tx);
    await rpc('tokenblaster_receipts_grant', {
      p_lease: lease, p_purpose: PURPOSE, p_transfer_txid: transfer, p_token_utxo: `${transfer}_1`, p_token_amt: Number(have - AMOUNT),
      p_beef: beef.toHex(), p_amount: Number(AMOUNT), p_to: to,
    });
    return NextResponse.json({ ok: true, purpose: PURPOSE, transfer, to, amount: Number(AMOUNT) });
  } catch (e) {
    // Before a broadcast nothing moved: free the pool. After it, keep the lease and report the transfer to book by hand.
    if (!transfer) await rpc('tokenblaster_launch_release', { p_lease: lease }).catch(() => undefined);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), transfer: transfer || null, lease }, { status: 500 });
  }
}
