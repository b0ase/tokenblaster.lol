'use client';
/**
 * The game crashed (owner, 31 Oct 2026: LOCK & LOAD paid, then the game died and the credit seemed gone). Never a
 * dead screen: this boundary catches the crash and shows the player's game credit, read from the PUBLIC chain for the
 * gun key stored in this browser (src/lib/gunKeys.ts peekCredit): no wallet call, no popup, no game code.
 * PLAY reloads the page (the credit is used, no new charge); UNLOAD reloads into the cabinet, where UNLOAD sends it
 * back to the wallet.
 */
import { Component, useEffect, useState, type ReactNode } from 'react';
import { peekCredit } from '@/lib/gunKeys';
import { satsToUsd } from '@/lib/coinop/credit';
import { RECOVERY_URL, safeCreditLine } from '@/lib/coinop/creditSafe';

export function CreditSafe() {
  const [usd, setUsd] = useState<number | null>(null);
  const [read, setRead] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ sats }, rate] = await Promise.all([
        peekCredit(),
        fetch('/api/price')
          .then((r) => r.json() as Promise<{ bsvUsd?: number }>)
          .then((j) => j.bsvUsd ?? null)
          .catch(() => null),
      ]);
      if (!live) return;
      setUsd(sats === null || !rate ? null : satsToUsd(sats, rate));
      setRead(true);
    })();
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="tbx-glass mx-auto flex max-w-[520px] flex-col items-center gap-3 rounded-xl p-6 text-center text-[#e8f1f6]" role="alert" data-credit-safe-fallback>
      <p className="text-lg font-bold tracking-[0.08em]">The game stopped unexpectedly.</p>
      <p className="text-sm font-bold text-[var(--tbx-teal)]" data-credit-safe>
        {read ? safeCreditLine(usd) : 'Checking your game credit…'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="tbx-btn tbx-btn-red" onClick={() => location.reload()}>
          PLAY
        </button>
        <button type="button" className="tbx-btn" onClick={() => location.reload()}>
          UNLOAD
        </button>
      </div>
      <p className="text-xs text-white/60">
        UNLOAD is on the cabinet after the reload. <a href={RECOVERY_URL} className="underline underline-offset-2">Credit missing?</a>
      </p>
    </div>
  );
}

/** Catches a crash anywhere in the game and shows CreditSafe instead of a blank page. */
export class CreditSafeBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(e: unknown) {
    console.error('[tb] game crashed; showing the credit-safe screen', e);
  }
  render() {
    return this.state.crashed ? <CreditSafe /> : this.props.children;
  }
}
