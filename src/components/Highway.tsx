'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChainStats } from '@/lib/chain';
import { subscribeStatus, subscribeTx, type StreamStatus } from '@/lib/chainStream';
import { KINDS, type FeedTx, type TxKind } from '@/lib/feed';
import { tokenMeta } from '@/lib/tokenMeta';

const WINDOW_MS = 60_000;
const LANE: Record<TxKind, number> = Object.fromEntries(KINDS.map((k, i) => [k.id, i])) as Record<TxKind, number>;


/**
 * The highway: every car is a real BSV transaction from the GorillaPool JungleBus stream
 * (mempool and newly mined). Lane = what the transaction carries, length = its size.
 * Click a car to open the transaction (or hand it to `onSelect`, e.g. the dashboard inspector).
 */
export function Highway({ onSelect, showMovers = true }: { onSelect?: (f: FeedTx) => void; showMovers?: boolean } = {}) {
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const queue = useRef<FeedTx[]>([]);
  const seen = useRef<{ at: number; kind: TxKind; token?: string; amt?: string }[]>([]);
  const [movers, setMovers] = useState<{ id: string; n: number; amt: bigint }[]>([]);
  const [tip, setTip] = useState<ChainStats | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [counts, setCounts] = useState<{ rate: number; byKind: Record<TxKind, number>; now: number } | null>(null);

  // Chain tip from GorillaPool.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/chain')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((s: ChainStats) => alive && setTip(s))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Live transactions from the page's shared JungleBus stream.
  useEffect(() => {
    const offStatus = subscribeStatus(setStatus);
    const offTx = subscribeTx((f) => {
      seen.current.push({ at: Date.now(), kind: f.kind, token: f.token, amt: f.amt });
      if (queue.current.length < 300) queue.current.push(f);
    });
    return () => {
      offStatus();
      offTx();
    };
  }, []);

  // Rolling one-minute counts.
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - WINDOW_MS;
      seen.current = seen.current.filter((s) => s.at >= cutoff);
      const byKind = Object.fromEntries(KINDS.map((k) => [k.id, 0])) as Record<TxKind, number>;
      for (const s of seen.current) byKind[s.kind]++;
      setCounts({ rate: seen.current.length / (WINDOW_MS / 1000), byKind, now: Date.now() });
      // Which tokens are moving, by number of transfers in the last minute.
      const by = new Map<string, { n: number; amt: bigint }>();
      for (const x of seen.current) {
        if (!x.token || (x.kind !== 'token' && x.kind !== 'blast')) continue;
        const cur = by.get(x.token) ?? { n: 0, amt: BigInt(0) };
        cur.n++;
        try {
          cur.amt += BigInt(x.amt ?? 0);
        } catch {
          /* tick amounts can be decimals */
        }
        by.set(x.token, cur);
      }
      setMovers([...by].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.n - a.n).slice(0, 12));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Draw loop.
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    type Car = FeedTx & { x: number; y: number; w: number; h: number; speed: number };
    const cars: Car[] = [];
    let raf = 0;
    const draw = () => {
      const dpr = devicePixelRatio;
      const w = (c.width = c.clientWidth * dpr);
      const h = (c.height = c.clientHeight * dpr);
      const lane = h / KINDS.length;
      ctx.fillStyle = '#050202';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3a1010';
      ctx.setLineDash([20 * dpr, 16 * dpr]);
      for (let i = 1; i < KINDS.length; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * lane);
        ctx.lineTo(w, i * lane);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Release queued transactions; drain faster when the queue backs up.
      const release = Math.max(1, Math.ceil(queue.current.length / 30));
      for (let k = 0; k < release && queue.current.length; k++) {
        const f = queue.current.shift()!;
        const l = LANE[f.kind];
        const cw = (f.token ? 150 : Math.min(160, 14 + Math.log2(f.bytes) * 6)) * dpr;
        cars.push({ ...f, x: -cw - Math.random() * 40 * dpr, y: l * lane + lane * 0.3, w: cw, h: lane * 0.4, speed: (2 + Math.random() * 2) * dpr });
      }
      for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        car.x += car.speed;
        car.y = LANE[car.kind] * lane + lane * 0.3;
        car.h = lane * 0.4;
        if (car.x > w) {
          cars.splice(i, 1);
          continue;
        }
        ctx.fillStyle = KINDS[LANE[car.kind]].color;
        ctx.fillRect(car.x, car.y, car.w, car.h);
        ctx.fillStyle = car.mined ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)';
        ctx.fillRect(car.x, car.y + car.h * 0.75, car.w, car.h * 0.25);
        // Token cars carry the token's icon and symbol.
        const meta = car.token ? tokenMeta(car.token) : null;
        if (meta) {
          const sz = car.h * 0.9;
          if (meta.icon?.complete && meta.icon.naturalWidth) ctx.drawImage(meta.icon, car.x + 2 * dpr, car.y + (car.h - sz) / 2, sz, sz);
          ctx.font = `bold ${Math.max(9, car.h / dpr / 2.2) * dpr}px monospace`;
          ctx.fillStyle = '#0a0404';
          ctx.fillText(`$${meta.sym}`, car.x + sz + 5 * dpr, car.y + car.h * 0.62, Math.max(0, car.w - sz - 7 * dpr));
        }
      }
      ctx.font = `${10 * dpr}px monospace`;
      ctx.fillStyle = '#7a3a30';
      KINDS.forEach((k, i) => ctx.fillText(k.label.toUpperCase(), 6 * dpr, i * lane + 12 * dpr));
      frame.cars = cars;
      raf = requestAnimationFrame(draw);
    };
    const frame: { cars: Car[] } = { cars };
    const click = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) * devicePixelRatio;
      const y = (e.clientY - r.top) * devicePixelRatio;
      const hit = frame.cars.find((car) => x >= car.x && x <= car.x + car.w && y >= car.y && y <= car.y + car.h);
      if (hit && select.current) select.current(hit);
      else if (hit) window.open(`https://whatsonchain.com/tx/${hit.id}`, '_blank', 'noopener');
    };
    c.addEventListener('click', click);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      c.removeEventListener('click', click);
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">Live highway</span>
        <span className="text-accent">
          {status === 'live' ? (
            <>
              <span className="blink">●</span> LIVE · GorillaPool JungleBus
            </>
          ) : status === 'off' ? (
            <span className="text-fg">NO FEED: set NEXT_PUBLIC_JUNGLEBUS_SUBSCRIPTION_ID</span>
          ) : status === 'error' ? (
            <span className="text-fg">NO SIGNAL, retrying…</span>
          ) : (
            <span className="text-dim">connecting…</span>
          )}
        </span>
      </div>
      <canvas ref={canvas} className="inset h-56 w-full cursor-pointer" aria-label="Live BSV transactions" />
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <Stat label="Block" value={tip?.height.toLocaleString()} />
        <Stat label="Throughput" value={counts && `${counts.rate.toFixed(2)} tx/s`} />
        <Stat label="Last block" value={tip?.blockTime && counts ? `${Math.max(0, Math.round((counts.now / 1000 - tip.blockTime) / 60))} min ago` : null} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {KINDS.map((k) => (
          <span key={k.id}>
            <span className="mr-1 inline-block h-2 w-3" style={{ background: k.color }} />
            <span className="text-dim">{k.label}: </span>
            <span className="text-hot">{counts?.byKind[k.id] ?? 0}</span>
          </span>
        ))}
        <span className="text-muted">last 60 s · white underline = mined</span>
      </div>
      {showMovers && movers.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-dim">TOKENS MOVING NOW (last 60 s)</p>
          <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
            {movers.map((m) => {
              const meta = tokenMeta(m.id);
              const amt = meta ? Number(m.amt) / 10 ** meta.dec : null;
              return (
                <a
                  key={m.id}
                  href={/_\d+$/.test(m.id) ? `https://1sat.market/market/bsv21/${m.id}` : `https://1sat.market/market/bsv20/${m.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inset flex items-center gap-2 px-2 py-1 text-xs hover:border-fg"
                >
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
                      · {m.n} tx{amt !== null && amt > 0 ? ` · ${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="inset px-2 py-1">
      <span className="text-dim">{label}: </span>
      <span className="text-hot">{value ?? '—'}</span>
    </div>
  );
}
