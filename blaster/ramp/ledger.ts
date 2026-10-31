/**
 * Spent-outputs ledger + UTXO state machine for the ramp (GorillaPool's asks, 27 Oct 2026):
 *  - never re-spend an output this run has already spent (`spend` throws; the journal survives a restart);
 *  - build only on outputs whose tx is SEEN or MINED ("unsettled" ones such as ANNOUNCED_TO_NETWORK or
 *    SEEN_IN_ORPHAN_MEMPOOL are never spent);
 *  - chains at most `maxDepth` unconfirmed txs deep (a mined output is depth 0, its child 1, …);
 *  - a tx that comes back REJECTED "missing inputs" (ARC's verdict on a dead orphan, ~1 h) is dead with all its
 *    descendants, and its unconfirmed ancestors too; their mined inputs are released so the run rebuilds from there.
 *    A release happens once per outpoint, and only for a spender the broadcaster has itself REJECTED.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export type UState = 'unsettled' | 'seen' | 'mined' | 'dead';
export type Utxo = { txid: string; vout: number; value: number; state: UState; depth: number };
export type TxRec = { txid: string; inputs: string[]; outputs: string[]; depth: number; state: UState; rejected?: boolean };

export const op = (txid: string, vout: number) => `${txid}:${vout}`;

export class Ledger {
  readonly utxos = new Map<string, Utxo>();
  readonly spent = new Map<string, string>(); // outpoint → spending txid
  readonly txs = new Map<string, TxRec>();
  private released = new Set<string>();
  /** Free outputs ready to build on, by state (insertion order = FIFO). */
  private free = { seen: new Set<string>(), mined: new Set<string>() };

  constructor(readonly opts: { maxDepth?: number; journal?: string } = {}) {
    if (opts.journal && existsSync(opts.journal)) {
      for (const line of readFileSync(opts.journal, 'utf8').split('\n')) {
        const [k, a, b] = line.split(' ');
        if (k === 'S' && a) this.spent.set(a, b ?? '?');
        if (k === 'R' && a) { this.spent.delete(a); this.released.add(a); }
      }
    }
  }

  get maxDepth() { return this.opts.maxDepth ?? 2; }
  private log(line: string) { if (this.opts.journal) appendFileSync(this.opts.journal, line + '\n'); }

  /** A confirmed coin (from the funding address, or a mined prep split). */
  addMined(txid: string, vout: number, value: number) {
    const k = op(txid, vout);
    if (this.utxos.has(k)) return;
    this.utxos.set(k, { txid, vout, value, state: 'mined', depth: 0 });
    if (!this.spent.has(k)) this.free.mined.add(k);
  }

  isSpent(k: string) { return this.spent.has(k); }

  /** Free outputs in `state`: mined coins feed fan-outs, seen ones feed blasts. */
  available(state: 'seen' | 'mined', max = Infinity, pick?: (u: Utxo) => boolean): Utxo[] {
    const out: Utxo[] = [];
    for (const k of this.free[state]) {
      const u = this.utxos.get(k);
      if (!u || u.state !== state || this.spent.has(k)) { this.free[state].delete(k); continue; }
      if (u.depth + 1 > this.maxDepth) { this.free[state].delete(k); continue; } // back via settle('mined')
      if (pick && !pick(u)) continue;
      out.push(u);
      if (out.length >= max) break;
    }
    return out;
  }
  count(state: 'seen' | 'mined', pick?: (u: Utxo) => boolean) { return this.available(state, Infinity, pick).length; }

  /**
   * Record a signed tx BEFORE it is sent: its inputs become spent (journalled), its outputs unsettled.
   * Throws (and records nothing) if an input is already spent, unknown, unsettled/dead, or the chain gets too deep.
   */
  spend(txid: string, inputs: string[], outputs: number[]): TxRec {
    let depth = 0;
    for (const k of inputs) {
      if (this.spent.has(k)) throw new Error(`re-spend refused: ${k} already spent by ${this.spent.get(k)}`);
      const u = this.utxos.get(k);
      if (!u) throw new Error(`unknown input ${k}`);
      if (u.state !== 'seen' && u.state !== 'mined') throw new Error(`input ${k} is ${u.state}: only SEEN or MINED outputs may be spent`);
      depth = Math.max(depth, u.depth + 1);
    }
    if (depth > this.maxDepth) throw new Error(`chain too deep: ${depth} > ${this.maxDepth}`);
    for (const k of inputs) {
      this.spent.set(k, txid);
      this.free.seen.delete(k);
      this.free.mined.delete(k);
      this.log(`S ${k} ${txid}`);
    }
    const outs = outputs.map((value, vout) => {
      const k = op(txid, vout);
      if (value > 0) this.utxos.set(k, { txid, vout, value, state: 'unsettled', depth }); // 0-sat OP_RETURN is no coin
      return k;
    });
    const rec: TxRec = { txid, inputs, outputs: outs, depth, state: 'unsettled' };
    this.txs.set(txid, rec);
    return rec;
  }

  /** Move a tx (and its outputs) along unsettled → seen → mined. Never backwards; dead is final. */
  settle(txid: string, s: 'seen' | 'mined') {
    const t = this.txs.get(txid);
    if (!t || t.state === 'dead' || t.state === 'mined' || (t.state === 'seen' && s === 'seen')) return;
    t.state = s;
    for (const k of t.outputs) {
      const u = this.utxos.get(k);
      if (!u || u.state === 'dead') continue;
      u.state = s;
      if (s === 'mined') u.depth = 0;
      if (!this.spent.has(k)) {
        this.free.seen.delete(k);
        this.free[s].add(k);
      }
    }
  }

  /**
   * Drop the in-memory records of a settled leaf tx (a blast whose outputs are never built on) to keep a
   * multi-million-tx run's memory flat. Its inputs stay in `spent` (and the journal), so nothing is ever re-spent.
   */
  forget(txid: string) {
    const t = this.txs.get(txid);
    if (!t) return;
    for (const k of t.outputs) { if (!this.spent.has(k)) { this.utxos.delete(k); this.free.seen.delete(k); this.free.mined.delete(k); } }
    for (const k of t.inputs) this.utxos.delete(k);
    this.txs.delete(txid);
  }

  /** The broadcaster refused this tx for good (400 / REJECTED / DOUBLE_SPEND). Its outputs and descendants die. */
  reject(txid: string) {
    const t = this.txs.get(txid);
    if (t) t.rejected = true;
    this.kill(txid);
  }

  private kill(txid: string) {
    const t = this.txs.get(txid);
    if (!t || t.state === 'dead') return;
    t.state = 'dead';
    for (const k of t.outputs) {
      const u = this.utxos.get(k);
      if (u) u.state = 'dead';
      this.free.seen.delete(k);
      this.free.mined.delete(k);
      const child = this.spent.get(k);
      if (child) this.kill(child);
    }
  }

  /**
   * REJECTED "missing inputs": the tx's unconfirmed ancestry is gone. Kill it, its descendants and its unsettled /
   * seen ancestors (whose own status the caller has confirmed is REJECTED or gone, `ancestorDead`). Mined inputs
   * of the oldest dead txs are released ONCE so the run can rebuild from that point. Returns the released outpoints.
   */
  missingInputs(txid: string, ancestorDead: (txid: string) => boolean): string[] {
    const released: string[] = [];
    const walk = (id: string) => {
      const t = this.txs.get(id);
      if (!t) return;
      t.rejected = true;
      this.kill(id);
      for (const k of t.inputs) {
        const u = this.utxos.get(k);
        if (!u) continue;
        if (u.state === 'mined' || (u.depth === 0 && !this.txs.has(u.txid))) {
          if (this.released.has(k)) continue;
          this.released.add(k);
          this.spent.delete(k);
          this.free.mined.add(k);
          this.log(`R ${k}`);
          released.push(k);
        } else if (this.txs.has(u.txid) && ancestorDead(u.txid)) {
          walk(u.txid);
        }
      }
    };
    walk(txid);
    return released;
  }
}
