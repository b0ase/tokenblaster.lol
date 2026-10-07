/**
 * Buyback & burn helpers shared by the vault job (server) and the burn displays (browser).
 * Pure: no keys, no network. The vault passes its own ledger calls in, so tests can mock them.
 */
import { SUPPLY, V0 } from './curve';

/** The vault buys once its free balance reaches this. */
export const BUYBACK_MIN = 100_000;
/** Never spend under this on one buyback (fees would eat it). */
export const BUYBACK_MIN_SPEND = 10_000;
/** Sats left in the vault for the network fee and fund outputs. */
export const BUYBACK_FEE_MARGIN = 2_000;

/**
 * How many sats one buyback spends: at most what keeps the price move under ~2%
 * (price ∝ V², so +0.995% of the virtual BSV reserve ≈ +2% price), never more than the vault's
 * free balance less a fee margin. 0 = don't buy this run.
 */
export function buybackSpend(reserveSats: number, free: number): number {
  if (free < BUYBACK_MIN) return 0;
  const v = Number(V0) + reserveSats;
  const maxNet = Math.floor(v * 0.00995);
  const spend = Math.min(free - BUYBACK_FEE_MARGIN, Math.floor(maxNet / 0.99));
  return spend >= BUYBACK_MIN_SPEND ? spend : 0;
}

/** Burned so far as a share of supply, and the supply left in circulation. */
export function burnStats(burned: number) {
  const supply = Number(SUPPLY);
  const b = Math.max(0, Math.min(burned, supply));
  return { burned: b, pct: (b / supply) * 100, supplyNow: supply - b };
}

export const fmtBurn = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));

/**
 * Book a burn that is already on chain. The ledger write is retried, because once the transaction
 * is broadcast the pool's old coins are spent: dropping the booking (or releasing the lease so a
 * trader can build on the old coins) would break the pool. If every try fails this throws a loud
 * error that names the txid, and the lease is deliberately kept (it expires on its own).
 */
export async function bookBroadcastBurn(txid: string, commit: () => Promise<unknown>, tries = 3, waitMs = 1_500): Promise<void> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await commit();
      return;
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error(`BURN BROADCAST BUT NOT BOOKED ${txid}: ${last instanceof Error ? last.message : String(last)}`);
}
