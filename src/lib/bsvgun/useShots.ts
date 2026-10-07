'use client';

/**
 * LIVE range shots through the existing firing path: every trigger pull becomes one real BSVGun
 * transaction via useBlaster().fireBatch (tag, token, count, 'bsvgun', then 'range' and the weapon),
 * chained in batches exactly like the Arena and Chain Frogger do. No house payment, no new
 * transaction code: the leaderboard sees the same `bsvgun` blasts the storm sends. PRACTICE sends nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { STORM_FEE } from '../gun';
import type { useBlaster } from '../useBlaster';
import type { RangeWeapon } from './weapons';

type Blaster = ReturnType<typeof useBlaster>;
const BATCH = 40;

export function useShots(b: Blaster, live: boolean) {
  const [onChain, setOnChain] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<string[][]>([]);
  const draining = useRef(false);
  const counter = useRef(0);
  const liveRef = useRef(live);
  const ammo = useRef(b.ammo);
  const fireBatch = useRef(b.fireBatch);
  useEffect(() => {
    liveRef.current = live;
    ammo.current = b.ammo;
    fireBatch.current = b.fireBatch;
  });

  const drain = useRef(async () => {
    if (draining.current) return;
    draining.current = true;
    while (queue.current.length) {
      const batch = queue.current.slice(0, BATCH);
      try {
        const txids = await fireBatch.current(counter.current + 1, batch);
        counter.current += txids.length;
        queue.current.splice(0, txids.length);
        setOnChain((n) => n + txids.length);
        if (txids.length) setLastTx(txids[txids.length - 1]);
        setError(null);
        if (!txids.length) throw new Error('Out of sats: load more to keep shooting.');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        queue.current.length = 0;
        break;
      }
    }
    draining.current = false;
  });

  /** One trigger pull. False = can't pay for it (LIVE with an empty gun): the shot does not fire. */
  const fire = useCallback((w: RangeWeapon) => {
    if (!liveRef.current) return true;
    if (ammo.current - (queue.current.length + 1) * STORM_FEE < 0) return false;
    queue.current.push(['bsvgun', 'range', w.id]);
    void drain.current();
    return true;
  }, []);

  /** New run: forget the last run's transaction. */
  const reset = useCallback(() => {
    setOnChain(0);
    setLastTx(null);
    setError(null);
    queue.current.length = 0;
  }, []);

  return { fire, reset, onChain, lastTx, error, shotsAffordable: Math.max(0, Math.floor((b.ammo - 600) / STORM_FEE)) };
}
