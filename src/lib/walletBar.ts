/**
 * Top bar drawn to bWalletX's side-panel header (owner, 8 Oct 2026: "this applies to the chrome
 * extension when connected to games in tokenblaster.lol too"), so with the extension open the
 * site bar and the wallet bar read as one straight bar.
 *
 * Values copied read-only from bWalletX (src/mobile/tabs/TopNav.tsx, account/AccountStrip.tsx,
 * mobile.css, brand/theme.ts):
 *   name strip   28px, #010101, 1px bottom #1d1f24, 13px bold          (AccountStrip)
 *   tool row     56px (h-14), #000000                                   (TopNav)
 *   round button 36px, rounded-full, transparent, 1px #2A2A2C ring      (TopNav RING)
 *   icons        16px #F5B800 (ACCENT); ☰ 22px #F2F2F0 (ICON); Inter
 *
 * The wallet keeps Calls · Airdrops · Media · Lock BSV; this bar carries game tools.
 */
export const WALLET_BAR = {
  stripH: 28,
  rowH: 56,
  stripBg: '#010101',
  stripEdge: '#1d1f24',
  rowBg: '#000000',
  button: 36,
  ring: '#2A2A2C',
  accent: '#F5B800',
  icon: '#F2F2F0',
  iconSize: 16,
  menuIconSize: 22,
} as const;

export const BWALLETX_WEB = 'https://web.bwalletx.com';

/** What the chip shows. `wallet` = the connected BRC-100 wallet's name, or null. */
export type ChipState =
  | { kind: 'connected'; label: string; verified: boolean }
  | { kind: 'disconnected'; label: 'Connect wallet' };

export function chipState(wallet: string | null, handle: string | null, verified: boolean): ChipState {
  if (!wallet) return { kind: 'disconnected', label: 'Connect wallet' };
  return { kind: 'connected', label: handle ? `@${handle}` : wallet, verified: Boolean(handle) && verified };
}

// ── Connected wallet, shared by the bar and any page that connects one (useBlaster) ──
/**
 * The connected wallet: name, identity key, whether it still answers, and (when bWallet has one) the paymail.
 * `paymail?` / `alias?` / `avatar?` come from the public lookup at pay.bwallet.space.
 */
export type BarWallet = { id: string; name: string; publicKey?: string; live?: boolean; paymail?: string; alias?: string; avatar?: string } | null;
let current: BarWallet = null;
const subs = new Set<() => void>();
export const getBarWallet = () => current;
export const subBarWallet = (fn: () => void) => (subs.add(fn), () => void subs.delete(fn));
export function setBarWallet(w: BarWallet) {
  const next = w ? { ...w } : null;
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const f of subs) f();
}
/** Merge fields into the connected wallet (no-op when none, or a different key). */
export function patchBarWallet(p: Partial<NonNullable<BarWallet>>) {
  if (!current) return;
  if (p.publicKey && current.publicKey && p.publicKey !== current.publicKey) return;
  setBarWallet({ ...current, ...p });
}

/** The chip's menu asks the page's wallet hook to reconnect or switch (one wallet per page). */
type Ask = 'reconnect' | 'switch';
const askSubs = new Set<(a: Ask) => void>();
export const onWalletAsk = (fn: (a: Ask) => void) => (askSubs.add(fn), () => void askSubs.delete(fn));
/** Returns true when a page handled it. */
export function askWallet(a: Ask): boolean {
  for (const f of askSubs) f(a);
  return askSubs.size > 0;
}

/** A short identity key for the badge: 03ab…9f. */
export const shortKey = (k: string | null | undefined) => (k && k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-2)}` : (k ?? ''));

/** Who the badge says you are (owner rule): the FULL paymail, else the short identity key, else the wallet name. */
export const GET_NAME_URL = 'https://bwalletx.com/get';
export function idLabel(w: BarWallet): string {
  if (!w) return '';
  if (w.paymail) return w.paymail;
  if (w.publicKey) return shortKey(w.publicKey);
  return w.name;
}

export const PAYMAIL_API = 'https://pay.bwallet.space/api/paymail';
export type PaymailId = { paymail: string; alias?: string; avatar?: string };

/** Parse a lookup response. 404 (no name yet) or anything unusable → null. The main name comes first. */
export function parseLookup(status: number, body: unknown): PaymailId | null {
  if (status !== 200 || !body || typeof body !== 'object') return null;
  const b = body as { paymail?: unknown; alias?: unknown; names?: { name?: unknown; paymail?: unknown; kind?: unknown }[] };
  const names = Array.isArray(b.names) ? b.names : [];
  const main = names.find((n) => n?.kind === 'plain') ?? names[0];
  const paymail = typeof b.paymail === 'string' && b.paymail.includes('@') ? b.paymail : typeof main?.paymail === 'string' ? main.paymail : null;
  if (!paymail) return null;
  const alias = typeof b.alias === 'string' && b.alias ? b.alias : paymail.split('@')[0];
  return { paymail, alias };
}

/** Look up the paymail for an identity key (cached per key in sessionStorage; `fresh` re-checks). */
export async function lookupPaymail(key: string, fresh = false): Promise<PaymailId | null> {
  const ck = `tb.paymail.${key}`;
  if (!fresh) {
    try {
      const hit = sessionStorage.getItem(ck);
      if (hit) return JSON.parse(hit) as PaymailId | null;
    } catch {
      /* no cache */
    }
  }
  let id: PaymailId | null = null;
  try {
    const r = await fetch(`${PAYMAIL_API}/lookup?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    id = parseLookup(r.status, r.status === 200 ? await r.json() : null);
    if (!r.ok && r.status !== 404) return null; // a server error: don't cache "no name"
    if (id) {
      const pr = await fetch(`${PAYMAIL_API}/profile/${encodeURIComponent(id.paymail)}`).catch(() => null);
      const prof = pr?.ok ? ((await pr.json().catch(() => null)) as { avatar?: unknown } | null) : null;
      if (typeof prof?.avatar === 'string' && /^https:\/\//.test(prof.avatar)) id.avatar = prof.avatar;
    }
  } catch {
    return null;
  }
  try {
    sessionStorage.setItem(ck, JSON.stringify(id));
  } catch {
    /* no cache */
  }
  return id;
}
