/**
 * Guards on the bWalletX paymail server's P2P destinations (it allows ~200 per alias per hour, so they must never
 * be spent on page loads or by anyone hammering the API):
 *   checkCached     — ?check=1: bsvalias + pinned pki keys only (no destination used up), result cached 60 s.
 *   quoteFor        — a destination quote for one paid session: rate-limited per IP and per wallet identity, and an
 *                     unused quote for the same session + purpose is handed back again instead of fetching new ones.
 *   markUsed        — called once a payment to a quote is credited, so it is never reused.
 * In-memory per server instance (best effort; the paymail server's own limit is the backstop).
 */
import { checkPayees, resolveSplit } from './payees';
import type { SplitQuote } from './split';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const CHECK_TTL = 60_000;
export const QUOTE_REUSE = 10 * 60_000;
export const LIMIT = { window: 60_000, perIp: 6, perWho: 3 };

let checkCache: { at: number; ok: boolean; why?: string } | null = null;
let checkInflight: Promise<{ ok: boolean; why?: string }> | null = null;
const hits = new Map<string, number[]>();
const quotes = new Map<string, { at: number; quote: SplitQuote }>();
const used = new Set<string>();

export const _resetSplitGate = () => {
  checkCache = null;
  checkInflight = null;
  hits.clear();
  quotes.clear();
  used.clear();
};

/** Both paymails resolve with the pinned keys? Cached CHECK_TTL; concurrent callers share one lookup. */
export async function checkCached(f: Fetch = fetch, now = Date.now()): Promise<{ ok: boolean; why?: string }> {
  if (checkCache && now - checkCache.at < CHECK_TTL) return checkCache;
  checkInflight ??= checkPayees(f)
    .then(() => ({ ok: true }))
    .catch((e: unknown) => ({ ok: false, why: e instanceof Error ? e.message : String(e) }))
    .then((r) => {
      checkCache = { at: now, ...r };
      checkInflight = null;
      return r;
    });
  return checkInflight;
}

function allow(key: string, max: number, now: number): boolean {
  const h = (hits.get(key) ?? []).filter((t) => now - t < LIMIT.window);
  if (h.length >= max) {
    hits.set(key, h);
    return false;
  }
  h.push(now);
  hits.set(key, h);
  return true;
}

const fresh = (q: SplitQuote) => !used.has(q.npg.reference) && !used.has(q.bcorp.reference);

export type QuoteAsk = { ip: string; who: string; purpose: 'fee' | 'receipts' };
export type QuoteResult = { ok: true; quote: SplitQuote; reused: boolean } | { ok: false; status: 429 | 503; why: string };

/** A pinned quote for one paid session, reusing an unused one for the same session first. */
export async function quoteFor(a: QuoteAsk, f: Fetch = fetch, now = Date.now()): Promise<QuoteResult> {
  const key = `${a.purpose}:${a.who}`;
  const have = quotes.get(key);
  if (have && now - have.at < QUOTE_REUSE && fresh(have.quote)) return { ok: true, quote: have.quote, reused: true };
  quotes.delete(key);
  if (!allow(`ip:${a.ip}`, LIMIT.perIp, now) || !allow(`who:${a.who}`, LIMIT.perWho, now))
    return { ok: false, status: 429, why: 'Too many payment requests. Wait a minute and try again.' };
  try {
    const quote = await resolveSplit(f);
    quotes.set(key, { at: now, quote });
    return { ok: true, quote, reused: false };
  } catch (e) {
    return { ok: false, status: 503, why: e instanceof Error ? e.message : String(e) };
  }
}

/** A payment to this quote was credited: never hand it out again. */
export function markUsed(q: { npg?: { reference?: unknown }; bcorp?: { reference?: unknown } } | null | undefined) {
  for (const r of [q?.npg?.reference, q?.bcorp?.reference]) if (typeof r === 'string' && r) used.add(r);
  if (used.size > 5000) used.clear();
  for (const [k, v] of quotes) if (!fresh(v.quote)) quotes.delete(k);
}

/** The caller's IP as Vercel reports it. */
export const clientIp = (req: Request) =>
  (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim();
export const validWho = (w: unknown): w is string => typeof w === 'string' && /^[A-Za-z0-9._@:-]{4,100}$/.test(w);
