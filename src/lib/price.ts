/**
 * BSV/USD for the server: WhatsOnChain, then Coinbase, then CoinGecko, whichever answers first in that
 * order. Cached in memory for a minute so pages and share cards don't hammer the sources.
 */
import 'server-only';

type Source = { name: string; url: string; read: (j: unknown) => number | undefined };

const SOURCES: Source[] = [
  { name: 'whatsonchain', url: 'https://api.whatsonchain.com/v1/bsv/main/exchangerate', read: (j) => (j as { rate?: number }).rate },
  { name: 'coinbase', url: 'https://api.coinbase.com/v2/prices/BSV-USD/spot', read: (j) => Number((j as { data?: { amount?: string } }).data?.amount) },
  { name: 'coingecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash-sv&vs_currencies=usd', read: (j) => (j as { 'bitcoin-cash-sv'?: { usd?: number } })['bitcoin-cash-sv']?.usd },
];

let cache: { rate: number; at: number } | null = null;
const TTL = 60_000;

/** The BSV/USD rate, or 0 if every source failed (callers then show BSV). */
export async function bsvUsd(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL) return cache.rate;
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url, { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
      if (!r.ok) continue;
      const rate = s.read(await r.json());
      if (rate && Number.isFinite(rate) && rate > 0) {
        cache = { rate, at: Date.now() };
        return rate;
      }
    } catch {
      /* next source */
    }
  }
  return cache?.rate ?? 0; // a stale rate beats none
}

const GBP_SOURCES: Source[] = [
  { name: 'coinbase', url: 'https://api.coinbase.com/v2/prices/BSV-GBP/spot', read: (j) => Number((j as { data?: { amount?: string } }).data?.amount) },
  { name: 'coingecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash-sv&vs_currencies=gbp', read: (j) => (j as { 'bitcoin-cash-sv'?: { gbp?: number } })['bitcoin-cash-sv']?.gbp },
];
/** USD → GBP, for the last fallback (BSV/USD × USD/GBP). */
const USD_GBP: Source = { name: 'coinbase-fx', url: 'https://api.coinbase.com/v2/exchange-rates?currency=USD', read: (j) => Number((j as { data?: { rates?: { GBP?: string } } }).data?.rates?.GBP) };

async function firstRate(sources: Source[]): Promise<number> {
  for (const s of sources) {
    try {
      const r = await fetch(s.url, { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
      if (!r.ok) continue;
      const rate = s.read(await r.json());
      if (rate && Number.isFinite(rate) && rate > 0) return rate;
    } catch {
      /* next source */
    }
  }
  return 0;
}

let gbpCache: { rate: number; at: number } | null = null;

/** BSV/GBP: Coinbase, then CoinGecko, then BSV/USD × USD/GBP. Cached a minute; 0 if everything failed. */
export async function bsvGbp(): Promise<number> {
  if (gbpCache && Date.now() - gbpCache.at < TTL) return gbpCache.rate;
  let rate = await firstRate(GBP_SOURCES);
  if (!rate) {
    const [u, fx] = await Promise.all([bsvUsd(), firstRate([USD_GBP])]);
    rate = u && fx ? u * fx : 0;
  }
  if (rate) {
    gbpCache = { rate, at: Date.now() };
    return rate;
  }
  return gbpCache?.rate ?? 0; // a stale rate beats none
}
