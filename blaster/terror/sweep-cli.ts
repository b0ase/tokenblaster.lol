/**
 * TERRORNODE sweep: bring stranded lanes (~40-sat P2PKH outputs of stopped runs' fan-outs) back into one coin.
 *
 *   pnpm terror:sweep                                   DRY RUN (default): find lanes, check spends, plan txs. Sends nothing, no key.
 *   pnpm terror:sweep --live --max-fee 200000 --keychain     sign + broadcast to Arcade (owner's go only)
 *
 * Flags: --address 1Nbr… (default the stress wallet) · --sats-per-kb 100 · --max-inputs 5000 (per tx, ~740 KB)
 *        --max-coin 10000 (only outputs below this are lanes; bigger ones may be a running run's funding)
 *        --include live-<ts> (opt an older unfinished run in; the newest unfinished one is never swept)
 *        --woc (also ask WhatsOnChain per lane; slow, ~3/s) · --txs N (live: send only the first N txs)
 *        --arcade-url https://arcade.gorillapool.io · --key-env TERRORNODE_STRESS_WIF · --keychain · --stop-file
 *
 * Every input is journalled to ~/.tokenblaster/terror/spent-sweep.jsonl BEFORE its tx is sent, so no later sweep or
 * stress run (both read every spent-*.jsonl) can spend it again. A rejected tx releases its inputs ("R").
 * Kill switch: `touch ~/.tokenblaster/STOP` (checked every 0.5 s) or Ctrl-C. At most 2 txs in flight.
 * The key is read from the env / Keychain into this process only; it is never printed, logged or written.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PrivateKey, Utils } from '@bsv/sdk';
import { sha256 } from '@noble/hashes/sha2';
import { bsvBroadcaster, BSV_URL } from '../ramp/broadcaster';
import { GAME, TAG, signer, toHex, txidHex } from '../ramp/tx';
import { opReturn } from '../../src/lib/fastBlast';
import { gorillaSpends, wocSpends } from './coins';
import { inputCost, journalSpentFor, lanesOf, listRuns, op, pickRuns, planSweep, pool, type Coin } from './sweep';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : d; };
const args = (k: string) => argv.flatMap((a, i) => (a === `--${k}` && argv[i + 1] ? [argv[i + 1]] : []));
const flag = (k: string) => argv.includes(`--${k}`);
const live = flag('live');
const DIR = join(homedir(), '.tokenblaster');
const TDIR = join(DIR, 'terror');
const CACHE = join(TDIR, 'sweep-cache');
const JOURNAL = join(TDIR, 'spent-sweep.jsonl');
const STOP = arg('stop-file', join(DIR, 'STOP'))!;
const KEY_ENV = arg('key-env', 'TERRORNODE_STRESS_WIF')!;
const ADDRESS = arg('address', '1NbrP33mMxRmmFaNvo8ds7kMruqwZT1DVH')!;
const RUN = 'terrornode-sweep';
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const n = (x: number) => Math.round(x).toLocaleString();
const bsv = (s: number) => (s / 1e8).toFixed(8);

let halted = false;
const ac = new AbortController();
const halt = (why: string) => { if (halted) return; halted = true; say(`HALT: ${why}`); ac.abort(); };
process.on('SIGINT', () => { if (halted) process.exit(130); halt('Ctrl-C'); });
setInterval(() => { if (existsSync(STOP)) halt(`${STOP} exists`); }, 500).unref();

function privKey(): Uint8Array {
  if (!process.env[KEY_ENV] && flag('keychain')) {
    // read straight into this process's env: never printed, logged or written anywhere
    try { process.env[KEY_ENV] = execFileSync('security', ['find-generic-password', '-s', KEY_ENV, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not there */ }
  }
  const wif = process.env[KEY_ENV];
  if (!wif) throw new Error(`No key: set ${KEY_ENV} or pass --keychain (Keychain service ${KEY_ENV}). It is never printed.`);
  return Uint8Array.from(PrivateKey.fromWif(wif.trim()).toArray('be', 32));
}

const dsha = (b: Uint8Array) => sha256(sha256(b));

/** Raw bytes of `txid` (GorillaPool JungleBus, then WhatsOnChain), checked against the txid and cached on disk. */
async function rawTx(txid: string): Promise<Uint8Array | null> {
  const file = join(CACHE, `${txid}.bin`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const tries: [string, (r: Response) => Promise<Uint8Array>][] = [
    [`https://junglebus.gorillapool.io/v1/transaction/get/${txid}/bin`, async (r) => new Uint8Array(await r.arrayBuffer())],
    [`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`, async (r) => new Uint8Array(Buffer.from((await r.text()).trim(), 'hex'))],
  ];
  for (const [url, read] of tries) {
    for (let k = 0; k < 3; k++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (r.status === 404) break;
        if (!r.ok) { await new Promise((x) => setTimeout(x, 1000 * (k + 1))); continue; }
        const b = await read(r);
        if (txidHex(dsha(b)) !== txid) break; // wrong bytes: try the next source
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(file, b);
        return b;
      } catch { await new Promise((x) => setTimeout(x, 1000 * (k + 1))); }
    }
  }
  return null;
}

async function main() {
  const satsPerKb = Number(arg('sats-per-kb', '100'));
  const maxInputs = Number(arg('max-inputs', '5000'));
  const maxCoin = Number(arg('max-coin', '10000'));
  const maxFee = Number(arg('max-fee', '0'));
  if (live && !(maxFee > 0)) throw new Error('--live needs --max-fee N (total sats the sweep may spend on fees)');
  if (existsSync(STOP)) throw new Error(`${STOP} exists (kill switch). Remove it to run.`);

  const lockHex = '76a914' + toHex(Uint8Array.from(Utils.fromBase58Check(ADDRESS).data as number[])) + '88ac';
  const priv = live ? privKey() : randomBytes(32); // dry run: a throwaway key, only to measure tx sizes
  const sign = signer(priv);
  if (live && toHex(sign.lock) !== lockHex) throw new Error(`the key in ${KEY_ENV} is not for ${ADDRESS}`);

  // 1. runs + fan-outs
  const pick = pickRuns(listRuns(TDIR), args('include'));
  for (const s of pick.skipped) say(`skip ${s.run.name} (${n(s.run.fanouts.length)} fan-outs): ${s.why}`);
  const fanTxids = [...new Set(pick.swept.flatMap((r) => r.fanouts.map((f) => f.txid)))];
  say(`sweeping ${pick.swept.length} finished run(s): ${pick.swept.map((r) => r.name).join(', ')} · ${n(fanTxids.length)} fan-out txs`);

  // 2. fetch each fan-out, take its lanes
  let lanes: Coin[] = [];
  const missing: string[] = [];
  let bigSkipped = 0, bigSats = 0, done = 0;
  await pool(fanTxids, 6, async (txid) => {
    const raw = await rawTx(txid);
    if (!raw) { missing.push(txid); return; }
    lanes.push(...lanesOf(txid, raw, lockHex, maxCoin));
    for (const c of lanesOf(txid, raw, lockHex, Number.MAX_SAFE_INTEGER)) if (c.value >= maxCoin) { bigSkipped++; bigSats += c.value; }
    if (++done % 50 === 0) say(`  fetched ${done}/${fanTxids.length}`);
  }, () => halted);
  if (halted) return;
  say(`${n(lanes.length)} lane outputs (< ${n(maxCoin)} sats) holding ${n(lanes.reduce((s, c) => s + c.value, 0))} sats; ${missing.length} fan-out(s) not found on chain; ${bigSkipped} bigger output(s) left alone (${n(bigSats)} sats)`);
  for (const m of missing) say(`  not found: ${m}`);

  // 3. drop spent ones: journals (incl. earlier sweeps), GorillaPool spends index, optionally WoC
  const want = new Set(fanTxids);
  const jSpent = await journalSpentFor(TDIR, want);
  const before = lanes.length;
  lanes = lanes.filter((c) => !jSpent.has(op(c)));
  say(`journals: ${n(before - lanes.length)} spent · ${n(lanes.length)} left`);
  const gpSpent = new Set<string>();
  const chunks: Coin[][] = [];
  for (let i = 0; i < lanes.length; i += 1000) chunks.push(lanes.slice(i, i + 1000));
  let gpFail = 0, gpDone = 0;
  await pool(chunks, 4, async (part) => {
    try { for (const [k, v] of await gorillaSpends(part)) if (v) gpSpent.add(k); }
    catch (e) { gpFail++; for (const c of part) gpSpent.add(op(c)); say(`  GorillaPool spends failed for ${part.length} lanes (treated as spent): ${(e as Error).message}`); }
    if (++gpDone % 200 === 0) say(`  GorillaPool spends ${gpDone}/${chunks.length} batches`);
  }, () => halted);
  if (halted) return;
  const b2 = lanes.length;
  lanes = lanes.filter((c) => !gpSpent.has(op(c)));
  say(`GorillaPool: ${n(b2 - lanes.length)} spent${gpFail ? ` (incl. ${gpFail} failed batch(es) held back)` : ''} · ${n(lanes.length)} left`);
  if (flag('woc')) {
    say(`WhatsOnChain spent check of ${n(lanes.length)} lanes (~${Math.ceil(lanes.length / 3 / 60)} min)…`);
    const w = await wocSpends(lanes, { log: say });
    lanes = lanes.filter((c) => !w.get(op(c)));
    say(`WhatsOnChain: ${n(lanes.length)} left`);
  }

  // 4. plan
  const tag = opReturn([TAG, 'sats', 'fan', GAME, RUN]);
  const plan = planSweep(lanes, satsPerKb, { maxInputs, bytesFor: (k) => sign.fanBytes(k, 1, tag.length) });
  const unSats = plan.uneconomic.reduce((s, c) => s + c.value, 0);
  say(`── plan @ ${satsPerKb} sat/kB (input ≈ ${inputCost(satsPerKb).toFixed(1)} sats), ≤ ${n(maxInputs)} inputs/tx ──`);
  say(`lanes swept ${n(plan.lanes)} · in ${n(plan.inValue)} sats · fees ${n(plan.fees)} sats · recovered ${n(plan.out)} sats (${bsv(plan.out)} BSV) · ${plan.txs.length} tx(s), largest ${n(Math.max(0, ...plan.txs.map((t) => t.bytes)))} bytes`);
  say(`uneconomic (input cost ≥ value): ${n(plan.uneconomic.length)} lanes, ${n(unSats)} sats left where they are`);
  if (!plan.txs.length) return;

  // size check: sign the first tx (throwaway key in a dry run) and compare with the plan
  const first = sign.fanOut(plan.txs[0].inputs, [], RUN, satsPerKb);
  if (first.fee !== plan.txs[0].fee) throw new Error(`fee mismatch: plan ${plan.txs[0].fee}, signer ${first.fee}`);
  say(`tx 1 signed for a size check: ${n(first.raw.length)} bytes raw, ${n(first.ef.length)} EF, fee ${first.fee}`);
  if (!live) { say('DRY RUN: nothing sent. Add --live --max-fee N --keychain to broadcast (owner\'s go only).'); return; }

  // 5. live
  const txs = plan.txs.slice(0, Number(arg('txs', String(plan.txs.length))));
  const fees = txs.reduce((s, t) => s + t.fee, 0);
  if (fees > maxFee) throw new Error(`planned fees ${n(fees)} > --max-fee ${n(maxFee)}; raise it or send fewer with --txs`);
  const bc = bsvBroadcaster(arg('arcade-url', BSV_URL)!, { callbackToken: RUN, timeoutMs: 120_000, tries: 1, signal: ac.signal, stopped: () => halted, log: (s) => say(`  ${s}`) });
  let ok = 0, bad = 0, unknown = 0, paid = 0;
  await pool(txs, 2, async (p, i) => {
    if (halted) return;
    const t = sign.fanOut(p.inputs, [], RUN, satsPerKb);
    appendFileSync(JOURNAL, p.inputs.map((c) => `S ${op(c)} ${t.txid}`).join('\n') + '\n'); // before the bytes leave
    let r;
    for (let k = 0; k < 3 && !halted; k++) {
      r = (await bc.submit([{ txid: t.txid, bytes: t.ef }]))[0];
      if (r.outcome !== 'retry') break;
      await new Promise((x) => setTimeout(x, 2000)); // same bytes again
    }
    if (r?.outcome === 'accepted') { ok++; paid += t.fee; say(`tx ${i + 1}/${txs.length} ${t.txid} accepted (${r.txStatus}): ${p.inputs.length} lanes → ${n(p.out)} sats`); }
    else if (r?.outcome === 'rejected') { bad++; appendFileSync(JOURNAL, p.inputs.map((c) => `R ${op(c)}`).join('\n') + '\n'); say(`tx ${i + 1} ${t.txid} REJECTED: ${r.reason ?? ''} (inputs released)`); }
    else { unknown++; say(`tx ${i + 1} ${t.txid}: no answer; inputs stay journalled as spent (check it on chain)`); }
  }, () => halted);
  say(`LIVE done: accepted ${ok} · rejected ${bad} · unknown ${unknown} · fees ${n(paid)} sats · journal ${JOURNAL}`);
}

main().then(() => process.exit(0), (e) => { console.error(`error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
