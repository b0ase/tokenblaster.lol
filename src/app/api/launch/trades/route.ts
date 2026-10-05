/** Trades, newest first: for one coin (?token=) or one wallet (?trader=). Public. */
import { NextResponse } from 'next/server';
import { rpc } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get('token');
  const trader = u.searchParams.get('trader');
  const limit = Math.min(1000, Number(u.searchParams.get('limit') ?? 200) || 200);
  try {
    const trades = await rpc<unknown[]>('tokenblaster_launch_trades_for', { p_token: token, p_trader: trader, p_limit: limit }, false);
    return NextResponse.json({ trades }, { headers: { 'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=10' } });
  } catch (e) {
    return NextResponse.json({ trades: [], error: e instanceof Error ? e.message : String(e) });
  }
}
