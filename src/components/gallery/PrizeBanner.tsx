'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PRIZE } from '@/lib/gallery';

/** "1 BSV to the top blaster": dates and rules come from PRIZE (src/lib/gallery.ts). Rules are placeholders until the owner signs them off. */
export function PrizeBanner({ cta = false }: { cta?: boolean }) {
  const [open, setOpen] = useState(false);
  const fmt = (iso: string) => new Date(iso).toUTCString().replace(':00 GMT', ' UTC').slice(5);
  return (
    <section className="panel border-[#ffd27a]" style={{ background: 'linear-gradient(90deg, rgba(255,210,122,0.14), rgba(255,59,59,0.10))' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="dr-display text-[clamp(22px,3.6vw,36px)] leading-none text-[#ffd27a]">{PRIZE.title.toUpperCase()}</p>
          <p className="mt-1 text-sm text-dim">
            Most accepted Shooting Gallery shots with your handle on them, {fmt(PRIZE.start)} to {fmt(PRIZE.end)}.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen((v) => !v)} className="btn px-3 py-1 text-sm">
            {open ? 'HIDE RULES' : 'RULES'}
          </button>
          {cta && (
            <Link href="/arcade/gallery" className="btn-fire px-4 py-1 text-sm">
              ENTER THE GALLERY
            </Link>
          )}
        </div>
      </div>
      {open && (
        <ul className="mt-2 list-disc pl-5 text-xs text-dim">
          {PRIZE.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
