'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { rememberWallet } from '@/lib/discovery';
import { short, useBsvUsd } from './data';

const LINKS = [
  ['/launch', 'Board'],
  ['/launch/new', 'Launch'],
  ['/launch/rewards', 'Rewards'],
  ['/launch/leaders', 'Leaders'],
  ['/launch/mine', 'My coins'],
  ['/launch/how', 'How it works'],
] as const;

export function LaunchNav({ wallet, onConnect, busy }: { wallet?: { address: string } | null; onConnect?: () => void; busy?: boolean }) {
  const path = usePathname();
  const rate = useBsvUsd();
  return (
    <header className="panel flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/launch" className="dr-display dr-logo text-xl text-hot">
          BLAST<span className="text-[var(--accent)]">PAD</span>
          <span className="blink">_</span>
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={`btn ${path === href ? 'btn-on' : ''}`}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        {rate > 0 && <span className="text-dim">BSV ${rate.toFixed(2)}</span>}
        <Link href="/" className="text-dim hover:text-hot">
          TokenBlaster.lol
        </Link>
        {onConnect &&
          (wallet ? (
            <WalletBadge address={wallet.address} />
          ) : (
            <button className="btn" onClick={onConnect} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect wallet'}
            </button>
          ))}
      </div>
    </header>
  );
}

/** The connected wallet: click for Copy address and Disconnect (forgets the wallet so it doesn't reconnect). */
function WalletBadge({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <span className="relative">
      <button className="btn btn-on" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {short(address)} ▾
      </button>
      {open && (
        <span role="menu" className="panel absolute right-0 top-full z-50 mt-1 flex w-56 flex-col gap-1 p-2 text-sm">
          <span className="break-all text-xs text-muted">{address}</span>
          <button
            role="menuitem"
            className="btn"
            onClick={() => navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined)}
          >
            {copied ? 'Copied ✓' : 'Copy address'}
          </button>
          <button
            role="menuitem"
            className="btn btn-fire"
            onClick={() => {
              rememberWallet(null);
              location.reload();
            }}
          >
            Disconnect
          </button>
        </span>
      )}
    </span>
  );
}
