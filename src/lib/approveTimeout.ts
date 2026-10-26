/**
 * Our own wait for the wallet's approval (owner, 26 Oct 2026): when bWalletX never shows its sheet the player sat
 * frozen behind "Waiting for bWalletX…" for the wallet module's 3 min. The game now stops waiting after 20 s and
 * offers Retry / Cancel. The wallet call itself is never cancelled by the timer: if it answers late with a paid tx,
 * that payment is honoured (the coin is in the gun), never charged again.
 */

/** How long the game waits for the wallet's approval before showing "didn't respond" + Retry. */
export const APPROVE_TIMEOUT_MS = 20_000;

/**
 * bWalletX (yours-mobile #355) rejects createAction itself when its sheet never showed (ERR_PROMPT_NOT_SHOWN, 503,
 * ~8 s) or the player never answered it (ERR_PROMPT_EXPIRED, 408, 60 s). Both mean "didn't respond", not a refusal:
 * the game shows Retry / Cancel at once instead of a generic failure.
 */
export const NO_PROMPT_CODES = ['ERR_PROMPT_NOT_SHOWN', 'ERR_PROMPT_EXPIRED'] as const;
export function isPromptNoResponse(e: unknown): boolean {
  if (!e) return false;
  const o = (typeof e === 'object' ? e : {}) as { code?: unknown; status?: unknown; message?: unknown };
  const text = `${String(o.code ?? '')} ${typeof e === 'string' ? e : String(o.message ?? '')}`;
  if (NO_PROMPT_CODES.some((c) => text.includes(c))) return true;
  const status = Number(o.status);
  return (status === 503 || status === 408) && /prompt/i.test(text);
}

/** A wallet request that outlived our timer. `done` settles when the request finally does. */
export type LatePay<T> = { state: 'pending' | 'paid' | 'failed'; value?: T; done: Promise<void> };

/**
 * Race the wallet's answer against `ms`. An answer (or refusal) in time is returned / thrown as usual. On timeout the
 * request keeps running: its outcome is tracked in `late` (and `onLate` runs if it pays).
 */
export function raceApproval<T>(p: Promise<T>, ms: number, onLate?: (v: T) => void): Promise<{ kind: 'paid'; value: T } | { kind: 'timeout'; late: LatePay<T> }> {
  return new Promise((ok, no) => {
    let timedOut = false;
    const late: LatePay<T> = { state: 'pending', done: Promise.resolve() };
    late.done = p.then(
      (v) => {
        late.state = 'paid';
        late.value = v;
        if (timedOut) onLate?.(v);
      },
      () => {
        late.state = 'failed';
      },
    );
    const t = setTimeout(() => {
      timedOut = true;
      ok({ kind: 'timeout', late });
    }, ms);
    p.then(
      (value) => {
        if (timedOut) return;
        clearTimeout(t);
        ok({ kind: 'paid', value });
      },
      (e) => {
        if (timedOut) return;
        clearTimeout(t);
        // The wallet says its prompt never showed / expired: same as our own timeout (Retry checks before re-sending).
        if (isPromptNoResponse(e)) {
          timedOut = true;
          late.state = 'failed';
          ok({ kind: 'timeout', late });
          return;
        }
        no(e);
      },
    );
  });
}

/**
 * Retry after a timeout, never a double charge. In order:
 *  1. the late request already paid → 'paid' (no new request);
 *  2. the gun's chain balance shows the payment → 'paid' (the hung request is dropped);
 *  3. balance unreadable → 'unknown' (do NOT re-send: we can't prove it didn't pay);
 *  4. otherwise drop the hung request (frees the wallet queue), and if it paid in that instant → 'paid',
 *     else 'resend' (the caller sends the same request again).
 */
export async function retryDecision<T>(
  late: LatePay<T>,
  deps: { paidOnChain: () => Promise<boolean | null>; cancelHung: () => void },
): Promise<'paid' | 'unknown' | 'resend'> {
  if (late.state === 'paid') return 'paid';
  const onChain = await deps.paidOnChain();
  if ((late.state as LatePay<T>['state']) === 'paid' || onChain === true) {
    if (late.state === 'pending') deps.cancelHung();
    return 'paid';
  }
  if (onChain === null) return 'unknown';
  if (late.state === 'pending') {
    deps.cancelHung();
    await Promise.race([late.done, new Promise((r) => setTimeout(r, 3000))]);
    if (late.state === 'pending') return 'unknown'; // still hung: never stack a second request on it
  }
  return (late.state as LatePay<T>['state']) === 'paid' ? 'paid' : 'resend';
}
