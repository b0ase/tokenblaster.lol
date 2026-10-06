'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ROUTES } from '@/lib/launch/shape';
import { LaunchNav } from './LaunchNav';
import { Ticker } from './Ticker';
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

  const trending = useMemo(() => sortCoins(data.coins, 'Trending', []).slice(0, 8), [data.coins]);
  const fresh = useMemo(() => sortCoins(data.coins, 'New', []).slice(0, 6), [data.coins]);
  const king = useMemo(() => data.coins.filter((c) => !graduated(c)).sort((a, b) => b.sold - a.sold)[0], [data.coins]);
  const vol24 = data.coins.reduce((n, c) => n + c.vol24, 0);
  const grads = data.coins.filter(graduated).length;
  const routeCount = (k: string) => data.coins.filter((c) => c.route.kind === k).length;
  const money = (sats: number) => (rate ? usd(sats, rate) : bsv(sats));

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={busy} />
      {chooserEl}
      <Ticker feed={data.feed} />

      <div className="grid gap-3 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_260px]">
        <aside className="order-2 flex flex-col gap-3 lg:order-1">
          <SideList title="🔥 Trending" coins={trending} rate={rate} />
          <GameTile href="/arena" img="/arcade/arena.jpg" kicker="Horde survival" title="Arena" text="Every BlastPad coin you hold is ammo. Each shot is a real transaction of your token." />
          <GameTile href="/arcade/doubleosatoshi" img="/arcade/doubleo.jpg" kicker="Spy shooter" title="Double-O Satoshi" text="Five missions, co-op, live token play." />
        </aside>

        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          <section className="panel grid gap-4 md:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="text-xs text-muted">
                <span className="border border-hot px-1.5 py-0.5 text-hot">BLASTPAD</span> {'// BSV-21 LAUNCHPAD ON TOKENBLASTER.LOL'}
              </p>
              <h1 className="mt-3 text-4xl font-bold leading-tight text-hot sm:text-5xl">
                Launch a coin.
                <br />
                <span className="text-fg">Blast it up the curve.</span>
              </h1>
              <p className="mt-3 text-dim">
                Every coin starts on a bonding curve with a fixed supply of 1,000,000,000. Buying moves the price up, selling moves it down, and each trade
                settles as one atomic BSV transaction. Then take it into the games: every coin here is ammo in the Arena and the gun.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
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
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <Stat label="Coins launched" value={String(data.coins.length)} sub="on the board" />
                <Stat label="24h volume" value={money(vol24)} sub={rate ? bsv(vol24) : ''} />
                <Stat label="Graduated" value={String(grads)} sub="curve sold out" />
              </div>
              <p className="mt-3 text-xs text-muted">1.0% a trade (0.70% house + 0.30% to the coin’s route) · launch 0.10025 BSV (0.1 of it funds the token’s index)</p>
            </div>
            {king ? (
              <Link href={`/launch/${king.token_id}`} className="inset flex flex-col justify-center gap-3 border-hot p-4 shadow-[0_0_24px_-6px_var(--hot)] hover:border-fg">
                <div className="flex items-center justify-between text-xs">
                  <span className="whitespace-nowrap text-accent">👑 KING OF THE HILL</span>
                  <span className="hidden text-right text-muted 2xl:inline">top market cap still on the curve</span>
                </div>
                <div className="flex gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageOf(king.token_id)} alt="" className="h-24 w-24 rounded object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-2xl font-bold text-hot">${king.sym}</p>
                    <p className="truncate text-dim">{king.name}</p>
                    <p className="mt-1 text-sm">
                      Market cap <span className="text-lg font-bold text-hot">{money(mcapSats(king.sold))}</span>
                    </p>
                    <p className="text-xs">
                      24h <Change v={change24(king)} /> · <span className="text-muted">{short(king.creator)}</span>
                    </p>
                  </div>
                </div>
                <Segments v={pct(king.sold)} />
                <div className="flex justify-between text-xs text-muted">
                  <span>{(pct(king.sold) * 100).toFixed(1)}% of the curve sold</span>
                  <span>graduates at 100%</span>
                </div>
              </Link>
            ) : (
              <div className="inset flex flex-col items-center justify-center gap-2 p-4 text-center">
                <p className="text-accent">👑 King of the hill</p>
                <p className="text-dim">No one holds the hill yet. The top coin still on its curve sits here.</p>
                <Link href="/launch/new" className="btn btn-fire">
                  Take it ▸
                </Link>
              </div>
            )}
          </section>

          <section id="board" className="panel flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-2 font-bold text-hot">{'// THE BOARD'}</span>
              {TABS.map((t) => (
                <button key={t} className={`btn text-sm ${tab === t ? 'btn-on' : ''}`} onClick={() => setTab(t)}>
                  {t === 'Watchlist' ? '☆ Watchlist' : t}
                </button>
              ))}
              <input className="inset ml-auto min-w-[180px] px-2 py-1 text-sm" placeholder="Filter by name or $ticker" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="mr-1 text-muted">Creator fee goes to</span>
              <button className={`btn ${route === 'all' ? 'btn-on' : ''}`} onClick={() => setRoute('all')}>
                Any
              </button>
              {ROUTES.map((r) => (
                <button key={r.kind} className={`btn ${route === r.kind ? 'btn-on' : ''}`} onClick={() => setRoute(r.kind)} title={r.about}>
                  {r.title} <span className="text-muted">{routeCount(r.kind)}</span>
                </button>
              ))}
              <span className="ml-auto text-muted">{coins.length} coins</span>
            </div>
            {data.error && !data.coins.length && <p className="text-dim">The board is not open yet.</p>}
            {!data.error && !coins.length && (
              <p className="text-dim">
                Nothing here yet. <Link href="/launch/new" className="text-hot underline">Launch the first coin</Link>.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {coins.map((c) => (
                <CoinCard key={c.token_id} c={c} rate={rate} watched={watch.includes(c.token_id)} onWatch={() => toggle(c.token_id)} />
              ))}
            </div>
          </section>
        </div>

        <aside className="order-3 flex flex-col gap-3 lg:col-span-2 xl:col-span-1">
          <SideList title="✦ New coins" coins={fresh} rate={rate} />
          <GameTile href="/arcade/bsvgun" img="/arcade/bsvgun.jpg" kicker="Mass blaster" title="BSVGun" text="Storm the chain with your coin." />
          <div className="panel">
            <p className="panel-title mb-2">
              Live trades<span className="blink">_</span>
            </p>
            <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto text-xs">
              {data.feed.map((t) => (
                <li key={t.txid} className="inset flex items-center justify-between gap-2 px-2 py-1">
                  <Link href={`/launch/${t.token_id}`} className="font-bold hover:text-hot">
                    ${t.sym}
                  </Link>
                  <span className={t.side === 'buy' ? 'text-green-400' : t.side === 'sell' ? 'text-red-400' : 'text-accent'}>
                    {t.side === 'launch' ? 'launched' : t.side === 'buy' ? 'bought' : t.side === 'sell' ? 'sold' : t.side}
                  </span>
                  <span className="text-dim">{t.side === 'launch' ? '' : bsv(t.curve_sats)}</span>
                  <span className="text-muted">{ago(t.created_at)}</span>
                </li>
              ))}
              {!data.feed.length && <li className="text-muted">No trades yet.</li>}
            </ul>
          </div>
        </aside>
      </div>

      <p className="text-center text-xs text-muted">
        <span className="text-hot">Memecoins are toys.</span> Prices can go to zero, and every trade is final on-chain. Only spend what you are happy to lose.
      </p>
    </main>
  );
}

function SideList({ title, coins, rate }: { title: string; coins: BoardCoin[]; rate: number }) {
  return (
    <div className="panel">
      <p className="panel-title mb-2">{title}</p>
      {!coins.length && <p className="text-xs text-muted">Nothing yet.</p>}
      <ol className="flex flex-col gap-1 text-sm">
        {coins.map((c, i) => (
          <li key={c.token_id}>
            <Link href={`/launch/${c.token_id}`} className="flex items-center gap-2 px-1 py-1 hover:bg-active">
              <span className="w-4 text-xs text-muted">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageOf(c.token_id)} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{c.sym}</span>
                <span className="block text-xs text-muted">MC {rate ? usd(mcapSats(c.sold), rate) : bsv(mcapSats(c.sold))}</span>
              </span>
              <span className="text-xs">
                <Change v={change24(c)} />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function GameTile({ href, img, kicker, title, text }: { href: string; img: string; kicker: string; title: string; text: string }) {
  return (
    <Link href={href} className="panel group block overflow-hidden p-0 hover:border-hot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img} alt="" className="h-32 w-full object-cover opacity-80 transition group-hover:opacity-100" loading="lazy" />
      <div className="p-3">
        <p className="text-xs text-accent">{kicker.toUpperCase()}</p>
        <p className="font-bold text-hot">{title}</p>
        <p className="text-xs text-dim">{text}</p>
        <span className="btn mt-2 inline-block text-xs">Play ▸</span>
      </div>
    </Link>
  );
}

/** Segmented curve bar: one cell per 2.5% sold, the leading edge glowing. */
export function Segments({ v }: { v: number }) {
  const n = 40;
  const lit = Math.min(n, Math.round(Math.min(1, v) * n));
  return (
    <div className="flex h-3 gap-[2px]" role="progressbar" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={`flex-1 ${i < lit ? (i === lit - 1 ? 'bg-hot shadow-[0_0_8px_var(--hot)]' : 'bg-accent') : 'bg-input'}`}
          style={i < lit ? { opacity: 0.45 + (0.55 * (i + 1)) / lit } : undefined}
        />
      ))}
    </div>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="inset p-2">
      <p className="text-xs text-muted">{label.toUpperCase()}</p>
      <p className="text-xl font-bold text-hot">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function CoinCard({ c, rate, watched, onWatch }: { c: BoardCoin; rate: number; watched: boolean; onWatch: () => void }) {
  const grad = graduated(c);
  const route = ROUTES.find((r) => r.kind === c.route.kind);
  const p = pct(c.sold);
  return (
    <div className={`inset relative flex flex-col gap-2 p-3 transition hover:border-hot ${grad ? 'border-accent' : ''}`}>
      <Link href={`/launch/${c.token_id}`} className="absolute inset-0" aria-label={`$${c.sym}`} />
      <div className="flex gap-3">
        <div className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageOf(c.token_id)} alt="" className="h-20 w-20 rounded object-cover" loading="lazy" />
          {grad && <span className="absolute bottom-0 left-0 bg-accent px-1 text-[10px] font-bold text-bg">GRAD #{c.grad_rank ?? '?'}</span>}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-base font-bold text-hot">${c.sym}</p>
            <span className="flex shrink-0 items-center gap-2">
              <span className="border border-line px-1 text-xs">
                <Change v={change24(c)} />
              </span>
              <button onClick={onWatch} className="relative z-10 text-lg leading-none" title={watched ? 'Unwatch' : 'Watch'} aria-label={watched ? 'Unwatch' : 'Watch'}>
                {watched ? '★' : '☆'}
              </button>
            </span>
          </div>
          <p className="truncate text-dim">{c.name}</p>
          <p className="text-xs text-muted">
            {short(c.creator)} · {ago(c.created_at)} ago {route && route.kind !== 'creator' && <span className="text-accent">· {route.short}</span>}
          </p>
          <p className="line-clamp-2 text-xs text-dim">{c.description}</p>
        </div>
      </div>
      <div className="flex items-end justify-between text-sm">
        <span>
          <span className="text-xs text-muted">MCAP </span>
          <span className="font-bold text-hot">{rate ? usd(mcapSats(c.sold), rate) : bsv(mcapSats(c.sold))}</span>
          {rate > 0 && <span className="ml-1 text-xs text-muted">{bsv(mcapSats(c.sold))}</span>}
        </span>
        <span className="text-xs text-muted" title="holders · trades in 24h">
          👥 {c.holders} · ⇄ {c.trades24}
        </span>
      </div>
      <Segments v={p} />
      <p className="flex justify-between text-xs text-muted">
        <span>{grad ? 'graduated · keeps trading on the curve' : `${(p * 100).toFixed(1)}% of the curve`}</span>
        <span className="text-accent">⌖ game ammo</span>
      </p>
    </div>
  );
}
