/**
 * UNLOAD / "Send back to my wallet" (owner, 31 Oct 2026): sweep a game-credit key's coins to the player's own wallet
 * address. The coins come from the full chain read (/api/coins: WhatsOnChain, every page, src/lib/creditRead.ts).
 * A storm leaves thousands of 6-sat lane ends; a coin worth less than the fee to spend it is left (it would cost the
 * player money to move), everything else goes in one transaction.
 */
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction } from '@bsv/sdk';

export const SWEEP_FEE_RATE = 100; // sats/kB, the gun's rate
/** A P2PKH input is ~148 bytes: at 100 sat/kB it costs ~15 sats to spend. */
export const INPUT_COST = Math.ceil((148 * SWEEP_FEE_RATE) / 1000);
/** Most inputs in one sweep (the largest coins first); run it again for the rest. */
export const MAX_SWEEP_INPUTS = 500;

export type SweepCoin = { tx: Transaction; vout: number };
const sats = (c: SweepCoin) => c.tx.outputs[c.vout]?.satoshis ?? 0;

/** The coins worth sweeping: more than they cost to spend, not tokens (1 sat), largest first, one per outpoint. */
export function sweepable(coins: SweepCoin[]): SweepCoin[] {
  const seen = new Set<string>();
  return coins
    .filter((c) => {
      const k = `${c.tx.id('hex')}_${c.vout}`;
      if (seen.has(k) || sats(c) <= Math.max(1, INPUT_COST)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => sats(b) - sats(a))
    .slice(0, MAX_SWEEP_INPUTS);
}

/** Sign one tx paying every sweepable coin (less the fee) to `to`. Null when there is nothing worth sending. */
export async function buildSweep(key: PrivateKey, coins: SweepCoin[], to: string): Promise<{ tx: Transaction; sats: number; inputs: number } | null> {
  const use = sweepable(coins);
  const total = use.reduce((n, c) => n + sats(c), 0);
  if (total < 50) return null;
  const tx = new Transaction();
  for (const c of use) tx.addInput({ sourceTransaction: c.tx, sourceOutputIndex: c.vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
  tx.addOutput({ lockingScript: new P2PKH().lock(to), change: true });
  await tx.fee(new SatoshisPerKilobyte(SWEEP_FEE_RATE));
  await tx.sign();
  return { tx, sats: tx.outputs[0].satoshis ?? 0, inputs: use.length };
}
