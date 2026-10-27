/**
 * Escape from TERRORNODE revenue split (owner, 27 Oct 2026): every sat of TERRORNODE revenue (the $TERRORNODE
 * receipt money and the platform fee on its rounds) is paid 50/50 to NPG Ltd and The Bitcoin Corporation, as two
 * outputs in the same tx. An odd sat goes to bCorp. Other TokenBlaster games and coins are unchanged.
 *
 * Destinations are never hardcoded. Each payment uses a one-time BRC-29 P2P destination from the companies'
 * paymail server (bwalletx.com bsvalias → pay.bwallet.space), resolved server-side (src/lib/launch/payees.ts) and
 * PINNED: the paymail's identity key must equal the key below, and the script must re-derive from that key with
 * the returned derivation prefix/suffix (sender = the "anyone" key, private key 1). So nobody, the paymail server
 * included, can swap in a destination that isn't the company's. Pure: shared by the browser, server and tests.
 */
import { KeyDeriver, P2PKH, PrivateKey, type Transaction } from '@bsv/sdk';

export type PayeeId = 'npg' | 'bcorp';
export type Payee = { id: PayeeId; name: string; paymail: string; alias: string; identityKey: string };

export const PAYEES: readonly Payee[] = [
  { id: 'npg', name: 'NPG Ltd', paymail: 'npg@bwalletx.com', alias: 'npg', identityKey: '026607f69e27c84eb19bfbc430575c46abec2a587712eac91b3b3f58e7f262b59b' },
  { id: 'bcorp', name: 'bCorp', paymail: 'bcorp@bwalletx.com', alias: 'bcorp', identityKey: '03c96b37e69377c8af33b583067f56444c83a656b05014e8f15003e67250943880' },
] as const;
export const payeeOf = (id: PayeeId) => PAYEES.find((p) => p.id === id)!;
/** What the cabinet shows next to the cost. */
export const SPLIT_LINE = '→ NPG Ltd 50% · bCorp 50%';

/** 50/50, whole sats; the odd sat goes to bCorp. */
export function splitSats(total: number | bigint): { npg: number; bcorp: number } {
  const t = Math.max(0, Math.floor(Number(total)));
  const npg = Math.floor(t / 2);
  return { npg, bcorp: t - npg };
}

/** One resolved destination: where to pay, plus what the paymail server needs to credit the company's wallet. */
export type SplitDest = { payee: PayeeId; address: string; prefix: string; suffix: string; reference: string };
export type SplitQuote = { npg: SplitDest; bcorp: SplitDest };

const BRC29: [2, string] = [2, '3241645161d8'];
const anyone = new KeyDeriver(new PrivateKey(1));
const b64 = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9+/]{4,64}={0,2}$/.test(s);

/** The address `identityKey` receives at for this BRC-29 derivation (sender = anyone). */
export function derivedAddress(identityKey: string, prefix: string, suffix: string): string {
  return anyone.derivePublicKey(BRC29, `${prefix} ${suffix}`, identityKey, false).toAddress();
}

/** Is `d` a destination of its pinned payee? Re-derives the address from the pinned key; never trusts `d.address`. */
export function pinned(d: unknown, payee: PayeeId): d is SplitDest {
  const x = d as Partial<SplitDest> | null;
  if (!x || x.payee !== payee || !b64(x.prefix) || !b64(x.suffix) || typeof x.address !== 'string') return false;
  if (typeof x.reference !== 'string' || !/^[0-9a-f]{8,64}$/.test(x.reference)) return false;
  try {
    return derivedAddress(payeeOf(payee).identityKey, x.prefix, x.suffix) === x.address;
  } catch {
    return false;
  }
}
export const pinnedQuote = (q: unknown): q is SplitQuote => {
  const x = q as Partial<SplitQuote> | null;
  return !!x && pinned(x.npg, 'npg') && pinned(x.bcorp, 'bcorp') && x.npg!.address !== x.bcorp!.address;
};

/** The two outputs that pay `total` sats of TERRORNODE revenue (a zero half is left out). */
export function splitOutputs(q: SplitQuote, total: number): { address: string; sats: number }[] {
  const s = splitSats(total);
  return [
    { address: q.npg.address, sats: s.npg },
    { address: q.bcorp.address, sats: s.bcorp },
  ].filter((o) => o.sats > 0);
}

/**
 * What `tx` paid to the quoted split. ok only when both halves are there and the amounts are exactly 50/50 of
 * their sum (odd sat to bCorp); `paid` is that sum. Any other split, a missing half, or a destination that isn't
 * pinned is refused.
 */
export function readSplit(tx: Transaction, q: unknown): { ok: true; paid: bigint; npg: number; bcorp: number } | { ok: false; why: string } {
  if (!pinnedQuote(q)) return { ok: false, why: 'The revenue destinations are not NPG Ltd and bCorp.' };
  const sum = (addr: string) => {
    const lock = new P2PKH().lock(addr).toHex();
    return tx.outputs.reduce((n, o) => (o.lockingScript.toHex() === lock ? n + Number(o.satoshis ?? 0) : n), 0);
  };
  const npg = sum(q.npg.address);
  const bcorp = sum(q.bcorp.address);
  const want = splitSats(npg + bcorp);
  if (npg + bcorp <= 0) return { ok: false, why: 'The transaction pays nothing to NPG Ltd or bCorp.' };
  if (npg !== want.npg || bcorp !== want.bcorp) return { ok: false, why: `The split is not 50/50 (NPG ${npg}, bCorp ${bcorp} sats).` };
  return { ok: true, paid: BigInt(npg + bcorp), npg, bcorp };
}
