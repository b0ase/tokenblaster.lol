'use client';

/** "Connect wallet to see your arsenal": the 1Sat Ordnance weapons the connected wallet holds. */
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { discoverWallets, rememberWallet, rememberedWallet, type WalletEntry } from '@/lib/discovery';
import { connect, type Wallet } from '@/lib/wallet';
import { ORDNANCE, RARITY_COLOR, isMinted } from '@/lib/ordnance';
import { saveOrdinalAddresses, savedOrdinalAddresses, useOrdnance } from '@/lib/useOrdnance';
import { WalletChooser } from './WalletChooser';

/** Connect a wallet the light way (no gun): in-app wallet, else remembered, else the chooser. */
export function useWalletConnect() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [chooser, setChooser] = useState<{ note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = useCallback(async (entry: WalletEntry) => {
    setChooser(null);
    setBusy(true);
    setError(null);
    try {
      setWallet(await connect(entry));
      rememberWallet(entry.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  const connectWallet = useCallback(async () => {
    setError(null);
    setBusy(true);
    const all = await discoverWallets().catch(() => [] as WalletEntry[]);
    setBusy(false);
    const inApp = all.find((w) => w.kind === 'in-app');
    if (inApp) return pick(inApp);
    const id = rememberedWallet();
    const found = id && all.find((w) => w.id === id);
    if (found) return pick(found);
    setChooser({ note: id ? 'The wallet you used last time is not available any more.' : null });
  }, [pick]);
  const chooserEl = chooser && <WalletChooser note={chooser.note} onPick={pick} onClose={() => setChooser(null)} />;
  return { wallet, busy, error, connectWallet, chooserEl };
}

export function OrdnanceArsenal() {
  const w = useWalletConnect();
  const [extra, setExtra] = useState<string[]>(() => (typeof window === 'undefined' ? [] : savedOrdinalAddresses()));
  const [draft, setDraft] = useState('');
  const { owned, checking, error } = useOrdnance(w.wallet, extra);
  const anyMinted = ORDNANCE.some(isMinted);
  const mine = ORDNANCE.filter((o) => owned.has(o.id));

  return (
    <section className="panel" id="arsenal">
      <div className="panel-header">
        <span className="panel-title">&gt; Your arsenal</span>
        {w.wallet && <span className="text-xs text-dim">{w.wallet.name} · {w.wallet.address.slice(0, 8)}…</span>}
      </div>
      {!w.wallet ? (
        <div className="flex flex-col items-start gap-2 py-2">
          <p className="text-dim">Connect your wallet to see which ordnance you hold. Nothing is signed: we only read what the wallet (and the 1Sat index) says you own.</p>
          <button onClick={w.connectWallet} disabled={w.busy} className="btn-fire">
            {w.busy ? 'CONNECTING…' : 'CONNECT WALLET TO SEE YOUR ARSENAL'}
          </button>
        </div>
      ) : checking ? (
        <p className="py-2 text-dim">Checking your ordinals…</p>
      ) : mine.length ? (
        <div className="grid gap-2 py-2 sm:grid-cols-2 lg:grid-cols-3">
          {mine.map((o) => (
            <div key={o.id} className="inset flex items-center gap-3 bg-black/60 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.image} alt="" className="h-16 w-16 object-contain" />
              <div>
                <p className="font-bold text-hot">{o.name}</p>
                <p className="text-xs" style={{ color: RARITY_COLOR[o.rarity] }}>
                  {o.rarity.toUpperCase()} · UNLOCKED
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-2 text-dim">
          {anyMinted ? 'No ordnance in this wallet yet. Pick one up on any 1Sat marketplace and it unlocks here and in the games.' : 'Your wallet is connected. Nothing is minted yet: when the first weapons drop, any you hold show up here automatically.'}
        </p>
      )}
      {(w.error || error) && <p className="text-xs text-hot">⚠ {w.error ?? error}</p>}
      {w.wallet && (
        <form
          className="mt-1 flex flex-wrap items-center gap-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            const a = draft.trim();
            if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a) || extra.includes(a)) return;
            const next = [...extra, a];
            setExtra(next);
            saveOrdinalAddresses(next);
            setDraft('');
          }}
        >
          <span className="text-dim">Ordinals in another address (e.g. your Yours ordinals address)?</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="1… address" className="min-w-0 flex-1 border border-[var(--border-dim)] bg-input px-2 py-1 text-hot" />
          <button className="btn px-2 py-1">ADD</button>
          {extra.map((a) => (
            <button
              type="button"
              key={a}
              onClick={() => {
                const next = extra.filter((x) => x !== a);
                setExtra(next);
                saveOrdinalAddresses(next);
              }}
              className="text-dim hover:text-hot"
              title="remove"
            >
              {a.slice(0, 10)}… ×
            </button>
          ))}
        </form>
      )}
      <p className="mt-2 text-xs text-dim">
        Owned weapons appear unlocked in <Link href="/arcade/doubleokweg" className="underline hover:text-hot">Double-O Kweg</Link> (Q Branch) and the <Link href="/arena" className="underline hover:text-hot">Arena</Link> gun picker.
      </p>
      {w.chooserEl}
    </section>
  );
}
