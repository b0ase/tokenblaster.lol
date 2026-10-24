/**
 * BSVGun storm worker: signs and broadcasts its share of lanes on its own CPU core.
 * Each lane is an unconfirmed chain: coin → blast → blast → … (one OP_RETURN tag + change each).
 *
 * Messages in:  { type: 'start', wif, token, hex, lanes: [{ vout, count, n }], step, game?, extra?, arcs?, paused? }
 *               hex: the split tx; lane coins are its outputs `vout`. game: the <game> push (default 'bsvgun');
 *               extra: short pushes after it (e.g. the player's handle). arcs: ARC base URLs (default GorillaPool).
 *               { type: 'stop' } | { type: 'pause' } | { type: 'resume' }  (paused: hold fire, keep lanes)
 * Messages out: { type: 'sent', n, last }   n = newly ARC-ACCEPTED blasts (never just attempted)
 *               { type: 'why', text }       a rejection reason (for the UI)
 *               { type: 'stats', stats }    signed / posted / accepted / signMs / postMs / posts since the last one
 *               { type: 'done' }
 *
 * Throughput (docs/throughput.md): blasts are built and signed by src/lib/fastBlast.ts (@noble/curves, raw bytes,
 * several times the SDK), and the next round is signed WHILE the current round's ARC requests are in flight. A round
 * is only SENT once ARC has answered for the round before it, and a lane carries on only from a blast ARC accepted:
 * a lane with any rejection stops for good and its pre-signed blasts are thrown away (never re-spend a coin of
 * unknown fate: that is what caused the DOUBLE_SPEND / ANNOUNCED stalls in the CLI harness).
 */
import { PrivateKey, Transaction } from '@bsv/sdk';
import { fromHex, makeBlaster, opReturn, toHex, txidHex, type Blast } from '../lib/fastBlast';

const ARC_DEFAULT = 'https://arc.gorillapool.io';
const TAG = 'tokenblaster.lol';
const FEE_RATE = 100; // sats/kB: the GorillaPool / TAAL floor
/** Most blasts in one ARC request (whole lanes only, so a lane's chain is always in order in one request). */
const MAX_POST = 600;
// Orphan is NOT bad here: a chained blast often reaches ARC a moment before its parent is processed;
// it's held and goes through once the parent lands.
const BAD = /REJECT|DOUBLE|INVALID|ERROR/i;

let stopped = false;
/** Trigger released: hold fire, keep the lanes (the next pull carries on at once). */
let paused = false;

type Lane = { txidLE: Uint8Array; vout: number; value: number; left: number; n: number; alive: boolean; arc: string };
type Part = { lane: Lane; txs: Blast[]; last: string };
type ArcResult = { txStatus?: string; extraInfo?: string; status?: number; detail?: string };

const now = () => performance.now();
const stats = { signed: 0, posted: 0, accepted: 0, signMs: 0, postMs: 0, posts: 0 };
let statsAt = 0;
function flushStats(force = false) {
  if (!force && now() - statsAt < 1000) return;
  statsAt = now();
  self.postMessage({ type: 'stats', stats: { ...stats } });
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = 0;
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'stop') {
    stopped = true;
    return;
  }
  if (m.type === 'pause' || m.type === 'resume') {
    paused = m.type === 'pause';
    return;
  }
  if (m.type !== 'start') return;
  paused = Boolean(m.paused);
  const b = makeBlaster(Uint8Array.from(PrivateKey.fromWif(m.wif).toArray('be', 32)));
  const token: string = m.token || 'sats';
  const game: string = typeof m.game === 'string' && m.game ? m.game : 'bsvgun';
  const extra: string[] = Array.isArray(m.extra) ? (m.extra as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 2) : [];
  const arcs: string[] = Array.isArray(m.arcs) && m.arcs.length ? m.arcs : [ARC_DEFAULT];
  const step: number = Math.max(1, m.step | 0);
  const base = Transaction.fromHex(m.hex);
  const baseLE = fromHex(base.id('hex')).reverse();
  // Each lane numbers its blasts in its own range so numbers never collide across workers.
  const lanes: Lane[] = (m.lanes as { vout: number; count: number; n: number }[]).map((l, i) => ({
    txidLE: baseLE,
    vout: l.vout,
    value: base.outputs[l.vout].satoshis ?? 0,
    left: l.count,
    n: l.n,
    alive: true,
    // A lane stays on one ARC so its chain always reaches the same node in order.
    arc: arcs[i % arcs.length],
  }));
  const pushes = (n: number) => opReturn([TAG, token, String(n), game, ...extra]);
  // One fee for every blast, worked out on the longest number this session can carry.
  const fee = b.feeFor(pushes(Math.max(...lanes.map((l) => l.n + l.left))), FEE_RATE);

  // Ramp: the first rounds are short so the first blasts leave at once (the first build is not overlapped
  // with anything), then each round is 4x longer, up to `step`.
  let rstep = Math.min(step, 10);
  /** Build and sign up to `rstep` blasts on every live lane, moving each lane's tip along (speculatively). */
  function build(): Part[] {
    const t0 = now();
    const cap = rstep;
    rstep = Math.min(step, rstep * 4);
    const parts: Part[] = [];
    for (const lane of lanes) {
      if (!lane.alive || lane.left <= 0) continue;
      const txs: Blast[] = [];
      while (txs.length < cap && lane.left > 0 && !stopped && !paused) {
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

  /** Send one ARC request; returns ARC's per-tx answers (empty on a failed request). */
  async function post(arc: string, parts: Part[]): Promise<ArcResult[]> {
    const body = '[' + parts.map((p) => p.txs.map((t) => `{"rawTx":"${toHex(t.ef)}"}`).join(',')).join(',') + ']';
    try {
      const r = await fetch(`${arc}/v1/txs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const j = await r.json();
      if (Array.isArray(j)) return j;
      self.postMessage({ type: 'why', text: `ARC ${r.status}: ${j?.detail ?? j?.title ?? 'error'}` });
    } catch (err) {
      self.postMessage({ type: 'why', text: err instanceof Error ? err.message : String(err) });
    }
    return [];
  }

  /** Send a round: whole lanes grouped into requests of <= MAX_POST blasts, all in parallel. */
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
    let last: string | undefined;
    groups.forEach((g, gi) => {
      const res = answers[gi];
      let at = 0;
      for (const p of g.parts) {
        let k = 0;
        while (k < p.txs.length) {
          const r = res[at + k];
          if (!r || !r.txStatus || BAD.test(`${r.txStatus} ${r.extraInfo ?? ''}`)) break;
          k++;
        }
        if (k < p.txs.length) {
          // A broken lane stops: re-sending from a coin of unknown fate risks a double spend.
          p.lane.alive = false;
          const r = res[at + k];
          if (r) self.postMessage({ type: 'why', text: `${r.txStatus ?? r.status ?? ''} ${r.extraInfo ?? r.detail ?? ''}`.trim() });
        }
        if (k) last = k === p.txs.length ? p.last : txidHex(p.txs[k - 1].txidLE);
        at += p.txs.length;
        got += k;
        stats.posted += p.txs.length;
      }
    });
    stats.accepted += got;
    if (got) self.postMessage({ type: 'sent', n: got, last });
  }

  let cur: Part[] = [];
  while (!stopped) {
    while (paused && !stopped) await new Promise((r) => setTimeout(r, 20));
    if (stopped) break;
    if (!cur.length) cur = build();
    if (!cur.length) {
      if (paused) continue; // released mid-build: wait for the next pull
      break;
    }
    const sending = send(cur);
    // Pipeline: sign the next round while this one is on the wire (none of it is sent before ARC answers).
    // Yield first so the requests actually leave before the CPU-bound build starts.
    await new Promise((r) => setTimeout(r, 0));
    const next = paused || stopped ? [] : build();
    await sending;
    // Drop pre-signed blasts of lanes that just broke.
    cur = next.filter((p) => p.lane.alive);
    flushStats();
  }
  flushStats(true);
  self.postMessage({ type: 'done' });
};
