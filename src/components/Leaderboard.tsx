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
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">Most blasted tokens</span>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                if (p.id === period) return;
                setTokens(null);
                setPeriod(p.id);
              }}
              className={`btn text-xs ${period === p.id ? 'btn-on' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {tokens === null && (
        <p className="text-dim">
          Loading<span className="blink">…</span>
        </p>
      )}
      {tokens?.length === 0 && <p className="text-dim">No blasts yet. Be first on the board.</p>}
      <ol className="flex flex-col gap-1">
        {tokens?.map((t, n) => (
          <li key={t.tokenId} className="flex items-center gap-3">
            <span className="w-6 text-right text-dim">{n + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.icon ? <img src={t.icon} alt="" className="h-5 w-5 [image-rendering:pixelated]" /> : <span className="h-5 w-5 bg-muted" />}
            <span className="w-28 overflow-hidden text-ellipsis whitespace-nowrap text-accent">${t.ticker}</span>
            <span className="w-20 text-right text-hot">{t.blasts.toLocaleString()}</span>
            <div className="h-4 flex-1 bg-input">
              <div className="h-full bg-fg" style={{ width: `${top ? (t.blasts / top) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
