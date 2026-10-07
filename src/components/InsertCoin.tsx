'use client';

/**
 * The arcade coin slot (src/lib/coinop.ts). useCoinOp(game, tag) keeps this session's credits (in
 * memory, per game) and the txid of each coin; <InsertCoin> is the big "INSERT COIN · 10p (N sats)"
 * button plus the CREDITS counter. Starting a paid game calls `consume()`, which spends one credit
 * and returns that coin's txid (record it with the run). Render `chooserEl` once (wallet picker).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { COINOP_HOUSE, COIN_PENCE, coinSats, insertCoin, isCancel, LIVES_PER_CREDIT } from '@/lib/coinop';
import { useWalletConnect } from './OrdnanceArsenal';

// Credits live for the session (this tab), per game: each entry is the txid of a paid coin.
const credits = new Map<string, string[]>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
let coinN = 0;

export function useCoinOp(game: string, tag: string) {
  const w = useWalletConnect();
  const count = useSyncExternalStore(subscribe, () => credits.get(tag)?.length ?? 0, () => 0);
  const [rate, setRate] = useState<number | null>(null);
  const [rateErr, setRateErr] = useState(false);
  const [paying, setPaying] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);
  const [wantPay, setWantPay] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch('/api/price/gbp')
        .then((r) => r.json())
        .then((j: { bsvGbp?: number }) => {
          if (!live) return;
          setRate(j.bsvGbp ?? null);
          setRateErr(!j.bsvGbp);
        })
        .catch(() => live && setRateErr(true));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const sats = coinSats(rate);

  const pay = useCallback(async () => {
    if (!w.wallet || !sats) return;
    setPaying(true);
    setMsg(null);
    try {
      const txid = await insertCoin(w.wallet.client, { game, tag, sats, n: ++coinN });
      credits.set(tag, [...(credits.get(tag) ?? []), txid]);
      emit();
      setMsg({ ok: true, text: `Coin accepted: 1 credit (${sats.toLocaleString('en-GB')} sats).`, txid });
    } catch (e) {
      setMsg({ ok: false, text: isCancel(e) ? 'Cancelled in the wallet. No coin taken.' : `Coin not taken: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setPaying(false);
    }
  }, [w.wallet, sats, game, tag]);

  // Connect first if needed, then pay once the wallet is in.
  useEffect(() => {
    if (wantPay && w.wallet) {
      void Promise.resolve().then(() => {
        setWantPay(false);
        void pay();
      });
    }
  }, [wantPay, w.wallet, pay]);

  const insert = useCallback(() => {
    if (!COINOP_HOUSE || !sats || paying) return;
    if (w.wallet) return void pay();
    setWantPay(true);
    void w.connectWallet();
  }, [sats, paying, w, pay]);

  /** Spend one credit; returns its coin's txid, or null when there are no credits. */
  const consume = useCallback((): string | null => {
    const list = credits.get(tag) ?? [];
    if (!list.length) return null;
    const [txid, ...rest] = list;
    credits.set(tag, rest);
    emit();
    return txid;
  }, [tag]);

  return { credits: count, sats, rateErr, paying: paying || w.busy, msg, walletErr: w.error, insert, consume, chooserEl: w.chooserEl, enabled: Boolean(COINOP_HOUSE) };
}

export type CoinOp = ReturnType<typeof useCoinOp>;

const txUrl = (txid: string) => `https://whatsonchain.com/tx/${txid}`;

/** The coin slot: INSERT COIN button, CREDITS, and any plain-English result. */
export function InsertCoin({ co }: { co: CoinOp }) {
  const label = !co.enabled ? 'COIN SLOT CLOSED' : co.paying ? 'CHECK YOUR WALLET…' : co.sats ? `INSERT COIN · ${COIN_PENCE}p (${co.sats.toLocaleString('en-GB')} sats)` : co.rateErr ? 'PRICE UNAVAILABLE' : 'PRICING…';
  return (
    <div className="flex flex-col items-center gap-1" onKeyDown={(e) => e.stopPropagation()}>
      <button
        onClick={co.insert}
        disabled={!co.enabled || !co.sats || co.paying}
        className="btn btn-on border-2 border-[#ffd36a] px-4 py-2 text-base font-bold tracking-widest text-[#ffd36a] shadow-[0_0_14px_#ffd36a80] disabled:opacity-50 sm:text-lg"
      >
        🪙 {label}
      </button>
      <p className="text-xs font-bold tracking-[0.3em] text-hot">CREDITS: {co.credits}</p>
      {co.enabled ? (
        <p className="text-[10px] text-dim">
          1 credit = 1 game, {LIVES_PER_CREDIT} lives. Paid to the house in one wallet approval, plus the network fee. No payouts.
        </p>
      ) : (
        <p className="text-[10px] text-dim">Paid play is off here: no house address is set (NEXT_PUBLIC_TB_HOUSE_ADDRESS). Practice is free.</p>
      )}
      {co.msg && (
        <p className={`text-xs ${co.msg.ok ? 'text-[#60ff90]' : 'text-accent'}`}>
          {co.msg.text}{' '}
          {co.msg.txid && (
            <a href={txUrl(co.msg.txid)} target="_blank" rel="noopener noreferrer" className="underline">
              tx ↗
            </a>
          )}
        </p>
      )}
      {co.walletErr && <p className="text-xs text-accent">{co.walletErr}</p>}
    </div>
  );
}
