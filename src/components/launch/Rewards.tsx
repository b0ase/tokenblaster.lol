'use client';

import Link from 'next/link';
import { useState } from 'react';
import { claimRewards } from '@/lib/launch/client';
import { LaunchNav } from './LaunchNav';
import { ago, bsv, short, usd, useBsvUsd, usePoll } from './data';
import { useLaunchWallet } from './useLaunchWallet';

type Owed = { token_id: string; sym: string; sats: number };
type Payout = { txid: string; token_id: string; sym: string; kind: 'split' | 'holders' | 'claim' | 'buyback'; sats: number; tokens: number; created_at: string };
const KIND = { split: 'paid its split', holders: 'credited its holders', claim: 'claimed by a holder', buyback: 'bought back & burned' } as const;

export function Rewards() {
  const { wallet, open, busy, chooserEl } = useLaunchWallet();
  const rate = useBsvUsd();
  const [owed, refresh] = usePoll<{ owed: Owed[] }>(wallet ? `/api/launch/claim?address=${wallet.address}` : null, 20000, { owed: [] });
  const [pays] = usePoll<{ payouts: Payout[] }>('/api/launch/payouts', 20000, { payouts: [] });
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: string }>({});
  const total = owed.owed.reduce((n, o) => n + Number(o.sats), 0);
  const money = (s: number) => (rate ? `${usd(s, rate)} · ${bsv(s)}` : bsv(s));

  const claim = async () => {
    if (!wallet) return open();
    setState({ busy: true });
    try {
      const r = await claimRewards(wallet);
      setState({ done: r.txid });
      refresh();
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={busy} />
      {chooserEl}
      <section className="panel">
        <p className="panel-title mb-2">Your holder rewards</p>
        {!wallet ? (
          <button className="btn btn-fire" onClick={open}>Connect wallet</button>
        ) : (
          <>
            <ul className="text-sm">
              {owed.owed.map((o) => (
                <li key={o.token_id} className="flex justify-between border-t border-line-dim py-0.5">
                  <Link className="hover:text-hot" href={`/launch/${o.token_id}`}>${o.sym}</Link>
                  <span>{money(Number(o.sats))}</span>
                </li>
              ))}
            </ul>
            {!owed.owed.length && <p className="text-dim">Nothing owed yet. Hold ≥100,000 tokens of a coin whose fee goes to its holders.</p>}
            <button className="btn btn-fire mt-2" disabled={state.busy || total < 1000} onClick={claim}>
              {state.busy ? 'Approve in your wallet…' : `Claim ${bsv(total)} into your wallet`}
            </button>
            {total > 0 && total < 1000 && <p className="mt-1 text-xs text-muted">Claims open from 1,000 sats.</p>}
            {state.error && <p className="mt-1 text-sm text-red-400">{state.error}</p>}
            {state.done && <p className="mt-1 text-sm text-green-400">Paid: <a className="underline" href={`https://whatsonchain.com/tx/${state.done}`} target="_blank" rel="noreferrer">{short(state.done)}</a></p>}
          </>
        )}
      </section>
      <section className="panel">
        <p className="panel-title mb-2">Every vault payout</p>
        <ul className="text-sm">
          {pays.payouts.map((p) => (
            <li key={`${p.txid}-${p.token_id}-${p.kind}`} className="flex flex-wrap justify-between gap-2 border-t border-line-dim py-0.5">
              <span><Link className="font-bold hover:text-hot" href={`/launch/${p.token_id}`}>${p.sym}</Link> {KIND[p.kind]}</span>
              <span>{money(Number(p.sats))}{p.kind === 'buyback' ? ` · ${Number(p.tokens).toLocaleString()} burned` : ''}</span>
              <span className="text-muted">{p.txid.startsWith('credit-') ? 'ledger' : <a className="underline" href={`https://whatsonchain.com/tx/${p.txid}`} target="_blank" rel="noreferrer">{short(p.txid)}</a>} · {ago(p.created_at)}</span>
            </li>
          ))}
        </ul>
        {!pays.payouts.length && <p className="text-dim">No payouts yet.</p>}
      </section>
    </main>
  );
}
