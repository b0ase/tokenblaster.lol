'use client';

/**
 * Cabinet ammo-coin picker (swap on load, owner 25 Oct 2026). Shows "$X buys N $COIN rounds (curve price)"
 * from a live curve quote, with the slippage limit and the one-approval wording. Hidden while no ammo coin has a
 * token id (src/lib/launch/ammoCoins.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { activeAmmoCoins, planSwapLoad, type AmmoCoin, type SwapLoadQuote } from '@/lib/launch/ammoCoins';
import { fmtUsd } from '@/lib/gallery';

export const SLIPPAGE_CHOICES = [100, 300, 500];

export function useAmmoCoinQuote(coin: AmmoCoin | null, paySats: number | null, gunSats: number, slippageBps: number) {
  const [sold, setSold] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!coin) return;
    let live = true;
    const read = () =>
      fetch(`/api/launch/coin?token=${coin.tokenId}`)
        .then((r) => r.json() as Promise<{ coin?: { sold: number }; error?: string }>)
        .then((j) => {
          if (!live) return;
          if (j.coin) {
            setSold(BigInt(j.coin.sold));
            setErr(null);
          } else setErr(j.error ?? 'No quote.');
        })
        .catch(() => live && setErr('No quote right now.'));
    void read();
    const t = setInterval(read, 5_000); // live: the curve moves with every trade
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [coin]);
  const quote = useMemo<SwapLoadQuote | null>(
    () => (coin && sold !== null && paySats ? planSwapLoad({ paySats, sold, coin, slippageBps, gunSats }) : null),
    [coin, sold, paySats, slippageBps, gunSats],
  );
  return { quote, sold, err };
}

/** The line the cabinet shows for a quote. */
export function quoteLine(coin: AmmoCoin, usd: number, q: SwapLoadQuote | null) {
  if (!q) return `Put at least a coin in to buy $${coin.sym} rounds.`;
  return `${fmtUsd(usd)} buys ${q.rounds.toLocaleString('en-US')} $${coin.sym} rounds (curve price)`;
}

export function AmmoCoinPick(props: {
  chosen: AmmoCoin | null;
  setChosen: (c: AmmoCoin | null) => void;
  payUsd: number;
  quote: SwapLoadQuote | null;
  quoteErr: string | null;
  slippageBps: number;
  setSlippageBps: (n: number) => void;
  status: string | null;
  disabled?: boolean;
}) {
  const coins = activeAmmoCoins();
  if (!coins.length) return null;
  const { chosen, quote } = props;
  return (
    <div className="mb-3 rounded border border-white/15 bg-black/40 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="opacity-70">AMMO</span>
        <button disabled={props.disabled} onClick={() => props.setChosen(null)} className={`btn px-2 py-0.5 ${!chosen ? 'btn-on' : ''}`}>
          Sats rounds
        </button>
        {coins.map((c) => (
          <button key={c.key} disabled={props.disabled} onClick={() => props.setChosen(c)} className={`btn px-2 py-0.5 ${chosen?.key === c.key ? 'btn-on' : ''}`}>
            ${c.sym}
          </button>
        ))}
      </div>
      {chosen && (
        <>
          <p className="font-semibold">{quoteLine(chosen, props.payUsd, quote)}</p>
          {quote && (
            <p className="mt-1 opacity-80">
              {quote.tokens.toLocaleString('en-US')} ${chosen.sym} at least {quote.minTokens.toLocaleString('en-US')} after slippage, plus {quote.fuelSats.toLocaleString('en-US')} sats of gunpowder. Each shot burns {chosen.burnPer.toString()} ${chosen.sym}.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <span className="opacity-70">Slippage</span>
            {SLIPPAGE_CHOICES.map((bps) => (
              <button key={bps} disabled={props.disabled} onClick={() => props.setSlippageBps(bps)} className={`btn px-2 py-0.5 ${props.slippageBps === bps ? 'btn-on' : ''}`}>
                {bps / 100}%
              </button>
            ))}
          </div>
          <p className="mt-2 opacity-70">One approval: your wallet buys ${chosen.sym} on BlastPad and loads it straight into your gun with the gunpowder, in a single transaction.</p>
          {props.quoteErr && <p className="mt-1 text-red-300">{props.quoteErr}</p>}
          {props.status && <p className="mt-1 text-amber-200">{props.status}</p>}
        </>
      )}
    </div>
  );
}
