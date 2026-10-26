/**
 * START with ammo already in the gun (owner, 26 Oct 2026: four START presses on /arcade/npg-arena logged only
 * "start pressed" + "no new coins" and the game never opened). The play payment (gun → house) waited on the
 * gun's queue with no timeout and no log, and every press stacked another wait behind it. Now: one start at a
 * time, each step logged, and a hung payment ends in a plain error after START_PAY_TIMEOUT_MS.
 */
export const START_PAY_TIMEOUT_MS = 15_000;

export type StartDeps = {
  pay: () => Promise<string>;
  open: (txid: string) => void;
  mark: (s: string) => void;
  timeoutMs?: number;
};

let busy = false;

/** Pay one play from the gun's credit, then open the game. Returns the txid, or null if a start is already running. */
export async function startPlay(d: StartDeps): Promise<string | null> {
  if (busy) {
    d.mark('start: already starting, waiting on the play payment');
    return null;
  }
  busy = true;
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    d.mark('start: paying one play from the gun');
    const txid = await Promise.race([
      d.pay(),
      new Promise<never>((_, no) => {
        t = setTimeout(() => no(new Error('The gun did not answer. Your credit is safe. Press START again.')), d.timeoutMs ?? START_PAY_TIMEOUT_MS);
      }),
    ]);
    d.mark(`start: play paid ${txid.slice(0, 8)}…`);
    d.open(txid);
    d.mark('playing');
    return txid;
  } catch (e) {
    d.mark(`start failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    if (t) clearTimeout(t);
    busy = false;
  }
}
