import { isPeriod, topTokens } from '@/lib/leaderboard';

/** GET /api/leaderboard?period=24h|7d|30d|all → { period, tokens: [{ tokenId, ticker, icon, blasts }] } */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams.get('period');
  const period = isPeriod(p) ? p : '24h';
  return Response.json({ period, tokens: await topTokens(period) });
}
