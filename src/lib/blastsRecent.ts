/** Pure helpers for GET /api/blasts/recent: query parsing, row mapping and CORS. */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const ALLOWED_ORIGINS = new Set(['https://www.bchatx.com', 'https://bchatx.com', 'https://www.tokenblaster.lol', 'https://badvertisingx.com', 'https://www.badvertisingx.com']);

export type RecentQuery = { limit: number; game: string | null; since: string | null; before: string | null };
export type BlastRow = { txid: string; token: string; n: number | null; game: string | null; seen_at: string; block_height: number | null };
export type BlastItem = { txid: string; game: string | null; ammo: string; n: number | null; player: string | null; seenAt: string; blockHeight: number | null };

/** Accepts an ISO date or epoch milliseconds; anything else is ignored (null). */
export function parseTime(v: string | null): string | null {
  if (!v) return null;
  const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseQuery(params: URLSearchParams): RecentQuery {
  const raw = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT;
  const g = (params.get('game') ?? '').trim().toLowerCase();
  const game = /^[a-z0-9_-]{1,40}$/.test(g) ? g : null;
  return { limit, game, since: parseTime(params.get('since')), before: parseTime(params.get('before')) };
}

/** TERRORNODE rounds fired before 25 Oct 2026 carry 'gallery' on chain. */
export const canonicalGame = (g: string | null): string | null => (g === 'gallery' ? 'terrornode' : g);

/** The on-chain tags to match for a requested game (terrornode also matches legacy 'gallery'). */
export const gameTags = (g: string | null): string[] | null => (g === null ? null : g === 'terrornode' ? ['terrornode', 'gallery'] : [g]);

/** The indexer does not store the shooter's paymail/handle yet, so player is always null for now. */
export function toItem(r: BlastRow): BlastItem {
  return {
    txid: r.txid,
    game: canonicalGame(r.game),
    ammo: r.token,
    n: r.n === null ? null : Number(r.n),
    player: null,
    seenAt: new Date(r.seen_at).toISOString(),
    blockHeight: r.block_height === null ? null : Number(r.block_height),
  };
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return origin && ALLOWED_ORIGINS.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : { Vary: 'Origin' };
}
