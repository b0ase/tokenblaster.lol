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
