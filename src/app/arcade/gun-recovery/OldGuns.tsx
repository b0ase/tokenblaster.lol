'use client';
/** Every game-credit address this browser has used, with its balance from the public chain. No wallet call. */
import { useEffect, useState } from 'react';
import { chainSats, gunAddresses } from '@/lib/gunKeys';

export function OldGuns() {
  const [rows, setRows] = useState<{ address: string; sats: number | null }[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(gunAddresses().map(async (address) => ({ address, sats: await chainSats(address) }))).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, []);
  if (!rows) return <p className="text-sm text-dim">Checking this browser…</p>;
  if (!rows.length) return <p className="text-sm text-dim">No game credit keys are stored in this browser (this exact site address and browser profile).</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm" data-old-guns>
      {rows.map((r, i) => (
        <li key={r.address} className="flex flex-wrap gap-2">
          <a className="font-mono underline underline-offset-2" href={`https://whatsonchain.com/address/${r.address}`} target="_blank" rel="noopener noreferrer">
            {r.address}
          </a>
          <span className="text-dim">
            {i === 0 ? 'current' : 'older'} · {r.sats === null ? 'balance unknown right now' : `${r.sats.toLocaleString('en-US')} sats`}
          </span>
        </li>
      ))}
    </ul>
  );
}
