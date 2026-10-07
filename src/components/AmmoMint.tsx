'use client';

/**
 * Q Branch ammo bench (owner tool, unlinked). From the CONNECTED wallet:
 *  1. inscribe the ammo icon, 2. deploy+mint the BSV-21 ammo token (whole supply to the wallet),
 *  3. list packs for sale as OrdLock v2 listings that pay the house address.
 * The owner approves each step in their own wallet; nothing is signed here.
 */
import Link from 'next/link';
import { useState } from 'react';
import { AMMO, type AmmoDef } from '@/lib/ammo';
import { HOUSE, deployAmmo, inscribeAmmoIcon, listAmmoPack } from '@/lib/ammoChain';
import type { Ammo } from '@/lib/ordnance';
import { useWalletConnect } from './OrdnanceArsenal';

export function AmmoMint() {
  const w = useWalletConnect();
  const [kind, setKind] = useState<Ammo>('bullet');
  const def: AmmoDef = AMMO[kind];
  const [icon, setIcon] = useState('');
  const [tokenId, setTokenId] = useState(def.id);
  const [pack, setPack] = useState(100);
  const [price, setPrice] = useState(10_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);

  const step = async (name: string, fn: () => Promise<string>) => {
    setBusy(name);
    try {
      const out = await fn();
      setLog((l) => [{ ok: true, text: `${name}: ${out}` }, ...l]);
      return out;
    } catch (e) {
      setLog((l) => [{ ok: false, text: `${name}: ${e instanceof Error ? e.message : String(e)}` }, ...l]);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const pick = (k: Ammo) => {
    setKind(k);
    setTokenId(AMMO[k].id);
    setIcon('');
  };
  const client = w.wallet?.client;

  return (
    <section className="panel flex flex-col gap-3">
      <div className="panel-header">
        <span className="panel-title">Q Branch · ammo bench</span>
        <Link href="/1satordnance/ammo" className="text-dim hover:text-hot">
          &lt; ammo store
        </Link>
      </div>
      <p className="text-xs text-hot">Owner tool. Your wallet shows each transaction and you approve it there. Every step is a real mainnet transaction and pays its fee. Sales pay {HOUSE}.</p>

      <div className="flex flex-wrap gap-1">
        {Object.values(AMMO).map((d) => (
          <button key={d.kind} onClick={() => pick(d.kind)} className={`btn px-2 py-1 text-xs ${kind === d.kind ? 'btn-on' : ''}`} style={{ color: d.color }}>
            ${d.sym}
            {d.id ? ' ✓' : ''}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-[8rem_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={def.icon} alt="" className="h-32 w-32" />
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <b className="text-hot">${def.sym}</b> · {def.name} · supply {def.supply.toLocaleString()} · 0 decimals
          </p>
          {!w.wallet ? (
            <button onClick={w.connectWallet} disabled={w.busy} className="btn-fire self-start">
              {w.busy ? 'CONNECTING…' : 'CONNECT WALLET'}
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-dim">1.</span>
                <button disabled={Boolean(busy)} className="btn px-3 py-1" onClick={async () => client && setIcon((await step('Icon inscribed', () => inscribeAmmoIcon(client, def))) ?? icon)}>
                  {busy === 'Icon inscribed' ? 'CHECK WALLET…' : 'INSCRIBE ICON'}
                </button>
                <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="icon outpoint txid_0" className="min-w-0 flex-1 border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-dim">2.</span>
                <button disabled={Boolean(busy) || !icon} className="btn px-3 py-1" onClick={async () => client && setTokenId((await step('Token deployed (paste into AMMO in src/lib/ammo.ts)', () => deployAmmo(client, def, icon))) ?? tokenId)}>
                  {busy?.startsWith('Token deployed') ? 'CHECK WALLET…' : `DEPLOY $${def.sym}`}
                </button>
                <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="token id txid_0" className="min-w-0 flex-1 border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-dim">3.</span>
                <label className="flex items-center gap-1">
                  pack
                  <input type="number" min={1} value={pack} onChange={(e) => setPack(Math.max(1, Number(e.target.value) || 1))} className="w-24 border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
                </label>
                <label className="flex items-center gap-1">
                  price (sats)
                  <input type="number" min={1} value={price} onChange={(e) => setPrice(Math.max(1, Number(e.target.value) || 1))} className="w-28 border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
                </label>
                <button disabled={Boolean(busy) || !tokenId} className="btn px-3 py-1" onClick={() => client && step('Pack listed', () => listAmmoPack(client, def, tokenId, BigInt(pack), price))}>
                  {busy === 'Pack listed' ? 'CHECK WALLET…' : 'LIST PACK'}
                </button>
              </div>
            </>
          )}
          {w.error && <p className="text-xs text-hot">⚠ {w.error}</p>}
        </div>
      </div>

      {log.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {log.map((l, i) => (
            <li key={i} className={`break-all ${l.ok ? 'text-[var(--ok)]' : 'text-hot'}`}>
              {l.ok ? '✓ ' : '⚠ '}
              {l.text}
            </li>
          ))}
        </ul>
      )}
      {w.chooserEl}
    </section>
  );
}
