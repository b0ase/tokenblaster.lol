/**
 * Token blasting for the CLI, same shape as the web gun (src/lib/gun.ts fireTokens): every bullet is a
 * real BSV-21 transfer of `per` units to the burn address, carrying the TokenBlaster tag, with the rest
 * of the tokens going back to the token address. Tokens sit at the token key's address; network fees
 * come from the BSV key's coins.
 *
 * One prep tx gathers every token coin of the chosen id and the BSV coins, and splits them into
 * `lanes` token coins plus `lanes` fee coins, so the lanes fire in parallel.
 */
import { ARC, P2PKH, PrivateKey, SatoshisPerKilobyte, Script, Transaction, Utils } from '@bsv/sdk';
import { dim, red } from './banner';
import { fetchTx, unspent } from './turbo';

const GP = 'https://ordinals.gorillapool.io/api';
const ARC_URL = process.env.BLASTER_ARC_URL || 'https://arc.gorillapool.io';
export const BURN_ADDRESS = '1BitcoinEaterAddressDontSendf59kuE';
const TAG = 'tokenblaster.lol';
/** Sats per token bullet at 100 sat/kB: ~830-byte transfer, plus the 1-sat burn output. */
export const bulletSats = (feeRate: number) => Math.ceil((850 * feeRate) / 1000) + 1;

const hex = (s: string) => Utils.toHex(Utils.toArray(s, 'utf8'));
const n = (x: number | bigint) => x.toLocaleString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txOf = (txid: string) => fetchTx(txid);

export const bsv21 = (id: string, amt: bigint, address: string) =>
  Script.fromASM(
    `OP_0 OP_IF ${hex('ord')} OP_1 ${hex('application/bsv-20')} OP_0 ${hex(JSON.stringify({ p: 'bsv-20', op: 'transfer', id, amt: amt.toString() }))} OP_ENDIF ${new P2PKH().lock(address).toASM()}`,
  );

export type Held = { id: string; sym: string; dec: number; amt: bigint };

/** Tokens at `address` (GorillaPool index, confirmed + pending), largest first. */
export async function tokensAt(address: string): Promise<Held[]> {
  const r = await fetch(`${GP}/bsv20/${address}/balance`, { cache: 'no-store' });
  if (!r.ok) return [];
  const rows = (await r.json()) as { id?: string; tick?: string; sym?: string; dec?: number; all?: { confirmed: string; pending: string } }[];
  return rows
    .filter((t) => t.id)
    .map((t) => ({ id: t.id!, sym: t.sym || t.tick || t.id!.slice(0, 8), dec: t.dec ?? 0, amt: BigInt(t.all?.confirmed ?? '0') + BigInt(t.all?.pending ?? '0') }))
    .filter((t) => t.amt > BigInt(0))
    .sort((a, b) => (b.amt > a.amt ? 1 : -1));
}

async function tokenUtxos(address: string, id: string) {
  const r = await fetch(`${GP}/bsv20/${address}/id/${id}`, { cache: 'no-store' });
  if (!r.ok) return [];
  return ((await r.json()) as { txid: string; vout: number; amt: string; spend: string }[])
    .filter((u) => !u.spend)
    .map((u) => ({ txid: u.txid, vout: u.vout, amt: BigInt(u.amt) }));
}

export const fmt = (amt: bigint, dec: number) => {
  if (!dec) return n(amt);
  const s = amt.toString().padStart(dec + 1, '0');
  return `${n(BigInt(s.slice(0, -dec)))}.${s.slice(-dec).replace(/0+$/, '') || '0'}`;
};

/** Blast every unit of token `t` from the token key, `per` units per bullet. Fees from `fees`. */
export async function blastTokens(o: { tokKey: PrivateKey; fees: PrivateKey; t: Held; per: bigint; feeRate: number }) {
  const { tokKey, fees, t, per, feeRate } = o;
  const tokAddr = tokKey.toAddress(), feeAddr = fees.toAddress();
  const utxos = (await tokenUtxos(tokAddr, t.id)).slice(0, 100);
  const total = utxos.reduce((s, u) => s + u.amt, BigInt(0));
  const bullets = Number(total / per);
  if (bullets < 1) throw new Error(`Not enough $${t.sym} for one bullet of ${fmt(per, t.dec)}.`);
  const lanes = Math.max(1, Math.min(50, Math.ceil(bullets / 200)));
  const quota = (l: number) => Math.floor(bullets / lanes) + (l < bullets % lanes ? 1 : 0);
  const satCoins = (await unspent(feeAddr)).filter((c) => c.value > 1).slice(0, 100);
  const sats = satCoins.reduce((s, c) => s + c.value, 0);
  const need = bullets * bulletSats(feeRate) + lanes * 60 + Math.ceil(((utxos.length + satCoins.length) * 150 + lanes * 140) * feeRate / 1000) + 50;
  if (need > sats) throw new Error(`Fees: ${n(bullets)} bullets need about ${n(need)} sats, the BSV address has ${n(sats)}. Pay ${feeAddr} more, or fire more per bullet.`);

  // prep: all token coins + fee coins in; per lane a token coin and a fee coin out
  const prep = new Transaction();
  for (const u of utxos) prep.addInput({ sourceTransaction: await txOf(u.txid), sourceOutputIndex: u.vout, unlockingScriptTemplate: new P2PKH().unlock(tokKey) });
  for (const c of satCoins) prep.addInput({ sourceTransaction: await txOf(c.tx_hash), sourceOutputIndex: c.tx_pos, unlockingScriptTemplate: new P2PKH().unlock(fees) });
  const laneAmt = Array.from({ length: lanes }, (_, l) => per * BigInt(quota(l)));
  laneAmt[lanes - 1] += total - laneAmt.reduce((s, a) => s + a, BigInt(0));   // the remainder (< per) rides in the last lane
  for (let l = 0; l < lanes; l++) prep.addOutput({ lockingScript: bsv21(t.id, laneAmt[l], tokAddr), satoshis: 1 });
  for (let l = 0; l < lanes; l++) prep.addOutput({ lockingScript: new P2PKH().lock(feeAddr), satoshis: quota(l) * bulletSats(feeRate) + 60 });
  prep.addOutput({ lockingScript: new P2PKH().lock(feeAddr), change: true });
  await prep.fee(new SatoshisPerKilobyte(feeRate));
  await prep.sign();

  const arc = new ARC(ARC_URL);
  const send = async (tx: Transaction) => {
    for (let attempt = 0; ; attempt++) {
      const r = await tx.broadcast(arc);
      if (r.status === 'success' || /invalid competing transaction identifiers/i.test((r as { description?: string }).description ?? '')) return;
      if (attempt >= 3) throw new Error(JSON.stringify(r));
      await sleep(500 * 2 ** attempt);
    }
  };
  await send(prep);
  console.log(`${red('▶')} loaded   ${prep.id('hex')}  ${dim(`${lanes} lane${lanes > 1 ? 's' : ''}`)}\n`);

  let sent = 0, spentSats = 0, burned = BigInt(0), stopped = 0;
  const started = Date.now();
  const draw = () => {
    const secs = Math.max(0.1, (Date.now() - started) / 1000), w = 30, done = Math.round((sent / bullets) * w);
    process.stdout.write(`\r${red('█'.repeat(done))}${dim('░'.repeat(w - done))} ${n(sent)} / ${n(bullets)}  ${(sent / secs).toFixed(0)}/s  ${fmt(burned, t.dec)} $${t.sym} blasted  ${n(spentSats)} sats ${stopped ? red(` ${stopped} lanes stopped`) : ''}  `);
  };
  const tick = setInterval(draw, 250);

  await Promise.all(
    Array.from({ length: lanes }, async (_, l) => {
      let tok = { tx: prep, vout: l, amt: laneAmt[l] };
      let fee = { tx: prep, vout: lanes + l };
      for (let i = 1; i <= quota(l) && tok.amt >= per; i++) {
        const rest = tok.amt - per;
        const tx = new Transaction();
        tx.addInput({ sourceTransaction: tok.tx, sourceOutputIndex: tok.vout, unlockingScriptTemplate: new P2PKH().unlock(tokKey) });
        tx.addInput({ sourceTransaction: fee.tx, sourceOutputIndex: fee.vout, unlockingScriptTemplate: new P2PKH().unlock(fees) });
        tx.addOutput({ lockingScript: bsv21(t.id, per, BURN_ADDRESS), satoshis: 1 });
        if (rest > BigInt(0)) tx.addOutput({ lockingScript: bsv21(t.id, rest, tokAddr), satoshis: 1 });
        tx.addOutput({ lockingScript: Script.fromASM(`OP_FALSE OP_RETURN ${[TAG, t.id, `${l}:${i}`, 'cli'].map(hex).join(' ')}`), satoshis: 0 });
        tx.addOutput({ lockingScript: new P2PKH().lock(feeAddr), change: true });
        await tx.fee(new SatoshisPerKilobyte(feeRate));
        await tx.sign();
        try { await send(tx); } catch (e) {
          stopped++;
          console.error(`\n${red('✖')} lane ${l} stopped at ${i}: ${(e as Error).message.slice(0, 200)}`);
          return;
        }
        sent++; spentSats += tx.getFee() + 1; burned += per;
        const changeVout = tx.outputs.length - 1;
        if (tok.tx !== prep) { tx.inputs[0].sourceTXID = tok.tx.id('hex'); tx.inputs[0].sourceTransaction = undefined; }
        if (fee.tx !== prep && fee.tx !== tok.tx) { tx.inputs[1].sourceTXID = fee.tx.id('hex'); tx.inputs[1].sourceTransaction = undefined; }
        tok = { tx, vout: 1, amt: rest };
        fee = { tx, vout: changeVout };
        if (rest <= BigInt(0)) break;
      }
    }),
  );
  clearInterval(tick);
  draw();
  const secs = (Date.now() - started) / 1000;
  console.log(`\n\n${red('▶')} blasted ${n(sent)} token bullets in ${secs.toFixed(1)}s: ${fmt(burned, t.dec)} $${t.sym} to the burn address, ${n(spentSats)} sats in fees${stopped ? red(`, ${stopped} lane(s) stopped early`) : ''}\n`);
}
