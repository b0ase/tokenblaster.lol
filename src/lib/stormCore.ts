/**
 * The storm sender's core, shared by the browser worker (src/workers/storm.ts) and the node tests
 * (src/lib/stormCore.test.ts, against a mock ARC). No globals: the caller passes `fetch`, the stop / pause
 * flags and an `emit` for the worker's out-messages.
 *
 * WIDE, NOT DEEP (26 Oct 2026, GorillaPool's operator): ARC announces a batch's txs to the node concurrently, so a
 * child in the same POST as its parent reaches the node first and lands in the orphan mempool (depth 2 ~50 %
 * orphaned, depth 6+ 100 %, never recovered: 1.13M of 1.17M txs in 24 h). So:
 *  - the gun fans its coin out into many lane coins first (src/lib/gun.ts prepareStorm), and waits until the
 *    network has the fan-out before any lane spends it;
 *  - a lane is a short chain: coin → blast → blast, at most `maxDepth` (MAX_DEPTH = 2) deep;
 *  - a lane has at most ONE tx in flight. Its next blast is signed only after the broadcaster said the last one is
 *    on the network (SEEN_ON_NETWORK: ARC holds its answer for it with X-WaitFor), so a POST only ever carries
 *    independent txs (one per lane, same depth level) and never a parent with its child.
 * A lane whose tx came back held (STORED / QUEUED / SEEN_IN_ORPHAN_MEMPOOL …) waits and asks the broadcaster
 * again (GET the tx) before it goes on; a tx the broadcaster never got is re-sent (same bytes).
 *
 * Tag: "tokenblaster.lol" <token> <n> <game> [...extra]  (extra: e.g. the player's paymail, see src/lib/gallery.ts).
 *
 * Network status (owner test, 25 Oct 2026): only SEEN_ON_NETWORK-type statuses mean the network has it NOW; the
 * held ones count as "sent" (the coin is spent either way), but `seen` counts only the first group, and every
 * POST's histogram goes out as a 'batch' message, with the SEEN_IN_ORPHAN_MEMPOOL count, for the [tb-load] log.
 *
 * Broadcasters: ARC (default, POST /v1/txs, JSON EF, per-tx answers) or Arcade (GorillaPool's Teranode-backed
 * service, POST /txs, concatenated raw EF bytes, one 202 for the batch, statuses by GET /tx/:txid). Same POST
 * timeout and resend rules for both.
 */
import { bsv21Lock, fromHex, makeBlaster, opReturn, toHex, txidHex, type Blast } from './fastBlast';

export const ARC_DEFAULT = 'https://arc.gorillapool.io';
export const ARCADE_DEFAULT = 'https://arcade.gorillapool.io';
export type BroadcasterKind = 'arc' | 'arcade';
export const TAG = 'tokenblaster.lol';
export const FEE_RATE = 100; // sats/kB: the GorillaPool / TAAL floor
/** Most txs in one POST (GorillaPool: 600 a POST is fine). All independent: one per lane. */
export const MAX_POST = 600;
/** Most POSTs a worker has in flight at once. */
export const MAX_INFLIGHT = 4;
/** Deepest unconfirmed chain on one fan-out coin (sats storm; = src/lib/gallery.ts LANE_DEPTH). */
export const MAX_DEPTH = 2;
/** ARC X-WaitFor by default: answer once the network has the tx, so the lane can go on from it. */
export const WAIT_FOR = 'SEEN_ON_NETWORK';
/** ARC X-MaxTimeout (s, max 30): kept under the client POST deadline so ARC answers before we give up. */
export const ARC_MAX_TIMEOUT_S = 8;
/** A held lane asks again every POLL_MS, at most POLL_TRIES times, and re-sends a tx the broadcaster lost at most RESENDS times. */
export const POLL_MS = 1000;
export const POLL_TRIES = 20;
export const RESENDS = 2;
const BAD = /REJECT|DOUBLE|INVALID|ERROR/i;
/** On the network now (not just held by the broadcaster). Arcade adds SEEN_MULTIPLE_NODES. */
export const isSeen = (s: string | undefined) => !!s && /^(SEEN_ON_NETWORK|SEEN_MULTIPLE_NODES|ACCEPTED_BY_NETWORK|MINED|IMMUTABLE|CONFIRMED)$/.test(s);
export const ORPHAN = 'SEEN_IN_ORPHAN_MEMPOOL';
/** Status lookup: the broadcaster has never heard of the tx. */
export const NOT_FOUND = 'NOT_FOUND';

export type StartMsg = {
  /** 32-byte private key of the gun (the worker derives it from the WIF). */
  priv: Uint8Array;
  token?: string;
  /** The fan-out tx: its txid (hex) and output values; lane coins are its outputs `vout`. */
  baseTxid: string;
  baseValues: number[];
  /** More fan-out txs (a big load splits in several, src/lib/gun.ts): a lane with `base: i` spends bases[i - 1]. */
  bases?: { txid: string; values: number[] }[];
  lanes: { vout: number; count: number; n: number; base?: number; tok?: { vout: number; amt: string } }[];
  /**
   * Coin ammo (25 Oct 2026): every shot burns `per` tokens of `id` to `toLockHex` (the burn address). Each lane then
   * has a token coin (`tok`, 1 sat, an output of the same base tx) next to its fee coin (`vout`). The <token> push
   * is the token id, so bsv.lol counts it as TokenBlaster and labels it with the coin's symbol.
   */
  burn?: { id: string; per: string; toLockHex: string };
  /** Legacy (blasts per lane per round): a lane now sends one tx per POST, so this is ignored. */
  step?: number;
  /** Most blasts one lane chains (default: its whole count). The sats storm passes MAX_DEPTH. */
  maxDepth?: number;
  game?: string;
  extra?: unknown;
  /** Broadcaster base URLs (default: GorillaPool ARC, or Arcade when `broadcaster` is 'arcade'). */
  arcs?: string[];
  broadcaster?: BroadcasterKind;
  paused?: boolean;
  /** ARC X-WaitFor (default WAIT_FOR; '' turns it off). Arcade has no such header: its lanes always ask by GET. */
  waitFor?: string;
};
export type Out =
  | { type: 'sent'; n: number; last?: string; seen: number; orphans: number; statuses: Record<string, number> }
  | { type: 'batch'; via: string; n: number; ms: number; statuses: Record<string, number> }
  | { type: 'why'; text: string }
  | { type: 'stats'; stats: Stats };
export type Stats = { signed: number; posted: number; accepted: number; signMs: number; postMs: number; posts: number; orphans: number };
export type Ctl = {
  stopped: () => boolean;
  paused: () => boolean;
  emit: (m: Out) => void;
  fetch?: typeof fetch;
  now?: () => number;
  /** Per-POST deadline (default POST_TIMEOUT_MS) and back-off base between resends (default POST_BACKOFF_MS). Tests shrink them. */
  postTimeoutMs?: number;
  postBackoffMs?: number;
  /** Gap between status asks for a held lane (default POLL_MS). Tests shrink it. */
  pollMs?: number;
};
/**
 * One POST may take at most this long (26 Oct 2026: a stalled POST froze a storm at exactly 5,000 txs and held
 * the gun lock). On a timeout or network error the SAME bytes are re-POSTed (same txids, so it is idempotent) up to
 * POST_TRIES times with a growing back-off, and only then are the lanes given up.
 */
export const POST_TIMEOUT_MS = 10_000;
export const POST_TRIES = 3;
export const POST_BACKOFF_MS = 500;

export type TxResult = { txid?: string; txStatus?: string; extraInfo?: string; status?: number; detail?: string };

/** One broadcaster endpoint: POST a batch of independent txs, and look one tx up. */
export type Broadcaster = {
  kind: BroadcasterKind;
  url: string;
  /** Answers in the order of `efs` ([] when the POST failed every try). */
  post: (efs: Uint8Array[], txids: string[]) => Promise<TxResult[]>;
  status: (txid: string) => Promise<TxResult | null>;
};
export type BroadcasterOpts = {
  fetch?: typeof fetch;
  stopped?: () => boolean;
  why?: (text: string) => void;
  timeoutMs?: number;
  backoffMs?: number;
  waitFor?: string;
};

const describe = (j: unknown): string | undefined => {
  if (!j || typeof j !== 'object') return undefined;
  const o = j as Record<string, unknown>;
  const v = o.detail ?? o.reason ?? o.error ?? o.title;
  return typeof v === 'string' ? v : undefined;
};

/** fetch + JSON with the POST deadline and bounded resends of the same request (5xx / timeout / network error only). */
async function request(f: typeof fetch, url: string, init: RequestInit, o: BroadcasterOpts, tries = POST_TRIES): Promise<{ status: number; j: unknown } | null> {
  const timeout = o.timeoutMs ?? POST_TIMEOUT_MS;
  const backoff = o.backoffMs ?? POST_BACKOFF_MS;
  const host = url.replace(/^https?:\/\//, '').split('/')[0];
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, backoff * i));
    if (o.stopped?.()) break;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, rej) => {
      timer = setTimeout(() => {
        ac.abort();
        rej(new Error(`${init.method ?? 'GET'} ${host} timed out after ${Math.round(timeout / 1000)} s`));
      }, timeout);
    });
    try {
      // The race also covers a fetch (or body read) that ignores the abort signal.
      const r = await Promise.race([f(url, { ...init, signal: ac.signal }).then(async (r) => ({ status: r.status, j: (await r.json().catch(() => null)) as unknown })), late]);
      if (r.status < 500) return r; // a real answer (2xx / 4xx): resending the same bytes will not help a 4xx
      o.why?.(`${host} ${r.status}: ${describe(r.j) ?? 'error'}`);
    } catch (err) {
      o.why?.(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** GorillaPool ARC: POST /v1/txs (JSON EF, X-WaitFor + X-MaxTimeout), GET /v1/tx/:txid. */
export function arcBroadcaster(url: string, o: BroadcasterOpts = {}): Broadcaster {
  const f = o.fetch ?? fetch;
  return {
    kind: 'arc',
    url,
    async post(efs) {
      const body = '[' + efs.map((e) => `{"rawTx":"${toHex(e)}"}`).join(',') + ']';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (o.waitFor) {
        headers['X-WaitFor'] = o.waitFor;
        headers['X-MaxTimeout'] = String(ARC_MAX_TIMEOUT_S);
      }
      const r = await request(f, `${url}/v1/txs`, { method: 'POST', headers, body }, o);
      if (!r) return [];
      if (Array.isArray(r.j)) return r.j as TxResult[];
      o.why?.(`ARC ${r.status}: ${describe(r.j) ?? 'error'}`);
      return [];
    },
    async status(txid) {
      const r = await request(f, `${url}/v1/tx/${txid}`, { method: 'GET' }, o, 1);
      if (!r) return null;
      if (r.status === 404) return { txid, txStatus: NOT_FOUND };
      return r.j && typeof r.j === 'object' ? (r.j as TxResult) : null;
    },
  };
}

/**
 * GorillaPool Arcade (arcade.gorillapool.io, Teranode-backed; under active development, off by default):
 * POST /txs takes the batch as concatenated raw tx bytes (application/octet-stream; EF is accepted) and answers
 * 202 { submitted, duplicates, total } for the whole batch, or 400 { txid, reason } when any tx fails validation
 * (that one is REJECTED). No per-tx status and no X-WaitFor, so every tx comes back RECEIVED and its lane asks
 * GET /tx/:txid until the network has it.
 */
export function arcadeBroadcaster(url: string, o: BroadcasterOpts = {}): Broadcaster {
  const f = o.fetch ?? fetch;
  return {
    kind: 'arcade',
    url,
    async post(efs, txids) {
      const body = new Uint8Array(efs.reduce((n, e) => n + e.length, 0));
      let at = 0;
      for (const e of efs) {
        body.set(e, at);
        at += e.length;
      }
      const r = await request(f, `${url}/txs`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body }, o);
      if (!r) return [];
      if (r.status >= 200 && r.status < 300) return txids.map((txid) => ({ txid, txStatus: 'RECEIVED' }));
      const j = (r.j ?? {}) as { txid?: string };
      o.why?.(`Arcade ${r.status}: ${describe(r.j) ?? 'error'}`);
      if (r.status === 400 && j.txid) {
        // Only the named tx is bad; the rest are of unknown fate: their lanes ask (and re-send if Arcade lost them).
        return txids.map((txid) => (txid === j.txid ? { txid, txStatus: 'REJECTED', extraInfo: describe(r.j) } : { txid, txStatus: 'RECEIVED' }));
      }
      return [];
    },
    async status(txid) {
      const r = await request(f, `${url}/tx/${txid}`, { method: 'GET' }, o, 1);
      if (!r) return null;
      if (r.status === 404) return { txid, txStatus: NOT_FOUND };
      return r.j && typeof r.j === 'object' ? (r.j as TxResult) : null;
    },
  };
}

/** The broadcaster for `kind` (ARC unless 'arcade'). ARC gets X-WaitFor: WAIT_FOR unless `waitFor` is ''. */
export function makeBroadcaster(kind: BroadcasterKind | undefined, url: string | undefined, o: BroadcasterOpts = {}): Broadcaster {
  if (kind === 'arcade') return arcadeBroadcaster(url || ARCADE_DEFAULT, o);
  const waitFor = o.waitFor ?? WAIT_FOR;
  return arcBroadcaster(url || ARC_DEFAULT, { ...o, waitFor: waitFor || undefined });
}

/**
 * Broadcast already-signed independent txs (a fan-out level) in one POST and wait until the network has every one
 * (or `deadlineMs` passes). src/lib/gun.ts runs this before any lane spends a fan-out output. Returns the seen txids
 * and the last status of each, and which ones the broadcaster refused.
 */
export async function settleTxs(
  bc: Broadcaster,
  txs: { ef: Uint8Array; txid: string }[],
  o: { deadlineMs?: number; pollMs?: number } = {},
): Promise<{ seen: Set<string>; statuses: Record<string, string>; bad: string[] }> {
  const end = Date.now() + (o.deadlineMs ?? 60_000);
  const seen = new Set<string>();
  const statuses: Record<string, string> = {};
  const bad: string[] = [];
  const res = await bc.post(
    txs.map((t) => t.ef),
    txs.map((t) => t.txid),
  );
  txs.forEach((t, i) => {
    const r = res[i];
    statuses[t.txid] = r?.txStatus ?? 'NO_ANSWER';
    if (r?.txStatus && BAD.test(`${r.txStatus} ${r.extraInfo ?? ''}`)) bad.push(t.txid);
    if (isSeen(r?.txStatus)) seen.add(t.txid);
  });
  while (seen.size + bad.length < txs.length && Date.now() < end) {
    await new Promise((r) => setTimeout(r, o.pollMs ?? POLL_MS));
    await Promise.all(
      txs
        .filter((t) => !seen.has(t.txid) && !bad.includes(t.txid))
        .map(async (t) => {
          const r = await bc.status(t.txid);
          if (r?.txStatus) statuses[t.txid] = r.txStatus;
          if (isSeen(r?.txStatus)) seen.add(t.txid);
        }),
    );
  }
  return { seen, statuses, bad };
}

/** ready: may sign its next blast · flight: a POST or status ask is out · held: waiting to ask again · resend: re-POST `pending` · done. */
type LaneState = 'ready' | 'flight' | 'held' | 'resend' | 'done';
type Lane = {
  txidLE: Uint8Array;
  vout: number;
  value: number;
  left: number;
  n: number;
  state: LaneState;
  bc: Broadcaster;
  /** The lane's last tx (its tip): in flight, held or to re-send. */
  pending?: Blast;
  polls: number;
  resends: number;
  due: number;
  tok?: { txidLE: Uint8Array; vout: number; amt: bigint; lock: Uint8Array };
};

/** The <game> push and up to two short pushes after it (strings only). */
export function tagPushes(token: string, n: number, game: string | undefined, extra: unknown): string[] {
  const ex = Array.isArray(extra) ? extra.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 2) : [];
  return [TAG, token || 'sats', String(n), game || 'bsvgun', ...ex];
}

export async function runLanes(m: StartMsg, ctl: Ctl): Promise<void> {
  const now = ctl.now ?? (() => performance.now());
  const pollMs = ctl.pollMs ?? POLL_MS;
  const stats: Stats = { signed: 0, posted: 0, accepted: 0, signMs: 0, postMs: 0, posts: 0, orphans: 0 };
  let statsAt = 0;
  const flushStats = (force = false) => {
    if (!force && now() - statsAt < 1000) return;
    statsAt = now();
    ctl.emit({ type: 'stats', stats: { ...stats } });
    for (const k of Object.keys(stats) as (keyof Stats)[]) stats[k] = 0;
  };
  const b = makeBlaster(m.priv);
  const token = m.burn ? m.burn.id : m.token || 'sats';
  const per = m.burn ? BigInt(m.burn.per) : BigInt(0);
  const toLock = m.burn ? fromHex(m.burn.toLockHex) : null;
  const kind: BroadcasterKind = m.broadcaster === 'arcade' ? 'arcade' : 'arc';
  const urls = m.arcs && m.arcs.length ? m.arcs : [kind === 'arcade' ? ARCADE_DEFAULT : ARC_DEFAULT];
  const bcs = urls.map((u) =>
    makeBroadcaster(kind, u, {
      fetch: ctl.fetch,
      stopped: ctl.stopped,
      why: (text) => ctl.emit({ type: 'why', text }),
      timeoutMs: ctl.postTimeoutMs,
      backoffMs: ctl.postBackoffMs,
      waitFor: m.waitFor,
    }),
  );
  const bases = [{ txid: m.baseTxid, values: m.baseValues }, ...(m.bases ?? [])].map((x) => ({ le: fromHex(x.txid).reverse(), values: x.values }));
  const depth = m.maxDepth && m.maxDepth > 0 ? m.maxDepth : Infinity;
  const lanes: Lane[] = m.lanes.map((l, i) => {
    const base = bases[l.base ?? 0] ?? bases[0];
    return {
      txidLE: base.le,
      vout: l.vout,
      value: base.values[l.vout] ?? 0,
      left: Math.min(l.count, depth),
      n: l.n,
      state: 'ready',
      bc: bcs[i % bcs.length], // a lane stays on one broadcaster so its chain reaches the same node
      polls: 0,
      resends: 0,
      due: 0,
      tok: m.burn && l.tok ? { txidLE: base.le, vout: l.tok.vout, amt: BigInt(l.tok.amt), lock: bsv21Lock(m.burn.id, BigInt(l.tok.amt), b.lock) } : undefined,
    };
  });
  const pushes = (n: number) => opReturn(tagPushes(token, n, m.game, m.extra));
  // One fee for every blast, worked out on the longest number this session can carry.
  const fee = b.feeFor(pushes(Math.max(...lanes.map((l) => l.n + l.left))), FEE_RATE);
  const halted = () => ctl.stopped() || ctl.paused();

  /** Sign the lane's next blast (from its tip, which the network already has) and move the tip onto it. */
  function next(lane: Lane): Blast | null {
    if (lane.left <= 0) return null;
    if (m.burn) {
      // A burn lane: spend the token coin and the fee coin; carry on from the rest + the change.
      const tk = lane.tok;
      if (!tk || tk.amt < per) return null;
      const t = b.burn(tk, { txidLE: lane.txidLE, vout: lane.vout, value: lane.value }, m.burn.id, per, toLock!, pushes(lane.n), FEE_RATE);
      if (!t) return null;
      lane.txidLE = t.txidLE;
      lane.vout = t.changeVout;
      lane.value = t.change;
      lane.tok = t.restLock ? { txidLE: t.txidLE, vout: 1, amt: t.rest, lock: t.restLock } : undefined;
      return t;
    }
    if (lane.value - fee < 1) return null;
    const t = b.blast(lane.txidLE, lane.vout, lane.value, pushes(lane.n), fee);
    lane.txidLE = t.txidLE;
    lane.vout = 1;
    lane.value = t.change;
    return t;
  }

  /** Up to MAX_POST lanes on one broadcaster with a tx to send (a fresh blast, or the same bytes again): one tx per lane. */
  function take(): { bc: Broadcaster; lanes: Lane[] } | null {
    const t0 = now();
    let bc: Broadcaster | null = null;
    const out: Lane[] = [];
    for (const lane of lanes) {
      if (out.length >= MAX_POST) break;
      if (lane.state !== 'ready' && lane.state !== 'resend') continue;
      if (bc && lane.bc !== bc) continue;
      if (lane.state === 'ready') {
        const t = next(lane);
        if (!t) {
          lane.state = 'done';
          continue;
        }
        lane.pending = t;
        lane.resends = 0;
        stats.signed++;
      }
      bc = lane.bc;
      lane.state = 'flight';
      out.push(lane);
    }
    stats.signMs += now() - t0;
    return bc && out.length ? { bc, lanes: out } : null;
  }

  /** The network has the lane's tip: carry on from it (or finish). */
  const advance = (lane: Lane) => {
    lane.left--;
    lane.n++;
    lane.pending = undefined;
    lane.polls = 0;
    lane.state = lane.left > 0 ? 'ready' : 'done';
  };
  const hold = (lane: Lane) => {
    lane.state = 'held';
    lane.due = now() + pollMs;
  };
  const isBad = (r: TxResult) => BAD.test(`${r.txStatus ?? ''} ${r.extraInfo ?? ''}`);

  async function sendBatch(bc: Broadcaster, batch: Lane[]) {
    const t0 = now();
    const res = await bc.post(
      batch.map((l) => l.pending!.ef),
      batch.map((l) => txidHex(l.pending!.txidLE)),
    );
    const ms = now() - t0;
    stats.postMs += ms;
    stats.posts++;
    stats.posted += batch.length;
    let got = 0;
    let seen = 0;
    let orphans = 0;
    let last: string | undefined;
    const statuses: Record<string, number> = {};
    batch.forEach((lane, i) => {
      const r = res[i];
      const s = r?.txStatus ?? 'NO_ANSWER';
      statuses[s] = (statuses[s] ?? 0) + 1;
      if (!r || !r.txStatus || isBad(r)) {
        // No answer after every try, or a rejection: re-sending from a coin of unknown fate risks a double spend.
        lane.state = 'done';
        if (r) ctl.emit({ type: 'why', text: `${r.txStatus ?? r.status ?? ''} ${r.extraInfo ?? r.detail ?? ''}`.trim() });
        return;
      }
      got++;
      last = txidHex(lane.pending!.txidLE);
      if (s === ORPHAN) orphans++;
      if (isSeen(s)) {
        seen++;
        advance(lane);
      } else if (lane.left <= 1) advance(lane); // the lane's last blast: nothing will spend it, nothing to wait for
      else hold(lane);
    });
    stats.accepted += got;
    stats.orphans += orphans;
    ctl.emit({ type: 'batch', via: bc.kind, n: batch.length, ms: Math.round(ms), statuses });
    if (got) ctl.emit({ type: 'sent', n: got, last, seen, orphans, statuses });
  }

  /** Ask about the held lanes that are due; carry on from the ones the network now has. */
  async function poll() {
    const due = lanes.filter((l) => l.state === 'held' && l.due <= now()).slice(0, 50);
    for (const l of due) l.state = 'flight';
    let seen = 0;
    const statuses: Record<string, number> = {};
    await Promise.all(
      due.map(async (lane) => {
        const r = await lane.bc.status(txidHex(lane.pending!.txidLE));
        const s = r?.txStatus;
        if (s) statuses[s] = (statuses[s] ?? 0) + 1;
        if (isSeen(s)) {
          seen++;
          advance(lane);
        } else if (s === NOT_FOUND && lane.resends < RESENDS) {
          lane.resends++;
          lane.state = 'resend'; // the broadcaster lost it: the same bytes go out again
        } else if ((r && isBad(r)) || s === NOT_FOUND || ++lane.polls >= POLL_TRIES) {
          lane.state = 'done'; // never seen: its coin's fate is unknown, so the lane stops here
          if (r && s !== NOT_FOUND) ctl.emit({ type: 'why', text: `${s ?? ''} ${r.extraInfo ?? ''}`.trim() });
        } else hold(lane);
      }),
    );
    if (seen) ctl.emit({ type: 'sent', n: 0, seen, orphans: 0, statuses });
  }

  const inflight = new Set<Promise<void>>();
  const track = (p: Promise<void>) => {
    const q: Promise<void> = p.finally(() => inflight.delete(q));
    inflight.add(q);
  };
  let polling = false;
  while (!ctl.stopped()) {
    if (!halted()) {
      while (inflight.size < MAX_INFLIGHT) {
        const batch = take();
        if (!batch) break;
        track(sendBatch(batch.bc, batch.lanes));
        await new Promise((r) => setTimeout(r, 0)); // let the request leave before the next CPU-bound build
      }
    }
    if (!polling && lanes.some((l) => l.state === 'held' && l.due <= now())) {
      polling = true;
      track(poll().finally(() => (polling = false)));
    }
    if (!inflight.size && !lanes.some((l) => l.state === 'held' || (ctl.paused() && l.state !== 'done'))) break;
    await Promise.race([...inflight, new Promise((r) => setTimeout(r, Math.min(pollMs, 50)))]);
    flushStats();
  }
  await Promise.allSettled([...inflight]);
  flushStats(true);
}
