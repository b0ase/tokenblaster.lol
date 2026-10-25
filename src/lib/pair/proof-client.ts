/** Browser side: ask our server to sign a pairing link. Never throws; undefined → unsigned QR, as before. */
import type { PairLink } from './protocol';

export async function fetchPairProof(l: Pick<PairLink, 'c' | 'k' | 'o' | 'e'>): Promise<string | undefined> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch('/api/pair/proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: l.c, k: l.k, o: l.o, e: l.e }),
      signal: ctl.signal,
    });
    if (!r.ok) return undefined;
    const { s } = (await r.json()) as { s?: unknown };
    return typeof s === 'string' && /^30[0-9a-f]+$/i.test(s) ? s : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}
