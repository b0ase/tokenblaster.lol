/**
 * One coin: its ledger row, and a proof of reserves (what the curve owes vs what the ledger says
 * vs what the pool addresses hold on chain right now). Public.
 */
import { NextResponse } from 'next/server';
import { SUPPLY, poolSats } from '@/lib/launch/curve';
import { rpc } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';
type Row = { token_id: string; sold: number; reserve_sats: number; token_amt: number; reserve_address: string; token_address: string; burned: number };

async function onChain(row: Row) {
  const [bsv, tok] = await Promise.all([
    fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${row.reserve_address}/balance`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { confirmed: number; unconfirmed: number } | null) => (j ? j.confirmed + j.unconfirmed : null))
      .catch(() => null),
    fetch(`https://ordinals.gorillapool.io/api/bsv20/${row.token_address}/id/${row.token_id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { all?: { confirmed: string; pending: string } } | null) => (j?.all ? Number(j.all.confirmed) + Number(j.all.pending) : null))
      .catch(() => null),
  ]);
  return { bsv, tokens: tok, checkedAt: Date.now() };
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[0-9a-f]{64}_\d+$/.test(token)) return NextResponse.json({ error: 'Bad coin id.' }, { status: 400 });
  try {
    const [row] = await rpc<Row[]>('tokenblaster_launch_coin', { p_token: token }, false);
    if (!row) return NextResponse.json({ error: 'No such coin on TokenBlaster.' }, { status: 404 });
    const sold = BigInt(row.sold);
    const expected = { bsv: Number(poolSats(sold)), tokens: Number(SUPPLY - sold) };
    const ledger = { bsv: Number(row.reserve_sats), tokens: Number(row.token_amt) };
    const chain = await onChain(row);
    return NextResponse.json({ coin: row, reserves: { expected, ledger, chain } }, { headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
