/**
 * What the player reads when a paid load can't turn into a game (owner, 31 Oct 2026: "it stole my money").
 * The money is in the player's own game credit (the gun, src/lib/gun.ts): every dead end says so and offers
 * PLAY or UNLOAD, never "nothing was charged" when something was. Pure, so the tests pin the words.
 */
import { fmtCredit } from './credit';

/** The page that walks a player through getting credit back (old guns, wallet backup, key file). */
export const RECOVERY_URL = '/arcade/gun-recovery';

/** The safe line for a dead end (engine stuck, crash, lost context), from the credit the chain shows. */
export function safeCreditLine(usd: number | null): string {
  if (usd === null) return 'If you paid, your money is in your game credit on this device, not lost. Reload to PLAY or UNLOAD it back to your wallet.';
  if (usd <= 0) return 'Nothing is in your game credit on this device.';
  return `Your ${fmtCredit(usd)} is safe in your game credit. PLAY or UNLOAD it back to your wallet.`;
}

/** A restore that found nothing here is said out loud, with where to go next. */
export function missingCreditLine(kind: 'missing' | 'unchecked'): string {
  return kind === 'missing'
    ? 'Credit not found on this device. Your wallet has an earlier game credit that could not be restored here.'
    : 'Could not check your wallet for earlier game credit right now.';
}

/** The CREDIT counter could not be read from the chain: say it is unknown, not gone. */
export const CREDIT_UNKNOWN_LINE = "Couldn't read your credit from the chain just now. It isn't lost: checking again…";
