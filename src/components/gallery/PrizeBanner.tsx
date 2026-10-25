'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PRIZE } from '@/lib/gallery';
import { tbxFontClass } from '../coinop/fonts';
import { Icon } from '../coinop/ui';

/** "1 BSV to the top blaster": dates and rules come from PRIZE (src/lib/gallery.ts). Rules are placeholders until the owner signs them off. */
export function PrizeBanner({ cta = false }: { cta?: boolean }) {
  const [open, setOpen] = useState(false);
  const fmt = (iso: string) => new Date(iso).toUTCString().replace(':00 GMT', ' UTC').slice(5);
  return (
    <section className={`${tbxFontClass} tbx-glass p-4`} style={{ borderColor: 'rgba(255,182,46,.45)', background: 'linear-gradient(90deg, rgba(255,182,46,0.12), rgba(255,59,59,0.10))' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="tbx-display flex items-center gap-2 text-[clamp(24px,3.6vw,38px)]" style={{ color: 'var(--tbx-amber)' }}>
            <Icon name="trophy" size={26} /> {PRIZE.title}
          </p>
          <p className="mt-1 text-sm text-[var(--tbx-dim)]">
            Most accepted Shooting Gallery shots with your handle on them, {fmt(PRIZE.start)} to {fmt(PRIZE.end)}.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen((v) => !v)} className="tbx-btn">
            {open ? 'Hide rules' : 'Rules'}
          </button>
          {cta && (
            <Link href="/arcade/terrornode" className="tbx-btn tbx-btn-red">
              Enter the gallery
            </Link>
          )}
        </div>
      </div>
      {open && (
        <ul className="mt-3 list-disc pl-5 text-xs text-[var(--tbx-dim)]">
          {PRIZE.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
