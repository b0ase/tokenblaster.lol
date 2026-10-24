'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cleanName } from '@/lib/coinop/credit';
import { getBarWallet, subBarWallet } from '@/lib/walletBar';

const KEY = 'tokenblaster.playerName';

/**
 * The player's NAME at the cabinet (owner, 24 Oct 2026: "my name is there from the paymail"). Filled in from the
 * connected wallet's paymail alias (b0asex@bwalletx.com → b0asex), else the last name typed on this device. The
 * player can still change it; a typed name is remembered.
 */
export function usePlayerName(): [string, (s: string) => void] {
  const bar = useSyncExternalStore(subBarWallet, getBarWallet, () => null);
  const [name, setNameState] = useState('');
  const typed = useRef(false);

  useEffect(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(KEY) ?? '';
    } catch {
      /* storage blocked */
    }
    if (saved && !typed.current) void Promise.resolve().then(() => setNameState((n) => n || saved));
  }, []);

  useEffect(() => {
    if (typed.current) return;
    const fromPaymail = cleanName(bar?.alias ?? bar?.paymail?.split('@')[0] ?? '');
    if (fromPaymail) void Promise.resolve().then(() => setNameState(fromPaymail));
  }, [bar?.alias, bar?.paymail]);

  const setName = (s: string) => {
    typed.current = true;
    setNameState(s);
    try {
      if (cleanName(s)) localStorage.setItem(KEY, s);
    } catch {
      /* storage blocked */
    }
  };
  return [name, setName];
}
