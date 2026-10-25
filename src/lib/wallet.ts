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

/**
 * One wallet request at a time (bWalletX, 24 Oct 2026): a different request sent while a sheet is open joins it as
 * an unticked "risky" line, and "I trust it, allow" then DENIES it, leaving the site looking disconnected. So every
 * call to a wallet goes through one queue per wallet object.
 */
const queues = new WeakMap<object, { tail: Promise<unknown>; inFlight: number }>();

/**
 * PLAY GUARD (owner playtest, 25 Oct 2026: wallet sheets kept opening mid-fire). While a paid round is live the
 * gun signs every bullet with its own in-browser key, so nothing may ask the wallet anything: any call through a
 * connected wallet is refused here, before it reaches the extension, and a dev-console warning names the caller.
 */
const holds = new Set<string>();
let playHeld = false;
export const WALLET_HELD = 'WALLET_HELD_DURING_PLAY';
/** `key` names who holds it (a page's round, a storm session): the wallet is free again only when every holder lets go. */
export const holdWalletForPlay = (on: boolean, key = 'play') => {
  if (on) holds.add(key);
  else holds.delete(key);
  playHeld = holds.size > 0;
};
export const walletHeld = () => playHeld;
export const walletBusy = (client: object) => (queues.get(client)?.inFlight ?? 0) > 0;
export function serialised(client: WalletInterface): WalletInterface {
  const q = queues.get(client) ?? { tail: Promise.resolve(), inFlight: 0 };
  queues.set(client, q);
  const proxy: WalletInterface = new Proxy(client, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        if (playHeld) {
          if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_TB_ADMIN === '1')
            console.warn(`[tokenblaster] wallet.${String(prop)} refused: a round is live (no wallet prompts during play)`, new Error().stack);
          return Promise.reject(new Error(WALLET_HELD));
        }
        q.inFlight++;
        const run = q.tail.then(() => (v as (...a: unknown[]) => unknown).apply(target, args));
        q.tail = run.catch(() => undefined).finally(() => q.inFlight--);
        return run;
      };
    },
  });
  queues.set(proxy, q);
  return proxy;
}

/** Connect the wallet the player picked in the chooser. */
export async function connect(entry: WalletEntry): Promise<Wallet> {
  const client = serialised(entry.wallet);
  try {
    const { publicKey } = await client.getPublicKey({ identityKey: true });
    return { client, publicKey, address: PublicKey.fromString(publicKey).toAddress(), id: entry.id, name: entry.name };
  } catch (e) {
    // A locked wallet refuses getPublicKey: that means "unlock me", not "not installed".
    throw new Error(`${entry.name} did not answer: ${e instanceof Error ? e.message : e}. Unlock it and try again.`);
  }
}

/** Pay `sats` to `address` in one approval. Returns the funding transaction (with its proofs). */
// Only one payment request may be open in the wallet at a time (a second createAction while one is pending
// can wedge an extension wallet's prompt queue).
let paying: Promise<unknown> | null = null;
export async function fund(w: Wallet, address: string, sats: number, description: string): Promise<Transaction> {
  if (paying) throw new Error('A payment is already waiting in your wallet. Approve or cancel it first.');
  const req = w.client.createAction({
    description,
    outputs: [{ lockingScript: new P2PKH().lock(address).toHex(), satoshis: sats, outputDescription: description }],
    // No labels: a BRC-100 wallet asks permission for every new label, an extra sheet before the payment (playtest 25 Oct).
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  });
  paying = req;
  let r: Awaited<typeof req>;
  try {
    r = await req;
  } finally {
    paying = null;
  }
  if (!r.tx) throw new Error('bWallet returned no transaction.');
  return Transaction.fromAtomicBEEF(r.tx);
}

/** Rejects with `msg` if `p` has not settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((ok, no) => {
    const t = setTimeout(() => no(new Error(msg)), ms);
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      (e) => (clearTimeout(t), no(e)),
    );
  });
}

/**
 * Is the wallet connection live? Asks `isAuthenticated` (a status check: it never opens a sheet), with a timeout.
 * Never `getPublicKey({ identityKey })`: in bWalletX that is the connect request, and after a Disconnect or a quiet
 * day it opens "Reconnect to <site>?" (playtest 25 Oct: read as "sign in to localhost" mid-play). Called only right
 * before a payment, never on a timer. Chrome extension wallets sleep their worker (MV3): one retry after a pause.
 * A wallet without isAuthenticated counts as live (the payment itself will say if it is not).
 */
export async function walletAlive(w: Wallet, ms = 15_000): Promise<boolean> {
  if (playHeld) return true; // a round is live: never touch the wallet, assume it is still there
  if (walletBusy(w.client)) return true; // a request is open in the wallet: it is alive, just waiting on the player
  if (typeof (w.client as { isAuthenticated?: unknown }).isAuthenticated !== 'function') return true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { authenticated } = await withTimeout(w.client.isAuthenticated({}), ms, 'WALLET_TIMEOUT');
      return authenticated === true;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  return false;
}
