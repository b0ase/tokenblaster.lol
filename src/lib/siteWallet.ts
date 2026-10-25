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
import { connect, serialised, type Wallet } from './wallet';
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
};

const EMPTY: SiteWalletState = { wallet: null, live: true, busy: false, error: null, chooser: null };
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
  if (/disconnected on your phone|disconnected$/i.test(m)) return 'Your phone disconnected. Scan a new code to pair again.';
  if (/locked/i.test(m)) return `${entry?.name ?? 'Your wallet'} is locked. Unlock it and try again.`;
  if (/reload/i.test(m)) return 'Your wallet lost touch with this page. Reload the page (your ammo is safe).';
  if (/timeout|did not answer|not answering/i.test(m))
    return phone ? 'Your phone is asleep or offline. Open bWallet on your phone to resume, or scan a new code.' : `${entry?.name ?? 'Your wallet'} did not answer. Open it and try again.`;
  return `${entry?.name ?? 'Your wallet'} could not connect: ${m}.`;
}

function adopt(w: Wallet) {
  rememberWallet(w.id);
  saveKey({ id: w.id, publicKey: w.publicKey });
  setProofWallet(w.client);
  set({ wallet: w, live: true, error: null, busy: false, chooser: null });
  setBarWallet({ id: w.id, name: w.name, publicKey: w.publicKey, live: true });
  void lookupPaymail(w.publicKey, true).then((id) => {
    if (id && getBarWallet()?.publicKey === w.publicKey) patchBarWallet({ publicKey: w.publicKey, paymail: id.paymail, alias: id.alias, avatar: id.avatar });
  });
}

let connecting: Promise<Wallet | null> | null = null;

/** Connect the wallet the player picked (or the remembered one). Every page sees it at once. */
export function connectEntry(entry: WalletEntry): Promise<Wallet | null> {
  if (!entry.fresh && state.wallet && state.wallet.id === entry.id && state.live) return Promise.resolve(state.wallet);
  if (connecting) return connecting;
  set({ busy: true, error: null, chooser: null });
  connecting = (async () => {
    try {
      // Same wallet as earlier in this tab: reuse its key, ask nothing.
      // A wallet that stopped answering (not a phone: that is the relay's job) gets a real connect, to re-ask it.
      const stale = state.wallet?.id === entry.id && !state.live && entry.kind !== 'phone';
      const known = entry.fresh || stale ? null : savedKey(entry.id);
      const w: Wallet = known
        ? { client: serialised(entry.wallet), publicKey: known, address: PublicKey.fromString(known).toAddress(), id: entry.id, name: entry.name }
        : await connect(entry);
      adopt(w);
      return w;
    } catch (e) {
      set({ busy: false, error: walletErrorText(e, entry) });
      return null;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

export const openChooser = (note: string | null = null) => set({ chooser: { note }, error: null });
export const closeChooser = () => set({ chooser: null });

/** Any "Connect" button: the in-app wallet (inside bWallet), else the remembered one, else the chooser. */
export async function openSiteWallet(): Promise<Wallet | null> {
  if (state.wallet && state.live) return state.wallet;
  set({ busy: true, error: null });
  const all = await discoverWallets().catch(() => [] as WalletEntry[]);
  set({ busy: false });
  const inApp = all.find((w) => w.kind === 'in-app');
  if (inApp) return connectEntry(inApp);
  const id = state.wallet?.id ?? rememberedWallet();
  const found = id ? all.find((w) => w.id === id) : null;
  if (found) return connectEntry(found);
  openChooser(id ? 'The wallet you used last time is not available any more.' : null);
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
  set({ ...EMPTY });
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
  set({ ...EMPTY, chooser: { note: why } });
});

export function setSiteWalletLive(live: boolean) {
  if (!state.wallet || state.live === live) return;
  set({ live });
  patchBarWallet({ live });
}

export const setSiteWalletError = (error: string | null) => set({ error });

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
}
