'use client';

import { disconnectSiteWallet, openSiteWallet } from '@/lib/siteWallet';
import { useSiteWallet } from '@/lib/useSiteWallet';
import { SiteWalletChooser } from '../SiteWalletChooser';

/**
 * The player's wallet for the launchpad pages: the site's ONE wallet (src/lib/siteWallet.ts). Connecting from the top
 * bar connects here too, and Connect here opens the same chooser.
 */
export function useLaunchWallet() {
  const { wallet, busy, error } = useSiteWallet();
  const open = () => void openSiteWallet();
  const chooserEl = <SiteWalletChooser />;
  return { wallet, open, disconnect: disconnectSiteWallet, busy, error, chooserEl };
}
