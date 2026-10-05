'use client';

import { useEffect, useState } from 'react';
import { PERIODS, type Period, type TokenScore } from '@/lib/leaderboard';

/** Most blasted tokens, by period (refreshes every 30 s). */
export function Leaderboard({ hero = false }: { hero?: boolean } = {}) {
  const [period, setPeriod] = useState<Period>('24h');
  const [tokens, setTokens] = useState<TokenScore[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [games, setGames] = useState<{ game: string; blasts: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/leaderboard?period=${period}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: { tokens?: TokenScore[] }) => alive && (setTokens(d.tokens ?? []), setFailed(false)))
        .catch(() => alive && (setTokens([]), setFailed(true)));
    const loadGames = () =>
      fetch(`/api/games?period=${period}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: { games?: { game: string; blasts: number }[] }) => alive && setGames(d.games ?? []))
        .catch(() => undefined);
    load();
    loadGames();
    const t = setInterval(() => (load(), loadGames()), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [period]);

  const top = tokens?.[0]?.blasts ?? 0;
  const total = tokens?.reduce((n, t) => n + t.blasts, 0) ?? 0;
  const icon = hero ? 'h-9 w-9' : 'h-5 w-5';
  return (
    <section className={`panel min-w-0 ${hero ? 'border-fg shadow-[0_0_18px_rgba(245,184,0,0.25)]' : ''}`}>
      <div className="panel-header">
        <span className={`panel-title ${hero ? 'text-xl text-hot sm:text-2xl' : ''}`}>{hero ? '> Most blasted tokens' : 'Most blasted tokens'}</span>
        <div className="flex flex-wrap gap-1">
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
              {hero ? p.id.toUpperCase() : p.label}
            </button>
          ))}
        </div>
      </div>
      {hero && total > 0 && (
        <p className="mb-2 text-sm text-dim">
          <span className="text-hot">{total.toLocaleString()}</span> blasts confirmed on chain · {PERIODS.find((p) => p.id === period)?.label.toLowerCase()}
        </p>
      )}
      {hero && games.some((g) => g.game !== 'untagged') && (
        <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
          <span>by game:</span>
          {games.map((g) => (
            <span key={g.game}>
              {g.game === 'untagged' ? 'earlier (untagged)' : g.game} <span className="text-hot">{g.blasts.toLocaleString()}</span>
            </span>
          ))}
        </p>
      )}
      {tokens === null && (
        <p className="text-dim">
          Loading<span className="blink">…</span>
        </p>
      )}
      {tokens?.length === 0 && <p className="text-dim">{failed ? 'Leaderboard unavailable, retrying…' : 'No blasts yet. Be first on the board.'}</p>}
      <ol className={`flex flex-col ${hero ? 'gap-1.5' : 'gap-1'}`}>
        {tokens?.map((t, n) => (
          <li key={t.tokenId} className={`flex min-w-0 items-center gap-3 ${hero ? 'inset px-2 py-1.5' : ''}`}>
            <span className={`w-6 shrink-0 text-right ${hero && n < 3 ? 'text-lg font-bold text-hot' : 'text-dim'}`}>{n + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.icon ? <img src={t.icon} alt="" className={`${icon} shrink-0 rounded object-cover`} /> : <span className={`${icon} shrink-0 bg-muted`} />}
            <a
              href={/_\d+$/.test(t.tokenId) ? `https://1sat.market/market/bsv21/${t.tokenId}` : `https://1sat.market/market/bsv20/${t.tokenId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${hero ? 'w-24 text-base font-bold sm:w-36' : 'w-28'} shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-accent hover:text-hot`}
            >
              ${t.ticker}
            </a>
            <div className="h-4 min-w-0 flex-1 bg-input">
              <div className="h-full bg-fg" style={{ width: `${top ? (t.blasts / top) * 100 : 0}%` }} />
            </div>
            <span className={`shrink-0 text-right text-hot ${hero ? 'w-24 text-base font-bold' : 'w-20'}`}>{t.blasts.toLocaleString()}</span>
            {hero && <span className="hidden w-14 shrink-0 text-right text-xs text-dim sm:inline">{total ? ((t.blasts / total) * 100).toFixed(1) : 0}%</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
