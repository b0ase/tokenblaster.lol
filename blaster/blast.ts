/**
 * TokenBlaster CLI (bare bones). Fires a chain of transactions, each tagged
 *   OP_FALSE OP_RETURN "tokenblaster.lol" <token id> <n>
 * so the referee can count them. Each one spends the previous one's change, so one coin is enough.
 *
 *   BLASTER_WIF=<your key> pnpm blast --token <txid_vout> --count 100            (dry run)
 *   BLASTER_WIF=<your key> pnpm blast --token <txid_vout> --count 100 --broadcast
 *
 * The key comes only from the environment, never from a file in this repo. Use a small throwaway
 * wallet: every broadcast transaction pays a fee.
 */
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const ARC_URL = process.env.BLASTER_ARC_URL || 'https://arc.gorillapool.io';
const FEE_RATE = Number(process.env.BLASTER_FEE_RATE || 100); // sats per kB

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));

async function main() {
  const wif = process.env.BLASTER_WIF;
  if (!wif) throw new Error('Set BLASTER_WIF to the private key (WIF) of a small throwaway wallet.');
  // The token this pack is for (BSV-21 id `<txid>_<vout>`): the leaderboard credits it.
  const token = arg('token', 'test')!;
  const count = Math.max(1, Math.min(10_000, Number(arg('count', '10'))));
  const broadcast = process.argv.includes('--broadcast');

  const key = PrivateKey.fromWif(wif);
  const address = key.toAddress();
  const utxos: { tx_hash: string; tx_pos: number; value: number }[] = await fetch(
    `${WOC}/address/${address}/unspent`,
  ).then((r) => r.json());
  if (!utxos.length) throw new Error(`No coins at ${address}. Send it a little BSV first.`);
  const coin = utxos.sort((a, b) => b.value - a.value)[0];
  let prev = Transaction.fromHex(await fetch(`${WOC}/tx/${coin.tx_hash}/hex`).then((r) => r.text()));
  let vout = coin.tx_pos;

  const arc = new ARC(ARC_URL);
  let bytes = 0;
  let fees = 0;
  const started = Date.now();
  for (let n = 1; n <= count; n++) {
    const tx = new Transaction();
    tx.addInput({ sourceTransaction: prev, sourceOutputIndex: vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
    tx.addOutput({
      lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${hex('tokenblaster.lol')} ${hex(token)} ${hex(String(n))}`),
      satoshis: 0,
    });
    tx.addOutput({ lockingScript: new P2PKH().lock(address), change: true });
    await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
    await tx.sign();
    bytes += tx.toBinary().length;
    fees += tx.getFee();
    if (broadcast) {
      const r = await tx.broadcast(arc);
      if (r.status !== 'success') throw new Error(`Broadcast ${n} failed: ${JSON.stringify(r)}`);
    }
    prev = tx;
    vout = 1;
  }
  const secs = (Date.now() - started) / 1000;
  console.log(
    `${broadcast ? 'Broadcast' : 'Dry run:'} ${count} tx in ${secs.toFixed(1)}s (${(count / secs).toFixed(0)}/s), ` +
      `${bytes} bytes, ${fees} sats in fees. Last txid ${prev.id('hex')}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
