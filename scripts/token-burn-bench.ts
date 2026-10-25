/**
 * Token-burn throughput bench (swap on load, 25 Oct 2026): the real burn builder (buildTokenBurns in
 * src/lib/gun.ts, what Gun.fireTokens uses) against a MOCK ARC. Nothing touches the network or a real key:
 * the key is fresh and never funded, the token and fee coins spend made-up parents, nothing is broadcast.
 *
 *   pnpm tsx scripts/token-burn-bench.ts                      batch 25/100/250, 2,000 burns per run
 *   pnpm tsx scripts/token-burn-bench.ts --burns 5000 --rtt 300 --per-tx 0.3
 *
 * One lane: each burn spends the previous burn's token change, so building is serial (sign + fee per tx).
 * Mock ARC answers a batch after `rtt + perTx × batch` ms; batches are sent while the next one is built
 * (as the gallery's token loop does with one batch in flight). Reports build rate and end-to-end rate.
 */
import { P2PKH, PrivateKey, Transaction, UnlockingScript } from '@bsv/sdk';
import { bsv21, buildTokenBurns, BURN_ADDRESS } from '../src/lib/gun';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const BURNS = arg('burns', 2000);
const RTT = arg('rtt', 300); // ms, GorillaPool batch round trip (an input, not a measurement)
const PER_TX = arg('per-tx', 0.3); // ms per tx in a batch on ARC's side

const id = `${'ab'.repeat(32)}_0`;
const key = PrivateKey.fromRandom();
const me = key.toAddress();
const parent = (script: ReturnType<typeof bsv21>, sats: number) => {
  const t = new Transaction();
  t.addInput({ sourceTXID: 'cd'.repeat(32), sourceOutputIndex: 0, unlockingScript: new UnlockingScript() });
  t.addOutput({ lockingScript: script, satoshis: sats });
  return t;
};

async function run(batch: number) {
  let tok = { id, tx: parent(bsv21(id, BigInt(BURNS), me), 1), vout: 0, amt: BigInt(BURNS) };
  let fee = { tx: parent(new P2PKH().lock(me), BURNS * 90 + 1_000), vout: 0 };
  let n = 0;
  let buildMs = 0;
  let inFlight: Promise<void> = Promise.resolve();
  const t0 = performance.now();
  while (n < BURNS) {
    const extras = Array.from({ length: Math.min(batch, BURNS - n) }, () => ['gallery', 'player@bwalletx.com']);
    const b0 = performance.now();
    const chain = await buildTokenBurns(key, id, BigInt(1), n, extras, tok, fee, BURN_ADDRESS);
    const efs = chain.map((c) => c.tx.toHexEF()); // what ARC.broadcastMany serialises
    buildMs += performance.now() - b0;
    await inFlight; // one batch in flight at a time
    inFlight = new Promise((r) => setTimeout(r, RTT + PER_TX * efs.length));
    const last = chain[chain.length - 1];
    n += chain.length;
    if (!last.tok) break;
    // Drop ancestry like Gun.fireTokens does after a batch (keeps each tx small).
    tok = { ...last.tok, tx: Transaction.fromHex(last.tok.tx.toHex()) };
    fee = { tx: Transaction.fromHex(last.sats.tx.toHex()), vout: last.sats.vout };
  }
  await inFlight;
  const total = performance.now() - t0;
  return { batch, burns: n, buildPerSec: Math.round((n / buildMs) * 1000), endToEndPerSec: Math.round((n / total) * 1000) };
}

void (async () => {
  console.log(`token-burn bench: ${BURNS} burns, mock ARC rtt ${RTT} ms + ${PER_TX} ms/tx, one lane`);
  for (const b of [25, 100, 250]) console.log(JSON.stringify(await run(b)));
})();
