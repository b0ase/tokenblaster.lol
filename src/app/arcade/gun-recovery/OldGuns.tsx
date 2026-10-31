'use client';
/**
 * The answer first: where this browser's game credit is, its balance in $ and sats, what to do (PLAY / UNLOAD), and
 * each key's on-chain history count (/api/gun/activity) so a player can see where the credit went. Public reads
 * only: no wallet call, no key leaves the browser.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { chainSats, gunAddresses } from '@/lib/gunKeys';
import { SendBack } from './SendBack';

type Activity = { txs: number; more: boolean; last: { txid: string; height: number | null } | null } | null;
type Row = { address: string; sats: number | null; activity: Activity };

const GAME = '/arcade/terrornode';

async function activityOf(address: string): Promise<Activity> {
  const r = await fetch(`/api/gun/activity?address=${address}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => null)) as Activity;
}

const usd = (sats: number, rate: number) => {
  const v = (sats / 1e8) * rate;
  return v > 0 && v < 0.01 ? 'under $0.01' : `$${v.toFixed(2)}`;
};
const satsText = (n: number) => `${n.toLocaleString('en-US')} sats`;

function Balance({ sats, rate }: { sats: number | null; rate: number }) {
  if (sats === null) return <span>balance unavailable right now</span>;
  return (
    <span>
      {rate > 0 && <b className="text-white">{usd(sats, rate)}</b>}
      {rate > 0 && ' · '}
      {satsText(sats)}
    </span>
  );
}

function History({ address, a }: { address: string; a: Activity }) {
  const woc = `https://whatsonchain.com/address/${address}`;
  if (!a) return null;
  if (!a.txs)
    return <p className="text-white/70">No transactions yet.</p>;
  return (
    <p className="text-white/80">
      Used in <b className="text-white">{a.more ? `${a.txs.toLocaleString('en-US')}+` : a.txs.toLocaleString('en-US')}</b> transactions: your load, the ammo
      split and your shots.{' '}
      <a className="underline underline-offset-2" href={woc} target="_blank" rel="noopener noreferrer">
        See them all
      </a>
      .
    </p>
  );
}

export function OldGuns() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rate, setRate] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch('/api/price')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { bsvUsd?: number } | null) => live && j?.bsvUsd && setRate(j.bsvUsd))
      .catch(() => undefined);
    void Promise.all(gunAddresses().map(async (address) => ({ address, sats: await chainSats(address), activity: await activityOf(address) }))).then(
      (r) => live && setRows(r),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!rows)
    return (
      <section className="rounded-2xl border border-white/15 bg-white/[0.04] p-5 text-lg" role="status">
        Checking this browser for game credit…
      </section>
    );
  if (!rows.length)
    return (
      <section className="flex flex-col gap-2 rounded-2xl border border-white/15 bg-white/[0.04] p-5" data-old-guns>
        <h2 className="text-2xl font-bold text-white sm:text-3xl">No game credit in this browser</h2>
        <p>This browser has never loaded a game here. Try the steps below.</p>
      </section>
    );

  const [cur, ...older] = rows;
  return (
    <div className="flex flex-col gap-6" data-old-guns>
      <section className="flex flex-col gap-4 rounded-2xl border-2 border-[var(--tbx-teal,#3fd8e8)] bg-black/50 p-5 sm:p-6" aria-labelledby="credit-here">
        <h2 id="credit-here" className="text-2xl font-bold text-white sm:text-3xl">
          Your game credit is here
        </h2>
        <p className="text-3xl font-bold text-[var(--tbx-teal,#3fd8e8)] sm:text-4xl" data-credit-balance>
          <Balance sats={cur.sats} rate={rate} />
        </p>
        <p className="break-all font-mono text-sm text-white/80 sm:text-base">
          <a className="underline underline-offset-2" href={`https://whatsonchain.com/address/${cur.address}`} target="_blank" rel="noopener noreferrer">
            {cur.address}
          </a>
        </p>
        <History address={cur.address} a={cur.activity} />
        <div className="flex flex-col gap-2">
          <p className="font-bold text-white">What to do:</p>
          <div className="flex flex-wrap gap-3">
            <Link href={GAME} className="btn btn-on px-4 py-2 font-bold min-w-[120px] justify-center text-center text-lg">
              PLAY
            </Link>
            <Link href={GAME} className="btn px-4 py-2 min-w-[120px] justify-center text-center text-lg">
              UNLOAD
            </Link>
          </div>
          <p className="text-white/75">
            <b className="text-white">PLAY</b> uses this credit. No new payment. <b className="text-white">UNLOAD</b> on the TERRORNODE screen, or the button
            below, sends it back to your wallet.
          </p>
          <SendBack address={cur.address} />
        </div>
      </section>

      {older.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="older">
          <h2 id="older" className="text-xl font-bold text-white sm:text-2xl">
            Older keys in this browser
          </h2>
          <ul className="flex flex-col gap-3">
            {older.map((r) => (
              <li key={r.address} className="flex flex-col gap-1 rounded-xl border border-white/15 bg-white/[0.04] p-4">
                <p className="text-lg">
                  <Balance sats={r.sats} rate={rate} />
                </p>
                <a className="break-all font-mono text-sm text-white/80 underline underline-offset-2" href={`https://whatsonchain.com/address/${r.address}`} target="_blank" rel="noopener noreferrer">
                  {r.address}
                </a>
                <History address={r.address} a={r.activity} />
                <SendBack address={r.address} />
              </li>
            ))}
          </ul>
          <p className="text-white/75">Credit on an older key stays safe at its address. Send it back with the button under it.</p>
        </section>
      )}
    </div>
  );
}
