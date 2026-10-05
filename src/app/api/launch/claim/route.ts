/**
 * Holder rewards. GET ?address= → what the wallet is owed per coin, and the key payouts come from.
 * POST: the wallet proves it is `address` (BRC-3 signature by its identity key) and names a fresh
 * BRC-29 address of its own; the vaults pay everything owed there in one transaction, and the
 * browser hands it to the wallet as a payment (internalizeAction), so it shows up straight away.
 */
import { NextResponse } from 'next/server';
import { Beef, ProtoWallet, PublicKey, Transaction, Utils, P2PKH, SatoshisPerKilobyte } from '@bsv/sdk';
import { broadcast, configured, poolKey, rpc } from '@/lib/launch/server';
import { confirmedUtxos } from '@/lib/launch/vault';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isAddr = (a: unknown): a is string => typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);
const senderKey = () => poolKey('claims', 'vault').toPublicKey().toString();

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address');
  if (!isAddr(address)) return bad('Bad address.');
  try {
    const owed = await rpc<{ slot: string; token_id: string; sym: string; sats: number }[]>('tokenblaster_launch_owed_to', { p_address: address }, false);
    return NextResponse.json({ owed, sender: configured() ? senderKey() : null });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: Request) {
  if (!configured()) return bad('Not open yet.', 503);
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }
  try {
    const { address, identityKey, signature, ts, payTo } = b as Record<string, string>;
    if (!isAddr(address) || !isAddr(payTo) || !/^0[23][0-9a-f]{64}$/.test(identityKey ?? '')) return bad('Bad claim.');
    if (PublicKey.fromString(identityKey).toAddress() !== address) return bad('That key is not this wallet.');
    if (!(Math.abs(Date.now() - Number(ts)) < 5 * 60_000)) return bad('Claim expired; try again.');
    const message = `TokenBlaster claim\n${address}\npay to ${payTo}\n${ts}`;
    const { valid } = await new ProtoWallet('anyone')
      .verifySignature({ data: Utils.toArray(message, 'utf8'), signature: Utils.toArray(signature, 'hex'), protocolID: [1, 'tokenblaster claim'], keyID: String(ts), counterparty: identityKey })
      .catch(() => ({ valid: false }));
    if (!valid) return bad('Signature does not match.');

    const rows = await rpc<{ id: number; slot: string; sats: number }[]>('tokenblaster_launch_owed_rows', { p_address: address });
    if (!rows.length) return bad('Nothing to claim.');
    const bySlot = new Map<string, number>();
    for (const r of rows) bySlot.set(r.slot, (bySlot.get(r.slot) ?? 0) + Number(r.sats));
    const total = [...bySlot.values()].reduce((n, s) => n + s, 0);
    if (total < 1_000) return bad('Rewards are paid out from 1,000 sats.');

    // Take from each vault exactly what it owes this wallet; change goes back to that vault.
    const tx = new Transaction();
    for (const [slot, sats] of bySlot) {
      const [row] = await rpc<{ vault_address: string }[]>('tokenblaster_launch_get', { p_slot: slot });
      const key = poolKey(slot, 'vault');
      const utxos = await confirmedUtxos(row.vault_address);
      let got = 0;
      for (const u of utxos) {
        if (got >= sats + 200) break;
        tx.addInput({ sourceTransaction: u.tx, sourceOutputIndex: u.vout, unlockingScriptTemplate: new P2PKH().unlock(key) });
        got += u.sats;
      }
      if (got < sats) return bad('A vault is waiting for a block before it can pay; try again in a few minutes.');
      if (got - sats > 0) tx.addOutput({ lockingScript: new P2PKH().lock(row.vault_address), satoshis: got - sats });
    }
    // The network fee comes out of the payout.
    tx.addOutput({ lockingScript: new P2PKH().lock(payTo), change: true });
    await tx.fee(new SatoshisPerKilobyte(100));
    await tx.sign();
    const payIdx = tx.outputs.length - 1;
    // change:true takes the leftover; we must make sure the payout output got exactly `total` minus the fee.
    const paid = tx.outputs[payIdx].satoshis ?? 0;
    if (paid <= 0) return bad('Too small to pay out after the network fee.');
    const txid = await broadcast(tx);
    await rpc('tokenblaster_launch_mark_claimed', { p_address: address, p_ids: rows.map((r) => r.id), p_txid: txid });
    for (const [slot, sats] of bySlot) await rpc('tokenblaster_launch_payout', { p_txid: txid, p_slot: slot, p_kind: 'claim', p_sats: sats, p_tokens: 0, p_detail: { to: address } });
    // The wallet wants the payout with its proven history (BEEF): the vault coins are all confirmed.
    const beef = new Beef();
    for (const src of new Set(tx.inputs.map((i) => i.sourceTransaction!.id('hex')))) {
      const r = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${src}/beef`, { cache: 'no-store' });
      if (r.ok) beef.mergeBeef(Beef.fromString((await r.text()).trim(), 'hex'));
    }
    beef.mergeTransaction(tx);
    return NextResponse.json({ txid, beef: Utils.toHex(beef.toBinaryAtomic(txid)), outputIndex: payIdx, sats: paid, sender: senderKey() });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}
