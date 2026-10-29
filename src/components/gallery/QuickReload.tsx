'use client';
/**
 * QUICK RELOAD (owner, 29 Oct 2026): "add more money and keep playing". When the gun runs low or dry mid-run, one
 * big tap (or R for the middle preset) pays a preset through the cabinet's usual single wallet approval and the new rounds
 * add to the gun, with no trip back to the loadout and the run kept. Prices and money flow are LOCK & LOAD's own.
 */
import { useEffect, useState } from 'react';
import { fmtCredit } from '@/lib/coinop/credit';

export const RELOAD_USD: readonly number[] = [0.25, 1, 5];

export function QuickReload(p: {
  /** Rounds left in the gun (0 = dry). */
  left: number;
  /** Rounds each preset buys (null while the price loads). */
  buys: (usd: number) => number | null;
  /** True while a wallet approval or load is running: buttons wait. */
  busy: boolean;
  freePlay?: boolean;
  onReload: (usd: number) => void;
}) {
  // A tap or R while a payment is in flight used to do nothing at all (29 Oct audit): say it is still paying.
  const [nudged, setNudged] = useState(false);
  useEffect(() => {
    if (!nudged) return;
    const t = setTimeout(() => setNudged(false), 1600);
    return () => clearTimeout(t);
  }, [nudged]);
  const press = (usd: number) => (p.busy ? setNudged(true) : p.onReload(usd));
  // R pays the middle preset ($1); works while pointer-locked
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // R only: the number keys already pick guns
      if (e.code !== 'KeyR') return;
      const i = 1;
      e.preventDefault();
      if (p.busy) return setNudged(true);
      p.onReload(p.freePlay ? 0 : (RELOAD_USD[i] ?? 1));
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, [p]);
  const dry = p.left <= 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-3" data-quick-reload>
      <div className={`tbx-glass pointer-events-auto flex flex-col items-center gap-2 rounded-xl px-3 py-2.5 sm:px-4 ${dry ? 'tbx-pop' : ''}`} style={{ borderColor: 'var(--tbx-red)' }}>
        <p className={`text-[11px] font-black tracking-[0.28em] text-[var(--tbx-amber)] ${p.busy ? 'animate-pulse' : ''}`} role="status" aria-live="polite" data-reload-paying={p.busy || undefined}>
          {p.busy ? (nudged ? 'STILL PAYING · APPROVE IN YOUR WALLET' : 'PAYING… APPROVE IN YOUR WALLET') : dry ? 'OUT OF ROUNDS' : `LOW AMMO · ${p.left.toLocaleString()} LEFT`} · <kbd className="rounded border border-white/30 px-1 text-white">R</kbd> RELOAD
        </p>
        <div className="flex gap-2">
          {p.freePlay ? (
            <button type="button" aria-disabled={p.busy} onClick={() => press(0)} className="lock-load min-h-[56px] rounded-lg bg-[var(--tbx-red)] px-6 text-xl font-black tracking-[0.14em] text-white aria-disabled:opacity-50" data-reload-usd="0">
              ↻ RELOAD
            </button>
          ) : (
            RELOAD_USD.map((u, i) => {
              const n = p.buys(u);
              return (
                <button key={u} type="button" aria-disabled={p.busy} onClick={() => press(u)} className={`min-h-[56px] rounded-lg px-3 text-lg font-black tracking-[0.08em] text-white aria-disabled:opacity-50 sm:px-5 sm:text-xl ${i === 1 ? 'lock-load bg-[var(--tbx-red)]' : 'border border-white/25 bg-black/60'}`} data-reload-usd={u}>
                  ↻ {fmtCredit(u)}
                  <span className="block text-[10px] font-bold tracking-[0.2em] text-white/75">{n != null ? `${n.toLocaleString()} ROUNDS` : '…'}{i === 1 ? ' · R' : ''}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
