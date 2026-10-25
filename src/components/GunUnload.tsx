'use client';
/**
 * Gun safety (agreed with bWalletX, 25 Oct 2026): one clear UNLOAD that sends everything still in the browser gun
 * (unused tokens and unused sats) back to the player's wallet, behind a plain confirmation of what's coming back,
 * plus the plain line about where the gun's key lives.
 */
import { useState } from 'react';
import { GUN_KEY_NOTE } from '@/lib/tokenLoad';
import type { useBlaster } from '@/lib/useBlaster';

type Blaster = ReturnType<typeof useBlaster>;

export function GunKeyNote({ className = 'text-xs text-dim' }: { className?: string }) {
  return (
    <p className={className} data-gun-key-note>
      {GUN_KEY_NOTE}
    </p>
  );
}

export function GunUnload({ b, disabled = false, className = '' }: { b: Blaster; disabled?: boolean; className?: string }) {
  const [asking, setAsking] = useState(false);
  // No wallet yet: show the control disabled with a hint, so copy that mentions UNLOAD always has a button to point at.
  if (!b.wallet)
    return (
      <div className={`flex flex-col gap-1 ${className}`} data-gun-unload>
        <button type="button" className="btn px-2 py-0.5 text-xs font-bold" disabled>
          UNLOAD to my wallet
        </button>
        <span className="text-[10px] text-dim">Connect your wallet with LOCK &amp; LOAD first.</span>
      </div>
    );
  const toks = b.gunTokens.filter((t) => t.amt > BigInt(0));
  const empty = !toks.length && b.ammo <= 0;
  const busy = b.busy === 'unloading';
  const what = [
    ...toks.map((t) => {
      const sym = b.tokens.find((x) => x.id === t.id)?.sym;
      return `${t.amt.toLocaleString()} base units of ${sym ? `$${sym}` : `token ${t.id.slice(0, 8)}…`}`;
    }),
    ...(b.ammo > 0 ? [`about ${b.ammo.toLocaleString()} sats (less the network fee)`] : []),
  ];
  return (
    <div className={`flex flex-col gap-1 ${className}`} data-gun-unload>
      {!asking ? (
        <button type="button" className="btn px-2 py-0.5 text-xs font-bold" disabled={disabled || busy || empty || !!b.busy} onClick={() => setAsking(true)}>
          {busy ? 'UNLOADING…' : empty ? 'Gun is empty' : 'UNLOAD to my wallet'}
        </button>
      ) : (
        <div className="flex flex-col gap-1 text-xs">
          <span>Coming back to {b.wallet.name}: {what.join(' and ')}.</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn px-2 py-0.5 text-xs font-bold"
              disabled={busy}
              onClick={() => {
                setAsking(false);
                void b.unload();
              }}
            >
              Yes, unload
            </button>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
