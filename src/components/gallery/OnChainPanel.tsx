'use client';
/**
 * bsv.lol-style ON CHAIN panel (owner, 24 Oct 2026): small, collapsible, bottom-right corner. It reuses what the
 * gun already learns from ARC (a round is only counted once ARC accepted it) and samples the latest txid a few
 * times a second for the feed, so there is no extra polling per transaction. bsv.lol is linked, not framed.
 */
import { useState } from 'react';
import { DR } from '@/lib/dr/tokens';

export type FeedRow = { txid: string; at: number };

export function OnChainPanel({ accepted, tps, feed, simulated }: { accepted: number; tps: number; feed: FeedRow[]; simulated: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="pointer-events-auto absolute bottom-24 right-2 z-10 w-[min(250px,46vw)] border bg-black/80 font-mono text-[10px]" style={{ borderColor: DR.colour.cyan }} data-onchain>
      <button type="button" data-fs-skip onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-2 py-1 tracking-widest" style={{ color: DR.colour.cyan }} aria-expanded={open}>
        <span>● ON CHAIN{simulated ? ' · SIM' : ''}</span>
        <span>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 px-2 pb-2">
          <div className="grid grid-cols-2 gap-1 text-center">
            <div className="bg-white/5 py-0.5">
              <div className="text-dim">ACCEPTED</div>
              <div className="text-sm font-bold tabular-nums" style={{ color: DR.colour.amber }}>
                {accepted.toLocaleString('en-US')}
              </div>
            </div>
            <div className="bg-white/5 py-0.5">
              <div className="text-dim">TX/S</div>
              <div className="text-sm font-bold tabular-nums" style={{ color: DR.colour.cyan }}>
                {tps.toLocaleString('en-US')}
              </div>
            </div>
          </div>
          <ol className="flex max-h-[96px] flex-col gap-0.5 overflow-hidden">
            {feed.map((r) => (
              <li key={r.txid} className="flex justify-between gap-1">
                {simulated ? (
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-muted">{r.txid.slice(0, 14)}…</span>
                ) : (
                  <a href={`https://whatsonchain.com/tx/${r.txid}`} target="_blank" rel="noopener noreferrer" className="overflow-hidden text-ellipsis whitespace-nowrap text-accent underline">
                    {r.txid.slice(0, 14)}…
                  </a>
                )}
                <span style={{ color: DR.colour.acid }}>ACCEPTED</span>
              </li>
            ))}
            {!feed.length && <li className="text-dim">Hold the trigger: rounds show up here.</li>}
          </ol>
          <p className="text-[9px] leading-tight text-dim">Counted when ARC accepts. For mempool and block status, open a txid or watch everything on bsv.lol.</p>
          <a href="https://bsv.lol" target="_blank" rel="noopener noreferrer" className="text-accent underline">
            view on bsv.lol ↗
          </a>
        </div>
      )}
    </div>
  );
}
