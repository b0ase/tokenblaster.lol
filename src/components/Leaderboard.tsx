'use client';

import { useEffect, useState } from 'react';
import { PERIODS, type Period, type TokenScore } from '@/lib/leaderboard';

/** Most blasted tokens, by period (refreshes every 30 s). */
export function Leaderboard() {
  const [period, setPeriod] = useState<Period>('24h');
  const [tokens, setTokens] = useState<TokenScore[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/leaderboard?period=${period}`)
        .then((r) => r.json())
        .then((d: { tokens?: TokenScore[] }) => alive && setTokens(d.tokens ?? []))
        .catch(() => alive && setTokens([]));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [period]);

  const top = tokens?.[0]?.blasts ?? 0;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[#2a2a35] bg-[#14141c] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-lg font-bold text-white">Most blasted tokens</h2>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                if (p.id === period) return;
                setTokens(null);
                setPeriod(p.id);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs ${period === p.id ? 'bg-[#ffd24d] text-black' : 'text-[#a8a8b8]'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {tokens === null && <p className="text-sm text-[#a8a8b8]">Loading…</p>}
      {tokens?.length === 0 && <p className="text-sm text-[#a8a8b8]">No blasts yet. Be first on the board.</p>}
      <ol className="flex flex-col gap-2">
        {tokens?.map((t, n) => (
          <li key={t.tokenId} className="flex items-center gap-3">
            <span className="w-6 text-right font-mono text-sm text-[#a8a8b8]">{n + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.icon ? <img src={t.icon} alt="" className="h-8 w-8 rounded-full" /> : <span className="h-8 w-8 rounded-full bg-[#2a2a35]" />}
            <div className="relative h-8 flex-1 overflow-hidden rounded-lg bg-[#0b0b10]">
              <div className="h-full bg-[#ffd24d]/80" style={{ width: `${top ? (t.blasts / top) * 100 : 0}%` }} />
              <span className="absolute inset-y-0 left-3 flex items-center font-mono text-sm font-bold text-white">${t.ticker}</span>
            </div>
            <span className="w-24 text-right font-mono text-sm text-white">{t.blasts.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
