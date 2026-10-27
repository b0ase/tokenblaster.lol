/**
 * Local mock of ARC and the BSV Broadcaster for the ramp tests and `pnpm ramp --dry-run` (nothing leaves 127.0.0.1).
 *
 *  ARC:        POST /v1/txs (JSON [{rawTx}]) · GET /v1/tx/:txid · GET /v1/policy · GET /v1/health
 *  Broadcaster: POST /txs (octet-stream EF batch) · POST /tx · GET /tx/:txid · GET /policy · GET /health · GET /events (SSE)
 *
 * Simulates: 202 / 400 / 503 (first `fail503` POSTs, or `busy()`), per-tx rejects, double spends, a child sent
 * before its parent is SEEN (counted as a parents-first violation, left in the orphan mempool), orphan →
 * REJECTED "missing inputs", and RECEIVED → SEEN_ON_NETWORK → MINED status progress.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fromHex, parseMany, parseTx, type ParsedTx } from './tx';

export type MockOpts = {
  seenAfterMs?: number;
  minedAfterMs?: number;
  /** The first N POSTs answer 503. */
  fail503?: number;
  /** Extra 503 control (e.g. under load). */
  busy?: () => boolean;
  /** txids refused with 400. */
  reject?: Set<string> | ((txid: string) => boolean);
  /** /txs 400 names the bad txid (true) or not (false: forces bisection). */
  nameBadTxid?: boolean;
  /** ARC: refuse the whole request (400) when it holds a bad tx, instead of a per-tx row. */
  arcWhole400?: boolean;
  /** txids that sit in the orphan mempool, then die REJECTED "missing inputs" after orphanDeadMs. */
  orphan?: (txid: string) => boolean;
  orphanDeadMs?: number;
  satsPerKb?: number;
  latencyMs?: number;
};

type Known = { tx: ParsedTx; at: number; status: string; extraInfo?: string; orphan: boolean; token?: string };

export class Mock {
  server!: Server;
  url = '';
  readonly txs = new Map<string, Known>();
  readonly spentBy = new Map<string, string>();
  readonly bodies: { path: string; sha: string; n: number }[] = [];
  readonly tokens = new Set<string>();
  posts = 0;
  violations: string[] = []; // parents-first
  doubleSpends: string[] = [];

  constructor(public o: MockOpts = {}) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res).catch((e) => { res.statusCode = 500; res.end(String(e)); }));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  stop() { return new Promise<void>((r) => { this.server.closeAllConnections?.(); this.server.close(() => r()); }); }

  /** Mark a tx as already mined (funding coins the mock should treat as confirmed parents). */
  mined(txid: string) { this.txs.set(txid, { tx: { txid, inputs: [], outputs: 0, bytes: 0 }, at: 0, status: 'MINED', orphan: false }); }

  private isBad(txid: string) { const r = this.o.reject; return !!r && (typeof r === 'function' ? r(txid) : r.has(txid)); }

  /** Current status of a known tx (time-driven). */
  statusOf(txid: string): { txStatus: string; extraInfo?: string } | null {
    const k = this.txs.get(txid);
    if (!k) return null;
    const age = Date.now() - k.at;
    if (k.status === 'REJECTED' || k.status === 'DOUBLE_SPEND_ATTEMPTED' || k.status === 'MINED') return { txStatus: k.status, extraInfo: k.extraInfo };
    if (k.orphan) {
      if (age >= (this.o.orphanDeadMs ?? 100)) { k.status = 'REJECTED'; k.extraInfo = 'missing inputs'; }
      else k.status = 'SEEN_IN_ORPHAN_MEMPOOL';
    } else if (age >= (this.o.minedAfterMs ?? Infinity)) k.status = 'MINED';
    else if (age >= (this.o.seenAfterMs ?? 20)) k.status = 'SEEN_ON_NETWORK';
    return { txStatus: k.status, extraInfo: k.extraInfo };
  }

  private settled(txid: string) { const s = this.statusOf(txid)?.txStatus; return s === 'SEEN_ON_NETWORK' || s === 'MINED'; }

  /** Validate and accept one tx. Returns null when OK, else the reject reason. */
  private accept(tx: ParsedTx, token?: string): { status: string; reason?: string } {
    if (this.txs.has(tx.txid)) return { status: this.statusOf(tx.txid)!.txStatus };
    if (this.isBad(tx.txid)) return { status: 'REJECTED', reason: 'bad tx (mock)' };
    for (const i of tx.inputs) {
      const k = `${i.txid}:${i.vout}`;
      const by = this.spentBy.get(k);
      if (by && by !== tx.txid) { this.doubleSpends.push(tx.txid); return { status: 'DOUBLE_SPEND_ATTEMPTED', reason: `double spend of ${k}` }; }
    }
    let orphan = !!this.o.orphan?.(tx.txid);
    for (const i of tx.inputs) {
      if (this.txs.has(i.txid) && !this.settled(i.txid)) { this.violations.push(`${tx.txid} before parent ${i.txid}`); orphan = true; }
    }
    for (const i of tx.inputs) this.spentBy.set(`${i.txid}:${i.vout}`, tx.txid);
    this.txs.set(tx.txid, { tx, at: Date.now(), status: 'RECEIVED', orphan, token });
    if (token) this.tokens.add(token);
    return { status: 'RECEIVED' };
  }

  private async body(req: IncomingMessage) {
    const parts: Buffer[] = [];
    for await (const c of req) parts.push(c as Buffer);
    return Buffer.concat(parts);
  }
  private json(res: ServerResponse, status: number, j: unknown) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url ?? '/', 'http://x');
    const p = u.pathname;
    const token = (req.headers['x-callbacktoken'] as string | undefined) ?? undefined;
    if (this.o.latencyMs) await new Promise((r) => setTimeout(r, this.o.latencyMs));
    if (req.method === 'GET') {
      if (p === '/policy' || p === '/v1/policy') return this.json(res, 200, { policy: { miningFee: { satoshis: this.o.satsPerKb ?? 100, bytes: 1000 }, maxtxsizepolicy: 10_485_760 } });
      if (p === '/health' || p === '/v1/health') return this.json(res, 200, { healthy: true, status: 'ok' });
      const m = /^\/(?:v1\/)?tx\/([0-9a-f]{64})$/.exec(p);
      if (m) { const s = this.statusOf(m[1]); return s ? this.json(res, 200, { txid: m[1], ...s }) : this.json(res, 404, { title: 'not found' }); }
      if (p === '/events') return this.events(req, res);
      return this.json(res, 404, {});
    }
    const b = await this.body(req);
    this.posts++;
    this.bodies.push({ path: p, sha: createHash('sha256').update(b).digest('hex'), n: b.length });
    if (this.posts <= (this.o.fail503 ?? 0) || this.o.busy?.()) { res.setHeader('Retry-After', '0'); return this.json(res, 503, { title: 'busy' }); }
    if (p === '/v1/txs') {
      const rows = (JSON.parse(b.toString('utf8')) as { rawTx: string }[]).map((r) => parseTx(fromHex(r.rawTx)).tx);
      if (this.o.arcWhole400) {
        const bad = rows.find((t) => this.isBad(t.txid));
        if (bad) return this.json(res, 400, { title: 'bad tx', ...(this.o.nameBadTxid ? { txid: bad.txid } : {}) });
      }
      return this.json(res, 200, rows.map((t) => { const r = this.accept(t, token); return { txid: t.txid, txStatus: r.status, status: r.reason ? 461 : 200, extraInfo: r.reason ?? '' }; }));
    }
    if (p === '/txs' || p === '/tx') {
      let txs: ParsedTx[];
      try { txs = parseMany(new Uint8Array(b)); } catch { return this.json(res, 400, { reason: 'unparseable' }); }
      if (p === '/tx' && txs.length !== 1) return this.json(res, 400, { reason: 'one tx' });
      // A /txs batch is all or nothing: validate every tx first.
      const bad = txs.find((t) => this.isBad(t.txid) || t.inputs.some((i) => { const by = this.spentBy.get(`${i.txid}:${i.vout}`); return by && by !== t.txid; }));
      if (bad) {
        if (!this.isBad(bad.txid)) this.doubleSpends.push(bad.txid);
        return this.json(res, 400, { reason: this.isBad(bad.txid) ? 'bad tx (mock)' : 'double spend', ...(this.o.nameBadTxid || p === '/tx' ? { txid: bad.txid } : {}) });
      }
      for (const t of txs) this.accept(t, token);
      return this.json(res, 202, p === '/tx' ? { txid: txs[0].txid, txStatus: 'RECEIVED' } : { submitted: txs.length, duplicates: 0, total: txs.length });
    }
    return this.json(res, 404, {});
  }

  private events(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const last = new Map<string, string>();
    let id = Number(req.headers['last-event-id'] ?? 0) || 0;
    const t = setInterval(() => {
      for (const [txid] of this.txs) {
        const s = this.statusOf(txid);
        if (!s || last.get(txid) === s.txStatus) continue;
        last.set(txid, s.txStatus);
        res.write(`id: ${++id}\ndata: ${JSON.stringify({ txid, ...s })}\n\n`);
      }
    }, 25);
    req.on('close', () => clearInterval(t));
  }
}
