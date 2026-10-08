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
export type BarWallet = { id: string; name: string } | null;
let current: BarWallet = null;
const subs = new Set<() => void>();
export const getBarWallet = () => current;
export const subBarWallet = (fn: () => void) => (subs.add(fn), () => void subs.delete(fn));
export function setBarWallet(w: BarWallet) {
  if (w?.id === current?.id && w?.name === current?.name) return;
  current = w ? { id: w.id, name: w.name } : null;
  for (const f of subs) f();
}
