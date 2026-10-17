/**
 * TokenBlaster CLI. Fires transactions tagged
 *   OP_FALSE OP_RETURN "tokenblaster.lol" <token id> <chain>:<n>
 * so the referee can count them. Each one spends the previous one's change. With --chains N, one
 * fan-out tx first splits the coin into N coins and N chains run in parallel (one chain is ~10-20 tx/s,
 * bounded by the ARC round trip; parallel chains are how you get to a million).
 *
 *   BLASTER_WIF=<key> pnpm blast --token <txid_vout> --count 100                         (dry run)
 *   BLASTER_WIF=<key> pnpm blast --token <txid_vout> --count 1000000 --chains 1000 --broadcast
 *   pnpm blast --keychain ...      reads the key from macOS Keychain (service BLASTER_WIF), never shown
 *
 * The key comes only from the environment or Keychain, never from a file in this repo. Use a small
 * throwaway wallet: every broadcast transaction pays a fee. Leftover coins stay at the key's address.
 */
import { execFileSync } from 'node:child_process';
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';
import { banner, dim, red } from './banner';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const ARC_URL = process.env.BLASTER_ARC_URL || 'https://arc.gorillapool.io';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const USAGE = `${red('usage')}  pnpm blast [--keychain] --token <txid_vout> --count <n> [--chains <n>] [--fee-rate <sat/kB>] [--broadcast]

  --token      BSV-21 token id the blasts credit (default: test)
  --count      total transactions (up to 2,000,000)
  --chains     parallel chains (default 1, up to 2,000); a fan-out tx splits the coin first
  --fee-rate   sats per kB (default ${process.env.BLASTER_FEE_RATE || 100}, or BLASTER_FEE_RATE)
  --broadcast  actually send; without it this is a dry run that only builds and signs
  --keychain   read the key from macOS Keychain (service BLASTER_WIF) instead of BLASTER_WIF

  ${dim('Key: BLASTER_WIF env var or --keychain. Use a small throwaway wallet.')}`;

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
  if (flag('help') || flag('h')) return console.log(USAGE);
  const wif = loadWif();
  if (!wif) {
    console.log(USAGE);
    throw new Error('\nSet BLASTER_WIF (or use --keychain) to the key of a small throwaway wallet.');
  }
  const token = arg('token', 'test')!;
  const count = Math.max(1, Math.min(2_000_000, Number(arg('count', '10'))));
  const chains = Math.max(1, Math.min(2_000, Number(arg('chains', '1')), count));
  const feeRate = Number(arg('fee-rate', process.env.BLASTER_FEE_RATE || '100'));
  const broadcast = flag('broadcast');

  const key = PrivateKey.fromWif(wif);
  const address = key.toAddress();
  const utxos: { tx_hash: string; tx_pos: number; value: number }[] = await fetch(`${WOC}/address/${address}/unspent`).then((r) => r.json());
  if (!utxos.length) throw new Error(`No coins at ${address}. Send it a little BSV first.`);
  const coin = utxos.sort((a, b) => b.value - a.value)[0];
  const source = Transaction.fromHex(await fetch(`${WOC}/tx/${coin.tx_hash}/hex`).then((r) => r.text()));

  // budget: a blast is ~230 bytes; give each chain its share plus a margin
  const perTx = Math.ceil((240 * feeRate) / 1000);
  const perChain = Math.ceil(count / chains) * perTx + 50;
  const need = perChain * chains + Math.ceil(((chains * 34 + 200) * feeRate) / 1000) + 100;
  console.log(`${red('▶')} wallet   ${address}  ${dim(`${coin.value.toLocaleString()} sats in the largest coin`)}`);
  console.log(`${red('▶')} plan     ${count.toLocaleString()} tx over ${chains} chain${chains > 1 ? 's' : ''} at ${feeRate} sat/kB  ${dim(`≈ ${(count * perTx).toLocaleString()} sats in fees`)}`);
  if (need > coin.value) throw new Error(`Not enough in one coin: need about ${need.toLocaleString()} sats, have ${coin.value.toLocaleString()}.`);
  console.log(`${red('▶')} mode     ${broadcast ? red('BROADCAST') : 'dry run (add --broadcast to send)'}  ${dim(ARC_URL)}\n`);

  const arc = new ARC(ARC_URL);
  const send = async (tx: Transaction) => {
    for (let attempt = 0; ; attempt++) {
      const r = await tx.broadcast(arc);
      if (r.status === 'success') return;
      if (attempt >= 3) throw new Error(JSON.stringify(r));
      await sleep(500 * 2 ** attempt);
    }
  };

  // heads: one coin per chain (the fan-out's outputs), or the coin itself for a single chain
  let heads: { tx: Transaction; vout: number }[];
  if (chains === 1) heads = [{ tx: source, vout: coin.tx_pos }];
  else {
    const fan = new Transaction();
    fan.addInput({ sourceTransaction: source, sourceOutputIndex: coin.tx_pos, unlockingScriptTemplate: new P2PKH().unlock(key) });
    for (let c = 0; c < chains; c++) fan.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: perChain });
    fan.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
    await fan.fee(new SatoshisPerKilobyte(feeRate));
    await fan.sign();
    if (broadcast) await send(fan);
    console.log(`${red('▶')} fan-out  ${fan.id('hex')}  ${dim(`${chains} coins of ${perChain} sats`)}`);
    heads = Array.from({ length: chains }, (_, c) => ({ tx: fan, vout: c }));
  }

  let sent = 0, fees = 0, bytes = 0, failed = 0;
  const started = Date.now();
  const tick = setInterval(() => {
    const secs = (Date.now() - started) / 1000;
    process.stdout.write(`\r${red('■')} ${sent.toLocaleString()} / ${count.toLocaleString()}  ${(sent / secs).toFixed(0)} tx/s  ${fees.toLocaleString()} sats  ${failed ? red(`${failed} chains stopped`) : ''}   `);
  }, 500);

  await Promise.all(
    heads.map(async (head, c) => {
      const quota = Math.floor(count / chains) + (c < count % chains ? 1 : 0);
      let prev = head.tx, vout = head.vout;
      for (let n = 1; n <= quota; n++) {
        const tx = new Transaction();
        tx.addInput({ sourceTransaction: prev, sourceOutputIndex: vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
        tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${hex('tokenblaster.lol')} ${hex(token)} ${hex(`${c}:${n}`)}`), satoshis: 0 });
        tx.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
        await tx.fee(new SatoshisPerKilobyte(feeRate));
        await tx.sign();
        if (broadcast) {
          try { await send(tx); } catch (e) {
            failed++;
            console.error(`\n${red('✖')} chain ${c} stopped at ${n}: ${(e as Error).message.slice(0, 200)}`);
            return;
          }
        }
        sent++; fees += tx.getFee(); bytes += tx.toBinary().length;
        // drop the parent so a long chain doesn't keep every tx in memory
        tx.inputs[0].sourceTransaction = undefined;
        tx.inputs[0].sourceTXID = prev.id('hex');
        prev = tx; vout = 1;
      }
    }),
  );
  clearInterval(tick);
  const secs = (Date.now() - started) / 1000;
  console.log(
    `\n\n${red('▶')} ${broadcast ? 'broadcast' : 'dry run'}: ${sent.toLocaleString()} tx in ${secs.toFixed(1)}s ` +
      `(${(sent / secs).toFixed(0)}/s), ${bytes.toLocaleString()} bytes, ${fees.toLocaleString()} sats in fees` +
      (failed ? red(`, ${failed} chain(s) stopped early`) : ''),
  );
}

main().catch((e) => {
  console.error(red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
