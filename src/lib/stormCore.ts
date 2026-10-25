/**
 * The storm sender's core, shared by the browser worker (src/workers/storm.ts) and the node tests
 * (src/lib/stormCore.test.ts, against a mock ARC). No globals: the caller passes `fetch`, the stop / pause
 * flags and an `emit` for the worker's out-messages.
 *
 * Each lane is an unconfirmed chain: coin → blast → blast → … (one OP_RETURN tag + change each).
 * Tag: "tokenblaster.lol" <token> <n> <game> [...extra]  (extra: e.g. the player's paymail, see src/lib/gallery.ts).
 *
 * Throughput (docs/throughput.md): blasts are built and signed by src/lib/fastBlast.ts, and the next round is
 * signed WHILE the current round's ARC requests are in flight. A round is only SENT once ARC has answered for the
 * round before it, and a lane carries on only from a blast ARC accepted: a lane with any rejection stops for good.
 *
 * Network status (owner test, 25 Oct 2026: rounds reached bsv.lol "in a massive batch long after the fact"):
 * ARC answers each tx with a txStatus. Only SEEN_ON_NETWORK / ACCEPTED_BY_NETWORK / MINED mean the network has it
 * NOW; STORED / QUEUED / RECEIVED / ANNOUNCED_TO_NETWORK / SEEN_IN_ORPHAN_MEMPOOL mean ARC holds it and relays it
 * later. Both count as "sent" (the coin is spent either way), but `seen` counts only the first group, so the HUD
 * can show what is on the network live, and `statuses` keeps the histogram for the console.
 */
import { fromHex, makeBlaster, opReturn, toHex, txidHex, type Blast } from './fastBlast';

export const ARC_DEFAULT = 'https://arc.gorillapool.io';
export const TAG = 'tokenblaster.lol';
export const FEE_RATE = 100; // sats/kB: the GorillaPool / TAAL floor
/** Most blasts in one ARC request (whole lanes only, so a lane's chain is always in order in one request). */
export const MAX_POST = 600;
// Orphan is NOT bad here: a chained blast often reaches ARC a moment before its parent is processed.
const BAD = /REJECT|DOUBLE|INVALID|ERROR/i;
/** On the network now (not just held by ARC). */
export const isSeen = (s: string | undefined) => !!s && /^(SEEN_ON_NETWORK|ACCEPTED_BY_NETWORK|MINED|CONFIRMED)$/.test(s);

export type StartMsg = {
  /** 32-byte private key of the gun (the worker derives it from the WIF). */
  priv: Uint8Array;
  token?: string;
  /** The split tx: its txid (hex) and output values; lane coins are its outputs `vout`. */
  baseTxid: string;
  baseValues: number[];
  lanes: { vout: number; count: number; n: number }[];
  step: number;
  game?: string;
  extra?: unknown;
  arcs?: string[];
  paused?: boolean;
  /** ARC X-WaitFor (e.g. 'SEEN_ON_NETWORK'): ARC holds its answer until then (or its timeout). Default: none. */
  waitFor?: string;
};
export type Out =
  | { type: 'sent'; n: number; last?: string; seen: number; statuses: Record<string, number> }
  | { type: 'why'; text: string }
  | { type: 'stats'; stats: Stats };
export type Stats = { signed: number; posted: number; accepted: number; signMs: number; postMs: number; posts: number };
export type Ctl = { stopped: () => boolean; paused: () => boolean; emit: (m: Out) => void; fetch?: typeof fetch; now?: () => number };

type Lane = { txidLE: Uint8Array; vout: number; value: number; left: number; n: number; alive: boolean; arc: string };
type Part = { lane: Lane; txs: Blast[]; last: string };
type ArcResult = { txid?: string; txStatus?: string; extraInfo?: string; status?: number; detail?: string };

/** The <game> push and up to two short pushes after it (strings only). */
export function tagPushes(token: string, n: number, game: string | undefined, extra: unknown): string[] {
  const ex = Array.isArray(extra) ? extra.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 2) : [];
  return [TAG, token || 'sats', String(n), game || 'bsvgun', ...ex];
}

export async function runLanes(m: StartMsg, ctl: Ctl): Promise<void> {
  const f = ctl.fetch ?? fetch;
  const now = ctl.now ?? (() => performance.now());
  const stats: Stats = { signed: 0, posted: 0, accepted: 0, signMs: 0, postMs: 0, posts: 0 };
  let statsAt = 0;
  const flushStats = (force = false) => {
    if (!force && now() - statsAt < 1000) return;
    statsAt = now();
    ctl.emit({ type: 'stats', stats: { ...stats } });
    for (const k of Object.keys(stats) as (keyof Stats)[]) stats[k] = 0;
  };
  const b = makeBlaster(m.priv);
  const token = m.token || 'sats';
  const arcs = m.arcs && m.arcs.length ? m.arcs : [ARC_DEFAULT];
  const step = Math.max(1, m.step | 0);
  const baseLE = fromHex(m.baseTxid).reverse();
  const lanes: Lane[] = m.lanes.map((l, i) => ({
    txidLE: baseLE,
    vout: l.vout,
    value: m.baseValues[l.vout] ?? 0,
    left: l.count,
    n: l.n,
    alive: true,
    arc: arcs[i % arcs.length], // a lane stays on one ARC so its chain reaches the same node in order
  }));
  const pushes = (n: number) => opReturn(tagPushes(token, n, m.game, m.extra));
  // One fee for every blast, worked out on the longest number this session can carry.
  const fee = b.feeFor(pushes(Math.max(...lanes.map((l) => l.n + l.left))), FEE_RATE);
  const halted = () => ctl.stopped() || ctl.paused();

  let rstep = Math.min(step, 10);
  function build(): Part[] {
    const t0 = now();
    const cap = rstep;
    rstep = Math.min(step, rstep * 4);
    const parts: Part[] = [];
    for (const lane of lanes) {
      if (!lane.alive || lane.left <= 0) continue;
      const txs: Blast[] = [];
      while (txs.length < cap && lane.left > 0 && !halted()) {
        if (lane.value - fee < 1) {
          lane.left = 0;
          break;
        }
        const t = b.blast(lane.txidLE, lane.vout, lane.value, pushes(lane.n), fee);
        txs.push(t);
        lane.txidLE = t.txidLE;
        lane.vout = 1;
        lane.value = t.change;
        lane.left--;
        lane.n++;
      }
      if (txs.length) parts.push({ lane, txs, last: txidHex(txs[txs.length - 1].txidLE) });
    }
    stats.signMs += now() - t0;
    for (const p of parts) stats.signed += p.txs.length;
    return parts;
  }

  async function post(arc: string, parts: Part[]): Promise<ArcResult[]> {
    const body = '[' + parts.map((p) => p.txs.map((t) => `{"rawTx":"${toHex(t.ef)}"}`).join(',')).join(',') + ']';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (m.waitFor) headers['X-WaitFor'] = m.waitFor;
    try {
      const r = await f(`${arc}/v1/txs`, { method: 'POST', headers, body });
      const j = await r.json();
      if (Array.isArray(j)) return j;
      ctl.emit({ type: 'why', text: `ARC ${r.status}: ${j?.detail ?? j?.title ?? 'error'}` });
    } catch (err) {
      ctl.emit({ type: 'why', text: err instanceof Error ? err.message : String(err) });
    }
    return [];
  }

  async function send(parts: Part[]) {
    const t0 = now();
    const groups: { arc: string; parts: Part[]; n: number }[] = [];
    for (const p of parts) {
      let g = groups.find((x) => x.arc === p.lane.arc && x.n + p.txs.length <= MAX_POST);
      if (!g) groups.push((g = { arc: p.lane.arc, parts: [], n: 0 }));
      g.parts.push(p);
      g.n += p.txs.length;
    }
    const answers = await Promise.all(groups.map((g) => post(g.arc, g.parts)));
    stats.postMs += now() - t0;
    stats.posts += groups.length;
    let got = 0;
    let seen = 0;
    const statuses: Record<string, number> = {};
    let last: string | undefined;
    groups.forEach((g, gi) => {
      const res = answers[gi];
      let at = 0;
      for (const p of g.parts) {
        let k = 0;
        while (k < p.txs.length) {
          const r = res[at + k];
          if (!r || !r.txStatus || BAD.test(`${r.txStatus} ${r.extraInfo ?? ''}`)) break;
          statuses[r.txStatus] = (statuses[r.txStatus] ?? 0) + 1;
          if (isSeen(r.txStatus)) seen++;
          k++;
        }
        if (k < p.txs.length) {
          p.lane.alive = false; // re-sending from a coin of unknown fate risks a double spend
          const r = res[at + k];
          if (r) ctl.emit({ type: 'why', text: `${r.txStatus ?? r.status ?? ''} ${r.extraInfo ?? r.detail ?? ''}`.trim() });
        }
        if (k) last = k === p.txs.length ? p.last : txidHex(p.txs[k - 1].txidLE);
        at += p.txs.length;
        got += k;
        stats.posted += p.txs.length;
      }
    });
    stats.accepted += got;
    if (got) ctl.emit({ type: 'sent', n: got, last, seen, statuses });
  }

  let cur: Part[] = [];
  while (!ctl.stopped()) {
    while (ctl.paused() && !ctl.stopped()) await new Promise((r) => setTimeout(r, 20));
    if (ctl.stopped()) break;
    if (!cur.length) cur = build();
    if (!cur.length) {
      if (ctl.paused()) continue;
      break;
    }
    const sending = send(cur);
    await new Promise((r) => setTimeout(r, 0)); // let the requests leave before the CPU-bound build
    const next = halted() ? [] : build();
    await sending;
    cur = next.filter((p) => p.lane.alive);
    flushStats();
  }
  flushStats(true);
}
