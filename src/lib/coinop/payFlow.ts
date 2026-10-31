/**
 * LOCK & LOAD with no wallet yet connects first, then pays (owner, 25 Oct 2026). Pure, for the cabinet and the tests.
 *
 * The "pay once connected" intent must not outlive the connect attempt: if the player closes the chooser, cancels,
 * or the connect fails, the intent is dropped. Otherwise a later, unrelated Connect (top bar) would pop a payment
 * sheet the player never asked for at that moment.
 */
export type ConnectState = { hasWallet: boolean; chooserOpen: boolean; busy: boolean; waiting: boolean };

/** True when a pending "pay after connect" should be dropped: nothing is connecting any more and no wallet came. */
export function connectAttemptOver(s: ConnectState): boolean {
  return !s.hasWallet && !s.chooserOpen && !s.busy && !s.waiting;
}

/**
 * The amount picked is the amount asked for (owner, 31 Oct 2026: picked $1, LOCK & LOAD ran, the wallet was only
 * charged $0.10). An earlier payment whose outcome was unknown (timed out, cancelled while open, or still in flight)
 * may stand in for a new press ONLY when it asked for the same amount. Otherwise the earlier one, if it paid, is just
 * credit already in the gun, and the new press asks the wallet for exactly what was picked.
 */
export function earlierPayCovers(earlierSats: number | null | undefined, sats: number): boolean {
  if (earlierSats == null || !(earlierSats > 0) || !(sats > 0)) return false;
  // The same dollar amount turns into slightly different sats as the live BSV price moves between a press and its
  // Retry: within 3% is the same request (a Retry must never charge twice); $0.10 vs $1.00 never is.
  return Math.abs(earlierSats - sats) <= Math.max(1, Math.max(earlierSats, sats) * 0.03);
}
