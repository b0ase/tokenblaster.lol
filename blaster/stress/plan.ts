/**
 * Stress-test planning: pure maths, no network. Used by the stress CLI and its tests.
 *
 * A blast is 1-in-2-out: P2PKH in, OP_RETURN "tokenblaster.lol" <token> <c:n> <game> + P2PKH change.
 * ~235 bytes signed. Fee per blast = ceil(bytes * feeRate / 1000) sats.
 */
export const BLAST_BYTES = 260; // 235 typical; the c:n tag + DER signature grow it, and ARC rejected ~10% at 24 sats (smoke test 24 Oct)
export const FAN_INPUT_BYTES = 150;
export const FAN_OUTPUT_BYTES = 34;

export const blastFee = (feeRate: number, bytes = BLAST_BYTES) => Math.max(1, Math.ceil((bytes * feeRate) / 1000));

export type Plan = {
  count: number;          // txs to make
  chains: number;         // independent chains
  depth: number;          // longest chain
  feeRate: number;        // sat/kB
  feePerTx: number;       // sats
  fanFee: number;         // sats for the fan-out
  totalSats: number;      // everything this run can spend (fees + 2-sat dust per chain end)
  usd: number;            // at bsvUsd
  secsAtRate: number;     // wall time at `rate` tx/s (0 if no rate)
};

export function plan(o: { count: number; chains: number; feeRate: number; inputs?: number; rate?: number; bsvUsd?: number; maxDepth?: number }): Plan {
  const count = Math.max(0, Math.floor(o.count));
  let chains = Math.max(1, Math.min(Math.floor(o.chains), Math.max(1, count)));
  // keep every chain under maxDepth (ARC/node ancestor limits): add chains rather than deepen them
  if (o.maxDepth && Math.ceil(count / chains) > o.maxDepth) chains = Math.ceil(count / o.maxDepth);
  const depth = Math.ceil(count / chains);
  const feePerTx = blastFee(o.feeRate);
  const fanFee = Math.ceil((((o.inputs ?? 1) * FAN_INPUT_BYTES + chains * FAN_OUTPUT_BYTES + 100) * o.feeRate) / 1000) + 10;
  const totalSats = count * feePerTx + chains * 2 + fanFee;
  const usd = (totalSats / 1e8) * (o.bsvUsd ?? 17.4);
  return { count, chains, depth, feeRate: o.feeRate, feePerTx, fanFee, totalSats, usd, secsAtRate: o.rate ? count / o.rate : 0 };
}

/** Cost of N txs at a fee rate, in sats and USD. */
export const costOf = (txs: number, feeRate: number, bsvUsd = 17.4) => {
  const sats = txs * blastFee(feeRate);
  return { sats, bsv: sats / 1e8, usd: (sats / 1e8) * bsvUsd };
};

/** Hard caps. Any breach stops the run (no new sends; in-flight batches finish). */
export type Caps = { maxSats: number; maxTxs: number; maxRejectRatio: number; minWindow: number };

export function checkPlan(p: Plan, caps: Caps): string | null {
  if (p.count > caps.maxTxs) return `plan has ${p.count} txs, cap is ${caps.maxTxs}`;
  if (p.totalSats > caps.maxSats) return `plan spends up to ${p.totalSats} sats, cap is ${caps.maxSats}`;
  return null;
}

/** Live guard: call after every batch result. Returns a reason to stop, or null. */
export class Guard {
  sent = 0; accepted = 0; rejected = 0; sats = 0;
  private win: boolean[] = [];
  constructor(private caps: Caps, private feePerTx: number) {}
  record(ok: number, bad: number): string | null {
    this.sent += ok + bad; this.accepted += ok; this.rejected += bad; this.sats += ok * this.feePerTx;
    for (let i = 0; i < ok; i++) this.win.push(true);
    for (let i = 0; i < bad; i++) this.win.push(false);
    if (this.win.length > 2000) this.win.splice(0, this.win.length - 2000);
    return this.check();
  }
  /** Would sending `n` more break a cap? */
  allows(n: number): string | null {
    if (this.sent + n > this.caps.maxTxs) return `max txs ${this.caps.maxTxs} reached`;
    if (this.sats + n * this.feePerTx > this.caps.maxSats) return `max sats ${this.caps.maxSats} reached`;
    return null;
  }
  check(): string | null {
    if (this.sats > this.caps.maxSats) return `spent ${this.sats} sats > cap ${this.caps.maxSats}`;
    if (this.win.length >= this.caps.minWindow) {
      const bad = this.win.filter((x) => !x).length / this.win.length;
      if (bad > this.caps.maxRejectRatio) return `reject ratio ${(bad * 100).toFixed(1)}% over last ${this.win.length} > ${(this.caps.maxRejectRatio * 100).toFixed(0)}%`;
    }
    return null;
  }
}

/** Token bucket: `take(n)` resolves when n tokens are available at `rate` per second (rate 0 = unlimited). */
export class RateLimiter {
  private tokens: number; private last: number;
  constructor(private rate: number, private burst = Math.max(1, rate), private now: () => number = Date.now, private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
    this.tokens = this.burst; this.last = this.now();
  }
  private refill() { const t = this.now(); this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate); this.last = t; }
  waitMs(n: number): number { if (!this.rate) return 0; this.refill(); return this.tokens >= n ? 0 : ((n - this.tokens) / this.rate) * 1000; }
  async take(n: number) {
    if (!this.rate) return;
    for (;;) { const w = this.waitMs(n); if (w <= 0) { this.tokens -= n; return; } await this.sleep(Math.min(w, 1000)); }
  }
}

/** Split `count` over `chains` the same way the signer does. */
export const quota = (count: number, chains: number, c: number) => Math.floor(count / chains) + (c < count % chains ? 1 : 0);
