/**
 * bWalletX's RETURN to this site after Connect on the same phone (@bwalletx/connect 0.9, bWalletX 5.2.61+).
 *
 * On a phone the pairing link carries `ret` (this origin's ROOT), a one-time `rid` and the browser `b`. After Connect
 * bWalletX opens `https://www.tokenblaster.lol/#bwx=ok&rid=…&wk=…&f=…`, often in a NEW tab, sometimes in this one (a
 * hashchange). The fragment is only a CLAIM: connect uses it once the relay's wallet says hello with the same key.
 *
 * The fragment leaves the address bar BEFORE ANY OTHER SCRIPT RUNS: `BWX_RETURN_SCRIPT` is inlined first in <head>
 * (app/layout.tsx). It moves the fragment into memory (`window.__bwxReturn`) and strips it with replaceState, before
 * Next.js hydrates (the App Router keeps the URL it hydrated with and writes it back later) and before anything else
 * reads `location`. It also handles `hashchange` (a return into a live tab), and runs before connect's own listener,
 * so connect's in-module copy stays empty and only this site (siteWallet.finishReturnedPairing, or the chooser's
 * pairBwalletX through `readHash`) ever takes a return. <bwalletx-signin> never sees one.
 */

/** The window property the boot script stashes the fragment in. */
export const RETURN_GLOBAL = '__bwxReturn';

/** Same test as connect's: `bwx=ok` as a whole parameter of the fragment. */
export const isReturnHash = (h: string) => /(^#|&)bwx=ok(&|$)/.test(h);

/** Inline, blocking, first in <head>. ES5 on purpose (no build step touches it). Does nothing unless it is a return. */
export const BWX_RETURN_SCRIPT =
  `(function(){try{var w=window,l=w.location,h=w.history;` +
  `function s(){var x=l.hash;if(!/(^#|&)bwx=ok(&|$)/.test(x))return;w.${RETURN_GLOBAL}=x;` +
  `try{h.replaceState(h.state,'',l.pathname+l.search)}catch(e){}}` +
  `s();w.addEventListener('hashchange',s)}catch(e){}})();`;

type W = Record<string, unknown>;
const win = (): W | null => (typeof window === 'undefined' ? null : (window as unknown as W));

/**
 * The waiting return fragment ('' when none). If the boot script didn't run (a test, a page outside the layout) and
 * the fragment is still in the address bar, it is moved into memory and stripped here.
 */
export function bootReturnHash(): string {
  const w = win();
  if (!w) return '';
  try {
    if (typeof location !== 'undefined' && isReturnHash(location.hash)) {
      w[RETURN_GLOBAL] = location.hash;
      history.replaceState(history.state, '', `${location.pathname ?? ''}${location.search ?? ''}`);
    }
  } catch {
    /* no history API: the hash stays, it is still read from memory below */
  }
  const v = w[RETURN_GLOBAL];
  return typeof v === 'string' && isReturnHash(v) ? v : '';
}

/** Connect's `replaceUrl`: the return is taken. Clears the in-memory copy (the address bar was stripped already). */
export function clearBootReturn(): void {
  const w = win();
  if (w) w[RETURN_GLOBAL] = '';
}

/** The return's one-time request id, or null. */
export function returnRid(hash: string): string | null {
  if (!isReturnHash(hash)) return null;
  const rid = new URLSearchParams(hash.replace(/^#/, '')).get('rid') ?? '';
  return /^[A-Za-z0-9_-]{16,64}$/.test(rid) ? rid : null;
}
