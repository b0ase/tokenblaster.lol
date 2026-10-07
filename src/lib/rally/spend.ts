/**
 * Token Rally's spending model: in a LIVE race the car burns your loaded coin as fuel, and every burn is a real
 * on-chain transaction (the gun's tagged blast + 1 sat / 1 token to the house, src/lib/gun.ts). This file holds
 * only the rules and the queue; the transactions themselves are sent through the existing useBlaster paths
 * (fireBatch for SATS, fireTokens for a $TOKEN), exactly like Chain Frogger's payFor/drain.
 *
 *   FUEL   1 tx per FUEL_M metres driven with throttle on (about 2 to 4 txs/s), coast when dry
 *   NITRO  1 tx per burst + 1 tx per NITRO_TICK_S of a held burst
 *   DRIFT  1 tx per DRIFT_PTS drift points banked
 *   SPLIT  1 tx per checkpoint and the finish line
 */
export const FUEL_M = 10;
export const NITRO_TICK_S = 0.6;
export const DRIFT_PTS = 300;
/** Smallest tank worth starting a LIVE race with (about 400 m of road). */
export const MIN_START_ACTIONS = 20;
/** Extra actions a full stage needs beyond its fuel: nitro, drift and split txs. */
export const STAGE_EXTRAS = 60;

export type SpendKind = 'fuel' | 'nitro' | 'drift' | 'split';
export type SpendLine = { kind: SpendKind; tag: string; tx: string | null };

export const actionsForStage = (lengthM: number) => Math.ceil(lengthM / FUEL_M) + STAGE_EXTRAS;

/** Callbacks into the wallet layer. `send` returns the txids it managed to broadcast (a prefix of `batch`). */
export type SpendIO = {
  send: (startN: number, batch: string[][]) => Promise<string[]>;
  /** Can the wallet pay for `n` more actions (counting the ones still queued)? */
  canPay: (n: number) => boolean;
  batchMax: () => number;
  onChange: () => void;
};

/** Queue + drain, so a 60 fps game never waits on a transaction (Frogger's pattern, factored out). */
export class SpendMeter {
  private queue: { kind: SpendKind; tag: string }[] = [];
  private draining = false;
  private counter = 0;
  requested = 0;
  sent = 0;
  firstTx: string | null = null;
  lastTx: string | null = null;
  error: string | null = null;
  ticker: SpendLine[] = [];
  byKind: Record<SpendKind, number> = { fuel: 0, nitro: 0, drift: 0, split: 0 };
  private idle: (() => void)[] = [];
  constructor(private io: SpendIO) {}

  get queued() {
    return this.queue.length;
  }

  /** New race: zero the per-race counters (a queue still draining from the last race just finishes). */
  reset() {
    this.requested = 0;
    this.sent = 0;
    this.firstTx = null;
    this.lastTx = null;
    this.error = null;
    this.ticker = [];
    this.byKind = { fuel: 0, nitro: 0, drift: 0, split: 0 };
    this.io.onChange();
  }

  /** Ask to pay for an action. False = can't afford it (the car runs dry). */
  request(kind: SpendKind, tag: string): boolean {
    if (!this.io.canPay(this.queue.length + 1)) return false;
    this.queue.push({ kind, tag });
    this.requested++;
    void this.drain();
    return true;
  }

  /** Resolves once everything queued has been sent (or failed). */
  whenIdle(): Promise<void> {
    if (!this.draining && !this.queue.length) return Promise.resolve();
    return new Promise((ok) => this.idle.push(ok));
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.slice(0, Math.max(1, this.io.batchMax()));
        try {
          const txids = await this.io.send(this.counter + 1, batch.map((a) => ['rally', a.kind, a.tag]));
          this.counter += txids.length;
          this.queue.splice(0, txids.length);
          this.sent += txids.length;
          txids.forEach((tx, i) => {
            this.byKind[batch[i].kind]++;
            this.ticker.push({ kind: batch[i].kind, tag: batch[i].tag, tx });
          });
          this.ticker = this.ticker.slice(-6);
          if (txids.length) {
            this.firstTx ??= txids[0];
            this.lastTx = txids[txids.length - 1];
            this.error = null;
          } else throw new Error('Out of fuel: load more to keep driving.');
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e);
          this.queue.length = 0;
        }
        this.io.onChange();
      }
    } finally {
      this.draining = false;
      const w = this.idle;
      this.idle = [];
      w.forEach((f) => f());
    }
  }
}
