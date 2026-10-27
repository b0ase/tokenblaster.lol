/**
 * Short ticker links: /launch/TERRORNODE (any case, optional leading $) resolves to the coin's one canonical
 * page, /launch/<deploy outpoint>. Pure helpers here; the page does the lookup and the 308.
 */

export const isOutpoint = (s: string) => /^[0-9a-f]{64}_\d+$/.test(s);

/** "$terrornode" / "%24TerrorNode" → "TERRORNODE"; null when it can't be a ticker. */
export function normTicker(raw: string): string | null {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  s = s.trim().replace(/^\$/, '').toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(s) ? s : null;
}

export type TickerRow = { token_id: string | null; sym: string; status?: string | null; created_at?: string | null };

/**
 * The coin a ticker means. Two coins may share a ticker: prefer the live one, then the most recent.
 * Rows without a status are treated as live (the public board only lists live coins).
 */
export function pickByTicker<T extends TickerRow>(rows: T[], raw: string): T | null {
  const t = normTicker(raw);
  if (!t) return null;
  const live = (r: TickerRow) => (r.status ?? 'live') === 'live';
  const when = (r: TickerRow) => (r.created_at ? Date.parse(r.created_at) || 0 : 0);
  const hits = rows.filter((r) => r.token_id && isOutpoint(r.token_id) && r.sym.trim().replace(/^\$/, '').toUpperCase() === t);
  hits.sort((a, b) => Number(live(b)) - Number(live(a)) || when(b) - when(a));
  return hits[0] ?? null;
}
