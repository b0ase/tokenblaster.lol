'use client';

import { useState } from 'react';
import { GRAD_SOLD, marketCap, poolSats, price } from '@/lib/launch/curve';

/** Drag how much of the curve is sold; see the price, market cap and BSV in the pool. */
export function CurveSlider() {
  const [p, setP] = useState(0.5);
  const sold = BigInt(Math.floor(Number(GRAD_SOLD) * p));
  return (
    <div className="inset mt-2 p-3 text-sm">
      <input type="range" min={0} max={1} step={0.001} value={p} onChange={(e) => setP(Number(e.target.value))} className="w-full" aria-label="How much of the curve is sold" />
      <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
        <span><span className="text-muted">Sold </span>{(p * 100).toFixed(1)}%</span>
        <span><span className="text-muted">Price </span>{price(sold).toPrecision(4)} sats</span>
        <span><span className="text-muted">Market cap </span>{(marketCap(sold) / 1e8).toFixed(2)} BSV</span>
        <span><span className="text-muted">In the pool </span>{(Number(poolSats(sold)) / 1e8).toFixed(3)} BSV</span>
      </div>
    </div>
  );
}
