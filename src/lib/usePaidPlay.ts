'use client';

/**
 * PAID mode for arcade games (same pattern as Block Hopper / Chain Frogger): every action is one
 * real transaction, tag + PER_ACTION sat to the house + the network fee, queued and chained in
 * batches from the player's loaded sats. PRACTICE mode puts nothing on chain.
 */
import { useEffect, useRef, useState } from 'react';
import { useBlaster } from './useBlaster';

export const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS ?? '';
export const PER_ACTION = 1;
export const EST_FEE = 26; // sats: ~260-byte tx at 100 sat/kB
export const LOADS = [1_000, 10_000, 100_000];

export function usePaidPlay(outOfSats: string) {
  const b = useBlaster();
  const [paid, setPaid] = useState(false);
  const [onChain, setOnChain] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [needSats, setNeedSats] = useState(false);
  const payRef = useRef({ paid: false, sats: 0, queued: 0 });
  useEffect(() => {
    payRef.current.paid = paid && Boolean(HOUSE);
    payRef.current.sats = b.ammo;
  }, [paid, b.ammo]);
  const queue = useRef<string[][]>([]);
  const draining = useRef(false);
  const counter = useRef(0);
  const fireBatchRef = useRef(b.fireBatch);
  useEffect(() => {
    fireBatchRef.current = b.fireBatch;
  }, [b.fireBatch]);
  const drain = useRef(async () => {
    if (draining.current) return;
    draining.current = true;
    while (queue.current.length) {
      const batch = queue.current.slice(0, 40);
      try {
        const txids = await fireBatchRef.current(counter.current + 1, batch, { address: HOUSE, sats: PER_ACTION });
        counter.current += txids.length;
        queue.current.splice(0, txids.length);
        payRef.current.queued = queue.current.length;
        setOnChain((n) => n + txids.length);
        if (txids.length) setLastTx(txids[txids.length - 1]);
        setPayErr(null);
        if (!txids.length) throw new Error(outOfSats);
      } catch (e) {
        setPayErr(e instanceof Error ? e.message : String(e));
        queue.current.length = 0;
        payRef.current.queued = 0;
        break;
      }
    }
    draining.current = false;
  });
  /** Ask to pay for one action; false = out of sats, so the action is refused. Stable ref, safe in game loops. */
  const payFor = useRef((action: string[]) => {
    const pr = payRef.current;
    if (!pr.paid) return true; // practice mode
    if (pr.sats - (pr.queued + 1) * (PER_ACTION + EST_FEE) < 0) {
      setNeedSats(true);
      return false;
    }
    setNeedSats(false);
    queue.current.push(action);
    pr.queued = queue.current.length;
    void drain.current();
    return true;
  });
  return { b, paid, setPaid, onChain, lastTx, payErr, needSats, payFor };
}
