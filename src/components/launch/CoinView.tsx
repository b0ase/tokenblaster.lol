'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { GRAD_SOLD, MAX_BUY, MIN_BUY, SUPPLY, fmtTokens, quoteBuy, quoteSell } from '@/lib/launch/curve';
import { trade } from '@/lib/launch/client';
import { ROUTES } from '@/lib/launch/shape';
import { tokenCoins } from '@/lib/tokens';
import { Change, Segments } from './Board';
import { LaunchNav } from './LaunchNav';
import { PriceChart } from './PriceChart';
import { Ticker } from './Ticker';
import { ago, bsv, graduated, imageOf, mcapSats, pct, priceSats, short, usd, useBsvUsd, useNow, usePoll, useWatchlist, type BoardCoin, type Trade } from './data';
import { useLaunchWallet } from './useLaunchWallet';

type Coin = {
  slot: string;
  token_id: string;
  sym: string;
  name: string;
  description: string;
  creator: string;
  creator_key: string;
  route: { kind: 'creator' | 'split' | 'holders' | 'buyback'; to?: { address: string; bps: number }[] };
  launch_msg: string;
  launch_sig: string;
  token_address: string;
  reserve_address: string;
  vault_address: string;
  fund_address: string | null;
  sold: number;
  reserve_sats: number;
  token_amt: number;
  burned: number;
  route_accrued: number;
  ath_sold: number;
  graduated_at: string | null;
  grad_rank: number | null;
  created_at: string;
};
type Reserves = { expected: { bsv: number; tokens: number }; ledger: { bsv: number; tokens: number }; chain: { bsv: number | null; tokens: number | null; checkedAt: number } };

const WOC = 'https://whatsonchain.com';
const WINDOWS = [
  ['5M', 300_000],
  ['1H', 3_600_000],
  ['6H', 21_600_000],
  ['24H', 86_400_000],
] as const;

/** Curve position at the start of a window: the newest trade older than it (newest-first list), else the launch (0 sold). */
function soldAt(trades: Trade[], now: number, ms: number) {
  return trades.find((t) => now - new Date(t.created_at).getTime() >= ms)?.sold_after ?? 0;
}

export function CoinView({ id }: { id: string }) {
  const { wallet, open, busy, chooserEl } = useLaunchWallet();
  const rate = useBsvUsd();
  const [data, refreshCoin] = usePoll<{ coin?: Coin; reserves?: Reserves; indexed?: boolean | null; error?: string }>(`/api/launch/coin?token=${id}`, 5000, {});
  const [tr, refreshTrades] = usePoll<{ trades: Trade[] }>(`/api/launch/trades?token=${id}&limit=1000`, 5000, { trades: [] });
  const [board] = usePoll<{ coins: BoardCoin[]; feed: Trade[] }>('/api/launch/coins', 8000, { coins: [], feed: [] });
  const { list: watch, toggle } = useWatchlist();
  const [copied, setCopied] = useState(false);
  const now = useNow();
  const c = data.coin;
  const trades = tr.trades;

  const holders = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades) if (t.side === 'buy' || t.side === 'sell') m.set(t.trader, (m.get(t.trader) ?? 0) + (t.side === 'buy' ? t.tokens : -t.tokens));
    return [...m].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  }, [trades]);
  const kingId = useMemo(() => board.coins.filter((x) => !graduated(x)).sort((a, b) => b.sold - a.sold)[0]?.token_id, [board.coins]);

  const shell = (body: React.ReactNode) => (
    <Shell wallet={wallet} open={open} busy={busy} chooserEl={chooserEl} feed={board.feed}>
      {body}
    </Shell>
  );
  if (data.error) return shell(<p className="panel text-dim">{data.error}</p>);
  if (!c) return shell(<p className="panel text-dim">Loading…</p>);

  const sold = c.sold;
  const grad = Boolean(c.graduated_at);
  const devHeld = holders.find(([a]) => a === c.creator)?.[1] ?? 0;
  const top10 = holders.slice(0, 10).reduce((n, [, v]) => n + v, 0);
  const route = ROUTES.find((r) => r.kind === c.route.kind)!;
  const day = trades.filter((t) => now - new Date(t.created_at).getTime() < 86_400_000 && (t.side === 'buy' || t.side === 'sell') && !t.mm);
  const changeOver = (ms: number) => {
    const then = priceSats(soldAt(trades, now, ms));
    return then > 0 ? (priceSats(sold) / then - 1) * 100 : 0;
  };
  const money = (sats: number) => (rate ? usd(sats, rate) : bsv(sats));
  const icon = `${c.token_id.split('_')[0]}_0`;
  const deployTx = c.token_id.split('_')[0];
  const share = () => {
    const text = `$${c.sym} is on BlastPad: ${money(mcapSats(sold))} market cap, ${(pct(sold) * 100).toFixed(1)}% up the curve. Every coin is ammo in the TokenBlaster games.`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.href)}`, '_blank', 'noopener');
  };
  const copy = () => {
    navigator.clipboard?.writeText(location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return shell(
    <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-3">
        <section className="panel flex flex-wrap gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageOf(c.token_id)} alt="" className="h-28 w-28 rounded object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              <Link href="/launch" className="hover:text-hot">
                ← Board
              </Link>
            </p>
            <h1 className="flex flex-wrap items-center gap-2 text-3xl font-bold text-hot">
              {c.name} <span className="text-xl text-fg">${c.sym}</span>
              {grad ? (
                <span className="border border-accent px-1.5 text-xs text-accent">GRAD #{c.grad_rank}</span>
              ) : (
                <span className="border border-green-400 px-1.5 text-xs text-green-400">● LIVE</span>
              )}
              {kingId === c.token_id && <span className="border border-hot px-1.5 text-xs text-hot shadow-[0_0_10px_-2px_var(--hot)]">👑 KING OF THE HILL</span>}
            </h1>
            <p className="mt-1 text-xs text-muted">
              Token{' '}
              <a className="underline" href={`${WOC}/tx/${deployTx}`} target="_blank" rel="noreferrer">
                {short(deployTx)}_{c.token_id.split('_')[1]}
              </a>{' '}
              · Dev{' '}
              <a className="underline" href={`${WOC}/address/${c.creator}`} target="_blank" rel="noreferrer">
                {short(c.creator)}
              </a>{' '}
              · launched {ago(c.created_at)} ago
            </p>
            <p className="mt-1 text-sm text-dim">{c.description}</p>
          </div>
          <div className="flex w-full flex-col gap-1 text-xs sm:w-auto sm:items-end">
            <div className="flex flex-wrap gap-1 sm:justify-end">
              <span className="btn">✓ Fixed supply</span>
              <span className="btn">✓ No mint</span>
              <span className="btn">Dev {((devHeld / Number(SUPPLY)) * 100).toFixed(2)}%</span>
            </div>
            <div className="flex flex-wrap gap-1 sm:justify-end">
              <span className="btn">Top 10 {((top10 / Number(SUPPLY)) * 100).toFixed(1)}%</span>
              <span className="btn">Holders {holders.length}</span>
            </div>
            <div className="flex flex-wrap gap-1 sm:justify-end">
              <button className="btn" onClick={() => toggle(c.token_id)}>
                {watch.includes(c.token_id) ? '★ Watching' : '☆ Watch'}
              </button>
              <button className="btn" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
              <button className="btn" onClick={share}>
                Share on X
              </button>
              <a className="btn" href={`${WOC}/tx/${deployTx}`} target="_blank" rel="noreferrer">
                Deploy tx ↗
              </a>
            </div>
          </div>
        </section>

        <section className="panel grid grid-cols-2 gap-3 text-sm md:grid-cols-[1fr_1fr_repeat(4,auto)]">
          <Stat label="Price" value={rate ? usd(priceSats(sold) * 1e6, rate) : `${(priceSats(sold) * 1e6).toFixed(0)} sats`} sub={`per 1M · ${priceSats(sold).toPrecision(4)} sats/token`} />
          <Stat label="Market cap" value={money(mcapSats(sold))} sub={bsv(mcapSats(sold))} />
          {WINDOWS.map(([l, ms]) => (
            <div key={l} className="text-center">
              <p className="text-xs text-muted">{l}</p>
              <p className="inset mt-1 px-2 py-0.5 text-xs">
                <Change v={changeOver(ms)} />
              </p>
            </div>
          ))}
          <Stat label="In the curve" value={money(c.reserve_sats)} sub={bsv(c.reserve_sats)} />
          <Stat label="24h volume" value={money(day.reduce((n, t) => n + t.curve_sats, 0))} sub={`${day.length} txns`} />
          <Stat label="Holders" value={String(holders.length)} />
          <Stat label="ATH market cap" value={money(mcapSats(c.ath_sold))} sub={bsv(mcapSats(c.ath_sold))} />
        </section>

        <PriceChart trades={trades} rate={rate} />

        <Activity trades={trades} rate={rate} />

        <TradesAndHolders c={c} trades={trades} holders={holders} rate={rate} />

        <Audit c={c} reserves={data.reserves} route={route} />
      </div>

      <aside className="flex flex-col gap-3">
        <TradePanel
          indexed={data.indexed ?? null}
          coin={c}
          icon={icon}
          wallet={wallet}
          onConnect={open}
          rate={rate}
          onDone={() => {
            refreshCoin();
            refreshTrades();
          }}
        />
        <section className="panel text-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="panel-title">Bonding curve</p>
            <p className="text-2xl font-bold text-hot">{(pct(sold) * 100).toFixed(1)}%</p>
          </div>
          <Segments v={pct(sold)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="inset p-2">
              <p className="text-xs text-muted">In the curve</p>
              <p>{bsv(c.reserve_sats)}</p>
              <p className="text-xs text-dim">{rate ? usd(c.reserve_sats, rate) : ''}</p>
            </div>
            <div className="inset p-2">
              <p className="text-xs text-muted">Still on the curve</p>
              <p>{fmtTokens(Math.max(0, Number(GRAD_SOLD) - sold))}</p>
              <p className="text-xs text-dim">tokens to graduation</p>
            </div>
          </div>
          <CurveChart sold={sold} />
          <p className="mt-2 text-xs text-muted">
            {grad ? 'Graduated. The curve stays as permanent liquidity: keep trading.' : 'Graduates at 100%. The curve then stays as permanent liquidity.'}
          </p>
        </section>
        <section className="panel text-sm">
          <p className="panel-title mb-2">Play ${c.sym}</p>
          <p className="mb-2 text-xs text-dim">Pick ${c.sym} as your ammo: every shot is a real ${c.sym} transaction on chain.</p>
          <div className="flex flex-col gap-2">
            <Link href="/arena" className="btn btn-fire text-center">
              Shoot ${c.sym} in the Arena ▸
            </Link>
            <Link href="/arcade/doubleosatoshi" className="btn text-center">
              Double-O Satoshi ▸
            </Link>
            <Link href="/blast" className="btn text-center">
              Blast it with the gun ▸
            </Link>
          </div>
        </section>
      </aside>
    </div>,
  );
}

function Shell({ wallet, open, busy, chooserEl, feed, children }: { wallet: { address: string } | null; open: () => void; busy: boolean; chooserEl: React.ReactNode; feed: Trade[]; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[1300px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={busy} />
      {chooserEl}
      <Ticker feed={feed} />
      {children}
      <p className="text-center text-xs text-muted">
        Every trade is ONE atomic Bitcoin transaction: tokens and BSV move together or not at all. You never send funds first.{' '}
        <span className="text-hot">Memecoins are toys:</span> prices can go to zero and every trade is final. Only spend what you are happy to lose.
      </p>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label.toUpperCase()}</p>
      <p className="text-lg font-bold text-hot">{value}</p>
      {sub && <p className="text-xs text-dim">{sub}</p>}
    </div>
  );
}

/** The curve's price from 0 sold to graduation, with a dot where the coin is now. */
function CurveChart({ sold }: { sold: number }) {
  const W = 300;
  const H = 110;
  const grad = Number(GRAD_SOLD);
  const top = priceSats(grad);
  const low = priceSats(0);
  const x = (s: number) => (Math.min(s, grad) / grad) * W;
  const y = (s: number) => H - 6 - ((priceSats(Math.min(s, grad)) - low) / (top - low)) * (H - 16);
  const pts = Array.from({ length: 61 }, (_, i) => Math.floor((grad * i) / 60));
  const line = pts.map((s, i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  const filled = pts.filter((s) => s <= sold);
  const area = filled.length > 1 ? `M0,${H} ${filled.map((s) => `L${x(s).toFixed(1)},${y(s).toFixed(1)}`).join(' ')} L${x(sold).toFixed(1)},${y(sold).toFixed(1)} L${x(sold).toFixed(1)},${H} Z` : '';
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-muted">
        <span>
          {low.toPrecision(3)} → {top.toPrecision(3)} sats
        </span>
        <span className="text-accent">GRADUATION</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bonding curve, ${(pct(sold) * 100).toFixed(1)}% sold`}>
        {area && <path d={area} fill="var(--accent)" opacity={0.18} />}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        <line x1={W - 1} x2={W - 1} y1={0} y2={H} stroke="var(--accent)" strokeDasharray="3 3" opacity={0.6} />
        <circle cx={x(sold)} cy={y(sold)} r={4} fill="var(--hot)">
          <animate attributeName="r" values="4;6;4" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
      <div className="flex justify-between text-[10px] text-muted">
        <span>0 sold</span>
        <span>793M sold</span>
      </div>
    </div>
  );
}

function Activity({ trades, rate }: { trades: Trade[]; rate: number }) {
  const [win, setWin] = useState(86_400_000);
  const now = useNow();
  const t = trades.filter((x) => (x.side === 'buy' || x.side === 'sell') && !x.mm && now - new Date(x.created_at).getTime() < win);
  const buys = t.filter((x) => x.side === 'buy');
  const sells = t.filter((x) => x.side === 'sell');
  const vol = (a: Trade[]) => a.reduce((n, x) => n + x.curve_sats, 0);
  const money = (s: number) => (rate ? usd(s, rate) : bsv(s));
  const startSold = soldAt(trades, now, win);
  const endSold = trades[0]?.sold_after ?? startSold;
  const then = priceSats(startSold);
  const chg = then > 0 ? (priceSats(endSold) / then - 1) * 100 : 0;
  return (
    <section className="panel text-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="panel-title">Activity</p>
        <div className="flex gap-1 text-xs">
          {WINDOWS.map(([l, ms]) => (
            <button key={l} className={`btn ${win === ms ? 'btn-on' : ''}`} onClick={() => setWin(ms)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
        <Split label="Txns" total={String(t.length)} a={`Buys ${buys.length}`} b={`Sells ${sells.length}`} share={t.length ? buys.length / t.length : 0.5} />
        <Split label="Volume" total={money(vol(t))} a={`Buy ${money(vol(buys))}`} b={`Sell ${money(vol(sells))}`} share={vol(t) ? vol(buys) / vol(t) : 0.5} />
        <div className="grid grid-cols-2 gap-x-4 text-xs md:grid-cols-1">
          <p className="text-muted">MAKERS</p>
          <p className="text-lg font-bold text-hot">{new Set(t.map((x) => x.trader)).size}</p>
          <p className="text-muted">PRICE CHANGE</p>
          <p>
            <Change v={chg} />
          </p>
        </div>
      </div>
    </section>
  );
}

function Split({ label, total, a, b, share }: { label: string; total: string; a: string; b: string; share: number }) {
  return (
    <div>
      <p className="text-xs text-muted">{label.toUpperCase()}</p>
      <p className="text-lg font-bold text-hot">{total}</p>
      <div className="flex justify-between text-xs">
        <span className="text-green-400">{a}</span>
        <span className="text-red-400">{b}</span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded bg-red-400/70">
        <div className="bg-green-400" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function TradesAndHolders({ c, trades, holders, rate }: { c: Coin; trades: Trade[]; holders: [string, number][]; rate: number }) {
  const [tab, setTab] = useState<'trades' | 'holders'>('trades');
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const rows = trades.filter((t) => t.side !== 'launch' && (side === 'all' || t.side === side)).slice(0, 200);
  return (
    <section className="panel overflow-x-auto">
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        <button className={`btn ${tab === 'trades' ? 'btn-on' : ''}`} onClick={() => setTab('trades')}>
          Trades
        </button>
        <button className={`btn ${tab === 'holders' ? 'btn-on' : ''}`} onClick={() => setTab('holders')}>
          Holders <span className="text-muted">{holders.length}</span>
        </button>
        {tab === 'trades' && (
          <div className="ml-auto flex gap-1 text-xs">
            {(['all', 'buy', 'sell'] as const).map((s) => (
              <button key={s} className={`btn ${side === s ? 'btn-on' : ''}`} onClick={() => setSide(s)}>
                {s === 'all' ? 'All' : s === 'buy' ? 'Buys' : 'Sells'}
              </button>
            ))}
          </div>
        )}
      </div>
      {tab === 'trades' ? (
        <>
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1">Age</th>
                <th>Type</th>
                <th>BSV</th>
                <th>USD</th>
                <th>${c.sym}</th>
                <th>Price · sats</th>
                <th>Trader</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.txid} className="border-t border-line-dim">
                  <td className="py-1">{ago(t.created_at)}</td>
                  <td className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                    {t.side === 'buy' ? 'Buy' : t.side === 'sell' ? 'Sell' : t.side}
                    {t.mm && ' · MM'}
                  </td>
                  <td>{(t.curve_sats / 1e8).toPrecision(3)}</td>
                  <td>{rate ? usd(t.curve_sats, rate) : '—'}</td>
                  <td className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>{fmtTokens(t.tokens)}</td>
                  <td>{t.tokens ? (t.curve_sats / t.tokens).toPrecision(4) : '—'}</td>
                  <td>
                    <a className="underline" href={`${WOC}/address/${t.trader}`} target="_blank" rel="noreferrer">
                      {short(t.trader)}
                    </a>
                    {t.trader === c.creator && <span className="text-accent"> dev</span>}
                  </td>
                  <td>
                    <a className="underline" href={`${WOC}/tx/${t.txid}`} target="_blank" rel="noreferrer">
                      {short(t.txid)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="text-dim">{side === 'all' ? 'No trades yet. Be the first.' : 'None yet.'}</p>}
        </>
      ) : (
        <>
          <p className="mb-1 text-xs text-muted">Counted from trades on the curve (tokens moved outside BlastPad are not followed).</p>
          <ol className="text-sm">
            {holders.slice(0, 50).map(([a, n], i) => (
              <li key={a} className="flex items-center justify-between gap-2 border-t border-line-dim py-1">
                <span>
                  {i + 1}.{' '}
                  <a className="underline" href={`${WOC}/address/${a}`} target="_blank" rel="noreferrer">
                    {short(a)}
                  </a>
                  {a === c.creator && <span className="text-accent"> (dev)</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="hidden h-1.5 w-24 overflow-hidden rounded bg-input sm:block">
                    <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (n / Number(SUPPLY)) * 100 * 5)}%` }} />
                  </span>
                  <span className="w-14 text-right">{((n / Number(SUPPLY)) * 100).toFixed(2)}%</span>
                </span>
              </li>
            ))}
          </ol>
          {!holders.length && <p className="text-dim">No holders yet.</p>}
        </>
      )}
    </section>
  );
}

/**
 * Proof of reserves, strict: green only when the ledger matches the curve AND the chain shows
 * at least that much BSV AND at least that many tokens at the pool. A side the index can't
 * answer for is "unverified", never quietly counted as a match.
 */
function reserveState(r: Reserves) {
  const ledgerOk = r.expected.bsv === r.ledger.bsv && r.expected.tokens === r.ledger.tokens;
  const side = (chain: number | null, ledger: number) => (chain === null ? 'unverified' : chain >= ledger ? 'ok' : 'short');
  const bsvSide = side(r.chain.bsv, r.ledger.bsv);
  const tokSide = side(r.chain.tokens, r.ledger.tokens);
  if (!ledgerOk) return { tone: 'text-red-400', bsvSide, tokSide, text: 'Ledger and curve disagree. Trading on this coin should be treated as unsafe until this is explained.' };
  if (bsvSide === 'ok' && tokSide === 'ok') return { tone: 'text-green-400', bsvSide, tokSide, text: '✓ Reserves match: on chain, the pool holds all the BSV and all the tokens the curve owes.' };
  if (bsvSide === 'short' || tokSide === 'short')
    return { tone: 'text-yellow-400', bsvSide, tokSide, text: `On chain shows less ${bsvSide === 'short' ? 'BSV' : 'tokens'} than the ledger. The index can lag a fresh trade by a few seconds; if this stays, something is wrong.` };
  return { tone: 'text-yellow-400', bsvSide, tokSide, text: `${[bsvSide === 'unverified' && 'BSV', tokSide === 'unverified' && 'Tokens'].filter(Boolean).join(' and ')} not verified on chain right now (the index didn’t answer). Not counted as a match.` };
}

function Audit({ c, reserves, route }: { c: Coin; reserves?: Reserves; route: (typeof ROUTES)[number] }) {
  const r = reserves;
  const st = r ? reserveState(r) : null;
  const mark = (s: string) => (s === 'ok' ? <span className="text-green-400"> ✓</span> : s === 'short' ? <span className="text-yellow-400"> ⚠</span> : <span className="text-muted"> ?</span>);
  const addr = (a: string | null, what: string, note: string) =>
    a ? (
      <Row label={what}>
        <span className="flex items-center gap-2">
          <a className="underline" href={`${WOC}/address/${a}`} target="_blank" rel="noreferrer">
            {short(a)} ↗
          </a>
          <button className="text-muted hover:text-hot" onClick={() => navigator.clipboard?.writeText(a)} title="Copy address" aria-label={`Copy ${what} address`}>
            ⧉
          </button>
        </span>
        <span className="block text-xs text-muted">{note}</span>
      </Row>
    ) : null;
  return (
    <section className="panel text-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="panel-title">Info &amp; audit</p>
        <span className="text-xs text-accent">verifiable on chain</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="flex flex-col">
          <Row label="✓ Fixed supply">
            1,000,000,000<span className="block text-xs text-muted">minted once in the deploy · no mint authority</span>
          </Row>
          <Row label="✓ Decimals">0</Row>
          <Row label="✓ Creator fee">
            0.30% of every trade: {route.title}
            <span className="block text-xs text-muted">{route.about}</span>
          </Row>
          {c.route.kind === 'split' &&
            c.route.to?.map((t) => (
              <Row key={t.address} label={`  ${short(t.address)}`}>
                {(t.bps / 100).toFixed(2)}%
              </Row>
            ))}
          {c.route.kind !== 'creator' && <Row label="In the vault so far">{bsv(c.route_accrued)}</Row>}
          {addr(c.token_address, 'Token pool', 'holds the curve’s tokens')}
          {addr(c.reserve_address, 'BSV reserve', 'holds the curve’s BSV')}
          {addr(c.vault_address, 'Fee vault', 'collects the 0.30% route fee')}
          {addr(c.fund_address, 'Token index fund', 'pays the indexer so wallets see the tokens')}
          <Row label="Deploy tx">
            <a className="underline" href={`${WOC}/tx/${c.token_id.split('_')[0]}`} target="_blank" rel="noreferrer">
              {short(c.token_id.split('_')[0])} ↗
            </a>
          </Row>
          <li className="border-t border-line-dim py-2">
            <details>
              <summary className="cursor-pointer text-accent">✓ Launch signature: signed by the creator (ticker, image, addresses and where the creator fee goes)</summary>
              <pre className="inset mt-1 whitespace-pre-wrap break-all p-2 text-xs">{c.launch_msg}</pre>
              <p className="mt-1 break-all text-xs text-dim">signature {c.launch_sig}</p>
              <p className="mt-1 break-all text-xs text-dim">
                creator key {c.creator_key} · protocol [1, &quot;tokenblaster launch&quot;] · keyID {c.slot} · counterparty anyone (BRC-3)
              </p>
              <button className="btn mt-1 text-xs" onClick={() => navigator.clipboard?.writeText(`${c.launch_msg}\n\nsignature: ${c.launch_sig}\ncreator key: ${c.creator_key}`)}>
                Copy the signed message
              </button>
            </details>
          </li>
        </ul>
        <div>
          <p className="panel-title mb-2">Proof of reserves</p>
          {r && st ? (
            <>
              <p className={`inset p-2 ${st.tone}`}>{st.text}</p>
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th></th>
                    <th className="py-1">BSV</th>
                    <th>Tokens</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line-dim">
                    <td className="py-1 text-muted">EXPECTED</td>
                    <td>{bsv(r.expected.bsv)}</td>
                    <td>{fmtTokens(r.expected.tokens)}</td>
                    <td className="text-muted">what the curve owes</td>
                  </tr>
                  <tr className="border-t border-line-dim">
                    <td className="py-1 text-muted">LEDGER</td>
                    <td>{bsv(r.ledger.bsv)}</td>
                    <td>{fmtTokens(r.ledger.tokens)}</td>
                    <td className="text-muted">the pool’s coins</td>
                  </tr>
                  <tr className="border-t border-line-dim">
                    <td className="py-1 text-muted">ON CHAIN</td>
                    <td>
                      {r.chain.bsv === null ? '—' : bsv(r.chain.bsv)}
                      {mark(st.bsvSide)}
                    </td>
                    <td>
                      {r.chain.tokens === null ? '—' : fmtTokens(r.chain.tokens)}
                      {mark(st.tokSide)}
                    </td>
                    <td className="text-muted">checked {ago(new Date(r.chain.checkedAt).toISOString())} ago</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-dim">Checking…</p>
          )}
          <p className="mt-2 text-xs text-muted">
            Custody, stated plainly: the pool and vault keys are held by the TokenBlaster server. The creator has no key to the pool; its BSV only moves when someone sells back to the curve.
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[130px_1fr] gap-2 border-t border-line-dim py-2 first:border-t-0">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </li>
  );
}

function TradePanel({ coin, icon, wallet, onConnect, rate, onDone, indexed }: { coin: Coin; icon: string; wallet: ReturnType<typeof useLaunchWallet>['wallet']; onConnect: () => void; rate: number; onDone: () => void; indexed: boolean | null }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slip, setSlip] = useState(300);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [held, setHeld] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  // Pressing Buy/Sell with no usable amount opens this picker instead of doing nothing.
  const [picking, setPicking] = useState(false);
  const [bsvHeld, setBsvHeld] = useState<number | null>(null);

  const loadHeld = () => {
    if (!wallet) return;
    tokenCoins(wallet.client)
      .then(({ coins }) => setHeld(coins.filter((c) => c.id === coin.token_id && c.noted).reduce((n, c) => n + c.amt, BigInt(0))))
      .catch(() => setHeld(null));
  };
  useEffect(loadHeld, [wallet, coin.token_id]);

  const n = Number(amount);
  const units = side === 'buy' ? BigInt(Math.floor((n || 0) * 1e8)) : BigInt(Math.floor(n || 0));
  const q = units > BigInt(0) ? (side === 'buy' ? quoteBuy(BigInt(coin.sold), units) : quoteSell(BigInt(coin.sold), units)) : null;
  const invalid = side === 'buy' ? units < BigInt(MIN_BUY) || units > BigInt(MAX_BUY) : held !== null && units > held;

  const go = async () => {
    if (!wallet) return onConnect();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await trade(wallet, { id: coin.token_id, sym: coin.sym, icon }, side, units, BigInt(coin.sold), slip, setStatus);
      setDone(r.txid);
      setAmount('');
      onDone();
      setTimeout(loadHeld, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setBusy(false);
    }
  };

  return (
    <section className="panel text-sm">
      {picking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPicking(false)}>
          <div role="dialog" aria-label={`${side === 'buy' ? 'Buy' : 'Sell'} $${coin.sym}`} className="panel w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <p className="panel-title mb-2">{side === 'buy' ? `Buy $${coin.sym}` : `Sell $${coin.sym}`}</p>
            {side === 'buy' ? (
              <>
                <p className="text-dim">Choose how much BSV to spend. You get ${coin.sym} at the curve&apos;s price, in one transaction your wallet asks you to approve.</p>
                <p className="mt-1 text-xs text-muted">
                  One buy: 0.0001 to 20 BSV, fees included (1.0%).{bsvHeld !== null && <> Your wallet has {bsv(bsvHeld)}{rate ? ` (${usd(bsvHeld, rate)})` : ''}.</>}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {['0.001', '0.01', '0.1', '1'].filter((v) => bsvHeld === null || Number(v) * 1e8 < bsvHeld).map((v) => {
                    const qq = quoteBuy(BigInt(coin.sold), BigInt(Math.round(Number(v) * 1e8)));
                    return (
                      <button key={v} className="btn" onClick={() => { setAmount(v); setPicking(false); }}>
                        {v} BSV<span className="block text-xs text-muted">≈ {Number(qq.tokens).toLocaleString()} ${coin.sym}</span>
                      </button>
                    );
                  })}
                </div>
                {bsvHeld !== null && bsvHeld < MIN_BUY + 5_000 && <p className="mt-2 text-xs text-red-400">Your wallet needs at least about 0.00015 BSV for the smallest buy.</p>}
              </>
            ) : (
              <>
                <p className="text-dim">Choose how much ${coin.sym} to sell back to the curve for BSV, in one transaction.</p>
                <p className="mt-1 text-xs text-muted">You hold {held === null ? '…' : Number(held).toLocaleString()} ${coin.sym}.</p>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {[25, 50, 100].map((pc) => (
                    <button key={pc} className="btn" disabled={!held} onClick={() => { if (held) setAmount(((held * BigInt(pc)) / BigInt(100)).toString()); setPicking(false); }}>
                      {pc === 100 ? 'Max' : `${pc}%`}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mt-2 text-xs text-muted">Or type an exact amount in the box. Then press {side === 'buy' ? 'Buy' : 'Sell'} again to see the quote and approve.</p>
            <button className="btn mt-2 w-full" onClick={() => setPicking(false)}>Close</button>
          </div>
        </div>
      )}
      <div className="mb-2 grid grid-cols-2 gap-1">
        <button className={`btn ${side === 'buy' ? 'btn-on' : ''}`} onClick={() => setSide('buy')}>Buy</button>
        <button className={`btn ${side === 'sell' ? 'btn-on' : ''}`} onClick={() => setSide('sell')}>Sell</button>
      </div>
      <p className="text-xs text-muted">
        {wallet ? <>Your ${coin.sym}: {held === null ? '…' : Number(held).toLocaleString()}</> : 'Connect a wallet to trade.'}
      </p>
      <label className="mt-2 block text-xs text-muted">Amount ({side === 'buy' ? 'BSV' : `$${coin.sym}`})</label>
      <input className="inset w-full px-2 py-2 text-lg" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
      <div className="mt-1 flex flex-wrap gap-1 text-xs">
        {side === 'buy'
          ? ['0.001', '0.01', '0.1', '1'].map((v) => <button key={v} className="btn" onClick={() => setAmount(v)}>{v}</button>)
          : [25, 50, 100].map((p) => (
              <button key={p} className="btn" disabled={!held} onClick={() => held && setAmount(((held * BigInt(p)) / BigInt(100)).toString())}>{p === 100 ? 'Max' : `${p}%`}</button>
            ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted">Max slippage</span>
        {[100, 300, 500].map((s) => <button key={s} className={`btn ${slip === s ? 'btn-on' : ''}`} onClick={() => setSlip(s)}>{s / 100}%</button>)}
      </div>
      {q && q.tokens > BigInt(0) && (
        <div className="inset mt-2 grid grid-cols-2 gap-1 p-2 text-xs">
          {side === 'buy' ? (
            <>
              <span className="text-muted">You get</span><span>{Number(q.tokens).toLocaleString()} ${coin.sym}</span>
              <span className="text-muted">Into the curve</span><span>{bsv(Number(q.curveSats))}</span>
            </>
          ) : (
            <>
              <span className="text-muted">You get</span><span>{bsv(Number(q.userSats))} {rate ? `(${usd(Number(q.userSats), rate)})` : ''}</span>
              <span className="text-muted">Out of the curve</span><span>{bsv(Number(q.curveSats))}</span>
            </>
          )}
          <span className="text-muted">Fees (1.0%)</span><span>{bsv(Number(q.houseFee + q.routeFee))}</span>
          <span className="text-muted">Index + network</span><span>~2,000–5,000 sats + a few hundred</span>
          <span className="text-muted">Price after</span><span>{priceSats(Number(q.soldAfter)).toPrecision(4)} sats</span>
        </div>
      )}
      {!q && <p className="mt-2 text-xs text-dim">Enter an amount to see what you get.</p>}
      {side === 'sell' && indexed === false && (
        <p className="inset mt-2 p-2 text-xs text-yellow-400">
          Sells open once the token index has picked ${coin.sym} up, usually within a block or two of launch (about 10–20 minutes). Buying works now.
        </p>
      )}
      <button
        className="btn btn-fire mt-2 w-full"
        disabled={busy}
        onClick={() => {
          if (!wallet) return onConnect();
          if (!q || invalid) {
            setPicking(true);
            wallet.client
              .listOutputs({ basket: 'default', limit: 1000 })
              .then((r) => setBsvHeld(r.outputs.filter((o) => o.spendable).reduce((n, o) => n + o.satoshis, 0)))
              .catch(() => setBsvHeld(null));
            return;
          }
          void go();
        }}
      >
        {busy ? (status ?? 'Working…') : !wallet ? 'Connect wallet' : `${side === 'buy' ? 'Buy' : 'Sell'} $${coin.sym}`}
      </button>
      {side === 'buy' && units > BigInt(0) && invalid && <p className="mt-1 text-xs text-red-400">One buy is between 0.0001 and 20 BSV.</p>}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {done && (
        <p className="mt-2 text-xs text-green-400">
          Done.{' '}
          <a className="underline" href={`https://whatsonchain.com/tx/${done}`} target="_blank" rel="noreferrer">
            {short(done)}
          </a>
        </p>
      )}
      <p className="mt-2 text-xs text-muted">One atomic BSV transaction per trade: tokens and BSV move together or not at all.</p>
    </section>
  );
}
