'use client';

import { useState } from 'react';
import { ORDNANCE, priceOf, slugOf } from '@/lib/ordnance';
import { gunCardDataUrl, gunOgDataUrl } from '@/lib/ordnanceArt';

const bsv = (sats: number) => `${(sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })} BSV`;

/** DEV ONLY (next dev): render each weapon's card + share image and save them via /api/dev/save-art. */
export function OrdnanceRender() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const save = async (name: string, dataUrl: string) => {
    const r = await fetch('/api/dev/save-art', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, dataUrl }) });
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
  };
  const run = async () => {
    setBusy(true);
    for (const o of ORDNANCE) {
      try {
        await save(`${o.id}.webp`, await gunCardDataUrl(o));
        await save(`${o.id}-og.jpg`, await gunOgDataUrl(o, bsv(priceOf(o)), slugOf(o)));
        setLog((l) => [...l, `✓ ${o.id}`]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${o.id}: ${e instanceof Error ? e.message : e}`]);
      }
    }
    setLog((l) => [...l, 'DONE']);
    setBusy(false);
  };
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-2 p-4">
      <p className="text-hot">Dev tool: renders all {ORDNANCE.length} weapon cards and share images into public/ordnance/cards/.</p>
      <button onClick={run} disabled={busy} className="btn-fire self-start" id="render-all">
        {busy ? 'RENDERING…' : 'RENDER ALL'}
      </button>
      <pre id="render-log" className="text-xs text-dim">{log.join('\n')}</pre>
    </main>
  );
}
