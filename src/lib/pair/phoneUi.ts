/**
 * Phone layout of the wallet chooser (bwallet docs/PAIRING-ORIGIN-PROOF.md, "No app installed": never show a QR or
 * mention a computer on a phone). Pure, so the order and the no-QR rule are tested without a DOM.
 */

/** A phone: an iPhone/iPad/Android UA, or a touch screen narrower than a tablet in landscape. */
export function isPhoneDevice(ua: string, touch = false, width = Infinity): boolean {
  if (/iPhone|iPad|Android/i.test(ua)) return true;
  return touch && width <= 820;
}

/** This browser, read once per render. False on the server. */
export function detectPhone(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  const width = Math.min(window.screen?.width ?? Infinity, window.innerWidth || Infinity);
  return isPhoneDevice(navigator.userAgent, touch, width);
}

/**
 * Open this page inside bWallet's own (dapp) browser, where the wallet is injected and no pairing is needed.
 * NOTE: the scheme follows bWallet's other bwalletx:// links; confirm the handler name with the bWalletX session.
 */
/** bWallet has no in-app-browser deep link yet; the row stays hidden until the bWalletX session ships one (then set this true and fix the URL). */
export const BWALLET_BROWSER_LINK_READY = true; // bwallet #191 ships /browse (universal link)

export const openInBwalletBrowserUrl = (pageUrl: string) => `https://www.bwallet.space/browse?url=${encodeURIComponent(pageUrl)}`;

export type PhoneRow = 'in-app' | 'open-in-browser' | 'phone-link' | 'get' | 'web';

/**
 * Rows on a phone, top to bottom. A wallet already in this app leads; otherwise "Open in bWallet's browser" comes
 * first, then "bWallet on your phone → Open in bWallet", then the install links. Never a QR.
 */
export function phoneRows(hasInApp: boolean): PhoneRow[] {
  return [...(hasInApp ? (['in-app'] as const) : []), 'open-in-browser', 'phone-link', 'get', 'web'];
}

/** The QR panel is for a computer only. */
export const showQrPanel = (isPhone: boolean) => !isPhone;

/** bWallet's in-app browser adds `bWallet/` (or the older `YoursWalletMobile/`) to the user agent (see lib/wallet.ts). */
export const isBwalletInAppUa = (ua: string) => /(?:bWallet|YoursWalletMobile)\//.test(ua);

/** TERRORNODE plays full screen inside bWallet: a phone browser that is not bWallet gets "Play in bWallet" first. */
/** bWallet's in-wallet frame (#392) is an iframe in the app WebView, whose UA had no token before yours-mobile #396:
 *  also count a frame whose parent is the app (capacitor://localhost on iOS, https://localhost on Android). */
export const isAppParent = (parents: readonly string[], framed: boolean) =>
  framed && parents.some((o) => o.startsWith('capacitor://localhost') || /^https:\/\/localhost(?::\d+)?(?:\/|$)/.test(o));

const parentOrigins = (): string[] => {
  if (typeof window === 'undefined') return [];
  const a = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  return [...(a ? Array.from(a) : []), document.referrer].filter(Boolean);
};
const isFramed = () => {
  try { return typeof window !== 'undefined' && window.top !== window; } catch { return true; }
};

export const showPlayInBwallet = (
  ua: string,
  isPhone: boolean,
  linkReady: boolean = BWALLET_BROWSER_LINK_READY,
  inAppFrame: boolean = isAppParent(parentOrigins(), isFramed()),
) => linkReady && isPhone && !isBwalletInAppUa(ua) && !inAppFrame;

export const TERRORNODE_URL = 'https://www.tokenblaster.lol/arcade/terrornode';
