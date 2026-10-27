/**
 * Browser side of the TERRORNODE revenue split (split.ts): ask the server for pinned destinations, re-check the
 * pinning locally (the address must re-derive from the hardcoded identity keys), and report fee payments so the
 * companies' wallets are credited.
 */
import { pinnedQuote, type SplitQuote } from './split';

/** Fresh pinned NPG Ltd / bCorp destinations, or null (payments temporarily unavailable). */
export async function fetchSplit(): Promise<SplitQuote | null> {
  const r = await fetch('/api/terrornode/split', { cache: 'no-store' }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { ok?: boolean; quote?: unknown } | null;
  return r?.ok && j?.ok && pinnedQuote(j.quote) ? j.quote : null;
}

/** Can paid TERRORNODE play start? Both paymails answer with the pinned keys. */
export async function splitAvailable(): Promise<boolean> {
  const r = await fetch('/api/terrornode/split?check=1', { cache: 'no-store' }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { ok?: boolean } | null;
  return !!(r?.ok && j?.ok);
}

/** Credit a split payment (the platform fee) to the companies' wallets; retries while the tx propagates. */
export async function reportSplit(txid: string, quote: SplitQuote, tries = 6): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch('/api/terrornode/split', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txid, quote }) }).catch(() => null);
    if (r?.ok) return true;
    if (r && r.status !== 202 && r.status < 500) return false;
    await new Promise((ok) => setTimeout(ok, 2500 * (i + 1)));
  }
  return false;
}
