'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cancelSiteWalletWait, closeChooser, openSiteWallet, pickWallet } from '@/lib/siteWallet';
import { useSiteWallet } from '@/lib/useSiteWallet';
import { WalletChooser } from './WalletChooser';

/**
 * The ONE wallet chooser. Every page and the top bar mount this; only the first mounted one renders, so a page with
 * the top bar and its own Connect button still shows a single chooser, and whichever button opened it, the wallet
 * picked is the site's wallet everywhere.
 */
const hosts: string[] = [];
const hostSubs = new Set<() => void>();
const firstHost = () => hosts[0] ?? null;
const subHosts = (f: () => void) => (hostSubs.add(f), () => void hostSubs.delete(f));
const ping = () => hostSubs.forEach((f) => f());

export function SiteWalletChooser() {
  const id = useId();
  const { chooser, waiting } = useSiteWallet();
  useEffect(() => {
    hosts.push(id);
    ping();
    return () => {
      const i = hosts.indexOf(id);
      if (i >= 0) hosts.splice(i, 1);
      ping();
    };
  }, [id]);
  const first = useSyncExternalStore(subHosts, firstHost, () => null);
  if (first !== id || typeof document === 'undefined') return null;
  // Portalled to <body> (owner, 25 Oct: "won't connect to my wallet"): the first host is often the site nav, which a
  // game page hides (display:none), so the chooser and the waiting card rendered inside it were invisible.
  return createPortal(
    <>
      {/* Every click on a row looks for the wallet again and asks it afresh (owner, 25 Oct: the row did nothing). */}
      {chooser && <WalletChooser note={chooser.note} onPick={(e) => void pickWallet(e)} onClose={closeChooser} />}
      {waiting && <SiteWalletWaiting text={waiting.text} since={waiting.since} kind={waiting.kind} />}
    </>,
    document.body,
  );
}

/**
 * Whenever we wait on the wallet, say so, with a way out (owner, 25 Oct 2026: Connect and LOCK & LOAD did nothing,
 * with no prompt and no error). Cancel frees the wallet queue; Try again re-runs discovery and connect.
 */
function SiteWalletWaiting({ text, since, kind }: { text: string; since: number; kind: 'discover' | 'connect' | 'pay' }) {
  const [now, setNow] = useState(() => since);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - since) / 1000));
  const retry = () => {
    cancelSiteWalletWait();
    if (kind !== 'pay') void openSiteWallet();
  };
  return (
    <div role="status" aria-live="polite" data-testid="wallet-waiting" className="fixed bottom-4 left-1/2 z-[1000] w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-white/15 bg-black/90 p-4 text-sm text-white shadow-2xl">
      <div className="flex items-center gap-3">
        <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
        <span className="flex-1">{text}</span>
        <span className="text-xs text-white/50 tabular-nums">{secs}s</span>
      </div>
      {kind === 'pay' && <p className="mt-2 text-xs text-white/60">If you cancel here and the wallet already paid, the coin is in your gun: you will not be charged twice.</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" data-testid="wallet-waiting-cancel" onClick={cancelSiteWalletWait} className="rounded-md border border-white/20 px-3 py-1.5 hover:bg-white/10">Cancel</button>
        {kind !== 'pay' && <button type="button" data-testid="wallet-waiting-retry" onClick={retry} className="rounded-md bg-white px-3 py-1.5 font-semibold text-black hover:bg-white/90">Try again</button>}
      </div>
    </div>
  );
}
