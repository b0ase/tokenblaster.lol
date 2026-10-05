'use client';

/**
 * PAID ("LIVE") mode for arcade games: every action is one real transaction, tag + PER_ACTION sat to
 * the house + the network fee, queued and chained in batches from the player's loaded sats.
 * PRACTICE mode puts nothing on chain. The player's choice is remembered per game.
 *
 * If a broadcast fails the drain loop stops, the error is kept in `payErr` and `halted` is set:
 * new paid actions are refused until the player hits `resume()` (shown loudly on the canvas).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlaster } from './useBlaster';

export const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU' // bCorp's receiving address (public, not a key);
export const PER_ACTION = 1;
export const EST_FEE = 26; // sats: ~260-byte tx at 100 sat/kB
export const COST = PER_ACTION + EST_FEE;
export const LOADS = [1_000, 10_000, 100_000];

const modeKey = (game: string) => `tb:mode:${game}`;

export function usePaidPlay(outOfSats: string, game: string) {
  const b = useBlaster();
  const [paid, setPaidState] = useState(false);
  const [onChain, setOnChain] = useState(0);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [halted, setHalted] = useState(false);
  const [needSats, setNeedSats] = useState(false);
  const payRef = useRef({ paid: false, sats: 0, queued: 0, halted: false });

  // Remembered mode (after mount, so server and client render the same first frame).
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        if (localStorage.getItem(modeKey(game)) === 'live' && HOUSE) setPaidState(true);
      } catch {
        /* storage blocked */
      }
    });
  }, [game]);
  const setPaid = useCallback(
    (v: boolean) => {
      setPaidState(v);
      try {
        localStorage.setItem(modeKey(game), v ? 'live' : 'practice');
      } catch {
        /* storage blocked */
      }
    },
    [game],
  );

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
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[paid play] broadcast stopped:', e);
        setPayErr(msg);
        setHalted(true);
        payRef.current.halted = true;
        queue.current.length = 0;
        payRef.current.queued = 0;
        break;
      }
    }
    draining.current = false;
  });
  /** Ask to pay for one action; false = out of sats or halted, so the action is refused. Stable ref, safe in game loops. */
  const payFor = useRef((action: string[]) => {
    const pr = payRef.current;
    if (!pr.paid) return true; // practice mode
    if (pr.halted) return false;
    if (pr.sats - (pr.queued + 1) * COST < 0) {
      setNeedSats(true);
      return false;
    }
    setNeedSats(false);
    queue.current.push(action);
    pr.queued = queue.current.length;
    void drain.current();
    return true;
  });
  /** Clear a stopped drain so paid actions go through again. */
  const resume = useCallback(() => {
    payRef.current.halted = false;
    setHalted(false);
    setPayErr(null);
    setNeedSats(false);
    b.setError(null);
  }, [b]);
  return { b, paid, setPaid, onChain, lastTx, payErr, halted, resume, needSats, payFor };
}
