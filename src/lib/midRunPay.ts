/**
 * MID-RUN RELOAD (owner, live 31 Oct 2026 07:31): out of rounds mid-fight, the player picked $1.00 RELOAD while the
 * monsters kept hitting, and got "THAT DID NOT GO THROUGH … bWalletX said: WALLET_HELD_DURING_PLAY". The page's own
 * play hold (src/lib/wallet.ts holdWalletForPlay) and the storm session's hold refused the payment before it reached
 * the wallet. A reload now runs in this order, always:
 *   1. pause the game at once (world frozen, no damage),
 *   2. stop the round sender,
 *   3. release the wallet (end the storm session cleanly, drop the round's play hold),
 *   4. only then ask the wallet to pay,
 *   5. paid: resume with the new rounds; anything else: stay paused with a plain-words message.
 * Pure orchestration (deps injected) so the order is tested (src/lib/midRunPay.test.ts).
 */
export type MidRunPayDeps = {
  pause: () => void;
  stopSender: () => void;
  /** End the storm session and drop every play hold. Resolves once the wallet is free. */
  releaseWallet: () => Promise<void>;
  walletHeld: () => boolean;
  /** Optional: wait up to this long (ms) for the last holder to let go before giving up (default 3 s). */
  freeWaitMs?: number;
  /** Ask the wallet for the payment. Resolves true when paid. */
  pay: () => Promise<boolean>;
  resume: () => Promise<void> | void;
  /** Plain words for the player; the game stays paused. */
  fail: (msg: string) => void;
};

export const RELOAD_STILL_HELD = 'The game could not free your wallet for the payment. Nothing was charged. Press RELOAD again, or end the round and use LOCK & LOAD.';

export async function midRunReload(d: MidRunPayDeps): Promise<'paid' | 'failed'> {
  d.pause();
  d.stopSender();
  try {
    await d.releaseWallet();
  } catch {
    /* checked below */
  }
  // A storm's own hold drops a moment after its session ends (its finally runs on a later turn): wait for it, briefly.
  const until = Date.now() + (d.freeWaitMs ?? 3000);
  while (d.walletHeld() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  if (d.walletHeld()) return (d.fail(RELOAD_STILL_HELD), 'failed');
  let ok = false;
  try {
    ok = await d.pay();
  } catch (e) {
    d.fail(playerWords(e instanceof Error ? e.message : String(e)) ?? 'The payment did not complete. Nothing was charged. Press RELOAD to try again.');
    return 'failed';
  }
  if (!ok) return 'failed'; // cancelled or refused: the cabinet dialog already said so; the game stays paused
  await d.resume();
  return 'paid';
}

/** Raw wallet / internal codes never reach a player: plain words for the ones we know, nothing for the rest. */
/**
 * May the credit-to-rounds auto-load (or any LOCK & LOAD) start now? Never while a mid-run RELOAD payment is open or
 * the game is paused for it (owner log, 31 Oct 2026 11:46: the auto-load started a new storm session during the
 * RELOAD, its 'storm' hold came back on, and the wallet refused the payment with WALLET_HELD_DURING_PLAY x3).
 */
export const loadAllowed = (s: { midPay: boolean; paused: boolean }) => !s.midPay && !s.paused;

export function playerWords(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/WALLET_HELD_DURING_PLAY/.test(raw)) return 'The game was still using your wallet. It is paused now: press RELOAD again to pay.';
  if (/WALLET_TIMEOUT/.test(raw)) return 'Your wallet did not answer in time. Nothing was charged. Try again.';
  if (/WALLET_CANCELLED|cancel/i.test(raw)) return 'You cancelled the payment. Nothing was charged.';
  // A bare code (SHOUTY_SNAKE_CASE, an HTTP-ish code) is not words: hide it.
  if (/^[A-Z0-9_:.\- ]{4,}$/.test(raw.trim()) || /\b[A-Z]+(_[A-Z]+){1,}\b/.test(raw)) return null;
  return raw;
}
