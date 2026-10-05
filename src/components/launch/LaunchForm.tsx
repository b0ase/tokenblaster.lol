'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LAUNCH_FEE } from '@/lib/launch/curve';
import { launchCoin } from '@/lib/launch/client';
import { ROUTES, type Route } from '@/lib/launch/shape';
import { LaunchNav } from './LaunchNav';
import { useLaunchWallet } from './useLaunchWallet';

/** Square-crop and shrink the picture to a 512px WebP (keeps the inscription small and cheap). */
async function prepImage(file: File): Promise<{ bytes: Uint8Array; type: string; url: string }> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(512, side);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  let q = 0.85;
  let blob: Blob | null = null;
  do {
    blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', q));
    q -= 0.15;
  } while (blob && blob.size > 60_000 && q > 0.2);
  if (!blob) throw new Error('Could not read that image.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/webp', url: URL.createObjectURL(blob) };
}

export function LaunchForm() {
  const router = useRouter();
  const { wallet, open, busy: connecting, chooserEl } = useLaunchWallet();
  const [sym, setSym] = useState('');
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [image, setImage] = useState<{ bytes: Uint8Array; type: string; url: string } | null>(null);
  const [kind, setKind] = useState<Route['kind']>('creator');
  const [split, setSplit] = useState<{ address: string; pct: string }[]>([
    { address: '', pct: '50' },
    { address: '', pct: '50' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);

  const [payout, setPayout] = useState('');
  const route = (): Route => {
    if (kind === 'creator') return { kind, address: (payout || wallet?.address || '').trim() };
    if (kind !== 'split') return { kind } as Route;
    return { kind: 'split', to: split.map((s) => ({ address: s.address.trim(), bps: Math.round(Number(s.pct) * 100) })) };
  };
  const splitTotal = split.reduce((n, s) => n + (Number(s.pct) || 0), 0);
  const ready = /^[A-Z0-9]{2,12}$/.test(sym) && name.trim() && image && signed && (kind !== 'split' || Math.abs(splitTotal - 100) < 0.001);

  const go = async () => {
    if (!wallet) return open();
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      const id = await launchCoin(wallet, { sym, name: name.trim(), description: about.trim(), route: route(), image });
      router.push(`/launch/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[900px] flex-col gap-3 p-2.5">
      <LaunchNav wallet={wallet} onConnect={open} busy={connecting} />
      {chooserEl}
      <section className="panel flex flex-col gap-3">
        <h1 className="text-2xl font-bold text-hot">Launch a coin</h1>
        <p className="text-dim">
          One transaction from your wallet inscribes the image, mints 1,000,000,000 $tokens straight into the coin’s bonding curve and pays the {LAUNCH_FEE.toLocaleString()} sat launch fee.
          Nothing is set aside for anyone: your own first buy is made on the curve, at the curve’s price.
        </p>
        <div className="grid gap-3 md:grid-cols-[180px_1fr]">
          <label className="inset flex aspect-square cursor-pointer items-center justify-center overflow-hidden text-center text-dim">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {image ? <img src={image.url} alt="" className="h-full w-full object-cover" /> : <span>Add image<br /><span className="text-xs">square, any size</span></span>}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && prepImage(e.target.files[0]).then(setImage, (er) => setError(String(er)))} />
          </label>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted">Ticker</label>
            <input className="inset px-2 py-1" maxLength={12} placeholder="BLAST" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <label className="text-xs text-muted">Name</label>
            <input className="inset px-2 py-1" maxLength={40} placeholder="Token Blaster" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="text-xs text-muted">Story ({about.length}/400)</label>
            <textarea className="inset min-h-[90px] px-2 py-1" maxLength={400} value={about} onChange={(e) => setAbout(e.target.value)} />
          </div>
        </div>

        <div>
          <p className="text-xs text-muted">Where the 0.30% of every trade goes (signed at launch, can never be changed)</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {ROUTES.map((r) => (
              <button key={r.kind} className={`inset p-2 text-left ${kind === r.kind ? 'border-hot' : ''}`} onClick={() => setKind(r.kind)}>
                <p className="font-bold text-hot">{kind === r.kind ? '◉' : '○'} {r.title}</p>
                <p className="text-xs text-dim">{r.about}</p>
              </button>
            ))}
          </div>
          {kind === 'creator' && (
            <div className="mt-2">
              <label className="text-xs text-muted">Payout address for your 0.30% (a BSV address your wallet shows payments for; defaults to your wallet’s identity address)</label>
              <input className="inset w-full px-2 py-1 text-sm" placeholder={wallet?.address ?? '1…'} value={payout} onChange={(e) => setPayout(e.target.value.trim())} />
            </div>
          )}
          {kind === 'split' && (
            <div className="mt-2 flex flex-col gap-1">
              {split.map((s, i) => (
                <div key={i} className="flex gap-1">
                  <input className="inset flex-1 px-2 py-1 text-sm" placeholder="BSV address (1…)" value={s.address} onChange={(e) => setSplit(split.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} />
                  <input className="inset w-20 px-2 py-1 text-sm" value={s.pct} onChange={(e) => setSplit(split.map((x, j) => (j === i ? { ...x, pct: e.target.value.replace(/[^0-9.]/g, '') } : x)))} />
                  <span className="self-center">%</span>
                  {split.length > 2 && <button className="btn" onClick={() => setSplit(split.filter((_, j) => j !== i))}>×</button>}
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs">
                {split.length < 10 && <button className="btn" onClick={() => setSplit([...split, { address: '', pct: '0' }])}>+ wallet</button>}
                <span className={Math.abs(splitTotal - 100) < 0.001 ? 'text-green-400' : 'text-red-400'}>total {splitTotal}%</span>
              </div>
            </div>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm text-dim">
          <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} className="mt-1" />
          I understand that launching is a real BSV transaction from my wallet, that I sign the coin’s ticker, image, addresses and fee route with my wallet key, and that
          memecoins are toys that can go to zero.
        </label>
        <button className="btn btn-fire" disabled={busy || (Boolean(wallet) && !ready)} onClick={go}>
          {busy ? 'Approve in your wallet…' : wallet ? `Launch $${sym || 'COIN'} (${LAUNCH_FEE.toLocaleString()} sats + network fee)` : 'Connect wallet'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>
    </main>
  );
}
