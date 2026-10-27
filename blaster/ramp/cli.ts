/**
 * TERRORNODE ramp test with GorillaPool (Thu 29 Oct 2026, 14:00 UTC).
 *
 *   pnpm ramp estimate                                  sats for the full ramp at the live /policy fee (read-only GETs)
 *   pnpm ramp                                           DRY RUN (default): whole pipeline against a local mock, no key
 *   pnpm ramp prep --live --max-sats N                  split the funding coins into fan-out coins (wait 1 block after)
 *   pnpm ramp --live --max-sats N                       ARC run → 10 min pause → BSV Broadcaster run
 *
 * Flags: --only arc|bsv · --bsv-url URL (default https://arcade.gorillapool.io) · --arc-url URL · --stages 100,250,…
 *        --stage-secs 300 · --pause 600 · --fan-width 2000 · --out DIR · --check-endpoints (dry run: also GET the
 *        real /policy + /health) · --key-env NAME (default TERRORNODE_STRESS_WIF)
 *
 * Key: ONLY from the env var named by --key-env (TERRORNODE_STRESS_WIF), supplied by the operator at runtime, e.g.
 *   TERRORNODE_STRESS_WIF="$(security find-generic-password -s TERRORNODE_STRESS_WIF -w)" pnpm ramp --live --max-sats …
 * It is never printed or written anywhere.
 *
 * Halt: Ctrl-C, or `touch ~/.tokenblaster/STOP` (checked every 0.5 s; everything stops within 10 s).
 * State: ~/.tokenblaster/ramp/spent.jsonl (spent-outputs journal: never re-spend, survives a restart) and prep.json.
 * Logs:  ~/.tokenblaster/ramp/<timestamp>/stages.csv + <run>-stage-<n>.json + summary.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrivateKey } from '@bsv/sdk';
import { arcBroadcaster, bsvBroadcaster, classify, ARC_URL, BSV_URL, CALLBACK_TOKEN, type Broadcaster, type Opts } from './broadcaster';
import { Ledger } from './ledger';
import { Mock } from './mock';
import { csvHeader, estimate, prepCoins, runRamp, STAGES, STAGE_SECS, type StageStats } from './runner';
import { signer, txidHex } from './tx';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const live = flag('live');
const DIR = join(homedir(), '.tokenblaster');
const RAMP = join(DIR, 'ramp');
const STOP = arg('stop-file', join(DIR, 'STOP'))!;
const KEY_ENV = arg('key-env', 'TERRORNODE_STRESS_WIF')!;
const fanWidth = Number(arg('fan-width', '2000'));
const stages = (arg('stages') ?? STAGES.join(',')).split(',').map(Number).filter((x) => x > 0);
const stageSecs = Number(arg('stage-secs', live || cmd === 'estimate' ? String(STAGE_SECS) : '20'));
const pauseSecs = Number(arg('pause', live ? '600' : '5'));
const only = arg('only') as 'arc' | 'bsv' | undefined;
const arcUrl = arg('arc-url', ARC_URL)!;
const bsvUrl = arg('bsv-url', BSV_URL)!;
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── halt: STOP file / SIGINT ──
let halted = false;
const ac = new AbortController();
const halt = (why: string) => { if (halted) return; halted = true; say(`HALT: ${why}`); ac.abort(); };
process.on('SIGINT', () => { if (halted) process.exit(130); halt('SIGINT'); });
const stopTimer = setInterval(() => { if (existsSync(STOP)) halt(`${STOP} exists`); }, 500);
stopTimer.unref();

function key(): Uint8Array {
  const wif = process.env[KEY_ENV];
  if (!wif) throw new Error(`No key: set ${KEY_ENV} at runtime (e.g. from the macOS Keychain). It is never printed.`);
  return Uint8Array.from(PrivateKey.fromWif(wif.trim()).toArray('be', 32));
}

function maxSats(): number {
  const m = Number(arg('max-sats'));
  if (!(m > 0)) throw new Error('--live needs --max-sats N (a hard cap on fees spent).');
  return m;
}

const bopts = (): Opts => ({ callbackToken: CALLBACK_TOKEN, stopped: () => halted, signal: ac.signal, log: (s) => say(`  ${s}`) });

async function policyOf(bc: Broadcaster) {
  const h = await bc.health().catch(() => ({ ok: false, raw: null }));
  const p = await bc.policy();
  say(`${bc.kind} ${bc.url}: health ${h.ok ? 'ok' : 'NOT OK'}, fee ${p.satsPerKb} sat/kB`);
  return p.satsPerKb;
}

async function cmdEstimate() {
  const arcFee = await policyOf(arcBroadcaster(arcUrl, bopts()));
  const bsvFee = await policyOf(bsvBroadcaster(bsvUrl, bopts()));
  const s = signer(randomBytes(32));
  for (const [run, fee] of [['arc', arcFee], ['bsv', bsvFee]] as const) {
    const e = estimate({ stages, stageSecs, satsPerKb: fee, fanWidth, sign: s, run: `ramp-29oct-${run}` });
    say(`${run}: ${e.blasts.toLocaleString()} blasts × ${e.blastFee} sats + ${e.fans} fan-outs × ${e.fanFee} = ${e.fees.toLocaleString()} sats fees (+${e.dust.toLocaleString()} 1-sat change) → ${(e.total / 1e8).toFixed(4)} BSV`);
  }
  const a = estimate({ stages, stageSecs, satsPerKb: arcFee, fanWidth, sign: s });
  const b = estimate({ stages, stageSecs, satsPerKb: bsvFee, fanWidth, sign: s });
  say(`both runs, every stage: ${(a.total + b.total).toLocaleString()} sats = ${((a.total + b.total) / 1e8).toFixed(4)} BSV (auto-stop usually ends sooner)`);
}

async function cmdPrep() {
  if (!live) { say('prep is live-only (it broadcasts the split). Dry runs make their own fake coins.'); return; }
  const cap = maxSats();
  const priv = key();
  const s = signer(priv);
  const arc = arcBroadcaster(arcUrl, bopts());
  const fee = await policyOf(arc);
  const e = estimate({ stages, stageSecs, satsPerKb: fee, fanWidth, sign: s });
  const runs = only ? 1 : 2;
  const coins = prepCoins(e.fans, runs, { stages, fanWidth });
  const coinValue = fanWidth * e.laneValue + e.fanFee + 100;
  const address = PrivateKey.fromWif(process.env[KEY_ENV]!.trim()).toAddress();
  say(`stress address ${address}: need ${coins} coins × ${coinValue} sats = ${(coins * coinValue).toLocaleString()} sats`);
  const { wocJson } = await import('../turbo');
  // Confirmed coins only (a fan-out may only spend MINED outputs), not already spent in the mempool.
  const conf = (await wocJson<{ result: { tx_hash: string; tx_pos: number; value: number; height?: number; isSpentInMempoolTx?: boolean }[] }>(`/address/${address}/confirmed/unspent`)).result;
  const pool = conf.filter((c) => !c.isSpentInMempoolTx).sort((a, b) => b.value - a.value);
  const ins: { txid: string; vout: number; value: number }[] = [];
  let have = 0;
  for (const c of pool) { if (have >= coins * coinValue + 200_000 || ins.length >= 200) break; ins.push({ txid: c.tx_hash, vout: c.tx_pos, value: c.value }); have += c.value; }
  const fit = Math.min(coins, Math.floor((have - 200_000) / coinValue));
  if (fit < 1) throw new Error(`Not enough CONFIRMED coins at ${address}: have ${have} sats. Fund it and wait for a block.`);
  if (fit < coins) say(`only enough for ${fit} of ${coins} coins: the ramp will stop early (out of coins)`);
  const t = s.fanOut(ins, Array(fit).fill(coinValue), 'ramp-29oct-prep', fee);
  if (t.fee > cap) throw new Error(`prep fee ${t.fee} > --max-sats ${cap}`);
  const ledger = new Ledger({ journal: join(RAMP, 'spent.jsonl') });
  for (const c of ins) ledger.addMined(c.txid, c.vout, c.value);
  ledger.spend(t.txid, ins.map((c) => `${c.txid}:${c.vout}`), t.outputs);
  mkdirSync(RAMP, { recursive: true });
  writeFileSync(join(RAMP, 'prep.json'), JSON.stringify({ txid: t.txid, outputs: t.outputs, coinValue, at: new Date().toISOString() }, null, 2));
  const r = (await arc.submit([{ txid: t.txid, bytes: t.ef }]))[0];
  say(`prep ${t.txid}: ${r.outcome} ${r.txStatus ?? ''} ${r.reason ?? ''}. Fee ${t.fee} sats. Wait for it to be MINED, then run the ramp.`);
}

async function oneRun(kind: 'arc' | 'bsv', ledger: Ledger, sign: ReturnType<typeof signer>, budget: { maxSats: number; spent: number }, out: string, url: string, fee?: number) {
  const bc = kind === 'arc' ? arcBroadcaster(url, bopts()) : bsvBroadcaster(url, bopts());
  const satsPerKb = fee ?? (await policyOf(bc));
  return runRamp({
    bc, ledger, sign, run: `ramp-29oct-${kind}`, label: kind === 'arc' ? 'ARC' : 'BSV Broadcaster', stages, stageSecs, satsPerKb, fanWidth, budget,
    halted: () => halted, signal: ac.signal, outDir: out, log: say, fanSettleMs: live ? 120_000 : 10_000, pollMs: live ? 2000 : 250,
  });
}

async function cmdRun() {
  const out = arg('out', join(RAMP, new Date().toISOString().replace(/[:.]/g, '-')))!;
  csvHeader(out);
  const results: { kind: string; url: string; stages: StageStats[]; stop?: string }[] = [];
  const kinds = only ? [only] : (['arc', 'bsv'] as const);
  let urls = { arc: arcUrl, bsv: bsvUrl };
  let ledger: Ledger;
  let sign: ReturnType<typeof signer>;
  let budget: { maxSats: number; spent: number };
  const mocks: Mock[] = [];
  if (live) {
    budget = { maxSats: maxSats(), spent: 0 };
    sign = signer(key());
    ledger = new Ledger({ journal: join(RAMP, 'spent.jsonl') });
    const prepFile = join(RAMP, 'prep.json');
    if (!existsSync(prepFile)) throw new Error('No prep: run `pnpm ramp prep --live --max-sats N` first and wait for a block.');
    const prep = JSON.parse(readFileSync(prepFile, 'utf8')) as { txid: string; outputs: number[] };
    const st = await arcBroadcaster(arcUrl, bopts()).status(prep.txid);
    if (classify(st) !== 'mined') throw new Error(`prep ${prep.txid} is ${st?.txStatus ?? 'unknown'}, not MINED yet: wait for a block.`);
    prep.outputs.forEach((v, i) => { if (v > 0) ledger.addMined(prep.txid, i, v); });
    say(`LIVE: ${ledger.count('mined')} unspent prep coins, fee cap ${budget.maxSats.toLocaleString()} sats, tag ${CALLBACK_TOKEN}`);
  } else {
    say('DRY RUN: throwaway key, fake coins, local mock ARC + BSV Broadcaster. Nothing leaves this machine.');
    if (flag('check-endpoints')) { await policyOf(arcBroadcaster(arcUrl, bopts())); await policyOf(bsvBroadcaster(bsvUrl, bopts())); }
    sign = signer(randomBytes(32));
    ledger = new Ledger();
    const e = estimate({ stages, stageSecs, satsPerKb: 100, fanWidth, sign });
    const coinValue = fanWidth * e.laneValue + e.fanFee + 100;
    const fake = txidHex(randomBytes(32));
    for (let i = 0; i < prepCoins(e.fans, kinds.length, { stages, fanWidth }); i++) ledger.addMined(fake, i, coinValue);
    budget = { maxSats: Number(arg('max-sats', String(e.total * 3))), spent: 0 };
    const ma = new Mock({ seenAfterMs: 30 });
    const mb = new Mock({ seenAfterMs: 30 });
    urls = { arc: await ma.start(), bsv: await mb.start() };
    mocks.push(ma, mb);
  }
  try {
    for (let i = 0; i < kinds.length && !halted; i++) {
      const kind = kinds[i];
      if (i > 0) {
        say(`pause ${pauseSecs} s before the ${kind} run (Ctrl-C / STOP file ends it)`);
        const end = Date.now() + pauseSecs * 1000;
        while (!halted && Date.now() < end) await sleep(250);
        if (halted) break;
      }
      const r = await oneRun(kind, ledger, sign, budget, out, urls[kind], live ? undefined : 100);
      results.push({ kind, url: live ? urls[kind] : `mock ${urls[kind]}`, ...r });
    }
  } finally {
    writeFileSync(join(out, 'summary.json'), JSON.stringify({ live, callbackToken: CALLBACK_TOKEN, feesSats: budget.spent, halted, results }, null, 2));
    say(`fees spent ${budget.spent.toLocaleString()} sats · logs in ${out}`);
    for (const m of mocks) await m.stop();
  }
}

(async () => {
  if (cmd === 'estimate') await cmdEstimate();
  else if (cmd === 'prep') await cmdPrep();
  else await cmdRun();
  process.exit(0);
})().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
