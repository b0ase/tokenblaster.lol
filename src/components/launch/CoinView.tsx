'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { GRAD_SOLD, MAX_BUY, MIN_BUY, SUPPLY, fmtTokens, quoteBuy, quoteSell } from '@/lib/launch/curve';
import { trade } from '@/lib/launch/client';
import { ROUTES } from '@/lib/launch/shape';
import { tokenCoins } from '@/lib/tokens';
import { Change, Progress } from './Board';
import { LaunchNav } from './LaunchNav';
import { PriceChart } from './PriceChart';
import { ago, bsv, imageOf, mcapSats, pct, priceSats, short, usd, useBsvUsd, useNow, usePoll, useWatchlist, type Trade } from './data';
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

export function CoinView({ id }: { id: string }) {
  const { wallet, open, busy, chooserEl } = useLaunchWallet();
  const rate = useBsvUsd();
  const [data, refreshCoin] = usePoll<{ coin?: Coin; reserves?: Reserves; error?: string }>(`/api/launch/coin?token=${id}`, 5000, {});
  const [tr, refreshTrades] = usePoll<{ trades: Trade[] }>(`/api/launch/trades?token=${id}&limit=1000`, 5000, { trades: [] });
  const { list: watch, toggle } = useWatchlist();
  const now = useNow();
  const c = data.coin;
  const trades = tr.trades;

  const holders = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades) if (t.side === 'buy' || t.side === 'sell') m.set(t.trader, (m.get(t.trader) ?? 0) + (t.side === 'buy' ? t.tokens : -t.tokens));
    return [...m].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  }, [trades]);

  if (data.error) return <Shell wallet={wallet} open={open} busy={busy} chooserEl={chooserEl}><p className="panel text-dim">{data.error}</p></Shell>;
  if (!c) return <Shell wallet={wallet} open={open} busy={busy} chooserEl={chooserEl}><p className="panel text-dim">Loading…</p></Shell>;

  const sold = c.sold;
  const grad = Boolean(c.graduated_at);
  const devHeld = holders.find(([a]) => a === c.creator)?.[1] ?? 0;
  const top10 = holders.slice(0, 10).reduce((n, [, v]) => n + v, 0);
  const route = ROUTES.find((r) => r.kind === c.route.kind)!;
  const day = trades.filter((t) => now - new Date(t.created_at).getTime() < 86_400_000 && (t.side === 'buy' || t.side === 'sell') && !t.mm);
  const soldDayAgo = trades.find((t) => now - new Date(t.created_at).getTime() >= 86_400_000)?.sold_after ?? 0;
  const chg = priceSats(soldDayAgo) > 0 ? (priceSats(sold) / priceSats(soldDayAgo) - 1) * 100 : 0;
  const money = (sats: number) => (rate ? usd(sats, rate) : bsv(sats));
  const icon = `${c.token_id.split('_')[0]}_0`;

  return (
    <Shell wallet={wallet} open={open} busy={busy} chooserEl={chooserEl}>
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <section className="panel flex flex-wrap gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageOf(c.token_id)} alt="" className="h-28 w-28 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">
                <Link href="/launch" className="hover:text-hot">
                  Board
                </Link>{' '}
                / ${c.sym}
              </p>
              <h1 className="text-2xl font-bold text-hot">
                {c.name} <span className="text-fg">${c.sym}</span> {grad && <span className="text-sm text-accent">GRAD #{c.grad_rank}</span>}
              </h1>
              <p className="text-sm text-dim">{c.description}</p>
              <p className="mt-1 text-xs text-muted">
                Token <a className="underline" href={`${WOC}/tx/${c.token_id.split('_')[0]}`} target="_blank" rel="noreferrer">{short(c.token_id.split('_')[0])}_{c.token_id.split('_')[1]}</a> · Dev{' '}
                <a className="underline" href={`${WOC}/address/${c.creator}`} target="_blank" rel="noreferrer">{short(c.creator)}</a> · launched {ago(c.created_at)} ago
              </p>
              <div className="mt-2 flex flex-wrap gap-1 text-xs">
                <span className="btn">Fixed supply</span>
                <span className="btn">No mint</span>
                <span className="btn">Dev {((devHeld / Number(SUPPLY)) * 100).toFixed(2)}%</span>
                <span className="btn">Top 10 {((top10 / Number(SUPPLY)) * 100).toFixed(1)}%</span>
                <span className="btn">{holders.length} holders</span>
                <button className="btn" onClick={() => toggle(c.token_id)}>{watch.includes(c.token_id) ? '★ Watching' : '☆ Watch'}</button>
                <button className="btn" onClick={() => navigator.clipboard?.writeText(location.href)}>Copy link</button>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <Box label="Price" value={rate ? usd(priceSats(sold) * 1e6, rate) : `${(priceSats(sold) * 1e6).toFixed(0)} sats`} sub={`per 1M · ${priceSats(sold).toPrecision(4)} sats/token`} />
            <Box label="Market cap" value={money(mcapSats(sold))} sub={bsv(mcapSats(sold))} extra={<Change v={chg} />} />
            <Box label="24h volume" value={money(day.reduce((n, t) => n + t.curve_sats, 0))} sub={`${day.length} txns`} />
            <Box label="ATH market cap" value={money(mcapSats(c.ath_sold))} sub={bsv(mcapSats(c.ath_sold))} />
          </section>

          <PriceChart trades={trades} rate={rate} />

          <section className="panel">
            <p className="panel-title mb-2">Play ${c.sym}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link href={`/arena`} className="btn btn-fire">Shoot ${c.sym} in the Arena ▸</Link>
              <Link href={`/blast`} className="btn">Blast it with the gun</Link>
              <span className="text-dim">Pick ${c.sym} as your ammo: every shot is a real ${c.sym} transaction on chain.</span>
            </div>
          </section>

          <section className="panel overflow-x-auto">
            <p className="panel-title mb-2">Trades</p>
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr><th>Age</th><th>Type</th><th>BSV</th><th>USD</th><th>${c.sym}</th><th>Price · sats</th><th>Trader</th><th>Tx</th></tr>
              </thead>
              <tbody>
                {trades.filter((t) => t.side !== 'launch').slice(0, 200).map((t) => (
                  <tr key={t.txid} className="border-t border-line-dim">
                    <td>{ago(t.created_at)}</td>
                    <td className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>{t.side === 'buy' ? 'Buy' : t.side === 'sell' ? 'Sell' : t.side}{t.mm && ' · MM'}</td>
                    <td>{(t.curve_sats / 1e8).toPrecision(3)}</td>
                    <td>{rate ? usd(t.curve_sats, rate) : '—'}</td>
                    <td>{fmtTokens(t.tokens)}</td>
                    <td>{t.tokens ? (t.curve_sats / t.tokens).toPrecision(4) : '—'}</td>
                    <td><a className="underline" href={`${WOC}/address/${t.trader}`} target="_blank" rel="noreferrer">{short(t.trader)}</a></td>
                    <td><a className="underline" href={`${WOC}/tx/${t.txid}`} target="_blank" rel="noreferrer">{short(t.txid)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!trades.some((t) => t.side !== 'launch') && <p className="text-dim">No trades yet. Be the first.</p>}
          </section>

          <section className="panel">
            <p className="panel-title mb-2">Holders</p>
            <p className="mb-1 text-xs text-muted">Counted from trades on the curve (tokens moved outside BlastPad are not followed).</p>
            <ol className="text-sm">
              {holders.slice(0, 20).map(([a, n], i) => (
                <li key={a} className="flex justify-between border-t border-line-dim py-0.5">
                  <span>{i + 1}. <a className="underline" href={`${WOC}/address/${a}`} target="_blank" rel="noreferrer">{short(a)}</a>{a === c.creator && <span className="text-accent"> (dev)</span>}</span>
                  <span>{((n / Number(SUPPLY)) * 100).toFixed(2)}%</span>
                </li>
              ))}
            </ol>
          </section>

          <Audit c={c} reserves={data.reserves} route={route} />
        </div>

        <aside className="flex flex-col gap-3">
          <TradePanel coin={c} icon={icon} wallet={wallet} onConnect={open} rate={rate} onDone={() => { refreshCoin(); refreshTrades(); }} />
          <section className="panel text-sm">
            <p className="panel-title mb-2">Bonding curve</p>
            <p className="text-2xl font-bold text-hot">{(pct(sold) * 100).toFixed(1)}%</p>
            <Progress v={pct(sold)} />
            <div className="grid grid-cols-2 gap-2">
              <div className="inset p-2"><p className="text-xs text-muted">In the curve</p><p>{bsv(c.reserve_sats)}</p><p className="text-xs text-dim">{rate ? usd(c.reserve_sats, rate) : ''}</p></div>
              <div className="inset p-2"><p className="text-xs text-muted">Still on the curve</p><p>{fmtTokens(Math.max(0, Number(GRAD_SOLD) - sold))}</p><p className="text-xs text-dim">tokens to graduation</p></div>
            </div>
            <p className="mt-2 text-xs text-muted">
              {grad
                ? 'Graduated. The curve stays as permanent liquidity: keep trading.'
                : `0 → 793M sold · ${priceSats(0).toPrecision(3)} → ${priceSats(Number(GRAD_SOLD)).toPrecision(3)} sats. Graduates at 100%.`}
            </p>
          </section>
          <Activity trades={trades} rate={rate} />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ wallet, open, busy, chooserEl, children }: { wallet: { address: string } | null; open: () => void; busy: boolean; chooserEl: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[1300px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={busy} />
      {chooserEl}
      {children}
      <p className="text-center text-xs text-muted">
        Every trade is ONE atomic Bitcoin transaction: tokens and BSV move together or not at all. You never send funds first. Memecoins are toys: prices can go to zero
        and every trade is final. Only spend what you are happy to lose.
      </p>
    </main>
  );
}

function Box({ label, value, sub, extra }: { label: string; value: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <div className="panel">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-bold text-hot">{value} {extra}</p>
      {sub && <p className="text-xs text-dim">{sub}</p>}
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
  return (
    <section className="panel text-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="panel-title">Activity</p>
        <div className="flex gap-1 text-xs">
          {([['5M', 300_000], ['1H', 3_600_000], ['6H', 21_600_000], ['24H', 86_400_000]] as const).map(([l, ms]) => (
            <button key={l} className={`btn ${win === ms ? 'btn-on' : ''}`} onClick={() => setWin(ms)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted">Txns</span><span>{t.length} (buys {buys.length} · sells {sells.length})</span>
        <span className="text-muted">Volume</span><span>{money(vol(t))}</span>
        <span className="text-muted">Buy / sell</span><span><span className="text-green-400">{money(vol(buys))}</span> / <span className="text-red-400">{money(vol(sells))}</span></span>
        <span className="text-muted">Makers</span><span>{new Set(t.map((x) => x.trader)).size}</span>
      </div>
    </section>
  );
}

function Audit({ c, reserves, route }: { c: Coin; reserves?: Reserves; route: (typeof ROUTES)[number] }) {
  const r = reserves;
  const match = r && r.expected.bsv === r.ledger.bsv && r.expected.tokens === r.ledger.tokens && (r.chain.bsv === null || r.chain.bsv >= r.ledger.bsv);
  const addr = (a: string | null, what: string) =>
    a ? (
      <li className="flex justify-between gap-2"><span className="text-muted">{what}</span><a className="truncate underline" href={`${WOC}/address/${a}`} target="_blank" rel="noreferrer">{short(a)}</a></li>
    ) : null;
  return (
    <section className="panel text-sm">
      <p className="panel-title mb-2">Info &amp; audit</p>
      <ul className="flex flex-col gap-1">
        <li className="flex justify-between"><span className="text-muted">Fixed supply</span><span>1,000,000,000 · minted once, no mint authority</span></li>
        <li className="flex justify-between"><span className="text-muted">Decimals</span><span>0</span></li>
        <li className="flex justify-between gap-2"><span className="text-muted">Creator fee</span><span className="text-right">0.30% of every trade: {route.title}. {route.about}</span></li>
        {c.route.kind === 'split' && c.route.to?.map((t) => <li key={t.address} className="flex justify-between pl-3 text-xs"><span>{short(t.address)}</span><span>{(t.bps / 100).toFixed(2)}%</span></li>)}
        {c.route.kind !== 'creator' && <li className="flex justify-between"><span className="text-muted">In the vault so far</span><span>{bsv(c.route_accrued)}</span></li>}
        {addr(c.token_address, 'Token pool (holds the curve’s tokens)')}
        {addr(c.reserve_address, 'BSV reserve (holds the curve’s BSV)')}
        {addr(c.vault_address, 'Fee vault')}
        {addr(c.fund_address, 'Token index fund')}
        <li className="flex justify-between"><span className="text-muted">Deploy tx</span><a className="underline" href={`${WOC}/tx/${c.token_id.split('_')[0]}`} target="_blank" rel="noreferrer">{short(c.token_id.split('_')[0])}</a></li>
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer text-accent">Launch signature (signed by the creator: ticker, image, addresses and where the creator fee goes)</summary>
        <pre className="inset mt-1 whitespace-pre-wrap break-all p-2 text-xs">{c.launch_msg}</pre>
        <p className="mt-1 break-all text-xs text-dim">signature {c.launch_sig}</p>
        <p className="mt-1 break-all text-xs text-dim">creator key {c.creator_key} · protocol [1, &quot;tokenblaster launch&quot;] · keyID {c.slot} · counterparty anyone (BRC-3)</p>
        <button className="btn mt-1 text-xs" onClick={() => navigator.clipboard?.writeText(`${c.launch_msg}\n\nsignature: ${c.launch_sig}\ncreator key: ${c.creator_key}`)}>Copy the signed message</button>
      </details>
      <div className="mt-3">
        <p className="panel-title">Proof of reserves</p>
        {r ? (
          <>
            <p className={match ? 'text-green-400' : 'text-red-400'}>{match ? 'Reserves match: the pool holds everything the curve owes.' : 'Reserves are being checked (the chain index may lag a trade).'}</p>
            <table className="mt-1 w-full text-left text-xs">
              <thead className="text-muted"><tr><th></th><th>BSV</th><th>Tokens</th><th></th></tr></thead>
              <tbody>
                <tr><td>Expected</td><td>{bsv(r.expected.bsv)}</td><td>{fmtTokens(r.expected.tokens)}</td><td className="text-muted">what the curve owes</td></tr>
                <tr><td>Ledger</td><td>{bsv(r.ledger.bsv)}</td><td>{fmtTokens(r.ledger.tokens)}</td><td className="text-muted">the pool’s coins</td></tr>
                <tr><td>On chain</td><td>{r.chain.bsv === null ? '—' : bsv(r.chain.bsv)}</td><td>{r.chain.tokens === null ? '—' : fmtTokens(r.chain.tokens)}</td><td className="text-muted">checked now</td></tr>
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-dim">Checking…</p>
        )}
        <p className="mt-1 text-xs text-muted">Custody, stated plainly: the pool and vault keys are held by the TokenBlaster server. The creator has no key to the pool; its BSV only moves when someone sells back to the curve.</p>
      </div>
    </section>
  );
}

function TradePanel({ coin, icon, wallet, onConnect, rate, onDone }: { coin: Coin; icon: string; wallet: ReturnType<typeof useLaunchWallet>['wallet']; onConnect: () => void; rate: number; onDone: () => void }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slip, setSlip] = useState(300);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [held, setHeld] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

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
      <button className="btn btn-fire mt-2 w-full" disabled={busy || (Boolean(wallet) && (!q || invalid))} onClick={go}>
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
