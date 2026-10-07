/** The launchpad board: every live coin with its 24h numbers. Public. */
import { NextResponse } from 'next/server';
import { rpc } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';

/**
 * Coins kept off the board, the trade feed and wallet listings: TokenBlaster's own test coins. Their pages
 * still open by direct link (/launch/<id>) and they still trade, so nobody's coins are stuck.
 */
const HIDDEN = new Set(['342d637360569559810232fbbf9c4aea873e95c31d710396b0c9ac2e832ce628_1']); // $TBTEST
const shown = (rows: unknown[]) => rows.filter((r) => !HIDDEN.has((r as { token_id?: string }).token_id ?? ''));

export async function GET() {
  try {
    const [coins, feed] = await Promise.all([
      rpc<unknown[]>('tokenblaster_launch_board', {}, false),
      rpc<unknown[]>('tokenblaster_launch_trades_for', { p_limit: 40 }, false),
    ]);
    return NextResponse.json({ coins: shown(coins), feed: shown(feed) }, { headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10' } });
  } catch (e) {
    return NextResponse.json({ coins: [], feed: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
