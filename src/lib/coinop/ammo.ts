/**
 * Gun ammo bookkeeping (pure, tested in ammo.test.ts). Owner, 24 Oct 2026 fix: the CREDIT is the gun's real
 * spendable balance, leftover ammo is used without a new payment, and the coin set is rebuilt from real
 * unspent outputs (never a coin our own transactions already spent).
 */
import { satsToUsd } from './credit';

export type Outpoint = { txid: string; vout: number; sats: number };
export const opKey = (o: { txid: string; vout: number }) => `${o.txid}_${o.vout}`;

/**
 * The gun's spendable coins: everything we know of (chain lookup, the wallet's payment responses, our own
 * broadcast change), each outpoint once, minus every outpoint our own transactions spent. Largest first.
 */
export function spendableCoins<T extends Outpoint>(sources: T[][], spent: ReadonlySet<string>): T[] {
  const seen = new Map<string, T>();
  for (const list of sources) for (const c of list) if (c.sats > 1 && !spent.has(opKey(c)) && !seen.has(opKey(c))) seen.set(opKey(c), c);
  return [...seen.values()].sort((a, b) => b.sats - a.sats);
}
export const sumSats = (coins: { sats: number }[]) => coins.reduce((n, c) => n + c.sats, 0);

/** CREDIT shown on the cabinet: the gun's spendable sats in dollars, plus coins inserted and not yet paid. */
export const creditUsd = (gunSats: number, bsvUsd: number | null | undefined, pendingUsd = 0) => satsToUsd(Math.max(0, gunSats), bsvUsd) + Math.max(0, pendingUsd);

/**
 * What LOCK & LOAD does. Only newly inserted coins are billed; with no coins inserted and ammo already in the
 * gun it loads from that ammo with no wallet request at all.
 */
export function planLoad(p: { gunSats: number; pendingUsd: number; roundSats: number }): { pay: boolean; useLeftover: boolean; short: boolean } {
  const pay = p.pendingUsd > 0;
  const useLeftover = !pay && p.gunSats >= p.roundSats && p.roundSats > 0;
  return { pay, useLeftover, short: !pay && !useLeftover };
}

/** Rounds the gun's sats buy, after the per-transaction overhead. */
export function roundsFrom(avail: number, perShotAll: number, overhead: (shots: number) => number): number {
  if (perShotAll <= 0 || avail <= 0) return 0;
  return Math.max(0, Math.floor(Math.max(0, avail - overhead(Math.floor(avail / perShotAll))) / perShotAll));
}

/** Plain-words notes the cabinet shows. */
export const leftoverNote = (usd: string) => `You have ${usd} of ammo loaded. Press LOCK & LOAD.`;
export const safeNote = (usd: string) => `Your ammo is safe in your gun (${usd}). Press LOCK & LOAD to try again.`;
