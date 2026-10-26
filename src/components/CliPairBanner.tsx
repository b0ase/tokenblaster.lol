'use client';
/** bwalletx-cli pairing (src/lib/cliWallet.ts): shows the 8-digit code while the owner approves in the terminal. */
import { useSyncExternalStore } from 'react';
import { cliPairState, onCliPair, type CliPairState } from '@/lib/cliWallet';

const IDLE: CliPairState = { k: 'idle' };

export function CliPairBanner() {
  const s: CliPairState = useSyncExternalStore((cb) => onCliPair(cb), cliPairState, () => IDLE);
  if (s.k === 'idle') return null;
  return (
    <div role="status" data-cli-pair className="fixed bottom-4 left-1/2 z-[1000] -translate-x-1/2 rounded-lg px-4 py-3 text-center" style={{ background: 'var(--canvas, #111)', border: '1px solid var(--border-dim, #333)', color: 'var(--muted, #aaa)', fontSize: 13, maxWidth: 'calc(100vw - 32px)' }}>
      {s.k === 'code' ? (
        <>
          <span className="block">Approve in your terminal (bwalletx serve):</span>
          <span style={{ color: 'var(--accent, #0f0)', fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 24, letterSpacing: 3 }}>{s.code}</span>
        </>
      ) : (
        <span>Local wallet pairing failed: {s.message}</span>
      )}
    </div>
  );
}
