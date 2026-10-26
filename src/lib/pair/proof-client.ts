/** Browser side: ask our server to sign a pairing link. Never throws; undefined → unsigned QR, as before. */
import type { PairLink } from './protocol';

const SIG = /^30[0-9a-f]+$/i;

export async function fetchPairProofs(
  l: Pick<PairLink, 'c' | 'k' | 'o' | 'e' | 'ret' | 'rid' | 'b'>,
): Promise<{ s?: string; s2?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch('/api/pair/proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: l.c, k: l.k, o: l.o, e: l.e, ret: l.ret, rid: l.rid, b: l.b }),
      signal: ctl.signal,
    });
    if (!r.ok) return {};
    const { s, s2 } = (await r.json()) as { s?: unknown; s2?: unknown };
    return {
      s: typeof s === 'string' && SIG.test(s) ? s : undefined,
      s2: typeof s2 === 'string' && SIG.test(s2) ? s2 : undefined,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(t);
  }
}

/** v1 only (kept for callers that don't send a return). */
export async function fetchPairProof(l: Pick<PairLink, 'c' | 'k' | 'o' | 'e'>): Promise<string | undefined> {
  return (await fetchPairProofs(l)).s;
}
