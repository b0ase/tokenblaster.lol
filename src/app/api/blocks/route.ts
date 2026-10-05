import { recentBlocks } from '@/lib/blocks';

/**
 * GET /api/blocks → recent blocks (height, hash, miner, size, txs, fees, time), miner share over the
 * last ~144 blocks, and averages. Per-height results are cached in memory; CDN caches 30 s.
 */
export async function GET() {
  try {
    const data = await recentBlocks();
    return Response.json(data, { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=60' } });
  } catch {
    return Response.json({ error: 'Block data unavailable' }, { status: 502 });
  }
}
