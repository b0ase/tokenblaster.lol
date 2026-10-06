/**
 * Arcade high scores: public.tokenblaster_scores on the Hetzner Supabase, written and read only
 * through the tokenblaster_submit_score / tokenblaster_top_scores functions (db/002_scores.sql).
 */
export const SCORE_GAMES = {
  hopper: { title: 'Block Hopper', tag: 'hopper', sort: 'score' },
  invaders: { title: 'Mempool Invaders', tag: 'invaders', sort: 'score' },
  snake: { title: 'Token Snake', tag: 'snake', sort: 'score' },
  kweg: { title: "Kweg's Expedition", tag: 'kweg', sort: 'score' },
  frogger: { title: 'Chain Frogger', tag: 'frogger', sort: 'score' },
  'doubleo-facility': { title: 'Double-O Satoshi · Facility', tag: 'doubleo', sort: 'score' },
  'doubleo-tower': { title: 'Double-O Satoshi · Tower', tag: 'doubleo', sort: 'score' },
  'doubleo-vault': { title: 'Double-O Satoshi · Vault', tag: 'doubleo', sort: 'score' },
  'doubleo-farm': { title: 'Double-O Satoshi · Hash Farm', tag: 'doubleo', sort: 'score' },
  'doubleo-yacht': { title: 'Double-O Satoshi · Yacht', tag: 'doubleo', sort: 'score' },
  npgcards: { title: 'Ninja Punk Girls: Card Battle', tag: 'npgcards', sort: 'score' },
  npg: { title: 'Ninja Punk Girls: Erobot Uprising', tag: 'npg', sort: 'score' },
} as const;
export type ScoreGame = keyof typeof SCORE_GAMES;
export const isScoreGame = (g: string | null): g is ScoreGame => !!g && Object.prototype.hasOwnProperty.call(SCORE_GAMES, g);

export type ScorePeriod = '24h' | '7d' | 'all';
export const isScorePeriod = (p: string | null): p is ScorePeriod => p === '24h' || p === '7d' || p === 'all';
export type ScoreSort = 'score' | 'time';

export type ScoreRow = { id: number; name: string; score: number; secs: number; mode: 'practice' | 'live'; verified: boolean; txid: string | null; meta: Record<string, unknown>; created_at: string };

/** Letters, digits, space, _ . - only; max 16 chars. Same rule as the database. */
export const cleanName = (s: string) => s.replace(/[^A-Za-z0-9 _.\-]/g, '').trim().slice(0, 16);

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Scores database not configured');
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`${fn} failed: ${r.status}`);
  return (await r.json()) as T;
}

const HOURS: Record<ScorePeriod, number | null> = { '24h': 24, '7d': 24 * 7, all: null };

export async function topScores(game: ScoreGame, period: ScorePeriod, maxRows = 10, sort: ScoreSort = 'score'): Promise<ScoreRow[]> {
  const h = HOURS[period];
  const since = h ? new Date(Date.now() - h * 3600_000).toISOString() : null;
  const rows = await rpc<ScoreRow[]>('tokenblaster_top_scores', { p_game: game, since, max_rows: maxRows, sort });
  return rows.map((r) => ({ ...r, id: Number(r.id), score: Number(r.score), secs: Number(r.secs) }));
}

export async function submitScore(s: { game: ScoreGame; mode: 'practice' | 'live'; name: string; score: number; secs: number; meta: Record<string, unknown>; txid: string | null; verified: boolean; ipHash: string }) {
  const rows = await rpc<{ id: number | null; ok: boolean; error: string | null }[]>('tokenblaster_submit_score', {
    p_game: s.game,
    p_mode: s.mode,
    p_name: s.name,
    p_score: s.score,
    p_secs: s.secs,
    p_meta: s.meta,
    p_txid: s.txid,
    p_verified: s.verified,
    p_secret: process.env.SCORES_SECRET ?? null, // without it, runs are stored but never marked verified
    p_ip_hash: s.ipHash,
  });
  return rows[0] ?? { id: null, ok: false, error: 'no result' };
}

const TAG_HEX = Buffer.from('tokenblaster.lol').toString('hex');

/** Read the pushes of an OP_FALSE OP_RETURN script (hex). */
function pushes(script: string): string[] {
  const out: string[] = [];
  let i = 4; // after 00 6a
  while (i + 2 <= script.length && out.length < 6) {
    let len = parseInt(script.slice(i, i + 2), 16);
    i += 2;
    if (len === 0x4c) {
      len = parseInt(script.slice(i, i + 2), 16);
      i += 2;
    } else if (len === 0x4d) {
      len = parseInt(script.slice(i + 2, i + 4) + script.slice(i, i + 2), 16);
      i += 4;
    } else if (len > 0x4d) break;
    out.push(script.slice(i, i + len * 2));
    i += len * 2;
  }
  return out;
}

/**
 * A LIVE run is verified when its last tx is known to ARC (GorillaPool) and carries
 * OP_FALSE OP_RETURN "tokenblaster.lol" <token> <n> <game> with this game's tag.
 */
export async function verifyRunTx(txid: string, tag: string): Promise<boolean> {
  try {
    const r = await fetch(`https://arc.gorillapool.io/v1/tx/${txid}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { rawTx?: string; txStatus?: string };
    if (/REJECTED|DOUBLE_SPEND/i.test(j.txStatus ?? '')) return false;
    // ARC only returns the raw tx while it's fresh; once mined, fetch it from WhatsOnChain.
    let raw = j.rawTx;
    if (!raw) {
      const w = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!w.ok) return false;
      raw = (await w.text()).trim();
    }
    if (!/^[0-9a-f]+$/i.test(raw)) return false;
    const { Transaction } = await import('@bsv/sdk');
    const tx = Transaction.fromHex(raw);
    if (tx.id('hex') !== txid) return false;
    const gameHex = Buffer.from(tag).toString('hex');
    return tx.outputs.some((o) => {
      const s = o.lockingScript.toHex();
      if (!s.startsWith('006a')) return false;
      const p = pushes(s);
      return p[0] === TAG_HEX && p[3] === gameHex;
    });
  } catch {
    return false;
  }
}
