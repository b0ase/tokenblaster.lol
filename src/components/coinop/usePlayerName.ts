'use client';
import { useSyncExternalStore } from 'react';
import { getBarWallet, subBarWallet } from '@/lib/walletBar';
import { playerNameFrom } from '@/lib/coinop/credit';

/**
 * The player's NAME (owner, 25 Oct 2026): always the connected wallet's paymail, as the top bar shows it. Not
 * typed, not editable, not optional. No paymail yet: the identity key's short form, and `hasPaymail` false so
 * the cabinet can show a "Get a name" link. No wallet (or it stopped answering): no name.
 */
export function usePlayerName(): { name: string; hasPaymail: boolean } {
  const bar = useSyncExternalStore(subBarWallet, getBarWallet, () => null);
  return playerNameFrom(bar && bar.live !== false ? bar : null);
}
