/**
 * bWallet connection. bWallet (our Yours Wallet Mobile fork) opens apps in its in-app browser,
 * adds `bWallet/` to the user agent and injects a BRC-100 wallet as `window.CWI`. The Yours v5
 * browser extension injects the same thing on desktop. Which wallet to use is the player's
 * choice (src/lib/discovery.ts, docs/wallet-connect.md).
 */
import { P2PKH, PublicKey, Transaction, type WalletInterface } from '@bsv/sdk';
import { payRefScript } from './payRef';
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
type Queue = { tail: Promise<unknown>; inFlight: number; gen: number; cancels: Set<(e: Error) => void> };
const queues = new WeakMap<object, Queue>();
/** The wallet object behind a serialised() proxy (status checks go to it directly, never through the queue). */
const raws = new WeakMap<object, WalletInterface>();
export const WALLET_CANCELLED = 'WALLET_CANCELLED';

/** Calls that never open a sheet in the wallet. Everything else may: the page leaves fullscreen first. */
const QUIET = new Set(['isAuthenticated', 'waitForAuthentication', 'getNetwork', 'getVersion', 'getHeight', 'getHeaderForHeight']);

/**
 * Paid-play fix (owner, 25 Oct 2026: "approve in your wallet" but no prompt until he pressed Esc / clicked the URL
 * bar). The game page runs in element fullscreen (GameShell auto-fullscreen on a coin / START press) and often with
 * the pointer locked. A Chrome extension wallet opens its approval sheet in its own popup window, which Chrome keeps
 * behind a fullscreen tab: the request had gone out, the sheet just could not be seen until fullscreen ended. So
 * before any wallet request that may open a sheet, leave fullscreen and release the pointer.
 */
export function leaveFullscreenForWallet() {
  if (typeof document === 'undefined') return;
  try {
    if (document.pointerLockElement) document.exitPointerLock?.();
  } catch {
    /* nothing locked */
  }
  try {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  } catch {
    /* not fullscreen */
  }
}

/**
 * Hang fix (owner, 25 Oct 2026: a payment sheet left unanswered blocked every later wallet call in the tab, so
 * Connect and LOCK & LOAD did nothing). Rejects every call queued or open on this wallet with WALLET_CANCELLED and
 * frees the queue at once, so the next call goes straight to the wallet. The wallet's own sheet (if any) is left to
 * the wallet; whatever it answers later is ignored.
 */
export function cancelWalletCalls(client: object, reason = WALLET_CANCELLED) {
  const q = queues.get(client);
  if (!q) return;
  q.gen++;
  const err = new Error(reason);
  for (const c of [...q.cancels]) c(err);
  q.cancels.clear();
  q.tail = Promise.resolve();
  q.inFlight = 0;
  if (paying) paying = null;
}

/**
 * PLAY GUARD (owner playtest, 25 Oct 2026: wallet sheets kept opening mid-fire). While a paid round is live the
 * gun signs every bullet with its own in-browser key, so nothing may ask the wallet anything: any call through a
 * connected wallet is refused here, before it reaches the extension, and a dev-console warning names the caller.
 */
const holds = new Set<string>();
let playHeld = false;
export const WALLET_HELD = 'WALLET_HELD_DURING_PLAY';
/** `key` names who holds it (a page's round, a storm session): the wallet is free again only when every holder lets go. */
const holdSubs = new Set<(held: boolean) => void>();
/** Told whenever the play hold turns on or off (siteWallet clears its "round is still live" note on release). */
export const onWalletHold = (fn: (held: boolean) => void) => (holdSubs.add(fn), () => void holdSubs.delete(fn));
export const holdWalletForPlay = (on: boolean, key = 'play') => {
  if (on) holds.add(key);
  else holds.delete(key);
  const was = playHeld;
  playHeld = holds.size > 0;
  if (was !== playHeld) for (const f of [...holdSubs]) f(playHeld);
};
export const walletHeld = () => playHeld;
export const walletBusy = (client: object) => (queues.get(client)?.inFlight ?? 0) > 0;
/** True while a payment (fund) is open in the wallet. */
export const walletPaying = () => paying !== null;
/**
 * Every call through the queue has a deadline, counted from when it is queued (26 Oct 2026: a background gun-backup
 * encrypt that never settled held the queue, so the payment behind it never reached the wallet). On the deadline the
 * caller gets WALLET_TIMEOUT and the call leaves the queue: if it had not reached the wallet yet it never will.
 * Payments get the payment timeout (plus a little, so fund()'s own timeout answers first); everything else a minute.
 */
export const CALL_TIMEOUT_MS = 60_000;
const PAY_METHODS = new Set(['createAction', 'signAction', 'internalizeAction']);
let callTimeoutMs = CALL_TIMEOUT_MS;
/** Tests only: shorten the non-payment deadline. */
export const setWalletCallTimeout = (ms = CALL_TIMEOUT_MS) => void (callTimeoutMs = ms);
export const callDeadline = (method: string) => (PAY_METHODS.has(method) ? PAY_TIMEOUT_MS + 5_000 : callTimeoutMs);
export function serialised(client: WalletInterface): WalletInterface {
  const q: Queue = queues.get(client) ?? { tail: Promise.resolve(), inFlight: 0, gen: 0, cancels: new Set() };
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
        if (!QUIET.has(String(prop))) leaveFullscreenForWallet();
        q.inFlight++;
        const gen = q.gen;
        let cancel!: (e: Error) => void;
        const cancelled = new Promise<never>((_, no) => (cancel = no));
        q.cancels.add(cancel);
        let expired = false;
        const deadline = setTimeout(() => {
          expired = true;
          cancel(new Error('WALLET_TIMEOUT'));
        }, callDeadline(String(prop)));
        (deadline as { unref?: () => void }).unref?.();
        const call = q.tail.then(() => {
          if (q.gen !== gen || expired) throw new Error(expired ? 'WALLET_TIMEOUT' : WALLET_CANCELLED);
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        });
        // The caller sees the wallet's answer, a cancel or the deadline, whichever comes first; each frees the queue.
        const run = Promise.race([call, cancelled]);
        run.catch(() => undefined);
        const done = run.catch(() => undefined).finally(() => {
          clearTimeout(deadline);
          q.cancels.delete(cancel);
          if (q.gen === gen) q.inFlight = Math.max(0, q.inFlight - 1);
        });
        q.tail = done;
        return run;
      };
    },
  });
  queues.set(proxy, q);
  raws.set(proxy, raws.get(client) ?? client);
  return proxy;
}

/** How long a connect (identity key) request may wait for the player's approval before we stop waiting. */
export const CONNECT_TIMEOUT_MS = 45_000;

/** Connect the wallet the player picked in the chooser. */
export async function connect(entry: WalletEntry, ms = CONNECT_TIMEOUT_MS): Promise<Wallet> {
  const client = serialised(entry.wallet);
  try {
    const { publicKey } = await withTimeout(client.getPublicKey({ identityKey: true }), ms, 'WALLET_TIMEOUT').catch((e) => {
      // Never leave a hung connect in the queue: it would block every later call to this wallet.
      if (e instanceof Error && e.message === 'WALLET_TIMEOUT') cancelWalletCalls(client, 'WALLET_TIMEOUT');
      throw e;
    });
    return { client, publicKey, address: PublicKey.fromString(publicKey).toAddress(), id: entry.id, name: entry.name };
  } catch (e) {
    // A paired phone says exactly why (bWallet's reply codes): keep that, never "did not answer".
    if (e instanceof Error && (e.message === WALLET_CANCELLED || e.message === 'WALLET_TIMEOUT')) throw e;
    if (e instanceof Error && 'code' in e && typeof (e as { code: unknown }).code === 'string') throw e;
    // A locked wallet refuses getPublicKey: that means "unlock me", not "not installed".
    throw new Error(`${entry.name} did not answer: ${e instanceof Error ? e.message : e}. Unlock it and try again.`);
  }
}

/** Pay `sats` to `address` in one approval. Returns the funding transaction (with its proofs). */
// Only one payment request may be open in the wallet at a time (a second createAction while one is pending
// can wedge an extension wallet's prompt queue).
let paying: Promise<unknown> | null = null;
/** A payment sheet left this long counts as "outcome unknown": the queue is freed and the gun balance decides. */
export const PAY_TIMEOUT_MS = 180_000;
export async function fund(w: Wallet, address: string, sats: number, description: string, ms = PAY_TIMEOUT_MS, ref?: string): Promise<Transaction> {
  if (paying) throw new Error('A payment is already waiting in your wallet. Approve or cancel it first.');
  const req = w.client.createAction({
    description,
    outputs: [
      { lockingScript: new P2PKH().lock(address).toHex(), satoshis: sats, outputDescription: description },
      ...(ref ? [{ lockingScript: payRefScript(ref).toHex(), satoshis: 0, outputDescription: 'TokenBlaster payment id' }] : []),
    ],
    // No labels: a BRC-100 wallet asks permission for every new label, an extra sheet before the payment (playtest 25 Oct).
    options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
  });
  paying = req;
  let r: Awaited<typeof req>;
  try {
    r = await withTimeout(req, ms, 'WALLET_TIMEOUT');
  } catch (e) {
    if (e instanceof Error && e.message === 'WALLET_TIMEOUT') cancelWalletCalls(w.client, 'WALLET_TIMEOUT');
    throw e;
  } finally {
    if (paying === req) paying = null;
  }
  if (!r.tx) {
    // bWalletX answers {txid, pending: true} with no transaction when it queues the send (approved, going out):
    // that is a payment, never a refusal (owner, 25 Oct: approved $0.10, the cabinet said "Your wallet said no").
    const txid = (r as { txid?: string }).txid;
    if (txid) throw new Error(`${WALLET_SENT_PENDING}:${txid}`);
    throw new Error('bWallet returned no transaction.');
  }
  return Transaction.fromAtomicBEEF(r.tx);
}

/** fund() error prefix: the wallet approved and sent (or queued) the payment but returned only its txid. */
export const WALLET_SENT_PENDING = 'WALLET_SENT_PENDING';

/** True only when the wallet's error is the player (or wallet) declining. Anything else is a failure, not a "no". */
export function isRefusal(m: string): boolean {
  return /cancel|denied|reject|declin|abort|not approved|user (?:said no|refused)/i.test(m) && !m.startsWith(WALLET_SENT_PENDING);
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
export async function walletAlive(w: Wallet, ms = 15_000): Promise<boolean | 'busy'> {
  if (playHeld) return true; // a round is live: never touch the wallet, assume it is still there
  // Calls are queued or open: NOT proof the wallet is alive (a hung call looks exactly like this). The caller decides.
  if (walletBusy(w.client)) return 'busy';
  if (typeof (w.client as { isAuthenticated?: unknown }).isAuthenticated !== 'function') return true;
  // Straight to the wallet, NOT through the queue (owner, 25 Oct 2026): a status check that timed out used to stay
  // at the head of the queue, so the payment queued behind it was only sent once the asleep extension woke up.
  const raw = raws.get(w.client) ?? w.client;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { authenticated } = await withTimeout(raw.isAuthenticated({}), ms, 'WALLET_TIMEOUT');
      return authenticated === true;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  return false;
}
