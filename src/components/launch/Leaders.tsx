'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { quoteSell } from '@/lib/launch/curve';
import { LaunchNav } from './LaunchNav';
import { bsv, imageOf, short, usd, useBsvUsd, usePoll, type BoardCoin, type Trade } from './data';
import { useLaunchWallet } from './useLaunchWallet';

type Pos = { tokenId: string; sym: string; held: number; cost: number; taken: number; realized: number };

/**
 * Profit and loss from what really moved through the curve, at average cost. What a wallet still
 * holds is valued at what the curve would pay for it now (fees included), not last price × amount.
 */
export function positions(trades: Trade[], coins: BoardCoin[]) {
  const sold = new Map(coins.map((c) => [c.token_id, BigInt(c.sold)]));
  const by = new Map<string, Map<string, Pos>>();
  for (const t of trades.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if ((t.side !== 'buy' && t.side !== 'sell') || t.mm) continue;
    const w = by.get(t.trader) ?? new Map<string, Pos>();
    by.set(t.trader, w);
    const p = w.get(t.token_id) ?? { tokenId: t.token_id, sym: t.sym, held: 0, cost: 0, taken: 0, realized: 0 };
    w.set(t.token_id, p);
    if (t.side === 'buy') {
      p.held += t.tokens;
      p.cost += t.user_sats;
    } else {
      const sell = Math.min(t.tokens, p.held);
      const basis = p.held ? (p.cost * sell) / p.held : 0;
      p.realized += t.user_sats - basis;
      p.cost -= basis;
      p.held -= sell;
      p.taken += t.user_sats;
    }
  }
  const value = (p: Pos) => (p.held > 0 && sold.has(p.tokenId) ? Number(quoteSell(sold.get(p.tokenId)!, BigInt(p.held)).userSats) : 0);
  return { by, value };
}

export function Leaders() {
  const { wallet, open, busy, chooserEl } = useLaunchWallet();
  const rate = useBsvUsd();
  const [board] = usePoll<{ coins: BoardCoin[] }>('/api/launch/coins', 15000, { coins: [] });
  const [tr] = usePoll<{ trades: Trade[] }>('/api/launch/trades?limit=1000', 15000, { trades: [] });
  const money = (s: number) => `${s < 0 ? '−' : ''}${rate ? usd(Math.abs(s), rate) : bsv(Math.abs(s))}`;

  const traders = useMemo(() => {
    const { by } = positions(tr.trades, board.coins);
    return [...by].map(([a, m]) => ({ a, pnl: [...m.values()].reduce((n, p) => n + p.realized, 0) })).sort((x, y) => y.pnl - x.pnl).slice(0, 50);
  }, [tr.trades, board.coins]);
  const creators = useMemo(() => {
    const m = new Map<string, { vol: number; coins: number }>();
    for (const c of board.coins) {
      const x = m.get(c.creator) ?? { vol: 0, coins: 0 };
      m.set(c.creator, { vol: x.vol + c.vol24, coins: x.coins + 1 });
    }
    return [...m].sort((a, b) => b[1].vol - a[1].vol).slice(0, 30);
  }, [board.coins]);
  const payers = useMemo(() => board.coins.filter((c) => c.route.kind !== 'creator' && c.route_accrued > 0).sort((a, b) => b.route_accrued - a.route_accrued).slice(0, 20), [board.coins]);

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={busy} />
      {chooserEl}
      <div className="grid gap-3 md:grid-cols-2">
        <section className="panel">
          <p className="panel-title mb-2">Top traders · realized profit</p>
          <ol className="text-sm">
            {traders.map((t, i) => (
              <li key={t.a} className="flex justify-between border-t border-line-dim py-0.5">
                <span>{i + 1}. <a className="underline" href={`https://whatsonchain.com/address/${t.a}`} target="_blank" rel="noreferrer">{short(t.a)}</a></span>
                <span className={t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{money(t.pnl)}</span>
              </li>
            ))}
          </ol>
          {!traders.length && <p className="text-dim">No trades yet.</p>}
          <p className="mt-2 text-xs text-muted">Average cost, fees included, curve trades only. House market-maker trades never rank.</p>
        </section>
        <section className="panel">
          <p className="panel-title mb-2">Creators · 24h volume of their coins</p>
          <ol className="text-sm">
            {creators.map(([a, x], i) => (
              <li key={a} className="flex justify-between border-t border-line-dim py-0.5">
                <span>{i + 1}. {short(a)} <span className="text-muted">({x.coins} coins)</span></span>
                <span>{money(x.vol)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel md:col-span-2">
          <p className="panel-title mb-2">Coins whose fee pays holders, splits or burns</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {payers.map((c) => (
              <Link key={c.token_id} href={`/launch/${c.token_id}`} className="inset flex items-center gap-2 p-2 text-sm hover:border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageOf(c.token_id)} alt="" className="h-8 w-8 rounded object-cover" />
                <span className="font-bold">${c.sym}</span>
                <span className="text-accent">{c.route.kind}</span>
                <span className="ml-auto">{money(c.route_accrued)} collected</span>
              </Link>
            ))}
          </div>
          {!payers.length && <p className="text-dim">None yet.</p>}
        </section>
      </div>
    </main>
  );
}

export function MyCoins() {
  const { wallet, open, busy, chooserEl } = useLaunchWallet();
  const rate = useBsvUsd();
  const [board] = usePoll<{ coins: BoardCoin[] }>('/api/launch/coins', 15000, { coins: [] });
  const [tr] = usePoll<{ trades: Trade[] }>(wallet ? `/api/launch/trades?trader=${wallet.address}&limit=1000` : null, 10000, { trades: [] });
  const money = (s: number) => `${s < 0 ? '−' : ''}${rate ? usd(Math.abs(s), rate) : bsv(Math.abs(s))}`;
  const rows = useMemo(() => {
    if (!wallet) return [];
    const { by, value } = positions(tr.trades, board.coins);
    return [...(by.get(wallet.address)?.values() ?? [])].map((p) => ({ ...p, now: value(p) }));
  }, [wallet, tr.trades, board.coins]);
  const launched = board.coins.filter((c) => c.creator === wallet?.address);

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={busy} />
      {chooserEl}
      {!wallet ? (
        <section className="panel">
          <p className="text-dim">Connect your wallet to see your coins.</p>
          <button className="btn btn-fire mt-2" onClick={open}>Connect wallet</button>
        </section>
      ) : (
        <>
          <section className="panel overflow-x-auto">
            <p className="panel-title mb-2">Holdings</p>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted"><tr><th>Coin</th><th>Held</th><th>Cost</th><th>Worth if sold now</th><th>Taken out</th><th>Realized</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.tokenId} className="border-t border-line-dim">
                    <td><Link className="font-bold hover:text-hot" href={`/launch/${p.tokenId}`}>${p.sym}</Link></td>
                    <td>{p.held.toLocaleString()}</td>
                    <td>{money(p.cost)}</td>
                    <td className={p.now >= p.cost ? 'text-green-400' : 'text-red-400'}>{money(p.now)}</td>
                    <td>{money(p.taken)}</td>
                    <td className={p.realized >= 0 ? 'text-green-400' : 'text-red-400'}>{money(p.realized)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="text-dim">No BlastPad trades from this wallet yet.</p>}
          </section>
          {launched.length > 0 && (
            <section className="panel">
              <p className="panel-title mb-2">Coins you launched</p>
              <div className="flex flex-wrap gap-2">
                {launched.map((c) => <Link key={c.token_id} href={`/launch/${c.token_id}`} className="btn">${c.sym}</Link>)}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
