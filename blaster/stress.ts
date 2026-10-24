/**
 * Stress-test practice harness (31 Oct 2026 BSV mainnet stress test).
 *
 *   pnpm stress --count 100000 --chains 500 --rate 2000            dry run (default): build + sign only
 *   pnpm stress ... --broadcast --max-sats 3000000 --max-txs 100000  really send (owner-approved runs only)
 *
 * Fans a funded coin out into N chains, then streams 1-in-2-out blasts (tagged
 * OP_RETURN "tokenblaster.lol" <token> <c:n> <game>, which bsv.lol counts as TokenBlaster) at a target
 * rate. Hard caps: --max-sats, --max-txs, reject ratio. Kill switch: Ctrl-C, or create
 * ~/.tokenblaster/STOP (any machine in a fleet can be stopped by touching that file over ssh).
 * Metrics: one JSON line per second to --log (default ~/.tokenblaster/stress-<ts>.jsonl).
 *
 * Dry run uses a throwaway in-memory key and a fake fan-out, so it needs no funds and no secrets.
 * Broadcast needs the key in BLASTER_WIF or macOS Keychain (service BLASTER_WIF); it is never printed.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { cpus, homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction } from '@bsv/sdk';
import { Guard, RateLimiter, checkPlan, plan, quota, type Caps } from './stress/plan';
import { broadcasters, fetchTx, onNetwork, postBatch, unspent, wocBroadcast } from './turbo';

const DIR = join(homedir(), '.tokenblaster');
const STOP = join(DIR, 'STOP');
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const num = (k: string, d: number) => Number(arg(k, String(d)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (x: number) => Math.round(x).toLocaleString();

const jwkOf = (k: PrivateKey) => {
  const pub = k.toPublicKey().encode(false) as number[];
  const b = (a: number[]) => Buffer.from(a).toString('base64url');
  return { d: b(k.toArray('be', 32)), x: b(pub.slice(1, 33)), y: b(pub.slice(33)) };
};

function liveKey(): PrivateKey {
  let wif = process.env.BLASTER_WIF;
  if (!wif) { try { wif = execFileSync('security', ['find-generic-password', '-s', 'BLASTER_WIF', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* none */ } }
  if (!wif) throw new Error('No key: set BLASTER_WIF or add Keychain service BLASTER_WIF.');
  return PrivateKey.fromWif(wif);
}

async function fanOut(key: PrivateKey, chains: number, per: (c: number) => number, feeRate: number) {
  const address = key.toAddress();
  // Confirmed, not already spent in the mempool, largest first, and only as many as the fan-out needs:
  // an unconfirmed parent that ARC hasn't seen relayed stalls the fan-out (1M run, 24 Oct).
  const need = Array.from({ length: chains }, (_, c) => per(c)).reduce((a, b) => a + b, 0) + chains * 34 + 10_000;
  const pool = (await unspent(address))
    .filter((c) => c.value >= 100 && !(arg('exclude-tx', '') || '').split(',').filter(Boolean).includes(c.tx_hash) && (flag('allow-unconfirmed') || (c as { status?: string }).status !== 'unconfirmed') && !c.isSpentInMempoolTx)
    .sort((a, b) => b.value - a.value);
  const coins: typeof pool = [];
  let have = 0;
  for (const c of pool) { if (have >= need || coins.length >= 200) break; coins.push(c); have += c.value; }
  if (have < need) throw new Error(`Not enough confirmed coins at ${address}: have ${have}, need ${need}. Wait for a block.`);
  if (!coins.length) throw new Error(`No coins at ${address}.`);
  const fan = new Transaction();
  for (const c of coins) fan.addInput({ sourceTransaction: await fetchTx(c.tx_hash), sourceOutputIndex: c.tx_pos, unlockingScriptTemplate: new P2PKH().unlock(key) });
  for (let c = 0; c < chains; c++) fan.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: per(c) });
  fan.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
  await fan.fee(new SatoshisPerKilobyte(feeRate));
  await fan.sign();
  return fan;
}

async function main() {
  const broadcast = flag('broadcast');
  const feeRate = num('fee-rate', 100);
  const rate = num('rate', 0);
  const seg = num('seg', 25);                 // links per chain per round
  const batch = num('batch', 250);            // txs per ARC POST
  const conc = num('concurrency', 16);        // POSTs in flight
  const workers = Math.max(1, Math.min(num('workers', cpus().length), cpus().length));
  const token = arg('token', 'stress')!;
  const game = arg('game', 'stress')!;
  const p = plan({ count: num('count', 10_000), chains: num('chains', 100), feeRate, rate, bsvUsd: num('bsv-usd', 17.4), maxDepth: num('max-depth', 1000) });
  const caps: Caps = {
    maxTxs: num('max-txs', broadcast ? 0 : Infinity),
    maxSats: num('max-sats', broadcast ? 0 : Infinity),
    maxRejectRatio: num('max-reject', 0.2),
    minWindow: 500,
  };
  const log = arg('log', join(DIR, `stress-${Date.now()}.jsonl`))!;
  mkdirSync(DIR, { recursive: true });
  const emit = (o: object) => appendFileSync(log, JSON.stringify({ t: Date.now(), host: hostname(), ...o }) + '\n');

  console.log(`plan   ${n(p.count)} tx · ${n(p.chains)} chains × ≤${p.depth} · ${feeRate} sat/kB (${p.feePerTx} sat/tx) · ≤${n(p.totalSats)} sats ≈ $${p.usd.toFixed(2)}${rate ? ` · ${rate} tx/s ≈ ${(p.secsAtRate / 60).toFixed(1)} min` : ''}`);
  console.log(`mode   ${broadcast ? 'BROADCAST via ' + broadcasters().map((a) => a.name).join('+') : 'dry run (build + sign, nothing sent)'} · ${workers} workers · log ${log}`);
  if (broadcast) {
    if (!(caps.maxTxs > 0 && caps.maxSats > 0)) throw new Error('--broadcast needs --max-txs and --max-sats (the owner-approved budget).');
    const bad = checkPlan(p, caps);
    if (bad) throw new Error(`Refusing: ${bad}.`);
  }
  if (existsSync(STOP)) throw new Error(`${STOP} exists (kill switch). Remove it to run.`);

  const key = broadcast ? liveKey() : PrivateKey.fromRandom();
  const per = (c: number) => quota(p.count, p.chains, c) * p.feePerTx + 2;
  let fanId = randomBytes(32).toString('hex');
  if (broadcast) {
    const fan = await fanOut(key, p.chains, per, feeRate);
    fanId = fan.id('hex');
    const woc = await wocBroadcast(fan.toHex());
    const arc = await postBatch([Buffer.from(fan.toHexEF(), 'hex')]);
    if (!woc.ok && arc.bad.length) throw new Error(`fan-out not accepted: ${woc.why}; ${arc.why}`);
    emit({ ev: 'fanout', txid: fanId, fee: fan.getFee() });
    if (!(await onNetwork(fanId, num('fan-wait', 300) * 1000))) throw new Error(`fan-out ${fanId} not seen on network in ${num('fan-wait', 300)} s; nothing else sent.`);
  }

  let stop: string | null = null;
  process.on('SIGINT', () => { stop = 'Ctrl-C'; });
  const guard = new Guard(caps, p.feePerTx);
  const limiter = new RateLimiter(rate, Math.max(batch, rate));
  const errs: Record<string, number> = {};
  let signed = 0, inflight = 0;
  const t0 = Date.now();
  let lastSigned = 0, lastSent = 0;
  const tick = setInterval(() => {
    if (existsSync(STOP)) stop ??= 'STOP file';
    const secs = (Date.now() - t0) / 1000;
    const m = { ev: 'tick', secs, signed, sent: guard.sent, accepted: guard.accepted, rejected: guard.rejected, sats: guard.sats, signRate: signed - lastSigned, sendRate: guard.sent - lastSent, inflight, errs };
    lastSigned = signed; lastSent = guard.sent;
    emit(m);
    process.stdout.write(`\r\x1b[2K${n(secs)}s  signed ${n(signed)} (${n(m.signRate)}/s)  sent ${n(guard.accepted)}/${n(guard.sent)} (${n(m.sendRate)}/s)  ${n(guard.sats)} sats${stop ? '  STOPPING: ' + stop : ''}`);
  }, 1000);

  // workers: heads split round-robin
  const heads = Array.from({ length: p.chains }, (_, c) => ({ c, txid: fanId, vout: c, value: per(c), depth: quota(p.count, p.chains, c) }));
  const jwk = jwkOf(key);
  const W = Math.min(workers, heads.length);
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./stress/worker.mjs', import.meta.url), { workerData: { stress: true, jwk, heads: heads.filter((_, i) => i % W === w), fee: p.feePerTx, token, seg, game } });
    const done = () => { worker.terminate(); resolve(); };
    worker.on('error', reject);
    worker.on('message', async (m: { end?: boolean; ab?: ArrayBuffer; meta?: number[] }) => {
      if (m.end || stop) return done();
      const buf = Buffer.from(m.ab!);
      const txs: Buffer[] = [];
      for (let i = 0, off = 0; i < m.meta!.length; i += 2) { txs.push(buf.subarray(off, off + m.meta![i + 1])); off += m.meta![i + 1]; }
      signed += txs.length;
      if (broadcast) {
        // a dead chain's later links would be rejected anyway; the guard's reject ratio catches it
        const posts: Promise<void>[] = [];
        for (let i = 0; i < txs.length && !stop; i += batch) {
          const b = txs.slice(i, i + batch);
          stop ??= guard.allows(b.length);
          if (stop) break;
          await limiter.take(b.length);
          while (inflight >= conc) await sleep(5);
          inflight++;
          posts.push(postBatch(b).then((r) => {
            if (r.why) { const k = r.why.slice(0, 60); errs[k] = (errs[k] ?? 0) + 1; }
            stop ??= guard.record(b.length - r.bad.length, r.bad.length);
          }).finally(() => { inflight--; }));
        }
        await Promise.all(posts);   // segment fully sent before the next is signed (parents first)
      } else if (rate) {
        await limiter.take(txs.length);
      }
      if (stop) return done();
      worker.postMessage({ go: true });
    });
  })));
  clearInterval(tick);
  const secs = (Date.now() - t0) / 1000;
  const summary = { ev: 'end', secs, signed, signRate: signed / secs, sent: guard.sent, accepted: guard.accepted, rejected: guard.rejected, sats: guard.sats, stop, errs, plan: p, broadcast };
  emit(summary);
  console.log(`\n\n${broadcast ? 'sent' : 'dry run'}: signed ${n(signed)} in ${secs.toFixed(1)}s = ${n(signed / secs)} tx/s` + (broadcast ? ` · accepted ${n(guard.accepted)} rejected ${n(guard.rejected)} · ${n(guard.sats)} sats` : '') + (stop ? ` · stopped: ${stop}` : ''));
  process.exit(0);
}

main().catch((e) => { console.error(`\n✖ ${(e as Error).message}`); process.exit(1); });
