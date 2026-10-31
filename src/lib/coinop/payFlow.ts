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
 * ONE payment dialog for the whole LOCK & LOAD (owner, 31 Oct 2026: a centre "Approve in your wallet" and a bottom
 * "Checking whether your last payment reached the gun…" card showed together, both counting, both with Cancel, while
 * the wallet had not been asked anything yet). Pure, for CabinetModals and the tests.
 */
export type PayStep = 'prepare' | 'check' | 'connect' | 'approve' | 'paid';
type Waiting = { text: string; since: number; kind: 'discover' | 'connect' | 'pay'; step?: 'check' | 'connect' | 'approve' | 'paid' } | null;

/** The step the payment is really at. `prev` keeps "Paid" up in the gap between the wallet's answer and the start. */
export function payStep(waiting: Waiting, prev: PayStep | null): PayStep {
  if (waiting?.kind === 'pay' && waiting.step) return waiting.step;
  // A pay wait without a step is a request already sent to the wallet (older callers): never a false "check".
  if (waiting?.kind === 'pay') return 'approve';
  return prev === 'paid' ? 'paid' : 'prepare';
}

export const SAFE_CANCEL_NOTE = (wallet: string) => `If ${wallet} already paid, your money is in your game credit: you won't be charged twice.`;

export type PayDialogView = { step: PayStep; title: string; body: string; note: string | null; cancel: boolean };

/** What the one dialog says. Only 'approve' (the request has been sent) ever asks the player to approve. */
export function payDialogView(step: PayStep, walletName: string | null): PayDialogView {
  const name = walletName ?? 'your wallet';
  const safe = SAFE_CANCEL_NOTE(walletName ?? 'your wallet');
  switch (step) {
    case 'check':
      return { step, title: 'Checking your last payment', body: 'Checking your last payment… so you are never charged twice.', note: safe, cancel: true };
    case 'connect':
      return { step, title: 'Getting your payment ready', body: `Checking ${name} is connected…`, note: null, cancel: true };
    case 'approve':
      return { step, title: 'Approve in your wallet', body: `Approve the payment in ${name}. It's waiting for you.`, note: safe, cancel: true };
    case 'paid':
      return { step, title: 'Paid', body: 'Paid. Loading your gun…', note: null, cancel: false };
    default:
      return { step: 'prepare', title: 'Getting your payment ready', body: 'Getting your payment ready…', note: null, cancel: true };
  }
}

/** The site's bottom waiting card: hidden for a payment while an on-page payment dialog shows it instead. */
export function showWaitingCard(waiting: Waiting, payDialogs: number): boolean {
  if (!waiting) return false;
  return !(waiting.kind === 'pay' && payDialogs > 0);
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
