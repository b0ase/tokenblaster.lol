import { createHash } from 'node:crypto';
import { cleanHandle } from '@/lib/identity';
import { cleanName, verifyRunTx } from '@/lib/scores';
import { checkProof } from '@/lib/xproof';

/**
 * POST /api/txlog { game, txs, txid, secs?, name?, x?, xp? } records how many LIVE transactions a player put on chain in one run,
 * for the hall of fame's "most transactions" board (db/019).
 *
 * Trust: the run's last tx must exist on chain carrying OP_RETURN "tokenblaster.lol" <token> <n> <game> for this game
 * (verifyRunTx, like /api/scores) and can count once (unique txid in the database). The count itself is the client's word, so it is
 * capped by what a run can plausibly send (500 + 60 per second of play) and only verified runs are ranked. The player is the X handle
 * when given (with xp: a bWalletX signature over this txid, which earns the identity tick), else the score name.
 * Gated like scores: only this server, holding SCORES_SECRET, can mark a row verified.
 */

const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= 60_000)) hits.delete(k);
  return recent.length > 5;
}

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  if (limited(ip)) return bad('Too many reports, try again in a minute', 429);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2000) return bad('Too large', 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return bad('Bad JSON');
  }
  const { game, txs, txid, secs, name } = body;
  if (typeof game !== 'string' || !/^[a-z0-9-]{1,16}$/.test(game)) return bad('Bad game');
  if (typeof txs !== 'number' || !Number.isInteger(txs) || txs < 1 || txs > 100_000) return bad('Bad count');
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) return bad('Bad txid');
  const run = secs === undefined ? 0 : secs;
  if (typeof run !== 'number' || !Number.isFinite(run) || run < 0 || run > 6 * 3600) return bad('Bad time');
  if (txs > 500 + 60 * run) return bad('Implausible count');
  const handle = cleanHandle(body.x);
  const player = handle ? `@${handle}` : typeof name === 'string' ? cleanName(name) : '';
  if (!player) return bad('Bad player');
  const id = txid.toLowerCase();
  if (!(await verifyRunTx(id, game))) return bad('Transaction not found on chain for this game', 422);
  const idv = handle ? await checkProof(handle, body.xp, 'tx', game, id) : false;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return bad('Not configured', 502);
  try {
    const r = await fetch(`${url}/rest/v1/rpc/tokenblaster_record_txs`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_game: game,
        p_player: player,
        p_txs: txs,
        p_txid: id,
        p_verified: true,
        p_idv: idv,
        p_ip_hash: createHash('sha256').update(`tokenblaster-txlog:${ip}`).digest('hex').slice(0, 32),
        p_secret: process.env.SCORES_SECRET ?? null, // without it, rows are stored but never ranked
      }),
      cache: 'no-store',
    });
    if (!r.ok) return bad('Tx log unavailable', 502);
    const rows = (await r.json()) as { ok: boolean; error: string | null }[];
    const row = rows[0];
    if (!row?.ok) return bad(row?.error ?? 'Rejected', row?.error === 'rate limited' ? 429 : 400);
    return Response.json({ ok: true, idv });
  } catch {
    return bad('Tx log unavailable', 502);
  }
}
