'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getSiteWallet, resumeSiteWallet, subSiteWallet, type SiteWalletState } from './siteWallet';

const server = (): SiteWalletState => ({ wallet: null, live: true, busy: false, error: null, chooser: null });
let serverSnap: SiteWalletState | null = null;

/** The site's one wallet (src/lib/siteWallet.ts). Mounting any user resumes the remembered wallet once. */
export function useSiteWallet(): SiteWalletState {
  const s = useSyncExternalStore(subSiteWallet, getSiteWallet, () => (serverSnap ??= server()));
  useEffect(() => resumeSiteWallet(), []);
  return s;
}
