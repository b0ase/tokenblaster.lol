/**
 * Holder rewards. GET ?address= → what the wallet is owed per coin, and the key payouts come from.
 * POST: the wallet proves it is `address` (BRC-3 signature by its identity key) and names a fresh
 * BRC-29 address of its own; the vaults pay everything owed there in one transaction, and the
 * browser hands it to the wallet as a payment (internalizeAction), so it shows up straight away.
 */
import { NextResponse } from 'next/server';
import { Beef, ProtoWallet, PublicKey, Utils } from '@bsv/sdk';
import { broadcast, configured, launchSigningOff, poolKey, poolPublicKey, rpc, spentBy } from '@/lib/launch/server';
import { confirmedUtxos } from '@/lib/launch/vault';
import { RateLimiter, caps, clientIp } from '@/lib/launch/guard';
import { claimSignatureUsed, vaultOutflowToday } from '@/lib/launch/limits';
import { runClaim } from '@/lib/launch/claimFlow';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isAddr = (a: unknown): a is string => typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);
const senderKey = () => poolPublicKey('claims', 'vault');
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const LEASE_SECS = 60;
// Per warm instance: 10 claim attempts / 10 min per IP, 5 per address.
const limiter = new RateLimiter();
const usedSigs = new Set<string>();

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
  if (launchSigningOff()) return bad('Reward payouts are paused for maintenance. Your rewards are safe.', 503);
  if (!limiter.allow(`ip:${clientIp(req)}`, 10, 10 * 60_000)) return bad('Too many claims. Wait a few minutes.', 429);
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
    if (!limiter.allow(`addr:${address}`, 5, 10 * 60_000)) return bad('Too many claims for this wallet. Wait a few minutes.', 429);
    const message = `TokenBlaster claim\n${address}\npay to ${payTo}\n${ts}`;
    const { valid } = await new ProtoWallet('anyone')
      .verifySignature({ data: Utils.toArray(message, 'utf8'), signature: Utils.toArray(signature, 'hex'), protocolID: [1, 'tokenblaster claim'], keyID: String(ts), counterparty: identityKey })
      .catch(() => ({ valid: false }));
    if (!valid) return bad('Signature does not match.');
    const sigKey = `${address}:${ts}`;
    if (usedSigs.has(sigKey)) return bad('This claim signature was already used. Sign a new claim.', 409);

    const r = await runClaim(
      { address, payTo, ts: String(ts) },
      {
        signatureUsed: claimSignatureUsed,
        owedRows: (addr) => rpc('tokenblaster_launch_owed_rows', { p_address: addr }),
        coin: async (slot) => (await rpc<{ token_id: string; vault_address: string }[]>('tokenblaster_launch_get', { p_slot: slot }))[0] ?? null,
        lease: async (tokenId, lease) => (await rpc<unknown[]>('tokenblaster_launch_lease', { p_token: tokenId, p_lease: lease, p_secs: LEASE_SECS })).length > 0,
        release: (lease) => rpc('tokenblaster_launch_release', { p_lease: lease }),
        utxos: (addr) => confirmedUtxos(addr),
        vaultKey: (slot) => poolKey(slot, 'vault'),
        markClaimed: (addr, ids, txid) => rpc('tokenblaster_launch_mark_claimed', { p_address: addr, p_ids: ids, p_txid: txid }),
        reowe: (slot, addr, sats) => rpc('tokenblaster_launch_owe', { p_slot: slot, p_rows: [{ address: addr, sats }] }),
        broadcast,
        spentBy,
        txKnown: (txid) => fetch(`${WOC}/tx/hash/${txid}`, { cache: 'no-store' }).then((x) => x.ok),
        payout: (txid, slot, sats, detail) => rpc('tokenblaster_launch_payout', { p_txid: txid, p_slot: slot, p_kind: 'claim', p_sats: sats, p_tokens: 0, p_detail: detail }),
        vaultOutflowToday: () => vaultOutflowToday(),
        vaultCap: caps().vaultSats,
        newLease: () => crypto.randomUUID(),
      },
    );
    if (!r.ok) return bad(r.why, r.status);
    usedSigs.add(sigKey); // single-use (also recorded on the payout rows for other instances)
    if (usedSigs.size > 10_000) usedSigs.clear();
    const { txid, tx, outputIndex, sats } = r;
    // The wallet wants the payout with its proven history (BEEF): the vault coins are all confirmed.
    const beef = new Beef();
    for (const src of new Set(tx.inputs.map((i) => i.sourceTransaction!.id('hex')))) {
      const x = await fetch(`${WOC}/tx/${src}/beef`, { cache: 'no-store' });
      if (x.ok) beef.mergeBeef(Beef.fromString((await x.text()).trim(), 'hex'));
    }
    beef.mergeTransaction(tx);
    return NextResponse.json({ txid, beef: Utils.toHex(beef.toBinaryAtomic(txid)), outputIndex, sats, sender: senderKey() });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}
