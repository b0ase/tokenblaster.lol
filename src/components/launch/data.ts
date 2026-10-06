'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { GRAD_SOLD, marketCap, price, progress } from '@/lib/launch/curve';

export type BoardCoin = {
  slot: string;
  token_id: string;
  sym: string;
  name: string;
  description: string;
  creator: string;
  route: { kind: 'creator' | 'split' | 'holders' | 'buyback'; to?: { address: string; bps: number }[] };
  sold: number;
  reserve_sats: number;
  burned: number;
  route_accrued: number;
  ath_sold: number;
  graduated_at: string | null;
  grad_rank: number | null;
  created_at: string;
  vol24: number;
  trades24: number;
  holders: number;
  sold24: number;
};

export type Trade = {
  txid: string;
  token_id: string;
  sym: string;
  side: 'buy' | 'sell' | 'launch' | 'burn';
  trader: string;
  tokens: number;
  curve_sats: number;
  user_sats: number;
  sold_after: number;
  mm: boolean;
  created_at: string;
};

export const imageOf = (tokenId: string) => `https://ordfs.network/${tokenId.split('_')[0]}_0`;
export const short = (a: string) => (a ? `${a.slice(0, 4)}…${a.slice(-3)}` : '');
export const mcapSats = (sold: number) => marketCap(BigInt(sold));
export const priceSats = (sold: number) => price(BigInt(sold));
export const pct = (sold: number) => progress(BigInt(sold));
export const graduated = (c: { sold: number; graduated_at: string | null }) => Boolean(c.graduated_at) || BigInt(c.sold) >= GRAD_SOLD;
export const change24 = (c: BoardCoin) => {
  const then = priceSats(c.sold24 || 0);
  return then > 0 ? (priceSats(c.sold) / then - 1) * 100 : 0;
};

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const usd = (sats: number, rate: number) => {
  const v = (sats / 1e8) * rate;
  return v >= 1000 ? `$${Math.round(v).toLocaleString()}` : v >= 1 ? `$${v.toFixed(2)}` : v >= 0.01 ? `$${v.toFixed(3)}` : `$${v.toPrecision(2)}`;
};
export const bsv = (sats: number) => {
  const n = sats / 1e8;
  return `${n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(4) : n.toPrecision(3)} BSV`;
};

/** BSV/USD from /api/price, refreshed every minute. */
export function useBsvUsd() {
  const [rate, setRate] = useState(0);
  useEffect(() => {
    let live = true;
    const get = () =>
      fetch('/api/price')
        .then((r) => r.json())
        .then((j: { bsvUsd?: number }) => live && j.bsvUsd && setRate(j.bsvUsd))
        .catch(() => undefined);
    get();
    const t = setInterval(get, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return rate;
}

/** Poll a JSON endpoint while the tab is visible. */
export function usePoll<T>(url: string | null, ms: number, initial: T): [T, () => void] {
  const [data, setData] = useState<T>(initial);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const load = () =>
      fetch(url, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => live && setData(j))
        .catch(() => undefined);
    // Always load once, even in a background tab; only the repeat polls wait for the tab to be visible.
    const get = () => {
      if (document.visibilityState !== 'hidden') load();
    };
    load();
    const t = setInterval(get, ms);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [url, ms, tick]);
  return [data, () => setTick((n) => n + 1)];
}

const WATCH = 'tokenblaster.launch.watch';
const watchers = new Set<() => void>();
const readWatch = () => {
  try {
    return localStorage.getItem(WATCH) ?? '[]';
  } catch {
    return '[]';
  }
};
/** Starred coins, kept in this browser only. */
export function useWatchlist() {
  const raw = useSyncExternalStore(
    (cb) => {
      watchers.add(cb);
      return () => watchers.delete(cb);
    },
    readWatch,
    () => '[]',
  );
  const list = useMemo<string[]>(() => {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }, [raw]);
  const toggle = (id: string) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    try {
      localStorage.setItem(WATCH, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
    watchers.forEach((f) => f());
  };
  return { list, toggle };
}

/** The current time, ticking every `ms` (keeps "5m ago" and 24h windows fresh without impure renders). */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
