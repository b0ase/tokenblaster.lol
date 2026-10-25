'use client';
/**
 * The player's own items, on the loadout (owner, 25 Oct 2026: nothing below the game). Credit, the gun's balance
 * link, rounds ready, the X handle that rides on the rounds, and the wallet ordnance check. Free play says plainly
 * that nothing is paid or scored.
 */
import { IdentityPicker } from '../PlayerBadge';
import { Icon } from '../coinop/ui';
import { PRACTICE } from '@/lib/gallery/story';

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
  gunAddress: string | null | undefined;
  packLeft: number;
  ordnance: { checking: boolean; checked: boolean; check: () => void; idle: boolean } | null;
  error: string | null | undefined;
}) {
  const error = plainError(p.error);
  if (p.freePlay)
    return (
      <section className="tbx-glass p-4" data-freeplay-note>
        <p className="text-sm font-semibold text-[var(--tbx-text)]">{PRACTICE.nothing}</p>
        <p className="mt-1 text-xs text-[var(--tbx-dim)]">Practice rounds are not scored on the board. The paid game puts every round on the record.</p>
      </section>
    );
  return (
    <section className="tbx-glass p-4" data-player-panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="tbx-eyebrow flex items-center gap-2" style={{ color: 'var(--tbx-text)' }}>
          <Icon name="coin" size={14} /> Your gun
        </span>
        <span className="text-xs text-[var(--tbx-dim)]">
          {p.free ? <span style={{ color: 'var(--tbx-ok)' }}>No platform fee until 1 Nov</span> : `${Math.round(p.fee * 100)}% platform fee`} · BSV ${p.bsvUsd.toFixed(2)}
        </span>
      </div>
      <div className="flex flex-col gap-1 text-sm text-[var(--tbx-dim)]">
        <span>
          Credit: <span className="tbx-num font-bold" style={{ color: 'var(--tbx-amber)' }}>{p.credit}</span>.
          {p.gunAddress && (
            <>
              {' '}
              <a href={`https://whatsonchain.com/address/${p.gunAddress}`} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">
                See your gun&apos;s balance on chain
              </a>
            </>
          )}
        </span>
        <span>
          Rounds ready: <span className="tbx-num font-bold text-white">{p.packLeft.toLocaleString()}</span>. Unused credit stays in your gun for later rounds.
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--tbx-dim)]">
        <span>X handle on your rounds:</span>
        <IdentityPicker compact />
      </div>
      {p.ordnance && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--tbx-dim)]">
          {/* Wallet-basket ownership only on this tap, never in the background or during play (src/lib/useOrdnance.ts) */}
          <button type="button" data-fs-skip className="btn px-2 py-0.5 text-xs" disabled={!p.ordnance.idle || p.ordnance.checking || p.ordnance.checked} onClick={p.ordnance.check}>
            {p.ordnance.checked ? 'Wallet checked for ordnance' : 'Check my wallet for ordnance'}
          </button>
          <span className="text-xs">Your wallet may ask once to show this site your TokenBlaster weapons, so owned guns unlock.</span>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-[#ff7a70]">{error}</p>}
    </section>
  );
}
