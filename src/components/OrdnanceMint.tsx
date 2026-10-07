'use client';

/**
 * Q Branch mint (owner tool). Builds a 1Sat inscription for one weapon (or the collection) and
 * asks the CONNECTED wallet to create it: the owner reviews and approves in their own wallet.
 * No server key, nothing signed here. The output goes to a wallet-derived key in the `1sat`
 * basket (so the wallet keeps and can spend it), or to an address the owner types.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PublicKey, Transaction } from '@bsv/sdk';
import { inscriptionScript } from '@/lib/inscribe';
import { ORDNANCE, ORDNANCE_COLLECTION, collectionMap, ordnanceMap } from '@/lib/ordnance';
import { useWalletConnect } from './OrdnanceArsenal';

const PROTOCOL: [1, string] = [1, '1sat ordnance'];

export function OrdnanceMint() {
  const w = useWalletConnect();
  const [which, setWhich] = useState<string>(ORDNANCE[0].id);
  const [num, setNum] = useState(1);
  const [collectionId, setCollectionId] = useState(ORDNANCE_COLLECTION);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);

  const weapon = ORDNANCE.find((o) => o.id === which);
  const map = useMemo(() => (weapon ? ordnanceMap(weapon, num, collectionId.trim()) : collectionMap()), [weapon, num, collectionId]);
  const image = weapon?.image ?? '/ordnance/collection.webp';

  const mint = async () => {
    if (!w.wallet) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(image);
      if (!res.ok) throw new Error(`Could not load ${image}`);
      const data = Array.from(new Uint8Array(await res.arrayBuffer()));
      const keyID = `${which}-${weapon ? num : 'collection'}`;
      let address = to.trim();
      let custom: string | undefined;
      if (!address) {
        const { publicKey } = await w.wallet.client.getPublicKey({ protocolID: PROTOCOL, keyID, counterparty: 'self' });
        address = PublicKey.fromString(publicKey).toAddress();
        custom = JSON.stringify({ protocolID: PROTOCOL, keyID, counterparty: 'self' });
      }
      const script = inscriptionScript(address, { contentType: 'image/webp', data }, map);
      const r = await w.wallet.client.createAction({
        description: `Inscribe ${map.name}`,
        outputs: [
          {
            lockingScript: script.toHex(),
            satoshis: 1,
            outputDescription: `1Sat Ordnance: ${map.name}`,
            basket: custom ? '1sat' : undefined,
            customInstructions: custom,
            tags: custom ? ['ordnance', `weapon:${which}`, 'type:image/webp'] : undefined,
          },
        ],
        labels: ['tokenblaster', 'ordnance'],
        options: { randomizeOutputs: false },
      });
      const txid = r.txid ?? (r.tx ? Transaction.fromAtomicBEEF(r.tx).id('hex') : '');
      setMsg({ ok: true, text: `Inscribed. Origin: ${txid}_0. Put it in src/lib/ordnance.ts (${weapon ? `origin of ${weapon.id}` : 'ORDNANCE_COLLECTION'}).`, txid });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel flex flex-col gap-3">
      <div className="panel-header">
        <span className="panel-title">Q Branch · mint 1Sat Ordnance</span>
        <Link href="/1satordnance" className="text-dim hover:text-hot">
          &lt; shop
        </Link>
      </div>
      <p className="text-xs text-hot">Owner tool. Your wallet shows the transaction and you approve it there. Every inscription is a real mainnet transaction and pays its fee.</p>

      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="aspect-square w-full border border-[var(--border-dim)] object-cover" />
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-dim">Inscription</span>
            <select value={which} onChange={(e) => setWhich(e.target.value)} className="border border-[var(--border-dim)] bg-input px-2 py-1 text-hot">
              <option value="collection">Collection: 1Sat Ordnance (mint first)</option>
              {ORDNANCE.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.rarity}, ed. {o.edition}){o.origin ? ' · minted' : ''}
                </option>
              ))}
            </select>
          </label>
          {weapon && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-dim">Edition number (1–{weapon.edition})</span>
                <input type="number" min={1} max={weapon.edition} value={num} onChange={(e) => setNum(Math.max(1, Math.min(weapon.edition, Number(e.target.value) || 1)))} className="border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-dim">Collection origin (from minting the collection; optional)</span>
                <input value={collectionId} onChange={(e) => setCollectionId(e.target.value)} placeholder="txid_0" className="border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
              </label>
            </>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-dim">Send to address (blank: a key in this wallet, kept in its 1sat basket)</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="optional 1… ordinals address" className="border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
          </label>
          <details>
            <summary className="cursor-pointer text-dim">MAP metadata</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all bg-black/60 p-2 text-xs text-accent">{JSON.stringify(map, null, 2)}</pre>
          </details>
          {!w.wallet ? (
            <button onClick={w.connectWallet} disabled={w.busy} className="btn-fire self-start">
              {w.busy ? 'CONNECTING…' : 'CONNECT WALLET'}
            </button>
          ) : (
            <button onClick={mint} disabled={busy} className="btn-fire self-start">
              {busy ? 'WAITING FOR YOUR WALLET…' : `ASK ${w.wallet.name.toUpperCase()} TO INSCRIBE`}
            </button>
          )}
          {w.error && <p className="text-xs text-hot">⚠ {w.error}</p>}
          {msg && (
            <p className={`text-xs ${msg.ok ? 'text-[var(--ok)]' : 'text-hot'}`}>
              {msg.ok ? '✓ ' : '⚠ '}
              {msg.text}{' '}
              {msg.txid && (
                <a href={`https://whatsonchain.com/tx/${msg.txid}`} target="_blank" rel="noopener noreferrer" className="underline">
                  view ↗
                </a>
              )}
            </p>
          )}
        </div>
      </div>
      {w.chooserEl}
    </section>
  );
}
