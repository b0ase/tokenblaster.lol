'use client';

import { useEffect, useState } from 'react';
import { BwalletxSignin } from '@bwalletx/connect/react';
import { GET_BWALLETX_URL } from '@/lib/pair/site';
import { detectPhone, isAppParent, isBwalletInAppUa } from '@/lib/pair/phoneUi';
import { WALLET_BAR as W } from '@/lib/walletBar';
import { openSiteWallet } from '@/lib/siteWallet';
import { useSiteWallet } from '@/lib/useSiteWallet';
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

/**
 * The official bWalletX sign-in button (<bwalletx-signin> from @bwalletx/connect: gold b mark, brand gradient,
 * radius and shadow; owner 28 Oct 2026: no knock-offs) in the arcade bar while signed out. Event-only mode: the
 * click runs this site's own connect (openSiteWallet), whose chooser also offers Get bWalletX. Connected, the bar's
 * handle chip takes its place. No wallet detected (or a phone that can't tell): a small "Get bWalletX" link under it.
 */
export function BwalletButton({ onSignIn, size = 'sm' }: { onSignIn: () => void; size?: 'sm' | 'md' | 'lg' }) {
  const presence = useWalletPresence();
  const signIn = (
    <span data-bwallet-button="sign-in" className="inline-flex shrink-0">
      <BwalletxSignin size={size} subtitle={size === 'sm' ? false : undefined} onClick={() => onSignIn()} />
    </span>
  );
  if (presence === 'installed') return signIn;
  return (
    <span className="flex shrink-0 flex-col items-center leading-none" data-bwallet-unknown={presence}>
      {signIn}
      <a href={GET_BWALLETX_URL} target="_blank" rel="noreferrer" className="mt-0.5 text-[10px] font-semibold underline" style={{ color: W.accent }} data-bwallet-get-link>
        Get bWalletX
      </a>
    </span>
  );
}

/**
 * The same yellow button for screens that hide the game bar (TERRORNODE's rotate prompt and phone-landscape loadout,
 * owner 28 Oct 2026). Renders nothing once a wallet is connected: the bar's chip has it then.
 */
export function SignedOutBwalletButton({ className = '', size = 'sm' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const site = useSiteWallet();
  if (site.wallet) return null;
  return (
    <span className={className}>
      <BwalletButton size={size} onSignIn={() => void openSiteWallet()} />
    </span>
  );
}
