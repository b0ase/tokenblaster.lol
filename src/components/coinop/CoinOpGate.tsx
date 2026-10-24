'use client';
/**
 * The coin-op gate GameShell puts over every arcade game (owner, 24 Oct 2026: no free play anywhere).
 * Coins add to a total → PAY (one approval, funds the player's own gun) → LOADING AMMO → NAME → START.
 * START pays this game's play price (src/lib/coinop/credit.ts PLAY_PRICE_USD) from the gun to the HOUSE in one
 * transaction tagged "tokenblaster.lol" … "coinop" <game> <name>, records it as one prepaid play and opens the
 * game. The game's own PLAY button uses that play; PLAY AGAIN pays another from the same credit (store.payer).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlaster } from '@/lib/useBlaster';
import { HOUSE } from '@/lib/usePaidPlay';
import { cleanName, fmtCredit, hasCredit, playPriceUsd, playPushes, usdToSats } from '@/lib/coinop/credit';
import { WalletChooser } from '../WalletChooser';
import { CoinCabinet } from './CoinCabinet';
import { coinStore } from './store';
import { useCabinet } from './useCabinet';

export function CoinOpGate({ game, title, children }: { game: string; title: string; children: ReactNode }) {
  const b = useBlaster();
  const cab = useCabinet(b, title);
  const price = playPriceUsd(game);
  const [name, setNameState] = useState('');
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const n = useRef(0);
  const setName = (s: string) => {
    setNameState(s);
    coinStore.setName(s);
  };

  useEffect(() => coinStore.setCredit(cab.creditUsd), [cab.creditUsd]);

  const payPlay = useCallback(async () => {
    const who = cleanName(coinStore.name()) ?? 'player';
    const sats = usdToSats(price, cab.bsvUsd);
    if (!sats) throw new Error('No BSV price yet.');
    if (!hasCredit(coinStore.credit(), price)) throw new Error(`Not enough credit: one play is ${fmtCredit(price)}. Insert coin.`);
    const txids = await b.fireBatch(++n.current, [playPushes(game, who)], { address: HOUSE, sats }, 'coinop');
    if (!txids[0]) throw new Error('The play payment did not go through.');
    return txids[0];
  }, [b, cab.bsvUsd, game, price]);

  useEffect(() => {
    coinStore.setPayer(payPlay);
    return () => coinStore.setPayer(null);
  }, [payPlay]);

  const start = async () => {
    cab.setErr(null);
    setStarting(true);
    try {
      coinStore.addPrepaid(await payPlay());
      setOpen(true);
    } catch (e) {
      cab.setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      {open ? (
        children
      ) : (
        <div className="coinop-gate relative flex min-h-full w-full items-start justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_top,#1a1420,#05060c_70%)] px-4 py-5 sm:items-center">
          <div className="w-full max-w-[720px]">
            <CoinCabinet
              title={title}
              creditUsd={cab.creditUsd}
              pendingUsd={cab.pending}
              bsvUsd={cab.bsvUsd}
              onCoin={cab.onCoin}
              onClear={cab.onClear}
              onPay={() => void cab.pay()}
              stage={cab.stage}
              stageText={cab.stageText}
              name={name}
              setName={setName}
              priceUsd={price}
              priceNote={`One play costs ${fmtCredit(price)} of credit, paid to the house on chain.`}
              startLabel="Start ▶"
              onStart={() => void start()}
              starting={starting}
              walletLabel={b.wallet?.name ?? null}
              error={cab.err}
              footer={
                b.wallet && b.ammo > 0 ? (
                  <button type="button" data-fs-skip onClick={() => void b.unload()} disabled={!!b.busy} className="btn px-3 py-1 text-xs">
                    UNLOAD (return unused credit to your wallet)
                  </button>
                ) : null
              }
            />
          </div>
        </div>
      )}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </>
  );
}
