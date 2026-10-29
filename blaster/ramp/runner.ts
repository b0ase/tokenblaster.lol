/**
 * The ramp: climb tx/s stage by stage on one broadcaster, wide not deep.
 *
 *   mined coin ──fan-out (depth 1)──▶ lane coins ──blast (depth 2)──▶ OP_RETURN tag + 1-sat change
 *
 * Parents first: a fan-out is sent alone and its lane coins are used only once the SAME broadcaster reports it
 * SEEN (or MINED). Blasts never chain (depth 2 is the cap). Every input goes through the Ledger first, so nothing is
 * ever spent twice; a "retry" (no answer after the resends) is re-sent later with the same bytes.
 *
 * Auto-stop after each stage: accept rate < 95 %, or orphan + rejected rate up on the previous stage, or the sender
 * fell under 80 % of the target. halted() (STOP file / SIGINT) ends everything within a tick; `signal` aborts
 * in-flight requests.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, type Broadcaster, type SubmitResult, type TxItem } from './broadcaster';
import { Ledger, op } from './ledger';
import type { Coin, signer as makeSigner } from './tx';

export const STAGES = [100, 250, 500, 1000, 1500, 2000];
export const STAGE_SECS = 300;

export type StageStats = {
  run: string;
  stage: number;
  target: number;
  secs: number;
  sent: number;
  accepted: number;
  rejected: number;
  retryPending: number;
  sampled: number;
  seen: number;
  orphan: number;
  sampleRejected: number;
  txps: number;
  acceptRate: number;
  badRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyMax: number;
  fanouts: number;
  feesSats: number;
  stop?: string;
};

export type RunOpts = {
  bc: Broadcaster;
  ledger: Ledger;
  sign: ReturnType<typeof makeSigner>;
  run: string;
  label?: string;
  stages?: number[];
  stageSecs?: number;
  satsPerKb: number;
  fanWidth?: number;
  leadSecs?: number;
  maxInflight?: number;
  batch?: number;
  tickMs?: number;
  statusSample?: number;
  pollMs?: number;
  fanSettleMs?: number;
  minAccept?: number;
  badRise?: number;
  minPace?: number;
  /** Fees cap (sats) for the whole process, shared by both runs. */
  budget: { maxSats: number; spent: number };
  halted: () => boolean;
  signal?: AbortSignal;
  outDir?: string;
  log?: (s: string) => void;
  acceptedIsSeen?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (a: number[], p: number) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

/** Should the climb stop after this stage? Returns the reason or undefined. */
export function stopReason(cur: StageStats, prev: StageStats | undefined, o: { minAccept?: number; badRise?: number; minPace?: number } = {}): string | undefined {
  const minAccept = o.minAccept ?? 0.95;
  if (cur.sent === 0) return 'nothing sent';
  if (cur.acceptRate < minAccept) return `accept rate ${(cur.acceptRate * 100).toFixed(1)} % < ${minAccept * 100} %`;
  const rise = o.badRise ?? 0.005;
  if (prev && cur.badRate > prev.badRate + rise) return `orphan/rejected up ${(prev.badRate * 100).toFixed(2)} % → ${(cur.badRate * 100).toFixed(2)} %`;
  if (!prev && cur.badRate > rise * 2) return `orphan/rejected ${(cur.badRate * 100).toFixed(2)} % at the first stage`;
  if (cur.txps < cur.target * (o.minPace ?? 0.8)) return `only ${cur.txps.toFixed(0)} tx/s of ${cur.target} (sender or broadcaster can't keep up)`;
  return undefined;
}

/** Prep coins (each funds one `width`-lane fan-out) for `runs` runs: the fan-outs, 5 % spare, and the lane buffer left at each run's end. */
export function prepCoins(fans: number, runs: number, o: { stages?: number[]; leadSecs?: number; fanWidth?: number } = {}) {
  const buffer = Math.ceil((Math.max(...(o.stages ?? STAGES)) * (o.leadSecs ?? 5)) / (o.fanWidth ?? 2000)) + 1;
  return Math.ceil(fans * runs * 1.05) + runs * buffer + 2;
}

/** Sats the full ramp needs at `satsPerKb` (per run): fees, plus 1-sat change left in each blast. */
export function estimate(o: { stages?: number[]; stageSecs?: number; satsPerKb: number; fanWidth?: number; sign: ReturnType<typeof makeSigner>; run?: string }) {
  const stages = o.stages ?? STAGES;
  const secs = o.stageSecs ?? STAGE_SECS;
  const width = o.fanWidth ?? 2000;
  const blasts = stages.reduce((s, r) => s + r * secs, 0);
  const blastFee = o.sign.blastFee(9_999_999, o.run ?? 'ramp-29oct-arc', o.satsPerKb);
  const fans = Math.ceil(blasts / width);
  const fanFee = Math.ceil((o.sign.fanBytes(1, width + 1, 60) * o.satsPerKb) / 1000) + 1;
  const fees = blasts * blastFee + fans * fanFee;
  return { blasts, blastFee, fans, fanFee, fees, dust: blasts, total: fees + blasts, laneValue: blastFee + 1 };
}

export async function runRamp(o: RunOpts): Promise<{ stages: StageStats[]; stop?: string }> {
  const log = o.log ?? (() => {});
  const stages = o.stages ?? STAGES;
  const stageSecs = o.stageSecs ?? STAGE_SECS;
  const width = o.fanWidth ?? 2000;
  const batch = o.batch ?? (o.bc.kind === 'arc' ? 500 : 1000);
  const maxInflight = o.maxInflight ?? 16;
  const tickMs = o.tickMs ?? 100;
  const sample = o.statusSample ?? 0.02;
  const pollMs = o.pollMs ?? 2000;
  const run = o.run;
  const laneFee = o.sign.blastFee(9_999_999, run, o.satsPerKb);
  const laneValue = laneFee + 1;
  const L = o.ledger;
  const out: StageStats[] = [];
  let n = 0;
  let stop: string | undefined;

  // Fan-outs: tx → outputs; settled when the broadcaster says SEEN.
  const fans = new Map<string, { at: number; lanes: number; status?: string; settled: boolean }>();
  const fanBad = new Set<string>();
  let fanCount = 0;
  let fanFees = 0;
  const pendingLanes = () => { let s = 0; for (const f of fans.values()) if (!f.settled) s += f.lanes; return s; };

  // A fan-out always uses its whole coin (prep coins are sized for `width` lanes), never a sliver of it.
  async function newFanOut() {
    const mined = L.available('mined');
    if (!mined.length) return false;
    const lanes = width;
    const ins: Coin[] = [];
    let have = 0;
    const feeFor = (k: number) => Math.ceil((o.sign.fanBytes(k, lanes + 2, 60) * o.satsPerKb) / 1000) + 1;
    for (const c of mined.sort((a, b) => b.value - a.value)) { if (have >= lanes * laneValue + feeFor(ins.length) || ins.length >= 50) break; ins.push(c); have += c.value; }
    const fee = feeFor(ins.length);
    const fit = Math.min(lanes, Math.floor((have - fee) / laneValue));
    if (fit < 1) return false;
    const t = o.sign.fanOut(ins, Array(fit).fill(laneValue), run, o.satsPerKb);
    if (o.budget.spent + t.fee > o.budget.maxSats) { stop ??= `max-sats ${o.budget.maxSats} reached`; return false; }
    L.spend(t.txid, ins.map((c) => op(c.txid, c.vout)), t.outputs); // inputs spent before the bytes leave
    o.budget.spent += t.fee;
    fanFees += t.fee;
    fanCount++;
    const f = { at: Date.now(), lanes: fit, settled: false as boolean, status: undefined as string | undefined };
    fans.set(t.txid, f);
    // Fan-out txids for GorillaPool to separate our traffic on ARC (a callback token alone isn't stored there).
    if (o.outDir) { mkdirSync(o.outDir, { recursive: true }); appendFileSync(join(o.outDir, `${o.run}-fanouts.txt`), t.txid + '\n'); }
    // Sent alone; its children wait for SEEN.
    void (async () => {
      let r: SubmitResult | undefined;
      for (let i = 0; i < 5 && !o.halted(); i++) {
        r = (await o.bc.submit([{ txid: t.txid, bytes: t.ef }]))[0];
        if (r.outcome !== 'retry') break;
        await sleep(1000); // same bytes again
      }
      if (!r || r.outcome !== 'accepted') { fanBad.add(t.txid); f.settled = true; L.reject(t.txid); log(`fan-out ${t.txid} ${r?.outcome ?? 'no answer'} ${r?.reason ?? ''}`); return; }
      const end = Date.now() + (o.fanSettleMs ?? 60_000);
      while (!o.halted() && Date.now() < end) {
        const s = await o.bc.status(t.txid);
        f.status = s?.txStatus;
        const c = classify(s, o.acceptedIsSeen);
        if (c === 'seen' || c === 'mined') { L.settle(t.txid, c); f.settled = true; return; }
        if (c === 'rejected' || c === 'orphan-dead') { fanBad.add(t.txid); f.settled = true; L.reject(t.txid); log(`fan-out ${t.txid} ${s?.txStatus} ${s?.extraInfo ?? ''}`); return; }
        await sleep(Math.min(500, pollMs));
      }
      if (!f.settled) { f.settled = true; log(`fan-out ${t.txid} not SEEN in time (${f.status ?? 'no status'}): its lanes stay unused`); }
    })();
    return true;
  }

  for (let si = 0; si < stages.length && !stop && !o.halted(); si++) {
    const rate = stages[si];
    const st = { sent: 0, accepted: 0, rejected: 0, latency: [] as number[], fees: 0, fan0: fanCount, fanFee0: fanFees };
    const retryQ: TxItem[] = [];
    const samples = new Map<string, { at: number; done?: string; orphanSeen?: boolean }>();
    let inflight = 0;
    const t0 = Date.now();
    log(`[${o.label ?? run}] stage ${si + 1}/${stages.length}: ${rate} tx/s for ${stageSecs} s`);

    const dispatch = (items: TxItem[], fresh: boolean) => {
      inflight++;
      const s0 = Date.now();
      void o.bc.submit(items).then((res) => {
        st.latency.push(Date.now() - s0);
        const byId = new Map(items.map((it) => [it.txid, it]));
        for (const r of res) {
          if (r.outcome === 'accepted') {
            st.accepted++;
            if (Math.random() < sample) samples.set(r.txid, { at: Date.now() });
          } else if (r.outcome === 'rejected') { st.rejected++; L.reject(r.txid); }
          else { const it = byId.get(r.txid); if (it) retryQ.push(it); }
        }
      }).catch((e) => { log(`submit: ${e instanceof Error ? e.message : String(e)}`); retryQ.push(...items); })
        .finally(() => { inflight--; });
      if (fresh) st.sent += items.length;
    };

    // Sampled status poller (and missing-inputs detection).
    let polling = true;
    const poller = (async () => {
      while (polling && !o.halted()) {
        await sleep(pollMs);
        const due = [...samples].filter(([, s]) => !s.done).slice(0, 200);
        await Promise.all(due.map(async ([txid, s]) => {
          const r = await o.bc.status(txid);
          if (r?.txStatus === 'SEEN_IN_ORPHAN_MEMPOOL') s.orphanSeen = true;
          const c = classify(r, o.acceptedIsSeen);
          if (c === 'seen' || c === 'mined' || c === 'rejected') s.done = c;
          else if (c === 'orphan-dead') {
            s.done = c;
            const rel = L.missingInputs(txid, (id) => fanBad.has(id));
            if (rel.length) log(`missing inputs ${txid}: rebuilt from ${rel.length} mined coin(s)`);
          }
        }));
      }
    })();

    while (!o.halted() && !stop) {
      const el = (Date.now() - t0) / 1000;
      if (el >= stageSecs) break;
      // Lanes ahead: keep `leadSecs` of the NEXT second's need in seen coins + fan-outs on the way.
      const want = rate * (o.leadSecs ?? 5);
      const have = L.count('seen', (u) => u.value === laneValue) + pendingLanes();
      if (have < want && [...fans.values()].filter((f) => !f.settled).length < 6) await newFanOut();
      // Same bytes first.
      while (retryQ.length && inflight < maxInflight) dispatch(retryQ.splice(0, batch), false);
      const need = Math.min(Math.floor(rate * el) - st.sent, rate); // at most 1 s of catch-up per tick
      if (need > 0 && inflight < maxInflight) {
        const coins = L.available('seen', Math.min(need, batch * (maxInflight - inflight)), (u) => u.value === laneValue); // lane coins only, never a fan-out's change
        const items: TxItem[] = [];
        for (const c of coins) {
          if (o.budget.spent + laneFee > o.budget.maxSats) { stop = `max-sats ${o.budget.maxSats} reached`; break; }
          const t = o.sign.blast(c, ++n, run, o.satsPerKb);
          L.spend(t.txid, [op(c.txid, c.vout)], t.outputs);
          o.budget.spent += t.fee;
          st.fees += t.fee;
          items.push({ txid: t.txid, bytes: t.ef });
        }
        for (let i = 0; i < items.length; i += batch) dispatch(items.slice(i, i + batch), true);
      }
      if (need > 0 && !L.available('mined').length && !pendingLanes() && !L.count('seen', (u) => u.value === laneValue)) stop ??= 'out of funded coins';
      await sleep(tickMs);
    }
    const secs = Math.min(stageSecs, (Date.now() - t0) / 1000);
    // Let in-flight POSTs land (bounded; a halt aborts them via the signal).
    const drainEnd = Date.now() + (o.halted() ? 2000 : 10_000);
    while (inflight > 0 && Date.now() < drainEnd) await sleep(50);
    // Last same-bytes resend of anything still held.
    if (retryQ.length && !o.halted()) { const q = retryQ.splice(0); dispatch(q, false); const e2 = Date.now() + 10_000; while (inflight > 0 && Date.now() < e2) await sleep(50); }
    // Give sampled statuses a moment to settle.
    const sEnd = Date.now() + (o.halted() ? 0 : Math.max(pollMs * 2, 1000));
    while (!o.halted() && Date.now() < sEnd && [...samples.values()].some((s) => !s.done)) await sleep(50);
    polling = false;
    await poller;

    const sv = [...samples.values()];
    const sampled = sv.length;
    const seen = sv.filter((s) => s.done === 'seen' || s.done === 'mined').length;
    const orphan = sv.filter((s) => s.orphanSeen || s.done === 'orphan-dead').length;
    const sRej = sv.filter((s) => s.done === 'rejected').length;
    const accepted = st.accepted;
    const stats: StageStats = {
      run, stage: si + 1, target: rate, secs: +secs.toFixed(1), sent: st.sent, accepted, rejected: st.rejected,
      retryPending: retryQ.length, sampled, seen, orphan, sampleRejected: sRej,
      txps: +(accepted / Math.max(secs, 0.001)).toFixed(1),
      acceptRate: st.sent ? accepted / st.sent : 0,
      badRate: (st.sent ? st.rejected / st.sent : 0) + (sampled ? (orphan + sRej) / sampled : 0),
      latencyP50: pct(st.latency, 0.5), latencyP95: pct(st.latency, 0.95), latencyMax: pct(st.latency, 1),
      fanouts: fanCount - st.fan0, feesSats: st.fees + (fanFees - st.fanFee0),
    };
    const why = o.halted() ? 'halted (STOP file / SIGINT)' : stop ?? stopReason(stats, out[out.length - 1], o);
    if (why) stats.stop = why;
    out.push(stats);
    write(o.outDir, stats);
    log(`[${o.label ?? run}] stage ${si + 1}: sent ${stats.sent}, accepted ${accepted} (${(stats.acceptRate * 100).toFixed(1)} %), ${stats.txps} tx/s, seen ${seen}/${sampled} sampled, orphan ${orphan}, rejected ${st.rejected}, p95 ${stats.latencyP95} ms${why ? ` · STOP: ${why}` : ''}`);
    if (why) { stop = why; break; }
  }
  return { stages: out, stop };
}

const CSV_COLS: (keyof StageStats)[] = ['run', 'stage', 'target', 'secs', 'sent', 'accepted', 'rejected', 'retryPending', 'sampled', 'seen', 'orphan', 'sampleRejected', 'txps', 'acceptRate', 'badRate', 'latencyP50', 'latencyP95', 'latencyMax', 'fanouts', 'feesSats', 'stop'];
function write(dir: string | undefined, s: StageStats) {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${s.run}-stage-${s.stage}.json`), JSON.stringify(s, null, 2));
  const csv = join(dir, 'stages.csv');
  const row = CSV_COLS.map((k) => JSON.stringify(s[k] ?? '')).join(',');
  appendFileSync(csv, row + '\n');
}
export function csvHeader(dir: string) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'stages.csv'), CSV_COLS.join(',') + '\n'); }
