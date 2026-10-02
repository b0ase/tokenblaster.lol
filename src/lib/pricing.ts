/** Packs: how many blasts you buy, priced in dollars (paid in sats at the live rate). */
export const PACKS = [1_000, 10_000, 100_000, 1_000_000] as const;

/**
 * Sats charged per blast: the network fee (~23 sats for a 224-byte tagged tx at 100 sat/kB,
 * blaster/blast.ts) plus a margin for the pack server. Tune once real packs run.
 */
export const SATS_PER_BLAST = 30;

export const packSats = (blasts: number) => blasts * SATS_PER_BLAST;

export const usd = (sats: number, bsvUsd: number) => (sats / 1e8) * bsvUsd;

export const formatUsd = (v: number) =>
  v < 0.01 ? '<$0.01' : v < 100 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`;

export const formatCount = (n: number) =>
  n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n);
