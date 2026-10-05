'use client';

/**
 * Token loot shared by every arcade game: the BSV-21 tokens moving on chain right now become
 * pickups. Games call `pickup(token)` when the player grabs one; a run's haul is tallied per
 * token and the all-time haul is kept in this browser.
 *
 * Phase 1 (now): tally + leaderboard only, nothing is paid out.
 * Phase 2 (later): capped real BSV-21 payouts from a house token wallet at the end of a PAID run.
 *   `Run.summary()` is the claim payload that phase 2 will send to a server route.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedTx } from './feed';
import { tokenMeta } from './tokenMeta';

export type Loot = { id: string; sym: string; icon: string | null };
export type Haul = Record<string, Loot & { n: number }>;

const STORE = 'tokenblaster.loot';

/** A collectible for this live token transfer, or null if the tx isn't a token one. */
export function lootFrom(f: FeedTx): Loot | null {
  if (f.kind !== 'token' || !f.token) return null;
  const m = tokenMeta(f.token);
  return { id: f.token, sym: m?.sym ?? f.token.slice(0, 6), icon: m?.iconSrc ?? null }; // canvas image: tokenMeta(id)?.icon
}

function readAll(): Record<string, Haul> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

function saveRun(game: string, run: Haul) {
  try {
    const all = readAll();
    const g = (all[game] ??= {});
    for (const [id, t] of Object.entries(run)) g[id] = { ...t, n: (g[id]?.n ?? 0) + t.n };
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* private window: the run still shows, it just isn't kept */
  }
}

/** Sorted haul, biggest first. */
export const ranked = (h: Haul) => Object.values(h).sort((a, b) => b.n - a.n);

/**
 * Per-game loot state. `pickup` is stable and safe to call from a game loop; `end()` banks the run.
 * `run` and `allTime` are React state for the HUD and the leaderboard panel.
 */
export function useLoot(game: string) {
  const live = useRef<Haul>({});
  const [run, setRun] = useState<Haul>({});
  const [allTime, setAllTime] = useState<Haul>({});
  useEffect(() => {
    void Promise.resolve().then(() => setAllTime(readAll()[game] ?? {}));
  }, [game]);
  const pickup = useCallback((t: Loot, n = 1) => {
    const h = live.current;
    h[t.id] = { ...t, n: (h[t.id]?.n ?? 0) + n };
    setRun({ ...h });
  }, []);
  const end = useCallback(() => {
    if (Object.keys(live.current).length) saveRun(game, live.current);
    live.current = {};
    setRun({});
    setAllTime(readAll()[game] ?? {});
  }, [game]);
  return { run, allTime, pickup, end, total: (h: Haul) => Object.values(h).reduce((s, t) => s + t.n, 0) };
}
