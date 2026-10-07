/**
 * Hall of fame data: per-game champions, the arcade-wide ranking, most blasted tokens, BlastPad leaders and
 * (when the database records it) most transactions by player. Server side only, every read cached 60 s.
 *
 * Reads the same Supabase functions the rest of the site uses (tokenblaster_top_scores, tokenblaster_top,
 * tokenblaster_launch_board); the only new one is the optional tokenblaster_top_tx_players (db/019).
 */
import { cleanHandle } from './identity';
import { price } from './launch/curve';
import { SCORE_GAMES, type ScoreGame, type ScorePeriod, type ScoreRow } from './scores';
import { iconUrl, tokenById } from './tokens';

export const REVALIDATE = 60;
export const HALL_PERIODS: { id: ScorePeriod; label: string }[] = [
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
  { id: 'all', label: 'ALL' },
];

// ── The cabinets ──

export type Cabinet = {
  id: string;
  title: string;
  href: string;
  img: string;
  /** SCORE_GAMES tags whose boards belong to this cabinet (empty: no score board yet). */
  tags: string[];
  /** What the score counts, for the champion line. */
  unit: string;
};

/** Every game on /arcade (plus Arena), in any order: the page sorts A-Z with byTitle(). */
export const CABINETS: Cabinet[] = [
  { id: 'doubleo', title: 'Double-O Satoshi', href: '/arcade/doubleosatoshi', img: '/arcade/doubleo.jpg', tags: ['doubleo'], unit: 'rekt' },
  { id: 'bsvgun', title: 'BSVGun', href: '/arcade/bsvgun', img: '/arcade/bsvgun.jpg', tags: ['bsvgun'], unit: 'pts' },
  { id: 'arena', title: 'Arena', href: '/arena', img: '/arcade/arena.jpg', tags: ['arena'], unit: 'kills' },
  { id: 'frogger', title: 'Chain Frogger', href: '/arcade/frogger', img: '/arcade/frogger.jpg', tags: ['frogger'], unit: 'crossings' },
  { id: 'hopper', title: 'Block Hopper', href: '/arcade/hopper', img: '/arcade/hopper.jpg', tags: ['hopper'], unit: 'pts' },
  { id: 'invaders', title: 'Mempool Invaders', href: '/arcade/invaders', img: '/arcade/invaders.jpg', tags: ['invaders'], unit: 'pts' },
  { id: 'kweg', title: "Kweg's Expedition", href: '/arcade/kweg', img: '/arcade/kweg.jpg', tags: ['kweg'], unit: 'pts' },
  { id: 'snake', title: 'Token Snake', href: '/arcade/snake', img: '/arcade/snake.jpg', tags: ['snake'], unit: 'pts' },
  { id: 'city', title: 'Satoshi City', href: '/arcade/city', img: '/arcade/city.jpg', tags: ['city'], unit: 'pts' },
  { id: 'npgcards', title: 'Ninja Punk Girls: Card Battle', href: '/arcade/npg-cards', img: '/arcade/npg-cards.jpg', tags: ['npgcards'], unit: 'wins' },
  { id: 'npg', title: 'Ninja Punk Girls: Erobot Uprising', href: '/arcade/npg-runner', img: '/arcade/npg-runner.jpg', tags: ['npg'], unit: 'pts' },
  { id: 'rally', title: 'Token Rally', href: '/arcade/rally', img: '/arcade/rally.jpg', tags: ['rally'], unit: 'pts' },
  { id: 'sats2048', title: 'Sat Stack 2048', href: '/arcade/2048', img: '/arcade/2048.jpg', tags: ['sats2048'], unit: 'pts' },
  { id: 'highway21', title: 'Highway 21M', href: '/arcade/highway21', img: '/arcade/highway21.jpg', tags: ['highway21'], unit: 'pts' },
  { id: 'bubbo', title: 'Coin Pop', href: '/arcade/bubbo-bubbo', img: '/arcade/bubbo-bubbo.jpg', tags: ['bubbo'], unit: 'pts' },
  { id: 'potions', title: 'Token Potions', href: '/arcade/puzzling-potions', img: '/arcade/puzzling-potions.jpg', tags: ['potions'], unit: 'pts' },
  { id: 'bracer', title: 'bRacer', href: '/arcade/bracer', img: '/arcade/bracer.jpg', tags: ['bracer', 'bracer-hc'], unit: 'pts' },
];

export const boardsOf = (c: Cabinet): ScoreGame[] => (Object.keys(SCORE_GAMES) as ScoreGame[]).filter((g) => c.tags.includes(SCORE_GAMES[g].tag));
export const cabinetOfBoard = (g: ScoreGame) => CABINETS.find((c) => c.tags.includes(SCORE_GAMES[g].tag));
/** Boards no cabinet claims: a guard for the tests, so a new game cannot silently miss the hall. */
export const unclaimedBoards = () => (Object.keys(SCORE_GAMES) as ScoreGame[]).filter((g) => !cabinetOfBoard(g));

// ── Players ──

export type Player = { key: string; name: string; handle: string | null; /** the handle is proven by a bWalletX signature (meta.xv, set by the server only) */ verified: boolean };

/** Scores carry a free-text name; an X identity exists only when a game sends meta.x (a valid handle). */
export function playerOf(r: Pick<ScoreRow, 'name' | 'meta'>): Player {
  const handle = cleanHandle(r.meta?.x);
  return { key: (handle ?? r.name).toLowerCase(), name: handle ? `@${handle}` : r.name, handle, verified: Boolean(handle) && r.meta?.xv === 1 };
}

// ── Arcade-wide ranking ──

/** Formula-1 points for placings 1 to 10. */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export type Placing = { game: string; rank: number; points: number };
export type OverallRow = { player: Player; points: number; wins: number; games: number; best: Placing[] };

/**
 * One cabinet = one championship. A player's result there is their best placing (highest points) across the
 * cabinet's boards, counted once, so a game with five levels does not outweigh a game with one. Points are the
 * F1 table on the top 10 of each board; ties break on number of #1s, then games entered, then name.
 * `boards` maps cabinet id to its boards' rows (best first). Pure, so it is unit tested.
 */
export function overallRanking(boards: Record<string, ScoreRow[][]>): OverallRow[] {
  const by = new Map<string, OverallRow>();
  for (const [game, lists] of Object.entries(boards)) {
    const bestHere = new Map<string, { player: Player; rank: number; points: number }>();
    for (const rows of lists) {
      const seen = new Set<string>();
      let rank = 0;
      for (const r of rows) {
        const p = playerOf(r);
        if (seen.has(p.key)) continue; // a player's best row on a board only
        seen.add(p.key);
        rank++;
        if (rank > POINTS.length) break;
        const pts = POINTS[rank - 1];
        const cur = bestHere.get(p.key);
        if (!cur || pts > cur.points) bestHere.set(p.key, { player: p, rank, points: pts });
      }
    }
    for (const [key, b] of bestHere) {
      const row = by.get(key) ?? { player: b.player, points: 0, wins: 0, games: 0, best: [] };
      if (b.player.handle) row.player = { ...b.player, verified: b.player.verified || row.player.verified };
      row.points += b.points;
      row.wins += b.rank === 1 ? 1 : 0;
      row.games += 1;
      row.best.push({ game, rank: b.rank, points: b.points });
      by.set(key, row);
    }
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || b.games - a.games || a.player.name.localeCompare(b.player.name));
}

// ── Reads ──

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('database not configured');
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    next: { revalidate: REVALIDATE },
  });
  if (!r.ok) throw new Error(`${fn} failed: ${r.status}`);
  return (await r.json()) as T;
}

const HOURS: Record<ScorePeriod, number | null> = { '24h': 24, '7d': 168, all: null };
const sinceOf = (p: ScorePeriod) => {
  const h = HOURS[p];
  if (!h) return null;
  // Rounded to the minute so the cached request is shared between visitors.
  return new Date(Math.floor((Date.now() - h * 3600_000) / 60_000) * 60_000).toISOString();
};

/** Top rows of one board. A failed read is an empty board (the page says so), never a crash. */
export async function boardRows(game: ScoreGame, period: ScorePeriod, max = 10): Promise<ScoreRow[]> {
  try {
    const rows = await rpc<ScoreRow[]>('tokenblaster_top_scores', { p_game: game, since: sinceOf(period), max_rows: max, sort: 'score' });
    return rows.map((r) => ({ ...r, id: Number(r.id), score: Number(r.score), secs: Number(r.secs) }));
  } catch {
    return [];
  }
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export type CabinetBoard = { game: ScoreGame; title: string; rows: ScoreRow[] };
export type HallData = Record<ScorePeriod, Record<string, CabinetBoard[]>>;

/** Top 10 of every board for the three periods (about 90 small reads, cached a minute, 12 at a time). */
export async function hallBoards(): Promise<HallData> {
  const jobs = CABINETS.flatMap((c) => boardsOf(c).map((g) => ({ c, g }))).flatMap((j) => HALL_PERIODS.map((p) => ({ ...j, p: p.id })));
  const rows = await pool(jobs, 12, (j) => boardRows(j.g, j.p, 10));
  const out: HallData = { '24h': {}, '7d': {}, all: {} };
  jobs.forEach((j, i) => {
    (out[j.p][j.c.id] ??= []).push({ game: j.g, title: SCORE_GAMES[j.g].title, rows: rows[i] });
  });
  return out;
}

export type TopToken = { tokenId: string; ticker: string; icon: string | null; blasts: number };
const tokenMetaCache = new Map<string, { ticker: string; icon: string | null }>();
async function tokenMeta(id: string) {
  const hit = tokenMetaCache.get(id);
  if (hit) return hit;
  try {
    const t = await tokenById(id);
    const m = { ticker: t.sym, icon: iconUrl(t.icon) };
    tokenMetaCache.set(id, m);
    return m;
  } catch {
    return { ticker: id.slice(0, 8), icon: null };
  }
}

/** Most blasted tokens (tokenblaster_top), top 10 per period. */
export async function topTokensFor(period: ScorePeriod): Promise<TopToken[]> {
  try {
    const rows = await rpc<{ token: string; blasts: number }[]>('tokenblaster_top', { since: sinceOf(period), max_rows: 10 });
    return await Promise.all(rows.map(async (r) => ({ tokenId: r.token, blasts: Number(r.blasts), ...(await tokenMeta(r.token)) })));
  } catch {
    return [];
  }
}

export type PadCoin = { tokenId: string; sym: string; name: string; creator: string; vol24: number; trades24: number; holders: number; sold: number; change24: number; graduated: boolean };
/** Coins kept off every public list (TokenBlaster's own test coin), as in /api/launch/coins. */
const HIDDEN = new Set(['342d637360569559810232fbbf9c4aea873e95c31d710396b0c9ac2e832ce628_1']);

export async function padCoins(): Promise<PadCoin[] | null> {
  try {
    const rows = await rpc<Record<string, unknown>[]>('tokenblaster_launch_board', {});
    return rows
      .filter((r) => r.token_id && !HIDDEN.has(String(r.token_id)))
      .map((r) => {
        const sold = Math.floor(Number(r.sold)) || 0;
        const then = price(BigInt(Math.floor(Number(r.sold24) || 0)));
        return {
          tokenId: String(r.token_id),
          sym: String(r.sym),
          name: String(r.name),
          creator: String(r.creator ?? ''),
          vol24: Number(r.vol24) || 0,
          trades24: Number(r.trades24) || 0,
          holders: Number(r.holders) || 0,
          sold,
          change24: Number(r.trades24) > 0 && then > 0 ? (price(BigInt(sold)) / then - 1) * 100 : 0,
          graduated: Boolean(r.graduated_at),
        };
      });
  } catch {
    return null;
  }
}

export type TxPlayer = { name: string; txs: number; games: number; last_txid: string | null; idv: boolean };
/** Most transactions put on chain by player. null = the database does not record it yet (db/019 not applied). */
export async function topTxPlayers(period: ScorePeriod): Promise<TxPlayer[] | null> {
  try {
    const rows = await rpc<{ player: string; txs: number; games: number; last_txid: string | null; idv: boolean }[]>('tokenblaster_top_tx_players', { since: sinceOf(period), max_rows: 10 });
    return rows.map((r) => ({ name: r.player, txs: Number(r.txs), games: Number(r.games), last_txid: r.last_txid, idv: Boolean(r.idv) }));
  } catch {
    return null;
  }
}

// ── Formatting ──

export const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const shortAddr = (a: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
export const wocTx = (txid: string) => `https://whatsonchain.com/tx/${txid}`;
