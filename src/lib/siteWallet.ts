/**
 * ONE wallet for the whole site (owner, 25 Oct 2026: the top bar's Connect and the in-page Connect buttons each kept
 * their own wallet, so pairing the phone from the top bar left the launch form "not connected").
 *
 * Every connect site (the top bar chip, useBlaster, useLaunchWallet, the coin-op gate, the Arena, GunApp, ordnance…)
 * reads and writes this one store, and every "Connect" opens the same chooser (rendered once, by <SiteWalletChooser/>).
 * The top bar's metadata store (walletBar.ts setBarWallet) and the X-proof wallet follow it.
 *
 * Connecting asks the wallet for its identity key once. The key is kept for this tab (sessionStorage), so a reload,
 * a page change or a second Connect button never sends another getPublicKey({ identityKey: true }): in bWalletX that
 * request is the "connect" itself and, after a quiet spell, re-opens "Reconnect to <site>?" (on a paired phone that
 * came back as "Permission denied.").
 */
import { PublicKey } from '@bsv/sdk';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from './discovery';
import { PairError, disconnectPhone, getPhoneEnd, getPhoneStatus, subPhoneStatus } from './pair/site';
import { cancelWalletCalls, connect, onWalletHold, serialised, walletHeld, withTimeout, WALLET_CANCELLED, WALLET_HELD, type Wallet } from './wallet';
import { lookupPaymail, patchBarWallet, setBarWallet, tellWalletDisconnected, getBarWallet } from './walletBar';
import { setProofWallet } from './xproof';

export type SiteWalletState = {
  wallet: Wallet | null;
  /** False once the wallet stopped answering (checked right before a payment, never on a timer). */
  live: boolean;
  busy: boolean;
  error: string | null;
  /** The chooser is open (with an optional note at the top). */
  chooser: { note: string | null } | null;
  /** We are waiting on the wallet (shown by <SiteWalletWaiting/> with Cancel / Try again). Never a silent wait. */
  waiting: { text: string; since: number; kind: 'discover' | 'connect' | 'pay' } | null;
  /** Bumped by every Cancel: pages waiting on the wallet (the coin-op cabinet) reset their own "approve" state. */
  cancels: number;
};

const EMPTY: SiteWalletState = { wallet: null, live: true, busy: false, error: null, chooser: null, waiting: null, cancels: 0 };
let state: SiteWalletState = EMPTY;
const subs = new Set<() => void>();
export const getSiteWallet = () => state;
export const subSiteWallet = (fn: () => void) => (subs.add(fn), () => void subs.delete(fn));
function set(p: Partial<SiteWalletState>) {
  state = { ...state, ...p };
  for (const f of subs) f();
}

/** The connected key for this tab, so a reload resumes without asking the wallet again. */
const KEY_STORE = 'tokenblaster.siteWallet';
type SavedKey = { id: string; publicKey: string };
function savedKey(id: string): string | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY_STORE) ?? 'null') as SavedKey | null;
    return s && s.id === id && /^0[23][0-9a-f]{64}$/i.test(s.publicKey) ? s.publicKey : null;
  } catch {
    return null;
  }
}
function saveKey(k: SavedKey | null) {
  try {
    if (k) sessionStorage.setItem(KEY_STORE, JSON.stringify(k));
    else sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* the next reload just asks again */
  }
}

/**
 * Plain words for a wallet that refused or did not answer. Never the raw "Permission denied." (owner, 25 Oct: the
 * phone was unlocked and had permission; what had lapsed was the pairing's connect grant on the phone).
 */
export function walletErrorText(e: unknown, entry?: Pick<WalletEntry, 'kind' | 'name'>): string {
  const m = (e instanceof Error ? e.message : String(e)).replace(/\.+$/, '');
  const phone = entry?.kind === 'phone';
  // The paired phone's own reply codes (bWallet #122): its words, not a guess from the text.
  if (e instanceof PairError) return e.message;
  if (/permission denied|denied by user|user (has )?denied|dismissed|ERR_PERMISSION_DENIED|USER_REJECTED/i.test(m))
    return phone
      ? 'Your phone did not approve the connection. Open bWallet on your phone and approve it, or scan a new code.'
      : `${entry?.name ?? 'Your wallet'} did not approve the connection. Open it and approve, or pick another wallet.`;
  if (/WALLET_HELD_DURING_PLAY/.test(m)) return 'A round is still live on this page, so the wallet is paused. Finish or end the round, then connect.';
  if (/disconnected on your phone|disconnected$/i.test(m)) return 'Your phone disconnected. Scan a new code to pair again.';
  if (/locked/i.test(m)) return `${entry?.name ?? 'Your wallet'} is locked. Unlock it and try again.`;
  // The wallet's own words (owner, 25 Oct: every error that merely mentioned "reload" became a vague "lost touch").
  if (/reload/i.test(m)) return `${entry?.name ?? 'Your wallet'} says: ${m}. (Your ammo is safe.)`;
  if (/timeout|did not answer|not answering/i.test(m))
    return phone ? 'Your phone is asleep or offline. Open bWallet on your phone to resume, or scan a new code.' : `${entry?.name ?? 'Your wallet'} did not answer. Open it and try again.`;
  return `${entry?.name ?? 'Your wallet'} could not connect: ${m}.`;
}

function adopt(w: Wallet) {
  rememberWallet(w.id);
  saveKey({ id: w.id, publicKey: w.publicKey });
  setProofWallet(w.client);
  set({ wallet: w, live: true, error: null, busy: false, chooser: null, waiting: null });
  setBarWallet({ id: w.id, name: w.name, publicKey: w.publicKey, live: true });
  void lookupPaymail(w.publicKey, true).then((id) => {
    if (id && getBarWallet()?.publicKey === w.publicKey) patchBarWallet({ publicKey: w.publicKey, paymail: id.paymail, alias: id.alias, avatar: id.avatar });
  });
}

/** The connect in progress: its entry and a way to give up on it (Cancel, a timeout, or a new pick). */
let connecting: { entry: WalletEntry; promise: Promise<Wallet | null>; abort: (why: string) => void } | null = null;

/** How long "Connect" may look for wallets before it says so (MV3 extensions can be asleep). */
export const DISCOVERY_TIMEOUT_MS = 8_000;

const waitText = (entry: Pick<WalletEntry, 'kind' | 'name'>) =>
  entry.kind === 'phone' ? 'Waiting for your phone… open bWallet on your phone to approve.' : `Waiting for ${entry.name}… open the extension to approve.`;

/** Show that we are waiting on the wallet (payments use this too), or clear it. */
export const setSiteWalletWaiting = (w: SiteWalletState['waiting']) => set({ waiting: w });

/**
 * Connect the wallet the player picked (or the remembered one). Every page sees it at once.
 * A connect that never settles can not wedge the site any more (owner, 25 Oct 2026): it times out (CONNECT_TIMEOUT_MS,
 * in wallet.connect), Cancel gives up on it, and a fresh pick (the chooser) replaces it instead of joining it.
 */
export function connectEntry(entry: WalletEntry, opts: { retry?: boolean } = {}): Promise<Wallet | null> {
  // A round is live: the wallet must not be asked anything, and that is not a disconnect (owner, 25 Oct 2026: a
  // Reconnect during warm-up left "Wallet disconnected" and "A round is still live" up after the round had gone).
  if (walletHeld()) return (discoveryDone(), Promise.resolve(state.wallet));
  if (!entry.fresh && !opts.retry && state.wallet && state.wallet.id === entry.id && state.live) return (discoveryDone(), Promise.resolve(state.wallet));
  if (connecting) {
    if (!opts.retry && !entry.fresh && connecting.entry.id === entry.id) return (discoveryDone(), connecting.promise);
    connecting.abort(WALLET_CANCELLED);
  }
  set({ busy: true, error: null, chooser: null, waiting: { text: waitText(entry), since: Date.now(), kind: 'connect' } });
  let abort!: (why: string) => void;
  const aborted = new Promise<never>((_, no) => (abort = (why) => no(new Error(why))));
  const mine = {
    entry,
    abort: (why: string) => {
      cancelWalletCalls(entry.wallet, why);
      abort(why);
    },
    promise: null as unknown as Promise<Wallet | null>,
  };
  mine.promise = (async () => {
    try {
      // Same wallet as earlier in this tab: reuse its key, ask nothing.
      // A wallet that stopped answering (not a phone: that is the relay's job) gets a real connect, to re-ask it.
      // A retry from the chooser always asks again: the old key may be what the wedged extension no longer honours.
      const stale = state.wallet?.id === entry.id && !state.live && entry.kind !== 'phone';
      const known = entry.fresh || stale || opts.retry ? null : savedKey(entry.id);
      const w: Wallet = known
        ? { client: serialised(entry.wallet), publicKey: known, address: PublicKey.fromString(known).toAddress(), id: entry.id, name: entry.name }
        : await Promise.race([connect(entry), aborted]);
      if (connecting !== mine) return null; // replaced by a newer pick
      adopt(w);
      return w;
    } catch (e) {
      if (connecting === mine) {
        const cancelled = e instanceof Error && e.message === WALLET_CANCELLED;
        const held = e instanceof Error && e.message === WALLET_HELD;
        // Refused by the play guard: nothing reached the wallet, so it is neither an error nor a disconnect.
        set({ busy: false, waiting: null, error: cancelled || held ? null : walletErrorText(e, entry), ...(held && state.wallet ? { live: true } : {}) });
        if (held && state.wallet) patchBarWallet({ live: true });
        if (!cancelled) console.warn('[tokenblaster] wallet connect failed', entry.id, e);
      }
      return null;
    } finally {
      if (connecting === mine) connecting = null;
    }
  })();
  aborted.catch(() => undefined);
  connecting = mine;
  return mine.promise;
}

/**
 * Cancel whatever we are waiting on the wallet for (connect, discovery, a payment): frees the wallet queue so the
 * next press goes straight to the wallet. A payment cancelled this way may still have gone through in the wallet:
 * the gun's balance is checked before any re-pay (useBlaster.load).
 */
export function cancelSiteWalletWait() {
  connecting?.abort(WALLET_CANCELLED);
  connecting = null;
  if (state.wallet) cancelWalletCalls(state.wallet.client);
  discoverGen++;
  set({ busy: false, waiting: null, cancels: state.cancels + 1 });
}

/**
 * A wallet call just succeeded (a payment, a read): the wallet is plainly connected, so the site says so everywhere
 * (owner, 25 Oct 2026: after a paid game the header still said "Connect wallet" with an empty badge).
 */
export function markSiteWalletAnswered(w: Wallet | null = state.wallet) {
  if (!w) return;
  if (state.wallet?.id !== w.id || !state.live || state.waiting?.kind === 'connect') set({ wallet: w, live: true, error: null, waiting: state.waiting?.kind === 'connect' ? null : state.waiting });
  const bar = getBarWallet();
  if (!bar || bar.publicKey !== w.publicKey) {
    setBarWallet({ id: w.id, name: w.name, publicKey: w.publicKey, live: true });
    void lookupPaymail(w.publicKey).then((id) => {
      if (id && getBarWallet()?.publicKey === w.publicKey) patchBarWallet({ publicKey: w.publicKey, paymail: id.paymail, alias: id.alias, avatar: id.avatar });
    });
  } else if (bar.live === false) patchBarWallet({ live: true });
}

let discoverGen = 0;
/**
 * Wallet discovery with a timeout (and visible state while it runs).
 * It leaves `busy`/`waiting` ON: the caller hands over in ONE update (connectEntry's own waiting, the chooser, or
 * `discoveryDone`). Clearing it here left a render with nothing connecting, no chooser and no wallet between
 * discovery and the connect, and the cabinet read that as "the connect ended" and dropped LOCK & LOAD's payment
 * (owner, 25 Oct: connect worked, the payment never asked).
 */
async function discoverVisible(): Promise<WalletEntry[] | null> {
  const gen = ++discoverGen;
  set({ busy: true, error: null, waiting: { text: 'Looking for your wallet…', since: Date.now(), kind: 'discover' } });
  const all = await withTimeout(discoverWallets(), DISCOVERY_TIMEOUT_MS, 'WALLET_TIMEOUT').catch(() => null);
  if (gen !== discoverGen) return null; // cancelled
  return all;
}
function discoveryDone() {
  if (state.waiting?.kind === 'discover') set({ busy: false, waiting: null });
}

/** A chooser row was clicked: look again for that wallet (it may have been reloaded) and ask it afresh, every click. */
export async function pickWallet(entry: WalletEntry): Promise<Wallet | null> {
  if (entry.kind === 'phone') return connectEntry(entry);
  connecting?.abort(WALLET_CANCELLED);
  connecting = null;
  const gen = discoverGen + 1;
  const all = await discoverVisible();
  if (discoverGen !== gen) return null; // the player pressed Cancel
  const found = all?.find((w) => w.id === entry.id) ?? entry;
  return connectEntry(found, { retry: true }); // replaces the discover wait with its own, in one update
}

export const openChooser = (note: string | null = null) =>
  set({ chooser: { note }, error: null, ...(state.waiting?.kind === 'discover' ? { busy: false, waiting: null } : {}) });
export const closeChooser = () => set({ chooser: null });

/** Any "Connect" button: the in-app wallet (inside bWallet), else the remembered one, else the chooser. */
export async function openSiteWallet(): Promise<Wallet | null> {
  if (state.wallet && state.live) return state.wallet;
  if (connecting) return connecting.promise; // already waiting: the waiting card says so, with Cancel
  const gen = discoverGen + 1;
  const found0 = await discoverVisible();
  if (discoverGen !== gen) return null; // the player pressed Cancel
  const all = found0 ?? [];
  const inApp = all.find((w) => w.kind === 'in-app');
  if (inApp) return connectEntry(inApp);
  const id = state.wallet?.id ?? rememberedWallet();
  const found = id ? all.find((w) => w.id === id) : null;
  if (found) return connectEntry(found);
  openChooser(
    found0 === null
      ? 'Looking for wallets took too long. Pick yours below to try again.'
      : id
        ? 'The wallet you used last time did not answer this page. Pick it below (reload the page if it is not listed).'
        : null,
  );
  return null;
}

/** The one Disconnect (top bar): clears every page, tells bWalletX, closes a phone pairing. */
export function disconnectSiteWallet() {
  const was = state.wallet;
  rememberWallet(null);
  saveKey(null);
  tellWalletDisconnected();
  if (was?.id === 'phone') disconnectPhone();
  setProofWallet(null);
  setBarWallet(null);
  set({ ...EMPTY, cancels: state.cancels });
}

/**
 * The phone ended the pairing (REPAIR_NEEDED, or the player unpaired in bWallet): drop the phone wallet and open the
 * chooser, whose fresh QR is the way back. No retry of the old channel.
 */
subPhoneStatus(() => {
  if (getPhoneStatus() !== 'gone' || state.wallet?.id !== 'phone') return;
  const why = getPhoneEnd()?.message ?? null;
  rememberWallet(null);
  saveKey(null);
  setProofWallet(null);
  setBarWallet(null);
  set({ ...EMPTY, cancels: state.cancels, chooser: { note: why } });
});

export function setSiteWalletLive(live: boolean) {
  if (!state.wallet || state.live === live) return;
  set({ live });
  patchBarWallet({ live });
}

export const setSiteWalletError = (error: string | null) => set({ error });

/** The text a play-guard refusal turns into (walletErrorText): stale as soon as no round holds the wallet. */
export const HELD_TEXT = /round is still live on this page/;
/** The hold is off: drop a leftover "round is still live" note, and stop calling a wallet "disconnected" for it. */
export function clearHeldNote() {
  if (walletHeld()) return;
  if (state.error && HELD_TEXT.test(state.error)) set({ error: null });
}
onWalletHold((held) => {
  if (!held) clearHeldNote();
});

/** Quietly reconnect the remembered wallet once per page load (no chooser popping up uninvited). */
let resumed = false;
export function resumeSiteWallet() {
  if (resumed || typeof window === 'undefined') return;
  resumed = true;
  const id = rememberedWallet();
  if (!id || state.wallet) return;
  void discoverWallets()
    .then((all) => {
      const found = all.find((w) => w.id === id) ?? all.find((w) => w.kind === 'in-app');
      // A paired phone resumes only with the key kept for this tab: never a fresh connect request to a sleeping phone.
      if (found && (found.kind !== 'phone' || savedKey(found.id))) return connectEntry(found);
    })
    .catch(() => undefined);
}

/** Tests only. */
export function _resetSiteWallet() {
  state = EMPTY;
  resumed = false;
  connecting = null;
  discoverGen = 0;
}
