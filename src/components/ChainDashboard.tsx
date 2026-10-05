'use client';

/**
 * The landing dashboard: most-blasted tokens up top, then bsv.lol-style live chain panels, all fed
 * by the page's one shared JungleBus stream (src/lib/chainStream.ts). Transactions land in refs;
 * React state is refreshed on a timer (never per tx), so 300 tx/s stays cheap.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlocksSummary } from '@/lib/blocks';
import { subscribeStatus, subscribeTx, type StreamStatus } from '@/lib/chainStream';
import { APPS, APP_COLOR, type AppId, type FeedTx } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';
import { Highway } from './Highway';
import { Leaderboard } from './Leaderboard';

const FEED_CAP = 60;
const MEMPOOL_CAP = 720;
const WINDOWS = [
  { id: 60_000, label: '1m' },
  { id: 300_000, label: '5m' },
  { id: 900_000, label: '15m' },
  { id: 0, label: 'session' },
];
const SPEEDS = [
  { id: 1500, label: '0.3x' },
  { id: 500, label: '1x' },
  { id: 150, label: '3x' },
];

type Seen = { at: number; app: AppId; name: string; token?: string; amt?: string };

type Row = { name: string; app: AppId; n: number };
type Mover = { id: string; n: number; amt: bigint; blasts: number };
type Snap = { now: number; feed: FeedTx[]; total: number; rate: number; lastAt: number; mempool: AppId[]; blasts: FeedTx[]; breakdown: { rows: Row[]; total: number }; movers: Mover[] };
const EMPTY: Snap = { now: 0, feed: [], total: 0, rate: 0, lastAt: 0, mempool: [], blasts: [], breakdown: { rows: [], total: 0 }, movers: [] };

function computeBreakdown(seen: Seen[], session: Map<string, { app: AppId; n: number }>, sessionTotal: number, win: number, now: number) {
  const m = new Map<string, { app: AppId; n: number }>();
  let total = sessionTotal;
  if (win) {
    total = 0;
    for (const x of seen) {
      if (x.at < now - win) continue;
      total++;
      const c = m.get(x.name);
      if (c) c.n++;
      else m.set(x.name, { app: x.app, n: 1 });
    }
  } else for (const [k, v] of session) m.set(k, { ...v });
  const rows: Row[] = [...m].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n);
  const top = rows.slice(0, 14);
  const rest = rows.slice(14).reduce((n, r) => n + r.n, 0);
  if (rest) top.push({ name: `${rows.length - 14} others`, app: 'opreturn', n: rest });
  return { rows: top, total };
}

function computeMovers(seen: Seen[], win: number, now: number): Mover[] {
  const by = new Map<string, { n: number; amt: bigint; blasts: number }>();
  for (const x of seen) {
    if (x.at < now - win || !x.token) continue;
    const c = by.get(x.token) ?? { n: 0, amt: BigInt(0), blasts: 0 };
    c.n++;
    if (x.app === 'tokenblaster') c.blasts++;
    if (x.amt && /^\d+$/.test(x.amt)) c.amt += BigInt(x.amt);
    by.set(x.token, c);
  }
  return [...by].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.n - a.n).slice(0, 16);
}

const appOf = (f: FeedTx): AppId => f.app ?? 'payment';
const labelOf = (id: AppId) => APPS.find((a) => a.id === id)?.label ?? id;
const nameOf = (f: FeedTx) => f.appName ?? labelOf(appOf(f));
const bsv = (sats: number) => (sats / 1e8).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const ago = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
const market = (id: string) => (/_\d+$/.test(id) ? `https://1sat.market/market/bsv21/${id}` : `https://1sat.market/market/bsv20/${id}`);

/** "$SYM transfer 1,000" when we know the token, else the raw preview. */
function tokenLine(f: FeedTx) {
  if (!f.token) return null;
  const meta = tokenMeta(f.token);
  let amt = f.amt ?? '';
  if (meta && f.amt && /^\d+$/.test(f.amt)) amt = (Number(f.amt) / 10 ** meta.dec).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return { meta, text: `$${meta?.sym ?? f.token.slice(0, 8)} ${f.app === 'tokenblaster' ? 'blast' : (f.op ?? 'transfer')}${amt ? ` ${amt}` : ''}` };
}

function hexToText(h: string) {
  const bytes = h.match(/../g)?.map((x) => parseInt(x, 16)) ?? [];
  return new TextDecoder('utf-8', { fatal: false })
    .decode(Uint8Array.from(bytes))
    .replace(/[\u0000-\u001f\u007f-\u009f�]+/g, '·');
}

export function ChainDashboard() {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [selected, setSelected] = useState<FeedTx | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(500);
  const [win, setWin] = useState(300_000);
  const [hidden, setHidden] = useState<Set<AppId>>(() => new Set());
  const [snap, setSnap] = useState<Snap>(EMPTY);

  const store = useRef({
    incoming: [] as FeedTx[],
    feed: [] as FeedTx[],
    seen: [] as Seen[],
    session: new Map<string, { app: AppId; n: number }>(),
    sessionTotal: 0,
    mempool: new Map<string, AppId>(),
    times: [] as number[],
    lastAt: 0,
    blasts: [] as FeedTx[],
    total: 0,
    flushes: 0,
    breakdown: EMPTY.breakdown,
    movers: EMPTY.movers,
  });
  const opts = useRef({ paused, hidden, win });
  useEffect(() => {
    opts.current = { paused, hidden, win };
    store.current.flushes = -1; // recompute aggregates on the next flush
  }, [paused, hidden, win]);

  useEffect(() => {
    const offS = subscribeStatus(setStatus);
    const offT = subscribeTx((f) => {
      const s = store.current;
      const now = Date.now();
      const app = appOf(f);
      s.total++;
      s.lastAt = now;
      s.times.push(now);
      const name = nameOf(f);
      s.seen.push({ at: now, app, name, token: f.token, amt: f.amt });
      const cur = s.session.get(name);
      if (cur) cur.n++;
      else if (s.session.size < 400) s.session.set(name, { app, n: 1 });
      s.sessionTotal++;
      if (f.mined) s.mempool.delete(f.id);
      else {
        s.mempool.set(f.id, app);
        if (s.mempool.size > MEMPOOL_CAP) s.mempool.delete(s.mempool.keys().next().value as string);
      }
      if (app === 'tokenblaster' || app === 'txblaster') {
        s.blasts.unshift(f);
        if (s.blasts.length > 24) s.blasts.pop();
      }
      if (!opts.current.paused && !opts.current.hidden.has(app)) {
        s.incoming.push(f);
        if (s.incoming.length > FEED_CAP) s.incoming.splice(0, s.incoming.length - FEED_CAP);
      }
    });
    return () => {
      offS();
      offT();
    };
  }, []);

  // Flush to the screen at the chosen speed; heavier aggregates about once a second.
  useEffect(() => {
    const every = Math.max(1, Math.round(1000 / speed));
    const t = setInterval(() => {
      const s = store.current;
      const now = Date.now();
      s.times = s.times.filter((x) => x > now - 10_000);
      const keep = now - 900_000;
      if (s.seen.length && s.seen[0].at < keep) s.seen = s.seen.filter((x) => x.at >= keep);
      if (s.seen.length > 200_000) s.seen.splice(0, s.seen.length - 200_000);
      if (s.incoming.length) {
        s.feed = [...s.incoming.reverse(), ...s.feed].slice(0, FEED_CAP);
        s.incoming = [];
      }
      if (s.flushes < 0 || s.flushes % every === 0) {
        s.breakdown = computeBreakdown(s.seen, s.session, s.sessionTotal, opts.current.win, now);
        s.movers = computeMovers(s.seen, opts.current.win || 900_000, now);
        s.flushes = 0;
      }
      s.flushes++;
      setSnap({
        now,
        feed: s.feed,
        total: s.total,
        rate: s.times.length / 10,
        lastAt: s.lastAt,
        mempool: [...s.mempool.values()],
        blasts: s.blasts.slice(),
        breakdown: s.breakdown,
        movers: s.movers,
      });
    }, speed);
    return () => clearInterval(t);
  }, [speed]);

  const { now, rate, breakdown, movers } = snap;
  const toggle = (id: AppId) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onSelect = useCallback((f: FeedTx) => setSelected(f), []);
  const s = snap;

  return (
    <>
      {/* Hero: the token-blasting board */}
      <section className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Leaderboard hero />
        <div className="flex min-w-0 flex-col gap-3">
          <BlastTicker blasts={s.blasts} status={status} now={now} onSelect={onSelect} />
          <TokensMoving movers={movers} win={win} />
        </div>
      </section>

      <Highway onSelect={onSelect} showMovers={false} />

      <section className="grid min-w-0 gap-3 lg:grid-cols-3">
        {/* Live feed */}
        <div className="panel min-w-0 lg:col-span-2">
          <div className="panel-header">
            <span className="panel-title">Live feed</span>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="mr-1 text-dim">total {s.total.toLocaleString()}</span>
              <button className={`btn text-xs ${paused ? 'btn-on' : ''}`} onClick={() => setPaused((p) => !p)} title="Pause/resume">
                {paused ? '▶ RESUME' : '❚❚ PAUSE'}
              </button>
              {SPEEDS.map((sp) => (
                <button key={sp.id} className={`btn text-xs ${speed === sp.id ? 'btn-on' : ''}`} onClick={() => setSpeed(sp.id)}>
                  {sp.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2 flex flex-wrap gap-1 text-xs">
            <button className="btn text-xs" onClick={() => setHidden(new Set())}>
              ALL
            </button>
            <button className="btn text-xs" onClick={() => setHidden(new Set(APPS.map((a) => a.id)))}>
              NONE
            </button>
            {APPS.map((a) => (
              <button
                key={a.id}
                onClick={() => toggle(a.id)}
                className={`inset px-1.5 py-0.5 ${hidden.has(a.id) ? 'opacity-35' : 'hover:border-fg'}`}
                title={`Show/hide ${a.label}`}
              >
                <span className="mr-1 inline-block h-2 w-2" style={{ background: a.color }} />
                {a.label}
              </button>
            ))}
          </div>
          <ol className="inset h-[420px] overflow-y-auto overflow-x-hidden text-xs">
            {s.feed.length === 0 && <li className="p-2 text-dim">{status === 'off' ? 'No feed configured.' : paused ? 'Paused.' : 'Waiting for transactions…'}</li>}
            {s.feed.map((f) => (
              <FeedRow key={f.id} f={f} active={selected?.id === f.id} onClick={() => setSelected(f)} />
            ))}
          </ol>
        </div>

        {/* Inspector + meter + mempool */}
        <div className="flex min-w-0 flex-col gap-3">
          <Inspector f={selected} />
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Throughput</span>
              <span className="text-xs text-dim">last tx {s.lastAt ? `${ago(Math.max(0, (now - s.lastAt) / 1000))} ago` : '—'}</span>
            </div>
            <div className="flex items-end gap-3">
              <span className="text-4xl font-bold text-hot">{rate.toFixed(1)}</span>
              <span className="pb-1 text-dim">tx/s · 10 s avg</span>
            </div>
            <div className="mt-2 h-2 bg-input">
              <div className="h-full bg-fg transition-[width]" style={{ width: `${Math.min(100, (Math.log10(1 + rate) / Math.log10(1001)) * 100)}%` }} />
            </div>
          </div>
          <MempoolGrid cells={s.mempool} />
        </div>
      </section>

      <section className="grid min-w-0 gap-3 lg:grid-cols-3">
        <div className="panel min-w-0">
          <div className="panel-header">
            <span className="panel-title">Protocol / app breakdown</span>
            <div className="flex gap-1">
              {WINDOWS.map((w) => (
                <button key={w.id} className={`btn text-xs ${win === w.id ? 'btn-on' : ''}`} onClick={() => setWin(w.id)}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-1 text-xs text-dim">{breakdown.total.toLocaleString()} txs</p>
          <ul className="flex flex-col gap-1 text-xs">
            {breakdown.rows.map((r) => {
              const pct = breakdown.total ? (r.n / breakdown.total) * 100 : 0;
              return (
                <li key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-2">
                  <span className="relative overflow-hidden whitespace-nowrap">
                    <span className="absolute inset-y-0 left-0 opacity-25" style={{ width: `${pct}%`, background: APP_COLOR[r.app] }} />
                    <span className="relative">
                      <span className="mr-1 inline-block h-2 w-2" style={{ background: APP_COLOR[r.app] }} />
                      {r.name}
                    </span>
                  </span>
                  <span className="text-hot">{r.n.toLocaleString()}</span>
                  <span className="text-right text-dim">{pct.toFixed(1)}%</span>
                </li>
              );
            })}
            {breakdown.rows.length === 0 && <li className="text-dim">No traffic yet.</li>}
          </ul>
        </div>
        <Blocks />
      </section>
    </>
  );
}

function FeedRow({ f, active, onClick }: { f: FeedTx; active: boolean; onClick: () => void }) {
  const app = appOf(f);
  const tl = tokenLine(f);
  return (
    <li
      onClick={onClick}
      className={`grid cursor-pointer grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 border-b border-line-canvas px-2 py-1 hover:bg-active sm:grid-cols-[7.5rem_6.5rem_7rem_minmax(0,1fr)] ${active ? 'bg-active' : ''}`}
    >
      <span className="overflow-hidden text-ellipsis whitespace-nowrap font-bold" style={{ color: APP_COLOR[app] }}>
        {f.appName?.startsWith('ordinal') ? 'ordinal' : nameOf(f)}
      </span>
      <span className="text-right text-hot sm:order-none">{bsv(f.sats)}</span>
      <a
        href={`https://whatsonchain.com/tx/${f.id}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-dim hover:text-hot"
      >
        {short(f.id)}
        {f.mined ? '' : ' ·m'}
      </a>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-accent">
        {tl?.meta?.iconSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tl.meta.iconSrc} alt="" className="h-4 w-4 shrink-0 rounded object-cover" />
        )}
        <span className="overflow-hidden text-ellipsis">{tl?.text ?? f.preview ?? ''}</span>
      </span>
    </li>
  );
}

function Inspector({ f }: { f: FeedTx | null }) {
  const tl = f ? tokenLine(f) : null;
  return (
    <div className="panel min-w-0">
      <div className="panel-header">
        <span className="panel-title">Transaction inspector</span>
        {f && (
          <a href={`https://whatsonchain.com/tx/${f.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-dim hover:text-hot">
            WhatsOnChain ↗
          </a>
        )}
      </div>
      {!f ? (
        <p className="text-sm text-dim">Click a feed row or a highway car.</p>
      ) : (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          <dt className="text-dim">txid</dt>
          <dd className="break-all text-hot">{f.id}</dd>
          <dt className="text-dim">type / app</dt>
          <dd style={{ color: APP_COLOR[appOf(f)] }}>
            {nameOf(f)} <span className="text-muted">({f.kind})</span>
          </dd>
          <dt className="text-dim">inputs/outputs</dt>
          <dd className="text-hot">
            {f.ins ?? '?'} / {f.outs ?? '?'}
          </dd>
          <dt className="text-dim">total output</dt>
          <dd className="text-hot">{bsv(f.sats)} BSV</dd>
          <dt className="text-dim">size</dt>
          <dd className="text-hot">{f.bytes.toLocaleString()} bytes</dd>
          <dt className="text-dim">status</dt>
          <dd className="text-hot">{f.mined ? 'mined' : 'mempool'}</dd>
          {tl && (
            <>
              <dt className="text-dim">token</dt>
              <dd className="flex min-w-0 items-center gap-2">
                {tl.meta?.iconSrc && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tl.meta.iconSrc} alt="" className="h-6 w-6 rounded object-cover" />
                )}
                <a href={market(f.token!)} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-accent hover:text-hot">
                  {tl.text}
                </a>
              </dd>
              <dt className="text-dim">token id</dt>
              <dd className="break-all text-muted">{f.token}</dd>
            </>
          )}
          {f.preview && !tl && (
            <>
              <dt className="text-dim">preview</dt>
              <dd className="break-words text-accent">{f.preview}</dd>
            </>
          )}
          {f.opReturn && (
            <>
              <dt className="text-dim">OP_RETURN</dt>
              <dd className="inset max-h-20 overflow-y-auto break-all p-1 text-muted">{f.opReturn}</dd>
              <dt className="text-dim">decoded</dt>
              <dd className="inset max-h-20 overflow-y-auto break-all p-1 text-accent">{hexToText(f.opReturn)}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function MempoolGrid({ cells }: { cells: AppId[] }) {
  return (
    <div className="panel min-w-0">
      <div className="panel-header">
        <span className="panel-title">Mempool ({cells.length.toLocaleString()})</span>
        <span className="text-xs text-dim">seen unconfirmed</span>
      </div>
      <div className="inset flex h-36 flex-wrap content-start gap-[2px] overflow-hidden p-1">
        {cells.map((a, i) => (
          <span key={i} className="h-[6px] w-[6px]" style={{ background: APP_COLOR[a] }} />
        ))}
      </div>
    </div>
  );
}

function BlastTicker({ blasts, status, now, onSelect }: { blasts: FeedTx[]; status: StreamStatus; now: number; onSelect: (f: FeedTx) => void }) {
  return (
    <div className="panel min-w-0">
      <div className="panel-header">
        <span className="panel-title">Blasts happening now</span>
        <span className="text-xs text-accent">{status === 'live' ? <><span className="blink">●</span> LIVE</> : status}</span>
      </div>
      <ul className="inset h-40 overflow-y-auto overflow-x-hidden text-xs">
        {blasts.length === 0 && <li className="p-2 text-dim">Watching the chain for tokenblaster.lol and 🔥 blasts…</li>}
        {blasts.map((f) => {
          const tl = tokenLine(f);
          return (
            <li key={f.id} onClick={() => onSelect(f)} className="flex cursor-pointer items-center gap-2 border-b border-line-canvas px-2 py-1 hover:bg-active">
              {tl?.meta?.iconSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tl.meta.iconSrc} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
              ) : (
                <span className="w-5 shrink-0 text-center">{f.app === 'txblaster' ? '🔥' : '✶'}</span>
              )}
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-hot">
                {f.app === 'txblaster' ? 'TXBLASTER 🔥' : (tl?.text ?? 'TokenBlaster blast')}
              </span>
              <span className="shrink-0 text-dim">{f.at ? `${ago(Math.max(0, (now - f.at) / 1000))}` : ''}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/blast" className="btn btn-on px-3 py-1">
          BLAST NOW &gt;
        </Link>
        <Link href="/arena" className="btn px-3 py-1">
          ARENA &gt;
        </Link>
      </div>
    </div>
  );
}

function TokensMoving({ movers, win }: { movers: Mover[]; win: number }) {
  return (
    <div className="panel min-w-0">
      <div className="panel-header">
        <span className="panel-title">Tokens moving now</span>
        <span className="text-xs text-dim">last {WINDOWS.find((w) => w.id === win && w.id)?.label ?? '15m'}</span>
      </div>
      {movers.length === 0 ? (
        <p className="text-xs text-dim">No token transfers seen yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {movers.map((m) => {
            const meta = tokenMeta(m.id);
            const amt = meta ? Number(m.amt) / 10 ** meta.dec : null;
            return (
              <a key={m.id} href={market(m.id)} target="_blank" rel="noopener noreferrer" className="inset flex min-w-0 items-center gap-2 px-2 py-1 text-xs hover:border-fg">
                {meta?.iconSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={meta.iconSrc} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded bg-input" />
                )}
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  <span className="text-hot">${meta?.sym ?? m.id.slice(0, 8)}</span>
                  <span className="text-dim">
                    {' '}
                    · {m.n} tx{m.blasts ? ` · ${m.blasts} blasts` : ''}
                    {amt !== null && amt > 0 ? ` · ${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Blocks() {
  const [data, setData] = useState<BlocksSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [nowS, setNowS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowS(Date.now() / 1000), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/blocks')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: BlocksSummary) => alive && (setData(d), setFailed(false), setNowS(Date.now() / 1000)))
        .catch(() => alive && setFailed(true));
    load();
    const t = setInterval(load, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const last = data?.blocks[0];
  return (
    <>
      <div className="panel min-w-0">
        <div className="panel-header">
          <span className="panel-title">Recent blocks</span>
          <span className="text-xs text-dim">last block {last ? `${ago(Math.max(0, nowS - last.time))} ago` : '—'}</span>
        </div>
        {!data && <p className="text-xs text-dim">{failed ? 'Block data unavailable, retrying…' : 'Loading…'}</p>}
        <ul className="flex max-h-[360px] flex-col gap-1 overflow-y-auto text-xs">
          {data?.blocks.map((b) => (
            <li key={b.height} className="inset">
              <button className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 px-2 py-1 text-left hover:bg-active" onClick={() => setOpen(open === b.height ? null : b.height)}>
                <span className="text-hot">{b.height.toLocaleString()}</span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-accent">{b.miner}</span>
                <span className="text-dim">
                  {b.txCount.toLocaleString()} tx · {ago(Math.max(0, nowS - b.time))}
                </span>
              </button>
              {open === b.height && (
                <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 border-t border-line-canvas px-2 py-1">
                  <dt className="text-dim">hash</dt>
                  <dd className="break-all">
                    <a href={`https://whatsonchain.com/block-height/${b.height}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-hot">
                      {b.hash}
                    </a>
                  </dd>
                  <dt className="text-dim">size</dt>
                  <dd className="text-hot">{(b.size / 1e6).toFixed(2)} MB</dd>
                  <dt className="text-dim">total fees</dt>
                  <dd className="text-hot">{b.fees.toFixed(8)} BSV</dd>
                  <dt className="text-dim">time</dt>
                  <dd className="text-hot">{new Date(b.time * 1000).toLocaleString()}</dd>
                </dl>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="panel min-w-0">
        <div className="panel-header">
          <span className="panel-title">Miners</span>
          <span className="text-xs text-dim">last {data?.window ?? 0} blocks</span>
        </div>
        {data && (
          <div className="mb-2 grid grid-cols-2 gap-1 text-xs">
            <Stat k="avg size" v={`${(data.avgSize / 1e6).toFixed(2)} MB`} />
            <Stat k="avg fees" v={`${data.avgFees.toFixed(5)} BSV`} />
            <Stat k="avg interval" v={data.avgInterval ? `${(data.avgInterval / 60).toFixed(1)} min` : '—'} />
            <Stat k="avg txs" v={Math.round(data.avgTx).toLocaleString()} />
          </div>
        )}
        <ul className="flex flex-col gap-1 text-xs">
          {data?.miners.slice(0, 12).map((m) => (
            <li key={m.name} className="grid grid-cols-[minmax(0,1fr)_2.5rem_3.5rem] items-center gap-2">
              <span className="relative overflow-hidden whitespace-nowrap">
                <span className="absolute inset-y-0 left-0 bg-fg opacity-25" style={{ width: `${m.pct}%` }} />
                <span className="relative text-accent">{m.name}</span>
              </span>
              <span className="text-right text-hot">{m.blocks}</span>
              <span className="text-right text-dim">{m.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
        {data && data.window < 100 && <p className="mt-2 text-xs text-muted">Window fills as blocks are fetched (polite to WhatsOnChain).</p>}
      </div>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="inset px-2 py-1">
      <span className="text-dim">{k}: </span>
      <span className="text-hot">{v}</span>
    </div>
  );
}
