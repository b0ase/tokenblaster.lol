/** GET /api/price → { bsvUsd } (WhatsOnChain, falling back to Coinbase and CoinGecko). */
import { bsvUsd } from '@/lib/price';

export async function GET() {
  const rate = await bsvUsd();
  if (!rate) return Response.json({ error: 'Price unavailable' }, { status: 502 });
  return Response.json({ bsvUsd: rate }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
