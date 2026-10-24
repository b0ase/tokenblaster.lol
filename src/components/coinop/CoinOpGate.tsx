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
import { tbxFontClass } from './fonts';
import { coinStore } from './store';
import { useCabinet } from './useCabinet';
import { usePlayerName } from './usePlayerName';

export function CoinOpGate({ game, title, children }: { game: string; title: string; children: ReactNode }) {
  const b = useBlaster();
  const cab = useCabinet(b, title);
  const price = playPriceUsd(game);
  const [name, setNameState] = usePlayerName();
  useEffect(() => coinStore.setName(name), [name]);
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
    if (!sats) throw new Error('Checking the price. Try again in a moment.');
    if (!hasCredit(coinStore.credit(), price)) throw new Error(`Not enough credit: one play is ${fmtCredit(price)}. Put another coin in.`);
    const txids = await b.fireBatch(++n.current, [playPushes(game, who)], { address: HOUSE, sats }, 'coinop').catch(() => [] as string[]);
    if (!txids[0]) throw new Error('That did not go through. Your credit is safe. Try again.');
    return txids[0];
  }, [b, cab.bsvUsd, game, price]);

  useEffect(() => {
    coinStore.setPayer(payPlay);
    return () => coinStore.setPayer(null);
  }, [payPlay]);

  const startNow = async () => {
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

  // START = the bill: pay the pending coins (one approval), then pay this play and open the game by itself.
  const startRef = useRef(startNow);
  useEffect(() => {
    startRef.current = startNow;
  });
  const start = () => cab.payThen(() => void startRef.current());
  const buys = (usd: number) => (cab.bsvUsd ? Math.floor((usd + 1e-9) / price) : null);

  return (
    <>
      {open ? (
        children
      ) : (
        <div className={`${tbxFontClass} coinop-gate relative flex min-h-full w-full items-start justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_50%_-10%,#12303a,#071018_55%,#04070b)] px-4 py-4 sm:items-center`}>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--tbx-red)] to-transparent" />
          <div className="tbx-screen w-full max-w-[720px] pt-2">
            <CoinCabinet
              title={title}
              creditUsd={cab.creditUsd}
              pendingUsd={cab.pending}
              bsvUsd={cab.bsvUsd}
              onCoin={cab.onCoin}
              onClear={cab.onClear}
              stage={cab.stage}
              stageText={cab.stageText}
              name={name}
              setName={setName}
              priceUsd={price}
              priceNote={`One play costs ${fmtCredit(price)} of credit, paid to the house on chain.`}
              startLabel="Start ▶"
              onStart={start}
              buys={price > 0 ? buys : undefined}
              unit="plays"
              starting={starting}
              error={cab.err}
            />
          </div>
        </div>
      )}
      {b.chooser && <WalletChooser note={b.chooser.note} onPick={b.pick} onClose={() => b.setChooser(null)} />}
    </>
  );
}
