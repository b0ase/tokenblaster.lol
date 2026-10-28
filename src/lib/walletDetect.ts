/**
 * Is a bWallet on hand for the arcade's yellow button (owner, 28 Oct 2026)? Cheap signals only, no wallet calls:
 * an injected window.CWI or a brc100 announce (extension), bWallet's in-app browser UA or app frame, or a page
 * framed by web.bwalletx.com. Phones without any of these can't be told apart from "not installed" (the app can
 * still open the page via a link), so they come back 'unknown'.
 */
export type WalletPresence = 'installed' | 'none' | 'unknown';

export type DetectSignals = {
  cwi: boolean;
  announced: boolean;
  inAppUa: boolean;
  appFrame: boolean;
  bwalletxParent: boolean;
  phone: boolean;
};

export function walletPresence(s: DetectSignals): WalletPresence {
  if (s.cwi || s.announced || s.inAppUa || s.appFrame || s.bwalletxParent) return 'installed';
  return s.phone ? 'unknown' : 'none';
}

/** A parent origin that is the bWalletX web wallet (the page is open inside web.bwalletx.com). */
export const isBwalletxOrigin = (o: string) => /^https:\/\/([a-z0-9-]+\.)*bwalletx\.com(?:[:/]|$)/i.test(o);
