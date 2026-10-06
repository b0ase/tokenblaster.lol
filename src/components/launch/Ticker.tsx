'use client';

import Link from 'next/link';
import { bsv, imageOf, short, type Trade } from './data';

/** The live tape: the latest trades scrolling across the top of the board and coin pages. */
export function Ticker({ feed }: { feed: Trade[] }) {
  const items = feed.filter((t) => t.side !== 'burn').slice(0, 24);
  if (!items.length) return null;
  const row = (key: string) =>
    items.map((t) => (
      <Link key={`${key}${t.txid}`} href={`/launch/${t.token_id}`} className="flex shrink-0 items-center gap-2 px-3 hover:text-hot" tabIndex={key ? -1 : 0}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageOf(t.token_id)} alt="" className="h-5 w-5 rounded object-cover" />
        <span className="font-bold">${t.sym}</span>
        <span className={t.side === 'buy' ? 'text-green-400' : t.side === 'sell' ? 'text-red-400' : 'text-accent'}>
          {t.side === 'launch' ? 'launched' : t.side === 'buy' ? `bought ${bsv(t.curve_sats)}` : `sold ${bsv(t.curve_sats)}`}
        </span>
        <span className="text-muted">{short(t.trader)}</span>
      </Link>
    ));
  return (
    <div className="panel flex items-center gap-2 overflow-hidden py-1.5 text-sm">
      <span className="shrink-0 pr-2 text-xs text-accent">
        ● LIVE<span className="blink">_</span>
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="ticker-track flex w-max">
          <div className="flex">{row('')}</div>
          <div className="flex" aria-hidden>
            {row('b')}
          </div>
        </div>
      </div>
    </div>
  );
}
