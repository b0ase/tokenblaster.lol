/**
 * $TERRORNODE settlement vs the gun lock (owner log, 31 Oct 2026 11:47): at session end the settlement asked for the
 * gun while the next LOCK & LOAD held it and failed with "Another TokenBlaster tab is using the gun" (there was one
 * tab). A busy gun is not a failure: wait and ask again with backoff. Anything else is a real error, thrown at once.
 * What still cannot run is persisted by the caller (src/components/gallery/useReceipts.ts) and retried on next load.
 */
/** src/lib/gun.ts GUN_BUSY (the gun lock is held by this tab's other work or another tab). */
export const GUN_BUSY_RE = /Another TokenBlaster tab is using the gun/;

export const SETTLE_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000];

export const isGunBusy = (e: unknown) => GUN_BUSY_RE.test(e instanceof Error ? e.message : String(e));

export async function withGunBusyRetry<T>(fn: () => Promise<T>, o: { delays?: number[]; sleep?: (ms: number) => Promise<void>; onWait?: (ms: number, attempt: number) => void } = {}): Promise<T> {
  const delays = o.delays ?? SETTLE_BACKOFF_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isGunBusy(e) || i >= delays.length) throw e;
      o.onWait?.(delays[i], i + 1);
      await sleep(delays[i]);
    }
  }
}

/** A settlement that could not run yet: kept in this browser and tried again on the next page load. */
export type PendingSettle = { recipient: string; session: string; handle: string; shownAs: string; at: number };
export const PENDING_SETTLE_KEY = 'tokenblaster.receipts.pending';
