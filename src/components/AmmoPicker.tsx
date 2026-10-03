'use client';

import { formatCount, formatUsd, packSats, usd } from '@/lib/pricing';

export const AMMO_PRESETS = [100, 1_000, 10_000, 100_000, 1_000_000];
export const MAX_AMMO = 10_000_000;

/** Load as many shots as you like: type a number or tap a preset; shows the cost before you approve. */
export function AmmoPicker({ value, onChange, bsvUsd }: { value: number; onChange: (n: number) => void; bsvUsd: number | null }) {
  const sats = packSats(value);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex flex-wrap items-center justify-center gap-1">
        {AMMO_PRESETS.map((p) => (
          <button key={p} onClick={() => onChange(p)} className={`btn text-xs ${p === value ? 'btn-on' : ''}`}>
            {formatCount(p)}
          </button>
        ))}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_AMMO}
          value={value}
          onChange={(e) => onChange(Math.max(1, Math.min(MAX_AMMO, Math.floor(Number(e.target.value) || 0))))}
          className="inset w-28 bg-input px-2 py-1 text-right text-hot"
          aria-label="Shots to load"
        />
        <span className="text-xs text-dim">shots</span>
      </div>
      <span className="text-xs text-dim">
        {sats.toLocaleString()} sats{bsvUsd ? ` · ${formatUsd(usd(sats, bsvUsd))}` : ''} · unused ammo comes back on Unload
      </span>
    </div>
  );
}
