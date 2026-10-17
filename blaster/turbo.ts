/**
 * Turbo blast: sign everything first (worker threads, native crypto, ~2k tx/s per core), then send it
 * layer by layer in batches to ARC's /v1/txs, so a whole blast lands inside one block.
 *
 * Shape: one fan-out tx (via @bsv/sdk) splits the wallet's coins into `chains` coins; each chain is
 * `depth` blasts deep. Layer d = the d-th blast of every chain; a layer goes only after the one before.
 */
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction } from '@bsv/sdk';
import { blue, dim, red } from './banner';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const ARC_URL = process.env.BLASTER_ARC_URL || 'https://arc.gorillapool.io';
const BATCH = 1000;
const n = (x: number) => x.toLocaleString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const BLAST_BYTES = 235;
export const blastFee = (feeRate: number) => Math.max(1, Math.ceil((BLAST_BYTES * feeRate) / 1000));

const jwkOf = (k: PrivateKey) => {
  const pub = k.toPublicKey().encode(false) as number[];
  const b = (a: number[]) => Buffer.from(a).toString('base64url');
  return { d: b(k.toArray('be', 32)), x: b(pub.slice(1, 33)), y: b(pub.slice(33)) };
};

type Head = { c: number; txid: string; vout: number; value: number; depth: number };

/** Sign every chain on all cores. Returns raws[chain][i]. */
export async function signAll(key: PrivateKey, heads: Head[], fee: number, token: string, onProgress?: (k: number) => void): Promise<Buffer[][]> {
  const W = Math.max(1, Math.min(cpus().length, heads.length));
  const jwk = jwkOf(key);
  const slices = Array.from({ length: W }, (_, w) => heads.filter((_, i) => i % W === w));
  const done = new Array(W).fill(0);
  const out: Buffer[][] = new Array(heads.length);
  await Promise.all(
    slices.map(
      (mine, w) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL('./signer.mjs', import.meta.url), { workerData: { jwk, heads: mine, fee, token } });
          worker.on('message', (m: { progress?: number; done?: boolean; buf?: Uint8Array; lens?: number[] }) => {
            if (m.progress !== undefined) { done[w] = m.progress; onProgress?.(done.reduce((a, b) => a + b, 0)); }
            if (m.done) {
              const buf = Buffer.from(m.buf!.buffer, m.buf!.byteOffset, m.buf!.byteLength);
              let off = 0, h = 0, cur: Buffer[] = [];
              for (const len of m.lens!) {
                if (len === -1) { out[mine[h].c] = cur; cur = []; h++; continue; }
                cur.push(buf.subarray(off, off + len)); off += len;
              }
              resolve();
            }
          });
          worker.on('error', reject);
        }),
    ),
  );
  return out;
}

/** POST raw txs to ARC's batch endpoint. Returns the indexes that were not accepted. */
async function postBatch(raws: Buffer[]): Promise<{ bad: number[]; why?: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${ARC_URL}/v1/txs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(raws.map((b) => ({ rawTx: b.toString('hex') }))),
      });
      if (!r.ok) throw new Error(`ARC ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const rows = (await r.json()) as { status?: number; txStatus?: string; title?: string; extraInfo?: string }[];
      const bad: number[] = [];
      let why: string | undefined;
      rows.forEach((x, i) => {
        const ok = (x.status === 200 || x.status === undefined) && !/REJECT|ORPHAN|DOUBLE/i.test(x.txStatus ?? '');
        if (!ok) { bad.push(i); why ??= `${x.status} ${x.txStatus ?? ''} ${x.title ?? ''} ${x.extraInfo ?? ''}`.trim(); }
      });
      return { bad, why };
    } catch (e) {
      if (attempt >= 3) return { bad: raws.map((_, i) => i), why: (e as Error).message };
      await sleep(500 * 2 ** attempt);
    }
  }
}

export type TurboResult = { signed: number; sent: number; signSecs: number; sendSecs: number; fees: number; deadChains: number; why?: string };

export async function turbo(o: { key: PrivateKey; count: number; chains: number; feeRate: number; token: string; broadcast: boolean; color?: (s: string) => string }): Promise<TurboResult> {
  const { key, feeRate, token, broadcast } = o;
  const paint = o.color ?? red;
  const address = key.toAddress();
  const fee = blastFee(feeRate);
  const chains = Math.max(1, Math.min(4000, o.chains, o.count));
  const quota = (c: number) => Math.floor(o.count / chains) + (c < o.count % chains ? 1 : 0);

  // fan-out with @bsv/sdk (sent as EF so ARC needs nothing else)
  const coins = ((await fetch(`${WOC}/address/${address}/unspent`, { cache: 'no-store' }).then((r) => r.json())) as { tx_hash: string; tx_pos: number; value: number }[])
    .filter((c) => c.value > 1).sort((a, b) => b.value - a.value).slice(0, 200);
  if (!coins.length) throw new Error(`No coins at ${address}. Pay it some BSV first.`);
  const fan = new Transaction();
  for (const c of coins) {
    const src = Transaction.fromHex(await fetch(`${WOC}/tx/${c.tx_hash}/hex`).then((r) => r.text()));
    fan.addInput({ sourceTransaction: src, sourceOutputIndex: c.tx_pos, unlockingScriptTemplate: new P2PKH().unlock(key) });
  }
  const per = (c: number) => quota(c) * fee + 2;
  const have = coins.reduce((s, c) => s + c.value, 0);
  const need = Array.from({ length: chains }, (_, c) => per(c)).reduce((a, b) => a + b, 0) + Math.ceil(((coins.length * 150 + chains * 34 + 100) * feeRate) / 1000) + 10;
  if (need > have) throw new Error(`Not enough: need about ${n(need)} sats, the address has ${n(have)}.`);
  for (let c = 0; c < chains; c++) fan.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: per(c) });
  fan.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
  await fan.fee(new SatoshisPerKilobyte(feeRate));
  await fan.sign();
  const fanId = fan.id('hex');

  // 1. sign
  console.log(`${paint('▶')} signing  ${n(o.count)} blasts in ${chains} chains on ${Math.min(cpus().length, chains)} cores…`);
  const t0 = Date.now();
  const heads: Head[] = Array.from({ length: chains }, (_, c) => ({ c, txid: fanId, vout: c, value: per(c), depth: quota(c) }));
  const raws = await signAll(key, heads, fee, token, (k) => process.stdout.write(`\r${paint('■')} signed ${n(k)} / ${n(o.count)}   `));
  const signSecs = (Date.now() - t0) / 1000;
  const signed = raws.reduce((s, r) => s + r.length, 0);
  console.log(`\r${paint('▶')} signed   ${n(signed)} in ${signSecs.toFixed(1)}s ${dim(`(${n(Math.round(signed / signSecs))} tx/s)`)}      `);
  if (!broadcast) return { signed, sent: 0, signSecs, sendSecs: 0, fees: signed * fee, deadChains: 0 };

  // 2. send: fan-out, then layer by layer
  const r = await fan.broadcast(new ARC(ARC_URL));
  if (r.status !== 'success' && !/invalid competing transaction identifiers/i.test((r as { description?: string }).description ?? '')) throw new Error(`Fan-out not accepted: ${JSON.stringify(r)}`);
  console.log(`${paint('▶')} fan-out  ${fanId}`);
  const dead = new Set<number>();
  let sent = 0, why: string | undefined;
  const t1 = Date.now();
  const depth = Math.max(...raws.map((r) => r.length));
  const draw = () => {
    const secs = Math.max(0.1, (Date.now() - t1) / 1000), w = 30, d = Math.round((sent / signed) * w);
    process.stdout.write(`\r${paint('█'.repeat(d))}${dim('░'.repeat(w - d))} ${n(sent)} / ${n(signed)}  ${n(Math.round(sent / secs))} tx/s ${dead.size ? red(` ${dead.size} chains stopped`) : ''}  `);
  };
  const tick = setInterval(draw, 250);
  for (let d = 0; d < depth; d++) {
    const layer: { c: number; raw: Buffer }[] = [];
    for (let c = 0; c < raws.length; c++) if (!dead.has(c) && raws[c][d]) layer.push({ c, raw: raws[c][d] });
    if (!layer.length) break;
    const batches: (typeof layer)[] = [];
    for (let i = 0; i < layer.length; i += BATCH) batches.push(layer.slice(i, i + BATCH));
    await Promise.all(
      batches.map(async (b) => {
        const res = await postBatch(b.map((x) => x.raw));
        why ??= res.why;
        for (const i of res.bad) dead.add(b[i].c);
        sent += b.length - res.bad.length;
      }),
    );
  }
  clearInterval(tick);
  draw();
  const sendSecs = (Date.now() - t1) / 1000;
  console.log('');
  return { signed, sent, signSecs, sendSecs, fees: sent * fee, deadChains: dead.size, why };
}

export { blue };
