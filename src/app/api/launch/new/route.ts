/**
 * Launch a coin, in two steps:
 *   prepare: pick a slot, derive the coin's pool/reserve/vault addresses, return the message to sign
 *   commit:  the creator signed the message and their wallet broadcast the launch tx
 *            ([0] image inscription → creator, [1] deploy+mint 1B → token pool, [2] launch fee → house).
 *            Check both, then the coin goes live.
 */
import { NextResponse } from 'next/server';
import { Beef, ProtoWallet, Transaction, Utils } from '@bsv/sdk';
import { LAUNCH_FEE, SUPPLY } from '@/lib/launch/curve';
import { bsv20Json, launchMessage, p2pkh, validRoute } from '@/lib/launch/shape';
import { HOUSE, broadcast, compactBeef, configured, poolAddress, rpc } from '@/lib/launch/server';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isAddr = (a: unknown): a is string => typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);

function fields(b: Record<string, unknown>) {
  const sym = String(b.sym ?? '').toUpperCase().replace(/^\$/, '');
  const name = String(b.name ?? '').trim();
  const description = String(b.description ?? '').trim();
  const route = validRoute(b.route);
  if (!/^[A-Z0-9]{2,12}$/.test(sym)) throw new Error('Ticker: 2 to 12 letters or digits.');
  if (!name || name.length > 40) throw new Error('Name: 1 to 40 characters.');
  if (description.length > 400) throw new Error('Description: up to 400 characters.');
  if (!route) throw new Error('Pick where the 0.30% goes (fee sharing needs 2 to 10 wallets adding up to 100%).');
  if (!isAddr(b.creator) || typeof b.creatorKey !== 'string' || !/^0[23][0-9a-f]{64}$/.test(b.creatorKey)) throw new Error('Connect your wallet first.');
  if (typeof b.imageSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.imageSha256)) throw new Error('Add an image.');
  return { sym, name, description, route, creator: b.creator, creatorKey: b.creatorKey, imageSha256: b.imageSha256 };
}

export async function POST(req: Request) {
  if (!configured()) return bad('The launchpad is not open yet.', 503);
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }
  try {
    const f = fields(b);
    if (b.step === 'prepare') {
      const slot = crypto.randomUUID();
      const addrs = { tokenAddress: poolAddress(slot, 'token'), reserveAddress: poolAddress(slot, 'reserve'), vaultAddress: poolAddress(slot, 'vault') };
      const message = launchMessage({ slot, ...f, ...addrs });
      return NextResponse.json({ slot, ...addrs, message, house: HOUSE, launchFee: LAUNCH_FEE });
    }
    if (b.step === 'commit') {
      const slot = String(b.slot ?? '');
      if (!/^[0-9a-f-]{36}$/.test(slot)) throw new Error('Bad slot.');
      const addrs = { tokenAddress: poolAddress(slot, 'token'), reserveAddress: poolAddress(slot, 'reserve'), vaultAddress: poolAddress(slot, 'vault') };
      const message = launchMessage({ slot, ...f, ...addrs });
      const sig = String(b.signature ?? '');
      const { valid } = await new ProtoWallet('anyone')
        .verifySignature({ data: Utils.toArray(message, 'utf8'), signature: Utils.toArray(sig, 'hex'), protocolID: [1, 'tokenblaster launch'], keyID: slot, counterparty: f.creatorKey })
        .catch(() => ({ valid: false }));
      if (!valid) throw new Error('The launch signature does not match.');

      const bytes = Array.from(Buffer.from(String(b.tx ?? ''), 'hex'));
      const tx = Transaction.fromAtomicBEEF(bytes);
      const deploy = tx.outputs[1];
      const j = deploy ? bsv20Json(deploy.lockingScript.toHex()) : null;
      if (!j || j.op !== 'deploy+mint' || j.amt !== SUPPLY.toString() || (j.sym ?? '').toUpperCase() !== f.sym) throw new Error('Output 1 is not this coin’s deploy.');
      if (!deploy.lockingScript.toHex().endsWith(p2pkh(addrs.tokenAddress))) throw new Error('The supply does not go to the coin’s pool.');
      const fee = tx.outputs[2];
      if (!fee || fee.lockingScript.toHex() !== p2pkh(HOUSE) || (fee.satoshis ?? 0) < LAUNCH_FEE) throw new Error('The launch fee is missing.');
      await broadcast(tx); // the wallet normally sent it already; this is idempotent
      const txid = tx.id('hex');

      await rpc('tokenblaster_launch_create', {
        p_row: {
          slot,
          sym: f.sym,
          name: f.name,
          description: f.description,
          image_type: String(b.imageType ?? 'image/webp'),
          creator: f.creator,
          creator_key: f.creatorKey,
          route: f.route,
          launch_msg: message,
          launch_sig: sig,
          token_address: addrs.tokenAddress,
          reserve_address: addrs.reserveAddress,
          vault_address: addrs.vaultAddress,
        },
      });
      const beef = Beef.fromBinary(bytes);
      // The launch output itself needs indexing: 3,000 sats owed to its fund, paid by the first trades.
      await rpc('tokenblaster_launch_go_live', { p_slot: slot, p_txid: txid, p_beef: await compactBeef(beef.toHex(), [txid]), p_fund_owed: 3000 });
      return NextResponse.json({ token: `${txid}_1`, txid });
    }
    return bad('Unknown step.');
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
}
