/** The launchpad board: every live coin with its 24h numbers. Public. */
import { NextResponse } from 'next/server';
import { rpc } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [coins, feed] = await Promise.all([
      rpc<unknown[]>('tokenblaster_launch_board', {}, false),
      rpc<unknown[]>('tokenblaster_launch_trades_for', { p_limit: 40 }, false),
    ]);
    return NextResponse.json({ coins, feed }, { headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10' } });
  } catch (e) {
    return NextResponse.json({ coins: [], feed: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
