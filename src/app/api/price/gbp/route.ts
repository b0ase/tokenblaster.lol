/** GET /api/price/gbp → { bsvGbp } (Coinbase, then CoinGecko, then BSV/USD × USD/GBP). Used by the arcade coin slot. */
import { bsvGbp } from '@/lib/price';

export async function GET() {
  const rate = await bsvGbp();
  if (!rate) return Response.json({ error: 'Price unavailable' }, { status: 502 });
  return Response.json({ bsvGbp: rate }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
