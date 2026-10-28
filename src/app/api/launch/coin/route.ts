/**
 * One coin: its ledger row, and a proof of reserves (what the curve owes vs what the ledger says
 * vs what the pool addresses hold on chain right now). Public.
 */
import { NextResponse } from 'next/server';
import { SUPPLY, poolSats } from '@/lib/launch/curve';
import { rpc } from '@/lib/launch/server';
import { withExtras } from '@/lib/launch/coinMeta';
import { receiptsIssued } from '@/lib/launch/receiptsIssued';
import { withLaunchedBy } from '@/lib/launch/launchedBy';
import { NO_TRADE } from '@/lib/launch/receipts';
import { expectedReserves } from '@/lib/launch/reserves';

export const dynamic = 'force-dynamic';
type Row = { token_id: string; creator: string; creator_key: string; launch_paymail?: string | null; sold: number; reserve_sats: number; token_amt: number; reserve_address: string; token_address: string; burned: number };

async function onChain(row: Row) {
  const [bsv, tok] = await Promise.all([
    // Sum the unspent coins (mempool included): WhatsOnChain's /balance lags fresh, unconfirmed trades.
    fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${row.reserve_address}/unspent/all`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { result?: { value: number; isSpentInMempoolTx?: boolean }[] } | null) =>
        j?.result ? j.result.filter((u) => !u.isSpentInMempoolTx).reduce((n, u) => n + u.value, 0) : null,
      )
      .catch(() => null),
    fetch(`https://ordinals.gorillapool.io/api/bsv20/${row.token_address}/id/${row.token_id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      // The pool's unspent coins of this token; only validated ones (status 1) count.
      .then((j: { amt: string | number; status: number; spend?: string }[] | null) =>
        Array.isArray(j) ? j.filter((c) => c.status === 1 && !c.spend).reduce((n, c) => n + Number(c.amt), 0) : null,
      )
      .catch(() => null),
  ]);
  return { bsv, tokens: tok, checkedAt: Date.now() };
}

/**
 * Addresses holding the token on chain (GorillaPool's BSV-21 holders index), not counting the coin's own pool.
 * Covers curve buyers and players who hold receipts alike. null when the index doesn't answer.
 */
async function chainHolders(row: Row): Promise<number | null> {
  return fetch(`https://ordinals.gorillapool.io/api/bsv20/id/${row.token_id}/holders?limit=1000`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ address: string; amt: string }[]>) : null))
    .then((j) => (Array.isArray(j) ? j.filter((h) => h.address !== row.token_address && Number(h.amt) > 0).length : null))
    .catch(() => null);
}

/** Has GorillaPool indexed ("included") the token? Until it has, sells can't be verified. */
async function indexed(tokenId: string): Promise<boolean | null> {
  return fetch(`https://ordinals.gorillapool.io/api/bsv20/id/${tokenId}`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ included?: boolean }>) : null))
    .then((j) => (j ? Boolean(j.included) : null))
    .catch(() => null);
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[0-9a-f]{64}_\d+$/.test(token)) return NextResponse.json({ error: 'Bad coin id.' }, { status: 400 });
  try {
    const [row] = await rpc<Row[]>('tokenblaster_launch_coin', { p_token: token }, false);
    if (!row) return NextResponse.json({ error: 'No such coin on TokenBlaster.' }, { status: 404 });
    const sold = BigInt(row.sold);
    const ledger = { bsv: Number(row.reserve_sats), tokens: Number(row.token_amt) };
    const [chain, isIndexed, issued, holders] = await Promise.all([onChain(row), indexed(token), receiptsIssued(), chainHolders(row)]);
    // Receipts paid to players left the pool too (db/022 ledger). Unknown (null) counts as 0, so it can only alarm, never hide one.
    const receipts = NO_TRADE.has(token) ? { tokens: issued ?? 0 } : null;
    const expected = expectedReserves(Number(SUPPLY), Number(sold), Number(poolSats(sold)), receipts?.tokens ?? 0);
    return NextResponse.json({ coin: withLaunchedBy(withExtras(row, issued)), indexed: isIndexed, holders, reserves: { expected, ledger, chain, receipts } }, { headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
