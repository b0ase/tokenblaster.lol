/**
 * Pay-per-action queue (the Chain Frogger pattern, made shareable): every in-game action is one real
 * transaction, tag + 1 sat (or 1 whole token) to the house + the network fee, chained from the
 * player's loaded gun in batches. `ask()` is synchronous and cheap, so a game loop can call it every
 * frame without stalling; the broadcast runs in the background drain. No payment code lives here:
 * `fire` is useBlaster's fireBatch / fireTokens.
 */
import { TOKEN_FEE } from './gun';

export const PER_ACTION = 1;
export const EST_FEE = 26; // sats: ~260-byte tx at 100 sat/kB (GorillaPool ARC minimum)
export const SAT_COST = PER_ACTION + EST_FEE;
export const SAT_LOADS = [1_000, 10_000, 100_000];
export const TOKEN_LOADS = [10, 100, 1_000];
export { TOKEN_FEE };

export type PayState = { live: boolean; tokens: boolean; sats: number; tokenAmmo: number; queued: number; halted: boolean };
export type Fire = (tokens: boolean, startN: number, batch: string[][]) => Promise<string[]>;
export type Events = { onSent: (n: number, last: string | null) => void; onError: (msg: string) => void; onNeed: (need: boolean) => void };

/** Whole actions the loaded ammo covers. */
export const actionsLoaded = (s: Pick<PayState, 'tokens' | 'sats' | 'tokenAmmo'>) =>
  s.tokens ? Math.max(0, Math.min(Math.floor(s.tokenAmmo), Math.floor(s.sats / TOKEN_FEE))) : Math.max(0, Math.floor(s.sats / SAT_COST));

export function createActionQueue(game: string, fire: Fire, ev: Events, outMsg: () => string) {
  const st: PayState = { live: false, tokens: false, sats: 0, tokenAmmo: 0, queued: 0, halted: false };
  const queue: string[][] = [];
  let draining = false;
  let counter = 0;
  let sent = 0;

  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const tokens = st.tokens;
      const batch = queue.slice(0, tokens ? 25 : 40);
      try {
        const txids = await fire(tokens, counter + 1, batch);
        counter += txids.length;
        sent += txids.length;
        queue.splice(0, txids.length);
        st.queued = queue.length;
        ev.onSent(sent, txids.length ? txids[txids.length - 1] : null);
        if (!txids.length) throw new Error(outMsg());
      } catch (e) {
        ev.onError(e instanceof Error ? e.message : String(e));
        st.halted = true;
        queue.length = 0;
        st.queued = 0;
        break;
      }
    }
    draining = false;
  };

  /** Ask to pay for one action. true = go ahead (always, in practice); false = out of ammo, refuse the action. */
  const ask = (action: string[]): boolean => {
    if (!st.live) return true;
    if (st.halted) return false;
    const n = st.queued + 1;
    if (actionsLoaded(st) < n) {
      ev.onNeed(true);
      return false;
    }
    ev.onNeed(false);
    queue.push([game, ...action]);
    st.queued = queue.length;
    void drain();
    return true;
  };

  const resume = () => {
    st.halted = false;
  };
  const setFire = (f: Fire) => {
    fire = f;
  };
  return { st, ask, resume, setFire, pending: () => queue.length };
}
export type ActionQueue = ReturnType<typeof createActionQueue>;
