/**
 * "Most blasted tokens": blasts per token over a period, from public.tokenblaster_blasts on the
 * Hetzner Supabase (filled by worker/indexer.ts), read through the tokenblaster_top() function.
 */
import { iconUrl, tokenById } from './tokens';

export type Period = '24h' | '7d' | '30d' | 'all';
export const PERIODS: { id: Period; label: string }[] = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

export type TokenScore = { tokenId: string; ticker: string; icon: string | null; blasts: number };

export const isPeriod = (v: string | null): v is Period => PERIODS.some((p) => p.id === v);

const HOURS: Record<Period, number | null> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, all: null };

/** Token names and icons change never; keep them for the life of the server instance. */
const meta = new Map<string, { ticker: string; icon: string | null }>();
async function tokenMeta(id: string) {
  if (!meta.has(id)) {
    try {
      const t = await tokenById(id);
      meta.set(id, { ticker: t.sym, icon: iconUrl(t.icon) });
    } catch {
      return { ticker: id.slice(0, 8), icon: null };
    }
  }
  return meta.get(id)!;
}

export async function topTokens(period: Period): Promise<TokenScore[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Leaderboard database not configured');
  const hours = HOURS[period];
  const since = hours ? new Date(Date.now() - hours * 3600_000).toISOString() : null;
  const r = await fetch(`${url}/rest/v1/rpc/tokenblaster_top`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ since, max_rows: 25 }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Leaderboard query failed: ${r.status}`);
  const rows = (await r.json()) as { token: string; blasts: number }[];
  return Promise.all(rows.map(async (row) => ({ tokenId: row.token, blasts: Number(row.blasts), ...(await tokenMeta(row.token)) })));
}
