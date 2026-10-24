'use client';
/**
 * The ON CHAIN panel (owner, 24 Oct 2026): small, collapsible, bottom-right. It reuses what the gun already
 * learns from ARC (a round is only counted once ARC accepted it) and samples the latest txid a few times a second
 * for the feed, so there is no extra polling per transaction. bsv.lol is linked, not framed.
 */
import { useState } from 'react';
import { Icon, Ticker } from '../coinop/ui';

export type FeedRow = { txid: string; at: number };

export function OnChainPanel({ accepted, tps, feed, simulated }: { accepted: number; tps: number; feed: FeedRow[]; simulated: boolean }) {
  // Open on a desktop; collapsed on a phone, where the screen is for the fight.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);
  return (
    <div className="tbx-in-r tbx-glass pointer-events-auto absolute bottom-[150px] right-1.5 sm:bottom-[88px] z-10 w-[min(264px,52vw)] text-[11px] sm:right-3" data-onchain>
      <button type="button" data-fs-skip onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-[10px] font-bold tracking-[0.28em]" aria-expanded={open}>
        <span className="flex items-center gap-2 text-[var(--tbx-teal)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--tbx-ok)]" style={{ boxShadow: '0 0 8px var(--tbx-ok)', animation: tps > 0 ? 'tbx-breathe 0.8s ease-in-out infinite' : undefined }} />
          ON CHAIN{simulated ? ' · SIM' : ''}
        </span>
        <Icon name={open ? 'minus' : 'plus'} size={13} className="text-[var(--tbx-dim)]" />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.2em] text-[var(--tbx-dim)]">
                <Icon name="shield" size={10} /> ACCEPTED
              </div>
              <Ticker value={accepted} ease={0.25} className="text-base font-bold" style={{ color: 'var(--tbx-amber)' }} />
            </div>
            <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
              <div className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.2em] text-[var(--tbx-dim)]">
                <Icon name="signal" size={10} /> TX/S
              </div>
              <Ticker value={tps} ease={0.3} className="text-base font-bold" style={{ color: 'var(--tbx-teal)' }} />
            </div>
          </div>
          <ol className="flex max-h-[96px] flex-col gap-1 overflow-hidden">
            {feed.map((r) => (
              <li key={r.txid} className="tbx-in-r flex items-center justify-between gap-2" style={{ animationDuration: '0.35s' }}>
                {simulated ? (
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--tbx-mute)]">{r.txid.slice(0, 14)}…</span>
                ) : (
                  <a href={`https://whatsonchain.com/tx/${r.txid}`} target="_blank" rel="noopener noreferrer" className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--tbx-teal)] underline decoration-white/20 underline-offset-2">
                    {r.txid.slice(0, 14)}…
                  </a>
                )}
                <span className="text-[9px] font-bold tracking-wider text-[var(--tbx-ok)]">ACCEPTED</span>
              </li>
            ))}
            {!feed.length && <li className="text-[var(--tbx-mute)]">Hold the trigger: rounds show up here.</li>}
          </ol>
          <p className="text-[9px] leading-tight text-[var(--tbx-mute)]">Counted when the network takes each round. Tap one to see it, or watch them all on bsv.lol.</p>
          <a href="https://bsv.lol" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[var(--tbx-teal)] underline decoration-white/20 underline-offset-2">
            view on bsv.lol <Icon name="external" size={11} />
          </a>
        </div>
      )}
    </div>
  );
}
