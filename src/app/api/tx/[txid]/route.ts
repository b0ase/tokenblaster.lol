/**
 * GET /api/tx/<txid> → the transaction's hex (text). Server-side WhatsOnChain so the browser never calls it (its
 * errors carry no CORS header). A txid's bytes never change: cached here and immutable at the edge.
 */
import { txHexCached } from '@/lib/wocServer';

export async function GET(_req: Request, ctx: { params: Promise<{ txid: string }> }) {
  const { txid } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(txid)) return new Response('bad txid', { status: 400 });
  try {
    const hex = await txHexCached(txid);
    return new Response(hex, { headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=31536000, immutable' } });
  } catch {
    return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}
