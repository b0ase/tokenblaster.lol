/**
 * POST /api/gun/resync { candidates: [{ txid, vout, sats, spenders? }] } → { results } : the gun re-sync check
 * (src/lib/gunResync.ts). Server side because WhatsOnChain has no CORS header on its errors. Read only: no key, no
 * wallet, nothing broadcast. The browser clears only the outpoints answered `freed`.
 */
import { RESYNC_MAX, resyncCheck, type ResyncCandidate } from '@/lib/gunResync';

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { candidates?: unknown } | null;
  const list = Array.isArray(body?.candidates) ? (body.candidates as ResyncCandidate[]).slice(0, RESYNC_MAX) : null;
  if (!list) return Response.json({ error: 'bad request' }, { status: 400 });
  const clean = list
    .filter((c) => c && typeof c.txid === 'string' && typeof c.vout === 'number' && typeof c.sats === 'number')
    .map((c) => ({ txid: c.txid, vout: c.vout, sats: c.sats, spenders: Array.isArray(c.spenders) ? c.spenders.filter((s) => typeof s === 'string').slice(0, 4) : [] }));
  const results = await resyncCheck(clean);
  return Response.json({ results }, { headers: { 'cache-control': 'no-store' } });
}
