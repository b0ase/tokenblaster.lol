'use client';

/**
 * The ammo counter: live 1Sat market listings for each ammo token, cheapest per round first.
 * BUY asks the connected wallet to buy the listing (OrdLock v2 purchase): one approval to set the
 * payment aside, one to buy. Nothing is signed here; the tokens land in the wallet's bsv21 basket.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AMMO, PNEE, type AmmoDef } from '@/lib/ammo';
import { ammoListings, buyAmmo, type AmmoListing } from '@/lib/ammoChain';
import { ORDNANCE, ammoOf } from '@/lib/ordnance';
import { formatUsd, usd } from '@/lib/pricing';
import { useWalletConnect } from './OrdnanceArsenal';

const bsv = (sats: number) => `${(sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 6 })} BSV`;

function gunsFor(def: AmmoDef) {
  return ORDNANCE.filter((o) => ammoOf(o) === def.kind && o.id !== 'pnee-shotgun').map((o) => o.name);
}

function AmmoRow({ def, bsvUsd, w }: { def: AmmoDef; bsvUsd: number; w: ReturnType<typeof useWalletConnect> }) {
  const [list, setList] = useState<AmmoListing[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!def.id) return;
    let live = true;
    ammoListings(def.id)
      .then((l) => live && setList(l))
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [def.id, nonce]);

  const buy = async (l: AmmoListing) => {
    if (!w.wallet) return;
    setBusy(l.outpoint);
    setMsg(null);
    try {
      const txid = await buyAmmo(w.wallet.client, l, def.icon);
      setMsg({ ok: true, text: `Bought ${l.amt.toLocaleString()} $${def.sym}. They're in your wallet; load them in the Arena with a ${def.name.toLowerCase()} gun.`, txid });
      setTimeout(() => setNonce((n) => n + 1), 6000);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="panel flex flex-col gap-2" id={def.sym.toLowerCase()}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={def.icon} alt="" className="h-16 w-16 shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-bold" style={{ color: def.color }}>
            ${def.sym} <span className="text-sm text-dim">· {def.name}</span>
          </p>
          <p className="text-sm text-dim">{def.blurb}</p>
          <p className="text-xs text-muted">Fits: {gunsFor(def).join(', ')}</p>
        </div>
      </div>
      {!def.id ? (
        <p className="text-sm font-bold text-hot">COMING SOON · not minted yet. Until it drops, these guns fire any token.</p>
      ) : err ? (
        <p className="text-xs text-hot">⚠ Market unavailable: {err}</p>
      ) : !list ? (
        <p className="text-xs text-dim">Checking the market…</p>
      ) : !list.length ? (
        <p className="text-sm text-dim">Sold out right now. New packs are listed regularly.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.slice(0, 5).map((l) => (
            <li key={l.outpoint} className="inset flex flex-wrap items-center justify-between gap-2 bg-black/50 p-2 text-sm">
              <span className="font-bold text-hot">{l.amt.toLocaleString()} rounds</span>
              <span className="text-dim">
                {bsv(l.price)}
                {bsvUsd ? ` ≈ ${formatUsd(usd(l.price, bsvUsd))}` : ''} + fee
              </span>
              {w.wallet ? (
                <button onClick={() => buy(l)} disabled={Boolean(busy)} className="btn-fire !px-4 !py-1 !text-sm">
                  {busy === l.outpoint ? 'CHECK WALLET…' : 'BUY'}
                </button>
              ) : (
                <button onClick={w.connectWallet} disabled={w.busy} className="btn px-3 py-1 text-xs">
                  CONNECT TO BUY
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-[#60ff90]' : 'text-hot'}`}>
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
}

export function AmmoStore() {
  const w = useWalletConnect();
  const [bsvUsd, setBsvUsd] = useState(0);
  useEffect(() => {
    let live = true;
    fetch('/api/price')
      .then((r) => r.json())
      .then((j: { bsvUsd?: number }) => live && setBsvUsd(j.bsvUsd ?? 0))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <section className="panel flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-dim">Each 1Sat Ordnance gun fires its own ammo in LIVE play. Packs are real BSV-21 tokens, bought from 1Sat market listings straight into your wallet.</p>
        {!w.wallet ? (
          <button onClick={w.connectWallet} disabled={w.busy} className="btn px-3 py-1">
            {w.busy ? 'CONNECTING…' : 'CONNECT WALLET'}
          </button>
        ) : (
          <span className="text-xs text-dim">
            {w.wallet.name} · {w.wallet.address.slice(0, 8)}…
          </span>
        )}
      </section>
      {w.error && <p className="text-xs text-hot">⚠ {w.error}</p>}

      <article className="panel flex flex-wrap items-center gap-3" id="pnee">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ordnance/pnee-logo.png" alt="" className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-hot">
            $PNEE <span className="text-sm text-dim">· real PNEEs</span>
          </p>
          <p className="text-sm text-dim">The PNEE Shotgun only fires the real thing: ten pellets of $PNEE per pull.</p>
        </div>
        {PNEE.buyUrl && (
          <a href={PNEE.buyUrl} target="_blank" rel="noopener noreferrer" className="btn px-3 py-1">
            GET PNEES ↗
          </a>
        )}
      </article>

      <section className="grid gap-3 md:grid-cols-2">
        {Object.values(AMMO).map((d) => (
          <AmmoRow key={d.kind} def={d} bsvUsd={bsvUsd} w={w} />
        ))}
      </section>
      <p className="text-xs text-muted">
        Buying takes two approvals in your wallet: one sets the payment aside, one buys the pack. Every purchase is a real mainnet transaction and pays its network fee.{' '}
        <Link href="/1satordnance/store" className="underline hover:text-hot">
          Need a gun first?
        </Link>
      </p>
      {w.chooserEl}
    </>
  );
}
