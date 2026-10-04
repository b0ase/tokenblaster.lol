'use client';

/**
 * Live BSV transactions for games: the GorillaPool JungleBus stream, classified into lanes
 * (src/lib/feed.ts). Games pull from `take()`; nothing is lost if they fall behind (capped queue).
 */
import { useEffect, useRef, useState } from 'react';
import type { ChainStats } from './chain';
import { classify, type FeedTx } from './feed';
import { streamSubscription, type JbTx } from './junglebus';
import { tokenMeta } from './tokenMeta';

const SUBSCRIPTION = process.env.NEXT_PUBLIC_JUNGLEBUS_SUBSCRIPTION_ID ?? '';

export function useChainFeed(cap = 400) {
  const queue = useRef<FeedTx[]>([]);
  const [status, setStatus] = useState<'off' | 'connecting' | 'live' | 'error'>(SUBSCRIPTION ? 'connecting' : 'off');
  useEffect(() => {
    if (!SUBSCRIPTION) return;
    const ids = new Set<string>();
    const push = (tx: JbTx) => {
      if (ids.has(tx.id)) return;
      ids.add(tx.id);
      if (ids.size > 5000) ids.clear();
      const f = classify(tx.id, tx.hex, tx.mined);
      if (!f) return;
      if (f.token) tokenMeta(f.token); // fetch its name/icon early
      if (queue.current.length < cap) queue.current.push(f);
    };
    let stop: (() => void) | undefined;
    let cancelled = false;
    fetch('/api/chain')
      .then((r) => r.json())
      .then((s: ChainStats) => {
        if (!cancelled) stop = streamSubscription(SUBSCRIPTION, s.height || 0, { onTx: push, onState: setStatus });
      })
      .catch(() => setStatus('error'));
    return () => {
      cancelled = true;
      stop?.();
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
