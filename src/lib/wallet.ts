/**
 * bWallet connection. bWallet (our Yours Wallet Mobile fork) opens apps in its in-app browser,
 * adds `bWallet/` to the user agent and injects a BRC-100 wallet as `window.CWI`. The Yours v5
 * browser extension injects the same thing on desktop, so one path covers both.
 * Same flow as bmovies-app's src/lib/brc100.ts.
 */
import { P2PKH, PublicKey, Transaction, WalletClient } from '@bsv/sdk';

export type Wallet = { client: WalletClient; address: string; publicKey: string };

export const hasCwi = () => typeof window !== 'undefined' && Boolean((window as { CWI?: unknown }).CWI);
export const inBwallet = () =>
  typeof navigator !== 'undefined' && /(?:bWallet|YoursWalletMobile)\//.test(navigator.userAgent) && hasCwi();

export async function connect(): Promise<Wallet> {
  if (!hasCwi()) throw new Error('No wallet found. Open TokenBlaster.lol from the Apps tab in bWallet.');
  const client = new WalletClient('window.CWI');
  try {
    const { publicKey } = await client.getPublicKey({ identityKey: true });
    return { client, publicKey, address: PublicKey.fromString(publicKey).toAddress() };
  } catch (e) {
    // A locked wallet refuses getPublicKey: that means "unlock me", not "not installed".
    throw new Error(`bWallet did not answer: ${e instanceof Error ? e.message : e}. Unlock it and try again.`);
  }
}

/** Pay `sats` to `address` in one approval. Returns the funding transaction (with its proofs). */
export async function fund(w: Wallet, address: string, sats: number, description: string): Promise<Transaction> {
  const r = await w.client.createAction({
    description,
    outputs: [{ lockingScript: new P2PKH().lock(address).toHex(), satoshis: sats, outputDescription: description }],
    labels: ['tokenblaster'],
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  });
  if (!r.tx) throw new Error('bWallet returned no transaction.');
  return Transaction.fromAtomicBEEF(r.tx);
}
