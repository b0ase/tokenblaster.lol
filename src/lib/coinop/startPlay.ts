/**
 * START with ammo already in the gun (owner, 26 Oct 2026: four START presses on /arcade/npg-arena logged only
 * "start pressed" + "no new coins" and the game never opened). The play payment (gun → house) waited on the
 * gun's queue with no timeout and no log, and every press stacked another wait behind it. Now: one start at a
 * time, each step logged, and a hung payment ends in a plain error after START_PAY_TIMEOUT_MS.
 *
 * Cancellable (26 Oct 2026, money-ok): the timeout ABORTS the pending payment (`pay` gets an AbortSignal and must
 * not broadcast once it is aborted). If it had already gone out and answers late, that play is CREDITED to the
 * player (`credit`), never charged again; until the late answer settles, START does not send another payment.
 */
export const START_PAY_TIMEOUT_MS = 15_000;

export type StartDeps = {
  pay: (signal: AbortSignal) => Promise<string>;
  open: (txid: string) => void;
  mark: (s: string) => void;
  /** A play paid after its START timed out: keep it for the player (e.g. as a prepaid play). */
  credit?: (txid: string) => void;
  timeoutMs?: number;
};

export const START_ABORTED = 'START_ABORTED';

let busy = false;
/** A timed-out payment that may still answer: no new payment until it has. */
let settling: Promise<unknown> | null = null;

/** Pay one play from the gun's credit, then open the game. Returns the txid, or null if a start is already running. */
export async function startPlay(d: StartDeps): Promise<string | null> {
  if (busy) {
    d.mark('start: already starting, waiting on the play payment');
    return null;
  }
  if (settling) {
    d.mark('start: the last play payment is still settling');
    throw new Error('Your last START is still finishing. If it went through, that play is kept for you. Press START again in a moment.');
  }
  busy = true;
  let t: ReturnType<typeof setTimeout> | undefined;
  const ac = new AbortController();
  const paid = d.pay(ac.signal);
  try {
    d.mark('start: paying one play from the gun');
    const txid = await Promise.race([
      paid,
      new Promise<never>((_, no) => {
        t = setTimeout(() => {
          no(new Error('The gun did not answer. Your credit is safe. Press START again.'));
          ac.abort(); // after the rejection above, so START reports the timeout, not the abort
        }, d.timeoutMs ?? START_PAY_TIMEOUT_MS);
      }),
    ]);
    d.mark(`start: play paid ${txid.slice(0, 8)}…`);
    d.open(txid);
    d.mark('playing');
    return txid;
  } catch (e) {
    d.mark(`start failed: ${e instanceof Error ? e.message : String(e)}`);
    if (ac.signal.aborted) {
      // Timed out: the payment was told to stop. If it had already gone out, credit it instead of charging again.
      const s = paid.then(
        (txid) => {
          d.mark(`start: late play payment ${txid.slice(0, 8)}… credited, not charged again`);
          d.credit?.(txid);
        },
        () => d.mark('start: timed-out play payment cancelled, nothing charged'),
      );
      const done: Promise<void> = s.finally(() => {
        if (settling === done) settling = null;
      });
      settling = done;
    }
    throw e;
  } finally {
    if (t) clearTimeout(t);
    busy = false;
  }
}

/** Tests only. */
export const _resetStartPlay = () => {
  busy = false;
  settling = null;
};
