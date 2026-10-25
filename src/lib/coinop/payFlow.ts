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
