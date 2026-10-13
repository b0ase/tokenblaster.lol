'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChainStats } from '@/lib/chain';
import { subscribeStatus, subscribeTx, type StreamStatus } from '@/lib/chainStream';
import type { FeedTx } from '@/lib/feed';

/** What the chain is doing right now, for the hero's rhythm and readouts. */
export type PulseSnap = {
  status: StreamStatus;
  /** tx/s over the last 5 s */
  rate: number;
  /** sats and bytes seen in the last 10 s */
  sats10: number;
  bytes10: number;
  /** transactions this session */
  total: number;
  /** unconfirmed txs seen since the last block */
  mempool: number;
  /** chain tip height (0 until /api/chain answers) */
  height: number;
  /** when the last block landed (0: none yet this session) */
  blockAt: number;
};

export type PulseEvent =
  | { type: 'tx'; tx: FeedTx }
  | { type: 'big'; tx: FeedTx; bsv: number }
  | { type: 'token'; tx: FeedTx }
  | { type: 'blast'; tx: FeedTx }
  | { type: 'inscription'; tx: FeedTx }
  | { type: 'block'; height: number };

const EMPTY: PulseSnap = { status: 'connecting', rate: 0, sats10: 0, bytes10: 0, total: 0, mempool: 0, height: 0, blockAt: 0 };
/** A move this size is a hit: 1 BSV or a 40 KB transaction. */
const BIG_SATS = 1e8;
const BIG_BYTES = 40_000;

/**
 * The live mainnet pulse for the landing hero, from the page's one shared JungleBus stream (src/lib/chainStream, the
 * stream under useChainFeed; subscribed directly because the games' capped queue drops transactions on a busy chain
 * and the readout must match the strip). Transactions land in rolling windows (rate, sats, bytes), a session count
 * and a mempool count; `onEvent` fires per transaction with the hits picked out (big moves, token transfers, blasts,
 * inscriptions) and once per block. Dev: the 'tokenblaster:test-tx' window event feeds it too. Blocks: JungleBus replays the tip block's mined transactions on connect, then streams each
 * new block's as it lands, so a burst of mined txs after a quiet spell is a new block (the tip height is re-read
 * from /api/chain). React state refreshes twice a second, never per tx; `live` is the per-frame view.
 */
export function useChainPulse(onEvent: (e: PulseEvent) => void) {
  const live = useRef<PulseSnap>({ ...EMPTY });
  const [snap, setSnap] = useState<PulseSnap>(EMPTY);
  const cb = useRef(onEvent);
  useEffect(() => {
    cb.current = onEvent;
  });

  useEffect(() => {
    const stamps: number[] = [];
    const recent: { at: number; sats: number; bytes: number }[] = [];
    const queue: FeedTx[] = [];
    let lastMined = 0, connectedAt = Date.now(), alive = true;
    const l = live.current;
    const tip = async () => {
      try {
        const s = (await (await fetch('/api/chain')).json()) as ChainStats;
        if (alive && s.height) l.height = Math.max(l.height, s.height);
      } catch {
        /* chain data unavailable: the readout shows -- */
      }
    };
    void tip();
    const tipT = setInterval(tip, 90_000);
    let blockT: ReturnType<typeof setTimeout> | null = null;
    const drain = () => {
      const now = Date.now();
      for (const f of queue.splice(0)) {
        stamps.push(now);
        recent.push({ at: now, sats: f.sats, bytes: f.bytes });
        l.total++;
        if (f.mined) {
          // the first burst after connecting is the replay of the tip block, not a new block
          const fresh = now - lastMined > 45_000 && now - connectedAt > 20_000;
          lastMined = now;
          if (fresh && !blockT) {
            l.blockAt = now;
            l.mempool = 0;
            cb.current({ type: 'block', height: l.height ? l.height + 1 : 0 });
            if (l.height) l.height++;
            blockT = setTimeout(() => {
              blockT = null;
              void tip();
            }, 8000);
          }
          continue;
        }
        l.mempool++;
        cb.current({ type: 'tx', tx: f });
        if (f.sats >= BIG_SATS || f.bytes >= BIG_BYTES) cb.current({ type: 'big', tx: f, bsv: f.sats / 1e8 });
        else if (f.kind === 'blast') cb.current({ type: 'blast', tx: f });
        else if (f.kind === 'token') cb.current({ type: 'token', tx: f });
        else if (f.kind === 'inscription') cb.current({ type: 'inscription', tx: f });
      }
      while (stamps.length && now - stamps[0] > 5000) stamps.shift();
      while (recent.length && now - recent[0].at > 10_000) recent.shift();
      l.rate = stamps.length / 5;
      let s = 0, b = 0;
      for (const r of recent) {
        s += r.sats;
        b += r.bytes;
      }
      l.sats10 = s;
      l.bytes10 = b;
    };
    const push = (f: FeedTx) => {
      if (queue.length < 4000) queue.push(f);
    };
    const offTx = subscribeTx(push);
    const offStatus = subscribeStatus((s) => {
      l.status = s;
      if (s === 'live') connectedAt = Date.now();
    });
    const onTest = (e: Event) => push((e as CustomEvent<FeedTx>).detail);
    if (process.env.NODE_ENV !== 'production') window.addEventListener('tokenblaster:test-tx', onTest);
    const drainT = setInterval(drain, 180);
    const snapT = setInterval(() => setSnap({ ...l }), 500);
    const onVis = () => {
      if (!document.hidden) connectedAt = Date.now(); // back from a hidden tab: the catch-up burst is not a block
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      offTx();
      offStatus();
      window.removeEventListener('tokenblaster:test-tx', onTest);
      clearInterval(drainT);
      clearInterval(snapT);
      clearInterval(tipT);
      if (blockT) clearTimeout(blockT);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return { snap, live };
}
