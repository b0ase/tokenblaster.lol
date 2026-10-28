'use client';

import { useEffect, useState } from 'react';
import { GET_BWALLETX_URL } from '@/lib/pair/site';
import { detectPhone, isAppParent, isBwalletInAppUa } from '@/lib/pair/phoneUi';
import { WALLET_BAR as W } from '@/lib/walletBar';
import { isBwalletxOrigin, walletPresence, type WalletPresence } from '@/lib/walletDetect';

/** How long to listen for an extension's brc100 announce before calling it "none". */
const LISTEN_MS = 1200;

function signalsNow(announced: boolean) {
  const w = window as { CWI?: unknown };
  const a = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  const parents = [...(a ? Array.from(a) : []), document.referrer].filter(Boolean);
  let framed = true;
  try {
    framed = window.top !== window;
  } catch {
    /* cross-origin parent: framed */
  }
  return {
    cwi: Boolean(w.CWI),
    announced,
    inAppUa: isBwalletInAppUa(navigator.userAgent),
    appFrame: isAppParent(parents, framed),
    bwalletxParent: framed && parents.some(isBwalletxOrigin),
    phone: detectPhone(),
  };
}

/** 'unknown' until the listen window ends (renders Sign in + a small Get link, same as a phone). */
export function useWalletPresence(): WalletPresence {
  const [p, setP] = useState<WalletPresence>('unknown');
  useEffect(() => {
    let heard = false;
    const on = () => {
      heard = true;
      setP('installed');
    };
    window.addEventListener('brc100:announceWallet', on);
    window.dispatchEvent(new Event('brc100:requestWallet'));
    const first = walletPresence(signalsNow(false));
    if (first === 'installed') void Promise.resolve().then(() => setP('installed'));
    const t = setTimeout(() => {
      if (!heard) setP(walletPresence(signalsNow(false)));
    }, LISTEN_MS);
    return () => {
      clearTimeout(t);
      window.removeEventListener('brc100:announceWallet', on);
    };
  }, []);
  return p;
}

const btn =
  'inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-[12px] font-extrabold tracking-wide text-black shadow-[0_0_0_1px_rgba(0,0,0,0.4)] transition-[filter] hover:brightness-110 sm:px-4 sm:text-[13px]';

/**
 * The obvious yellow bWallet button in the arcade bar (owner, 28 Oct 2026), shown while signed out. Connected,
 * the bar's own handle chip takes its place. Colour: the bar's gold (WALLET_BAR.accent, bWalletX's #F5B800).
 */
export function BwalletButton({ onSignIn }: { onSignIn: () => void }) {
  const presence = useWalletPresence();
  const style = { background: W.accent };
  if (presence === 'none') {
    return (
      <a href={GET_BWALLETX_URL} target="_blank" rel="noreferrer" className={btn} style={style} data-bwallet-button="get">
        GET bWALLET
      </a>
    );
  }
  const signIn = (
    <button type="button" onClick={onSignIn} className={btn} style={style} data-bwallet-button="sign-in" aria-label="Sign in with bWallet">
      SIGN IN<span className="hidden sm:inline">&nbsp;WITH bWALLET</span>
    </button>
  );
  if (presence === 'installed') return signIn;
  return (
    <span className="flex shrink-0 flex-col items-center leading-none" data-bwallet-unknown>
      {signIn}
      <a href={GET_BWALLETX_URL} target="_blank" rel="noreferrer" className="mt-0.5 text-[10px] font-semibold underline" style={{ color: W.accent }} data-bwallet-get-link>
        Get bWallet
      </a>
    </span>
  );
}
