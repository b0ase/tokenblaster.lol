/**
 * Ramp-test broadcasters (29 Oct 2026 ramp with GorillaPool): one interface over ARC and the BSV Broadcaster
 * (formerly Arcade; it replaces ARC, arc.taal.com closes 30 Nov).
 *
 *  - ARC:              POST {url}/v1/txs  JSON [{"rawTx": EF hex}]   GET {url}/v1/tx/{txid}   GET {url}/v1/policy
 *  - BSV Broadcaster:  POST {url}/txs     octet-stream, EF bytes back to back (max 256 MiB)
 *                      POST {url}/tx      one tx (octet-stream)       GET {url}/tx/{txid}?callbackToken=
 *                      GET  {url}/policy  GET {url}/health            GET {url}/events?callbackToken= (SSE)
 *
 * Rules (from the operators):
 *  - 503 / 5xx / timeout: back off and re-send the SAME bytes (the body buffer is built once and reused). Never rebuild.
 *  - 400 is final. A /txs batch with one bad tx is refused whole (nothing published), so a 400 batch is split:
 *    the tx the error names is dropped, else the batch is bisected, down to single /tx posts that find it.
 *  - Each broadcaster only knows what was sent to it: status is always asked of the same endpoint.
 *  - Every request carries X-CallbackToken (the ramp tag), on ARC too.
 *  - Body: EF or raw only (never BEEF).
 */

export type Kind = 'arc' | 'bsv';
export const ARC_URL = 'https://arc.gorillapool.io';
export const BSV_URLS = [
  'https://arcade.gorillapool.io',
  'https://arcade-us-1.bsvblockchain.tech',
  'https://arcade-eu-1.bsvblockchain.tech',
  'https://arcade-ap-1.bsvblockchain.tech',
] as const;
export const BSV_URL = BSV_URLS[0];
export const CALLBACK_TOKEN = 'terrornode-ramp-29oct';
export const MAX_BODY_BYTES = 256 * 1024 * 1024;

export type TxItem = { txid: string; bytes: Uint8Array };
/** accepted: the broadcaster took it · rejected: final (400 / REJECTED) · retry: no answer after every resend (hold the same bytes). */
export type SubmitResult = { txid: string; outcome: 'accepted' | 'rejected' | 'retry'; txStatus?: string; reason?: string };
export type TxStatus = { txid: string; txStatus: string; extraInfo?: string; blockHeight?: number };
export type Policy = { satsPerKb: number; maxTxSize?: number; raw: unknown };

export interface Broadcaster {
  kind: Kind;
  url: string;
  submit(items: TxItem[]): Promise<SubmitResult[]>;
  status(txid: string): Promise<TxStatus | null>;
  policy(): Promise<Policy>;
  health(): Promise<{ ok: boolean; raw: unknown }>;
}

export type Opts = {
  fetch?: typeof fetch;
  callbackToken?: string;
  /** Per-request deadline (ms). */
  timeoutMs?: number;
  /** Tries per request for 5xx / timeout (same bytes each time). */
  tries?: number;
  /** First backoff (ms); doubles each retry, capped at 8 s; Retry-After wins when given. */
  backoffMs?: number;
  /** Most txs in one POST. */
  maxBatch?: number;
  /** Set when the run is halting: no new tries. */
  stopped?: () => boolean;
  /** Abort in-flight requests (halt within 10 s). */
  signal?: AbortSignal;
  log?: (s: string) => void;
  /** Called with every request body sent (tests check resends are byte-identical). */
  onSend?: (path: string, body: Uint8Array | string) => void;
};

const toHex = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('hex');
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => {
    if (signal?.aborted) return res();
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
  });

export const SEEN = new Set(['SEEN_ON_NETWORK', 'SEEN_MULTIPLE_NODES']);
export const MINED = new Set(['MINED', 'IMMUTABLE']);
export const BAD = new Set(['REJECTED', 'DOUBLE_SPEND_ATTEMPTED']);
export const ORPHAN = 'SEEN_IN_ORPHAN_MEMPOOL';
export const MISSING_INPUTS = /missing[\s_-]*inputs/i;

/** Where a tx stands. Only seen / mined outputs may be built on (ANNOUNCED_TO_NETWORK, SEEN_IN_ORPHAN_MEMPOOL … are unsettled). */
export type Settle = 'unsettled' | 'seen' | 'mined' | 'rejected' | 'orphan-dead' | 'unknown';
export function classify(s: { txStatus?: string; extraInfo?: string } | null | undefined, acceptedIsSeen = false): Settle {
  const t = (s?.txStatus ?? '').toUpperCase();
  if (!t || t === 'NOT_FOUND' || t === 'UNKNOWN') return 'unknown';
  if (MINED.has(t)) return 'mined';
  if (SEEN.has(t) || (acceptedIsSeen && t === 'ACCEPTED_BY_NETWORK')) return 'seen';
  if (BAD.has(t)) return MISSING_INPUTS.test(s?.extraInfo ?? '') ? 'orphan-dead' : 'rejected';
  return 'unsettled';
}

type Resp = { status: number; j: unknown; text: string };

/** One request, re-sent (same init, same body) on 5xx / timeout / network error with backoff. null = gave up. */
export async function send(url: string, init: RequestInit, o: Opts, tries = o.tries ?? 5): Promise<Resp | null> {
  const f = o.fetch ?? fetch;
  let wait = o.backoffMs ?? 500;
  for (let i = 0; i < tries; i++) {
    if (o.stopped?.() || o.signal?.aborted) return null;
    const ac = new AbortController();
    const kill = () => ac.abort();
    o.signal?.addEventListener('abort', kill, { once: true });
    const timer = setTimeout(kill, o.timeoutMs ?? 10_000);
    let retryAfter = 0;
    try {
      if (init.body !== undefined && init.body !== null) o.onSend?.(new URL(url).pathname, init.body as Uint8Array | string);
      const r = await f(url, { ...init, signal: ac.signal });
      const text = await r.text();
      let j: unknown = null;
      try { j = JSON.parse(text); } catch { /* not JSON */ }
      if (r.status < 500) return { status: r.status, j, text };
      retryAfter = Number(r.headers.get('retry-after')) * 1000 || 0;
      o.log?.(`${r.status} from ${url} (try ${i + 1}/${tries})`);
    } catch (e) {
      o.log?.(`${url}: ${e instanceof Error ? e.message : String(e)} (try ${i + 1}/${tries})`);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', kill);
    }
    if (i < tries - 1) {
      await sleep(Math.min(retryAfter || wait, 8000), o.signal);
      wait = Math.min(wait * 2, 8000);
    }
  }
  return null;
}

const reasonOf = (j: unknown, text: string): string => {
  if (j && typeof j === 'object') {
    const o = j as Record<string, unknown>;
    for (const k of ['extraInfo', 'reason', 'detail', 'error', 'title']) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  }
  return text.slice(0, 200);
};

const chunks = <T>(a: T[], n: number, maxBytes = Infinity, size: (x: T) => number = () => 0): T[][] => {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const x of a) {
    const s = size(x);
    if (cur.length && (cur.length >= n || bytes + s > maxBytes)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(x);
    bytes += s;
  }
  if (cur.length) out.push(cur);
  return out;
};

function parsePolicy(j: unknown): Policy {
  const p = ((j as { policy?: unknown })?.policy ?? j) as { miningFee?: { satoshis?: number; bytes?: number }; maxtxsizepolicy?: number };
  const fee = p?.miningFee;
  if (!fee || !fee.bytes || fee.satoshis === undefined) throw new Error('policy has no miningFee');
  return { satsPerKb: (fee.satoshis * 1000) / fee.bytes, maxTxSize: p.maxtxsizepolicy, raw: j };
}

/**
 * Split a refused batch until the bad tx(s) are found. `post(items)` returns 'ok' | {bad txid?} | null (no answer).
 * A named txid is dropped and the rest re-posted; otherwise halves; a single item is posted on its own.
 */
async function isolate(items: TxItem[], post: (items: TxItem[]) => Promise<{ ok: true } | { ok: false; status: number; txid?: string; reason: string } | null>, single: (it: TxItem) => Promise<SubmitResult>): Promise<SubmitResult[]> {
  if (items.length === 1) return [await single(items[0])];
  const r = await post(items);
  if (!r) return items.map((it) => ({ txid: it.txid, outcome: 'retry' as const }));
  if (r.ok) return items.map((it) => ({ txid: it.txid, outcome: 'accepted' as const, txStatus: 'RECEIVED' }));
  if (r.txid && items.some((it) => it.txid === r.txid)) {
    const rest = items.filter((it) => it.txid !== r.txid);
    const bad: SubmitResult = { txid: r.txid, outcome: 'rejected', txStatus: 'REJECTED', reason: r.reason };
    return [bad, ...(rest.length ? await isolate(rest, post, single) : [])];
  }
  const mid = items.length >> 1;
  return [...(await isolate(items.slice(0, mid), post, single)), ...(await isolate(items.slice(mid), post, single))];
}

/** The BSV Broadcaster (formerly Arcade). */
export function bsvBroadcaster(url: string = BSV_URL, o: Opts = {}): Broadcaster {
  const token = o.callbackToken ?? CALLBACK_TOKEN;
  const headers = { 'Content-Type': 'application/octet-stream', 'X-CallbackToken': token };
  const postMany = async (items: TxItem[]) => {
    const body = new Uint8Array(items.reduce((n, it) => n + it.bytes.length, 0));
    let at = 0;
    for (const it of items) { body.set(it.bytes, at); at += it.bytes.length; }
    const r = await send(`${url}/txs`, { method: 'POST', headers, body }, o);
    if (!r) return null;
    if (r.status >= 200 && r.status < 300) return { ok: true as const };
    const j = (r.j ?? {}) as { txid?: string };
    return { ok: false as const, status: r.status, txid: typeof j.txid === 'string' ? j.txid : undefined, reason: reasonOf(r.j, r.text) };
  };
  const postOne = async (it: TxItem): Promise<SubmitResult> => {
    const r = await send(`${url}/tx`, { method: 'POST', headers, body: it.bytes as Uint8Array<ArrayBuffer> }, o);
    if (!r) return { txid: it.txid, outcome: 'retry' };
    const j = (r.j ?? {}) as { txStatus?: string };
    if (r.status >= 200 && r.status < 300) return { txid: it.txid, outcome: 'accepted', txStatus: j.txStatus ?? 'RECEIVED' };
    return { txid: it.txid, outcome: 'rejected', txStatus: j.txStatus ?? 'REJECTED', reason: reasonOf(r.j, r.text) };
  };
  return {
    kind: 'bsv',
    url,
    async submit(items) {
      const out: SubmitResult[] = [];
      for (const c of chunks(items, o.maxBatch ?? 1000, MAX_BODY_BYTES, (it) => it.bytes.length)) {
        if (c.length === 1) { out.push(await postOne(c[0])); continue; }
        out.push(...(await isolate(c, postMany, postOne)));
      }
      return out;
    },
    async status(txid) {
      const r = await send(`${url}/tx/${txid}?callbackToken=${encodeURIComponent(token)}`, { method: 'GET', headers: { 'X-CallbackToken': token } }, o, 2);
      if (!r) return null;
      if (r.status === 404) return { txid, txStatus: 'NOT_FOUND' };
      return r.j && typeof r.j === 'object' ? ({ txid, ...(r.j as object) } as TxStatus) : null;
    },
    async policy() {
      let r = await send(`${url}/policy`, { method: 'GET' }, o, 3);
      if (!r || r.status !== 200) r = await send(`${url}/v1/policy`, { method: 'GET' }, o, 3);
      if (!r || r.status !== 200) throw new Error(`GET ${url}/policy failed`);
      return parsePolicy(r.j);
    },
    async health() {
      const r = await send(`${url}/health`, { method: 'GET' }, o, 2);
      const j = r?.j as { healthy?: boolean } | null;
      return { ok: !!r && r.status === 200 && j?.healthy !== false, raw: r?.j ?? null };
    },
  };
}

/** ARC (GorillaPool). Per-tx answers in a JSON array; a whole-request 4xx is bisected like the Broadcaster. */
export function arcBroadcaster(url: string = ARC_URL, o: Opts = {}): Broadcaster {
  const token = o.callbackToken ?? CALLBACK_TOKEN;
  const headers = { 'Content-Type': 'application/json', 'X-CallbackToken': token };
  type ArcRow = { txid?: string; txStatus?: string; status?: number; extraInfo?: string; detail?: string };
  const rowResult = (txid: string, row: ArcRow | undefined): SubmitResult => {
    if (!row) return { txid, outcome: 'retry' };
    const st = row.txStatus ?? '';
    const bad = BAD.has(st.toUpperCase()) || (typeof row.status === 'number' && row.status >= 400);
    return bad ? { txid, outcome: 'rejected', txStatus: st || 'REJECTED', reason: row.extraInfo || row.detail } : { txid, outcome: 'accepted', txStatus: st || 'RECEIVED' };
  };
  const postArc = async (items: TxItem[]): Promise<{ rows: ArcRow[] } | { ok: false; status: number; txid?: string; reason: string } | null> => {
    const body = '[' + items.map((it) => `{"rawTx":"${toHex(it.bytes)}"}`).join(',') + ']';
    const r = await send(`${url}/v1/txs`, { method: 'POST', headers, body }, o);
    if (!r) return null;
    if (r.status >= 200 && r.status < 300 && Array.isArray(r.j)) return { rows: r.j as ArcRow[] };
    const j = (r.j ?? {}) as { txid?: string };
    return { ok: false, status: r.status, txid: typeof j.txid === 'string' ? j.txid : undefined, reason: reasonOf(r.j, r.text) };
  };
  const byTxid = (items: TxItem[], rows: ArcRow[]) => items.map((it, i) => rowResult(it.txid, rows.find((x) => x.txid === it.txid) ?? rows[i]));
  const single = async (it: TxItem): Promise<SubmitResult> => {
    const r = await postArc([it]);
    if (!r) return { txid: it.txid, outcome: 'retry' };
    if ('rows' in r) return byTxid([it], r.rows)[0];
    return { txid: it.txid, outcome: 'rejected', txStatus: 'REJECTED', reason: r.reason };
  };
  return {
    kind: 'arc',
    url,
    async submit(items) {
      const out: SubmitResult[] = [];
      for (const c of chunks(items, o.maxBatch ?? 600)) {
        const first = await postArc(c);
        if (!first) { out.push(...c.map((it) => ({ txid: it.txid, outcome: 'retry' as const }))); continue; }
        if ('rows' in first) { out.push(...byTxid(c, first.rows)); continue; }
        // Whole request refused: find the bad one(s) the same way as the Broadcaster.
        let primed: typeof first | null = first;
        out.push(
          ...(await isolate(
            c,
            async (items) => {
              const r = primed && items === c ? primed : await postArc(items);
              primed = null;
              if (!r) return null;
              if ('rows' in r) {
                const res = byTxid(items, r.rows);
                const bad = res.find((x) => x.outcome !== 'accepted');
                return bad ? { ok: false as const, status: 400, txid: bad.txid, reason: bad.reason ?? 'rejected' } : { ok: true as const };
              }
              return r;
            },
            single,
          )),
        );
      }
      return out;
    },
    async status(txid) {
      const r = await send(`${url}/v1/tx/${txid}`, { method: 'GET', headers: { 'X-CallbackToken': token } }, o, 2);
      if (!r) return null;
      if (r.status === 404) return { txid, txStatus: 'NOT_FOUND' };
      return r.j && typeof r.j === 'object' ? ({ txid, ...(r.j as object) } as TxStatus) : null;
    },
    async policy() {
      const r = await send(`${url}/v1/policy`, { method: 'GET' }, o, 3);
      if (!r || r.status !== 200) throw new Error(`GET ${url}/v1/policy failed`);
      return parsePolicy(r.j);
    },
    async health() {
      const r = await send(`${url}/v1/health`, { method: 'GET' }, o, 2);
      return { ok: !!r && r.status === 200, raw: r?.j ?? null };
    },
  };
}

export const makeBroadcaster = (kind: Kind, url: string | undefined, o: Opts = {}): Broadcaster =>
  kind === 'arc' ? arcBroadcaster(url || ARC_URL, o) : bsvBroadcaster(url || BSV_URL, o);

/**
 * BSV Broadcaster status stream: GET /events?callbackToken= (SSE). Calls `on` for every {txid, txStatus} event and
 * reconnects with Last-Event-ID until `signal` aborts.
 */
export async function followEvents(url: string, on: (s: TxStatus) => void, o: Opts & { signal: AbortSignal }): Promise<void> {
  const f = o.fetch ?? fetch;
  const token = o.callbackToken ?? CALLBACK_TOKEN;
  let last = '';
  while (!o.signal.aborted) {
    try {
      const r = await f(`${url}/events?callbackToken=${encodeURIComponent(token)}`, { headers: { Accept: 'text/event-stream', ...(last ? { 'Last-Event-ID': last } : {}) }, signal: o.signal });
      if (!r.ok || !r.body) throw new Error(`events ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k: number;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k);
          buf = buf.slice(k + 2);
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('id:')) last = line.slice(3).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const j = JSON.parse(data) as Partial<TxStatus>;
            if (j.txid && j.txStatus) on(j as TxStatus);
          } catch { /* not JSON */ }
        }
      }
    } catch (e) {
      if (o.signal.aborted) return;
      o.log?.(`events: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(1000, o.signal);
  }
}
