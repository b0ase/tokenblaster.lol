/**
 * Nothing asks the wallet on page load (owner, 25 Oct 2026, after #95: "Waiting for bWalletX… 24s" appeared as soon as
 * TERRORNODE loaded). The gun restore used to run from a useEffect the moment the site wallet appeared, which on a page
 * load is the SILENT resume, so it reached the wallet (createSignature) with nobody having pressed anything.
 *
 * Now the restore (and the backup after it) only runs for a player's press on a button that needs the wallet:
 * LOCK & LOAD, UNLOAD or Connect. A mount or a silent resume is a no-op here: no wallet call, no waiting card.
 * A restore that fails stays invisible apart from the debug log line.
 */
import type { GunLike, RestoreResult } from './gunBackup';
import type { Wallet } from './wallet';

/** Why we might ask: a page mount / silent resume (never asks), or the player pressed a wallet button. */
export type RestoreTrigger = 'mount' | 'resume' | 'press';
export type GateResult = RestoreResult | 'skip' | 'error';

export const mayAskWallet = (t: RestoreTrigger) => t === 'press';

/**
 * One restore per (identity, gun) per page, and only on a press. `restore` is restoreGunIfNeeded (injected for tests).
 */
export function restoreGate() {
  let done: string | null = null;
  return async function run(
    trigger: RestoreTrigger,
    w: Pick<Wallet, 'client' | 'publicKey'> | null,
    g: GunLike | null,
    restore: (w: Pick<Wallet, 'client' | 'publicKey'>, g: GunLike) => Promise<RestoreResult>,
  ): Promise<GateResult> {
    if (!mayAskWallet(trigger) || !w || !g) return 'skip';
    const id = `${w.publicKey}:${g.address}`;
    if (done === id) return 'skip';
    done = id;
    try {
      return await restore(w, g);
    } catch {
      return 'error';
    }
  };
}
