/**
 * Server side of the launchpad: the pool keys, the ledger (Supabase RPC behind LAUNCH_SECRET),
 * signing the pool's inputs and broadcasting. Server only: never import from a client component.
 *
 * Every coin has three keys, derived from LAUNCH_POOL_WIF (env only, never in code) with BRC-42:
 * its token pool, its BSV reserve and its fee vault. That is custody, and the coin page says so.
 */
import 'server-only';
import { ARC, Beef, P2PKH, PrivateKey, Transaction } from '@bsv/sdk';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.LAUNCH_SECRET;
const WIF = process.env.LAUNCH_POOL_WIF;
export const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS ?? '';
const ARC_URL = 'https://arc.gorillapool.io';
const GP = 'https://ordinals.gorillapool.io/api';
const WOC = 'https://api.whatsonchain.com/v1/bsv/main';

export const configured = () => Boolean(URL_ && ANON && SECRET && WIF && /^1/.test(HOUSE));

export async function rpc<T>(fn: string, args: Record<string, unknown>, secret = true): Promise<T> {
  if (!URL_ || !ANON) throw new Error('Launchpad database is not configured.');
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(secret ? { p_secret: SECRET, ...args } : args),
    cache: 'no-store',
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ledger ${fn}: ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export type CoinRow = {
  slot: string;
  token_id: string | null;
  sym: string;
  name: string;
  description: string;
  creator: string;
  creator_key: string;
  route: { kind: string; address?: string; to?: { address: string; bps: number }[] };
  token_address: string;
  reserve_address: string;
  vault_address: string;
  fund_address: string | null;
  fund_owed: number;
  burned?: number;
  status: string;
  sold: number;
  reserve_sats: number;
  token_utxo: string | null;
  token_amt: number;
  reserve_utxo: string | null;
  beef: string | null;
  lease_id: string | null;
  lease_until: string | null;
  lease_quote: Record<string, unknown> | null;
};

const root = () => {
  if (!WIF) throw new Error('LAUNCH_POOL_WIF is not set.');
  return PrivateKey.fromWif(WIF);
};
export type Role = 'token' | 'reserve' | 'vault' | 'index';
export function poolKey(slot: string, role: Role): PrivateKey {
  const r = root();
  return r.deriveChild(r.toPublicKey(), `tokenblaster launch ${slot} ${role}`);
}
export const poolAddress = (slot: string, role: Role) => poolKey(slot, role).toAddress();

/** Sign input `i` of `tx` (P2PKH, SIGHASH_ALL|FORKID) with `key`; returns the unlocking script hex. */
export async function signInput(tx: Transaction, i: number, key: PrivateKey, source: Transaction): Promise<string> {
  const input = tx.inputs[i];
  input.sourceTransaction = source;
  const unlock = new P2PKH().unlock(key);
  const script = await unlock.sign(tx, i);
  return script.toHex();
}

/** Broadcast to GorillaPool ARC (and WhatsOnChain as a backup). Throws with ARC's reason. */
export async function broadcast(tx: Transaction): Promise<string> {
  const txid = tx.id('hex');
  const r = await tx.broadcast(new ARC(ARC_URL));
  const ok =
    (r.status === 'success' && !/ORPHAN|REJECT|DOUBLE/i.test((r as { txStatus?: string }).txStatus ?? '')) ||
    /invalid competing transaction identifiers|already known|ALREADY_IN_MEMPOOL|SEEN_ON_NETWORK|MINED/i.test(JSON.stringify(r));
  if (!ok) {
    // Already in the mempool via the wallet is fine.
    const seen = await fetch(`${WOC}/tx/hash/${txid}`).then((x) => x.ok).catch(() => false);
    if (!seen) throw new Error(`The network refused the trade: ${(r as { description?: string }).description ?? JSON.stringify(r).slice(0, 200)}`);
  }
  fetch(`${WOC}/tx/raw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: tx.toHex() }) }).catch(() => undefined);
  return txid;
}

/** The token's GorillaPool indexer fund address (known once the indexer has seen the deploy). */
export async function fundAddressOf(tokenId: string): Promise<string | null> {
  const r = await fetch(`${GP}/bsv20/id/${tokenId}`, { cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json()) as { fundAddress?: string };
  return j.fundAddress ?? null;
}

/** Is this token coin valid in the BSV-21 index, and how many tokens of `id` does it hold? */
export async function indexedTokenAmt(outpoint: string, id: string): Promise<bigint | null> {
  // /txos says who owns the coin and which token it claims, but never its validation status;
  // the owner's token list does (status 1 = valid, 0 = pending, -1 = invalid).
  const r = await fetch(`${GP}/txos/${outpoint}?script=false`, { cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json()) as { owner?: string; data?: { bsv20?: { id?: string } } };
  if (!j.owner || j.data?.bsv20?.id !== id) return null;
  const list = await fetch(`${GP}/bsv20/${j.owner}/id/${id}`, { cache: 'no-store' })
    .then((x) => (x.ok ? (x.json() as Promise<{ outpoint: string; amt: string | number; status: number }[]>) : null))
    .catch(() => null);
  const coin = list?.find((c) => c.outpoint === outpoint);
  if (!coin || coin.status !== 1) return null; // pending or invalid
  return BigInt(coin.amt);
}

/**
 * Keep a pool's BEEF small: once its latest transactions are mined, replace the stored history
 * with WhatsOnChain's proven BEEF for them.
 */
export async function compactBeef(beefHex: string, txids: string[]): Promise<string> {
  try {
    const fresh = new Beef();
    for (const t of new Set(txids)) {
      const r = await fetch(`${WOC}/tx/${t}/beef`, { cache: 'no-store' });
      if (!r.ok) return beefHex;
      fresh.mergeBeef(Beef.fromString((await r.text()).trim(), 'hex'));
    }
    return fresh.toHex();
  } catch {
    return beefHex;
  }
}

/** Which tx spent this outpoint, if WhatsOnChain knows. */
export async function spentBy(outpoint: string): Promise<string | null> {
  const [txid, vout] = outpoint.split('_');
  const r = await fetch(`${WOC}/tx/${txid}/${vout}/spent`, { cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { txid?: string } | null;
  return j?.txid ?? null;
}
