'use client';

import { useCallback, useEffect, useState } from 'react';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from '@/lib/discovery';
import { connect, type Wallet } from '@/lib/wallet';
import { WalletChooser } from '../WalletChooser';

/** The player's wallet for the launchpad pages: reconnects the one picked last time, else the chooser. */
export function useLaunchWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [chooser, setChooser] = useState<{ note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async (entry: WalletEntry) => {
    setChooser(null);
    setError(null);
    setBusy(true);
    try {
      const w = await connect(entry);
      rememberWallet(entry.id);
      setWallet(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const open = useCallback(async () => {
    setError(null);
    setBusy(true);
    const all = await discoverWallets().catch(() => [] as WalletEntry[]);
    setBusy(false);
    const inApp = all.find((w) => w.kind === 'in-app');
    if (inApp) return pick(inApp);
    const id = rememberedWallet();
    const found = id ? all.find((w) => w.id === id) : null;
    if (found) return pick(found);
    setChooser({ note: id ? 'The wallet you used last time is not available any more.' : null });
  }, [pick]);

  // Quietly reconnect a remembered wallet on load (no chooser popping up uninvited).
  useEffect(() => {
    const id = rememberedWallet();
    if (!id) return;
    discoverWallets()
      .then((all) => {
        const found = all.find((w) => w.id === id) ?? all.find((w) => w.kind === 'in-app');
        if (found) return pick(found);
      })
      .catch(() => undefined);
  }, [pick]);

  const disconnect = useCallback(() => {
    rememberWallet(null);
    setWallet(null);
  }, []);

  const chooserEl = chooser ? <WalletChooser note={chooser.note} onPick={pick} onClose={() => setChooser(null)} /> : null;
  return { wallet, open, disconnect, busy, error, chooserEl };
}
