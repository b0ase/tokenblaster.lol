/**
 * Live tx/s for the HUD: transactions ARC ACCEPTED per second over a short sliding window (owner, 25 Oct 2026:
 * the HUD must be honest; never the trigger's or the weapon's nominal rate). Feed it every accepted batch.
 */
export class TxMeter {
  private hits: { t: number; n: number }[] = [];
  constructor(private windowMs = 2000) {}
  add(n: number, t = Date.now()) {
    if (n > 0) this.hits.push({ t, n });
  }
  /** Accepted tx per second over the last window (0 once nothing has landed for a whole window). */
  rate(t = Date.now()): number {
    const from = t - this.windowMs;
    while (this.hits.length && this.hits[0].t < from) this.hits.shift();
    let n = 0;
    for (const h of this.hits) n += h.n;
    return Math.round((n * 1000) / this.windowMs);
  }
  reset() {
    this.hits = [];
  }
}
