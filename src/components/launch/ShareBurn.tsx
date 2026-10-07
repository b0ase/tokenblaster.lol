'use client';

import { fmtBurn } from '@/lib/launch/burn';

/** Share one burn to X (the link unfurls into the burn's card). */
export function ShareBurn({ sym, tokens, pct, txid }: { sym: string; tokens: number; pct: number; txid: string }) {
  const share = () => {
    const text = `🔥 ${fmtBurn(tokens)} $${sym} BURNED on BlastPad. ${pct.toFixed(2)}% of supply gone for good, bought back on the curve by the coin's own fees.`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.href)}`, '_blank', 'noopener');
  };
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <button className="btn btn-fire" onClick={share}>
        Share on X
      </button>
      <a className="btn" href={`https://whatsonchain.com/tx/${txid}`} target="_blank" rel="noreferrer">
        Burn tx ↗
      </a>
    </div>
  );
}
