import { corsHeaders, gameTags, parseQuery, toItem, type BlastRow } from '@/lib/blastsRecent';

/**
 * GET /api/blasts/recent?limit=50&game=<tag>&since=<ISO|ms>&before=<ISO|ms>
 *   → { items: [{ txid, game, ammo, n, player, seenAt, blockHeight }], next? }
 * Public, read-only feed of blasts seen on chain, newest first by seenAt (bChatX /feed "Live" tab).
 * `since` is for incremental polling; `next` (when present) is the `before` value for the next older page.
 */
const CACHE = 'public, s-maxage=5, stale-while-revalidate=30';

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(request.headers.get('origin')), 'Access-Control-Max-Age': '86400' } });
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get('origin'));
  const q = parseQuery(new URL(request.url).searchParams);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: 'not configured' }, { status: 502, headers: cors });
  try {
    const r = await fetch(`${url}/rest/v1/rpc/tokenblaster_recent`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: q.since, before: q.before, games: gameTags(q.game), max_rows: q.limit }),
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(String(r.status));
    const items = ((await r.json()) as BlastRow[]).map(toItem);
    const next = items.length === q.limit ? items[items.length - 1].seenAt : undefined;
    return Response.json(next ? { items, next } : { items }, { headers: { ...cors, 'Cache-Control': CACHE } });
  } catch {
    return Response.json({ error: 'Blasts unavailable' }, { status: 502, headers: cors });
  }
}
