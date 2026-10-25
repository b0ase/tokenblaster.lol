'use client';
/**
 * "Check my wallet for ordnance": the only way a page reads the wallet's ordinal baskets (src/lib/useOrdnance.ts).
 * An explicit tap, outside play, once per session, so guns held only in wallet baskets still unlock without a
 * background permission sheet.
 */
type Ord = { checkWallet: () => Promise<void>; checking: boolean; walletChecked: boolean };

export function CheckOrdnance({ ordnance, connected, disabled = false, className = '' }: { ordnance: Ord; connected: boolean; disabled?: boolean; className?: string }) {
  if (!connected) return null;
  return (
    <button
      type="button"
      className={`btn px-2 py-0.5 text-xs ${className}`}
      disabled={disabled || ordnance.checking || ordnance.walletChecked}
      onClick={() => void ordnance.checkWallet()}
      title="Your wallet may ask once to show this site your TokenBlaster weapons, so owned guns unlock"
    >
      {ordnance.walletChecked ? 'Wallet checked for ordnance' : ordnance.checking ? 'Checking…' : 'Check my wallet for ordnance'}
    </button>
  );
}
