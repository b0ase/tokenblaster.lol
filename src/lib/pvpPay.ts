/**
 * The Arena's PvP payment rule, shared: "hit another player in LIVE mode and your token lands in their gun".
 *
 * Extracted unchanged from src/components/Arena.tsx (the shooting drain):
 *  - Shots queue as { extra, to?, target? }. `to` is the target's gun address (from room presence), `target` their
 *    player id. Shots with no `to` are ordinary blasts (burned / house, per game).
 *  - The drain sends one destination per batch: the leading run of shots with the same `to`, capped at maxRun.
 *  - Token mode: fireTokens(startN, extras.slice(0, 25), to): one whole token per shot, sent to the target's gun
 *    (fireTokens burns when `to` is undefined). Sats mode: fireBatch(startN, extras): a tagged blast, nothing to the
 *    target (the Arena never paid sats to players).
 *  - After a paid batch with a target, the shooter broadcasts a 'hit' so the target sees "+n $SYM in your gun".
 *  - Errors: an empty gun (/out of|empty|no tokens|no sats|load/i) stops at once; anything else retries quietly with
 *    1s, 2s, 3s back-off, then stops. Stopping clears the queue.
 *
 * No payment code lives here: the senders are useBlaster's fireBatch / fireTokens, passed in. Nothing signs here.
 */

/** Anything with a destination: `to` = a gun address (none = the game's default sink), `target` = the player id. */
export type Routed = { to?: string; target?: string };
export type PvpShot = Routed & { extra: string[] };

/** useBlaster's two senders (see src/lib/useBlaster.ts). */
export type PvpFire = {
  fireBatch(startN: number, extras: string[][]): Promise<string[]>;
  fireTokens(startN: number, extras: string[][], to?: string): Promise<string[]>;
};

export const ARENA_BATCH = 50; // shots per ARC request (Arena)
export const TOKEN_CHAIN_MAX = 25; // token shots per request

/** Empty gun: a real stop, not a retry. */
export const isEmptyGun = (msg: string) => /out of|empty|no tokens|no sats|load/i.test(msg);

/** How many leading shots share the first shot's destination (capped at `max`, at least 1 when non-empty). */
export function leadingRun(queue: readonly { to?: string }[], max: number): number {
  if (!queue.length) return 0;
  let run = 1;
  while (run < queue.length && run < max && queue[run].to === queue[0].to) run++;
  return run;
}

/** The Arena's send: token mode pays the target's gun (or burns), sats mode is a plain tagged blast. */
export function arenaSend(fire: PvpFire, tokenMode: boolean, startN: number, extras: string[][], to: string | undefined): Promise<string[]> {
  return tokenMode ? fire.fireTokens(startN, extras.slice(0, TOKEN_CHAIN_MAX), to) : fire.fireBatch(startN, extras);
}

/** The 'hit' broadcast the shooter sends once a batch at a player has paid. */
export type HitMsg = { to: string; from: string; n: number; tokens: boolean; sym?: string; icon?: string | null; txid: string };
export function hitMsg(target: string, from: string, txids: string[], tokens: boolean, tk: { sym: string; icon: string | null } | null | undefined): HitMsg {
  return { to: target, from, n: txids.length, tokens, sym: tk?.sym, icon: tk?.icon, txid: txids[txids.length - 1] };
}

export type PvpQueueOpts<S extends Routed = PvpShot> = {
  /** Send one batch (all to the same `to`). */
  send(startN: number, batch: S[], to: string | undefined): Promise<string[]>;
  /** Max shots per batch (a function when it depends on the current mode). */
  maxRun: number | (() => number);
  /** Quiet retries before giving up on a non-empty error (Arena: 3). */
  retries: number;
  /** Message thrown when a send returns no txids. */
  emptyMsg: string;
  /** A batch went out (txids may be empty: the empty-gun stop follows). The queue is already trimmed and `sent` counted. */
  onPaid(txids: string[], batch: S[], to: string | undefined, target: string | undefined, state: { sent: number; pending: number }): void;
  /** Gave up: the queue has been cleared. */
  onFail(msg: string): void;
  /** After each successful batch, and when the drain ends (Arena: heat = queue.length). */
  onIdle?(): void;
  /** Back-off sleep (tests pass a fast one). */
  wait?(ms: number): Promise<void>;
};

/** The Arena's background drain as a reusable queue. push() + drain() from the game loop; it never blocks a frame. */
export function createPvpQueue<S extends Routed = PvpShot>(o: PvpQueueOpts<S>) {
  const queue: S[] = [];
  let draining = false;
  let fails = 0;
  let n = 0; // shots on chain so far (the next tag counter is n + 1)
  const wait = o.wait ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const run = leadingRun(queue, typeof o.maxRun === 'function' ? o.maxRun() : o.maxRun);
      const batch = queue.slice(0, run);
      const to = batch[0].to;
      const target = batch[0].target;
      try {
        const txids = await o.send(n + 1, batch, to);
        n += txids.length;
        queue.splice(0, txids.length);
        o.onPaid(txids, batch, to, target, { sent: n, pending: queue.length });
        fails = 0;
        if (!txids.length) throw new Error(o.emptyMsg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!isEmptyGun(msg) && ++fails <= o.retries) {
          await wait(1000 * fails);
          continue;
        }
        fails = 0;
        queue.length = 0;
        o.onFail(msg);
        break;
      }
      o.onIdle?.();
    }
    o.onIdle?.();
    draining = false;
  };
  return {
    queue,
    push(s: S) {
      queue.push(s);
    },
    drain,
    /** A new run: forget queued shots and restart the tag counter (a drain in flight finishes its current batch). */
    reset() {
      queue.length = 0;
      n = 0;
      fails = 0;
    },
    get sent() {
      return n;
    },
    get busy() {
      return draining;
    },
  };
}
export type PvpQueue<S extends Routed = PvpShot> = ReturnType<typeof createPvpQueue<S>>;

/**
 * Pay a killer once per death (Token Snake). A death message is broadcast several times; `did` dedupes. The Arena pays
 * per hit; a snake kill is one hit, so the victim's client queues exactly one Arena shot at the killer's gun.
 * Returns true when a shot was queued.
 */
export function createKillPay(o: { game: string; push(s: PvpShot): void; live(): boolean }) {
  const paid = new Set<string>();
  return {
    paid,
    onKilled(did: string, killerId: string | null, killerGun: string | undefined): boolean {
      if (!did || !killerId || paid.has(did)) return false;
      paid.add(did);
      if (paid.size > 500) {
        const first = paid.values().next().value;
        if (first !== undefined) paid.delete(first);
      }
      if (!o.live() || !killerGun) return false; // practice sends nothing; no gun known, nothing to pay
      o.push({ extra: [o.game, 'player', killerId], to: killerGun, target: killerId });
      return true;
    },
  };
}
