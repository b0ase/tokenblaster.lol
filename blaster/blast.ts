/**
 * TokenBlaster CLI. Every blast is a transaction tagged
 *   OP_FALSE OP_RETURN "tokenblaster.lol" <token id> <chain>:<n>
 * so the referee can count them. One fan-out tx gathers the wallet's coins and splits them into one coin
 * per chain; the chains then run in parallel, each tx spending the previous one's change.
 *
 * Interactive (just `pnpm blast`):
 *   paste a private key (hidden) to spend from, or /new for a fresh pair; pay the address shown;
 *   /fire blasts the whole balance. /balance, /help, /quit.
 *   /new keys are saved to ~/.tokenblaster/<address>.wif (mode 600), outside this repo, never printed.
 *
 * Scripted:
 *   BLASTER_WIF=<key> pnpm blast --count 1000000 --chains 1000 [--token <txid_vout>] [--broadcast]
 *   pnpm blast --keychain ...      reads the key from macOS Keychain (service BLASTER_WIF)
 *
 * Every broadcast transaction pays a network fee. Use a small throwaway wallet.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as readline from 'node:readline';
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';
import { banner, dim, red } from './banner';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const ARC_URL = process.env.BLASTER_ARC_URL || 'https://arc.gorillapool.io';
const KEY_DIR = join(homedir(), '.tokenblaster');

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (x: number) => x.toLocaleString();

type Coin = { tx_hash: string; tx_pos: number; value: number };
const coinsOf = async (address: string): Promise<Coin[]> =>
  (await fetch(`${WOC}/address/${address}/unspent`, { cache: 'no-store' }).then((r) => r.json())).filter((c: Coin) => c.value > 1);
const balanceOf = async (address: string) => (await coinsOf(address)).reduce((s, c) => s + c.value, 0);

/** Sats per blast at this fee rate (a blast is ~230 bytes). */
const perTx = (feeRate: number) => Math.ceil((240 * feeRate) / 1000);
/** Fan-out fee for this many inputs and chains. */
const fanFee = (inputs: number, chains: number, feeRate: number) => Math.ceil(((inputs * 150 + chains * 34 + 100) * feeRate) / 1000) + 10;
/** How many blasts a balance pays for, and how many chains to spread them over. */
function planFor(balance: number, inputs: number, feeRate: number) {
  let chains = 1;
  for (let i = 0; i < 3; i++) {
    const count = Math.max(0, Math.floor((balance - fanFee(inputs, chains, feeRate) - 50 * chains) / perTx(feeRate)));
    chains = Math.max(1, Math.min(1000, Math.ceil(count / 1000)));
  }
  const count = Math.max(0, Math.floor((balance - fanFee(inputs, chains, feeRate) - 50 * chains) / perTx(feeRate)));
  return { count, chains };
}

async function blast(o: { key: PrivateKey; count: number; chains: number; feeRate: number; token: string; broadcast: boolean }) {
  const { key, feeRate, token, broadcast } = o;
  const address = key.toAddress();
  const coins = (await coinsOf(address)).sort((a, b) => b.value - a.value).slice(0, 200);
  if (!coins.length) throw new Error(`No coins at ${address}. Pay it some BSV first.`);
  const chains = Math.max(1, Math.min(2000, o.chains, o.count));
  const count = o.count;
  const quota = (c: number) => Math.floor(count / chains) + (c < count % chains ? 1 : 0);
  const have = coins.reduce((s, c) => s + c.value, 0);
  const need = count * perTx(feeRate) + 50 * chains + fanFee(coins.length, chains, feeRate);
  console.log(`${red('▶')} plan     ${n(count)} tx over ${chains} chain${chains > 1 ? 's' : ''} at ${feeRate} sat/kB  ${dim(`≈ ${n(count * perTx(feeRate))} sats in fees`)}`);
  console.log(`${red('▶')} mode     ${broadcast ? red('BROADCAST') : 'dry run (add --broadcast to send)'}  ${dim(ARC_URL)}`);
  if (need > have) throw new Error(`Not enough: need about ${n(need)} sats, the address has ${n(have)}.`);

  const arc = new ARC(ARC_URL);
  const send = async (tx: Transaction) => {
    for (let attempt = 0; ; attempt++) {
      const r = await tx.broadcast(arc);
      if (r.status === 'success') return;
      if (attempt >= 3) throw new Error(JSON.stringify(r));
      await sleep(500 * 2 ** attempt);
    }
  };

  // fan-out: all coins in, one coin per chain out (sized to its quota), the rest back as change
  const fan = new Transaction();
  for (const c of coins) {
    const src = Transaction.fromHex(await fetch(`${WOC}/tx/${c.tx_hash}/hex`).then((r) => r.text()));
    fan.addInput({ sourceTransaction: src, sourceOutputIndex: c.tx_pos, unlockingScriptTemplate: new P2PKH().unlock(key) });
  }
  for (let c = 0; c < chains; c++) fan.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: quota(c) * perTx(feeRate) + 50 });
  fan.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
  await fan.fee(new SatoshisPerKilobyte(feeRate));
  await fan.sign();
  if (broadcast) await send(fan);
  console.log(`${red('▶')} fan-out  ${fan.id('hex')}\n`);

  let sent = 0, fees = 0, bytes = 0, failed = 0;
  const started = Date.now();
  const draw = () => {
    const secs = Math.max(0.1, (Date.now() - started) / 1000);
    const w = 30, done = Math.round((sent / count) * w);
    process.stdout.write(`\r${red('█'.repeat(done))}${dim('░'.repeat(w - done))} ${n(sent)} / ${n(count)}  ${(sent / secs).toFixed(0)} tx/s  ${n(fees)} sats ${failed ? red(` ${failed} chains stopped`) : ''}  `);
  };
  const tick = setInterval(draw, 250);

  await Promise.all(
    Array.from({ length: chains }, async (_, c) => {
      let prev = fan, vout = c;
      for (let i = 1; i <= quota(c); i++) {
        const tx = new Transaction();
        tx.addInput({ sourceTransaction: prev, sourceOutputIndex: vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
        tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${hex('tokenblaster.lol')} ${hex(token)} ${hex(`${c}:${i}`)}`), satoshis: 0 });
        tx.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
        await tx.fee(new SatoshisPerKilobyte(feeRate));
        await tx.sign();
        if (broadcast) {
          try { await send(tx); } catch (e) {
            failed++;
            console.error(`\n${red('✖')} chain ${c} stopped at ${i}: ${(e as Error).message.slice(0, 200)}`);
            return;
          }
        }
        sent++; fees += tx.getFee(); bytes += tx.toBinary().length;
        if (prev !== fan) { tx.inputs[0].sourceTXID = prev.id('hex'); tx.inputs[0].sourceTransaction = undefined; }
        prev = tx; vout = 1;
      }
    }),
  );
  clearInterval(tick);
  draw();
  const secs = (Date.now() - started) / 1000;
  console.log(
    `\n\n${red('▶')} ${broadcast ? 'blasted' : 'dry run'}: ${n(sent)} tx in ${secs.toFixed(1)}s (${(sent / secs).toFixed(0)}/s), ` +
      `${n(bytes)} bytes, ${n(fees)} sats in fees${failed ? red(`, ${failed} chain(s) stopped early`) : ''}\n`,
  );
}

// ── interactive ────────────────────────────────────────────────────────────────────────────
const HELP = `  ${red('/new')}      make a fresh key pair and show its address to pay
  ${red('/fire')}     blast the whole balance of the current address
  ${red('/balance')}  show the current address and balance
  ${red('/quit')}     leave
  ${dim('or paste a private key (WIF) to spend from: input is hidden')}`;

async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // hide what's typed while the line looks like a key (so a pasted WIF never shows on screen)
  const out = rl as unknown as { _writeToOutput: (s: string) => void; line: string };
  const write = out._writeToOutput.bind(rl);
  let hiding = false;   // only at the main prompt, where a key may be pasted
  out._writeToOutput = (s: string) => { if (hiding && out.line && !out.line.startsWith('/')) write(s.includes('\n') ? '\n' : ''); else write(s); };
  const ask = (q: string, hide = false) => new Promise<string>((res) => { hiding = hide; rl.question(q, (a) => { hiding = false; res(a); }); });
  const feeRate = Number(process.env.BLASTER_FEE_RATE || 100);
  const token = arg('token', 'test')!;
  let key: PrivateKey | null = null;

  const show = async () => {
    if (!key) return console.log(dim('  no key yet: paste one, or /new\n'));
    const a = key.toAddress(), bal = await balanceOf(a);
    const { count } = planFor(bal, 1, feeRate);
    console.log(`\n  ${red('PAY TO')}  ${a}\n  ${dim('balance')} ${n(bal)} sats  ${dim(`→ about ${n(count)} blasts at ${feeRate} sat/kB`)}\n`);
  };

  console.log(HELP + '\n');
  for (;;) {
    const line = (await ask(red('blast> '), true)).trim();
    try {
      if (!line) continue;
      if (line === '/quit' || line === '/exit') break;
      if (line === '/help') console.log(HELP + '\n');
      else if (line === '/new') {
        key = PrivateKey.fromRandom();
        mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
        const file = join(KEY_DIR, `${key.toAddress()}.wif`);
        writeFileSync(file, key.toWif() + '\n', { mode: 0o600 });
        chmodSync(file, 0o600);
        console.log(dim(`  new key saved to ${file} (keep it: it's the only copy)`));
        await show();
      } else if (line === '/balance') await show();
      else if (line === '/fire') {
        if (!key) { console.log(dim('  no key yet: paste one, or /new\n')); continue; }
        const a = key.toAddress(), coins = await coinsOf(a);
        const bal = coins.reduce((s, c) => s + c.value, 0);
        const { count, chains } = planFor(bal, Math.min(200, coins.length), feeRate);
        if (count < 1) { console.log(dim(`  ${n(bal)} sats isn't enough for a blast: pay ${a} first\n`)); continue; }
        const yes = (await ask(`  fire ${red(n(count))} blasts from ${a}, spending ~${n(bal)} sats? type ${red('yes')}: `)).trim();
        if (yes !== 'yes') { console.log(dim('  held fire\n')); continue; }
        await blast({ key, count, chains, feeRate, token, broadcast: true });
        await show();
      } else if (line.startsWith('/')) console.log(dim(`  unknown command ${line}; /help\n`));
      else {
        key = PrivateKey.fromWif(line);
        console.log(dim('  key loaded'));
        await show();
      }
    } catch (e) {
      console.log(red(`  ${e instanceof Error ? e.message : String(e)}\n`));
    }
  }
  rl.close();
}

// ── scripted ───────────────────────────────────────────────────────────────────────────────
function loadWif(): string | undefined {
  if (process.env.BLASTER_WIF) return process.env.BLASTER_WIF;
  if (!flag('keychain')) return undefined;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'BLASTER_WIF', '-w'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('No Keychain item with service BLASTER_WIF.');
  }
}

async function main() {
  banner('chain blaster · BSV · every blast is a real transaction');
  const wif = loadWif();
  if (!wif) {
    if (!process.stdin.isTTY) throw new Error('Set BLASTER_WIF (or use --keychain), or run in a terminal for interactive mode.');
    return interactive();
  }
  await blast({
    key: PrivateKey.fromWif(wif),
    count: Math.max(1, Math.min(2_000_000, Number(arg('count', '10')))),
    chains: Number(arg('chains', '1')),
    feeRate: Number(arg('fee-rate', process.env.BLASTER_FEE_RATE || '100')),
    token: arg('token', 'test')!,
    broadcast: flag('broadcast'),
  });
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
