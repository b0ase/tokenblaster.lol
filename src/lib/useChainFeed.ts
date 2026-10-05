'use client';

/**
 * Live BSV transactions for games: the GorillaPool JungleBus stream, classified into lanes
 * (src/lib/feed.ts). Games pull from `take()`; nothing is lost if they fall behind (capped queue).
 */
import { useEffect, useRef, useState } from 'react';
import { subscribeStatus, subscribeTx } from './chainStream';
import type { FeedTx } from './feed';

const SUBSCRIPTION = process.env.NEXT_PUBLIC_JUNGLEBUS_SUBSCRIPTION_ID ?? '';

export function useChainFeed(cap = 400) {
  const queue = useRef<FeedTx[]>([]);
  const [status, setStatus] = useState<'off' | 'connecting' | 'live' | 'error'>(SUBSCRIPTION ? 'connecting' : 'off');
  useEffect(() => {
    if (!SUBSCRIPTION) return;
    const push = (f: FeedTx) => {
      // Rolling buffer, per kind: always keep the newest of each kind, so one flood (e.g. a
      // spam burst of data txs) can't fill the queue and starve the other lanes or go stale.
      const q = queue.current;
      q.push(f);
      // Each kind keeps at most its share (oldest of that kind goes first), then the total cap.
      let same = 0;
      for (const x of q) if (x.kind === f.kind) same++;
      if (same > Math.ceil(cap / 6)) q.splice(q.findIndex((x) => x.kind === f.kind), 1);
      if (q.length > cap) q.shift();
      (window as unknown as { __tbFeed?: unknown }).__tbFeed = { waiting: q.length, kinds: q.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {}) };
    };
    const offStatus = subscribeStatus(setStatus);
    const offTx = subscribeTx(push);
    // Dev only: inject a fake tx to test games, e.g. dispatchEvent(new CustomEvent('tokenblaster:test-tx', { detail: {...} })).
    const onTest = (e: Event) => push((e as CustomEvent<FeedTx>).detail);
    if (process.env.NODE_ENV !== 'production') window.addEventListener('tokenblaster:test-tx', onTest);
    return () => {
      window.removeEventListener('tokenblaster:test-tx', onTest);
      offStatus();
      offTx();
    };
  }, [cap]);
  /** Next live transaction (optionally of one kind), or null if none waiting. */
  const take = (pred?: (f: FeedTx) => boolean) => {
    const q = queue.current;
    const i = pred ? q.findIndex(pred) : q.length ? 0 : -1;
    return i < 0 ? null : q.splice(i, 1)[0];
  };
  return { take, status, waiting: () => queue.current.length };
}
