'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
        <Link href="/launch" className="text-xl font-bold text-hot">
          BLAST<span className="text-fg">PAD</span>
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
            <span className="btn btn-on">{short(wallet.address)}</span>
          ) : (
            <button className="btn" onClick={onConnect} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect wallet'}
            </button>
          ))}
      </div>
    </header>
  );
}
