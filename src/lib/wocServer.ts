/** Server-side WhatsOnChain access (never from the browser: no CORS on its errors). */
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';

/** WOC answers 404 for an address it has never seen (a fresh gun): that means no coins, not an error. */
export const NONE = Symbol('none');

export async function woc(path: string, text = false): Promise<unknown> {
  for (let i = 0; ; i++) {
    // Keep well inside the function timeout: 3 tries with a 4s cap each, short backoff.
    const r = await fetch(`${WOC}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (r?.ok) return text ? r.text() : r.json();
    if (r?.status === 404) return NONE;
    if (i >= 2) throw new Error(`WOC ${r ? r.status : 'timeout'}`);
    await new Promise((ok) => setTimeout(ok, 400 * (i + 1)));
  }
}

const HEX = new Map<string, string>();
/** A tx's hex from WhatsOnChain, cached in memory (immutable). Shared with /api/tx/[txid]. */
export async function txHexCached(txid: string): Promise<string> {
  const c = HEX.get(txid);
  if (c) return c;
  const h = await woc(`/tx/${txid}/hex`, true);
  if (h === NONE || typeof h !== 'string' || !/^[0-9a-f]+$/i.test(h.trim())) throw new Error('WOC tx 404');
  if (HEX.size > 5000) HEX.delete(HEX.keys().next().value as string);
  HEX.set(txid, h.trim());
  return h.trim();
}


const HEX_RE = /^[0-9a-f]+$/i;
/**
 * Many txs' hex at once via WhatsOnChain's bulk `POST /txs/hex` (20 txids per call, calls in parallel), so a gun
 * with 177 dust coins costs ~9 requests, not 177 (29 Oct audit: the first coin read took 14 s, 8 at a time).
 * Cached in memory for the life of the instance (a txid never changes). Anything the bulk call misses is fetched
 * one by one as before. Missing txs are left out of the map; callers decide what to do.
 */
export async function txHexBulk(txids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need: string[] = [];
  for (const t of new Set(txids)) {
    const c = HEX.get(t);
    if (c) out.set(t, c);
    else need.push(t);
  }
  const groups: string[][] = [];
  for (let i = 0; i < need.length; i += 20) groups.push(need.slice(i, i + 20));
  // Up to 5 bulk calls in flight: WOC rate-limits bursts.
  for (let i = 0; i < groups.length; i += 5) {
    await Promise.all(
      groups.slice(i, i + 5).map(async (g) => {
        const r = await fetch(`${WOC}/txs/hex`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txids: g }),
          cache: 'no-store',
          signal: AbortSignal.timeout(6000),
        }).catch(() => null);
        if (!r?.ok) return;
        const list = (await r.json().catch(() => [])) as { txid?: string; hex?: string }[];
        for (const x of Array.isArray(list) ? list : []) {
          const h = x.hex?.trim();
          if (x.txid && h && HEX_RE.test(h)) {
            if (HEX.size > 5000) HEX.delete(HEX.keys().next().value as string);
            HEX.set(x.txid, h);
            out.set(x.txid, h);
          }
        }
      }),
    );
  }
  const left = need.filter((t) => !out.has(t));
  for (let i = 0; i < left.length; i += 8) {
    await Promise.all(left.slice(i, i + 8).map(async (t) => out.set(t, await txHexCached(t).catch(() => ''))));
  }
  for (const [t, h] of out) if (!h) out.delete(t);
  return out;
}
