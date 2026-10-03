/** Packs: how many blasts one load fires. The browser fires them one after another, so keep packs modest. */
export const PACKS = [100, 1_000, 10_000] as const;

/**
 * Sats loaded per blast: the network fee for a ~224-byte tagged tx at 100 sat/kB (~23 sats,
 * src/lib/gun.ts) plus headroom. There is no margin for us: whatever is not burned in fees
 * goes back to the player on Unload.
 */
export const SATS_PER_BLAST = 30;

export const packSats = (blasts: number) => blasts * SATS_PER_BLAST;

export const usd = (sats: number, bsvUsd: number) => (sats / 1e8) * bsvUsd;

export const formatUsd = (v: number) =>
  v < 0.01 ? '<$0.01' : v < 100 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`;

export const formatCount = (n: number) =>
  n >= 1e6 && n % 1e5 === 0 ? `${n / 1e6}M` : n >= 1e3 && n % 100 === 0 ? `${n / 1e3}K` : n.toLocaleString();
