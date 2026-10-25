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

