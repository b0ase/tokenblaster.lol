'use client';

/**
 * Report a finished LIVE run's transaction count to the hall of fame (POST /api/txlog). Fire and forget: it never blocks, never
 * throws and never touches payments. Skipped for practice runs, stub transaction ids and players with no name or X handle.
 * `txid` is the run's last transaction (the server checks it on chain). With an X handle set and a wallet connected, the run is
 * also signed for the identity tick (src/lib/xproof.ts).
 */
import { cleanHandle, loadMyHandle } from './identity';
import { cachedProof } from './xproof';

const NAME_KEY = 'tb:scores:name'; // the name HighScores remembers

export function reportTxs(o: { game: string; txs: number; txid: string | null | undefined; secs?: number }): void {
  const txid = o.txid && /^[0-9a-f]{64}$/i.test(o.txid) ? o.txid.toLowerCase() : null;
  if (!txid || !Number.isInteger(o.txs) || o.txs < 1 || typeof window === 'undefined') return;
  const handle = cleanHandle(loadMyHandle());
  let name: string | null = null;
  try {
    name = localStorage.getItem(NAME_KEY);
  } catch {
    /* storage blocked */
  }
  if (!handle && !name) return;
  void (async () => {
    try {
      const xp = cachedProof(handle);
      await fetch('/api/txlog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: o.game, txs: o.txs, txid, secs: o.secs !== undefined ? Math.round(o.secs * 10) / 10 : undefined, name: name ?? undefined, x: handle ?? undefined, xp: xp ?? undefined }),
        keepalive: true,
      });
    } catch {
      /* the hall is cosmetic: ignore */
    }
  })();
}
