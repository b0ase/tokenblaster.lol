import { createHash } from 'node:crypto';
import { cleanName, isScoreGame, isScorePeriod, SCORE_GAMES, submitScore, topScores, verifyRunTx } from '@/lib/scores';

/** GET /api/scores?game=hopper&period=24h|7d|all&limit=10&sort=score|time → { game, period, scores } */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const game = q.get('game');
  if (!isScoreGame(game)) return Response.json({ error: 'Unknown game' }, { status: 400 });
  const p = q.get('period');
  const period = isScorePeriod(p) ? p : 'all';
  const limit = Math.min(50, Math.max(1, Number(q.get('limit')) || 10));
  const sort = q.get('sort') === 'time' ? 'time' : 'score';
  try {
    return Response.json({ game, period, sort, scores: await topScores(game, period, limit, sort) });
  } catch {
    return Response.json({ game, period, error: 'Scores unavailable' }, { status: 502 });
  }
}

// Per-IP limit in memory (per server instance): 5 submits a minute.
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

/** POST /api/scores { game, mode: 'practice'|'live', name, score, secs, meta?, txid? } */
export async function POST(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  if (limited(ip)) return bad('Too many submissions, try again in a minute', 429);
  if (Number(request.headers.get('content-length') ?? 0) > 2000) return bad('Too large', 413);
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2000) return bad('Too large', 413);
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
  } catch {
    return bad('Bad JSON');
  }
  const { game, mode, name, score, secs, meta, txid } = body;
  if (typeof game !== 'string' || !isScoreGame(game)) return bad('Unknown game');
  if (mode !== 'practice' && mode !== 'live') return bad('Bad mode');
  if (typeof name !== 'string' || name.length > 32 || !cleanName(name)) return bad('Bad name');
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 1e9) return bad('Bad score');
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0 || secs > 6 * 3600) return bad('Bad time');
  let m: Record<string, unknown> = {};
  if (meta !== undefined) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return bad('Bad meta');
    m = Object.fromEntries(
      Object.entries(meta as Record<string, unknown>)
        .slice(0, 8)
        .filter(([k, v]) => /^[a-z0-9_]{1,16}$/i.test(k) && ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 32))),
    );
  }
  let tx: string | null = null;
  if (txid !== undefined && txid !== null && txid !== '') {
    if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) return bad('Bad txid');
    tx = txid.toLowerCase();
  }
  if (mode === 'practice') tx = null;
  const verified = mode === 'live' && tx ? await verifyRunTx(tx, SCORE_GAMES[game].tag) : false;
  const ipHash = createHash('sha256').update(`tokenblaster-scores:${ip}`).digest('hex').slice(0, 32);
  try {
    const r = await submitScore({ game, mode, name: cleanName(name), score, secs, meta: m, txid: verified ? tx : null, verified, ipHash });
    if (!r.ok) return bad(r.error ?? 'Rejected', r.error === 'rate limited' ? 429 : 400);
    return Response.json({ ok: true, id: Number(r.id), verified });
  } catch {
    return bad('Scores unavailable', 502);
  }
}
