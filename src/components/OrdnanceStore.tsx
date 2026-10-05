'use client';

/**
 * The 1Sat Ordnance store. BUY asks the connected wallet for ONE transaction: the weapon's
 * inscription to a key in that wallet (kept in its `1sat` basket) plus the price to the house.
 * Nothing is signed here; the buyer approves in their own wallet. The issue counts once
 * /api/ordnance/issued has checked the payment on chain.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { P2PKH, PublicKey, Transaction } from '@bsv/sdk';
import { inscriptionScript } from '@/lib/inscribe';
import { ORDNANCE, RARITY_COLOR, ordnanceMap, priceOf, slugOf, type Ordnance, type Rarity } from '@/lib/ordnance';
import { gunArtFile } from '@/lib/ordnanceArt';
import { formatUsd, usd } from '@/lib/pricing';
import { resetStoreIssued, useOrdnance } from '@/lib/useOrdnance';
import { GunArt } from './GunArt';
import { useWalletConnect } from './OrdnanceArsenal';

const HOUSE = process.env.NEXT_PUBLIC_TB_HOUSE_ADDRESS || '192nuX6cz81MH3T2gwsam3FxYoDrvzDYpU' // bCorp's receiving address (public, not a key);
const PROTOCOL: [1, string] = [1, '1sat ordnance'];
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
const bsv = (sats: number) => `${(sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })} BSV`;

export function OrdnanceStore({ only }: { only?: string } = {}) {
  const w = useWalletConnect();
  const [nonce, setNonce] = useState(0);
  const { owned } = useOrdnance(w.wallet, [], nonce);
  const [issued, setIssued] = useState<Record<string, string[]> | null>(null);
  const [bsvUsd, setBsvUsd] = useState(0);
  const [filter, setFilter] = useState<Rarity | 'all'>('all');
  const [sort, setSort] = useState<'price' | 'rarity' | 'name'>('rarity');
  const [buying, setBuying] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string; txid?: string } | null>(null);
  const [bought, setBought] = useState<{ o: Ordnance; n: number; txid: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/price').then((r) => r.json()).then((j: { bsvUsd?: number }) => live && setBsvUsd(j.bsvUsd ?? 0)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    fetch('/api/ordnance/issued').then((r) => r.json()).then((j: { issued?: Record<string, string[]> }) => live && setIssued(j.issued ?? {})).catch(() => live && setIssued({}));
    return () => {
      live = false;
    };
  }, [nonce]);

  const list = useMemo(() => {
    const l = ORDNANCE.filter((o) => (only ? o.id === only : filter === 'all' || o.rarity === filter));
    const r = (o: Ordnance) => RARITIES.indexOf(o.rarity);
    return [...l].sort((a, b) => (sort === 'price' ? priceOf(a) - priceOf(b) : sort === 'name' ? a.name.localeCompare(b.name) : r(b) - r(a) || a.name.localeCompare(b.name)));
  }, [filter, sort, only]);

  const buy = async (o: Ordnance) => {
    if (!w.wallet || !HOUSE) return;
    setBuying(o.id);
    setMsg(null);
    try {
      const n = (issued?.[o.id]?.length ?? 0) + 1;
      const file = await gunArtFile(o);
      const keyID = `${o.id}-${Date.now()}`;
      const { publicKey } = await w.wallet.client.getPublicKey({ protocolID: PROTOCOL, keyID, counterparty: 'self' });
      const to = PublicKey.fromString(publicKey).toAddress();
      const script = inscriptionScript(to, file, ordnanceMap(o, n));
      const r = await w.wallet.client.createAction({
        description: `Buy ${o.name} #${n} (1Sat Ordnance)`,
        outputs: [
          {
            lockingScript: script.toHex(),
            satoshis: 1,
            outputDescription: `1Sat Ordnance: ${o.name} #${n}`,
            basket: '1sat',
            customInstructions: JSON.stringify({ protocolID: PROTOCOL, keyID, counterparty: 'self' }),
            tags: ['ordnance', `weapon:${o.id}`, `type:${file.contentType}`],
          },
          { lockingScript: new P2PKH().lock(HOUSE).toHex(), satoshis: priceOf(o), outputDescription: `TokenBlaster: ${o.name}` },
        ],
        labels: ['tokenblaster', 'ordnance'],
        options: { randomizeOutputs: false },
      });
      const txid = r.txid ?? (r.tx ? Transaction.fromAtomicBEEF(r.tx).id('hex') : '');
      setMsg({ id: o.id, ok: true, text: `Issued: ${o.name} #${n} is in your wallet. It unlocks in the games once the 1Sat index picks it up (usually a few seconds).`, txid });
      setBought({ o, n, txid });
      resetStoreIssued();
      setTimeout(() => setNonce((x) => x + 1), 8000);
    } catch (e) {
      setMsg({ id: o.id, ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBuying(null);
    }
  };

  return (
    <>
      <section className="panel flex flex-wrap items-center gap-2">
        <div className={only ? 'hidden' : 'flex flex-wrap gap-1'}>
          {(['all', ...RARITIES] as const).map((r) => (
            <button key={r} onClick={() => setFilter(r)} className={`btn px-2 py-1 text-xs uppercase ${filter === r ? 'btn-on' : ''}`} style={r !== 'all' ? { color: RARITY_COLOR[r] } : undefined}>
              {r} {r === 'all' ? ORDNANCE.length : ORDNANCE.filter((o) => o.rarity === r).length}
            </button>
          ))}
        </div>
        <label className={only ? 'hidden' : 'ml-auto flex items-center gap-1 text-xs text-dim'}>
          sort
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="border border-[var(--border-dim)] bg-input px-1 py-0.5 text-hot">
            <option value="rarity">rarity</option>
            <option value="price">price</option>
            <option value="name">name</option>
          </select>
        </label>
        {!w.wallet ? (
          <button onClick={w.connectWallet} disabled={w.busy} className="btn px-3 py-1">
            {w.busy ? 'CONNECTING…' : 'CONNECT WALLET'}
          </button>
        ) : (
          <span className="text-xs text-dim">
            {w.wallet.name} · {w.wallet.address.slice(0, 8)}… · {owned.size} owned
          </span>
        )}
      </section>
      {w.error && <p className="text-xs text-hot">⚠ {w.error}</p>}
      {!HOUSE && <p className="panel text-hot">The quartermaster is out: the store has no house address configured, so nothing can be bought right now.</p>}

      <section className={only ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'}>
        {list.map((o) => {
          const sold = issued?.[o.id]?.length ?? 0;
          const out = sold >= o.edition;
          const mine = owned.has(o.id);
          const price = priceOf(o);
          return (
            <article key={o.id} id={o.id} className="panel flex scroll-mt-4 flex-col" style={{ borderColor: o.rarity === 'legendary' ? RARITY_COLOR.legendary : undefined }}>
              <div className="relative -mx-2.5 -mt-2.5 mb-2 aspect-square overflow-hidden border-b border-[var(--border-dim)] bg-black">
                <GunArt o={o} spin className="h-full w-full object-cover" />
                <span className="absolute left-2 top-2 border bg-black/70 px-1.5 text-xs font-bold uppercase" style={{ color: RARITY_COLOR[o.rarity], borderColor: RARITY_COLOR[o.rarity] }}>
                  {o.rarity}
                </span>
                {mine && <span className="absolute right-2 top-2 border border-[#60ff90] bg-black/70 px-1.5 text-xs font-bold text-[#60ff90]">IN YOUR WALLET</span>}
              </div>
              <div className="panel-header">
                {only ? (
                  <h1 className="panel-title">&gt; {o.name}</h1>
                ) : (
                  <Link href={`/1satordnance/store/${slugOf(o)}`} className="panel-title hover:underline">
                    &gt; {o.name}
                  </Link>
                )}
                <span className="text-xs text-dim">{issued ? `${sold}/${o.edition} issued` : `ed. ${o.edition}`}</span>
              </div>
              <p className="text-accent">{o.tagline}</p>
              <p className="mt-1 flex-1 text-sm text-dim">{o.description}</p>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
                <div className="inset bg-black/50 p-1">
                  <dt className="text-dim">RATE</dt>
                  <dd className="font-bold text-hot">{Math.round(1000 / o.stats.fireMs)}/s</dd>
                </div>
                <div className="inset bg-black/50 p-1">
                  <dt className="text-dim">PELLETS</dt>
                  <dd className="font-bold text-hot">{o.stats.pellets}</dd>
                </div>
                <div className="inset bg-black/50 p-1">
                  <dt className="text-dim">SPREAD</dt>
                  <dd className="font-bold text-hot">{o.stats.spread < 0.01 ? 'pin' : o.stats.spread < 0.05 ? 'tight' : 'wide'}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-hot">{bsv(price)}</p>
                  <p className="text-xs text-dim">{bsvUsd ? `≈ ${formatUsd(usd(price, bsvUsd))} + network fee` : '+ network fee'}</p>
                </div>
                {out ? (
                  <span className="text-sm font-bold text-dim">SOLD OUT</span>
                ) : !w.wallet ? (
                  <button onClick={w.connectWallet} disabled={w.busy || !HOUSE} className="btn px-3 py-1">
                    CONNECT TO BUY
                  </button>
                ) : (
                  <button onClick={() => buy(o)} disabled={Boolean(buying) || !HOUSE} className="btn-fire px-5 py-1 text-base">
                    {buying === o.id ? 'CHECK WALLET…' : mine ? 'BUY ANOTHER' : 'BUY'}
                  </button>
                )}
              </div>
              {msg?.id === o.id && (
                <p className={`mt-2 text-xs ${msg.ok ? 'text-[#60ff90]' : 'text-hot'}`}>
                  {msg.ok ? '✓ ' : '⚠ '}
                  {msg.text}{' '}
                  {msg.txid && (
                    <a href={`https://whatsonchain.com/tx/${msg.txid}`} target="_blank" rel="noopener noreferrer" className="underline">
                      view ↗
                    </a>
                  )}
                </p>
              )}
            </article>
          );
        })}
      </section>
      {w.chooserEl}
      {bought && <Issued o={bought.o} n={bought.n} txid={bought.txid} onClose={() => setBought(null)} />}
    </>
  );
}

/** After a purchase: the gun, its edition, proof on chain, and where to use it / share it. */
function Issued({ o, n, txid, onClose }: { o: Ordnance; n: number; txid: string; onClose: () => void }) {
  const url = `https://www.tokenblaster.lol/1satordnance/store/${slugOf(o)}`;
  const tweet = `Just drew my ${o.name} #${n}: a real 1Sat ordinal gun. ${o.tagline}`;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={`${o.name} issued`} onClick={onClose}>
      <div className="panel w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">&gt; WEAPON ISSUED</span>
          <button onClick={onClose} className="text-dim hover:text-hot" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="-mx-2.5 aspect-square overflow-hidden bg-black">
          <GunArt o={o} spin className="h-full w-full object-cover" />
        </div>
        <p className="mt-2 text-lg font-bold text-hot">
          {o.name} #{n}
        </p>
        <p className="text-sm text-dim">It&apos;s in your wallet now as a 1Sat ordinal. It unlocks in the games as soon as the 1Sat index sees it (usually seconds).</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
          <Link href="/arena" className="btn-fire !px-2 !py-2 !text-sm">
            PLAY IT IN THE ARENA
          </Link>
          <Link href="/arcade/doubleokweg" className="btn-fire !px-2 !py-2 !text-sm">
            DOUBLE-O KWEG
          </Link>
          <a href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" className="btn px-2 py-2">
            SHARE ON X
          </a>
          <a href={`https://whatsonchain.com/tx/${txid}`} target="_blank" rel="noopener noreferrer" className="btn px-2 py-2">
            VIEW ON CHAIN ↗
          </a>
        </div>
      </div>
    </div>
  );
}
