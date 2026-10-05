import { issuedOrdnance } from '@/lib/ordnanceIssued';

let cache: { at: number; data: Record<string, string[]> } | null = null;

/** GET /api/ordnance/issued → { issued: { [weaponId]: originOutpoint[] } } (verified store issues, cached 30s) */
export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), data: await issuedOrdnance() };
    return Response.json({ issued: cache.data }, { headers: { 'cache-control': 'public, max-age=15' } });
  } catch {
    if (cache) return Response.json({ issued: cache.data, stale: true });
    return Response.json({ error: 'Index unavailable' }, { status: 502 });
  }
}
