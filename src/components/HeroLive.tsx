'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeStatus, subscribeTx } from '@/lib/chainStream';
import type { FeedTx } from '@/lib/feed';

/**
 * Hero live strip: scrolling hazard tape, a TX/SEC readout and a marquee of live token moves, all from the page's one
 * shared chain stream (src/lib/chainStream.ts). Transactions land in refs; React state refreshes once a second.
 */
const FALLBACK = ['LOAD YOUR TOKENS', 'EVERY BULLET = ONE REAL BSV TX', 'BLAST THE CHAIN', 'PLAY THE ARCADE', 'OWN YOUR GUNS', 'LAUNCH A COIN ON BLASTPAD'];

const line = (f: FeedTx) => {
  const what = f.appName ?? f.kind.toUpperCase();
  const tok = f.token ? ` · ${f.token.slice(0, 6)}…` : '';
  return `${what}${tok} · ${f.sats.toLocaleString()} sat`;
};

export function HeroLive() {
  const stamps = useRef<number[]>([]);
  const recent = useRef<string[]>([]);
  const [rate, setRate] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const offS = subscribeStatus((s) => setStatus(s));
    const offT = subscribeTx((f) => {
      stamps.current.push(Date.now());
      if (f.token || f.kind === 'blast' || f.kind === 'inscription') {
        recent.current.unshift(line(f));
        if (recent.current.length > 14) recent.current.pop();
      }
    });
    const t = setInterval(() => {
      const now = Date.now();
      stamps.current = stamps.current.filter((x) => now - x < 5000);
      setRate(stamps.current.length / 5);
      setLines((old) => (recent.current.length && recent.current[0] !== old[0] ? [...recent.current] : old));
    }, 1000);
    return () => {
      offS();
      offT();
      clearInterval(t);
    };
  }, []);

  const live = status === 'live';
  const items = lines.length >= 4 ? lines : FALLBACK;
  const row = (k: string) => (
    <ul className="flex shrink-0" aria-hidden={k !== ''}>
      {items.map((x, n) => (
        <li key={`${k}${n}`} className="dr-code flex shrink-0 items-center gap-2 px-4 !text-[11px] !text-[var(--text)]">
          <span className="inline-block h-2 w-1.5 bg-[var(--accent-fill)] [clip-path:polygon(0_0,100%_50%,0_100%)]" aria-hidden />
          {x}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="border-t-2 border-[var(--hot)] bg-bg">
      <div className="dr-tape" aria-hidden />
      <div className="flex items-stretch">
        <div className="flex shrink-0 items-center gap-2.5 border-r-2 border-[var(--hot)] bg-[var(--accent-fill)] px-3 py-1.5 text-[var(--on-accent)]">
          <span className={`inline-block h-2.5 w-2.5 rounded-full bg-[var(--on-accent)] ${live ? 'blink' : 'opacity-60'}`} aria-hidden />
          <span className="dr-display text-[26px] leading-none tabular-nums" aria-label={live ? `${rate.toFixed(1)} transactions per second` : 'chain stream offline'}>
            {live ? rate.toFixed(1) : '--'}
          </span>
          <span className="dr-code !text-[10px] !leading-tight !text-[var(--on-accent)]">
            TX/SEC
            <br />
            {live ? 'LIVE' : status.toUpperCase()}
          </span>
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden py-2" aria-label="Live token moves">
          <div className="ticker-track flex w-max">
            {row('')}
            {row('b')}
          </div>
        </div>
      </div>
    </div>
  );
}
