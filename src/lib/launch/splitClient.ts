/**
 * Browser side of the TERRORNODE revenue split (split.ts): ask the server for pinned destinations, re-check the
 * pinning locally (the address must re-derive from the hardcoded identity keys), and report fee payments so the
 * companies' wallets are credited.
 */
import { pinnedQuote, type SplitQuote } from './split';

/**
 * Pinned NPG Ltd / bCorp destinations for one paid session (`who` = the session's gun/session id), or null.
 * Only call when a payment is actually about to be made: each new quote uses up paymail destinations.
 */
export async function fetchSplit(purpose: 'fee' | 'receipts', who: string): Promise<SplitQuote | null> {
  const u = `/api/terrornode/split?for=${purpose}&who=${encodeURIComponent(who)}`;
  const r = await fetch(u, { cache: 'no-store' }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { ok?: boolean; quote?: unknown } | null;
  return r?.ok && j?.ok && pinnedQuote(j.quote) ? j.quote : null;
}

/**
 * Can paid TERRORNODE play start? Both paymails answer with the pinned keys. A yes is reused for a minute and the
 * check is started early (loadout open: prefetchSplitCheck), so LOCK & LOAD does not wait on the server's paymail
 * round trips. It only gates the start: every payment still fetches and re-verifies its own pinned quote.
 */
const CHECK_MS = 60_000;
let checked: { at: number; p: Promise<boolean> } | null = null;
export function splitAvailable(): Promise<boolean> {
  if (checked && performance.now() - checked.at < CHECK_MS) return checked.p;
  const p = fetch('/api/terrornode/split?check=1', { cache: 'no-store' })
    .then(async (r) => {
      const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      return !!(r.ok && j?.ok);
    })
    .catch(() => false);
  const entry = { at: performance.now(), p };
  checked = entry;
  void p.then((ok) => {
    if (!ok && checked === entry) checked = null; // never cache a no
  });
  return p;
}
export const prefetchSplitCheck = () => void splitAvailable();

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
