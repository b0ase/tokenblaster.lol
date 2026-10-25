/**
 * The paid half of LOCK & LOAD (one-prompt play, #45): exactly ONE wallet request, the payment. The paid coin is
 * saved into the gun straight from the wallet's response, then the gun backup is handed off to run in the
 * background (never awaited here, so no other wallet sheet is ever chained to the payment).
 */
import type { Transaction } from '@bsv/sdk';
import { loadMark } from './gun';
import type { Wallet } from './wallet';

export type PayGun = { readonly address: string; load(funding: Transaction): Promise<void> | void };
export type PayDeps = {
  fund: (w: Wallet, address: string, sats: number, description: string) => Promise<Transaction>;
  /** Called once the coin is in the gun. Fire-and-forget: its result is never awaited. */
  afterPaid?: () => void;
  /** Right after the wallet answered (before anything else), e.g. close the waiting card. */
  onAnswered?: () => void;
};

export async function payIntoGun(w: Wallet, g: PayGun, sats: number, label: string, deps: PayDeps): Promise<Transaction> {
  const funding = await deps.fund(w, g.address, sats, label);
  loadMark('approved + paid (wallet answered)');
  deps.onAnswered?.();
  // The wallet has paid the gun's address: from here the money is in the gun whatever happens next.
  try {
    await g.load(funding);
    loadMark('gun has the coin');
  } catch (e) {
    loadMark(`paid, but saving the coin failed (${e instanceof Error ? e.message : e}); reading the balance instead`);
  }
  try {
    deps.afterPaid?.();
  } catch {
    /* the backup never affects the payment */
  }
  return funding;
}
