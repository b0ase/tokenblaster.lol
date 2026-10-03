/**
 * bWallet connection. bWallet (our Yours Wallet Mobile fork) opens apps in its in-app browser,
 * adds `bWallet/` to the user agent and injects a BRC-100 wallet as `window.CWI`. The Yours v5
 * browser extension injects the same thing on desktop. Which wallet to use is the player's
 * choice (src/lib/discovery.ts, docs/wallet-connect.md).
 */
import { P2PKH, PublicKey, Transaction, type WalletInterface } from '@bsv/sdk';
import type { WalletEntry } from './discovery';

export type Wallet = { client: WalletInterface; address: string; publicKey: string; id: string; name: string };

export const hasCwi = () => typeof window !== 'undefined' && Boolean((window as { CWI?: unknown }).CWI);
export const inBwallet = () =>
  typeof navigator !== 'undefined' && /(?:bWallet|YoursWalletMobile)\//.test(navigator.userAgent) && hasCwi();

/** Connect the wallet the player picked in the chooser. */
export async function connect(entry: WalletEntry): Promise<Wallet> {
  try {
    const { publicKey } = await entry.wallet.getPublicKey({ identityKey: true });
    return { client: entry.wallet, publicKey, address: PublicKey.fromString(publicKey).toAddress(), id: entry.id, name: entry.name };
  } catch (e) {
    // A locked wallet refuses getPublicKey: that means "unlock me", not "not installed".
    throw new Error(`${entry.name} did not answer: ${e instanceof Error ? e.message : e}. Unlock it and try again.`);
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
