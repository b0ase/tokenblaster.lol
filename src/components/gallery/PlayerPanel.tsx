'use client';
/**
 * The player's own items, on the loadout (owner, 25 Oct 2026: nothing below the game). Credit, the gun's balance
 * link, rounds ready, the X handle that rides on the rounds, and the wallet ordnance check. Free play says plainly
 * that nothing is paid or scored.
 */
import { IdentityPicker } from '../PlayerBadge';
import { Icon } from '../coinop/ui';
import { PRACTICE } from '@/lib/gallery/story';
import { GUN_KEY_NOTE } from '@/lib/tokenLoad';
import type { ReactNode } from 'react';

/** Wallet and validator errors in plain words (owner, 25 Oct: "A truthy value is required." is not English). */
export function plainError(msg: string | null | undefined): string | null {
  if (!msg) return null;
  if (/truthy value|is required|invalid parameter|must be (a|an) /i.test(msg)) return 'Your wallet could not do that. Check it is connected and unlocked, then try again.';
  return msg;
}

export function PlayerPanel(p: {
  freePlay: boolean;
  free: boolean;
  fee: number;
  bsvUsd: number;
  credit: string;
  /** The gun's sats from the chain read (src/lib/creditRead.ts: every page), and whether that read is still unsure. */
  sats?: number;
  checking?: boolean;
  walletName?: string | null;
  onRescan?: () => void;
  gunAddress: string | null | undefined;
  packLeft: number;
  ordnance: { checking: boolean; checked: boolean; check: () => void; idle: boolean } | null;
  error: string | null | undefined;
  /** The UNLOAD control (src/components/GunUnload.tsx): tokens and unused sats back to the wallet. */
  unload?: ReactNode;
}) {
  const error = plainError(p.error);
  if (p.freePlay)
    return (
      <section className="tbx-glass p-4" data-freeplay-note>
        <p className="text-sm font-semibold text-[var(--tbx-text)]">{PRACTICE.nothing}</p>
        <p className="mt-1 text-xs text-[var(--tbx-dim)]">Practice rounds are not scored on the board. The paid game puts every round on the record.</p>
      </section>
    );
  const sats = p.sats ?? 0;
  // Never a bare $0.00 while a read is unsure (owner, 31 Oct 2026: "so users don't panic").
  const unsure = Boolean(p.checking) && sats <= 0;
  return (
    <section className="tbx-glass p-4" data-player-panel>
      <span className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}>
        <Icon name="coin" size={14} /> Your gun
      </span>
      <p className="mt-2 text-xl font-bold leading-snug text-white sm:text-2xl" data-gun-balance>
        Your credit:{' '}
        {unsure ? (
          <span className="text-[var(--tbx-amber)]">checking…</span>
        ) : (
          <>
            <span className="tbx-num" style={{ color: 'var(--tbx-amber)' }}>{p.credit}</span>
            <span className="tbx-num text-white/80"> · {sats.toLocaleString('en-US')} sats</span>
            <span className="text-[var(--tbx-teal)]"> · safe on chain</span>
          </>
        )}
      </p>
      <p className="mt-0.5 text-xs text-[var(--tbx-dim)]">
        {p.checking ? 'checking the chain…' : 'checked just now'}
        {p.gunAddress && (
          <>
            {' · '}
            <a href={`https://whatsonchain.com/address/${p.gunAddress}`} target="_blank" rel="noreferrer" className="underline">
              view on chain
            </a>
          </>
        )}
        {p.onRescan && (
          <>
            {' · '}
            <button type="button" className="underline" onClick={p.onRescan}>
              Rescan the chain
            </button>
          </>
        )}
      </p>
      <div className="mt-3 flex flex-col gap-1" data-gun-unload-primary>
        {p.unload}
        <span className="text-sm text-white/80">Sends it all back to {p.walletName || 'your wallet'}.</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-white">This money is yours, held by a key in this browser. Nobody else can spend it.</p>
      <p className="mt-1 text-xs text-[var(--tbx-dim)]">
        Rounds ready: <span className="tbx-num font-bold text-white">{p.packLeft.toLocaleString()}</span> ·{' '}
        <a href="/arcade/gun-recovery" className="underline">
          Where did my credit go?
        </a>
      </p>
      <span className="sr-only" data-gun-key-note>{GUN_KEY_NOTE}</span>
      <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-3 text-sm text-[var(--tbx-dim)]">
        <span className="text-xs">
          {p.free ? <span style={{ color: 'var(--tbx-ok)' }}>No platform fee until 1 Nov</span> : `${Math.round(p.fee * 100)}% platform fee`} · BSV ${p.bsvUsd.toFixed(2)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span>X handle on your rounds:</span>
          <IdentityPicker compact />
        </div>
        {p.ordnance && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Wallet-basket ownership only on this tap, never in the background or during play (src/lib/useOrdnance.ts) */}
            <button type="button" data-fs-skip className="btn px-2 py-0.5 text-xs" disabled={!p.ordnance.idle || p.ordnance.checking || p.ordnance.checked} onClick={p.ordnance.check}>
              {p.ordnance.checked ? 'Wallet checked for ordnance' : 'Check my wallet for ordnance'}
            </button>
            <span className="text-xs">Your wallet may ask once to show this site your TokenBlaster weapons, so owned guns unlock.</span>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-[#ff7a70]">{error}</p>}
    </section>
  );
}
