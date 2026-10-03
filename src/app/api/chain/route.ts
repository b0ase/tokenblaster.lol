import { chainStats } from '@/lib/chain';

/** GET /api/chain → { height, hash, blockTime, at } from GorillaPool (not cached: live data). */
export async function GET() {
  try {
    return Response.json(await chainStats());
  } catch {
    return Response.json({ error: 'Chain data unavailable' }, { status: 502 });
  }
}
