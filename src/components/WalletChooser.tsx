'use client';

import { useEffect, useState } from 'react';
import { discoverWallets, type WalletEntry } from '@/lib/discovery';

const KIND: Record<WalletEntry['kind'], string> = {
  extension: 'browser ext.',
  'in-app': 'this app',
  web: 'web wallet',
  desktop: 'this computer',
};

/**
 * "Connect a wallet": every wallet found, plus the phone (docs/wallet-connect.md §2).
 * The site never picks for the player.
 */
export function WalletChooser({ note, onPick, onClose }: { note?: string | null; onPick: (w: WalletEntry) => void; onClose: () => void }) {
  const [wallets, setWallets] = useState<WalletEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    discoverWallets()
      .then((w) => alive && setWallets(w))
      .catch(() => alive && setWallets([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="panel w-full max-w-md" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Connect a wallet">
        <div className="panel-header">
          <span className="panel-title">Connect a wallet</span>
          <button onClick={onClose} className="btn text-xs" aria-label="Close">
            ✕
          </button>
        </div>
        {note && <p className="mb-2 text-sm text-hot">{note}</p>}
        {wallets === null && (
          <p className="text-dim">
            Looking for wallets<span className="blink">…</span>
          </p>
        )}
        {wallets?.length === 0 && <p className="text-dim">No wallet found in this browser.</p>}
        <ul className="flex flex-col gap-1">
          {wallets?.map((w) => (
            <li key={w.id}>
              <button onClick={() => onPick(w)} className="inset flex w-full items-center gap-3 px-3 py-2 text-left hover:border-fg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {w.icon ? <img src={w.icon} alt="" className="h-6 w-6" /> : <span className="h-6 w-6 bg-muted" />}
                <span className="flex-1 text-hot">{w.name}</span>
                <span className="text-xs text-dim">{KIND[w.kind]}</span>
                <span className="text-accent">›</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="inset mt-3 flex items-center gap-3 px-3 py-2 opacity-60">
          <span className="grid h-10 w-10 place-items-center bg-input text-xs text-dim">QR</span>
          <span className="flex-1">
            <span className="block text-hot">Use bWallet on your phone</span>
            <span className="text-xs text-dim">Scan to connect: coming soon</span>
          </span>
        </div>
        {wallets && wallets.length > 1 && wallets.some((w) => w.id === 'window.CWI') && (
          <p className="mt-2 text-xs text-dim">
            &quot;{wallets.find((w) => w.id === 'window.CWI')?.name}&quot; is whichever extension claimed window.CWI last. Wallets that
            announce themselves are listed by name.
          </p>
        )}
        <p className="mt-3 text-xs text-dim">
          No wallet?{' '}
          <a href="https://bwallet.space" target="_blank" rel="noreferrer" className="text-accent hover:text-hot">
            Get bWallet →
          </a>
        </p>
      </div>
    </div>
  );
}
