/**
 * TERRORNODE sweep: pure logic (no network, no keys). Finds the lanes a stopped stress run left unspent and plans
 * consolidation txs (many lane inputs → one output back to the stress address).
 *
 * Safety rules:
 *  - only runs whose summary.json exists (finished) are swept; the newest live-* dir without one is a run in
 *    progress and is never touched; an older unfinished dir can be opted in by name (--include).
 *  - only outputs under `maxCoin` sats (lanes) are taken by default: live runs pick funding coins ≥ 10,000 sats from
 *    the wallet, so a fan-out's change could be a running run's next coin.
 *  - a lane is dropped when any check (journals, GorillaPool spends, WoC) calls it spent.
 */
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export type Coin = { txid: string; vout: number; value: number };
export const op = (c: { txid: string; vout: number }) => `${c.txid}:${c.vout}`;

/** P2PKH input with a worst-case 73-byte signature + 33-byte key: 32 + 4 + 1 + 107 + 4 = 148 bytes. */
export const INPUT_BYTES = 148;
/** Cost of spending one lane at `satsPerKb`. */
export const inputCost = (satsPerKb: number) => (INPUT_BYTES * satsPerKb) / 1000;

export type RunDir = { name: string; finished: boolean; newest: boolean; fanouts: { bot: string; txid: string }[] };
export type RunPick = { swept: RunDir[]; skipped: { run: RunDir; why: string }[] };

/** Every live-* dir under `dir`, oldest first (names sort by timestamp). */
export function listRuns(dir: string): RunDir[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((x) => /^live-/.test(x) && existsSync(join(dir, x, 'fanouts.txt'))).sort();
  return names.map((name, i) => ({
    name,
    finished: existsSync(join(dir, name, 'summary.json')),
    newest: i === names.length - 1,
    fanouts: parseFanouts(readFileSync(join(dir, name, 'fanouts.txt'), 'utf8')),
  }));
}

export function parseFanouts(text: string): { bot: string; txid: string }[] {
  return text.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && /^[0-9a-f]{64}$/.test(p[1])).map(([bot, txid]) => ({ bot, txid }));
}

/** Which runs may be swept. `include` names unfinished, non-newest dirs the owner opted in. */
export function pickRuns(runs: RunDir[], include: string[] = []): RunPick {
  const out: RunPick = { swept: [], skipped: [] };
  for (const r of runs) {
    if (r.finished) out.swept.push(r);
    else if (r.newest) out.skipped.push({ run: r, why: 'newest run, no summary.json: may still be running' });
    else if (include.includes(r.name)) out.swept.push(r);
    else out.skipped.push({ run: r, why: 'no summary.json (pass --include to opt in)' });
  }
  return out;
}

/** Outputs of a raw tx: [vout, value, scriptHex]. Throws on a truncated tx. */
export function txOutputs(b: Uint8Array): { vout: number; value: number; script: string }[] {
  let at = 0;
  const rd = (n: number) => { if (at + n > b.length) throw new Error('truncated tx'); const s = b.subarray(at, at + n); at += n; return s; };
  const vi = () => { const f = rd(1)[0]; if (f < 0xfd) return f; if (f === 0xfd) { const s = rd(2); return s[0] | (s[1] << 8); } if (f === 0xfe) { const s = rd(4); return (s[0] | (s[1] << 8) | (s[2] << 16)) + s[3] * 2 ** 24; } throw new Error('varint too big'); };
  rd(4);
  const nIn = vi();
  for (let i = 0; i < nIn; i++) { rd(36); rd(vi()); rd(4); }
  const nOut = vi();
  const out: { vout: number; value: number; script: string }[] = [];
  for (let i = 0; i < nOut; i++) {
    const v = rd(8);
    const value = new DataView(v.buffer, v.byteOffset, 8).getUint32(0, true) + new DataView(v.buffer, v.byteOffset, 8).getUint32(4, true) * 2 ** 32;
    const script = Buffer.from(rd(vi())).toString('hex');
    out.push({ vout: i, value, script });
  }
  rd(4);
  if (at !== b.length) throw new Error('trailing bytes after tx');
  return out;
}

/** The coins of `txid` paying `lockHex` (P2PKH to our address) with value < maxCoin. */
export function lanesOf(txid: string, raw: Uint8Array, lockHex: string, maxCoin: number): Coin[] {
  return txOutputs(raw).filter((o) => o.script === lockHex && o.value > 0 && o.value < maxCoin).map((o) => ({ txid, vout: o.vout, value: o.value }));
}

/** Journal spends ("S <outpoint> <txid>", minus "R <outpoint>") from every spent-*.jsonl in `dir`, kept only for
 * outpoints of the txids in `want` (the journals hold millions of lines; this keeps memory small). */
export async function journalSpentFor(dir: string, want: Set<string>): Promise<Set<string>> {
  const spent = new Set<string>();
  if (!existsSync(dir)) return spent;
  for (const f of readdirSync(dir).filter((x) => /^spent-.*\.jsonl$/.test(x)).sort()) {
    // a release only undoes a spend in the same journal (one writer each): a rejected sweep tx must not "unspend" a lane a bot spent
    const mine = new Set<string>();
    const rl = createInterface({ input: createReadStream(join(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      const [k, a] = line.split(' ');
      if (!a || !want.has(a.slice(0, 64))) continue;
      if (k === 'S') mine.add(a);
      else if (k === 'R') mine.delete(a);
    }
    for (const a of mine) spent.add(a);
  }
  return spent;
}

export type SweepTx = { inputs: Coin[]; inValue: number; fee: number; out: number; bytes: number };
export type SweepPlan = { txs: SweepTx[]; uneconomic: Coin[]; lanes: number; inValue: number; fees: number; out: number };

/**
 * Plan consolidation txs. `bytesFor(k)` is the tx size with k inputs (the signer's own worst-case size; default
 * 10 + k·148 + 1 output + a small tag). Fee = ceil(bytes · rate / 1000) + 1, the same formula as the signer's fanOut.
 * Lanes whose own input cost ≥ their value are left out (uneconomic). Each tx takes at most `maxInputs` inputs.
 */
export function planSweep(coins: Coin[], satsPerKb: number, o: { maxInputs?: number; bytesFor?: (k: number) => number } = {}): SweepPlan {
  const maxInputs = Math.max(1, o.maxInputs ?? 5000);
  const bytesFor = o.bytesFor ?? ((k: number) => 10 + k * INPUT_BYTES + 34 + 60);
  const per = inputCost(satsPerKb);
  const uneconomic = coins.filter((c) => c.value <= per);
  const good = coins.filter((c) => c.value > per).sort((a, b) => (a.txid === b.txid ? a.vout - b.vout : a.txid < b.txid ? -1 : 1));
  const txs: SweepTx[] = [];
  for (let i = 0; i < good.length; i += maxInputs) {
    const inputs = good.slice(i, i + maxInputs);
    const bytes = bytesFor(inputs.length);
    const fee = Math.ceil((bytes * satsPerKb) / 1000) + 1;
    const inValue = inputs.reduce((s, c) => s + c.value, 0);
    if (inValue - fee < 1) { uneconomic.push(...inputs); continue; }
    txs.push({ inputs, inValue, fee, out: inValue - fee, bytes });
  }
  return {
    txs, uneconomic, lanes: txs.reduce((s, t) => s + t.inputs.length, 0),
    inValue: txs.reduce((s, t) => s + t.inValue, 0), fees: txs.reduce((s, t) => s + t.fee, 0), out: txs.reduce((s, t) => s + t.out, 0),
  };
}

/** Run `fn` over `items` with at most `limit` in flight; stops starting new work once `stopped()` is true. */
export async function pool<T>(items: T[], limit: number, fn: (x: T, i: number) => Promise<void>, stopped: () => boolean = () => false): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length && !stopped()) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
