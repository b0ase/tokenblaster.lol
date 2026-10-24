'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cleanName } from '@/lib/coinop/credit';
import { getBarWallet, subBarWallet } from '@/lib/walletBar';

/**
 * The player's NAME at the cabinet (owner, 24 Oct 2026: "my name is there from the paymail"). Filled in from the
 * connected wallet's full paymail (b0asex@bwalletx.com) and cleared when the wallet disconnects (owner, 24 Oct:
 * no name may show while the wallet is disconnected). A typed name lasts for this page visit only.
 */
export function usePlayerName(): [string, (s: string) => void] {
  const bar = useSyncExternalStore(subBarWallet, getBarWallet, () => null);
  const [name, setNameState] = useState('');
  const typed = useRef(false);

  useEffect(() => {
    if (!bar || bar.live === false) {
      typed.current = false;
      try {
        localStorage.removeItem('tokenblaster.playerName'); // the old remembered name, no longer used
      } catch {
        /* storage blocked */
      }
      void Promise.resolve().then(() => setNameState(''));
      return;
    }
    if (typed.current) return;
    const fromPaymail = cleanName(bar.paymail ?? bar.alias ?? '');
    if (fromPaymail) void Promise.resolve().then(() => setNameState(fromPaymail));
  }, [bar, bar?.alias, bar?.paymail]);

  const setName = (s: string) => {
    typed.current = true;
    setNameState(s);
  };
  return [name, setName];
}
