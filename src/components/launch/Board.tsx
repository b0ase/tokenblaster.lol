'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ROUTES } from '@/lib/launch/shape';
import { LaunchNav } from './LaunchNav';
import { ago, bsv, change24, graduated, imageOf, mcapSats, pct, short, usd, useBsvUsd, usePoll, useWatchlist, type BoardCoin, type Trade } from './data';
import { useLaunchWallet } from './useLaunchWallet';

const TABS = ['Trending', 'New', 'Market cap', 'About to graduate', 'Graduated', 'Watchlist'] as const;
type Tab = (typeof TABS)[number];

function sortCoins(coins: BoardCoin[], tab: Tab, watch: string[]) {
  const c = [...coins];
  switch (tab) {
    case 'New':
      return c.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'Market cap':
      return c.sort((a, b) => b.sold - a.sold);
    case 'About to graduate':
      return c.filter((x) => !graduated(x)).sort((a, b) => b.sold - a.sold);
    case 'Graduated':
      return c.filter(graduated).sort((a, b) => (a.grad_rank ?? 0) - (b.grad_rank ?? 0));
    case 'Watchlist':
      return c.filter((x) => watch.includes(x.token_id));
    default:
      // Trending: 24h volume, then trades, then recency.
      return c.sort((a, b) => b.vol24 - a.vol24 || b.trades24 - a.trades24 || b.created_at.localeCompare(a.created_at));
  }
}

export function Board() {
  const { wallet, open, busy, chooserEl } = useLaunchWallet();
  const [data] = usePoll<{ coins: BoardCoin[]; feed: Trade[]; error?: string }>('/api/launch/coins', 4000, { coins: [], feed: [] });
  const rate = useBsvUsd();
  const [tab, setTab] = useState<Tab>('Trending');
  const [route, setRoute] = useState<string>('all');
  const [q, setQ] = useState('');
  const { list: watch, toggle } = useWatchlist();

  const coins = useMemo(() => {
    let c = sortCoins(data.coins, tab, watch);
    if (route !== 'all') c = c.filter((x) => x.route.kind === route);
    const s = q.trim().toLowerCase().replace(/^\$/, '');
    if (s) c = c.filter((x) => x.sym.toLowerCase().includes(s) || x.name.toLowerCase().includes(s));
    return c;
  }, [data.coins, tab, route, q, watch]);

  const trending = useMemo(() => sortCoins(data.coins, 'Trending', []).slice(0, 10), [data.coins]);
  const king = useMemo(() => data.coins.filter((c) => !graduated(c)).sort((a, b) => b.sold - a.sold)[0], [data.coins]);
  const vol24 = data.coins.reduce((n, c) => n + c.vol24, 0);

  return (
    <main className="mx-auto flex w-full max-w-[1300px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={busy} />
      {chooserEl}

      {trending.length > 0 && (
        <div className="panel flex gap-2 overflow-x-auto text-sm">
          {trending.map((c, i) => (
            <Link key={c.token_id} href={`/launch/${c.token_id}`} className="inset flex shrink-0 items-center gap-2 px-2 py-1 hover:border-line">
              <span className="text-muted">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageOf(c.token_id)} alt="" className="h-6 w-6 rounded object-cover" />
              <span className="font-bold">{c.sym}</span>
              <span className="text-dim">MC {rate ? usd(mcapSats(c.sold), rate) : bsv(mcapSats(c.sold))}</span>
              <Change v={change24(c)} />
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-3">
          <section className="panel grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted">{'// BLASTPAD · BSV-21 LAUNCHPAD ON TOKENBLASTER.LOL'}</p>
              <h1 className="mt-2 text-3xl font-bold text-hot">
                Launch a coin.
                <br />
                Blast it up the curve.
              </h1>
              <p className="mt-2 text-dim">
                Every coin starts on a bonding curve with a fixed supply of 1,000,000,000. Buying moves the price up, selling moves it down, and each trade
                settles as one atomic BSV transaction. Then take it into the games: every coin here is ammo in the Arena and the gun.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/launch/new" className="btn btn-fire">
                  Launch a coin ▸
                </Link>
                <a href="#board" className="btn">
                  Browse the board
                </a>
                <Link href="/launch/how" className="btn">
                  How it works
                </Link>
              </div>
              <p className="mt-3 text-xs text-muted">1.0% a trade (0.70% house + 0.30% to the coin’s route) · launch 25,000 sats</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Coins launched" value={String(data.coins.length)} />
                <Stat label="24h volume" value={rate ? usd(vol24, rate) : bsv(vol24)} />
              </div>
              {king && (
                <Link href={`/launch/${king.token_id}`} className="inset flex gap-3 p-3 hover:border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageOf(king.token_id)} alt="" className="h-20 w-20 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-accent">👑 King of the hill</p>
                    <p className="font-bold text-hot">
                      ${king.sym} <span className="text-dim">{king.name}</span>
                    </p>
                    <p className="text-sm text-dim">Market cap {rate ? usd(mcapSats(king.sold), rate) : bsv(mcapSats(king.sold))}</p>
                    <Progress v={pct(king.sold)} />
                    <p className="text-xs text-muted">{(pct(king.sold) * 100).toFixed(1)}% of the curve sold · graduates at 100%</p>
                  </div>
                </Link>
              )}
            </div>
          </section>

          <section id="board" className="panel flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1">
              {TABS.map((t) => (
                <button key={t} className={`btn text-sm ${tab === t ? 'btn-on' : ''}`} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input className="inset min-w-[200px] flex-1 px-2 py-1" placeholder="Filter by name or $ticker" value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="text-muted">Creator fee goes to</span>
              <select className="inset px-2 py-1" value={route} onChange={(e) => setRoute(e.target.value)}>
                <option value="all">Any</option>
                {ROUTES.map((r) => (
                  <option key={r.kind} value={r.kind}>
                    {r.title}
                  </option>
                ))}
              </select>
              <span className="text-muted">{coins.length} coins</span>
            </div>
            {data.error && !data.coins.length && <p className="text-dim">The board is not open yet.</p>}
            {!data.error && !coins.length && (
              <p className="text-dim">
                Nothing here yet. <Link href="/launch/new" className="text-hot underline">Launch the first coin</Link>.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {coins.map((c) => (
                <CoinCard key={c.token_id} c={c} rate={rate} watched={watch.includes(c.token_id)} onWatch={() => toggle(c.token_id)} />
              ))}
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3">
          <Link href="/arena" className="panel block hover:border-hot">
            <p className="text-xs text-accent">Play with your coins</p>
            <p className="font-bold text-hot">Arena: shoot with any coin ▸</p>
            <p className="text-sm text-dim">Every BlastPad coin you hold is ammo. Each shot is a real transaction of your token.</p>
          </Link>
          <div className="panel">
            <p className="panel-title mb-2">
              Live<span className="blink">_</span>
            </p>
            <ul className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto text-sm">
              {data.feed.map((t) => (
                <li key={t.txid} className="inset flex items-center justify-between gap-2 px-2 py-1">
                  <Link href={`/launch/${t.token_id}`} className="font-bold hover:text-hot">
                    ${t.sym}
                  </Link>
                  <span className={t.side === 'buy' ? 'text-green-400' : t.side === 'sell' ? 'text-red-400' : 'text-accent'}>
                    {t.side === 'launch' ? 'launched' : t.side === 'buy' ? 'bought' : t.side === 'sell' ? 'sold' : t.side}
                  </span>
                  <span className="text-dim">{t.side === 'launch' ? '' : bsv(t.curve_sats)}</span>
                  <span className="text-muted">{short(t.trader)}</span>
                  <span className="text-muted">{ago(t.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <p className="text-center text-xs text-muted">
        Memecoins are toys. Prices can go to zero, and every trade is final on-chain. Only spend what you are happy to lose.
      </p>
    </main>
  );
}

export function Change({ v }: { v: number }) {
  return <span className={v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-muted'}>{`${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`}</span>;
}

export function Progress({ v }: { v: number }) {
  return (
    <div className="my-1 h-2 w-full overflow-hidden rounded bg-input">
      <div className="h-full bg-accent" style={{ width: `${Math.min(100, v * 100)}%` }} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold text-hot">{value}</p>
    </div>
  );
}

function CoinCard({ c, rate, watched, onWatch }: { c: BoardCoin; rate: number; watched: boolean; onWatch: () => void }) {
  const grad = graduated(c);
  const route = ROUTES.find((r) => r.kind === c.route.kind);
  return (
    <div className="inset relative flex gap-3 p-2 hover:border-line">
      <Link href={`/launch/${c.token_id}`} className="absolute inset-0" aria-label={`$${c.sym}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageOf(c.token_id)} alt="" className="h-24 w-24 shrink-0 rounded object-cover" loading="lazy" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-bold text-hot">
            ${c.sym} {grad && <span className="text-xs text-accent">GRAD #{c.grad_rank ?? '?'}</span>}
          </p>
          <button onClick={onWatch} className="relative z-10 text-lg leading-none" title={watched ? 'Unwatch' : 'Watch'}>
            {watched ? '★' : '☆'}
          </button>
        </div>
        <p className="truncate text-dim">{c.name}</p>
        <p className="text-xs text-muted">
          {short(c.creator)} · {ago(c.created_at)} ago {route && route.kind !== 'creator' && <span className="text-accent">· {route.short}</span>}
        </p>
        <p className="line-clamp-2 text-xs text-dim">{c.description}</p>
        <div className="mt-1 flex items-center justify-between">
          <span>MC {rate ? usd(mcapSats(c.sold), rate) : bsv(mcapSats(c.sold))}</span>
          <Change v={change24(c)} />
        </div>
        <Progress v={pct(c.sold)} />
        <p className="text-xs text-muted">
          {c.holders} holders · {grad ? 'graduated' : `${(pct(c.sold) * 100).toFixed(1)}%`}
        </p>
      </div>
    </div>
  );
}
