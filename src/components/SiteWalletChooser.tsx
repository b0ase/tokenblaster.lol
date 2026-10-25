'use client';

import { useEffect, useId, useSyncExternalStore } from 'react';
import { closeChooser, connectEntry } from '@/lib/siteWallet';
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
  const { chooser } = useSiteWallet();
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
  if (!chooser || first !== id) return null;
  return <WalletChooser note={chooser.note} onPick={(e) => void connectEntry(e)} onClose={closeChooser} />;
}
