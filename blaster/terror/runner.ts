/**
 * TERRORNODE stress runner: N bots × M shots, wide (fan-out depth 1, blast depth 2), with per-bot and global caps,
 * a rolling broadcast-error auto-stop, a kill switch (halted()), live tx/s and sampled accept / seen / orphan stats.
 *
 * Every bot has its own Ledger (spent-outputs journal: never re-spend, survives a restart), its own funding coins and
 * its own broadcaster (bots are spread over the broadcasters round-robin, so a lane's parent and child always go to
 * the same endpoint). A fan-out is sent alone; its lanes are spent only once that broadcaster reports it SEEN/MINED.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { classify, type Broadcaster, type SubmitResult, type TxItem } from '../ramp/broadcaster';
import { Ledger, op } from '../ramp/ledger';
import type { Coin, signer as makeSigner } from '../ramp/tx';
import { ErrorWindow, lanesFor } from './plan';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (a: number[], p: number) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

/** `fanBc`: the same endpoint with fan-out settings (long timeout, few tries: a fan-out is a ~0.5 MB body). Defaults to `bc`. */
/** The label for shot n: a list of flags rotates one per shot. */
export const tagOf = (b: { name: string; tag?: string | string[] }, n: number) => (Array.isArray(b.tag) ? b.tag[n % b.tag.length] : b.tag ?? b.name);
const tagsOf = (b: { name: string; tag?: string | string[] }) => (Array.isArray(b.tag) ? b.tag : [b.tag ?? b.name]);

export type BotSpec = { name: string; /** OP_RETURN label (push 5); defaults to name. Journals stay keyed by name. */ tag?: string | string[]; ledger: Ledger; bc: Broadcaster; fanBc?: Broadcaster; shots: number; maxSats: number };

export type BotState = BotSpec & {
  signed: number; accepted: number; rejected: number; retries: number; fees: number; fanouts: number; fanFees: number;
  funded: number; committed: number; skip: Set<string>; pendingLanes: number; pendingFans: number; done?: string; n: number; retryQ: TxItem[];
};

export type Totals = {
  secs: number; signed: number; sent: number; accepted: number; rejected: number; retries: number; fees: number; fanouts: number; fanFees: number;
  signRate: number; acceptRate: number; txps1s: number; errRatio: number; sampled: number; seen: number; orphan: number; sampleRejected: number;
  latencyP50: number; latencyP95: number; inflight: number; bytes: number;
};

export type RunOpts = {
  bots: BotSpec[];
  sign: ReturnType<typeof makeSigner>;
  satsPerKb: number;
  /** Global target tx/s across all bots; 0 = as fast as signing + broadcasting allow. */
  rate: number;
  /** Global fees cap (sats) for the process. */
  maxSats: number;
  fanWidth?: number;
  leadSecs?: number;
  batch?: number;
  maxInflight?: number;
  tickMs?: number;
  statusSample?: number;
  pollMs?: number;
  fanSettleMs?: number;
  maxErrorRatio?: number;
  maxOrphanRatio?: number;
  /** At most this many fan-out POSTs in flight across all bots (31 Oct: 20 × 0.5 MB at once to Arcade all timed out). */
  fanConcurrency?: number;
  /** Bot k (0-based) makes its first fan-out k × staggerMs after the start. */
  staggerMs?: number;
  /** Submit attempts per fan-out (each re-sends the same bytes). */
  fanTries?: number;
  /** A fan-out POST with no answer may still have landed (31 Oct: 12 of 20 did): poll its status this long before giving up. */
  fanNoAnswerPollMs?: number;
  /** Don't keep per-tx records after a blast is settled (multi-million runs). */
  forget?: boolean;
  /** Keep every signed tx's bytes (dry-run measurement only; off for real runs). */
  onSigned?: (bot: string, kind: 'fan' | 'blast', t: { txid: string; ef: Uint8Array; fee: number }) => void;
  halted: () => boolean;
  outDir?: string;
  log?: (s: string) => void;
  onTick?: (t: Totals, bots: BotState[]) => void;
};

export async function runStress(o: RunOpts): Promise<{ totals: Totals; bots: BotState[]; stop?: string }> {
  const log = o.log ?? (() => {});
  const batch = o.batch ?? 1000;
  const maxInflight = o.maxInflight ?? 16;
  const tickMs = o.tickMs ?? 50;
  const sample = o.statusSample ?? 0.01;
  const pollMs = o.pollMs ?? 2000;
  const width = o.fanWidth ?? 20_000;
  const errs = new ErrorWindow(5000, o.maxErrorRatio ?? 0.05, 1000);
  const laneFee = Math.max(...o.bots.flatMap((b) => tagsOf(b).map((t) => o.sign.blastFee(99_999_999, t, o.satsPerKb))));
  const laneValue = laneFee + 1;
  const fanFee = (lanes: number) => Math.ceil((o.sign.fanBytes(1, lanes + 2, 60) * o.satsPerKb) / 1000) + 1;
  const bots: BotState[] = o.bots.map((b) => ({ ...b, signed: 0, accepted: 0, rejected: 0, retries: 0, fees: 0, fanouts: 0, fanFees: 0, funded: 0, committed: 0, skip: new Set<string>(), pendingLanes: 0, pendingFans: 0, n: 0, retryQ: [] }));
  let stop: string | undefined;
  let spent = 0;
  let committed = 0;
  let inflight = 0;
  let bytes = 0;
  const latency: number[] = [];
  const samples = new Map<string, { bot: BotState; done?: string; orphanSeen?: boolean }>();
  const fanBad = new Set<string>();
  const ev = (x: object) => { if (o.outDir) appendFileSync(join(o.outDir, 'events.jsonl'), JSON.stringify({ t: Date.now(), ...x }) + '\n'); };
  if (o.outDir) mkdirSync(o.outDir, { recursive: true });

  const isLane = (u: { value: number }) => u.value === laneValue;
  const fanMax = Math.max(1, o.fanConcurrency ?? 2);
  let fanSlots = 0;
  const fanWait: (() => void)[] = [];
  const fanAcquire = async () => { while (fanSlots >= fanMax) await new Promise<void>((r) => fanWait.push(r)); fanSlots++; };
  const fanRelease = () => { fanSlots--; fanWait.shift()?.(); };
  const startAt = new Map(bots.map((b, k) => [b, k * (o.staggerMs ?? 0)]));

  function newFanOut(b: BotState): boolean {
    const want = b.shots - b.funded;
    if (want <= 0) return false;
    const coin = b.ledger.available('mined', 1, (u) => !b.skip.has(op(u.txid, u.vout)))[0];
    if (!coin) return false;
    // Caps are checked on what a fan-out COMMITS (its fee + every lane's future blast fee), so a bot never funds
    // lanes it isn't allowed to fire.
    const room = Math.min(b.maxSats - b.committed, o.maxSats - committed);
    const byCap = Math.floor((room - fanFee(Math.min(want, width))) / laneFee);
    const lanes = lanesFor(coin.value, laneValue, fanFee, Math.min(want, width, Math.max(0, byCap)));
    if (lanes < 1) {
      if (byCap < 1) { if (b.maxSats - b.committed <= o.maxSats - committed) b.done ??= `spend cap ${b.maxSats} sats`; else stop ??= `max-sats ${o.maxSats} reached`; return false; }
      b.skip.add(op(coin.txid, coin.vout)); log(`${b.name}: coin ${coin.txid}:${coin.vout} (${coin.value} sats) too small for a lane`); return false;
    }
    const t = o.sign.fanOut([coin as Coin], Array(lanes).fill(laneValue), tagOf(b, 0), o.satsPerKb);
    b.committed += t.fee + lanes * laneFee; committed += t.fee + lanes * laneFee;
    b.ledger.spend(t.txid, [op(coin.txid, coin.vout)], t.outputs); // inputs journalled before the bytes leave
    o.onSigned?.(b.name, 'fan', t);
    spent += t.fee; b.fees += t.fee; b.fanFees += t.fee; b.fanouts++; b.funded += lanes; b.pendingLanes += lanes; b.pendingFans++;
    ev({ ev: 'fanout', bot: b.name, txid: t.txid, lanes, fee: t.fee, bytes: t.ef.length });
    if (o.outDir) appendFileSync(join(o.outDir, 'fanouts.txt'), `${b.name} ${t.txid}\n`);
    void (async () => {
      let r: SubmitResult | undefined;
      const fbc = b.fanBc ?? b.bc;
      await fanAcquire();
      try {
        for (let i = 0; i < (o.fanTries ?? 2) && !o.halted(); i++) {
          r = (await fbc.submit([{ txid: t.txid, bytes: t.ef }]))[0];
          if (r.outcome !== 'retry') break;
          await sleep(1000); // same bytes again
        }
      } finally { fanRelease(); }
      const finish = (why?: string) => { b.pendingLanes -= lanes; b.pendingFans--; if (why) log(`${b.name} fan-out ${t.txid}: ${why}`); };
      const dead = (why: string) => { fanBad.add(t.txid); b.ledger.reject(t.txid); b.funded -= lanes; return finish(why); };
      if (r?.outcome === 'rejected') { errs.push(0, 1); return dead(`rejected ${r.reason ?? ''}`); }
      // accepted → wait for SEEN. No answer → it may still have landed: ask for its status for a while.
      const noAnswer = !r || r.outcome !== 'accepted';
      if (noAnswer) log(`${b.name} fan-out ${t.txid}: no answer to the POST; checking whether it landed anyway`);
      const end = Date.now() + (noAnswer ? (o.fanNoAnswerPollMs ?? 120_000) : (o.fanSettleMs ?? 900_000));
      while (!o.halted() && Date.now() < end) {
        const s = await b.bc.status(t.txid);
        const c = classify(s);
        if (c === 'seen' || c === 'mined') { b.ledger.settle(t.txid, c); return finish(noAnswer ? `landed after all (${s?.txStatus})` : undefined); }
        if (c === 'rejected' || c === 'orphan-dead') { if (noAnswer) errs.push(0, 1); return dead(`${s?.txStatus} ${s?.extraInfo ?? ''}`); }
        await sleep(Math.min(1000, pollMs));
      }
      if (noAnswer && !o.halted()) { errs.push(0, 1); return dead('no answer and not found: input stays journalled as spent (check it on chain)'); }
      finish(o.halted() ? 'halted before SEEN' : 'not SEEN in time: its lanes stay unused');
    })();
    return true;
  }

  const dispatch = (b: BotState, items: TxItem[], fresh: boolean) => {
    inflight++;
    const s0 = Date.now();
    for (const it of items) bytes += it.bytes.length;
    void b.bc.submit(items).then((res) => {
      latency.push(Date.now() - s0);
      if (latency.length > 20_000) latency.splice(0, 10_000);
      const byId = new Map(items.map((it) => [it.txid, it]));
      let ok = 0, bad = 0;
      for (const r of res) {
        if (r.outcome === 'accepted') {
          ok++; b.accepted++;
          if (Math.random() < sample) samples.set(r.txid, { bot: b });
          else if (o.forget) b.ledger.forget(r.txid);
        } else if (r.outcome === 'rejected') { bad++; b.rejected++; b.ledger.reject(r.txid); }
        else { bad++; b.retries++; const it = byId.get(r.txid); if (it && fresh) b.retryQ.push(it); }
      }
      errs.push(ok, bad);
      stop ??= errs.check();
    }).catch((e) => { log(`${b.name} submit: ${e instanceof Error ? e.message : String(e)}`); if (fresh) b.retryQ.push(...items); })
      .finally(() => { inflight--; });
  };

  // Sampled status poller: seen / orphan / rejected, and missing-inputs handling.
  let polling = true;
  const poller = (async () => {
    while (polling) {
      await sleep(pollMs);
      const due = [...samples].filter(([, s]) => !s.done).slice(0, 200);
      await Promise.all(due.map(async ([txid, s]) => {
        const r = await s.bot.bc.status(txid);
        if (r?.txStatus === 'SEEN_IN_ORPHAN_MEMPOOL') s.orphanSeen = true;
        const c = classify(r);
        if (c === 'seen' || c === 'mined' || c === 'rejected') s.done = c;
        else if (c === 'orphan-dead') { s.done = c; s.bot.ledger.missingInputs(txid, (id) => fanBad.has(id)); }
        if (s.done && o.forget && c !== 'orphan-dead') s.bot.ledger.forget(txid);
      }));
      const sv = [...samples.values()].filter((x) => x.done || x.orphanSeen);
      if (sv.length >= 200) {
        const orphan = sv.filter((x) => x.orphanSeen || x.done === 'orphan-dead').length / sv.length;
        if (orphan > (o.maxOrphanRatio ?? 0.05)) stop ??= `orphans ${(orphan * 100).toFixed(1)}% of ${sv.length} sampled`;
      }
    }
  })();

  const t0 = Date.now();
  let lastAcc = 0;
  let lastTick = t0;
  let lastTotals: Totals = totals();
  function totals(): Totals {
    const sv = [...samples.values()];
    const sum = (k: keyof BotState) => bots.reduce((a, b) => a + (b[k] as number), 0);
    const secs = (Date.now() - t0) / 1000;
    const signed = sum('signed');
    return {
      secs, signed, sent: signed, accepted: sum('accepted'), rejected: sum('rejected'), retries: sum('retries'), fees: sum('fees'),
      fanouts: sum('fanouts'), fanFees: sum('fanFees'), signRate: signed / Math.max(secs, 0.001), acceptRate: signed ? sum('accepted') / signed : 0,
      txps1s: 0, errRatio: errs.ratio, sampled: sv.length, seen: sv.filter((x) => x.done === 'seen' || x.done === 'mined').length,
      orphan: sv.filter((x) => x.orphanSeen || x.done === 'orphan-dead').length, sampleRejected: sv.filter((x) => x.done === 'rejected').length,
      latencyP50: pct(latency, 0.5), latencyP95: pct(latency, 0.95), inflight, bytes,
    };
  }

  let rr = 0;
  while (!o.halted() && !stop) {
    const active = bots.filter((b) => !b.done);
    if (!active.length && inflight === 0) break;
    // fan-outs ahead: keep leadSecs of lanes on the way per bot
    const perBotRate = o.rate ? o.rate / Math.max(1, active.length) : 5000;
    const now = Date.now() - t0;
    for (const b of active) {
      if (now < (startAt.get(b) ?? 0)) continue; // --stagger
      const ready = b.ledger.count('seen', isLane);
      if (ready + b.pendingLanes < perBotRate * (o.leadSecs ?? 10) && b.pendingFans < 3) newFanOut(b);
    }
    // same bytes first
    for (const b of bots) while (b.retryQ.length && inflight < maxInflight) dispatch(b, b.retryQ.splice(0, batch), false);
    const el = (Date.now() - t0) / 1000;
    const signed = bots.reduce((a, b) => a + b.signed, 0);
    let need = o.rate ? Math.min(Math.floor(o.rate * el) - signed, o.rate) : batch * Math.max(0, maxInflight - inflight);
    if (need > 0 && inflight < maxInflight && active.length) {
      const share = Math.ceil(need / active.length);
      for (let k = 0; k < active.length && need > 0 && !stop; k++) {
        const b = active[(rr + k) % active.length];
        const room = Math.min(share, need, b.shots - b.signed);
        if (room <= 0) continue;
        const coins = b.ledger.available('seen', room, isLane);
        const items: TxItem[] = [];
        for (const c of coins) {
          const fee = o.sign.blastFee(b.n + 1, tagOf(b, b.n + 1), o.satsPerKb);
          if (spent + fee > o.maxSats) { stop = `max-sats ${o.maxSats} reached`; break; }
          if (b.fees + fee > b.maxSats) { b.done ??= `spend cap ${b.maxSats} sats`; break; }
          const t = o.sign.blast(c, ++b.n, tagOf(b, b.n), o.satsPerKb);
          b.ledger.spend(t.txid, [op(c.txid, c.vout)], t.outputs);
          o.onSigned?.(b.name, 'blast', t);
          spent += t.fee; b.fees += t.fee; b.signed++;
          items.push({ txid: t.txid, bytes: t.ef });
        }
        need -= items.length;
        for (let i = 0; i < items.length; i += batch) dispatch(b, items.slice(i, i + batch), true);
      }
      rr++;
    }
    for (const b of active) {
      if (b.signed >= b.shots) b.done ??= 'shots done';
      else if (!b.ledger.available('mined', 1).length && !b.pendingLanes && !b.ledger.count('seen', isLane)) b.done ??= 'out of funded coins';
    }
    if (Date.now() - lastTick >= 1000) {
      const t = totals();
      t.txps1s = (t.accepted - lastAcc) / ((Date.now() - lastTick) / 1000);
      lastAcc = t.accepted; lastTick = Date.now(); lastTotals = t;
      ev({ ev: 'tick', ...t });
      o.onTick?.(t, bots);
    }
    await sleep(tickMs);
  }
  if (o.halted()) stop ??= 'halted (STOP file / Ctrl-C)';
  // let in-flight POSTs land (a halt aborts them via the broadcaster's signal)
  const drainEnd = Date.now() + (o.halted() ? 2000 : 15_000);
  while (inflight > 0 && Date.now() < drainEnd) await sleep(50);
  const sEnd = Date.now() + (o.halted() || stop ? 0 : Math.max(pollMs * 2, 1000));
  while (Date.now() < sEnd && [...samples.values()].some((s) => !s.done)) await sleep(50);
  polling = false;
  await poller;
  const t = totals();
  t.txps1s = lastTotals.txps1s;
  ev({ ev: 'end', stop, ...t, bots: bots.map((b) => ({ name: b.name, signed: b.signed, accepted: b.accepted, rejected: b.rejected, fees: b.fees, done: b.done })) });
  return { totals: t, bots, stop };
}
