/**
 * TERRORNODE stress test runner (1 Nov 2026): N bots × M shots from the pre-split stress wallet.
 *
 *   pnpm terror --bots 1 --shots 10000 --keychain                          DRY RUN (default): sign from the REAL coins, send nothing
 *   pnpm terror --bots 1 --shots 10000 --address 1Nbr…                     DRY RUN: that address's real coins, throwaway key
 *   pnpm terror --bots 1 --shots 10000 --fake                              DRY RUN with a throwaway key + fake coins (no key needed)
 *   pnpm terror --live --bots 1 --shots 10000 --max-sats 400000 --keychain                     live rehearsal (owner's go only)
 *   pnpm terror --live --bots 20 --shots 850000 --rate 1000 --max-sats 520000000 --keychain    full run (owner's go only)
 *
 * Bots are labels on the one funding wallet: terrornode-bot01 … terrornode-botNN, written into every tx's OP_RETURN
 * ("tokenblaster.lol" "TERRORNODE" <n> "terrornode-botNN"). Bot shots never touch the receipts API: bots earn NO
 * $TERRORNODE. Each bot owns a disjoint slice of the funding coins (coin i → bot i mod --total-bots), so several
 * machines/processes can run different --bots ranges (e.g. "1-10" and "11-20") from the same wallet safely.
 *
 *   pnpm terror prep --address 1Nbr…  |  pnpm terror prep --live --coins 1000 --max-sats 50000 --keychain
 *                                          split the funding into 1,000 mined coins first (one block before the run)
 *
 * Flags: --bots N | a-b | a,b,c · --total-bots 20 · --shots M (per bot) · --rate tx/s (global, 0 = flat out)
 *        --bot-max-sats 30000000 (0.3 BSV per bot) · --max-sats N (global fee cap; required with --live)
 *        --broadcasters arc,bsv (bots round-robin over them) · --arc-url · --bsv-url · --sats-per-kb (default: live /policy)
 *        --max-errors 0.05 · --fan-width 20000 · --batch 1000 · --inflight 16 · --sample 0.01 · --out DIR
 *        --key-env TERRORNODE_STRESS_WIF · --keychain (read the key from the macOS Keychain into the env var, in-process)
 *
 * Kill switch: `touch ~/.tokenblaster/STOP` (any shell, any time; checked every 0.5 s) or Ctrl-C. Auto-stop: broadcast
 * errors > --max-errors over the last 5,000 results, sampled orphans > 5 %, any cap reached.
 * The key is never printed, logged or written to disk. Dry runs never write the live spent-outputs journal.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrivateKey } from '@bsv/sdk';
import { arcBroadcaster, bsvBroadcaster, ARC_URL, BSV_URL, type Broadcaster, type Opts, type TxStatus } from '../ramp/broadcaster';
import { Ledger } from '../ramp/ledger';
import { signer, txidHex } from '../ramp/tx';
import { NO_RECEIPTS, allocate, botName, checkLive, parseBots, project } from './plan';
import { runStress, type BotSpec } from './runner';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i > -1 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const live = flag('live');
const fake = flag('fake');
const DIR = join(homedir(), '.tokenblaster');
const STOP = arg('stop-file', join(DIR, 'STOP'))!;
const KEY_ENV = arg('key-env', 'TERRORNODE_STRESS_WIF')!;
const CALLBACK = arg('tag', 'terrornode-stress-1nov')!;
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const n = (x: number) => Math.round(x).toLocaleString();

let halted = false;
const ac = new AbortController();
const halt = (why: string) => { if (halted) return; halted = true; console.log(''); say(`HALT: ${why}`); ac.abort(); };
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

/** Dry broadcaster: takes everything, reports SEEN at once. Nothing leaves this machine. */
function dryBroadcaster(name: string): Broadcaster {
  return {
    kind: 'bsv', url: `dry://${name}`,
    async submit(items) { return items.map((it) => ({ txid: it.txid, outcome: 'accepted' as const, txStatus: 'RECEIVED' })); },
    async status(txid): Promise<TxStatus> { return { txid, txStatus: 'SEEN_ON_NETWORK' }; },
    async policy() { return { satsPerKb: 100, raw: null }; },
    async health() { return { ok: true, raw: null }; },
  };
}

async function main() {
  if (!NO_RECEIPTS) throw new Error('bots must not earn receipts');
  const botNums = parseBots(arg('bots', '1')!);
  const totalBots = Number(arg('total-bots', String(Math.max(20, ...botNums))));
  const shots = Number(arg('shots', '10000'));
  const rate = Number(arg('rate', '0'));
  const botMaxSats = Number(arg('bot-max-sats', '30000000'));
  const maxErr = Number(arg('max-errors', '0.05'));
  const kinds = (arg('broadcasters', 'bsv,arc')!).split(',').map((s) => s.trim()) as ('arc' | 'bsv')[];
  const bopts = (): Opts => ({ callbackToken: CALLBACK, stopped: () => halted, signal: ac.signal, log: (s) => say(`  ${s}`), timeoutMs: 30_000 });
  const real = kinds.map((k) => (k === 'arc' ? arcBroadcaster(arg('arc-url', ARC_URL)!, bopts()) : bsvBroadcaster(arg('bsv-url', BSV_URL)!, bopts())));
  if (existsSync(STOP)) throw new Error(`${STOP} exists (kill switch). Remove it to run.`);

  // fee rate: the live broadcasters' /policy (read-only GETs), the highest one wins; --sats-per-kb overrides
  let satsPerKb = Number(arg('sats-per-kb', '0'));
  if (!satsPerKb) {
    for (const bc of real) {
      try { const p = await bc.policy(); say(`${bc.kind} ${bc.url}: ${p.satsPerKb} sat/kB`); satsPerKb = Math.max(satsPerKb, p.satsPerKb); }
      catch (e) { say(`${bc.kind} ${bc.url}: policy unavailable (${(e as Error).message})`); }
    }
    if (!satsPerKb) { if (live) throw new Error('no broadcaster answered /policy; pass --sats-per-kb'); satsPerKb = 100; }
  }

  // --address (dry only): the REAL coin set of that address, signed with a throwaway key (same sizes, fees and rate;
  // the signatures just aren't valid for those coins). For when the funding key isn't on this machine.
  const watch = live ? undefined : arg('address');
  const priv = fake || watch ? randomBytes(32) : privKey();
  const sign = signer(priv);
  const address = watch ?? PrivateKey.fromString(Buffer.from(priv).toString('hex'), 16).toAddress();
  type C = { txid: string; vout: number; value: number };
  let coins: C[];
  if (fake) {
    const t = txidHex(randomBytes(32));
    coins = Array.from({ length: 1001 }, (_, i) => ({ txid: t, vout: i, value: 499_500 }));
    say(`FAKE coins: 1,001 × 499,500 sats on a throwaway key`);
  } else {
    const { wocJson } = await import('../turbo');
    const conf = (await wocJson<{ result: { tx_hash: string; tx_pos: number; value: number; isSpentInMempoolTx?: boolean }[] }>(`/address/${address}/confirmed/unspent`)).result;
    coins = conf.filter((c) => !c.isSpentInMempoolTx).map((c) => ({ txid: c.tx_hash, vout: c.tx_pos, value: c.value }))
      .sort((a, b) => (a.txid === b.txid ? a.vout - b.vout : a.txid < b.txid ? -1 : 1)); // same order on every machine
    const minCoin = Number(arg('min-coin', '10000'));
    const dust = coins.filter((c) => c.value < minCoin);
    coins = coins.filter((c) => c.value >= minCoin);
    say(`stress wallet ${address}: ${n(coins.length)} confirmed coins ≥ ${n(minCoin)} sats holding ${n(coins.reduce((s, c) => s + c.value, 0))} sats (min ${n(Math.min(...coins.map((c) => c.value)))}, max ${n(Math.max(...coins.map((c) => c.value)))}); ${n(dust.length)} smaller coins skipped (${n(dust.reduce((s, c) => s + c.value, 0))} sats)`);
  }

  const outDir = arg('out', join(DIR, 'terror', `${live ? 'live' : 'dry'}-${new Date().toISOString().replace(/[:.]/g, '-')}`))!;
  mkdirSync(outDir, { recursive: true });
  const specs: BotSpec[] = botNums.map((b, i) => {
    const name = botName(b);
    // live: per-bot journal of every spent output (never re-spend, survives restarts); dry: memory only
    const ledger = new Ledger(live ? { journal: join(DIR, 'terror', `spent-${name}.jsonl`) } : {});
    const mine = allocate(coins, totalBots, b);
    for (const c of mine) ledger.addMined(c.txid, c.vout, c.value);
    const bc = live ? real[i % real.length] : dryBroadcaster(name);
    return { name, ledger, bc, shots, maxSats: botMaxSats };
  });
  const walletSats = specs.reduce((s, b) => s + b.ledger.available('mined').reduce((a, u) => a + u.value, 0), 0);
  const feePerShotEst = sign.blastFee(9_999_999, botName(1), satsPerKb) + 0.1;
  let maxSats = Number(arg('max-sats', '0'));
  if (live) {
    if (!(maxSats > 0)) throw new Error('--live needs --max-sats N (hard cap on fees, the owner-approved budget)');
    const bad = checkLive({ bots: specs.length, shotsPerBot: shots, feePerShot: feePerShotEst, botMaxSats, maxSats, walletSats });
    if (bad) throw new Error(`Refusing: ${bad}.`);
  } else if (!maxSats) maxSats = Number.MAX_SAFE_INTEGER;

  say(`${live ? 'LIVE via ' + specs.map((s) => `${s.name}→${s.bc.kind}`).join(' ') : 'DRY RUN: real signatures, nothing broadcast'} · ${specs.length} bot(s) × ${n(shots)} shots · ${satsPerKb} sat/kB · bot cap ${n(botMaxSats)} sats · global cap ${live ? n(maxSats) : '∞'} · no receipts · tag ${CALLBACK}`);
  say(`kill switch: touch ${STOP}   · logs ${outDir}`);

  let blastBytes = 0, blastCount = 0, fanBytes = 0;
  const r = await runStress({
    bots: specs, sign, satsPerKb, rate, maxSats, maxErrorRatio: maxErr,
    fanWidth: Number(arg('fan-width', '20000')), batch: Number(arg('batch', '1000')), maxInflight: Number(arg('inflight', '16')),
    statusSample: Number(arg('sample', '0.01')), pollMs: live ? 2000 : 200, fanSettleMs: live ? 900_000 : 5_000, forget: true,
    halted: () => halted, outDir, log: say,
    onSigned: (_b, kind, t) => { if (kind === 'blast') { blastBytes += t.ef.length; blastCount++; } else fanBytes += t.ef.length; },
    onTick: (t) => process.stdout.write(`\r\x1b[2K${n(t.secs)}s  signed ${n(t.signed)} (${n(t.signRate)}/s avg)  accepted ${n(t.accepted)} (${n(t.txps1s)}/s)  rej ${n(t.rejected)} retry ${n(t.retries)} err ${(t.errRatio * 100).toFixed(2)}%  sampled ${t.sampled} seen ${t.seen} orphan ${t.orphan}  fees ${n(t.fees)} sats  p95 ${t.latencyP95} ms`),
  });
  console.log('');
  const t = r.totals;
  const feePerShot = t.signed ? t.fees / t.signed : 0;
  const usd = Number(arg('bsv-usd', '17.19'));
  const proj = [17_000_000, 20_000_000].map((s) => project(s, feePerShot, usd));
  const summary = {
    live, host: hostname(), address, satsPerKb, stop: r.stop, totals: t,
    feePerShot, blastFeeOnly: t.signed ? (t.fees - t.fanFees) / t.signed : 0, avgBlastBytes: blastCount ? blastBytes / blastCount : 0, fanBytes,
    projections: proj, bots: r.bots.map((b) => ({ name: b.name, signed: b.signed, accepted: b.accepted, rejected: b.rejected, retries: b.retries, fees: b.fees, fanouts: b.fanouts, done: b.done })),
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  say(`${live ? 'LIVE' : 'DRY RUN'} done${r.stop ? ` (stop: ${r.stop})` : ''}: signed ${n(t.signed)} in ${t.secs.toFixed(1)} s = ${n(t.signRate)} tx/s · accepted ${n(t.accepted)} · rejected ${n(t.rejected)} · ${t.fanouts} fan-out(s)`);
  say(`fees ${n(t.fees)} sats = ${feePerShot.toFixed(3)} sats/shot (blast ${summary.blastFeeOnly.toFixed(3)} + fan-out share) · blast ${summary.avgBlastBytes.toFixed(1)} bytes EF`);
  for (const p of proj) say(`projected ${n(p.shots)} shots: ${n(p.fees)} sats fees = ${p.bsv.toFixed(3)} BSV ≈ $${p.usd.toFixed(0)} @ $${usd} (+${n(p.dust)} sats parked in 1-sat change)`);
  for (const b of summary.bots) say(`  ${b.name}: signed ${n(b.signed)} accepted ${n(b.accepted)} fees ${n(b.fees)} · ${b.done ?? ''}`);
  say(`summary ${join(outDir, 'summary.json')}`);
}

/**
 * prep: split the big funding coin(s) into `--coins` equal coins (one per future fan-out), so every bot has many
 * mined coins and no chain is ever more than 2 deep. Dry by default (signs and prints the plan); --live broadcasts it
 * to every broadcaster. Wait for one block before the run.
 */
async function prep() {
  const count = Number(arg('coins', '1000'));
  const watch = live ? undefined : arg('address');
  const priv = watch ? randomBytes(32) : privKey();
  const sign = signer(priv);
  const address = watch ?? PrivateKey.fromString(Buffer.from(priv).toString('hex'), 16).toAddress();
  const satsPerKb = Number(arg('sats-per-kb', '100'));
  const { wocJson } = await import('../turbo');
  const conf = (await wocJson<{ result: { tx_hash: string; tx_pos: number; value: number; isSpentInMempoolTx?: boolean }[] }>(`/address/${address}/confirmed/unspent`)).result;
  const ins = conf.filter((c) => !c.isSpentInMempoolTx && c.value >= 100_000).map((c) => ({ txid: c.tx_hash, vout: c.tx_pos, value: c.value }));
  const have = ins.reduce((a, c) => a + c.value, 0);
  if (!ins.length) throw new Error(`no confirmed coin ≥ 100,000 sats at ${address}`);
  const fee = Math.ceil((sign.fanBytes(ins.length, count + 2, 60) * satsPerKb) / 1000) + 1;
  const each = Math.floor((have - fee - 10_000) / count);
  const t = sign.fanOut(ins, Array(count).fill(each), 'terrornode-stress-prep', satsPerKb);
  say(`prep ${live ? 'LIVE' : 'DRY'}: ${ins.length} coin(s), ${n(have)} sats → ${n(count)} × ${n(each)} sats + change · ${n(t.ef.length)} bytes · fee ${n(t.fee)} sats · txid ${t.txid}`);
  if (!live) return say('dry: nothing sent. Add --live (and --max-sats ≥ the fee) to broadcast it, then wait for one block.');
  const cap = Number(arg('max-sats', '0'));
  if (!(cap >= t.fee)) throw new Error(`--live prep needs --max-sats ≥ ${t.fee}`);
  const bopts: Opts = { callbackToken: CALLBACK, signal: ac.signal, log: (s) => say(`  ${s}`), timeoutMs: 30_000 };
  for (const bc of [bsvBroadcaster(arg('bsv-url', BSV_URL)!, bopts), arcBroadcaster(arg('arc-url', ARC_URL)!, bopts)]) {
    const r = (await bc.submit([{ txid: t.txid, bytes: t.ef }]))[0];
    say(`  ${bc.kind}: ${r.outcome} ${r.txStatus ?? ''} ${r.reason ?? ''}`);
  }
  say('wait for one block (MINED), then run the stress test.');
}

(argv[0] === 'prep' ? prep() : main()).then(() => process.exit(0)).catch((e) => { console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
