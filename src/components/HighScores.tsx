'use client';

/**
 * Arcade high scores. <HighScores> goes on a game-over / debrief screen: name (remembered) + SUBMIT,
 * then the top 10. <HighScoresPanel> is the compact top 5 under a game. useRunClock() times a run.
 * LIVE runs whose last tx checks out on chain get a ✓ linking to WhatsOnChain.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanHandle } from '@/lib/identity';
import { cachedProof, type XProof } from '@/lib/xproof';
import { IdentityPicker, PlayerBadge, useMyHandle } from './PlayerBadge';
import type { ScoreGame, ScorePeriod, ScoreRow, ScoreSort } from '@/lib/scores';

const NAME_KEY = 'tb:scores:name';
const EVENT = 'tb:scores';
const PERIODS: { id: ScorePeriod; label: string }[] = [
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
  { id: 'all', label: 'ALL' },
];

/** Seconds of play: counts while `playing` is true, resets when a new run starts. */
export function useRunClock(playing: boolean) {
  const start = useRef(0);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (playing) {
      start.current = performance.now();
      return;
    }
    if (start.current) {
      const s = (performance.now() - start.current) / 1000;
      void Promise.resolve().then(() => setSecs(s));
    }
  }, [playing]);
  return secs;
}

const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function useTop(game: ScoreGame, period: ScorePeriod, limit: number, sort: ScoreSort) {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/scores?game=${game}&period=${period}&limit=${limit}&sort=${sort}`, { cache: 'no-store' });
      const j = (await r.json()) as { scores?: ScoreRow[] };
      if (!r.ok || !j.scores) throw new Error();
      setRows(j.scores);
      setErr(false);
    } catch {
      setErr(true);
    }
  }, [game, period, limit, sort]);
  useEffect(() => {
    void Promise.resolve().then(load);
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === game) void load();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [load, game]);
  return { rows, err };
}

function Table({ rows, err, sort, highlight }: { rows: ScoreRow[] | null; err: boolean; sort: ScoreSort; highlight?: number | null }) {
  if (err) return <p className="text-xs text-dim">Scores unavailable right now.</p>;
  if (!rows) return <p className="text-xs text-dim">Loading…</p>;
  if (!rows.length) return <p className="text-xs text-dim">No scores yet. Be first.</p>;
  return (
    <ol className="flex flex-col gap-0.5 text-left text-xs">
      {rows.map((r, i) => (
        <li key={r.id} className={`flex items-center gap-2 px-1 ${r.id === highlight ? 'bg-white/10 text-hot' : ''}`}>
          <span className="w-5 text-right text-dim">{i + 1}.</span>
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-fg">
            {cleanHandle(r.meta?.x) ? <PlayerBadge handle={cleanHandle(r.meta?.x)} name={r.name} verified={r.meta?.xv === 1} size={16} /> : r.name}
          </span>
          {r.mode === 'live' &&
            (r.verified && r.txid ? (
              <a href={`https://whatsonchain.com/tx/${r.txid}`} target="_blank" rel="noopener noreferrer" title="Verified on chain" className="text-[var(--ok)] hover:underline">
                ✓ on chain
              </a>
            ) : (
              <span className="text-dim" title="LIVE run, not verified on chain">
                live
              </span>
            ))}
          <span className="w-16 text-right text-hot">{sort === 'time' ? fmtSecs(r.secs) : r.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

function PeriodTabs({ period, setPeriod }: { period: ScorePeriod; setPeriod: (p: ScorePeriod) => void }) {
  return (
    <div className="flex gap-1">
      {PERIODS.map((p) => (
        <button key={p.id} onClick={() => setPeriod(p.id)} className={`px-1.5 text-[10px] tracking-widest ${period === p.id ? 'text-hot' : 'text-dim hover:text-fg'}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

function SortTabs({ sorts, sort, setSort, label }: { sorts: ScoreSort[]; sort: ScoreSort; setSort: (s: ScoreSort) => void; label: string }) {
  return (
    <>
      {sorts.map((s) => (
        <button key={s} onClick={() => setSort(s)} className={sort === s ? 'text-hot' : 'text-dim hover:text-fg'}>
          {s === 'time' ? 'FASTEST' : `MOST ${label}`}
        </button>
      ))}
    </>
  );
}

/** Game-over block: submit this run, then the top 10. `sorts` lets a board offer fastest time too. */
export function HighScores({
  game,
  score,
  secs,
  live,
  txid,
  meta,
  label = 'SCORE',
  sorts = ['score'],
}: {
  game: ScoreGame;
  score: number;
  secs: number;
  live: boolean;
  txid?: string | null;
  meta?: Record<string, string | number>;
  label?: string;
  sorts?: ScoreSort[];
}) {
  const [name, setName] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const [period, setPeriod] = useState<ScorePeriod>('all');
  const [sort, setSort] = useState<ScoreSort>(sorts[0]);
  const top = useTop(game, period, 10, sort);
  useEffect(() => {
    try {
      const n = localStorage.getItem(NAME_KEY);
      if (n) void Promise.resolve().then(() => setName(n));
    } catch {
      /* storage blocked */
    }
  }, []);
  const handle = useMyHandle();
  const submit = async () => {
    const n = (name.replace(/[^A-Za-z0-9 _.\-]/g, '').trim() || handle || '').slice(0, 16);
    if (!n) return setMsg('Enter a name (letters, numbers, space, _ . -).');
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* storage blocked */
    }
    setState('sending');
    setMsg(null);
    try {
      const sc = Math.max(0, Math.floor(score));
      const sx = Math.round(secs * 10) / 10;
      // Never prompts: attach the cached ✓ VERIFY proof if the player made one (earns the identity tick).
      const xp: XProof | null = cachedProof(handle);
      const r = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, mode: live ? 'live' : 'practice', name: n, score: sc, secs: sx, meta, txid: live ? (txid ?? null) : null, x: handle ?? undefined, xp: xp ?? undefined }),
      });
      const j = (await r.json()) as { ok?: boolean; id?: number; verified?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'Rejected');
      setState('sent');
      setMine(j.id ?? null);
      setMsg(live ? (j.verified ? 'Submitted · ✓ verified on chain.' : 'Submitted · not verified on chain (tx not found yet).') : 'Submitted.');
      window.dispatchEvent(new CustomEvent(EVENT, { detail: game }));
    } catch (e) {
      setState('idle');
      setMsg(e instanceof Error ? e.message : 'Submit failed');
    }
  };
  return (
    <div className="inset flex w-full max-w-sm flex-col gap-2 bg-black/70 p-2" onKeyDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-widest text-dim">HIGH SCORES</span>
        <PeriodTabs period={period} setPeriod={setPeriod} />
      </div>
      {state !== 'sent' && (
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="Enter your name"
            maxLength={16}
            aria-label="Your name"
            className="min-w-0 flex-1 border border-line bg-input px-2 py-1 text-sm text-fg"
          />
          <button onClick={() => void submit()} disabled={state === 'sending'} className="btn px-2 py-1 text-xs">
            {state === 'sending' ? '…' : 'SUBMIT'}
          </button>
        </div>
      )}
      {state !== 'sent' && <IdentityPicker compact />}
      {msg && <p className="text-xs text-accent">{msg}</p>}
      {live && !txid && state !== 'sent' && <p className="text-[10px] text-dim">No on-chain tx in this run, so it can’t be verified.</p>}
      {sorts.length > 1 && (
        <div className="flex gap-2 text-[10px] tracking-widest">
          <SortTabs sorts={sorts} sort={sort} setSort={setSort} label={label} />
        </div>
      )}
      <Table rows={top.rows} err={top.err} sort={sort} highlight={mine} />
    </div>
  );
}

/** Compact top 5 for a game page. Several boards (e.g. missions) get tabs. */
export function HighScoresPanel({ games, titles, sorts = ['score'], label = 'SCORE' }: { games: ScoreGame[]; titles?: string[]; sorts?: ScoreSort[]; label?: string }) {
  const [gi, setGi] = useState(0);
  const [period, setPeriod] = useState<ScorePeriod>('all');
  const [sort, setSort] = useState<ScoreSort>(sorts[0]);
  const top = useTop(games[gi], period, 5, sort);
  return (
    <section className="panel flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-widest text-hot">HIGH SCORES</h2>
        <PeriodTabs period={period} setPeriod={setPeriod} />
      </div>
      {(games.length > 1 || sorts.length > 1) && (
        <div className="flex flex-wrap gap-2 text-[10px] tracking-widest">
          {games.length > 1 &&
            games.map((g, i) => (
              <button key={g} onClick={() => setGi(i)} className={gi === i ? 'text-hot' : 'text-dim hover:text-fg'}>
                {(titles?.[i] ?? g).toUpperCase()}
              </button>
            ))}
          {games.length > 1 && sorts.length > 1 && <span className="text-dim">|</span>}
          {sorts.length > 1 && <SortTabs sorts={sorts} sort={sort} setSort={setSort} label={label} />}
        </div>
      )}
      <Table rows={top.rows} err={top.err} sort={sort} />
    </section>
  );
}
