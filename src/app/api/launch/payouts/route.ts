/** Every vault payout (split, holder credits, claims, buybacks), newest first. Public. */
import { NextResponse } from 'next/server';
import { rpc } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  try {
    const payouts = await rpc<unknown[]>('tokenblaster_launch_payouts_for', { p_token: token, p_limit: 200 }, false);
    return NextResponse.json({ payouts }, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } });
  } catch (e) {
    return NextResponse.json({ payouts: [], error: e instanceof Error ? e.message : String(e) });
  }
}
